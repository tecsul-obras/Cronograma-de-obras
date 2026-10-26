-- =========================================================================
-- 57 · Flota: observación solo manual + último aviso automático
-- Tecsul S.A.E. · v20261026d
--
-- Hasta ahora la columna equipo_estado.observacion la escribían dos:
--   · la persona (taller / admin) desde la ficha del equipo, y
--   · el sistema, cuando el estado del equipo EMPEORA:
--       - parte con falla de los últimos 3 días →
--         "Parte DD/MM — <fallas> — <tipo de falla> — <descripción de la falla>"
--         (solo los campos de la falla; las observaciones generales del
--          parte no se usan)
--       - OT abierta o registro de trabajos → "OT N — <nombre de la OT>"
--       - OT cerrada que cambia el estado  → "OT N cerrada — <estado de salida>"
--   y lo del sistema pisaba lo que había escrito el encargado de taller.
--
-- Ahora:
--   · observacion           → SOLO manual. El sistema ya no la toca.
--   · observacion_auto      → lo que antes escribía el sistema (último
--     observacion_auto_en     aviso del parte o de la OT, y cuándo).
--
-- Cómo: un disparador BEFORE UPDATE. Cuando el cambio viene de un parte
-- o de una OT (flota.origen = 'parte' / 'ot', que ya ponen esas funciones),
-- el texto nuevo se desvía a observacion_auto y la observación manual
-- queda como estaba. No se reescribe ninguna de las funciones existentes.
--
-- Además, las observaciones que HOY tienen texto automático (empiezan con
-- "Parte DD/MM" o "OT <número>") se pasan a observacion_auto y la manual
-- queda vacía. Queda registrado en equipo_estado_historial.
--
-- Situación actual (situacion_actual): ya era solo manual; no cambia.
--
-- No hace falta recrear v_flota: la app lee las dos columnas nuevas
-- directo de equipo_estado.
-- Correr una sola vez en el SQL Editor de Supabase. Se puede volver a
-- correr sin problema. Para volver atrás: bloque REVERTIR al final.
-- =========================================================================

-- 1) Columnas nuevas
alter table public.equipo_estado
  add column if not exists observacion_auto    text,
  add column if not exists observacion_auto_en timestamptz;

comment on column public.equipo_estado.observacion is
  'Observación manual (taller / administración). El sistema no la modifica desde el SQL 57.';
comment on column public.equipo_estado.observacion_auto is
  'Último aviso automático: parte con falla u OT (antes se escribía en observacion).';

-- 2) Desvío: lo que escribe el sistema va a observacion_auto
create or replace function public.fn_equipo_estado_obs_auto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('flota.origen', true), '') in ('parte', 'ot')
     and new.observacion is distinct from old.observacion then
    new.observacion_auto    := new.observacion;
    new.observacion_auto_en := now();
    new.observacion         := old.observacion;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_equipo_estado_obs_auto on public.equipo_estado;
create trigger trg_equipo_estado_obs_auto
  before update on public.equipo_estado
  for each row execute function public.fn_equipo_estado_obs_auto();

-- 3) Lo automático que hoy está en la observación manual pasa a su lugar
--    (solo si observacion_auto está vacía, así se puede correr de nuevo)
update public.equipo_estado
   set observacion_auto    = observacion,
       observacion_auto_en = coalesce(actualizado_en, now()),
       observacion         = null
 where observacion_auto is null
   and observacion ~ '^(Parte [0-9]{2}/[0-9]{2}|OT [0-9]+)';

-- 4) Control: cuántos quedaron de cada lado
select count(*) filter (where observacion is not null)      as con_observacion_manual,
       count(*) filter (where observacion_auto is not null) as con_aviso_automatico
  from public.equipo_estado;

-- =========================================================================
-- REVERTIR (ejecutar solo si hay que volver atrás)
-- -------------------------------------------------------------------------
-- drop trigger if exists trg_equipo_estado_obs_auto on public.equipo_estado;
-- drop function if exists public.fn_equipo_estado_obs_auto();
-- update public.equipo_estado set observacion = observacion_auto
--  where observacion is null and observacion_auto is not null;
-- alter table public.equipo_estado drop column if exists observacion_auto,
--                                  drop column if exists observacion_auto_en;
-- =========================================================================
