-- 105 · Producción › Historial: editar también la FECHA y el ÍTEM de un registro
-- (v20261111b). Reemplaza prod_editar(text, text, jsonb) — misma firma, mismos permisos.
--
-- · ÍTEM (p_cambios.item_id): cambia el ítem de la fila. Debe existir en la obra y
--   no ser grupo/título. La cantidad, progresivas, etc. quedan como estaban.
-- · FECHA (p_cambios.fecha): la fecha es de la JORNADA. Si la jornada tiene una sola
--   fila (o es una jornada sin filas, p. ej. lluvia), se cambia la fecha de la jornada.
--   Si tiene VARIAS filas, solo la fila editada se muda a una jornada nueva con la
--   fecha nueva (copia estado, responsable, lluvia, observaciones, fotos y quién la
--   cargó); las otras filas quedan en su fecha. El id del registro cambia
--   (submission_id nuevo «<viejo>~<n>»).
-- Todo lo demás es igual a la versión anterior.

CREATE OR REPLACE FUNCTION public.prod_editar(p_obra text, p_id text, p_cambios jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sid text; nro integer; j record; f record; est text; c record;
        l numeric; a numeric; e numeric; q numeric;
        nfecha date; nfilas integer; mudar boolean := false; sid2 text; k integer := 0;
        iid text; it record; id_out text;
BEGIN
  PERFORM public._exigir_carga_propia(p_obra, 'produccion', (SELECT cargado_por FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = split_part(p_id, '#', 1)));
  sid := CASE WHEN position('#' IN p_id) > 0 THEN regexp_replace(p_id, '#[^#]*$', '') ELSE p_id END;
  nro := CASE WHEN position('#' IN p_id) > 0 THEN nullif(regexp_replace(p_id, '^.*#', ''), '')::integer END;
  SELECT * INTO j FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;

  nfecha := CASE WHEN p_cambios ? 'fecha' THEN public._jfecha(p_cambios->'fecha') END;
  IF p_cambios ? 'fecha' AND nfecha IS NULL AND coalesce(public._jtxt(p_cambios->'fecha'), '') <> '' THEN
    RAISE EXCEPTION 'Fecha no válida' USING ERRCODE = '22023';
  END IF;
  IF nfecha IS NOT NULL AND nfecha = j.fecha THEN nfecha := NULL; END IF;     -- sin cambio
  IF nfecha IS NOT NULL AND nro IS NOT NULL THEN
    SELECT count(*) INTO nfilas FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid;
    mudar := nfilas > 1;                       -- varias filas: solo se muda esta
  END IF;

  est := CASE WHEN p_cambios ? 'estado' THEN public._jtxt(p_cambios->'estado') ELSE j.estado END;
  UPDATE public.produccion_jornada SET
    estado    = est,
    fecha     = CASE WHEN nfecha IS NOT NULL AND NOT mudar THEN nfecha ELSE fecha END,
    lluvia_mm = CASE WHEN p_cambios ? 'lluvia_mm' THEN nullif(public._jnum(p_cambios->'lluvia_mm'), 0) ELSE lluvia_mm END
  WHERE obra_id = p_obra AND submission_id = sid;

  IF nro IS NULL THEN
    PERFORM public._cron_tocar(p_obra, false);
    RETURN json_build_object('editado', p_id, 'cantFinal', NULL);
  END IF;

  SELECT * INTO f FROM public.produccion_fila WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el registro' USING ERRCODE = 'P0002'; END IF;

  -- ítem nuevo
  iid := CASE WHEN p_cambios ? 'item_id' THEN nullif(public._jtxt(p_cambios->'item_id'), '') END;
  IF iid IS NOT NULL AND iid <> f.item_id THEN
    SELECT * INTO it FROM public.item WHERE obra_id = p_obra AND item_id = iid;
    IF NOT FOUND THEN RAISE EXCEPTION 'El ítem % no existe en esta obra', iid USING ERRCODE = '22023'; END IF;
    IF lower(coalesce(it.tipo, '')) = 'grupo' OR (coalesce(it.tipo, '') = '' AND coalesce(it.es_grupo, false)) THEN
      RAISE EXCEPTION 'El ítem % es un título/grupo: elegí un ítem de trabajo', iid USING ERRCODE = '22023';
    END IF;
  ELSE
    iid := f.item_id;
  END IF;

  l := CASE WHEN p_cambios ? 'longitud' THEN public._jnum(p_cambios->'longitud') ELSE f.longitud END;
  a := CASE WHEN p_cambios ? 'ancho'    THEN public._jnum(p_cambios->'ancho')    ELSE f.ancho_prom END;
  e := CASE WHEN p_cambios ? 'espesor'  THEN public._jnum(p_cambios->'espesor')  ELSE f.espesor_prom END;
  q := CASE WHEN p_cambios ? 'cantidad' THEN public._jnum(p_cambios->'cantidad') ELSE f.cantidad_dato END;
  -- filas migradas sin dimensiones: la cantidad que había es el dato
  IF q IS NULL AND NOT (p_cambios ? 'cantidad') AND l IS NULL AND a IS NULL THEN q := f.cantidad; END IF;
  c := public._prod_calc(l, a, e, q, NULL, NULL, est);

  UPDATE public.produccion_fila SET
    item_id       = iid,
    lado          = CASE WHEN p_cambios ? 'lado' THEN public._jtxt(p_cambios->'lado') ELSE lado END,
    observaciones = CASE WHEN p_cambios ? 'observaciones' THEN public._jtxt(p_cambios->'observaciones') ELSE observaciones END,
    prog_ini      = CASE WHEN p_cambios ? 'prog_ini' THEN public._jnum(p_cambios->'prog_ini') ELSE prog_ini END,
    prog_fin      = CASE WHEN p_cambios ? 'prog_fin' THEN public._jnum(p_cambios->'prog_fin') ELSE prog_fin END,
    longitud = l, ancho_prom = a, espesor_prom = e, cantidad_dato = q,
    area = c.area, volumen = c.volumen, cantidad = coalesce(c.cant_final, 0)
  WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro;

  id_out := p_id;
  IF mudar THEN
    -- jornada nueva con la fecha nueva (id único), y la fila pasa a ser su fila 1
    LOOP
      k := k + 1;
      sid2 := sid || '~' || k;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid2);
    END LOOP;
    INSERT INTO public.produccion_jornada (obra_id, submission_id, fecha, estado, responsable, lluvia_mm,
                                           observaciones, fotos, cargado_por, cargado_en)
    SELECT obra_id, sid2, nfecha, estado, responsable, lluvia_mm, observaciones, fotos, cargado_por, cargado_en
      FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = sid;
    UPDATE public.produccion_fila SET submission_id = sid2, fila_nro = 1
     WHERE obra_id = p_obra AND submission_id = sid AND fila_nro = nro;
    id_out := sid2 || '#1';
  END IF;

  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('editado', id_out, 'cantFinal', c.cant_final, 'mudado', mudar);
END $function$;

-- verificación: debe devolver «ok»
SELECT 'ok' AS verificacion FROM pg_proc
 WHERE proname = 'prod_editar' AND prosrc LIKE '%mudar%' AND prosrc LIKE '%item_id%';
