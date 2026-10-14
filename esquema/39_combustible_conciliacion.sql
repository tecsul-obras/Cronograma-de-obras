-- =========================================================================
-- 39_combustible_conciliacion.sql · v20261014c  (Equipos › Control de combustible)
--
-- PROBLEMA: la pantalla pide v_combustible_conciliacion filtrando por fecha,
-- pero la vista arma un FULL JOIN entre despachos y partes y el filtro queda
-- sobre COALESCE(d.fecha, p.fecha): Postgres no lo puede bajar a las tablas y
-- agrupa los 45 mil partes (con el texto de combustible de cada uno) antes de
-- filtrar. En producción: ~6 s en frío.
--
-- SOLUCIÓN: la misma consulta como función con el rango de fechas, que filtra
-- cada lado ANTES de agrupar (usa el índice por fecha de partes).
-- Es equivalente: el JOIN es por (equipo_id, fecha), así que una fila combinada
-- tiene la misma fecha a los dos lados, y una fila de un solo lado tiene la
-- fecha de ese lado. Filtrar antes o después da las mismas filas.
-- SECURITY INVOKER: respeta las mismas reglas (RLS) que la vista.
-- La vista queda como estaba (la pueden usar otros, p. ej. Power BI).
-- =========================================================================

create or replace function public.combustible_conciliacion(p_desde date, p_hasta date)
returns setof public.v_combustible_conciliacion
language sql stable security invoker
set search_path to 'public'
as $$
  with d as (
    select equipo_id, fecha,
           sum(litros) as litros_despacho,
           array_agg(distinct nro_boleta) filter (where nro_boleta is not null) as boletas
      from public.combustible_movimientos
     where actividad = 'Despacho de combustible' and equipo_id is not null and insumo = 'gasoil'
       and fecha >= p_desde and fecha <= p_hasta
     group by equipo_id, fecha
  ), p as (
    select equipo_id, fecha,
           sum(cantidad) as litros_parte,
           array_agg(distinct remision) filter (where remision is not null and remision <> '') as remisiones
      from public.v_combustible
     where lower(coalesce(insumo, 'gasoil')) like 'gasoil%' and coalesce(cantidad, 0) > 0
       and fecha >= p_desde and fecha <= p_hasta
     group by equipo_id, fecha
  )
  select coalesce(d.equipo_id, p.equipo_id) as equipo_id,
         coalesce(d.fecha, p.fecha) as fecha,
         d.litros_despacho,
         p.litros_parte,
         coalesce(d.litros_despacho, 0) - coalesce(p.litros_parte, 0) as diferencia,
         d.boletas,
         p.remisiones,
         case
           when d.equipo_id is null then 'Solo en el parte'
           when p.equipo_id is null then 'Solo en el despacho'
           when abs(d.litros_despacho - p.litros_parte) <= greatest(5, 0.02 * d.litros_despacho) then 'OK'
           else 'Diferencia de litros'
         end as resultado
    from d full join p on p.equipo_id = d.equipo_id and p.fecha = d.fecha
$$;

revoke all on function public.combustible_conciliacion(date, date) from public, anon;
grant execute on function public.combustible_conciliacion(date, date) to authenticated;

-- REVERTIR: drop function if exists public.combustible_conciliacion(date, date);
-- (la app vuelve sola a la vista si la función no existe)
