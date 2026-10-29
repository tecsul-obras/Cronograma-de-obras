-- =========================================================================
-- 72_rrhh.sql · Recursos humanos (29/10/2026)
--
-- Sección aparte de RECURSOS HUMANOS: planilla mensual de salarios de
-- operadores, choferes y mecánicos (la planilla SALARIO_OPERADORES_<MES>
-- que hoy lleva RRHH en Excel), legajo del personal y categorías.
-- Se entra desde el menú «Otras apps de Tecsul» (rrhh/index.html).
--
-- Quién la ve (lo decide la base: rrhh_acceso()):
--   · Administrador de Obras (admin) y admin central de Equipos → carga y edita
--   · Rol nuevo «rrhh» (Recursos humanos) en Obras             → carga y edita
--   · Gerente (Obras)                                           → solo ve
--   · Nadie más: ni residentes, ni taller, ni operadores. Las tablas
--     tienen RLS: sin acceso, la base no devuelve ninguna fila.
--
--   1) usuario.rol admite 'rrhh' (Administración › rol en Obras).
--   2) rrhh_categorias   Categorías (Chofer A…, Operador A+…, Mecánico A+…)
--                        con salario y precio de la hora mínimo / máximo.
--   3) rrhh_personal     Legajo: una fila por cédula, con los datos de su
--                        última planilla (categoría, cargo, local, salario
--                        base, viático, precio de la hora…) y si está activo.
--   4) rrhh_planillas    Una por mes (YYYY-MM): salario mínimo, período de
--                        horas hombre (por defecto del 26 al 25) y estado
--                        (borrador / cerrada).
--   5) rrhh_planilla_filas  Un renglón por persona y mes, con las mismas
--                        columnas del Excel. Total horas, total bruto, IPS y
--                        sueldo líquido los calcula la base (columnas
--                        calculadas), igual que las fórmulas del Excel:
--                          total horas = HH × precio por hora
--                          bruto   = salario a cobrar + viático + extras + total horas
--                          IPS     = bruto × % IPS (9 %; 0 si no aporta)
--                          líquido = bruto − IPS − anticipo − embargo − descuentos − casino
--   6) rrhh_planilla_guardar   Guarda la planilla entera de una vez (la usa
--                        la pantalla y la importación del Excel). Si otra
--                        persona la guardó mientras estaba abierta, avisa y
--                        no pisa. Una planilla cerrada no se modifica.
--   7) rrhh_hh_partes    Horas hombre por cédula sacadas de los partes
--                        diarios de un período (para comparar con las HH de
--                        la planilla y traerlas con un botón).
--
-- No borra datos. Se puede correr más de una vez.
-- Los datos (planilla de septiembre) NO van en este archivo: se cargan
-- desde la pantalla con «Importar Excel».
-- =========================================================================

-- ── 1) Rol «rrhh» en Obras ───────────────────────────────────────────────
alter table public.usuario drop constraint if exists usuario_rol_check;
alter table public.usuario add constraint usuario_rol_check check (rol = any (array[
  'admin', 'residente', 'consulta', 'lectura', 'transporte', 'produccion', 'compras', 'gerente', 'rrhh']));

create or replace function public.adm_usuario_guardar(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(public._jtxt(p->'email'), '')));
  r text := coalesce(public._jtxt(p->'rol'), '');
  o text;
begin
  if not public.app_es_admin() then raise exception 'Solo el administrador.' using errcode = '42501'; end if;
  if em = '' then raise exception 'Falta el correo o la cédula.' using errcode = '22023'; end if;
  if position('@' in em) = 0 then em := regexp_replace(em, '[^0-9a-z]', '', 'g') || '@campo.tecsul.com.py'; end if;
  if r not in ('admin', 'residente', 'lectura', 'transporte', 'produccion', 'compras', 'gerente', 'rrhh') then
    raise exception 'Rol no válido: %', r using errcode = '22023';
  end if;
  if r in ('transporte', 'produccion') and jsonb_array_length(coalesce(p->'obras', '[]'::jsonb)) = 0 then
    raise exception 'A los usuarios de campo hay que asignarles al menos una obra.' using errcode = '22023';
  end if;
  if em = public.app_email() and (r <> 'admin' or coalesce((p->>'activo')::boolean, true) = false) then
    raise exception 'No podés quitarte a vos mismo el rol de administrador.' using errcode = '42501';
  end if;
  insert into public.usuario (email, nombre, rol, activo)
  values (em, coalesce(public._jtxt(p->'nombre'), ''), r, coalesce((p->>'activo')::boolean, true))
  on conflict (email) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;
  delete from public.usuario_obra where email = em;
  for o in select jsonb_array_elements_text(coalesce(p->'obras', '[]'::jsonb)) loop
    insert into public.usuario_obra (email, obra_id) values (em, trim(o)) on conflict do nothing;
  end loop;
  return json_build_object('email', em, 'rol', r);
end $$;

-- ── 2) ¿Quién entra a RRHH? 'editar' | 'ver' | null ─────────────────────
create or replace function public.rrhh_acceso()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'rrhh')) then 'editar'
    when exists (select 1 from perfiles p where p.id = auth.uid() and p.activo and p.rol::text = 'admin_central') then 'editar'
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol = 'gerente') then 'ver'
  end
$$;
revoke all on function public.rrhh_acceso() from public;
grant execute on function public.rrhh_acceso() to authenticated;

create or replace function public.rrhh_puede_editar()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.rrhh_acceso() = 'editar', false)
$$;
grant execute on function public.rrhh_puede_editar() to authenticated;

-- ── 3) Tablas ────────────────────────────────────────────────────────────
create table if not exists public.rrhh_categorias (
  nombre          text primary key,
  grupo           text not null default 'Otros',      -- Choferes / Operadores / Mecánicos / Otros
  salario_min     numeric check (salario_min is null or salario_min >= 0),
  salario_max     numeric check (salario_max is null or salario_max >= 0),
  hh_min          numeric check (hh_min is null or hh_min >= 0),   -- precio de la hora hombre
  hh_max          numeric check (hh_max is null or hh_max >= 0),
  orden           integer not null default 0,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.rrhh_personal (
  cedula          text primary key check (cedula ~ '^[0-9]{3,10}$'),
  nombre          text not null,
  categoria       text,
  fecha_ingreso   date,
  cargo           text,
  equipo          text,                -- máquina habitual según el cargo (CV-13, EX-17…)
  local           text,
  factor_sm       numeric,
  salario_base    numeric,
  viatico         numeric,             -- viático estipulado
  precio_hora     numeric,
  aporta_ips      boolean not null default true,
  activo          boolean not null default true,
  fecha_baja      date,
  observacion     text,
  ultimo_mes      text,                -- última planilla en la que figura
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);

create table if not exists public.rrhh_planillas (
  mes             text primary key check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  titulo          text,
  salario_minimo  numeric,
  hh_desde        date,                -- período de horas hombre (por defecto 26 del mes anterior)
  hh_hasta        date,                -- … al 25 del mes
  estado          text not null default 'borrador' check (estado in ('borrador', 'cerrada')),
  notas           text,
  creado_en       timestamptz not null default now(),
  creado_por      text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text,
  cerrado_en      timestamptz,
  cerrado_por     text
);

create table if not exists public.rrhh_planilla_filas (
  id                 bigserial primary key,
  mes                text not null references public.rrhh_planillas(mes) on delete cascade on update cascade,
  orden              integer not null default 0,
  nro                text,
  cedula             text not null,
  nombre             text not null,
  categoria          text,
  fecha_ingreso      date,
  cargo              text,
  equipo             text,
  local              text,
  factor_sm          numeric,
  salario_base       numeric,
  viatico_estipulado numeric,
  dias_trabajados    numeric check (dias_trabajados is null or (dias_trabajados >= 0 and dias_trabajados <= 31)),
  salario_cobrar     numeric,
  viatico_cobrar     numeric,
  extras             numeric,
  hh                 numeric,
  precio_hora        numeric,
  ips_pct            numeric not null default 9 check (ips_pct >= 0 and ips_pct <= 100),
  anticipo           numeric,
  embargo            numeric,
  descuentos         numeric,
  casino             numeric,
  observacion        text,
  total_horas        numeric generated always as (coalesce(hh, 0) * coalesce(precio_hora, 0)) stored,
  bruto              numeric generated always as (
                       coalesce(salario_cobrar, 0) + coalesce(viatico_cobrar, 0) + coalesce(extras, 0)
                       + coalesce(hh, 0) * coalesce(precio_hora, 0)) stored,
  ips                numeric generated always as (
                       (coalesce(salario_cobrar, 0) + coalesce(viatico_cobrar, 0) + coalesce(extras, 0)
                        + coalesce(hh, 0) * coalesce(precio_hora, 0)) * ips_pct / 100) stored,
  liquido            numeric generated always as (
                       (coalesce(salario_cobrar, 0) + coalesce(viatico_cobrar, 0) + coalesce(extras, 0)
                        + coalesce(hh, 0) * coalesce(precio_hora, 0)) * (1 - ips_pct / 100)
                       - coalesce(anticipo, 0) - coalesce(embargo, 0) - coalesce(descuentos, 0) - coalesce(casino, 0)) stored,
  unique (mes, cedula)
);
create index if not exists rrhh_planilla_filas_mes_idx on public.rrhh_planilla_filas (mes, orden);
create index if not exists rrhh_planilla_filas_cedula_idx on public.rrhh_planilla_filas (cedula);

-- ── 4) Permisos (RLS) ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['rrhh_categorias', 'rrhh_personal', 'rrhh_planillas', 'rrhh_planilla_filas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.rrhh_acceso()) is not null)', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.rrhh_puede_editar())) with check ((select public.rrhh_puede_editar()))', t || '_editar', t);
  end loop;
end $$;
grant usage, select on sequence public.rrhh_planilla_filas_id_seq to authenticated;

-- ── 5) Guardar la planilla entera ────────────────────────────────────────
-- p_cab:   { titulo, salario_minimo, hh_desde, hh_hasta, notas, actualizar_personal (true) }
-- p_filas: [{ nro, cedula, nombre, categoria, fecha_ingreso, cargo, equipo, local, factor_sm,
--             salario_base, viatico_estipulado, dias_trabajados, salario_cobrar, viatico_cobrar,
--             extras, hh, precio_hora, ips_pct, anticipo, embargo, descuentos, casino, observacion }]
-- p_version: actualizado_en que tenía la pantalla al abrir (null = planilla nueva)
create or replace function public.rrhh_planilla_guardar(p_mes text, p_cab jsonb, p_filas jsonb, p_version timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  yo text := coalesce(nullif(app_email(), ''), auth.uid()::text);
  pl rrhh_planillas%rowtype;
  nfilas integer;
  dup text;
  num_ok constant text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if not rrhh_puede_editar() then raise exception 'Solo administración o RRHH pueden modificar la planilla.' using errcode = '42501'; end if;
  if p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido: %', p_mes using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_filas, '[]'::jsonb)) <> 'array' then raise exception 'Faltan los renglones.' using errcode = '22023'; end if;

  select * into pl from rrhh_planillas where mes = p_mes for update;
  if found then
    if pl.estado = 'cerrada' then
      raise exception 'La planilla de % está cerrada. Para cambiarla, primero reabrila.', p_mes using errcode = 'P0001';
    end if;
    if p_version is null or date_trunc('milliseconds', pl.actualizado_en) <> date_trunc('milliseconds', p_version) then
      raise exception 'Otra persona guardó esta planilla mientras la tenías abierta (%, %). Volvé a abrirla y repetí el cambio.',
        coalesce(pl.actualizado_por, '—'), to_char(pl.actualizado_en at time zone 'America/Asuncion', 'DD/MM HH24:MI')
        using errcode = 'P0001';
    end if;
  end if;

  -- cédulas repetidas o vacías
  select string_agg(distinct coalesce(nullif(c, ''), '(vacía)'), ', ') into dup
    from (select a.c, count(*) over (partition by a.c) as veces
            from (select regexp_replace(coalesce(f->>'cedula', ''), '\D', '', 'g') as c
                    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f) a) b
   where b.c = '' or b.veces > 1;
  if dup is not null then
    raise exception 'Hay cédulas repetidas o vacías en la planilla: %', dup using errcode = '22023';
  end if;

  insert into rrhh_planillas as t (mes, titulo, salario_minimo, hh_desde, hh_hasta, notas, creado_por, actualizado_por)
  values (p_mes, nullif(btrim(p_cab->>'titulo'), ''),
          case when (p_cab->>'salario_minimo') ~ num_ok then (p_cab->>'salario_minimo')::numeric end,
          nullif(p_cab->>'hh_desde', '')::date, nullif(p_cab->>'hh_hasta', '')::date,
          nullif(btrim(p_cab->>'notas'), ''), yo, yo)
  on conflict (mes) do update set
    titulo = excluded.titulo, salario_minimo = excluded.salario_minimo,
    hh_desde = excluded.hh_desde, hh_hasta = excluded.hh_hasta, notas = excluded.notas,
    actualizado_en = clock_timestamp(), actualizado_por = yo
  returning * into pl;

  delete from rrhh_planilla_filas where mes = p_mes;
  insert into rrhh_planilla_filas (mes, orden, nro, cedula, nombre, categoria, fecha_ingreso, cargo, equipo, local,
         factor_sm, salario_base, viatico_estipulado, dias_trabajados, salario_cobrar, viatico_cobrar, extras,
         hh, precio_hora, ips_pct, anticipo, embargo, descuentos, casino, observacion)
  select p_mes, i::int, nullif(btrim(f->>'nro'), ''),
         regexp_replace(f->>'cedula', '\D', '', 'g'),
         coalesce(nullif(btrim(f->>'nombre'), ''), '(sin nombre)'),
         nullif(btrim(f->>'categoria'), ''), nullif(f->>'fecha_ingreso', '')::date,
         nullif(btrim(f->>'cargo'), ''), nullif(upper(btrim(f->>'equipo')), ''), nullif(btrim(f->>'local'), ''),
         case when f->>'factor_sm' ~ num_ok then (f->>'factor_sm')::numeric end,
         case when f->>'salario_base' ~ num_ok then (f->>'salario_base')::numeric end,
         case when f->>'viatico_estipulado' ~ num_ok then (f->>'viatico_estipulado')::numeric end,
         case when f->>'dias_trabajados' ~ num_ok then (f->>'dias_trabajados')::numeric end,
         case when f->>'salario_cobrar' ~ num_ok then (f->>'salario_cobrar')::numeric end,
         case when f->>'viatico_cobrar' ~ num_ok then (f->>'viatico_cobrar')::numeric end,
         case when f->>'extras' ~ num_ok then (f->>'extras')::numeric end,
         case when f->>'hh' ~ num_ok then (f->>'hh')::numeric end,
         case when f->>'precio_hora' ~ num_ok then (f->>'precio_hora')::numeric end,
         case when f->>'ips_pct' ~ num_ok then (f->>'ips_pct')::numeric else 9 end,
         case when f->>'anticipo' ~ num_ok then (f->>'anticipo')::numeric end,
         case when f->>'embargo' ~ num_ok then (f->>'embargo')::numeric end,
         case when f->>'descuentos' ~ num_ok then (f->>'descuentos')::numeric end,
         case when f->>'casino' ~ num_ok then (f->>'casino')::numeric end,
         nullif(btrim(f->>'observacion'), '')
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) with ordinality t(f, i);
  get diagnostics nfilas = row_count;

  -- Legajo: queda con los datos de la planilla más nueva de cada persona
  if coalesce((p_cab->>'actualizar_personal')::boolean, true) then
    insert into rrhh_personal as r (cedula, nombre, categoria, fecha_ingreso, cargo, equipo, local, factor_sm,
           salario_base, viatico, precio_hora, aporta_ips, ultimo_mes, actualizado_por)
    select f.cedula, f.nombre, f.categoria, f.fecha_ingreso, f.cargo, f.equipo, f.local, f.factor_sm,
           f.salario_base, f.viatico_estipulado, f.precio_hora, f.ips_pct > 0, p_mes, yo
      from rrhh_planilla_filas f where f.mes = p_mes
    on conflict (cedula) do update set
      nombre = excluded.nombre, categoria = excluded.categoria,
      fecha_ingreso = coalesce(excluded.fecha_ingreso, r.fecha_ingreso),
      cargo = excluded.cargo, equipo = excluded.equipo, local = excluded.local, factor_sm = excluded.factor_sm,
      salario_base = excluded.salario_base, viatico = excluded.viatico, precio_hora = excluded.precio_hora,
      aporta_ips = excluded.aporta_ips, ultimo_mes = excluded.ultimo_mes,
      actualizado_en = now(), actualizado_por = excluded.actualizado_por
    where r.ultimo_mes is null or r.ultimo_mes <= excluded.ultimo_mes;
  end if;

  return json_build_object('mes', pl.mes, 'actualizado_en', pl.actualizado_en, 'filas', nfilas);
end $$;
revoke all on function public.rrhh_planilla_guardar(text, jsonb, jsonb, timestamptz) from public;
grant execute on function public.rrhh_planilla_guardar(text, jsonb, jsonb, timestamptz) to authenticated;

-- Cerrar / reabrir (no cambia los renglones)
create or replace function public.rrhh_planilla_estado(p_mes text, p_estado text)
returns json language plpgsql security definer set search_path = public as $$
declare yo text := coalesce(nullif(app_email(), ''), auth.uid()::text); pl rrhh_planillas%rowtype;
begin
  if not rrhh_puede_editar() then raise exception 'Solo administración o RRHH.' using errcode = '42501'; end if;
  if p_estado not in ('borrador', 'cerrada') then raise exception 'Estado no válido.' using errcode = '22023'; end if;
  update rrhh_planillas set estado = p_estado, actualizado_en = clock_timestamp(), actualizado_por = yo,
         cerrado_en = case when p_estado = 'cerrada' then now() end,
         cerrado_por = case when p_estado = 'cerrada' then yo end
   where mes = p_mes returning * into pl;
  if not found then raise exception 'No existe la planilla de %.', p_mes using errcode = 'P0001'; end if;
  return json_build_object('mes', pl.mes, 'estado', pl.estado, 'actualizado_en', pl.actualizado_en);
end $$;
revoke all on function public.rrhh_planilla_estado(text, text) from public;
grant execute on function public.rrhh_planilla_estado(text, text) to authenticated;

-- Eliminar una planilla en borrador
create or replace function public.rrhh_planilla_borrar(p_mes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not rrhh_puede_editar() then raise exception 'Solo administración o RRHH.' using errcode = '42501'; end if;
  if exists (select 1 from rrhh_planillas where mes = p_mes and estado = 'cerrada') then
    raise exception 'La planilla de % está cerrada: no se puede eliminar.', p_mes using errcode = 'P0001';
  end if;
  delete from rrhh_planillas where mes = p_mes;
  -- el legajo vuelve a apuntar a la última planilla que quede
  update rrhh_personal r set ultimo_mes = (select max(f.mes) from rrhh_planilla_filas f where f.cedula = r.cedula)
   where r.ultimo_mes = p_mes;
end $$;
revoke all on function public.rrhh_planilla_borrar(text) from public;
grant execute on function public.rrhh_planilla_borrar(text) to authenticated;

-- ── 6) Horas hombre de los partes diarios en un período ─────────────────
create or replace function public.rrhh_hh_partes(p_desde date, p_hasta date)
returns table (cedula text, hh numeric, partes bigint, dias bigint, equipos text, ultimo date)
language plpgsql stable security definer set search_path = public as $$
begin
  if rrhh_acceso() is null then raise exception 'Sin acceso a RRHH.' using errcode = '42501'; end if;
  return query
    select p.operador_cedula, sum(coalesce(p.horas_hombre, 0)), count(*), count(distinct p.fecha),
           string_agg(distinct p.equipo_id, ', ' order by p.equipo_id), max(p.fecha)
      from partes p
     where p.fecha between p_desde and p_hasta and p.operador_cedula is not null
     group by p.operador_cedula;
end $$;
revoke all on function public.rrhh_hh_partes(date, date) from public;
grant execute on function public.rrhh_hh_partes(date, date) to authenticated;

-- ── 7) Categorías de la planilla actual (hoja CATEGORÍAS) ────────────────
insert into public.rrhh_categorias (nombre, grupo, salario_min, salario_max, hh_min, hh_max, orden) values
  ('Chofer A',               'Choferes',    3300000, 3300000, 4000, 6000,  1),
  ('Chofer B+ (administ)',   'Choferes',    3070000, 3070000,    0,    0,  2),
  ('Chofer B',               'Choferes',    3000000, 3000000, 3000, 4000,  3),
  ('Chofer C',               'Choferes',    2900000, 2900000, 3000, 4000,  4),
  ('Chofer D (prueba)',      'Choferes',    2900000, 2900000,    0,    0,  5),
  ('Operador A+',            'Operadores',  3300000, 4300000, 9000, 9000,  6),
  ('Operador A',             'Operadores',  3300000, 3300000, 9000, 9000,  7),
  ('Operador B',             'Operadores',  3000000, 3000000, 6000, 8000,  8),
  ('Operador C',             'Operadores',  2900000, 2900000, 4000, 6000,  9),
  ('Operador D (prueba)',    'Operadores',  2900000, 2900000,    0,    0, 10),
  ('Mecánico A+',            'Mecánicos',   8000000, 8850000, null, null, 11),
  ('Mecánico A',             'Mecánicos',   6000000, 6900000, null, null, 12),
  ('Mecánico B',             'Mecánicos',   4000000, 5900000, null, null, 13),
  ('Mecánico C',             'Mecánicos',   3500000, 3900000, null, null, 14),
  ('Mecánico D',             'Mecánicos',   3000000, 3400000, null, null, 15),
  ('Mecánico E',             'Mecánicos',   2900000, 2900000, null, null, 16)
on conflict (nombre) do nothing;

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('rrhh_categorias', 'rrhh_personal', 'rrhh_planillas', 'rrhh_planilla_filas')) as tablas_ok_4,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'rrhh\_%')    as politicas_ok_8,
  (select count(*) from public.rrhh_categorias)                                                  as categorias_16,
  (select pg_get_constraintdef(oid) like '%rrhh%' from pg_constraint where conname = 'usuario_rol_check') as rol_rrhh_true;

-- =========================================================================
-- VOLVER ATRÁS (borra la sección y sus datos)
-- -------------------------------------------------------------------------
-- drop function if exists public.rrhh_hh_partes(date, date), public.rrhh_planilla_borrar(text),
--   public.rrhh_planilla_estado(text, text), public.rrhh_planilla_guardar(text, jsonb, jsonb, timestamptz),
--   public.rrhh_puede_editar(), public.rrhh_acceso();
-- drop table if exists public.rrhh_planilla_filas, public.rrhh_planillas, public.rrhh_personal, public.rrhh_categorias;
-- (el rol 'rrhh' puede quedar en usuario_rol_check sin problema)
-- =========================================================================
