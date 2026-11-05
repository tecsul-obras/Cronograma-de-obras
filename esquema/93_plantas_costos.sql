-- ═══════════════════════════════════════════════════════════════════════════
-- 93 · PLANTAS — mediciones sin producción, tabla del CAP y COSTO POR TONELADA
--      equipos-v92 · 05/11/2026 · correr DESPUÉS del 92. Se puede correr dos veces.
--
--   1) Mediciones de tanques sin arrancar la planta (la caldera calienta el CAP
--      también los días sin producción): planta_lecturas sin jornada, tipo «control».
--   2) Tabla de aforo del tanque de CAP de 40.000 L (control_tanque.xlsx: altura
--      libre 0 → 3,00 m = 41.079 → 0 L). Se guarda como altura de líquido
--      (3,00 − libre) y el tanque queda «libre» / «tabla» / altura 3,00 m.
--      Solo se carga si el tanque todavía no tiene tabla.
--   3) Costos (fase 2):
--      · planta_precios: precio de cada insumo (CAP, áridos, filler/cal, fuel,
--        gasoil…), en Gs o USD, con fecha desde (vale el último vigente).
--      · planta_formulas.componentes: dosificación de áridos/filler de cada fórmula
--        (% de la mezcla, precio que usa). El CAP NO va acá: se toma el medido.
--      · planta_equipos: máquinas que trabajan para la planta (PC-04, GG-02…):
--        horas del parte diario × tarifa del maestro de tarifas (tarifas_equipos).
--      · plantas: costo fijo mensual (personal de planta, etc.) y en config el tipo de
--        cambio, el % de desperdicio de áridos y el costo de referencia (APU).
--      · La amortización de la planta = tarifa de la planta × toneladas (si no se
--        carga en la planta, la del maestro de tarifas de la PA, ej. 27.800 Gs/t).
--      Quién ve costos: admin central, admin de obra, gerente (Equipos u Obras) y
--      admin de Obras. Encargado, operadores, báscula y taller NO ven precios.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Mediciones sin jornada ──────────────────────────────────────────────
alter table public.planta_lecturas alter column jornada_id drop not null;
alter table public.planta_lecturas drop constraint if exists planta_lecturas_tipo_check;
alter table public.planta_lecturas add constraint planta_lecturas_tipo_check check (tipo in ('inicio', 'hora', 'cierre', 'control'));
create index if not exists planta_lecturas_control on public.planta_lecturas (planta_id, hora desc) where jornada_id is null;
-- (las políticas del 92 ya sirven: sin jornada cuenta como «abierta»)

-- ── 2) Tabla del tanque de CAP de 40.000 L (PA-01) ──────────────────────────
update public.planta_tanques
   set forma = 'tabla', modo_lectura = 'libre', altura_m = 3.00,
       tabla = '[[0.0,0.0],[0.01,31.0],[0.02,62.0],[0.03,93.0],[0.04,124.0],[0.05,155.0],[0.06,174.8],[0.07,194.6],[0.08,214.4],[0.09,234.2],[0.1,254.0],[0.11,303.4],[0.12,352.8],[0.13,402.2],[0.14,451.6],[0.15,501.0],[0.16,583.0],[0.17,665.0],[0.18,747.0],[0.19,829.0],[0.2,911.0],[0.21,1003.4],[0.22,1095.8],[0.23,1188.2],[0.24,1280.6],[0.25,1373.0],[0.26,1474.4],[0.27,1575.8],[0.28,1677.2],[0.29,1778.6],[0.3,1880.0],[0.31,1989.0],[0.32,2098.0],[0.33,2207.0],[0.34,2316.0],[0.35,2425.0],[0.36,2541.0],[0.37,2657.0],[0.38,2773.0],[0.39,2889.0],[0.4,3005.0],[0.41,3127.4],[0.42,3249.8],[0.43,3372.2],[0.44,3494.6],[0.45,3617.0],[0.46,3745.2],[0.47,3873.4],[0.48,4001.6],[0.49,4129.8],[0.5,4258.0],[0.51,4391.4],[0.52,4524.8],[0.53,4658.2],[0.54,4791.6],[0.55,4925.0],[0.56,5063.0],[0.57,5201.0],[0.58,5339.0],[0.59,5477.0],[0.6,5615.0],[0.61,5757.6],[0.62,5900.2],[0.63,6042.8],[0.64,6185.4],[0.65,6328.0],[0.66,6474.6],[0.67,6621.2],[0.68,6767.8],[0.69,6914.4],[0.7,7061.0],[0.71,7211.2],[0.72,7361.4],[0.73,7511.6],[0.74,7661.8],[0.75,7812.0],[0.76,7965.6],[0.77,8119.2],[0.78,8272.8],[0.79,8426.4],[0.8,8580.0],[0.81,8736.8],[0.82,8893.6],[0.83,9050.4],[0.84,9207.2],[0.85,9364.0],[0.86,9523.4],[0.87,9682.8],[0.88,9842.2],[0.89,10001.6],[0.9,10161.0],[0.91,10323.2],[0.92,10485.4],[0.93,10647.6],[0.94,10809.8],[0.95,10972.0],[0.96,11136.4],[0.97,11300.8],[0.98,11465.2],[0.99,11629.6],[1.0,11794.0],[1.01,11960.4],[1.02,12126.8],[1.03,12293.2],[1.04,12459.6],[1.05,12626.0],[1.06,12794.4],[1.07,12962.8],[1.08,13131.2],[1.09,13299.6],[1.1,13468.0],[1.11,13638.0],[1.12,13808.0],[1.13,13978.0],[1.14,14148.0],[1.15,14318.0],[1.16,14489.2],[1.17,14660.4],[1.18,14831.6],[1.19,15002.8],[1.2,15174.0],[1.21,15346.6],[1.22,15519.2],[1.23,15691.8],[1.24,15864.4],[1.25,16037.0],[1.26,16210.4],[1.27,16383.8],[1.28,16557.2],[1.29,16730.6],[1.3,16904.0],[1.31,17078.4],[1.32,17252.8],[1.33,17427.2],[1.34,17601.6],[1.35,17776.0],[1.36,17950.8],[1.37,18125.6],[1.38,18300.4],[1.39,18475.2],[1.4,18650.0],[1.41,18825.2],[1.42,19000.4],[1.43,19175.6],[1.44,19350.8],[1.45,19526.0],[1.46,19701.4],[1.47,19876.8],[1.48,20052.2],[1.49,20227.6],[1.5,20403.0],[1.51,20578.6],[1.52,20754.2],[1.53,20929.8],[1.54,21105.4],[1.55,21281.0],[1.56,21456.2],[1.57,21631.4],[1.58,21806.6],[1.59,21981.8],[1.6,22157.0],[1.61,22331.8],[1.62,22506.6],[1.63,22681.4],[1.64,22856.2],[1.65,23031.0],[1.66,23205.4],[1.67,23379.8],[1.68,23554.2],[1.69,23728.6],[1.7,23903.0],[1.71,24076.6],[1.72,24250.2],[1.73,24423.8],[1.74,24597.4],[1.75,24771.0],[1.76,24943.4],[1.77,25115.8],[1.78,25288.2],[1.79,25460.6],[1.8,25633.0],[1.81,25804.4],[1.82,25975.8],[1.83,26147.2],[1.84,26318.6],[1.85,26490.0],[1.86,26659.8],[1.87,26829.6],[1.88,26999.4],[1.89,27169.2],[1.9,27339.0],[1.91,27507.4],[1.92,27675.8],[1.93,27844.2],[1.94,28012.6],[1.95,28181.0],[1.96,28347.4],[1.97,28513.8],[1.98,28680.2],[1.99,28846.6],[2.0,29013.0],[2.01,29177.4],[2.02,29341.8],[2.03,29506.2],[2.04,29670.6],[2.05,29835.0],[2.06,29997.0],[2.07,30159.0],[2.08,30321.0],[2.09,30483.0],[2.1,30645.0],[2.11,30804.6],[2.12,30964.2],[2.13,31123.8],[2.14,31283.4],[2.15,31443.0],[2.16,31599.6],[2.17,31756.2],[2.18,31912.8],[2.19,32069.4],[2.2,32226.0],[2.21,32379.6],[2.22,32533.2],[2.23,32686.8],[2.24,32840.4],[2.25,32994.0],[2.26,33176.2],[2.27,33358.4],[2.28,33540.6],[2.29,33722.8],[2.3,33905.0],[2.31,34019.6],[2.32,34134.2],[2.33,34248.8],[2.34,34363.4],[2.35,34478.0],[2.36,34620.6],[2.37,34763.2],[2.38,34905.8],[2.39,35048.4],[2.4,35191.0],[2.41,35329.2],[2.42,35467.4],[2.43,35605.6],[2.44,35743.8],[2.45,35882.0],[2.46,36015.2],[2.47,36148.4],[2.48,36281.6],[2.49,36414.8],[2.5,36548.0],[2.51,36676.2],[2.52,36804.4],[2.53,36932.6],[2.54,37060.8],[2.55,37189.0],[2.56,37311.4],[2.57,37433.8],[2.58,37556.2],[2.59,37678.6],[2.6,37801.0],[2.61,37917.0],[2.62,38033.0],[2.63,38149.0],[2.64,38265.0],[2.65,38381.0],[2.66,38490.0],[2.67,38599.0],[2.68,38708.0],[2.69,38817.0],[2.7,38926.0],[2.71,39027.2],[2.72,39128.4],[2.73,39229.6],[2.74,39330.8],[2.75,39432.0],[2.76,39524.4],[2.77,39616.8],[2.78,39709.2],[2.79,39801.6],[2.8,39894.0],[2.81,39976.2],[2.82,40058.4],[2.83,40140.6],[2.84,40222.8],[2.85,40305.0],[2.86,40375.0],[2.87,40445.0],[2.88,40515.0],[2.89,40585.0],[2.9,40655.0],[2.91,40709.6],[2.92,40764.2],[2.93,40818.8],[2.94,40873.4],[2.95,40928.0],[2.96,40958.2],[2.97,40988.4],[2.98,41018.6],[2.99,41048.8],[3.0,41079.0]]'::jsonb,
       notas = coalesce(nullif(notas, ''), '') || ' · Tabla control_tanque.xlsx (40.000 L, altura libre 0–3,00 m)',
       actualizado_en = now()
 where planta_id = 'PA-01' and insumo = 'cap' and nombre = 'Tanque de CAP' and tabla is null;

-- ── 3) Costos ───────────────────────────────────────────────────────────────
alter table public.plantas add column if not exists costo_fijo_mes numeric check (costo_fijo_mes is null or costo_fijo_mes >= 0);
alter table public.planta_formulas add column if not exists componentes jsonb not null default '[]'::jsonb;   -- [{"nombre","pct","precio_id"}]

create table if not exists public.planta_precios (
  id          bigserial primary key,
  planta_id   text not null references public.plantas(id) on update cascade on delete cascade,
  insumo      text not null check (insumo in ('cap', 'fuel', 'gasoil', 'arido', 'filler', 'cemento', 'aditivo', 'agua', 'otro')),
  nombre      text not null,
  unidad      text not null default 't' check (unidad in ('t', 'L', 'm3', 'kg')),
  precio      numeric not null check (precio >= 0),
  moneda      text not null default 'Gs' check (moneda in ('Gs', 'USD')),
  desde       date not null default current_date,
  recurso_id  text,                 -- opcional: recurso del maestro (para traer el precio de una obra)
  notas       text,
  actualizado_en timestamptz not null default now()
);
create index if not exists planta_precios_planta on public.planta_precios (planta_id, insumo, desde desc);

create table if not exists public.planta_equipos (
  planta_id  text not null references public.plantas(id) on update cascade on delete cascade,
  equipo_id  text not null references public.equipos(id) on update cascade,
  notas      text,
  primary key (planta_id, equipo_id)
);

create or replace function public.planta_ve_costos(p_planta text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.planta_rol(p_planta) = 'admin', false)
      or exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text in ('admin_obra', 'gerente'))
      or exists (select 1 from usuario u where u.email = app_email() and u.activo and u.rol in ('admin', 'gerente'))
$$;
grant execute on function public.planta_ve_costos(text) to authenticated;

alter table public.planta_precios enable row level security;
alter table public.planta_equipos enable row level security;
drop policy if exists planta_precios_ver on public.planta_precios;
create policy planta_precios_ver on public.planta_precios for select to authenticated using (public.planta_ve_costos(planta_id));
drop policy if exists planta_precios_admin on public.planta_precios;
create policy planta_precios_admin on public.planta_precios for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists planta_equipos_ver on public.planta_equipos;
create policy planta_equipos_ver on public.planta_equipos for select to authenticated using (public.planta_rol(planta_id) is not null);
drop policy if exists planta_equipos_admin on public.planta_equipos;
create policy planta_equipos_admin on public.planta_equipos for all to authenticated using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.planta_precios, public.planta_equipos to authenticated;
grant usage, select on sequence public.planta_precios_id_seq to authenticated;

-- plantas_acceso: agrega si la persona ve costos
create or replace function public.plantas_acceso()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'planta', p.id, 'tipo', p.tipo, 'nombre', coalesce(p.nombre, e.descripcion), 'rol', r.rol,
           'recarga_cap', (r.rol = 'admin' or exists (select 1 from perfiles pf where pf.id = auth.uid() and pf.activo and pf.rol::text = 'admin_obra')),
           'costos', public.planta_ve_costos(p.id))
           order by p.id), '[]'::jsonb)
  from plantas p
  join equipos e on e.id = p.id
  cross join lateral (select public.planta_rol(p.id) as rol) r
  where p.activo and r.rol is not null
$$;

-- Tarifa del maestro (tarifas_equipos) para un equipo en una obra y fecha:
-- la de esa unidad de negocio vigente a la fecha (la de fecha_hasta más próxima);
-- si no hay para esa obra, la última vigente de cualquier obra.
create or replace function public.planta_tarifa(p_equipo text, p_obra_codigo text, p_fecha date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.tarifa1 from tarifas_equipos t where t.equipo_id = p_equipo and t.unidad_negocio = p_obra_codigo
       and coalesce(t.fecha_hasta, '2999-12-31') >= p_fecha and t.tarifa1 > 0 order by t.fecha_hasta nulls last limit 1),
    (select t.tarifa1 from tarifas_equipos t where t.equipo_id = p_equipo
       and coalesce(t.fecha_hasta, '2999-12-31') >= p_fecha and t.tarifa1 > 0 order by t.fecha_hasta desc nulls first, t.tarifa1 desc limit 1),
    (select t.tarifa1 from tarifas_equipos t where t.equipo_id = p_equipo and t.tarifa1 > 0 order by t.fecha_hasta desc nulls first limit 1))
$$;
grant execute on function public.planta_tarifa(text, text, date) to authenticated;

-- Costo de las máquinas de la planta en un período: horas del parte diario × tarifa.
-- Solo cuentan los partes cargados en la obra donde está la planta (la obra de los
-- partes de la propia planta y la obra destino de sus jornadas en el período): si la
-- PC-04 se fue a otra obra, esas horas no se le cargan a la planta (salen en horas_fuera).
drop function if exists public.planta_costo_equipos(text, date, date);
create or replace function public.planta_costo_equipos(p_planta text, p_desde date, p_hasta date)
returns table (equipo_id text, descripcion text, horas numeric, partes bigint, costo numeric, sin_tarifa bigint, horas_fuera numeric, obras text)
language sql stable security definer set search_path = public as $$
  with obras_planta as (
    select split_part(pa.obra_clave, '_', 1) as cod from partes pa where pa.equipo_id = p_planta and pa.fecha between p_desde and p_hasta and pa.obra_clave is not null
    union
    select split_part(j.obra_clave, '_', 1) from planta_jornadas j where j.planta_id = p_planta and j.fecha between p_desde and p_hasta and j.obra_clave is not null
  ), pt as (
    select pa.*, split_part(pa.obra_clave, '_', 1) as cod,
           (split_part(pa.obra_clave, '_', 1) in (select cod from obras_planta)) as en_planta,
           public.planta_tarifa(pa.equipo_id, split_part(pa.obra_clave, '_', 1), pa.fecha) as tarifa
    from partes pa
    where pa.fecha between p_desde and p_hasta and pa.equipo_id in (select x.equipo_id from planta_equipos x where x.planta_id = p_planta)
  )
  select pe.equipo_id, e.descripcion,
         coalesce(sum(coalesce(pt.horas_horometro, 0)) filter (where pt.en_planta), 0),
         count(pt.id) filter (where pt.en_planta),
         coalesce(sum(coalesce(pt.horas_horometro, 0) * coalesce(pt.tarifa, 0)) filter (where pt.en_planta), 0),
         count(pt.id) filter (where pt.en_planta and pt.tarifa is null),
         coalesce(sum(coalesce(pt.horas_horometro, 0)) filter (where not pt.en_planta), 0),
         (select string_agg(cod, ', ') from obras_planta)
  from planta_equipos pe
  join equipos e on e.id = pe.equipo_id
  left join pt on pt.equipo_id = pe.equipo_id
  where pe.planta_id = p_planta and public.planta_ve_costos(p_planta)
  group by pe.equipo_id, e.descripcion
  order by pe.equipo_id
$$;
revoke all on function public.planta_costo_equipos(text, date, date) from public;
grant execute on function public.planta_costo_equipos(text, date, date) to authenticated;

-- Tarifa de la planta en el maestro (para la amortización si no se cargó una propia)
create or replace function public.planta_tarifa_maestro(p_planta text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when public.planta_ve_costos(p_planta) then public.planta_tarifa(p_planta, null, current_date) end
$$;
grant execute on function public.planta_tarifa_maestro(text) to authenticated;

-- Precio de un recurso del maestro en una obra (para «Traer del maestro»)
create or replace function public.planta_precio_maestro(p_planta text, p_recurso text, p_obra_codigo text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when public.planta_ve_costos(p_planta) then
    (select rp.precio_sin_iva from recurso_precio rp where rp.recurso_id = p_recurso and rp.obra_id = p_obra_codigo limit 1) end
$$;
grant execute on function public.planta_precio_maestro(text, text, text) to authenticated;

-- Máquinas que trabajan para la PA-01 (de la planilla Consumo PA01: PC-04 y GG-02; cambiar en Configuración)
insert into public.planta_equipos (planta_id, equipo_id)
select 'PA-01', x from unnest(array['PC-04', 'GG-02']) x
where exists (select 1 from public.equipos e where e.id = x)
on conflict do nothing;

-- ── Verificación ─────────────────────────────────────────────────────────────
select t.planta_id, t.nombre, t.forma, t.modo_lectura, jsonb_array_length(coalesce(t.tabla, '[]'::jsonb)) as puntos_tabla,
       (select count(*) from public.planta_equipos pe where pe.planta_id = t.planta_id) as equipos_planta
from public.planta_tanques t where t.planta_id = 'PA-01' order by t.orden;
