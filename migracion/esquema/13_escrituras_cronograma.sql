-- =============================================================================
-- 13_escrituras_cronograma.sql — Etapa 3: guardar el cronograma desde la PWA
-- Cronograma de Obra · TECSUL · v20261003c
--
-- Una función por acción del Apps Script viejo (Codigo.gs, doPost), con la misma
-- semántica y el mismo control de revisión:
--
--   cron_guardar_items      ← saveItems      (ítems / distribución / dependencias)
--   cron_guardar_semanal    ← saveWeekly
--   cron_guardar_categorias ← saveCategorias
--   cron_guardar_config     ← saveConfig     (reemplaza solo los namespaces enviados)
--   cron_guardar_calendario ← saveCalendario
--   cron_guardar_linea_base ← saveBaseline
--   cron_borrar_linea_base  ← borrarBaseline (las de convenio piden el Nº)
--   cron_borrar_items       ← deleteItems
--   cron_crear_obra / cron_duplicar_obra / cron_eliminar_obra / cron_guardar_obra
--
-- CONTROL DE REVISIÓN (igual que ACCIONES_CONFLICTO): items, semanal y
-- categorías reemplazan el cronograma entero de la obra. El cliente manda la
-- revisión que tenía cargada (p_base_rev). Si otra PERSONA guardó en el medio,
-- se rechaza con SQLSTATE PT409 (HTTP 409) y en `detail` va quién y cuándo.
-- Si la última revisión es del mismo usuario (otra pestaña, el celular) pasa.
-- Un reintento con el mismo p_req_id que ya se aplicó devuelve la revisión
-- vigente sin volver a escribir (PARCHE_16).
--
-- Todo corre en UNA transacción por llamada: o se guarda todo o nada. La fila
-- de la obra se bloquea (FOR UPDATE) mientras dura, así dos guardados de la
-- misma obra nunca se mezclan.
--
-- SECURITY DEFINER con permisos verificados explícitamente al entrar (mismas
-- reglas que el RLS: app_puede_escribir / app_es_admin), para dar mensajes
-- claros. Ejecutar completo en el SQL Editor. Es idempotente: se puede volver
-- a correr.
-- =============================================================================
BEGIN;

-- ------------------------------------------------- reintentos ya aplicados
CREATE TABLE IF NOT EXISTS public.req_aplicado (
  obra_id   text NOT NULL,
  req_id    text NOT NULL,
  rev       integer NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, req_id)
);
ALTER TABLE public.req_aplicado ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo las funciones
REVOKE ALL ON public.req_aplicado FROM anon, authenticated;

-- ------------------------------------------------------------- utilidades
-- Número de un valor JSON: '' / null / texto no numérico → NULL. Sin redondeo.
CREATE OR REPLACE FUNCTION public._jnum(v jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(v) = 'number' THEN RETURN (v #>> '{}')::numeric; END IF;
  IF jsonb_typeof(v) = 'boolean' THEN RETURN CASE WHEN v = 'true'::jsonb THEN 1 ELSE 0 END; END IF;
  s := btrim(v #>> '{}');
  IF s = '' THEN RETURN NULL; END IF;
  RETURN replace(s, ',', '.')::numeric;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._jtxt(v jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN ''
              WHEN jsonb_typeof(v) = 'number' AND (v #>> '{}') ~ '^-?\d+\.0+$' THEN split_part(v #>> '{}', '.', 1)
              ELSE btrim(v #>> '{}') END
$$;

CREATE OR REPLACE FUNCTION public._jfecha(v jsonb)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := left(public._jtxt(v), 10);
BEGIN
  IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN s::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- 'YYYY-MM' desde '2026-03', '2026-03-01', etc. (nmes_)
CREATE OR REPLACE FUNCTION public._jmes(v jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN left(public._jtxt(v), 7) ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN left(public._jtxt(v), 7) END
$$;

CREATE OR REPLACE FUNCTION public._jbool(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(public._jtxt(v)) IN ('1', 'true', 'si', 'sí', 't')
$$;

-- --------------------------------------------- permisos y revisión de obra
CREATE OR REPLACE FUNCTION public._cron_exigir_escritura(p_obra text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_rol() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.app_puede_escribir(p_obra) THEN
    RAISE EXCEPTION 'Sin permiso de escritura en la obra %', p_obra USING ERRCODE = '42501';
  END IF;
END $$;

/* Bloquea la obra y controla la revisión. Devuelve:
     NULL     → seguir y guardar
     un rev   → ese p_req_id ya se aplicó: contestar con este rev y no escribir */
CREATE OR REPLACE FUNCTION public._cron_controlar_rev(p_obra text, p_base_rev integer, p_req_id text, p_accion text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; ya integer; yo text := public.app_email();
BEGIN
  SELECT rev, rev_por, rev_ts INTO o FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra % no encontrada', p_obra USING ERRCODE = 'P0002'; END IF;

  IF coalesce(p_req_id, '') <> '' THEN
    SELECT rev INTO ya FROM public.req_aplicado WHERE obra_id = p_obra AND req_id = left(p_req_id, 60);
    IF FOUND THEN RETURN ya; END IF;
  END IF;

  IF p_base_rev IS NOT NULL AND p_base_rev <> o.rev
     AND lower(btrim(coalesce(o.rev_por, ''))) <> yo THEN
    RAISE EXCEPTION 'conflicto' USING ERRCODE = 'PT409',
      DETAIL = json_build_object(
        'rev_tuya', p_base_rev, 'rev_actual', o.rev, 'por', o.rev_por,
        'ts', to_char(o.rev_ts AT TIME ZONE 'America/Asuncion', 'YYYY-MM-DD HH24:MI'),
        'accion', p_accion)::text;
  END IF;
  RETURN NULL;
END $$;

-- Sube la revisión (cronograma) o solo sella quién tocó la obra (resto).
CREATE OR REPLACE FUNCTION public._cron_tocar(p_obra text, p_subir boolean, p_req_id text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nueva integer;
BEGIN
  UPDATE public.obra
     SET rev = rev + CASE WHEN p_subir THEN 1 ELSE 0 END,
         rev_por = public.app_email(),
         rev_ts = now()
   WHERE obra_id = p_obra
  RETURNING rev INTO nueva;
  IF p_subir AND coalesce(p_req_id, '') <> '' THEN
    DELETE FROM public.req_aplicado WHERE creado_en < now() - interval '6 hours';
    INSERT INTO public.req_aplicado (obra_id, req_id, rev) VALUES (p_obra, left(p_req_id, 60), nueva)
    ON CONFLICT (obra_id, req_id) DO UPDATE SET rev = EXCLUDED.rev, creado_en = now();
  END IF;
  RETURN nueva;
END $$;

-- ============================================================ saveItems
/* p_items / p_dist / p_deps: NULL = esa tabla no se toca (guardado parcial).
   Ítems: se actualizan o insertan; los que ya no vienen se borran, salvo que
   tengan producción, certificación o convenio (eso se perdería en cascada):
   en ese caso se rechaza el guardado con la lista. cant_convenio no se toca:
   es un caché de convenio_detalle que mantiene el backend. */
CREATE OR REPLACE FUNCTION public.cron_guardar_items(
  p_obra text, p_items jsonb DEFAULT NULL, p_dist jsonb DEFAULT NULL, p_deps jsonb DEFAULT NULL,
  p_base_rev integer DEFAULT NULL, p_req_id text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ya integer; n integer := 0; protegidos text; nueva integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  ya := public._cron_controlar_rev(p_obra, p_base_rev, p_req_id, 'saveItems');
  IF ya IS NOT NULL THEN RETURN json_build_object('saved', 0, 'rev', ya, 'repetido', true); END IF;

  IF p_items IS NOT NULL THEN
    DROP TABLE IF EXISTS pg_temp._it;
    CREATE TEMP TABLE _it ON COMMIT DROP AS
    SELECT DISTINCT ON (id) *
    FROM (
      SELECT public._jtxt(x->'id') AS id, ord - 1 AS k, x
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(x, ord)
    ) s
    WHERE id <> ''
    ORDER BY id, k DESC;

    SELECT string_agg(i.item_id, ', ' ORDER BY i.orden) INTO protegidos
    FROM public.item i
    WHERE i.obra_id = p_obra
      AND NOT EXISTS (SELECT 1 FROM _it WHERE _it.id = i.item_id)
      AND (EXISTS (SELECT 1 FROM public.certificacion c WHERE c.obra_id = p_obra AND c.item_id = i.item_id)
        OR EXISTS (SELECT 1 FROM public.produccion_fila f WHERE f.obra_id = p_obra AND f.item_id = i.item_id)
        OR EXISTS (SELECT 1 FROM public.convenio_detalle d WHERE d.obra_id = p_obra AND d.item_id = i.item_id));
    IF protegidos IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede quitar del cronograma: % (tienen producción, certificación o convenio cargados).', protegidos
        USING ERRCODE = '23503';
    END IF;

    DELETE FROM public.item i
     WHERE i.obra_id = p_obra AND NOT EXISTS (SELECT 1 FROM _it WHERE _it.id = i.item_id);

    INSERT INTO public.item AS i (obra_id, item_id, descripcion, id_nivel3, desc_nivel3, codigo_cc, um,
        cant_contrato, cant_ajustada, precio_unit, incidencia, categoria, estado, fecha_ini, fecha_fin,
        avance_esperado, avance_manual, nivel, es_grupo, tipo, padre_id, orden)
    SELECT p_obra, id,
           public._jtxt(x->'desc'), public._jtxt(x->'id_nivel3'), public._jtxt(x->'desc_nivel3'),
           public._jtxt(x->'codigo_cc'), public._jtxt(x->'um'),
           coalesce(public._jnum(x->'cant'), 0), public._jnum(x->'cant_ajustada'),
           coalesce(public._jnum(x->'pu'), 0), public._jnum(x->'incidencia'),
           coalesce(nullif(public._jtxt(x->'cat'), ''), 'Sin categoría'),
           coalesce(nullif(public._jtxt(x->'estado'), ''), 'Pendiente'),
           public._jfecha(x->'ini'), public._jfecha(x->'fin'),
           public._jnum(x->'avance_esperado'), public._jnum(x->'avance_manual'),
           greatest(1, least(8, coalesce(public._jnum(x->'nivel'), 1)))::smallint,
           public._jbool(x->'es_grupo'),
           public._jtxt(x->'tipo'),
           CASE WHEN public._jtxt(x->'padre_id') IN ('', id) THEN NULL
                WHEN EXISTS (SELECT 1 FROM _it p WHERE p.id = public._jtxt(src.x->'padre_id'))
                THEN public._jtxt(x->'padre_id') END,
           coalesce(public._jnum(x->'orden'), k)::integer
    FROM _it AS src
    ON CONFLICT (obra_id, item_id) DO UPDATE SET
      descripcion = EXCLUDED.descripcion, id_nivel3 = EXCLUDED.id_nivel3, desc_nivel3 = EXCLUDED.desc_nivel3,
      codigo_cc = EXCLUDED.codigo_cc, um = EXCLUDED.um, cant_contrato = EXCLUDED.cant_contrato,
      cant_ajustada = EXCLUDED.cant_ajustada, precio_unit = EXCLUDED.precio_unit,
      incidencia = EXCLUDED.incidencia, categoria = EXCLUDED.categoria, estado = EXCLUDED.estado,
      fecha_ini = EXCLUDED.fecha_ini, fecha_fin = EXCLUDED.fecha_fin,
      avance_esperado = EXCLUDED.avance_esperado, avance_manual = EXCLUDED.avance_manual,
      nivel = EXCLUDED.nivel, es_grupo = EXCLUDED.es_grupo, tipo = EXCLUDED.tipo,
      padre_id = EXCLUDED.padre_id, orden = EXCLUDED.orden;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  IF p_dist IS NOT NULL THEN
    DELETE FROM public.distribucion_mensual WHERE obra_id = p_obra;
    INSERT INTO public.distribucion_mensual (obra_id, item_id, mes, cant, manual)
    SELECT DISTINCT ON (item_id, mes) p_obra, item_id, mes, cant, manual
    FROM (
      SELECT public._jtxt(x->'item_id') AS item_id, public._jmes(x->'mes') AS mes,
             coalesce(public._jnum(x->'cant'), 0) AS cant, public._jbool(x->'manual') AS manual, ord
      FROM jsonb_array_elements(p_dist) WITH ORDINALITY AS t(x, ord)
    ) s
    WHERE mes IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
    ORDER BY item_id, mes, ord DESC;
  END IF;

  IF p_deps IS NOT NULL THEN
    DELETE FROM public.item_dependencia WHERE obra_id = p_obra;
    INSERT INTO public.item_dependencia (obra_id, item_id, pred_id, tipo, lag_dias)
    SELECT DISTINCT ON (item_id, pred_id) p_obra, item_id, pred_id,
           CASE WHEN tipo IN ('FS','SS','FF','SF') THEN tipo ELSE 'FS' END, lag
    FROM (
      SELECT public._jtxt(x->'item_id') AS item_id, public._jtxt(x->'pred_id') AS pred_id,
             upper(public._jtxt(x->'tipo')) AS tipo,
             coalesce(round(public._jnum(x->'lag_dias')), 0)::integer AS lag, ord
      FROM jsonb_array_elements(p_deps) WITH ORDINALITY AS t(x, ord)
    ) s
    WHERE item_id <> pred_id
      AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
      AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.pred_id)
    ORDER BY item_id, pred_id, ord DESC;
  END IF;

  nueva := public._cron_tocar(p_obra, true, p_req_id);
  RETURN json_build_object('saved', n, 'rev', nueva);
END $$;

-- ============================================================ saveWeekly
CREATE OR REPLACE FUNCTION public.cron_guardar_semanal(
  p_obra text, p_rows jsonb, p_base_rev integer DEFAULT NULL, p_req_id text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ya integer; n integer := 0; omitidas integer := 0; nueva integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  ya := public._cron_controlar_rev(p_obra, p_base_rev, p_req_id, 'saveWeekly');
  IF ya IS NOT NULL THEN RETURN json_build_object('saved', 0, 'rev', ya, 'repetido', true); END IF;

  DROP TABLE IF EXISTS pg_temp._ps;
    CREATE TEMP TABLE _ps ON COMMIT DROP AS
  SELECT coalesce(nullif(public._jtxt(x->'plan_id'), ''), 'pl_' || substr(gen_random_uuid()::text, 1, 8)) AS plan_id,
         public._jtxt(x->'item_id') AS item_id,
         public._jtxt(x->'actividad') AS actividad, public._jtxt(x->'frente') AS frente,
         public._jtxt(x->'um') AS um,
         coalesce(nullif(public._jtxt(x->'week'), ''), public._jtxt(x->'semana')) AS semana,
         public._jmes(coalesce(x->'month', x->'mes')) AS mes,
         coalesce(public._jnum(x->'cant_prevista'), 0) AS cant_prevista,
         public._jtxt(x->'causa') AS causa,
         CASE WHEN jsonb_typeof(x->'split_json') = 'string' THEN
                coalesce(nullif(x->>'split_json', ''), '{}')::jsonb
              WHEN jsonb_typeof(x->'split_json') = 'object' THEN x->'split_json'
              WHEN jsonb_typeof(x->'split') = 'object' THEN x->'split'
              ELSE '{}'::jsonb END AS split,
         public._jbool(x->'manual') AS manual,
         ord
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord);

  SELECT count(*) INTO omitidas FROM _ps s
   WHERE s.semana !~ '^\d{4}-W\d{2}$'
      OR NOT EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id);

  DELETE FROM public.plan_semanal WHERE obra_id = p_obra;
  INSERT INTO public.plan_semanal (obra_id, plan_id, item_id, actividad, frente, um, semana, mes,
                                   cant_prevista, causa, split, manual)
  SELECT DISTINCT ON (plan_id) p_obra, plan_id, item_id, actividad, frente, um, semana, mes,
         cant_prevista, causa, split, manual
  FROM _ps s
  WHERE s.semana ~ '^\d{4}-W\d{2}$'
    AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
  ORDER BY plan_id, ord DESC;
  GET DIAGNOSTICS n = ROW_COUNT;

  nueva := public._cron_tocar(p_obra, true, p_req_id);
  RETURN json_build_object('saved', n, 'rev', nueva, 'omitidas', omitidas);
END $$;

-- ======================================================== saveCategorias
CREATE OR REPLACE FUNCTION public.cron_guardar_categorias(
  p_obra text, p_cats jsonb, p_base_rev integer DEFAULT NULL, p_req_id text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ya integer; n integer := 0; nueva integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  ya := public._cron_controlar_rev(p_obra, p_base_rev, p_req_id, 'saveCategorias');
  IF ya IS NOT NULL THEN RETURN json_build_object('saved', 0, 'rev', ya, 'repetido', true); END IF;

  DELETE FROM public.categoria WHERE obra_id = p_obra;
  INSERT INTO public.categoria (obra_id, nombre, color, orden)
  SELECT DISTINCT ON (nombre) p_obra, nombre, color, orden
  FROM (
    SELECT CASE WHEN jsonb_typeof(x) = 'string' THEN btrim(x #>> '{}') ELSE public._jtxt(x->'nombre') END AS nombre,
           CASE WHEN jsonb_typeof(x) = 'object' THEN public._jtxt(x->'color') ELSE '' END AS color,
           coalesce(CASE WHEN jsonb_typeof(x) = 'object' THEN public._jnum(x->'orden') END, ord - 1)::integer AS orden,
           ord
    FROM jsonb_array_elements(coalesce(p_cats, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord)
  ) s
  WHERE nombre <> ''
  ORDER BY nombre, ord;
  GET DIAGNOSTICS n = ROW_COUNT;

  nueva := public._cron_tocar(p_obra, true, p_req_id);
  RETURN json_build_object('saved', n, 'rev', nueva);
END $$;

-- ============================================================ saveConfig
/* Reemplaza SOLO los namespaces presentes (prefijo hasta el primer ':'):
   guardar 'lluvia:*' no borra 'cal:*' ni 'prod:obra_origen'. Dentro de un
   namespace enviado, la clave que no viene desaparece. */
CREATE OR REPLACE FUNCTION public.cron_guardar_config(p_obra text, p_config jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;

  DROP TABLE IF EXISTS pg_temp._cf;
    CREATE TEMP TABLE _cf ON COMMIT DROP AS
  SELECT btrim(k) AS clave,
         CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}'
              WHEN jsonb_typeof(v) = 'null' THEN ''
              WHEN jsonb_typeof(v) = 'boolean' THEN upper(v::text)   -- como lo guardaba Sheets: TRUE / FALSE
              ELSE v::text END AS valor,
         CASE WHEN position(':' IN btrim(k)) > 0 THEN split_part(btrim(k), ':', 1) || ':' ELSE btrim(k) END AS ns
  FROM jsonb_each(coalesce(p_config, '{}'::jsonb)) AS e(k, v)
  WHERE btrim(k) <> '';

  DELETE FROM public.config c
   WHERE c.obra_id = p_obra
     AND (EXISTS (SELECT 1 FROM _cf WHERE _cf.clave = c.clave)
          OR EXISTS (SELECT 1 FROM _cf WHERE _cf.ns = CASE WHEN position(':' IN c.clave) > 0
                                                      THEN split_part(c.clave, ':', 1) || ':' ELSE c.clave END));
  INSERT INTO public.config (obra_id, clave, valor) SELECT p_obra, clave, valor FROM _cf;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('saved', n);
END $$;

-- ======================================================== saveCalendario
CREATE OR REPLACE FUNCTION public.cron_guardar_calendario(p_obra text, p_calendario jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;

  DELETE FROM public.calendario WHERE obra_id = p_obra;
  INSERT INTO public.calendario (obra_id, fecha, tipo, descripcion)
  SELECT DISTINCT ON (fecha) p_obra, fecha,
         CASE WHEN tipo IN ('laborable', 'no_laborable') THEN tipo ELSE 'feriado' END, descripcion
  FROM (
    SELECT public._jfecha(x->'fecha') AS fecha, lower(public._jtxt(x->'tipo')) AS tipo,
           public._jtxt(x->'descripcion') AS descripcion, ord
    FROM jsonb_array_elements(coalesce(p_calendario, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord)
  ) s
  WHERE fecha IS NOT NULL
  ORDER BY fecha, ord;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('saved', n);
END $$;

-- ========================================================== saveBaseline
/* La línea base es una acción manual: snapshot congelado del cronograma.
   p_items = { item_id: {ini, fin, cant, cant_convenio, dist:{mes:cant}} } */
CREATE OR REPLACE FUNCTION public.cron_guardar_linea_base(
  p_obra text, p_nombre text, p_items jsonb, p_tipo text DEFAULT '', p_convenio text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bl text := 'bl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
        t text := lower(btrim(coalesce(p_tipo, '')));
        cv text := nullif(btrim(coalesce(p_convenio, '')), '');
        n integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF cv IS NOT NULL AND t = '' THEN t := 'convenio'; END IF;
  IF t NOT IN ('inicial', 'convenio', 'replanificacion') THEN t := 'replanificacion'; END IF;
  IF cv IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.convenio WHERE obra_id = p_obra AND convenio_id = cv) THEN
    RAISE EXCEPTION 'El convenio indicado no existe en esta obra' USING ERRCODE = '23503';
  END IF;
  IF t = 'convenio' AND cv IS NULL THEN t := 'replanificacion'; END IF;
  IF t <> 'convenio' THEN cv := NULL; END IF;

  INSERT INTO public.linea_base (obra_id, baseline_id, nombre, fecha_snapshot, activa, tipo, convenio_id, creada_por)
  VALUES (p_obra, bl, coalesce(nullif(btrim(p_nombre), ''), 'Línea base'),
          (now() AT TIME ZONE 'America/Asuncion')::date, true, t, cv, public.app_email());

  INSERT INTO public.linea_base_detalle (obra_id, baseline_id, item_id, fecha_ini, fecha_fin, cant, cant_convenio, dist)
  SELECT p_obra, bl, btrim(k), public._jfecha(v->'ini'), public._jfecha(v->'fin'),
         coalesce(public._jnum(v->'cant'), 0), public._jnum(v->'cant_convenio'),
         CASE WHEN jsonb_typeof(v->'dist') = 'object' THEN v->'dist' ELSE '{}'::jsonb END
  FROM jsonb_each(coalesce(p_items, '{}'::jsonb)) AS e(k, v)
  WHERE btrim(k) <> '';
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('baseline_id', bl, 'detalle', n, 'tipo_lb', t, 'convenio_id', cv);
END $$;

-- ======================================================== borrarBaseline
CREATE OR REPLACE FUNCTION public.cron_borrar_linea_base(p_obra text, p_baseline text, p_confirm text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; nro text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  SELECT * INTO b FROM public.linea_base WHERE obra_id = p_obra AND baseline_id = p_baseline;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea base no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF b.tipo = 'convenio' THEN
    SELECT c.nro INTO nro FROM public.convenio c WHERE c.obra_id = p_obra AND c.convenio_id = b.convenio_id;
    nro := coalesce(nullif(btrim(nro), ''), btrim(b.nombre));
    IF btrim(coalesce(p_confirm, '')) <> nro THEN
      RAISE EXCEPTION 'Esta línea base corresponde al convenio %. Para borrarla hay que escribir su número exacto (%) como confirmación.', nro, nro
        USING ERRCODE = '22023';
    END IF;
  END IF;
  DELETE FROM public.linea_base WHERE obra_id = p_obra AND baseline_id = p_baseline;   -- el detalle cae en cascada
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('ok', true, 'borrada', p_baseline);
END $$;

-- =========================================================== deleteItems
/* Igual que deleteItems_: borra ítems con su distribución, dependencias, plan
   semanal y detalle de convenio. NO borra producción ni certificación: si el
   ítem tiene alguna, se rechaza (en Postgres caerían en cascada). */
CREATE OR REPLACE FUNCTION public.cron_borrar_items(p_obra text, p_ids jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ids text[]; protegidos text; n integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  PERFORM 1 FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  SELECT array_agg(DISTINCT public._jtxt(x)) INTO ids FROM jsonb_array_elements(coalesce(p_ids, '[]'::jsonb)) x;
  IF ids IS NULL THEN RETURN json_build_object('deleted', 0); END IF;

  SELECT string_agg(DISTINCT item_id, ', ') INTO protegidos FROM (
    SELECT item_id FROM public.certificacion WHERE obra_id = p_obra AND item_id = ANY(ids)
    UNION SELECT item_id FROM public.produccion_fila WHERE obra_id = p_obra AND item_id = ANY(ids)) s;
  IF protegidos IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden borrar: % (tienen producción o certificación cargadas).', protegidos
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.item WHERE obra_id = p_obra AND item_id = ANY(ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('deleted', n);
END $$;

-- ============================================================ crearObra
CREATE OR REPLACE FUNCTION public.cron_crear_obra(p_obra jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid text := public._jtxt(p_obra->'obra_id'); t text := lower(public._jtxt(p_obra->'tipo_obra'));
        yo text := public.app_email();
BEGIN
  IF public.app_rol() NOT IN ('admin', 'residente') OR public.app_rol() IS NULL THEN
    RAISE EXCEPTION 'Sin permiso para crear obras' USING ERRCODE = '42501';
  END IF;
  IF oid = '' THEN RAISE EXCEPTION 'Falta obra_id' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.obra WHERE obra_id = oid) THEN
    RAISE EXCEPTION 'Ya existe una obra con ese ID' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.obra (obra_id, nombre, llamado, lote, moneda, tipo_obra, fecha_inicio, fecha_fin,
                           plazo_meses, dias_por_mes, activo)
  VALUES (oid, public._jtxt(p_obra->'nombre'), public._jtxt(p_obra->'llamado'), public._jtxt(p_obra->'lote'),
          coalesce(nullif(public._jtxt(p_obra->'moneda'), ''), 'PYG'),
          CASE WHEN t IN ('publica', 'privada') THEN t ELSE 'privada' END,
          public._jfecha(p_obra->'fecha_inicio'), public._jfecha(p_obra->'fecha_fin'),
          nullif(round(public._jnum(p_obra->'plazo_meses')), 0)::integer,
          coalesce(nullif(round(public._jnum(p_obra->'dias_por_mes')), 0), 30)::integer, true);
  INSERT INTO public.categoria (obra_id, nombre, color, orden) VALUES (oid, 'Sin categoría', '', 0);
  -- quien tiene alcance limitado a algunas obras tiene que poder ver la que acaba de crear
  IF EXISTS (SELECT 1 FROM public.usuario_obra WHERE email = yo) THEN
    INSERT INTO public.usuario_obra (email, obra_id) VALUES (yo, oid) ON CONFLICT DO NOTHING;
  END IF;
  RETURN json_build_object('obra_id', oid, 'nombre', public._jtxt(p_obra->'nombre'));
END $$;

-- ========================================================== duplicarObra
/* Copia la obra completa con otro ID (sandbox para probar ajustes). Las líneas
   base reciben ID nuevo. La producción no se copia: la copia la lee de la obra
   de origen (config prod:obra_origen), igual que en Sheets. */
CREATE OR REPLACE FUNCTION public.cron_duplicar_obra(p_origen text, p_nueva jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dst text := public._jtxt(p_nueva->'obra_id'); base record; yo text := public.app_email();
        con_avance boolean := coalesce(p_nueva->>'copiar_avance', 'true') <> 'false';
        copiadas jsonb := '{}'::jsonb; n integer;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede duplicar obras' USING ERRCODE = '42501'; END IF;
  IF NOT public.app_puede_ver(p_origen) THEN RAISE EXCEPTION 'Sin acceso a esta obra' USING ERRCODE = '42501'; END IF;
  IF dst = '' THEN RAISE EXCEPTION 'Falta el ID de la obra nueva' USING ERRCODE = '22023'; END IF;
  IF dst = p_origen THEN RAISE EXCEPTION 'El ID nuevo debe ser distinto al de origen' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.obra WHERE obra_id = dst) THEN
    RAISE EXCEPTION 'Ya existe una obra con el ID %', dst USING ERRCODE = '23505';
  END IF;
  SELECT * INTO base FROM public.obra WHERE obra_id = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontré la obra de origen' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.obra (obra_id, nombre, llamado, lote, moneda, tipo_obra, fecha_inicio, fecha_fin,
                           plazo_meses, dias_por_mes, activo)
  VALUES (dst, coalesce(nullif(public._jtxt(p_nueva->'nombre'), ''), base.nombre || ' (copia)'),
          base.llamado, base.lote, base.moneda, base.tipo_obra,
          coalesce(public._jfecha(p_nueva->'fecha_inicio'), base.fecha_inicio),
          coalesce(public._jfecha(p_nueva->'fecha_fin'), base.fecha_fin),
          base.plazo_meses, base.dias_por_mes, true);

  INSERT INTO public.categoria SELECT dst, nombre, color, orden FROM public.categoria WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('Categorias', n);
  INSERT INTO public.item (obra_id, item_id, descripcion, id_nivel3, desc_nivel3, codigo_cc, um, cant_contrato,
         cant_convenio, cant_ajustada, precio_unit, incidencia, categoria, estado, fecha_ini, fecha_fin,
         avance_esperado, avance_manual, nivel, es_grupo, tipo, padre_id, orden)
  SELECT dst, item_id, descripcion, id_nivel3, desc_nivel3, codigo_cc, um, cant_contrato,
         cant_convenio, cant_ajustada, precio_unit, incidencia, categoria, estado, fecha_ini, fecha_fin,
         avance_esperado, avance_manual, nivel, es_grupo, tipo, padre_id, orden
  FROM public.item WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('Items', n);
  INSERT INTO public.item_dependencia SELECT dst, item_id, pred_id, tipo, lag_dias FROM public.item_dependencia WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('Dependencias', n);
  INSERT INTO public.distribucion_mensual SELECT dst, item_id, mes, cant, manual FROM public.distribucion_mensual WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('DistribucionMensual', n);
  INSERT INTO public.plan_semanal SELECT dst, plan_id, item_id, actividad, frente, um, semana, mes, cant_prevista, causa, split, manual
    FROM public.plan_semanal WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('PlanSemanal', n);
  INSERT INTO public.calendario SELECT dst, fecha, tipo, descripcion FROM public.calendario WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('Calendario', n);
  INSERT INTO public.convenio (obra_id, convenio_id, orden, nro, tipo, estado, fecha_presentacion, fecha_resolucion,
         monto_original, monto_convenio, pct_aumento, dias_calculados, dias_ampliacion, fecha_fin_contrato, descripcion, doc_url)
  SELECT dst, convenio_id, orden, nro, tipo, estado, fecha_presentacion, fecha_resolucion,
         monto_original, monto_convenio, pct_aumento, dias_calculados, dias_ampliacion, fecha_fin_contrato, descripcion, doc_url
  FROM public.convenio WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('Convenios', n);
  INSERT INTO public.convenio_detalle SELECT dst, convenio_id, item_id, tipo, cant, pu FROM public.convenio_detalle WHERE obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('ConvenioDetalle', n);

  DROP TABLE IF EXISTS pg_temp._bl;
    CREATE TEMP TABLE _bl ON COMMIT DROP AS
  SELECT baseline_id AS viejo, 'bl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) AS nuevo
  FROM public.linea_base WHERE obra_id = p_origen;
  INSERT INTO public.linea_base (obra_id, baseline_id, nombre, fecha_snapshot, activa, tipo, convenio_id, creada_por)
  SELECT dst, m.nuevo, b.nombre, b.fecha_snapshot, b.activa, b.tipo, b.convenio_id, b.creada_por
  FROM public.linea_base b JOIN _bl m ON m.viejo = b.baseline_id WHERE b.obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('LineasBase', n);
  INSERT INTO public.linea_base_detalle (obra_id, baseline_id, item_id, fecha_ini, fecha_fin, cant, cant_convenio, dist)
  SELECT dst, m.nuevo, d.item_id, d.fecha_ini, d.fecha_fin, d.cant, d.cant_convenio, d.dist
  FROM public.linea_base_detalle d JOIN _bl m ON m.viejo = d.baseline_id WHERE d.obra_id = p_origen;
  GET DIAGNOSTICS n = ROW_COUNT; copiadas := copiadas || jsonb_build_object('LineaBaseDetalle', n);

  INSERT INTO public.config (obra_id, clave, valor)
  SELECT dst, clave, valor FROM public.config WHERE obra_id = p_origen AND clave <> 'prod:obra_origen';
  IF con_avance THEN
    INSERT INTO public.config (obra_id, clave, valor)
    VALUES (dst, 'prod:obra_origen',
            coalesce((SELECT valor FROM public.config WHERE obra_id = p_origen AND clave = 'prod:obra_origen'), p_origen));
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuario_obra WHERE email = yo) THEN
    INSERT INTO public.usuario_obra (email, obra_id) VALUES (yo, dst) ON CONFLICT DO NOTHING;
  END IF;
  RETURN json_build_object('obra_id', dst, 'nombre', public._jtxt(p_nueva->'nombre'), 'copiadas', copiadas);
END $$;

-- ========================================================== eliminarObra
CREATE OR REPLACE FUNCTION public.cron_eliminar_obra(p_obra text, p_confirm text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base record;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede eliminar obras' USING ERRCODE = '42501'; END IF;
  IF NOT public.app_puede_ver(p_obra) THEN RAISE EXCEPTION 'Sin acceso a esta obra' USING ERRCODE = '42501'; END IF;
  SELECT * INTO base FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontré la obra' USING ERRCODE = 'P0002'; END IF;
  IF btrim(coalesce(p_confirm, '')) <> btrim(coalesce(base.nombre, '')) THEN
    RAISE EXCEPTION 'El nombre de confirmación no coincide' USING ERRCODE = '22023';
  END IF;
  -- la producción primero: sus filas apuntan a los ítems con RESTRICT
  DELETE FROM public.produccion_jornada WHERE obra_id = p_obra;
  DELETE FROM public.obra WHERE obra_id = p_obra;     -- el resto cae en cascada
  DELETE FROM public.req_aplicado WHERE obra_id = p_obra;
  RETURN json_build_object('obra_id', p_obra, 'nombre', base.nombre);
END $$;

-- ============================================================= saveObra
/* Datos contractuales de la obra. Solo cambia lo que viene en p_obra.
   El fin vigente NO se guarda: se deriva de los convenios (calcPlazo). */
CREATE OR REPLACE FUNCTION public.cron_guardar_obra(p_obra text, p_datos jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; t text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  SELECT * INTO o FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra no encontrada' USING ERRCODE = 'P0002'; END IF;
  t := lower(public._jtxt(p_datos->'tipo_obra'));
  UPDATE public.obra SET
    nombre       = CASE WHEN p_datos ? 'nombre'       THEN public._jtxt(p_datos->'nombre') ELSE nombre END,
    llamado      = CASE WHEN p_datos ? 'llamado'      THEN public._jtxt(p_datos->'llamado') ELSE llamado END,
    lote         = CASE WHEN p_datos ? 'lote'         THEN public._jtxt(p_datos->'lote') ELSE lote END,
    moneda       = CASE WHEN p_datos ? 'moneda'       THEN coalesce(nullif(public._jtxt(p_datos->'moneda'), ''), 'PYG') ELSE moneda END,
    fecha_inicio = CASE WHEN p_datos ? 'fecha_inicio' THEN public._jfecha(p_datos->'fecha_inicio') ELSE fecha_inicio END,
    fecha_fin    = CASE WHEN p_datos ? 'fecha_fin'    THEN public._jfecha(p_datos->'fecha_fin') ELSE fecha_fin END,
    tipo_obra    = CASE WHEN p_datos ? 'tipo_obra'    THEN (CASE WHEN t IN ('publica','privada') THEN t ELSE 'privada' END) ELSE tipo_obra END,
    plazo_meses  = CASE WHEN p_datos ? 'plazo_meses'  THEN nullif(round(public._jnum(p_datos->'plazo_meses')), 0)::integer ELSE plazo_meses END,
    dias_por_mes = CASE WHEN p_datos ? 'dias_por_mes' THEN coalesce(nullif(round(public._jnum(p_datos->'dias_por_mes')), 0), 30)::integer ELSE dias_por_mes END
  WHERE obra_id = p_obra
  RETURNING * INTO o;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('obra_id', o.obra_id, 'tipo_obra', o.tipo_obra, 'plazo_meses', o.plazo_meses,
                           'dias_por_mes', o.dias_por_mes, 'fecha_inicio', o.fecha_inicio, 'fecha_fin', o.fecha_fin);
END $$;

-- ------------------------------------------------------------- permisos
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._cron_exigir_escritura(text)',
    'public._cron_controlar_rev(text,integer,text,text)',
    'public._cron_tocar(text,boolean,text)',
    'public.cron_guardar_items(text,jsonb,jsonb,jsonb,integer,text)',
    'public.cron_guardar_semanal(text,jsonb,integer,text)',
    'public.cron_guardar_categorias(text,jsonb,integer,text)',
    'public.cron_guardar_config(text,jsonb)',
    'public.cron_guardar_calendario(text,jsonb)',
    'public.cron_guardar_linea_base(text,text,jsonb,text,text)',
    'public.cron_borrar_linea_base(text,text,text)',
    'public.cron_borrar_items(text,jsonb)',
    'public.cron_crear_obra(jsonb)',
    'public.cron_duplicar_obra(text,jsonb)',
    'public.cron_eliminar_obra(text,text)',
    'public.cron_guardar_obra(text,jsonb)'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
  END LOOP;
  -- las internas no se llaman desde la PWA
  REVOKE ALL ON FUNCTION public._cron_exigir_escritura(text), public._cron_controlar_rev(text,integer,text,text),
                         public._cron_tocar(text,boolean,text) FROM authenticated;
  FOREACH f IN ARRAY ARRAY[
    'public.cron_guardar_items(text,jsonb,jsonb,jsonb,integer,text)',
    'public.cron_guardar_semanal(text,jsonb,integer,text)',
    'public.cron_guardar_categorias(text,jsonb,integer,text)',
    'public.cron_guardar_config(text,jsonb)',
    'public.cron_guardar_calendario(text,jsonb)',
    'public.cron_guardar_linea_base(text,text,jsonb,text,text)',
    'public.cron_borrar_linea_base(text,text,text)',
    'public.cron_borrar_items(text,jsonb)',
    'public.cron_crear_obra(jsonb)',
    'public.cron_duplicar_obra(text,jsonb)',
    'public.cron_eliminar_obra(text,text)',
    'public.cron_guardar_obra(text,jsonb)'
  ] LOOP
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

COMMIT;

-- Comprobación: tienen que aparecer las 12 funciones cron_*
SELECT p.proname AS funcion, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS la_pwa_puede_llamarla
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'cron\_%' ORDER BY 1;
