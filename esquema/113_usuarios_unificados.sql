-- ═══════════════════════════════════════════════════════════════════════════
-- 113 · USUARIOS UNIFICADOS · v20261112g · equipos-v112 · 12/11/2026
--       Se puede correr más de una vez. No borra datos.
--
--  Una sola pantalla de usuarios (la misma en Obras › Administración y en
--  Equipos › Administración › Usuarios). En la ficha de cada persona:
--    · cuenta (cédula o correo, contraseña),
--    · rol en Obras (+ obras),
--    · rol en Equipos (+ frentes) — ahora también «Compras (taller)»,
--    · FORMULARIOS A MEDIDA: parte / taller / combustible, para cualquier rol
--      (ej.: compras de taller que además carga combustible),
--    · Compras de taller: solicitar (obras), bodega, compras, autorizar, ver
--      (la misma tabla tc_permiso de Compras › Taller › Permisos),
--    · Plantas: encargado / operador / báscula de cada planta (planta_personal),
--    · Responsable de máquinas (lista de Flota),
--    · Aprueba ediciones de partes certificados (partes_aprobadores),
--    · Recursos humanos extra (editar o ver) sin cambiar el rol de Obras.
--
--  Quién edita:
--    · Administrador de Obras (app_es_admin): todo.
--    · Admin central de Equipos (es_admin): todo menos el rol en Obras.
--
--  Cambio de regla (mis_formularios):
--    Hasta ahora Compras, Taller, Admin de obra y Gerente tenían los
--    formularios FIJOS (lo marcado a mano se ignoraba). Ahora lo marcado a
--    mano manda para todos; «Automático» sigue igual que antes.
--    Para no cambiar a nadie sin querer, a esos cuatro roles se les limpia
--    lo marcado a mano (que hoy no tenía efecto) → quedan en Automático.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 0) quién administra ──────────────────────────────────────────────────
create or replace function public.adm_puede_equipos()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_es_admin(), false) or coalesce(public.es_admin(), false)
$$;
revoke all on function public.adm_puede_equipos() from public, anon;
grant execute on function public.adm_puede_equipos() to authenticated;

-- ── 1) formularios: lo marcado a mano manda para todos los roles ─────────
-- (lo que hoy estaba marcado en estos roles no tenía efecto: se limpia para
--  que nadie gane ni pierda un formulario al correr esto)
-- Solo la PRIMERA vez (si mis_formularios todavía es la vieja): si se vuelve a
-- correr no borra lo que ya se haya dado a medida desde la pantalla.
-- (el disparador que protege perfiles no deja cambiar formularios desde el SQL Editor)
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'mis_formularios' and prosrc like '%formularios_auto%') then
    alter table public.perfiles disable trigger trg_perfil_campos_bloqueados;
    update public.perfiles set formularios = null
     where rol::text in ('taller', 'admin_obra', 'compras', 'gerente') and formularios is not null;
    alter table public.perfiles enable trigger trg_perfil_campos_bloqueados;
  end if;
end $$;

alter table public.perfiles drop constraint if exists perfiles_formularios_validos;
alter table public.perfiles add constraint perfiles_formularios_validos
  check (formularios is null or formularios <@ array['parte', 'taller', 'combustible']);

-- Automático: según el rol y la especialidad (la misma tabla de siempre)
create or replace function public.formularios_auto(p_rol text, p_especialidad text)
returns text[] language sql immutable as $$
  select case
    when p_rol = 'admin_central' then array['parte', 'taller', 'combustible']
    when p_rol = 'taller'        then array['taller']
    when p_rol = 'admin_obra'    then array['parte']
    when p_rol in ('gerente', 'compras') then array[]::text[]
    when p_especialidad = 'DESPACHADOR' then array['combustible']
    when p_especialidad in ('MECANICO', 'MECANICO A', 'MECANICO B', 'ELECTRICISTA',
                            'GOMERO', 'AYUDANTE MECANICO', 'SUPERVISOR') then array['taller']
    else array['parte']
  end
$$;
grant execute on function public.formularios_auto(text, text) to authenticated;

create or replace function public.mis_formularios()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(p.formularios, public.formularios_auto(p.rol::text, o.especialidad))
  from perfiles p
  left join operadores o on o.cedula = p.cedula
  where p.id = auth.uid()
$$;
revoke all on function public.mis_formularios() from public, anon;
grant execute on function public.mis_formularios() to authenticated;

-- ── 2) permisos extra sueltos (por ahora: Recursos humanos) ──────────────
create table if not exists public.permiso_extra (
  user_id      uuid not null references auth.users(id) on delete cascade,
  permiso      text not null check (permiso in ('rrhh_editar', 'rrhh_ver')),
  otorgado_por uuid default auth.uid(),
  otorgado_en  timestamptz not null default now(),
  primary key (user_id, permiso)
);
alter table public.permiso_extra enable row level security;
drop policy if exists permiso_extra_lee on public.permiso_extra;
create policy permiso_extra_lee on public.permiso_extra for select to authenticated
  using (user_id = auth.uid() or public.adm_puede_equipos());
revoke insert, update, delete, truncate on public.permiso_extra from authenticated, anon;
grant select on public.permiso_extra to authenticated;

create or replace function public.rrhh_acceso()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'rrhh')) then 'editar'
    when exists (select 1 from perfiles p where p.id = auth.uid() and p.activo and p.rol::text = 'admin_central') then 'editar'
    when exists (select 1 from permiso_extra x where x.user_id = auth.uid() and x.permiso = 'rrhh_editar') then 'editar'
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol = 'gerente') then 'ver'
    when exists (select 1 from permiso_extra x where x.user_id = auth.uid() and x.permiso = 'rrhh_ver') then 'ver'
  end
$$;
revoke all on function public.rrhh_acceso() from public;
grant execute on function public.rrhh_acceso() to authenticated;

-- ── 3) rol en Equipos: también «compras» y lo puede guardar el admin central ──
create or replace function public.adm_perfil_guardar(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_rol text := coalesce(nullif(p->>'rol', ''), '');
  v_email text;
  v_obras text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'obras', '[]'::jsonb)) x), '{}');
  -- null o ausente = Automático; una lista (aunque esté vacía) = a medida
  v_form text[] := case when jsonb_typeof(p->'formularios') = 'array'
                        then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'formularios') x), '{}') end;
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_id;
  if v_email is null then raise exception 'Primero hay que crear la cuenta de acceso de esta persona.' using errcode = '22023'; end if;
  if v_id = auth.uid() and v_rol is distinct from 'admin_central' and exists (select 1 from perfiles where id = v_id and rol::text = 'admin_central') then
    raise exception 'No podés quitarte a vos mismo el rol de administrador de Equipos.' using errcode = '42501';
  end if;
  if v_rol = '' then
    delete from public.perfiles where id = v_id;
    return json_build_object('id', v_id, 'eq_rol', null);
  end if;
  if v_rol not in ('operador', 'admin_obra', 'taller', 'gerente', 'compras', 'admin_central') then
    raise exception 'Rol de equipos no válido: %', v_rol using errcode = '22023';
  end if;
  if v_rol = 'admin_obra' and coalesce(array_length(v_obras, 1), 0) = 0 then
    raise exception 'Un admin de obra necesita al menos una obra de equipos.' using errcode = '22023';
  end if;
  if v_form is not null and not (v_form <@ array['parte', 'taller', 'combustible']) then
    raise exception 'Formulario no válido.' using errcode = '22023';
  end if;
  insert into public.perfiles (id, cedula, nombre, rol, obras, formularios, activo, debe_cambiar_clave)
  values (v_id,
          coalesce(nullif(p->>'cedula', ''), split_part(v_email, '@', 1)),
          coalesce(nullif(p->>'nombre', ''), split_part(v_email, '@', 1)),
          v_rol::rol_usuario,
          case when v_rol = 'admin_obra' then v_obras else '{}' end,
          v_form,
          coalesce((p->>'activo')::boolean, true),
          false)
  on conflict (id) do update set
    nombre = excluded.nombre, rol = excluded.rol, obras = excluded.obras,
    formularios = excluded.formularios, activo = excluded.activo;
  return json_build_object('id', v_id, 'eq_rol', v_rol);
end $$;

-- ── 4) la lista de personas, con todo lo que tienen ──────────────────────
create or replace function public.adm_personas()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  return coalesce((
    with correos as (
      select lower(a.email) as email from auth.users a where a.email is not null
      union
      select u.email from public.usuario u
    )
    select json_agg(json_build_object(
      'email',          c.email,
      'id',             a.id,
      'tiene_acceso',   a.id is not null,
      'ultimo_ingreso', a.last_sign_in_at,
      'nombre',         coalesce(nullif(u.nombre, ''), nullif(p.nombre, ''), a.raw_user_meta_data->>'nombre', ''),
      'ob_rol',         u.rol,
      'ob_activo',      u.activo,
      'ob_obras',       coalesce((select json_agg(uo.obra_id order by uo.obra_id) from public.usuario_obra uo where uo.email = c.email), '[]'::json),
      'eq_rol',         p.rol,
      'eq_activo',      p.activo,
      'eq_cedula',      p.cedula,
      'eq_obras',       coalesce(to_json(p.obras), '[]'::json),
      'eq_formularios', to_json(p.formularios),
      'eq_especialidad', o.especialidad,
      'eq_forms_auto',  case when p.id is not null then to_json(public.formularios_auto(p.rol::text, o.especialidad)) end,
      'eq_cambiar_clave', p.debe_cambiar_clave,
      'tc',             coalesce((select json_object_agg(t.capacidad, t.obras) from public.tc_permiso t where t.user_id = a.id), '{}'::json),
      'aprobador',      exists (select 1 from public.partes_aprobadores pa where pa.usuario_id = a.id),
      'responsable',    exists (select 1 from public.responsables_maquinas r where r.perfil_id = a.id and r.activo),
      'plantas',        coalesce((select json_agg(json_build_object('planta', pp.planta_id, 'rol', pp.rol, 'cedula', pp.cedula) order by pp.planta_id)
                                    from public.planta_personal pp
                                   where pp.activo and (pp.usuario_id = a.id or (p.cedula is not null and pp.cedula = p.cedula))), '[]'::json),
      'extras',         coalesce((select json_agg(x.permiso order by x.permiso) from public.permiso_extra x where x.user_id = a.id), '[]'::json)
    ) order by coalesce(nullif(u.nombre, ''), nullif(p.nombre, ''), c.email))
    from correos c
    left join auth.users a on lower(a.email) = c.email
    left join public.usuario u on u.email = c.email
    left join public.perfiles p on p.id = a.id
    left join public.operadores o on o.cedula = p.cedula
  ), '[]'::json);
end $$;

-- Qué puede editar quien entra, y las listas para la ficha
create or replace function public.adm_contexto()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  return json_build_object(
    'obras',    coalesce(public.app_es_admin(), false),   -- rol en Obras
    'equipos',  true,                                     -- todo lo demás
    'obras_ob', coalesce((select json_agg(json_build_object('id', ob.obra_id, 'nombre', coalesce(ob.nombre, ob.obra_id)) order by ob.obra_id)
                            from public.obra ob where ob.activo is distinct from false), '[]'::json),
    'frentes',  coalesce((select json_agg(f.clave order by f.clave) from public.obras f where f.activa is distinct from false), '[]'::json),
    'plantas',  coalesce((select json_agg(json_build_object('id', pl.id, 'nombre', coalesce(pl.nombre, pl.id)) order by pl.id)
                            from public.plantas pl where pl.activo), '[]'::json),
    'personal', coalesce((select json_agg(json_build_object('cedula', op.cedula, 'nombre', op.nombre) order by op.nombre)
                            from public.operadores op where op.activo), '[]'::json));
end $$;

-- ── 5) guardar lo «extra» de una persona (todo en una llamada) ───────────
--  p = { id, tc: {capacidad: [obras]}, aprobador, responsable, extras: [..],
--        plantas: [{planta, rol, cedula}] }
--  Cada bloque es opcional: si no viene, no se toca.
create or replace function public.adm_extras_guardar(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nombre text;
  v_ced text;
  v_caps text[];
  r jsonb;
begin
  if not public.adm_puede_equipos() then raise exception 'Solo un administrador.' using errcode = '42501'; end if;
  if v_id is null or not exists (select 1 from auth.users where id = v_id) then
    raise exception 'Primero hay que crear la cuenta de acceso de esta persona.' using errcode = '22023';
  end if;
  select coalesce(nullif(pf.nombre, ''), nullif(u.nombre, ''), split_part(au.email, '@', 1)), pf.cedula
    into v_nombre, v_ced
    from auth.users au left join perfiles pf on pf.id = au.id left join usuario u on u.email = lower(au.email)
   where au.id = v_id;

  -- Compras de taller
  if jsonb_typeof(p->'tc') = 'object' then
    select coalesce(array_agg(k), '{}') into v_caps from jsonb_object_keys(p->'tc') k;
    if not (v_caps <@ array['solicitar', 'bodega', 'compras', 'autorizar', 'ver']) then
      raise exception 'Permiso de compras de taller no válido.' using errcode = '22023';
    end if;
    delete from tc_permiso where user_id = v_id and capacidad <> all (v_caps);
    insert into tc_permiso (user_id, capacidad, obras, otorgado_por)
    select v_id, k,
           case when k = 'solicitar' then coalesce((select array_agg(x) from jsonb_array_elements_text(
                  case when jsonb_typeof(p->'tc'->k) = 'array' then p->'tc'->k else '[]'::jsonb end) x), '{}') else '{}' end,
           auth.uid()
      from unnest(v_caps) k
    on conflict (user_id, capacidad) do update set obras = excluded.obras, otorgado_por = excluded.otorgado_por, otorgado_en = now();
  end if;

  -- Aprueba ediciones de partes certificados
  if p ? 'aprobador' then
    if coalesce((p->>'aprobador')::boolean, false) then
      insert into partes_aprobadores (usuario_id, nombre) values (v_id, v_nombre) on conflict (usuario_id) do nothing;
    else
      if v_id = auth.uid() then raise exception 'No podés quitarte a vos mismo como aprobador.' using errcode = '42501'; end if;
      delete from partes_aprobadores where usuario_id = v_id;
    end if;
  end if;

  -- Responsable de máquinas (lista de Flota)
  if p ? 'responsable' then
    if coalesce((p->>'responsable')::boolean, false) then
      if not exists (select 1 from perfiles where id = v_id) then
        raise exception 'Para ser responsable de máquinas necesita un rol en Equipos.' using errcode = '22023';
      end if;
      update responsables_maquinas set activo = true where perfil_id = v_id;
      if not found then
        update responsables_maquinas set perfil_id = v_id, activo = true
         where perfil_id is null and norm_nombre(nombre) = norm_nombre(v_nombre);
        if not found then
          insert into responsables_maquinas (nombre, perfil_id) values (v_nombre, v_id)
          on conflict (nombre) do update set activo = true;
        end if;
      end if;
    else
      update responsables_maquinas set activo = false where perfil_id = v_id;
    end if;
  end if;

  -- Permisos sueltos (RRHH)
  if jsonb_typeof(p->'extras') = 'array' then
    delete from permiso_extra where user_id = v_id
       and permiso <> all (coalesce((select array_agg(x) from jsonb_array_elements_text(p->'extras') x), '{}'));
    insert into permiso_extra (user_id, permiso)
    select v_id, x from jsonb_array_elements_text(p->'extras') x
    on conflict do nothing;
  end if;

  -- Plantas: los renglones que no vienen quedan inactivos (no se borran)
  if jsonb_typeof(p->'plantas') = 'array' then
    update planta_personal pp set activo = false
     where pp.activo and (pp.usuario_id = v_id or (v_ced is not null and pp.cedula = v_ced))
       and not exists (select 1 from jsonb_array_elements(p->'plantas') e
                        where e->>'planta' = pp.planta_id and coalesce(nullif(e->>'cedula', ''), v_ced) = pp.cedula);
    for r in select * from jsonb_array_elements(p->'plantas') loop
      if coalesce(r->>'rol', '') not in ('encargado', 'operador', 'bascula') then
        raise exception 'Rol de planta no válido: %', r->>'rol' using errcode = '22023';
      end if;
      if not exists (select 1 from operadores where cedula = coalesce(nullif(r->>'cedula', ''), v_ced)) then
        raise exception 'Para la planta % hay que elegir la persona del Personal (cédula %).', r->>'planta', coalesce(nullif(r->>'cedula', ''), v_ced, '—')
          using errcode = '22023';
      end if;
      insert into planta_personal (planta_id, cedula, rol, activo, usuario_id)
      values (r->>'planta', coalesce(nullif(r->>'cedula', ''), v_ced), r->>'rol', true,
              case when exists (select 1 from perfiles where id = v_id) then v_id end)
      on conflict (planta_id, cedula) do update set rol = excluded.rol, activo = true,
        usuario_id = coalesce(excluded.usuario_id, planta_personal.usuario_id);
    end loop;
  end if;

  return json_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.adm_personas() from public, anon;
revoke all on function public.adm_contexto() from public, anon;
revoke all on function public.adm_perfil_guardar(jsonb) from public, anon;
revoke all on function public.adm_extras_guardar(jsonb) from public, anon;
grant execute on function public.adm_personas() to authenticated;
grant execute on function public.adm_contexto() to authenticated;
grant execute on function public.adm_perfil_guardar(jsonb) to authenticated;
grant execute on function public.adm_extras_guardar(jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from pg_proc where proname in ('adm_puede_equipos', 'formularios_auto', 'adm_contexto', 'adm_extras_guardar')) as funciones_4,
  (select prosrc like '%formularios_auto%' from pg_proc where proname = 'mis_formularios') as formularios_t,
  (select prosrc like '%''compras'', ''admin_central''%' from pg_proc where proname = 'adm_perfil_guardar') as rol_compras_t,
  (select prosrc like '%permiso_extra%' from pg_proc where proname = 'rrhh_acceso') as rrhh_extra_t,
  (select count(*) from public.perfiles where formularios is not null) as personas_con_formularios_a_medida;
-- Debe dar: 4 · t · t · t · (un número)

-- Volver atrás (resumen): correr de nuevo el 99 (mis_formularios con roles
-- fijos) y el 72 (rrhh_acceso); drop table public.permiso_extra;
-- drop function public.adm_extras_guardar(jsonb), public.adm_contexto(),
-- public.formularios_auto(text, text), public.adm_puede_equipos().
