/* =========================================================================
 * 27_plantilla_costos.sql — Bucket privado para la Plantilla de Costos base
 * v20261007b
 *
 * La app arma el .xlsm de exportación a partir de una plantilla base (la
 * Plantilla de Costos rev19 con sus macros). Como tiene precios de la
 * empresa, NO va en GitHub: se guarda acá, en un bucket privado.
 *   costos/Plantilla_Costos.xlsm
 * Leen: admin, gerente y residente (los que ven costos). Suben: solo admin.
 * Se puede correr más de una vez.
 * ========================================================================= */
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plantillas', 'plantillas', false, 31457280,
        ARRAY['application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel.sheet.macroenabled.12', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "plantillas_leer" ON storage.objects;
CREATE POLICY "plantillas_leer" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plantillas' AND coalesce(public.app_rol() IN ('admin', 'gerente', 'residente'), false));
DROP POLICY IF EXISTS "plantillas_subir" ON storage.objects;
CREATE POLICY "plantillas_subir" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plantillas' AND public.app_es_admin());
DROP POLICY IF EXISTS "plantillas_reemplazar" ON storage.objects;
CREATE POLICY "plantillas_reemplazar" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plantillas' AND public.app_es_admin())
  WITH CHECK (bucket_id = 'plantillas' AND public.app_es_admin());
DROP POLICY IF EXISTS "plantillas_borrar" ON storage.objects;
CREATE POLICY "plantillas_borrar" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plantillas' AND public.app_es_admin());
