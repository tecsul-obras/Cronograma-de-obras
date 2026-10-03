-- =============================================================================
-- 15_certificados.sql — Certificados numerados (formato MOPC), varios por mes
-- Cronograma de Obra · TECSUL · v20261003e
--
-- Hasta ahora la certificación era "ítem × mes": un solo certificado por mes.
-- En obras privadas puede haber certificados quincenales o más de uno por mes,
-- y el formato MOPC trabaja con el N° de certificado (anterior / presente /
-- acumulado se cuentan por número, no por mes). Entonces:
--
--   * certificado: la cabecera. N° correlativo por obra, mes de imputación
--     (el que usan las curvas), período desde/hasta, fecha, referencia, estado.
--   * certificacion: las cantidades, ahora por (certificado × ítem). Conserva
--     la columna `mes` (copia del mes del certificado) para que las curvas,
--     Power BI y el cronograma sigan leyendo igual.
--
-- Migración de lo cargado: un certificado por obra y mes, numerados 1, 2, 3…
-- en orden de mes. El texto que había en "N° de certificado" queda como
-- referencia. Los números se pueden corregir después desde la PWA.
--
-- Requiere 13 y 14. Ejecutar completo en el SQL Editor. Es una transacción.
-- =============================================================================
BEGIN;

-- el control de tope se apaga solo mientras se reacomodan las filas existentes
-- (hay ítems históricos sobre el tope que no se tocan) y se vuelve a prender al final
ALTER TABLE public.certificacion DISABLE TRIGGER tg_tope_certificacion;

CREATE TABLE IF NOT EXISTS public.certificado (
  obra_id        text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  cert_id        text NOT NULL DEFAULT ('ct_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  nro            integer NOT NULL CHECK (nro > 0),
  mes            text NOT NULL CHECK (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  periodo_desde  date,
  periodo_hasta  date,
  fecha          date,
  referencia     text NOT NULL DEFAULT '',
  observacion    text NOT NULL DEFAULT '',
  estado         text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'presentado', 'aprobado')),
  creado_por     text NOT NULL DEFAULT '',
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, cert_id),
  CONSTRAINT certificado_nro_unico UNIQUE (obra_id, nro) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT certificado_periodo CHECK (periodo_desde IS NULL OR periodo_hasta IS NULL OR periodo_hasta >= periodo_desde)
);

-- ---------------------------------------------------- migrar lo existente
ALTER TABLE public.certificacion ADD COLUMN IF NOT EXISTS cert_id text;

INSERT INTO public.certificado (obra_id, cert_id, nro, mes, referencia, estado, creado_por)
SELECT obra_id, 'ct_m' || replace(mes, '-', '') AS cert_id,
       row_number() OVER (PARTITION BY obra_id ORDER BY mes)::integer AS nro, mes,
       coalesce(max(nullif(nro_certificado, '')), ''), 'aprobado', 'migracion'
FROM public.certificacion
WHERE cert_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.certificado c WHERE c.obra_id = certificacion.obra_id)
GROUP BY obra_id, mes;

UPDATE public.certificacion c SET cert_id = 'ct_m' || replace(c.mes, '-', '') WHERE c.cert_id IS NULL;

ALTER TABLE public.certificacion ALTER COLUMN cert_id SET NOT NULL;
ALTER TABLE public.certificacion DROP CONSTRAINT IF EXISTS certificacion_pkey;
ALTER TABLE public.certificacion ADD CONSTRAINT certificacion_pkey PRIMARY KEY (obra_id, cert_id, item_id);
ALTER TABLE public.certificacion DROP CONSTRAINT IF EXISTS certificacion_certificado_fk;
ALTER TABLE public.certificacion ADD CONSTRAINT certificacion_certificado_fk
  FOREIGN KEY (obra_id, cert_id) REFERENCES public.certificado(obra_id, cert_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS certificacion_obra_item_mes ON public.certificacion (obra_id, item_id, mes);
ALTER TABLE public.certificacion ENABLE TRIGGER tg_tope_certificacion;

-- --------------------------------------------------------------- permisos (RLS)
ALTER TABLE public.certificado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.certificado;
DROP POLICY IF EXISTS escribir ON public.certificado;
CREATE POLICY leer ON public.certificado FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
CREATE POLICY escribir ON public.certificado FOR ALL TO authenticated
  USING (public.app_puede_escribir(obra_id)) WITH CHECK (public.app_puede_escribir(obra_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificado TO authenticated;

-- ============================================================ guardar certificado
/* p_cert = { cert_id?, nro?, mes, periodo_desde?, periodo_hasta?, fecha?, referencia?,
              observacion?, estado? }
   p_filas = [ { item_id, cant_certificada, observacion } ]   (solo lo de ESTE certificado)
   Sin cert_id = certificado nuevo (N° = el siguiente si no viene).
   Reemplaza las cantidades de este certificado y no toca los demás.
   Tope duro: lo de los OTROS certificados + lo de este ≤ tope del ítem
   (pública = contractual · privada = vigente). Negativos permitidos. */
CREATE OR REPLACE FUNCTION public.cert_guardar_certificado(p_obra text, p_cert jsonb, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id text := nullif(public._jtxt(p_cert->'cert_id'), '');
        v_nro integer := nullif(public._jnum(p_cert->'nro'), 0)::integer;
        v_mes text := public._jmes(p_cert->'mes');
        v_est text := lower(public._jtxt(p_cert->'estado'));
        publica boolean; det text; total_exc integer; n integer := 0; nuevo boolean := false;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF v_mes IS NULL THEN RAISE EXCEPTION 'Falta el mes de imputación del certificado' USING ERRCODE = '22023'; END IF;
  SELECT tipo_obra = 'publica' INTO publica FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF v_est NOT IN ('borrador', 'presentado', 'aprobado') THEN v_est := NULL; END IF;

  IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.certificado WHERE obra_id = p_obra AND cert_id = v_id) THEN
    nuevo := true;
    v_id := coalesce(v_id, 'ct_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    IF v_nro IS NULL THEN SELECT coalesce(max(nro), 0) + 1 INTO v_nro FROM public.certificado WHERE obra_id = p_obra; END IF;
  END IF;
  IF v_nro IS NOT NULL AND EXISTS (SELECT 1 FROM public.certificado WHERE obra_id = p_obra AND nro = v_nro AND cert_id <> v_id) THEN
    RAISE EXCEPTION 'Ya existe el certificado N° % en esta obra.', v_nro USING ERRCODE = '23505';
  END IF;

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

  WITH ex AS (
    SELECT ce.item_id, coalesce(o.otros, 0) AS ya, ce.cant AS este, coalesce(o.otros, 0) + ce.cant AS total,
           CASE WHEN publica THEN i.cant_contractual ELSE i.cant_vigente END AS tope
    FROM _ce ce
    JOIN public.item i ON i.obra_id = p_obra AND i.item_id = ce.item_id
    LEFT JOIN (SELECT item_id, sum(cant_certificada) AS otros FROM public.certificacion
                WHERE obra_id = p_obra AND cert_id <> v_id GROUP BY item_id) o ON o.item_id = ce.item_id
  ), malos AS (SELECT * FROM ex WHERE tope IS NOT NULL AND total > tope + 0.000001)
  SELECT string_agg('· ' || item_id || ': ' || public._num_py(ya) || ' ya certificado en otros certificados + ' ||
                    public._num_py(este) || ' de este = ' || public._num_py(total) ||
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

  IF nuevo THEN
    INSERT INTO public.certificado (obra_id, cert_id, nro, mes, periodo_desde, periodo_hasta, fecha, referencia,
                                    observacion, estado, creado_por)
    VALUES (p_obra, v_id, v_nro, v_mes, public._jfecha(p_cert->'periodo_desde'), public._jfecha(p_cert->'periodo_hasta'),
            public._jfecha(p_cert->'fecha'), public._jtxt(p_cert->'referencia'), public._jtxt(p_cert->'observacion'),
            coalesce(v_est, 'borrador'), public.app_email());
  ELSE
    UPDATE public.certificado SET
      nro           = coalesce(v_nro, nro),
      mes           = v_mes,
      periodo_desde = CASE WHEN p_cert ? 'periodo_desde' THEN public._jfecha(p_cert->'periodo_desde') ELSE periodo_desde END,
      periodo_hasta = CASE WHEN p_cert ? 'periodo_hasta' THEN public._jfecha(p_cert->'periodo_hasta') ELSE periodo_hasta END,
      fecha         = CASE WHEN p_cert ? 'fecha' THEN public._jfecha(p_cert->'fecha') ELSE fecha END,
      referencia    = CASE WHEN p_cert ? 'referencia' THEN public._jtxt(p_cert->'referencia') ELSE referencia END,
      observacion   = CASE WHEN p_cert ? 'observacion' THEN public._jtxt(p_cert->'observacion') ELSE observacion END,
      estado        = coalesce(v_est, estado)
    WHERE obra_id = p_obra AND cert_id = v_id;
  END IF;

  DELETE FROM public.certificacion WHERE obra_id = p_obra AND cert_id = v_id;
  INSERT INTO public.certificacion (obra_id, cert_id, item_id, mes, cant_certificada, observacion, nro_certificado,
                                    guardado_por, guardado_en)
  SELECT p_obra, v_id, item_id, v_mes, cant, obs,
         coalesce(nullif((SELECT referencia FROM public.certificado WHERE obra_id = p_obra AND cert_id = v_id), ''),
                  'N° ' || (SELECT nro FROM public.certificado WHERE obra_id = p_obra AND cert_id = v_id)),
         public.app_email(), now()
  FROM _ce;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('cert_id', v_id, 'nro', (SELECT nro FROM public.certificado WHERE obra_id = p_obra AND cert_id = v_id),
                           'mes', v_mes, 'guardados', n, 'nuevo', nuevo);
END $$;

-- Borrar un certificado completo. Uno APROBADO solo lo borra un administrador.
CREATE OR REPLACE FUNCTION public.cert_borrar_certificado(p_obra text, p_cert text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  SELECT * INTO c FROM public.certificado WHERE obra_id = p_obra AND cert_id = p_cert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el certificado.' USING ERRCODE = 'P0002'; END IF;
  IF c.estado = 'aprobado' AND NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'El certificado N° % está aprobado: solo un administrador puede borrarlo.', c.nro USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.certificado WHERE obra_id = p_obra AND cert_id = p_cert;   -- las cantidades caen en cascada
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('borrado', p_cert, 'nro', c.nro);
END $$;

/* Compatibilidad con la pantalla vieja (un certificado por mes): si el mes ya
   tiene UN certificado lo reemplaza, si no tiene ninguno lo crea; si tiene
   varios, pide usar la pantalla nueva. */
CREATE OR REPLACE FUNCTION public.cert_guardar(p_obra text, p_mes text, p_filas jsonb, p_nro text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mes text := public._jmes(to_jsonb(coalesce(p_mes, ''))); ids text[]; r json;
BEGIN
  SELECT array_agg(cert_id) INTO ids FROM public.certificado WHERE obra_id = p_obra AND mes = v_mes;
  IF coalesce(array_length(ids, 1), 0) > 1 THEN
    RAISE EXCEPTION 'Este mes tiene % certificados: editalos desde la pestaña Certificación.', array_length(ids, 1)
      USING ERRCODE = '22023';
  END IF;
  r := public.cert_guardar_certificado(p_obra,
         jsonb_build_object('cert_id', ids[1], 'mes', v_mes, 'referencia', coalesce(p_nro, '')), p_filas);
  RETURN json_build_object('guardados', r->'guardados', 'mes', v_mes);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.cert_guardar_certificado(text,jsonb,jsonb)', 'public.cert_borrar_certificado(text,text)',
                           'public.cert_guardar(text,text,jsonb,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

COMMIT;

-- Comprobación: certificados por obra (después de migrar, uno por mes)
SELECT obra_id, count(*) AS certificados, min(mes) AS desde, max(mes) AS hasta, max(nro) AS ultimo_nro
FROM public.certificado GROUP BY obra_id ORDER BY obra_id;
