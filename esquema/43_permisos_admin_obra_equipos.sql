-- =========================================================================
-- 43_permisos_admin_obra_equipos.sql · v20261015c  (Equipos: rol Admin de obra)
--
-- Admin de obra en la app de Equipos queda así:
--   · Nuevo parte e Historial de partes: carga y corrige los de sus obras
--     (igual que antes, no se toca).
--   · Flota y ficha de equipos: solo ve; lo único que cambia es la
--     DISPONIBILIDAD (ya no la observación).
--   · Todo lo demás (carga de combustible, reporte de taller, OT, control de
--     combustible, mantenimiento, personal, alertas): ni ve ni edita.
--
-- Qué cambia en la base:
--   1) mis_formularios(): admin de obra → solo 'parte' (antes parte + combustible),
--      aunque su usuario tenga formularios cargados a mano.
--   2) ve_gestion(): como ve_flota() pero sin admin de obra. Reemplaza a
--      ve_flota() en la lectura de mantenimientos, planes, registros de OT y
--      movimientos de combustible. Flota, estado, documentos e historial del
--      equipo siguen con ve_flota() (los ve).
--   3) Órdenes de trabajo: admin de obra ya no las lee ni las pide. Las OT que
--      abre un parte con falla las sigue creando la base (no depende del rol).
--   4) Combustible: admin de obra ya no puede cargar movimientos.
--   5) cambiar_disponibilidad(): con admin de obra ignora la nota (observación).
--
-- Para volver atrás: el bloque REVERTIR del final.
-- =========================================================================

-- 1) Formularios
create or replace function public.mis_formularios()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when p.rol::text = 'admin_obra' then array['parte']
    else coalesce(
      p.formularios,
      case p.rol::text
        when 'admin_central' then array['parte','taller','combustible']
        when 'taller'        then array['parte','taller','combustible']
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

-- 2) Gestión de taller: flota sin admin de obra
create or replace function public.ve_gestion()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ve_flota() and public.mi_rol()::text is distinct from 'admin_obra', false)
$$;
grant execute on function public.ve_gestion() to authenticated;

alter policy mantenimientos_lectura on public.mantenimientos
  using ((select public.ve_gestion()));
alter policy planes_mantenimiento_lectura on public.planes_mantenimiento
  using ((select public.ve_gestion()));
alter policy otr_lectura on public.ot_registros
  using ((select public.ve_gestion())
         or usuario_id = (select auth.uid())
         or tecnico_cedula = (select public.mi_cedula()));
alter policy comb_lectura on public.combustible_movimientos
  using ((select public.ve_gestion())
         or usuario_id = (select auth.uid())
         or despachador_cedula = (select public.mi_cedula()));

-- 3) Órdenes de trabajo
alter policy ot_lectura on public.ordenes_trabajo
  using ((select public.mi_rol())::text is distinct from 'admin_obra');
alter policy ot_alta on public.ordenes_trabajo
  with check ((select public.es_taller())
              or (creado_por = (select auth.uid())
                  and estado = any (array['Abierta','Solicitada'])
                  and (select public.mi_rol())::text is distinct from 'admin_obra'));

-- 4) Combustible
alter policy comb_alta on public.combustible_movimientos
  with check (usuario_id = (select auth.uid())
              and (select public.mi_rol())::text is distinct from 'admin_obra');

-- 5) Disponibilidad sin observación para admin de obra
create or replace function public.cambiar_disponibilidad(p_equipo text, p_disponibilidad text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ve_flota() then
    raise exception 'Sin permiso para cambiar la disponibilidad';
  end if;
  if not exists (select 1 from cat_disponibilidad where nombre = p_disponibilidad and activo) then
    raise exception 'Disponibilidad inválida: %', p_disponibilidad;
  end if;
  if mi_rol()::text = 'admin_obra' then
    p_nota := null;   -- admin de obra solo cambia la disponibilidad
  end if;
  update equipo_estado
     set disponibilidad = p_disponibilidad,
         observacion = coalesce(nullif(trim(p_nota), ''), observacion)
   where equipo_id = p_equipo;
  if not found then raise exception 'Equipo inexistente: %', p_equipo; end if;
end;
$$;

-- =========================================================================
-- REVERTIR (ejecutar solo si hay que volver atrás)
-- -------------------------------------------------------------------------
-- alter policy mantenimientos_lectura on public.mantenimientos using ((select public.ve_flota()));
-- alter policy planes_mantenimiento_lectura on public.planes_mantenimiento using ((select public.ve_flota()));
-- alter policy otr_lectura on public.ot_registros using ((select public.ve_flota()) or usuario_id = (select auth.uid()) or tecnico_cedula = (select public.mi_cedula()));
-- alter policy comb_lectura on public.combustible_movimientos using ((select public.ve_flota()) or usuario_id = (select auth.uid()) or despachador_cedula = (select public.mi_cedula()));
-- alter policy ot_lectura on public.ordenes_trabajo using (true);
-- alter policy ot_alta on public.ordenes_trabajo with check ((select public.es_taller()) or (creado_por = (select auth.uid()) and estado = any (array['Abierta','Solicitada'])));
-- alter policy comb_alta on public.combustible_movimientos with check (usuario_id = (select auth.uid()));
-- (mis_formularios y cambiar_disponibilidad: volver a correr su versión anterior,
--  admin_obra → array['parte','combustible'] y sin el bloque "p_nota := null")
-- drop function if exists public.ve_gestion();
-- =========================================================================
