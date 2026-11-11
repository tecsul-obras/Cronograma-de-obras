-- ══════════════════════════════════════════════════════════════════
-- 107 — Consumo de combustible por equipo, OBRA y mes (v20261111f)
--
-- Para Control de combustible › Consumo por equipo: filtros por equipo y por
-- obra, y el detalle de cada equipo en cada obra.
--
--   litros    = despachos de gasoil al equipo con esa obra (combustible_movimientos.obra_clave)
--   horas, km = partes diarios del equipo con esa obra (partes.obra_clave)
--
-- Se cruzan por equipo + mes + obra (clave completa). Si el despacho se cargó
-- en una obra y el parte en otra, salen dos filas: una con litros sin horas y
-- otra con horas sin litros. Solo entran los equipos que tuvieron al menos un
-- despacho en el período. Los despachos a un receptor que no es un equipo de
-- la flota (chapa o texto de JotForm) salen con equipo_id vacío y el texto en
-- «receptor», para que el total cierre con Movimientos. A diferencia de combustible_consumo (SQL 70), usa
-- las fechas exactas, no meses completos.
--
-- No cambia nada de lo existente. Se corre una vez en el SQL Editor.
-- ══════════════════════════════════════════════════════════════════

create or replace function public.combustible_consumo_obra(p_desde date, p_hasta date)
returns table (
  equipo_id text, receptor text, descripcion text, tipo text, mes date, obra_clave text,
  litros numeric, despachos integer, horas numeric, km numeric,
  referencia_lh numeric, meta_lh numeric, max_lh numeric
)
language sql stable
set search_path to 'public'
as $$
with l as (
  select c.equipo_id,
         case when c.equipo_id is null then coalesce(nullif(trim(c.receptor_texto), ''), '(sin receptor)') end as receptor,
         date_trunc('month', c.fecha::timestamptz)::date as mes,
         coalesce(nullif(trim(c.obra_clave), ''), '') as obra_clave,
         sum(c.litros) as litros, count(*)::integer as despachos
    from combustible_movimientos c
   where c.actividad = 'Despacho de combustible' and c.insumo = 'gasoil'
     and c.fecha between p_desde and p_hasta
   group by 1, 2, 3, 4
), h as (
  select p.equipo_id, date_trunc('month', p.fecha::timestamptz)::date as mes,
         coalesce(nullif(trim(p.obra_clave), ''), '') as obra_clave,
         sum(coalesce(p.horas_horometro, p.horas_horometro_reportada)) as horas,
         sum(p.km_recorridos) as km
    from partes p
   where p.fecha between p_desde and p_hasta
     and p.equipo_id in (select distinct equipo_id from l where equipo_id is not null)
   group by 1, 2, 3
), j as (
  select coalesce(l.equipo_id, h.equipo_id) as equipo_id, l.receptor, coalesce(l.mes, h.mes) as mes,
         coalesce(l.obra_clave, h.obra_clave) as obra_clave,
         l.litros, l.despachos, h.horas, h.km
    from l full join h on h.equipo_id = l.equipo_id and h.mes = l.mes and h.obra_clave = l.obra_clave
)
select j.equipo_id, j.receptor, e.descripcion, e.tipo, j.mes, nullif(j.obra_clave, ''),
       coalesce(j.litros, 0), coalesce(j.despachos, 0), j.horas, j.km,
       coalesce(e.consumo_promedio_lh, e.consumo_nominal), e.consumo_meta_lh, e.consumo_max_lh
  from j
  left join equipos e on e.id = j.equipo_id
$$;

grant execute on function public.combustible_consumo_obra(date, date) to authenticated;

-- Prueba: últimos 6 meses (debe dar unos cientos de filas en 2-3 segundos)
-- select count(*), sum(litros), sum(horas) from public.combustible_consumo_obra(current_date - 183, current_date);
