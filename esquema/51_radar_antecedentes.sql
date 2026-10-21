-- =====================================================================
-- 51_radar_antecedentes.sql · v20261020a
-- Licitaciones › Antecedentes de obra: catálogo de contratos, actas de
-- recepción, convenios, formularios y documentos del personal que se usan
-- para armar ofertas. Los PDF viven en Google Drive (con su propio permiso);
-- acá se guarda solo el índice: datos del documento, el ID del archivo en
-- Drive y el texto OCR para la búsqueda.
--
-- Permisos: los mismos del Radar.
--   · ver   → radar_access(false)  (admin, gerentes, habilitados del Radar)
--   · cargar/editar/borrar → radar_access(true)
-- Las escrituras pasan solo por las funciones de abajo (no hay INSERT/UPDATE
-- directo desde el cliente).
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.radar_antecedentes (
  id              text PRIMARY KEY,                 -- D001, D002… o el que genere la app
  obra_codigo     text NOT NULL,                    -- OB01…, LIC, PER
  obra            text NOT NULL,                    -- nombre de la obra o grupo
  contratante     text NOT NULL DEFAULT '',
  contrato        text NOT NULL DEFAULT '',         -- N° de contrato
  referencia      text NOT NULL DEFAULT '',         -- llamado / ID DNCP / financiamiento
  tipo            text NOT NULL,                    -- Contrato, Acta de Recepción Definitiva…
  detalle         text NOT NULL DEFAULT '',
  fecha           text NOT NULL DEFAULT '',         -- como figura en el documento (dd/mm/aaaa, mm/aaaa o aaaa)
  paginas         integer,
  monto           numeric,
  moneda          text,
  drive_id        text,                             -- ID del PDF en Google Drive
  carpeta         text NOT NULL DEFAULT '',
  origen          text NOT NULL DEFAULT '',         -- de qué escaneo y páginas salió
  texto           text NOT NULL DEFAULT '',         -- OCR completo
  texto_norm      text NOT NULL DEFAULT '',         -- metadatos + OCR en minúsculas y sin tildes (para buscar)
  actualizado     timestamptz NOT NULL DEFAULT now(),
  actualizado_por text
);

CREATE INDEX IF NOT EXISTS radar_antecedentes_obra_idx ON public.radar_antecedentes (obra_codigo);

ALTER TABLE public.radar_antecedentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS radar_antecedentes_ver ON public.radar_antecedentes;
CREATE POLICY radar_antecedentes_ver ON public.radar_antecedentes
  FOR SELECT TO authenticated
  USING (public.radar_access(false));

REVOKE ALL ON public.radar_antecedentes FROM PUBLIC, anon;
GRANT SELECT ON public.radar_antecedentes TO authenticated;

-- ---------------------------------------------------------------- guardar
-- p: { id?, obra_codigo, obra, contratante, contrato, referencia, tipo,
--      detalle, fecha, paginas, monto, moneda, drive_id, carpeta, origen }
-- El OCR (texto) no se toca desde la app: se conserva el que haya.
CREATE OR REPLACE FUNCTION public.radar_antecedente_guardar(p jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id   text := nullif(trim(p->>'id'), '');
  v_quien text;
  v_texto text;
  v_fila public.radar_antecedentes;
BEGIN
  IF NOT public.radar_access(true) THEN
    RAISE EXCEPTION 'Tu usuario no puede cargar antecedentes. Pedí acceso de edición al Radar.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p->>'obra_codigo'), '') = '' OR coalesce(trim(p->>'obra'), '') = '' OR coalesce(trim(p->>'tipo'), '') = '' THEN
    RAISE EXCEPTION 'Faltan datos: código de obra, obra y tipo de documento son obligatorios.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), u.email) INTO v_quien FROM auth.users u WHERE u.id = auth.uid();
  IF v_id IS NULL THEN
    v_id := 'D' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');
  END IF;
  SELECT texto INTO v_texto FROM public.radar_antecedentes WHERE id = v_id;

  INSERT INTO public.radar_antecedentes AS a
    (id, obra_codigo, obra, contratante, contrato, referencia, tipo, detalle, fecha, paginas, monto, moneda,
     drive_id, carpeta, origen, texto, texto_norm, actualizado, actualizado_por)
  VALUES
    (v_id, trim(p->>'obra_codigo'), trim(p->>'obra'), coalesce(trim(p->>'contratante'), ''), coalesce(trim(p->>'contrato'), ''),
     coalesce(trim(p->>'referencia'), ''), trim(p->>'tipo'), coalesce(trim(p->>'detalle'), ''), coalesce(trim(p->>'fecha'), ''),
     nullif(p->>'paginas', '')::integer, nullif(p->>'monto', '')::numeric, nullif(trim(p->>'moneda'), ''),
     nullif(trim(p->>'drive_id'), ''), coalesce(trim(p->>'carpeta'), ''), coalesce(trim(p->>'origen'), ''),
     coalesce(v_texto, ''), '', now(), v_quien)
  ON CONFLICT (id) DO UPDATE SET
    obra_codigo = EXCLUDED.obra_codigo, obra = EXCLUDED.obra, contratante = EXCLUDED.contratante,
    contrato = EXCLUDED.contrato, referencia = EXCLUDED.referencia, tipo = EXCLUDED.tipo,
    detalle = EXCLUDED.detalle, fecha = EXCLUDED.fecha, paginas = EXCLUDED.paginas,
    monto = EXCLUDED.monto, moneda = EXCLUDED.moneda, drive_id = EXCLUDED.drive_id,
    carpeta = EXCLUDED.carpeta, origen = EXCLUDED.origen,
    actualizado = now(), actualizado_por = v_quien
  RETURNING * INTO v_fila;

  -- texto de búsqueda: metadatos + OCR, en minúsculas y sin tildes
  UPDATE public.radar_antecedentes SET texto_norm = lower(translate(
      concat_ws(' ', obra_codigo, obra, contratante, contrato, referencia, tipo, detalle, fecha, carpeta, texto),
      'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
   WHERE id = v_id;

  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

-- ---------------------------------------------------------------- borrar
CREATE OR REPLACE FUNCTION public.radar_antecedente_borrar(p_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.radar_access(true) THEN
    RAISE EXCEPTION 'Tu usuario no puede borrar antecedentes.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.radar_antecedentes WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el antecedente %', p_id; END IF;
  RETURN json_build_object('ok', true, 'id', p_id);
END $$;

REVOKE ALL ON FUNCTION public.radar_antecedente_guardar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.radar_antecedente_borrar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.radar_antecedente_guardar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.radar_antecedente_borrar(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
