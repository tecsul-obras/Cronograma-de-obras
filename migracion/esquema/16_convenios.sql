-- =============================================================================
-- 16_convenios.sql — Convenios modificatorios desde la PWA (rehecho)
-- Cronograma de Obra · TECSUL · v20261004a
--
-- Modelo (igual que la planilla del C.M.): cada fila del convenio guarda la
-- CANTIDAD RESULTANTE del ítem después del convenio (no la diferencia). La
-- diferencia se calcula contra la cantidad contractual que había ANTES de este
-- convenio (contrato + convenios anteriores no rechazados).
--
--   conv_guardar  : cabecera + filas. Los ítems nuevos se crean en el
--                   cronograma (cantidad de contrato 0, su precio) para poder
--                   planificarlos durante el trámite; no se pueden certificar
--                   hasta que el convenio se apruebe.
--   conv_estado   : en trámite / aprobado / rechazado. Aprobar sube el tope de
--                   certificación (item.cant_convenio) y suma los días al fin.
--   conv_borrar   : solo admin, escribiendo el N° del convenio.
--
-- item.cant_convenio es un caché: la cantidad del último convenio APROBADO que
-- toca el ítem. Se recalcula siempre desde convenio_detalle (_conv_recalcular).
--
-- Estados en la base: 'presentado' = en trámite (la PWA dice "en trámite").
-- Requiere 13. Ejecutar completo en el SQL Editor.
-- =============================================================================
BEGIN;

ALTER TABLE public.convenio_detalle ADD COLUMN IF NOT EXISTS justificacion text NOT NULL DEFAULT '';
ALTER TABLE public.convenio ADD COLUMN IF NOT EXISTS fecha_suscripcion date;

-- ------------------------------------------------- recalcular el caché
CREATE OR REPLACE FUNCTION public._conv_recalcular(p_obra text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.item i SET cant_convenio = x.cant
  FROM (
    SELECT it.item_id,
           (SELECT d.cant FROM public.convenio_detalle d
              JOIN public.convenio c ON c.obra_id = d.obra_id AND c.convenio_id = d.convenio_id
             WHERE d.obra_id = p_obra AND d.item_id = it.item_id AND c.estado = 'aprobado'
             ORDER BY c.orden DESC LIMIT 1) AS cant
    FROM public.item it WHERE it.obra_id = p_obra
  ) x
  WHERE i.obra_id = p_obra AND i.item_id = x.item_id AND i.cant_convenio IS DISTINCT FROM x.cant
$$;

-- cantidad contractual de cada ítem ANTES del convenio de orden p_orden
-- (contrato + convenios anteriores que no estén rechazados)
CREATE OR REPLACE FUNCTION public._conv_previo(p_obra text, p_orden integer)
RETURNS TABLE (item_id text, cant numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT it.item_id,
         coalesce((SELECT d.cant FROM public.convenio_detalle d
                     JOIN public.convenio c ON c.obra_id = d.obra_id AND c.convenio_id = d.convenio_id
                    WHERE d.obra_id = p_obra AND d.item_id = it.item_id AND c.estado <> 'rechazado' AND c.orden < p_orden
                    ORDER BY c.orden DESC LIMIT 1), it.cant_contrato)
  FROM public.item it WHERE it.obra_id = p_obra
$$;

-- ======================================================================= guardar
/* p_conv  = { convenio_id?, nro?, tipo?('modificatorio'|'ampliacion_informal'), estado?,
              fecha_presentacion?, fecha_resolucion?, fecha_suscripcion?, dias_ampliacion?,
              fecha_fin_contrato?, descripcion?, doc_url? }
   p_filas = [ { item_id, cant, pu?, descripcion?, um?, categoria?, justificacion? } ]
             cant = cantidad RESULTANTE. Un ítem que no existe en la obra es un ítem NUEVO:
             necesita descripción, unidad y precio. */
CREATE OR REPLACE FUNCTION public.conv_guardar(p_obra text, p_conv jsonb, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id text := nullif(public._jtxt(p_conv->'convenio_id'), '');
        v_orden integer; v_nro text := public._jtxt(p_conv->'nro');
        v_tipo text := lower(public._jtxt(p_conv->'tipo'));
        v_est text := lower(public._jtxt(p_conv->'estado'));
        nuevo boolean := false; x jsonb; iid text; n_nuevos integer := 0; maxord integer; faltan text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF v_tipo NOT IN ('modificatorio', 'ampliacion_informal') THEN v_tipo := 'modificatorio'; END IF;
  v_est := CASE v_est WHEN 'aprobado' THEN 'aprobado' WHEN 'rechazado' THEN 'rechazado' ELSE 'presentado' END;

  IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.convenio WHERE obra_id = p_obra AND convenio_id = v_id) THEN
    nuevo := true;
    SELECT coalesce(max(orden), 0) + 1 INTO v_orden FROM public.convenio WHERE obra_id = p_obra;
    v_id := coalesce(v_id, 'cv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    IF v_nro = '' THEN v_nro := 'C.M. N° ' || v_orden; END IF;
  ELSE
    SELECT orden INTO v_orden FROM public.convenio WHERE obra_id = p_obra AND convenio_id = v_id;
  END IF;

  -- ítems nuevos: validar antes de tocar nada
  SELECT string_agg(public._jtxt(f->'item_id'), ', ') INTO faltan
  FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
  WHERE public._jtxt(f->'item_id') <> ''
    AND NOT EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = public._jtxt(f->'item_id'))
    AND (public._jtxt(f->'descripcion') = '' OR coalesce(public._jnum(f->'pu'), 0) = 0);
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Los ítems nuevos necesitan descripción y precio unitario: %', faltan USING ERRCODE = '22023';
  END IF;

  IF nuevo THEN
    INSERT INTO public.convenio (obra_id, convenio_id, orden, nro, tipo, estado, descripcion)
    VALUES (p_obra, v_id, v_orden, v_nro, v_tipo, v_est, '');
  END IF;
  UPDATE public.convenio SET
    nro                = CASE WHEN v_nro <> '' THEN v_nro ELSE nro END,
    tipo               = v_tipo,
    estado             = CASE WHEN p_conv ? 'estado' THEN v_est ELSE estado END,
    fecha_presentacion = CASE WHEN p_conv ? 'fecha_presentacion' THEN public._jfecha(p_conv->'fecha_presentacion') ELSE fecha_presentacion END,
    fecha_resolucion   = CASE WHEN p_conv ? 'fecha_resolucion' THEN public._jfecha(p_conv->'fecha_resolucion') ELSE fecha_resolucion END,
    fecha_suscripcion  = CASE WHEN p_conv ? 'fecha_suscripcion' THEN public._jfecha(p_conv->'fecha_suscripcion') ELSE fecha_suscripcion END,
    dias_ampliacion    = CASE WHEN p_conv ? 'dias_ampliacion' THEN round(public._jnum(p_conv->'dias_ampliacion'))::integer ELSE dias_ampliacion END,
    fecha_fin_contrato = CASE WHEN p_conv ? 'fecha_fin_contrato' THEN public._jfecha(p_conv->'fecha_fin_contrato') ELSE fecha_fin_contrato END,
    descripcion        = CASE WHEN p_conv ? 'descripcion' THEN public._jtxt(p_conv->'descripcion') ELSE descripcion END,
    doc_url            = CASE WHEN p_conv ? 'doc_url' THEN public._jtxt(p_conv->'doc_url') ELSE doc_url END
  WHERE obra_id = p_obra AND convenio_id = v_id;

  -- crear los ítems nuevos en el cronograma (al final, con su precio y cantidad de contrato 0)
  SELECT coalesce(max(orden), 0) INTO maxord FROM public.item WHERE obra_id = p_obra;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    iid := public._jtxt(x->'item_id');
    CONTINUE WHEN iid = '';
    IF EXISTS (SELECT 1 FROM public.item WHERE obra_id = p_obra AND item_id = iid) THEN
      -- ítem nuevo ya creado (cantidad de contrato 0): se pueden corregir su descripción, unidad y precio
      IF coalesce(public._jnum(x->'pu'), 0) <> 0 THEN
        UPDATE public.item SET precio_unit = public._jnum(x->'pu'),
               descripcion = coalesce(nullif(public._jtxt(x->'descripcion'), ''), descripcion),
               um = coalesce(nullif(public._jtxt(x->'um'), ''), um)
         WHERE obra_id = p_obra AND item_id = iid AND cant_contrato = 0;
      END IF;
      CONTINUE;
    END IF;
    maxord := maxord + 1; n_nuevos := n_nuevos + 1;
    INSERT INTO public.item (obra_id, item_id, descripcion, um, cant_contrato, precio_unit, categoria, estado,
                             nivel, es_grupo, tipo, orden)
    VALUES (p_obra, iid, public._jtxt(x->'descripcion'), public._jtxt(x->'um'), 0, public._jnum(x->'pu'),
            coalesce(nullif(public._jtxt(x->'categoria'), ''), 'Sin categoría'), 'Pendiente', 1, false, 'item', maxord);
  END LOOP;

  -- filas: tipo según la cantidad contractual previa; las que no cambian no se guardan
  DELETE FROM public.convenio_detalle WHERE obra_id = p_obra AND convenio_id = v_id;
  IF v_tipo = 'modificatorio' THEN
    INSERT INTO public.convenio_detalle (obra_id, convenio_id, item_id, tipo, cant, pu, justificacion)
    SELECT p_obra, v_id, f.item_id,
           CASE WHEN coalesce(pr.cant, 0) = 0 AND f.cant > 0 AND it.cant_contrato = 0 THEN 'item_nuevo'
                WHEN f.cant = 0 THEN 'supresion'
                WHEN f.cant > coalesce(pr.cant, 0) THEN 'aumento'
                ELSE 'disminucion' END,
           f.cant,
           CASE WHEN coalesce(pr.cant, 0) = 0 AND f.cant > 0 AND it.cant_contrato = 0 THEN it.precio_unit END,
           f.just
    FROM (
      SELECT DISTINCT ON (item_id) item_id, cant, just
      FROM (SELECT public._jtxt(e->'item_id') AS item_id, coalesce(public._jnum(e->'cant'), 0) AS cant,
                   public._jtxt(e->'justificacion') AS just, ord
              FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)) s
      WHERE item_id <> '' ORDER BY item_id, ord DESC
    ) f
    JOIN public.item it ON it.obra_id = p_obra AND it.item_id = f.item_id
    LEFT JOIN public._conv_previo(p_obra, v_orden) pr ON pr.item_id = f.item_id
    WHERE f.cant IS DISTINCT FROM coalesce(pr.cant, 0) OR f.just <> '';
  END IF;

  PERFORM public._conv_recalcular(p_obra);
  PERFORM public._cron_tocar(p_obra, true);      -- cambia cantidades del cronograma: sube la revisión
  RETURN json_build_object('convenio_id', v_id, 'orden', v_orden, 'nro', (SELECT nro FROM public.convenio WHERE obra_id = p_obra AND convenio_id = v_id),
                           'filas', (SELECT count(*) FROM public.convenio_detalle WHERE obra_id = p_obra AND convenio_id = v_id),
                           'items_nuevos', n_nuevos);
END $$;

-- ======================================================================= estado
CREATE OR REPLACE FUNCTION public.conv_estado(p_obra text, p_convenio text, p_estado text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_est text := CASE lower(coalesce(p_estado, '')) WHEN 'aprobado' THEN 'aprobado' WHEN 'rechazado' THEN 'rechazado' ELSE 'presentado' END;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF v_est = 'aprobado' AND NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede aprobar un convenio (sube el tope de certificación).' USING ERRCODE = '42501';
  END IF;
  UPDATE public.convenio SET estado = v_est,
         fecha_resolucion = CASE WHEN v_est = 'aprobado' THEN coalesce(fecha_resolucion, (now() AT TIME ZONE 'America/Asuncion')::date) ELSE fecha_resolucion END
   WHERE obra_id = p_obra AND convenio_id = p_convenio;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convenio no encontrado' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._conv_recalcular(p_obra);
  PERFORM public._cron_tocar(p_obra, true);
  RETURN json_build_object('convenio_id', p_convenio, 'estado', CASE v_est WHEN 'presentado' THEN 'en_tramite' ELSE v_est END);
END $$;

-- ======================================================================= borrar
CREATE OR REPLACE FUNCTION public.conv_borrar(p_obra text, p_convenio text, p_confirm text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; borrados integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar un convenio.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.convenio WHERE obra_id = p_obra AND convenio_id = p_convenio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convenio no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF btrim(coalesce(p_confirm, '')) <> btrim(c.nro) THEN
    RAISE EXCEPTION 'Para borrar el convenio hay que escribir su número exacto (%).', c.nro USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.linea_base WHERE obra_id = p_obra AND convenio_id = p_convenio) THEN
    RAISE EXCEPTION 'El convenio % tiene una línea base asociada: borrala primero.', c.nro USING ERRCODE = '23503';
  END IF;
  -- ítems que nacieron con este convenio y no tienen nada cargado: se van con él
  DELETE FROM public.item i
   WHERE i.obra_id = p_obra AND i.cant_contrato = 0
     AND EXISTS (SELECT 1 FROM public.convenio_detalle d WHERE d.obra_id = p_obra AND d.convenio_id = p_convenio
                  AND d.item_id = i.item_id AND d.tipo = 'item_nuevo')
     AND NOT EXISTS (SELECT 1 FROM public.convenio_detalle d WHERE d.obra_id = p_obra AND d.convenio_id <> p_convenio AND d.item_id = i.item_id)
     AND NOT EXISTS (SELECT 1 FROM public.certificacion x WHERE x.obra_id = p_obra AND x.item_id = i.item_id)
     AND NOT EXISTS (SELECT 1 FROM public.produccion_fila x WHERE x.obra_id = p_obra AND x.item_id = i.item_id);
  GET DIAGNOSTICS borrados = ROW_COUNT;
  DELETE FROM public.convenio WHERE obra_id = p_obra AND convenio_id = p_convenio;   -- el detalle cae en cascada
  PERFORM public._conv_recalcular(p_obra);
  PERFORM public._cron_tocar(p_obra, true);
  RETURN json_build_object('borrado', p_convenio, 'items_borrados', borrados);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.conv_guardar(text,jsonb,jsonb)', 'public.conv_estado(text,text,text)',
                           'public.conv_borrar(text,text,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public._conv_recalcular(text), public._conv_previo(text, integer) FROM PUBLIC, anon, authenticated;
END $$;

-- ------------------------------------------------- estado real de los convenios
-- Ruta de la Banana: el C.M. N° 2 todavía está EN TRÁMITE (José, 03/10/2026).
UPDATE public.convenio SET estado = 'presentado' WHERE obra_id = '1012500000' AND convenio_id = 'cv_cm02';
-- Nombre como en los documentos del MOPC
UPDATE public.convenio SET nro = 'C.M. N° ' || orden WHERE nro ~ '^CM-\d+$';
SELECT public._conv_recalcular(o.obra_id) FROM public.obra o;

COMMIT;

SELECT obra_id, orden, nro, CASE estado WHEN 'presentado' THEN 'en trámite' ELSE estado END AS estado,
       (SELECT count(*) FROM public.convenio_detalle d WHERE d.obra_id = c.obra_id AND d.convenio_id = c.convenio_id) AS filas
FROM public.convenio c ORDER BY obra_id, orden;
