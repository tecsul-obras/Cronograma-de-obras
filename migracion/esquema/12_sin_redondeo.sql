-- =============================================================================
-- 12_sin_redondeo.sql — cantidades, precios y montos SIN redondeo (03/10/2026)
--
-- Pedido de José: "para lo que es cantidades y montos de producción y
-- certificación no quiero nada de redondeos". Hasta ahora las columnas eran
-- numeric(18,4) (cantidades y precios), numeric(18,2) (montos) y similares, y
-- Postgres redondeaba al guardar. Pasan todas a `numeric` sin escala: guarda el
-- número exacto que se le manda, con todos sus decimales.
--
-- Para poder cambiar el tipo hay que sacar y volver a crear:
--   * las columnas calculadas item.cant_contractual e item.cant_vigente;
--   * las vistas que leen esas columnas (mismas definiciones, security_invoker).
-- No borra datos. Es una transacción: si algo falla, no cambia nada.
-- Después de esto hay que RECARGAR los datos (los que ya están quedaron
-- redondeados a 4 decimales al cargarse): archivos R1 … R6.
-- =============================================================================
BEGIN;

DROP VIEW IF EXISTS public.v_obra_avance;
DROP VIEW IF EXISTS public.v_item_cantidades;
DROP VIEW IF EXISTS public.v_powerbi_liberacion;
DROP VIEW IF EXISTS public.v_produccion_diaria;

ALTER TABLE public.item DROP COLUMN cant_contractual, DROP COLUMN cant_vigente;

ALTER TABLE public.item
  ALTER COLUMN cant_contrato   TYPE numeric,
  ALTER COLUMN cant_convenio   TYPE numeric,
  ALTER COLUMN cant_ajustada   TYPE numeric,
  ALTER COLUMN precio_unit     TYPE numeric,
  ALTER COLUMN incidencia      TYPE numeric,
  ALTER COLUMN avance_esperado TYPE numeric,
  ALTER COLUMN avance_manual   TYPE numeric;

ALTER TABLE public.item
  ADD COLUMN cant_contractual numeric GENERATED ALWAYS AS (coalesce(cant_convenio, cant_contrato)) STORED,
  ADD COLUMN cant_vigente     numeric GENERATED ALWAYS AS (coalesce(cant_ajustada, cant_convenio, cant_contrato)) STORED;

ALTER TABLE public.distribucion_mensual ALTER COLUMN cant TYPE numeric;
ALTER TABLE public.certificacion        ALTER COLUMN cant_certificada TYPE numeric;
ALTER TABLE public.plan_semanal         ALTER COLUMN cant_prevista TYPE numeric;
ALTER TABLE public.linea_base_detalle
  ALTER COLUMN cant          TYPE numeric,
  ALTER COLUMN cant_convenio TYPE numeric;
ALTER TABLE public.convenio
  ALTER COLUMN monto_original TYPE numeric,
  ALTER COLUMN monto_convenio TYPE numeric,
  ALTER COLUMN pct_aumento    TYPE numeric;
ALTER TABLE public.convenio_detalle
  ALTER COLUMN cant TYPE numeric,
  ALTER COLUMN pu   TYPE numeric;
ALTER TABLE public.produccion_fila
  ALTER COLUMN cantidad     TYPE numeric,
  ALTER COLUMN prog_ini     TYPE numeric,
  ALTER COLUMN prog_fin     TYPE numeric,
  ALTER COLUMN ancho_prom   TYPE numeric,
  ALTER COLUMN espesor_prom TYPE numeric;
ALTER TABLE public.produccion_jornada ALTER COLUMN lluvia_mm TYPE numeric;
ALTER TABLE public.pista_eje   ALTER COLUMN prog_ini TYPE numeric, ALTER COLUMN prog_fin TYPE numeric;
ALTER TABLE public.pista_tramo ALTER COLUMN prog_ini TYPE numeric, ALTER COLUMN prog_fin TYPE numeric;

-- ---------------------------------------------------------------- vistas
CREATE VIEW public.v_item_cantidades WITH (security_invoker = true) AS
SELECT i.obra_id, i.item_id, i.descripcion, i.um, o.tipo_obra,
       i.cant_contrato, i.cant_convenio, i.cant_ajustada, i.cant_contractual, i.cant_vigente,
       CASE WHEN o.tipo_obra = 'publica' THEN i.cant_contractual
            ELSE coalesce(i.cant_ajustada, i.cant_contractual) END AS cant_tope,
       coalesce(c.certificado, 0) AS cant_certificada,
       coalesce(p.producido, 0)   AS cant_producida,
       CASE WHEN o.tipo_obra = 'publica' THEN i.cant_contractual
            ELSE coalesce(i.cant_ajustada, i.cant_contractual) END - coalesce(c.certificado, 0) AS saldo_certificable,
       i.cant_vigente * i.precio_unit AS monto_vigente,
       coalesce(c.certificado, 0) * i.precio_unit AS monto_certificado
FROM public.item i
JOIN public.obra o ON o.obra_id = i.obra_id
LEFT JOIN (SELECT obra_id, item_id, sum(cant_certificada) AS certificado
           FROM public.certificacion GROUP BY obra_id, item_id) c
       ON c.obra_id = i.obra_id AND c.item_id = i.item_id
LEFT JOIN (SELECT f.obra_id, f.item_id, sum(f.cantidad) AS producido
           FROM public.produccion_fila f
           JOIN public.produccion_jornada j ON j.obra_id = f.obra_id AND j.submission_id = f.submission_id
           WHERE j.estado ILIKE '%con actividad con liberaciones%'
           GROUP BY f.obra_id, f.item_id) p
       ON p.obra_id = i.obra_id AND p.item_id = i.item_id;

-- Los porcentajes ya no se redondean a 2 decimales: el formato lo pone quien los muestra.
CREATE VIEW public.v_obra_avance WITH (security_invoker = true) AS
SELECT o.obra_id, o.nombre, o.tipo_obra,
       sum(i.cant_contrato * i.precio_unit)   AS monto_contrato_original,
       sum(i.cant_vigente * i.precio_unit)    AS monto_vigente,
       sum(v.cant_certificada * i.precio_unit) AS monto_certificado,
       sum(v.cant_producida * i.precio_unit)   AS monto_producido,
       CASE WHEN sum(i.cant_contrato * i.precio_unit) > 0
            THEN 100 * sum(v.cant_producida * i.precio_unit) / sum(i.cant_contrato * i.precio_unit) END AS pct_producido,
       CASE WHEN sum(i.cant_contrato * i.precio_unit) > 0
            THEN 100 * sum(v.cant_certificada * i.precio_unit) / sum(i.cant_contrato * i.precio_unit) END AS pct_certificado,
       count(*) FILTER (WHERE NOT i.es_grupo) AS total_items
FROM public.obra o
JOIN public.item i ON i.obra_id = o.obra_id
JOIN public.v_item_cantidades v ON v.obra_id = i.obra_id AND v.item_id = i.item_id
WHERE NOT i.es_grupo
GROUP BY o.obra_id, o.nombre, o.tipo_obra;

CREATE VIEW public.v_produccion_diaria WITH (security_invoker = true) AS
SELECT f.obra_id, f.item_id, j.fecha, sum(f.cantidad) AS cantidad
FROM public.produccion_fila f
JOIN public.produccion_jornada j ON j.obra_id = f.obra_id AND j.submission_id = f.submission_id
WHERE j.estado ILIKE '%con actividad con liberaciones%'
GROUP BY f.obra_id, f.item_id, j.fecha;

CREATE VIEW public.v_powerbi_liberacion WITH (security_invoker = true) AS
SELECT j.submission_id AS "Submission ID",
       j.responsable AS "Responsable registro",
       to_char(j.fecha::timestamptz, 'YYYY-MM-DD') AS "Fecha liberación",
       f.lado AS "Lado",
       f.prog_ini AS "Progresiva inicial",
       f.prog_fin AS "Progresiva Final",
       f.cantidad AS "Cantidad",
       f.observaciones AS "Observaciones",
       f.cantidad AS "Cant. Final Producida",
       i.um AS "U.M.",
       f.prog_fin - f.prog_ini AS "Longitud (m)",
       to_char(j.cargado_en, 'YYYY-MM-DD HH24:MI:SS') AS "Submission Date",
       i.codigo_cc AS "CODIGO CC",
       NULL::numeric AS "Cantidad old",
       j.estado AS "Estado de actividad",
       j.lluvia_mm AS "Cantidad de lluvia (mm)",
       j.obra_id AS "ID Obra",
       o.nombre AS "Desc. Obra",
       f.item_id AS "ID Item de Obra",
       i.descripcion AS "Desc. Item de Obra",
       f.ancho_prom AS "Ancho Promedio (m)",
       (f.prog_fin - f.prog_ini) * f.ancho_prom AS "Área (m2)",
       f.espesor_prom AS "Espesor Promedio (m)",
       (f.prog_fin - f.prog_ini) * f.ancho_prom * f.espesor_prom AS "Volumen (m3)",
       j.obra_id AS "ID Obra (nuevo)",
       o.nombre AS "Desc. Obra (nuevo)",
       f.item_id AS "ID Item de Obra (nuevo) raw",
       i.descripcion AS "Desc. Item de Obra (nuevo)",
       f.item_id AS "ID Item de Obra (nuevo)",
       i.um AS "U.M. (nuevo)",
       coalesce(i.padre_id, f.item_id) AS "ID Item de Obra Contrato",
       coalesce(pad.descripcion, i.descripcion) AS "Desc. Item de Obra Contrato",
       (j.obra_id || '-') || coalesce(i.padre_id, f.item_id) AS "ID OBRA - ITEM FINAL",
       j.observaciones AS "Observaciones jornada",
       array_to_string(j.fotos, ' | ') AS "Fotos",
       CASE WHEN i.padre_id IS NOT NULL THEN f.item_id ELSE '' END AS "ID Item de Obra Subdivisión",
       CASE WHEN i.padre_id IS NOT NULL THEN i.descripcion ELSE '' END AS "Desc. Item de Obra Subdivisión"
FROM public.produccion_fila f
JOIN public.produccion_jornada j ON j.obra_id = f.obra_id AND j.submission_id = f.submission_id
JOIN public.obra o ON o.obra_id = j.obra_id
JOIN public.item i ON i.obra_id = f.obra_id AND i.item_id = f.item_id
LEFT JOIN public.item pad ON pad.obra_id = i.obra_id AND pad.item_id = i.padre_id;

-- ------------------------------------------------- control de tope
-- Misma función, pero las variables internas ya no son numeric(18,4): antes el
-- acumulado y el tope se redondeaban a 4 decimales antes de compararse.
CREATE OR REPLACE FUNCTION public.fn_tope_certificacion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tope   numeric;
  v_total  numeric;
  v_tipo   text;
  v_um     text;
BEGIN
  SELECT o.tipo_obra,
         CASE WHEN o.tipo_obra = 'publica' THEN i.cant_contractual
              ELSE COALESCE(i.cant_ajustada, i.cant_contractual) END,
         i.um
    INTO v_tipo, v_tope, v_um
    FROM item i
    JOIN obra o ON o.obra_id = i.obra_id
   WHERE i.obra_id = NEW.obra_id AND i.item_id = NEW.item_id;

  IF v_tope IS NULL THEN
    RETURN NEW;                          -- ítem sin cantidad: nada que topear
  END IF;

  SELECT COALESCE(sum(cant_certificada), 0) INTO v_total
    FROM certificacion
   WHERE obra_id = NEW.obra_id AND item_id = NEW.item_id;

  IF v_total > v_tope + 0.0001 THEN
    RAISE EXCEPTION
      'Certificación por encima del tope contractual. Ítem % de la obra %: se intenta acumular % % contra un tope de % % (obra %).',
      NEW.item_id, NEW.obra_id, v_total, v_um, v_tope, v_um, v_tipo
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;

-- Comprobación: tiene que devolver 0 filas (ninguna columna numérica con escala fija)
SELECT table_name, column_name, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'numeric' AND numeric_scale IS NOT NULL;
