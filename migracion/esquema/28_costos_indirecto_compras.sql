/* =========================================================================
 * 28_costos_indirecto_compras.sql — v20261007f
 *
 * 1. costo_version.indirecto: TOTAL COSTOS INDIRECTOS (Gs) de la hoja
 *    «Gastos Generales» de la plantilla. costo_importar lo guarda.
 * 2. compras_desglose(p_obra): la necesidad de recursos para Compras sale del
 *    APU vigente de la obra (el último recosteo; si no hay, el presupuesto):
 *    un renglón por ítem y recurso con su cantidad por unidad del ítem y su
 *    costo unitario, y los componentes de los materiales in situ (hormigones,
 *    base, mezcla) desglosados con recurso_padre, igual que item_recurso.
 *    El transporte va como recurso aparte ('TR:' + código) para no sumarse
 *    a la cantidad del material. Si la obra no tiene APU, no devuelve nada y
 *    Compras sigue usando item_recurso.
 *    SECURITY DEFINER: Compras ve cantidades y costos unitarios de su obra
 *    sin tener acceso a las tablas de costos.
 * Correr después del 26. Se puede correr más de una vez.
 * ========================================================================= */

ALTER TABLE public.costo_version ADD COLUMN IF NOT EXISTS indirecto numeric;

CREATE OR REPLACE FUNCTION public.costo_importar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text := lower(coalesce(public._jtxt(p->'tipo'), ''));
  v_id bigint; n_it integer; n_li integer; n_pr integer; n_nuevos integer := 0;
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cargar costos.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obra WHERE obra_id = p_obra) THEN RAISE EXCEPTION 'Obra % inexistente', p_obra; END IF;
  IF v_tipo NOT IN ('presupuesto', 'recosteo') THEN RAISE EXCEPTION 'Tipo de versión inválido: %', v_tipo; END IF;
  IF jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'El archivo no trae ítems.'; END IF;

  IF v_tipo = 'presupuesto' AND EXISTS (SELECT 1 FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'presupuesto') THEN
    IF NOT coalesce(public._jbool(p->'reemplazar'), false) THEN
      RAISE EXCEPTION 'La obra ya tiene un presupuesto. Para reemplazarlo hay que confirmarlo.';
    END IF;
    DELETE FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'presupuesto';
  END IF;

  INSERT INTO public.costo_version (obra_id, tipo, nombre, fecha, gg, bi, iva, archivo, nota, indirecto)
  VALUES (p_obra, v_tipo,
          coalesce(nullif(public._jtxt(p->'nombre'), ''), CASE v_tipo WHEN 'presupuesto' THEN 'Presupuesto' ELSE 'Recosteo' END),
          coalesce(public._jfecha(p->'fecha'), current_date),
          public._jnum(p->'gg'), public._jnum(p->'bi'), public._jnum(p->'iva'),
          coalesce(public._jtxt(p->'archivo'), ''), coalesce(public._jtxt(p->'nota'), ''), public._jnum(p->'indirecto'))
  RETURNING version_id INTO v_id;

  -- recursos que no están en el maestro (sin importar mayúsculas): se agregan
  INSERT INTO public.recurso (recurso_id, nombre, um, tipo, clase, modelo_equipo, ubicacion, dmt_km, id_alternativo,
                              codigo_unysoft, nombre_unysoft, activo, actualizado)
  SELECT DISTINCT ON (upper(trim(public._jtxt(x->'recurso_id'))))
         upper(trim(public._jtxt(x->'recurso_id'))), coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'um'), ''),
         coalesce(public._jtxt(x->'tipo'), ''), '', coalesce(public._jtxt(x->'detalle'), ''), '', '', '', '', '', true, now()
    FROM jsonb_array_elements(coalesce(p->'precios', '[]'::jsonb)) x
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.recurso r WHERE upper(r.recurso_id) = upper(trim(public._jtxt(x->'recurso_id'))));
  GET DIAGNOSTICS n_nuevos = ROW_COUNT;

  -- código tal como está en el maestro
  CREATE TEMP TABLE IF NOT EXISTS _rmap (k text PRIMARY KEY, id text) ON COMMIT DROP;
  TRUNCATE _rmap;
  INSERT INTO _rmap SELECT DISTINCT ON (upper(recurso_id)) upper(recurso_id), recurso_id FROM public.recurso ORDER BY upper(recurso_id), recurso_id;

  INSERT INTO public.costo_item (version_id, clave, es_insitu, item_id, orden, descripcion, um, cantidad, igual_a, prod_ph,
                                 tot_equipos, tot_mo, costo_ejec, tot_mat, tot_transp, costo_directo,
                                 gg_pct, bi_pct, iva_pct, costo_unitario, costo_adoptado, hoja)
  SELECT DISTINCT ON (trim(public._jtxt(x->'clave'))) v_id, trim(public._jtxt(x->'clave')),
         coalesce(public._jbool(x->'es_insitu'), false),
         (SELECT i.item_id FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = nullif(trim(public._jtxt(x->'item_id')), '')),
         public._jnum(x->'orden')::integer, coalesce(public._jtxt(x->'descripcion'), ''), coalesce(public._jtxt(x->'um'), ''),
         public._jnum(x->'cantidad'), coalesce(public._jtxt(x->'igual_a'), ''), public._jnum(x->'prod_ph'),
         public._jnum(x->'tot_equipos'), public._jnum(x->'tot_mo'), public._jnum(x->'costo_ejec'), public._jnum(x->'tot_mat'),
         public._jnum(x->'tot_transp'), public._jnum(x->'costo_directo'),
         public._jnum(x->'gg_pct'), public._jnum(x->'bi_pct'), public._jnum(x->'iva_pct'),
         public._jnum(x->'costo_unitario'), public._jnum(x->'costo_adoptado'), coalesce(public._jtxt(x->'hoja'), '')
    FROM jsonb_array_elements(p->'items') x
   WHERE trim(coalesce(public._jtxt(x->'clave'), '')) <> '';
  GET DIAGNOSTICS n_it = ROW_COUNT;

  INSERT INTO public.costo_linea (version_id, clave, bloque, orden, recurso_id, nombre, detalle, um, rendimiento, personal, horas,
                                  cuantia, desperdicio, dmt, cantidad, precio, parcial)
  SELECT DISTINCT ON (trim(public._jtxt(x->'clave')), public._jtxt(x->'bloque'), public._jnum(x->'orden')::integer)
         v_id, trim(public._jtxt(x->'clave')), public._jtxt(x->'bloque'), public._jnum(x->'orden')::integer,
         coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))),
         coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'detalle'), ''), coalesce(public._jtxt(x->'um'), ''),
         public._jnum(x->'rendimiento'), public._jnum(x->'personal'), public._jnum(x->'horas'),
         public._jnum(x->'cuantia'), public._jnum(x->'desperdicio'), public._jnum(x->'dmt'),
         public._jnum(x->'cantidad'), public._jnum(x->'precio'), public._jnum(x->'parcial')
    FROM jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) x
    LEFT JOIN _rmap m ON m.k = upper(trim(public._jtxt(x->'recurso_id')))
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> ''
     AND public._jtxt(x->'bloque') IN ('equipo', 'mano_obra', 'material', 'transporte')
     AND EXISTS (SELECT 1 FROM public.costo_item ci WHERE ci.version_id = v_id AND ci.clave = trim(public._jtxt(x->'clave')));
  GET DIAGNOSTICS n_li = ROW_COUNT;

  INSERT INTO public.costo_precio (version_id, recurso_id, tipo, nombre, um, detalle, precio, dmt, factor_dmt, precio_transporte)
  SELECT DISTINCT ON (coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))))
         v_id, coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))), coalesce(public._jtxt(x->'tipo'), ''),
         coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'um'), ''), coalesce(public._jtxt(x->'detalle'), ''),
         public._jnum(x->'precio'), public._jnum(x->'dmt'), public._jnum(x->'factor_dmt'), public._jnum(x->'precio_transporte')
    FROM jsonb_array_elements(coalesce(p->'precios', '[]'::jsonb)) x
    LEFT JOIN _rmap m ON m.k = upper(trim(public._jtxt(x->'recurso_id')))
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> '';
  GET DIAGNOSTICS n_pr = ROW_COUNT;

  -- precios de la obra (los que usa Compras): los del último recosteo; si no
  -- hay recosteos, los del presupuesto
  IF v_tipo = 'recosteo' OR NOT EXISTS (SELECT 1 FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'recosteo') THEN
    INSERT INTO public.recurso_precio (obra_id, recurso_id, precio_sin_iva, actualizado)
    SELECT p_obra, cp.recurso_id, cp.precio, now() FROM public.costo_precio cp
     WHERE cp.version_id = v_id AND cp.precio IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.recurso r WHERE r.recurso_id = cp.recurso_id)
    ON CONFLICT (obra_id, recurso_id) DO UPDATE SET precio_sin_iva = EXCLUDED.precio_sin_iva, actualizado = now();
  END IF;

  PERFORM public._cron_tocar(p_obra, false, NULL);
  RETURN json_build_object('version_id', v_id, 'items', n_it, 'lineas', n_li, 'precios', n_pr, 'recursos_nuevos', n_nuevos);
END $$;


CREATE OR REPLACE FUNCTION public.compras_desglose(p_obra text)
RETURNS TABLE(version_id bigint, version text, item_id text, recurso_id text, nombre text, tipo text,
              cant_unitaria numeric, costo_unitario numeric, recurso_padre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint; vn text;
BEGIN
  IF NOT public.app_puede_ver(p_obra) THEN
    RAISE EXCEPTION 'Sin permiso para ver la obra %', p_obra USING ERRCODE = '42501';
  END IF;
  SELECT cv.version_id, cv.nombre || ' · ' || to_char(cv.fecha, 'DD/MM/YYYY') INTO v, vn
    FROM public.costo_version cv WHERE cv.obra_id = p_obra
   ORDER BY (cv.tipo = 'recosteo') DESC, cv.fecha DESC, cv.version_id DESC LIMIT 1;
  IF v IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH it AS (      -- ítems del cronograma y de qué APU sacan sus recursos («Es igual a»)
    SELECT ci.item_id AS iid,
           coalesce((SELECT r.clave FROM public.costo_item r
                      WHERE r.version_id = v AND NOT r.es_insitu AND ci.igual_a <> ''
                        AND NOT EXISTS (SELECT 1 FROM public.costo_linea x WHERE x.version_id = v AND x.clave = ci.clave)
                        AND replace(lower(r.clave), ',', '.') = replace(lower(ci.igual_a), ',', '.') LIMIT 1), ci.clave) AS fuente
      FROM public.costo_item ci
     WHERE ci.version_id = v AND NOT ci.es_insitu AND ci.item_id IS NOT NULL
  ), lin AS (       -- consumo por unidad del dueño (ítem o in situ) y costo unitario del recurso
    SELECT l.clave, l.recurso_id AS rid, l.nombre AS nom, l.bloque,
           CASE l.bloque
             WHEN 'equipo'    THEN coalesce(l.cantidad, 0) / coalesce(nullif(ci.prod_ph, 0), 1)
             WHEN 'mano_obra' THEN coalesce(l.cantidad, coalesce(l.personal, 0) * coalesce(l.horas, 0)) / coalesce(nullif(ci.prod_ph, 0), 1)
             ELSE coalesce(l.cantidad, 0) END AS q,
           CASE WHEN l.bloque = 'transporte'
                THEN CASE WHEN coalesce(l.cantidad, 0) <> 0 THEN l.parcial / l.cantidad END
                ELSE l.precio END AS cu
      FROM public.costo_linea l
      JOIN public.costo_item ci ON ci.version_id = l.version_id AND ci.clave = l.clave
     WHERE l.version_id = v
  ), tip AS (
    SELECT * FROM (VALUES ('equipo', 'Equipos'), ('mano_obra', 'Mano de obra'), ('material', 'Materiales'), ('transporte', 'Transporte')) t(b, nom)
  )
  SELECT v, vn, it.iid,
         CASE WHEN l.bloque = 'transporte' THEN 'TR:' || l.rid ELSE l.rid END,
         CASE WHEN l.bloque = 'transporte' THEN 'Transporte de ' || l.nom ELSE l.nom END,
         tip.nom, l.q, l.cu, ''::text
    FROM it JOIN lin l ON l.clave = it.fuente JOIN tip ON tip.b = l.bloque
  UNION ALL
  SELECT v, vn, it.iid,
         CASE WHEN c.bloque = 'transporte' THEN 'TR:' || c.rid ELSE c.rid END,
         CASE WHEN c.bloque = 'transporte' THEN 'Transporte de ' || c.nom ELSE c.nom END,
         tip.nom, l.q * c.q, c.cu, l.rid
    FROM it JOIN lin l ON l.clave = it.fuente AND l.bloque = 'material'
    JOIN lin c ON upper(c.clave) = 'IS:' || upper(l.rid)
    JOIN tip ON tip.b = c.bloque;
END $$;

REVOKE ALL ON FUNCTION public.compras_desglose(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_desglose(text) TO authenticated;
REVOKE ALL ON FUNCTION public.costo_importar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.costo_importar(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
