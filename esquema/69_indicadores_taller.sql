/* =========================================================================
 * 69_indicadores_taller.sql · equipos-v76 (28/10/2026)
 *
 * Lo que tenía Power BI y le faltaba a la app (ver LEEME_69_INDICADORES.md):
 *
 *   1) Ausencias del personal de taller (ex Jotform "Reportes - Varios"):
 *      tabla taller_ausencias, quién carga (puede_cargar_ausencias) y la vista
 *      por persona y día v_taller_ausencias_dia.
 *   2) Feriados nacionales (tabla feriados) y dia_laboral(): lun-vie 1,
 *      sábado 0,5, domingo y feriado 0 (lo mismo que el reporte Ocupación).
 *   3) Ficha del técnico: cargo, supervisor y taller designado (operadores).
 *   4) Equipos: horas mínimas por mes, meta y máximo de consumo L/h.
 *   5) equipo_dia_estado(desde, hasta): la cuenta de v_equipo_dia_estado
 *      (SQL 68) para un período. La vista pasa a usar la función: una sola
 *      cuenta para la app y para Power BI.
 *   6) indicadores_equipo_mes(desde, hasta): disponibilidad y utilización por
 *      equipo y mes (horas del parte contra horas laborales y contra mínimas).
 *   7) v_alertas_carga: equipos asignados sin parte / sin combustible.
 *   8) combustible_semanal(desde, hasta): L/h por equipo y semana contra la
 *      meta y el máximo (para el semanal y el ranking de sobreconsumo).
 *   9) Vistas para Power BI (v_powerbi_*), que la función powerbi toma sola.
 *  10) Carga inicial: feriados 2024-2027, horas mínimas (Tarifario Máquinas),
 *      meta y máximo (SP_Metas), cargo y supervisor (SP_Salarios). Las
 *      tarifas por hora NO van acá: están en 69b (no se sube a GitHub).
 *
 * No borra datos. Se puede correr más de una vez (la carga inicial no pisa lo
 * que ya se cambió a mano en la app: solo completa lo que está vacío).
 * Requiere el SQL 68 (v_equipo_dia_estado y vistas v_powerbi_*).
 * ========================================================================= */
begin;

-- ── 1. Feriados ──────────────────────────────────────────────────────────
create table if not exists public.feriados (
  fecha       date primary key,
  descripcion text not null,
  creado_en   timestamptz not null default now()
);
alter table public.feriados enable row level security;
drop policy if exists feriados_lectura on public.feriados;
create policy feriados_lectura on public.feriados for select to authenticated using (true);
drop policy if exists feriados_escritura on public.feriados;
create policy feriados_escritura on public.feriados for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
grant select, insert, update, delete on public.feriados to authenticated;
revoke all on public.feriados from anon;

-- Peso laboral del día: lun-vie 1, sábado 0,5, domingo / feriado 0
create or replace function public.dia_laboral(p_fecha date)
returns numeric language sql stable set search_path = public as $$
  select case
    when exists (select 1 from feriados f where f.fecha = p_fecha) then 0
    when extract(isodow from p_fecha) = 7 then 0
    when extract(isodow from p_fecha) = 6 then 0.5
    else 1 end::numeric
$$;
grant execute on function public.dia_laboral(date) to authenticated;

-- ── 2. Ficha del técnico ─────────────────────────────────────────────────
alter table public.operadores add column if not exists cargo text;
alter table public.operadores add column if not exists supervisor_cedula text;
alter table public.operadores add column if not exists taller_designado text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operadores_supervisor_fkey') then
    alter table public.operadores add constraint operadores_supervisor_fkey
      foreign key (supervisor_cedula) references public.operadores(cedula) on update cascade on delete set null;
  end if;
end $$;

-- ── 3. Equipos: mínimas y consumo ────────────────────────────────────────
alter table public.equipos add column if not exists horas_minimas_mes numeric;
alter table public.equipos add column if not exists consumo_meta_lh numeric;
alter table public.equipos add column if not exists consumo_max_lh numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipos_consumo_meta_max_chk') then
    alter table public.equipos add constraint equipos_consumo_meta_max_chk check (
      coalesce(horas_minimas_mes, 0) >= 0 and coalesce(consumo_meta_lh, 0) >= 0 and coalesce(consumo_max_lh, 0) >= 0);
  end if;
end $$;

-- ── 4. Ausencias del personal de taller ──────────────────────────────────
create table if not exists public.taller_ausencias (
  id                bigint generated always as identity primary key,
  cedula            text not null references public.operadores(cedula) on update cascade on delete cascade,
  desde             date not null,
  hasta             date not null,
  motivo            text not null check (motivo in ('Vacaciones', 'Receso en obra', 'Ausencia justificada')),
  supervisor_cedula text references public.operadores(cedula) on update cascade on delete set null,
  observaciones     text,
  creado_por        uuid default auth.uid(),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  check (hasta >= desde),
  check (hasta - desde <= 366)
);
create index if not exists taller_ausencias_cedula_idx on public.taller_ausencias (cedula, desde);
create index if not exists taller_ausencias_fechas_idx on public.taller_ausencias (desde, hasta);
alter table public.taller_ausencias enable row level security;

-- 'cargar': supervisores (especialidad SUPERVISOR), taller y admin central.
-- 'ver': gerente. null: nadie más.
create or replace function public.puede_cargar_ausencias()
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.rol::text in ('admin_central', 'taller') then 'cargar'
    when o.especialidad = 'SUPERVISOR' and p.activo then 'cargar'
    when p.rol::text = 'gerente' then 'ver'
    else null end
  from perfiles p left join operadores o on o.cedula = p.cedula
  where p.id = auth.uid()
$$;
revoke execute on function public.puede_cargar_ausencias() from public, anon;
grant execute on function public.puede_cargar_ausencias() to authenticated;

drop policy if exists taller_ausencias_lectura on public.taller_ausencias;
create policy taller_ausencias_lectura on public.taller_ausencias for select to authenticated
  using ((select public.puede_cargar_ausencias()) is not null);
drop policy if exists taller_ausencias_alta on public.taller_ausencias;
create policy taller_ausencias_alta on public.taller_ausencias for insert to authenticated
  with check ((select public.puede_cargar_ausencias()) = 'cargar');
-- Corrige o borra: taller y admin central siempre; el supervisor, lo que cargó él
drop policy if exists taller_ausencias_cambio on public.taller_ausencias;
create policy taller_ausencias_cambio on public.taller_ausencias for update to authenticated
  using ((select public.es_taller()) or creado_por = (select auth.uid()))
  with check ((select public.puede_cargar_ausencias()) = 'cargar');
drop policy if exists taller_ausencias_baja on public.taller_ausencias;
create policy taller_ausencias_baja on public.taller_ausencias for delete to authenticated
  using ((select public.es_taller()) or creado_por = (select auth.uid()));
grant select, insert, update, delete on public.taller_ausencias to authenticated;
revoke all on public.taller_ausencias from anon;

create or replace function public.taller_ausencias_tocar()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists trg_taller_ausencias_tocar on public.taller_ausencias;
create trigger trg_taller_ausencias_tocar before update on public.taller_ausencias
  for each row execute function public.taller_ausencias_tocar();

-- Una fila por persona y día (como lo expandía Power BI)
create or replace view public.v_taller_ausencias_dia with (security_invoker = true) as
select d::date as fecha,
       a.cedula,
       o.nombre,
       a.motivo,
       case a.motivo when 'Vacaciones' then 1 when 'Receso en obra' then 2 else 3 end as motivo_codigo,
       a.supervisor_cedula,
       s.nombre as supervisor,
       a.id as ausencia_id,
       a.desde, a.hasta, a.observaciones
  from public.taller_ausencias a
  cross join generate_series(a.desde, a.hasta, interval '1 day') d
  left join public.operadores o on o.cedula = a.cedula
  left join public.operadores s on s.cedula = a.supervisor_cedula;
grant select on public.v_taller_ausencias_dia to authenticated;

-- ── 5. Estado de cada equipo por día, para un período ────────────────────
-- Misma regla que el SQL 68 (OT de taller abierta, OT de pista ≥ 6 h, paro
-- del parte > 6 h, Inoperativo en la flota). Corre con los permisos de quien
-- llama (no es security definer): RLS sigue mandando.
create or replace function public.equipo_dia_estado(p_desde date, p_hasta date)
returns table (fecha date, mes date, equipo_id text, equipo text, tipo_equipo text, categoria text,
  propiedad text, obra_clave text, partes bigint, horas_maquina numeric, horas_hombre numeric,
  horas_paro numeric, tuvo_falla boolean, falla_impidio boolean, ot_taller bigint, ot_pista bigint,
  horas_ot_pista numeric, estado_flota text, parado_operador boolean, parado_taller boolean,
  parado_pista boolean, inoperativo_flota boolean, parado boolean, motivo text)
language sql stable set search_path = public as $$
with
param as (select greatest(p_desde, date '2025-10-01') as desde,
                 least(p_hasta, (now() at time zone 'America/Asuncion')::date) as hasta,
                 6::numeric as horas_umbral),
eq as (
  select e.id as equipo_id, e.descripcion, e.categoria, e.tipo, e.propiedad, e.fecha_baja
    from equipos e
   where e.activo and e.categoria in ('equipo', 'vehiculo_liviano')
),
dias as (
  select eq.*, d::date as fecha
    from eq cross join param p
    cross join generate_series(p.desde, p.hasta, interval '1 day') d
   where eq.fecha_baja is null or d::date <= eq.fecha_baja
),
pd as (
  select p.equipo_id, p.fecha, count(*) as partes,
         sum(coalesce(p.horas_horometro, 0)) as horas_maquina,
         sum(coalesce(p.horas_hombre, 0)) as horas_hombre,
         sum(coalesce(p.horas_paro, 0)) as horas_paro,
         bool_or(coalesce(p.tiene_falla, false)) as tuvo_falla,
         bool_or(coalesce(p.tiene_falla, false) and lower(coalesce(p.falla_impidio_trabajo, '')) = 'si') as falla_impidio,
         min(p.obra_clave) as obra_clave
    from partes p, param
   where p.fecha between param.desde and param.hasta
   group by 1, 2
),
ot_taller as (
  select d.equipo_id, d.fecha, min(o.numero) as ot_taller
    from dias d
    join ordenes_trabajo o on o.equipo_id = d.equipo_id
   where o.estado not in ('Anulada', 'Solicitada')
     and ot_tipo_efectivo(o.tipo_ot, o.obra_clave, o.ubicacion_texto) = 'Taller'
     and coalesce(o.ingreso_por_averia, true)
     and o.fecha_ingreso is not null
     and d.fecha >= (o.fecha_ingreso at time zone 'America/Asuncion')::date
     and d.fecha <= coalesce((o.fecha_cierre at time zone 'America/Asuncion')::date,
                             (now() at time zone 'America/Asuncion')::date)
   group by 1, 2
),
ot_pista as (
  select x.equipo_id, x.fecha, max(x.h) as horas_ot_pista, min(x.ot) as ot_pista
    from (select h.equipo_id, h.fecha, h.tecnico_cedula, min(h.ot) as ot,
                 sum(case when h.tipo_hora = 'traslado' then h.horas / 2 else h.horas end) as h
            from v_ot_horas h, param
           where h.tipo_ot = 'Pista' and h.fecha between param.desde and param.hasta
           group by 1, 2, 3) x
   group by 1, 2
)
select d.fecha,
       date_trunc('month', d.fecha)::date,
       d.equipo_id, d.descripcion, d.tipo, d.categoria, d.propiedad,
       pd.obra_clave,
       coalesce(pd.partes, 0),
       coalesce(pd.horas_maquina, 0),
       coalesce(pd.horas_hombre, 0),
       coalesce(pd.horas_paro, 0),
       coalesce(pd.tuvo_falla, false),
       coalesce(pd.falla_impidio, false),
       ot.ot_taller,
       op.ot_pista,
       coalesce(op.horas_ot_pista, 0),
       h.estado_despues,
       (coalesce(pd.horas_paro, 0) > p.horas_umbral),
       (ot.ot_taller is not null),
       (coalesce(op.horas_ot_pista, 0) >= p.horas_umbral),
       (coalesce(h.estado_despues, '') = 'Inoperativo'),
       (coalesce(pd.horas_paro, 0) > p.horas_umbral
        or ot.ot_taller is not null
        or coalesce(op.horas_ot_pista, 0) >= p.horas_umbral
        or coalesce(h.estado_despues, '') = 'Inoperativo'),
       case
         when ot.ot_taller is not null then 'OT taller'
         when coalesce(op.horas_ot_pista, 0) >= p.horas_umbral then 'OT pista'
         when coalesce(pd.horas_paro, 0) > p.horas_umbral then 'Paro reportado por operador'
         when coalesce(h.estado_despues, '') = 'Inoperativo' then 'Inoperativo en flota'
         else 'Disponible'
       end
  from dias d
  cross join param p
  left join pd on pd.equipo_id = d.equipo_id and pd.fecha = d.fecha
  left join ot_taller ot on ot.equipo_id = d.equipo_id and ot.fecha = d.fecha
  left join ot_pista op on op.equipo_id = d.equipo_id and op.fecha = d.fecha
  left join lateral (
    select x.estado_despues from equipo_estado_historial x
     where x.equipo_id = d.equipo_id
       and (x.momento at time zone 'America/Asuncion')::date <= d.fecha
     order by x.momento desc limit 1) h on true
$$;
grant execute on function public.equipo_dia_estado(date, date) to authenticated;

-- La vista del SQL 68, ahora con la misma función (mismas columnas)
create or replace view public.v_equipo_dia_estado with (security_invoker = true) as
select * from public.equipo_dia_estado(date '2025-10-01', (now() at time zone 'America/Asuncion')::date);

-- ── 6. Disponibilidad y utilización por equipo y mes ─────────────────────
-- dias_laborales: suma de dia_laboral() de los días del período en ese mes.
-- horas_laborales = días laborales × 10 h.
-- minimo_periodo: horas mínimas del mes (ficha; si no, Mínimo Hr del maestro
-- de tarifas) prorrateadas por los días del mes que entran en el período.
create or replace function public.indicadores_equipo_mes(p_desde date, p_hasta date)
returns table (mes date, equipo_id text, equipo text, tipo_equipo text, categoria text, propiedad text,
  asignacion text, ubicacion text, estado_actual text, usa_horometro boolean,
  dias_calendario bigint, dias_parado bigint, dias_ot_taller bigint, dias_ot_pista bigint,
  dias_paro_operador bigint, dias_inoperativo_flota bigint, dias_con_parte bigint,
  horas_maquina numeric, horas_hombre numeric, disponibilidad numeric,
  dias_laborales numeric, horas_laborales numeric, minimo_mes numeric, minimo_periodo numeric,
  utilizacion numeric, cumplimiento_minimo numeric)
language sql stable set search_path = public as $$
with d as (select * from equipo_dia_estado(p_desde, p_hasta)),
lab as (select g::date as fecha, dia_laboral(g::date) as peso
          from generate_series(greatest(p_desde, date '2025-10-01'),
                               least(p_hasta, (now() at time zone 'America/Asuncion')::date), interval '1 day') g),
m as (
  select d.mes, d.equipo_id, d.equipo, d.tipo_equipo, d.categoria, d.propiedad,
         count(*) as dias_calendario,
         count(*) filter (where d.parado) as dias_parado,
         count(*) filter (where d.motivo = 'OT taller') as dias_ot_taller,
         count(*) filter (where d.motivo = 'OT pista') as dias_ot_pista,
         count(*) filter (where d.motivo = 'Paro reportado por operador') as dias_paro_operador,
         count(*) filter (where d.motivo = 'Inoperativo en flota') as dias_inoperativo_flota,
         count(*) filter (where d.partes > 0) as dias_con_parte,
         sum(d.horas_maquina) as horas_maquina,
         sum(d.horas_hombre) as horas_hombre,
         sum(lab.peso) as dias_laborales
    from d join lab on lab.fecha = d.fecha
   group by 1, 2, 3, 4, 5, 6
)
select m.mes, m.equipo_id, m.equipo, m.tipo_equipo, m.categoria, m.propiedad,
       s.asignacion, s.ubicacion, s.estado, e.usa_horometro,
       m.dias_calendario, m.dias_parado, m.dias_ot_taller, m.dias_ot_pista, m.dias_paro_operador,
       m.dias_inoperativo_flota, m.dias_con_parte, m.horas_maquina, m.horas_hombre,
       round(1 - m.dias_parado::numeric / nullif(m.dias_calendario, 0), 4),
       m.dias_laborales,
       m.dias_laborales * 10,
       mn.minimo,
       round(mn.minimo * m.dias_calendario / extract(day from (m.mes + interval '1 month - 1 day'))::numeric, 1),
       round(m.horas_maquina / nullif(m.dias_laborales * 10, 0), 4),
       round(m.horas_maquina / nullif(mn.minimo * m.dias_calendario
             / extract(day from (m.mes + interval '1 month - 1 day'))::numeric, 0), 4)
  from m
  join equipos e on e.id = m.equipo_id
  left join equipo_estado s on s.equipo_id = m.equipo_id
  left join lateral (
    select coalesce(nullif(e.horas_minimas_mes, 0),
             (select max(t.minimo_hr) from tarifas_equipos t
               where t.equipo_id = m.equipo_id and coalesce(t.minimo_hr, 0) > 0
                 and (t.fecha_hasta is null or t.fecha_hasta >= m.mes))) as minimo) mn on true
$$;
grant execute on function public.indicadores_equipo_mes(date, date) to authenticated;

-- ── 7. Alertas de carga: asignados sin parte / sin combustible ───────────
-- Equipos y vehículos activos que van en el parte, con asignación (no
-- "Sin Asignación" ni Taller) y que no están Inoperativos. La cantidad de
-- días (N) se elige en la app.
create or replace view public.v_alertas_carga with (security_invoker = true) as
with hoy as (select (now() at time zone 'America/Asuncion')::date as d)
select e.id as equipo_id, e.descripcion, e.tipo, e.categoria, e.propiedad,
       s.asignacion, s.ubicacion, s.estado, s.disponibilidad, e.operador_habitual,
       up.fecha as ultimo_parte,
       (hoy.d - up.fecha) as dias_sin_parte,
       greatest(uc.fecha, ucp.fecha) as ultima_carga,
       (hoy.d - greatest(uc.fecha, ucp.fecha)) as dias_sin_carga,
       uc.fecha as ultimo_despacho,
       uc.litros as litros_ultimo_despacho,
       ucp.fecha as ultima_carga_en_parte
  from equipos e
  cross join hoy
  join equipo_estado s on s.equipo_id = e.id
  left join lateral (select max(p.fecha) as fecha from partes p where p.equipo_id = e.id) up on true
  -- carga de combustible: despacho del formulario de combustible…
  left join lateral (select c.fecha, c.litros from combustible_movimientos c
                      where c.equipo_id = e.id and c.actividad = 'Despacho de combustible'
                      order by c.fecha desc, c.hora desc nulls last limit 1) uc on true
  -- …o gasoil declarado en el parte (cantidad mayor a 0)
  left join lateral (select max(p.fecha) as fecha from partes p
                      where p.equipo_id = e.id
                        and p.combustible ~* 'gasoil[^\n]*cantidad suministrada:\s*0*[1-9]') ucp on true
 where e.activo and e.en_parte_diario
   and e.categoria in ('equipo', 'vehiculo_liviano')
   and coalesce(nullif(trim(s.asignacion), ''), 'Sin Asignación') not in ('Sin Asignación', 'Taller')
   and coalesce(s.estado, '') <> 'Inoperativo';
grant select on public.v_alertas_carga to authenticated;

-- ── 8. Consumo semanal contra meta y máximo ──────────────────────────────
-- Litros despachados (gasoil) contra horas de horómetro de los partes, por
-- semana (lunes). Meta: la de la ficha; si no, el consumo promedio. Máximo:
-- el de la ficha; si no, meta × 1,2. Variación como el reporte Combustible:
-- sobre el máximo → (L/h − máx) / máx; bajo la meta → −(meta − L/h) / meta.
create or replace function public.combustible_semanal(p_desde date, p_hasta date)
returns table (semana date, equipo_id text, descripcion text, tipo text, litros numeric, horas numeric,
  litros_hora numeric, meta_lh numeric, max_lh numeric, referencia text, variacion numeric,
  litros_sobre_max numeric, litros_sobre_meta numeric)
language sql stable set search_path = public as $$
with ini as (select date_trunc('week', p_desde)::date as d),
l as (
  select c.equipo_id, date_trunc('week', c.fecha)::date as semana, sum(c.litros) as litros
    from combustible_movimientos c, ini
   where c.actividad = 'Despacho de combustible' and c.insumo = 'gasoil' and c.equipo_id is not null
     and c.fecha between ini.d and p_hasta
   group by 1, 2
),
h as (
  select p.equipo_id, date_trunc('week', p.fecha)::date as semana,
         sum(coalesce(p.horas_horometro, p.horas_horometro_reportada)) as horas
    from partes p, ini
   where p.fecha between ini.d and p_hasta and p.equipo_id is not null
   group by 1, 2
),
x as (
  select l.semana, l.equipo_id, e.descripcion, e.tipo, l.litros, h.horas,
         case when h.horas > 0 then round(l.litros / h.horas, 2) end as lh,
         coalesce(nullif(e.consumo_meta_lh, 0), nullif(e.consumo_promedio_lh, 0)) as meta,
         coalesce(nullif(e.consumo_max_lh, 0), round(coalesce(nullif(e.consumo_meta_lh, 0), nullif(e.consumo_promedio_lh, 0)) * 1.2, 2)) as maximo,
         case when nullif(e.consumo_meta_lh, 0) is not null then 'meta'
              when nullif(e.consumo_promedio_lh, 0) is not null then 'promedio' end as referencia
    from l join equipos e on e.id = l.equipo_id
    left join h on h.equipo_id = l.equipo_id and h.semana = l.semana
   where coalesce(e.usa_horometro, true)
)
select semana, equipo_id, descripcion, tipo, litros, horas, lh, meta, maximo, referencia,
       case when lh is null or meta is null then null
            when lh > maximo then round((lh - maximo) / maximo, 4)
            when lh < meta then round(-(meta - lh) / meta, 4)
            else 0 end,
       case when horas > 0 and maximo is not null then round(greatest(litros - maximo * horas, 0), 1) end,
       case when horas > 0 and meta is not null then round(greatest(litros - meta * horas, 0), 1) end
  from x
$$;
grant execute on function public.combustible_semanal(date, date) to authenticated;

-- v_combustible_consumo (SQL 16): mismas columnas + meta y máximo al final
create or replace view public.v_combustible_consumo with (security_invoker = true) as
with l as (
  select c.equipo_id, date_trunc('month', c.fecha::timestamptz)::date as mes, sum(c.litros) as litros
    from combustible_movimientos c
   where c.actividad = 'Despacho de combustible' and c.equipo_id is not null and c.insumo = 'gasoil'
   group by 1, 2
), h as (
  select p.equipo_id, date_trunc('month', p.fecha::timestamptz)::date as mes,
         sum(coalesce(p.horas_horometro, p.horas_horometro_reportada)) as horas,
         sum(p.km_recorridos) as km
    from partes p
   group by 1, 2
)
select l.equipo_id, e.descripcion, e.tipo, l.mes, l.litros, h.horas, h.km,
       case when h.horas > 0 then round(l.litros / h.horas, 2) end as litros_hora,
       case when h.km > 0 then round(100 * l.litros / h.km, 2) end as litros_100km,
       coalesce(e.consumo_promedio_lh, e.consumo_nominal) as referencia_lh,
       case when h.horas > 0 and coalesce(e.consumo_promedio_lh, e.consumo_nominal) > 0
            then round(100 * ((l.litros / h.horas) - coalesce(e.consumo_promedio_lh, e.consumo_nominal))
                       / coalesce(e.consumo_promedio_lh, e.consumo_nominal)) end as desvio_pct,
       e.consumo_meta_lh as meta_lh,
       e.consumo_max_lh as max_lh
  from l
  join equipos e on e.id = l.equipo_id
  left join h on h.equipo_id = l.equipo_id and h.mes = l.mes;

-- ── 9. Power BI ──────────────────────────────────────────────────────────
create or replace view public.v_powerbi_feriados with (security_invoker = true) as
select fecha, descripcion from public.feriados;

create or replace view public.v_powerbi_taller_ausencias_dia with (security_invoker = true) as
select fecha, cedula, nombre, motivo, motivo_codigo, supervisor_cedula, supervisor, ausencia_id
  from public.v_taller_ausencias_dia;

create or replace view public.v_powerbi_indicadores_equipo_mes with (security_invoker = true) as
select * from public.indicadores_equipo_mes(date '2025-10-01', (now() at time zone 'America/Asuncion')::date);

create or replace view public.v_powerbi_combustible_semanal with (security_invoker = true) as
select * from public.combustible_semanal(date '2025-02-01', (now() at time zone 'America/Asuncion')::date);

create or replace view public.v_powerbi_alertas_carga with (security_invoker = true) as
select * from public.v_alertas_carga;

-- personal: las mismas columnas del SQL 68 + cargo, supervisor y taller al final
create or replace view public.v_powerbi_personal with (security_invoker = true) as
select o.cedula, o.nombre, o.activo, o.especialidad, o.ubicacion,
       o.equipo_habitual, o.verificado,
       pf.rol as rol_app, pf.activo as usuario_activo,
       o.cargo, o.supervisor_cedula, s.nombre as supervisor, o.taller_designado
  from public.operadores o
  left join public.operadores s on s.cedula = o.supervisor_cedula
  left join lateral (select p.rol, p.activo from public.perfiles p
                      where p.cedula = o.cedula order by p.activo desc limit 1) pf on true;

grant select on public.v_powerbi_feriados, public.v_powerbi_taller_ausencias_dia,
  public.v_powerbi_indicadores_equipo_mes, public.v_powerbi_combustible_semanal,
  public.v_powerbi_alertas_carga, public.v_powerbi_personal, public.v_combustible_consumo to authenticated;

-- ── 10. Carga inicial ────────────────────────────────────────────────────
-- Feriados de Paraguay. 2024 y 2025: los del reporte Ocupación de Power BI.
-- 2026 y 2027: las fechas de la ley; si el Poder Ejecutivo traslada alguno
-- (pasa con el 1/3, el 12/6 y el 29/9), se corrige en Administración ›
-- Catálogos › Calendario › Feriados.
insert into public.feriados (fecha, descripcion) values
  ('2024-01-01', 'Año Nuevo'), ('2024-03-01', 'Día de los Héroes'), ('2024-05-01', 'Día del Trabajador'),
  ('2024-05-15', 'Día de la Independencia Nacional'), ('2024-06-12', 'Paz del Chaco'),
  ('2024-08-15', 'Fundación de Asunción'), ('2024-09-29', 'Batalla de Boquerón'),
  ('2024-12-08', 'Virgen de Caacupé'), ('2024-12-25', 'Navidad'),
  ('2025-01-01', 'Año Nuevo'), ('2025-03-01', 'Día de los Héroes de la Patria'),
  ('2025-04-17', 'Jueves Santo'), ('2025-04-18', 'Viernes Santo'), ('2025-05-10', 'Día de los Trabajadores'),
  ('2025-05-14', 'Día de la Independencia'), ('2025-05-15', 'Día de la Madre'),
  ('2025-06-12', 'Día de la Paz del Chaco'), ('2025-08-15', 'Día de la Fundación de Asunción'),
  ('2025-09-29', 'Victoria de Boquerón'), ('2025-12-08', 'Día de la Virgen de Caacupé'), ('2025-12-25', 'Navidad'),
  ('2026-01-01', 'Año Nuevo'), ('2026-03-01', 'Día de los Héroes de la Patria'),
  ('2026-04-02', 'Jueves Santo'), ('2026-04-03', 'Viernes Santo'), ('2026-05-01', 'Día de los Trabajadores'),
  ('2026-05-14', 'Día de la Independencia'), ('2026-05-15', 'Día de la Madre'),
  ('2026-06-12', 'Día de la Paz del Chaco'), ('2026-08-15', 'Día de la Fundación de Asunción'),
  ('2026-09-29', 'Victoria de Boquerón'), ('2026-12-08', 'Día de la Virgen de Caacupé'), ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'), ('2027-03-01', 'Día de los Héroes de la Patria'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'), ('2027-05-01', 'Día de los Trabajadores'),
  ('2027-05-14', 'Día de la Independencia'), ('2027-05-15', 'Día de la Madre'),
  ('2027-06-12', 'Día de la Paz del Chaco'), ('2027-08-15', 'Día de la Fundación de Asunción'),
  ('2027-09-29', 'Victoria de Boquerón'), ('2027-12-08', 'Día de la Virgen de Caacupé'), ('2027-12-25', 'Navidad')
on conflict (fecha) do nothing;

-- Horas mínimas por mes (Power BI · Ocupación · Tarifario Máquinas)
update public.equipos e set horas_minimas_mes = v.minimo
  from (values
    ('AM-01',100),('AM-02',100),('AM-03',100),('AM-04',100),('AM-05',100),('BUS-01',90),('BUS-02',90),
    ('CC-01',80),('CC-02',80),('CM-01',100),('CM-02',100),('CM-03',100),('CM-04',100),
    ('CMX-01',120),('CMX-02',120),('CMX-03',120),('CMX-04',120),('CN-01',100),('CN-02',100),('CN-04',100),
    ('CR-02',110),('CR-03',110),('CR-04',110),('CR-05',110),('CR-06',110),('CR-07',110),('CR-08',110),
    ('CR-09',110),('CR-10',110),('CRA-01',100),('CRA-02',100),
    ('CV-01',110),('CV-02',110),('CV-03',110),('CV-04',110),('CV-05',110),('CV-06',110),('CV-07',110),
    ('CV-08',110),('CV-09',110),('CV-10',110),('CV-11',110),('CV-12',110),('CV-13',110),('CV-14',110),
    ('CV-15',110),('CV-16',110),('CX-01',120),('CX-02',120),('CX-03',120),('CX-04',120),
    ('EA-01',120),('EA-02',120),('ES-01',60),
    ('EX-03',100),('EX-04',100),('EX-05',100),('EX-06',100),('EX-07',100),('EX-08',100),('EX-09',100),
    ('EX-10',100),('EX-11',100),('EX-12',100),('EX-13',100),('EX-14',100),
    ('MC-01',100),('MC-02',100),('MC-03',100),
    ('MN-01',100),('MN-02',100),('MN-03',100),('MN-04',100),('MN-05',100),('MN-06',100),('MN-07',100),('MN-08',100),
    ('MT-01',120),('PC-01',110),('PC-02',110),('PC-03',110),('PC-04',110),('PC-05',110),('PC-06',110),
    ('PF-01',100),('RP-01',100),('RP-02',100),('RP-03',100),
    ('TA-01',100),('TA-02',100),('TA-03',100),('TA-04',100),('TA-05',100),('TA-06',100),('TA-07',100),
    ('TA-08',100),('TA-09',100),('TA-10',100),('TA-11',100),
    ('TC-02',90),('TC-03',90),('TC-04',90),('TC-05',90),('TC-06',90),('TC-07',90),
    ('TM-01',100),('TM-02',100),('TM-03',100),('TM-04',100),('TP-01',100),('TP-02',100),('TP-03',100),
    ('VC-01',90),('VC-02',90),('VC-03',90),('VC-04',90),('VC-05',90),('VC-06',90),('VC-07',90),('VC-08',90),
    ('VC-09',90),('VC-12',90),('VC-13',120),('VC-14',120),('VC-16',90),('VC-17',90),('VC-18',90),
    ('VC-19',90),('VC-20',90),('VC-21',90),('VC-22',90),('ZM-01',100)
  ) as v(id, minimo)
 where e.id = v.id and e.horas_minimas_mes is null;

-- Meta y máximo de consumo L/h (Power BI · Control Combustible · SP_Metas)
update public.equipos e set consumo_meta_lh = v.meta, consumo_max_lh = v.maximo
  from (values
    ('AM-01',2.5,3),('AM-02',2.5,3),('AM-03',2.5,3),('AM-04',2.5,3),('AM-05',2.5,3),('CA-03',4,4.8),
    ('CC-02',5,6),('CM-01',4,4.8),('CM-02',4,4.8),('CM-03',4,4.8),('CM-04',4,4.8),
    ('CMX-01',6.5,7.8),('CMX-02',6.5,7.8),('CMX-03',6.5,7.8),('CMX-04',6.5,7.8),
    ('CN-01',6,7.2),('CN-02',6,7.2),('CN-04',6,7.2),
    ('CR-02',6,7.2),('CR-03',6,7.2),('CR-04',6,7.2),('CR-05',6,7.2),('CR-06',6,7.2),('CR-07',8,9.6),
    ('CR-08',8,9.6),('CR-09',8,9.6),('CR-10',6,7.2),('CRA-01',10,12),('CRA-02',10,12),
    ('CV-01',8.5,10.2),('CV-02',8.5,10.2),('CV-03',8.5,10.2),('CV-04',8.5,10.2),('CV-05',8.5,10.2),
    ('CV-06',8.5,10.2),('CV-07',8.5,10.2),('CV-08',8.5,10.2),('CV-09',8.5,10.2),('CV-10',8.5,10.2),
    ('CV-11',8.5,10.2),('CV-12',8.5,10.2),('CV-13',5,6),('CV-14',5,6),('CV-15',5,6),('CV-16',5,6),
    ('CX-01',5.5,6.5),('CX-02',5.5,6.5),('CX-03',6.5,7.5),('CX-04',6.5,7.5),
    ('EA-01',10,12),('ES-01',65,78),
    ('EX-03',18,21.6),('EX-04',18,21.6),('EX-05',14,16.8),('EX-06',18,21.6),('EX-07',18,21.6),
    ('EX-08',27.5,33),('EX-09',22,26.4),('EX-10',22,26.4),('EX-11',22,26.4),('EX-12',25,30),
    ('EX-13',25,30),('EX-14',25,30),('GG-02',23.5,28.2),('GG-04',10,12),
    ('MC-01',2.5,3),('MC-02',2.5,3),('MC-03',2.5,3),
    ('MN-01',20,24),('MN-02',20,24),('MN-03',17,20.4),('MN-04',20,24),('MN-05',14,16.8),('MN-06',24,28.8),
    ('MN-07',20,24),('MN-08',24,28.8),('MT-01',2,2.4),
    ('PC-01',8,9.6),('PC-02',10,12),('PC-03',10,12),('PC-04',10,12),('PC-05',10,12),('PC-06',10,12),
    ('PF-01',15,18),('RP-01',6,7.2),('RP-02',6,7.2),('RP-03',6,7.2),
    ('TA-01',7.5,9),('TA-02',7.5,9),('TA-03',4.5,4.8),('TA-04',4.5,4.8),('TA-05',10,12),('TA-06',10,12),
    ('TA-07',12,14.4),('TA-08',14,16.8),('TA-09',14,16.8),('TA-10',14,16.8),('TA-11',14,16.8),
    ('TC-02',10,12),('TC-03',10,12),('TC-04',10,12),('TC-05',10,12),('TC-06',10,12),('TC-07',10,12),
    ('TM-01',34,40.8),('TM-02',34,40.8),('TM-03',28,33.6),('TM-04',28,33.6),
    ('TP-01',13,15.6),('TP-02',18,21.6),('TP-03',9,10.8),
    ('VC-01',12,14.4),('VC-02',12,14.4),('VC-03',12,14.4),('VC-04',12,14.4),('VC-05',10,12),('VC-06',12,14.4),
    ('VC-07',7,8.4),('VC-08',10,12),('VC-09',14,16.8),('VC-12',12,14.4),('VC-13',4.5,5.4),('VC-14',4.5,5.4),
    ('VC-16',7,8.4),('VC-17',22,26.4),('VC-18',22,26.4),('VC-19',10,12),('VC-20',10,12),('VC-21',10,12),
    ('VC-22',10,12),('ZM-01',14,16.8)
  ) as v(id, meta, maximo)
 where e.id = v.id and e.consumo_meta_lh is null and e.consumo_max_lh is null;
-- (VC-13 y VC-14 en SP_Metas tenían el máximo 3,6 por debajo de la meta 4,5:
--  se cargan con 5,4 = meta × 1,2, como el resto.)

-- Supervisora que estaba en el formulario de Jotform y no en el catálogo
insert into public.operadores (cedula, nombre, especialidad, activo)
values ('3726182', 'FLEITAS MALDONADO, MARGARET MARGONIA', 'SUPERVISOR', true)
on conflict (cedula) do nothing;

-- Cargo, supervisor y taller designado (Power BI · Control OT · SP_Salarios)
update public.operadores o
   set cargo = coalesce(o.cargo, v.cargo),
       supervisor_cedula = coalesce(o.supervisor_cedula, nullif(v.sup, o.cedula)),
       taller_designado = coalesce(o.taller_designado, v.taller)
  from (values
    ('8016035','AYUDANTE DE TALLER','3775957','RUTA DE LA BANANA'),
    ('4915910','AYUDANTE DE TALLER','3775957','RUTA DE LA BANANA'),
    ('7054175','AYUDANTE MECANICO',null,null),
    ('5339445','MECANICO','4782323','SAN JUAN BAUTISTA - MISIONES'),
    ('4046181','MECANICO',null,null),
    ('5389973','ELECTRICISTA','1664435','TALLER CENTRAL'),
    ('7236437','ELECTRICISTA',null,null),
    ('6880762','ELECTRICISTA','5499559','CONSORCIO CHACO SUR'),
    ('5457350','ELECTRICISTA','4782323','SAN JUAN BAUTISTA - MISIONES'),
    ('6322902','AYUDANTE DE TALLER',null,null),
    ('4200924','ELECTRICISTA','1664435','TALLER CENTRAL'),
    ('6862138','MECANICO','1664435','TALLER CENTRAL'),
    ('4782323','SUPERVISOR',null,'SAN JUAN BAUTISTA - MISIONES'),
    ('5500498','SUPERVISOR','1664435','TALLER CENTRAL'),
    ('1664435','SUPERVISOR',null,'TALLER CENTRAL'),
    ('5499559','SUPERVISOR',null,'CONSORCIO CHACO SUR'),
    ('3775957','SUPERVISOR',null,'RUTA DE LA BANANA'),
    ('3726182','SUPERVISOR',null,null),
    ('3698258','MECANICO','1664435','CT VIAL'),
    ('4278810','MECANICO','1664435','CRUZMONTE'),
    ('3914509','MECANICO','3775957','RUTA DE LA BANANA'),
    ('4372544','MECANICO','5499559','CONSORCIO CHACO SUR'),
    ('2148812','MECANICO SENIOR','1664435','TALLER CENTRAL'),
    ('5277376','MECANICO','1664435','TALLER CENTRAL'),
    ('3357161','MECANICO','1664435','TALLER CENTRAL'),
    ('3991715','MECANICO','4782323','SAN JUAN BAUTISTA - MISIONES'),
    ('6956079','MECANICO','3775957','RUTA DE LA BANANA'),
    ('3453963','MECANICO','3775957','RUTA DE LA BANANA'),
    ('5109491','MECANICO','4782323','SAN JUAN BAUTISTA - MISIONES'),
    ('4801232','MECANICO','1664435','CRUZMONTE'),
    ('4254494','AYUDANTE DE TALLER','1664435','TALLER CENTRAL'),
    ('6564821','AYUDANTE DE TALLER','1664435','TALLER CENTRAL'),
    ('5027915','AYUDANTE DE TALLER','5499559','CONSORCIO CHACO SUR')
  ) as v(cedula, cargo, sup, taller)
 where o.cedula = v.cedula;

commit;

-- ── Comprobación (tiene que dar todo > 0 / true) ─────────────────────────
select
  (select count(*) from public.feriados)                                          as feriados,
  (select count(*) from public.equipos where horas_minimas_mes > 0)               as equipos_con_minimo,
  (select count(*) from public.equipos where consumo_meta_lh > 0)                 as equipos_con_meta,
  (select count(*) from public.operadores where supervisor_cedula is not null)    as tecnicos_con_supervisor,
  (select count(*) from public.equipo_dia_estado(current_date - 6, current_date)) > 0 as dia_estado_ok,
  (select count(*) from public.v_equipo_dia_estado where fecha = current_date - 1) > 0 as vista_68_ok,
  public.dia_laboral(date '2026-12-25') = 0 and public.dia_laboral(date '2026-10-31') = 0.5 as dia_laboral_ok;
