/* =========================================================================
 * 44_plan_semanal_foto.sql — Cronograma dinámico + foto del plan semanal
 * v20261015d
 *
 * ANTES (SQL 25): las semanas cerradas quedaban congeladas DENTRO del
 * cronograma (plan_semanal). Por eso la vista Semanas del Gantt, la vista
 * Meses y el plan semanal podían mostrar números distintos.
 *
 * AHORA son dos cosas separadas:
 *   · plan_semanal        = el CRONOGRAMA por semana, dinámico en TODAS las
 *                           semanas (también las pasadas). El mes es la suma de
 *                           sus semanas. Lo guarda cualquiera que pueda editar.
 *   · plan_semanal_foto   = la FOTO del plan semanal: lo que quedó planificado
 *                           en cada semana al cerrar (lunes 00:00, Asunción).
 *                           No cambia con el cronograma. Sirve de KPI (PPC).
 *                           Solo el admin la corrige; los demás, solo la causa.
 *   · plan_semanal_foto_estado = hasta qué semana ya se sacó la foto por obra.
 *
 * Cuándo se saca la foto: cada vez que se guarda el plan semanal, ANTES de
 * reemplazar el cronograma, se fotografían las semanas que cerraron desde la
 * última foto, con lo que estaba guardado (= lo que había al cerrar).
 * Al correr este archivo se saca la primera foto de todas las obras: las
 * semanas pasadas quedan exactamente como están hoy.
 *
 * También actualiza v_powerbi_programacion_semanal: semanas cerradas desde la
 * foto, en curso y futuras desde el cronograma. Mismas columnas.
 *
 * Correr en el SQL Editor del proyecto del cronograma ANTES de publicar la
 * versión v20261015d de la app. Todo en una transacción. Se puede correr más
 * de una vez (la foto ya sacada no se vuelve a sacar).
 * ========================================================================= */
BEGIN;

-- ------------------------------------------------------------------ tablas
CREATE TABLE IF NOT EXISTS public.plan_semanal_foto (
  obra_id       text NOT NULL REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  plan_id       text NOT NULL DEFAULT ('pl_' || substr(gen_random_uuid()::text, 1, 8)),
  item_id       text NOT NULL,                 -- sin FK a item: es historial
  actividad     text NOT NULL DEFAULT '',
  frente        text NOT NULL DEFAULT '',
  um            text NOT NULL DEFAULT '',
  semana        text NOT NULL CHECK (semana ~ '^\d{4}-W\d{2}$'),
  mes           text CHECK (mes IS NULL OR mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  cant_prevista numeric NOT NULL DEFAULT 0,
  causa         text NOT NULL DEFAULT '',
  split         jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual        boolean NOT NULL DEFAULT false,
  congelado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, plan_id)
);
CREATE INDEX IF NOT EXISTS ix_plan_foto_obra_semana ON public.plan_semanal_foto (obra_id, semana);

CREATE TABLE IF NOT EXISTS public.plan_semanal_foto_estado (
  obra_id     text PRIMARY KEY REFERENCES public.obra(obra_id) ON DELETE CASCADE,
  hasta       text NOT NULL CHECK (hasta ~ '^\d{4}-W\d{2}$'),
  actualizado timestamptz NOT NULL DEFAULT now()
);

-- lectura igual que plan_semanal (forma rápida del SQL 37); escritura solo por RPC
ALTER TABLE public.plan_semanal_foto        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_semanal_foto_estado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leer ON public.plan_semanal_foto;
DROP POLICY IF EXISTS leer ON public.plan_semanal_foto_estado;
CREATE POLICY leer ON public.plan_semanal_foto FOR SELECT TO authenticated
  USING ((SELECT public.app_ve_todas_obras()) OR obra_id = ANY ((SELECT public.app_obras_usuario())::text[]));
CREATE POLICY leer ON public.plan_semanal_foto_estado FOR SELECT TO authenticated
  USING ((SELECT public.app_ve_todas_obras()) OR obra_id = ANY ((SELECT public.app_obras_usuario())::text[]));
REVOKE ALL ON public.plan_semanal_foto, public.plan_semanal_foto_estado FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.plan_semanal_foto, public.plan_semanal_foto_estado FROM authenticated;
GRANT SELECT ON public.plan_semanal_foto, public.plan_semanal_foto_estado TO authenticated;

-- ---------------------------------------------------------------- funciones
/* última semana ISO cerrada a la fecha (la de hace 7 días, hora de Asunción) */
CREATE OR REPLACE FUNCTION public._ultima_semana_cerrada()
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_char((now() AT TIME ZONE 'America/Asuncion')::date - 7, 'IYYY-"W"IW')
$$;

/* saca la foto de las semanas que cerraron desde la última, con lo guardado */
CREATE OR REPLACE FUNCTION public._foto_congelar(p_obra text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hasta text; v_ult text := public._ultima_semana_cerrada(); n integer := 0;
BEGIN
  SELECT hasta INTO v_hasta FROM public.plan_semanal_foto_estado WHERE obra_id = p_obra FOR UPDATE;
  IF v_hasta IS NOT NULL AND v_hasta >= v_ult THEN RETURN 0; END IF;
  INSERT INTO public.plan_semanal_foto (obra_id, plan_id, item_id, actividad, frente, um, semana, mes,
                                        cant_prevista, causa, split, manual)
  SELECT ps.obra_id, ps.plan_id, ps.item_id, ps.actividad, ps.frente, ps.um, ps.semana, ps.mes,
         ps.cant_prevista, ps.causa, ps.split, ps.manual
    FROM public.plan_semanal ps
   WHERE ps.obra_id = p_obra
     AND ps.semana <= v_ult
     AND (v_hasta IS NULL OR ps.semana > v_hasta)
  ON CONFLICT (obra_id, plan_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.plan_semanal_foto_estado (obra_id, hasta, actualizado)
  VALUES (p_obra, v_ult, now())
  ON CONFLICT (obra_id) DO UPDATE SET hasta = excluded.hasta, actualizado = now();
  RETURN n;
END $$;

/* guardar: foto de lo que cerró → cronograma completo → foto editada (si vino) */
DROP FUNCTION IF EXISTS public.cron_guardar_semanal(text, jsonb, integer, text);
CREATE OR REPLACE FUNCTION public.cron_guardar_semanal(
  p_obra text, p_rows jsonb, p_foto jsonb DEFAULT NULL, p_foto_hasta text DEFAULT NULL,
  p_base_rev integer DEFAULT NULL, p_req_id text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ya integer; n integer := 0; omitidas integer := 0; nfoto integer := 0; ncausas integer := 0;
        congeladas integer := 0; nueva integer; v_admin boolean; v_hasta text;
BEGIN
  PERFORM public._cron_exigir_escritura(p_obra);
  ya := public._cron_controlar_rev(p_obra, p_base_rev, p_req_id, 'saveWeekly');
  IF ya IS NOT NULL THEN RETURN json_build_object('saved', 0, 'rev', ya, 'repetido', true); END IF;
  v_admin := public.app_es_admin();

  -- 1) foto de las semanas que cerraron (con lo guardado = lo que había al cerrar)
  congeladas := public._foto_congelar(p_obra);

  -- 2) el cronograma por semana: se reemplaza entero (todas las semanas)
  DROP TABLE IF EXISTS pg_temp._ps;
  CREATE TEMP TABLE _ps ON COMMIT DROP AS
  SELECT coalesce(nullif(public._jtxt(x->'plan_id'), ''), 'pl_' || substr(gen_random_uuid()::text, 1, 8)) AS plan_id,
         public._jtxt(x->'item_id') AS item_id,
         public._jtxt(x->'actividad') AS actividad, public._jtxt(x->'frente') AS frente,
         public._jtxt(x->'um') AS um,
         coalesce(nullif(public._jtxt(x->'week'), ''), public._jtxt(x->'semana')) AS semana,
         public._jmes(coalesce(x->'month', x->'mes')) AS mes,
         coalesce(public._jnum(x->'cant_prevista'), 0) AS cant_prevista,
         public._jtxt(x->'causa') AS causa,
         CASE WHEN jsonb_typeof(x->'split_json') = 'string' THEN
                coalesce(nullif(x->>'split_json', ''), '{}')::jsonb
              WHEN jsonb_typeof(x->'split_json') = 'object' THEN x->'split_json'
              WHEN jsonb_typeof(x->'split') = 'object' THEN x->'split'
              ELSE '{}'::jsonb END AS split,
         public._jbool(x->'manual') AS manual,
         ord
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) WITH ORDINALITY AS t(x, ord);

  SELECT count(*) INTO omitidas FROM _ps s
   WHERE s.semana !~ '^\d{4}-W\d{2}$'
      OR NOT EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id);

  DELETE FROM public.plan_semanal WHERE obra_id = p_obra;
  INSERT INTO public.plan_semanal (obra_id, plan_id, item_id, actividad, frente, um, semana, mes,
                                   cant_prevista, causa, split, manual)
  SELECT DISTINCT ON (plan_id) p_obra, plan_id, item_id, actividad, frente, um, semana, mes,
         cant_prevista, causa, split, manual
  FROM _ps s
  WHERE s.semana ~ '^\d{4}-W\d{2}$'
    AND EXISTS (SELECT 1 FROM public.item i WHERE i.obra_id = p_obra AND i.item_id = s.item_id)
  ORDER BY plan_id, ord DESC;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- 3) foto editada en la app (solo si vino)
  IF p_foto IS NOT NULL AND jsonb_typeof(p_foto) = 'array' THEN
    IF v_admin THEN
      -- el admin reemplaza la foto de las semanas que conocía al abrir la obra
      v_hasta := nullif(btrim(coalesce(p_foto_hasta, '')), '');
      IF v_hasta ~ '^\d{4}-W\d{2}$' THEN
        DELETE FROM public.plan_semanal_foto WHERE obra_id = p_obra AND semana <= v_hasta;
        INSERT INTO public.plan_semanal_foto (obra_id, plan_id, item_id, actividad, frente, um, semana, mes,
                                              cant_prevista, causa, split, manual)
        SELECT DISTINCT ON (f.plan_id) p_obra, f.plan_id, f.item_id, f.actividad, f.frente, f.um, f.semana, f.mes,
               f.cant_prevista, f.causa, f.split, f.manual
        FROM (
          SELECT coalesce(nullif(public._jtxt(x->'plan_id'), ''), 'pl_' || substr(gen_random_uuid()::text, 1, 8)) AS plan_id,
                 public._jtxt(x->'item_id') AS item_id,
                 public._jtxt(x->'actividad') AS actividad, public._jtxt(x->'frente') AS frente,
                 public._jtxt(x->'um') AS um,
                 coalesce(nullif(public._jtxt(x->'week'), ''), public._jtxt(x->'semana')) AS semana,
                 public._jmes(coalesce(x->'month', x->'mes')) AS mes,
                 coalesce(public._jnum(x->'cant_prevista'), 0) AS cant_prevista,
                 public._jtxt(x->'causa') AS causa,
                 CASE WHEN jsonb_typeof(x->'split_json') = 'string' THEN
                        coalesce(nullif(x->>'split_json', ''), '{}')::jsonb
                      WHEN jsonb_typeof(x->'split_json') = 'object' THEN x->'split_json'
                      ELSE '{}'::jsonb END AS split,
                 public._jbool(x->'manual') AS manual,
                 ord
          FROM jsonb_array_elements(p_foto) WITH ORDINALITY AS t(x, ord)
        ) f
        WHERE f.semana ~ '^\d{4}-W\d{2}$' AND f.semana <= v_hasta AND f.item_id <> ''
        ORDER BY f.plan_id, f.ord DESC
        ON CONFLICT (obra_id, plan_id) DO UPDATE
          SET item_id = excluded.item_id, actividad = excluded.actividad, frente = excluded.frente,
              um = excluded.um, semana = excluded.semana, mes = excluded.mes,
              cant_prevista = excluded.cant_prevista, causa = excluded.causa, split = excluded.split,
              manual = excluded.manual;
        GET DIAGNOSTICS nfoto = ROW_COUNT;
      END IF;
    ELSE
      -- los demás: solo la causa de no cumplimiento (por ítem + semana)
      UPDATE public.plan_semanal_foto pf SET causa = c.causa
        FROM (SELECT DISTINCT ON (item_id, semana) item_id, semana, causa
                FROM (SELECT public._jtxt(x->'item_id') AS item_id,
                             coalesce(nullif(public._jtxt(x->'week'), ''), public._jtxt(x->'semana')) AS semana,
                             public._jtxt(x->'causa') AS causa, ord
                        FROM jsonb_array_elements(p_foto) WITH ORDINALITY AS t(x, ord)) z
               WHERE causa <> '' ORDER BY item_id, semana, ord DESC) c
       WHERE pf.obra_id = p_obra AND pf.item_id = c.item_id AND pf.semana = c.semana
         AND pf.causa IS DISTINCT FROM c.causa;
      GET DIAGNOSTICS ncausas = ROW_COUNT;
    END IF;
  END IF;

  nueva := public._cron_tocar(p_obra, true, p_req_id);
  RETURN json_build_object('saved', n, 'rev', nueva, 'omitidas', omitidas,
                           'foto_nuevas', congeladas, 'foto_guardadas', nfoto, 'causas_foto', ncausas);
END $function$;

REVOKE ALL ON FUNCTION public._ultima_semana_cerrada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._ultima_semana_cerrada() TO authenticated;
REVOKE ALL ON FUNCTION public._foto_congelar(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cron_guardar_semanal(text, jsonb, jsonb, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cron_guardar_semanal(text, jsonb, jsonb, text, integer, text) TO authenticated;

-- -------------------------------------------- primera foto de todas las obras
-- las semanas que ya cerraron quedan EXACTAMENTE como están hoy en plan_semanal
SELECT o.obra_id, public._foto_congelar(o.obra_id) AS filas_fotografiadas
  FROM public.obra o ORDER BY o.obra_id;

-- ------------------------------------------------ Power BI: programación semanal
-- semanas cerradas = foto · en curso y futuras = cronograma. Mismas columnas.
create or replace view public.v_powerbi_programacion_semanal
with (security_invoker = true) as
with
fuente as (
  select f.obra_id, f.semana, f.item_id, f.cant_prevista, f.frente, f.causa, f.actividad, f.um, f.plan_id
    from public.plan_semanal_foto f
  union all
  select s.obra_id, s.semana, s.item_id, s.cant_prevista, s.frente, s.causa, s.actividad, s.um, s.plan_id
    from public.plan_semanal s
    left join public.plan_semanal_foto_estado e on e.obra_id = s.obra_id
   where s.semana > coalesce(e.hasta, '')
),
base as (
  select s.obra_id, s.semana,
         coalesce(ic.contrato_id, s.item_id) as contrato_id,
         s.item_id, s.cant_prevista, s.frente, s.causa, s.actividad, s.um, s.plan_id
  from fuente s
  left join public.pbi_item_contrato ic on ic.obra_id = s.obra_id and ic.item_id = s.item_id
  where s.item_id is not null and s.semana ~ '^\d{4}-W\d{1,2}$'
),
agr as (
  select obra_id, contrato_id, semana,
         sum(coalesce(cant_prevista, 0))                                       as cant,
         string_agg(distinct nullif(trim(frente), ''), ' / ')                  as frente,
         string_agg(distinct nullif(trim(causa), ''), ' / ')                   as causa,
         string_agg(distinct nullif(trim(actividad), ''), ' · ')               as actividad,
         (array_agg(nullif(trim(um), '') order by item_id) filter (where nullif(trim(um), '') is not null))[1] as um_fila,
         count(*)                                                              as n_act
  from base
  group by obra_id, contrato_id, semana
),
x as (
  select a.*,
         replace(a.contrato_id, ',', '.') as item,
         to_date(a.semana, 'IYYY-"W"IW')                                       as lunes
  from agr a
)
select
  'PWA-' || x.obra_id                                        as "Board ID",
  'Programación Semanal ' || coalesce(o.nombre, x.obra_id)   as "Boards.Name",
  'PWA-' || x.obra_id || '-' || x.semana                     as "Group ID",
  'Semana ' || x.semana                                      as "Groups.Name",
  'PWA-' || x.obra_id || '-' || x.semana || '-' || x.item    as "Item ID",
  coalesce(x.actividad, ct.descripcion)                      as "Name",
  ct.categoria                                               as "Categoria Item de Obra",
  x.item                                                     as "Items",
  null::text                                                 as "Causa de incumplimiento (status_color_mkqa2bc1)",
  ct.descripcion                                             as "Related Item Name",
  coalesce(ct.um, x.um_fila)                                 as "Un",
  x.frente                                                   as "Frente",
  null::text                                                 as "Prog. Inicio",
  null::text                                                 as "Prog. Final",
  ct.estado                                                  as "Estado",
  x.cant                                                     as "Cantidad Prevista",
  null::numeric                                              as "Cantidad Ejecutada",
  x.lunes                                                    as "Cronograma from",
  x.lunes + 6                                                as "Cronograma to",
  x.causa                                                    as "Causas de incumplimiento",
  null::text                                                 as "Observaciones",
  x.item                                                     as "CODIGO ITEM",
  x.obra_id                                                  as "UNIDAD DE NEGOCIO",
  ct.descripcion                                             as "NOMBRE ITEM",
  null::text                                                 as "created_at",
  null::text                                                 as "updated_at",
  null::text                                                 as "Creator ID",
  null::text                                                 as "UNIDAD NEGOCIO (mirror_lookup_mksnw6en)",
  x.obra_id || '-' || x.item                                 as "ID OBRA - ITEM"
from x
join public.obra o on o.obra_id = x.obra_id
left join public.item ct on ct.obra_id = x.obra_id and ct.item_id = x.contrato_id;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------- verificación
-- Filas fotografiadas por obra y hasta qué semana:
-- select e.obra_id, e.hasta, count(f.*) filas
--   from public.plan_semanal_foto_estado e
--   left join public.plan_semanal_foto f on f.obra_id = e.obra_id
--  group by 1,2 order by 1;
