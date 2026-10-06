/* =========================================================================
 * 23_roles_compras_gerente_admin.sql — Roles COMPRAS y GERENTE, circuito de
 * aprobación de compras y administración de usuarios · v20261006d
 *
 *  Roles (usuario.rol):
 *    admin       todo, en todas las obras
 *    residente   carga y corrige en sus obras
 *    compras     ve TODAS las obras; en Compras: carga pedidos, cotiza,
 *                registra OC y entregas en cualquier obra. El resto, solo ver.
 *    gerente     ve TODAS las obras, no carga datos; APRUEBA pedidos y
 *                cotizaciones (la aprobación de la cotización es obligatoria
 *                para emitir la OC).
 *    lectura     solo ver
 *    transporte / produccion  usuarios de campo (ver 18_transporte.sql)
 *
 *  Circuito (Manual de procedimientos — Programación de requerimientos):
 *    obra carga el pedido → Gerente aprueba el pedido (o pide corrección /
 *    rechaza) → Compras cotiza (puede empezar antes de la aprobación) →
 *    Gerente APRUEBA LA COTIZACIÓN (obligatorio) → Compras emite la OC en
 *    Unysoft y registra el N° → seguimiento → recepción en obra.
 *    Si se cambia la cotización aprobada (proveedor o precio), la aprobación
 *    se cae y hay que volver a aprobar.
 *
 *  Administración: adm_usuarios() y adm_usuario_guardar() (solo admin).
 *
 *  Se puede correr más de una vez. Correr DESPUÉS de 19, 21 y 22.
 * ========================================================================= */

-- ------------------------------------------------------------- roles
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
ALTER TABLE public.usuario ADD CONSTRAINT usuario_rol_check
  CHECK (rol = ANY (ARRAY['admin', 'residente', 'consulta', 'lectura', 'transporte', 'produccion', 'compras', 'gerente']));

-- Compras: puede escribir pedidos/cotizaciones/OC en la obra
CREATE OR REPLACE FUNCTION public.app_puede_comprar(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_puede_escribir(p_obra) OR (public.app_rol() = 'compras' AND public.app_puede_ver(p_obra))
$$;
-- Gerente (o admin): aprueba pedidos y cotizaciones
CREATE OR REPLACE FUNCTION public.app_puede_aprobar(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.app_rol() IN ('gerente', 'admin'), false) AND public.app_puede_ver(p_obra)
$$;
CREATE OR REPLACE FUNCTION public._exigir_compras(p_obra text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_rol() IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000'; END IF;
  IF NOT public.app_puede_comprar(p_obra) THEN
    RAISE EXCEPTION 'Tu usuario no puede cargar ni modificar compras en la obra %.', p_obra USING ERRCODE = '42501';
  END IF;
END $$;

-- ------------------------------------------------------------- columnas de aprobación
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS aprobado_por   text NOT NULL DEFAULT '';
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS obs_aprobacion text NOT NULL DEFAULT '';
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS cot_estado     text NOT NULL DEFAULT '';   -- '' / Aprobada / Rechazada
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS cot_aprob_por  text NOT NULL DEFAULT '';
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS cot_aprob_en   timestamptz;
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS cot_obs        text NOT NULL DEFAULT '';
ALTER TABLE public.compra ADD COLUMN IF NOT EXISTS cot_firma      text NOT NULL DEFAULT '';   -- proveedor|precio aprobados (para detectar cambios)

-- ------------------------------------------------------------- guardar pedido
/* compra_guardar: admin, residente de la obra o Compras. La aprobación NO se
   toca acá (solo con compra_aprobar / compra_aprobar_cot). Registrar la OC
   exige la cotización aprobada por el Gerente. */
CREATE OR REPLACE FUNCTION public.compra_guardar(p_obra text, p_compra jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid text := nullif(trim(coalesce(public._jtxt(p_compra->'compra_id'), '')), '');
  nuevo boolean; v public.compra; c jsonb := p_compra; firma text; k int;
  oc_nueva text; est_nuevo text;
BEGIN
  PERFORM public._exigir_compras(p_obra);
  IF coalesce(trim(public._jtxt(p_compra->'descripcion')), '') = '' THEN
    RAISE EXCEPTION 'Falta la descripción del recurso a comprar.' USING ERRCODE = '22023';
  END IF;
  IF cid IS NULL THEN cid := 'cp_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 5); END IF;
  SELECT * INTO v FROM public.compra WHERE obra_id = p_obra AND compra_id = cid FOR UPDATE;
  nuevo := NOT FOUND;
  -- la aprobación del pedido se conserva tal como está
  c := c || jsonb_build_object('aprobacion', CASE WHEN nuevo THEN '' ELSE v.aprobacion END,
                               'fecha_aprobacion', CASE WHEN nuevo THEN NULL ELSE v.fecha_aprobacion END);
  -- OC: exige cotización aprobada (salvo que ya estuviera cargada antes)
  oc_nueva := coalesce(trim(public._jtxt(c->'orden_compra')), '');
  est_nuevo := coalesce(public._jtxt(c->'estado_oc'), '');
  IF (oc_nueva <> '' AND coalesce(v.orden_compra, '') = '')
     OR (est_nuevo IN ('Creada', 'Aprobación', 'Enviado Proveedor') AND coalesce(v.estado_oc, '') IN ('', 'Pendiente')) THEN
    IF nuevo OR v.cot_estado <> 'Aprobada' THEN
      RAISE EXCEPTION 'Para registrar la orden de compra, el Gerente tiene que aprobar la cotización primero.' USING ERRCODE = '42501';
    END IF;
  END IF;
  PERFORM public._compra_set(p_obra, cid, c, public.app_email(), nuevo);
  -- si cambió la cotización aprobada (otra elegida, otro proveedor o precio), la aprobación se cae
  IF NOT nuevo AND v.cot_estado = 'Aprobada' THEN
    SELECT cot_elegida INTO k FROM public.compra WHERE obra_id = p_obra AND compra_id = cid;
    SELECT coalesce(cot_elegida::text, '') || '|' ||
           CASE cot_elegida WHEN 1 THEN prov1 || '|' || coalesce(pu1::text, '') WHEN 2 THEN prov2 || '|' || coalesce(pu2::text, '')
                            WHEN 3 THEN prov3 || '|' || coalesce(pu3::text, '') ELSE '' END
      INTO firma FROM public.compra WHERE obra_id = p_obra AND compra_id = cid;
    IF firma IS DISTINCT FROM v.cot_firma THEN
      UPDATE public.compra SET cot_estado = '', cot_obs = 'La cotización cambió después de aprobada: hay que volver a aprobar.'
       WHERE obra_id = p_obra AND compra_id = cid;
    END IF;
  END IF;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('compra_id', cid, 'nuevo', nuevo);
END $$;

CREATE OR REPLACE FUNCTION public.compra_borrar(p_obra text, p_compra_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._exigir_compras(p_obra);
  DELETE FROM public.compra WHERE obra_id = p_obra AND compra_id = p_compra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el pedido.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('borrado', p_compra_id);
END $$;

-- ------------------------------------------------------------- aprobaciones (Gerente)
-- p_decision: 'Aprobado' | 'Falta Especificación' | 'Rechazado' | '' (volver a sin revisar)
CREATE OR REPLACE FUNCTION public.compra_aprobar(p_obra text, p_compra_id text, p_decision text, p_obs text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.app_puede_aprobar(p_obra) THEN RAISE EXCEPTION 'Solo el Gerente aprueba pedidos.' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_decision, '') NOT IN ('', 'Aprobado', 'Falta Especificación', 'Rechazado') THEN
    RAISE EXCEPTION 'Decisión no válida: %', p_decision USING ERRCODE = '22023';
  END IF;
  UPDATE public.compra SET aprobacion = coalesce(p_decision, ''),
         fecha_aprobacion = CASE WHEN coalesce(p_decision, '') = '' THEN NULL ELSE current_date END,
         aprobado_por = CASE WHEN coalesce(p_decision, '') = '' THEN '' ELSE public.app_email() END,
         obs_aprobacion = coalesce(p_obs, ''), editado_por = public.app_email(), editado_en = now()
   WHERE obra_id = p_obra AND compra_id = p_compra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el pedido.' USING ERRCODE = 'P0002'; END IF;
  RETURN json_build_object('compra_id', p_compra_id, 'aprobacion', p_decision);
END $$;

-- p_cot 1..3 = aprueba esa cotización (y el pedido, si no estaba aprobado) · 0 / NULL = rechaza las cotizaciones (recotizar)
CREATE OR REPLACE FUNCTION public.compra_aprobar_cot(p_obra text, p_compra_id text, p_cot integer, p_obs text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.compra; pv text; pu numeric;
BEGIN
  IF NOT public.app_puede_aprobar(p_obra) THEN RAISE EXCEPTION 'Solo el Gerente aprueba cotizaciones.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.compra WHERE obra_id = p_obra AND compra_id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el pedido.' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(p_cot, 0) = 0 THEN
    UPDATE public.compra SET cot_estado = 'Rechazada', cot_aprob_por = public.app_email(), cot_aprob_en = now(),
           cot_obs = coalesce(p_obs, ''), cot_firma = '', editado_por = public.app_email(), editado_en = now()
     WHERE obra_id = p_obra AND compra_id = p_compra_id;
    RETURN json_build_object('compra_id', p_compra_id, 'cot_estado', 'Rechazada');
  END IF;
  IF p_cot NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Cotización no válida.' USING ERRCODE = '22023'; END IF;
  pv := CASE p_cot WHEN 1 THEN v.prov1 WHEN 2 THEN v.prov2 ELSE v.prov3 END;
  pu := CASE p_cot WHEN 1 THEN v.pu1 WHEN 2 THEN v.pu2 ELSE v.pu3 END;
  IF pu IS NULL THEN RAISE EXCEPTION 'La cotización % no tiene precio cargado.', p_cot USING ERRCODE = '22023'; END IF;
  UPDATE public.compra SET cot_elegida = p_cot, cot_estado = 'Aprobada', cot_aprob_por = public.app_email(), cot_aprob_en = now(),
         cot_obs = coalesce(p_obs, ''), cot_firma = p_cot::text || '|' || coalesce(pv, '') || '|' || pu::text,
         aprobacion = CASE WHEN aprobacion IN ('', 'Falta Especificación') THEN 'Aprobado' ELSE aprobacion END,
         fecha_aprobacion = CASE WHEN aprobacion IN ('', 'Falta Especificación') THEN current_date ELSE fecha_aprobacion END,
         aprobado_por = CASE WHEN aprobacion IN ('', 'Falta Especificación') THEN public.app_email() ELSE aprobado_por END,
         editado_por = public.app_email(), editado_en = now()
   WHERE obra_id = p_obra AND compra_id = p_compra_id;
  RETURN json_build_object('compra_id', p_compra_id, 'cot_estado', 'Aprobada', 'cot', p_cot);
END $$;

-- Adjuntos de compras: también Compras puede subir y borrar (factura, OC, cotizaciones)
DROP POLICY IF EXISTS "adjuntos_subir" ON storage.objects;
CREATE POLICY "adjuntos_subir" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'adjuntos' AND (public.app_puede_escribir((storage.foldername(name))[1])
              OR ((storage.foldername(name))[2] = 'compra' AND public.app_puede_comprar((storage.foldername(name))[1]))));
DROP POLICY IF EXISTS "adjuntos_borrar" ON storage.objects;
CREATE POLICY "adjuntos_borrar" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'adjuntos' AND (public.app_puede_escribir((storage.foldername(name))[1])
         OR ((storage.foldername(name))[2] = 'compra' AND public.app_puede_comprar((storage.foldername(name))[1]))));

CREATE OR REPLACE FUNCTION public.adjunto_registrar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid text := nullif(public._jtxt(p->'adjunto_id'), ''); r text := coalesce(public._jtxt(p->'ruta'), ''); m text := coalesce(public._jtxt(p->'modulo'), '');
BEGIN
  IF m = 'compra' THEN PERFORM public._exigir_compras(p_obra); ELSE PERFORM public._cron_exigir_escritura(p_obra); END IF;
  IF split_part(r, '/', 1) <> p_obra OR split_part(r, '/', 2) <> m THEN RAISE EXCEPTION 'La ruta del adjunto no corresponde.' USING ERRCODE = '22023'; END IF;
  IF m = '' OR coalesce(public._jtxt(p->'ref_id'), '') = '' THEN RAISE EXCEPTION 'Falta a qué pertenece el adjunto.' USING ERRCODE = '22023'; END IF;
  IF aid IS NULL THEN aid := 'adj_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6); END IF;
  INSERT INTO public.adjunto (obra_id, adjunto_id, modulo, ref_id, tipo, nombre, mime, tamano, ruta, subido_por, subido_en)
  VALUES (p_obra, aid, m, public._jtxt(p->'ref_id'), coalesce(nullif(public._jtxt(p->'tipo'), ''), 'otro'),
          coalesce(public._jtxt(p->'nombre'), ''), coalesce(public._jtxt(p->'mime'), ''), public._jnum(p->'tamano')::bigint, r,
          public.app_email(), now())
  ON CONFLICT (obra_id, adjunto_id) DO UPDATE SET tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre;
  RETURN json_build_object('adjunto_id', aid);
END $$;

CREATE OR REPLACE FUNCTION public.adjunto_borrar(p_obra text, p_adjunto text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.adjunto;
BEGIN
  SELECT * INTO a FROM public.adjunto WHERE obra_id = p_obra AND adjunto_id = p_adjunto;
  IF NOT FOUND THEN RETURN json_build_object('borrado', p_adjunto, 'ruta', NULL); END IF;
  IF a.modulo = 'compra' THEN PERFORM public._exigir_compras(p_obra); ELSE PERFORM public._cron_exigir_escritura(p_obra); END IF;
  IF a.modulo = 'comunicacion' AND EXISTS (SELECT 1 FROM public.comunicacion c WHERE c.obra_id = p_obra AND c.com_id = a.ref_id AND c.cerrada) THEN
    RAISE EXCEPTION 'La nota está cerrada: sus adjuntos ya no se borran.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.adjunto WHERE obra_id = p_obra AND adjunto_id = p_adjunto;
  RETURN json_build_object('borrado', p_adjunto, 'ruta', a.ruta);
END $$;

-- ------------------------------------------------------------- administración de usuarios
CREATE OR REPLACE FUNCTION public.adm_usuarios()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo el administrador.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT json_agg(json_build_object('email', u.email, 'nombre', u.nombre, 'rol', u.rol, 'activo', u.activo,
            'creado_en', u.creado_en,
            'obras', coalesce((SELECT json_agg(uo.obra_id ORDER BY uo.obra_id) FROM public.usuario_obra uo WHERE uo.email = u.email), '[]'::json),
            'tiene_acceso', EXISTS (SELECT 1 FROM auth.users a WHERE lower(a.email) = u.email),
            'ultimo_ingreso', (SELECT max(a.last_sign_in_at) FROM auth.users a WHERE lower(a.email) = u.email))
          ORDER BY u.rol, u.nombre, u.email) FROM public.usuario u), '[]'::json);
END $$;

/* p: { email | cedula, nombre, rol, activo, obras: [obra_id] }   (obras vacío = todas, salvo roles de campo)
   El ACCESO (contraseña) se crea en Supabase › Authentication › Add user con el mismo correo. */
CREATE OR REPLACE FUNCTION public.adm_usuario_guardar(p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em text := lower(trim(coalesce(public._jtxt(p->'email'), '')));
  r text := coalesce(public._jtxt(p->'rol'), '');
  o text;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo el administrador.' USING ERRCODE = '42501'; END IF;
  IF em = '' THEN RAISE EXCEPTION 'Falta el correo o la cédula.' USING ERRCODE = '22023'; END IF;
  IF position('@' IN em) = 0 THEN em := regexp_replace(em, '[^0-9a-z]', '', 'g') || '@campo.tecsul.com.py'; END IF;
  IF r NOT IN ('admin', 'residente', 'lectura', 'transporte', 'produccion', 'compras', 'gerente') THEN
    RAISE EXCEPTION 'Rol no válido: %', r USING ERRCODE = '22023';
  END IF;
  IF r IN ('transporte', 'produccion') AND jsonb_array_length(coalesce(p->'obras', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A los usuarios de campo hay que asignarles al menos una obra.' USING ERRCODE = '22023';
  END IF;
  IF em = public.app_email() AND (r <> 'admin' OR coalesce((p->>'activo')::boolean, true) = false) THEN
    RAISE EXCEPTION 'No podés quitarte a vos mismo el rol de administrador.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.usuario (email, nombre, rol, activo)
  VALUES (em, coalesce(public._jtxt(p->'nombre'), ''), r, coalesce((p->>'activo')::boolean, true))
  ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol, activo = EXCLUDED.activo;
  DELETE FROM public.usuario_obra WHERE email = em;
  FOR o IN SELECT jsonb_array_elements_text(coalesce(p->'obras', '[]'::jsonb)) LOOP
    INSERT INTO public.usuario_obra (email, obra_id) VALUES (em, trim(o)) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN json_build_object('email', em, 'rol', r);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.compra_guardar(text,jsonb)', 'public.compra_borrar(text,text)',
                           'public.compra_aprobar(text,text,text,text)', 'public.compra_aprobar_cot(text,text,integer,text)',
                           'public.adjunto_registrar(text,jsonb)', 'public.adjunto_borrar(text,text)',
                           'public.adm_usuarios()', 'public.adm_usuario_guardar(jsonb)',
                           'public.app_puede_comprar(text)', 'public.app_puede_aprobar(text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public._exigir_compras(text) FROM PUBLIC, anon, authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
