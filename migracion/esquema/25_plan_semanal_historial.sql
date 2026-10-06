/* =========================================================================
 * 25_plan_semanal_historial.sql — Plan semanal: semanas cerradas = historial
 * v20261006h
 *
 * Una semana se CIERRA cuando termina (lunes siguiente 00:00, hora de
 * Asunción). Desde ahí su plan queda congelado para que sirva de KPI (PPC):
 *   · residente (y cualquiera que no sea admin): al guardar, las filas de
 *     semanas cerradas que ya están en la base NO se borran ni se cambian;
 *     solo se actualiza la CAUSA de no cumplimiento. Lo que llegue para una
 *     semana cerrada se ignora (no se pueden agregar filas al pasado).
 *   · admin: puede corregir el historial (p. ej. cargar lo de Monday);
 *     guarda todo como antes.
 * Lo ejecutado no se guarda acá: sale de la producción, así que se sigue
 * actualizando aunque se cargue atrasado.
 * Se puede correr más de una vez.
 * ========================================================================= */

CREATE OR REPLACE FUNCTION public._semana_cerrada(p_semana text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(p_semana, '') ~ '^\d{4}-W\d{2}$'
     AND to_date(p_semana, 'IYYY-"W"IW') + 7 <= (now() AT TIME ZONE 'America/Asuncion')::date
$$;

CREATE OR REPLACE FUNCTION public.cron_guardar_semanal(p_obra text, p_rows jsonb, p_base_rev integer DEFAULT NULL::integer, p_req_id text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ya integer; n integer := 0; omitidas integer := 0; protegidas integer := 0; causas integer := 0;
        nueva integer; v_admin boolean;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  ya := public._cron_controlar_rev(p_obra, p_base_rev, p_req_id, 'saveWeekly');
  IF ya IS NOT NULL THEN RETURN json_build_object('saved', 0, 'rev', ya, 'repetido', true); END IF;
  v_admin := public.app_es_admin();

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

  IF v_admin THEN
    -- el administrador guarda todo, incluido el historial
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
  ELSE
    -- semanas cerradas: solo la causa (por ítem + semana)
    UPDATE public.plan_semanal ps SET causa = c.causa
      FROM (SELECT DISTINCT ON (item_id, semana) item_id, semana, causa
              FROM _ps WHERE causa IS NOT NULL ORDER BY item_id, semana, ord DESC) c
     WHERE ps.obra_id = p_obra AND ps.item_id = c.item_id AND ps.semana = c.semana
       AND public._semana_cerrada(ps.semana) AND ps.causa IS DISTINCT FROM c.causa;
    GET DIAGNOSTICS causas = ROW_COUNT;
    SELECT count(*) INTO protegidas FROM _ps s WHERE public._semana_cerrada(s.semana);

    -- semana en curso y futuras: se reemplazan como antes
    DELETE FROM public.plan_semanal WHERE obra_id = p_obra AND NOT public._semana_cerrada(semana);
    INSERT INTO public.plan_semanal (obra_id, plan_id, item_id, actividad, frente, um, semana, mes,
                                     cant_prevista, causa, split, manual)
    SELECT DISTINCT ON (plan_id) p_obra, plan_id, item_id, actividad, frente, um, semana, mes,
           cant_prevista, causa, split, manual
    FROM _ps s
    WHERE s.semana ~ '^\d{4}-W\d{2}$'
      AND NOT public._semana_cerrada(s.semana)
      AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
      AND NOT EXISTS (SELECT 1 FROM public.plan_semanal p2 WHERE p2.obra_id = p_obra AND p2.plan_id = s.plan_id)
    ORDER BY plan_id, ord DESC;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  nueva := public._cron_tocar(p_obra, true, p_req_id);
  RETURN json_build_object('saved', n, 'rev', nueva, 'omitidas', omitidas,
                           'historial_protegido', protegidas, 'causas_historial', causas);
END $function$;

REVOKE ALL ON FUNCTION public._semana_cerrada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._semana_cerrada(text) TO authenticated;
REVOKE ALL ON FUNCTION public.cron_guardar_semanal(text, jsonb, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cron_guardar_semanal(text, jsonb, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
