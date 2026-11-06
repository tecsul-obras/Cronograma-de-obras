-- ═══════════════════════════════════════════════════════════════════════════
-- 97 · PLANTAS — el encargado de planta ve y maneja todo en SU planta · equipos-v94 · 06/11/2026
--      correr después del 92, 93 y 94. Se puede correr dos veces.
--
--   · Encargado (planta_personal.rol = 'encargado'): ve Costos y Configuración de su
--     planta y puede editar: datos de la planta, tanques y aforo, fórmulas y
--     dosificación, precios, máquinas fijas y el personal (operadores, báscula).
--     No puede crear ni borrar plantas (eso sigue siendo del admin central).
--   · Operadores: cargan el parte de planta (como hasta ahora); no ven costos ni configuración.
-- ═══════════════════════════════════════════════════════════════════════════

-- quién configura una planta: admin central o su encargado
create or replace function public.planta_configura(p_planta text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.planta_rol(p_planta) in ('admin', 'encargado'), false)
$$;
grant execute on function public.planta_configura(text) to authenticated;

-- costos: también el encargado
create or replace function public.planta_ve_costos(p_planta text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.planta_rol(p_planta) in ('admin', 'encargado'), false)
      or exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text in ('admin_obra', 'gerente'))
      or exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'gerente'))
$$;

-- plantas: el encargado edita la suya (no alta ni baja)
drop policy if exists plantas_encargado on public.plantas;
create policy plantas_encargado on public.plantas for update to authenticated
  using (public.planta_configura(id)) with check (public.planta_configura(id));

-- tablas de configuración: admin central o encargado de esa planta
do $$
declare t text;
begin
  foreach t in array array['planta_tanques', 'planta_formulas', 'planta_personal', 'planta_precios', 'planta_equipos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_encargado', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.planta_configura(planta_id)) with check (public.planta_configura(planta_id))', t || '_encargado', t);
  end loop;
end $$;

-- plantas_acceso: agrega «configura»
create or replace function public.plantas_acceso()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'planta', p.id, 'tipo', p.tipo, 'nombre', coalesce(p.nombre, e.descripcion), 'rol', r.rol,
           'recarga_cap', (r.rol = 'admin' or exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra')),
           'costos', public.planta_ve_costos(p.id),
           'configura', public.planta_configura(p.id))
           order by p.id), '[]'::jsonb)
  from plantas p
  join equipos e on e.id = p.id
  cross join lateral (select public.planta_rol(p.id) as rol) r
  where p.activo and r.rol is not null
$$;

-- ── Verificación: encargados y lo que ven ──────────────────────────────────
select pp.planta_id, pp.cedula, o.nombre, pp.rol, pp.activo
from public.planta_personal pp left join public.operadores o on o.cedula = pp.cedula
order by pp.planta_id, pp.rol, o.nombre;
