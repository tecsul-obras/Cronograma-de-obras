/* =========================================================================
 * 30_verificar_seguridad.sql — Chequeo de seguridad · v20261010a
 *
 * Solo lee. Correr después del 29, y de nuevo cada vez que se agregue un
 * SQL nuevo (30, 31, …). Cada fila debe decir OK; si alguna dice REVISAR,
 * la columna "detalle" dice qué objeto es.
 * ========================================================================= */

WITH f AS (
  SELECT p.oid, p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.prokind IN ('f', 'p')
), chequeos AS (
  SELECT 1 AS n, 'Tablas sin RLS' AS chequeo,
         (SELECT string_agg(c.relname, ', ') FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity) AS detalle
  UNION ALL
  SELECT 2, 'Funciones que se ejecutan sin login',
         (SELECT string_agg(proname, ', ') FROM f WHERE has_function_privilege('anon', oid, 'EXECUTE'))
  UNION ALL
  SELECT 3, 'Funciones sin search_path fijo',
         (SELECT string_agg(proname, ', ') FROM f
           WHERE proname <> 'rls_auto_enable'
             AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(proconfig, '{}')) c WHERE c LIKE 'search_path=%'))
  UNION ALL
  SELECT 4, 'Tablas con permisos para el anónimo',
         (SELECT string_agg(DISTINCT table_name, ', ') FROM information_schema.role_table_grants
           WHERE grantee = 'anon' AND table_schema = 'public')
  UNION ALL
  SELECT 5, 'Políticas que alcanzan al anónimo o a PUBLIC',
         (SELECT string_agg(schemaname || '.' || tablename || '.' || policyname, ', ') FROM pg_policies
           WHERE schemaname IN ('public', 'storage') AND (roles && ARRAY['anon', 'public']::name[]))
  UNION ALL
  SELECT 6, 'Políticas con condición siempre verdadera',
         (SELECT string_agg(tablename || '.' || policyname, ', ') FROM pg_policies
           WHERE schemaname IN ('public', 'storage') AND (btrim(qual) = 'true' OR btrim(with_check) = 'true'))
  UNION ALL
  SELECT 7, 'Escritura directa en tablas (fuera de usuario/usuario_obra/ia_registro)',
         (SELECT string_agg(tablename || '.' || policyname, ', ') FROM pg_policies
           WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
             AND tablename NOT IN ('usuario', 'usuario_obra', 'ia_registro'))
  UNION ALL
  SELECT 8, 'Vistas sin security_invoker',
         (SELECT string_agg(c.relname, ', ') FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname = 'public' AND c.relkind = 'v'
             AND NOT coalesce((SELECT bool_or(o IN ('security_invoker=true', 'security_invoker=on'))
                                 FROM unnest(c.reloptions) o), false))
  UNION ALL
  SELECT 9, 'TRUNCATE para usuarios de la app',
         (SELECT string_agg(DISTINCT table_name, ', ') FROM information_schema.role_table_grants
           WHERE grantee IN ('anon', 'authenticated') AND table_schema = 'public' AND privilege_type = 'TRUNCATE')
  UNION ALL
  SELECT 10, 'Buckets públicos (informativo: fotos-obra lo es a propósito por ahora)',
         (SELECT string_agg(id, ', ') FROM storage.buckets WHERE public AND id <> 'fotos-obra')
  UNION ALL
  SELECT 11, 'Usuarios de Auth sin fila en usuario (no ven nada, pero sobran)',
         (SELECT string_agg(u.email, ', ') FROM auth.users u
           WHERE NOT EXISTS (SELECT 1 FROM public.usuario x WHERE lower(x.email) = lower(u.email)))
  UNION ALL
  SELECT 12, 'Admins y gerentes sin doble factor (MFA)',
         (SELECT string_agg(x.email, ', ') FROM public.usuario x
           WHERE x.rol IN ('admin', 'gerente')
             AND NOT EXISTS (SELECT 1 FROM auth.users u JOIN auth.mfa_factors m ON m.user_id = u.id
                              WHERE lower(u.email) = lower(x.email) AND m.status = 'verified'))
)
SELECT n, chequeo, CASE WHEN detalle IS NULL THEN 'OK' ELSE 'REVISAR' END AS estado, detalle
  FROM chequeos ORDER BY n;
