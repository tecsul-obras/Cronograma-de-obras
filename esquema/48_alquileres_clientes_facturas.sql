-- =========================================================================
-- 48_alquileres_clientes_facturas.sql · v20261016h  (Equipos: alquileres)
-- Tecsul S.A.E.
--
-- Alquileres pasa a ser una pestaña de "Certificado de máquinas":
--  · clientes: un cliente con su RUC y contacto (se usa en los contratos
--    y en los certificados). Se crea a partir de los contratos que ya hay.
--  · alquiler_contratos.obra_clave / cliente_id: el contrato se vincula con
--    el centro de costo 305AM… que eligen los operadores en el parte diario.
--    Las horas de la liquidación son las de los partes de ESA obra.
--  · alquiler_facturas: facturas anexadas (número, fecha, mes, monto y el
--    archivo PDF o foto, en el bucket privado "alquileres").
--  · Gerente: solo lectura. Escribe: admin_central.
--
-- Se puede volver a correr. Para volver atrás: REVERTIR al final.
-- =========================================================================

-- ── Clientes ─────────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  ruc         text,
  contacto    text,
  telefono    text,
  email       text,
  direccion   text,
  notas       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists clientes_ruc_unico on public.clientes (ruc) where ruc is not null and ruc <> '';
create unique index if not exists clientes_nombre_sin_ruc on public.clientes (upper(nombre)) where ruc is null or ruc = '';

-- ── Contratos: obra (centro de costo) y cliente ──────────────────────────
alter table public.alquiler_contratos add column if not exists obra_clave text references public.obras(clave) on update cascade on delete set null;
alter table public.alquiler_contratos add column if not exists cliente_id bigint references public.clientes(id) on delete set null;
create index if not exists alquiler_contratos_obra on public.alquiler_contratos (obra_clave);

-- Clientes a partir de los contratos (agrupados por RUC; sin RUC, por nombre).
-- Si un mismo RUC tiene varios nombres ("CONSORCIO VICTORIA - PREFABRICADO",
-- "… - OBRA Y PLANTA"), el cliente se llama por la parte antes del " - ".
insert into public.clientes (nombre, ruc, contacto, telefono, email)
select case when count(distinct c.arrendatario) > 1 then min(split_part(c.arrendatario, ' - ', 1)) else min(c.arrendatario) end,
       nullif(btrim(c.ruc), ''), max(c.contacto), max(c.telefono), max(c.email)
from public.alquiler_contratos c
where nullif(btrim(c.ruc), '') is not null
group by nullif(btrim(c.ruc), '')
on conflict do nothing;

insert into public.clientes (nombre)
select distinct btrim(c.arrendatario)
from public.alquiler_contratos c
where nullif(btrim(c.ruc), '') is null and nullif(btrim(c.arrendatario), '') is not null
  and not exists (select 1 from public.clientes k where upper(k.nombre) = upper(btrim(c.arrendatario)))
on conflict do nothing;

update public.alquiler_contratos c set cliente_id = k.id
from public.clientes k
where c.cliente_id is null
  and ((nullif(btrim(c.ruc), '') is not null and k.ruc = btrim(c.ruc))
    or (nullif(btrim(c.ruc), '') is null and upper(k.nombre) = upper(btrim(c.arrendatario)) and nullif(k.ruc, '') is null));

-- Vincular la obra 305AM… solo cuando hay UNA candidata clara:
--  1) el nombre del centro de costo contiene el texto de la obra del contrato;
--  2) si hay varias, la que además contiene el sufijo del arrendatario
--     ("COMPAÑIA … - CCC" → CCC);
--  3) contrato en vigencia cuyo arrendatario es igual al nombre de la obra.
-- Los demás se vinculan a mano en la app (Certificado de máquinas → Alquileres).
with k as (
  select c.id, c.obra, c.arrendatario, c.estado, upper(btrim(regexp_replace(c.arrendatario, '^.* - ', ''))) as suf
  from public.alquiler_contratos c where c.obra_clave is null
), a as (
  select k.id, o.clave, (upper(o.nombre) ~ ('(^|[^A-Z])' || k.suf || '([^A-Z]|$)')) as con_suf
  from k join public.obras o on o.codigo like '305AM%'
   and nullif(btrim(k.obra), '') is not null and upper(o.nombre) like '%' || upper(btrim(k.obra)) || '%'
), elegida as (
  select id, min(clave) as clave from a group by id having count(*) = 1
  union all
  select id, min(clave) from a where con_suf and id not in (select id from a group by id having count(*) = 1)
  group by id having count(*) = 1
  union all
  select k.id, min(o.clave) from k join public.obras o on o.codigo like '305AM%' and upper(btrim(o.nombre)) = upper(btrim(k.arrendatario))
  where k.estado = 'En Vigencia' and k.id not in (select id from a)
  group by k.id having count(*) = 1
)
update public.alquiler_contratos c set obra_clave = e.clave
from elegida e where c.id = e.id and c.obra_clave is null;

-- ── Facturas anexadas ────────────────────────────────────────────────────
create table if not exists public.alquiler_facturas (
  id           bigint generated always as identity primary key,
  contrato_id  bigint not null references public.alquiler_contratos(id) on delete cascade,
  mes          date,                         -- mes que se factura (día 1)
  nro_factura  text,
  fecha        date,
  monto_gs     numeric,
  archivo      text,                         -- ruta en el bucket "alquileres"
  archivo_nombre text,
  notas        text,
  creado_por   uuid default auth.uid(),
  creado_en    timestamptz not null default now()
);
create index if not exists alquiler_facturas_contrato on public.alquiler_facturas (contrato_id, mes desc);

-- ── Permisos: admin escribe, gerente lee ─────────────────────────────────
create or replace function public.ve_alquileres() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol()::text in ('admin_central', 'gerente'), false)
$$;
revoke all on function public.ve_alquileres() from public, anon;
grant execute on function public.ve_alquileres() to authenticated;

alter table public.clientes enable row level security;
alter table public.alquiler_facturas enable row level security;

drop policy if exists clientes_lee on public.clientes;
create policy clientes_lee on public.clientes for select to authenticated using ((select public.ve_alquileres()));
drop policy if exists clientes_admin on public.clientes;
create policy clientes_admin on public.clientes for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

drop policy if exists alq_facturas_lee on public.alquiler_facturas;
create policy alq_facturas_lee on public.alquiler_facturas for select to authenticated using ((select public.ve_alquileres()));
drop policy if exists alq_facturas_admin on public.alquiler_facturas;
create policy alq_facturas_admin on public.alquiler_facturas for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

do $$
declare t text;
begin
  foreach t in array array['alquiler_contratos', 'alquiler_equipos', 'alquiler_facturacion'] loop
    execute format('drop policy if exists %I on public.%I', t || '_gerente_lee', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.ve_alquileres()))', t || '_gerente_lee', t);
  end loop;
end $$;

grant select, insert, update, delete on public.clientes, public.alquiler_facturas to authenticated;

-- ── Bucket privado para las facturas ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('alquileres', 'alquileres', false, 20971520)
on conflict (id) do nothing;

drop policy if exists alquileres_ve on storage.objects;
create policy alquileres_ve on storage.objects for select to authenticated
  using (bucket_id = 'alquileres' and public.ve_alquileres());
drop policy if exists alquileres_sube on storage.objects;
create policy alquileres_sube on storage.objects for insert to authenticated
  with check (bucket_id = 'alquileres' and public.es_admin());
drop policy if exists alquileres_borra on storage.objects;
create policy alquileres_borra on storage.objects for delete to authenticated
  using (bucket_id = 'alquileres' and public.es_admin());

-- ── Liquidación: horas de los partes de la obra del contrato ─────────────
-- Igual que antes, pero si el contrato tiene obra (305AM…), solo cuentan los
-- partes cargados en esa obra. Se agregan obra_clave y cliente_id.
create or replace view public.v_alquiler_liquidacion with (security_invoker = true) as
with periodos as (
  select ae.id as alquiler_equipo_id, ae.contrato_id, ae.equipo_id, ae.equipo_texto, ae.precio_hora_gs, ae.horas_minimas_mes,
         ae.incluye_operador, ae.incluye_combustible,
         greatest(coalesce(ae.desde, c.fecha_inicio), c.fecha_inicio) as ini,
         least(coalesce(ae.hasta, c.fecha_fin, current_date), coalesce(c.fecha_fin, current_date), current_date) as fin,
         c.arrendatario, c.obra, c.estado as estado_contrato, c.obra_clave, c.cliente_id
  from alquiler_equipos ae
  join alquiler_contratos c on c.id = ae.contrato_id
  where coalesce(ae.desde, c.fecha_inicio) is not null
), meses as (
  select p.*, m.m::date as mes,
         greatest(p.ini, m.m::date) as desde_mes,
         least(p.fin, (m.m + interval '1 mon -1 days')::date) as hasta_mes,
         extract(day from m.m + interval '1 mon -1 days')::int as dias_mes
  from periodos p
  cross join lateral generate_series(date_trunc('month', p.ini::timestamptz), date_trunc('month', p.fin::timestamptz), interval '1 mon') m(m)
  where p.fin >= p.ini
), horas as (
  select m.alquiler_equipo_id, m.mes,
         coalesce(sum(coalesce(pt.horas_horometro, pt.horas_horometro_reportada)), 0) as horas_trabajadas,
         count(pt.id) as partes
  from meses m
  left join partes pt on pt.equipo_id = m.equipo_id and pt.fecha between m.desde_mes and m.hasta_mes
                     and (m.obra_clave is null or pt.obra_clave = m.obra_clave)
  group by m.alquiler_equipo_id, m.mes
)
select m.contrato_id, m.arrendatario, m.obra, m.estado_contrato, m.alquiler_equipo_id, m.equipo_id, m.equipo_texto, m.mes,
       m.desde_mes, m.hasta_mes, (m.hasta_mes - m.desde_mes) + 1 as dias_alquilado, h.partes, h.horas_trabajadas,
       round(coalesce(m.horas_minimas_mes, 0) * ((m.hasta_mes - m.desde_mes) + 1)::numeric / m.dias_mes::numeric, 1) as horas_minimas,
       greatest(h.horas_trabajadas, round(coalesce(m.horas_minimas_mes, 0) * ((m.hasta_mes - m.desde_mes) + 1)::numeric / m.dias_mes::numeric, 1)) as horas_facturables,
       m.precio_hora_gs,
       round(greatest(h.horas_trabajadas, round(coalesce(m.horas_minimas_mes, 0) * ((m.hasta_mes - m.desde_mes) + 1)::numeric / m.dias_mes::numeric, 1))
             * coalesce(m.precio_hora_gs, 0)) as monto_gs,
       m.incluye_operador, m.incluye_combustible, f.estado as estado_facturacion, f.nro_factura,
       m.obra_clave, m.cliente_id
from meses m
join horas h on h.alquiler_equipo_id = m.alquiler_equipo_id and h.mes = m.mes
left join alquiler_facturacion f on f.contrato_id = m.contrato_id and f.mes = m.mes;

grant select on public.v_alquiler_liquidacion to authenticated;

select (select count(*) from public.clientes) as clientes,
       (select count(*) from public.alquiler_contratos where cliente_id is not null) as contratos_con_cliente,
       (select count(*) from public.alquiler_contratos where obra_clave is not null) as contratos_con_obra;

-- ── REVERTIR ─────────────────────────────────────────────────────────────
-- (la vista anterior está en U01b/U01c; volver a correr ese bloque)
-- drop table if exists public.alquiler_facturas;
-- alter table public.alquiler_contratos drop column if exists cliente_id, drop column if exists obra_clave;
-- drop table if exists public.clientes;
