-- =====================================================================
-- 50_costos_hoja_gg.sql · v20261019b
-- Costos: se guarda la hoja «Gastos Generales» de cada versión (presupuesto /
-- recosteo) para que al exportar el .xlsm salga la de la obra y no la de la
-- plantilla base. Se guarda como JSON: { hoja, celdas: { "B12": {"v":…} | {"f":"…","v":…} } }.
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

ALTER TABLE public.costo_version ADD COLUMN IF NOT EXISTS hoja_gg jsonb;

CREATE OR REPLACE FUNCTION public.costo_version_hoja_gg(p_obra text, p_version bigint, p_hoja jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cargar costos.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.costo_version SET hoja_gg = p_hoja
   WHERE version_id = p_version AND obra_id = p_obra;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versión de costos % inexistente en la obra %', p_version, p_obra; END IF;
  RETURN json_build_object('ok', true, 'version_id', p_version);
END $$;

REVOKE ALL ON FUNCTION public.costo_version_hoja_gg(text, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.costo_version_hoja_gg(text, bigint, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
