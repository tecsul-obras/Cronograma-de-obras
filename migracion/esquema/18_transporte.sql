/* =========================================================================
 * 18_transporte.sql — Pestaña TRANSPORTE / CAMIONES (ex "Planilla de carga de
 * pista" de Jotform) y roles de campo · v20261004d
 *
 *  1. Roles nuevos:
 *       'transporte' → solo carga viajes de camiones en sus obras.
 *       'produccion' → solo carga producción (liberaciones) en sus obras.
 *     Los dos ven SOLO las obras que tengan asignadas en usuario_obra (sin
 *     obras asignadas no ven ninguna, a diferencia de admin/residente/lectura).
 *     Pueden corregir o borrar lo que cargaron ellos mismos.
 *  2. Tablas transporte_carga (una planilla) y transporte_viaje (un camión de
 *     la planilla: chapa, viajes y toneladas TOTALES de la fila).
 *  3. tr_guardar (idempotente por carga_id: la cola offline puede reenviar sin
 *     duplicar), tr_editar, tr_borrar.
 *  4. Altas de usuarios de campo: adm_usuario_campo(cedula, nombre, rol, obras).
 *
 * Sin redondeos: se guarda lo que se carga. Se puede correr más de una vez.
 * ========================================================================= */

-- ------------------------------------------------------------- permisos
-- Los roles de campo solo ven las obras que tienen asignadas explícitamente.
CREATE OR REPLACE FUNCTION public.app_puede_ver(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario u
     WHERE u.email = public.app_email() AND u.activo
       AND ( ( u.rol NOT IN ('transporte', 'produccion')
               AND NOT EXISTS (SELECT 1 FROM public.usuario_obra uo WHERE uo.email = u.email) )
             OR EXISTS (SELECT 1 FROM public.usuario_obra uo
                         WHERE uo.email = u.email AND uo.obra_id = p_obra) )
  )
$$;

-- ¿Puede cargar en este módulo ('produccion' | 'transporte')?
CREATE OR REPLACE FUNCTION public.app_puede_cargar(p_obra text, p_modulo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_puede_escribir(p_obra)
      OR (public.app_rol() = p_modulo AND public.app_puede_ver(p_obra))
$$;

CREATE OR REPLACE FUNCTION public._exigir_carga(p_obra text, p_modulo text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_rol() IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000'; END IF;
  IF NOT public.app_puede_cargar(p_obra, p_modulo) THEN
    RAISE EXCEPTION 'Sin permiso para cargar en la obra %', p_obra USING ERRCODE = '42501';
  END IF;
END $$;

-- Corregir o borrar: admin/residente cualquiera; el rol de campo solo lo suyo.
CREATE OR REPLACE FUNCTION public._exigir_carga_propia(p_obra text, p_modulo text, p_cargado_por text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_puede_escribir(p_obra) THEN RETURN; END IF;
  PERFORM public._exigir_carga(p_obra, p_modulo);
  IF coalesce(p_cargado_por, '') <> public.app_email() THEN
    RAISE EXCEPTION 'Solo podés corregir lo que cargaste vos.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Producción: el rol 'produccion' también puede guardar; editar/borrar solo lo suyo.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.prod_guardar(text,jsonb,text[])'::regprocedure);
  IF position('_cron_exigir_escritura(p_obra)' IN d) > 0 THEN
    EXECUTE replace(d, 'PERFORM public._cron_exigir_escritura(p_obra);', 'PERFORM public._exigir_carga(p_obra, ''produccion'');');
  END IF;
  d := pg_get_functiondef('public.prod_editar(text,text,jsonb)'::regprocedure);
  IF position('_cron_exigir_escritura(p_obra)' IN d) > 0 THEN
    EXECUTE replace(d, 'PERFORM public._cron_exigir_escritura(p_obra);',
      'PERFORM public._exigir_carga_propia(p_obra, ''produccion'', (SELECT cargado_por FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = split_part(p_id, ''#'', 1)));');
  END IF;
  d := pg_get_functiondef('public.prod_borrar(text,text)'::regprocedure);
  IF position('_cron_exigir_escritura(p_obra)' IN d) > 0 THEN
    EXECUTE replace(d, 'PERFORM public._cron_exigir_escritura(p_obra);',
      'PERFORM public._exigir_carga_propia(p_obra, ''produccion'', (SELECT cargado_por FROM public.produccion_jornada WHERE obra_id = p_obra AND submission_id = split_part(p_id, ''#'', 1)));');
  END IF;
END $$;

-- Fotos: los roles de campo también suben a la carpeta de sus obras.
DROP POLICY IF EXISTS "fotos_obra_subir" ON storage.objects;
CREATE POLICY "fotos_obra_subir" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-obra' AND (public.app_puede_escribir((storage.foldername(name))[1])
              OR (public.app_rol() IN ('produccion', 'transporte') AND public.app_puede_ver((storage.foldername(name))[1]))));
DROP POLICY IF EXISTS "fotos_obra_reemplazar" ON storage.objects;
CREATE POLICY "fotos_obra_reemplazar" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'fotos-obra' AND (public.app_puede_escribir((storage.foldername(name))[1])
         OR (public.app_rol() IN ('produccion', 'transporte') AND public.app_puede_ver((storage.foldername(name))[1]))))
  WITH CHECK (bucket_id = 'fotos-obra' AND (public.app_puede_escribir((storage.foldername(name))[1])
         OR (public.app_rol() IN ('produccion', 'transporte') AND public.app_puede_ver((storage.foldername(name))[1]))));

-- ------------------------------------------------------------- tablas
CREATE TABLE IF NOT EXISTS public.transporte_carga (
  obra_id        text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  carga_id       text NOT NULL CHECK (carga_id <> ''),        -- Submission ID de Jotform o id de la PWA
  fecha          date NOT NULL,
  tipo_actividad text NOT NULL DEFAULT '',                     -- Carga en pista / Entrada de materiales a campamento / Descarga en acopio intermedio
  codigo_cc      text NOT NULL DEFAULT '',                     -- centro de costo (codigo_cc del ítem)
  item_id        text,                                         -- ítem de la obra con ese codigo_cc, si existe
  cc_texto       text NOT NULL DEFAULT '',                     -- texto del centro de costo tal como vino
  tipo_material  text NOT NULL DEFAULT '',
  origen         text NOT NULL DEFAULT '',
  destino        text NOT NULL DEFAULT '',
  prog_origen    text NOT NULL DEFAULT '',
  prog_ini       text NOT NULL DEFAULT '',
  prog_fin       text NOT NULL DEFAULT '',
  distancia_km   numeric,
  litros_ini     numeric,                                      -- emulsión asfáltica
  litros_fin     numeric,
  litros_usados  numeric,
  m2_pista       numeric,
  m3_hormigon    numeric,
  encargado      text NOT NULL DEFAULT '',
  observaciones  text NOT NULL DEFAULT '',
  fotos          text[] NOT NULL DEFAULT '{}',
  cargado_por    text NOT NULL DEFAULT '',
  cargado_en     timestamptz NOT NULL DEFAULT now(),
  editado_por    text NOT NULL DEFAULT '',
  editado_en     timestamptz,
  origen_dato    text NOT NULL DEFAULT 'pwa',                  -- 'pwa' | 'jotform'
  PRIMARY KEY (obra_id, carga_id)
);
CREATE INDEX IF NOT EXISTS transporte_carga_fecha ON public.transporte_carga (obra_id, fecha);

CREATE TABLE IF NOT EXISTS public.transporte_viaje (
  obra_id   text    NOT NULL,
  carga_id  text    NOT NULL,
  orden     integer NOT NULL,
  chapa     text    NOT NULL DEFAULT '',
  viajes    numeric,
  toneladas numeric,                                           -- total de la fila (no por viaje)
  PRIMARY KEY (obra_id, carga_id, orden),
  FOREIGN KEY (obra_id, carga_id) REFERENCES public.transporte_carga(obra_id, carga_id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transporte_carga', 'transporte_viaje'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS leer ON public.%I', t);
    EXECUTE format('CREATE POLICY leer ON public.%I FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id))', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------- escrituras
CREATE OR REPLACE FUNCTION public._tr_validar(p_obra text, c jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF public._jfecha(c->'fecha') IS NULL THEN RAISE EXCEPTION 'Elegí la fecha' USING ERRCODE = '22023'; END IF;
  IF coalesce(public._jtxt(c->'tipo_actividad'), '') = '' THEN RAISE EXCEPTION 'Elegí el tipo de actividad' USING ERRCODE = '22023'; END IF;
  IF coalesce(public._jtxt(c->'tipo_material'), '') = '' THEN RAISE EXCEPTION 'Elegí el tipo de material' USING ERRCODE = '22023'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public._tr_viajes(p_obra text, p_carga text, p_viajes jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb; k integer := 0;
BEGIN
  DELETE FROM public.transporte_viaje WHERE obra_id = p_obra AND carga_id = p_carga;
  FOR v IN SELECT * FROM jsonb_array_elements(coalesce(p_viajes, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(public._jtxt(v->'chapa'), '') = '' AND public._jnum(v->'viajes') IS NULL AND public._jnum(v->'toneladas') IS NULL;
    k := k + 1;
    INSERT INTO public.transporte_viaje (obra_id, carga_id, orden, chapa, viajes, toneladas)
    VALUES (p_obra, p_carga, k, upper(coalesce(public._jtxt(v->'chapa'), '')), public._jnum(v->'viajes'), public._jnum(v->'toneladas'));
  END LOOP;
  RETURN k;
END $$;

/* p_carga: { carga_id, fecha, tipo_actividad, codigo_cc, tipo_material, origen, destino,
              prog_origen, prog_ini, prog_fin, distancia_km, litros_ini, litros_fin, litros_usados,
              m2_pista, m3_hormigon, encargado, observaciones }
   p_viajes: [{ chapa, viajes, toneladas }]   p_fotos: urls ya subidas a Storage */
CREATE OR REPLACE FUNCTION public.tr_guardar(p_obra text, p_carga jsonb, p_viajes jsonb, p_fotos text[] DEFAULT '{}')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid text := nullif(public._jtxt(p_carga->'carga_id'), '');
  yo text := public.app_email();
  enc text := coalesce(public._jtxt(p_carga->'encargado'), '');
  cc text := coalesce(public._jtxt(p_carga->'codigo_cc'), '');
  iid text; n integer;
BEGIN
  PERFORM public._exigir_carga(p_obra, 'transporte');
  PERFORM public._tr_validar(p_obra, p_carga);
  IF cid IS NULL THEN cid := 'pwa_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6); END IF;
  IF EXISTS (SELECT 1 FROM public.transporte_carga WHERE obra_id = p_obra AND carga_id = cid) THEN
    SELECT count(*) INTO n FROM public.transporte_viaje WHERE obra_id = p_obra AND carga_id = cid;
    RETURN json_build_object('carga_id', cid, 'viajes', n, 'repetido', true);
  END IF;
  IF public.app_rol() = 'transporte' OR enc = '' THEN
    SELECT coalesce(nullif(nombre, ''), email) INTO enc FROM public.usuario WHERE email = yo;
  END IF;
  SELECT item_id INTO iid FROM public.item WHERE obra_id = p_obra AND cc <> '' AND codigo_cc = cc ORDER BY orden LIMIT 1;
  INSERT INTO public.transporte_carga (obra_id, carga_id, fecha, tipo_actividad, codigo_cc, item_id, cc_texto,
      tipo_material, origen, destino, prog_origen, prog_ini, prog_fin, distancia_km, litros_ini, litros_fin,
      litros_usados, m2_pista, m3_hormigon, encargado, observaciones, fotos, cargado_por, cargado_en, origen_dato)
  VALUES (p_obra, cid, public._jfecha(p_carga->'fecha'), public._jtxt(p_carga->'tipo_actividad'), cc, iid,
      coalesce(public._jtxt(p_carga->'cc_texto'), ''), public._jtxt(p_carga->'tipo_material'),
      coalesce(public._jtxt(p_carga->'origen'), ''), coalesce(public._jtxt(p_carga->'destino'), ''),
      coalesce(public._jtxt(p_carga->'prog_origen'), ''), coalesce(public._jtxt(p_carga->'prog_ini'), ''),
      coalesce(public._jtxt(p_carga->'prog_fin'), ''), public._jnum(p_carga->'distancia_km'),
      public._jnum(p_carga->'litros_ini'), public._jnum(p_carga->'litros_fin'), public._jnum(p_carga->'litros_usados'),
      public._jnum(p_carga->'m2_pista'), public._jnum(p_carga->'m3_hormigon'), coalesce(enc, ''),
      coalesce(public._jtxt(p_carga->'observaciones'), ''), coalesce(p_fotos, '{}'), yo, now(), 'pwa');
  n := public._tr_viajes(p_obra, cid, p_viajes);
  RETURN json_build_object('carga_id', cid, 'viajes', n);
END $$;

-- Corrige una carga (los campos que vengan) y, si viene p_viajes, reemplaza los camiones.
CREATE OR REPLACE FUNCTION public.tr_editar(p_obra text, p_carga_id text, p_cambios jsonb, p_viajes jsonb DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.transporte_carga; cc text; n integer;
BEGIN
  SELECT * INTO c FROM public.transporte_carga WHERE obra_id = p_obra AND carga_id = p_carga_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la carga.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._exigir_carga_propia(p_obra, 'transporte', c.cargado_por);
  cc := CASE WHEN p_cambios ? 'codigo_cc' THEN coalesce(public._jtxt(p_cambios->'codigo_cc'), '') ELSE c.codigo_cc END;
  UPDATE public.transporte_carga SET
    fecha          = CASE WHEN p_cambios ? 'fecha' THEN coalesce(public._jfecha(p_cambios->'fecha'), fecha) ELSE fecha END,
    tipo_actividad = CASE WHEN p_cambios ? 'tipo_actividad' THEN coalesce(public._jtxt(p_cambios->'tipo_actividad'), '') ELSE tipo_actividad END,
    codigo_cc      = cc,
    item_id        = CASE WHEN p_cambios ? 'codigo_cc' THEN (SELECT i.item_id FROM public.item i WHERE i.obra_id = p_obra AND cc <> '' AND i.codigo_cc = cc ORDER BY i.orden LIMIT 1) ELSE item_id END,
    tipo_material  = CASE WHEN p_cambios ? 'tipo_material' THEN coalesce(public._jtxt(p_cambios->'tipo_material'), '') ELSE tipo_material END,
    origen         = CASE WHEN p_cambios ? 'origen' THEN coalesce(public._jtxt(p_cambios->'origen'), '') ELSE origen END,
    destino        = CASE WHEN p_cambios ? 'destino' THEN coalesce(public._jtxt(p_cambios->'destino'), '') ELSE destino END,
    prog_origen    = CASE WHEN p_cambios ? 'prog_origen' THEN coalesce(public._jtxt(p_cambios->'prog_origen'), '') ELSE prog_origen END,
    prog_ini       = CASE WHEN p_cambios ? 'prog_ini' THEN coalesce(public._jtxt(p_cambios->'prog_ini'), '') ELSE prog_ini END,
    prog_fin       = CASE WHEN p_cambios ? 'prog_fin' THEN coalesce(public._jtxt(p_cambios->'prog_fin'), '') ELSE prog_fin END,
    distancia_km   = CASE WHEN p_cambios ? 'distancia_km' THEN public._jnum(p_cambios->'distancia_km') ELSE distancia_km END,
    litros_ini     = CASE WHEN p_cambios ? 'litros_ini' THEN public._jnum(p_cambios->'litros_ini') ELSE litros_ini END,
    litros_fin     = CASE WHEN p_cambios ? 'litros_fin' THEN public._jnum(p_cambios->'litros_fin') ELSE litros_fin END,
    litros_usados  = CASE WHEN p_cambios ? 'litros_usados' THEN public._jnum(p_cambios->'litros_usados') ELSE litros_usados END,
    m2_pista       = CASE WHEN p_cambios ? 'm2_pista' THEN public._jnum(p_cambios->'m2_pista') ELSE m2_pista END,
    m3_hormigon    = CASE WHEN p_cambios ? 'm3_hormigon' THEN public._jnum(p_cambios->'m3_hormigon') ELSE m3_hormigon END,
    encargado      = CASE WHEN p_cambios ? 'encargado' AND public.app_puede_escribir(p_obra) THEN coalesce(public._jtxt(p_cambios->'encargado'), '') ELSE encargado END,
    observaciones  = CASE WHEN p_cambios ? 'observaciones' THEN coalesce(public._jtxt(p_cambios->'observaciones'), '') ELSE observaciones END,
    editado_por = public.app_email(), editado_en = now()
  WHERE obra_id = p_obra AND carga_id = p_carga_id;
  IF p_viajes IS NOT NULL THEN n := public._tr_viajes(p_obra, p_carga_id, p_viajes); END IF;
  RETURN json_build_object('carga_id', p_carga_id, 'editado', true);
END $$;

CREATE OR REPLACE FUNCTION public.tr_borrar(p_obra text, p_carga_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE quien text;
BEGIN
  SELECT cargado_por INTO quien FROM public.transporte_carga WHERE obra_id = p_obra AND carga_id = p_carga_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la carga.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._exigir_carga_propia(p_obra, 'transporte', quien);
  DELETE FROM public.transporte_carga WHERE obra_id = p_obra AND carga_id = p_carga_id;   -- los viajes caen en cascada
  RETURN json_build_object('borrado', p_carga_id);
END $$;

-- ------------------------------------------------------------- altas de campo
/* El usuario de Auth lo crea el administrador en Supabase › Authentication ›
   Add user (email = <cedula>@campo.tecsul.com.py, contraseña, Auto Confirm).
   Esta función lo habilita en la app con su rol y sus obras.
   Ej.: SELECT adm_usuario_campo('4123456', 'Wilson Aguilera', 'transporte', ARRAY['2240100000']); */
CREATE OR REPLACE FUNCTION public.adm_usuario_campo(p_cedula text, p_nombre text, p_rol text, p_obras text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text := lower(trim(p_cedula)); o text;
BEGIN
  IF auth.jwt() IS NOT NULL AND (auth.jwt() ->> 'role') = 'authenticated' AND NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede dar de alta usuarios.' USING ERRCODE = '42501';
  END IF;
  IF p_rol NOT IN ('transporte', 'produccion', 'lectura', 'residente') THEN
    RAISE EXCEPTION 'Rol no válido: %', p_rol USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(p_obras, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Asigná al menos una obra.' USING ERRCODE = '22023';
  END IF;
  IF position('@' IN em) = 0 THEN em := regexp_replace(em, '[^0-9a-z]', '', 'g') || '@campo.tecsul.com.py'; END IF;
  INSERT INTO public.usuario (email, nombre, rol, activo) VALUES (em, coalesce(p_nombre, ''), p_rol, true)
  ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol, activo = true;
  DELETE FROM public.usuario_obra WHERE email = em;
  FOREACH o IN ARRAY p_obras LOOP
    INSERT INTO public.usuario_obra (email, obra_id) VALUES (em, trim(o)) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN json_build_object('email', em, 'rol', p_rol, 'obras', p_obras);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.tr_guardar(text,jsonb,jsonb,text[])', 'public.tr_editar(text,text,jsonb,jsonb)',
                           'public.tr_borrar(text,text)', 'public.app_puede_cargar(text,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public.adm_usuario_campo(text,text,text,text[]) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public._tr_viajes(text,text,jsonb), public._tr_validar(text,jsonb) FROM PUBLIC, anon, authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
