-- ═══════════════════════════════════════════════════════════════════════════
-- 98 · PLANTAS — personal de planta vinculado al USUARIO de la app · equipos-v95 · 06/11/2026
--      Se puede correr dos veces.
--
--   La planta encontraba a la persona solo por cédula. Los usuarios que entran con
--   correo (ej. diegoflores@tecsul.com.py) guardan como «cédula» la parte del correo
--   (diegoflores), así que no coincidían con la cédula del personal de Flota.
--   Ahora cada renglón del personal de la planta puede llevar el usuario de la app
--   (usuario_id). Vale cualquiera de los dos: misma cédula o usuario vinculado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.planta_personal add column if not exists usuario_id uuid references public.perfiles(id) on delete set null;

create or replace function public.planta_rol(p_planta text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_central') then 'admin'
    when exists (select 1 from planta_personal pp join perfiles pf on (pf.cedula = pp.cedula or pf.id = pp.usuario_id)
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'encargado') then 'encargado'
    when exists (select 1 from planta_personal pp join perfiles pf on (pf.cedula = pp.cedula or pf.id = pp.usuario_id)
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'operador') then 'operador'
    when exists (select 1 from planta_personal pp join perfiles pf on (pf.cedula = pp.cedula or pf.id = pp.usuario_id)
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'bascula') then 'bascula'
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra') then 'admin_obra'
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text in ('gerente', 'taller')) then 'ver'
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'gerente')) then 'ver'
  end
$$;

-- Usuarios de la app para elegir en Configuración › Personal (admin central o encargado)
create or replace function public.planta_usuarios(p_planta text)
returns table (id uuid, nombre text, cedula text, rol text, correo text)
language sql stable security definer set search_path = public as $$
  select pf.id, pf.nombre, pf.cedula, pf.rol::text, u.email::text
  from perfiles pf left join auth.users u on u.id = pf.id
  where pf.activo and public.planta_configura(p_planta)
  order by pf.nombre
$$;
revoke all on function public.planta_usuarios(text) from public;
grant execute on function public.planta_usuarios(text) to authenticated;

-- Diego Flores (encargado PA-01, cédula 4782323) → su usuario diegoflores@tecsul.com.py
update public.planta_personal pp
   set usuario_id = pf.id
  from perfiles pf join auth.users u on u.id = pf.id
 where pp.planta_id = 'PA-01' and pp.cedula = '4782323' and lower(u.email) = 'diegoflores@tecsul.com.py' and pp.usuario_id is null;

-- ── Verificación: cada persona de planta y si tiene usuario ──────────────────
select pp.planta_id, o.nombre, pp.rol, coalesce(u.email, pc.cedula) as usuario
from public.planta_personal pp
left join public.operadores o on o.cedula = pp.cedula
left join public.perfiles pc on pc.cedula = pp.cedula
left join auth.users u on u.id = pp.usuario_id
order by pp.planta_id, pp.rol, o.nombre;
