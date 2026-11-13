-- ═══════════════════════════════════════════════════════════════════════════
-- 116 · PERMISOS A MEDIDA POR PESTAÑA · v20261113d · obra-shell-v102 · equipos-v120
--       Se puede correr más de una vez. No borra datos.
--
--  En la ficha de cada persona (Administración › Usuarios) se elige, pestaña
--  por pestaña, qué ve y qué puede hacer, encima de su rol:
--    · pestañas: Oculto / Solo ver / Editar solo en sus obras / (como su rol)
--    · acciones: Sí / No (formularios, compras de taller, eliminar, emitir,
--      aprobar certificados)
--    · Recursos humanos: Oculto / Ver / Editar
--  y se pueden guardar como PLANTILLA (rol a medida) para usarla en varias
--  personas: si se cambia la plantilla, cambia para todos.
--
--  Cómo se respeta:
--    · La pestaña se oculta en la app (Obras, Equipos, Compras).
--    · La BASE rechaza cargar / editar / eliminar en lo quitado (un control
--      por tabla). Lo automático (JotForm, disparadores en cadena, tareas
--      programadas) no se ve afectado.
--    · Formularios, compras de taller y RRHH también se pueden DAR de más.
--      El resto de las pestañas solo se pueden bajar respecto del rol (para
--      dar más hay que cambiar el rol).
--
--  Reemplaza: los formularios marcados a mano (perfiles.formularios) y los
--  permisos extra de RRHH (permiso_extra) pasan a ajustes; quedan iguales.
--  Compras de taller: lo dado a mano sigue en tc_permiso (la pantalla
--  Compras › Taller › Permisos sigue andando); lo quitado va en ajustes.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) Catálogo de claves ────────────────────────────────────────────────
--  tipo: 'pestana' (oculto/ver/editar_sus) · 'lectura' (oculto) ·
--        'accion' (si/no) · 'nivel' (oculto/ver/editar) · 'sube' = se puede dar
create table if not exists public.permiso_clave (
  clave    text primary key,
  modulo   text not null,           -- obras / equipos / compras / rrhh
  etiqueta text not null,
  tipo     text not null check (tipo in ('pestana', 'lectura', 'accion', 'nivel')),
  sube     boolean not null default false,
  orden    int not null default 0
);
alter table public.permiso_clave enable row level security;
drop policy if exists permiso_clave_lee on public.permiso_clave;
create policy permiso_clave_lee on public.permiso_clave for select to authenticated using (true);
grant select on public.permiso_clave to authenticated;

insert into public.permiso_clave (clave, modulo, etiqueta, tipo, sube, orden) values
  ('ob.cronograma',      'obras',   'Cronograma y Plan semanal',              'pestana', false, 10),
  ('ob.prod',            'obras',   'Producción',                             'pestana', false, 20),
  ('ob.pista',           'obras',   'Situación de pista',                     'pestana', false, 30),
  ('ob.cert',            'obras',   'Certificación y convenios',              'pestana', false, 40),
  ('ob.cert_aprobar',    'obras',   'Aprobar certificados de obra',           'accion',  false, 41),
  ('ob.computo',         'obras',   'Cómputo',                                'pestana', false, 50),
  ('ob.transporte',      'obras',   'Transporte',                             'pestana', false, 60),
  ('ob.compras',         'obras',   'Compras de obra (pedidos, cotizaciones, OC)', 'pestana', false, 70),
  ('ob.costos',          'obras',   'Costos',                                 'pestana', false, 80),
  ('ob.report',          'obras',   'Avance / Informes',                      'lectura', false, 90),
  ('ob.com',             'obras',   'Comunicaciones',                         'pestana', false, 100),
  ('ob.archivos',        'obras',   'Archivos',                               'lectura', false, 110),
  ('ob.radar',           'obras',   'Licitaciones',                           'pestana', false, 120),
  ('ob.pbi',             'obras',   'Reportes Power BI',                      'lectura', false, 130),
  ('eq.form.parte',      'equipos', 'Formulario: Parte diario',               'accion',  true,  200),
  ('eq.form.taller',     'equipos', 'Formulario: Reporte de taller',          'accion',  true,  201),
  ('eq.form.combustible','equipos', 'Formulario: Carga de combustible',       'accion',  true,  202),
  ('eq.historial',       'equipos', 'Historial de partes (corregir partes)',  'pestana', false, 210),
  ('eq.eliminar',        'equipos', 'Eliminar partes, cargas y reportes',     'accion',  false, 211),
  ('eq.ausencias',       'equipos', 'Ausencias de taller',                    'pestana', false, 220),
  ('eq.flota',           'equipos', 'Flota',                                  'pestana', false, 230),
  ('eq.minutas',         'equipos', 'Minutas',                                'pestana', false, 240),
  ('eq.ot',              'equipos', 'Órdenes de trabajo',                     'pestana', false, 250),
  ('eq.gasoil',          'equipos', 'Control de combustible',                 'pestana', false, 260),
  ('eq.mant',            'equipos', 'Mantenimiento',                          'pestana', false, 270),
  ('eq.ind',             'equipos', 'Indicadores',                            'lectura', false, 280),
  ('eq.seg',             'equipos', 'Seguros',                                'pestana', false, 290),
  ('eq.pers',            'equipos', 'Personal',                               'pestana', false, 300),
  ('eq.cert',            'equipos', 'Certificado de máquinas y alquileres',   'pestana', false, 310),
  ('eq.cert_emitir',     'equipos', 'Emitir certificados de máquinas',        'accion',  false, 311),
  ('eq.plantas',         'equipos', 'Plantas',                                'pestana', false, 320),
  ('eq.alertas',         'equipos', 'Alertas',                                'lectura', false, 330),
  ('eq.bi',              'equipos', 'Reportes',                               'lectura', false, 340),
  ('tc.ver',             'compras', 'Compras de taller: ver todos los pedidos',       'accion', true, 400),
  ('tc.solicitar',       'compras', 'Compras de taller: solicitar y recibir',          'accion', true, 401),
  ('tc.bodega',          'compras', 'Compras de taller: bodega central',               'accion', true, 402),
  ('tc.compras',         'compras', 'Compras de taller: cotizar y comprar',            'accion', true, 403),
  ('tc.autorizar',       'compras', 'Compras de taller: autorizar compras',            'accion', true, 404),
  ('rrhh',               'rrhh',    'Recursos humanos (planilla de salarios)',         'nivel',  true, 500)
on conflict (clave) do update set modulo = excluded.modulo, etiqueta = excluded.etiqueta,
  tipo = excluded.tipo, sube = excluded.sube, orden = excluded.orden;

-- ── 2) Plantillas (roles a medida), persona → plantilla, ajustes ─────────
create table if not exists public.permiso_plantilla (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  descripcion text,
  ob_rol      text,          -- rol base en Obras (null = sin Obras)
  eq_rol      text,          -- rol base en Equipos (null = sin Equipos)
  ajustes     jsonb not null default '{}'::jsonb,
  creado_por  uuid default auth.uid(),
  actualizado timestamptz not null default now()
);
create table if not exists public.permiso_persona (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  plantilla_id bigint references public.permiso_plantilla(id) on delete set null
);
create table if not exists public.permiso_ajuste (
  user_id    uuid not null references auth.users(id) on delete cascade,
  clave      text not null references public.permiso_clave(clave) on delete cascade,
  valor      text not null check (valor in ('rol', 'oculto', 'ver', 'editar_sus', 'editar', 'si', 'no')),
  puesto_por uuid default auth.uid(),
  puesto_en  timestamptz not null default now(),
  primary key (user_id, clave)
);
alter table public.permiso_plantilla enable row level security;
alter table public.permiso_persona  enable row level security;
alter table public.permiso_ajuste   enable row level security;
drop policy if exists lee on public.permiso_plantilla;
drop policy if exists lee on public.permiso_persona;
drop policy if exists lee on public.permiso_ajuste;
create policy lee on public.permiso_plantilla for select to authenticated using (public.adm_puede_equipos());
create policy lee on public.permiso_persona  for select to authenticated using (user_id = auth.uid() or public.adm_puede_equipos());
create policy lee on public.permiso_ajuste   for select to authenticated using (user_id = auth.uid() or public.adm_puede_equipos());
revoke insert, update, delete, truncate on public.permiso_plantilla, public.permiso_persona, public.permiso_ajuste from authenticated, anon;
grant select on public.permiso_plantilla, public.permiso_persona, public.permiso_ajuste to authenticated;

-- Valor que manda para una persona: el suyo; si no tiene, el de su plantilla.
-- 'rol' en la persona = «como su rol» aunque la plantilla diga otra cosa.
create or replace function public.permiso_valor(p_uid uuid, p_clave text)
returns text language sql stable security definer set search_path = public as $$
  select nullif(coalesce(
    (select a.valor from permiso_ajuste a where a.user_id = p_uid and a.clave = p_clave),
    (select pl.ajustes ->> p_clave from permiso_persona pp join permiso_plantilla pl on pl.id = pp.plantilla_id where pp.user_id = p_uid)
  ), 'rol')
$$;
revoke all on function public.permiso_valor(uuid, text) from public, anon;
grant execute on function public.permiso_valor(uuid, text) to authenticated;

-- Lo de quien entra: para ocultar pestañas en la app
create or replace function public.mis_ajustes()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plantilla', (select pl.nombre from permiso_persona pp join permiso_plantilla pl on pl.id = pp.plantilla_id where pp.user_id = auth.uid()),
    'ajustes', coalesce((
      select jsonb_object_agg(c.clave, v) from (
        select c.clave, public.permiso_valor(auth.uid(), c.clave) v from permiso_clave c) c
      where v is not null), '{}'::jsonb))
$$;
revoke all on function public.mis_ajustes() from public, anon;
grant execute on function public.mis_ajustes() to authenticated;

-- ── 3) Control en la base: rechaza cargar / editar en lo quitado ─────────
-- Sus obras: las de Obras (usuario_obra) y los frentes de Equipos (perfiles.obras),
-- comparando el código de obra (lo de antes del «_»).
create or replace function public.permiso_mis_obras(p_uid uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select split_part(uo.obra_id, '_', 1) x from usuario_obra uo
      join auth.users a on lower(a.email) = uo.email where a.id = p_uid
    union all
    select split_part(o, '_', 1) from perfiles p, unnest(coalesce(p.obras, '{}')) o where p.id = p_uid
  ) s
$$;
revoke all on function public.permiso_mis_obras(uuid) from public, anon;

--  Argumentos: 0 = clave al insertar · 1 = clave al editar/eliminar ·
--              2 = columna de obra ('' = no se mira) · 3 = columna autor ('' = no)
--  Si el autor de la fila es quien edita (sus propios partes / cargas), manda
--  la clave de inserción (su formulario).
create or replace function public.permiso_bloqueo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fila jsonb;
  k text; v text; v_ob text; v_etq text;
begin
  -- automático (JotForm, cron, funciones en cadena) o nadie con ajustes: pasa
  if v_uid is null or pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if not exists (select 1 from permiso_ajuste where user_id = v_uid)
     and not exists (select 1 from permiso_persona where user_id = v_uid and plantilla_id is not null) then
    return coalesce(new, old);
  end if;
  v_fila := to_jsonb(coalesce(new, old));
  k := case when tg_op = 'INSERT' then tg_argv[0] else tg_argv[1] end;
  if tg_op <> 'INSERT' and coalesce(tg_argv[3], '') <> '' and (v_fila ->> tg_argv[3]) = v_uid::text then
    k := tg_argv[0];
  end if;
  if tg_op = 'DELETE' and tg_table_name in ('partes', 'combustible_movimientos', 'ot_registros')
     and public.permiso_valor(v_uid, 'eq.eliminar') = 'no' then
    raise exception 'No tenés permiso para eliminar (Administración › Usuarios › Permisos).' using errcode = '42501';
  end if;
  if coalesce(k, '') = '' then return coalesce(new, old); end if;
  v := public.permiso_valor(v_uid, k);
  if v is null or v in ('editar', 'si') then return coalesce(new, old); end if;
  select etiqueta into v_etq from permiso_clave where clave = k;
  if v in ('oculto', 'ver', 'no') then
    raise exception 'No tenés permiso para cargar ni editar en «%» (Administración › Usuarios › Permisos).', coalesce(v_etq, k)
      using errcode = '42501';
  end if;
  if v = 'editar_sus' and coalesce(tg_argv[2], '') <> '' then
    v_ob := split_part(v_fila ->> tg_argv[2], '_', 1);
    if v_ob is not null and v_ob <> '' and not (v_ob = any (public.permiso_mis_obras(v_uid))) then
      raise exception 'En «%» solo podés cargar en tus obras (Administración › Usuarios › Permisos).', coalesce(v_etq, k)
        using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- tabla → (clave al insertar, clave al editar, columna obra, columna autor)
do $$
declare r record;
begin
  for r in select * from (values
    ('item',                    'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('item_dependencia',        'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('distribucion_mensual',    'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('linea_base',              'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('linea_base_detalle',      'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('calendario',              'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('plan_semanal',            'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('plan_semanal_foto',       'ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('plan_semanal_foto_estado','ob.cronograma', 'ob.cronograma', 'obra_id', ''),
    ('produccion_jornada',      'ob.prod',       'ob.prod',       'obra_id', ''),
    ('produccion_fila',         'ob.prod',       'ob.prod',       'obra_id', ''),
    ('pista_eje',               'ob.pista',      'ob.pista',      'obra_id', ''),
    ('pista_estado',            'ob.pista',      'ob.pista',      'obra_id', ''),
    ('pista_snapshot',          'ob.pista',      'ob.pista',      'obra_id', ''),
    ('pista_tramo',             'ob.pista',      'ob.pista',      'obra_id', ''),
    ('certificacion',           'ob.cert',       'ob.cert',       'obra_id', ''),
    ('certificado',             'ob.cert',       'ob.cert',       'obra_id', ''),
    ('convenio',                'ob.cert',       'ob.cert',       'obra_id', ''),
    ('convenio_detalle',        'ob.cert',       'ob.cert',       'obra_id', ''),
    ('computo_item',            'ob.computo',    'ob.computo',    'obra_id', ''),
    ('computo_linea',           'ob.computo',    'ob.computo',    'obra_id', ''),
    ('transporte_carga',        'ob.transporte', 'ob.transporte', 'obra_id', ''),
    ('transporte_viaje',        'ob.transporte', 'ob.transporte', 'obra_id', ''),
    ('transporte_camion',       'ob.transporte', 'ob.transporte', '',        ''),
    ('stock_conteo',            'ob.transporte', 'ob.transporte', 'obra_id', ''),
    ('flete_tarifa',            'ob.transporte', 'ob.transporte', 'obra_id', ''),
    ('compra',                  'ob.compras',    'ob.compras',    'obra_id', ''),
    ('compra_ajuste',           'ob.compras',    'ob.compras',    'obra_id', ''),
    ('costo_version',           'ob.costos',     'ob.costos',     'obra_id', ''),
    ('costo_item',              'ob.costos',     'ob.costos',     '',        ''),
    ('costo_linea',             'ob.costos',     'ob.costos',     '',        ''),
    ('costo_precio',            'ob.costos',     'ob.costos',     '',        ''),
    ('comunicacion',            'ob.com',        'ob.com',        'obra_id', ''),
    ('radar_participations',    'ob.radar',      'ob.radar',      '',        ''),
    ('radar_antecedentes',      'ob.radar',      'ob.radar',      '',        ''),
    ('partes',                  'eq.form.parte', 'eq.historial',  'obra_clave', 'usuario_id'),
    ('taller_ausencias',        'eq.ausencias',  'eq.ausencias',  '',        ''),
    ('equipos',                 'eq.flota',      'eq.flota',      '',        ''),
    ('equipo_estado',           'eq.flota',      'eq.flota',      '',        ''),
    ('asignaciones',            'eq.flota',      'eq.flota',      'obra_clave', ''),
    ('documentos',              'eq.flota',      'eq.flota',      '',        ''),
    ('minuta_items',            'eq.minutas',    'eq.minutas',    'obra_clave', ''),
    ('minuta_tableros',         'eq.minutas',    'eq.minutas',    '',        ''),
    ('minuta_actualizaciones',  'eq.minutas',    'eq.minutas',    '',        ''),
    ('ordenes_trabajo',         'eq.ot',         'eq.ot',         'obra_clave', ''),
    ('ot_registros',            'eq.form.taller','eq.ot',         'obra_clave', 'usuario_id'),
    ('ot_registro_items',       'eq.ot',         'eq.ot',         '',        ''),
    ('combustible_movimientos', 'eq.form.combustible', 'eq.gasoil', 'obra_clave', 'usuario_id'),
    ('mantenimientos',          'eq.mant',       'eq.mant',       '',        ''),
    ('mantenimiento_recursos',  'eq.mant',       'eq.mant',       '',        ''),
    ('seguros',                 'eq.seg',        'eq.seg',        '',        ''),
    ('operadores',              'eq.pers',       'eq.pers',       '',        ''),
    ('cert_maq',                'eq.cert',       'eq.cert',       'obra_clave', ''),
    ('tarifas_equipos',         'eq.cert',       'eq.cert',       '',        ''),
    ('alquiler_contratos',      'eq.cert',       'eq.cert',       'obra_clave', ''),
    ('alquiler_equipos',        'eq.cert',       'eq.cert',       '',        ''),
    ('alquiler_facturas',       'eq.cert',       'eq.cert',       '',        ''),
    ('alquiler_facturacion',    'eq.cert',       'eq.cert',       '',        ''),
    ('clientes',                'eq.cert',       'eq.cert',       '',        ''),
    ('planta_jornadas',         'eq.plantas',    'eq.plantas',    'obra_clave', ''),
    ('planta_lecturas',         'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_pesadas',          'eq.plantas',    'eq.plantas',    'obra_clave', ''),
    ('planta_recargas',         'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_paradas',          'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_precios',          'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_tanques',          'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_equipos',          'eq.plantas',    'eq.plantas',    '',        ''),
    ('planta_formulas',         'eq.plantas',    'eq.plantas',    '',        '')
  ) t(tabla, k_ins, k_upd, col_obra, col_autor)
  loop
    if to_regclass('public.' || r.tabla) is null then
      raise notice 'No existe la tabla %, se salta', r.tabla; continue;
    end if;
    execute format('drop trigger if exists trg_zz_permiso_bloqueo on public.%I', r.tabla);
    execute format('create trigger trg_zz_permiso_bloqueo before insert or update or delete on public.%I
                    for each row execute function public.permiso_bloqueo(%L, %L, %L, %L)',
                   r.tabla, r.k_ins, r.k_upd, r.col_obra, r.col_autor);
  end loop;
end $$;

-- Acciones sueltas: emitir certificado de máquinas · aprobar certificado de obra
create or replace function public.permiso_accion_estado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); k text := tg_argv[0]; v_estado text := tg_argv[1]; v_etq text;
begin
  if v_uid is null or pg_trigger_depth() > 1 then return new; end if;
  if new.estado = v_estado and (tg_op = 'INSERT' or old.estado is distinct from v_estado)
     and public.permiso_valor(v_uid, k) = 'no' then
    select etiqueta into v_etq from permiso_clave where clave = k;
    raise exception 'No tenés permiso para «%» (Administración › Usuarios › Permisos).', coalesce(v_etq, k) using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_zz_permiso_emitir on public.cert_maq;
create trigger trg_zz_permiso_emitir before insert or update of estado on public.cert_maq
  for each row execute function public.permiso_accion_estado('eq.cert_emitir', 'emitido');
drop trigger if exists trg_zz_permiso_aprobar on public.certificado;
create trigger trg_zz_permiso_aprobar before insert or update of estado on public.certificado
  for each row execute function public.permiso_accion_estado('ob.cert_aprobar', 'aprobado');

-- ── 4) Formularios: automático del rol ± ajustes (se pueden dar y quitar) ──
create or replace function public.mis_formularios()
returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare
  f text[]; x text; v text;
begin
  select coalesce(p.formularios, public.formularios_auto(p.rol::text, o.especialidad)) into f
    from perfiles p left join operadores o on o.cedula = p.cedula where p.id = auth.uid();
  if f is null then return null; end if;           -- sin perfil de Equipos
  foreach x in array array['parte', 'taller', 'combustible'] loop
    v := public.permiso_valor(auth.uid(), 'eq.form.' || x);
    if v = 'si' and not (x = any (f)) then f := f || x; end if;
    if v = 'no' then f := array_remove(f, x); end if;
  end loop;
  return f;
end $$;
revoke all on function public.mis_formularios() from public, anon;
grant execute on function public.mis_formularios() to authenticated;

-- ── 5) Recursos humanos: el ajuste manda (oculto / ver / editar) ─────────
create or replace function public.rrhh_acceso()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when public.permiso_valor(auth.uid(), 'rrhh') = 'oculto' then null
    when public.permiso_valor(auth.uid(), 'rrhh') in ('ver', 'editar') then public.permiso_valor(auth.uid(), 'rrhh')
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'rrhh')) then 'editar'
    when exists (select 1 from perfiles p where p.id = auth.uid() and p.activo and p.rol::text = 'admin_central') then 'editar'
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol = 'gerente') then 'ver'
  end
$$;
revoke all on function public.rrhh_acceso() from public;
grant execute on function public.rrhh_acceso() to authenticated;

-- ── 6) Compras de taller: lo del rol + lo dado (tc_permiso) ± ajustes ────
-- La función de siempre queda como tc_yo_rol; tc_yo la llama y aplica ajustes.
-- (Todas las funciones de Compras de taller usan tc_yo, así que lo respetan.)
do $$
begin
  if to_regprocedure('public.tc_yo_rol()') is null then
    alter function public.tc_yo() rename to tc_yo_rol;
  end if;
end $$;
create or replace function public.tc_yo()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  b jsonb := public.tc_yo_rol();
  v_uid uuid := auth.uid();
  c text; v text; cambio boolean := false;
begin
  if b is null or v_uid is null then return b; end if;
  foreach c in array array['solicitar', 'bodega', 'compras', 'autorizar', 'ver'] loop
    v := public.permiso_valor(v_uid, 'tc.' || c);
    if v = 'no' then
      cambio := true;
      if c = 'ver' then b := b || jsonb_build_object('ver_todas', false);
      else b := b || jsonb_build_object(c, false);
        if c = 'solicitar' then b := b || jsonb_build_object('sol_todas', false, 'sol_obras', '[]'::jsonb, 'ver_obras', '[]'::jsonb); end if;
      end if;
    elsif v = 'si' then
      cambio := true;
      if c = 'ver' then b := b || jsonb_build_object('ver_todas', true);
      elsif c = 'solicitar' and not coalesce((b ->> 'solicitar')::boolean, false) then
        b := b || jsonb_build_object('solicitar', true, 'sol_todas', true);
      elsif c <> 'solicitar' then b := b || jsonb_build_object(c, true);
      end if;
    end if;
  end loop;
  if cambio then
    -- «ver todas» sale de lo que puede hacer, salvo que se lo haya quitado a mano
    if coalesce(public.permiso_valor(v_uid, 'tc.ver'), '') <> 'no' then
      b := b || jsonb_build_object('ver_todas',
        coalesce((b ->> 'ver_todas')::boolean, false) or coalesce((b ->> 'sol_todas')::boolean, false)
        or coalesce((b ->> 'bodega')::boolean, false) or coalesce((b ->> 'compras')::boolean, false)
        or coalesce((b ->> 'autorizar')::boolean, false));
    end if;
    b := b || jsonb_build_object('ver',
      coalesce((b ->> 'ver_todas')::boolean, false) or coalesce((b ->> 'solicitar')::boolean, false)
      or coalesce((b ->> 'bodega')::boolean, false) or coalesce((b ->> 'compras')::boolean, false)
      or coalesce((b ->> 'autorizar')::boolean, false));
    -- el «super» (admin) deja de serlo si le quitaron algo de compras de taller
    if exists (select 1 from unnest(array['solicitar', 'bodega', 'compras', 'autorizar', 'ver']) x
               where public.permiso_valor(v_uid, 'tc.' || x) = 'no') then
      b := b || jsonb_build_object('super', false);
    end if;
  end if;
  return b;
end $$;
revoke all on function public.tc_yo() from public, anon;
grant execute on function public.tc_yo() to authenticated;

-- ── 7) Pasar lo que ya estaba a ajustes (una sola vez por persona) ───────
-- formularios marcados a mano → ajustes Sí/No respecto del automático
insert into public.permiso_ajuste (user_id, clave, valor, puesto_por)
select p.id, 'eq.form.' || x,
       case when x = any (p.formularios) then 'si' else 'no' end, null
  from public.perfiles p
  left join public.operadores o on o.cedula = p.cedula
  cross join unnest(array['parte', 'taller', 'combustible']) x
 where p.formularios is not null
   and (x = any (p.formularios)) <> (x = any (public.formularios_auto(p.rol::text, o.especialidad)))
on conflict (user_id, clave) do nothing;
do $$
begin
  alter table public.perfiles disable trigger trg_perfil_campos_bloqueados;
  update public.perfiles set formularios = null where formularios is not null;
  alter table public.perfiles enable trigger trg_perfil_campos_bloqueados;
end $$;
-- RRHH extra → ajuste
insert into public.permiso_ajuste (user_id, clave, valor, puesto_por)
select x.user_id, 'rrhh', case x.permiso when 'rrhh_editar' then 'editar' else 'ver' end, x.otorgado_por
  from public.permiso_extra x
on conflict (user_id, clave) do nothing;
delete from public.permiso_extra;

-- ── 8) Administración ────────────────────────────────────────────────────
-- Las claves de Obras (ob.*) y las plantillas: solo el Administrador de Obras.
create or replace function public.adm_permisos_guardar(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_pl bigint := nullif(p->>'plantilla_id', '')::bigint;
  k text; v text; n int := 0;
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  if v_id is null or not exists (select 1 from auth.users where id = v_id) then
    raise exception 'Primero hay que crear la cuenta de acceso de esta persona.' using errcode = '22023';
  end if;
  -- plantilla
  if p ? 'plantilla_id' then
    if not public.app_es_admin() and v_pl is distinct from (select plantilla_id from permiso_persona where user_id = v_id) then
      raise exception 'Las plantillas las asigna el Administrador de Obras.' using errcode = '42501';
    end if;
    if v_pl is null then delete from permiso_persona where user_id = v_id;
    else insert into permiso_persona (user_id, plantilla_id) values (v_id, v_pl)
         on conflict (user_id) do update set plantilla_id = excluded.plantilla_id;
    end if;
  end if;
  -- ajustes: se reemplazan los de los módulos que puede tocar quien guarda
  if jsonb_typeof(p->'ajustes') = 'object' then
    for k, v in select key, value #>> '{}' from jsonb_each(p->'ajustes') loop
      if not exists (select 1 from permiso_clave where clave = k) then raise exception 'Permiso desconocido: %', k using errcode = '22023'; end if;
      if v not in ('rol', 'oculto', 'ver', 'editar_sus', 'editar', 'si', 'no') then raise exception 'Valor no válido en %: %', k, v using errcode = '22023'; end if;
      if k like 'ob.%' and not public.app_es_admin() then raise exception 'Los permisos de Obras los cambia el Administrador de Obras.' using errcode = '42501'; end if;
    end loop;
    delete from permiso_ajuste a where a.user_id = v_id
       and (public.app_es_admin() or a.clave not like 'ob.%')
       and not (p->'ajustes' ? a.clave);
    insert into permiso_ajuste (user_id, clave, valor)
    select v_id, key, value #>> '{}' from jsonb_each(p->'ajustes')
    on conflict (user_id, clave) do update set valor = excluded.valor, puesto_por = auth.uid(), puesto_en = now();
    get diagnostics n = row_count;
  end if;
  return json_build_object('ok', true, 'ajustes', n);
end $$;

create or replace function public.adm_plantillas()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object('id', pl.id, 'nombre', pl.nombre, 'descripcion', pl.descripcion,
      'ob_rol', pl.ob_rol, 'eq_rol', pl.eq_rol, 'ajustes', pl.ajustes,
      'personas', (select count(*) from permiso_persona pp where pp.plantilla_id = pl.id)) order by pl.nombre)
    from permiso_plantilla pl), '[]'::json);
end $$;

-- Guarda una plantilla. Si cambia el rol base, se lo cambia también a quienes
-- la tienen (solo donde ya tenían acceso a ese módulo).
create or replace function public.adm_plantilla_guardar(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_ob text := nullif(p->>'ob_rol', '');
  v_eq text := nullif(p->>'eq_rol', '');
  k text; v text;
begin
  if not public.app_es_admin() then raise exception 'Las plantillas las maneja el Administrador de Obras.' using errcode = '42501'; end if;
  if coalesce(trim(p->>'nombre'), '') = '' then raise exception 'Falta el nombre de la plantilla.' using errcode = '22023'; end if;
  if v_ob is not null and v_ob not in ('admin', 'residente', 'admin_obra', 'compras', 'gerente', 'lectura', 'rrhh', 'transporte', 'produccion') then
    raise exception 'Rol de Obras no válido: %', v_ob using errcode = '22023'; end if;
  if v_eq is not null and v_eq not in ('operador', 'admin_obra', 'taller', 'gerente', 'compras', 'admin_central') then
    raise exception 'Rol de Equipos no válido: %', v_eq using errcode = '22023'; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p->'ajustes', '{}'::jsonb)) loop
    if not exists (select 1 from permiso_clave where clave = k) then raise exception 'Permiso desconocido: %', k using errcode = '22023'; end if;
    if v not in ('oculto', 'ver', 'editar_sus', 'editar', 'si', 'no') then raise exception 'Valor no válido en %: %', k, v using errcode = '22023'; end if;
  end loop;
  if v_id is null then
    insert into permiso_plantilla (nombre, descripcion, ob_rol, eq_rol, ajustes)
    values (trim(p->>'nombre'), nullif(trim(coalesce(p->>'descripcion', '')), ''), v_ob, v_eq, coalesce(p->'ajustes', '{}'::jsonb))
    returning id into v_id;
  else
    update permiso_plantilla set nombre = trim(p->>'nombre'), descripcion = nullif(trim(coalesce(p->>'descripcion', '')), ''),
      ob_rol = v_ob, eq_rol = v_eq, ajustes = coalesce(p->'ajustes', '{}'::jsonb), actualizado = now()
     where id = v_id;
    if not found then raise exception 'La plantilla ya no existe.' using errcode = '22023'; end if;
    -- rol base a quienes la tienen
    if v_ob is not null then
      update usuario u set rol = v_ob from permiso_persona pp join auth.users a on a.id = pp.user_id
       where pp.plantilla_id = v_id and u.email = lower(a.email) and u.rol is distinct from v_ob;
    end if;
    if v_eq is not null then   -- (quien guarda es admin: el disparador de perfiles lo deja)
      update perfiles pf set rol = v_eq::rol_usuario from permiso_persona pp
       where pp.plantilla_id = v_id and pf.id = pp.user_id and pf.rol::text is distinct from v_eq
         and (v_eq <> 'admin_obra' or cardinality(coalesce(pf.obras, '{}')) > 0);
    end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.adm_plantilla_borrar(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.app_es_admin() then raise exception 'Las plantillas las maneja el Administrador de Obras.' using errcode = '42501'; end if;
  select count(*) into n from permiso_persona where plantilla_id = p_id;
  delete from permiso_plantilla where id = p_id;   -- las personas quedan con su rol y sin plantilla
  return json_build_object('ok', true, 'personas', n);
end $$;

-- adm_personas: + plantilla y ajustes de cada persona (sin «extras», ya son ajustes)
create or replace function public.adm_personas()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  return coalesce((
    with correos as (
      select lower(a.email) as email from auth.users a where a.email is not null
      union
      select u.email from public.usuario u
    )
    select json_agg(json_build_object(
      'email',          c.email,
      'id',             a.id,
      'tiene_acceso',   a.id is not null,
      'ultimo_ingreso', a.last_sign_in_at,
      'nombre',         coalesce(nullif(u.nombre, ''), nullif(p.nombre, ''), a.raw_user_meta_data->>'nombre', ''),
      'ob_rol',         u.rol,
      'ob_activo',      u.activo,
      'ob_obras',       coalesce((select json_agg(uo.obra_id order by uo.obra_id) from public.usuario_obra uo where uo.email = c.email), '[]'::json),
      'eq_rol',         p.rol,
      'eq_activo',      p.activo,
      'eq_cedula',      p.cedula,
      'eq_obras',       coalesce(to_json(p.obras), '[]'::json),
      'eq_especialidad', o.especialidad,
      'eq_forms_auto',  case when p.id is not null then to_json(public.formularios_auto(p.rol::text, o.especialidad)) end,
      'eq_cambiar_clave', p.debe_cambiar_clave,
      'tc',             coalesce((select json_object_agg(t.capacidad, t.obras) from public.tc_permiso t where t.user_id = a.id), '{}'::json),
      'aprobador',      exists (select 1 from public.partes_aprobadores pa where pa.usuario_id = a.id),
      'responsable',    exists (select 1 from public.responsables_maquinas r where r.perfil_id = a.id and r.activo),
      'plantas',        coalesce((select json_agg(json_build_object('planta', pp.planta_id, 'rol', pp.rol, 'cedula', pp.cedula) order by pp.planta_id)
                                    from public.planta_personal pp
                                   where pp.activo and (pp.usuario_id = a.id or (p.cedula is not null and pp.cedula = p.cedula))), '[]'::json),
      'plantilla_id',   (select pp.plantilla_id from public.permiso_persona pp where pp.user_id = a.id),
      'ajustes',        coalesce((select json_object_agg(aj.clave, aj.valor) from public.permiso_ajuste aj where aj.user_id = a.id), '{}'::json)
    ) order by coalesce(nullif(u.nombre, ''), nullif(p.nombre, ''), c.email))
    from correos c
    left join auth.users a on lower(a.email) = c.email
    left join public.usuario u on u.email = c.email
    left join public.perfiles p on p.id = a.id
    left join public.operadores o on o.cedula = p.cedula
  ), '[]'::json);
end $$;

revoke all on function public.adm_permisos_guardar(jsonb) from public, anon;
revoke all on function public.adm_plantillas() from public, anon;
revoke all on function public.adm_plantilla_guardar(jsonb) from public, anon;
revoke all on function public.adm_plantilla_borrar(bigint) from public, anon;
revoke all on function public.adm_personas() from public, anon;
grant execute on function public.adm_permisos_guardar(jsonb) to authenticated;
grant execute on function public.adm_plantillas() to authenticated;
grant execute on function public.adm_plantilla_guardar(jsonb) to authenticated;
grant execute on function public.adm_plantilla_borrar(bigint) to authenticated;
grant execute on function public.adm_personas() to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from public.permiso_clave) as claves_39,
  (select count(*) from pg_trigger where tgname = 'trg_zz_permiso_bloqueo') as tablas_controladas,
  (to_regprocedure('public.tc_yo_rol()') is not null) as tc_yo_rol_t,
  (select count(*) from public.permiso_ajuste) as ajustes_pasados,
  (select count(*) from public.perfiles where formularios is not null) as formularios_viejos_0;
-- Debe dar: 39 · (unas 68) · t · (número) · 0

-- Volver atrás (resumen): drop trigger trg_zz_permiso_bloqueo en cada tabla,
-- trg_zz_permiso_emitir / trg_zz_permiso_aprobar; drop function tc_yo();
-- alter function tc_yo_rol() rename to tc_yo; correr 113 (mis_formularios,
-- rrhh_acceso); los formularios a medida quedaron en permiso_ajuste.
