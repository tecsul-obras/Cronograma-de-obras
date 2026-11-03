-- =========================================================================
-- 82_cert_maq_consolidado.sql · v20261103b (equipos-v87) — correr DESPUÉS del 81
-- Tecsul S.A.E.
--
-- El certificado de varias obras pasa a ser un CONSOLIDADO INTERNO, sin obra
-- principal (todas las obras por igual):
--  · obra_clave queda vacía (null) en los consolidados; sus obras van en
--    cert_maq.obras. Los certificados de una obra siguen igual.
--  · serie: nombre del consolidado («Obras propias», «Alquileres» o el que se
--    ponga). Numeración propia por serie (no gasta números de ninguna obra).
--  · El «anterior» de un consolidado sale del consolidado anterior de la
--    misma serie; el de un certificado individual, solo de los individuales
--    de esa obra (las dos cuentas no se mezclan).
--  · Alquileres no cuenta los consolidados (al cliente se le presentan los
--    individuales): eso lo hace la app.
--  · v_cert_maq_items: se agrega la columna serie al final (null = individual).
--
-- Se puede volver a correr. Hoy no hay ningún certificado de varias obras.
-- =========================================================================

alter table public.cert_maq add column if not exists serie text;

-- La obra principal deja de existir en los consolidados
alter table public.cert_maq drop constraint if exists cert_maq_obras_principal;
alter table public.cert_maq alter column obra_clave drop not null;

-- O es de una obra, o es un consolidado con serie y al menos una obra
alter table public.cert_maq drop constraint if exists cert_maq_individual_o_consolidado;
alter table public.cert_maq add constraint cert_maq_individual_o_consolidado
  check ((obra_clave is not null and cardinality(obras) = 0)
      or (obra_clave is null and nullif(trim(serie), '') is not null and cardinality(obras) >= 1));

-- Número único por serie en los consolidados (los individuales siguen con cert_maq_numero_unico por obra)
create unique index if not exists cert_maq_numero_serie_unico on public.cert_maq (lower(trim(serie)), numero) where obra_clave is null;

-- Una fila por línea (Power BI / consultas)
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
       c.serie
from public.cert_maq c
cross join lateral jsonb_array_elements(c.items) with ordinality as i(x, ord)
left join public.obras o on o.clave = coalesce(nullif(i.x->>'obra_clave', ''), c.obra_clave)
where c.estado <> 'anulado';

grant select on public.v_cert_maq_items to authenticated;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cert_maq' and column_name = 'serie') as columna_serie,  -- 1
       (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'cert_maq' and column_name = 'obra_clave') as obra_clave_vacia_ok,  -- YES
       (select count(*) from public.cert_maq) as certificados,
       (select count(*) from public.cert_maq where obra_clave is null) as consolidados;   -- 0 al correrlo

-- ── REVERTIR (solo si no hay consolidados) ───────────────────────────────
-- drop index if exists public.cert_maq_numero_serie_unico;
-- alter table public.cert_maq drop constraint if exists cert_maq_individual_o_consolidado;
-- alter table public.cert_maq alter column obra_clave set not null;
-- (la vista: drop view + la del 81)
-- alter table public.cert_maq drop column if exists serie;
