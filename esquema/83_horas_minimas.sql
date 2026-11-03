-- =========================================================================
-- 83_horas_minimas.sql · v20261103c (equipos-v88) — correr DESPUÉS del 82
-- Tecsul S.A.E.
--
-- Carga las HORAS MÍNIMAS POR MES de cada máquina (Excel «Horas Mínimas»,
-- 143 equipos con valor; los que vienen vacíos —VL, PA, GG…— no se tocan).
--
--  1. Ficha del equipo (equipos.horas_minimas_mes): queda con el valor del
--     Excel. Es la fuente: un mínimo por máquina.
--  2. Maestro de tarifas (tarifas_equipos.minimo_hr): todas las filas de cada
--     equipo (una por obra / unidad de negocio) quedan con ese mínimo. Pisa los
--     valores que venían de Unysoft (casi todos 0; algunos sin sentido: 1, 2,
--     55,6 y 20.000).
--  3. Importar tarifas de Unysoft ya no borra el mínimo: si el equipo tiene
--     mínimo en su ficha, se usa ese.
--  4. Si se cambia el mínimo en la ficha del equipo (Flota), se actualizan
--     solas todas sus filas del maestro de tarifas.
--
-- Los contratos de alquiler (Alquileres › condiciones por equipo) tienen su
-- propio mínimo y siguen mandando en el certificado de esa obra.
-- Se puede volver a correr.
-- =========================================================================

drop table if exists _hmin;
create temp table _hmin (equipo text primary key, horas numeric not null);
insert into _hmin (equipo, horas)
select split_part(x.id, ' ', 1), x.h      -- «PT-01 con TC-02» → PT-01
from (values
  ('AM-01', 100), ('AM-02', 100), ('AM-03', 100), ('AM-04', 100), ('AM-05', 100), ('BUS-01', 90),
  ('BUS-02', 90), ('CC-01', 80), ('CC-02', 80), ('CM-01', 100), ('CM-02', 100), ('CM-03', 100),
  ('CM-04', 100), ('CMX-01', 120), ('CMX-02', 120), ('CMX-03', 120), ('CMX-04', 120), ('CN-01', 100),
  ('CN-02', 100), ('CN-04', 100), ('CR-02', 110), ('CR-03', 110), ('CR-04', 110), ('CR-05', 110),
  ('CR-06', 110), ('CR-07', 110), ('CR-08', 110), ('CR-09', 110), ('CR-10', 110), ('CRA-01', 100),
  ('CRA-02', 100), ('CV-01', 110), ('CV-02', 110), ('CV-03', 110), ('CV-04', 110), ('CV-05', 110),
  ('CV-06', 110), ('CV-07', 110), ('CV-08', 110), ('CV-09', 110), ('CV-10', 110), ('CV-11', 110),
  ('CV-12', 110), ('CV-13', 110), ('CV-14', 110), ('CV-15', 110), ('CV-16', 110), ('CX-01', 120),
  ('CX-02', 120), ('CX-03', 120), ('CX-04', 120), ('EA-01', 120), ('EA-02', 120), ('EX-03', 100),
  ('EX-04', 100), ('EX-05', 100), ('EX-06', 100), ('EX-07', 100), ('EX-08', 100), ('EX-09', 100),
  ('EX-10', 100), ('EX-11', 100), ('EX-12', 100), ('EX-13', 100), ('EX-14', 100), ('EX-15', 100),
  ('EX-16', 100), ('EX-17', 100), ('EX-18', 100), ('EX-19', 100), ('MC-01', 100), ('MC-02', 100),
  ('MC-03', 100), ('MN-01', 100), ('MN-02', 100), ('MN-03', 100), ('MN-04', 100), ('MN-05', 100),
  ('MN-06', 100), ('MN-07', 100), ('MN-08', 100), ('MT-01', 120), ('PC-01', 110), ('PC-02', 110),
  ('PC-03', 110), ('PC-04', 110), ('PC-05', 110), ('PC-06', 110), ('PF-01', 100), ('PT-01 con TC-02', 90),
  ('PT-02 con TC-03', 90), ('PT-03 con TC-04', 90), ('RP-01', 100), ('RP-02', 100), ('RP-03', 100), ('ES-01', 60),
  ('SV-01 con TC-07', 90), ('SV-02 con TC-05', 90), ('SV-03 con TC-06', 90), ('TA-01', 100), ('TA-02', 100), ('TA-03', 100),
  ('TA-04', 100), ('TA-05', 100), ('TA-06', 100), ('TA-07', 100), ('TA-08', 100), ('TA-09', 100),
  ('TA-10', 100), ('TA-11', 100), ('TC-02', 90), ('TC-03', 90), ('TC-04', 90), ('TC-05', 90),
  ('TC-06', 90), ('TC-07', 90), ('TM-01', 100), ('TM-02', 100), ('TM-03', 100), ('TM-04', 100),
  ('TP-01', 100), ('TP-02', 100), ('TP-03', 100), ('VC-01', 90), ('VC-02', 90), ('VC-03', 90),
  ('VC-04', 90), ('VC-05', 90), ('VC-06', 90), ('VC-07', 90), ('VC-08', 90), ('VC-09', 90),
  ('VC-12', 90), ('VC-13', 120), ('VC-14', 120), ('VC-16', 90), ('VC-17', 90), ('VC-18', 90),
  ('VC-19', 90), ('VC-20', 90), ('VC-21', 90), ('VC-22', 90), ('ZM-01', 100)
) as x(id, h)
on conflict (equipo) do update set horas = excluded.horas;

-- Vista previa (antes de cambiar)
select (select count(*) from _hmin) as excel,
       (select count(*) from _hmin h join public.equipos e on upper(e.id) = upper(h.equipo)) as en_flota,
       (select string_agg(h.equipo, ', ') from _hmin h where not exists (select 1 from public.equipos e where upper(e.id) = upper(h.equipo))) as no_estan_en_flota,
       (select count(*) from public.tarifas_equipos t join _hmin h on upper(t.equipo_id) = upper(h.equipo)) as filas_tarifa_a_cargar;

-- 1. Ficha del equipo
update public.equipos e set horas_minimas_mes = h.horas
from _hmin h where upper(e.id) = upper(h.equipo) and e.horas_minimas_mes is distinct from h.horas;

-- 2. Maestro de tarifas (todas las obras del equipo)
update public.tarifas_equipos t set minimo_hr = h.horas, actualizado_en = now()
from _hmin h where upper(t.equipo_id) = upper(h.equipo) and t.minimo_hr is distinct from h.horas;

-- 3. Importar de Unysoft respeta el mínimo de la ficha
create or replace function public.tarifas_importar(p jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  nuevas int; total int; sin_equipo int;
begin
  if not public.edita_certificados() then raise exception 'Solo administración o gerencia'; end if;

  select count(*), count(*) filter (where i.unysoft_id is null
           or not exists (select 1 from tarifas_equipos t where t.unysoft_id = i.unysoft_id))
    into total, nuevas
  from tarifas_filas(p) i;

  insert into tarifas_equipos (unysoft_id, equipo_unysoft, equipo_id, descripcion, unidad_negocio, unidad_negocio_nombre,
                               fecha_hasta, minimo_hr, tarifa1, tarifa2, proveedor, origen)
  select i.unysoft_id, i.equipo_unysoft, q.eq,
         i.descripcion, i.unidad_negocio, i.unidad_negocio_nombre, i.fecha_hasta,
         -- v83: el mínimo de la ficha del equipo manda sobre el de Unysoft
         coalesce((select nullif(e.horas_minimas_mes, 0) from equipos e where e.id = q.eq), i.minimo_hr),
         i.tarifa1, i.tarifa2, i.proveedor, 'unysoft'
  from tarifas_filas(p) i
  cross join lateral (select
         -- Equipos propios: el código ya es el de la app (CV-14).
         -- Alquilados: Unysoft usa un número; el código va al principio de la descripción.
         coalesce((select e.id from equipos e where upper(e.id) = upper(i.equipo_unysoft)),
                  (select e.id from equipos e where upper(e.id) = upper(split_part(btrim(i.descripcion), ' ', 1)))) as eq) q
  on conflict (unysoft_id) do update set
    equipo_unysoft = excluded.equipo_unysoft,
    equipo_id = coalesce(tarifas_equipos.equipo_id, excluded.equipo_id),
    descripcion = excluded.descripcion, unidad_negocio = excluded.unidad_negocio,
    unidad_negocio_nombre = excluded.unidad_negocio_nombre, fecha_hasta = excluded.fecha_hasta,
    minimo_hr = coalesce((select nullif(e.horas_minimas_mes, 0) from equipos e
                           where e.id = coalesce(tarifas_equipos.equipo_id, excluded.equipo_id)), excluded.minimo_hr),
    tarifa1 = excluded.tarifa1, tarifa2 = excluded.tarifa2,
    proveedor = excluded.proveedor, origen = 'unysoft', actualizado_en = now();

  select count(*) into sin_equipo from tarifas_equipos where equipo_id is null;
  return jsonb_build_object('leidas', total, 'nuevas', nuevas, 'actualizadas', total - nuevas, 'sin_equipo', sin_equipo);
end;
$function$;

-- 4. Cambiar el mínimo en la ficha actualiza sus tarifas
create or replace function public.equipo_minimo_a_tarifas() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.horas_minimas_mes, 0) > 0 then
    update tarifas_equipos set minimo_hr = new.horas_minimas_mes, actualizado_en = now()
     where equipo_id = new.id and minimo_hr is distinct from new.horas_minimas_mes;
  end if;
  return new;
end $$;
drop trigger if exists trg_equipo_minimo_a_tarifas on public.equipos;
create trigger trg_equipo_minimo_a_tarifas after update of horas_minimas_mes on public.equipos
  for each row when (old.horas_minimas_mes is distinct from new.horas_minimas_mes)
  execute function public.equipo_minimo_a_tarifas();

-- Resultado
select (select count(*) from public.equipos where horas_minimas_mes > 0) as equipos_con_minimo,
       (select count(*) from public.tarifas_equipos where minimo_hr > 0) as tarifas_con_minimo,
       (select count(*) from public.tarifas_equipos t join _hmin h on upper(t.equipo_id) = upper(h.equipo) where t.minimo_hr <> h.horas) as tarifas_distintas_al_excel,  -- 0
       (select count(*) from public.equipos e join _hmin h on upper(e.id) = upper(h.equipo) where e.horas_minimas_mes <> h.horas) as fichas_distintas_al_excel;       -- 0
