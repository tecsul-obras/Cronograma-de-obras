-- =========================================================================
-- 78_ot_abierta_trabajando.sql · v20261102g (equipos-v84) — correr DESPUÉS del 77
--
-- 1. Saltos: si entre el parte anterior y el nuevo la máquina entró a una
--    OT de TALLER, el parte queda «para revisar» aunque hayan pasado 1 o 2
--    días (antes hacía falta dias_parado_revisar o una lectura de taller).
--    Cuenta la OT que entró después del parte anterior, o cualquiera abierta
--    en el período si el parte anterior ya era de taller.
-- 2. v_ot_abierta_trabajando: OT de taller abiertas cuya máquina ya tiene
--    partes en una obra (no taller) desde que entró. Ej.: MN-04, OT 11308,
--    trabaja en Arborea desde el 26/10. No se bloquea el parte ni se cierra
--    la OT sola: se avisa en Alertas y en la bandeja de OT.
-- 3. v_alertas_flota: se suma el tipo «OT abierta con máquina trabajando».
--
-- Probado el 02/11/2026 (transacción deshecha): +10 partes «revisar» por OT en
-- el período desde el 01/10; 9 OT de taller abiertas con la máquina trabajando
-- (MN-04 11308, CV-09 10886, VC-06 11628, CV-15 11435 y 11801, CV-16 77337,
-- EX-11 10354, CV-13 11103, CRA-02 20037).
-- =========================================================================

-- ── 1. Detección con OT de taller en el período ─────────────────────────
create or replace function public.salto_evaluar(p_parte uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p     partes%rowtype;
  ant   partes%rowtype;
  ex    horometro_saltos%rowtype;
  gap   numeric;
  ndias int;
  tope  int := coalesce((select valor from form_reglas where clave = 'dias_parado_revisar'), 5)::int;
  ev_l  numeric;
  ev_f  date;
  ev_t  text;
  v_ot  bigint;
  v_tipo text;
  ant_taller boolean;
  p_taller boolean;
begin
  select * into p from partes where id = p_parte;
  if not found or p.origen = 'puente' then return; end if;

  select * into ex from horometro_saltos where parte_id = p_parte;
  if found and ex.estado <> 'pendiente' then return; end if;   -- lo resuelto no se toca

  if p.horometro_inicial is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  select * into ant from partes o
   where o.equipo_id = p.equipo_id and o.id <> p.id and o.horometro_final is not null
     and (o.fecha < p.fecha or (o.fecha = p.fecha and o.creado_en < p.creado_en))
   order by o.fecha desc, o.creado_en desc
   limit 1;
  if not found then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  gap   := round(p.horometro_inicial - ant.horometro_final, 1);
  ndias := p.fecha - ant.fecha;
  ant_taller := ant.obra_clave like '3050100006%' or coalesce(ant.actividad_dia, '') ilike '%taller%';
  p_taller   := p.obra_clave like '3050100006%' or coalesce(p.actividad_dia, '') ilike '%taller%';

  -- Lecturas de taller entre los dos partes mayores al final del anterior
  -- (las del mismo día del parte caen dentro del turno: no cuentan)
  select x.l, x.f into ev_l, ev_f from (
      select r.lectura l, r.fecha f
        from ot_registros r join ordenes_trabajo o on o.id = r.ot_id
       where o.equipo_id = p.equipo_id and r.tipo_medicion = 'Horómetro'
         and r.fecha > ant.fecha and r.fecha < p.fecha
      union all
      select o.lectura_salida, (o.fecha_cierre at time zone 'America/Asuncion')::date
        from ordenes_trabajo o
       where o.equipo_id = p.equipo_id and o.lectura_salida is not null
         and (o.fecha_cierre at time zone 'America/Asuncion')::date > ant.fecha
         and (o.fecha_cierre at time zone 'America/Asuncion')::date <= p.fecha
    ) x
   where x.l > ant.horometro_final + 0.05
     and x.l <= coalesce(p.horometro_final, x.l) + 0.05
   order by x.l desc
   limit 1;
  if ev_l is not null then
    ev_t := 'El taller registró ' || ev_l || ' h el ' || to_char(ev_f, 'DD/MM/YYYY')
         || ' (el parte anterior terminó en ' || ant.horometro_final || ' h)';
  end if;

  -- OT de taller en el período: entró después del parte anterior, o el
  -- parte anterior ya era de taller y la OT seguía abierta. Solo cuenta
  -- cuando la máquina SALE de taller (el parte nuevo no es de taller): los
  -- partes diarios «A disposición equipo en taller» no se marcan uno por uno.
  select o.id into v_ot from ordenes_trabajo o
   where o.equipo_id = p.equipo_id and o.tipo_ot = 'Taller'
     and coalesce(o.fecha_ingreso, o.creado_en)::date <= p.fecha
     and (o.fecha_cierre is null or (o.fecha_cierre at time zone 'America/Asuncion')::date >= ant.fecha)
     and (coalesce(o.fecha_ingreso, o.creado_en)::date >= ant.fecha or ant_taller)
     and not p_taller
   order by coalesce(o.fecha_ingreso, o.creado_en) desc
   limit 1;

  v_tipo := case
    when gap > 0.05 then 'salto'
    when gap >= -0.05 and ant.origen <> 'puente'
         and (ev_l is not null or ndias >= tope or v_ot is not null) then 'revision'
  end;

  if v_tipo is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  if ev_t is null and v_ot is not null and v_tipo = 'revision' then
    ev_t := 'La máquina pasó por la OT de taller ' || (select numero from ordenes_trabajo where id = v_ot)
         || ' entre los dos partes';
  end if;

  insert into horometro_saltos as s
    (equipo_id, parte_id, parte_anterior_id, tipo, fecha_desde, fecha_hasta, dias,
     lectura_desde, lectura_hasta, horas, evidencia_lectura, evidencia_fecha, evidencia, ot_id, causa_declarada)
  values
    (p.equipo_id, p.id, ant.id, v_tipo, ant.fecha, p.fecha, ndias,
     ant.horometro_final, p.horometro_inicial, greatest(gap, 0), ev_l, ev_f, ev_t, v_ot,
     nullif(p.extras->>'salto_causa', ''))
  on conflict (parte_id) do update set
     equipo_id = excluded.equipo_id, parte_anterior_id = excluded.parte_anterior_id, tipo = excluded.tipo,
     fecha_desde = excluded.fecha_desde, fecha_hasta = excluded.fecha_hasta, dias = excluded.dias,
     lectura_desde = excluded.lectura_desde, lectura_hasta = excluded.lectura_hasta, horas = excluded.horas,
     evidencia_lectura = excluded.evidencia_lectura, evidencia_fecha = excluded.evidencia_fecha,
     evidencia = excluded.evidencia, ot_id = excluded.ot_id,
     causa_declarada = coalesce(excluded.causa_declarada, s.causa_declarada)
  where s.estado = 'pendiente';
end;
$function$;

-- ── 2. OT de taller abiertas con la máquina ya trabajando ───────────────
create or replace view public.v_ot_abierta_trabajando with (security_invoker = true) as
select o.id as ot_id, o.numero, o.equipo_id, o.nombre,
       coalesce(o.fecha_ingreso, o.creado_en) as fecha_ingreso,
       pr.fecha as trabaja_desde, pr.obra_clave, ob.nombre as obra_nombre, op.nombre as operador,
       ul.fecha as ultimo_parte, ul.cantidad as partes_en_obra
  from ordenes_trabajo o
  join lateral (
    select p.fecha, p.obra_clave, p.operador_cedula from partes p
     where p.equipo_id = o.equipo_id and p.origen <> 'puente'
       and p.fecha > (coalesce(o.fecha_ingreso, o.creado_en) at time zone 'America/Asuncion')::date   -- el día que entró pudo trabajar antes
       and p.obra_clave not like '3050100006%'
       and coalesce(p.actividad_dia, '') not ilike '%taller%'
     order by p.fecha, p.creado_en limit 1) pr on true
  join lateral (
    select max(p.fecha) as fecha, count(*) as cantidad from partes p
     where p.equipo_id = o.equipo_id and p.origen <> 'puente' and p.fecha >= pr.fecha
       and p.obra_clave not like '3050100006%') ul on true
  left join obras ob on ob.clave = pr.obra_clave
  left join operadores op on op.cedula = pr.operador_cedula
 where o.estado = 'Abierta' and o.tipo_ot = 'Taller' and o.equipo_id is not null;

grant select on public.v_ot_abierta_trabajando to authenticated;

-- ── 3. Alertas de flota (misma definición + el tipo nuevo al final) ─────
create or replace view public.v_alertas_flota with (security_invoker = true) as
 SELECT 'Dinatran'::text AS tipo,
    e.id AS equipo_id,
    e.venc_dinatran AS vence,
    e.venc_dinatran - CURRENT_DATE AS dias,
        CASE
            WHEN e.venc_dinatran < CURRENT_DATE THEN 'VENCIDO'::text
            ELSE 'POR VENCER'::text
        END AS nivel,
    'Habilitación Dinatran'::text AS detalle
   FROM equipos e
  WHERE e.activo AND e.propiedad = 'Propio'::text AND e.venc_dinatran IS NOT NULL AND e.venc_dinatran <= (CURRENT_DATE + 30)
UNION ALL
 SELECT 'Habilitación municipal'::text AS tipo,
    e.id AS equipo_id,
    e.venc_habilitacion_municipal AS vence,
    e.venc_habilitacion_municipal - CURRENT_DATE AS dias,
        CASE
            WHEN e.venc_habilitacion_municipal < CURRENT_DATE THEN 'VENCIDO'::text
            ELSE 'POR VENCER'::text
        END AS nivel,
    'Habilitación municipal'::text AS detalle
   FROM equipos e
  WHERE e.activo AND e.propiedad = 'Propio'::text AND e.venc_habilitacion_municipal IS NOT NULL AND e.venc_habilitacion_municipal <= (CURRENT_DATE + 30)
UNION ALL
 SELECT 'Seguro'::text AS tipo,
    COALESCE(s.equipo_id, s.bien_asegurado) AS equipo_id,
    s.vencimiento AS vence,
    s.vencimiento - CURRENT_DATE AS dias,
        CASE
            WHEN s.vencimiento < CURRENT_DATE THEN 'VENCIDO'::text
            ELSE 'POR VENCER'::text
        END AS nivel,
    concat_ws(' · '::text, s.compania, 'Póliza '::text || s.poliza) AS detalle
   FROM seguros s
     LEFT JOIN equipos e ON e.id = s.equipo_id
  WHERE s.situacion IS NULL AND s.vencimiento IS NOT NULL AND s.vencimiento <= (CURRENT_DATE + 30) AND COALESCE(e.activo, true) AND NOT (EXISTS ( SELECT 1
           FROM seguros s2
          WHERE s2.bien_asegurado = s.bien_asegurado AND s2.vencimiento > s.vencimiento))
UNION ALL
 SELECT 'Mantenimiento'::text AS tipo,
    v.equipo_id,
    COALESCE(v.proxima_fecha,
        CASE
            WHEN v.dias_restantes IS NOT NULL THEN CURRENT_DATE + v.dias_restantes
            ELSE NULL::date
        END) AS vence,
    v.dias_restantes AS dias,
    v.semaforo AS nivel,
    concat_ws(' · '::text,
        CASE
            WHEN v.proximo_nivel IS NOT NULL THEN ('Service '::text || v.proximo_nivel) || ' h'::text
            ELSE v.nombre
        END,
        CASE
            WHEN v.horas_restantes < 0::numeric THEN ('pasado '::text || round(- v.horas_restantes)) || ' h'::text
            WHEN v.horas_restantes IS NOT NULL THEN ('faltan '::text || round(v.horas_restantes)) || ' h'::text
            ELSE NULL::text
        END,
        CASE
            WHEN v.km_restantes < 0::numeric THEN ('pasado '::text || round(- v.km_restantes)) || ' km'::text
            WHEN v.km_restantes IS NOT NULL THEN ('faltan '::text || round(v.km_restantes)) || ' km'::text
            ELSE NULL::text
        END) AS detalle
   FROM v_mantenimiento_plan v
  WHERE v.equipo_activo AND v.propiedad = 'Propio'::text AND (v.semaforo = ANY (ARRAY['VENCIDO'::text, 'PRÓXIMO'::text]))
UNION ALL
 SELECT 'Taller demorado'::text AS tipo,
    s.equipo_id,
    s.fecha_estimada_operacion AS vence,
    s.fecha_estimada_operacion - CURRENT_DATE AS dias,
    'VENCIDO'::text AS nivel,
    'Pasó la fecha estimada de salida de taller'::text AS detalle
   FROM equipo_estado s
     JOIN equipos e ON e.id = s.equipo_id AND e.activo AND e.propiedad = 'Propio'::text
  WHERE s.estado <> 'Operativo'::text AND s.fecha_estimada_operacion < CURRENT_DATE
UNION ALL
 -- SQL 78: OT de taller abierta con la máquina trabajando en una obra
 SELECT 'OT abierta con máquina trabajando'::text AS tipo,
    t.equipo_id,
    t.trabaja_desde AS vence,
    t.trabaja_desde - CURRENT_DATE AS dias,
    'VENCIDO'::text AS nivel,
    'OT ' || t.numero || ' abierta · trabaja en ' || coalesce(regexp_replace(t.obra_nombre, '^[0-9A-Z]+_', ''),
      regexp_replace(t.obra_clave, '^[0-9A-Z]+_', '')) || ' desde el ' || to_char(t.trabaja_desde, 'DD/MM')
      || ' · que taller la cierre con la Inspección Final' AS detalle
   FROM v_ot_abierta_trabajando t;

-- ── 4. Volver a evaluar los partes pendientes y los del último mes ──────
do $$
declare r record;
begin
  for r in select id from partes where fecha >= date '2026-10-01' and origen <> 'puente' and horometro_inicial is not null
           order by fecha, creado_en loop
    perform salto_evaluar(r.id);
  end loop;
end $$;

-- ── Resumen ─────────────────────────────────────────────────────────────
select
  (select count(*) from horometro_saltos where estado = 'pendiente' and tipo = 'salto')    as saltos_pendientes,
  (select count(*) from horometro_saltos where estado = 'pendiente' and tipo = 'revision') as revisar_pendientes,
  (select count(*) from v_ot_abierta_trabajando) as ot_abiertas_con_maquina_trabajando,
  (select string_agg(equipo_id || ' OT ' || numero || ' desde ' || to_char(trabaja_desde, 'DD/MM'), ' | ')
     from (select * from v_ot_abierta_trabajando order by trabaja_desde limit 15) x) as ejemplos;
