/* =========================================================================
 * 29_seguridad_higiene.sql — Endurecimiento de la base · v20261010a
 *
 * No cambia datos ni la forma en que funciona la app: todas las pantallas
 * leen con SELECT (que queda igual) y escriben con funciones RPC (que corren
 * como dueño de la base y no dependen de las políticas que se quitan acá).
 *
 *   A. Sin login no se ejecuta ninguna función.
 *   B. search_path fijo en las 16 funciones que no lo tenían.
 *   C. Escritura SOLO por las funciones de la app: se quitan las políticas
 *      que dejaban escribir directo en las tablas (saltando el control de
 *      revisión y las validaciones de las RPC). Las de lectura no se tocan.
 *   D. El rol anónimo no tiene permisos sobre tablas; nadie puede TRUNCATE.
 *   E. Lo mismo para todo lo que se cree de acá en adelante.
 *   F. req_aplicado: cerrada a propósito (la usan solo las funciones).
 *
 * Todo en una transacción: o se aplica entero o no se aplica nada.
 * Se puede correr más de una vez. Para volver atrás: 29_revertir.sql.
 * ========================================================================= */

BEGIN;

/* ---------- A. Funciones: nada se ejecuta sin login ----------
   Las funciones nuevas nacen con EXECUTE para PUBLIC (que incluye al
   anónimo). Se quita PUBLIC y anon, y se le devuelve a authenticated y
   service_role lo que antes tenían por PUBLIC. Las que ya estaban cerradas
   (_cron_*, _conv_*, …) no se tocan. */
DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.proname = 'rls_auto_enable' THEN
      -- disparador de eventos de Supabase: no se llama por la API
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'A. funciones cerradas al anónimo: %', n;
END $$;

/* ---------- B. search_path fijo ----------
   Sin esto, la función resuelve nombres según el search_path de quien la
   llama. Todas usan objetos de public, así que se fija en public. */
DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND p.proname <> 'rls_auto_enable'
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'B. funciones con search_path fijado: %', n;
END $$;

/* ---------- C. Escritura solo por las funciones de la app ----------
   Hoy un residente con la sesión abierta podía, desde la consola del
   navegador, hacer un DELETE directo sobre item o produccion_fila de su
   obra, sin pasar por el control de revisión ni por la protección de ítems
   con producción/certificación. La app no escribe nunca directo (todo va por
   RPC), así que estas políticas sobran.
   Quedan: las de lectura, las de usuario/usuario_obra (solo admin) y la de
   ia_registro (la Edge Function del asistente anota ahí directo). */
DO $$
DECLARE p record; n int := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND tablename NOT IN ('usuario', 'usuario_obra', 'ia_registro')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'C. políticas de escritura directa quitadas: %', n;
END $$;

/* ---------- D. Permisos sobre tablas ----------
   RLS ya bloquea al anónimo, pero el permiso no tiene por qué existir.
   TRUNCATE no pasa por RLS: nadie fuera del dueño lo necesita. */
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

/* ---------- E. Lo que se cree de acá en adelante ----------
   Los próximos SQL (30, 31, …) nacen ya cerrados al anónimo. authenticated
   y service_role siguen recibiendo los permisos de siempre.
   La primera línea va SIN "IN SCHEMA": el EXECUTE para PUBLIC es un
   default global de Postgres y solo se quita a ese nivel. */
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

/* ---------- F. req_aplicado ----------
   El asesor avisa "RLS sin políticas". Es a propósito: la leen y escriben
   solo las funciones de guardado (reintentos idempotentes). */
REVOKE ALL ON public.req_aplicado FROM anon, authenticated;
COMMENT ON TABLE public.req_aplicado IS
  'Solo la usan las funciones cron_* (reintento idempotente por req_id). RLS sin políticas a propósito: sin acceso por la API.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Después de correrlo: 30_verificar_seguridad.sql (todo debe dar OK).
