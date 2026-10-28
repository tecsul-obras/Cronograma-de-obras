-- =========================================================================
-- 67_tanques_unificacion.sql · v20261028e  (Equipos › tanques de combustible)
--
-- Aplica la «Propuesta de unificación de tanques de combustible» con las
-- respuestas de Taller (28/10/2026):
--
--  1. Códigos nuevos. Fijos TQ-xx (siguen igual). Montados en camión: el
--     código del camión (TQM-CC02, TQM-CM01…04). Móviles sueltos: TQM-01…07.
--       TQM-5937 → TQM-CC02   TQM-3516 → TQM-CM01   TQM-1051 → TQM-CM03
--       TQM-6035 → TQM-CM04   TQM-3366 → TQM-01     TQM-6522 → TQM-02
--       TQM-2458 → TQM-03     TQM-7244 → TQM-04     TQM-2503 → TQM-05
--       TQM-10   → TQM-06
--     Nuevos: TQM-CM02 (despacho 6.000 L en CM-02) y TQM-07 (móvil 1.000 L,
--     el que rotó por Taller Central, Cruz Monte y Molas Abasto).
--     La base cambia el código en todas las cargas (ON UPDATE CASCADE).
--  2. Códigos viejos: tabla equipo_codigo_anterior. Si un celular manda una
--     carga sin enviar con un código viejo, la base la pasa al nuevo (no la
--     rechaza). Lo mismo al restaurar algo de la papelera.
--  3. TQM-1715 (duplicado del fijo TQ-02, Tembiaporá): sus cargas pasan a
--     TQ-02 y queda dado de baja.
--  4. Bodega 1012599996 (Ruta de la Banana) = fijo TQ-02: sus 1.404 despachos
--     y 11 ingresos de proveedor salen del móvil del CM-04 y pasan a TQ-02
--     (por Submission ID de JotForm; el texto de la bodega queda guardado).
--  5. Cargas de JotForm que eran solo texto se vinculan a su tanque (el texto
--     original queda guardado en tanque_salida_texto / receptor_texto).
--  6. Actividad nueva «Trasvase entre tanques» (sale de un tanque y entra a
--     otro: no es consumo). Pasan a trasvase:
--       - todos los despachos cuyo receptor es un tanque (antes «traspaso»);
--       - los despachos de más de 400 L a un camión con tanque de despacho
--         (CC-02, CM-01, CM-03): van a su tanque de despacho.
--  7. Tanques de emulsión/diluido (TQ-03, TQ-06, TQ-08) fuera de la lista de
--     combustible y del stock (se reconocen por el Tipo en Flota).
--  8. Formulario: sección «Trasvase» editable (como las demás).
--
-- Se puede correr dos veces: lo que ya está hecho no se repite.
-- Correr a primera hora, con los despachadores sin cargas pendientes.
-- =========================================================================

begin;

-- ── 1. Códigos anteriores ───────────────────────────────────────────────
create table if not exists public.equipo_codigo_anterior (
  codigo_anterior text primary key,
  equipo_id       text not null references public.equipos(id) on update cascade on delete cascade,
  motivo          text,
  creado_en       timestamptz not null default now()
);
alter table public.equipo_codigo_anterior enable row level security;
drop policy if exists eca_lectura on public.equipo_codigo_anterior;
create policy eca_lectura on public.equipo_codigo_anterior for select to authenticated using (true);
grant select on public.equipo_codigo_anterior to authenticated;

-- ── 2. Renombrar ────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in select * from (values
      ('TQM-5937', 'TQM-CC02'), ('TQM-3516', 'TQM-CM01'), ('TQM-1051', 'TQM-CM03'), ('TQM-6035', 'TQM-CM04'),
      ('TQM-3366', 'TQM-01'),   ('TQM-6522', 'TQM-02'),   ('TQM-2458', 'TQM-03'),   ('TQM-7244', 'TQM-04'),
      ('TQM-2503', 'TQM-05'),   ('TQM-10',   'TQM-06')) as x(viejo, nuevo)
  loop
    if exists (select 1 from equipos where id = r.viejo) and not exists (select 1 from equipos where id = r.nuevo) then
      update equipos set id = r.nuevo where id = r.viejo;
      raise notice '% → %', r.viejo, r.nuevo;
    end if;
    if exists (select 1 from equipos where id = r.nuevo) then
      insert into equipo_codigo_anterior (codigo_anterior, equipo_id, motivo)
      values (r.viejo, r.nuevo, 'Unificación de tanques (SQL 67)')
      on conflict (codigo_anterior) do nothing;
    end if;
  end loop;
end $$;

-- ── 3. Tanques nuevos ───────────────────────────────────────────────────
insert into public.equipos (id, descripcion, categoria, tipo, capacidad, capacidad_unidad, activo,
                            en_parte_diario, usa_horometro, usa_km, propiedad, atributos)
values
  ('TQM-CM02', 'Tanque de despacho 6.000 L – en CM-02', 'tanque', 'Tanque de Combustible', 6000, 'L', true,
   false, false, false, 'Propio', '{"montado_en": "CM-02"}'),
  ('TQM-07', 'Tanque móvil 1.000 L – Taller Central', 'tanque', 'Tanque de Combustible', 1000, 'L', true,
   false, false, false, 'Propio', '{}')
on conflict (id) do nothing;
update public.equipo_estado s set ubicacion = coalesce(s.ubicacion, c.ubicacion), asignacion = coalesce(s.asignacion, c.asignacion)
  from public.equipo_estado c where s.equipo_id = 'TQM-CM02' and c.equipo_id = 'CM-02';
update public.equipo_estado set ubicacion = coalesce(ubicacion, 'Taller Central') where equipo_id = 'TQM-07';

-- ── 4. Descripciones, tipo y datos de Monday ────────────────────────────
-- (la ubicación del día no va en el nombre: la muestra Flota)
update public.equipos e set
    descripcion = x.descr,
    atributos = coalesce(e.atributos, '{}'::jsonb) || x.attr
  from (values
    ('TQ-01',    'Tanque fijo 30.000 L – Chaco Sur (Ruta 12)',             '{}'::jsonb),
    ('TQ-02',    'Tanque fijo 30.000 L – Ruta de la Banana',               '{"codigo_bodega": "1012599996", "lugar": "RUTA DE LA BANANA - TEMBIAPORÁ"}'),
    ('TQ-03',    'Tanque emulsión/diluido 30.000 L – Ruta de la Banana',   '{}'),
    ('TQ-04',    'Tanque fijo 30.000 L – CT Vial',                         '{}'),
    ('TQ-05',    'Tanque fijo 15.000 L – Taller Central',                  '{"lugar": "TALLER CENTRAL - LUQUE"}'),
    ('TQ-06',    'Tanque emulsión/diluido 30.000 L – CT Vial',             '{}'),
    ('TQ-07',    'Tanque fijo 30.000 L – Frigorífico Cruzmonte',           '{}'),
    ('TQ-08',    'Tanque emulsión/diluido 15.000 L – CT Vial',             '{}'),
    ('TQ-09',    'Tanque fijo – Consorcio Victoria',                       '{}'),
    ('TQM-CC02', 'Tanque de despacho 13.000 L – en CC-02 (Chaco Sur)',     '{"montado_en": "CC-02"}'),
    ('TQM-CM01', 'Tanque de despacho 2.000 L – en CM-01 (Cruzmonte)',      '{"montado_en": "CM-01"}'),
    ('TQM-CM03', 'Tanque de despacho 6.000 L – en CM-03 (Chaco Sur)',      '{"montado_en": "CM-03"}'),
    ('TQM-CM04', 'Tanque de despacho 5.000 L – en CM-04 (Ruta de la Banana)', '{"montado_en": "CM-04"}'),
    ('TQM-01',   'Tanque móvil 3.000 L – Ruta de la Leche',                '{"codigo_bodega": "1011899996"}'),
    ('TQM-02',   'Tanque móvil 1.000 L – CT Vial (Minga Guazú)',           '{"codigo_bodega": "1011799996"}'),
    ('TQM-03',   'Tanque móvil 1.000 L – CCC/Tecsul',                      '{}'),
    ('TQM-04',   'Tanque móvil 1.000 L – Olimpia',                         '{}'),
    ('TQM-05',   'Tanque móvil 1.000 L – CECON',                           '{}'),
    ('TQM-06',   'Tanque móvil – Consorcio Victoria',                      '{}')
  ) as x(id, descr, attr)
 where e.id = x.id
   and (e.descripcion is distinct from x.descr or not (coalesce(e.atributos, '{}'::jsonb) @> x.attr));
-- La bodega 1012599996 era la del fijo TQ-02, no la del móvil del CM-04
update public.equipos set atributos = atributos - 'codigo_bodega'
 where id = 'TQM-CM04' and atributos->>'codigo_bodega' = '1012599996';

-- ── 5. TQM-1715 es el mismo tanque que TQ-02 ────────────────────────────
update public.combustible_movimientos set tanque_salida_id = 'TQ-02' where tanque_salida_id = 'TQM-1715';
update public.combustible_movimientos set tanque_fijo_id   = 'TQ-02' where tanque_fijo_id   = 'TQM-1715';
update public.combustible_movimientos set equipo_id        = 'TQ-02' where equipo_id        = 'TQM-1715';
update public.equipos set activo = false, fecha_baja = coalesce(fecha_baja, date '2026-10-28'),
       descripcion = 'Duplicado de TQ-02 (dado de baja)',
       notas = concat_ws(E'\n', nullif(notas, ''), 'Era el mismo tanque que TQ-02 (fijo 30.000 L, Tembiaporá): sus cargas pasaron a TQ-02 (SQL 67).')
 where id = 'TQM-1715' and activo;
insert into public.equipo_codigo_anterior (codigo_anterior, equipo_id, motivo)
select 'TQM-1715', 'TQ-02', 'Duplicado de TQ-02 (SQL 67)' where exists (select 1 from public.equipos where id = 'TQ-02')
on conflict (codigo_anterior) do nothing;

-- ── 6. Actividad «Trasvase entre tanques» ───────────────────────────────
alter table public.combustible_movimientos drop constraint if exists comb_actividad_valida;
alter table public.combustible_movimientos add constraint comb_actividad_valida
  check (actividad = any (array['Despacho de combustible', 'Ingreso de combustible', 'Medición de tanque',
                                'Prueba de desviación', 'Trasvase entre tanques']));
alter table public.combustible_movimientos drop constraint if exists comb_trasvase_completo;

-- Códigos viejos → nuevos al cargar; litros del cuenta litros también en trasvases
create or replace function public.fn_comb_antes()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  new.tanque_salida_id := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_salida_id), new.tanque_salida_id);
  new.tanque_fijo_id   := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_fijo_id), new.tanque_fijo_id);
  new.equipo_id        := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.equipo_id), new.equipo_id);
  if new.actividad in ('Despacho de combustible', 'Trasvase entre tanques') and new.litros is null
     and new.cuenta_litros_final is not null and new.cuenta_litros_inicial is not null then
    new.litros := new.cuenta_litros_final - new.cuenta_litros_inicial;
  end if;
  if tg_op = 'UPDATE' then
    new.editado_en := now();
  end if;
  return new;
end;
$function$;

-- ── 7. Bodega 1012599996 = TQ-02 (por Submission ID) ────────────────────
create temp table _banana_salida (sid text primary key) on commit drop;
-- (repo público: la lista de 1.404 Submission ID está solo en la copia de Drive,
--  migracion_supabase\tanques\67_tanques_unificacion.sql — correr esa)
insert into _banana_salida select sid from (values ('')) x(sid) where false;
create temp table _banana_fijo (sid text primary key) on commit drop;
insert into _banana_fijo select sid from (values ('')) x(sid) where false;

update public.combustible_movimientos m
   set tanque_salida_id = 'TQ-02',
       tanque_salida_texto = coalesce(m.tanque_salida_texto, '1012599996_RUTA DE LA BANANA_BODEGA COMBUSTIBLE')
  from _banana_salida b
 where m.submission_id = b.sid and m.tanque_salida_id = 'TQM-CM04';
update public.combustible_movimientos m
   set tanque_fijo_id = 'TQ-02',
       observaciones = concat_ws(' | ', nullif(m.observaciones, ''), 'Tanque fijo JotForm: 1012599996_RUTA DE LA BANANA_BODEGA COMBUSTIBLE')
  from _banana_fijo b
 where m.submission_id = b.sid and m.tanque_fijo_id = 'TQM-CM04';

-- ── 8. Textos de JotForm → tanque ───────────────────────────────────────
create temp table _texto_tanque (clave text primary key, tanque text not null) on commit drop;
insert into _texto_tanque values
  ('TANQUE MÓVIL CM-02',                                       'TQM-CM02'),
  ('TANQUE MÓVIL MINGA GUAZU (1000L)',                         'TQM-02'),
  ('1011799996_TANQUE MÓVIL MINGA GUAZU (1000L)',              'TQM-02'),
  ('1011899996_RUTA DE LA LECHE_BODEGA MOVIL2 COMBUSTIBLE',    'TQM-01'),
  ('TANQUE MÓVIL RUTA DE LA LECHE (3000L)',                    'TQM-01'),
  ('TANQUE MÓVIL TALLER CENTRAL (1000L)',                      'TQM-07'),
  ('TANQUE MÓVIL CRUZ MONTE (1000L)',                          'TQM-07'),
  ('TANQUE MÓVIL MOLAS ABASTO (1000L)',                        'TQM-07'),
  ('100000000_BODEGA DE COMBUSTIBLE CONSORCIO VICTORIA',       'TQ-09'),
  ('100000000_BODEGA COMBUSTIBLE CONSORCIO VICTORIA',          'TQ-09'),
  ('100000000_BODEGA MOVIL DE COMBUSTIBLE CONSORCIO VICTORIA', 'TQM-06'),
  ('100000000_BODEGA MOVIL COMBUSTIBLE CONSORCIO VICTORIA',    'TQM-06'),
  ('TANQUE FIJO CRUZ MONTE',                                   'TQ-07'),
  ('TANQUE FIJO CTVIAL',                                       'TQ-04'),
  ('TANQUE FIJO TALLER CENTRAL',                               'TQ-05');
-- misma forma de escribir: mayúsculas, sin espacios dobles ni después de «_»
create or replace function pg_temp.clave_tq(t text) returns text language sql immutable as
  $$ select replace(regexp_replace(upper(trim(t)), '\s+', ' ', 'g'), '_ ', '_') $$;

-- tanque de salida (despachos)
update public.combustible_movimientos m set tanque_salida_id = x.tanque
  from _texto_tanque x
 where m.tanque_salida_id is null and m.tanque_salida_texto is not null
   and pg_temp.clave_tq(m.tanque_salida_texto) = x.clave;
-- tanque que recibe (traspasos que quedaron como texto)
update public.combustible_movimientos m set equipo_id = x.tanque
  from _texto_tanque x
 where m.equipo_id is null and m.receptor_texto is not null
   and m.actividad = 'Despacho de combustible'
   and pg_temp.clave_tq(m.receptor_texto) = x.clave;
-- tanque fijo de ingresos / mediciones / pruebas (el texto quedó en observaciones)
update public.combustible_movimientos m set tanque_fijo_id = x.tanque
  from _texto_tanque x
 where m.tanque_fijo_id is null and m.observaciones like '%Tanque fijo JotForm:%'
   and m.actividad <> 'Despacho de combustible'
   and pg_temp.clave_tq(substring(m.observaciones from 'Tanque fijo JotForm: ([^|]*)')) = x.clave;

-- ── 9. Traspasos → Trasvase entre tanques ───────────────────────────────
update public.combustible_movimientos m
   set actividad = 'Trasvase entre tanques', propietario = 'Tecsul'
  from public.equipos t
 where m.actividad = 'Despacho de combustible' and t.id = m.equipo_id and t.categoria = 'tanque';

-- Llenado del tanque de despacho cargado como despacho al camión (> 400 L)
update public.combustible_movimientos m
   set actividad = 'Trasvase entre tanques', equipo_id = t.id, propietario = 'Tecsul',
       observaciones = concat_ws(' | ', nullif(m.observaciones, ''), 'Antes: despacho a ' || m.equipo_id || ' (SQL 67)')
  from public.equipos t
 where m.actividad = 'Despacho de combustible'
   and t.categoria = 'tanque' and t.activo and t.atributos->>'montado_en' = m.equipo_id
   and m.litros > 400
   and m.tanque_salida_id is distinct from t.id;

alter table public.combustible_movimientos add constraint comb_trasvase_completo
  check (actividad <> 'Trasvase entre tanques'
         or ((tanque_salida_id is not null or tanque_salida_texto is not null) and equipo_id is not null));

-- ── 10. Último cuenta litros del surtidor: también trasvases ────────────
create or replace function public.ultimo_cuentalitros(p_tanque text)
returns table(cuenta_litros numeric, fecha date, hora time without time zone, equipo text)
language sql stable security definer set search_path to 'public' as $function$
  select c.cuenta_litros_final, c.fecha, c.hora, coalesce(c.equipo_id, c.receptor_texto)
  from combustible_movimientos c
  where c.tanque_salida_id = coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = p_tanque), p_tanque)
    and c.actividad in ('Despacho de combustible', 'Trasvase entre tanques')
    and c.cuenta_litros_final is not null
  order by c.fecha desc, c.hora desc nulls last, c.creado_en desc
  limit 1
$function$;

-- ── 11. Stock de tanques: solo combustible; trasvases entran y salen ────
create or replace view public.v_stock_tanques as
 with base as (
   select t.id as tanque_id, t.descripcion, t.capacidad, s.ubicacion, s.asignacion,
          m_1.fecha as fecha_medicion, m_1.creado_en as medido_en,
          coalesce(m_1.stock_medido, 0::numeric) as stock_base
     from equipos t
     left join equipo_estado s on s.equipo_id = t.id
     left join lateral (
       select c.fecha, c.creado_en, c.stock_medido
         from combustible_movimientos c
        where c.actividad = 'Medición de tanque' and c.stock_medido is not null
          and coalesce(c.tanque_fijo_id, c.tanque_salida_id) = t.id
        order by c.fecha desc, c.creado_en desc
        limit 1) m_1 on true
    where t.categoria = 'tanque' and t.activo
      and coalesce(t.tipo, '') not ilike '%emulsi%' and coalesce(t.tipo, '') not ilike '%diluid%'
 ), mov as (
   select b_1.tanque_id,
          sum(c.litros_ingresados) filter (where c.actividad = 'Ingreso de combustible' and c.tanque_fijo_id = b_1.tanque_id) as ingresos,
          sum(c.litros) filter (where c.actividad in ('Despacho de combustible', 'Trasvase entre tanques') and c.equipo_id = b_1.tanque_id) as traspasos_recibidos,
          sum(c.litros) filter (where c.actividad in ('Despacho de combustible', 'Trasvase entre tanques') and c.tanque_salida_id = b_1.tanque_id) as despachos,
          max(c.fecha) as ultimo_movimiento
     from base b_1
     left join combustible_movimientos c
       on (c.tanque_fijo_id = b_1.tanque_id or c.tanque_salida_id = b_1.tanque_id or c.equipo_id = b_1.tanque_id)
      and (b_1.medido_en is null or c.creado_en > b_1.medido_en)
    group by b_1.tanque_id
 )
 select b.tanque_id, b.descripcion, b.capacidad, b.ubicacion, b.asignacion, b.fecha_medicion, b.medido_en, b.stock_base,
        coalesce(m.ingresos, 0::numeric) as ingresos,
        coalesce(m.traspasos_recibidos, 0::numeric) as traspasos_recibidos,
        coalesce(m.despachos, 0::numeric) as despachos,
        b.stock_base + coalesce(m.ingresos, 0::numeric) + coalesce(m.traspasos_recibidos, 0::numeric) - coalesce(m.despachos, 0::numeric) as stock_estimado,
        case when b.capacidad > 0::numeric
             then round(100::numeric * (b.stock_base + coalesce(m.ingresos, 0::numeric) + coalesce(m.traspasos_recibidos, 0::numeric) - coalesce(m.despachos, 0::numeric)) / b.capacidad)
             else null::numeric end as porcentaje,
        b.fecha_medicion is null as sin_medicion,
        m.ultimo_movimiento
   from base b
   left join mov m on m.tanque_id = b.tanque_id;

-- ── 12. Formulario: sección Trasvase (editable como las demás) ──────────
insert into public.form_secciones (clave, titulo, icono, orden, activa, formulario)
values ('c_trasvase', 'Trasvase', '', 6, true, 'combustible')
on conflict (clave) do nothing;
insert into public.form_campos (seccion_id, clave, etiqueta, tipo, orden, requerido, activo, es_sistema, bloqueado, opciones)
select s.id, x.clave, x.etiqueta, x.tipo, x.orden, x.req, true, true, x.bloq, null
  from (values
    ('tra_tanque',      'Tanque de salida',           'catalogo', 1, true,  true),
    ('tra_destino',     'Tanque que recibe',          'catalogo', 2, true,  true),
    ('tra_cl_inicial',  'Cuenta litros inicial',      'numero',   3, false, false),
    ('tra_cl_final',    'Cuenta litros final',        'numero',   4, false, false),
    ('tra_litros',      'Litros trasvasados',         'numero',   5, true,  true),
    ('tra_foto_cl_ini', 'Foto cuenta litros inicial', 'foto',     6, false, false),
    ('tra_foto_cl_fin', 'Foto cuenta litros final',   'foto',     7, false, false)
  ) as x(clave, etiqueta, tipo, orden, req, bloq)
  join public.form_secciones s on s.clave = 'c_trasvase'
on conflict (clave) do nothing;

commit;

-- ── Verificación ────────────────────────────────────────────────────────
-- Tanques: código, descripción, cargas como salida / fijo / recibe
select e.id, e.descripcion, e.tipo, e.capacidad, e.activo, e.atributos->>'montado_en' as montado_en,
       (select count(*) from public.combustible_movimientos m where m.tanque_salida_id = e.id) as salidas,
       (select count(*) from public.combustible_movimientos m where m.tanque_fijo_id = e.id) as fijo,
       (select count(*) from public.combustible_movimientos m where m.equipo_id = e.id) as recibe
  from public.equipos e where e.categoria = 'tanque' order by e.activo desc, e.id;

-- Resumen esperado (con los datos del 28/10/2026):
--   trasvases ≈ 650 (10 con la nota «Antes: despacho a …»); despachos sin
--   tanque de salida = 26 «(sin tanque de salida en JotForm)»; TQ-02 ≈ 1.405
--   salidas y 11 ingresos; códigos anteriores = 11
select 'trasvases' as que, count(*) from public.combustible_movimientos where actividad = 'Trasvase entre tanques'
union all select 'despachos solo texto', count(*) from public.combustible_movimientos
 where actividad = 'Despacho de combustible' and tanque_salida_id is null
union all select 'códigos anteriores', count(*) from public.equipo_codigo_anterior;

-- REVERTIR (códigos): los códigos viejos están en equipo_codigo_anterior;
-- update equipos set id = '<viejo>' where id = '<nuevo>' los devuelve.
