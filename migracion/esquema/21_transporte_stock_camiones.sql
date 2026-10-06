/* =========================================================================
 * 21_transporte_stock_camiones.sql — Transporte: maestro de camiones (chapas)
 * y stock de materiales en depósitos · v20261006c
 *
 *  1. transporte_camion: maestro ÚNICO de chapas (fleteros + flota propia),
 *     común a todas las obras. Solo el ADMIN (central) da de alta, corrige o
 *     da de baja. La chapa se compara "normalizada" (mayúsculas, sin espacios
 *     ni guiones): "BJT 884" = "BJT-884".
 *     Desde que el maestro tiene al menos un camión activo, tr_guardar y
 *     tr_editar RECHAZAN una chapa que no esté en el maestro. Las cargas viejas
 *     (Jotform) no se tocan; al corregir una carga vieja se aceptan las chapas
 *     que ya tenía.
 *  2. stock_conteo: ajuste manual del stock. Es un CONTEO: "el día D en el
 *     depósito X había T toneladas de tal material". El stock a una fecha es
 *     el último conteo + entradas − salidas posteriores a ese conteo.
 *  3. v_transporte_stock_mov: los movimientos de stock que salen de las
 *     cargas (para Power BI y para revisar). Depósitos: Campamento, Cantera
 *     y Acopio Intermedio.
 *       entrada: destino es un depósito y el origen es otro lugar
 *       salida : origen es un depósito y el destino es otro lugar
 *     (origen = destino = mismo depósito: movimiento interno, no cambia el stock)
 *
 * Sin redondeos. Se puede correr más de una vez.
 * ========================================================================= */

-- ------------------------------------------------------------- utilidades
CREATE OR REPLACE FUNCTION public._chapa_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

-- ------------------------------------------------------------- 1 · camiones
CREATE TABLE IF NOT EXISTS public.transporte_camion (
  chapa        text PRIMARY KEY CHECK (chapa <> ''),       -- como se muestra: ABC-123
  chapa_key    text NOT NULL UNIQUE,                       -- normalizada: ABC123
  tipo         text NOT NULL DEFAULT 'CAMION VOLQUETE',
  descripcion  text NOT NULL DEFAULT '',                   -- doble eje, triple eje…
  marca        text NOT NULL DEFAULT '',
  modelo       text NOT NULL DEFAULT '',
  chasis       text NOT NULL DEFAULT '',
  proveedor    text NOT NULL DEFAULT '',                   -- fletero (o TECSUL si es propio)
  ruc          text NOT NULL DEFAULT '',
  chofer       text NOT NULL DEFAULT '',
  telefono     text NOT NULL DEFAULT '',
  contacto     text NOT NULL DEFAULT '',
  propio       boolean NOT NULL DEFAULT false,
  activo       boolean NOT NULL DEFAULT true,
  observaciones text NOT NULL DEFAULT '',
  alta_por     text NOT NULL DEFAULT '',
  alta_en      timestamptz NOT NULL DEFAULT now(),
  editado_por  text NOT NULL DEFAULT '',
  editado_en   timestamptz
);
ALTER TABLE public.transporte_camion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.transporte_camion;
CREATE POLICY leer ON public.transporte_camion FOR SELECT TO authenticated USING (public.app_rol() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.transporte_camion FROM authenticated, anon;
GRANT SELECT ON public.transporte_camion TO authenticated;

/* Alta o corrección de un camión (solo admin). p: { chapa, chapa_anterior?, tipo, descripcion,
   marca, modelo, chasis, proveedor, ruc, chofer, telefono, contacto, propio, activo, observaciones } */
CREATE OR REPLACE FUNCTION public.tr_camion_guardar(p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ch  text := upper(btrim(coalesce(public._jtxt(p->'chapa'), '')));
  ant text := upper(btrim(coalesce(public._jtxt(p->'chapa_anterior'), '')));
  k   text := public._chapa_key(ch);
  otro text;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo el administrador central puede modificar el maestro de camiones.' USING ERRCODE = '42501'; END IF;
  IF k = '' THEN RAISE EXCEPTION 'Falta la chapa.' USING ERRCODE = '22023'; END IF;
  SELECT chapa INTO otro FROM public.transporte_camion WHERE chapa_key = k AND chapa <> coalesce(nullif(ant, ''), ch);
  IF otro IS NOT NULL THEN RAISE EXCEPTION 'La chapa % ya existe en el maestro (como %).', ch, otro USING ERRCODE = '23505'; END IF;
  IF ant <> '' AND ant <> ch THEN
    UPDATE public.transporte_camion SET chapa = ch, chapa_key = k WHERE chapa = ant;
  END IF;
  INSERT INTO public.transporte_camion AS t (chapa, chapa_key, tipo, descripcion, marca, modelo, chasis, proveedor, ruc,
      chofer, telefono, contacto, propio, activo, observaciones, alta_por, alta_en)
  VALUES (ch, k, coalesce(nullif(public._jtxt(p->'tipo'), ''), 'CAMION VOLQUETE'), coalesce(public._jtxt(p->'descripcion'), ''),
      coalesce(public._jtxt(p->'marca'), ''), coalesce(public._jtxt(p->'modelo'), ''), coalesce(public._jtxt(p->'chasis'), ''),
      coalesce(public._jtxt(p->'proveedor'), ''), coalesce(public._jtxt(p->'ruc'), ''), coalesce(public._jtxt(p->'chofer'), ''),
      coalesce(public._jtxt(p->'telefono'), ''), coalesce(public._jtxt(p->'contacto'), ''),
      coalesce((p->>'propio')::boolean, false), coalesce((p->>'activo')::boolean, true),
      coalesce(public._jtxt(p->'observaciones'), ''), public.app_email(), now())
  ON CONFLICT (chapa) DO UPDATE SET
      tipo = EXCLUDED.tipo, descripcion = EXCLUDED.descripcion, marca = EXCLUDED.marca, modelo = EXCLUDED.modelo,
      chasis = EXCLUDED.chasis, proveedor = EXCLUDED.proveedor, ruc = EXCLUDED.ruc, chofer = EXCLUDED.chofer,
      telefono = EXCLUDED.telefono, contacto = EXCLUDED.contacto, propio = EXCLUDED.propio, activo = EXCLUDED.activo,
      observaciones = EXCLUDED.observaciones, editado_por = public.app_email(), editado_en = now();
  RETURN json_build_object('chapa', ch);
END $$;

-- Rechaza chapas que no están en el maestro (si el maestro ya tiene camiones).
-- p_previas: chapas que la carga ya tenía (al corregir una carga vieja).
CREATE OR REPLACE FUNCTION public._tr_exigir_chapas(p_viajes jsonb, p_previas text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE malas text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.transporte_camion WHERE activo) THEN RETURN; END IF;
  SELECT string_agg(DISTINCT upper(btrim(v->>'chapa')), ', ') INTO malas
    FROM jsonb_array_elements(coalesce(p_viajes, '[]'::jsonb)) v
   WHERE public._chapa_key(v->>'chapa') <> ''
     AND NOT EXISTS (SELECT 1 FROM public.transporte_camion c WHERE c.activo AND c.chapa_key = public._chapa_key(v->>'chapa'))
     AND public._chapa_key(v->>'chapa') <> ALL (SELECT public._chapa_key(x) FROM unnest(coalesce(p_previas, '{}')) x);
  IF malas IS NOT NULL THEN
    RAISE EXCEPTION 'Chapa(s) que no están en el maestro de camiones: %. Pedile al administrador central que la(s) agregue.', malas USING ERRCODE = '22023';
  END IF;
END $$;

-- Los camiones se guardan con la chapa tal como está en el maestro ("bjt 884" → "BJT-884").
CREATE OR REPLACE FUNCTION public._tr_viajes(p_obra text, p_carga text, p_viajes jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb; k integer := 0; ch text;
BEGIN
  DELETE FROM public.transporte_viaje WHERE obra_id = p_obra AND carga_id = p_carga;
  FOR v IN SELECT * FROM jsonb_array_elements(coalesce(p_viajes, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(public._jtxt(v->'chapa'), '') = '' AND public._jnum(v->'viajes') IS NULL AND public._jnum(v->'toneladas') IS NULL;
    k := k + 1;
    ch := upper(coalesce(public._jtxt(v->'chapa'), ''));
    ch := coalesce((SELECT c.chapa FROM public.transporte_camion c WHERE c.chapa_key = public._chapa_key(ch)), ch);
    INSERT INTO public.transporte_viaje (obra_id, carga_id, orden, chapa, viajes, toneladas)
    VALUES (p_obra, p_carga, k, ch, public._jnum(v->'viajes'), public._jnum(v->'toneladas'));
  END LOOP;
  RETURN k;
END $$;

-- tr_guardar / tr_editar: se les agrega la validación de chapas (el resto queda igual).
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.tr_guardar(text,jsonb,jsonb,text[])'::regprocedure);
  IF position('_tr_exigir_chapas' IN d) = 0 THEN
    d := replace(d, 'PERFORM public._tr_validar(p_obra, p_carga);',
                    'PERFORM public._tr_validar(p_obra, p_carga);' || chr(10) || '  PERFORM public._tr_exigir_chapas(p_viajes);');
    EXECUTE d;
  END IF;
  d := pg_get_functiondef('public.tr_editar(text,text,jsonb,jsonb)'::regprocedure);
  IF position('_tr_exigir_chapas' IN d) = 0 THEN
    d := replace(d, 'PERFORM public._exigir_carga_propia(p_obra, ''transporte'', c.cargado_por);',
                    'PERFORM public._exigir_carga_propia(p_obra, ''transporte'', c.cargado_por);' || chr(10) ||
                    '  IF p_viajes IS NOT NULL THEN PERFORM public._tr_exigir_chapas(p_viajes, ARRAY(SELECT chapa FROM public.transporte_viaje WHERE obra_id = p_obra AND carga_id = p_carga_id)); END IF;');
    EXECUTE d;
  END IF;
END $$;

-- ------------------------------------------------------------- 2 · stock
CREATE TABLE IF NOT EXISTS public.stock_conteo (
  obra_id     text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  conteo_id   text NOT NULL CHECK (conteo_id <> ''),
  deposito    text NOT NULL CHECK (deposito <> ''),        -- Campamento / Cantera / Acopio Intermedio
  material    text NOT NULL CHECK (material <> ''),        -- mismo texto que tipo_material de las cargas
  fecha       date NOT NULL,                               -- el conteo vale al FINAL de ese día
  toneladas   numeric NOT NULL,                            -- stock real contado / estimado
  motivo      text NOT NULL DEFAULT '',
  cargado_por text NOT NULL DEFAULT '',
  cargado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, conteo_id)
);
CREATE INDEX IF NOT EXISTS stock_conteo_busca ON public.stock_conteo (obra_id, deposito, material, fecha);
ALTER TABLE public.stock_conteo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.stock_conteo;
CREATE POLICY leer ON public.stock_conteo FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id));
REVOKE INSERT, UPDATE, DELETE ON public.stock_conteo FROM authenticated, anon;
GRANT SELECT ON public.stock_conteo TO authenticated;

-- p: { conteo_id?, deposito, material, fecha, toneladas, motivo }  (admin / residente de la obra)
CREATE OR REPLACE FUNCTION public.stock_conteo_guardar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cid text := nullif(public._jtxt(p->'conteo_id'), '');
  t numeric := public._jnum(p->'toneladas');
  f date := public._jfecha(p->'fecha');
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF coalesce(public._jtxt(p->'deposito'), '') = '' THEN RAISE EXCEPTION 'Elegí el depósito.' USING ERRCODE = '22023'; END IF;
  IF coalesce(public._jtxt(p->'material'), '') = '' THEN RAISE EXCEPTION 'Elegí el material.' USING ERRCODE = '22023'; END IF;
  IF f IS NULL THEN RAISE EXCEPTION 'Elegí la fecha del conteo.' USING ERRCODE = '22023'; END IF;
  IF t IS NULL THEN RAISE EXCEPTION 'Cargá las toneladas contadas.' USING ERRCODE = '22023'; END IF;
  IF cid IS NULL THEN cid := 'sc_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6); END IF;
  INSERT INTO public.stock_conteo (obra_id, conteo_id, deposito, material, fecha, toneladas, motivo, cargado_por, cargado_en)
  VALUES (p_obra, cid, public._jtxt(p->'deposito'), public._jtxt(p->'material'), f, t,
          coalesce(public._jtxt(p->'motivo'), ''), public.app_email(), now())
  ON CONFLICT (obra_id, conteo_id) DO UPDATE SET deposito = EXCLUDED.deposito, material = EXCLUDED.material,
      fecha = EXCLUDED.fecha, toneladas = EXCLUDED.toneladas, motivo = EXCLUDED.motivo,
      cargado_por = EXCLUDED.cargado_por, cargado_en = now();
  RETURN json_build_object('conteo_id', cid);
END $$;

CREATE OR REPLACE FUNCTION public.stock_conteo_borrar(p_obra text, p_conteo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.stock_conteo WHERE obra_id = p_obra AND conteo_id = p_conteo;
  RETURN json_build_object('borrado', p_conteo);
END $$;

-- ------------------------------------------------------------- 3 · movimientos (vista)
CREATE OR REPLACE VIEW public.v_transporte_stock_mov WITH (security_invoker = true) AS
WITH t AS (
  SELECT c.obra_id, c.carga_id, c.fecha, c.tipo_material AS material, c.origen, c.destino,
         sum(coalesce(v.toneladas, 0)) AS toneladas, sum(coalesce(v.viajes, 0)) AS viajes,
         sum(CASE WHEN coalesce(v.toneladas, 0) = 0 THEN coalesce(v.viajes, 0) ELSE 0 END) AS viajes_sin_ton
    FROM public.transporte_carga c
    JOIN public.transporte_viaje v ON v.obra_id = c.obra_id AND v.carga_id = c.carga_id
   GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT obra_id, carga_id, fecha, material, destino AS deposito, 'entrada'::text AS tipo,
       toneladas, viajes, viajes_sin_ton, origen AS contraparte
  FROM t WHERE destino IN ('Campamento', 'Cantera', 'Acopio Intermedio') AND origen IS DISTINCT FROM destino
UNION ALL
SELECT obra_id, carga_id, fecha, material, origen AS deposito, 'salida'::text,
       -toneladas, viajes, viajes_sin_ton, destino
  FROM t WHERE origen IN ('Campamento', 'Cantera', 'Acopio Intermedio') AND origen IS DISTINCT FROM destino;
GRANT SELECT ON public.v_transporte_stock_mov TO authenticated;

-- ------------------------------------------------------------- permisos de funciones
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.tr_camion_guardar(jsonb)', 'public.stock_conteo_guardar(text,jsonb)',
                           'public.stock_conteo_borrar(text,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public._tr_exigir_chapas(jsonb,text[]), public._tr_viajes(text,text,jsonb) FROM PUBLIC, anon, authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
