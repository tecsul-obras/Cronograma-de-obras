-- =========================================================================
-- 40_concurrencia.sql · v20261014d  (varias personas a la vez)
--
-- 1) CRONOGRAMA — el control "otra persona guardó" se salteaba por error.
--    _cron_controlar_rev no avisa si quien hizo el último cambio fui yo
--    (rev_por = mi correo). Pero rev_por lo escribe CUALQUIER guardado de la
--    obra (producción, compras, certificados, comunicaciones…), aunque no suba
--    la revisión del cronograma. Caso real:
--       A abre el cronograma (rev 5) · B guarda el cronograma (rev 6, rev_por B)
--       A carga la producción del día (rev 6, rev_por A)
--       A guarda el cronograma con base 5 → como rev_por = A, NO hay aviso y
--       A pisa lo que guardó B.
--    Ahora se guarda aparte QUIÉN SUBIÓ la revisión (rev_subida_por) y el
--    control usa eso. Mientras una obra no tenga ese dato (hasta su próximo
--    guardado del cronograma) se comporta como antes.
--
-- 2) COMPRAS — compra_guardar reemplaza el pedido completo con la copia que
--    tenía abierta quien guarda: si Compras carga la cotización y el residente
--    marca la entrega a la vez, el segundo borraba en silencio lo del primero.
--    Ahora la app manda la fecha de edición de la copia que abrió
--    (_base_editado_en); si alguien guardó en el medio, la base responde
--    "conflicto" (PT409) con quién y cuándo, y la persona decide.
--    Sin ese dato (app vieja, importación de Monday) se comporta como antes.
--
-- Para volver atrás: el bloque REVERTIR del final.
-- =========================================================================

alter table public.obra add column if not exists rev_subida_por text;

CREATE OR REPLACE FUNCTION public._cron_tocar(p_obra text, p_subir boolean, p_req_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE nueva integer;
BEGIN
  UPDATE public.obra
     SET rev = rev + CASE WHEN p_subir THEN 1 ELSE 0 END,
         rev_por = public.app_email(),
         rev_ts = now(),
         -- v20261014d: quién subió la revisión del cronograma (rev_por es quién tocó la obra)
         rev_subida_por = CASE WHEN p_subir THEN public.app_email() ELSE rev_subida_por END
   WHERE obra_id = p_obra
  RETURNING rev INTO nueva;
  IF p_subir AND coalesce(p_req_id, '') <> '' THEN
    DELETE FROM public.req_aplicado WHERE creado_en < now() - interval '6 hours';
    INSERT INTO public.req_aplicado (obra_id, req_id, rev) VALUES (p_obra, left(p_req_id, 60), nueva)
    ON CONFLICT (obra_id, req_id) DO UPDATE SET rev = EXCLUDED.rev, creado_en = now();
  END IF;
  RETURN nueva;
END $function$;

CREATE OR REPLACE FUNCTION public._cron_controlar_rev(p_obra text, p_base_rev integer, p_req_id text, p_accion text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o record; ya integer; yo text := public.app_email(); quien text;
BEGIN
  SELECT rev, rev_por, rev_ts, rev_subida_por INTO o FROM public.obra WHERE obra_id = p_obra FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obra % no encontrada', p_obra USING ERRCODE = 'P0002'; END IF;

  IF coalesce(p_req_id, '') <> '' THEN
    SELECT rev INTO ya FROM public.req_aplicado WHERE obra_id = p_obra AND req_id = left(p_req_id, 60);
    IF FOUND THEN RETURN ya; END IF;
  END IF;

  -- v20261014d: quien SUBIÓ la revisión (no quien tocó la obra por última vez)
  quien := coalesce(o.rev_subida_por, o.rev_por);
  IF p_base_rev IS NOT NULL AND p_base_rev <> o.rev
     AND lower(btrim(coalesce(quien, ''))) <> yo THEN
    RAISE EXCEPTION 'conflicto' USING ERRCODE = 'PT409',
      DETAIL = json_build_object(
        'rev_tuya', p_base_rev, 'rev_actual', o.rev, 'por', quien,
        'ts', to_char(o.rev_ts AT TIME ZONE 'America/Asuncion', 'YYYY-MM-DD HH24:MI'),
        'accion', p_accion)::text;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.compra_guardar(p_obra text, p_compra jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cid text := nullif(trim(coalesce(public._jtxt(p_compra->'compra_id'), '')), '');
  nuevo boolean; v public.compra; c jsonb := p_compra;
  f_cot date := public._jfecha(p_compra->'fecha_cotizacion');
  hoy date := (now() AT TIME ZONE 'America/Asuncion')::date;
BEGIN
  PERFORM public._exigir_compras(p_obra);
  IF coalesce(trim(public._jtxt(p_compra->'descripcion')), '') = '' THEN
    RAISE EXCEPTION 'Falta la descripción del recurso a comprar.' USING ERRCODE = '22023';
  END IF;
  IF cid IS NULL THEN cid := 'cp_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 5); END IF;
  SELECT * INTO v FROM public.compra WHERE obra_id = p_obra AND compra_id = cid FOR UPDATE;
  nuevo := NOT FOUND;
  -- v20261014d: alguien guardó este pedido después de que lo abrí → conflicto (no se pisa en silencio)
  IF NOT nuevo AND p_compra ? '_base_editado_en'
     AND v.editado_en IS DISTINCT FROM nullif(p_compra->>'_base_editado_en', '')::timestamptz THEN
    RAISE EXCEPTION 'conflicto' USING ERRCODE = 'PT409',
      DETAIL = json_build_object(
        'por', v.editado_por,
        'ts', to_char(v.editado_en AT TIME ZONE 'America/Asuncion', 'DD/MM HH24:MI'),
        'editado_en', v.editado_en, 'accion', 'pedido de compra')::text;
  END IF;
  -- las columnas viejas de aprobación se conservan como estaban (historial)
  c := c || jsonb_build_object('aprobacion', CASE WHEN nuevo THEN '' ELSE v.aprobacion END,
                               'fecha_aprobacion', CASE WHEN nuevo THEN NULL ELSE v.fecha_aprobacion END);
  PERFORM public._compra_set(p_obra, cid, c, public.app_email(), nuevo);
  -- Fechas para los KPI. Solo se ponen "hoy" cuando la etapa se cumple EN ESTE
  -- guardado (antes no estaba cumplida) y la fecha quedó vacía: así los pedidos
  -- viejos de Monday sin fecha no reciben la fecha del día en que se los edita.
  UPDATE public.compra x SET
    fecha_cotizacion = CASE
        WHEN x.pu1 IS NULL AND x.pu2 IS NULL AND x.pu3 IS NULL THEN NULL
        WHEN f_cot IS NOT NULL THEN f_cot
        WHEN NOT nuevo AND (v.pu1 IS NOT NULL OR v.pu2 IS NOT NULL OR v.pu3 IS NOT NULL) THEN v.fecha_cotizacion
        ELSE hoy END,
    fecha_oc = CASE
        WHEN x.fecha_oc IS NOT NULL THEN x.fecha_oc
        WHEN (x.orden_compra <> '' OR x.estado_oc IN ('Creada', 'Aprobación', 'Enviado Proveedor'))
         AND (nuevo OR (coalesce(v.orden_compra, '') = '' AND coalesce(v.estado_oc, '') IN ('', 'Pendiente'))) THEN hoy
        ELSE NULL END,
    fecha_entrega = CASE
        WHEN x.fecha_entrega IS NOT NULL THEN x.fecha_entrega
        WHEN x.entrega = 'Recibido' AND (nuevo OR coalesce(v.entrega, '') <> 'Recibido') THEN hoy
        ELSE NULL END
   WHERE x.obra_id = p_obra AND x.compra_id = cid;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('compra_id', cid, 'nuevo', nuevo);
END $function$;

-- ------------------------------------------------------------------ REVERTIR
-- Volver a crear las tres funciones sin las líneas marcadas v20261014d
-- (en _cron_controlar_rev: comparar contra o.rev_por; en compra_guardar: quitar
-- el bloque del conflicto). La columna obra.rev_subida_por puede quedar.
