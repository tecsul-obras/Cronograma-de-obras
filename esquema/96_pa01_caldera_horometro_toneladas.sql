-- =========================================================================
-- 96_pa01_caldera_horometro_toneladas.sql · v20261106b (equipos-v93)
--
-- Caso PA-01 (06/11/2026): en JotForm la planta asfáltica y su caldera se
-- cargaron siempre con el mismo código PA-01. La planta la carga José
-- Villasanti (7224913) y la caldera Alipio Ojeda (2236473). La caldera ya
-- tiene su código en Flota: CDR-01.
--
-- Además las plantas y calderas no tienen horómetro: en el campo horómetro
-- se cargan las toneladas producidas (la tarifa es por tonelada), así que
-- no tiene sentido exigir que el inicial sea igual al final del parte
-- anterior.
--
-- Qué hace este SQL:
--   1. equipo_horometro_libre(equipo): verdadero para las familias PA y CDR
--      (también PA-xx / CDR-xx por el código). Para esos equipos:
--        · no se marcan saltos ni «para revisar» (salto_evaluar),
--        · no aplica «A disposición sin horas» (fn_parte_disposicion_sin_horas),
--        · cerrar una OT de taller no crea parte puente (fn_ot_cierre_puente),
--        · el Panel de anomalías no avisa «Horómetro retrocede».
--      (En la app el formulario tampoco controla: sin saltos, no retrocede,
--      máximo 24 h / aviso 16 h, y no completa solo el inicial.)
--   2. Tabla sync_jf_equipo_reasignar + sync_jf_equipo(): la sincronización
--      automática de JotForm (SQL 95) pasa a CDR-01 todo parte que llega como
--      PA-01 cargado por Alipio Ojeda. Sin esto, cada hora devolvería los
--      partes corregidos a PA-01 y los nuevos entrarían como PA-01.
--   3. Pasa a CDR-01 los partes y despachos de combustible históricos de
--      PA-01 cargados por Alipio Ojeda. Los de José Villasanti quedan en PA-01.
--   4. Operador habitual: PA-01 = José Villasanti, CDR-01 = Alipio Ojeda.
--
-- Correr entero en el SQL Editor. Al final muestra un resumen.
-- =========================================================================

-- ── 1. Equipos sin control de horómetro ─────────────────────────────────
create or replace function public.equipo_horometro_libre(p_equipo text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select upper(coalesce(e.familia, '')) in ('PA', 'CDR')
         or upper(e.id) like 'PA-%' or upper(e.id) like 'CDR-%'
       from equipos e where e.id = p_equipo),
    upper(coalesce(p_equipo, '')) like 'PA-%' or upper(coalesce(p_equipo, '')) like 'CDR-%')
$$;
grant execute on function public.equipo_horometro_libre(text) to authenticated;

create or replace function public.salto_evaluar(p_parte uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p     partes%rowtype;
  ant   partes%rowtype;
  ex    horometro_saltos%rowtype;
  gap   numeric;
  ndias int;
  tope  int := coalesce((select valor from form_reglas where clave = 'dias_parado_revisar'), 5)::int;
  ev_l  numeric;
  ev_f  date;
  ev_t  text;
  v_ot  bigint;
  v_tipo text;
  ant_taller boolean;
  p_taller boolean;
begin
  select * into p from partes where id = p_parte;
  if not found or p.origen = 'puente' then return; end if;

  select * into ex from horometro_saltos where parte_id = p_parte;
  if found and ex.estado <> 'pendiente' then return; end if;   -- lo resuelto no se toca

  -- SQL 96: plantas (PA) y calderas (CDR) no tienen horómetro: ahí se cargan
  -- toneladas, así que no hay cadena que controlar.
  if equipo_horometro_libre(p.equipo_id) then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  if p.horometro_inicial is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  select * into ant from partes o
   where o.equipo_id = p.equipo_id and o.id <> p.id and o.horometro_final is not null
     and (o.fecha < p.fecha or (o.fecha = p.fecha and o.creado_en < p.creado_en))
   order by o.fecha desc, o.creado_en desc
   limit 1;
  if not found then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  gap   := round(p.horometro_inicial - ant.horometro_final, 1);
  ndias := p.fecha - ant.fecha;
  ant_taller := ant.obra_clave like '3050100006%' or coalesce(ant.actividad_dia, '') ilike '%taller%';
  p_taller   := p.obra_clave like '3050100006%' or coalesce(p.actividad_dia, '') ilike '%taller%';

  -- Lecturas de taller entre los dos partes mayores al final del anterior
  -- (las del mismo día del parte caen dentro del turno: no cuentan)
  select x.l, x.f into ev_l, ev_f from (
      select r.lectura l, r.fecha f
        from ot_registros r join ordenes_trabajo o on o.id = r.ot_id
       where o.equipo_id = p.equipo_id and r.tipo_medicion = 'Horómetro'
         and r.fecha > ant.fecha and r.fecha < p.fecha
      union all
      select o.lectura_salida, (o.fecha_cierre at time zone 'America/Asuncion')::date
        from ordenes_trabajo o
       where o.equipo_id = p.equipo_id and o.lectura_salida is not null
         and (o.fecha_cierre at time zone 'America/Asuncion')::date > ant.fecha
         and (o.fecha_cierre at time zone 'America/Asuncion')::date <= p.fecha
    ) x
   where x.l > ant.horometro_final + 0.05
     and x.l <= coalesce(p.horometro_final, x.l) + 0.05
   order by x.l desc
   limit 1;
  if ev_l is not null then
    ev_t := 'El taller registró ' || ev_l || ' h el ' || to_char(ev_f, 'DD/MM/YYYY')
         || ' (el parte anterior terminó en ' || ant.horometro_final || ' h)';
  end if;

  -- OT de taller en el período: entró después del parte anterior, o el
  -- parte anterior ya era de taller y la OT seguía abierta. Solo cuenta
  -- cuando la máquina SALE de taller (el parte nuevo no es de taller): los
  -- partes diarios «A disposición equipo en taller» no se marcan uno por uno.
  select o.id into v_ot from ordenes_trabajo o
   where o.equipo_id = p.equipo_id and o.tipo_ot = 'Taller'
     and coalesce(o.fecha_ingreso, o.creado_en)::date <= p.fecha
     and (o.fecha_cierre is null or (o.fecha_cierre at time zone 'America/Asuncion')::date >= ant.fecha)
     and (coalesce(o.fecha_ingreso, o.creado_en)::date >= ant.fecha or ant_taller)
     and not p_taller
   order by coalesce(o.fecha_ingreso, o.creado_en) desc
   limit 1;

  v_tipo := case
    when gap > 0.05 then 'salto'
    when gap >= -0.05 and ant.origen <> 'puente'
         and (ev_l is not null or ndias >= tope or v_ot is not null) then 'revision'
  end;

  if v_tipo is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  if ev_t is null and v_ot is not null and v_tipo = 'revision' then
    ev_t := 'La máquina pasó por la OT de taller ' || (select numero from ordenes_trabajo where id = v_ot)
         || ' entre los dos partes';
  end if;

  insert into horometro_saltos as s
    (equipo_id, parte_id, parte_anterior_id, tipo, fecha_desde, fecha_hasta, dias,
     lectura_desde, lectura_hasta, horas, evidencia_lectura, evidencia_fecha, evidencia, ot_id, causa_declarada)
  values
    (p.equipo_id, p.id, ant.id, v_tipo, ant.fecha, p.fecha, ndias,
     ant.horometro_final, p.horometro_inicial, greatest(gap, 0), ev_l, ev_f, ev_t, v_ot,
     nullif(p.extras->>'salto_causa', ''))
  on conflict (parte_id) do update set
     equipo_id = excluded.equipo_id, parte_anterior_id = excluded.parte_anterior_id, tipo = excluded.tipo,
     fecha_desde = excluded.fecha_desde, fecha_hasta = excluded.fecha_hasta, dias = excluded.dias,
     lectura_desde = excluded.lectura_desde, lectura_hasta = excluded.lectura_hasta, horas = excluded.horas,
     evidencia_lectura = excluded.evidencia_lectura, evidencia_fecha = excluded.evidencia_fecha,
     evidencia = excluded.evidencia, ot_id = excluded.ot_id,
     causa_declarada = coalesce(excluded.causa_declarada, s.causa_declarada)
  where s.estado = 'pendiente';
end;
$function$;

create or replace function public.fn_parte_disposicion_sin_horas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.origen in ('jotform', 'puente')
     or equipo_horometro_libre(new.equipo_id)   -- SQL 96: PA / CDR cargan toneladas
     or coalesce((select valor from form_reglas where clave = 'disposicion_sin_horas'), 1) = 0
     or new.horometro_inicial is null or new.horometro_final is null
     or new.horometro_final - new.horometro_inicial <= 0.05
     or not (new.actividad_dia in ('A disposición en pista', 'Receso', 'Sin actividad por lluvia')
             or new.actividad_dia ilike 'Sin operador%') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.actividad_dia is not distinct from old.actividad_dia
     and new.horometro_inicial is not distinct from old.horometro_inicial
     and new.horometro_final is not distinct from old.horometro_final then
    return new;   -- partes viejos que ya estaban así se pueden seguir editando
  end if;
  raise exception 'MAQUINA SIN TRABAJAR CON HORAS: con «%» el horómetro final tiene que ser igual al inicial (% → %). Si la máquina trabajó, elegí Con Actividad; si el horómetro subió fuera del turno, poné como inicial el valor con el que arrancó hoy.',
    new.actividad_dia, new.horometro_inicial, new.horometro_final
    using errcode = 'P0001';
end;
$function$;

create or replace function public.fn_ot_cierre_puente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ult  partes%rowtype;
  taller text := (select clave from obras where clave like '3050100006%' limit 1);
  v_fecha date;
  medicion text;
begin
  if new.estado <> 'Cerrada' or old.estado = 'Cerrada' or new.origen = 'jotform'
     or new.equipo_id is null or equipo_horometro_libre(new.equipo_id) or new.lectura_salida is null or coalesce(new.tipo_ot, '') <> 'Taller' then
    return new;
  end if;
  select r.tipo_medicion into medicion from ot_registros r
   where r.ot_id = new.id and r.lectura is not null order by r.creado_en desc limit 1;
  if coalesce(medicion, new.tipo_medicion, 'Horómetro') <> 'Horómetro' then return new; end if;

  select * into ult from partes o
   where o.equipo_id = new.equipo_id and o.horometro_final is not null
   order by o.fecha desc, o.creado_en desc limit 1;
  if not found or new.lectura_salida <= ult.horometro_final + 0.05 then return new; end if;

  -- Si la máquina ya volvió a trabajar en una obra después de entrar al
  -- taller, la diferencia no es solo del taller: no se inventa el puente
  -- (si hubo salto, el parte siguiente lo marca para revisar).
  if not (ult.fecha <= coalesce(new.fecha_ingreso, new.creado_en)::date
          or ult.obra_clave = taller
          or ult.actividad_dia ilike '%taller%'
          or ult.origen = 'puente') then
    return new;
  end if;

  v_fecha := greatest((coalesce(new.fecha_cierre, now()) at time zone 'America/Asuncion')::date, ult.fecha);
  perform salto_crear_puente(new.equipo_id, v_fecha, greatest(now(), ult.creado_en + interval '1 second'),
    ult.horometro_final, new.lectura_salida,
    case when new.obra_clave = taller then taller else coalesce(taller, new.obra_clave) end,
    'Uso en taller', ult.propietario,
    'Uso en taller: ' || ult.horometro_final || ' → ' || new.lectura_salida || ' h · OT ' || new.numero
      || ' (lectura de la Inspección Final)',
    jsonb_build_object('ot_id', new.id));
  return new;
end;
$function$;

create or replace function public.panel_anomalias(p_desde date default (current_date - 30), p_hasta date default current_date)
returns table(parte_id uuid, fecha date, obra_clave text, equipo_id text, operador text, tipo text, detalle text)
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select p.*, o.nombre as operador_nombre,
           lag(p.horometro_final) over (
             partition by p.equipo_id order by p.fecha, p.creado_en) as horom_previo,
           lag(p.km_final) over (
             partition by p.equipo_id order by p.fecha, p.creado_en) as km_previo,
           count(*) over (
             partition by p.equipo_id, p.fecha, p.obra_clave) as repetidos
    from partes p
    left join operadores o on o.cedula = p.operador_cedula
  ),
  rango as (select * from base where fecha between p_desde and p_hasta)

  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Horómetro invertido',
         format('inicial %s, final %s', horometro_inicial, horometro_final)
  from rango
  where horometro_inicial is not null and horometro_final is not null
    and horometro_final < horometro_inicial

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Horómetro retrocede',
         format('arranca en %s, el parte anterior cerró en %s',
                horometro_inicial, horom_previo)
  from rango
  where horometro_inicial is not null and horom_previo is not null
    and horometro_inicial < horom_previo
    and not equipo_horometro_libre(equipo_id)          -- SQL 96: PA / CDR cargan toneladas

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Kilometraje retrocede',
         format('arranca en %s, el parte anterior cerró en %s', km_inicial, km_previo)
  from rango
  where km_inicial is not null and km_previo is not null and km_inicial < km_previo

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Turno imposible',
         format('%s → %s', inicio_turno, fin_turno)
  from rango
  where inicio_turno is not null and fin_turno is not null and fin_turno <= inicio_turno

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Turno de más de 24 h',
         format('%s horas', round(extract(epoch from (fin_turno - inicio_turno))/3600.0, 1))
  from rango
  where inicio_turno is not null and fin_turno is not null
    and fin_turno - inicio_turno > interval '24 hours'

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Fecha futura',
         format('cargado el %s', creado_en::date)
  from rango
  where fecha > current_date

  union all
  select id, fecha, obra_clave, equipo_id, operador_nombre,
         'Posible duplicado',
         format('%s partes para esta máquina, esta obra y esta fecha', repetidos)
  from rango
  where repetidos > 1

  order by 2 desc, 4
  limit 1000;
$function$;

-- ── 2. Reasignación de equipo en la sincronización de JotForm ───────────
create table if not exists public.sync_jf_equipo_reasignar (
  id              bigserial primary key,
  equipo_jotform  text not null,                -- como viene de JotForm
  operador_cedula text not null,                -- quién lo carga
  equipo_destino  text not null references public.equipos(id) on update cascade,
  desde           date,                         -- null = desde siempre
  hasta           date,                         -- null = sin fin
  nota            text,
  creado_en       timestamptz not null default now(),
  unique (equipo_jotform, operador_cedula, equipo_destino)
);
alter table public.sync_jf_equipo_reasignar enable row level security;
drop policy if exists sync_jf_equipo_reasignar_ver on public.sync_jf_equipo_reasignar;
create policy sync_jf_equipo_reasignar_ver on public.sync_jf_equipo_reasignar
  for select to authenticated using ((mi_rol())::text in ('admin_central', 'gerente'));

insert into public.sync_jf_equipo_reasignar (equipo_jotform, operador_cedula, equipo_destino, nota)
values ('PA-01', '2236473', 'CDR-01',
        'En JotForm la caldera se cargó siempre como PA-01; la caldera la carga Alipio Ojeda (SQL 96).')
on conflict (equipo_jotform, operador_cedula, equipo_destino) do nothing;

create or replace function public.sync_jf_equipo(p_equipo text, p_cedula text, p_fecha date)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select r.equipo_destino from sync_jf_equipo_reasignar r
      where upper(r.equipo_jotform) = upper(p_equipo) and r.operador_cedula = p_cedula
        and (r.desde is null or p_fecha >= r.desde)
        and (r.hasta is null or p_fecha <= r.hasta)
      order by r.desde desc nulls last limit 1),
    p_equipo)
$$;

create or replace function public.sync_partes_jotform(p_filas jsonb, p_probar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Campos que se comparan y se corrigen. No están: client_id, origen,
  -- submission_id, creado_en (la hora de envío varía unos segundos según
  -- la exportación), cantidad_viajes (nunca se cargó) y lo de la app
  -- (usuario_id, extras, viajes, img_parte_papel).
  c_campos constant text[] := array[
    'fecha','equipo_id','operador_cedula','propietario','obra_clave',
    'inicio_turno','fin_turno','horas_hombre_reportada',
    'horometro_inicial','horometro_final','km_inicial','km_final',
    'horas_horometro_reportada','horas_totales','horas_traslado','horas_paro',
    'tiene_falla','tipo_falla','descripcion_falla','fallas','falla_impidio_trabajo',
    'actividad_dia','detalle_actividad','observaciones','combustible',
    'toneladas_asfalto','piedras_trituradas','m3_hormigon',
    'img_horometro','img_adjunto','firma','tipo_registro'];
  c_texto constant text[] := array[
    'equipo_id','operador_cedula','propietario','obra_clave','tipo_falla',
    'descripcion_falla','fallas','falla_impidio_trabajo','actividad_dia',
    'detalle_actividad','observaciones','combustible','img_horometro',
    'img_adjunto','firma','tipo_registro'];
  c_insert constant text :=
    'client_id, origen, submission_id, creado_en, fecha, equipo_id, operador_cedula, propietario, obra_clave, '
    'inicio_turno, fin_turno, horas_hombre_reportada, horometro_inicial, horometro_final, km_inicial, km_final, '
    'horas_horometro_reportada, horas_totales, horas_traslado, horas_paro, tiene_falla, tipo_falla, '
    'descripcion_falla, fallas, falla_impidio_trabajo, actividad_dia, detalle_actividad, observaciones, '
    'combustible, toneladas_asfalto, piedras_trituradas, m3_hormigon, img_horometro, img_adjunto, firma, tipo_registro';

  f        jsonb;
  nj       jsonb;     -- fila nueva, ya con los tipos y redondeos de la tabla
  vj       jsonb;     -- fila actual en la base
  n        partes;
  v        partes;
  k        text;
  parche   jsonb;
  sets     text;
  avisos_f text[];
  it       text;

  r_recibidas int := 0;  r_nuevos int := 0;  r_iguales int := 0;
  r_corr int := 0;       r_app int := 0;     r_no_jf int := 0;   r_cert int := 0;
  r_campos jsonb := '{}';
  r_ej     jsonb := '[]';
  r_err    jsonb := '[]';
  r_av     jsonb := '[]';
  r_cat    jsonb := jsonb_build_object('equipos','[]'::jsonb,'operadores','[]'::jsonb,'obras','[]'::jsonb,'propietarios','[]'::jsonb);
  r_fallas jsonb := '[]';
  r_rango  jsonb;
  resumen  jsonb;
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'p_filas tiene que ser una lista';
  end if;

  begin  -- todo lo de adentro se deshace si p_probar
    for f in select * from jsonb_array_elements(p_filas) loop
      r_recibidas := r_recibidas + 1;
      begin
        n := jsonb_populate_record(null::partes, f);
        if n.client_id is null or n.fecha is null or n.equipo_id is null
           or n.operador_cedula is null or n.obra_clave is null then
          raise exception 'fila incompleta (falta id, fecha, equipo, operador u obra)';
        end if;
        n.origen := 'jotform';
        -- SQL 96: equipo de JotForm que en la base es otro (PA-01 de Alipio Ojeda = caldera CDR-01)
        n.equipo_id := sync_jf_equipo(n.equipo_id, n.operador_cedula, n.fecha);
        if n.actividad_dia = 'Receso' then n.horas_hombre_reportada := 0; end if;  -- igual que fn_parte_receso
        nj := to_jsonb(n);

        select * into v from partes where client_id = n.client_id;

        -- ── NUEVO ───────────────────────────────────────────────
        if not found then
          if n.propietario is not null and not exists (select 1 from propietarios where nombre = n.propietario) then
            insert into propietarios (nombre) values (n.propietario) on conflict do nothing;
            r_cat := jsonb_set(r_cat, '{propietarios}', (r_cat->'propietarios') || to_jsonb(n.propietario));
          end if;
          if not exists (select 1 from operadores where cedula = n.operador_cedula) then
            insert into operadores (cedula, nombre)
            values (n.operador_cedula, coalesce(nullif(f->>'operador_nombre',''), n.operador_cedula))
            on conflict do nothing;
            r_cat := jsonb_set(r_cat, '{operadores}', (r_cat->'operadores') ||
                     to_jsonb(n.operador_cedula || ' ' || coalesce(f->>'operador_nombre','')));
          end if;
          if not exists (select 1 from obras where clave = n.obra_clave) then
            insert into obras (clave, codigo, nombre)
            values (n.obra_clave,
                    coalesce(nullif(split_part(n.obra_clave, '_', 1), ''), n.obra_clave),
                    coalesce(nullif(substr(n.obra_clave, strpos(n.obra_clave, '_') + 1), ''), n.obra_clave))
            on conflict do nothing;
            r_cat := jsonb_set(r_cat, '{obras}', (r_cat->'obras') || to_jsonb(n.obra_clave));
          end if;
          if not exists (select 1 from equipos where id = n.equipo_id) then
            insert into equipos (id, descripcion, propiedad)
            values (n.equipo_id, coalesce(nullif(f->>'equipo_desc',''), n.equipo_id),
                    case when lower(coalesce(n.propietario,'')) like 'alquil%' then 'Tercero' else 'Propio' end)
            on conflict do nothing;
            r_cat := jsonb_set(r_cat, '{equipos}', (r_cat->'equipos') ||
                     to_jsonb(n.equipo_id || ' ' || coalesce(f->>'equipo_desc','')));
          end if;
          -- ítems de obra que vienen en el detalle
          for it in select btrim(m[1]) from regexp_matches(coalesce(n.detalle_actividad,''), 'Item de obra:\s*([^,\n]+)', 'g') m loop
            if it <> '' then
              insert into items_obra (obra_clave, descripcion) values (n.obra_clave, it)
              on conflict (obra_clave, descripcion) do nothing;
            end if;
          end loop;

          execute format('insert into partes (%s) select %s from jsonb_populate_record(null::partes, $1)', c_insert, c_insert)
            using nj;
          r_nuevos := r_nuevos + 1;
          r_rango := jsonb_build_object(
            'desde', least(coalesce(r_rango->>'desde', n.fecha::text), n.fecha::text),
            'hasta', greatest(coalesce(r_rango->>'hasta', n.fecha::text), n.fecha::text));
          if n.tiene_falla and n.fecha >= current_date - 3 then
            r_fallas := r_fallas || to_jsonb(n.equipo_id || ' ' || to_char(n.fecha, 'DD/MM') || ' ' ||
                                              coalesce(n.fallas, n.tipo_falla, '') ||
                                              coalesce(' · impidió: ' || n.falla_impidio_trabajo, ''));
          end if;
          continue;
        end if;

        -- ── YA ESTÁ ─────────────────────────────────────────────
        if v.origen is distinct from 'jotform' then
          r_no_jf := r_no_jf + 1;  continue;
        end if;
        if exists (select 1 from log_ediciones l where l.parte_id = v.id and l.usuario_id is not null) then
          r_app := r_app + 1;  continue;   -- alguien lo corrigió en la app: manda la app
        end if;

        vj := to_jsonb(v);
        parche := '{}';
        avisos_f := '{}';
        foreach k in array c_campos loop
          if k = any(c_texto) then
            if sync_jf_txt(nj->k) is not distinct from sync_jf_txt(vj->k) then continue; end if;
          else
            if (nj->k) is not distinct from (vj->k)
               or (jsonb_typeof(nj->k) = 'null' and vj->k is null)
               or (nj->k is null and jsonb_typeof(vj->k) = 'null') then continue; end if;
          end if;
          -- No se cambia a un equipo / obra / operador que no existe:
          -- puede ser un nombre viejo que en Flota ya se renombró.
          if (k = 'equipo_id'       and not exists (select 1 from equipos      where id     = n.equipo_id))
          or (k = 'obra_clave'      and not exists (select 1 from obras        where clave  = n.obra_clave))
          or (k = 'operador_cedula' and not exists (select 1 from operadores   where cedula = n.operador_cedula))
          or (k = 'propietario'     and n.propietario is not null
                                    and not exists (select 1 from propietarios where nombre = n.propietario)) then
            avisos_f := avisos_f || (k || ' «' || coalesce(nj->>k,'') || '» no existe en la base');
            continue;
          end if;
          parche := parche || jsonb_build_object(k, jsonb_build_array(vj->k, nj->k));
        end loop;

        if array_length(avisos_f, 1) > 0 then
          r_av := r_av || jsonb_build_object('parte', n.client_id, 'equipo', v.equipo_id,
                                            'fecha', v.fecha, 'aviso', array_to_string(avisos_f, '; '));
        end if;
        if parche = '{}' then
          r_iguales := r_iguales + 1;  continue;
        end if;

        -- Ya está en un certificado de máquinas emitido (con la obra/fecha
        -- de antes o la de ahora): no se corrige solo, se avisa.
        it := coalesce(sync_jf_cert_emitido(v.obra_clave, v.fecha),
                       sync_jf_cert_emitido(coalesce(n.obra_clave, v.obra_clave), coalesce(n.fecha, v.fecha)));
        if it is not null then
          r_cert := r_cert + 1;
          r_av := r_av || jsonb_build_object('parte', n.client_id, 'equipo', v.equipo_id, 'fecha', v.fecha,
                    'aviso', 'cambió en JotForm pero está en el certificado emitido ' || it ||
                             ' de ' || v.obra_clave || ': no se corrige (' ||
                             (select string_agg(key, ', ') from jsonb_object_keys(parche) key) || ')');
          continue;
        end if;

        select string_agg(format('%I = ($2).%I', key, key), ', ') into sets from jsonb_object_keys(parche) key;
        execute format('update partes set %s where id = $1', sets) using v.id, n;

        r_corr := r_corr + 1;
        for k in select jsonb_object_keys(parche) loop
          r_campos := jsonb_set(r_campos, array[k], to_jsonb(coalesce((r_campos->>k)::int, 0) + 1));
        end loop;
        if jsonb_array_length(r_ej) < 60 then
          r_ej := r_ej || jsonb_build_object('parte', n.client_id, 'equipo', v.equipo_id,
                                            'fecha', v.fecha, 'cambios', parche);
        end if;

      exception when others then
        r_err := r_err || jsonb_build_object('parte', f->>'client_id', 'equipo', f->>'equipo_id',
                                            'fecha', f->>'fecha', 'error', left(sqlerrm, 300));
      end;
    end loop;

    if p_probar then
      raise exception using errcode = 'PRB01', message = 'ensayo: se deshace todo';
    end if;
  exception when sqlstate 'PRB01' then
    null;  -- ensayo: lo escrito arriba se deshizo, el informe queda en las variables
  end;

  resumen := jsonb_build_object(
    'probar', p_probar,
    'recibidas', r_recibidas,
    'nuevos', r_nuevos,
    'nuevos_fechas', r_rango,
    'corregidos', r_corr,
    'iguales', r_iguales,
    'no_se_tocan_editados_en_app', r_app,
    'no_se_tocan_no_jotform', r_no_jf,
    'no_se_tocan_certificado_emitido', r_cert,
    'campos_corregidos', r_campos,
    'catalogo_nuevo', r_cat,
    'fallas_recientes', r_fallas,
    'avisos', r_av,
    'errores', r_err,
    'ejemplos', r_ej);

  insert into sync_jotform_log (etapa, probar, resumen) values ('filas', p_probar, resumen);
  return resumen;
end
$function$;

-- ── 3. Partes y combustible históricos de la caldera → CDR-01 ───────────
update public.partes
   set equipo_id = 'CDR-01'
 where equipo_id = 'PA-01' and operador_cedula = '2236473';

update public.combustible_movimientos
   set equipo_id = 'CDR-01'
 where equipo_id = 'PA-01' and operador_cedula = '2236473';

-- Por las dudas: ningún salto pendiente en plantas / calderas
delete from public.horometro_saltos h
 where h.estado = 'pendiente' and public.equipo_horometro_libre(h.equipo_id);

-- ── 4. Operador habitual y observación del último parte en Flota ────────
update public.equipos set operador_habitual = '7224913' where id = 'PA-01';
update public.equipos set operador_habitual = '2236473' where id = 'CDR-01';

-- La «observación del último parte» de PA-01 era de la caldera (Alipio): pasa a CDR-01
insert into public.equipo_estado (equipo_id, observacion_parte, observacion_parte_en, observacion_parte_fecha)
select 'CDR-01', e.observacion_parte, e.observacion_parte_en, e.observacion_parte_fecha
  from public.equipo_estado e
 where e.equipo_id = 'PA-01' and e.observacion_parte ilike '%OJEDA, ALIPIO%'
on conflict (equipo_id) do update set
  observacion_parte       = excluded.observacion_parte,
  observacion_parte_en    = excluded.observacion_parte_en,
  observacion_parte_fecha = excluded.observacion_parte_fecha;
update public.equipo_estado
   set observacion_parte = null, observacion_parte_en = null, observacion_parte_fecha = null
 where equipo_id = 'PA-01' and observacion_parte ilike '%OJEDA, ALIPIO%';

-- ── Resumen ─────────────────────────────────────────────────────────────
select
  (select count(*) from partes where equipo_id = 'PA-01')                                  as partes_pa01,
  (select count(*) from partes where equipo_id = 'PA-01' and operador_cedula = '2236473')  as pa01_de_alipio_debe_ser_0,
  (select count(*) from partes where equipo_id = 'CDR-01')                                 as partes_cdr01,
  (select count(*) from combustible_movimientos where equipo_id = 'CDR-01')                as combustible_cdr01,
  (select sync_jf_equipo('PA-01', '2236473', current_date))                                as alipio_pa01_va_a,
  (select sync_jf_equipo('PA-01', '7224913', current_date))                                as villasanti_pa01_va_a,
  (select equipo_horometro_libre('PA-02') and equipo_horometro_libre('CDR-01')
          and not equipo_horometro_libre('EX-16'))                                         as libre_ok;

-- REVERTIR (vuelve los partes a PA-01; las funciones quedan como en 77/78/95):
--   update partes set equipo_id = 'PA-01' where equipo_id = 'CDR-01' and operador_cedula = '2236473';
--   update combustible_movimientos set equipo_id = 'PA-01' where equipo_id = 'CDR-01' and operador_cedula = '2236473';
--   delete from sync_jf_equipo_reasignar where equipo_jotform = 'PA-01' and equipo_destino = 'CDR-01';
