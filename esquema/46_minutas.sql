-- =========================================================================
-- 46_minutas.sql · v20261016d  (Equipos: Minutas de reunión)
-- Tecsul S.A.E.
--
-- Reemplaza el tablero de Monday "Minuta COPAC Obras - Taller - Compras":
-- compromisos de las reuniones con responsable, fecha de comité, estado,
-- prioridad, fecha límite y actualizaciones (comentarios con autor y hora).
--
--  · minuta_tableros: una minuta por comité/reunión periódica (COPAC…).
--  · minuta_items: los compromisos. "Pendientes" = estado distinto de Listo.
--  · minuta_actualizaciones: comentarios + cambios de estado (automáticos).
--
-- Quién: ven taller, admin de obra (residentes), admin central y gerente.
-- Cargan y editan taller, admin de obra y admin central. Borrar un
-- compromiso: admin central o quien lo creó. Tableros: admin central.
--
-- Se puede volver a correr. Después correr 46b_minutas_carga.sql (los
-- compromisos que estaban en Monday). Para volver atrás: REVERTIR al final.
-- =========================================================================

create or replace function public.ve_minutas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol()::text in ('admin_central', 'taller', 'admin_obra', 'gerente'), false)
$$;
create or replace function public.edita_minutas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol()::text in ('admin_central', 'taller', 'admin_obra'), false)
$$;
revoke all on function public.ve_minutas() from public, anon;
revoke all on function public.edita_minutas() from public, anon;
grant execute on function public.ve_minutas() to authenticated;
grant execute on function public.edita_minutas() to authenticated;

create table if not exists public.minuta_tableros (
  id           bigint generated always as identity primary key,
  nombre       text not null unique,
  descripcion  text,
  activo       boolean not null default true,
  orden        int not null default 0,
  creado_en    timestamptz not null default now()
);

create table if not exists public.minuta_items (
  id               bigint generated always as identity primary key,
  tablero_id       bigint not null references public.minuta_tableros(id) on delete cascade,
  titulo           text not null check (length(btrim(titulo)) > 0),
  responsables     text[] not null default '{}',
  fecha_comite     date,
  estado           text not null default 'No iniciado'
                   check (estado in ('No iniciado', 'Programado', 'En curso', 'En espera de definición', 'Detenido', 'Listo')),
  prioridad        text check (prioridad in ('Crítica', 'Alta', 'Media', 'Baja')),
  fecha_limite     date,
  notas            text,
  equipo_id        text,                 -- opcional: equipo de la flota al que se refiere
  obra_clave       text,                 -- opcional: obra
  monday_texto     text,                 -- "Ult. actualización" tal como venía de Monday
  creado_por       uuid default auth.uid(),
  creado_por_nombre text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  actualizado_por_nombre text,
  cerrado_en       timestamptz           -- cuándo pasó a Listo
);
create index if not exists minuta_items_tablero on public.minuta_items (tablero_id, estado, fecha_comite desc);

create table if not exists public.minuta_actualizaciones (
  id           bigint generated always as identity primary key,
  item_id      bigint not null references public.minuta_items(id) on delete cascade,
  texto        text not null,
  tipo         text not null default 'comentario' check (tipo in ('comentario', 'estado', 'monday')),
  autor_id     uuid default auth.uid(),
  autor_nombre text,
  creado_en    timestamptz not null default now()
);
create index if not exists minuta_act_item on public.minuta_actualizaciones (item_id, creado_en desc);

-- Nombre de quien está logueado (perfiles)
create or replace function public.mi_nombre() returns text
language sql stable security definer set search_path = public as $$
  select nombre from perfiles where id = auth.uid()
$$;
revoke all on function public.mi_nombre() from public, anon;
grant execute on function public.mi_nombre() to authenticated;

-- Autor y fechas automáticos; el cambio de estado queda como actualización
create or replace function public.minuta_items_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por_nombre := coalesce(new.creado_por_nombre, mi_nombre());
    new.actualizado_por_nombre := coalesce(new.actualizado_por_nombre, new.creado_por_nombre);
    if new.estado = 'Listo' and new.cerrado_en is null then new.cerrado_en := now(); end if;
    return new;
  end if;
  new.actualizado_en := now();
  new.actualizado_por_nombre := coalesce(mi_nombre(), new.actualizado_por_nombre);
  if new.estado is distinct from old.estado then
    new.cerrado_en := case when new.estado = 'Listo' then now() end;
    insert into minuta_actualizaciones (item_id, texto, tipo, autor_nombre)
    values (new.id, 'Estado: ' || old.estado || ' → ' || new.estado, 'estado', mi_nombre());
  end if;
  return new;
end $$;
drop trigger if exists trg_minuta_items_auditar on public.minuta_items;
create trigger trg_minuta_items_auditar before insert or update on public.minuta_items
  for each row execute function public.minuta_items_auditar();

create or replace function public.minuta_act_autor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.autor_nombre := coalesce(new.autor_nombre, mi_nombre());
  -- un comentario cuenta como actualización del compromiso
  if new.tipo = 'comentario' then
    update minuta_items set actualizado_en = now(), actualizado_por_nombre = new.autor_nombre where id = new.item_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_minuta_act_autor on public.minuta_actualizaciones;
create trigger trg_minuta_act_autor before insert on public.minuta_actualizaciones
  for each row execute function public.minuta_act_autor();

-- ── Permisos ─────────────────────────────────────────────────────────────
alter table public.minuta_tableros enable row level security;
alter table public.minuta_items enable row level security;
alter table public.minuta_actualizaciones enable row level security;

drop policy if exists minuta_tab_lee on public.minuta_tableros;
create policy minuta_tab_lee on public.minuta_tableros for select to authenticated using ((select public.ve_minutas()));
drop policy if exists minuta_tab_admin on public.minuta_tableros;
create policy minuta_tab_admin on public.minuta_tableros for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

drop policy if exists minuta_items_lee on public.minuta_items;
create policy minuta_items_lee on public.minuta_items for select to authenticated using ((select public.ve_minutas()));
drop policy if exists minuta_items_alta on public.minuta_items;
create policy minuta_items_alta on public.minuta_items for insert to authenticated with check ((select public.edita_minutas()));
drop policy if exists minuta_items_cambia on public.minuta_items;
create policy minuta_items_cambia on public.minuta_items for update to authenticated
  using ((select public.edita_minutas())) with check ((select public.edita_minutas()));
drop policy if exists minuta_items_borra on public.minuta_items;
create policy minuta_items_borra on public.minuta_items for delete to authenticated
  using ((select public.es_admin()) or creado_por = (select auth.uid()));

drop policy if exists minuta_act_lee on public.minuta_actualizaciones;
create policy minuta_act_lee on public.minuta_actualizaciones for select to authenticated using ((select public.ve_minutas()));
drop policy if exists minuta_act_alta on public.minuta_actualizaciones;
create policy minuta_act_alta on public.minuta_actualizaciones for insert to authenticated
  with check ((select public.edita_minutas()) and tipo = 'comentario' and autor_id = (select auth.uid()));
drop policy if exists minuta_act_borra on public.minuta_actualizaciones;
create policy minuta_act_borra on public.minuta_actualizaciones for delete to authenticated
  using ((select public.es_admin()) or (tipo = 'comentario' and autor_id = (select auth.uid())));

grant select, insert, update, delete on public.minuta_tableros, public.minuta_items, public.minuta_actualizaciones to authenticated;

-- El tablero que venía de Monday
insert into public.minuta_tableros (nombre, descripcion, orden)
values ('Minuta COPAC Obras - Taller - Compras', 'Comité semanal de obras, taller y compras (antes en Monday)', 1)
on conflict (nombre) do nothing;

select 'ok' as listo;

-- ── REVERTIR ─────────────────────────────────────────────────────────────
-- drop table if exists public.minuta_actualizaciones;
-- drop table if exists public.minuta_items;
-- drop table if exists public.minuta_tableros;
-- drop function if exists public.minuta_items_auditar(), public.minuta_act_autor(), public.ve_minutas(), public.edita_minutas(), public.mi_nombre();
