-- ══════════════════════════════════════════════════════════════════
-- 61 · Avisos de operador en Flota (equipos-v65, 27/10/2026)
--
--   1. Cada vez que cambia el operador habitual de una máquina queda un
--      registro en `equipo_operador_cambios` (quién, cuándo, antes/después
--      y si vino de un parte o de la app). El cambio por parte ya existía
--      (flota_aplicar_parte): ahora además deja aviso.
--   2. `v_avisos_operador`: lo que muestra Flota › Alertas y la tabla:
--        · "Operador en varias máquinas": el mismo operador habitual en 2+
--          máquinas activas.
--        · "Cambio de operador": cambios de los últimos 15 días que nadie
--          marcó como vistos.
--   3. `operador_cambios_marcar_vistos(ids)`: el botón "Visto".
--
-- Es una vista aparte de v_alertas_flota a propósito: los avisos por correo
-- y Power BI que leen v_alertas_flota no cambian.
-- Se corre una vez en el SQL Editor. No borra nada.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Registro de cambios ──
create table if not exists public.equipo_operador_cambios (
  id               bigserial primary key,
  equipo_id        text not null references public.equipos(id) on delete cascade,
  operador_antes   text,
  operador_despues text,
  origen           text not null default 'app',      -- app | parte | sistema
  parte_id         uuid,
  usuario_id       uuid default auth.uid(),
  momento          timestamptz not null default now(),
  visto_en         timestamptz,
  visto_por        uuid
);
create index if not exists equipo_operador_cambios_momento on public.equipo_operador_cambios (momento desc);
create index if not exists equipo_operador_cambios_equipo  on public.equipo_operador_cambios (equipo_id, momento desc);

alter table public.equipo_operador_cambios enable row level security;
drop policy if exists operador_cambios_lectura on public.equipo_operador_cambios;
create policy operador_cambios_lectura on public.equipo_operador_cambios
  for select using ((select public.ve_flota()) or (select public.mi_rol())::text = 'gerente');   -- el gerente ve las Alertas
-- Las escrituras las hacen el trigger y la función de "visto" (security definer).
grant select on public.equipo_operador_cambios to authenticated;

create or replace function public.fn_equipo_operador_cambio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.operador_habitual is distinct from old.operador_habitual then
    insert into equipo_operador_cambios (equipo_id, operador_antes, operador_despues, origen, parte_id, usuario_id)
    values (new.id, old.operador_habitual, new.operador_habitual,
            coalesce(nullif(current_setting('flota.origen', true), ''),
                     case when auth.uid() is null then 'sistema' else 'app' end),
            nullif(current_setting('flota.parte_id', true), '')::uuid,
            auth.uid());
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_equipo_operador_cambio on public.equipos;
create trigger trg_equipo_operador_cambio
  after update of operador_habitual on public.equipos
  for each row execute function public.fn_equipo_operador_cambio();

-- El parte marca su origen ANTES de cambiar el operador (antes solo lo
-- hacía para la ubicación), así el aviso dice "desde parte".
create or replace function public.flota_aplicar_parte(p_parte uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p    public.partes%rowtype;
  ubic text;
begin
  select * into p from public.partes where id = p_parte;
  if not found or p.equipo_id is null then return; end if;

  -- ¿Es el último parte del equipo? (por fecha y, el mismo día, por fin de turno)
  if exists (select 1 from public.partes o
              where o.equipo_id = p.equipo_id and o.id <> p.id
                and (o.fecha > p.fecha
                     or (o.fecha = p.fecha and coalesce(o.fin_turno, o.creado_en)
                                             > coalesce(p.fin_turno, p.creado_en)))) then
    return;
  end if;

  perform set_config('flota.origen', 'parte', true);
  perform set_config('flota.parte_id', p.id::text, true);

  -- Operador habitual
  if p.operador_cedula is not null
     and coalesce(p.actividad_dia, '') not ilike 'Sin operador%'
     and exists (select 1 from public.operadores where cedula = p.operador_cedula) then
    update public.equipos set operador_habitual = p.operador_cedula
     where id = p.equipo_id and operador_habitual is distinct from p.operador_cedula;
  end if;

  -- Ubicación según la obra
  select ubicacion into ubic from public.obras where clave = p.obra_clave;
  if ubic is not null then
    insert into public.equipo_estado (equipo_id, ubicacion) values (p.equipo_id, ubic)
    on conflict (equipo_id) do update set ubicacion = excluded.ubicacion
      where public.equipo_estado.ubicacion is distinct from excluded.ubicacion;
  end if;

  perform set_config('flota.origen', '', true);
  perform set_config('flota.parte_id', '', true);
end $function$;

-- ── 2. Avisos ──
create or replace view public.v_avisos_operador
with (security_invoker = true) as
with varias as (
  select e.operador_habitual as cedula,
         array_agg(e.id order by e.id) as equipos
    from public.equipos e
   where e.activo and e.operador_habitual is not null
   group by e.operador_habitual
  having count(*) > 1
)
select 'Operador en varias máquinas'::text as tipo,
       e.id as equipo_id,
       null::date as vence,
       null::integer as dias,
       'AVISO'::text as nivel,
       coalesce(o.nombre, v.cedula) || ' también figura como operador de '
         || array_to_string(array_remove(v.equipos, e.id), ', ') as detalle,
       null::bigint as cambio_id,
       v.cedula as operador,
       null::timestamptz as momento
  from varias v
  join public.equipos e on e.operador_habitual = v.cedula and e.activo
  left join public.operadores o on o.cedula = v.cedula
union all
select 'Cambio de operador',
       c.equipo_id,
       c.momento::date,
       c.momento::date - current_date,
       'AVISO',
       concat_ws(' ',
         coalesce(oa.nombre, c.operador_antes, '(sin operador)'), '→',
         coalesce(od.nombre, c.operador_despues, '(sin operador)'),
         case c.origen when 'parte' then '· por el parte diario'
                       when 'app'   then '· cambiado en Flota' else '' end),
       c.id,
       c.operador_despues,
       c.momento
  from public.equipo_operador_cambios c
  left join public.operadores oa on oa.cedula = c.operador_antes
  left join public.operadores od on od.cedula = c.operador_despues
 where c.visto_en is null
   and c.momento >= now() - interval '15 days';

grant select on public.v_avisos_operador to authenticated;

-- ── 3. Marcar como visto ──
create or replace function public.operador_cambios_marcar_vistos(p_ids bigint[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if not coalesce(public.ve_flota(), false) then
    raise exception 'Sin permiso para marcar avisos de flota.';
  end if;
  update equipo_operador_cambios
     set visto_en = now(), visto_por = auth.uid()
   where id = any (p_ids) and visto_en is null;
  get diagnostics n = row_count;
  return n;
end;
$function$;
grant execute on function public.operador_cambios_marcar_vistos(bigint[]) to authenticated;

-- Comprobación
select (select count(*) from public.v_avisos_operador where tipo = 'Operador en varias máquinas') as maquinas_con_operador_repetido,
       (select count(*) from pg_trigger where tgname = 'trg_equipo_operador_cambio') as trigger_ok;
