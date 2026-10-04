/* =========================================================================
 * 19_compras.sql — Pestaña COMPRAS · v20261004f
 *
 *  recurso       Maestro de recursos (MAESTRO_RECURSOS_PRESUPUESTO de Power BI).
 *                Es de toda la empresa, no de una obra.
 *  item_recurso  Qué recursos lleva cada ítem de obra y cuánto por unidad
 *                (CONSOLIDADO_RECURSOS_RECOSTEO: "Cant. Unitaria Final Recurso").
 *                Necesidad del recurso = cantidad vigente del ítem × cant_unitaria.
 *  compra        Pedido de compra (una línea = un recurso), con el mismo circuito
 *                que el tablero de Monday "Pedidos de Compra Obra UCC":
 *                aprobación → 3 cotizaciones → cotización elegida → OC → entrega.
 *
 * Sin redondeos. Se puede correr más de una vez.
 * ========================================================================= */

CREATE TABLE IF NOT EXISTS public.recurso (
  recurso_id     text PRIMARY KEY CHECK (recurso_id <> ''),
  nombre         text NOT NULL DEFAULT '',
  um             text NOT NULL DEFAULT '',
  tipo           text NOT NULL DEFAULT '',     -- Materiales / Equipos / Mano de obra / Transporte / Gastos Generales
  clase          text NOT NULL DEFAULT '',
  modelo_equipo  text NOT NULL DEFAULT '',
  ubicacion      text NOT NULL DEFAULT '',
  dmt_km         text NOT NULL DEFAULT '',
  id_alternativo text NOT NULL DEFAULT '',
  codigo_unysoft text NOT NULL DEFAULT '',
  nombre_unysoft text NOT NULL DEFAULT '',
  activo         boolean NOT NULL DEFAULT true,
  actualizado    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.item_recurso (
  obra_id        text    NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  item_id        text    NOT NULL,
  orden          integer NOT NULL,
  recurso_id     text    NOT NULL,
  nombre         text    NOT NULL DEFAULT '',   -- nombre del recurso tal como vino (por si no está en el maestro)
  tipo           text    NOT NULL DEFAULT '',
  cant_unitaria  numeric,                       -- cantidad de recurso por unidad del ítem
  costo_unitario numeric,
  recurso_padre  text    NOT NULL DEFAULT '',
  PRIMARY KEY (obra_id, item_id, orden)
);
CREATE INDEX IF NOT EXISTS item_recurso_rec ON public.item_recurso (obra_id, recurso_id);

CREATE TABLE IF NOT EXISTS public.compra (
  obra_id         text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  compra_id       text NOT NULL CHECK (compra_id <> ''),
  descripcion     text NOT NULL DEFAULT '',
  recurso_id      text,
  item_id         text,
  codigo_cc       text NOT NULL DEFAULT '',
  cantidad        numeric,
  um              text NOT NULL DEFAULT '',
  fecha_solicitud date,
  fecha_requerida date,
  solicitante     text NOT NULL DEFAULT '',
  obs_pedido      text NOT NULL DEFAULT '',
  aprobacion      text NOT NULL DEFAULT '',     -- '' (sin revisar) / Aprobado / Rechazado / Falta Especificación
  fecha_aprobacion date,
  prov1 text NOT NULL DEFAULT '', pu1 numeric,
  prov2 text NOT NULL DEFAULT '', pu2 numeric,
  prov3 text NOT NULL DEFAULT '', pu3 numeric,
  cot_elegida     smallint CHECK (cot_elegida IS NULL OR cot_elegida BETWEEN 1 AND 3),
  obs_cotizacion  text NOT NULL DEFAULT '',
  estado_oc       text NOT NULL DEFAULT '',     -- Pendiente / Creada / Aprobación / Enviado Proveedor
  orden_compra    text NOT NULL DEFAULT '',
  fecha_oc        date,
  monto_regular   numeric,                      -- referencia (máximo) para medir el ahorro
  monto_logrado   numeric,
  entrega         text NOT NULL DEFAULT '',     -- Pendiente / Recibido / Atrasado
  fecha_entrega   date,
  cant_recibida   numeric,
  monday_id       text,
  creado_por      text NOT NULL DEFAULT '',
  creado_en       timestamptz NOT NULL DEFAULT now(),
  editado_por     text NOT NULL DEFAULT '',
  editado_en      timestamptz,
  PRIMARY KEY (obra_id, compra_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS compra_monday ON public.compra (obra_id, monday_id) WHERE monday_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  ALTER TABLE public.recurso ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS leer ON public.recurso;
  CREATE POLICY leer ON public.recurso FOR SELECT TO authenticated USING (public.app_rol() IS NOT NULL);
  REVOKE INSERT, UPDATE, DELETE ON public.recurso FROM authenticated, anon;
  GRANT SELECT ON public.recurso TO authenticated;
  FOREACH t IN ARRAY ARRAY['item_recurso', 'compra'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS leer ON public.%I', t);
    EXECUTE format('CREATE POLICY leer ON public.%I FOR SELECT TO authenticated USING (public.app_puede_ver(obra_id))', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------- maestro de recursos
-- p_filas: [{recurso_id, nombre, um, tipo, clase, modelo_equipo, ubicacion, dmt_km, id_alternativo, codigo_unysoft, nombre_unysoft}]
CREATE OR REPLACE FUNCTION public.rec_importar(p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; n integer := 0; rid text;
BEGIN
  IF NOT public.app_es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede cargar el maestro de recursos.' USING ERRCODE = '42501'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    rid := trim(coalesce(public._jtxt(x->'recurso_id'), ''));
    CONTINUE WHEN rid = '';
    INSERT INTO public.recurso (recurso_id, nombre, um, tipo, clase, modelo_equipo, ubicacion, dmt_km, id_alternativo, codigo_unysoft, nombre_unysoft, activo, actualizado)
    VALUES (rid, coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'um'), ''), coalesce(public._jtxt(x->'tipo'), ''),
            coalesce(public._jtxt(x->'clase'), ''), coalesce(public._jtxt(x->'modelo_equipo'), ''), coalesce(public._jtxt(x->'ubicacion'), ''),
            coalesce(public._jtxt(x->'dmt_km'), ''), coalesce(public._jtxt(x->'id_alternativo'), ''), coalesce(public._jtxt(x->'codigo_unysoft'), ''),
            coalesce(public._jtxt(x->'nombre_unysoft'), ''), true, now())
    ON CONFLICT (recurso_id) DO UPDATE SET nombre = EXCLUDED.nombre, um = EXCLUDED.um, tipo = EXCLUDED.tipo, clase = EXCLUDED.clase,
      modelo_equipo = EXCLUDED.modelo_equipo, ubicacion = EXCLUDED.ubicacion, dmt_km = EXCLUDED.dmt_km, id_alternativo = EXCLUDED.id_alternativo,
      codigo_unysoft = EXCLUDED.codigo_unysoft, nombre_unysoft = EXCLUDED.nombre_unysoft, activo = true, actualizado = now();
    n := n + 1;
  END LOOP;
  RETURN json_build_object('recursos', n);
END $$;

-- ------------------------------------------------------------- recursos por ítem
-- Reemplaza todo el desglose de la obra. p_filas: [{item_id, recurso_id, nombre, tipo, cant_unitaria, costo_unitario, recurso_padre}]
CREATE OR REPLACE FUNCTION public.ir_importar(p_obra text, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; n integer := 0; k integer; iid text; rid text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.item_recurso WHERE obra_id = p_obra;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    iid := trim(coalesce(public._jtxt(x->'item_id'), '')); rid := trim(coalesce(public._jtxt(x->'recurso_id'), ''));
    CONTINUE WHEN iid = '' OR rid = '';
    SELECT coalesce(max(orden), 0) + 1 INTO k FROM public.item_recurso WHERE obra_id = p_obra AND item_id = iid;
    INSERT INTO public.item_recurso (obra_id, item_id, orden, recurso_id, nombre, tipo, cant_unitaria, costo_unitario, recurso_padre)
    VALUES (p_obra, iid, k, rid, coalesce(public._jtxt(x->'nombre'), ''), coalesce(public._jtxt(x->'tipo'), ''),
            public._jnum(x->'cant_unitaria'), public._jnum(x->'costo_unitario'), coalesce(public._jtxt(x->'recurso_padre'), ''));
    n := n + 1;
  END LOOP;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('filas', n);
END $$;

-- ------------------------------------------------------------- pedidos de compra
CREATE OR REPLACE FUNCTION public._compra_set(p_obra text, cid text, c jsonb, yo text, nuevo boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cc text := coalesce(public._jtxt(c->'codigo_cc'), ''); iid text := nullif(trim(coalesce(public._jtxt(c->'item_id'), '')), '');
BEGIN
  IF iid IS NOT NULL AND cc = '' THEN SELECT coalesce(codigo_cc, '') INTO cc FROM public.item WHERE obra_id = p_obra AND item_id = iid; END IF;
  IF nuevo THEN
    INSERT INTO public.compra (obra_id, compra_id, creado_por, creado_en) VALUES (p_obra, cid, yo, now());
  END IF;
  UPDATE public.compra SET
    descripcion = coalesce(public._jtxt(c->'descripcion'), ''),
    recurso_id = nullif(trim(coalesce(public._jtxt(c->'recurso_id'), '')), ''),
    item_id = iid, codigo_cc = coalesce(cc, ''),
    cantidad = public._jnum(c->'cantidad'), um = coalesce(public._jtxt(c->'um'), ''),
    fecha_solicitud = coalesce(public._jfecha(c->'fecha_solicitud'), fecha_solicitud, current_date),
    fecha_requerida = public._jfecha(c->'fecha_requerida'),
    solicitante = coalesce(public._jtxt(c->'solicitante'), ''), obs_pedido = coalesce(public._jtxt(c->'obs_pedido'), ''),
    aprobacion = coalesce(public._jtxt(c->'aprobacion'), ''), fecha_aprobacion = public._jfecha(c->'fecha_aprobacion'),
    prov1 = coalesce(public._jtxt(c->'prov1'), ''), pu1 = public._jnum(c->'pu1'),
    prov2 = coalesce(public._jtxt(c->'prov2'), ''), pu2 = public._jnum(c->'pu2'),
    prov3 = coalesce(public._jtxt(c->'prov3'), ''), pu3 = public._jnum(c->'pu3'),
    cot_elegida = CASE WHEN public._jnum(c->'cot_elegida') BETWEEN 1 AND 3 THEN public._jnum(c->'cot_elegida')::smallint END,
    obs_cotizacion = coalesce(public._jtxt(c->'obs_cotizacion'), ''),
    estado_oc = coalesce(public._jtxt(c->'estado_oc'), ''), orden_compra = coalesce(public._jtxt(c->'orden_compra'), ''),
    fecha_oc = public._jfecha(c->'fecha_oc'),
    monto_regular = public._jnum(c->'monto_regular'), monto_logrado = public._jnum(c->'monto_logrado'),
    entrega = coalesce(public._jtxt(c->'entrega'), ''), fecha_entrega = public._jfecha(c->'fecha_entrega'),
    cant_recibida = public._jnum(c->'cant_recibida'),
    monday_id = coalesce(nullif(public._jtxt(c->'monday_id'), ''), monday_id),
    editado_por = CASE WHEN nuevo THEN editado_por ELSE yo END, editado_en = CASE WHEN nuevo THEN editado_en ELSE now() END
  WHERE obra_id = p_obra AND compra_id = cid;
END $$;

CREATE OR REPLACE FUNCTION public.compra_guardar(p_obra text, p_compra jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid text := nullif(trim(coalesce(public._jtxt(p_compra->'compra_id'), '')), ''); nuevo boolean;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  IF coalesce(trim(public._jtxt(p_compra->'descripcion')), '') = '' THEN
    RAISE EXCEPTION 'Falta la descripción del recurso a comprar.' USING ERRCODE = '22023';
  END IF;
  IF cid IS NULL THEN cid := 'cp_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 5); END IF;
  nuevo := NOT EXISTS (SELECT 1 FROM public.compra WHERE obra_id = p_obra AND compra_id = cid);
  PERFORM public._compra_set(p_obra, cid, p_compra, public.app_email(), nuevo);
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('compra_id', cid, 'nuevo', nuevo);
END $$;

CREATE OR REPLACE FUNCTION public.compra_borrar(p_obra text, p_compra_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  DELETE FROM public.compra WHERE obra_id = p_obra AND compra_id = p_compra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el pedido.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('borrado', p_compra_id);
END $$;

-- Importación (Monday u otra planilla): actualiza por monday_id; si no existe, lo crea.
CREATE OR REPLACE FUNCTION public.compra_importar(p_obra text, p_filas jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; cid text; mid text; nuevos integer := 0; act integer := 0; yo text := public.app_email();
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(trim(public._jtxt(x->'descripcion')), '') = '';
    mid := nullif(trim(coalesce(public._jtxt(x->'monday_id'), '')), '');
    cid := NULL;
    IF mid IS NOT NULL THEN SELECT compra_id INTO cid FROM public.compra WHERE obra_id = p_obra AND monday_id = mid; END IF;
    IF cid IS NULL THEN
      cid := coalesce('md_' || mid, 'cp_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(md5(random()::text), 1, 5));
      PERFORM public._compra_set(p_obra, cid, x, coalesce(nullif(public._jtxt(x->'creado_por'), ''), 'monday'), true);
      nuevos := nuevos + 1;
    ELSE
      PERFORM public._compra_set(p_obra, cid, x, yo, false);
      act := act + 1;
    END IF;
  END LOOP;
  PERFORM public._cron_tocar(p_obra, false);
  RETURN json_build_object('nuevos', nuevos, 'actualizados', act);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.rec_importar(jsonb)', 'public.ir_importar(text,jsonb)', 'public.compra_guardar(text,jsonb)',
                           'public.compra_borrar(text,text)', 'public.compra_importar(text,jsonb)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
  REVOKE ALL ON FUNCTION public._compra_set(text,text,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
