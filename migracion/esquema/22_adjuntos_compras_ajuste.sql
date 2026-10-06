/* =========================================================================
 * 22_adjuntos_compras_ajuste.sql — Adjuntos (PDF / fotos) y "ya pedido" manual
 * en Compras · v20261006c
 *
 *  1. Bucket PRIVADO 'adjuntos' (PDF, imágenes, Excel, Word; hasta 25 MB).
 *     Ruta: <obra_id>/<modulo>/<ref_id>/<archivo>. Se lee con URL firmada
 *     (vence), así una factura no queda pública aunque alguien copie el link.
 *  2. Tabla adjunto: un archivo colgado de algo (por ahora módulo 'compra':
 *     cotización 1/2/3, factura, orden de compra u otro). Sirve también para
 *     Comunicaciones y lo que venga después (campo modulo).
 *  3. Tabla compra_ajuste: por recurso y obra, lo YA PEDIDO / COMPRADO fuera de
 *     la app (antes de usarla, por Monday, caja chica…). Suma al "Pedido" de la
 *     vista Necesidad por recurso y baja el saldo por pedir.
 *
 * Escribe: admin / residente de la obra (cuando estén los roles Compras y
 * Gerente se amplía). Sin redondeos. Se puede correr más de una vez.
 * ========================================================================= */

-- ------------------------------------------------------------- 1 · bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('adjuntos', 'adjuntos', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
                               allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "adjuntos_leer" ON storage.objects;
CREATE POLICY "adjuntos_leer" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'adjuntos' AND public.app_puede_ver((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "adjuntos_subir" ON storage.objects;
CREATE POLICY "adjuntos_subir" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'adjuntos' AND public.app_puede_escribir((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "adjuntos_reemplazar" ON storage.objects;
CREATE POLICY "adjuntos_reemplazar" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'adjuntos' AND public.app_puede_escribir((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'adjuntos' AND public.app_puede_escribir((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "adjuntos_borrar" ON storage.objects;
CREATE POLICY "adjuntos_borrar" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'adjuntos' AND public.app_puede_escribir((storage.foldername(name))[1]));

-- ------------------------------------------------------------- 2 · adjunto
CREATE TABLE IF NOT EXISTS public.adjunto (
  obra_id     text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  adjunto_id  text NOT NULL CHECK (adjunto_id <> ''),
  modulo      text NOT NULL CHECK (modulo <> ''),       -- 'compra', 'comunicacion', …
  ref_id      text NOT NULL CHECK (ref_id <> ''),       -- compra_id, com_id, …
  tipo        text NOT NULL DEFAULT 'otro',             -- compra: cot1 / cot2 / cot3 / factura / oc / otro
  nombre      text NOT NULL DEFAULT '',                 -- nombre original del archivo
  mime        text NOT NULL DEFAULT '',
  tamano      bigint,
  ruta        text NOT NULL CHECK (ruta <> ''),         -- ruta en el bucket 'adjuntos'
  subido_por  text NOT NULL DEFAULT '',
  subido_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, adjunto_id)
);
CREATE INDEX IF NOT EXISTS adjunto_ref ON public.adjunto (obra_id, modulo, ref_id);
ALTER TABLE public.adjunto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.adjunto;
CREATE POLICY leer ON public.adjunto FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
REVOKE INSERT, UPDATE, DELETE ON public.adjunto FROM authenticated, anon;
GRANT SELECT ON public.adjunto TO authenticated;

-- p: { adjunto_id?, modulo, ref_id, tipo, nombre, mime, tamano, ruta }  (el archivo ya está subido)
CREATE OR REPLACE FUNCTION public.adjunto_registrar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid text := nullif(public._jtxt(p->'adjunto_id'), ''); r text := coalesce(public._jtxt(p->'ruta'), '');
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF split_part(r, '/', 1) <> p_obra THEN RAISE EXCEPTION 'La ruta del adjunto no corresponde a la obra.' USING ERRCODE = '22023'; END IF;
  IF coalesce(public._jtxt(p->'modulo'), '') = '' OR coalesce(public._jtxt(p->'ref_id'), '') = '' THEN
    RAISE EXCEPTION 'Falta a qué pertenece el adjunto.' USING ERRCODE = '22023';
  END IF;
  IF aid IS NULL THEN aid := 'adj_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6); END IF;
  INSERT INTO public.adjunto (obra_id, adjunto_id, modulo, ref_id, tipo, nombre, mime, tamano, ruta, subido_por, subido_en)
  VALUES (p_obra, aid, public._jtxt(p->'modulo'), public._jtxt(p->'ref_id'), coalesce(nullif(public._jtxt(p->'tipo'), ''), 'otro'),
          coalesce(public._jtxt(p->'nombre'), ''), coalesce(public._jtxt(p->'mime'), ''), public._jnum(p->'tamano')::bigint, r,
          public.app_email(), now())
  ON CONFLICT (obra_id, adjunto_id) DO UPDATE SET tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre;
  RETURN json_build_object('adjunto_id', aid);
END $$;

-- Borra el registro y devuelve la ruta (el archivo lo borra la app del bucket).
CREATE OR REPLACE FUNCTION public.adjunto_borrar(p_obra text, p_adjunto text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.adjunto WHERE obra_id = p_obra AND adjunto_id = p_adjunto RETURNING ruta INTO r;
  RETURN json_build_object('borrado', p_adjunto, 'ruta', r);
END $$;

-- ------------------------------------------------------------- 3 · ya pedido manual
CREATE TABLE IF NOT EXISTS public.compra_ajuste (
  obra_id      text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  recurso_id   text NOT NULL CHECK (recurso_id <> ''),
  cant_pedida  numeric,          -- cantidad ya pedida / comprada fuera de los pedidos de la app
  monto        numeric,          -- lo que costó (opcional)
  obs          text NOT NULL DEFAULT '',
  editado_por  text NOT NULL DEFAULT '',
  editado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, recurso_id)
);
ALTER TABLE public.compra_ajuste ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.compra_ajuste;
CREATE POLICY leer ON public.compra_ajuste FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
REVOKE INSERT, UPDATE, DELETE ON public.compra_ajuste FROM authenticated, anon;
GRANT SELECT ON public.compra_ajuste TO authenticated;

-- p: { recurso_id, cant_pedida, monto, obs }. Cantidad y monto vacíos = se borra el ajuste.
CREATE OR REPLACE FUNCTION public.compra_ajuste_guardar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid text := coalesce(public._jtxt(p->'recurso_id'), ''); q numeric := public._jnum(p->'cant_pedida'); m numeric := public._jnum(p->'monto');
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF rid = '' THEN RAISE EXCEPTION 'Falta el recurso.' USING ERRCODE = '22023'; END IF;
  IF q IS NULL AND m IS NULL THEN
    DELETE FROM public.compra_ajuste WHERE obra_id = p_obra AND recurso_id = rid;
    RETURN json_build_object('recurso_id', rid, 'borrado', true);
  END IF;
  INSERT INTO public.compra_ajuste (obra_id, recurso_id, cant_pedida, monto, obs, editado_por, editado_en)
  VALUES (p_obra, rid, q, m, coalesce(public._jtxt(p->'obs'), ''), public.app_email(), now())
  ON CONFLICT (obra_id, recurso_id) DO UPDATE SET cant_pedida = EXCLUDED.cant_pedida, monto = EXCLUDED.monto,
      obs = EXCLUDED.obs, editado_por = EXCLUDED.editado_por, editado_en = now();
  RETURN json_build_object('recurso_id', rid);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.adjunto_registrar(text,jsonb)', 'public.adjunto_borrar(text,text)',
                           'public.compra_ajuste_guardar(text,jsonb)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
