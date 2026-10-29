-- ══════════════════════════════════════════════════════════════════
-- 71 · Parte diario: foto del parte en papel (obligatoria, último campo)
--      Combustible: «Trasvase» pasa a llamarse «Traspaso»   (v20261029a)
--
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de publicar la app
-- (equipos-v78). Se puede volver a correr. No borra nada.
-- ══════════════════════════════════════════════════════════════════
begin;

-- ── 1. Parte diario: columna para la foto del parte en papel ──────────
alter table public.partes add column if not exists img_parte_papel text;
comment on column public.partes.img_parte_papel is
  'Ruta en Storage de la foto del parte diario en papel (SQL 71). Obligatoria en la app desde v20261029a.';
grant select, insert, update (img_parte_papel) on public.partes to authenticated;

-- Campo del formulario: último de la última sección («Obra y actividad»)
insert into public.form_campos (seccion_id, clave, etiqueta, tipo, orden, requerido, activo,
                                es_sistema, bloqueado, ayuda, columna_destino)
select s.id, 'foto_parte_papel', 'Foto del parte diario en papel', 'foto',
       (select coalesce(max(c.orden), 0) + 1 from public.form_campos c where c.seccion_id = s.id),
       true, true, true, false,
       'Sacale una foto al parte en papel firmado, que se lea entero.',
       'img_parte_papel'
  from public.form_secciones s
 where s.formulario = 'parte'
 order by s.orden desc
 limit 1
on conflict (clave) do update
   set requerido = true, activo = true, columna_destino = 'img_parte_papel';

-- ── 2. «Trasvase entre tanques» → «Traspaso entre tanques» ────────────
alter table public.combustible_movimientos drop constraint if exists comb_actividad_valida;
alter table public.combustible_movimientos drop constraint if exists comb_trasvase_completo;

update public.combustible_movimientos
   set actividad = 'Traspaso entre tanques'
 where actividad = 'Trasvase entre tanques';

alter table public.combustible_movimientos add constraint comb_actividad_valida
  check (actividad = any (array['Despacho de combustible', 'Ingreso de combustible', 'Medición de tanque',
                                'Prueba de desviación', 'Traspaso entre tanques']));
alter table public.combustible_movimientos add constraint comb_trasvase_completo
  check (actividad <> 'Traspaso entre tanques'
         or ((tanque_salida_id is not null or tanque_salida_texto is not null) and equipo_id is not null));

-- Trigger de carga: igual que en SQL 67 + un celular con la app vieja que
-- todavía manda «Trasvase entre tanques» se guarda como «Traspaso».
create or replace function public.fn_comb_antes()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.actividad = 'Trasvase entre tanques' then
    new.actividad := 'Traspaso entre tanques';
  end if;
  new.tanque_salida_id := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_salida_id), new.tanque_salida_id);
  new.tanque_fijo_id   := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.tanque_fijo_id), new.tanque_fijo_id);
  new.equipo_id        := coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = new.equipo_id), new.equipo_id);
  if new.actividad in ('Despacho de combustible', 'Traspaso entre tanques') and new.litros is null
     and new.cuenta_litros_final is not null and new.cuenta_litros_inicial is not null then
    new.litros := new.cuenta_litros_final - new.cuenta_litros_inicial;
  end if;
  if tg_op = 'UPDATE' then
    new.editado_en := now();
  end if;
  return new;
end;
$function$;

create or replace function public.ultimo_cuentalitros(p_tanque text)
returns table(cuenta_litros numeric, fecha date, hora time without time zone, equipo text)
language sql stable security definer set search_path to 'public' as $function$
  select c.cuenta_litros_final, c.fecha, c.hora, coalesce(c.equipo_id, c.receptor_texto)
  from combustible_movimientos c
  where c.tanque_salida_id = coalesce((select a.equipo_id from equipo_codigo_anterior a where a.codigo_anterior = p_tanque), p_tanque)
    and c.actividad in ('Despacho de combustible', 'Traspaso entre tanques')
    and c.cuenta_litros_final is not null
  order by c.fecha desc, c.hora desc nulls last, c.creado_en desc
  limit 1
$function$;

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
          sum(c.litros) filter (where c.actividad in ('Despacho de combustible', 'Traspaso entre tanques') and c.equipo_id = b_1.tanque_id) as traspasos_recibidos,
          sum(c.litros) filter (where c.actividad in ('Despacho de combustible', 'Traspaso entre tanques') and c.tanque_salida_id = b_1.tanque_id) as despachos,
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

-- Formulario de combustible: título de la sección y etiqueta de litros
-- (la clave interna c_trasvase / tra_* no cambia)
update public.form_secciones set titulo = 'Traspaso'
 where clave = 'c_trasvase' and titulo = 'Trasvase';
update public.form_campos set etiqueta = 'Litros traspasados'
 where clave = 'tra_litros' and etiqueta = 'Litros trasvasados';

commit;

-- ── Verificación ──────────────────────────────────────────────────────
-- Esperado: traspasos ≈ 651 · trasvases = 0 · el campo nuevo al final de «Obra y actividad»
select 'traspasos' as que, count(*)::text as valor from public.combustible_movimientos where actividad = 'Traspaso entre tanques'
union all
select 'trasvases (debe ser 0)', count(*)::text from public.combustible_movimientos where actividad = 'Trasvase entre tanques'
union all
select 'sección combustible', titulo from public.form_secciones where clave = 'c_trasvase'
union all
select 'campo foto parte papel', s.titulo || ' · orden ' || c.orden || ' · obligatorio=' || c.requerido
  from public.form_campos c join public.form_secciones s on s.id = c.seccion_id
 where c.clave = 'foto_parte_papel';
