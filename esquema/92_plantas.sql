-- ═══════════════════════════════════════════════════════════════════════════
-- 92 · PLANTAS (asfalto, hormigón, suelo) · equipos-v91 · 05/11/2026 (rev. b: parte de báscula)
--
-- Control diario de las plantas PA-01, PA-02, PH-01 y PS-01:
--   · Parte de planta (lo cargan los operadores y el encargado de cada planta):
--     arranque, lectura cada hora (contador del SCADA + regla de cada tanque),
--     paradas con causa y cierre con la producción de BÁSCULA (la oficial).
--   · Parte de báscula: un renglón por ticket (chapa, bruto, tara, neto, obra);
--     lo carga el operador de báscula (rol «bascula» en planta_personal), el
--     encargado o los operadores, y se ve en vivo. Suma la producción oficial.
--   · Recargas de tanques (CAP: solo admin de obra / admin central; fuel y
--     gasoil: también el encargado).
--   · Tablas de aforo por tanque: cilindro horizontal (Ø y largo, igual que la
--     planilla cilindro_vol.xlsx), cilindro vertical o tabla pegada (altura → L).
--     La regla se lee «libre» (vacío desde arriba) o «stock» (altura de líquido).
--     El CAP se pasa a toneladas con la densidad de referencia del tanque
--     (se lee a 150 °C).
--   · En vivo: las tablas de lecturas, paradas, jornadas y recargas van a
--     Supabase Realtime (la pantalla se actualiza sola).
--
-- Quién (planta_rol): admin central = admin (configura todo) · encargado y
-- operador de ESA planta (planta_personal, por cédula) = cargan el parte ·
-- admin de obra = ve y carga recargas · gerente, taller y gerente/admin de
-- Obras = ven. Nadie más ve nada (RLS).
--
-- Se puede correr dos veces. No borra ni toca nada existente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Tablas de configuración ─────────────────────────────────────────────
create table if not exists public.plantas (
  id               text primary key references public.equipos(id) on update cascade,
  tipo             text not null check (tipo in ('asfalto', 'hormigon', 'suelo')),
  nombre           text,
  unidad           text not null default 't' check (unidad in ('t', 'm3')),
  caudal_nominal   numeric check (caudal_nominal is null or caudal_nominal > 0),   -- t/h o m³/h
  tarifa_planta    numeric check (tarifa_planta is null or tarifa_planta >= 0),     -- amortización por unidad producida (fase 2: costos)
  tarifa_moneda    text not null default 'USD' check (tarifa_moneda in ('USD', 'Gs')),
  config           jsonb not null default '{}'::jsonb,   -- tol_cap, lt_max, lectura_min, alerta_sin_lectura_min, causas
  activo           boolean not null default true,
  notas            text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid default auth.uid()
);

create table if not exists public.planta_tanques (
  id           bigserial primary key,
  planta_id    text not null references public.plantas(id) on update cascade on delete cascade,
  nombre       text not null,
  insumo       text not null check (insumo in ('cap', 'fuel', 'gasoil', 'cemento', 'agua', 'aditivo', 'otro')),
  modo_lectura text not null default 'stock' check (modo_lectura in ('libre', 'stock')),
  forma        text not null default 'cilindro_h' check (forma in ('cilindro_h', 'cilindro_v', 'tabla')),
  diametro_m   numeric check (diametro_m is null or diametro_m > 0),
  largo_m      numeric check (largo_m is null or largo_m > 0),     -- cilindro horizontal: largo
  altura_m     numeric check (altura_m is null or altura_m > 0),   -- cilindro vertical o tabla: altura total (para «libre»)
  tabla        jsonb,                                              -- [[altura_m, litros], …] ordenada
  densidad     numeric check (densidad is null or densidad > 0),   -- t/m³ (CAP: densidad de referencia)
  orden        integer not null default 0,
  activo       boolean not null default true,
  notas        text,
  actualizado_en timestamptz not null default now()
);
create index if not exists planta_tanques_planta on public.planta_tanques (planta_id, orden);

create table if not exists public.planta_formulas (
  id          bigserial primary key,
  planta_id   text not null references public.plantas(id) on update cascade on delete cascade,
  nombre      text not null,
  pct_cap     numeric check (pct_cap is null or (pct_cap >= 0 and pct_cap <= 20)),   -- % de CAP de la fórmula
  tol_cap     numeric check (tol_cap is null or tol_cap >= 0),                       -- ± puntos (vacío = el de la planta)
  notas       text,
  activo      boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.planta_personal (
  planta_id  text not null references public.plantas(id) on update cascade on delete cascade,
  cedula     text not null references public.operadores(cedula) on update cascade,
  rol        text not null default 'operador' check (rol in ('encargado', 'operador', 'bascula')),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  primary key (planta_id, cedula)
);
-- (si la tabla ya existía de antes, que acepte también el rol «bascula»)
alter table public.planta_personal drop constraint if exists planta_personal_rol_check;
alter table public.planta_personal add constraint planta_personal_rol_check check (rol in ('encargado', 'operador', 'bascula'));

-- ── 2) Tablas del día a día ────────────────────────────────────────────────
create table if not exists public.planta_jornadas (
  id              uuid primary key default gen_random_uuid(),   -- el celular lo genera (sin señal no se duplica)
  planta_id       text not null references public.plantas(id) on update cascade,
  fecha           date not null,
  turno           integer not null default 1 check (turno between 1 and 3),
  obra_clave      text references public.obras(clave) on update cascade,
  formula_id      bigint references public.planta_formulas(id) on delete set null,
  estado          text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  inicio          timestamptz,
  fin             timestamptz,
  bascula_t       numeric check (bascula_t is null or bascula_t >= 0),      -- producción oficial (báscula)
  bascula_viajes  integer check (bascula_viajes is null or bascula_viajes >= 0),
  scada_t         numeric check (scada_t is null or scada_t >= 0),          -- total del SCADA al cierre
  scada_cap_t     numeric check (scada_cap_t is null or scada_cap_t >= 0),
  scada_filler_t  numeric check (scada_filler_t is null or scada_filler_t >= 0),
  fotos           text[] not null default '{}',                             -- rutas en el bucket «plantas»
  observaciones   text,
  creado_por      uuid default auth.uid(),
  creado_en       timestamptz not null default now(),
  editado_por     uuid,
  editado_en      timestamptz,
  cerrado_por     uuid,
  cerrado_en      timestamptz,
  unique (planta_id, fecha, turno)
);
create index if not exists planta_jornadas_fecha on public.planta_jornadas (planta_id, fecha desc);

create table if not exists public.planta_lecturas (
  id           uuid primary key,
  jornada_id   uuid not null references public.planta_jornadas(id) on delete cascade,
  planta_id    text not null references public.plantas(id) on update cascade,
  hora         timestamptz not null,
  tipo         text not null default 'hora' check (tipo in ('inicio', 'hora', 'cierre')),
  contador_t   numeric check (contador_t is null or contador_t >= 0),     -- «Producción planta» del SCADA (acumulado)
  scada_cap_t  numeric check (scada_cap_t is null or scada_cap_t >= 0),   -- CAP acumulado del SCADA (opcional)
  valores      jsonb not null default '{}'::jsonb,   -- {"<tanque_id>": {"r": regla_m, "l": litros}}
  observaciones text,
  creado_por   uuid default auth.uid(),
  creado_en    timestamptz not null default now(),
  editado_por  uuid,
  editado_en   timestamptz
);
create index if not exists planta_lecturas_jornada on public.planta_lecturas (jornada_id, hora);
create index if not exists planta_lecturas_planta on public.planta_lecturas (planta_id, hora desc);

create table if not exists public.planta_paradas (
  id          uuid primary key,
  jornada_id  uuid not null references public.planta_jornadas(id) on delete cascade,
  planta_id   text not null references public.plantas(id) on update cascade,
  desde       timestamptz not null,
  hasta       timestamptz,
  causa       text not null,
  detalle     text,
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);
create index if not exists planta_paradas_jornada on public.planta_paradas (jornada_id, desde);

create table if not exists public.planta_recargas (
  id          uuid primary key default gen_random_uuid(),
  planta_id   text not null references public.plantas(id) on update cascade,
  tanque_id   bigint not null references public.planta_tanques(id),
  fecha_hora  timestamptz not null,
  cantidad    numeric not null check (cantidad > 0),
  unidad      text not null default 'L' check (unidad in ('L', 't')),
  remito      text,
  proveedor   text,
  fotos       text[] not null default '{}',
  observaciones text,
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists planta_recargas_tanque on public.planta_recargas (tanque_id, fecha_hora);

-- Parte de báscula: un renglón por ticket (camión que sale de la planta)
create table if not exists public.planta_pesadas (
  id           uuid primary key,                      -- el celular lo genera (sin señal no se duplica)
  planta_id    text not null references public.plantas(id) on update cascade,
  jornada_id   uuid references public.planta_jornadas(id) on delete set null,
  fecha        date not null,
  hora         timestamptz not null,
  ticket       text,
  chapa        text,
  bruto_kg     numeric check (bruto_kg is null or bruto_kg >= 0),
  tara_kg      numeric check (tara_kg is null or tara_kg >= 0),
  neto_t       numeric not null check (neto_t > 0 and neto_t < 80),
  obra_clave   text references public.obras(clave) on update cascade,
  fotos        text[] not null default '{}',
  observaciones text,
  creado_por   uuid default auth.uid(),
  creado_en    timestamptz not null default now(),
  editado_en   timestamptz
);
create index if not exists planta_pesadas_planta on public.planta_pesadas (planta_id, fecha, hora);
create index if not exists planta_pesadas_jornada on public.planta_pesadas (jornada_id);
create index if not exists planta_pesadas_chapa on public.planta_pesadas (planta_id, chapa, hora desc);

-- ── 3) Permisos ─────────────────────────────────────────────────────────────
-- Rol de la persona en una planta: admin | encargado | operador | admin_obra | ver | null
create or replace function public.planta_rol(p_planta text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_central') then 'admin'
    when exists (select 1 from planta_personal pp join perfiles pf on pf.cedula = pp.cedula
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'encargado') then 'encargado'
    when exists (select 1 from planta_personal pp join perfiles pf on pf.cedula = pp.cedula
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'operador') then 'operador'
    when exists (select 1 from planta_personal pp join perfiles pf on pf.cedula = pp.cedula
                  where pf.id = auth.uid() and pf.activo and pp.activo and pp.planta_id = p_planta and pp.rol = 'bascula') then 'bascula'
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra') then 'admin_obra'
    when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text in ('gerente', 'taller')) then 'ver'
    when exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'gerente')) then 'ver'
  end
$$;
revoke all on function public.planta_rol(text) from public;
grant execute on function public.planta_rol(text) to authenticated;

create or replace function public.planta_puede_cargar(p_planta text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.planta_rol(p_planta) in ('admin', 'encargado', 'operador'), false)
$$;
grant execute on function public.planta_puede_cargar(text) to authenticated;

-- Recargas: CAP solo admin de obra y admin central; fuel/gasoil/otros también el encargado
create or replace function public.planta_puede_recargar(p_tanque bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when public.planta_rol(t.planta_id) = 'admin' then true
      when exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra') then true
      when t.insumo <> 'cap' and public.planta_rol(t.planta_id) = 'encargado' then true
      else false end
    from planta_tanques t where t.id = p_tanque), false)
$$;
grant execute on function public.planta_puede_recargar(bigint) to authenticated;

-- Báscula: cargan tickets el operador de báscula, el encargado, los operadores y el admin
create or replace function public.planta_puede_pesar(p_planta text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.planta_rol(p_planta) in ('admin', 'encargado', 'operador', 'bascula'), false)
$$;
grant execute on function public.planta_puede_pesar(text) to authenticated;

create or replace function public.planta_jornada_abierta(p_jornada uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select estado = 'abierta' from planta_jornadas where id = p_jornada), true)
$$;
grant execute on function public.planta_jornada_abierta(uuid) to authenticated;

-- Lo que usa la pantalla al entrar (y el menú para mostrar la solapa)
create or replace function public.plantas_acceso()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'planta', p.id, 'tipo', p.tipo, 'nombre', coalesce(p.nombre, e.descripcion), 'rol', r.rol,
           'recarga_cap', (r.rol = 'admin' or exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra')))
           order by p.id), '[]'::jsonb)
  from plantas p
  join equipos e on e.id = p.id
  cross join lateral (select public.planta_rol(p.id) as rol) r
  where p.activo and r.rol is not null
$$;
revoke all on function public.plantas_acceso() from public;
grant execute on function public.plantas_acceso() to authenticated;

alter table public.plantas          enable row level security;
alter table public.planta_tanques   enable row level security;
alter table public.planta_formulas  enable row level security;
alter table public.planta_personal  enable row level security;
alter table public.planta_jornadas  enable row level security;
alter table public.planta_lecturas  enable row level security;
alter table public.planta_paradas   enable row level security;
alter table public.planta_recargas  enable row level security;
alter table public.planta_pesadas   enable row level security;

-- configuración: ve quien tiene rol en la planta; edita solo admin central
drop policy if exists plantas_ver on public.plantas;
create policy plantas_ver on public.plantas for select to authenticated using (public.planta_rol(id) is not null);
drop policy if exists plantas_admin on public.plantas;
create policy plantas_admin on public.plantas for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists planta_tanques_ver on public.planta_tanques;
create policy planta_tanques_ver on public.planta_tanques for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_tanques_admin on public.planta_tanques;
create policy planta_tanques_admin on public.planta_tanques for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists planta_formulas_ver on public.planta_formulas;
create policy planta_formulas_ver on public.planta_formulas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_formulas_admin on public.planta_formulas;
create policy planta_formulas_admin on public.planta_formulas for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists planta_personal_ver on public.planta_personal;
create policy planta_personal_ver on public.planta_personal for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_personal_admin on public.planta_personal;
create policy planta_personal_admin on public.planta_personal for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- jornadas: cargan encargado y operadores; cerrada solo la corrigen encargado y admin
drop policy if exists planta_jornadas_ver on public.planta_jornadas;
create policy planta_jornadas_ver on public.planta_jornadas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_jornadas_alta on public.planta_jornadas;
create policy planta_jornadas_alta on public.planta_jornadas for insert to authenticated with check (public.planta_puede_cargar(planta_id));
drop policy if exists planta_jornadas_editar on public.planta_jornadas;
create policy planta_jornadas_editar on public.planta_jornadas for update to authenticated
  using (public.planta_puede_cargar(planta_id) and (estado = 'abierta' or public.planta_rol(planta_id) in ('admin', 'encargado')))
  with check (public.planta_puede_cargar(planta_id));
drop policy if exists planta_jornadas_borrar on public.planta_jornadas;
create policy planta_jornadas_borrar on public.planta_jornadas for delete to authenticated using (public.planta_rol(planta_id) in ('admin', 'encargado'));

-- lecturas y paradas: con la jornada abierta cargan todos los de la planta;
-- corregir: el que la cargó (jornada abierta), el encargado o el admin
drop policy if exists planta_lecturas_ver on public.planta_lecturas;
create policy planta_lecturas_ver on public.planta_lecturas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_lecturas_alta on public.planta_lecturas;
create policy planta_lecturas_alta on public.planta_lecturas for insert to authenticated
  with check (public.planta_puede_cargar(planta_id) and (public.planta_jornada_abierta(jornada_id) or public.planta_rol(planta_id) in ('admin', 'encargado')));
drop policy if exists planta_lecturas_editar on public.planta_lecturas;
create policy planta_lecturas_editar on public.planta_lecturas for update to authenticated
  using (public.planta_rol(planta_id) in ('admin', 'encargado') or (creado_por = auth.uid() and public.planta_jornada_abierta(jornada_id)))
  with check (public.planta_puede_cargar(planta_id));
drop policy if exists planta_lecturas_borrar on public.planta_lecturas;
create policy planta_lecturas_borrar on public.planta_lecturas for delete to authenticated
  using (public.planta_rol(planta_id) in ('admin', 'encargado') or (creado_por = auth.uid() and public.planta_jornada_abierta(jornada_id)));

drop policy if exists planta_paradas_ver on public.planta_paradas;
create policy planta_paradas_ver on public.planta_paradas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_paradas_alta on public.planta_paradas;
create policy planta_paradas_alta on public.planta_paradas for insert to authenticated
  with check (public.planta_puede_cargar(planta_id) and (public.planta_jornada_abierta(jornada_id) or public.planta_rol(planta_id) in ('admin', 'encargado')));
drop policy if exists planta_paradas_editar on public.planta_paradas;
create policy planta_paradas_editar on public.planta_paradas for update to authenticated
  using (public.planta_puede_cargar(planta_id) and (public.planta_jornada_abierta(jornada_id) or public.planta_rol(planta_id) in ('admin', 'encargado')))
  with check (public.planta_puede_cargar(planta_id));
drop policy if exists planta_paradas_borrar on public.planta_paradas;
create policy planta_paradas_borrar on public.planta_paradas for delete to authenticated
  using (public.planta_rol(planta_id) in ('admin', 'encargado') or (creado_por = auth.uid() and public.planta_jornada_abierta(jornada_id)));

-- recargas
drop policy if exists planta_recargas_ver on public.planta_recargas;
create policy planta_recargas_ver on public.planta_recargas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_recargas_alta on public.planta_recargas;
create policy planta_recargas_alta on public.planta_recargas for insert to authenticated
  with check (public.planta_puede_recargar(tanque_id)
              and planta_id = (select t.planta_id from public.planta_tanques t where t.id = tanque_id));
drop policy if exists planta_recargas_editar on public.planta_recargas;
create policy planta_recargas_editar on public.planta_recargas for update to authenticated
  using (public.planta_rol(planta_id) = 'admin' or (creado_por = auth.uid() and public.planta_puede_recargar(tanque_id)))
  with check (public.planta_puede_recargar(tanque_id));
drop policy if exists planta_recargas_borrar on public.planta_recargas;
create policy planta_recargas_borrar on public.planta_recargas for delete to authenticated
  using (public.planta_rol(planta_id) = 'admin' or (creado_por = auth.uid() and public.planta_puede_recargar(tanque_id)));

-- pesadas: cargan los de báscula y planta; corrige el que la cargó (48 h), el encargado o el admin
drop policy if exists planta_pesadas_ver on public.planta_pesadas;
create policy planta_pesadas_ver on public.planta_pesadas for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_pesadas_alta on public.planta_pesadas;
create policy planta_pesadas_alta on public.planta_pesadas for insert to authenticated with check (public.planta_puede_pesar(planta_id));
drop policy if exists planta_pesadas_editar on public.planta_pesadas;
create policy planta_pesadas_editar on public.planta_pesadas for update to authenticated
  using (public.planta_rol(planta_id) in ('admin', 'encargado') or (creado_por = auth.uid() and creado_en > now() - interval '48 hours'))
  with check (public.planta_puede_pesar(planta_id));
drop policy if exists planta_pesadas_borrar on public.planta_pesadas;
create policy planta_pesadas_borrar on public.planta_pesadas for delete to authenticated
  using (public.planta_rol(planta_id) in ('admin', 'encargado') or (creado_por = auth.uid() and creado_en > now() - interval '48 hours'));

grant select, insert, update, delete on public.planta_pesadas to authenticated;
grant select, insert, update, delete on public.plantas, public.planta_tanques, public.planta_formulas, public.planta_personal,
  public.planta_jornadas, public.planta_lecturas, public.planta_paradas, public.planta_recargas to authenticated;
grant usage, select on sequence public.planta_tanques_id_seq, public.planta_formulas_id_seq to authenticated;

-- ── 4) Tiempo real (pantalla «En vivo») ─────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['planta_jornadas', 'planta_lecturas', 'planta_paradas', 'planta_recargas', 'planta_pesadas'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 5) Fotos (bucket privado «plantas»: SCADA, remitos) ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('plantas', 'plantas', false, 8388608)
on conflict (id) do nothing;

drop policy if exists plantas_fotos_ver on storage.objects;
create policy plantas_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'plantas' and public.planta_rol(split_part(name, '/', 1)) is not null);
drop policy if exists plantas_fotos_subir on storage.objects;
create policy plantas_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'plantas' and public.planta_rol(split_part(name, '/', 1)) in ('admin', 'encargado', 'operador', 'bascula', 'admin_obra'));
drop policy if exists plantas_fotos_borrar on storage.objects;
create policy plantas_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'plantas' and (owner = auth.uid() or public.planta_rol(split_part(name, '/', 1)) = 'admin'));

-- ── 6) Vistas (resumen por jornada; también para Power BI) ──────────────────
-- Consumo por jornada y tanque = litros de la primera lectura + recargas − litros de la última
create or replace view public.v_planta_consumo_jornada with (security_invoker = true) as
with lim as (
  select j.id as jornada_id, j.planta_id,
         (select l.id from planta_lecturas l where l.jornada_id = j.id order by l.hora asc  limit 1) as l_ini,
         (select l.id from planta_lecturas l where l.jornada_id = j.id order by l.hora desc limit 1) as l_fin
  from planta_jornadas j
)
select lim.jornada_id, lim.planta_id, t.id as tanque_id, t.nombre as tanque, t.insumo, t.densidad,
       li.hora as hora_ini, lf.hora as hora_fin,
       (li.valores -> t.id::text ->> 'l')::numeric as litros_ini,
       (lf.valores -> t.id::text ->> 'l')::numeric as litros_fin,
       coalesce((select sum(case when r.unidad = 't' then r.cantidad / nullif(t.densidad, 0) * 1000 else r.cantidad end)
                 from planta_recargas r
                 where r.tanque_id = t.id and r.fecha_hora > li.hora and r.fecha_hora <= lf.hora), 0) as recargas_l,
       (li.valores -> t.id::text ->> 'l')::numeric
         + coalesce((select sum(case when r.unidad = 't' then r.cantidad / nullif(t.densidad, 0) * 1000 else r.cantidad end)
                     from planta_recargas r
                     where r.tanque_id = t.id and r.fecha_hora > li.hora and r.fecha_hora <= lf.hora), 0)
         - (lf.valores -> t.id::text ->> 'l')::numeric as consumo_l
from lim
join planta_tanques t on t.planta_id = lim.planta_id
join planta_lecturas li on li.id = lim.l_ini
join planta_lecturas lf on lf.id = lim.l_fin
where lim.l_ini <> lim.l_fin;

create or replace view public.v_powerbi_plantas_jornadas with (security_invoker = true) as
select j.id as jornada_id, j.planta_id, p.tipo, j.fecha, j.turno, j.obra_clave, o.nombre as obra, f.nombre as formula, f.pct_cap as pct_cap_formula,
       j.estado, j.inicio, j.fin,
       round(extract(epoch from (j.fin - j.inicio)) / 3600.0, 2) as horas_jornada,
       round(coalesce((select sum(extract(epoch from (coalesce(pa.hasta, j.fin) - pa.desde))) from planta_paradas pa where pa.jornada_id = j.id), 0) / 3600.0, 2) as horas_parada,
       j.bascula_t, j.bascula_viajes, j.scada_t, j.scada_cap_t, j.scada_filler_t,
       (select max(l.contador_t) - min(l.contador_t) from planta_lecturas l where l.jornada_id = j.id) as contador_t,
       (select sum(c.consumo_l) from v_planta_consumo_jornada c where c.jornada_id = j.id and c.insumo = 'cap') as cap_l,
       (select sum(c.consumo_l * c.densidad / 1000) from v_planta_consumo_jornada c where c.jornada_id = j.id and c.insumo = 'cap') as cap_t,
       (select sum(c.consumo_l) from v_planta_consumo_jornada c where c.jornada_id = j.id and c.insumo = 'fuel') as fuel_l,
       (select sum(c.consumo_l) from v_planta_consumo_jornada c where c.jornada_id = j.id and c.insumo = 'gasoil') as gasoil_l,
       (select sum(pe.neto_t) from planta_pesadas pe where pe.jornada_id = j.id) as pesadas_t,
       (select count(*) from planta_pesadas pe where pe.jornada_id = j.id) as pesadas_viajes
from planta_jornadas j
join plantas p on p.id = j.planta_id
left join obras o on o.clave = j.obra_clave
left join planta_formulas f on f.id = j.formula_id;

-- Un renglón por ticket de báscula (Power BI / control con Transporte)
create or replace view public.v_powerbi_plantas_pesadas with (security_invoker = true) as
select pe.id, pe.planta_id, pe.fecha, pe.hora, pe.ticket, pe.chapa, pe.bruto_kg, pe.tara_kg, pe.neto_t,
       pe.obra_clave, o.codigo as obra_codigo, o.nombre as obra, pe.jornada_id, pe.observaciones
from planta_pesadas pe left join obras o on o.clave = pe.obra_clave;

grant select on public.v_planta_consumo_jornada, public.v_powerbi_plantas_jornadas, public.v_powerbi_plantas_pesadas to authenticated;

-- Control cruzado con Transporte: toneladas cargadas en pista por obra y día
-- (asfalto: «Concreto Asfáltico…»; hormigón: «Hormigón…»). Solo para quien ve la planta.
create or replace function public.planta_transporte(p_planta text, p_desde date, p_hasta date)
returns table (fecha date, obra_codigo text, toneladas numeric, viajes numeric, cargas bigint)
language sql stable security definer set search_path = public as $$
  select c.fecha::date, c.obra_id, sum(v.toneladas), sum(v.viajes), count(distinct c.carga_id)
  from transporte_carga c
  join transporte_viaje v on v.obra_id = c.obra_id and v.carga_id = c.carga_id
  join plantas p on p.id = p_planta
  where public.planta_rol(p_planta) is not null
    and c.fecha::date between p_desde and p_hasta
    and c.tipo_actividad = 'Carga en pista'
    and case p.tipo when 'asfalto' then c.tipo_material ilike '%concreto asf%'
                    when 'hormigon' then c.tipo_material ilike 'hormig%'
                    else false end
  group by 1, 2
$$;
revoke all on function public.planta_transporte(text, date, date) from public;
grant execute on function public.planta_transporte(text, date, date) to authenticated;

-- ── 7) Datos iniciales ───────────────────────────────────────────────────────
insert into public.plantas (id, tipo, nombre, unidad, caudal_nominal, config) values
  ('PA-01', 'asfalto',  'Planta asfáltica PA-01', 't',  80, '{"tol_cap":0.2,"lt_max":7,"lectura_min":60,"alerta_sin_lectura_min":90}'),
  ('PA-02', 'asfalto',  'Planta asfáltica PA-02', 't',  null, '{"tol_cap":0.2,"lt_max":7,"lectura_min":60,"alerta_sin_lectura_min":90}'),
  ('PH-01', 'hormigon', 'Planta de hormigón PH-01', 'm3', null, '{"lectura_min":60,"alerta_sin_lectura_min":90}'),
  ('PS-01', 'suelo',    'Planta de suelos PS-01', 't',  null, '{"lectura_min":60,"alerta_sin_lectura_min":90}')
on conflict (id) do nothing;

-- Tanques de las plantas de asfalto (las medidas se completan en Configuración).
-- El fuel del secadero de la PA-01 lleva las medidas de la planilla cilindro_vol.xlsx
-- (Ø 1,90 m × 4,80 m, ≈ 13.600 L): confirmar que es ese tanque.
insert into public.planta_tanques (planta_id, nombre, insumo, modo_lectura, forma, diametro_m, largo_m, densidad, orden, notas)
select v.* from (values
  ('PA-01', 'Tanque de CAP',        'cap',    'libre', 'cilindro_h', null::numeric, null::numeric, null::numeric, 1, 'Completar medidas y densidad de referencia (lectura a 150 °C)'),
  ('PA-01', 'Fuel secadero',        'fuel',   'stock', 'cilindro_h', 1.90, 4.80, null, 2, 'Medidas de cilindro_vol.xlsx — confirmar'),
  ('PA-01', 'Gasoil caldera',       'gasoil', 'stock', 'cilindro_h', null, null, null, 3, 'Completar medidas'),
  ('PA-02', 'Tanque de CAP',        'cap',    'libre', 'cilindro_h', null, null, null, 1, 'Completar medidas y densidad de referencia (lectura a 150 °C)'),
  ('PA-02', 'Fuel secadero',        'fuel',   'stock', 'cilindro_h', null, null, null, 2, 'Completar medidas'),
  ('PA-02', 'Gasoil caldera',       'gasoil', 'stock', 'cilindro_h', null, null, null, 3, 'Completar medidas')
) as v(planta_id, nombre, insumo, modo_lectura, forma, diametro_m, largo_m, densidad, orden, notas)
where not exists (select 1 from public.planta_tanques t where t.planta_id = v.planta_id and t.nombre = v.nombre);

-- ── Verificación ─────────────────────────────────────────────────────────────
select p.id, p.tipo, count(t.id) as tanques,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'planta_%') as tablas_en_vivo
from public.plantas p left join public.planta_tanques t on t.planta_id = p.id
group by p.id, p.tipo order by p.id;
