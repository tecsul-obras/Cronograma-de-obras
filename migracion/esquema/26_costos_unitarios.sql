/* =========================================================================
 * 26_costos_unitarios.sql — Costos unitarios (APU): presupuesto y recosteos
 * v20261006j
 *
 * Cada obra tiene UN «presupuesto» (la oferta, congelado) y los «recosteos»
 * que se quieran, con fecha. Cada versión guarda lo mismo que la Plantilla de
 * Costos (Excel rev19):
 *   costo_version  cabecera: tipo, nombre, fecha, % gastos generales,
 *                  beneficio e IVA, archivo de origen
 *   costo_item     un renglón por ítem del Presupuesto y por material in situ
 *                  (Base Granular, H25…, recurso padre): cantidades y los
 *                  totales del APU (A equipos … L costo adoptado)
 *   costo_linea    los renglones de cada APU (equipos, mano de obra,
 *                  materiales, transporte) con lo que se carga (rendimiento,
 *                  personal, horas, cuantía, desperdicio) y lo que calcula
 *   costo_precio   precios de los recursos usados en esa versión
 *
 * Permisos: solo el administrador importa o borra. Ven: admin, gerente y el
 * residente de la obra. Compras, lectura y campo no ven costos.
 * Los códigos de recurso se igualan sin importar mayúsculas (rp-03 = RP-03);
 * los que no existen se agregan al maestro.
 * Se puede correr más de una vez.
 * ========================================================================= */

CREATE OR REPLACE FUNCTION public.app_ve_costos(p_obra text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.app_rol() IN ('admin', 'gerente', 'residente'), false) AND public.app_puede_ver(p_obra)
$$;

CREATE TABLE IF NOT EXISTS public.costo_version (
  version_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obra_id     text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('presupuesto', 'recosteo')),
  nombre      text NOT NULL DEFAULT '',
  fecha       date NOT NULL DEFAULT current_date,
  gg          numeric,          -- gastos generales sobre el costo directo (0,5 = 50 %)
  bi          numeric,          -- beneficio e impuestos sobre (directo + GG)
  iva         numeric,          -- IVA sobre el costo unitario
  archivo     text NOT NULL DEFAULT '',
  nota        text NOT NULL DEFAULT '',
  creado_por  text NOT NULL DEFAULT public.app_email(),
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS costo_version_un_presupuesto ON public.costo_version (obra_id) WHERE tipo = 'presupuesto';
CREATE INDEX IF NOT EXISTS costo_version_obra ON public.costo_version (obra_id, fecha);

CREATE TABLE IF NOT EXISTS public.costo_item (
  version_id     bigint NOT NULL REFERENCES public.costo_version(version_id) ON DELETE CASCADE,
  clave          text NOT NULL,            -- N° de ítem del Excel; in situ: 'IS:' || código
  es_insitu      boolean NOT NULL DEFAULT false,
  item_id        text,                     -- ítem del cronograma (si cruza)
  orden          integer,
  descripcion    text NOT NULL DEFAULT '',
  um             text NOT NULL DEFAULT '',
  cantidad       numeric,
  igual_a        text NOT NULL DEFAULT '', -- «Es igual a: Item N°»
  prod_ph        numeric,                  -- (C) producción del equipo
  tot_equipos    numeric,                  -- (A)
  tot_mo         numeric,                  -- (B)
  costo_ejec     numeric,                  -- (D)
  tot_mat        numeric,                  -- (E)
  tot_transp     numeric,                  -- (F)
  costo_directo  numeric,                  -- (G)
  gg_pct         numeric, bi_pct numeric, iva_pct numeric,
  costo_unitario numeric,                  -- (J) sin IVA
  costo_adoptado numeric,                  -- (L) con IVA
  hoja           text NOT NULL DEFAULT '',
  PRIMARY KEY (version_id, clave)
);

CREATE TABLE IF NOT EXISTS public.costo_linea (
  version_id  bigint NOT NULL REFERENCES public.costo_version(version_id) ON DELETE CASCADE,
  clave       text NOT NULL,
  bloque      text NOT NULL CHECK (bloque IN ('equipo', 'mano_obra', 'material', 'transporte')),
  orden       integer NOT NULL,
  recurso_id  text NOT NULL,
  nombre      text NOT NULL DEFAULT '',
  detalle     text NOT NULL DEFAULT '',    -- modelo del equipo / unidad de la tarifa
  um          text NOT NULL DEFAULT '',
  rendimiento numeric,                     -- equipos: unidad por hora
  personal    numeric,                     -- mano de obra: cantidad de personal
  horas       numeric,                     -- mano de obra: horas de cada uno
  cuantia     numeric,                     -- materiales y transporte
  desperdicio numeric,
  dmt         numeric,                     -- transporte: DMT (o factor) usada
  cantidad    numeric,                     -- consumo por unidad del ítem (horas o cantidad)
  precio      numeric,                     -- costo por hora / unidad / tarifa
  parcial     numeric,                     -- costo por unidad del ítem
  PRIMARY KEY (version_id, clave, bloque, orden)
);

CREATE TABLE IF NOT EXISTS public.costo_precio (
  version_id        bigint NOT NULL REFERENCES public.costo_version(version_id) ON DELETE CASCADE,
  recurso_id        text NOT NULL,
  tipo              text NOT NULL DEFAULT '',
  nombre            text NOT NULL DEFAULT '',
  um                text NOT NULL DEFAULT '',
  detalle           text NOT NULL DEFAULT '',
  precio            numeric,
  dmt               numeric,
  factor_dmt        numeric,
  precio_transporte numeric,
  PRIMARY KEY (version_id, recurso_id)
);

-- --------------------------------------------------------------- lectura (RLS)
CREATE OR REPLACE FUNCTION public._costo_ve_version(p_version bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.costo_version v WHERE v.version_id = p_version AND public.app_ve_costos(v.obra_id))
$$;

ALTER TABLE public.costo_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costo_item    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costo_linea   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costo_precio  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.costo_version;
CREATE POLICY leer ON public.costo_version FOR SELECT TO authenticated USING (public.app_ve_costos(obra_id));
DROP POLICY IF EXISTS leer ON public.costo_item;
CREATE POLICY leer ON public.costo_item FOR SELECT TO authenticated USING (public._costo_ve_version(version_id));
DROP POLICY IF EXISTS leer ON public.costo_linea;
CREATE POLICY leer ON public.costo_linea FOR SELECT TO authenticated USING (public._costo_ve_version(version_id));
DROP POLICY IF EXISTS leer ON public.costo_precio;
CREATE POLICY leer ON public.costo_precio FOR SELECT TO authenticated USING (public._costo_ve_version(version_id));
GRANT SELECT ON public.costo_version, public.costo_item, public.costo_linea, public.costo_precio TO authenticated;

-- --------------------------------------------------------------- importar
/* p = { tipo, nombre, fecha, gg, bi, iva, archivo, nota, reemplazar,
         items:   [{clave, es_insitu, item_id, orden, descripcion, um, cantidad, igual_a, prod_ph,
                    tot_equipos, tot_mo, costo_ejec, tot_mat, tot_transp, costo_directo,
                    gg_pct, bi_pct, iva_pct, costo_unitario, costo_adoptado, hoja}],
         lineas:  [{clave, bloque, orden, recurso_id, nombre, detalle, um, rendimiento, personal, horas,
                    cuantia, desperdicio, dmt, cantidad, precio, parcial}],
         precios: [{recurso_id, tipo, nombre, um, detalle, precio, dmt, factor_dmt, precio_transporte}] }
   Devuelve {version_id, items, lineas, precios, recursos_nuevos}. */
CREATE OR REPLACE FUNCTION public.costo_importar(p_obra text, p jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text := lower(coalesce(public._jtxt(p->'tipo'), ''));
  v_id bigint; n_it integer; n_li integer; n_pr integer; n_nuevos integer := 0;
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede cargar costos.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obra WHERE obra_id = p_obra) THEN RAISE EXCEPTION 'Obra % inexistente', p_obra; END IF;
  IF v_tipo NOT IN ('presupuesto', 'recosteo') THEN RAISE EXCEPTION 'Tipo de versión inválido: %', v_tipo; END IF;
  IF jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'El archivo no trae ítems.'; END IF;

  IF v_tipo = 'presupuesto' AND EXISTS (SELECT 1 FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'presupuesto') THEN
    IF NOT coalesce(public._jbool(p->'reemplazar'), false) THEN
      RAISE EXCEPTION 'La obra ya tiene un presupuesto. Para reemplazarlo hay que confirmarlo.';
    END IF;
    DELETE FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'presupuesto';
  END IF;

  INSERT INTO public.costo_version (obra_id, tipo, nombre, fecha, gg, bi, iva, archivo, nota)
  VALUES (p_obra, v_tipo,
          coalesce(nullif(public._jtxt(p->'nombre'), ''), CASE v_tipo WHEN 'presupuesto' THEN 'Presupuesto' ELSE 'Recosteo' END),
          coalesce(public._jfecha(p->'fecha'), current_date),
          public._jnum(p->'gg'), public._jnum(p->'bi'), public._jnum(p->'iva'),
          coalesce(public._jtxt(p->'archivo'), ''), coalesce(public._jtxt(p->'nota'), ''))
  RETURNING version_id INTO v_id;

  -- recursos que no están en el maestro (sin importar mayúsculas): se agregan
  INSERT INTO public.recurso (recurso_id, nombre, um, tipo, clase, modelo_equipo, ubicacion, dmt_km, id_alternativo,
                              codigo_unysoft, nombre_unysoft, activo, actualizado)
  SELECT DISTINCT ON (upper(trim(public._jtxt(x->'recurso_id'))))
         upper(trim(public._jtxt(x->'recurso_id'))), coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'um'), ''),
         coalesce(public._jtxt(x->'tipo'), ''), '', coalesce(public._jtxt(x->'detalle'), ''), '', '', '', '', '', true, now()
    FROM jsonb_array_elements(coalesce(p->'precios', '[]'::jsonb)) x
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.recurso r WHERE upper(r.recurso_id) = upper(trim(public._jtxt(x->'recurso_id'))));
  GET DIAGNOSTICS n_nuevos = ROW_COUNT;

  -- código tal como está en el maestro
  CREATE TEMP TABLE IF NOT EXISTS _rmap (k text PRIMARY KEY, id text) ON COMMIT DROP;
  TRUNCATE _rmap;
  INSERT INTO _rmap SELECT DISTINCT ON (upper(recurso_id)) upper(recurso_id), recurso_id FROM public.recurso ORDER BY upper(recurso_id), recurso_id;

  INSERT INTO public.costo_item (version_id, clave, es_insitu, item_id, orden, descripcion, um, cantidad, igual_a, prod_ph,
                                 tot_equipos, tot_mo, costo_ejec, tot_mat, tot_transp, costo_directo,
                                 gg_pct, bi_pct, iva_pct, costo_unitario, costo_adoptado, hoja)
  SELECT DISTINCT ON (trim(public._jtxt(x->'clave'))) v_id, trim(public._jtxt(x->'clave')),
         coalesce(public._jbool(x->'es_insitu'), false),
         (SELECT i.item_id FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = nullif(trim(public._jtxt(x->'item_id')), '')),
         public._jnum(x->'orden')::integer, coalesce(public._jtxt(x->'descripcion'), ''), coalesce(public._jtxt(x->'um'), ''),
         public._jnum(x->'cantidad'), coalesce(public._jtxt(x->'igual_a'), ''), public._jnum(x->'prod_ph'),
         public._jnum(x->'tot_equipos'), public._jnum(x->'tot_mo'), public._jnum(x->'costo_ejec'), public._jnum(x->'tot_mat'),
         public._jnum(x->'tot_transp'), public._jnum(x->'costo_directo'),
         public._jnum(x->'gg_pct'), public._jnum(x->'bi_pct'), public._jnum(x->'iva_pct'),
         public._jnum(x->'costo_unitario'), public._jnum(x->'costo_adoptado'), coalesce(public._jtxt(x->'hoja'), '')
    FROM jsonb_array_elements(p->'items') x
   WHERE trim(coalesce(public._jtxt(x->'clave'), '')) <> '';
  GET DIAGNOSTICS n_it = ROW_COUNT;

  INSERT INTO public.costo_linea (version_id, clave, bloque, orden, recurso_id, nombre, detalle, um, rendimiento, personal, horas,
                                  cuantia, desperdicio, dmt, cantidad, precio, parcial)
  SELECT DISTINCT ON (trim(public._jtxt(x->'clave')), public._jtxt(x->'bloque'), public._jnum(x->'orden')::integer)
         v_id, trim(public._jtxt(x->'clave')), public._jtxt(x->'bloque'), public._jnum(x->'orden')::integer,
         coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))),
         coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'detalle'), ''), coalesce(public._jtxt(x->'um'), ''),
         public._jnum(x->'rendimiento'), public._jnum(x->'personal'), public._jnum(x->'horas'),
         public._jnum(x->'cuantia'), public._jnum(x->'desperdicio'), public._jnum(x->'dmt'),
         public._jnum(x->'cantidad'), public._jnum(x->'precio'), public._jnum(x->'parcial')
    FROM jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) x
    LEFT JOIN _rmap m ON m.k = upper(trim(public._jtxt(x->'recurso_id')))
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> ''
     AND public._jtxt(x->'bloque') IN ('equipo', 'mano_obra', 'material', 'transporte')
     AND EXISTS (SELECT 1 FROM public.costo_item ci WHERE ci.version_id = v_id AND ci.clave = trim(public._jtxt(x->'clave')));
  GET DIAGNOSTICS n_li = ROW_COUNT;

  INSERT INTO public.costo_precio (version_id, recurso_id, tipo, nombre, um, detalle, precio, dmt, factor_dmt, precio_transporte)
  SELECT DISTINCT ON (coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))))
         v_id, coalesce(m.id, upper(trim(public._jtxt(x->'recurso_id')))), coalesce(public._jtxt(x->'tipo'), ''),
         coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'um'), ''), coalesce(public._jtxt(x->'detalle'), ''),
         public._jnum(x->'precio'), public._jnum(x->'dmt'), public._jnum(x->'factor_dmt'), public._jnum(x->'precio_transporte')
    FROM jsonb_array_elements(coalesce(p->'precios', '[]'::jsonb)) x
    LEFT JOIN _rmap m ON m.k = upper(trim(public._jtxt(x->'recurso_id')))
   WHERE trim(coalesce(public._jtxt(x->'recurso_id'), '')) <> '';
  GET DIAGNOSTICS n_pr = ROW_COUNT;

  -- precios de la obra (los que usa Compras): los del último recosteo; si no
  -- hay recosteos, los del presupuesto
  IF v_tipo = 'recosteo' OR NOT EXISTS (SELECT 1 FROM public.costo_version WHERE obra_id = p_obra AND tipo = 'recosteo') THEN
    INSERT INTO public.recurso_precio (obra_id, recurso_id, precio_sin_iva, actualizado)
    SELECT p_obra, cp.recurso_id, cp.precio, now() FROM public.costo_precio cp
     WHERE cp.version_id = v_id AND cp.precio IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.recurso r WHERE r.recurso_id = cp.recurso_id)
    ON CONFLICT (obra_id, recurso_id) DO UPDATE SET precio_sin_iva = EXCLUDED.precio_sin_iva, actualizado = now();
  END IF;

  PERFORM public._cron_tocar(p_obra, false, NULL);
  RETURN json_build_object('version_id', v_id, 'items', n_it, 'lineas', n_li, 'precios', n_pr, 'recursos_nuevos', n_nuevos);
END $$;

CREATE OR REPLACE FUNCTION public.costo_borrar(p_obra text, p_version bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede borrar costos.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.costo_version WHERE obra_id = p_obra AND version_id = p_version;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('borradas', n);
END $$;

REVOKE ALL ON FUNCTION public.costo_importar(text, jsonb), public.costo_borrar(text, bigint),
                       public.app_ve_costos(text), public._costo_ve_version(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.costo_importar(text, jsonb), public.costo_borrar(text, bigint),
                          public.app_ve_costos(text), public._costo_ve_version(bigint) TO authenticated;

-- el asistente IA también puede leer los costos (solo admin, solo lectura)
CREATE OR REPLACE FUNCTION public.ia_tablas()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['obra', 'item', 'distribucion_mensual', 'linea_base', 'linea_base_detalle', 'convenio', 'convenio_detalle',
               'plan_semanal', 'produccion_jornada', 'produccion_fila', 'certificado', 'certificacion', 'comunicacion',
               'pista_tramo', 'transporte_carga', 'transporte_viaje', 'v_transporte_stock_mov', 'stock_conteo',
               'compra', 'compra_ajuste', 'recurso', 'item_recurso', 'recurso_precio', 'computo_item', 'computo_linea',
               'costo_version', 'costo_item', 'costo_linea', 'costo_precio']
$$;

NOTIFY pgrst, 'reload schema';
