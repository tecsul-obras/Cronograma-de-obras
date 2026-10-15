-- =========================================================================
-- 41_receso_flota_desde_parte.sql · v20261015a  (Parte diario → Flota)
--
-- 1) RECESO — nueva opción en "Actividad del día". Con Receso las horas
--    hombre van en 0 aunque el operador haya cargado inicio y fin de turno:
--      · horas_hombre (calculada por la base) → 0
--      · horas_hombre_reportada (la que manda la app) → 0
--    La app ya lo corrige antes de enviar; la base lo fuerza igual por si
--    el parte llega de otro lado o se edita después.
--    Los ítems de obra ya se ocultan solos (solo aparecen con "Con Actividad").
--
-- 2) UBICACIÓN POR OBRA — nueva columna obras.ubicacion (de cat_ubicaciones).
--    Se completa en Parte diario › Administración › Catálogos › Obras.
--
-- 3) FLOTA SE ACTUALIZA CON EL PARTE — al entrar (o editarse) el parte MÁS
--    RECIENTE de un equipo:
--      · equipos.operador_habitual  ← operador del parte
--        (no con "Sin operador…": ahí el operador del parte no maneja la máquina)
--      · equipo_estado.ubicacion    ← ubicación de la obra del parte
--        (si la obra no tiene ubicación cargada, no se toca)
--    Un parte atrasado (hay otro del mismo equipo con fecha/turno posterior)
--    no pisa nada. El cambio de ubicación queda en el historial de Flota con
--    origen "parte".
--
-- 4) flota_sincronizar_desde_partes() — aplica la regla 3 de una vez a todos
--    los equipos con su último parte (para después de cargar las ubicaciones).
--
-- Para volver atrás: el bloque REVERTIR del final.
-- =========================================================================

-- ── 1) Receso ────────────────────────────────────────────────────────────
update public.form_campos
   set opciones = opciones || '["Receso"]'::jsonb
 where clave = 'actividad_dia'
   and jsonb_typeof(opciones) = 'array'
   and not opciones ? 'Receso';

alter table public.partes
  alter column horas_hombre set expression as (
    CASE
      WHEN actividad_dia = 'Receso' THEN 0::numeric
      WHEN inicio_turno IS NULL OR fin_turno IS NULL THEN NULL::numeric
      ELSE GREATEST(round(EXTRACT(epoch FROM (fin_turno - inicio_turno)) / 3600.0 - 1::numeric, 2), 0::numeric)
    END);

create or replace function public.fn_parte_receso()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.actividad_dia = 'Receso' then
    new.horas_hombre_reportada := 0;
  end if;
  return new;
end $$;

drop trigger if exists trg_parte_receso on public.partes;
create trigger trg_parte_receso
  before insert or update of actividad_dia, horas_hombre_reportada on public.partes
  for each row execute function public.fn_parte_receso();

-- ── 2) Ubicación por obra ────────────────────────────────────────────────
alter table public.obras
  add column if not exists ubicacion text
  references public.cat_ubicaciones(nombre) on update cascade on delete set null;

-- ── 3) Flota se actualiza con el parte más reciente ──────────────────────
create or replace function public.flota_aplicar_parte(p_parte uuid)
returns void language plpgsql security definer set search_path = public as $$
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
    perform set_config('flota.origen', 'parte', true);
    perform set_config('flota.parte_id', p.id::text, true);
    insert into public.equipo_estado (equipo_id, ubicacion) values (p.equipo_id, ubic)
    on conflict (equipo_id) do update set ubicacion = excluded.ubicacion
      where public.equipo_estado.ubicacion is distinct from excluded.ubicacion;
    perform set_config('flota.origen', '', true);
    perform set_config('flota.parte_id', '', true);
  end if;
end $$;

create or replace function public.fn_parte_actualiza_flota()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.flota_aplicar_parte(new.id);
  return new;
end $$;

drop trigger if exists trg_parte_actualiza_flota on public.partes;
create trigger trg_parte_actualiza_flota
  after insert or update of equipo_id, operador_cedula, obra_clave, fecha, fin_turno, actividad_dia
  on public.partes
  for each row execute function public.fn_parte_actualiza_flota();

-- ── 4) Aplicar a todos los equipos de una vez ────────────────────────────
-- Uso (después de cargar las ubicaciones de las obras):
--   select public.flota_sincronizar_desde_partes();
create or replace function public.flota_sincronizar_desde_partes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  -- Desde el SQL Editor (sin usuario) se permite; desde la app, solo admin central
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo administración central';
  end if;
  for r in
    select distinct on (equipo_id) id from public.partes
     where equipo_id is not null
     order by equipo_id, fecha desc, coalesce(fin_turno, creado_en) desc
  loop
    perform public.flota_aplicar_parte(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.flota_aplicar_parte(uuid) from public, anon, authenticated;
revoke all on function public.flota_sincronizar_desde_partes() from public, anon;
grant execute on function public.flota_sincronizar_desde_partes() to authenticated;

-- ── Sugerencia: ubicaciones de las obras con una ubicación clara ─────────
-- Sacadas de dónde están hoy los equipos asignados a cada obra. Solo se
-- completan las obras que todavía no tienen ubicación. Las que tienen
-- equipos repartidos (Ruta de la Leche, Chaco Sur, CCC-Tecsul) quedan
-- para cargar a mano en Administración › Catálogos › Obras.
update public.obras o set ubicacion = s.ubic
  from (values
    ('1011700000_CONSORCIO CT VIAL',                  'Minga Guazú'),
    ('1012500000_OBRA RUTA DE LA BANANA LOTE 2',       'Tembiaporá'),
    ('1012700000_SAN JUAN MISIONES LOTE 3',            'Misiones'),
    ('1080100000_ARBOREA HILLS',                       'San Ber'),
    ('2090700000_CECON PROYECTO CLOACAL Y PLUVIAL',    'Limpio'),
    ('2240100000_FRIGORIFICO CRUZMONTE',               'Valenzuela')
  ) as s(clave, ubic)
 where o.clave = s.clave and o.ubicacion is null
   and exists (select 1 from public.cat_ubicaciones u where u.nombre = s.ubic);

-- Verificación rápida
select clave, ubicacion from public.obras where ubicacion is not null order by clave;

-- =========================================================================
-- REVERTIR (ejecutar solo si hay que volver atrás)
-- -------------------------------------------------------------------------
-- drop trigger if exists trg_parte_actualiza_flota on public.partes;
-- drop function if exists public.fn_parte_actualiza_flota();
-- drop function if exists public.flota_sincronizar_desde_partes();
-- drop function if exists public.flota_aplicar_parte(uuid);
-- drop trigger if exists trg_parte_receso on public.partes;
-- drop function if exists public.fn_parte_receso();
-- alter table public.partes alter column horas_hombre set expression as (
--   CASE WHEN inicio_turno IS NULL OR fin_turno IS NULL THEN NULL::numeric
--   ELSE GREATEST(round(EXTRACT(epoch FROM (fin_turno - inicio_turno)) / 3600.0 - 1::numeric, 2), 0::numeric) END);
-- alter table public.obras drop column if exists ubicacion;
-- update public.form_campos set opciones = opciones - 'Receso' where clave = 'actividad_dia';
-- =========================================================================
