/* =========================================================================
 * 20_precios_recursos.sql — Lista de precios de recursos por obra · v20261005b
 *
 * "MAESTRO LISTA DE PRECIOS" (planilla MAESTRO_RECURSOS_PRESUPUESTO): el precio
 * sin IVA de licitación de cada recurso en cada obra. En Compras sirve para
 * comparar lo cotizado / comprado contra lo presupuestado.
 * Se puede correr más de una vez. Correr después de 19_compras.sql.
 * ========================================================================= */

CREATE TABLE IF NOT EXISTS public.recurso_precio (
  obra_id       text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  recurso_id    text NOT NULL CHECK (recurso_id <> ''),
  precio_sin_iva numeric,
  actualizado   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, recurso_id)
);

ALTER TABLE public.recurso_precio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.recurso_precio;
CREATE POLICY leer ON public.recurso_precio FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
REVOKE INSERT, UPDATE, DELETE ON public.recurso_precio FROM authenticated, anon;
GRANT SELECT ON public.recurso_precio TO authenticated;

-- p_filas: [{recurso_id, precio_sin_iva}] — reemplaza la lista de la obra
CREATE OR REPLACE FUNCTION public.rp_importar(p_obra text, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; n integer := 0; rid text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.recurso_precio WHERE obra_id = p_obra;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    rid := trim(coalesce(public._jtxt(x->'recurso_id'), ''));
    CONTINUE WHEN rid = '';
    INSERT INTO public.recurso_precio (obra_id, recurso_id, precio_sin_iva) VALUES (p_obra, rid, public._jnum(x->'precio_sin_iva'))
    ON CONFLICT (obra_id, recurso_id) DO UPDATE SET precio_sin_iva = EXCLUDED.precio_sin_iva, actualizado = now();
    n := n + 1;
  END LOOP;
  RETURN json_build_object('precios', n);
END $$;
REVOKE ALL ON FUNCTION public.rp_importar(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rp_importar(text,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Enlazar en lote pedidos con recursos del maestro (herramienta "Enlazar recursos" de Compras).
-- p_pares: [{compra_id, recurso_id}]  (recurso_id vacío = desenlazar)
CREATE OR REPLACE FUNCTION public.compra_enlazar(p_obra text, p_pares jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; n integer := 0;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_pares, '[]'::jsonb)) LOOP
    UPDATE public.compra SET recurso_id = nullif(trim(coalesce(public._jtxt(x->'recurso_id'), '')), ''),
           editado_por = public.app_email(), editado_en = now()
     WHERE obra_id = p_obra AND compra_id = public._jtxt(x->'compra_id');
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN json_build_object('enlazados', n);
END $$;
REVOKE ALL ON FUNCTION public.compra_enlazar(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_enlazar(text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Reimportar de Monday no borra lo enlazado a mano: si la fila importada viene sin recurso, ítem o
-- centro de costo, se conserva el que ya tenía el pedido. (Reemplaza la versión de 19_compras.sql.)
CREATE OR REPLACE FUNCTION public.compra_importar(p_obra text, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; cid text; mid text; nuevos integer := 0; act integer := 0; yo text := public.app_email();
        r_old text; i_old text; cc_old text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(trim(public._jtxt(x->'descripcion')), '') = '';
    mid := nullif(trim(coalesce(public._jtxt(x->'monday_id'), '')), '');
    cid := NULL;
    IF mid IS NOT NULL THEN SELECT compra_id, recurso_id, item_id, codigo_cc INTO cid, r_old, i_old, cc_old FROM public.compra WHERE obra_id = p_obra AND monday_id = mid; END IF;
    IF cid IS NULL THEN
      cid := coalesce('md_' || mid, 'cp_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(md5(random()::text), 1, 5));
      PERFORM public._compra_set(p_obra, cid, x, coalesce(nullif(public._jtxt(x->'creado_por'), ''), 'monday'), true);
      nuevos := nuevos + 1;
    ELSE
      IF coalesce(trim(public._jtxt(x->'recurso_id')), '') = '' AND r_old IS NOT NULL THEN x := x || jsonb_build_object('recurso_id', r_old); END IF;
      IF coalesce(trim(public._jtxt(x->'item_id')), '') = '' AND i_old IS NOT NULL THEN x := x || jsonb_build_object('item_id', i_old); END IF;
      IF coalesce(trim(public._jtxt(x->'codigo_cc')), '') = '' AND coalesce(cc_old, '') <> '' THEN x := x || jsonb_build_object('codigo_cc', cc_old); END IF;
      PERFORM public._compra_set(p_obra, cid, x, yo, false);
      act := act + 1;
    END IF;
  END LOOP;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('nuevos', nuevos, 'actualizados', act);
END $$;
REVOKE ALL ON FUNCTION public.compra_importar(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_importar(text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
