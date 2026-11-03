-- PRUEBA COMPLETA SQL 79: pegar TODO este archivo en el SQL Editor y ejecutar.
-- Termina con «PRUEBA OK (se deshace todo)» o «FALLA n». No guarda nada.
begin;
-- =========================================================================
-- 79_compras_taller.sql · v20261102i — COMPRAS DE TALLER (módulo Compras › Taller)
--
--  Pedidos de repuestos / servicios de las obras al taller central, con un solo
--  número TAL-000001 de punta a punta:
--
--    Solicitud (obra) → Bodega central revisa
--        ├─ hay stock  → prepara → envía → la obra confirma (sin compra ni cotizaciones)
--        ├─ en revisión (pide aclaración) / rechazado (con motivo)
--        └─ comprar    → Compras cotiza → pide autorización → el autorizador autoriza
--                        o devuelve → Compras registra la compra (OC / factura /
--                        comprobante, «se pagó con caja chica» sí/no) → entrega
--                        por central, directa del proveedor a la obra o mixta.
--
--  La etapa NO se guarda: se calcula de los datos (v_tc_pedido.fase), así los
--  contadores no se desincronizan. Saldos de entregas parciales por movimientos:
--    C central · D directa · P preparado · E enviado · R recibido en obra · S servicio
--    C + D ≤ Q ;  P ≤ C (o Q si sale de stock) ;  E ≤ P ;  R ≤ E ;  S ≤ Q
--  Cerrado = R + D + S ≥ Q. Enviar no cierra.
--
--  Toda escritura pasa por funciones (no hay políticas de insert/update):
--    · identidad = la sesión (auth.uid / email), nunca un nombre tipeado;
--    · p_version: si otro cambió el pedido → error 40001 «cambió»;
--    · p_op (uuid): reintentar la misma operación no la repite.
--
--  Quién hace qué (tc_yo). Sirve el usuario de Obras (usuario) y/o el de
--  Equipos (perfiles) — mucha gente de taller solo tiene el de Equipos:
--    · super (todo + permisos): admin de Obras o admin central de Equipos.
--    · solicitar / confirmar recepción: taller (todas las obras), admin de obra
--      de Equipos (sus obras), o permiso dado.
--    · bodega central: permiso dado.        · compras: rol compras de Obras o permiso.
--    · autorizar: permiso dado. Quien pidió la autorización no la puede resolver.
--    · ver: los anteriores + gerente (Obras o Equipos).
--  Los permisos se dan en Compras › Taller › Permisos (tabla tc_permiso).
--
--  Fotos y PDF: bucket privado taller_compras/<pedido_id>/…, URLs firmadas,
--  tamaño y tipo los toma la base del archivo subido (no del navegador).
--
--  No hay inventario compartido: «stock» es lo que bodega declara haber
--  verificado para ESE pedido; no reserva existencias globales.
--
--  Se puede correr más de una vez. El histórico de Monday va aparte (SQL 80).
-- =========================================================================

-- ─────────────────────────── 1. Tablas ───────────────────────────
create table if not exists public.tc_proveedor (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) >= 2),
  ruc text, categoria text, contacto text, telefono text, email text, condiciones text,
  activo boolean not null default true,
  creado_por uuid, creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create unique index if not exists tc_proveedor_nombre_uq on public.tc_proveedor (lower(trim(nombre)));

create table if not exists public.tc_permiso (
  user_id uuid not null references auth.users(id) on delete cascade,
  capacidad text not null check (capacidad in ('solicitar', 'bodega', 'compras', 'autorizar', 'ver')),
  obras text[] not null default '{}',          -- solo para «solicitar»: vacío = todas
  otorgado_por uuid, otorgado_en timestamptz not null default now(),
  primary key (user_id, capacidad)
);

create sequence if not exists public.tc_pedido_num;

create table if not exists public.tc_pedido (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null unique default nextval('public.tc_pedido_num'),
  obra_clave text not null references public.obras(clave) on update cascade,
  obra_nombre text not null,
  equipo_id text references public.equipos(id) on update cascade,
  equipo_texto text,
  ot_numero bigint,
  tipo text not null default 'producto' check (tipo in ('producto', 'servicio')),
  descripcion text not null check (length(trim(descripcion)) >= 3),
  codigo_repuesto text, marca_modelo text,
  cantidad numeric not null check (cantidad > 0),
  unidad text not null check (length(trim(unidad)) > 0),
  prioridad text not null default 'normal' check (prioridad in ('normal', 'alta', 'urgente')),
  fecha_requerida date,
  notas text,
  solicitante_id uuid not null, solicitante_nombre text not null,
  creado_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'revision', 'stock', 'compra', 'rechazado', 'anulado')),
  bodega_por uuid, bodega_nombre text, bodega_en timestamptz, bodega_stock numeric check (bodega_stock >= 0), bodega_nota text,
  ruta text not null default 'central' check (ruta in ('central', 'directa', 'mixta')),
  version int not null default 1,
  actualizado_en timestamptz not null default now(),
  legacy_canal text,                       -- procedencia (Monday): no controla el flujo
  legacy_fuente jsonb
);
create index if not exists tc_pedido_obra_ix on public.tc_pedido (obra_clave, creado_en desc);
create index if not exists tc_pedido_estado_ix on public.tc_pedido (estado);

create table if not exists public.tc_cotizacion (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.tc_pedido(id) on delete cascade,
  proveedor_id uuid references public.tc_proveedor(id),
  proveedor_nombre text not null,
  precio_unit numeric not null check (precio_unit >= 0),
  moneda text not null default 'PYG' check (moneda in ('PYG', 'USD')),
  flete numeric not null default 0 check (flete >= 0),
  unidad text,
  impuesto text not null default 'incluido' check (impuesto in ('incluido', 'no_incluido', 'exento')),
  plazo_dias int check (plazo_dias >= 0),
  condiciones text, nota text,
  anulada boolean not null default false,
  rev int not null default 1,
  creado_por uuid, creado_nombre text, creado_en timestamptz not null default now(), editado_en timestamptz
);
create index if not exists tc_cotizacion_ped_ix on public.tc_cotizacion (pedido_id);

create table if not exists public.tc_autorizacion (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.tc_pedido(id) on delete cascade,
  cotizacion_id uuid not null references public.tc_cotizacion(id),
  cotizacion_rev int not null,
  oferta jsonb not null,                   -- copia de la oferta tal como se pidió autorizar
  total numeric not null, moneda text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'autorizada', 'devuelta', 'anulada')),
  solicitado_por uuid not null, solicitado_nombre text not null, solicitado_en timestamptz not null default now(),
  motivo text not null,
  resuelto_por uuid, resuelto_nombre text, resuelto_en timestamptz, motivo_resolucion text
);
create unique index if not exists tc_autorizacion_activa_uq on public.tc_autorizacion (pedido_id) where estado in ('pendiente', 'autorizada');

create table if not exists public.tc_compra (
  pedido_id uuid primary key references public.tc_pedido(id) on delete cascade,
  autorizacion_id uuid references public.tc_autorizacion(id),
  oferta jsonb not null,
  cantidad numeric not null, total numeric, moneda text,
  doc_tipo text not null check (doc_tipo in ('oc', 'factura', 'comprobante')),
  doc_numero text not null,
  fecha_compra date not null,
  uso_caja_chica boolean,                  -- null = desconocido (solo histórico)
  registrado_por uuid, registrado_nombre text, registrado_en timestamptz not null default now(), corregido_en timestamptz
);

create table if not exists public.tc_movimiento (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.tc_pedido(id) on delete cascade,
  tipo text not null check (tipo in ('central', 'prepara', 'envio', 'recepcion', 'directa', 'servicio')),
  cantidad numeric not null check (cantidad > 0),
  fecha date not null,
  referencia text, responsable text, nota text,
  registrado_por uuid, registrado_nombre text, registrado_en timestamptz not null default now(),
  anulado_en timestamptz, anulado_por uuid, anulado_nombre text, anulado_motivo text
);
create index if not exists tc_movimiento_ped_ix on public.tc_movimiento (pedido_id);

create table if not exists public.tc_evento (
  id bigserial primary key,
  pedido_id uuid not null references public.tc_pedido(id) on delete cascade,
  en timestamptz not null default now(),
  actor_id uuid, actor_nombre text,
  titulo text not null, detalle text
);
create index if not exists tc_evento_ped_ix on public.tc_evento (pedido_id, en);

create table if not exists public.tc_adjunto (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.tc_pedido(id) on delete cascade,
  tipo text not null default 'foto' check (tipo in ('foto', 'cotizacion', 'compra', 'entrega', 'otro')),
  ref_id uuid,                             -- cotización o movimiento al que pertenece
  ruta text not null unique,
  nombre text, mime text, tamano bigint, sha256 text, ancho int, alto int,
  subido_por uuid, subido_nombre text, subido_en timestamptz not null default now(),
  quitado_en timestamptz, quitado_por uuid
);
create index if not exists tc_adjunto_ped_ix on public.tc_adjunto (pedido_id);

create table if not exists public.tc_operacion (
  op uuid primary key,
  user_id uuid not null,
  accion text not null,
  pedido_id uuid,
  resultado jsonb,
  en timestamptz not null default now()
);

-- ─────────────────────────── 2. Quién soy y qué puedo ───────────────────────────
create or replace function public.tc_yo()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.app_email();
  r_ob text; n_ob text;
  r_eq text; n_eq text; o_eq text[];
  g_sol boolean; g_sol_obras text[];
  v_super boolean; v_sol boolean; v_sol_todas boolean := false; v_sol_obras text[] := '{}';
  v_bod boolean; v_com boolean; v_aut boolean; v_ver boolean; v_ver_todas boolean;
begin
  if v_uid is null then return null; end if;
  select u.rol, u.nombre into r_ob, n_ob from usuario u where u.email = v_email and u.activo;
  select p.rol::text, p.nombre, coalesce(p.obras, '{}') into r_eq, n_eq, o_eq from perfiles p where p.id = v_uid and coalesce(p.activo, true);
  select true, obras into g_sol, g_sol_obras from tc_permiso where user_id = v_uid and capacidad = 'solicitar';

  v_super := coalesce(r_ob = 'admin', false) or coalesce(r_eq = 'admin_central', false);

  -- solicitar y confirmar recepción, con alcance por obra
  if v_super or r_eq = 'taller' or (g_sol and cardinality(g_sol_obras) = 0)
     or (r_eq = 'admin_obra' and cardinality(o_eq) = 0) then
    v_sol_todas := true;
  else
    if r_eq = 'admin_obra' then v_sol_obras := v_sol_obras || o_eq; end if;
    if g_sol then v_sol_obras := v_sol_obras || g_sol_obras; end if;
  end if;
  v_sol := v_sol_todas or cardinality(v_sol_obras) > 0;

  v_bod := v_super or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'bodega');
  v_com := v_super or coalesce(r_ob = 'compras', false) or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'compras');
  v_aut := v_super or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'autorizar');

  v_ver_todas := v_sol_todas or v_bod or v_com or v_aut
    or coalesce(r_ob in ('gerente', 'compras'), false) or coalesce(r_eq = 'gerente', false)
    or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'ver');
  v_ver := v_ver_todas or v_sol;

  if not v_ver then
    return jsonb_build_object('uid', v_uid, 'email', v_email, 'nombre', coalesce(n_ob, n_eq, v_email),
      'rol_obras', r_ob, 'rol_equipos', r_eq, 'ver', false);
  end if;
  return jsonb_build_object(
    'uid', v_uid, 'email', v_email, 'nombre', coalesce(nullif(n_ob, ''), nullif(n_eq, ''), v_email),
    'rol_obras', r_ob, 'rol_equipos', r_eq,
    'super', v_super, 'ver', v_ver, 'ver_todas', v_ver_todas,
    'ver_obras', to_jsonb(v_sol_obras),
    'solicitar', v_sol, 'sol_todas', v_sol_todas, 'sol_obras', to_jsonb(v_sol_obras),
    'bodega', v_bod, 'compras', v_com, 'autorizar', v_aut);
end $$;

create or replace function public._tc_en(yo jsonb, p_lista text, p_obra text)
returns boolean language sql immutable as $$
  select p_obra in (select jsonb_array_elements_text(coalesce(yo -> p_lista, '[]'::jsonb)))
$$;

create or replace function public._tc_ve(yo jsonb, p_obra text)
returns boolean language sql immutable as $$
  select coalesce((yo ->> 'ver_todas')::boolean, false) or public._tc_en(yo, 'ver_obras', p_obra)
$$;

create or replace function public._tc_sol(yo jsonb, p_obra text)
returns boolean language sql immutable as $$
  select coalesce((yo ->> 'solicitar')::boolean, false)
     and (coalesce((yo ->> 'sol_todas')::boolean, false) or public._tc_en(yo, 'sol_obras', p_obra))
$$;

create or replace function public.tc_ve_obra(p_obra text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public._tc_ve(public.tc_yo(), p_obra), false)
$$;

create or replace function public._tc_exigir(yo jsonb, p_cap text)
returns void language plpgsql immutable as $$
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> p_cap)::boolean, false) then
    raise exception 'Tu usuario no tiene permiso de %.', case p_cap when 'bodega' then 'bodega central'
      when 'compras' then 'compras' when 'autorizar' then 'autorizar compras' when 'super' then 'administrador'
      else p_cap end using errcode = '42501';
  end if;
end $$;

-- ─────────────────────────── 3. Saldos y etapa (calculados) ───────────────────────────
create or replace view public.v_tc_pedido with (security_invoker = true) as
select p.*,
  'TAL-' || lpad(p.numero::text, 6, '0') as codigo,
  coalesce(m.c, 0) as q_central, coalesce(m.d, 0) as q_directa, coalesce(m.pr, 0) as q_prepara,
  coalesce(m.e, 0) as q_envio, coalesce(m.r, 0) as q_recepcion, coalesce(m.s, 0) as q_servicio,
  m.ult_recepcion,
  a.id as aut_id, a.estado as aut_estado, a.total as aut_total, a.moneda as aut_moneda,
  a.oferta ->> 'proveedor_nombre' as aut_proveedor,
  (c.pedido_id is not null) as comprado, c.doc_tipo, c.doc_numero, c.fecha_compra, c.uso_caja_chica,
  c.total as compra_total, c.moneda as compra_moneda, c.oferta ->> 'proveedor_nombre' as compra_proveedor,
  coalesce(q.n, 0) as n_cotizaciones,
  coalesce(f.n, 0) as n_fotos,
  case
    when p.estado = 'anulado' then 'anulado'
    when p.estado = 'rechazado' then 'rechazado'
    when p.estado in ('pendiente', 'revision') then 'bodega'
    when p.estado = 'compra' and c.pedido_id is null then
      case a.estado when 'pendiente' then 'autorizacion' when 'autorizada' then 'compra' else 'cotizacion' end
    when coalesce(m.r, 0) + coalesce(m.d, 0) + coalesce(m.s, 0) >= p.cantidad then 'cerrado'
    else 'entrega'
  end as fase
from public.tc_pedido p
left join lateral (
  select sum(cantidad) filter (where tipo = 'central') c, sum(cantidad) filter (where tipo = 'directa') d,
         sum(cantidad) filter (where tipo = 'prepara') pr, sum(cantidad) filter (where tipo = 'envio') e,
         sum(cantidad) filter (where tipo = 'recepcion') r, sum(cantidad) filter (where tipo = 'servicio') s,
         max(fecha) filter (where tipo in ('recepcion', 'directa', 'servicio')) ult_recepcion
    from public.tc_movimiento mv where mv.pedido_id = p.id and mv.anulado_en is null) m on true
left join public.tc_autorizacion a on a.pedido_id = p.id and a.estado in ('pendiente', 'autorizada')
left join public.tc_compra c on c.pedido_id = p.id
left join lateral (select count(*) n from public.tc_cotizacion x where x.pedido_id = p.id and not x.anulada) q on true
left join lateral (select count(*) n from public.tc_adjunto x where x.pedido_id = p.id and x.tipo = 'foto' and x.quitado_en is null) f on true;

-- Revisa los saldos del pedido; si algo no cierra, aborta la transacción.
create or replace function public._tc_validar_saldos(p_pedido uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v record; base numeric;
begin
  select * into v from public.v_tc_pedido where id = p_pedido;
  base := case when v.estado = 'stock' then v.cantidad else v.q_central end;
  if v.estado = 'stock' and (v.q_central > 0 or v.q_directa > 0 or v.q_servicio > 0) then
    raise exception 'Un pedido atendido desde stock no tiene recepciones de proveedor.' using errcode = '22023'; end if;
  if v.q_central + v.q_directa > v.cantidad then
    raise exception 'Lo recibido del proveedor (% en central + % directo) supera lo pedido (%).', v.q_central, v.q_directa, v.cantidad using errcode = '22023'; end if;
  if v.q_prepara > base then
    raise exception 'Lo preparado (%) supera lo disponible en central para este pedido (%).', v.q_prepara, base using errcode = '22023'; end if;
  if v.q_envio > v.q_prepara then
    raise exception 'Lo enviado (%) supera lo preparado (%).', v.q_envio, v.q_prepara using errcode = '22023'; end if;
  if v.q_recepcion > v.q_envio then
    raise exception 'Lo recibido en obra (%) supera lo enviado desde central (%).', v.q_recepcion, v.q_envio using errcode = '22023'; end if;
  if v.q_servicio > v.cantidad then
    raise exception 'La conformidad (%) supera lo pedido (%).', v.q_servicio, v.cantidad using errcode = '22023'; end if;
end $$;

create or replace function public._tc_evento(p_pedido uuid, yo jsonb, p_titulo text, p_detalle text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.tc_evento (pedido_id, actor_id, actor_nombre, titulo, detalle)
  values (p_pedido, (yo ->> 'uid')::uuid, yo ->> 'nombre', p_titulo, nullif(trim(coalesce(p_detalle, '')), ''))
$$;

create or replace function public._tc_txt(p jsonb, k text) returns text language sql immutable as $$
  select nullif(trim(coalesce(p ->> k, '')), '')
$$;
create or replace function public._tc_num(p jsonb, k text) returns numeric language plpgsql immutable as $$
declare t text := nullif(trim(coalesce(p ->> k, '')), '');
begin
  if t is null then return null; end if;
  return replace(t, ',', '.')::numeric;
exception when others then
  raise exception 'El valor «%» no es un número válido.', t using errcode = '22023';
end $$;

create or replace function public._tc_fmt(v numeric) returns text language sql immutable as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(v, 'FM999999999990.######')))
$$;

-- ─────────────────────────── 4. Crear pedido ───────────────────────────
create or replace function public.tc_pedido_crear(p_op uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  yo jsonb := public.tc_yo();
  prev jsonb; v_obra obras%rowtype; v_eq text; nuevo tc_pedido%rowtype; res jsonb;
  v_q numeric := public._tc_num(p, 'cantidad');
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_op is null then raise exception 'Falta la clave de la operación.' using errcode = '22023'; end if;
  select resultado into prev from tc_operacion where op = p_op and user_id = (yo ->> 'uid')::uuid;
  if found then return prev || '{"repetida": true}'; end if;

  select * into v_obra from obras where clave = public._tc_txt(p, 'obra_clave');
  if not found then raise exception 'Elegí la obra / destino del pedido.' using errcode = '22023'; end if;
  if not v_obra.activa then raise exception 'La obra % no está activa.', v_obra.nombre using errcode = '22023'; end if;
  if not public._tc_sol(yo, v_obra.clave) then
    raise exception 'Tu usuario no puede pedir repuestos para %.', v_obra.nombre using errcode = '42501'; end if;
  v_eq := public._tc_txt(p, 'equipo_id');
  if v_eq is not null and not exists (select 1 from equipos where id = v_eq) then
    raise exception 'El equipo % no está en la flota.', v_eq using errcode = '22023'; end if;
  if v_q is null or v_q <= 0 then raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = '22023'; end if;
  if public._tc_txt(p, 'unidad') is null then raise exception 'Indicá la unidad.' using errcode = '22023'; end if;
  if length(coalesce(public._tc_txt(p, 'descripcion'), '')) < 3 then raise exception 'Describí el repuesto o servicio.' using errcode = '22023'; end if;

  insert into tc_pedido (obra_clave, obra_nombre, equipo_id, equipo_texto, ot_numero, tipo, descripcion, codigo_repuesto,
                         marca_modelo, cantidad, unidad, prioridad, fecha_requerida, notas, solicitante_id, solicitante_nombre)
  values (v_obra.clave, v_obra.nombre, v_eq, public._tc_txt(p, 'equipo_texto'), public._tc_num(p, 'ot_numero')::bigint,
          coalesce(public._tc_txt(p, 'tipo'), 'producto'), public._tc_txt(p, 'descripcion'), public._tc_txt(p, 'codigo_repuesto'),
          public._tc_txt(p, 'marca_modelo'), v_q, public._tc_txt(p, 'unidad'), coalesce(public._tc_txt(p, 'prioridad'), 'normal'),
          public._tc_txt(p, 'fecha_requerida')::date, public._tc_txt(p, 'notas'), (yo ->> 'uid')::uuid, yo ->> 'nombre')
  returning * into nuevo;

  perform public._tc_evento(nuevo.id, yo, 'Solicitud cargada',
    public._tc_fmt(nuevo.cantidad) || ' ' || nuevo.unidad || ' · ' || nuevo.obra_nombre || coalesce(' · ' || nuevo.equipo_id, ''));
  res := jsonb_build_object('ok', true, 'id', nuevo.id, 'codigo', 'TAL-' || lpad(nuevo.numero::text, 6, '0'), 'version', nuevo.version);
  insert into tc_operacion (op, user_id, accion, pedido_id, resultado) values (p_op, (yo ->> 'uid')::uuid, 'crear', nuevo.id, res);
  return res;
end $$;

-- ─────────────────────────── 5. Acciones sobre un pedido ───────────────────────────
create or replace function public.tc_accion(p_pedido uuid, p_accion text, p_version int, p_op uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  yo jsonb := public.tc_yo();
  v_uid uuid := (yo ->> 'uid')::uuid;
  prev jsonb; ped tc_pedido%rowtype; v record; res jsonb;
  v_txt text; v_mot text; v_q numeric; v_n numeric; v_id uuid; v_tipo text; v_fecha date;
  cot tc_cotizacion%rowtype; aut tc_autorizacion%rowtype; com tc_compra%rowtype; mov tc_movimiento%rowtype;
  v_obra obras%rowtype; v_det text;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_op is null then raise exception 'Falta la clave de la operación.' using errcode = '22023'; end if;
  p := coalesce(p, '{}'::jsonb);
  select resultado into prev from tc_operacion where op = p_op and user_id = v_uid;
  if found then return prev || '{"repetida": true}'; end if;

  select * into ped from tc_pedido where id = p_pedido for update;
  if not found then raise exception 'El pedido no existe.' using errcode = 'P0002'; end if;
  if not public._tc_ve(yo, ped.obra_clave) then raise exception 'No tenés acceso a los pedidos de %.', ped.obra_nombre using errcode = '42501'; end if;
  if p_version is distinct from ped.version then
    raise exception 'El pedido TAL-% cambió mientras lo tenías abierto. Se actualiza para que veas lo último.', lpad(ped.numero::text, 6, '0') using errcode = '40001';
  end if;
  select * into v from v_tc_pedido where id = p_pedido;
  v_mot := public._tc_txt(p, 'motivo');

  case p_accion
  -- ── solicitante ──────────────────────────────────────────────
  when 'editar' then
    if ped.estado not in ('pendiente', 'revision') then raise exception 'Bodega ya decidió: el pedido no se puede editar.' using errcode = '22023'; end if;
    if ped.solicitante_id <> v_uid and not coalesce((yo ->> 'super')::boolean, false) then
      raise exception 'Solo quien cargó el pedido lo puede editar.' using errcode = '42501'; end if;
    if public._tc_txt(p, 'obra_clave') is not null and public._tc_txt(p, 'obra_clave') <> ped.obra_clave then
      select * into v_obra from obras where clave = public._tc_txt(p, 'obra_clave') and activa;
      if not found or not public._tc_sol(yo, v_obra.clave) then raise exception 'No podés pasar el pedido a esa obra.' using errcode = '42501'; end if;
      ped.obra_clave := v_obra.clave; ped.obra_nombre := v_obra.nombre;
    end if;
    v_q := coalesce(public._tc_num(p, 'cantidad'), ped.cantidad);
    if v_q <= 0 then raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = '22023'; end if;
    if public._tc_txt(p, 'equipo_id') is not null and not exists (select 1 from equipos where id = public._tc_txt(p, 'equipo_id')) then
      raise exception 'El equipo no está en la flota.' using errcode = '22023'; end if;
    update tc_pedido set obra_clave = ped.obra_clave, obra_nombre = ped.obra_nombre,
      descripcion = coalesce(public._tc_txt(p, 'descripcion'), descripcion),
      codigo_repuesto = case when p ? 'codigo_repuesto' then public._tc_txt(p, 'codigo_repuesto') else codigo_repuesto end,
      marca_modelo = case when p ? 'marca_modelo' then public._tc_txt(p, 'marca_modelo') else marca_modelo end,
      equipo_id = case when p ? 'equipo_id' then public._tc_txt(p, 'equipo_id') else equipo_id end,
      equipo_texto = case when p ? 'equipo_texto' then public._tc_txt(p, 'equipo_texto') else equipo_texto end,
      ot_numero = case when p ? 'ot_numero' then public._tc_num(p, 'ot_numero')::bigint else ot_numero end,
      tipo = coalesce(public._tc_txt(p, 'tipo'), tipo), cantidad = v_q,
      unidad = coalesce(public._tc_txt(p, 'unidad'), unidad), prioridad = coalesce(public._tc_txt(p, 'prioridad'), prioridad),
      fecha_requerida = case when p ? 'fecha_requerida' then public._tc_txt(p, 'fecha_requerida')::date else fecha_requerida end,
      notas = case when p ? 'notas' then public._tc_txt(p, 'notas') else notas end,
      estado = 'pendiente'
     where id = ped.id;
    perform public._tc_evento(ped.id, yo, case when ped.estado = 'revision' then 'Solicitud corregida · vuelve a bodega' else 'Solicitud editada' end, v_mot);

  when 'anular' then
    if ped.estado not in ('pendiente', 'revision') then raise exception 'Solo se anula antes de la decisión de bodega.' using errcode = '22023'; end if;
    if ped.solicitante_id <> v_uid and not coalesce((yo ->> 'super')::boolean, false) then
      raise exception 'Solo quien cargó el pedido lo puede anular.' using errcode = '42501'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set estado = 'anulado' where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Pedido anulado por el solicitante', v_mot);

  -- ── bodega central ───────────────────────────────────────────
  when 'bodega_revision', 'bodega_rechazar', 'bodega_stock', 'bodega_compra' then
    perform public._tc_exigir(yo, 'bodega');
    if ped.estado not in ('pendiente', 'revision') then raise exception 'Bodega ya decidió este pedido.' using errcode = '22023'; end if;
    v_n := public._tc_num(p, 'stock');
    if v_n is not null and v_n < 0 then raise exception 'El stock no puede ser negativo.' using errcode = '22023'; end if;
    if p_accion in ('bodega_revision', 'bodega_rechazar') and v_mot is null then
      raise exception 'Indicá el motivo (lo ve el solicitante).' using errcode = '22023'; end if;
    if p_accion = 'bodega_stock' then
      if ped.tipo = 'servicio' then raise exception 'Un servicio no sale de stock.' using errcode = '22023'; end if;
      if v_n is null or v_n < ped.cantidad then
        raise exception 'Para atender desde stock tiene que haber al menos % % verificados. Si falta, derivá a compras.', public._tc_fmt(ped.cantidad), ped.unidad using errcode = '22023'; end if;
    end if;
    update tc_pedido set estado = case p_accion when 'bodega_revision' then 'revision' when 'bodega_rechazar' then 'rechazado'
                                          when 'bodega_stock' then 'stock' else 'compra' end,
      bodega_por = v_uid, bodega_nombre = yo ->> 'nombre', bodega_en = now(), bodega_stock = v_n, bodega_nota = v_mot,
      ruta = case when p_accion = 'bodega_stock' then 'central' else ruta end
     where id = ped.id;
    perform public._tc_evento(ped.id, yo, case p_accion when 'bodega_revision' then 'Bodega pidió aclaración'
        when 'bodega_rechazar' then 'Bodega rechazó el pedido' when 'bodega_stock' then 'Bodega: hay stock, se atiende desde central'
        else 'Bodega: sin stock suficiente, se deriva a compras' end,
      concat_ws(' · ', case when v_n is not null then 'stock verificado ' || public._tc_fmt(v_n) || ' ' || ped.unidad end, v_mot));

  when 'bodega_volver' then
    perform public._tc_exigir(yo, 'bodega');
    if ped.estado not in ('stock', 'compra', 'rechazado') then raise exception 'No hay decisión de bodega para deshacer.' using errcode = '22023'; end if;
    if v.comprado or v.aut_id is not null or exists (select 1 from tc_movimiento where pedido_id = ped.id and anulado_en is null) then
      raise exception 'Ya hay autorización, compra o movimientos: la decisión de bodega no se puede deshacer.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set estado = 'pendiente' where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Bodega reabrió su decisión', v_mot);

  -- ── compras: cotizaciones ───────────────────────────────────
  when 'cot_guardar', 'cot_anular' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' then raise exception 'El pedido no está derivado a compras.' using errcode = '22023'; end if;
    if v.comprado then raise exception 'La compra ya está registrada: las cotizaciones quedan como están.' using errcode = '22023'; end if;
    v_id := nullif(public._tc_txt(p, 'id'), '')::uuid;
    if v_id is not null then
      select * into cot from tc_cotizacion where id = v_id and pedido_id = ped.id for update;
      if not found or cot.anulada then raise exception 'La cotización no existe o está anulada.' using errcode = '22023'; end if;
    elsif p_accion = 'cot_anular' then raise exception 'Falta la cotización.' using errcode = '22023';
    end if;
    if p_accion = 'cot_anular' then
      update tc_cotizacion set anulada = true, editado_en = now() where id = v_id;
      perform public._tc_evento(ped.id, yo, 'Cotización anulada', cot.proveedor_nombre || coalesce(' · ' || v_mot, ''));
    else
      v_n := public._tc_num(p, 'precio_unit');
      if v_n is null or v_n < 0 then raise exception 'Indicá el precio unitario.' using errcode = '22023'; end if;
      v_txt := public._tc_txt(p, 'proveedor_nombre');
      if public._tc_txt(p, 'proveedor_id') is not null then
        select nombre into v_txt from tc_proveedor where id = public._tc_txt(p, 'proveedor_id')::uuid;
        if not found then raise exception 'El proveedor no existe.' using errcode = '22023'; end if;
      end if;
      if v_txt is null then raise exception 'Indicá el proveedor.' using errcode = '22023'; end if;
      if v_id is null then
        insert into tc_cotizacion (pedido_id, proveedor_id, proveedor_nombre, precio_unit, moneda, flete, unidad, impuesto,
                                   plazo_dias, condiciones, nota, creado_por, creado_nombre)
        values (ped.id, public._tc_txt(p, 'proveedor_id')::uuid, v_txt, v_n, coalesce(public._tc_txt(p, 'moneda'), 'PYG'),
                coalesce(public._tc_num(p, 'flete'), 0), coalesce(public._tc_txt(p, 'unidad'), ped.unidad),
                coalesce(public._tc_txt(p, 'impuesto'), 'incluido'), public._tc_num(p, 'plazo_dias')::int,
                public._tc_txt(p, 'condiciones'), public._tc_txt(p, 'nota'), v_uid, yo ->> 'nombre')
        returning * into cot;
        v_id := cot.id;
        perform public._tc_evento(ped.id, yo, 'Cotización cargada', v_txt || ' · ' || cot.moneda || ' ' || public._tc_fmt(v_n) || ' c/u');
      else
        update tc_cotizacion set proveedor_id = public._tc_txt(p, 'proveedor_id')::uuid, proveedor_nombre = v_txt, precio_unit = v_n,
          moneda = coalesce(public._tc_txt(p, 'moneda'), moneda), flete = coalesce(public._tc_num(p, 'flete'), 0),
          unidad = coalesce(public._tc_txt(p, 'unidad'), unidad), impuesto = coalesce(public._tc_txt(p, 'impuesto'), impuesto),
          plazo_dias = public._tc_num(p, 'plazo_dias')::int, condiciones = public._tc_txt(p, 'condiciones'),
          nota = public._tc_txt(p, 'nota'), rev = rev + 1, editado_en = now()
         where id = v_id;
        perform public._tc_evento(ped.id, yo, 'Cotización modificada', v_txt || ' · ' || coalesce(public._tc_txt(p, 'moneda'), cot.moneda) || ' ' || public._tc_fmt(v_n) || ' c/u');
      end if;
    end if;
    -- tocar la oferta que se pidió autorizar la deja sin efecto
    if v_id is not null and v.aut_id is not null then
      select * into aut from tc_autorizacion where id = v.aut_id;
      if aut.cotizacion_id = v_id then
        update tc_autorizacion set estado = 'anulada', resuelto_en = coalesce(resuelto_en, now()),
          motivo_resolucion = coalesce(motivo_resolucion, 'La cotización cambió después de pedir la autorización.') where id = aut.id;
        perform public._tc_evento(ped.id, yo, case aut.estado when 'autorizada' then 'Autorización sin efecto' else 'Pedido de autorización sin efecto' end,
          'Se modificó o anuló la cotización elegida: hay que volver a pedir autorización.');
      end if;
    end if;

  -- ── autorización ─────────────────────────────────────────────
  when 'aut_solicitar' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' or v.comprado then raise exception 'El pedido no está esperando compra.' using errcode = '22023'; end if;
    if v.aut_id is not null then raise exception 'Ya hay una autorización % para este pedido.', case v.aut_estado when 'pendiente' then 'pedida' else 'vigente' end using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá por qué se elige esta oferta.' using errcode = '22023'; end if;
    select * into cot from tc_cotizacion where id = public._tc_txt(p, 'cotizacion_id')::uuid and pedido_id = ped.id and not anulada;
    if not found then raise exception 'Elegí una cotización vigente.' using errcode = '22023'; end if;
    insert into tc_autorizacion (pedido_id, cotizacion_id, cotizacion_rev, oferta, total, moneda, solicitado_por, solicitado_nombre, motivo)
    values (ped.id, cot.id, cot.rev, to_jsonb(cot), cot.precio_unit * ped.cantidad + cot.flete, cot.moneda, v_uid, yo ->> 'nombre', v_mot);
    perform public._tc_evento(ped.id, yo, 'Autorización solicitada',
      cot.proveedor_nombre || ' · ' || cot.moneda || ' ' || public._tc_fmt(cot.precio_unit * ped.cantidad + cot.flete) || ' · ' || v_mot);

  when 'aut_resolver' then
    perform public._tc_exigir(yo, 'autorizar');
    select * into aut from tc_autorizacion where id = public._tc_txt(p, 'autorizacion_id')::uuid and pedido_id = ped.id for update;
    if not found or aut.estado <> 'pendiente' then raise exception 'Esa solicitud de autorización ya no está pendiente.' using errcode = '22023'; end if;
    if aut.solicitado_por = v_uid then raise exception 'Quien pide la autorización no la puede resolver: la tiene que resolver otra persona.' using errcode = '42501'; end if;
    select * into cot from tc_cotizacion where id = aut.cotizacion_id;
    if cot.anulada or cot.rev <> aut.cotizacion_rev then raise exception 'La cotización cambió desde que se pidió la autorización.' using errcode = '22023'; end if;
    v_txt := public._tc_txt(p, 'decision');
    if v_txt not in ('autorizar', 'devolver') then raise exception 'Decisión no válida.' using errcode = '22023'; end if;
    if v_txt = 'devolver' and v_mot is null then raise exception 'Indicá el motivo para devolver a compras.' using errcode = '22023'; end if;
    update tc_autorizacion set estado = case v_txt when 'autorizar' then 'autorizada' else 'devuelta' end,
      resuelto_por = v_uid, resuelto_nombre = yo ->> 'nombre', resuelto_en = now(), motivo_resolucion = v_mot where id = aut.id;
    perform public._tc_evento(ped.id, yo, case v_txt when 'autorizar' then 'Compra autorizada' else 'Autorización devuelta a compras' end,
      concat_ws(' · ', aut.oferta ->> 'proveedor_nombre', aut.moneda || ' ' || public._tc_fmt(aut.total), v_mot));

  -- ── compra ───────────────────────────────────────────────────
  when 'compra_registrar' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' or v.comprado then raise exception 'El pedido no está esperando compra.' using errcode = '22023'; end if;
    if v.aut_estado is distinct from 'autorizada' then raise exception 'Falta la autorización de la compra.' using errcode = '22023'; end if;
    select * into aut from tc_autorizacion where id = v.aut_id;
    if public._tc_txt(p, 'doc_tipo') not in ('oc', 'factura', 'comprobante') then raise exception 'Elegí el tipo de documento.' using errcode = '22023'; end if;
    if public._tc_txt(p, 'doc_numero') is null then raise exception 'Indicá el número del documento.' using errcode = '22023'; end if;
    v_fecha := public._tc_txt(p, 'fecha_compra')::date;
    if v_fecha is null then raise exception 'Indicá la fecha de compra.' using errcode = '22023'; end if;
    if jsonb_typeof(p -> 'uso_caja_chica') is distinct from 'boolean' then raise exception 'Indicá si se pagó con caja chica.' using errcode = '22023'; end if;
    v_txt := case when ped.tipo = 'servicio' then 'directa' else coalesce(public._tc_txt(p, 'ruta'), 'central') end;
    if v_txt not in ('central', 'directa', 'mixta') then raise exception 'Ruta de entrega no válida.' using errcode = '22023'; end if;
    insert into tc_compra (pedido_id, autorizacion_id, oferta, cantidad, total, moneda, doc_tipo, doc_numero, fecha_compra,
                           uso_caja_chica, registrado_por, registrado_nombre)
    values (ped.id, aut.id, aut.oferta, ped.cantidad, aut.total, aut.moneda, public._tc_txt(p, 'doc_tipo'), public._tc_txt(p, 'doc_numero'),
            v_fecha, (p ->> 'uso_caja_chica')::boolean, v_uid, yo ->> 'nombre');
    update tc_pedido set ruta = v_txt where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Compra registrada',
      concat_ws(' · ', upper(public._tc_txt(p, 'doc_tipo')) || ' ' || public._tc_txt(p, 'doc_numero'), aut.oferta ->> 'proveedor_nombre',
        case when (p ->> 'uso_caja_chica')::boolean then 'caja chica' end,
        case v_txt when 'central' then 'entrega por central' when 'directa' then 'entrega directa en obra' else 'entrega mixta' end));

  when 'compra_corregir' then
    perform public._tc_exigir(yo, 'compras');
    select * into com from tc_compra where pedido_id = ped.id for update;
    if not found then raise exception 'No hay compra registrada.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo de la corrección.' using errcode = '22023'; end if;
    update tc_compra set doc_tipo = coalesce(public._tc_txt(p, 'doc_tipo'), doc_tipo), doc_numero = coalesce(public._tc_txt(p, 'doc_numero'), doc_numero),
      fecha_compra = coalesce(public._tc_txt(p, 'fecha_compra')::date, fecha_compra),
      uso_caja_chica = case when jsonb_typeof(p -> 'uso_caja_chica') = 'boolean' then (p ->> 'uso_caja_chica')::boolean else uso_caja_chica end,
      corregido_en = now()
     where pedido_id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Compra corregida', concat_ws(' · ',
      case when public._tc_txt(p, 'doc_numero') is distinct from com.doc_numero and public._tc_txt(p, 'doc_numero') is not null then 'documento ' || com.doc_numero || ' → ' || public._tc_txt(p, 'doc_numero') end,
      case when jsonb_typeof(p -> 'uso_caja_chica') = 'boolean' and (p ->> 'uso_caja_chica')::boolean is distinct from com.uso_caja_chica
           then 'caja chica: ' || case when (p ->> 'uso_caja_chica')::boolean then 'sí' else 'no' end end,
      v_mot));

  when 'ruta_cambiar' then
    if not (coalesce((yo ->> 'compras')::boolean, false) or coalesce((yo ->> 'bodega')::boolean, false)) then
      raise exception 'Tu usuario no puede cambiar la ruta de entrega.' using errcode = '42501'; end if;
    if not v.comprado then raise exception 'La ruta se define al registrar la compra.' using errcode = '22023'; end if;
    v_txt := public._tc_txt(p, 'ruta');
    if v_txt not in ('central', 'directa', 'mixta') then raise exception 'Ruta de entrega no válida.' using errcode = '22023'; end if;
    if v_txt = 'central' and v.q_directa > 0 then raise exception 'Ya hay entregas directas en obra: usá «mixta».' using errcode = '22023'; end if;
    if v_txt = 'directa' and (v.q_central > 0 or v.q_prepara > 0) then raise exception 'Ya hay recepciones en central: usá «mixta».' using errcode = '22023'; end if;
    update tc_pedido set ruta = v_txt where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Ruta de entrega cambiada', ped.ruta || ' → ' || v_txt || coalesce(' · ' || v_mot, ''));

  -- ── movimientos (entregas parciales) ─────────────────────────
  when 'mov_registrar' then
    v_tipo := public._tc_txt(p, 'tipo');
    v_q := public._tc_num(p, 'cantidad');
    v_fecha := coalesce(public._tc_txt(p, 'fecha')::date, current_date);
    if v_q is null or v_q <= 0 then raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = '22023'; end if;
    if v_fecha > current_date + 1 then raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
    if v_tipo in ('central', 'prepara', 'envio') then perform public._tc_exigir(yo, 'bodega');
    elsif v_tipo in ('recepcion', 'directa', 'servicio') then
      if not public._tc_sol(yo, ped.obra_clave) then raise exception 'Solo la gente de % confirma lo recibido en obra.', ped.obra_nombre using errcode = '42501'; end if;
    else raise exception 'Movimiento no válido.' using errcode = '22023'; end if;
    if ped.estado = 'stock' then
      if v_tipo not in ('prepara', 'envio', 'recepcion') then raise exception 'Un pedido desde stock solo se prepara, envía y recibe.' using errcode = '22023'; end if;
    elsif ped.estado = 'compra' and v.comprado then
      if ped.tipo = 'servicio' and v_tipo <> 'servicio' then raise exception 'Un servicio se cierra con la conformidad.' using errcode = '22023'; end if;
      if ped.tipo = 'producto' and v_tipo = 'servicio' then raise exception 'La conformidad es solo para servicios.' using errcode = '22023'; end if;
      if v_tipo = 'central' and ped.ruta = 'directa' then raise exception 'La compra va directo a obra: cambiá la ruta a «mixta» para recibir en central.' using errcode = '22023'; end if;
      if v_tipo = 'directa' and ped.ruta = 'central' then raise exception 'La compra va por central: cambiá la ruta a «mixta» para registrar entrega directa.' using errcode = '22023'; end if;
    else raise exception 'Todavía no hay nada para entregar (falta la decisión de bodega o la compra).' using errcode = '22023';
    end if;
    insert into tc_movimiento (pedido_id, tipo, cantidad, fecha, referencia, responsable, nota, registrado_por, registrado_nombre)
    values (ped.id, v_tipo, v_q, v_fecha, public._tc_txt(p, 'referencia'),
            coalesce(public._tc_txt(p, 'responsable'), case when v_tipo in ('recepcion', 'directa', 'servicio') then yo ->> 'nombre' end),
            public._tc_txt(p, 'nota'), v_uid, yo ->> 'nombre')
    returning * into mov;
    perform public._tc_validar_saldos(ped.id);
    perform public._tc_evento(ped.id, yo, case v_tipo when 'central' then 'Recibido en taller central' when 'prepara' then 'Preparado en bodega'
        when 'envio' then 'Enviado a obra' when 'recepcion' then 'Recibido en obra' when 'directa' then 'Recibido en obra directo del proveedor'
        else 'Conformidad del servicio' end,
      concat_ws(' · ', public._tc_fmt(v_q) || ' ' || ped.unidad, mov.referencia, mov.responsable));

  when 'mov_anular' then
    select * into mov from tc_movimiento where id = public._tc_txt(p, 'movimiento_id')::uuid and pedido_id = ped.id for update;
    if not found or mov.anulado_en is not null then raise exception 'El movimiento no existe o ya está anulado.' using errcode = '22023'; end if;
    if mov.tipo in ('central', 'prepara', 'envio') then perform public._tc_exigir(yo, 'bodega');
    elsif not public._tc_sol(yo, ped.obra_clave) then raise exception 'Tu usuario no puede anular recepciones de esta obra.' using errcode = '42501'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_movimiento set anulado_en = now(), anulado_por = v_uid, anulado_nombre = yo ->> 'nombre', anulado_motivo = v_mot where id = mov.id;
    perform public._tc_validar_saldos(ped.id);   -- p. ej. no se anula lo preparado si ya se envió
    perform public._tc_evento(ped.id, yo, 'Movimiento anulado', mov.tipo || ' ' || public._tc_fmt(mov.cantidad) || ' ' || ped.unidad || ' · ' || v_mot);

  else
    raise exception 'Acción desconocida: %', p_accion using errcode = '22023';
  end case;

  update tc_pedido set version = version + 1, actualizado_en = now() where id = ped.id returning version into v_n;
  res := jsonb_build_object('ok', true, 'id', ped.id, 'version', v_n::int);
  insert into tc_operacion (op, user_id, accion, pedido_id, resultado) values (p_op, v_uid, p_accion, ped.id, res);
  return res;
end $$;

-- ─────────────────────────── 6. Fotos y documentos ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('taller_compras', 'taller_compras', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public._tc_pedido_de_ruta(p_carpeta text)
returns uuid language sql immutable as $$
  select case when p_carpeta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_carpeta::uuid end
$$;

-- ¿puede ver / subir archivos de ese pedido?
create or replace function public.tc_archivo_puede(p_carpeta text, p_subir boolean)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb; v_obra text; v_estado text;
begin
  select obra_clave, estado into v_obra, v_estado from tc_pedido where id = public._tc_pedido_de_ruta(p_carpeta);
  if not found then return false; end if;
  yo := public.tc_yo();
  if not coalesce(public._tc_ve(yo, v_obra), false) then return false; end if;
  if not p_subir then return true; end if;
  return public._tc_sol(yo, v_obra) or coalesce((yo ->> 'bodega')::boolean, false) or coalesce((yo ->> 'compras')::boolean, false);
end $$;

drop policy if exists tc_archivos_ver on storage.objects;
create policy tc_archivos_ver on storage.objects for select to authenticated
  using (bucket_id = 'taller_compras' and public.tc_archivo_puede((storage.foldername(name))[1], false));
drop policy if exists tc_archivos_subir on storage.objects;
create policy tc_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'taller_compras' and public.tc_archivo_puede((storage.foldername(name))[1], true));
-- sin update ni delete: lo subido queda (se «quita» de la ficha, no se borra)

create or replace function public.tc_adjunto_registrar(p_pedido uuid, p_op uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); prev jsonb; ped tc_pedido%rowtype; obj record; v_tipo text; res jsonb; v_id uuid;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select resultado into prev from tc_operacion where op = p_op and user_id = (yo ->> 'uid')::uuid;
  if found then return prev || '{"repetida": true}'; end if;
  select * into ped from tc_pedido where id = p_pedido;
  if not found then raise exception 'El pedido no existe.' using errcode = 'P0002'; end if;
  v_tipo := coalesce(public._tc_txt(p, 'tipo'), 'foto');
  if v_tipo not in ('foto', 'cotizacion', 'compra', 'entrega', 'otro') then raise exception 'Tipo de archivo no válido.' using errcode = '22023'; end if;
  if v_tipo in ('cotizacion', 'compra') then perform public._tc_exigir(yo, 'compras');
  elsif not public.tc_archivo_puede(p_pedido::text, true) then raise exception 'No podés adjuntar archivos a este pedido.' using errcode = '42501'; end if;
  if split_part(public._tc_txt(p, 'ruta'), '/', 1) <> p_pedido::text then raise exception 'La ruta del archivo no corresponde al pedido.' using errcode = '22023'; end if;
  select name, metadata into obj from storage.objects where bucket_id = 'taller_compras' and name = public._tc_txt(p, 'ruta');
  if not found then raise exception 'El archivo no llegó al servidor; volvé a intentar.' using errcode = '22023'; end if;
  insert into tc_adjunto (pedido_id, tipo, ref_id, ruta, nombre, mime, tamano, sha256, ancho, alto, subido_por, subido_nombre)
  values (ped.id, v_tipo, public._tc_txt(p, 'ref_id')::uuid, obj.name, left(coalesce(public._tc_txt(p, 'nombre'), 'archivo'), 160),
          obj.metadata ->> 'mimetype', (obj.metadata ->> 'size')::bigint, public._tc_txt(p, 'sha256'),
          public._tc_num(p, 'ancho')::int, public._tc_num(p, 'alto')::int, (yo ->> 'uid')::uuid, yo ->> 'nombre')
  returning id into v_id;
  perform public._tc_evento(ped.id, yo, case v_tipo when 'foto' then 'Foto agregada' else 'Archivo adjuntado' end, public._tc_txt(p, 'nombre'));
  res := jsonb_build_object('ok', true, 'id', v_id);
  insert into tc_operacion (op, user_id, accion, pedido_id, resultado) values (p_op, (yo ->> 'uid')::uuid, 'adjunto', ped.id, res);
  return res;
end $$;

create or replace function public.tc_adjunto_quitar(p_adjunto uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); a tc_adjunto%rowtype;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into a from tc_adjunto where id = p_adjunto and quitado_en is null for update;
  if not found then raise exception 'El archivo ya no está.' using errcode = '22023'; end if;
  if a.subido_por <> (yo ->> 'uid')::uuid and not coalesce((yo ->> 'super')::boolean, false) then
    raise exception 'Solo quien lo subió lo puede quitar.' using errcode = '42501'; end if;
  update tc_adjunto set quitado_en = now(), quitado_por = (yo ->> 'uid')::uuid where id = a.id;
  perform public._tc_evento(a.pedido_id, yo, 'Archivo quitado', concat_ws(' · ', a.nombre, nullif(trim(coalesce(p_motivo, '')), '')));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────── 7. Proveedores ───────────────────────────
create or replace function public.tc_proveedor_guardar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); v_id uuid := public._tc_txt(p, 'id')::uuid;
begin
  perform public._tc_exigir(yo, 'compras');
  if public._tc_txt(p, 'nombre') is null then raise exception 'Indicá el nombre del proveedor.' using errcode = '22023'; end if;
  if v_id is null then
    insert into tc_proveedor (nombre, ruc, categoria, contacto, telefono, email, condiciones, creado_por)
    values (public._tc_txt(p, 'nombre'), public._tc_txt(p, 'ruc'), public._tc_txt(p, 'categoria'), public._tc_txt(p, 'contacto'),
            public._tc_txt(p, 'telefono'), public._tc_txt(p, 'email'), public._tc_txt(p, 'condiciones'), (yo ->> 'uid')::uuid)
    returning id into v_id;
  else
    update tc_proveedor set nombre = public._tc_txt(p, 'nombre'), ruc = public._tc_txt(p, 'ruc'), categoria = public._tc_txt(p, 'categoria'),
      contacto = public._tc_txt(p, 'contacto'), telefono = public._tc_txt(p, 'telefono'), email = public._tc_txt(p, 'email'),
      condiciones = public._tc_txt(p, 'condiciones'), activo = coalesce((p ->> 'activo')::boolean, activo), actualizado_en = now()
     where id = v_id;
    if not found then raise exception 'El proveedor no existe.' using errcode = '22023'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  raise exception 'Ya hay un proveedor con ese nombre.' using errcode = '23505';
end $$;

-- ─────────────────────────── 8. Lecturas ───────────────────────────
create or replace function public._tc_fila(v public.v_tc_pedido)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', v.id, 'codigo', v.codigo, 'numero', v.numero, 'obra_clave', v.obra_clave, 'obra_nombre', v.obra_nombre,
    'equipo_id', v.equipo_id, 'equipo_texto', v.equipo_texto, 'ot_numero', v.ot_numero, 'tipo', v.tipo,
    'descripcion', v.descripcion, 'codigo_repuesto', v.codigo_repuesto, 'marca_modelo', v.marca_modelo,
    'cantidad', v.cantidad, 'unidad', v.unidad, 'prioridad', v.prioridad, 'fecha_requerida', v.fecha_requerida,
    'notas', v.notas, 'solicitante_id', v.solicitante_id, 'solicitante_nombre', v.solicitante_nombre, 'creado_en', v.creado_en,
    'estado', v.estado, 'fase', v.fase, 'ruta', v.ruta, 'version', v.version, 'actualizado_en', v.actualizado_en,
    'bodega_nombre', v.bodega_nombre, 'bodega_en', v.bodega_en, 'bodega_stock', v.bodega_stock, 'bodega_nota', v.bodega_nota,
    'q', jsonb_build_object('c', v.q_central, 'd', v.q_directa, 'p', v.q_prepara, 'e', v.q_envio, 'r', v.q_recepcion, 's', v.q_servicio),
    'ult_recepcion', v.ult_recepcion,
    'aut_id', v.aut_id, 'aut_estado', v.aut_estado, 'aut_total', v.aut_total, 'aut_moneda', v.aut_moneda, 'aut_proveedor', v.aut_proveedor,
    'comprado', v.comprado, 'doc_tipo', v.doc_tipo, 'doc_numero', v.doc_numero, 'fecha_compra', v.fecha_compra,
    'uso_caja_chica', v.uso_caja_chica, 'compra_total', v.compra_total, 'compra_moneda', v.compra_moneda, 'compra_proveedor', v.compra_proveedor,
    'n_cotizaciones', v.n_cotizaciones, 'n_fotos', v.n_fotos, 'legacy_canal', v.legacy_canal)
$$;

-- Bandeja paginada (no trae el histórico entero). p: bandeja, fase, obra, q, desde, hasta, limite, desplazar
create or replace function public.tc_listar(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  yo jsonb := public.tc_yo();
  v_todas boolean; v_obras text[];
  v_q text := lower(coalesce(public._tc_txt(p, 'q'), ''));
  v_fase text := public._tc_txt(p, 'fase');
  v_band text := coalesce(public._tc_txt(p, 'bandeja'), 'pedidos');
  v_lim int := least(coalesce(public._tc_num(p, 'limite')::int, 200), 1000);
  v_off int := greatest(coalesce(public._tc_num(p, 'desplazar')::int, 0), 0);
  fases text[];
  res jsonb;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> 'ver')::boolean, false) then raise exception 'Tu usuario no tiene acceso a Compras de taller.' using errcode = '42501'; end if;
  v_todas := coalesce((yo ->> 'ver_todas')::boolean, false);
  v_obras := array(select jsonb_array_elements_text(coalesce(yo -> 'ver_obras', '[]')));
  fases := case v_band
    when 'bodega' then array['bodega']
    when 'compras' then array['cotizacion', 'autorizacion', 'compra']
    when 'entregas' then array['entrega']
    else array['bodega', 'cotizacion', 'autorizacion', 'compra', 'entrega', 'cerrado', 'rechazado', 'anulado'] end;

  with base as (
    select v as fila, v.fase, v.prioridad, v.fecha_requerida, v.numero, v.obra_clave, v.obra_nombre from v_tc_pedido v
     where (v_todas or v.obra_clave = any (v_obras))
       and v.fase = any (fases)
       and (public._tc_txt(p, 'obra') is null or v.obra_clave = public._tc_txt(p, 'obra'))
       and (public._tc_txt(p, 'desde') is null or v.creado_en >= public._tc_txt(p, 'desde')::date)
       and (public._tc_txt(p, 'hasta') is null or v.creado_en < public._tc_txt(p, 'hasta')::date + 1)
       and (coalesce((p ->> 'mios')::boolean, false) = false or v.solicitante_id = (yo ->> 'uid')::uuid)
       and (v_q = '' or lower(concat_ws(' ', v.codigo, v.descripcion, v.codigo_repuesto, v.marca_modelo, v.equipo_id, v.equipo_texto,
                                         v.obra_nombre, v.solicitante_nombre, v.doc_numero, v.aut_proveedor, v.compra_proveedor, v.ot_numero::text)) like '%' || v_q || '%')
  ), filt as (
    select * from base where v_fase is null or fase = v_fase
       or (v_fase = 'activos' and fase not in ('cerrado', 'rechazado', 'anulado'))
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'conteos', coalesce((select jsonb_object_agg(fase, n) from (select fase, count(*) n from base group by fase) c), '{}'),
    'obras', coalesce((select jsonb_agg(distinct jsonb_build_object('clave', obra_clave, 'nombre', obra_nombre)) from base), '[]'),
    'filas', coalesce((select jsonb_agg(public._tc_fila(f.fila) order by
        case f.prioridad when 'urgente' then 0 when 'alta' then 1 else 2 end, f.fecha_requerida nulls last, f.numero desc)
      from (select * from filt order by case prioridad when 'urgente' then 0 when 'alta' then 1 else 2 end,
                                         fecha_requerida nulls last, numero desc limit v_lim offset v_off) f), '[]'))
  into res;
  return res;
end $$;

create or replace function public.tc_detalle(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); v v_tc_pedido%rowtype;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into v from v_tc_pedido where id = p_pedido;
  if not found then raise exception 'El pedido no existe.' using errcode = 'P0002'; end if;
  if not public._tc_ve(yo, v.obra_clave) then raise exception 'No tenés acceso a este pedido.' using errcode = '42501'; end if;
  return public._tc_fila(v) || jsonb_build_object(
    'equipo_desc', (select descripcion from equipos where id = v.equipo_id),
    'cotizaciones', coalesce((select jsonb_agg(to_jsonb(c) order by c.creado_en) from tc_cotizacion c where c.pedido_id = v.id), '[]'),
    'autorizaciones', coalesce((select jsonb_agg(to_jsonb(a) order by a.solicitado_en) from tc_autorizacion a where a.pedido_id = v.id), '[]'),
    'compra', (select to_jsonb(c) from tc_compra c where c.pedido_id = v.id),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha, m.registrado_en) from tc_movimiento m where m.pedido_id = v.id), '[]'),
    'adjuntos', coalesce((select jsonb_agg(to_jsonb(a) order by a.subido_en) from tc_adjunto a where a.pedido_id = v.id and a.quitado_en is null), '[]'),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) order by e.en, e.id) from tc_evento e where e.pedido_id = v.id), '[]'),
    'legacy_fuente', v.legacy_fuente);
end $$;

-- Catálogos para el formulario y quién soy
create or replace function public.tc_inicio()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo();
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> 'ver')::boolean, false) then return jsonb_build_object('yo', yo); end if;
  return jsonb_build_object('yo', yo,
    'obras', coalesce((select jsonb_agg(jsonb_build_object('clave', o.clave, 'codigo', o.codigo, 'nombre', o.nombre,
                         'pide', public._tc_sol(yo, o.clave)) order by o.nombre)
                       from obras o where o.activa and public._tc_ve(yo, o.clave)), '[]'),
    'equipos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'd', e.descripcion) order by e.id)
                         from equipos e where e.activo), '[]'),
    'proveedores', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from tc_proveedor x), '[]'));
end $$;

-- KPIs: tiempos por tramo (días corridos) y cómo se resuelven los pedidos
create or replace function public.tc_kpis(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); v_todas boolean; v_obras text[]; res jsonb;
  v_desde date := coalesce(public._tc_txt(p, 'desde')::date, current_date - 90);
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> 'ver')::boolean, false) then raise exception 'Sin acceso.' using errcode = '42501'; end if;
  v_todas := coalesce((yo ->> 'ver_todas')::boolean, false);
  v_obras := array(select jsonb_array_elements_text(coalesce(yo -> 'ver_obras', '[]')));
  with b as (
    select v.*,
      (select min(a.solicitado_en) from tc_autorizacion a where a.pedido_id = v.id) aut_pedida,
      (select min(a.resuelto_en) from tc_autorizacion a where a.pedido_id = v.id and a.estado in ('autorizada')) aut_ok,
      c.registrado_en compra_en
      from v_tc_pedido v left join tc_compra c on c.pedido_id = v.id
     where (v_todas or v.obra_clave = any (v_obras)) and v.creado_en >= v_desde
       and (public._tc_txt(p, 'obra') is null or v.obra_clave = public._tc_txt(p, 'obra'))
  )
  select jsonb_build_object(
    'desde', v_desde,
    'n', (select count(*) from b),
    'fases', coalesce((select jsonb_object_agg(fase, n) from (select fase, count(*) n from b group by fase) x), '{}'),
    'desde_stock', (select count(*) from b where estado = 'stock'),
    'por_compra', (select count(*) from b where estado = 'compra'),
    'caja_chica', (select count(*) from b where uso_caja_chica),
    'comprados', (select count(*) from b where comprado),
    'dias_bodega', (select round(avg(extract(epoch from bodega_en - creado_en) / 86400)::numeric, 1) from b where bodega_en is not null),
    'dias_cotizar', (select round(avg(extract(epoch from aut_pedida - bodega_en) / 86400)::numeric, 1) from b where aut_pedida is not null and bodega_en is not null),
    'dias_autorizar', (select round(avg(extract(epoch from aut_ok - aut_pedida) / 86400)::numeric, 1) from b where aut_ok is not null),
    'dias_comprar', (select round(avg(extract(epoch from compra_en - aut_ok) / 86400)::numeric, 1) from b where compra_en is not null and aut_ok is not null),
    'dias_total', (select round(avg(ult_recepcion - creado_en::date)::numeric, 1) from b where fase = 'cerrado'),
    'a_tiempo', (select count(*) from b where fase = 'cerrado' and fecha_requerida is not null and ult_recepcion <= fecha_requerida),
    'con_fecha', (select count(*) from b where fase = 'cerrado' and fecha_requerida is not null),
    'atrasados_abiertos', (select count(*) from b where fase not in ('cerrado', 'rechazado', 'anulado') and fecha_requerida < current_date),
    'por_obra', coalesce((select jsonb_agg(x order by x.n desc) from (
        select obra_nombre, count(*) n, count(*) filter (where fase = 'cerrado') cerrados,
               count(*) filter (where fase not in ('cerrado', 'rechazado', 'anulado')) abiertos,
               count(*) filter (where fase not in ('cerrado', 'rechazado', 'anulado') and fecha_requerida < current_date) atrasados
          from b group by obra_nombre) x), '[]'))
  into res;
  return res;
end $$;

-- ─────────────────────────── 9. Permisos (solo super) ───────────────────────────
create or replace function public.tc_permisos_listar()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo();
begin
  perform public._tc_exigir(yo, 'super');
  return coalesce((
    select jsonb_agg(x order by x.nombre) from (
      select au.id user_id, lower(au.email) email,
             coalesce(nullif(u.nombre, ''), nullif(pf.nombre, ''), au.email) nombre,
             u.rol rol_obras, pf.rol::text rol_equipos, pf.obras obras_equipos,
             coalesce((select jsonb_object_agg(t.capacidad, t.obras) from tc_permiso t where t.user_id = au.id), '{}') permisos
        from auth.users au
        left join usuario u on u.email = lower(au.email) and u.activo
        left join perfiles pf on pf.id = au.id and coalesce(pf.activo, true)
       where (u.email is not null and u.rol not in ('transporte', 'produccion'))
          or (pf.id is not null and pf.rol::text <> 'operador')
          or exists (select 1 from tc_permiso t where t.user_id = au.id)) x), '[]');
end $$;

create or replace function public.tc_permiso_guardar(p_user uuid, p_capacidades text[], p_obras text[] default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo();
begin
  perform public._tc_exigir(yo, 'super');
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'El usuario no existe.' using errcode = '22023'; end if;
  delete from tc_permiso where user_id = p_user and capacidad <> all (coalesce(p_capacidades, '{}'));
  insert into tc_permiso (user_id, capacidad, obras, otorgado_por)
  select p_user, c, case when c = 'solicitar' then coalesce(p_obras, '{}') else '{}' end, (yo ->> 'uid')::uuid
    from unnest(coalesce(p_capacidades, '{}')) c
  on conflict (user_id, capacidad) do update set obras = excluded.obras, otorgado_por = excluded.otorgado_por, otorgado_en = now();
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────── 10. Seguridad de las tablas ───────────────────────────
alter table public.tc_proveedor enable row level security;
alter table public.tc_permiso enable row level security;
alter table public.tc_pedido enable row level security;
alter table public.tc_cotizacion enable row level security;
alter table public.tc_autorizacion enable row level security;
alter table public.tc_compra enable row level security;
alter table public.tc_movimiento enable row level security;
alter table public.tc_evento enable row level security;
alter table public.tc_adjunto enable row level security;
alter table public.tc_operacion enable row level security;

drop policy if exists leer on public.tc_pedido;
create policy leer on public.tc_pedido for select to authenticated using (public.tc_ve_obra(obra_clave));
do $$
declare t text;
begin
  foreach t in array array['tc_cotizacion', 'tc_autorizacion', 'tc_compra', 'tc_movimiento', 'tc_evento', 'tc_adjunto'] loop
    execute format('drop policy if exists leer on public.%I', t);
    execute format('create policy leer on public.%I for select to authenticated using (exists (select 1 from public.tc_pedido p where p.id = pedido_id and public.tc_ve_obra(p.obra_clave)))', t);
  end loop;
end $$;
drop policy if exists leer on public.tc_proveedor;
create policy leer on public.tc_proveedor for select to authenticated using (coalesce((public.tc_yo() ->> 'ver')::boolean, false));
drop policy if exists leer on public.tc_permiso;
create policy leer on public.tc_permiso for select to authenticated using (user_id = auth.uid());
-- tc_operacion: sin políticas (solo las funciones)

revoke all on public.tc_proveedor, public.tc_permiso, public.tc_pedido, public.tc_cotizacion, public.tc_autorizacion,
  public.tc_compra, public.tc_movimiento, public.tc_evento, public.tc_adjunto, public.tc_operacion, public.v_tc_pedido from anon;
revoke insert, update, delete, truncate on public.tc_proveedor, public.tc_permiso, public.tc_pedido, public.tc_cotizacion,
  public.tc_autorizacion, public.tc_compra, public.tc_movimiento, public.tc_evento, public.tc_adjunto, public.tc_operacion from authenticated;
revoke all on public.tc_operacion from authenticated;
grant select on public.tc_proveedor, public.tc_permiso, public.tc_pedido, public.tc_cotizacion, public.tc_autorizacion,
  public.tc_compra, public.tc_movimiento, public.tc_evento, public.tc_adjunto, public.v_tc_pedido to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.tc_yo()', 'public.tc_ve_obra(text)', 'public.tc_pedido_crear(uuid, jsonb)', 'public.tc_accion(uuid, text, integer, uuid, jsonb)',
    'public.tc_archivo_puede(text, boolean)', 'public.tc_adjunto_registrar(uuid, uuid, jsonb)', 'public.tc_adjunto_quitar(uuid, text)',
    'public.tc_proveedor_guardar(jsonb)', 'public.tc_listar(jsonb)', 'public.tc_detalle(uuid)', 'public.tc_inicio()',
    'public.tc_kpis(jsonb)', 'public.tc_permisos_listar()', 'public.tc_permiso_guardar(uuid, text[], text[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public._tc_validar_saldos(uuid)', 'public._tc_evento(uuid, jsonb, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Comprobación
select 'SQL 79 ok' as resultado,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'tc\_%') as tablas,
  (select public from storage.buckets where id = 'taller_compras') as bucket_publico;

-- =========================================================================
-- Prueba de SQL 79 (Compras de taller). Se corre DESPUÉS del 79 en la misma
-- transacción y termina con un error a propósito: así NO queda nada guardado
-- y el mensaje trae el resultado («PRUEBA OK …» o el paso que falló).
--
--   begin;  \i 79_compras_taller.sql  \i pruebas/79_compras_taller_prueba.sql
--
-- Usa usuarios reales solo como identidad (los permisos de prueba se dan y se
-- deshacen con la transacción). Ajustar los correos si cambian.
-- =========================================================================
do $$
declare
  u_sol uuid; u_bod uuid; u_com uuid; u_aut uuid; u_otro uuid;
  e_sol text := 'alicia.villalba@tecsul.com.py';    -- admin de obra (Equipos) de Arborea Hills
  e_bod text := 'fatima.cantero@tecsul.com.py';     -- se le da «bodega»
  e_com text := 'guido.franco@tecsul.com.py';       -- se le da «compras»
  e_aut text := 'petercacerez@tecsul.com.py';       -- admin central (super)
  e_otro text := 'edgar.bobadilla@tecsul.com.py';   -- admin de obra de otra obra, sin permisos extra
  obra text := '1080100000_ARBOREA HILLS';
  eq text := (select id from equipos where activo order by id limit 1);
  r jsonb; pid uuid; pid2 uuid; ver int; q1 uuid; q2 uuid; aid uuid; mid uuid; log text := '';
  ok boolean;

  -- (sin funciones anidadas en plpgsql: se repite el patrón)
begin
  select id into u_sol from auth.users where lower(email) = e_sol;
  select id into u_bod from auth.users where lower(email) = e_bod;
  select id into u_com from auth.users where lower(email) = e_com;
  select id into u_aut from auth.users where lower(email) = e_aut;
  select id into u_otro from auth.users where lower(email) = e_otro;
  insert into tc_permiso (user_id, capacidad) values (u_bod, 'bodega'), (u_com, 'compras');

  -- 1. solicitud
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol, 'role', 'authenticated')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', obra, 'equipo_id', eq, 'descripcion', 'Kit de filtros prueba',
        'cantidad', '10', 'unidad', 'kit', 'prioridad', 'alta', 'fecha_requerida', current_date + 5));
  pid := (r ->> 'id')::uuid; ver := (r ->> 'version')::int;
  log := log || '1 crear ' || (r ->> 'codigo') || E'\n';

  begin
    perform tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', '1012400000_ACCESO A GENERAL BRUGUEZ', 'descripcion', 'xx otra', 'cantidad', 1, 'unidad', 'un'));
    raise exception 'FALLA 2: pidió para una obra ajena';
  exception when insufficient_privilege then log := log || '2 obra ajena rechazada' || E'\n'; end;

  -- 3. compras no hace de bodega
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  begin
    perform tc_accion(pid, 'bodega_compra', ver, gen_random_uuid(), '{}');
    raise exception 'FALLA 3';
  exception when insufficient_privilege then log := log || '3 sin permiso de bodega' || E'\n'; end;

  -- 4-6. bodega
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  begin
    perform tc_accion(pid, 'bodega_stock', ver, gen_random_uuid(), '{"stock": 4}');
    raise exception 'FALLA 4';
  exception when sqlstate '22023' then log := log || '4 stock insuficiente rechazado' || E'\n'; end;
  begin
    perform tc_accion(pid, 'bodega_compra', ver - 1, gen_random_uuid(), '{}');
    raise exception 'FALLA 5';
  exception when sqlstate '40001' then log := log || '5 versión vieja → conflicto' || E'\n'; end;
  declare op uuid := gen_random_uuid();
  begin
    r := tc_accion(pid, 'bodega_compra', ver, op, '{"stock": 0, "motivo": "no hay en central"}');
    ver := (r ->> 'version')::int;
    r := tc_accion(pid, 'bodega_compra', ver - 1, op, '{"stock": 0}');
    if not coalesce((r ->> 'repetida')::boolean, false) or (r ->> 'version')::int <> ver then raise exception 'FALLA 6: %', r; end if;
    log := log || '6 derivado a compras; reintento idempotente' || E'\n';
  end;

  -- 7-8. cotizaciones y autorización
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre": "Prov A", "precio_unit": "100000", "flete": 50000}'); ver := (r ->> 'version')::int;
  select id into q1 from tc_cotizacion where pedido_id = pid and proveedor_nombre = 'Prov A';
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre": "Prov B", "precio_unit": "95000", "flete": 0}'); ver := (r ->> 'version')::int;
  select id into q2 from tc_cotizacion where pedido_id = pid and proveedor_nombre = 'Prov B';
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', q2, 'motivo', 'menor total')); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'autorizacion' then raise exception 'FALLA 7 fase'; end if;
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar'));
    raise exception 'FALLA 7b';
  exception when insufficient_privilege then log := log || '7 compras no autoriza' || E'\n'; end;
  insert into tc_permiso (user_id, capacidad) values (u_com, 'autorizar');
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar'));
    raise exception 'FALLA 7c';
  exception when insufficient_privilege then log := log || '7 quien pide no autoriza su pedido' || E'\n'; end;
  delete from tc_permiso where user_id = u_com and capacidad = 'autorizar';
  -- cambiar la oferta elegida deja sin efecto el pedido de autorización
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), jsonb_build_object('id', q2, 'proveedor_nombre', 'Prov B', 'precio_unit', '96000')); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'cotizacion' then raise exception 'FALLA 8: no invalidó'; end if;
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', q2, 'motivo', 'menor total')); ver := (r ->> 'version')::int;
  log := log || '8 cambiar la cotización invalida la autorización' || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', u_aut, 'email', e_aut)::text, true);
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'devolver'));
    raise exception 'FALLA 9';
  exception when sqlstate '22023' then log := log || '9 devolver sin motivo rechazado' || E'\n'; end;
  r := tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar')); ver := (r ->> 'version')::int;

  -- 10. compra
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  begin
    perform tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo": "oc", "doc_numero": "OC-1", "fecha_compra": "2026-11-02", "ruta": "mixta"}');
    raise exception 'FALLA 10';
  exception when sqlstate '22023' then log := log || '10 caja chica sí/no obligatorio' || E'\n'; end;
  r := tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo": "oc", "doc_numero": "OC-1", "fecha_compra": "2026-11-02", "ruta": "mixta", "uso_caja_chica": false}'); ver := (r ->> 'version')::int;
  if (select compra_total from v_tc_pedido where id = pid) <> 960000 then raise exception 'FALLA 10 total %', (select compra_total from v_tc_pedido where id = pid); end if;

  -- 11. entregas parciales (ejemplo del documento: 6 central, 2 directo, 4 preparado y enviado, 3 recibido)
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 6}'); ver := (r ->> 'version')::int;
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 1}');
    raise exception 'FALLA 11a';
  exception when insufficient_privilege then log := log || '11 bodega no confirma recepción en obra' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "directa", "cantidad": 2, "referencia": "remito 55"}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 4}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 4}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 3}'); ver := (r ->> 'version')::int;
  select (q_central = 6 and q_directa = 2 and q_prepara = 4 and q_envio = 4 and q_recepcion = 3 and fase = 'entrega') into ok from v_tc_pedido where id = pid;
  if not ok then raise exception 'FALLA 11 saldos'; end if;
  log := log || '11 saldos del ejemplo: prov 2 · central 2 · tránsito 1 · en obra 5' || E'\n';
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 2}');
    raise exception 'FALLA 12';
  exception when sqlstate '22023' then log := log || '12 no se recibe más de lo enviado' || E'\n'; end;
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "directa", "cantidad": 3}');
    raise exception 'FALLA 13';
  exception when sqlstate '22023' then log := log || '13 proveedor no entrega más de lo pedido' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  select id into mid from tc_movimiento where pedido_id = pid and tipo = 'prepara';
  begin
    perform tc_accion(pid, 'mov_anular', ver, gen_random_uuid(), jsonb_build_object('movimiento_id', mid, 'motivo', 'error'));
    raise exception 'FALLA 14';
  exception when sqlstate '22023' then log := log || '14 no se anula lo preparado ya enviado' || E'\n'; end;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 2}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 4}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 4}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 4}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'entrega' then raise exception 'FALLA 15 cerró antes'; end if;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 1}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'cerrado' then raise exception 'FALLA 15 no cerró'; end if;
  log := log || '15 cerrado recién con todo recibido en obra (R 8 + D 2 = 10)' || E'\n';

  -- 16. rama stock
  r := tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', obra, 'descripcion', 'Espejo retrovisor prueba', 'cantidad', 3, 'unidad', 'un'));
  pid2 := (r ->> 'id')::uuid; ver := 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid2, 'bodega_stock', ver, gen_random_uuid(), '{"stock": 5}'); ver := (r ->> 'version')::int;
  begin
    perform tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 1}');
    raise exception 'FALLA 16a';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 3}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 2}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 2}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid2) <> 'entrega' or exists (select 1 from tc_cotizacion where pedido_id = pid2) or exists (select 1 from tc_compra where pedido_id = pid2) then
    raise exception 'FALLA 16'; end if;
  log := log || '16 desde stock: sin compra ni cotizaciones, recepción parcial' || E'\n';

  -- 17. lecturas y alcance
  r := tc_listar('{"bandeja": "entregas"}');
  if (r ->> 'total')::int < 1 then raise exception 'FALLA 17 listar %', r; end if;
  r := tc_detalle(pid);
  if jsonb_array_length(r -> 'eventos') < 10 or jsonb_array_length(r -> 'movimientos') <> 10 then raise exception 'FALLA 17 detalle'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_otro, 'email', e_otro)::text, true);
  r := tc_listar('{}');
  if exists (select 1 from jsonb_array_elements(r -> 'filas') f where (f ->> 'id')::uuid in (pid, pid2)) then raise exception 'FALLA 17 ve ajena'; end if;
  begin
    perform tc_detalle(pid);
    raise exception 'FALLA 17b';
  exception when insufficient_privilege then log := log || '17 otra obra no ve los pedidos' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_aut, 'email', e_aut)::text, true);
  r := tc_kpis('{}');
  log := log || '18 kpis n=' || (r ->> 'n') || E'\n';
  r := tc_permisos_listar();
  log := log || '19 permisos: ' || jsonb_array_length(r) || ' personas' || E'\n';

  raise exception 'PRUEBA OK (se deshace todo)%', E'\n' || log;
end $$;

rollback;
