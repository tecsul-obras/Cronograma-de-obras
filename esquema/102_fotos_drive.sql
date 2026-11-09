-- ══════════════════════════════════════════════════════════════════
-- 102 · Fotos a Drive + «Foto vencida» (09/11/2026)
--
-- Las fotos de los últimos 12 meses terminan en la unidad compartida
-- «Fotos Tecsul» (privada); las de más de 1 año se borran y en su lugar
-- queda el texto «vencida» (la app muestra «Foto vencida»).
--   · JotForm: se copian solo las de registros de los últimos 100 días
--     (JotForm borra sus archivos a los 3 meses: las más viejas ya no
--     existen). Las demás pasan directo a «vencida».
--   · App (Storage de Supabase): pasan a Drive cuando el registro tiene
--     más de 30 días (dias_app) y se borran de Supabase.
--   · Retención: toda foto (Drive o Supabase) de un registro con más de
--     365 días (dias_retencion) se borra y queda «vencida». Corre todas
--     las noches. Vale para fotos, firmas, partes, taller, combustible…
--
-- Cómo funciona:
--   1. fotos_drive_encolar() arma la cola (tabla fotos_drive): una fila
--      por foto, con los registros que la usan (refs). Corre sola todas
--      las noches (pg_cron) y se puede correr a mano.
--   2. El Apps Script «FotosDrive» pide lotes (fotos_drive_tomar), baja
--      cada foto, la achica a 1600 px, la sube a Drive y avisa
--      (fotos_drive_lista). Ahí se cambia el valor en cada registro por
--      https://drive.google.com/file/d/<id>/view. También borra de Drive
--      y de Supabase las vencidas (fotos_drive_a_vencer / _vencida).
--   2b. fotos_drive_vencer_lote() (pg_cron, cada minuto) pone «vencida»
--      en los registros de las que no hay que borrar afuera (JotForm).
--   3. La app las muestra con la Edge Function «foto» (Drive privado,
--      solo usuarios con sesión).
--
-- No borra registros. Cambiar el link de una foto NO cuenta como edición
-- del parte: no corren los triggers (no va a log_ediciones, no cambia
-- editado_en, no recalcula flota). En fotos_drive
-- queda el link original de cada foto (origen).
-- Se puede correr dos veces.
-- ══════════════════════════════════════════════════════════════════

-- ── Configuración ───────────────────────────────────────────────────
create table if not exists fotos_drive_config (
  id         int primary key default 1 check (id = 1),
  dias_app   int  not null default 30,           -- fotos de la app: a Drive cuando el registro tiene más de N días
  dias_jotform int not null default 100,         -- JotForm: más viejas que esto ya no existen → «vencida» sin intentar
  dias_retencion int not null default 365,       -- toda foto de un registro más viejo que esto se borra → «vencida»
  borrar_storage boolean not null default true,  -- borrar de Supabase después de copiar
  actualizado_en timestamptz default now()
);
alter table fotos_drive_config add column if not exists dias_jotform int not null default 100;
alter table fotos_drive_config add column if not exists dias_retencion int not null default 365;
insert into fotos_drive_config (id) values (1) on conflict do nothing;

-- ── Cola ────────────────────────────────────────────────────────────
create table if not exists fotos_drive (
  id            bigserial primary key,
  origen        text not null unique,          -- el valor tal como estaba guardado (URL de JotForm, URL pública o ruta de Storage)
  fuente        text not null check (fuente in ('jotform', 'storage', 'drive')),
  bucket        text,                           -- Storage
  ruta          text,                           -- Storage
  modulo        text not null,                  -- Partes / Combustible / Taller / Transporte / Produccion / Plantas
  fecha         date,                           -- fecha del registro (para la retención)
  carpeta       text not null,                  -- Partes/2026/2026-10
  nombre        text not null,                  -- sin extensión
  refs          jsonb not null default '[]',    -- [{t, c, a (array), k {pk: valor}}]
  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'tomada', 'subida', 'lista', 'error', 'vencer', 'vencida')),
  intentos      int not null default 0,
  drive_tmp_id  text,                           -- original subido, esperando la versión achicada
  drive_id      text,
  url_drive     text,
  bytes_origen  bigint,
  bytes_drive   bigint,
  error         text,
  tomada_en     timestamptz,
  creado_en     timestamptz not null default now(),
  lista_en      timestamptz,
  vencida_en    timestamptz
);
create index if not exists fotos_drive_estado on fotos_drive (estado, fuente, id);
create index if not exists fotos_drive_fecha on fotos_drive (fecha) where estado = 'lista';
alter table fotos_drive enable row level security;          -- sin políticas: solo service_role y funciones
alter table fotos_drive_config enable row level security;

-- ── Cambiar el link de una foto no es una edición ───────────────────
-- Los cambios de link se hacen con session_replication_role = replica:
-- no corren los triggers (log_ediciones, editado_en, solapes, flota…),
-- solo cambia el texto de la foto. Se vuelve a como estaba al terminar.
create or replace function _fotos_drive_sin_triggers(p_si boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_si then
    perform set_config('tecsul.fotos_drive_srr', current_setting('session_replication_role'), true);
    execute 'set local session_replication_role = replica';   -- con SET (no set_config): lo permite Supabase
  else
    execute format('set local session_replication_role = %s',
                   coalesce(nullif(current_setting('tecsul.fotos_drive_srr', true), ''), 'origin'));
  end if;
end $$;
revoke all on function _fotos_drive_sin_triggers(boolean) from public, anon, authenticated;

-- ── Todas las fotos que hay en la base ──────────────────────────────
-- Una fila por (valor, registro, columna). a = la columna es un arreglo.
create or replace view fotos_drive_fuentes as
  select v.valor, 'partes'::text t, v.c, false a, jsonb_build_object('id', p.id) k,
         'Partes'::text modulo, 'partes'::text bucket, p.fecha, coalesce(p.equipo_id, '') etiqueta
  from partes p
  cross join lateral (values ('img_horometro', p.img_horometro), ('img_adjunto', p.img_adjunto),
                             ('firma', p.firma), ('img_parte_papel', p.img_parte_papel)) v(c, valor)
  where coalesce(v.valor, '') not in ('', 'vencida')
union all
  select v.valor, 'combustible_movimientos', v.c, false, jsonb_build_object('id', m.id),
         'Combustible', 'combustible', m.fecha, coalesce(m.equipo_id, m.tanque_salida_id, '')
  from combustible_movimientos m
  cross join lateral (values ('foto_boleta', m.foto_boleta), ('foto_cuenta_inicial', m.foto_cuenta_inicial),
                             ('foto_cuenta_final', m.foto_cuenta_final)) v(c, valor)
  where coalesce(v.valor, '') not in ('', 'vencida')
union all
  select v.valor, 'ot_registros', v.c, false, jsonb_build_object('id', r.id),
         'Taller', 'taller', r.fecha, coalesce('OT' || o.numero, '')
  from ot_registros r left join ordenes_trabajo o on o.id = r.ot_id
  cross join lateral (values ('foto_lectura', r.foto_lectura), ('firma', r.firma)) v(c, valor)
  where coalesce(v.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'ot_registros', v.c, true, jsonb_build_object('id', r.id),
         'Taller', 'taller', r.fecha, coalesce('OT' || o.numero, '')
  from ot_registros r left join ordenes_trabajo o on o.id = r.ot_id
  cross join lateral (values ('fotos', r.fotos), ('fotos_boletas', r.fotos_boletas)) v(c, arr)
  cross join lateral unnest(v.arr) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'ordenes_trabajo', v.c, true, jsonb_build_object('id', o.id),
         'Taller', 'taller', coalesce(o.fecha_ingreso, o.creado_en)::date, 'OT' || coalesce(o.numero::text, o.id::text) || '_' || coalesce(o.equipo_id, '')
  from ordenes_trabajo o
  cross join lateral (values ('imagenes', o.imagenes), ('fotos_salida', o.fotos_salida)) v(c, arr)
  cross join lateral unnest(v.arr) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'transporte_carga', 'fotos', true, jsonb_build_object('obra_id', c.obra_id, 'carga_id', c.carga_id),
         'Transporte', 'fotos-obra', c.fecha, c.obra_id
  from transporte_carga c cross join lateral unnest(c.fotos) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'produccion_jornada', 'fotos', true, jsonb_build_object('obra_id', j.obra_id, 'submission_id', j.submission_id),
         'Produccion', 'fotos-obra', j.fecha, j.obra_id
  from produccion_jornada j cross join lateral unnest(j.fotos) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'planta_jornadas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', x.fecha, coalesce(x.obra_clave, '')
  from planta_jornadas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'planta_pesadas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', x.fecha, coalesce(x.obra_clave, '')
  from planta_pesadas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida')
union all
  select f.valor, 'planta_recargas', 'fotos', true, jsonb_build_object('id', x.id),
         'Plantas', 'plantas', (x.creado_en at time zone 'America/Asuncion')::date, ''
  from planta_recargas x cross join lateral unnest(x.fotos) f(valor)
  where coalesce(f.valor, '') not in ('', 'vencida');
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
  perform _fotos_drive_sin_triggers(true);
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
  perform _fotos_drive_sin_triggers(false);
  return n;
end $$;
revoke all on function _fotos_drive_reemplazar(jsonb, text, text) from public, anon, authenticated;

-- ── «vencida» en bloque (miles de links de una vez) ─────────────────
-- _fdv: valor, t, c, a, k — pone 'vencida' en cada registro.
create or replace function _fotos_drive_vencer_bloque()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record; cond text; n bigint := 0; m bigint; vuelta int;
begin
  perform _fotos_drive_sin_triggers(true);
  for g in select distinct v.t, v.c, v.a, (select string_agg(x, ',' order by x) from jsonb_object_keys(v.k) x) llaves
           from _fdv v loop
    -- la llave con su tipo (así usa el índice de la tabla)
    select string_agg(format('x.%I = (v.k->>%L)::%s', x, x,
                             (select format_type(at.atttypid, at.atttypmod) from pg_attribute at
                              where at.attrelid = g.t::regclass and at.attname = x)), ' and ') into cond
    from unnest(string_to_array(g.llaves, ',')) x;
    if g.a then
      -- un registro puede tener varias fotos viejas en el mismo arreglo: se repite
      vuelta := 0;
      loop
        execute format('update %I x set %I = array_replace(x.%I, v.valor, ''vencida'') from _fdv v
                        where v.t = %L and v.c = %L and %s and v.valor = any(x.%I)',
                       g.t, g.c, g.c, g.t, g.c, cond, g.c);
        get diagnostics m = row_count; n := n + m; vuelta := vuelta + 1;
        exit when m = 0 or vuelta > 20;
      end loop;
    else
      execute format('update %I x set %I = ''vencida'' from _fdv v
                      where v.t = %L and v.c = %L and %s and x.%I = v.valor',
                     g.t, g.c, g.t, g.c, cond, g.c);
      get diagnostics m = row_count; n := n + m;
    end if;
  end loop;
  perform _fotos_drive_sin_triggers(false);
  return n;
end $$;
revoke all on function _fotos_drive_vencer_bloque() from public, anon, authenticated;

-- Las «vencer» que no tienen nada que borrar afuera (JotForm, o nunca
-- copiadas): pone «vencida» en los registros, de a lotes. Lo corre
-- pg_cron cada minuto (5000 por vez, ≈10 s); la primera vez son
-- ≈120.000 y tarda ≈25 minutos.
create or replace function fotos_drive_vencer_lote(p_limite int default 5000)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare ids bigint[];
begin
  select array_agg(z.id) into ids from (
    select f.id from fotos_drive f
    where f.estado = 'vencer' and f.drive_id is null and f.drive_tmp_id is null and f.fuente <> 'storage'
    order by f.id limit p_limite for update skip locked) z;
  if ids is null then return 0; end if;
  drop table if exists _fdv;
  create temp table _fdv on commit drop as
    select f.origen valor, r->>'t' t, r->>'c' c, (r->>'a')::boolean a, r->'k' k
    from fotos_drive f cross join lateral jsonb_array_elements(f.refs) r
    where f.id = any(ids);
  perform _fotos_drive_vencer_bloque();
  drop table _fdv;
  update fotos_drive f set estado = 'vencida', vencida_en = now() where f.id = any(ids);
  return cardinality(ids);
end $$;
revoke all on function fotos_drive_vencer_lote(int) from public, anon, authenticated;
grant execute on function fotos_drive_vencer_lote(int) to service_role;

-- ── Armar la cola ───────────────────────────────────────────────────
drop function if exists fotos_drive_encolar();
create or replace function fotos_drive_encolar()
returns table (paso text, fotos bigint)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '600s'
as $$
declare
  cf fotos_drive_config;
  x record; n bigint;
begin
  select * into cf from fotos_drive_config c where c.id = 1;

  drop table if exists _fd;
  create temp table _fd on commit drop as
  with c as (
    select s.*,
      case
        when s.valor ilike '%jotform.com/uploads/%' then 'jotform'
        when s.valor in (select a.url_drive from fotos_archivadas a) then 'drive'   -- del archivador viejo (Drive privado)
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
         min(modulo) modulo, max(fecha) fecha, min(etiqueta) etiqueta, min(c) col,
         jsonb_agg(distinct jsonb_build_object('t', t, 'c', c, 'a', a, 'k', k)) refs,
         case
           -- JotForm ya no las tiene, o pasaron el año → «vencida» sin intentar
           when fte in ('jotform', 'drive') and max(fecha) < current_date - least(cf.dias_retencion, case when fte = 'jotform' then cf.dias_jotform else cf.dias_retencion end) then 'vencer_ya'
           -- de la app con más de un año: hay que borrarlas de Supabase
           when fte = 'storage' and max(fecha) < current_date - cf.dias_retencion then 'vencer'
           when fte in ('jotform', 'drive') then 'copiar'
           when fte = 'storage' and max(fecha) < current_date - cf.dias_app then 'copiar'
         end accion
  from c
  where fte is not null
  group by valor, fte, bkt, rta;
  delete from _fd where accion is null;

  -- 1) Fotos ya pasadas que aparecen en un registro nuevo (p. ej. un parte
  --    corregido que volvió a traer el link viejo): se cambia el link directo.
  for x in select f.origen, f.url_drive, n.refs from _fd n join fotos_drive f on f.origen = n.valor
           where f.estado = 'lista' loop
    perform _fotos_drive_reemplazar(x.refs, x.origen, x.url_drive);
  end loop;
  for x in select f.origen, n.refs from _fd n join fotos_drive f on f.origen = n.valor
           where f.estado = 'vencida' loop
    perform _fotos_drive_reemplazar(x.refs, x.origen, 'vencida');
  end loop;
  delete from _fd n using fotos_drive f where f.origen = n.valor and f.estado in ('lista', 'vencida');

  -- 2) Nuevas: para copiar, o para borrar / dejar «vencida»
  --    (vencer_ya = JotForm ya no la tiene, o pasó el año: no se intenta copiar)
  insert into fotos_drive (origen, fuente, bucket, ruta, modulo, fecha, carpeta, nombre, refs, estado, error)
  select n.valor, n.fte, n.bkt, n.rta, n.modulo, n.fecha,
         n.modulo || '/' || to_char(coalesce(n.fecha, current_date), 'YYYY') || '/' || to_char(coalesce(n.fecha, current_date), 'YYYY-MM'),
         to_char(coalesce(n.fecha, current_date), 'YYYY-MM-DD') || '_' ||
           coalesce(nullif(regexp_replace(n.etiqueta, '[^A-Za-z0-9-]+', '', 'g'), ''), 'x') || '_' || n.col || '_' || left(md5(n.valor), 8),
         n.refs,
         case when n.accion = 'copiar' then 'pendiente' else 'vencer' end,
         case when n.accion = 'vencer_ya' and n.fte = 'jotform' and n.fecha >= current_date - cf.dias_retencion
              then 'JotForm ya no la tiene (más de ' || cf.dias_jotform || ' días)'
              when n.accion <> 'copiar' then 'más de ' || cf.dias_retencion || ' días' end
  from _fd n
  on conflict (origen) do update
    set refs = (select jsonb_agg(distinct e) from jsonb_array_elements(fotos_drive.refs || excluded.refs) e),
        fecha = excluded.fecha,
        error = coalesce(excluded.error, fotos_drive.error),
        estado = case when excluded.estado = 'vencer' and fotos_drive.estado in ('pendiente', 'error') then 'vencer'
                      else fotos_drive.estado end;
  get diagnostics n = row_count;
  paso := 'en la cola (nuevas o actualizadas)'; fotos := n; return next;

  -- 3) Retención: las que ya están en Drive y pasaron el año → el Apps Script las borra
  update fotos_drive f set estado = 'vencer'
  where f.estado = 'lista' and f.fecha < current_date - cf.dias_retencion;
  get diagnostics n = row_count;
  paso := 'en Drive con más de un año: a borrar'; fotos := n; return next;

  -- 4b) Pendientes que pasaron el plazo antes de copiarse
  update fotos_drive f set estado = 'vencer'
  where f.estado in ('pendiente', 'error') and f.fecha < current_date - cf.dias_retencion;

  return query
  select 'estado: ' || e.estado, count(*) from fotos_drive e group by e.estado order by 1;
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

-- p: [{id, error, descartar}] — descartar = la foto ya no existe en el
-- origen (404): queda «vencida» en los registros.
create or replace function fotos_drive_error(p jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare x record; f fotos_drive; n int := 0;
begin
  for x in select * from jsonb_to_recordset(p) r(id bigint, error text, descartar boolean, tmp_id text) loop
    select * into f from fotos_drive d where d.id = x.id for update;
    if not found then continue; end if;
    if coalesce(x.descartar, false) then
      perform _fotos_drive_reemplazar(f.refs, f.origen, 'vencida');
      update fotos_drive d set estado = 'vencida', vencida_en = now(), error = left('No está en el origen: ' || coalesce(x.error, ''), 500)
      where d.id = x.id;
    else
      update fotos_drive d set estado = 'error', error = left(x.error, 500), drive_tmp_id = coalesce(x.tmp_id, d.drive_tmp_id)
      where d.id = x.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Fotos para borrar afuera (más de un año): en Drive (drive_id) o en Supabase (bucket, ruta).
-- Las que no tienen nada afuera las hace fotos_drive_vencer_lote.
create or replace function fotos_drive_a_vencer(p_limite int default 100)
returns table (id bigint, drive_id text, drive_tmp_id text, bucket text, ruta text)
language sql
security definer
set search_path to 'public'
as $$
  select f.id, f.drive_id, f.drive_tmp_id,
         case when f.fuente = 'storage' and f.drive_id is null then f.bucket end,
         case when f.fuente = 'storage' and f.drive_id is null then f.ruta end
  from fotos_drive f
  where f.estado = 'vencer' and (f.drive_id is not null or f.drive_tmp_id is not null or f.fuente = 'storage')
  order by f.fecha, f.id limit p_limite
$$;

-- p: [id, …] — ya borradas: en los registros queda «vencida»
create or replace function fotos_drive_vencida(p jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare f fotos_drive; n int := 0;
begin
  for f in select d.* from fotos_drive d where d.id in (select (jsonb_array_elements_text(p))::bigint) and d.estado = 'vencer' for update loop
    perform _fotos_drive_reemplazar(f.refs, coalesce(f.url_drive, f.origen), 'vencida');
    if f.url_drive is not null then perform _fotos_drive_reemplazar(f.refs, f.origen, 'vencida'); end if;
    update fotos_drive d set estado = 'vencida', vencida_en = now(), drive_tmp_id = null where d.id = f.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function fotos_drive_a_vencer(int), fotos_drive_vencida(jsonb) from public, anon, authenticated;
grant execute on function fotos_drive_a_vencer(int), fotos_drive_vencida(jsonb) to service_role;

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
         count(*) filter (where estado = 'vencer') a_borrar,
         count(*) filter (where estado = 'vencida') vencidas,
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

-- ── Encolar todas las noches (03:10 Paraguay = 06:10 UTC); «vencida» cada minuto ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fotos_drive_encolar';
    perform cron.schedule('fotos_drive_encolar', '10 6 * * *', 'select * from public.fotos_drive_encolar()');
    perform cron.unschedule(jobid) from cron.job where jobname = 'fotos_drive_vencer';
    perform cron.schedule('fotos_drive_vencer', '* * * * *', 'select public.fotos_drive_vencer_lote(5000)');
  end if;
end $$;

-- ── Primera carga de la cola ────────────────────────────────────────
select * from fotos_drive_encolar();
select * from fotos_drive_avance;
