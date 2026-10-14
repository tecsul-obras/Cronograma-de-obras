-- =========================================================================
-- 37_rls_rendimiento.sql · v20261014a
--
-- PROBLEMA: las políticas de lectura usan app_puede_ver(obra_id). Es SECURITY
-- DEFINER + SET search_path, así que Postgres no la puede "aplanar" y la
-- ejecuta UNA VEZ POR FILA (≈0,11 ms cada una). Medido en producción:
--   plan_semanal de Frigorífico Cruzmonte (7.539 filas): 825 ms  → 1,9 ms
--   item_recurso (4.652 filas):                           521 ms  → 1,5 ms
--   compra, todas las obras (1.328 filas):                190 ms  →   5 ms
-- y con la paginación (OFFSET) el costo se repite por cada página.
--
-- SOLUCIÓN (misma regla, otra forma de escribirla): app_puede_ver(p) es
--     ∃ usuario activo con mi email  ∧ ( rol ∉ {transporte, produccion} ∧ sin obras asignadas
--                                       ∨ p ∈ obras asignadas )
-- que es exactamente
--     app_ve_todas_obras()  ∨  p = ANY(app_obras_usuario())
-- Ninguna de las dos depende de la fila: envueltas en (select …) Postgres las
-- calcula UNA vez por consulta (InitPlan).
-- También se envuelve app_rol() en (select …) en las políticas que la usan.
--
-- Solo cambia la expresión USING de políticas de LECTURA. app_puede_ver() queda
-- como estaba (la usan funciones de escritura). Verificado antes de aplicar (14/10/2026),
-- dentro de una transacción descartada: para los 12 usuarios activos (admin,
-- gerente, compras, residentes con y sin obras asignadas) y un email inexistente,
-- las 32 tablas devuelven exactamente las mismas filas (cantidad y hash del
-- contenido): 416 comparaciones, 0 diferencias. Tiempo total 89 s → 1,6 s.
-- Nota: "= any ((select …)::text[])" lleva el cast para que Postgres lo tome como
-- arreglo y no como subconsulta de filas.
-- Para volver atrás: correr el bloque del final ("REVERTIR").
-- =========================================================================

create or replace function public.app_ve_todas_obras()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.usuario u
     where u.email = public.app_email() and u.activo
       and u.rol not in ('transporte', 'produccion')
       and not exists (select 1 from public.usuario_obra uo where uo.email = u.email)
  )
$$;

create or replace function public.app_obras_usuario()
returns text[]
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(uo.obra_id), '{}'::text[])
    from public.usuario u
    join public.usuario_obra uo on uo.email = u.email
   where u.email = public.app_email() and u.activo
$$;

revoke all on function public.app_ve_todas_obras() from public, anon;
revoke all on function public.app_obras_usuario() from public, anon;
grant execute on function public.app_ve_todas_obras() to authenticated;
grant execute on function public.app_obras_usuario() to authenticated;

do $$
declare p record; q text;
begin
  for p in
    select tablename, policyname, qual from pg_policies
     where schemaname = 'public' and cmd = 'SELECT'
       and qual like '%app_puede_ver(obra_id)%'
  loop
    q := replace(p.qual, 'app_puede_ver(obra_id)',
                 '((select public.app_ve_todas_obras()) or obra_id = any ((select public.app_obras_usuario())::text[]))');
    q := replace(q, 'app_rol()', '(select public.app_rol())');
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
  end loop;
end $$;

-- ------------------------------------------------------------------ REVERTIR
-- (vuelve a las expresiones originales; las funciones nuevas pueden quedar)
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['adjunto','calendario','categoria','certificacion','certificado','compra','compra_ajuste','computo_item','computo_linea','comunicacion','convenio','convenio_detalle','distribucion_mensual','item','item_dependencia','item_recurso','linea_base','linea_base_detalle','obra','pista_eje','pista_estado','pista_snapshot','pista_tramo','plan_semanal','produccion_fila','produccion_jornada','recurso_precio','stock_conteo','transporte_carga','transporte_viaje'] loop
--     execute format('alter policy leer on public.%I using (app_puede_ver(obra_id))', t);
--   end loop;
-- end $$;
-- alter policy leer on public.config using (((obra_id is null) and (app_rol() is not null)) or app_puede_ver(obra_id));
-- alter policy leer on public.flete_tarifa using ((app_rol() = any (array['admin','residente','gerente','compras'])) and app_puede_ver(obra_id));
