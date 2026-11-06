-- ═══════════════════════════════════════════════════════════════════════════
-- 99 · Rol de Equipos «compras» (compras de taller) · equipos-v96 · 06/11/2026
--      Se puede correr dos veces.
--
--   Para la persona de compras del taller:
--   · Compras › Taller: permiso «compras» completo (cotiza, pide autorización,
--     registra la compra) — sin tener que asignarlo a mano en Permisos.
--   · Equipos: ve solo la solapa Flota (y las fichas de los equipos), sin poder
--     modificar nada. No ve partes, OT, combustible, mantenimiento, plata, ni
--     formularios.
--   El usuario se crea en Administración con rol «Compras (taller)».
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) el valor nuevo del rol (va primero; las funciones de abajo lo comparan como texto)
alter type public.rol_usuario add value if not exists 'compras';

-- 2) ve la flota (lectura); edita_flota() no cambia: no edita
create or replace function public.ve_flota()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(mi_rol()::text in ('admin_central', 'taller', 'admin_obra', 'gerente', 'compras'), false)
$$;

-- 3) sin formularios (no carga partes, taller ni combustible)
create or replace function public.mis_formularios()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select case
    when p.rol::text = 'compras'    then array[]::text[]
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

-- 4) Compras de taller: el rol «compras» de Equipos tiene el permiso de compras
create or replace function public.tc_yo()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_email text := public.app_email();
  r_ob text; n_ob text;
  r_eq text; n_eq text; o_eq text[];
  g_sol boolean; g_sol_obras text[];
  v_super boolean; v_sol boolean; v_sol_todas boolean := false; v_sol_obras text[] := '{}';
  v_bod boolean; v_com boolean; v_aut boolean; v_ver boolean; v_ver_todas boolean;
begin
  if v_uid is null then return null; end if;
  select u.rol, u.nombre into r_ob, n_ob from usuario u where u.email = v_email and u.activo;
  select p.rol::text, p.nombre, coalesce(p.obras, '{}') into r_eq, n_eq, o_eq from perfiles p where p.id = v_uid and coalesce(p.activo, true);
  select true, obras into g_sol, g_sol_obras from tc_permiso where user_id = v_uid and capacidad = 'solicitar';

  v_super := coalesce(r_ob = 'admin', false) or coalesce(r_eq = 'admin_central', false);

  -- solicitar y confirmar recepción, con alcance por obra
  if v_super or r_eq = 'taller' or (g_sol and cardinality(g_sol_obras) = 0)
     or (r_eq = 'admin_obra' and cardinality(o_eq) = 0) then
    v_sol_todas := true;
  else
    if r_eq = 'admin_obra' then v_sol_obras := v_sol_obras || o_eq; end if;
    if g_sol then v_sol_obras := v_sol_obras || g_sol_obras; end if;
  end if;
  v_sol := v_sol_todas or cardinality(v_sol_obras) > 0;

  v_bod := v_super or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'bodega');
  v_com := v_super or coalesce(r_ob = 'compras', false) or coalesce(r_eq = 'compras', false)
           or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'compras');
  v_aut := v_super or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'autorizar');

  v_ver_todas := v_sol_todas or v_bod or v_com or v_aut
    or coalesce(r_ob in ('gerente', 'compras'), false) or coalesce(r_eq = 'gerente', false)
    or exists (select 1 from tc_permiso where user_id = v_uid and capacidad = 'ver');
  v_ver := v_ver_todas or v_sol;

  if not v_ver then
    return jsonb_build_object('uid', v_uid, 'email', v_email, 'nombre', coalesce(n_ob, n_eq, v_email),
      'rol_obras', r_ob, 'rol_equipos', r_eq, 'ver', false);
  end if;
  return jsonb_build_object(
    'uid', v_uid, 'email', v_email, 'nombre', coalesce(nullif(n_ob, ''), nullif(n_eq, ''), v_email),
    'rol_obras', r_ob, 'rol_equipos', r_eq,
    'super', v_super, 'ver', v_ver, 'ver_todas', v_ver_todas,
    'ver_obras', to_jsonb(v_sol_obras),
    'solicitar', v_sol, 'sol_todas', v_sol_todas, 'sol_obras', to_jsonb(v_sol_obras),
    'bodega', v_bod, 'compras', v_com, 'autorizar', v_aut);
end $function$;

select 'SQL 99 ok' as resultado,
       exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'rol_usuario' and e.enumlabel = 'compras') as rol_compras_existe;
