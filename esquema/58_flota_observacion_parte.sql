-- =========================================================================
-- 58 · Flota: sin "Situación actual" + observaciones del último parte
-- Tecsul S.A.E. · v20261026e · Requiere el SQL 57.
--
-- La ficha del equipo (Flota › Estado) queda con tres renglones:
--   1. observacion           → manual (taller / administración)
--   2. observacion_auto      → último aviso automático: parte con falla / OT
--                              (solo lectura, SQL 57)
--   3. observacion_parte     → "Observaciones generales" del último parte
--                              del equipo que las tenga (solo lectura, NUEVO)
--
-- Qué hace:
--   1) "Situación actual" deja de usarse: su texto se AGREGA al final de la
--      observación manual (separado por " · "), así no se pierde nada. La
--      columna situacion_actual queda en la base tal cual (v_flota y Power BI
--      la siguen viendo), pero la app ya no la muestra ni la edita.
--   2) Columnas nuevas observacion_parte / _en / _fecha y un disparador en
--      partes: cada parte que se carga (o se corrige) con observaciones
--      generales escribe "Parte DD/MM · OPERADOR — texto", siempre que no
--      haya ya uno de fecha posterior. No toca estado, disponibilidad ni la
--      observación manual. Partes de más de 30 días atrás no cuentan
--      (carga de histórico).
--   3) Carga inicial: el último parte con observaciones de los últimos 30
--      días de cada equipo.
--
-- Se puede volver a correr sin duplicar. Para volver atrás: REVERTIR al final.
-- =========================================================================

-- 1) Situación actual → al final de la observación manual
--    (solo si ese texto todavía no está en la observación: no duplica)
update public.equipo_estado
   set observacion = concat_ws(' · ', nullif(trim(observacion), ''), trim(situacion_actual))
 where nullif(trim(situacion_actual), '') is not null
   and position(trim(situacion_actual) in coalesce(observacion, '')) = 0;

comment on column public.equipo_estado.situacion_actual is
  'En desuso desde el SQL 58: su texto se agregó a observacion. La app ya no la muestra.';

-- 2) Observaciones del último parte
alter table public.equipo_estado
  add column if not exists observacion_parte       text,
  add column if not exists observacion_parte_en    timestamptz,
  add column if not exists observacion_parte_fecha date;

comment on column public.equipo_estado.observacion_parte is
  'Observaciones generales del último parte del equipo que las tiene (automático, SQL 58).';

create or replace function public.fn_parte_observacion_flota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  txt text := nullif(trim(coalesce(new.observaciones, '')), '');
  op  text;
begin
  if txt is null or new.equipo_id is null or new.fecha < current_date - 30 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.observaciones is not distinct from old.observaciones then
    return new;
  end if;
  select nombre into op from operadores where cedula = new.operador_cedula;

  perform set_config('flota.origen', 'parte', true);
  perform set_config('flota.parte_id', new.id::text, true);
  update equipo_estado
     set observacion_parte       = left(concat_ws(' — ',
                                     'Parte ' || to_char(new.fecha, 'DD/MM') || coalesce(' · ' || op, ''),
                                     txt), 1000),
         observacion_parte_en    = now(),
         observacion_parte_fecha = new.fecha
   where equipo_id = new.equipo_id
     and (observacion_parte_fecha is null or observacion_parte_fecha <= new.fecha);
  perform set_config('flota.origen', '', true);
  perform set_config('flota.parte_id', '', true);
  return new;
end;
$$;

drop trigger if exists trg_parte_observacion_flota on public.partes;
create trigger trg_parte_observacion_flota
  after insert or update of observaciones on public.partes
  for each row execute function public.fn_parte_observacion_flota();

-- 3) Carga inicial: último parte con observaciones (últimos 30 días)
with ult as (
  select distinct on (p.equipo_id)
         p.equipo_id, p.fecha, p.creado_en,
         left(concat_ws(' — ', 'Parte ' || to_char(p.fecha, 'DD/MM') || coalesce(' · ' || o.nombre, ''),
                        trim(p.observaciones)), 1000) as texto
    from public.partes p
    left join public.operadores o on o.cedula = p.operador_cedula
   where nullif(trim(coalesce(p.observaciones, '')), '') is not null
     and p.fecha >= current_date - 30
   order by p.equipo_id, p.fecha desc, p.creado_en desc
)
update public.equipo_estado s
   set observacion_parte       = u.texto,
       observacion_parte_en    = u.creado_en,
       observacion_parte_fecha = u.fecha
  from ult u
 where s.equipo_id = u.equipo_id
   and (s.observacion_parte_fecha is null or s.observacion_parte_fecha <= u.fecha);

-- 4) Control
select count(*) filter (where nullif(trim(situacion_actual), '') is not null) as tenian_situacion_actual,
       count(*) filter (where observacion is not null)       as con_observacion_manual,
       count(*) filter (where observacion_auto is not null)  as con_aviso_parte_ot,
       count(*) filter (where observacion_parte is not null) as con_observacion_de_parte
  from public.equipo_estado;

-- =========================================================================
-- REVERTIR (ejecutar solo si hay que volver atrás)
-- -------------------------------------------------------------------------
-- drop trigger if exists trg_parte_observacion_flota on public.partes;
-- drop function if exists public.fn_parte_observacion_flota();
-- alter table public.equipo_estado drop column if exists observacion_parte,
--   drop column if exists observacion_parte_en, drop column if exists observacion_parte_fecha;
-- La situación actual sigue intacta en su columna: para sacarla de la
-- observación manual, ver equipo_estado_historial (campo "observacion").
-- =========================================================================
