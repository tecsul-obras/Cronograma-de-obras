-- =========================================================================
-- 66_ot_tipo_por_origen.sql · equipos-v71 (28/10/2026)
--
-- Tipo de OT (Taller / Pista) con las reglas de José:
--   1. Ubicación TALLER CENTRAL → siempre Taller (aunque diga otra cosa).
--   2. Abierta desde "Registro de Trabajos - OT" (o desde la Inspección
--      Final sin OT) → siempre Pista.
--   3. Si se eligió el tipo (Diagnóstico Inicial - Generación OT, o al tomar
--      la OT en la bandeja) → ese.
--   4. "Diagnóstico Inicial - Generación OT" sin tipo elegido → Taller.
--   5. Reporte de falla / parte diario (OT Solicitada): queda sin tipo hasta
--      que taller la toma; mientras tanto se muestra como Pista (≈).
--
-- Corrige el tipo guardado de todas las OT (también las viejas de JotForm)
-- y un disparador lo aplica a las nuevas. Requiere el SQL 65.
-- No borra datos. Se puede correr más de una vez.
-- =========================================================================

-- ── 1. La regla, en una función ────────────────────────────────────────
create or replace function public.ot_tipo_regla(p_tipo text, p_condicion text, p_obra text, p_ubicacion text)
returns text language sql stable set search_path = public as $$
  select case
    when coalesce((select o.nombre from obras o where o.clave = p_obra), p_ubicacion, '') ilike '%taller central%' then 'Taller'
    when p_condicion = 'Registro de Trabajos - OT' then 'Pista'
    when nullif(trim(p_tipo), '') is not null then trim(p_tipo)
    when p_condicion = 'Diagnóstico Inicial - Generación OT' then 'Taller'
    else null end
$$;

-- El tipo que usan la bandeja, las reglas de cierre y los costos
-- (el guardado ya viene corregido; TALLER CENTRAL manda igual)
create or replace function public.ot_tipo_efectivo(p_tipo text, p_obra text, p_ubicacion text)
returns text language sql stable set search_path = public as $$
  select case
    when coalesce((select o.nombre from obras o where o.clave = p_obra), p_ubicacion, '') ilike '%taller central%' then 'Taller'
    else coalesce(nullif(trim(p_tipo), ''), 'Pista') end
$$;

-- ── 2. Disparador: toda OT nueva o editada queda con el tipo de la regla ─
-- (el nombre empieza con 0 para correr antes que los otros disparadores)
create or replace function public.fn_ot_tipo()
returns trigger language plpgsql set search_path = public as $$
begin
  new.tipo_ot := ot_tipo_regla(new.tipo_ot, new.condicion_origen, new.obra_clave, new.ubicacion_texto);
  return new;
end $$;
drop trigger if exists trg_ot_0_tipo on public.ordenes_trabajo;
create trigger trg_ot_0_tipo before insert or update of tipo_ot, condicion_origen, obra_clave, ubicacion_texto
  on public.ordenes_trabajo for each row execute function public.fn_ot_tipo();

-- ── 3. Corregir las OT que ya existen ──────────────────────────────────
-- Sin los otros disparadores: solo cambia el tipo (no toca fechas, estado
-- de flota ni el "actualizado_en" que usan las 48 h).
alter table public.ordenes_trabajo disable trigger trg_ot_abierta;
alter table public.ordenes_trabajo disable trigger trg_ot_cerrada;
alter table public.ordenes_trabajo disable trigger trg_ot_cierre_valido;

create temp table _ot_tipo_antes as
  select id, tipo_ot as antes from public.ordenes_trabajo;

update public.ordenes_trabajo o
   set tipo_ot = public.ot_tipo_regla(o.tipo_ot, o.condicion_origen, o.obra_clave, o.ubicacion_texto)
 where o.tipo_ot is distinct from public.ot_tipo_regla(o.tipo_ot, o.condicion_origen, o.obra_clave, o.ubicacion_texto);

alter table public.ordenes_trabajo enable trigger trg_ot_abierta;
alter table public.ordenes_trabajo enable trigger trg_ot_cerrada;
alter table public.ordenes_trabajo enable trigger trg_ot_cierre_valido;

-- ── 4. Vistas con la regla nueva (mismas columnas que en el SQL 65) ────
create or replace view public.v_ot with (security_invoker = true) as
SELECT o.id,
    o.numero,
    o.estado,
    o.condicion_origen,
    o.nombre,
    o.tipo_ot,
    o.equipo_id,
    COALESCE(e.descripcion, o.trabajo_general) AS equipo,
    e.tipo AS tipo_equipo,
    o.trabajo_general,
    o.obra_clave,
    COALESCE(ob.nombre, o.ubicacion_texto) AS ubicacion,
    o.lider_cedula,
    li.nombre AS lider,
    o.fallas,
    o.sintomas,
    COALESCE(o.fecha_ingreso, o.creado_en) AS abierta_el,
    o.fecha_estimada_cierre,
    o.fecha_cierre,
        CASE
            WHEN o.estado = ANY (ARRAY['Abierta'::text, 'Solicitada'::text]) THEN CURRENT_DATE - COALESCE(o.fecha_ingreso, o.creado_en)::date
            ELSE o.fecha_cierre::date - COALESCE(o.fecha_ingreso, o.creado_en)::date
        END AS dias,
        CASE
            WHEN o.estado = 'Abierta'::text AND o.fecha_estimada_cierre < CURRENT_DATE THEN true
            ELSE false
        END AS atrasada,
    r.registros,
    r.tecnicos,
    r.horas_trabajo,
    r.horas_traslado,
    r.ultimo_registro,
    r.ultimo_estado_maquina,
    o.estado_maquina_salida,
    o.parte_id,
    o.origen,
    ot_tipo_efectivo(o.tipo_ot, o.obra_clave, o.ubicacion_texto) AS tipo_ot_efectivo,
    nullif(trim(o.tipo_ot), '') IS NULL AS tipo_ot_inferido
   FROM ordenes_trabajo o
     LEFT JOIN equipos e ON e.id = o.equipo_id
     LEFT JOIN obras ob ON ob.clave = o.obra_clave
     LEFT JOIN operadores li ON li.cedula = o.lider_cedula
     LEFT JOIN LATERAL ( SELECT count(*) AS registros,
            array_agg(DISTINCT COALESCE(t.nombre, x.tecnico_texto)) FILTER (WHERE COALESCE(t.nombre, x.tecnico_texto) IS NOT NULL) AS tecnicos,
            sum(COALESCE(it.horas, 0::numeric)) + sum(COALESCE(x.horas_mantenimiento, 0::numeric)) AS horas_trabajo,
            sum(COALESCE(x.horas_traslado, 0::numeric)) AS horas_traslado,
            max(x.fecha) AS ultimo_registro,
            (array_agg(x.estado_maquina ORDER BY x.creado_en DESC) FILTER (WHERE x.estado_maquina IS NOT NULL))[1] AS ultimo_estado_maquina
           FROM ot_registros x
             LEFT JOIN operadores t ON t.cedula = x.tecnico_cedula
             LEFT JOIN LATERAL ( SELECT sum(i.horas) AS horas
                   FROM ot_registro_items i
                  WHERE i.registro_id = x.id) it ON true
          WHERE x.ot_id = o.id) r ON true;

create or replace view public.v_ot_horas with (security_invoker = true) as
with h as (
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         i.sistema, i.componente, i.horas, i.estado_reparacion, 'trabajo'::text as tipo_hora
  from ot_registro_items i join ot_registros x on x.id = i.registro_id
  where coalesce(i.horas, 0) > 0
  union all
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         'MTTO. ACEITES', 'Service ' || coalesce(x.tipo_mantenimiento || ' h', ''), x.horas_mantenimiento, null, 'mantenimiento'
  from ot_registros x where coalesce(x.horas_mantenimiento, 0) > 0
  union all
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         'TRASLADO', 'Traslado', x.horas_traslado, null, 'traslado'
  from ot_registros x where coalesce(x.horas_traslado, 0) > 0
)
select date_trunc('month', h.fecha::timestamptz)::date as mes,
       h.fecha,
       o.numero as ot,
       o.equipo_id,
       h.tecnico_cedula,
       coalesce(t.nombre, h.tecnico_texto) as tecnico,
       h.sistema,
       h.componente,
       h.horas,
       h.estado_reparacion,
       h.tipo_hora,
       o.nombre as ot_nombre,
       o.estado as ot_estado,
       ot_tipo_efectivo(o.tipo_ot, o.obra_clave, o.ubicacion_texto) as tipo_ot,
       coalesce(e.descripcion, o.trabajo_general) as equipo,
       e.tipo as tipo_equipo,
       tf.tarifa as tarifa_hora,
       round(h.horas * tf.tarifa) as costo
from h
join ordenes_trabajo o on o.id = h.ot_id
left join operadores t on t.cedula = h.tecnico_cedula
left join equipos e on e.id = o.equipo_id
left join obras ob on ob.clave = o.obra_clave
left join lateral (select tarifa_tecnico(h.tecnico_cedula, h.fecha) as tarifa) tf on true;

-- ── Comprobación ────────────────────────────────────────────────────────
-- Cuántas OT cambiaron y cómo quedaron
select coalesce(a.antes, '(sin tipo)') as antes, coalesce(o.tipo_ot, '(sin tipo)') as ahora, count(*) as ot
  from public.ordenes_trabajo o join _ot_tipo_antes a on a.id = o.id
 group by 1, 2 order by 1, 2;
