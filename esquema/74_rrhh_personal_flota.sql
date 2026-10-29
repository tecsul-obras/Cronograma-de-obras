-- =========================================================================
-- 74_rrhh_personal_flota.sql · Personal único RRHH ↔ Flota (29/10/2026)
--
-- Una sola lista de personas: la de Flota › Personal (tabla operadores), que
-- es la que usan los partes, las OT, los responsables y los técnicos.
-- RRHH › Personal (rrhh_personal) queda como su parte privada (categoría,
-- salario, viático, precio de la hora, IPS), unida por la cédula.
--
-- Regla decidida por José (29/10/2026): el NOMBRE vale el de RRHH.
--   · Cada vez que RRHH guarda una planilla o corrige a alguien en el legajo,
--     el nombre pasa a Flota (operadores) y a su usuario de la app (perfiles).
--   · Si la cédula no existe en Flota, se da de alta ahí (activo), con la
--     especialidad sacada de la categoría / cargo y el cargo de RRHH.
--   · Las BAJAS no se pasan por ahora (todos siguen activos en Flota hasta
--     que José revise la lista de los que no están en la planilla).
--   · Se limpian puntos sueltos y espacios del nombre («BOGADO, WUALTER .»
--     → «BOGADO, WUALTER»), también en RRHH.
--
-- Al correrlo se aplica a las 138 personas ya cargadas: 33 nombres de Flota
-- cambian al de RRHH y 12 personas se dan de alta en Flota.
-- No borra nada. Se puede correr más de una vez.
-- =========================================================================

-- ── 1) Nombre limpio ─────────────────────────────────────────────────────
create or replace function public.rrhh_nombre_limpio(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(
           regexp_replace(                                   -- espacios repetidos
             regexp_replace(                                 -- «OTAZU. VICTOR» → «OTAZU, VICTOR»
               regexp_replace(                               -- espacio antes de coma y coma sin espacio
                 regexp_replace(coalesce(p, ''), '[\s.]+$', ''),   -- puntos y espacios al final
               '\s*,\s*', ', ', 'g'),
             '^([^,.]+)\.\s+', '\1, '),
           '\s{2,}', ' ', 'g')), '')
$$;

-- ── 2) Especialidad de Flota a partir de la categoría / cargo de RRHH ────
-- sin depender de la extensión unaccent
create or replace function public.unaccent_simple(p text)
returns text language sql immutable set search_path = public as $$
  select translate(coalesce(p, ''), 'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN')
$$;

create or replace function public.rrhh_especialidad(p_categoria text, p_cargo text)
returns text language sql immutable set search_path = public as $$
  select case
    when unaccent_simple(coalesce(p_cargo, '')) ~* 'electric'                  then 'ELECTRICISTA'
    when unaccent_simple(coalesce(p_cargo, '') || ' ' || coalesce(p_categoria, '')) ~* 'gomero' then 'GOMERO'
    when unaccent_simple(coalesce(p_cargo, '')) ~* 'ayudante.*(mecanic|taller)' then 'AYUDANTE MECANICO'
    when unaccent_simple(coalesce(p_categoria, '')) ~* '^mecanico\s+([a-e])'
      then 'MECANICO ' || upper(substring(unaccent_simple(p_categoria) from '(?i)^mecanico\s+([a-e])'))
    when unaccent_simple(coalesce(p_categoria, '') || ' ' || coalesce(p_cargo, '')) ~* 'mecanic' then 'MECANICO'
    when unaccent_simple(coalesce(p_categoria, '') || ' ' || coalesce(p_cargo, '')) ~* 'chofer|operador|oeprador' then 'OPERADOR'
    else 'OTRO'
  end
$$;
-- ── 3) RRHH → Flota ──────────────────────────────────────────────────────
create or replace function public.fn_rrhh_personal_a_flota()
returns trigger language plpgsql security definer set search_path = public as $$
declare nom text := rrhh_nombre_limpio(new.nombre);
begin
  if nom is null then return new; end if;
  if exists (select 1 from operadores where cedula = new.cedula) then
    update operadores set nombre = nom where cedula = new.cedula and nombre is distinct from nom;
  else
    insert into operadores (cedula, nombre, activo, especialidad, cargo)
    values (new.cedula, nom, true, rrhh_especialidad(new.categoria, new.cargo), new.cargo);
  end if;
  update perfiles set nombre = nom where cedula = new.cedula and nombre is distinct from nom;
  return new;
end $$;

-- el nombre de RRHH también se guarda limpio
create or replace function public.fn_rrhh_personal_limpiar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.nombre := coalesce(rrhh_nombre_limpio(new.nombre), new.nombre);
  return new;
end $$;

drop trigger if exists trg_rrhh_personal_limpiar on public.rrhh_personal;
create trigger trg_rrhh_personal_limpiar before insert or update of nombre on public.rrhh_personal
  for each row execute function public.fn_rrhh_personal_limpiar();
drop trigger if exists trg_rrhh_personal_a_flota on public.rrhh_personal;
create trigger trg_rrhh_personal_a_flota after insert or update of nombre, cargo, categoria on public.rrhh_personal
  for each row execute function public.fn_rrhh_personal_a_flota();

-- ── 4) Aplicar a lo que ya está cargado ──────────────────────────────────
update public.rrhh_personal set nombre = nombre;   -- dispara la limpieza y el paso a Flota

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from public.rrhh_personal r where not exists (select 1 from public.operadores o where o.cedula = r.cedula))  as rrhh_sin_flota_0,
  (select count(*) from public.rrhh_personal r join public.operadores o on o.cedula = r.cedula where o.nombre <> r.nombre)      as nombres_distintos_0,
  (select count(*) from public.operadores o where o.activo and not exists (select 1 from public.rrhh_personal r where r.cedula = o.cedula)) as flota_sin_rrhh,
  (select count(*) from public.rrhh_personal where nombre ~ '[\s.]$')                                                     as nombres_con_punto_0;

-- =========================================================================
-- VOLVER ATRÁS (los nombres ya cambiados no vuelven solos)
-- drop trigger if exists trg_rrhh_personal_a_flota on public.rrhh_personal;
-- drop trigger if exists trg_rrhh_personal_limpiar on public.rrhh_personal;
-- =========================================================================
