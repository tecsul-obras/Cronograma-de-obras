-- ══════════════════════════════════════════════════════════════════
-- 100 · Fotos a Drive (09/11/2026)
--
-- Todas las fotos terminan en la unidad compartida «Fotos Tecsul»:
--   · las de JotForm (≈139.000: partes, combustible, taller, transporte),
--     todas, sin importar la fecha;
--   · las que se cargan desde la app (Storage de Supabase), cuando el
--     registro tiene más de 30 días (fotos_drive_config.dias_app).
--
-- Cómo funciona:
--   1. fotos_drive_encolar() arma la cola (tabla fotos_drive): una fila
--      por foto, con los registros que la usan (refs). Corre sola todas
--      las noches (pg_cron) y se puede correr a mano.
--   2. El Apps Script «FotosDrive» pide lotes (fotos_drive_tomar), baja
--      cada foto, la achica a 1600 px, la sube a Drive y avisa
--      (fotos_drive_lista). Ahí se cambia el valor en cada registro por
--      https://drive.google.com/file/d/<id>/view.
--   3. La app las muestra con la Edge Function «foto» (Drive privado,
--      solo usuarios con sesión).
--
-- No borra registros. Cambiar el link de una foto NO cuenta como edición
-- del parte (no va a log_ediciones ni cambia editado_en).
-- Se puede correr dos veces.
-- ══════════════════════════════════════════════════════════════════

-- ── Configuración ───────────────────────────────────────────────────
create table if not exists fotos_drive_config (
  id         int primary key default 1 check (id = 1),
  dias_app   int  not null default 30,      -- fotos de la app: a Drive cuando el registro tiene más de N días
  borrar_storage boolean not null default true,   -- borrar de Supabase después de copiar
  actualizado_en timestamptz default now()
);
insert into fotos_drive_config (id) values (1) on conflict do nothing;

-- ── Cola ────────────────────────────────────────────────────────────
create table if not exists fotos_drive (
  id            bigserial primary key,
  origen        text not null unique,          -- el valor tal como está guardado (URL de JotForm, URL pública o ruta de Storage)
  fuente        text not null check (fuente in ('jotform', 'storage', 'drive')),
  bucket        text,                           -- Storage
  ruta          text,                           -- Storage
  modulo        text not null,                  -- Partes / Combustible / Taller / Transporte / Produccion / Plantas
  carpeta       text not null,                  -- Partes/2026/2026-10
  nombre        text not null,                  -- sin extensión
  refs          jsonb not null default '[]',    -- [{t, c, a (array), k {pk: valor}}]
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'tomada', 'subida', 'lista', 'error', 'descartada')),
  intentos      int not null default 0,
  drive_tmp_id  text,                           -- original subido, esperando la versión achicada
  drive_id      text,
  url_drive     text,
  bytes_origen  bigint,
  bytes_drive   bigint,
  error         text,
  tomada_en     timestamptz,
  creado_en     timestamptz not null default now(),
  lista_en      timestamptz
);
create index if not exists fotos_drive_estado on fotos_drive (estado, fuente, id);
alter table fotos_drive enable row level security;          -- sin políticas: solo service_role y funciones
alter table fotos_drive_config enable row level security;

-- ── Cambiar el link de una foto no es una edición ───────────────────
create or replace function public.fn_log_edicion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- 100: el paso de una foto a Drive solo cambia el link: no es una edición
  if coalesce(current_setting('tecsul.fotos_drive', true), '') = '1' then
    return new;
  end if;
  new.editado_en := now();
  insert into log_ediciones (parte_id, usuario_id, antes, despues)
  values (old.id, auth.uid(), to_jsonb(old), to_jsonb(new));
  return new;
end;
$function$;

create or replace function public.fn_comb_antes()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.actividad = 'Trasvase entre tanques' then
    new.actividad := 'Traspaso entre tanques';
  end if;
  new.tanque_salida_id := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_salida_id), new.tanque_salida_id);
  new.tanque_fijo_id   := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_fijo_id), new.tanque_fijo_id);
  new.equipo_id        := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.equipo_id), new.equipo_id);
  if new.actividad in ('Despacho de combustible', 'Traspaso entre tanques') and new.litros is null
     and new.cuenta_litros_final is not null and new.cuenta_litros_inicial is not null then
    new.litros := new.cuenta_litros_final - new.cuenta_litros_inicial;
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('tecsul.fotos_drive', true), '') <> '1' then   -- 100
    new.editado_en := now();
  end if;
  return new;
end;
$function$;

-- ── Todas las fotos que hay en la base ──────────────────────────────
-- Una fila por (valor, registro, columna). a = la columna es un arreglo.
create or replace view fotos_drive_fuentes as
  select v.valor, 'partes'::text t, v.c, false a, jsonb_build_object('id', p.id) k,
         'Partes'::text modulo, 'partes'::text bucket, p.fecha, coalesce(p.equipo_id, '') etiqueta
  from partes p
  cross join lateral (values ('img_horometro', p.img_horometro), ('img_adjunto', p.img_adjunto),
                             ('firma', p.firma), ('img_parte_papel', p.img_parte_papel)) v(c, valor)
  where coalesce(v.valor, '') <> ''
union all
  select v.valor, 'combustible_movimientos', v.c, false, jsonb_build_object('id', m.id),
         'Combustible', 'combustible', m.fecha, coalesce(m.equipo_id, m.tanque_salida_id, '')
  from combustible_movimientos m
  cross join lateral (values ('foto_boleta', m.foto_boleta), ('foto_cuenta_inicial', m.foto_cuenta_inicial),
                             ('foto_cuenta_final', m.foto_cuenta_final)) v(c, valor)
  where coalesce(v.valor, '') <> ''
union all
  select v.valor, 'ot_registros', v.c, false, jsonb_build_object('id', r.id),
         'Taller', 'taller', r.fecha, coalesce('OT' || o.numero, '')
  from ot_registros r left join ordenes_trabajo o on o.id = r.ot_id
  cross join lateral (values ('foto_lectura', r.foto_lectura), ('firma', r.firma)) v(c, valor)
  where coalesce(v.valor, '') <> ''
union all
  select f.valor, 'ot_registros', v.c, true, jsonb_build_object('id', r.id),
         'Taller', 'taller', r.fecha, coalesce('OT' || o.numero, '')
  from ot_registros r left join ordenes_trabajo o on o.id = r.ot_id
  cross join lateral (values ('fotos', r.fotos), ('fotos_boletas', r.fotos_boletas)) v(c, arr)
  cross join lateral unnest(v.arr) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'ordenes_trabajo', v.c, true, jsonb_build_object('id', o.id),
         'Taller', 'taller', coalesce(o.fecha_ingreso, o.creado_en)::date, 'OT' || coalesce(o.numero::text, o.id::text) || '_' || coalesce(o.equipo_id, '')
  from ordenes_trabajo o
  cross join lateral (values ('imagenes', o.imagenes), ('fotos_salida', o.fotos_salida)) v(c, arr)
  cross join lateral unnest(v.arr) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'transporte_carga', 'fotos', true, jsonb_build_object('obra_id', c.obra_id, 'carga_id', c.carga_id),
         'Transporte', 'fotos-obra', c.fecha, c.obra_id
  from transporte_carga c cross join lateral unnest(c.fotos) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'produccion_jornada', 'fotos', true, jsonb_build_object('obra_id', j.obra_id, 'submission_id', j.submission_id),
         'Produccion', 'fotos-obra', j.fecha, j.obra_id
  from produccion_jornada j cross join lateral unnest(j.fotos) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'planta_jornadas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', x.fecha, coalesce(x.obra_clave, '')
  from planta_jornadas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'planta_pesadas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', x.fecha, coalesce(x.obra_clave, '')
  from planta_pesadas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') <> ''
union all
  select f.valor, 'planta_recargas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', (x.creado_en at time zone 'America/Asuncion')::date, ''
  from planta_recargas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') <> '';
revoke all on fotos_drive_fuentes from anon, authenticated;

-- ── Cambiar el link en los registros que usan la foto ───────────────
create or replace function _fotos_drive_reemplazar(p_refs jsonb, p_viejo text, p_nuevo text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r jsonb; donde text; n int := 0; m int;
begin
  perform set_config('tecsul.fotos_drive', '1', true);
  for r in select * from jsonb_array_elements(p_refs) loop
    select string_agg(format('%I = %L', e.key, e.value), ' and ') into donde
    from jsonb_each_text(r->'k') e;
    if (r->>'a')::boolean then
      execute format('update %I set %I = array_replace(%I, %L, %L) where %s and %L = any(%I)',
                     r->>'t', r->>'c', r->>'c', p_viejo, p_nuevo, donde, p_viejo, r->>'c');
    else
      execute format('update %I set %I = %L where %s and %I = %L',
                     r->>'t', r->>'c', p_nuevo, donde, r->>'c', p_viejo);
    end if;
    get diagnostics m = row_count;
    n := n + m;
  end loop;
  perform set_config('tecsul.fotos_drive', '', true);
  return n;
end $$;
revoke all on function _fotos_drive_reemplazar(jsonb, text, text) from public, anon, authenticated;

-- ── Armar la cola ───────────────────────────────────────────────────
create or replace function fotos_drive_encolar()
returns table (fuente text, nuevas bigint, en_cola bigint)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare
  dias int := (select c.dias_app from fotos_drive_config c where c.id = 1);
  x record;
begin
  drop table if exists _fd;
  create temp table _fd on commit drop as
  with c as (
    select s.*,
      case
        when s.valor ilike '%jotform.com/uploads/%' then 'jotform'
        when s.valor in (select a.url_drive from fotos_archivadas a) then 'drive'   -- las del archivador viejo (Drive privado)
        when s.valor ~* '^https://[^/]+\.supabase\.co/storage/v1/object/public/' then 'storage'
        when s.valor !~* '^(https?:|data:|blob:)' then 'storage'
      end fte,
      case when s.valor ~* '^https://[^/]+\.supabase\.co/storage/v1/object/public/'
           then (regexp_match(s.valor, '/object/public/([^/]+)/'))[1] else s.bucket end bkt,
      case when s.valor ~* '^https://[^/]+\.supabase\.co/storage/v1/object/public/'
           then (regexp_match(s.valor, '/object/public/[^/]+/(.+)$'))[1] else s.valor end rta
    from fotos_drive_fuentes s
  )
  select valor, fte, case when fte = 'storage' then bkt end bkt, case when fte = 'storage' then rta end rta,
         min(modulo) modulo, min(fecha) fecha, min(etiqueta) etiqueta, min(c) col,
         jsonb_agg(distinct jsonb_build_object('t', t, 'c', c, 'a', a, 'k', k)) refs
  from c
  where fte in ('jotform', 'drive') or (fte = 'storage' and fecha < current_date - dias)
  group by valor, fte, bkt, rta;

  -- Fotos ya pasadas que aparecen en un registro nuevo (p. ej. un parte
  -- corregido que volvió a traer el link viejo): se cambia el link directo.
  for x in select f.origen, f.url_drive, n.refs from _fd n join fotos_drive f on f.origen = n.valor
           where f.estado = 'lista' loop
    perform _fotos_drive_reemplazar(x.refs, x.origen, x.url_drive);
  end loop;

  drop table if exists _fd_n;
  create temp table _fd_n (fuente text, nueva boolean) on commit drop;
  with ins as (
    insert into fotos_drive (origen, fuente, bucket, ruta, modulo, carpeta, nombre, refs)
    select n.valor, n.fte, n.bkt, n.rta, n.modulo,
           n.modulo || '/' || to_char(coalesce(n.fecha, current_date), 'YYYY') || '/' || to_char(coalesce(n.fecha, current_date), 'YYYY-MM'),
           to_char(coalesce(n.fecha, current_date), 'YYYY-MM-DD') || '_' ||
             coalesce(nullif(regexp_replace(n.etiqueta, '[^A-Za-z0-9-]+', '', 'g'), ''), 'x') || '_' || n.col || '_' || left(md5(n.valor), 8),
           n.refs
    from _fd n
    on conflict (origen) do update
      set refs = (select jsonb_agg(distinct e) from jsonb_array_elements(fotos_drive.refs || excluded.refs) e)
      where fotos_drive.estado <> 'lista'
    returning fotos_drive.fuente, (xmax = 0) es_nueva
  )
  insert into _fd_n select * from ins;

  return query
  select e.fuente, (select count(*) from _fd_n n where n.fuente = e.fuente and n.nueva),
         count(*) filter (where e.estado in ('pendiente', 'tomada', 'subida', 'error'))
  from fotos_drive e group by e.fuente;
end $$;
revoke all on function fotos_drive_encolar() from public, anon, authenticated;
grant execute on function fotos_drive_encolar() to service_role;

-- ── Para el Apps Script ─────────────────────────────────────────────
-- Toma un lote. Las «tomadas» hace más de 20 minutos (el script se
-- cortó) vuelven a la cola. Las que fallaron 5 veces quedan en «error».
create or replace function fotos_drive_tomar(p_limite int default 40)
returns table (id bigint, origen text, fuente text, bucket text, ruta text, carpeta text, nombre text,
               estado text, drive_tmp_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update fotos_drive f set estado = 'pendiente'
  where f.estado = 'tomada' and f.tomada_en < now() - interval '20 minutes';

  return query
  with l as (
    select f.id from fotos_drive f
    where f.estado = 'pendiente' or (f.estado = 'error' and f.intentos < 5)
    order by (f.fuente = 'jotform') desc, f.intentos, f.id
    limit p_limite
    for update skip locked
  )
  update fotos_drive f set estado = 'tomada', tomada_en = now(), intentos = f.intentos + 1
  from l where f.id = l.id
  returning f.id, f.origen, f.fuente, f.bucket, f.ruta, f.carpeta, f.nombre, f.estado, f.drive_tmp_id;
end $$;

-- Originales subidos que esperan la versión achicada
create or replace function fotos_drive_subidas(p_limite int default 60)
returns table (id bigint, carpeta text, nombre text, drive_tmp_id text, bytes_origen bigint)
language sql
security definer
set search_path to 'public'
as $$
  select f.id, f.carpeta, f.nombre, f.drive_tmp_id, f.bytes_origen
  from fotos_drive f where f.estado = 'subida' order by f.tomada_en limit p_limite
$$;

-- p: [{id, tmp_id, bytes}] — original subido, falta achicar
create or replace function fotos_drive_subida(p jsonb)
returns int
language sql
security definer
set search_path to 'public'
as $$
  with u as (
    update fotos_drive f set estado = 'subida', drive_tmp_id = x.tmp_id, bytes_origen = x.bytes, tomada_en = now(), error = null
    from jsonb_to_recordset(p) x(id bigint, tmp_id text, bytes bigint)
    where f.id = x.id
    returning 1)
  select count(*)::int from u
$$;

-- p: [{id, drive_id, bytes, bytes_origen}] — foto final en Drive: se cambia el link en los registros.
-- Devuelve las de Storage que ya se pueden borrar de Supabase.
create or replace function fotos_drive_lista(p jsonb)
returns table (id bigint, bucket text, ruta text, registros int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  x record; f fotos_drive; url text; n int; borrar boolean := (select c.borrar_storage from fotos_drive_config c where c.id = 1);
begin
  for x in select * from jsonb_to_recordset(p) r(id bigint, drive_id text, bytes bigint, bytes_origen bigint) loop
    select * into f from fotos_drive d where d.id = x.id for update;
    if not found or x.drive_id is null then continue; end if;
    url := 'https://drive.google.com/file/d/' || x.drive_id || '/view';
    n := _fotos_drive_reemplazar(f.refs, f.origen, url);
    update fotos_drive d set estado = 'lista', drive_id = x.drive_id, url_drive = url, drive_tmp_id = null,
           bytes_drive = x.bytes, bytes_origen = coalesce(x.bytes_origen, d.bytes_origen), error = null, lista_en = now()
    where d.id = x.id;
    id := f.id; registros := n;
    -- de Storage se borra solo si se cambiaron todos los registros que la usaban
    if f.fuente = 'storage' and borrar and n >= jsonb_array_length(f.refs) then
      bucket := f.bucket; ruta := f.ruta;
    else
      bucket := null; ruta := null;
    end if;
    return next;
  end loop;
end $$;

-- p: [{id, error, descartar}] — descartar = la foto ya no existe en el origen (404)
create or replace function fotos_drive_error(p jsonb)
returns int
language sql
security definer
set search_path to 'public'
as $$
  with u as (
    update fotos_drive f
       set estado = case when x.descartar then 'descartada' else 'error' end,
           error = left(x.error, 500), drive_tmp_id = coalesce(x.tmp_id, f.drive_tmp_id)
    from jsonb_to_recordset(p) x(id bigint, error text, descartar boolean, tmp_id text)
    where f.id = x.id
    returning 1)
  select count(*)::int from u
$$;

revoke all on function fotos_drive_tomar(int), fotos_drive_subidas(int), fotos_drive_subida(jsonb),
                       fotos_drive_lista(jsonb), fotos_drive_error(jsonb) from public, anon, authenticated;
grant execute on function fotos_drive_tomar(int), fotos_drive_subidas(int), fotos_drive_subida(jsonb),
                          fotos_drive_lista(jsonb), fotos_drive_error(jsonb) to service_role;

-- ── Avance (también para mirar desde el SQL Editor) ─────────────────
create or replace view fotos_drive_avance as
  select fuente, modulo,
         count(*) total,
         count(*) filter (where estado = 'lista') listas,
         count(*) filter (where estado in ('pendiente', 'tomada', 'subida')) en_cola,
         count(*) filter (where estado = 'error') con_error,
         count(*) filter (where estado = 'descartada') descartadas,
         round(sum(bytes_origen) filter (where estado = 'lista') / 1e9, 2) gb_origen,
         round(sum(bytes_drive) filter (where estado = 'lista') / 1e9, 2) gb_drive,
         max(lista_en) ultima
  from fotos_drive group by 1, 2 order by 1, 2;
revoke all on fotos_drive_avance from anon, authenticated;

-- ── Lo viejo: el archivador de fotos de partes de la app ────────────
-- (Apps Script de equipos: archivar_foto / fotos_a_archivar) queda
-- reemplazado por este: ya no le da fotos para archivar, así no las
-- manda a un Drive privado que la app no puede mostrar. Las 7 que ya
-- archivó se copian a la unidad compartida (fuente 'drive').
create or replace function fotos_a_archivar(p_dias integer default 90, p_limite integer default 200)
returns table (parte_id uuid, fecha date, equipo_id text, campo text, ruta text)
language sql stable security definer set search_path to 'public'
as $$ select null::uuid, null::date, null::text, null::text, null::text where false $$;

-- ── Encolar solo todas las noches (03:10 Paraguay = 06:10 UTC) ──────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fotos_drive_encolar';
    perform cron.schedule('fotos_drive_encolar', '10 6 * * *', 'select * from public.fotos_drive_encolar()');
  end if;
end $$;

-- ── Primera carga de la cola ────────────────────────────────────────
select * from fotos_drive_encolar();
select * from fotos_drive_avance;
