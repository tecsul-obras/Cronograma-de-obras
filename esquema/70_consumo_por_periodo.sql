/* =========================================================================
 * 70_consumo_por_periodo.sql · equipos-v77 (29/10/2026)
 *
 * Control de combustible › Consumo por equipo daba «canceling statement due
 * to statement timeout». La vista v_combustible_consumo suma TODOS los partes
 * (46 mil, desde 2025) y recién después filtra los meses pedidos: ~7,5 s, y
 * con los permisos (RLS) de la app pasa el límite.
 *
 * combustible_consumo(desde, hasta): la misma cuenta y las mismas columnas,
 * pero filtra las fechas ANTES de agrupar (meses completos de desde a hasta).
 * Con octubre: 9 ms. Igual que se hizo con la conciliación (SQL 39).
 * La vista queda como estaba (Power BI la sigue usando).
 *
 * Solo crea una función. Se puede correr más de una vez.
 * ========================================================================= */
create or replace function public.combustible_consumo(p_desde date, p_hasta date)
returns table (equipo_id text, descripcion text, tipo text, mes date, litros numeric, horas numeric, km numeric,
  litros_hora numeric, litros_100km numeric, referencia_lh numeric, desvio_pct numeric, meta_lh numeric, max_lh numeric)
language sql stable set search_path = public as $$
with r as (select date_trunc('month', p_desde)::date as desde,
                  (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date as hasta),
l as (
  select c.equipo_id, date_trunc('month', c.fecha::timestamptz)::date as mes, sum(c.litros) as litros
    from combustible_movimientos c, r
   where c.actividad = 'Despacho de combustible' and c.equipo_id is not null and c.insumo = 'gasoil'
     and c.fecha between r.desde and r.hasta
   group by 1, 2
), h as (
  select p.equipo_id, date_trunc('month', p.fecha::timestamptz)::date as mes,
         sum(coalesce(p.horas_horometro, p.horas_horometro_reportada)) as horas,
         sum(p.km_recorridos) as km
    from partes p, r
   where p.fecha between r.desde and r.hasta
   group by 1, 2
)
select l.equipo_id, e.descripcion, e.tipo, l.mes, l.litros, h.horas, h.km,
       case when h.horas > 0 then round(l.litros / h.horas, 2) end,
       case when h.km > 0 then round(100 * l.litros / h.km, 2) end,
       coalesce(e.consumo_promedio_lh, e.consumo_nominal),
       case when h.horas > 0 and coalesce(e.consumo_promedio_lh, e.consumo_nominal) > 0
            then round(100 * ((l.litros / h.horas) - coalesce(e.consumo_promedio_lh, e.consumo_nominal))
                       / coalesce(e.consumo_promedio_lh, e.consumo_nominal)) end,
       e.consumo_meta_lh,
       e.consumo_max_lh
  from l
  join equipos e on e.id = l.equipo_id
  left join h on h.equipo_id = l.equipo_id and h.mes = l.mes
$$;
grant execute on function public.combustible_consumo(date, date) to authenticated;

-- Comprobación: cuántas filas da el mes actual (tiene que responder al instante)
select count(*) as filas_mes_actual from public.combustible_consumo(current_date, current_date);
