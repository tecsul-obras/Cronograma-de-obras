-- =============================================================================
-- 14_escrituras_operativas.sql — Etapa 4: producción, certificación,
-- comunicaciones y situación de pista desde la PWA
-- Cronograma de Obra · TECSUL · v20261003d
--
-- Una función por acción del Apps Script viejo (Code_Producción.gs,
-- Code_Comunicaciones.gs, Code Pista.gs), con la misma semántica:
--
--   prod_guardar / prod_editar / prod_borrar          (jornadas de liberación)
--   cert_guardar                                      (reemplaza UN mes, con tope)
--   com_guardar / com_cerrar / com_borrar             (archivo de notas)
--   pista_guardar_ejes / _estados / _tramos / pista_snapshot
--
-- Además: columnas que faltaban para guardar lo mismo que la hoja vieja
-- (longitud, área, volumen y cantidad tipeada de cada fila; formato, tipo,
-- cota y "en proceso" de la pista) y el depósito de FOTOS en Supabase Storage.
--
-- Requiere 13_escrituras_cronograma.sql (usa sus utilidades _j* y _cron_*).
-- Ejecutar completo en el SQL Editor. Es idempotente: se puede volver a correr.
-- =============================================================================
BEGIN;

-- ------------------------------------------------------- columnas nuevas
ALTER TABLE public.produccion_fila
  ADD COLUMN IF NOT EXISTS longitud      numeric,
  ADD COLUMN IF NOT EXISTS area          numeric,
  ADD COLUMN IF NOT EXISTS volumen       numeric,
  ADD COLUMN IF NOT EXISTS cantidad_dato numeric;     -- la "Cantidad" tipeada (la final es `cantidad`)

ALTER TABLE public.pista_eje    ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'pk';
ALTER TABLE public.pista_estado
  ADD COLUMN IF NOT EXISTS tipo             text    NOT NULL DEFAULT 'capa',
  ADD COLUMN IF NOT EXISTS derivable        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alias_liberacion text    NOT NULL DEFAULT '';
ALTER TABLE public.pista_tramo
  ADD COLUMN IF NOT EXISTS orden      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cota       numeric,
  ADD COLUMN IF NOT EXISTS en_proceso boolean NOT NULL DEFAULT false;
-- (la observación del tramo va en la columna `nota` que ya existía)

-- Vista para Power BI: ahora con la cantidad tipeada, longitud, área y volumen guardados
CREATE OR REPLACE VIEW public.v_powerbi_liberacion WITH (security_invoker = true) AS
SELECT j.submission_id AS "Submission ID",
       j.responsable AS "Responsable registro",
       to_char(j.fecha::timestamptz, 'YYYY-MM-DD') AS "Fecha liberación",
       f.lado AS "Lado",
       f.prog_ini AS "Progresiva inicial",
       f.prog_fin AS "Progresiva Final",
       coalesce(f.cantidad_dato, f.cantidad) AS "Cantidad",
       f.observaciones AS "Observaciones",
       f.cantidad AS "Cant. Final Producida",
       i.um AS "U.M.",
       coalesce(f.longitud, f.prog_fin - f.prog_ini) AS "Longitud (m)",
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
       coalesce(f.area, (f.prog_fin - f.prog_ini) * f.ancho_prom) AS "Área (m2)",
       f.espesor_prom AS "Espesor Promedio (m)",
       coalesce(f.volumen, (f.prog_fin - f.prog_ini) * f.ancho_prom * f.espesor_prom) AS "Volumen (m3)",
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

-- ------------------------------------------------------------ utilidades
-- Número es-PY para mensajes: 19888.869 → '19888,869' (sin redondear)
CREATE OR REPLACE FUNCTION public._num_py(n numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n IS NULL THEN '0'
              WHEN n = trunc(n) THEN trunc(n)::text
              ELSE replace(rtrim(rtrim(n::text, '0'), '.'), '.', ',') END
$$;

-- Espesor en metros (prodEspesorEnMetros_): 25 → 0,25 · 3 → 0,30 · 0,25 → 0,25
CREATE OR REPLACE FUNCTION public._espesor_m(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL OR v = 0 THEN NULL WHEN v > 10 THEN v / 100 WHEN v > 1 THEN v / 10 ELSE v END
$$;

-- Cascada de cantidad (prodCalc_): cantidad directa → volumen → área → longitud.
-- Devuelve (area, volumen, cant_final). Sin redondeo.
CREATE OR REPLACE FUNCTION public._prod_calc(p_long numeric, p_ancho numeric, p_esp numeric, p_cant numeric,
                                             p_area numeric, p_vol numeric, p_estado text,
                                             OUT area numeric, OUT volumen numeric, OUT cant_final numeric)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  area := coalesce(p_area, CASE WHEN coalesce(p_long, 0) <> 0 AND coalesce(p_ancho, 0) <> 0 THEN p_long * p_ancho END);
  volumen := coalesce(p_vol, CASE WHEN coalesce(area, 0) <> 0 AND public._espesor_m(p_esp) IS NOT NULL
                                  THEN area * public._espesor_m(p_esp) END);
  cant_final := NULL;
  IF p_estado = 'Con Actividad con liberaciones' THEN
    cant_final := CASE WHEN coalesce(p_cant, 0) <> 0 THEN p_cant
                       WHEN coalesce(volumen, 0) <> 0 THEN volumen
                       WHEN coalesce(area, 0) <> 0 THEN area
                       WHEN coalesce(p_long, 0) <> 0 THEN p_long END;
  END IF;
END $$;

-- ==================================================================== PRODUCCIÓN
/* Guarda una JORNADA: cabecera (fecha, estado, lluvia, nota del día, fotos) +
   N filas de ítems. p_jornada trae submission_id generado en el teléfono: si
   la cola offline reenvía algo que ya llegó, no se duplica. */
CREATE OR REPLACE FUNCTION public.prod_guardar(p_obra text, p_jornada jsonb, p_fotos text[] DEFAULT '{}')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid text := nullif(public._jtxt(p_jornada->'submission_id'), '');
        fecha date := public._jfecha(p_jornada->'fecha');
        estado text := public._jtxt(p_jornada->'estado');
        lluvia numeric := public._jnum(p_jornada->'lluvia_mm');
        yo text := public.app_email();
        resp text := public._jtxt(p_jornada->'responsable');
        n integer := 0; x jsonb; k integer := 0; c record; iid text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF fecha IS NULL THEN RAISE EXCEPTION 'Elegí la fecha de la jornada' USING ERRCODE = '22023'; END IF;
  IF estado = '' THEN RAISE EXCEPTION 'Elegí el estado de actividad' USING ERRCODE = '22023'; END IF;
  IF sid IS NULL THEN sid := 'pwa_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6); END IF;

  IF EXISTS (SELECT 1 FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid) THEN
    SELECT count(*) INTO n FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid;
    RETURN json_build_object('guardados', greatest(n, 1), 'submission_id', sid, 'fotos_urls',
             (SELECT to_json(fotos) FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid),
             'repetido', true);
  END IF;

  IF resp = '' THEN SELECT coalesce(nullif(nombre, ''), email) INTO resp FROM public.usuario WHERE email = yo; END IF;
  INSERT INTO public.produccion_jornada (obra_id, submission_id, fecha, estado, responsable, lluvia_mm,
                                         observaciones, fotos, cargado_por, cargado_en)
  VALUES (p_obra, sid, fecha, estado, coalesce(resp, ''), CASE WHEN lluvia > 0 THEN lluvia END,
          public._jtxt(p_jornada->'obs_jornada'), coalesce(p_fotos, '{}'), yo, now());

  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_jornada->'filas', '[]'::jsonb)) LOOP
    iid := public._jtxt(x->'item_id');
    CONTINUE WHEN iid = '' OR NOT EXISTS (SELECT 1 FROM public.item WHERE obra_id = p_obra AND item_id = iid);
    c := public._prod_calc(public._jnum(x->'longitud'), public._jnum(x->'ancho'), public._jnum(x->'espesor'),
                           public._jnum(x->'cantidad'), public._jnum(x->'area'), public._jnum(x->'volumen'), estado);
    k := k + 1;
    INSERT INTO public.produccion_fila (obra_id, submission_id, fila_nro, item_id, lado, prog_ini, prog_fin,
                                        cantidad, ancho_prom, espesor_prom, observaciones,
                                        longitud, area, volumen, cantidad_dato)
    VALUES (p_obra, sid, k, iid, public._jtxt(x->'lado'), public._jnum(x->'prog_ini'), public._jnum(x->'prog_fin'),
            coalesce(c.cant_final, 0), public._jnum(x->'ancho'), public._jnum(x->'espesor'),
            public._jtxt(x->'observaciones'),
            public._jnum(x->'longitud'), c.area, c.volumen, public._jnum(x->'cantidad'));
  END LOOP;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('guardados', greatest(k, 1), 'submission_id', sid, 'fotos_urls', to_json(coalesce(p_fotos, '{}')));
END $$;

/* p_id = "<submission_id>#<fila_nro>" para una fila, o "<submission_id>" para
   una jornada sin filas (día de lluvia, nota del día). Fecha, estado y lluvia
   son de la jornada: cambiarlos desde una fila los cambia para todo ese día. */
CREATE OR REPLACE FUNCTION public.prod_editar(p_obra text, p_id text, p_cambios jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid text; nro integer; j record; f record; est text; c record;
        l numeric; a numeric; e numeric; q numeric;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  sid := CASE WHEN position('#' IN p_id) > 0 THEN regexp_replace(p_id, '#[^#]*$', '') ELSE p_id END;
  nro := CASE WHEN position('#' IN p_id) > 0 THEN nullif(regexp_replace(p_id, '^.*#', ''), '')::integer END;
  SELECT * INTO j FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;

  est := CASE WHEN p_cambios ? 'estado' THEN public._jtxt(p_cambios->'estado') ELSE j.estado END;
  UPDATE public.produccion_jornada SET
    estado    = est,
    fecha     = CASE WHEN p_cambios ? 'fecha' AND public._jfecha(p_cambios->'fecha') IS NOT NULL
                     THEN public._jfecha(p_cambios->'fecha') ELSE fecha END,
    lluvia_mm = CASE WHEN p_cambios ? 'lluvia_mm' THEN nullif(public._jnum(p_cambios->'lluvia_mm'), 0) ELSE lluvia_mm END
  WHERE obra_id = p_obra AND submission_id = sid;

  IF nro IS NULL THEN
    PERFORM public._cron_tocar(p_obra, false);
    RETURN json_build_object('editado', p_id, 'cantFinal', NULL);
  END IF;

  SELECT * INTO f FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;
  l := CASE WHEN p_cambios ? 'longitud' THEN public._jnum(p_cambios->'longitud') ELSE f.longitud END;
  a := CASE WHEN p_cambios ? 'ancho'    THEN public._jnum(p_cambios->'ancho')    ELSE f.ancho_prom END;
  e := CASE WHEN p_cambios ? 'espesor'  THEN public._jnum(p_cambios->'espesor')  ELSE f.espesor_prom END;
  q := CASE WHEN p_cambios ? 'cantidad' THEN public._jnum(p_cambios->'cantidad') ELSE f.cantidad_dato END;
  -- filas migradas sin dimensiones: la cantidad que había es el dato
  IF q IS NULL AND NOT (p_cambios ? 'cantidad') AND l IS NULL AND a IS NULL THEN q := f.cantidad; END IF;
  c := public._prod_calc(l, a, e, q, NULL, NULL, est);

  UPDATE public.produccion_fila SET
    lado          = CASE WHEN p_cambios ? 'lado' THEN public._jtxt(p_cambios->'lado') ELSE lado END,
    observaciones = CASE WHEN p_cambios ? 'observaciones' THEN public._jtxt(p_cambios->'observaciones') ELSE observaciones END,
    prog_ini      = CASE WHEN p_cambios ? 'prog_ini' THEN public._jnum(p_cambios->'prog_ini') ELSE prog_ini END,
    prog_fin      = CASE WHEN p_cambios ? 'prog_fin' THEN public._jnum(p_cambios->'prog_fin') ELSE prog_fin END,
    longitud = l, ancho_prom = a, espesor_prom = e, cantidad_dato = q,
    area = c.area, volumen = c.volumen, cantidad = coalesce(c.cant_final, 0)
  WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('editado', p_id, 'cantFinal', c.cant_final);
END $$;

CREATE OR REPLACE FUNCTION public.prod_borrar(p_obra text, p_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid text; nro integer; quedan integer; est text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  sid := CASE WHEN position('#' IN p_id) > 0 THEN regexp_replace(p_id, '#[^#]*$', '') ELSE p_id END;
  nro := CASE WHEN position('#' IN p_id) > 0 THEN nullif(regexp_replace(p_id, '^.*#', ''), '')::integer END;
  SELECT estado INTO est FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;

  IF nro IS NULL THEN
    DELETE FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid;   -- filas en cascada
  ELSE
    DELETE FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;
    SELECT count(*) INTO quedan FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid;
    -- una jornada de liberaciones que se queda sin filas ya no dice nada: se va con su última fila
    IF quedan = 0 AND est ILIKE '%con actividad con liberaciones%' THEN
      DELETE FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid;
    END IF;
  END IF;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('borrado', p_id);
END $$;

-- ================================================================= CERTIFICACIÓN
/* Guarda las cantidades certificadas de UN mes: reemplaza ese mes de la obra y
   no toca los demás. Los negativos (deducciones) se guardan tal cual. Tope
   duro (validarTopeCertificacion_): pública = contractual, privada = vigente. */
CREATE OR REPLACE FUNCTION public.cert_guardar(p_obra text, p_mes text, p_filas jsonb, p_nro text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mes text := public._jmes(to_jsonb(coalesce(p_mes, ''))); n integer := 0;
        publica boolean; det text; total_exc integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF v_mes IS NULL THEN RAISE EXCEPTION 'Falta el mes de la certificación' USING ERRCODE = '22023'; END IF;
  SELECT tipo_obra = 'publica' INTO publica FROM public.obra WHERE obra_id = p_obra FOR UPDATE;

  DROP TABLE IF EXISTS pg_temp._ce;
  CREATE TEMP TABLE _ce ON COMMIT DROP AS
  SELECT DISTINCT ON (item_id) item_id, cant, obs
  FROM (
    SELECT public._jtxt(x->'item_id') AS item_id, coalesce(public._jnum(x->'cant_certificada'), 0) AS cant,
           public._jtxt(x->'observacion') AS obs, ord
    FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord)
  ) s
  WHERE item_id <> '' AND (cant <> 0 OR obs <> '')
    AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
  ORDER BY item_id, ord DESC;

  -- tope: lo de OTROS meses + lo de este mes
  WITH ex AS (
    SELECT ce.item_id, coalesce(o.otros, 0) AS ya, ce.cant AS este, coalesce(o.otros, 0) + ce.cant AS total,
           CASE WHEN publica THEN i.cant_contractual ELSE i.cant_vigente END AS tope
    FROM _ce ce
    JOIN public.item i ON i.obra_id = p_obra AND i.item_id = ce.item_id
    LEFT JOIN (SELECT item_id, sum(cant_certificada) AS otros FROM public.certificacion
                WHERE obra_id = p_obra AND certificacion.mes <> v_mes GROUP BY item_id) o ON o.item_id = ce.item_id
  ), malos AS (
    SELECT * FROM ex WHERE tope IS NOT NULL AND total > tope + 0.000001 ORDER BY item_id
  )
  SELECT string_agg('· ' || item_id || ': ' || public._num_py(ya) || ' ya certificado en otros meses + ' ||
                    public._num_py(este) || ' de este mes = ' || public._num_py(total) ||
                    ', sobre un tope de ' || public._num_py(tope) || ' (exceso ' || public._num_py(total - tope) || ')',
                    E'\n') FILTER (WHERE rn <= 8),
         count(*)::integer
    INTO det, total_exc
  FROM (SELECT *, row_number() OVER (ORDER BY item_id) rn FROM malos) m;

  IF total_exc > 0 THEN
    RAISE EXCEPTION '%', CASE WHEN publica THEN
        'No se puede certificar por encima de la cantidad contractual aprobada.' || E'\n' || det ||
        CASE WHEN total_exc > 8 THEN E'\n… y ' || (total_exc - 8) || ' ítem(s) más.' ELSE '' END ||
        E'\n\nSi el aumento ya está ejecutado, cargá el convenio modificatorio y aprobalo. Mientras el convenio esté EN TRÁMITE el tope no sube.'
      ELSE
        'No se puede certificar por encima de la cantidad ajustada del ítem.' || E'\n' || det ||
        CASE WHEN total_exc > 8 THEN E'\n… y ' || (total_exc - 8) || ' ítem(s) más.' ELSE '' END ||
        E'\n\nEsta obra es PRIVADA: el techo es la cantidad ajustada. Si el aumento ya se acordó con el comitente, subí la cantidad ajustada del ítem en el cronograma.'
      END USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.certificacion WHERE obra_id = p_obra AND certificacion.mes = v_mes;
  INSERT INTO public.certificacion (obra_id, item_id, mes, cant_certificada, observacion, nro_certificado, guardado_por, guardado_en)
  SELECT p_obra, item_id, v_mes, cant, obs, coalesce(p_nro, ''), public.app_email(), now() FROM _ce;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('guardados', n, 'mes', v_mes);
END $$;

-- ================================================================ COMUNICACIONES
/* Alta (sin com_id) o edición. Una nota cerrada no se edita (lo frena también
   el trigger de la tabla). de/para de la PWA = remitente/destinatario. */
CREATE OR REPLACE FUNCTION public.com_guardar(p_obra text, p_nota jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid text := public._jtxt(p_nota->'com_id'); alta boolean; ant record;
        v_asunto text := public._jtxt(p_nota->'asunto'); v_de text := public._jtxt(p_nota->'de');
        v_para text := public._jtxt(p_nota->'para'); v_resp text := nullif(public._jtxt(p_nota->'resp_a'), '');
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF v_asunto = '' THEN RAISE EXCEPTION 'La nota necesita un asunto.' USING ERRCODE = '22023'; END IF;
  IF v_de = '' OR v_para = '' THEN RAISE EXCEPTION 'Cargá de quién viene y a quién va la nota.' USING ERRCODE = '22023'; END IF;
  alta := cid = '';
  IF NOT alta THEN
    SELECT * INTO ant FROM public.comunicacion WHERE obra_id = p_obra AND com_id = cid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la nota que querés editar.' USING ERRCODE = 'P0002'; END IF;
    IF ant.cerrada THEN
      RAISE EXCEPTION 'Esta nota está cerrada y no se puede modificar. Registrá una nota nueva encadenada a ella.' USING ERRCODE = '22023';
    END IF;
  ELSE
    cid := 'COM' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
  END IF;
  IF v_resp IS NOT NULL AND v_resp = cid THEN
    RAISE EXCEPTION 'Una nota no puede responderse a sí misma.' USING ERRCODE = '22023';
  END IF;
  IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comunicacion x WHERE x.obra_id = p_obra AND x.com_id = v_resp) THEN
    RAISE EXCEPTION 'La nota que estás respondiendo no existe en esta obra.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.comunicacion AS c (obra_id, com_id, nro, fecha_nota, fecha_recepcion, remitente, destinatario,
         asunto, resumen, tipo, medio, requiere_resp, vence, resp_a, responsable, link, creado_por, creado_en)
  VALUES (p_obra, cid, public._jtxt(p_nota->'nro'), public._jfecha(p_nota->'fecha_nota'),
          public._jfecha(p_nota->'fecha_recepcion'), v_de, v_para, v_asunto, public._jtxt(p_nota->'resumen'),
          public._jtxt(p_nota->'tipo'), public._jtxt(p_nota->'medio'),
          lower(public._jtxt(p_nota->'requiere_resp')) NOT IN ('', '0', 'false', 'no'),
          public._jfecha(p_nota->'vence'), v_resp, public._jtxt(p_nota->'responsable'), public._jtxt(p_nota->'link'),
          public.app_email(), now())
  ON CONFLICT (obra_id, com_id) DO UPDATE SET
    nro = EXCLUDED.nro, fecha_nota = EXCLUDED.fecha_nota, fecha_recepcion = EXCLUDED.fecha_recepcion,
    remitente = EXCLUDED.remitente, destinatario = EXCLUDED.destinatario, asunto = EXCLUDED.asunto,
    resumen = EXCLUDED.resumen, tipo = EXCLUDED.tipo, medio = EXCLUDED.medio,
    requiere_resp = EXCLUDED.requiere_resp, vence = EXCLUDED.vence, resp_a = EXCLUDED.resp_a,
    responsable = EXCLUDED.responsable, link = EXCLUDED.link;   -- creado_por / creado_en se conservan

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('com_id', cid, 'alta', alta);
END $$;

-- Cerrar es irreversible: no hay "reabrir" (se registra una nota nueva encadenada).
CREATE OR REPLACE FUNCTION public.com_cerrar(p_obra text, p_com text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ya boolean;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  SELECT cerrada INTO ya FROM public.comunicacion WHERE obra_id = p_obra AND com_id = p_com FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la nota.' USING ERRCODE = 'P0002'; END IF;
  IF ya THEN RETURN json_build_object('cerrada', p_com, 'ya', true); END IF;
  UPDATE public.comunicacion SET cerrada = true, cerrada_por = public.app_email()
   WHERE obra_id = p_obra AND com_id = p_com;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('cerrada', p_com);
END $$;

-- Solo admin, solo si no está cerrada y nadie le respondió (no deja hilos huérfanos).
CREATE OR REPLACE FUNCTION public.com_borrar(p_obra text, p_com text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cer boolean; hijos integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar una nota del archivo' USING ERRCODE = '42501';
  END IF;
  SELECT cerrada INTO cer FROM public.comunicacion WHERE obra_id = p_obra AND com_id = p_com FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la nota.' USING ERRCODE = 'P0002'; END IF;
  IF cer THEN RAISE EXCEPTION 'Una nota cerrada no se borra: es un registro definitivo.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO hijos FROM public.comunicacion WHERE obra_id = p_obra AND resp_a = p_com;
  IF hijos > 0 THEN
    RAISE EXCEPTION 'No se puede borrar: hay % nota(s) encadenada(s) como respuesta a esta. Desencadenalas primero.', hijos
      USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.comunicacion WHERE obra_id = p_obra AND com_id = p_com;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('borrada', p_com);
END $$;

-- ============================================================ SITUACIÓN DE PISTA
-- Catálogo propuesto cuando la obra todavía no tiene uno propio (pistaEstadosDefault_)
CREATE OR REPLACE FUNCTION public._pista_estados_default(p_obra text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.pista_estado (obra_id, estado_id, nombre, color, orden, tipo, derivable, alias_liberacion)
  SELECT p_obra, e.id, e.nombre, e.color, e.orden, e.tipo, e.der, e.alias
  FROM (VALUES ('base',   'Base de asiento',          '#b8895c', 10, 'capa',   true,  'Base de asiento'),
               ('terr',   'Terraplén',                '#e0a458', 20, 'capa',   false, ''),
               ('terrc',  'Terraplén en corte',       '#a97038', 25, 'capa',   false, ''),
               ('subr',   'Subrasante',               '#4f9e63', 30, 'capa',   true,  'Subrasante'),
               ('reg',    'Regularización asfáltica', '#414e59', 40, 'capa',   true,  'Regularización asf.'),
               ('puente', 'Puente',                   '#9aa7b1', 0,  'neutro', false, ''),
               ('sinint', 'Sin intervención',         '#cdd5db', 0,  'neutro', false, '')
       ) AS e(id, nombre, color, orden, tipo, der, alias)
  WHERE NOT EXISTS (SELECT 1 FROM public.pista_estado WHERE obra_id = p_obra)
$$;

/* Ejes: set completo. Borrar un eje borra sus tramos y snapshots. */
CREATE OR REPLACE FUNCTION public.pista_guardar_ejes(p_obra text, p_ejes jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; k integer := 0; ini numeric; fin numeric; nombre text; eid text;
        vistos text[] := '{}'; borrados integer := 0; ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_ejes, '[]'::jsonb)) LOOP
    k := k + 1;
    ini := public._jnum(x->'prog_ini'); fin := public._jnum(x->'prog_fin');
    nombre := coalesce(nullif(public._jtxt(x->'nombre'), ''), 'Eje ' || k);
    IF ini IS NULL OR fin IS NULL THEN
      RAISE EXCEPTION 'El eje "%" no tiene progresiva inicial y final.', nombre USING ERRCODE = '22023';
    END IF;
    IF fin - ini <= 0.001 THEN
      RAISE EXCEPTION 'El eje "%": la progresiva final tiene que ser mayor que la inicial.', nombre USING ERRCODE = '22023';
    END IF;
    eid := coalesce(nullif(public._jtxt(x->'eje_id'), ''), 'eje_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    IF eid = ANY(vistos) THEN
      RAISE EXCEPTION 'Hay dos ejes con el mismo identificador (%).', eid USING ERRCODE = '23505';
    END IF;
    vistos := vistos || eid;
    INSERT INTO public.pista_eje (obra_id, eje_id, nombre, prog_ini, prog_fin, formato, orden)
    VALUES (p_obra, eid, nombre, ini, fin, CASE WHEN public._jtxt(x->'formato') = 'plano' THEN 'plano' ELSE 'pk' END, k - 1)
    ON CONFLICT (obra_id, eje_id) DO UPDATE SET nombre = EXCLUDED.nombre, prog_ini = EXCLUDED.prog_ini,
      prog_fin = EXCLUDED.prog_fin, formato = EXCLUDED.formato, orden = EXCLUDED.orden;
    ids := ids || jsonb_build_object('eje_id', eid, 'nombre', nombre);
  END LOOP;
  SELECT count(*) INTO borrados FROM public.pista_tramo WHERE obra_id = p_obra AND NOT (eje_id = ANY(vistos));
  DELETE FROM public.pista_eje WHERE obra_id = p_obra AND NOT (eje_id = ANY(vistos));
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('ok', true, 'ejes', k, 'tramos_borrados', borrados, 'ids', ids);
END $$;

/* Catálogo de estados: set completo. Un estado en uso no se puede quitar. */
CREATE OR REPLACE FUNCTION public.pista_guardar_estados(p_obra text, p_estados jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; k integer := 0; nombre text; eid text; tipo text; vistos text[] := '{}';
        faltan text; ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF jsonb_array_length(coalesce(p_estados, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El catálogo no puede quedar vacío: la obra necesita al menos un estado.' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_estados) LOOP
    k := k + 1;
    nombre := public._jtxt(x->'nombre');
    IF nombre = '' THEN RAISE EXCEPTION 'Hay un estado sin nombre en el catálogo.' USING ERRCODE = '22023'; END IF;
    eid := coalesce(nullif(public._jtxt(x->'estado_id'), ''), 'est_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    IF eid = ANY(vistos) THEN
      RAISE EXCEPTION 'Hay dos estados con el mismo identificador (%).', eid USING ERRCODE = '23505';
    END IF;
    vistos := vistos || eid;
    tipo := CASE WHEN lower(public._jtxt(x->'tipo')) = 'neutro' THEN 'neutro' ELSE 'capa' END;
    INSERT INTO public.pista_estado (obra_id, estado_id, nombre, color, orden, tipo, derivable, alias_liberacion)
    VALUES (p_obra, eid, nombre, coalesce(nullif(public._jtxt(x->'color'), ''), '#9aa7b1'),
            CASE WHEN tipo = 'neutro' THEN 0 ELSE coalesce(nullif(public._jnum(x->'orden'), 0), k * 10)::integer END,
            tipo, tipo = 'capa' AND public._jbool(x->'derivable'), public._jtxt(x->'alias_liberacion'))
    ON CONFLICT (obra_id, estado_id) DO UPDATE SET nombre = EXCLUDED.nombre, color = EXCLUDED.color,
      orden = EXCLUDED.orden, tipo = EXCLUDED.tipo, derivable = EXCLUDED.derivable,
      alias_liberacion = EXCLUDED.alias_liberacion;
    ids := ids || jsonb_build_object('estado_id', eid, 'nombre', nombre);
  END LOOP;
  SELECT string_agg(estado_id || ' (' || n || ' tramos)', ', ') INTO faltan
  FROM (SELECT estado_id, count(*) n FROM public.pista_tramo
         WHERE obra_id = p_obra AND NOT (estado_id = ANY(vistos)) GROUP BY estado_id) s;
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede borrar del catálogo un estado que está en uso: %. Cambiá esos tramos a otro estado primero.', faltan
      USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.pista_estado WHERE obra_id = p_obra AND NOT (estado_id = ANY(vistos));
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('ok', true, 'estados', k, 'ids', ids);
END $$;

/* Tramos de UN eje: set completo de ese eje. Se recortan al eje, se ordenan y
   se fusionan los contiguos iguales (pistaFusionar_); si quedan superpuestos,
   se rechaza. No toca los otros ejes. */
CREATE OR REPLACE FUNCTION public.pista_guardar_tramos(p_obra text, p_eje text, p_tramos jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record; t record; prev record; hay boolean := false; k integer := 0; eps numeric := 0.001;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  SELECT * INTO e FROM public.pista_eje WHERE obra_id = p_obra AND eje_id = p_eje FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El eje % no existe en esta obra.', p_eje USING ERRCODE = 'P0002'; END IF;
  PERFORM public._pista_estados_default(p_obra);    -- la obra todavía usa el catálogo propuesto

  DROP TABLE IF EXISTS pg_temp._tr;
  CREATE TEMP TABLE _tr (ini numeric, fin numeric, estado text, cota numeric, obs text, proc boolean) ON COMMIT DROP;
  INSERT INTO _tr
  SELECT greatest(ini, e.prog_ini), least(fin, e.prog_fin), estado, cota, obs, proc
  FROM (
    SELECT public._jnum(coalesce(x->'prog_ini', x->'ini')) AS ini, public._jnum(coalesce(x->'prog_fin', x->'fin')) AS fin,
           coalesce(nullif(public._jtxt(x->'estado_id'), ''), public._jtxt(x->'estado')) AS estado,
           public._jnum(x->'cota') AS cota, public._jtxt(x->'obs') AS obs,
           public._jbool(coalesce(x->'en_proceso', x->'proc')) AS proc
    FROM jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) x
  ) s
  WHERE ini IS NOT NULL AND fin IS NOT NULL AND fin > ini AND estado <> '';

  IF EXISTS (SELECT 1 FROM _tr WHERE NOT EXISTS (SELECT 1 FROM public.pista_estado pe
                                                  WHERE pe.obra_id = p_obra AND pe.estado_id = _tr.estado)) THEN
    RAISE EXCEPTION 'Hay tramos con un estado que no está en el catálogo de la obra: %',
      (SELECT string_agg(DISTINCT estado, ', ') FROM _tr WHERE NOT EXISTS (SELECT 1 FROM public.pista_estado pe
                                                  WHERE pe.obra_id = p_obra AND pe.estado_id = _tr.estado))
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.pista_tramo WHERE obra_id = p_obra AND eje_id = p_eje;
  FOR t IN SELECT * FROM _tr WHERE fin - ini > eps ORDER BY ini, fin LOOP
    IF hay THEN
      IF abs(prev.fin - t.ini) <= eps AND prev.estado = t.estado
         AND coalesce(prev.cota::text, '') = coalesce(t.cota::text, '') AND prev.obs = t.obs AND prev.proc = t.proc THEN
        prev.fin := t.fin;                              -- contiguo y con la misma clave: se fusiona
        CONTINUE;
      END IF;
      IF t.ini < prev.fin - eps THEN
        RAISE EXCEPTION 'Los tramos se superponen en la progresiva %.', public._num_py(t.ini) USING ERRCODE = '23P01';
      END IF;
      k := k + 1;
      INSERT INTO public.pista_tramo (obra_id, tramo_id, eje_id, estado_id, prog_ini, prog_fin, nota, orden, cota, en_proceso)
      VALUES (p_obra, 'tr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), p_eje, prev.estado, prev.ini, prev.fin, prev.obs, k - 1, prev.cota, prev.proc);
    END IF;
    prev := t; hay := true;
  END LOOP;
  IF hay THEN
    k := k + 1;
    INSERT INTO public.pista_tramo (obra_id, tramo_id, eje_id, estado_id, prog_ini, prog_fin, nota, orden, cota, en_proceso)
    VALUES (p_obra, 'tr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), p_eje, prev.estado, prev.ini, prev.fin, prev.obs, k - 1, prev.cota, prev.proc);
  END IF;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('ok', true, 'tramos', k, 'eje_id', p_eje);
END $$;

/* Snapshot (se guarda solo al exportar el PDF): uno por eje y por día. */
CREATE OR REPLACE FUNCTION public.pista_snapshot(p_obra text, p_eje text, p_fecha text DEFAULT NULL,
                                                 p_nota text DEFAULT '', p_resumen jsonb DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f date := coalesce(public._jfecha(to_jsonb(coalesce(p_fecha, ''))), (now() AT TIME ZONE 'America/Asuncion')::date);
        nota text := btrim(coalesce(p_nota, '')); nuevo integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF NOT EXISTS (SELECT 1 FROM public.pista_eje WHERE obra_id = p_obra AND eje_id = p_eje) THEN
    RAISE EXCEPTION 'El eje % no existe en esta obra.', p_eje USING ERRCODE = 'P0002';
  END IF;
  IF nota = '' THEN nota := 'PDF exportado por ' || public.app_email(); END IF;
  INSERT INTO public.pista_snapshot (obra_id, eje_id, fecha, nota, resumen, por)
  VALUES (p_obra, p_eje, f, nota, coalesce(p_resumen, '{}'::jsonb), public.app_email())
  ON CONFLICT (obra_id, eje_id, fecha) DO NOTHING;
  GET DIAGNOSTICS nuevo = ROW_COUNT;
  RETURN json_build_object('ok', true, 'fecha', f, 'nuevo', nuevo > 0);
END $$;

-- ---------------------------------------------------------------- FOTOS
-- Depósito público de solo lectura (como los enlaces de Drive "cualquiera con el
-- enlace"): las rutas llevan un identificador al azar. Solo sube quien puede
-- escribir en la obra; la primera carpeta de la ruta es el obra_id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fotos-obra', 'fotos-obra', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
                               allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "fotos_obra_subir" ON storage.objects;
CREATE POLICY "fotos_obra_subir" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-obra' AND public.app_puede_escribir((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "fotos_obra_reemplazar" ON storage.objects;
CREATE POLICY "fotos_obra_reemplazar" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'fotos-obra' AND public.app_puede_escribir((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'fotos-obra' AND public.app_puede_escribir((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "fotos_obra_leer" ON storage.objects;
CREATE POLICY "fotos_obra_leer" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fotos-obra' AND public.app_puede_ver((storage.foldername(name))[1]));

-- ------------------------------------------------------------- permisos
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.prod_guardar(text,jsonb,text[])', 'public.prod_editar(text,text,jsonb)', 'public.prod_borrar(text,text)',
    'public.cert_guardar(text,text,jsonb,text)',
    'public.com_guardar(text,jsonb)', 'public.com_cerrar(text,text)', 'public.com_borrar(text,text)',
    'public.pista_guardar_ejes(text,jsonb)', 'public.pista_guardar_estados(text,jsonb)',
    'public.pista_guardar_tramos(text,text,jsonb)', 'public.pista_snapshot(text,text,text,text,jsonb)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public._pista_estados_default(text) FROM PUBLIC, anon, authenticated;
END $$;

COMMIT;

-- Comprobación: 11 funciones y el depósito de fotos
SELECT p.proname AS funcion, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS la_pwa_puede_llamarla
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('prod_guardar','prod_editar','prod_borrar','cert_guardar','com_guardar','com_cerrar','com_borrar',
                    'pista_guardar_ejes','pista_guardar_estados','pista_guardar_tramos','pista_snapshot')
UNION ALL
SELECT 'depósito ' || id, public FROM storage.buckets WHERE id = 'fotos-obra'
ORDER BY 1;
