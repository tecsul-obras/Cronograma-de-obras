-- =========================================================================
-- 47_taller_estados_jotform.sql · v20261016g  (Equipos: reporte de taller)
-- Tecsul S.A.E.
--
-- El reporte de taller de la app ahora usa los mismos estados de máquina
-- que el formulario de JotForm "Reportes - Taller". Esta función traduce
-- esos estados al estado de la flota (Operativo / Fallando / Inoperativo).
-- Lo que devuelve null no cambia el estado de la flota (y en un diagnóstico
-- de taller o por avería la OT deja la máquina Inoperativa, como antes).
--
--   Inspección final:  Funcional → Operativo · Funcional - Fallando y
--                      Funcional - Pruebas en Campo → Fallando · Otros → (nada)
--   Diagnóstico:       Espera de Repuestos y Pruebas de funcionamiento →
--                      Fallando · Reparación → Inoperativo · el resto → (nada)
--   Registro:          igual que antes (Reparado → Operativo, Esperando… y
--                      Fallas menores → Fallando, En Reparación → Inoperativo)
--
-- Se puede volver a correr. Para volver atrás: REVERTIR al final.
-- =========================================================================
create or replace function public.ot_estado_flota(p_estado_maquina text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_estado_maquina is null then null
    when lower(p_estado_maquina) like 'funcional - fallando%'   then 'Fallando'
    when lower(p_estado_maquina) like 'funcional - pruebas%'    then 'Fallando'
    when lower(p_estado_maquina) =    'funcional'               then 'Operativo'
    when lower(p_estado_maquina) like '%fallas menores%'        then 'Fallando'
    when lower(p_estado_maquina) like '%esperando%'             then 'Fallando'
    when lower(p_estado_maquina) like 'espera de%'              then 'Fallando'
    when lower(p_estado_maquina) like 'pruebas de funcionamiento%' then 'Fallando'
    when lower(p_estado_maquina) like 'reparado%'               then 'Operativo'
    when lower(p_estado_maquina) like '%repar%'                 then 'Inoperativo'
    else null end
$$;

select e, public.ot_estado_flota(e) as flota
from unnest(array['Funcional', 'Funcional - Fallando', 'Funcional - Pruebas en Campo', 'Otros',
                  'Diagnóstico', 'Espera de Repuestos', 'Pruebas de funcionamiento', 'Reparación',
                  'En Reparación', 'Esperando repuestos', 'Reparado', 'Reparado- Fallas menores']) e;

-- ── REVERTIR (la versión anterior) ───────────────────────────────────────
-- create or replace function public.ot_estado_flota(p_estado_maquina text)
-- returns text language sql immutable set search_path = public as $$
--   select case
--     when p_estado_maquina is null then null
--     when lower(p_estado_maquina) like '%fallas menores%'  then 'Fallando'
--     when lower(p_estado_maquina) like '%esperando%'       then 'Fallando'
--     when lower(p_estado_maquina) like 'reparado%'         then 'Operativo'
--     when lower(p_estado_maquina) like '%repar%'           then 'Inoperativo'
--     else null end
-- $$;
