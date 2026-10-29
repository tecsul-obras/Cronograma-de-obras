-- =========================================================================
-- 73_mantenimiento_ciclo_horometro.sql · equipos-v79 (29/10/2026)
--
-- Confirma y asegura dos reglas de los services por horas:
--
--   1) Se registra el nivel real: 250, 500, 750, 1.000, 1.250, 1.500, 1.750
--      y 2.000 (500 y 750 llevan el mismo kit que el de 250, pero quedan
--      anotados como 500 y 750, así se sabe cuándo toca el de 1.000 y el de
--      2.000). Eso ya lo hacían la app y el reporte de taller; acá solo se
--      pasa al ciclo 250 → 2.000 los 21 planes viejos de Monday que no tenían
--      ni horas ni ciclo («Mantenimiento preventivo» cada 60 días), y que por
--      eso no avisaban nunca el próximo service por horas.
--
--   2) Las 250 h corren desde el horómetro del ÚLTIMO SERVICE HECHO, no desde
--      múltiplos de 250: si se hizo a las 265 h, el próximo es a las 515 h.
--      La vista ya lo calculaba así (último horómetro + 250). Lo que se corrige:
--        · solo un mantenimiento PREVENTIVO mueve el contador del plan (antes
--          un correctivo con plan elegido en la ficha lo reiniciaba);
--        · un horómetro vacío o en 0 no pisa el último horómetro.
--
-- No borra datos. Se puede correr más de una vez.
-- Después, si se quiere, correr 73b_control_mantenimiento_datos.sql (los
-- últimos services de la planilla CONTROL DE MANTENIMIENTO GENERAL).
-- =========================================================================

-- ── 1) Solo un preventivo mueve el contador del plan ─────────────────────
create or replace function public.fn_mantenimiento_registrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is not null and new.tipo = 'Preventivo' then
    update planes_mantenimiento
       set ultimo_fecha     = new.fecha,
           ultimo_horometro = coalesce(nullif(new.horometro, 0), ultimo_horometro),
           ultimo_km        = coalesce(nullif(new.km, 0), ultimo_km),
           ultimo_nivel     = coalesce(nivel_service(new.nivel), ultimo_nivel)
     where id = new.plan_id
       and (ultimo_fecha is null or ultimo_fecha <= new.fecha);
  end if;
  if new.estado_despues is not null then
    update equipo_estado set estado = new.estado_despues
     where equipo_id = new.equipo_id and estado <> new.estado_despues;
  end if;
  return new;
end $$;

-- ── 2) Planes sin horas ni ciclo → service por horas, ciclo 250 → 2.000 ──
-- Solo los planes activos sin ninguna frecuencia por horas ni por km (los
-- «Mantenimiento preventivo» que vinieron de Monday con 60 días). Se
-- conserva el último service que tenían (fecha y horómetro).
update public.planes_mantenimiento
   set nombre     = 'Service por horas',
       cada_horas = 250,
       cada_dias  = null,
       ciclo      = array['250','500','750','1.000','1.250','1.500','1.750','2.000'],
       aviso_horas = coalesce(aviso_horas, 50)
 where activo
   and cada_horas is null and cada_km is null
   and (ciclo is null or cardinality(ciclo) = 0);

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from public.planes_mantenimiento
    where activo and cada_horas is null and cada_km is null)                     as planes_sin_frecuencia_0,
  (select count(*) from public.planes_mantenimiento
    where activo and cada_horas = 250 and cardinality(ciclo) = 8)               as planes_ciclo_250_2000,
  (select position('''Preventivo''' in prosrc) > 0 from pg_proc
    where proname = 'fn_mantenimiento_registrado')                              as solo_preventivo_true;

-- =========================================================================
-- VOLVER ATRÁS (solo la regla del contador; los planes convertidos quedan)
-- -------------------------------------------------------------------------
-- create or replace function public.fn_mantenimiento_registrado() returns trigger
-- language plpgsql security definer set search_path = public as $$
-- begin
--   if new.plan_id is not null then
--     update planes_mantenimiento set ultimo_fecha = new.fecha,
--       ultimo_horometro = coalesce(new.horometro, ultimo_horometro), ultimo_km = coalesce(new.km, ultimo_km),
--       ultimo_nivel = coalesce(nivel_service(new.nivel), ultimo_nivel)
--      where id = new.plan_id and (ultimo_fecha is null or ultimo_fecha <= new.fecha);
--   end if;
--   if new.estado_despues is not null then
--     update equipo_estado set estado = new.estado_despues where equipo_id = new.equipo_id and estado <> new.estado_despues;
--   end if;
--   return new;
-- end $$;
-- =========================================================================
