-- =========================================================================
-- 77_saltos_horometro.sql · v20261102f (equipos-v83)
--
-- Caso MN-04 (26/10/2026): la máquina estuvo en taller desde el 14/08
-- (OT 11308) y volvió con 5,3 h más en el horómetro. La regla «sin saltos»
-- obligó al operador a poner como inicial el valor viejo y esas horas de
-- taller quedaron cargadas a Arborea Hills como «A disposición en pista».
--
-- Qué hace este SQL:
--   1. Reglas nuevas (Parte diario › Administración › Reglas):
--        disposicion_sin_horas = 1  → «A disposición en pista», «Receso»,
--          «Sin actividad por lluvia» y «Sin operador…» no pueden sumar horas
--          de máquina (final = inicial). «A disposición equipo en taller» sí
--          puede (son horas de taller).
--        dias_parado_revisar = 5    → el primer parte después de 5 días o más
--          sin partes queda para revisar aunque el horómetro «cierre».
--   2. Operador técnico «USO EN TALLER» (cédula TALLER, inactivo): es el que
--      llevan los partes puente (la columna operador es obligatoria).
--   3. Tabla horometro_saltos: un registro por parte con salto o para revisar.
--        tipo 'salto'    → el inicial es mayor al final del parte anterior.
--        tipo 'revision' → el horómetro cierra, pero la máquina estuvo parada
--                          muchos días o el taller registró lecturas mayores
--                          en el medio (señal de horas «absorbidas»).
--   4. Detección automática con cada parte (y repaso de los partes desde el
--      01/10/2026).
--   5. salto_resolver(): el admin central o el encargado de taller lo
--      resuelve. Uso en taller / Traslado / Parte faltante crean un PARTE
--      PUENTE (origen 'puente', 0 HH, horas de máquina = el salto) para que
--      la cadena del horómetro quede completa y las horas no caigan en la obra.
--   6. Al cerrar una OT de taller con la Inspección Final, si la lectura de
--      salida supera al último parte (y la máquina no volvió a trabajar
--      antes), se crea solo el parte puente de taller.
--   7. Los partes puente no tocan Flota (operador habitual / ubicación).
--
-- Correr entero en el SQL Editor. Al final muestra un resumen.
-- =========================================================================

-- ── 1. Reglas ───────────────────────────────────────────────────────────
insert into public.form_reglas (clave, valor, descripcion, unidad) values
  ('disposicion_sin_horas', 1,
   'Si la máquina no trabajó (A disposición en pista, Receso, lluvia, sin operador) el horómetro final debe ser igual al inicial.', null),
  ('dias_parado_revisar', 5,
   'Días sin partes a partir de los cuales el primer parte queda para revisar posibles horas de taller no registradas.', 'días')
on conflict (clave) do nothing;

update public.form_reglas
   set descripcion = 'El horómetro inicial debe ser igual al final del parte anterior. Si es mayor, el operador declara el motivo y queda un salto para revisar.'
 where clave = 'horometro_sin_saltos';

-- ── 2. Operador técnico de los partes puente ────────────────────────────
insert into public.operadores (cedula, nombre, activo, especialidad, verificado)
values ('TALLER', 'USO EN TALLER (sin operador)', false, 'OTRO', true)
on conflict (cedula) do nothing;

-- ── 3. Tabla ────────────────────────────────────────────────────────────
create table if not exists public.horometro_saltos (
  id               bigserial primary key,
  equipo_id        text not null references public.equipos(id) on update cascade,
  parte_id         uuid not null unique references public.partes(id) on delete cascade,
  parte_anterior_id uuid references public.partes(id) on delete set null,
  tipo             text not null check (tipo in ('salto', 'revision')),
  fecha_desde      date,          -- fecha del parte anterior
  fecha_hasta      date,          -- fecha del parte nuevo
  dias             int,
  lectura_desde    numeric,       -- final del parte anterior
  lectura_hasta    numeric,       -- inicial del parte nuevo
  horas            numeric,       -- salto (lectura_hasta − lectura_desde); 0 en revisión
  evidencia_lectura numeric,      -- mayor lectura de taller en el medio (si hay)
  evidencia_fecha  date,
  evidencia        text,
  ot_id            bigint references public.ordenes_trabajo(id) on delete set null,
  causa_declarada  text,          -- lo que eligió el operador en el parte
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'resuelto')),
  resolucion       text,
  lectura_real     numeric,
  puente_id        uuid references public.partes(id) on delete set null,
  nota             text,
  resuelto_por     uuid,
  resuelto_en      timestamptz,
  creado_en        timestamptz not null default now()
);
create index if not exists horometro_saltos_estado on public.horometro_saltos (estado, fecha_hasta desc);
create index if not exists horometro_saltos_equipo on public.horometro_saltos (equipo_id, fecha_hasta desc);

alter table public.horometro_saltos enable row level security;
drop policy if exists horometro_saltos_lectura on public.horometro_saltos;
create policy horometro_saltos_lectura on public.horometro_saltos for select to authenticated
  using ((select mi_rol())::text in ('admin_central', 'taller', 'gerente', 'admin_obra'));
grant select on public.horometro_saltos to authenticated;

-- ── 4. Detección ────────────────────────────────────────────────────────
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
begin
  select * into p from partes where id = p_parte;
  if not found or p.origen = 'puente' then return; end if;

  select * into ex from horometro_saltos where parte_id = p_parte;
  if found and ex.estado <> 'pendiente' then return; end if;   -- lo resuelto no se toca

  if p.horometro_inicial is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
  end if;

  -- Parte anterior de la máquina (los puentes cuentan: cierran la cadena)
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

  -- Lecturas de taller entre los dos partes mayores al final del anterior
  select x.l, x.f into ev_l, ev_f from (
      select r.lectura l, r.fecha f
        from ot_registros r join ordenes_trabajo o on o.id = r.ot_id
       where o.equipo_id = p.equipo_id and r.tipo_medicion = 'Horómetro'
         and r.fecha > ant.fecha and r.fecha <= p.fecha
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

  -- OT de taller que cubre el período
  select o.id into v_ot from ordenes_trabajo o
   where o.equipo_id = p.equipo_id and o.tipo_ot = 'Taller'
     and coalesce(o.fecha_ingreso, o.creado_en)::date <= p.fecha
     and (o.fecha_cierre is null or (o.fecha_cierre at time zone 'America/Asuncion')::date >= ant.fecha)
   order by coalesce(o.fecha_ingreso, o.creado_en) desc
   limit 1;

  v_tipo := case
    when gap > 0.05 then 'salto'
    when gap >= -0.05 and ant.origen <> 'puente' and (ev_l is not null or ndias >= tope) then 'revision'
  end;

  if v_tipo is null then
    delete from horometro_saltos where parte_id = p_parte;
    return;
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

-- Al cargar o corregir un parte se evalúa ese parte y el siguiente de la
-- misma máquina (su «anterior» pudo cambiar).
create or replace function public.fn_parte_salto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sig uuid;
begin
  if new.origen = 'puente' then
    -- un puente nuevo puede explicar el salto del parte siguiente
    select o.id into sig from partes o
     where o.equipo_id = new.equipo_id and o.id <> new.id and o.origen <> 'puente'
       and (o.fecha > new.fecha or (o.fecha = new.fecha and o.creado_en > new.creado_en))
     order by o.fecha, o.creado_en limit 1;
    if sig is not null then perform salto_evaluar(sig); end if;
    return new;
  end if;
  perform salto_evaluar(new.id);
  select o.id into sig from partes o
   where o.equipo_id = new.equipo_id and o.id <> new.id and o.origen <> 'puente'
     and (o.fecha > new.fecha or (o.fecha = new.fecha and o.creado_en > new.creado_en))
   order by o.fecha, o.creado_en limit 1;
  if sig is not null then perform salto_evaluar(sig); end if;
  return new;
end;
$function$;

drop trigger if exists trg_parte_salto on public.partes;
create trigger trg_parte_salto
  after insert or update of horometro_inicial, horometro_final, fecha, equipo_id, extras on public.partes
  for each row execute function public.fn_parte_salto();

-- ── 1b. Regla «si no trabajó, no suma horas» también en la base ─────────
create or replace function public.fn_parte_disposicion_sin_horas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.origen in ('jotform', 'puente')
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

drop trigger if exists trg_parte_disposicion_sin_horas on public.partes;
create trigger trg_parte_disposicion_sin_horas
  before insert or update on public.partes
  for each row execute function public.fn_parte_disposicion_sin_horas();

-- ── 7. Los puentes no actualizan Flota ──────────────────────────────────
create or replace function public.fn_parte_actualiza_flota()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.origen = 'puente' then return new; end if;   -- SQL 77
  perform public.flota_aplicar_parte(new.id);
  return new;
end $function$;

-- ── Parte puente (lo usan la resolución y el cierre de OT) ─────────────
create or replace function public.salto_crear_puente(
  p_equipo text, p_fecha date, p_creado timestamptz, p_desde numeric, p_hasta numeric,
  p_obra text, p_actividad text, p_propietario text, p_detalle text, p_extras jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into partes (client_id, origen, creado_en, fecha, equipo_id, operador_cedula, propietario, obra_clave,
                      usuario_id, horometro_inicial, horometro_final, horas_horometro_reportada, horas_totales,
                      horas_hombre_reportada, tiene_falla, actividad_dia, tipo_registro, detalle_actividad, extras)
  values ('puente-' || gen_random_uuid(), 'puente', p_creado, p_fecha, p_equipo, 'TALLER', p_propietario, p_obra,
          auth.uid(), p_desde, p_hasta, round(p_hasta - p_desde, 1), round(p_hasta - p_desde, 1),
          0, false, p_actividad, 'Puente de horómetro', p_detalle, coalesce(p_extras, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.salto_crear_puente(text, date, timestamptz, numeric, numeric, text, text, text, text, jsonb) from public, anon, authenticated;

-- ── 5. Resolver un salto / revisión ─────────────────────────────────────
--   p_accion: uso_taller | traslado | parte_faltante  → parte puente
--             cambio_horometro | error_carga | sin_salto → solo se cierra
--   p_lectura_real: en una revisión, el horómetro con el que arrancó de
--             verdad (sale de la foto del tablero o del parte en papel).
create or replace function public.salto_resolver(
  p_id bigint, p_accion text, p_lectura_real numeric default null,
  p_obra text default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s      horometro_saltos%rowtype;
  p      partes%rowtype;
  ant    partes%rowtype;
  desde  numeric;
  hasta  numeric;
  v_fecha date;
  v_creado timestamptz;
  v_obra text;
  v_act  text;
  v_puente uuid;
  v_ot_num bigint;
  taller text := (select clave from obras where clave like '3050100006%' limit 1);
  etiqueta text;
begin
  if not es_taller() then
    raise exception 'Solo el administrador central o el encargado de taller resuelven saltos de horómetro' using errcode = '42501';
  end if;
  select * into s from horometro_saltos where id = p_id for update;
  if not found then raise exception 'No existe el salto %', p_id; end if;
  if s.estado <> 'pendiente' then raise exception 'Ese salto ya está resuelto'; end if;
  select * into p from partes where id = s.parte_id;
  select * into ant from partes where id = s.parte_anterior_id;
  select numero into v_ot_num from ordenes_trabajo where id = s.ot_id;

  etiqueta := case p_accion
    when 'uso_taller'       then 'Uso en taller'
    when 'traslado'         then 'Traslado'
    when 'parte_faltante'   then 'Parte faltante'
    when 'cambio_horometro' then 'Cambio de horómetro'
    when 'error_carga'      then 'Error de carga (se corrige el parte)'
    when 'sin_salto'        then 'Sin salto: el parte está bien'
  end;
  if etiqueta is null then raise exception 'Acción desconocida: %', p_accion; end if;
  if p_accion = 'sin_salto' and s.tipo = 'salto' then
    raise exception 'Hay un salto real de % h: elegí qué pasó (uso en taller, traslado, parte faltante, cambio de horómetro o error de carga)', s.horas;
  end if;

  if p_accion in ('uso_taller', 'traslado', 'parte_faltante') then
    desde := s.lectura_desde;
    if s.tipo = 'salto' then
      hasta := s.lectura_hasta;
    else
      hasta := p_lectura_real;
      if hasta is null or hasta <= desde + 0.05 then
        raise exception 'Cargá el horómetro real con el que arrancó el %: tiene que ser mayor a % h', to_char(p.fecha, 'DD/MM'), desde;
      end if;
      if p.horometro_final is not null and hasta > p.horometro_final + 0.05 then
        raise exception 'El horómetro real (%) no puede ser mayor al final del parte (%)', hasta, p.horometro_final;
      end if;
      if p.actividad_dia = 'Con Actividad' and coalesce(p.detalle_actividad, '') ilike '%Horas máquina:%' then
        raise exception 'El parte del % tiene horas por ítem de obra: corregilo desde Historial › Editar (horómetro inicial % y las horas de cada ítem). Al guardar, el salto vuelve a aparecer como salto de % h y lo resolvés acá.',
          to_char(p.fecha, 'DD/MM'), hasta, round(hasta - desde, 1);
      end if;
    end if;

    v_fecha := case when s.fecha_hasta > s.fecha_desde then s.fecha_hasta - 1 else s.fecha_desde end;
    v_creado := case
      when v_fecha = s.fecha_hasta then ant.creado_en + (p.creado_en - ant.creado_en) / 2
      when v_fecha = s.fecha_desde then ant.creado_en + interval '1 second'
      else now() end;
    v_obra := coalesce(nullif(p_obra, ''), case when p_accion = 'uso_taller' then taller else p.obra_clave end);
    v_act  := case p_accion when 'uso_taller' then 'Uso en taller' when 'traslado' then 'Traslado' else 'Sin parte (salto de horómetro)' end;

  end if;

  -- Primero se marca resuelto: así el puente (que dispara la evaluación
  -- del parte siguiente) no borra ni recalcula este registro.
  update horometro_saltos
     set estado = 'resuelto', resolucion = etiqueta, lectura_real = coalesce(hasta, p_lectura_real),
         nota = nullif(p_nota, ''), resuelto_por = auth.uid(), resuelto_en = now()
   where id = s.id;

  if desde is not null then
    v_puente := salto_crear_puente(p.equipo_id, v_fecha, v_creado, desde, hasta, v_obra, v_act, p.propietario,
      concat_ws(' · ', etiqueta || ': ' || desde || ' → ' || hasta || ' h',
                'entre el parte del ' || to_char(s.fecha_desde, 'DD/MM/YYYY') || ' y el del ' || to_char(s.fecha_hasta, 'DD/MM/YYYY'),
                case when v_ot_num is not null then 'OT ' || v_ot_num end, nullif(p_nota, '')),
      jsonb_build_object('salto_id', s.id, 'ot_id', s.ot_id));
    update horometro_saltos set puente_id = v_puente where id = s.id;
  end if;

  -- Revisión con horómetro real distinto: se corrige el inicial del parte
  if s.tipo = 'revision' and v_puente is not null then
    update partes
       set horometro_inicial = hasta,
           horas_horometro_reportada = greatest(round(horometro_final - hasta, 1), 0),
           horas_totales = greatest(round(horometro_final - hasta, 1), 0),
           observaciones = concat_ws(E'\n', nullif(observaciones, ''),
             'Horómetro inicial corregido de ' || p.horometro_inicial || ' a ' || hasta
             || ' (' || etiqueta || ', salto ' || s.id || ', ' || to_char(now() at time zone 'America/Asuncion', 'DD/MM/YYYY') || ')')
     where id = p.id;
  end if;

  return jsonb_build_object('ok', true, 'resolucion', etiqueta, 'puente_id', v_puente,
                            'horas', case when v_puente is not null then round(hasta - desde, 1) end);
end;
$function$;
grant execute on function public.salto_resolver(bigint, text, numeric, text, text) to authenticated;

-- Lista para la pantalla (Historial de partes › Saltos de horómetro)
create or replace function public.horometro_saltos_lista(p_estado text default 'pendiente')
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(row_to_json(x) order by x.fecha_hasta desc, x.id desc), '[]'::jsonb) from (
    select s.*, e.descripcion as equipo_desc,
           p.obra_clave, p.actividad_dia, p.horometro_final as parte_final, p.horas_horometro as parte_horas,
           p.img_horometro, p.img_parte_papel, p.observaciones, p.detalle_actividad, p.origen as parte_origen,
           op.nombre as operador, ant.obra_clave as obra_anterior, ant.actividad_dia as actividad_anterior,
           o.numero as ot_numero, o.estado as ot_estado,
           pu.obra_clave as puente_obra, pu.fecha as puente_fecha
      from horometro_saltos s
      join partes p on p.id = s.parte_id
      left join equipos e on e.id = s.equipo_id
      left join operadores op on op.cedula = p.operador_cedula
      left join partes ant on ant.id = s.parte_anterior_id
      left join ordenes_trabajo o on o.id = s.ot_id
      left join partes pu on pu.id = s.puente_id
     where (mi_rol())::text in ('admin_central', 'taller', 'gerente', 'admin_obra')
       and (p_estado = 'todos' or s.estado = p_estado)
     limit 2000
  ) x;
$function$;
grant execute on function public.horometro_saltos_lista(text) to authenticated;

-- ── 6. Cierre de OT de taller → parte puente ────────────────────────────
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
     or new.equipo_id is null or new.lectura_salida is null or coalesce(new.tipo_ot, '') <> 'Taller' then
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

drop trigger if exists trg_ot_cierre_puente on public.ordenes_trabajo;
create trigger trg_ot_cierre_puente
  after update on public.ordenes_trabajo
  for each row execute function public.fn_ot_cierre_puente();

-- ── 4b. Repaso de los partes desde el 01/10/2026 ────────────────────────
do $$
declare r record;
begin
  for r in select id from partes where fecha >= date '2026-10-01' and origen <> 'puente' and horometro_inicial is not null
           order by fecha, creado_en loop
    perform salto_evaluar(r.id);
  end loop;
end $$;

-- ── Resumen ─────────────────────────────────────────────────────────────
select
  (select count(*) from horometro_saltos where tipo = 'salto')    as saltos,
  (select count(*) from horometro_saltos where tipo = 'revision') as para_revisar,
  (select count(*) from horometro_saltos where tipo = 'revision' and evidencia is not null) as con_lectura_de_taller,
  (select string_agg(tipo || ' ' || coalesce(evidencia, ''), ' | ') from horometro_saltos
    where equipo_id = 'MN-04') as mn04,
  (select count(*) from partes where origen = 'pwa' and fecha >= date '2026-10-01'
      and (actividad_dia in ('A disposición en pista', 'Receso', 'Sin actividad por lluvia') or actividad_dia ilike 'Sin operador%')
      and horometro_final - horometro_inicial > 0.05) as pwa_sin_trabajar_con_horas;

-- REVERTIR:
--   drop trigger trg_parte_salto on partes; drop trigger trg_parte_disposicion_sin_horas on partes;
--   drop trigger trg_ot_cierre_puente on ordenes_trabajo;
--   delete from partes where origen = 'puente'; drop table horometro_saltos;
--   delete from form_reglas where clave in ('disposicion_sin_horas', 'dias_parado_revisar');
