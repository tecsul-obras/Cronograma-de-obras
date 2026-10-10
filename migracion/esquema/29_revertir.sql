/* =========================================================================
 * 29_revertir.sql — Deshace 29_seguridad_higiene.sql · v20261010a
 *
 * Solo si después del 29 algo de la app deja de guardar. Repone las
 * políticas de escritura tal como estaban el 10/10/2026 y devuelve los
 * permisos al anónimo. El search_path fijo (parte B) no se revierte: no
 * cambia nada de lo que hace la app.
 * ========================================================================= */

BEGIN;

-- C. políticas de escritura directa (copiadas de la base el 10/10/2026)
DROP POLICY IF EXISTS escribir ON public.calendario;
DROP POLICY IF EXISTS escribir ON public.categoria;
DROP POLICY IF EXISTS escribir ON public.certificacion;
DROP POLICY IF EXISTS escribir ON public.certificado;
DROP POLICY IF EXISTS borrar   ON public.comunicacion;
DROP POLICY IF EXISTS crear    ON public.comunicacion;
DROP POLICY IF EXISTS editar   ON public.comunicacion;
DROP POLICY IF EXISTS escribir ON public.config;
DROP POLICY IF EXISTS borrar   ON public.convenio;
DROP POLICY IF EXISTS crear    ON public.convenio;
DROP POLICY IF EXISTS editar   ON public.convenio;
DROP POLICY IF EXISTS escribir ON public.convenio_detalle;
DROP POLICY IF EXISTS escribir ON public.distribucion_mensual;
DROP POLICY IF EXISTS escribir ON public.item;
DROP POLICY IF EXISTS escribir ON public.item_dependencia;
DROP POLICY IF EXISTS escribir ON public.linea_base;
DROP POLICY IF EXISTS escribir ON public.linea_base_detalle;
DROP POLICY IF EXISTS borrar   ON public.obra;
DROP POLICY IF EXISTS crear    ON public.obra;
DROP POLICY IF EXISTS editar   ON public.obra;
DROP POLICY IF EXISTS escribir ON public.pista_eje;
DROP POLICY IF EXISTS escribir ON public.pista_estado;
DROP POLICY IF EXISTS escribir ON public.pista_snapshot;
DROP POLICY IF EXISTS escribir ON public.pista_tramo;
DROP POLICY IF EXISTS escribir ON public.plan_semanal;
DROP POLICY IF EXISTS escribir ON public.produccion_fila;
DROP POLICY IF EXISTS escribir ON public.produccion_jornada;

CREATE POLICY escribir ON public.calendario AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.categoria AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.certificacion AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.certificado AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY borrar ON public.comunicacion AS PERMISSIVE FOR DELETE TO authenticated USING ((app_es_admin() AND app_puede_ver(obra_id)));
CREATE POLICY crear ON public.comunicacion AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY editar ON public.comunicacion AS PERMISSIVE FOR UPDATE TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.config AS PERMISSIVE FOR ALL TO authenticated
  USING (CASE WHEN (obra_id IS NULL) THEN app_es_admin() ELSE app_puede_escribir(obra_id) END)
  WITH CHECK (CASE WHEN (obra_id IS NULL) THEN app_es_admin() ELSE app_puede_escribir(obra_id) END);
CREATE POLICY borrar ON public.convenio AS PERMISSIVE FOR DELETE TO authenticated USING ((app_es_admin() AND app_puede_ver(obra_id)));
CREATE POLICY crear ON public.convenio AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY editar ON public.convenio AS PERMISSIVE FOR UPDATE TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.convenio_detalle AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.distribucion_mensual AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.item AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.item_dependencia AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.linea_base AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.linea_base_detalle AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY borrar ON public.obra AS PERMISSIVE FOR DELETE TO authenticated USING ((app_es_admin() AND app_puede_ver(obra_id)));
CREATE POLICY crear ON public.obra AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((app_rol() = ANY (ARRAY['admin'::text, 'residente'::text])));
CREATE POLICY editar ON public.obra AS PERMISSIVE FOR UPDATE TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.pista_eje AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.pista_estado AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.pista_snapshot AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.pista_tramo AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.plan_semanal AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.produccion_fila AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));
CREATE POLICY escribir ON public.produccion_jornada AS PERMISSIVE FOR ALL TO authenticated USING (app_puede_escribir(obra_id)) WITH CHECK (app_puede_escribir(obra_id));

-- D. permisos de tablas como estaban
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.req_aplicado TO anon, authenticated;

-- A. funciones: vuelve a ejecutar cualquiera que antes tenía PUBLIC
--    (solo las que el 29 cerró; las internas _cron_*, _conv_* siguen cerradas)
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_chapa_key(text)', '_espesor_m(numeric)', '_exigir_carga_propia(text,text,text)', '_exigir_carga(text,text)',
    '_jbool(jsonb)', '_jfecha(jsonb)', '_jmes(jsonb)', '_jnum(jsonb)', '_jtxt(jsonb)', '_num_py(numeric)',
    '_prod_calc(numeric,numeric,numeric,numeric,numeric,numeric,text)', 'app_email()', 'app_es_admin()',
    'app_puede_escribir(text)', 'app_puede_ver(text)', 'app_rol()', 'app_whoami()',
    'fn_comunicacion_cerrada()', 'fn_lb_detalle_inmutable()', 'fn_linea_base_inmutable()',
    'fn_rev_monotonica()', 'fn_tope_certificacion()', 'rls_auto_enable()']
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO PUBLIC', f);
  END LOOP;
END $$;

-- E. permisos por defecto como estaban
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
