-- ══════════════════════════════════════════════════════════════════
-- 62 · Accesorios enganchados a equipos (equipos-v65, 27/10/2026)
--
-- Una rastra, un semi, una plancha, un martillete… se "engancha" a un
-- equipo principal (tractor, tracto camión, excavadora…):
--   · equipos.enganchado_a = código del equipo principal (o vacío = suelto).
--   · Un accesorio tiene UN principal; un principal puede tener varios
--     accesorios. Un equipo que tiene accesorios no puede engancharse a
--     otro, y un accesorio no puede tener accesorios (sin cadenas).
--   · Cada enganche / desenganche queda en `equipo_enganche_historial`.
--   · Lo cambian taller y admin central (la misma regla que el resto de la
--     ficha del equipo). Se ve en Flota: columna "Enganchado a", chip 🔗 en
--     las tarjetas y en la ficha (Estado) con los accesorios del equipo.
--
-- Se corre una vez en el SQL Editor. No borra nada.
-- ══════════════════════════════════════════════════════════════════

alter table public.equipos
  add column if not exists enganchado_a text references public.equipos(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipos_enganche_no_propio') then
    alter table public.equipos add constraint equipos_enganche_no_propio check (enganchado_a is distinct from id);
  end if;
end $$;

create index if not exists equipos_enganchado_a on public.equipos (enganchado_a) where enganchado_a is not null;

-- Sin cadenas: ni el principal es accesorio de otro, ni el accesorio tiene accesorios.
create or replace function public.fn_equipo_enganche_valida()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.enganchado_a is null or new.enganchado_a is not distinct from old.enganchado_a then
    return new;
  end if;
  if exists (select 1 from equipos where id = new.enganchado_a and enganchado_a is not null) then
    raise exception 'ENGANCHE: % ya está enganchado a otro equipo; un accesorio no puede llevar accesorios.', new.enganchado_a;
  end if;
  if exists (select 1 from equipos where enganchado_a = new.id) then
    raise exception 'ENGANCHE: % tiene accesorios enganchados; soltalos antes de engancharlo a otro equipo.', new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_equipo_enganche_valida on public.equipos;
create trigger trg_equipo_enganche_valida
  before update of enganchado_a on public.equipos
  for each row execute function public.fn_equipo_enganche_valida();

-- ── Historial ──
create table if not exists public.equipo_enganche_historial (
  id               bigserial primary key,
  equipo_id        text not null references public.equipos(id) on delete cascade,   -- el accesorio
  principal_antes  text,
  principal_despues text,
  usuario_id       uuid default auth.uid(),
  momento          timestamptz not null default now()
);
create index if not exists equipo_enganche_historial_eq on public.equipo_enganche_historial (equipo_id, momento desc);
create index if not exists equipo_enganche_historial_pr on public.equipo_enganche_historial (principal_despues, momento desc);

alter table public.equipo_enganche_historial enable row level security;
drop policy if exists enganche_historial_lectura on public.equipo_enganche_historial;
create policy enganche_historial_lectura on public.equipo_enganche_historial
  for select using ((select public.ve_flota()));
grant select on public.equipo_enganche_historial to authenticated;

create or replace function public.fn_equipo_enganche_historial()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.enganchado_a is distinct from old.enganchado_a then
    insert into equipo_enganche_historial (equipo_id, principal_antes, principal_despues, usuario_id)
    values (new.id, old.enganchado_a, new.enganchado_a, auth.uid());
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_equipo_enganche_historial on public.equipos;
create trigger trg_equipo_enganche_historial
  after update of enganchado_a on public.equipos
  for each row execute function public.fn_equipo_enganche_historial();

-- Comprobación
select (select count(*) from information_schema.columns
         where table_name = 'equipos' and column_name = 'enganchado_a') as columna_ok,
       (select count(*) from pg_trigger
         where tgname in ('trg_equipo_enganche_valida', 'trg_equipo_enganche_historial')) as triggers_ok;
