-- =========================================================================
-- 44_permisos_taller_equipos.sql · v20261015e  (Equipos: rol Taller)
--
-- Taller en la app de Equipos queda así:
--   · Ve y edita: Reporte de taller, Flota, Órdenes de trabajo, Control de
--     combustible y Mantenimiento. Ve sus Reportes de Power BI.
--   · Historial de partes: solo ve (todos). Ya era así en la base.
--   · No ve: Nuevo parte, Carga de combustible, Alquileres, Seguros, Personal,
--     Alertas (ni Certificado ni Administración, que ya no veía).
--
-- Qué cambia en la base:
--   1) mis_formularios(): taller → solo 'taller' (antes parte + taller + combustible).
--   2) Partes: taller ya no puede cargar partes nuevos.
--   3) Combustible: taller ya no carga movimientos nuevos (sí sigue corrigiendo
--      en Control de combustible, como antes).
--   4) Alquileres y seguros: solo administración central (antes también taller).
--   5) Personal: modificar operadores queda para administración central (la
--      lista la siguen leyendo todos: la usa el formulario del parte).
--
-- Requiere el SQL 43 (usa la misma versión de mis_formularios con admin de obra).
-- Para volver atrás: el bloque REVERTIR del final.
-- =========================================================================

-- 1) Formularios
create or replace function public.mis_formularios()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when p.rol::text = 'admin_obra' then array['parte']
    when p.rol::text = 'taller'     then array['taller']
    else coalesce(
      p.formularios,
      case p.rol::text
        when 'admin_central' then array['parte','taller','combustible']
        else case
          when o.especialidad = 'DESPACHADOR' then array['combustible']
          when o.especialidad in ('MECANICO','MECANICO A','MECANICO B','ELECTRICISTA',
                                  'GOMERO','AYUDANTE MECANICO','SUPERVISOR') then array['taller']
          else array['parte'] end
      end)
  end
  from perfiles p
  left join operadores o on o.cedula = p.cedula
  where p.id = auth.uid()
$$;

-- 2) Partes: taller no carga partes
alter policy partes_alta on public.partes
  with check (usuario_id = (select auth.uid())
              and (select public.mi_rol())::text is distinct from 'taller'
              and (((select public.mi_rol()) <> 'admin_obra'::rol_usuario)
                   or obra_clave = any ((select public.mis_obras())::text[])));

-- 3) Combustible: ni admin de obra ni taller cargan movimientos nuevos
alter policy comb_alta on public.combustible_movimientos
  with check (usuario_id = (select auth.uid())
              and coalesce((select public.mi_rol())::text, '') not in ('admin_obra', 'taller'));

-- 4) Alquileres y seguros: solo administración central
alter policy alquiler_contratos_todo   on public.alquiler_contratos   using ((select public.es_admin())) with check ((select public.es_admin()));
alter policy alquiler_equipos_todo     on public.alquiler_equipos     using ((select public.es_admin())) with check ((select public.es_admin()));
alter policy alquiler_facturacion_todo on public.alquiler_facturacion using ((select public.es_admin())) with check ((select public.es_admin()));
alter policy seguros_todo              on public.seguros              using ((select public.es_admin())) with check ((select public.es_admin()));

-- 5) Personal: solo administración central modifica operadores
alter policy operadores_escritura on public.operadores
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- =========================================================================
-- REVERTIR (ejecutar solo si hay que volver atrás)
-- -------------------------------------------------------------------------
-- alter policy partes_alta on public.partes with check (usuario_id = (select auth.uid()) and (((select public.mi_rol()) <> 'admin_obra'::rol_usuario) or obra_clave = any ((select public.mis_obras())::text[])));
-- alter policy comb_alta on public.combustible_movimientos with check (usuario_id = (select auth.uid()) and (select public.mi_rol())::text is distinct from 'admin_obra');
-- alter policy alquiler_contratos_todo   on public.alquiler_contratos   using ((select public.es_taller())) with check ((select public.es_taller()));
-- alter policy alquiler_equipos_todo     on public.alquiler_equipos     using ((select public.es_taller())) with check ((select public.es_taller()));
-- alter policy alquiler_facturacion_todo on public.alquiler_facturacion using ((select public.es_taller())) with check ((select public.es_taller()));
-- alter policy seguros_todo              on public.seguros              using ((select public.es_taller())) with check ((select public.es_taller()));
-- alter policy operadores_escritura on public.operadores using ((select public.es_taller())) with check ((select public.es_taller()));
-- (mis_formularios: volver a correr la versión del SQL 43)
-- =========================================================================
