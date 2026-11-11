-- ══════════════════════════════════════════════════════════════════
-- 108 — Gasoil de los partes en alquileres sin despacho (v20261111h)
--
-- En algunos alquileres el combustible lo carga el cliente (un tercero) y el
-- único registro es lo que el operador anota en el parte diario. Regla
-- (decidida con José, 11/11/2026):
--
--   cuenta el gasoil del PARTE cuando
--     · la obra del parte es un alquiler (centro de costo 305AM…),
--     · el parte declara gasoil en litros,
--     · y ese equipo NO tiene ningún despacho de combustible en todo ese
--       MES calendario (en ninguna obra).
--
--   Si el equipo tuvo aunque sea un despacho en el mes, ese mes se usan solo
--   los despachos (no se cuenta dos veces). Los litros salen con la fecha de
--   cada parte, para verlos día por día.
--
--   Las obras propias quedan afuera: ahí un parte con gasoil y sin despacho
--   es una carga que falta registrar, no un tercero.
--
-- 1. combustible_partes_alquiler(desde, hasta): esos litros por día (del parte), equipo y obra.
-- 2. combustible_consumo_obra (SQL 107) se rehace con la columna litros_parte
--    y con las horas de los equipos que solo tienen gasoil de parte (antes
--    entraban solo los que tenían algún despacho).
--
-- Se corre una vez en el SQL Editor, después del 107. Si ya corriste una
-- versión anterior de este 108 (la que miraba el mismo día), corré este de
-- nuevo: reemplaza las dos funciones.
-- ══════════════════════════════════════════════════════════════════

create or replace function public.combustible_partes_alquiler(p_desde date, p_hasta date)
returns table (fecha date, equipo_id text, obra_clave text, litros numeric, partes integer)
language sql stable
set search_path to 'public'
as $$
  select p.fecha, p.equipo_id, p.obra_clave,
         sum(nullif((regexp_match(l.linea, 'cantidad suministrada:\s*([0-9.]*)'))[1], '')::numeric) as litros,
         count(distinct p.id)::integer as partes
    from partes p
   cross join lateral unnest(string_to_array(coalesce(p.combustible, ''), E'\n')) as l(linea)
   where p.fecha between p_desde and p_hasta
     and p.obra_clave like '305AM%'
     and p.equipo_id is not null
     and trim(l.linea) <> ''
     and lower(trim((regexp_match(l.linea, 'Tipo de Insumo:\s*([^,]*)'))[1])) = 'gasoil'
     and lower(trim((regexp_match(l.linea, 'medida:\s*([^,]*)'))[1])) = 'litros'
     and not exists (select 1 from combustible_movimientos c
                      where c.actividad = 'Despacho de combustible' and c.equipo_id = p.equipo_id
                        and c.fecha >= date_trunc('month', p.fecha::timestamptz)::date
                        and c.fecha < (date_trunc('month', p.fecha::timestamptz) + interval '1 month')::date)
   group by 1, 2, 3
  having sum(nullif((regexp_match(l.linea, 'cantidad suministrada:\s*([0-9.]*)'))[1], '')::numeric) > 0
$$;

grant execute on function public.combustible_partes_alquiler(date, date) to authenticated;

-- La función del 107 cambia sus columnas: hay que borrarla y crearla de nuevo.
drop function if exists public.combustible_consumo_obra(date, date);

create function public.combustible_consumo_obra(p_desde date, p_hasta date)
returns table (
  equipo_id text, receptor text, descripcion text, tipo text, mes date, obra_clave text,
  litros numeric, despachos integer, litros_parte numeric, horas numeric, km numeric,
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
), pa as (
  select a.equipo_id, date_trunc('month', a.fecha::timestamptz)::date as mes, a.obra_clave, sum(a.litros) as litros_parte
    from public.combustible_partes_alquiler(p_desde, p_hasta) a
   group by 1, 2, 3
), eqs as (
  select equipo_id from l where equipo_id is not null
  union select equipo_id from pa
), h as (
  select p.equipo_id, date_trunc('month', p.fecha::timestamptz)::date as mes,
         coalesce(nullif(trim(p.obra_clave), ''), '') as obra_clave,
         sum(coalesce(p.horas_horometro, p.horas_horometro_reportada)) as horas,
         sum(p.km_recorridos) as km
    from partes p
   where p.fecha between p_desde and p_hasta
     and p.equipo_id in (select equipo_id from eqs)
   group by 1, 2, 3
), j as (
  select coalesce(l.equipo_id, pa.equipo_id, h.equipo_id) as equipo_id, l.receptor,
         coalesce(l.mes, pa.mes, h.mes) as mes,
         coalesce(l.obra_clave, pa.obra_clave, h.obra_clave) as obra_clave,
         l.litros, l.despachos, pa.litros_parte, h.horas, h.km
    from l
    full join pa on pa.equipo_id = l.equipo_id and pa.mes = l.mes and pa.obra_clave = l.obra_clave
    full join h on h.equipo_id = coalesce(l.equipo_id, pa.equipo_id) and h.mes = coalesce(l.mes, pa.mes)
                and h.obra_clave = coalesce(l.obra_clave, pa.obra_clave)
)
select j.equipo_id, j.receptor, e.descripcion, e.tipo, j.mes, nullif(j.obra_clave, ''),
       coalesce(j.litros, 0), coalesce(j.despachos, 0), coalesce(j.litros_parte, 0), j.horas, j.km,
       coalesce(e.consumo_promedio_lh, e.consumo_nominal), e.consumo_meta_lh, e.consumo_max_lh
  from j
  left join equipos e on e.id = j.equipo_id
$$;

grant execute on function public.combustible_consumo_obra(date, date) to authenticated;

-- Prueba (últimos 6 meses):
-- select sum(litros) from public.combustible_partes_alquiler(current_date - 183, current_date);
-- select sum(litros), sum(litros_parte), sum(horas) from public.combustible_consumo_obra(current_date - 183, current_date);
