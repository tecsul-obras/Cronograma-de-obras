-- =========================================================================
-- 63_recursos_mantenimiento.sql · equipos-v68 (27/10/2026)
--
-- Recursos típicos de mantenimiento (filtros, lubricantes, piezas de
-- desgaste) por modelo de máquina, con precio aproximado por código, y el
-- consumo de cada service registrado.
--
--   1) mant_listas        Una lista por modelo. equipos.lista_recursos_id
--                         dice qué lista usa cada máquina.
--   2) mant_codigos       Un renglón por código de repuesto: marca y precio
--                         aproximado (uno solo por código, vale para todas
--                         las listas que lo usan).
--   3) mant_recursos      Los renglones de cada lista: códigos (el primero es
--                         el principal), cantidad, unidad y en qué services
--                         se cambia (250 / 1.000 / 2.000 h). Sin service =
--                         según desgaste o inspección.
--   4) mantenimiento_recursos  Lo que se usó en cada mantenimiento.
--   5) Al registrar un service preventivo (desde la app o desde el reporte
--      de taller) se carga solo el kit estándar del nivel. Queda marcado
--      "estándar" hasta que alguien de taller lo revise y confirme.
--   6) Ciclo de services: 250 → 2.000 h (los planes con el ciclo viejo
--      250/500/750/1.000 pasan al nuevo).
--
-- Permisos: ven administración, taller y gerencia (ve_gestion); cargan y
-- editan administración central y taller (es_taller), precios incluidos.
--
-- No borra datos. Se puede correr más de una vez.
-- Después correr 63b_recursos_mantenimiento_datos.sql (lo del Excel).
-- =========================================================================

-- ── 0) Clave de código: mayúsculas, sin espacios, guiones, puntos ni barras
create or replace function public.mant_clave(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s\-\.\/]', '', 'g')), '')
$$;

-- ── 1) Listas por modelo
create table if not exists public.mant_listas (
  id              bigserial primary key,
  nombre          text not null,
  notas           text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);
alter table public.equipos add column if not exists lista_recursos_id bigint
  references public.mant_listas(id) on delete set null;
create index if not exists equipos_lista_recursos_idx on public.equipos (lista_recursos_id);

-- ── 2) Códigos y precios
create table if not exists public.mant_codigos (
  clave           text primary key,
  codigo          text not null,
  marca           text,
  precio_gs       numeric check (precio_gs is null or precio_gs >= 0),
  precio_fecha    date,
  precio_por      text,
  actualizado_en  timestamptz not null default now()
);

-- ── 3) Renglones de cada lista
create table if not exists public.mant_recursos (
  id              bigserial primary key,
  lista_id        bigint not null references public.mant_listas(id) on delete cascade,
  orden           integer not null default 0,
  grupo           text not null default 'Otros',
  descripcion     text not null,
  codigos         jsonb not null default '[]'::jsonb,   -- [{"c":"1R1807","e":"sis"}]; e: sis | ok | ver | na
  cantidad        numeric,
  unidad          text,
  services        integer[] not null default '{}',     -- 250, 1000, 2000…; vacío = según desgaste
  nota            text,
  solo_equipo     text references public.equipos(id) on delete cascade,   -- null = todos los de la lista
  excluye         text[] not null default '{}',                           -- equipos de la lista que no lo llevan
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint mant_recursos_codigos_array check (jsonb_typeof(codigos) = 'array')
);
create index if not exists mant_recursos_lista_idx on public.mant_recursos (lista_id, orden);

-- ── 4) Recursos usados en cada mantenimiento
alter table public.mantenimientos add column if not exists recursos_estado text
  check (recursos_estado is null or recursos_estado in ('estandar', 'confirmado'));

create table if not exists public.mantenimiento_recursos (
  id                bigserial primary key,
  mantenimiento_id  bigint not null references public.mantenimientos(id) on delete cascade,
  recurso_id        bigint references public.mant_recursos(id) on delete set null,
  orden             integer not null default 0,
  descripcion       text not null,
  codigo            text,
  cantidad          numeric,
  unidad            text,
  precio_gs         numeric,                 -- precio por unidad al momento de registrar
  usado             boolean not null default true,
  agregado          boolean not null default false   -- no venía en el kit
);
create index if not exists mantenimiento_recursos_mant_idx on public.mantenimiento_recursos (mantenimiento_id);

-- ── Permisos
alter table public.mant_listas            enable row level security;
alter table public.mant_codigos           enable row level security;
alter table public.mant_recursos          enable row level security;
alter table public.mantenimiento_recursos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mant_listas', 'mant_codigos', 'mant_recursos', 'mantenimiento_recursos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escritura', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve_gestion()))', t || '_lectura', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.es_taller())) with check ((select public.es_taller()))', t || '_escritura', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.mant_listas_id_seq, public.mant_recursos_id_seq,
  public.mantenimiento_recursos_id_seq to authenticated;

-- ── 5) Kit de un equipo para un nivel de service
-- El kit del service N es el del mayor nivel de la lista que divide a N:
-- 500, 750, 1.250… → 250 · 1.000, 3.000 → 1.000 · 2.000, 4.000 → 2.000.
-- Sin nivel (plan por km o días) → el menor nivel de la lista.
create or replace function public.mant_nivel_kit(p_nivel text, p_niveles integer[])
returns integer language sql immutable set search_path = public as $$
  with n as (select nullif(regexp_replace(coalesce(p_nivel, ''), '\D', '', 'g'), '')::bigint as v),
       l as (select distinct x from unnest(p_niveles) x where x > 0)
  select case
    when (select v from n) is null then (select min(x) from l)
    else coalesce((select max(x) from l where (select v from n) % x = 0),
                  (select max(x) from l where x <= (select v from n)),
                  (select min(x) from l))
  end
$$;

-- Renglones de la lista que corresponden a un equipo
create or replace function public.mant_recursos_de_equipo(p_equipo text)
returns setof public.mant_recursos language sql stable security definer set search_path = public as $$
  select r.* from mant_recursos r
    join equipos e on e.lista_recursos_id = r.lista_id
   where e.id = p_equipo
     and (r.solo_equipo is null or r.solo_equipo = p_equipo)
     and not (p_equipo = any (r.excluye))
$$;

create or replace function public.mant_kit(p_equipo text, p_nivel text)
returns table (recurso_id bigint, orden integer, descripcion text, codigo text, cantidad numeric,
               unidad text, precio_gs numeric, nivel_kit integer)
language sql stable security definer set search_path = public as $$
  with rs as (select * from mant_recursos_de_equipo(p_equipo)),
       niv as (select mant_nivel_kit(p_nivel, (select array_agg(distinct s) from rs, unnest(rs.services) s)) as k)
  select rs.id, rs.orden, rs.descripcion,
         rs.codigos -> 0 ->> 'c',
         rs.cantidad, rs.unidad,
         (select c.precio_gs
            from jsonb_array_elements(rs.codigos) with ordinality j(x, i)
            join mant_codigos c on c.clave = mant_clave(j.x ->> 'c')
           where c.precio_gs is not null
           order by j.i limit 1),
         niv.k
    from rs, niv
   where niv.k is not null and niv.k = any (rs.services)
   order by rs.orden, rs.id
$$;
grant execute on function public.mant_nivel_kit(text, integer[]), public.mant_clave(text) to authenticated;
-- El kit lo arma la base al registrar; la app lo calcula con las tablas (que tienen permisos)
revoke execute on function public.mant_kit(text, text), public.mant_recursos_de_equipo(text) from public, anon, authenticated;

-- Al registrar un preventivo: kit estándar (si la máquina tiene lista)
create or replace function public.fn_mantenimiento_kit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.tipo is distinct from 'Preventivo' then return new; end if;
  if exists (select 1 from mantenimiento_recursos where mantenimiento_id = new.id) then return new; end if;
  -- Nunca frena el registro del service (ni el reporte de taller): si algo falla, queda sin kit
  begin
    insert into mantenimiento_recursos (mantenimiento_id, recurso_id, orden, descripcion, codigo, cantidad, unidad, precio_gs)
    select new.id, k.recurso_id, k.orden, k.descripcion, k.codigo, k.cantidad, k.unidad, k.precio_gs
      from mant_kit(new.equipo_id, new.nivel) k;
    get diagnostics n = row_count;
    if n > 0 then
      update mantenimientos set recursos_estado = 'estandar' where id = new.id;
    end if;
  exception when others then
    raise warning 'Kit de recursos no cargado para el mantenimiento %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists trg_mantenimiento_kit on public.mantenimientos;
create trigger trg_mantenimiento_kit after insert on public.mantenimientos
  for each row execute function public.fn_mantenimiento_kit();

-- Guardar lo usado en un mantenimiento (reemplaza lo anterior y lo confirma)
-- p_filas: [{recurso_id, descripcion, codigo, cantidad, unidad, precio_gs, usado, agregado}]
create or replace function public.mant_guardar_recursos(p_mantenimiento bigint, p_filas jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not es_taller() then raise exception 'Solo administración o taller'; end if;
  if not exists (select 1 from mantenimientos where id = p_mantenimiento) then
    raise exception 'El mantenimiento no existe';
  end if;
  delete from mantenimiento_recursos where mantenimiento_id = p_mantenimiento;
  insert into mantenimiento_recursos (mantenimiento_id, recurso_id, orden, descripcion, codigo, cantidad,
                                      unidad, precio_gs, usado, agregado)
  select p_mantenimiento, nullif(f ->> 'recurso_id', '')::bigint, i::int,
         coalesce(nullif(btrim(f ->> 'descripcion'), ''), '(sin nombre)'),
         nullif(btrim(f ->> 'codigo'), ''), nullif(f ->> 'cantidad', '')::numeric,
         nullif(btrim(f ->> 'unidad'), ''), nullif(f ->> 'precio_gs', '')::numeric,
         coalesce((f ->> 'usado')::boolean, true), coalesce((f ->> 'agregado')::boolean, false)
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) with ordinality t(f, i);
  update mantenimientos set recursos_estado = 'confirmado' where id = p_mantenimiento;
end $$;
grant execute on function public.mant_guardar_recursos(bigint, jsonb) to authenticated;

-- Volver a cargar el kit estándar en un mantenimiento (p. ej. si se registró
-- antes de existir la lista o con el nivel equivocado)
create or replace function public.mant_recargar_kit(p_mantenimiento bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare m mantenimientos%rowtype; n integer;
begin
  if not es_taller() then raise exception 'Solo administración o taller'; end if;
  select * into m from mantenimientos where id = p_mantenimiento;
  if m.id is null then raise exception 'El mantenimiento no existe'; end if;
  delete from mantenimiento_recursos where mantenimiento_id = m.id;
  insert into mantenimiento_recursos (mantenimiento_id, recurso_id, orden, descripcion, codigo, cantidad, unidad, precio_gs)
  select m.id, k.recurso_id, k.orden, k.descripcion, k.codigo, k.cantidad, k.unidad, k.precio_gs
    from mant_kit(m.equipo_id, m.nivel) k;
  get diagnostics n = row_count;
  update mantenimientos set recursos_estado = case when n > 0 then 'estandar' end where id = m.id;
  return n;
end $$;
revoke execute on function public.mant_recargar_kit(bigint) from public, anon;
grant execute on function public.mant_recargar_kit(bigint) to authenticated;

-- Totales por mantenimiento (para la lista de services realizados)
create or replace view public.v_mantenimiento_recursos_total
with (security_invoker = true) as
-- Precio: el guardado al registrar; si no tenía, el precio actual del código
select mr.mantenimiento_id,
       count(*) filter (where mr.usado)                                                  as recursos,
       count(*)                                                                          as renglones,
       count(*) filter (where mr.usado and coalesce(mr.precio_gs, c.precio_gs) is null)   as sin_precio,
       sum(mr.cantidad * coalesce(mr.precio_gs, c.precio_gs)) filter (where mr.usado)    as costo_estimado
  from public.mantenimiento_recursos mr
  left join public.mant_codigos c on c.clave = public.mant_clave(mr.codigo)
 group by mr.mantenimiento_id;
grant select on public.v_mantenimiento_recursos_total to authenticated;

-- ── 6) Ciclo 250 → 2.000 h
update public.planes_mantenimiento
   set ciclo = array['250', '500', '750', '1.000', '1.250', '1.500', '1.750', '2.000']
 where ciclo = array['250', '500', '750', '1.000'];

-- ── Comprobación
select (select count(*) from information_schema.tables
         where table_schema = 'public'
           and table_name in ('mant_listas', 'mant_codigos', 'mant_recursos', 'mantenimiento_recursos')) as tablas_ok_4,
       (select count(*) from pg_trigger where tgname = 'trg_mantenimiento_kit')                          as trigger_ok_1,
       (select count(*) from public.planes_mantenimiento
         where ciclo = array['250', '500', '750', '1.000', '1.250', '1.500', '1.750', '2.000'])          as planes_ciclo_2000,
       public.mant_nivel_kit('750', array[250, 1000, 2000]) as kit_750_es_250,
       public.mant_nivel_kit('2.000', array[250, 1000, 2000]) as kit_2000_es_2000;
