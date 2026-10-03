-- =====================================================================
-- 10_auth_rls.sql — Login y permisos por fila (Row Level Security)
-- Cronograma de Obra · TECSUL · v20261003a
--
-- Replica las reglas del backend Apps Script (Codigo.gs, doPost):
--   * El login es Supabase Auth con correo (@tecsul.com.py). La tabla
--     public.usuario (clave: email) dice quién está habilitado y con qué rol.
--   * Rol (qué puede hacer):
--       admin      lee y escribe; único que borra convenios, notas y obras
--       residente  lee y escribe
--       consulta   solo lee
--       lectura    solo lee
--   * Alcance (dónde): public.usuario_obra. Sin filas = todas las obras
--     (igual que la columna "obras" vacía de la hoja Usuarios).
--   * Un usuario inactivo o que no está en public.usuario no ve nada.
-- =====================================================================

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER: leen usuario/usuario_obra sin chocar con el RLS de esas
-- mismas tablas. STABLE: Postgres los evalúa una vez por consulta.

CREATE OR REPLACE FUNCTION public.app_email()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

CREATE OR REPLACE FUNCTION public.app_rol()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.rol FROM public.usuario u
   WHERE u.email = public.app_email() AND u.activo
$$;

CREATE OR REPLACE FUNCTION public.app_puede_ver(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario u
     WHERE u.email = public.app_email() AND u.activo
       AND ( NOT EXISTS (SELECT 1 FROM public.usuario_obra uo WHERE uo.email = u.email)
             OR EXISTS (SELECT 1 FROM public.usuario_obra uo
                         WHERE uo.email = u.email AND uo.obra_id = p_obra) )
  )
$$;

CREATE OR REPLACE FUNCTION public.app_puede_escribir(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_rol() IN ('admin', 'residente') AND public.app_puede_ver(p_obra)
$$;

CREATE OR REPLACE FUNCTION public.app_es_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.app_rol() = 'admin', false)
$$;

-- Para la PWA: quién soy, con qué rol y qué obras (reemplaza whoami).
CREATE OR REPLACE FUNCTION public.app_whoami()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'email',  u.email,
    'nombre', u.nombre,
    'rol',    u.rol,
    'obras',  coalesce((SELECT json_agg(uo.obra_id ORDER BY uo.obra_id)
                          FROM public.usuario_obra uo WHERE uo.email = u.email), '[]'::json)
  )
  FROM public.usuario u
  WHERE u.email = public.app_email() AND u.activo
$$;

REVOKE ALL ON FUNCTION public.app_rol(), public.app_puede_ver(text), public.app_puede_escribir(text),
                       public.app_es_admin(), public.app_whoami() FROM anon;

-- ------------------------------------------------- tablas con obra_id
-- Patrón: leer si puede ver la obra; insertar/editar/borrar si puede escribir.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categoria','item','item_dependencia','distribucion_mensual','linea_base','linea_base_detalle',
    'plan_semanal','certificacion','produccion_jornada','produccion_fila','calendario',
    'pista_eje','pista_estado','pista_tramo','pista_snapshot','convenio_detalle'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS leer ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS escribir ON public.%I', t);
    EXECUTE format('CREATE POLICY leer ON public.%I FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id))', t);
    EXECUTE format('CREATE POLICY escribir ON public.%I FOR ALL TO authenticated USING (public.app_puede_escribir(obra_id)) WITH CHECK (public.app_puede_escribir(obra_id))', t);
  END LOOP;
END $$;

-- obra: ver las propias; crear/editar con permiso de escritura; borrar solo admin
DROP POLICY IF EXISTS leer ON public.obra;
DROP POLICY IF EXISTS crear ON public.obra;
DROP POLICY IF EXISTS editar ON public.obra;
DROP POLICY IF EXISTS borrar ON public.obra;
CREATE POLICY leer   ON public.obra FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
CREATE POLICY crear  ON public.obra FOR INSERT TO authenticated WITH CHECK (public.app_rol() IN ('admin','residente'));
CREATE POLICY editar ON public.obra FOR UPDATE TO authenticated USING (public.app_puede_escribir(obra_id)) WITH CHECK (public.app_puede_escribir(obra_id));
CREATE POLICY borrar ON public.obra FOR DELETE TO authenticated USING (public.app_es_admin() AND public.app_puede_ver(obra_id));

-- convenio: borrar solo admin (alto impacto: reescribe tope y plazo)
DROP POLICY IF EXISTS leer ON public.convenio;
DROP POLICY IF EXISTS crear ON public.convenio;
DROP POLICY IF EXISTS editar ON public.convenio;
DROP POLICY IF EXISTS borrar ON public.convenio;
CREATE POLICY leer   ON public.convenio FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
CREATE POLICY crear  ON public.convenio FOR INSERT TO authenticated WITH CHECK (public.app_puede_escribir(obra_id));
CREATE POLICY editar ON public.convenio FOR UPDATE TO authenticated USING (public.app_puede_escribir(obra_id)) WITH CHECK (public.app_puede_escribir(obra_id));
CREATE POLICY borrar ON public.convenio FOR DELETE TO authenticated USING (public.app_es_admin() AND public.app_puede_ver(obra_id));

-- comunicacion: borrar solo admin (corregir cargas, no editar la historia)
DROP POLICY IF EXISTS leer ON public.comunicacion;
DROP POLICY IF EXISTS crear ON public.comunicacion;
DROP POLICY IF EXISTS editar ON public.comunicacion;
DROP POLICY IF EXISTS borrar ON public.comunicacion;
CREATE POLICY leer   ON public.comunicacion FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
CREATE POLICY crear  ON public.comunicacion FOR INSERT TO authenticated WITH CHECK (public.app_puede_escribir(obra_id));
CREATE POLICY editar ON public.comunicacion FOR UPDATE TO authenticated USING (public.app_puede_escribir(obra_id)) WITH CHECK (public.app_puede_escribir(obra_id));
CREATE POLICY borrar ON public.comunicacion FOR DELETE TO authenticated USING (public.app_es_admin() AND public.app_puede_ver(obra_id));

-- config: obra_id NULL = configuración global (la leen todos, la edita admin)
DROP POLICY IF EXISTS leer ON public.config;
DROP POLICY IF EXISTS escribir ON public.config;
CREATE POLICY leer ON public.config FOR SELECT TO authenticated
  USING (obra_id IS NULL AND public.app_rol() IS NOT NULL OR public.app_puede_ver(obra_id));
CREATE POLICY escribir ON public.config FOR ALL TO authenticated
  USING (CASE WHEN obra_id IS NULL THEN public.app_es_admin() ELSE public.app_puede_escribir(obra_id) END)
  WITH CHECK (CASE WHEN obra_id IS NULL THEN public.app_es_admin() ELSE public.app_puede_escribir(obra_id) END);

-- usuario / usuario_obra: cada uno ve lo suyo; el admin ve y administra todo
DROP POLICY IF EXISTS leer ON public.usuario;
DROP POLICY IF EXISTS administrar ON public.usuario;
CREATE POLICY leer ON public.usuario FOR SELECT TO authenticated
  USING (email = public.app_email() OR public.app_es_admin());
CREATE POLICY administrar ON public.usuario FOR ALL TO authenticated
  USING (public.app_es_admin()) WITH CHECK (public.app_es_admin());

DROP POLICY IF EXISTS leer ON public.usuario_obra;
DROP POLICY IF EXISTS administrar ON public.usuario_obra;
CREATE POLICY leer ON public.usuario_obra FOR SELECT TO authenticated
  USING (email = public.app_email() OR public.app_es_admin());
CREATE POLICY administrar ON public.usuario_obra FOR ALL TO authenticated
  USING (public.app_es_admin()) WITH CHECK (public.app_es_admin());

-- las vistas leen con los permisos de quien consulta (no del dueño)
ALTER VIEW public.v_comunicacion       SET (security_invoker = true);
ALTER VIEW public.v_item_cantidades    SET (security_invoker = true);
ALTER VIEW public.v_obra_avance        SET (security_invoker = true);
ALTER VIEW public.v_powerbi_liberacion SET (security_invoker = true);
ALTER VIEW public.v_produccion_diaria  SET (security_invoker = true);

-- ---------------------------------------------------------- usuarios
-- José: administrador de todas las obras (el resto se carga desde la PWA o el SQL Editor)
INSERT INTO public.usuario (email, nombre, rol, activo)
VALUES ('jose.espinola@tecsul.com.py', 'José Espínola', 'admin', true)
ON CONFLICT (email) DO UPDATE SET rol = 'admin', activo = true;
