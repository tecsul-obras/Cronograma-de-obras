/* =========================================================================
 * 17_computo.sql — Cómputo métrico ligero (pestaña Cómputo de la PWA)
 * v20261004b
 *
 * Por obra y por ETAPA ('contrato' = cómputo del contrato original, o el
 * convenio_id de un C.M.) se guarda, para cada ítem:
 *   - las líneas de cómputo (tramo / descripción, progresivas, L, a, e, N y el
 *     total de la línea, tal cual se cargó, sin redondeo);
 *   - la cantidad ADOPTADA (si no se carga, la app usa la suma de las líneas).
 * Las planillas pesadas (terraplén, pavimento) se cargan como una sola línea
 * con el total y se siguen trabajando en Excel.
 *
 * Las líneas no tienen FK al ítem: si un ítem se quita del cronograma su
 * cómputo queda guardado y reaparece si se vuelve a agregar.
 * Se escribe solo con comp_guardar / comp_borrar_etapa.
 * Se puede correr más de una vez.
 * ========================================================================= */

CREATE TABLE IF NOT EXISTS public.computo_linea (
  obra_id   text    NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  etapa     text    NOT NULL CHECK (etapa <> ''),
  item_id   text    NOT NULL CHECK (item_id <> ''),
  orden     integer NOT NULL,
  tramo     text    NOT NULL DEFAULT '',
  prog_ini  numeric,
  prog_fin  numeric,
  largo     numeric,
  ancho     numeric,
  espesor   numeric,
  n         numeric,
  total     numeric NOT NULL DEFAULT 0,
  obs       text    NOT NULL DEFAULT '',
  PRIMARY KEY (obra_id, etapa, item_id, orden)
);

CREATE TABLE IF NOT EXISTS public.computo_item (
  obra_id     text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  etapa       text NOT NULL CHECK (etapa <> ''),
  item_id     text NOT NULL CHECK (item_id <> ''),
  adoptada    numeric,
  obs         text NOT NULL DEFAULT '',
  actualizado timestamptz NOT NULL DEFAULT now(),
  actualizado_por text NOT NULL DEFAULT '',
  PRIMARY KEY (obra_id, etapa, item_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['computo_linea', 'computo_item'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS leer ON public.%I', t);
    EXECUTE format('CREATE POLICY leer ON public.%I FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id))', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

/* p_items: [{ item_id, adoptada?, obs?, lineas: [{tramo, prog_ini, prog_fin, largo, ancho, espesor, n, total, obs}] }]
   Cada ítem que viene REEMPLAZA sus líneas en esa etapa. Con p_reemplazar = true
   además se borra el cómputo de los ítems de la etapa que no vinieron (carga de
   Excel completo). */
CREATE OR REPLACE FUNCTION public.comp_guardar(p_obra text, p_etapa text, p_items jsonb, p_reemplazar boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_etapa text := coalesce(nullif(trim(p_etapa), ''), 'contrato');
  x jsonb; l jsonb; v_item text; k integer; n_items integer := 0; n_lineas integer := 0;
  ids text[] := ARRAY[]::text[];
  v_user text := coalesce(auth.jwt() ->> 'email', '');
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF v_etapa <> 'contrato' AND NOT EXISTS (SELECT 1 FROM public.convenio WHERE obra_id = p_obra AND convenio_id = v_etapa) THEN
    RAISE EXCEPTION 'El convenio del cómputo no existe en esta obra.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Formato de cómputo no válido.' USING ERRCODE = '22023';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    v_item := public._jtxt(x->'item_id');
    IF v_item IS NULL OR v_item = '' THEN CONTINUE; END IF;
    IF v_item = ANY(ids) THEN
      RAISE EXCEPTION 'El ítem % aparece dos veces en el cómputo.', v_item USING ERRCODE = '22023';
    END IF;
    ids := ids || v_item;
    DELETE FROM public.computo_linea WHERE obra_id = p_obra AND etapa = v_etapa AND item_id = v_item;
    k := 0;
    FOR l IN SELECT * FROM jsonb_array_elements(coalesce(x->'lineas', '[]'::jsonb)) LOOP
      k := k + 1;
      INSERT INTO public.computo_linea (obra_id, etapa, item_id, orden, tramo, prog_ini, prog_fin, largo, ancho, espesor, n, total, obs)
      VALUES (p_obra, v_etapa, v_item, k, coalesce(public._jtxt(l->'tramo'), ''),
              public._jnum(l->'prog_ini'), public._jnum(l->'prog_fin'), public._jnum(l->'largo'),
              public._jnum(l->'ancho'), public._jnum(l->'espesor'), public._jnum(l->'n'),
              coalesce(public._jnum(l->'total'), 0), coalesce(public._jtxt(l->'obs'), ''));
    END LOOP;
    n_lineas := n_lineas + k;
    IF k = 0 AND public._jnum(x->'adoptada') IS NULL AND coalesce(public._jtxt(x->'obs'), '') = '' THEN
      DELETE FROM public.computo_item WHERE obra_id = p_obra AND etapa = v_etapa AND item_id = v_item;
    ELSE
      INSERT INTO public.computo_item (obra_id, etapa, item_id, adoptada, obs, actualizado, actualizado_por)
      VALUES (p_obra, v_etapa, v_item, public._jnum(x->'adoptada'), coalesce(public._jtxt(x->'obs'), ''), now(), v_user)
      ON CONFLICT (obra_id, etapa, item_id) DO UPDATE
        SET adoptada = EXCLUDED.adoptada, obs = EXCLUDED.obs, actualizado = now(), actualizado_por = v_user;
      n_items := n_items + 1;
    END IF;
  END LOOP;

  IF p_reemplazar THEN
    DELETE FROM public.computo_linea WHERE obra_id = p_obra AND etapa = v_etapa AND NOT (item_id = ANY(ids));
    DELETE FROM public.computo_item  WHERE obra_id = p_obra AND etapa = v_etapa AND NOT (item_id = ANY(ids));
  END IF;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('etapa', v_etapa, 'items', n_items, 'lineas', n_lineas);
END $$;

CREATE OR REPLACE FUNCTION public.comp_borrar_etapa(p_obra text, p_etapa text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.computo_linea WHERE obra_id = p_obra AND etapa = p_etapa;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.computo_item WHERE obra_id = p_obra AND etapa = p_etapa;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('etapa', p_etapa, 'lineas_borradas', n);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.comp_guardar(text,text,jsonb,boolean)', 'public.comp_borrar_etapa(text,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
