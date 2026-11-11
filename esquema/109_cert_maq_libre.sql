-- =========================================================================
-- 109_cert_maq_libre.sql · v20261111j (equipos-v108) — correr DESPUÉS del 106
-- Tecsul S.A.E.
--
-- Certificado de máquinas › formato LIBRE: certificados de combustible,
-- insumos, recursos o cualquier otro concepto, guardados en la misma tabla
-- (cert_maq) y en la misma lista que los de máquinas.
--
--  · plantilla = 'libre'. Siempre de UNA obra (obra_clave), nunca consolidado.
--  · serie = el CONCEPTO («Combustible», «Insumos»…). Obligatorio en los libres.
--  · Numeración propia por obra + concepto: Combustible N° 01, 02… aparte de
--    los de máquinas (que siguen numerando por obra como siempre). Así puede
--    haber un libre en la misma obra y el mismo período que el de máquinas.
--  · Un libre EMITIDO no bloquea partes diarios (SQL 106) ni frena la
--    sincronización de JotForm: solo los de máquinas.
--  · v_cert_maq_items y v_powerbi_cert_maq_items: columna nueva «formato» al
--    final (estandar / horas_minimas / volumen_minimo / libre) para filtrar.
--  · Alquileres: el monto del mes ya suma todos los emitidos de la obra
--    (máquinas + libres) — no hace falta nada en la base.
--
-- Se puede volver a correr. Hoy no hay ningún certificado libre.
-- Para volver atrás: bloque REVERTIR al final (solo si no hay libres).
-- =========================================================================

-- ── 1. Formato «libre» ───────────────────────────────────────────────────
alter table public.cert_maq drop constraint if exists cert_maq_plantilla_check;
alter table public.cert_maq add constraint cert_maq_plantilla_check
  check (plantilla in ('estandar', 'horas_minimas', 'volumen_minimo', 'libre'));

-- Individual (con concepto si es libre) o consolidado (nunca libre)
alter table public.cert_maq drop constraint if exists cert_maq_individual_o_consolidado;
alter table public.cert_maq add constraint cert_maq_individual_o_consolidado
  check ((obra_clave is not null and cardinality(obras) = 0
          and (plantilla <> 'libre' or nullif(trim(serie), '') is not null))
      or (obra_clave is null and nullif(trim(serie), '') is not null and cardinality(obras) >= 1
          and plantilla <> 'libre'));

-- ── 2. Numeración ────────────────────────────────────────────────────────
-- De máquinas: única por obra (como antes, pero sin contar los libres)
alter table public.cert_maq drop constraint if exists cert_maq_numero_unico;
drop index if exists public.cert_maq_numero_unico;
create unique index cert_maq_numero_unico on public.cert_maq (obra_clave, numero)
  where obra_clave is not null and plantilla <> 'libre';
-- Libres: única por obra + concepto
create unique index if not exists cert_maq_numero_libre_unico on public.cert_maq (obra_clave, lower(trim(serie)), numero)
  where plantilla = 'libre';

-- ── 3. Los libres no bloquean partes ─────────────────────────────────────
create or replace function public.parte_cert_emitido(p_obra text, p_fecha date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'numero', c.numero, 'serie', c.serie,
                            'desde', c.desde, 'hasta', c.hasta,
                            'obra', coalesce(c.obra_clave, c.serie),
                            'texto', coalesce(c.serie || ' ', '') || 'N° ' || c.numero
                                     || ' (' || to_char(c.desde, 'DD/MM/YYYY') || ' – ' || to_char(c.hasta, 'DD/MM/YYYY') || ')')
    from public.cert_maq c
   where c.estado = 'emitido' and c.plantilla <> 'libre' and p_fecha between c.desde and c.hasta
     and (c.obra_clave = p_obra or p_obra = any (coalesce(c.obras, '{}')))
   order by (c.obra_clave is null), c.desde, c.id
   limit 1
$$;

create or replace function public.partes_periodos_certificados()
returns table (obra_clave text, desde date, hasta date, cert_id bigint, numero int, serie text)
language sql stable security definer set search_path = public as $$
  select o.obra, c.desde, c.hasta, c.id, c.numero, c.serie
    from public.cert_maq c
    cross join lateral unnest(case when cardinality(coalesce(c.obras, '{}')) > 0
                                   then c.obras else array[c.obra_clave] end) o(obra)
   where c.estado = 'emitido' and c.plantilla <> 'libre' and o.obra is not null
$$;

-- Sincronización de JotForm (SQL 95/96): tampoco frena por un libre
create or replace function public.sync_jf_cert_emitido(p_obra text, p_fecha date) returns text
language sql stable set search_path = public as $$
  select 'N° ' || c.numero || ' (' || to_char(c.desde, 'DD/MM') || '–' || to_char(c.hasta, 'DD/MM') || ')'
    from cert_maq c
   where c.estado = 'emitido' and c.plantilla <> 'libre' and p_fecha between c.desde and c.hasta
     and (c.obra_clave = p_obra or p_obra = any (coalesce(c.obras, '{}')))
   order by c.desde limit 1
$$;

-- ── 4. Vistas: columna «formato» al final ────────────────────────────────
create or replace view public.v_cert_maq_items with (security_invoker = true) as
select c.id as cert_id,
       coalesce(nullif(i.x->>'obra_clave', ''), c.obra_clave) as obra_clave,
       o.nombre as obra_nombre, c.numero, c.desde, c.hasta, c.estado, c.cliente, c.ruc,
       (i.ord)::int as orden, i.x->>'codigo' as codigo, i.x->>'descripcion' as descripcion, i.x->>'unidad' as unidad,
       (i.x->>'trabajado')::numeric   as trabajado,
       (i.x->>'minimo')::numeric      as minimo,
       (i.x->>'a_certificar')::numeric as cantidad_actual,
       (i.x->>'precio')::numeric      as precio_unitario,
       (i.x->>'cant_anterior')::numeric as cantidad_anterior,
       (i.x->>'monto_anterior')::numeric as monto_anterior,
       round(coalesce((i.x->>'a_certificar')::numeric, 0) * coalesce((i.x->>'precio')::numeric, 0)) as monto_actual,
       c.obra_clave as cert_obra_clave,
       c.serie,
       c.plantilla as formato
from public.cert_maq c
cross join lateral jsonb_array_elements(c.items) with ordinality as i(x, ord)
left join public.obras o on o.clave = coalesce(nullif(i.x->>'obra_clave', ''), c.obra_clave)
where c.estado <> 'anulado';

create or replace view public.v_powerbi_cert_maq_items with (security_invoker = true) as
select ob.codigo as "ID Obra",
       i.cert_id, i.obra_clave, i.obra_nombre, i.numero, i.desde, i.hasta, i.estado, i.cliente, i.ruc,
       i.orden, i.codigo, i.descripcion, i.unidad, i.trabajado, i.minimo, i.cantidad_actual,
       i.precio_unitario, i.cantidad_anterior, i.monto_anterior, i.monto_actual,
       i.formato, i.serie
from public.v_cert_maq_items i
left join public.obras ob on ob.clave = i.obra_clave;

grant select on public.v_cert_maq_items to authenticated;

-- ── Control ──────────────────────────────────────────────────────────────
select (select pg_get_constraintdef(oid) like '%libre%' from pg_constraint where conname = 'cert_maq_plantilla_check') as formato_libre,       -- true
       (select count(*) from pg_indexes where indexname in ('cert_maq_numero_unico', 'cert_maq_numero_libre_unico')) as indices_numeracion,  -- 2
       (select count(*) from pg_proc where proname in ('parte_cert_emitido', 'partes_periodos_certificados', 'sync_jf_cert_emitido')
          and prosrc like '%libre%') as funciones_sin_libres,                                                                                -- 3
       (select count(*) from information_schema.columns where table_name = 'v_powerbi_cert_maq_items' and column_name = 'formato') as powerbi_formato, -- 1
       (select count(*) from public.cert_maq) as certificados,
       (select count(*) from public.cert_maq where plantilla = 'libre') as libres;                                                          -- 0 al correrlo

-- ── REVERTIR (solo si no hay certificados libres) ────────────────────────
-- drop index if exists public.cert_maq_numero_libre_unico;
-- drop index if exists public.cert_maq_numero_unico;
-- alter table public.cert_maq add constraint cert_maq_numero_unico unique (obra_clave, numero);
-- alter table public.cert_maq drop constraint cert_maq_plantilla_check;
-- alter table public.cert_maq add constraint cert_maq_plantilla_check check (plantilla in ('estandar', 'horas_minimas', 'volumen_minimo'));
-- (constraint cert_maq_individual_o_consolidado y funciones: las del 82 y 106; las vistas: drop + las del 82)
