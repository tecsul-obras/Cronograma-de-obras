-- =========================================================================
-- 106_partes_bloqueo_certificado.sql · v20261111d (equipos-v102)
-- Tecsul S.A.E.
--
-- Partes diarios de maquinaria BLOQUEADOS cuando ya hay un certificado de
-- máquinas EMITIDO de ese período. Nadie los edita ni los borra (tampoco el
-- administrador central). Si hace falta, se pide desde la app
-- (Historial › detalle del parte › «Solicitar edición / eliminación») y lo
-- aprueba un aprobador central: José, Peter o Margaret (tabla
-- partes_aprobadores).
--
--  · Cuándo está bloqueado: existe un cert_maq con estado = 'emitido', la
--    fecha del parte entre desde y hasta, y la obra del parte es la del
--    certificado (o una de sus obras, en los consolidados). Es la misma regla
--    que ya usa la sincronización de JotForm (sync_jf_cert_emitido): esos
--    partes tampoco se corrigen solos desde JotForm.
--    Si el certificado se reabre (vuelve a borrador) o se anula, se desbloquea.
--  · También se bloquea MOVER un parte a un período certificado (cambiarle la
--    fecha u obra para que caiga en un certificado emitido).
--  · Lo que sí pasa sin pedir permiso: pasar las fotos a Drive (solo cambian
--    img_* a una dirección http) y el renombrado de obra / equipo / operador /
--    propietario en los catálogos (ON UPDATE CASCADE).
--  · Cargar partes nuevos en un período certificado NO se bloquea (no se pidió).
--  · Solicitud aprobada: vale 72 h y para UN solo cambio (una vez guardado,
--    queda «usada»). La puede usar quien la pidió o un aprobador. Con eso la
--    base le deja editar/borrar aunque normalmente no pudiera (por ejemplo el
--    operador pasadas las 24 h). Lo borrado con solicitud va a la papelera
--    (7 días, restaurable). Todo cambio sigue quedando en log_ediciones.
--  · El certificado emitido NO cambia solo: si la corrección cambia horas o
--    días, hay que reabrir el certificado y volver a emitirlo.
--
-- Escape para correcciones por SQL (SQL Editor, sin usuario):
--   begin; set local partes.desbloqueo = 'si'; update partes ...; commit;
--
-- Se puede volver a correr. Para volver atrás: bloque REVERTIR al final.
-- =========================================================================

-- ── 1. Quiénes aprueban ──────────────────────────────────────────────────
create table if not exists public.partes_aprobadores (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  agregado_en timestamptz not null default now()
);
alter table public.partes_aprobadores enable row level security;
drop policy if exists partes_aprobadores_lee on public.partes_aprobadores;
create policy partes_aprobadores_lee on public.partes_aprobadores for select to authenticated using (true);
grant select on public.partes_aprobadores to authenticated;

insert into public.partes_aprobadores (usuario_id, nombre)
select u.id, x.nombre
  from (values ('jose.espinola@tecsul.com.py', 'José Espínola'),
               ('petercacerez@tecsul.com.py', 'Peter'),
               ('margaret.fleitas@tecsul.com.py', 'Margaret')) x(correo, nombre)
  join auth.users u on lower(u.email) = x.correo
on conflict (usuario_id) do nothing;

create or replace function public.es_aprobador_partes() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.partes_aprobadores where usuario_id = auth.uid())
$$;

-- ── 2. ¿Está el parte en un certificado emitido? ─────────────────────────
create or replace function public.parte_cert_emitido(p_obra text, p_fecha date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'numero', c.numero, 'serie', c.serie,
                            'desde', c.desde, 'hasta', c.hasta,
                            'obra', coalesce(c.obra_clave, c.serie),
                            'texto', coalesce(c.serie || ' ', '') || 'N° ' || c.numero
                                     || ' (' || to_char(c.desde, 'DD/MM/YYYY') || ' – ' || to_char(c.hasta, 'DD/MM/YYYY') || ')')
    from public.cert_maq c
   where c.estado = 'emitido' and p_fecha between c.desde and c.hasta
     and (c.obra_clave = p_obra or p_obra = any (coalesce(c.obras, '{}')))
   order by (c.obra_clave is null), c.desde, c.id
   limit 1
$$;

-- Períodos bloqueados (para marcar los partes en la app sin consultar uno por uno)
create or replace function public.partes_periodos_certificados()
returns table (obra_clave text, desde date, hasta date, cert_id bigint, numero int, serie text)
language sql stable security definer set search_path = public as $$
  select o.obra, c.desde, c.hasta, c.id, c.numero, c.serie
    from public.cert_maq c
    cross join lateral unnest(case when cardinality(coalesce(c.obras, '{}')) > 0
                                   then c.obras else array[c.obra_clave] end) o(obra)
   where c.estado = 'emitido' and o.obra is not null
$$;

-- ── 3. Solicitudes ───────────────────────────────────────────────────────
create table if not exists public.partes_solicitudes (
  id              bigint generated always as identity primary key,
  parte_id        uuid references public.partes(id) on delete set null,
  tipo            text not null check (tipo in ('editar', 'eliminar')),
  motivo          text not null check (length(trim(motivo)) >= 5),
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada', 'usada')),
  parte_resumen   text,             -- "MN-04 · 26/10/2026 · obra" (queda aunque se borre el parte)
  parte_datos     jsonb,            -- copia del parte al pedir
  cert            jsonb,            -- certificado que lo bloqueaba al pedir
  solicitado_por  uuid not null default auth.uid(),
  solicitado_nombre text,
  solicitado_en   timestamptz not null default now(),
  resuelto_por    uuid,
  resuelto_nombre text,
  resuelto_en     timestamptz,
  nota_resolucion text,
  usada_por       uuid,
  usada_en        timestamptz
);
create index if not exists partes_solicitudes_parte on public.partes_solicitudes (parte_id);
create index if not exists partes_solicitudes_estado on public.partes_solicitudes (estado, solicitado_en desc);
-- Una sola abierta (pendiente o aprobada) por parte y tipo
create unique index if not exists partes_solicitudes_una_abierta
  on public.partes_solicitudes (parte_id, tipo) where estado in ('pendiente', 'aprobada');

alter table public.partes_solicitudes enable row level security;
drop policy if exists partes_solicitudes_lee on public.partes_solicitudes;
create policy partes_solicitudes_lee on public.partes_solicitudes for select to authenticated
  using (solicitado_por = (select auth.uid()) or (select public.es_aprobador_partes())
         or coalesce((select public.mi_rol())::text, '') in ('admin_central', 'gerente'));
-- Se escribe solo por las funciones de abajo
grant select on public.partes_solicitudes to authenticated;

-- Aprobación vigente: aprobada hace menos de 72 h, para quien la pidió o un aprobador
create or replace function public.parte_aprobacion_vigente(p_parte uuid, p_tipo text) returns bigint
language sql stable security definer set search_path = public as $$
  select s.id from public.partes_solicitudes s
   where s.parte_id = p_parte and s.tipo = p_tipo and s.estado = 'aprobada'
     and s.resuelto_en > now() - interval '72 hours'
     and auth.uid() is not null
     and (s.solicitado_por = auth.uid() or public.es_aprobador_partes())
   order by s.resuelto_en desc
   limit 1
$$;

-- Pedir: lo puede pedir quien VE el parte. La función corre con los permisos
-- de quien pide (security invoker): si RLS no le deja ver el parte, no puede.
drop policy if exists partes_solicitudes_alta on public.partes_solicitudes;
create policy partes_solicitudes_alta on public.partes_solicitudes for insert to authenticated
  with check (solicitado_por = (select auth.uid()) and estado = 'pendiente'
              and resuelto_por is null and resuelto_en is null and usada_en is null
              and exists (select 1 from public.partes p where p.id = parte_id));
grant insert on public.partes_solicitudes to authenticated;

create or replace function public.parte_solicitar(p_parte uuid, p_tipo text, p_motivo text) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  p partes%rowtype;
  c jsonb;
  v_id bigint;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_tipo not in ('editar', 'eliminar') then raise exception 'Tipo de solicitud desconocido: %', p_tipo; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribí el motivo (qué hay que corregir y por qué)'; end if;
  select * into p from partes where id = p_parte;   -- con RLS: solo si lo ve
  if not found then raise exception 'No se encontró el parte o no tenés acceso'; end if;
  c := parte_cert_emitido(p.obra_clave, p.fecha);
  if c is null then raise exception 'Ese parte no está en un certificado emitido: se edita normalmente'; end if;
  begin
    insert into partes_solicitudes (parte_id, tipo, motivo, parte_resumen, parte_datos, cert, solicitado_por, solicitado_nombre)
    values (p.id, p_tipo, trim(p_motivo),
            concat_ws(' · ', p.equipo_id, to_char(p.fecha, 'DD/MM/YYYY'), p.obra_clave),
            to_jsonb(p), c, auth.uid(), mi_nombre_partes_())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una solicitud de % abierta (pendiente o aprobada) para este parte', p_tipo;
  end;
  return v_id;
end $$;

create or replace function public.mi_nombre_partes_() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.nombre), ''), u.email)
    from auth.users u left join perfiles p on p.id = u.id
   where u.id = auth.uid()
$$;

-- Aprobar / rechazar: solo aprobadores
create or replace function public.parte_solicitud_resolver(p_id bigint, p_aprobar boolean, p_nota text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s partes_solicitudes%rowtype;
begin
  if not es_aprobador_partes() then
    raise exception 'Solo un aprobador central (José, Peter o Margaret) aprueba solicitudes' using errcode = '42501';
  end if;
  select * into s from partes_solicitudes where id = p_id for update;
  if not found then raise exception 'No existe la solicitud %', p_id; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya está %', s.estado; end if;
  if not p_aprobar and length(trim(coalesce(p_nota, ''))) = 0 then
    raise exception 'Escribí por qué se rechaza';
  end if;
  update partes_solicitudes
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         resuelto_por = auth.uid(), resuelto_en = now(),
         resuelto_nombre = mi_nombre_partes_(),
         nota_resolucion = nullif(trim(coalesce(p_nota, '')), '')
   where id = p_id;
  return case when p_aprobar then 'aprobada' else 'rechazada' end;
end $$;

-- Cancelar la propia (pendiente o aprobada sin usar)
create or replace function public.parte_solicitud_cancelar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update partes_solicitudes set estado = 'cancelada', resuelto_en = now(), resuelto_por = auth.uid(),
         resuelto_nombre = mi_nombre_partes_()
   where id = p_id and estado in ('pendiente', 'aprobada')
     and (solicitado_por = auth.uid() or es_aprobador_partes());
  if not found then raise exception 'No se puede cancelar esa solicitud'; end if;
end $$;

-- Lista para la app (con vencidas marcadas)
create or replace function public.partes_solicitudes_lista(p_estado text default 'abiertas')
returns table (id bigint, parte_id uuid, tipo text, motivo text, estado text, vencida boolean,
               parte_resumen text, parte_datos jsonb, cert jsonb, cert_sigue_emitido boolean,
               solicitado_nombre text, solicitado_en timestamptz, es_mia boolean,
               resuelto_nombre text, resuelto_en timestamptz, nota_resolucion text, usada_en timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.parte_id, s.tipo, s.motivo, s.estado,
         (s.estado = 'aprobada' and s.resuelto_en <= now() - interval '72 hours') as vencida,
         s.parte_resumen, coalesce(to_jsonb(p), s.parte_datos), s.cert,
         (p.id is not null and parte_cert_emitido(p.obra_clave, p.fecha) is not null),
         s.solicitado_nombre, s.solicitado_en, s.solicitado_por = auth.uid(),
         s.resuelto_nombre, s.resuelto_en, s.nota_resolucion, s.usada_en
    from partes_solicitudes s
    left join partes p on p.id = s.parte_id
   where (s.solicitado_por = auth.uid() or es_aprobador_partes()
          or coalesce(mi_rol()::text, '') in ('admin_central', 'gerente'))
     and case p_estado
           when 'pendiente' then s.estado = 'pendiente'
           when 'abiertas'  then s.estado = 'pendiente'
                                 or (s.estado = 'aprobada' and s.resuelto_en > now() - interval '72 hours')
           when 'todas'     then true
           else s.estado = p_estado
         end
   order by (s.estado = 'pendiente') desc, s.solicitado_en desc
   limit 500
$$;

-- ── 4. El candado ────────────────────────────────────────────────────────
create or replace function public.fn_parte_bloqueo_cert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c_old   jsonb;
  c_new   jsonb;
  c       jsonb;
  campos  text[];
  v_tipo  text := case tg_op when 'DELETE' then 'eliminar' else 'editar' end;
  v_sol   bigint;
begin
  c_old := parte_cert_emitido(old.obra_clave, old.fecha);
  if tg_op = 'UPDATE' and (new.obra_clave is distinct from old.obra_clave or new.fecha is distinct from old.fecha) then
    c_new := parte_cert_emitido(new.obra_clave, new.fecha);
  end if;
  c := coalesce(c_old, c_new);
  if c is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key) into campos
      from jsonb_each(to_jsonb(new)) n
     where n.value is distinct from (to_jsonb(old) -> n.key);
    if campos is null then return new; end if;                -- no cambia nada
    campos := array_remove(campos, 'editado_en');
    if cardinality(campos) = 0 then return new; end if;
    -- Fotos pasadas a Drive
    if campos <@ array['img_horometro', 'img_adjunto', 'img_parte_papel']
       and not exists (select 1 from jsonb_each_text(to_jsonb(new)) n
                        where n.key = any (campos) and coalesce(n.value, '') not like 'http%') then
      return new;
    end if;
    -- Renombrado en un catálogo (llega por ON UPDATE CASCADE)
    if pg_trigger_depth() > 1 and campos <@ array['obra_clave', 'equipo_id', 'operador_cedula', 'propietario'] then
      return new;
    end if;
  end if;

  -- Corrección por SQL a propósito (sin usuario de la app)
  if auth.uid() is null and current_setting('partes.desbloqueo', true) = 'si' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  v_sol := parte_aprobacion_vigente(old.id, v_tipo);
  if v_sol is null then
    raise exception 'PARTE CERTIFICADO: % % está en el certificado de máquinas emitido %. No se puede %: pedí la %.',
      old.equipo_id, to_char(old.fecha, 'DD/MM/YYYY'),
      case when c_old is null then (c_new->>'texto') || ' (la fecha u obra nueva cae ahí)' else c->>'texto' end,
      case tg_op when 'DELETE' then 'eliminar' else 'editar' end,
      case tg_op when 'DELETE' then 'eliminación' else 'edición' end
      using errcode = 'P0001',
            hint = 'Historial de partes › el parte › «Solicitar ' || case tg_op when 'DELETE' then 'eliminación' else 'edición' end
                   || '». La aprueba José, Peter o Margaret.';
  end if;

  -- Se marca «usada» en el AFTER (las reglas RLS se controlan antes)
  perform set_config('partes.sol_' || replace(old.id::text, '-', ''), v_sol::text, true);
  return case tg_op when 'DELETE' then old else new end;
end $$;

create or replace function public.fn_parte_bloqueo_cert_usar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  clave text := 'partes.sol_' || replace(old.id::text, '-', '');
  v_sol bigint := nullif(current_setting(clave, true), '')::bigint;
begin
  if v_sol is null then return null; end if;
  perform set_config(clave, '', true);
  update partes_solicitudes set estado = 'usada', usada_por = auth.uid(), usada_en = now()
   where id = v_sol and estado = 'aprobada';
  if tg_op = 'DELETE' then
    insert into papelera (tabla, registro_id, resumen, datos, motivo, anulado_por)
    values ('partes', old.id,
            'Parte ' || old.equipo_id || ' · ' || to_char(old.fecha, 'DD/MM/YYYY') || ' · ' || old.obra_clave,
            to_jsonb(old), 'Eliminado con la solicitud N° ' || v_sol || ' aprobada (parte certificado)', auth.uid());
  end if;
  return null;
end $$;

-- «trg_a…» para que corra antes que los demás BEFORE (van por orden alfabético)
drop trigger if exists trg_a_parte_bloqueo_cert on public.partes;
create trigger trg_a_parte_bloqueo_cert before update or delete on public.partes
  for each row execute function public.fn_parte_bloqueo_cert();
drop trigger if exists trg_z_parte_bloqueo_cert_usar on public.partes;
create trigger trg_z_parte_bloqueo_cert_usar after update or delete on public.partes
  for each row execute function public.fn_parte_bloqueo_cert_usar();

-- ── 5. Con la solicitud aprobada, la base le deja (aunque normalmente no) ─
drop policy if exists partes_edicion_aprobada on public.partes;
create policy partes_edicion_aprobada on public.partes for update to authenticated
  using ((select public.parte_aprobacion_vigente(id, 'editar')) is not null)
  with check ((select public.parte_aprobacion_vigente(id, 'editar')) is not null);
drop policy if exists partes_baja_aprobada on public.partes;
create policy partes_baja_aprobada on public.partes for delete to authenticated
  using ((select public.parte_aprobacion_vigente(id, 'eliminar')) is not null);

grant execute on function public.es_aprobador_partes() to authenticated;
grant execute on function public.parte_cert_emitido(text, date) to authenticated;
grant execute on function public.partes_periodos_certificados() to authenticated;
grant execute on function public.parte_aprobacion_vigente(uuid, text) to authenticated;
grant execute on function public.parte_solicitar(uuid, text, text) to authenticated;
grant execute on function public.parte_solicitud_resolver(bigint, boolean, text) to authenticated;
grant execute on function public.parte_solicitud_cancelar(bigint) to authenticated;
grant execute on function public.partes_solicitudes_lista(text) to authenticated;
revoke execute on function public.parte_solicitar(uuid, text, text) from anon;
revoke execute on function public.parte_solicitud_resolver(bigint, boolean, text) from anon;
revoke execute on function public.parte_solicitud_cancelar(bigint) from anon;
revoke execute on function public.partes_solicitudes_lista(text) from anon;

-- ── Control ──────────────────────────────────────────────────────────────
select (select count(*) from public.partes_aprobadores) as aprobadores,          -- 3
       (select count(*) from pg_trigger where tgrelid = 'public.partes'::regclass
          and tgname in ('trg_a_parte_bloqueo_cert', 'trg_z_parte_bloqueo_cert_usar')) as disparadores,   -- 2
       (select count(*) from public.partes p
         where public.parte_cert_emitido(p.obra_clave, p.fecha) is not null) as partes_bloqueados;

-- ── REVERTIR ─────────────────────────────────────────────────────────────
-- drop trigger if exists trg_a_parte_bloqueo_cert on public.partes;
-- drop trigger if exists trg_z_parte_bloqueo_cert_usar on public.partes;
-- drop policy if exists partes_edicion_aprobada on public.partes;
-- drop policy if exists partes_baja_aprobada on public.partes;
-- drop function if exists public.fn_parte_bloqueo_cert(), public.fn_parte_bloqueo_cert_usar(),
--   public.partes_solicitudes_lista(text), public.parte_solicitud_cancelar(bigint),
--   public.parte_solicitud_resolver(bigint, boolean, text), public.parte_solicitar(uuid, text, text),
--   public.mi_nombre_partes_(), public.parte_aprobacion_vigente(uuid, text),
--   public.partes_periodos_certificados(), public.parte_cert_emitido(text, date), public.es_aprobador_partes();
-- drop table if exists public.partes_solicitudes;
-- drop table if exists public.partes_aprobadores;
