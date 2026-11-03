-- =========================================================================
-- 81_cert_maq_varias_obras.sql · v20261103a (equipos-v86) — correr DESPUÉS del 80
-- Tecsul S.A.E.
--
-- Certificados de máquinas con VARIAS OBRAS en un mismo certificado
-- (un cliente, un total a cobrar, las líneas agrupadas por obra con su
-- subtotal). Se puede volver a correr sin problema.
--
--  · cert_maq.obras: todas las obras del certificado, en orden (la primera es
--    la principal = obra_clave, que sigue numerando). Vacío = una sola obra
--    (todos los certificados que ya existen quedan así, sin cambios).
--  · cert_maq.subtotales: { "<obra>": {cert, desc, cobrar} } que guarda la
--    app. Los descuentos manuales van a la obra principal; la provisión de
--    combustible, a la obra de cada línea. Alquileres usa el «cobrar» de cada
--    centro de costo.
--  · Cada línea (items) lleva su "obra_clave".
--  · v_cert_maq_items (Power BI): obra_clave / obra_nombre pasan a ser los de
--    la LÍNEA (antes, siempre la principal); se agrega cert_obra_clave al final
--    con la obra principal. En los certificados de una obra no cambia nada.
--
-- Permisos: los mismos de cert_maq (lee admin_central y gerente; escriben
-- quienes edita_certificados(), SQL 76).
-- Para volver atrás: bloque REVERTIR al final.
-- =========================================================================

alter table public.cert_maq add column if not exists obras text[] not null default '{}';
alter table public.cert_maq add column if not exists subtotales jsonb not null default '{}'::jsonb;

-- Buscar los certificados que incluyen una obra (para el "anterior" y el filtro de la lista)
create index if not exists cert_maq_obras on public.cert_maq using gin (obras);

-- La principal siempre va primera (o la lista queda vacía si es de una sola obra)
alter table public.cert_maq drop constraint if exists cert_maq_obras_principal;
alter table public.cert_maq add constraint cert_maq_obras_principal
  check (cardinality(obras) = 0 or obras[1] = obra_clave);

-- Una fila por línea (Power BI / consultas): la obra es la de la línea
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
       c.obra_clave as cert_obra_clave
from public.cert_maq c
cross join lateral jsonb_array_elements(c.items) with ordinality as i(x, ord)
left join public.obras o on o.clave = coalesce(nullif(i.x->>'obra_clave', ''), c.obra_clave)
where c.estado <> 'anulado';

grant select on public.v_cert_maq_items to authenticated;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cert_maq'
          and column_name in ('obras', 'subtotales')) as columnas_nuevas,      -- 2
       (select count(*) from public.cert_maq) as certificados,
       (select count(*) from public.cert_maq where cardinality(obras) > 1) as de_varias_obras,   -- 0 al correrlo
       (select count(*) from public.v_cert_maq_items) as lineas_en_vista;

-- ── REVERTIR ─────────────────────────────────────────────────────────────
-- (antes, pasar a una sola obra o borrar los certificados de varias obras)
-- create or replace view public.v_cert_maq_items ... (la del 45, sin cert_obra_clave: hay que hacer drop view primero)
-- alter table public.cert_maq drop constraint if exists cert_maq_obras_principal;
-- drop index if exists public.cert_maq_obras;
-- alter table public.cert_maq drop column if exists subtotales;
-- alter table public.cert_maq drop column if exists obras;
