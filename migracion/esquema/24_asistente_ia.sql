/* =========================================================================
 * 24_asistente_ia.sql — Asistente IA (solo admin) · v20261006e
 *
 * Igual que en la app de Parte Diario: la pregunta va a la Edge Function
 * "asistente", que habla con Gemini y corre las consultas que Gemini pide
 * con ia_consulta(): solo SELECT, transacción de solo lectura, máx. 300
 * filas y 10 segundos, con los permisos (RLS) del usuario que pregunta.
 * Cada pregunta queda en ia_registro.
 * Se puede correr más de una vez.
 * ========================================================================= */

-- tablas y vistas que el asistente puede leer
CREATE OR REPLACE FUNCTION public.ia_tablas()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['obra', 'item', 'distribucion_mensual', 'linea_base', 'linea_base_detalle', 'convenio', 'convenio_detalle',
               'plan_semanal', 'produccion_jornada', 'produccion_fila', 'certificado', 'certificacion', 'comunicacion',
               'pista_tramo', 'transporte_carga', 'transporte_viaje', 'v_transporte_stock_mov', 'stock_conteo',
               'compra', 'compra_ajuste', 'recurso', 'item_recurso', 'recurso_precio', 'computo_item', 'computo_linea']
$$;

CREATE OR REPLACE FUNCTION public.ia_esquema()
RETURNS TABLE(tabla text, columnas text) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.table_name::text,
         string_agg(c.column_name || ' ' ||
                    CASE c.data_type WHEN 'timestamp with time zone' THEN 'timestamptz' WHEN 'character varying' THEN 'text'
                                     WHEN 'ARRAY' THEN 'array' ELSE c.data_type END, ', ' ORDER BY c.ordinal_position)
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = ANY (public.ia_tablas())
     AND c.column_name NOT IN ('fotos', 'cargado_por', 'creado_por', 'editado_por', 'guardado_por', 'subido_por',
                               'rev_por', 'cerrada_por', 'link', 'doc_url', 'split', 'dist')
   GROUP BY c.table_name
   ORDER BY c.table_name
$$;

CREATE OR REPLACE FUNCTION public.ia_consulta(p_sql text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  q text := btrim(coalesce(p_sql, ''));
  res jsonb;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo el administrador puede usar el asistente'; END IF;
  q := regexp_replace(q, ';\s*$', '');
  IF q = '' OR q !~* '^\s*(select|with)\s' THEN RAISE EXCEPTION 'Solo se permiten consultas SELECT'; END IF;
  IF q ~ ';' THEN RAISE EXCEPTION 'Una sola consulta por vez'; END IF;
  IF q ~* '\m(auth|storage|pg_catalog|information_schema|usuario|usuario_obra|ia_registro|config|adjunto|transporte_camion|req_aplicado)\M'
     OR q ~* '\mpg_\w+' THEN
    RAISE EXCEPTION 'Esa tabla no está disponible para el asistente';
  END IF;
  -- todo lo que sigue en esta transacción es de solo lectura
  PERFORM set_config('transaction_read_only', 'on', true);
  PERFORM set_config('statement_timeout', '10s', true);
  EXECUTE format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 300) t', q) INTO res;
  RETURN res;
END $$;

CREATE TABLE IF NOT EXISTS public.ia_registro (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL DEFAULT public.app_email(),
  pregunta   text NOT NULL DEFAULT '',
  consultas  jsonb,
  respuesta  text,
  modelo     text,
  error      text,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ia_registro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.ia_registro;
CREATE POLICY leer ON public.ia_registro FOR SELECT TO authenticated USING (public.app_es_admin());
DROP POLICY IF EXISTS anotar ON public.ia_registro;
CREATE POLICY anotar ON public.ia_registro FOR INSERT TO authenticated WITH CHECK (public.app_es_admin());
GRANT SELECT, INSERT ON public.ia_registro TO authenticated;

REVOKE ALL ON FUNCTION public.ia_consulta(text), public.ia_esquema(), public.ia_tablas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_consulta(text), public.ia_esquema(), public.ia_tablas() TO authenticated;

NOTIFY pgrst, 'reload schema';
