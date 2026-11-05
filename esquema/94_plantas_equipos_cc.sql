-- ═══════════════════════════════════════════════════════════════════════════
-- 94 · PLANTAS — máquinas por centro de costo y tarifa 3 USD/t · 05/11/2026
--      correr DESPUÉS del 93. Se puede correr dos veces.
--
--   · La pala que trabaja en la planta no es siempre la PC-04 (puede ser otra PC o
--     una RP): normalmente carga su parte en el centro de costo de la carpeta /
--     concreto asfáltico de la obra. Ahora el costo de equipos toma, en la obra de
--     la planta, los partes de las familias PC, RP y GG cuyo ítem de obra dice
--     «carpeta», «concreto asf», «Cª Aª» o «mezcla asf» (configurable por planta),
--     más las máquinas fijas que se agreguen a mano (Equipos de la planta).
--     Camiones, terminadora y compactadores de pista NO cuentan (no son de la planta).
--   · Las tarifas del maestro ya incluyen combustible y operador: el gasoil de esas
--     máquinas no se suma aparte.
--   · Amortización de la planta: 3 USD por tonelada (PA-01 y PA-02, si no tenían tarifa).
--   · Se saca la PC-04 de las máquinas fijas de la PA-01 (queda el GG-02).
-- ═══════════════════════════════════════════════════════════════════════════

update public.plantas set tarifa_planta = 3, tarifa_moneda = 'USD', actualizado_en = now()
 where id in ('PA-01', 'PA-02') and tarifa_planta is null;

delete from public.planta_equipos where planta_id = 'PA-01' and equipo_id = 'PC-04';

-- Palabras del centro de costo y familias que cuentan (se cambian en Configuración)
update public.plantas
   set config = config || jsonb_build_object('familias_equipos', '["PC","RP","GG"]'::jsonb)
 where tipo = 'asfalto' and not (config ? 'familias_equipos');
update public.plantas
   set config = config || jsonb_build_object('cc_palabras', '["carpeta","concreto asf","cª aª","c.a.","mezcla asf"]'::jsonb)
 where tipo = 'asfalto' and not (config ? 'cc_palabras');
update public.plantas
   set config = config || jsonb_build_object('familias_equipos', '["PC","RP","GG"]'::jsonb, 'cc_palabras', '["hormig"]'::jsonb)
 where tipo = 'hormigon' and not (config ? 'cc_palabras');

drop function if exists public.planta_costo_equipos(text, date, date);
create or replace function public.planta_costo_equipos(p_planta text, p_desde date, p_hasta date)
returns table (equipo_id text, descripcion text, origen text, horas numeric, partes bigint, costo numeric, sin_tarifa bigint, horas_fuera numeric, obras text, items text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(p.config -> 'familias_equipos') x), array['PC', 'RP', 'GG']) as fam,
           coalesce((select array_agg('%' || lower(x) || '%') from jsonb_array_elements_text(p.config -> 'cc_palabras') x), array['%carpeta%', '%concreto asf%']) as pal
    from plantas p where p.id = p_planta
  ), obras_planta as (
    select split_part(pa.obra_clave, '_', 1) as cod from partes pa where pa.equipo_id = p_planta and pa.fecha between p_desde and p_hasta and pa.obra_clave is not null
    union
    select split_part(j.obra_clave, '_', 1) from planta_jornadas j where j.planta_id = p_planta and j.fecha between p_desde and p_hasta and j.obra_clave is not null
  ), fijos as (
    select x.equipo_id from planta_equipos x where x.planta_id = p_planta
  ), pt as (
    select pa.id, pa.equipo_id, pa.fecha, pa.horas_horometro,
           split_part(pa.obra_clave, '_', 1) as cod,
           substring(pa.detalle_actividad from 'Item de obra: ([^,]*)') as item,
           (split_part(pa.obra_clave, '_', 1) in (select cod from obras_planta)) as en_obra,
           (pa.equipo_id in (select equipo_id from fijos)) as fijo,
           (upper(coalesce(nullif(e.familia, ''), split_part(pa.equipo_id, '-', 1))) = any (cfg.fam)
             and lower(coalesce(substring(pa.detalle_actividad from 'Item de obra: ([^,]*)'), '')) like any (cfg.pal)) as por_cc,
           public.planta_tarifa(pa.equipo_id, split_part(pa.obra_clave, '_', 1), pa.fecha) as tarifa
    from partes pa
    join equipos e on e.id = pa.equipo_id
    cross join cfg
    where pa.fecha between p_desde and p_hasta and pa.equipo_id <> p_planta
  ), sel as (
    select pt.*, (pt.en_obra and (pt.fijo or pt.por_cc)) as cuenta from pt where pt.fijo or (pt.por_cc and pt.en_obra)
  )
  select s.equipo_id, e.descripcion,
         case when bool_or(s.fijo) then 'fija' else 'centro de costo' end,
         coalesce(sum(coalesce(s.horas_horometro, 0)) filter (where s.cuenta), 0),
         count(*) filter (where s.cuenta),
         coalesce(sum(coalesce(s.horas_horometro, 0) * coalesce(s.tarifa, 0)) filter (where s.cuenta), 0),
         count(*) filter (where s.cuenta and s.tarifa is null),
         coalesce(sum(coalesce(s.horas_horometro, 0)) filter (where not s.cuenta), 0),
         (select string_agg(cod, ', ') from obras_planta),
         string_agg(distinct s.item, ' | ') filter (where s.cuenta and not s.fijo)
  from sel s join equipos e on e.id = s.equipo_id
  where public.planta_ve_costos(p_planta)
  group by s.equipo_id, e.descripcion
  -- las fijas sin partes en el período también aparecen (con 0 h)
  union all
  select f.equipo_id, e.descripcion, 'fija', 0, 0, 0, 0, 0, (select string_agg(cod, ', ') from obras_planta), null
  from fijos f join equipos e on e.id = f.equipo_id
  where public.planta_ve_costos(p_planta) and not exists (select 1 from sel s where s.equipo_id = f.equipo_id)
  order by 1
$$;
revoke all on function public.planta_costo_equipos(text, date, date) from public;
grant execute on function public.planta_costo_equipos(text, date, date) to authenticated;

-- ── Verificación ─────────────────────────────────────────────────────────────
select id, tarifa_planta, tarifa_moneda, config -> 'familias_equipos' as familias, config -> 'cc_palabras' as centro_de_costo,
       (select string_agg(equipo_id, ', ') from public.planta_equipos pe where pe.planta_id = p.id) as fijas
from public.plantas p order by id;
