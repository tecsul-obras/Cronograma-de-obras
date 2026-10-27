-- =========================================================================
-- 65_ot_cierre_y_costos_taller.sql · equipos-v70 (27/10/2026)
--
-- Órdenes de trabajo:
--   1. Tipo de OT (Taller / Pista) en la bandeja. Las OT viejas que no lo
--      tienen cargado se estiman por la ubicación: "TALLER CENTRAL" = Taller,
--      cualquier otra = Pista (columna tipo_ot_inferido = true).
--   2. Una OT de PISTA solo se cierra si el estado general de la máquina
--      queda en Reparado, Reparado - Fallas menores o Servicio Tercerizado.
--   3. Una OT de TALLER solo se cierra con la Inspección Final - Taller.
--      Desde la bandeja no se puede cerrar: la app manda al formulario.
--      (Las OT sin máquina —servicios generales, trabajos internos— no
--      tienen estas dos reglas.)
--   4. Una OT cerrada sigue aceptando "Registro de Trabajos" durante 48 h
--      (para que los otros mecánicos carguen sus horas). Esos registros no
--      cambian el estado de la OT ni de la máquina.
--
-- Costos de taller:
--   5. Tarifa horaria por técnico (tecnico_tarifas, con fecha "desde" para
--      que un aumento no cambie el costo de los trabajos anteriores).
--      Cargan: admin central. Ven: admin central y gerente.
--   6. v_ot_horas suma también las horas de mantenimiento (service) y de
--      traslado, y trae tipo de OT, equipo, tarifa y costo.
--
-- No borra datos. Se puede correr más de una vez.
-- =========================================================================

-- ── 1. Tipo de OT efectivo ──────────────────────────────────────────────
create or replace function public.ot_tipo_efectivo(p_tipo text, p_obra text, p_ubicacion text)
returns text language sql stable set search_path = public as $$
  select coalesce(
    nullif(trim(p_tipo), ''),
    case when coalesce((select o.nombre from obras o where o.clave = p_obra), p_ubicacion, '') ilike '%taller central%'
         then 'Taller' else 'Pista' end)
$$;

-- ── 2. Estados de la máquina que permiten cerrar una OT de pista ───────
create or replace function public.ot_estado_permite_cierre(p_estado text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(trim(p_estado) ~* '^reparado' or p_estado ~* 'tercerizad', false)
$$;

-- ── 3. Cierre directo de la OT (bandeja de taller) ──────────────────────
-- Los cierres que vienen de un formulario ya se validaron en ot_registrar
-- y pasan con la marca ot.cierre_ok (la pone fn_ot_registro).
create or replace function public.fn_ot_cierre_valido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Cerrada' and old.estado is distinct from 'Cerrada'
     and coalesce(current_setting('ot.cierre_ok', true), '') <> '1'
     and new.equipo_id is not null then
    if ot_tipo_efectivo(new.tipo_ot, new.obra_clave, new.ubicacion_texto) = 'Taller' then
      if not exists (select 1 from ot_registros r
                      where r.ot_id = new.id and r.condicion = 'Cierre de OT - Taller') then
        raise exception 'OT_TALLER: la OT % es de taller y se cierra con el formulario Inspección Final - Taller.', new.numero;
      end if;
    elsif not ot_estado_permite_cierre(new.estado_maquina_salida) then
      raise exception 'OT_ESTADO: para cerrar la OT % la máquina tiene que quedar Reparado, Reparado - Fallas menores o Servicio Tercerizado.', new.numero;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ot_cierre_valido on public.ordenes_trabajo;
create trigger trg_ot_cierre_valido before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_cierre_valido();

-- ── 4. El registro que cierra la OT (igual que antes + la marca) ───────
create or replace function public.fn_ot_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ot ordenes_trabajo%rowtype;
begin
  select * into ot from ordenes_trabajo where id = new.ot_id;

  if ot.estado = 'Solicitada' and new.condicion <> 'Reporte de Fallas' then
    update ordenes_trabajo set estado = 'Abierta' where id = ot.id;
    ot.estado := 'Abierta';
  end if;

  if ot.estado = 'Abierta' and not new.finaliza_ot and new.origen <> 'jotform'
     and ot.equipo_id is not null then
    perform set_config('flota.origen', 'ot', true);
    perform flota_empeorar_estado(ot.equipo_id, ot_estado_flota(new.estado_maquina),
              'OT ' || ot.numero || ' — ' || ot.nombre, new.fecha, null);
    perform set_config('flota.origen', '', true);
  end if;

  if new.finaliza_ot and ot.estado in ('Abierta', 'Solicitada') then
    perform set_config('ot.cierre_ok', '1', true);
    update ordenes_trabajo
       set estado = 'Cerrada',
           fecha_cierre = coalesce(fecha_cierre, new.creado_en),
           estado_maquina_salida = coalesce(new.estado_maquina, estado_maquina_salida),
           lectura_salida = coalesce(new.lectura, lectura_salida),
           detalle_cierre = coalesce(detalle_cierre, new.detalle),
           fotos_salida = case when new.condicion = 'Cierre de OT - Taller' and cardinality(new.fotos) > 0
                               then new.fotos else fotos_salida end,
           sistemas_intervenidos = coalesce((
             select array_agg(distinct x order by x)
             from ot_registros r, unnest(r.trabajo_ejecutado) x
             where r.ot_id = ot.id), '{}')
     where id = ot.id;
    perform set_config('ot.cierre_ok', '', true);
  else
    update ordenes_trabajo set actualizado_en = now() where id = ot.id;
  end if;
  return new;
end;
$$;

-- ── 5. ot_registrar: las reglas de cierre y las 48 h ────────────────────
-- Igual que la versión de los SQL 59/60, con:
--   · Registro de Trabajos en una OT cerrada hace menos de 48 h: se acepta
--     (no cierra nada). Cualquier otra cosa en una OT cerrada: error.
--   · "Trabajo Finalizado = SI" en el Registro de Trabajos no cierra si la
--     OT es de taller (va la Inspección Final) o si el estado de la máquina
--     no es Reparado / Reparado - Fallas menores / Servicio Tercerizado.
--     En ese caso el registro se guarda igual y la respuesta trae "aviso"
--     (el teléfono ya lo valida antes; esto cubre los envíos sin señal).
create or replace function public.ot_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client   text := nullif(p->>'client_id', '');
  v_cond     text := coalesce(nullif(p->>'condicion', ''), 'Registro de Trabajos - OT');
  v_nueva    jsonb := p->'ot_nueva';
  v_ot       ordenes_trabajo%rowtype;
  v_reg      uuid;
  v_existe   record;
  v_equipo   text;
  v_obra     text := nullif(p->>'obra_clave', '');
  v_fin      boolean;
  v_tarde    boolean := false;
  v_aviso    text;
begin
  -- SQL 59: medición normalizada (textos largos del formulario)
  p := public.norm_medicion_payload(p);
  v_nueva := p->'ot_nueva';
  if auth.uid() is null then
    raise exception 'Sesión vencida: volvé a entrar.';
  end if;
  if not ('taller' = any (coalesce(mis_formularios(), '{}'))) then
    raise exception 'Tu usuario no tiene habilitado el formulario de taller.';
  end if;
  if v_client is null then
    raise exception 'Falta client_id';
  end if;

  -- Reenvío: ya está guardado.
  select r.id, o.numero into v_existe
  from ot_registros r join ordenes_trabajo o on o.id = r.ot_id
  where r.client_id = v_client;
  if found then
    return jsonb_build_object('registro_id', v_existe.id, 'numero', v_existe.numero, 'repetido', true);
  end if;

  if v_obra is not null and not exists (select 1 from obras where clave = v_obra) then
    v_obra := null;
  end if;

  -- ── La OT ──
  if v_nueva is not null and jsonb_typeof(v_nueva) = 'object' then
    v_equipo := nullif(v_nueva->>'equipo_id', '');

    -- SQL 60: un reporte de falla se suma SOLO a una OT Solicitada de la
    -- misma máquina (nunca a una Abierta). Si no hay, se crea una nueva
    -- Solicitada más abajo.
    if v_cond = 'Reporte de Fallas' and v_equipo is not null then
      select * into v_ot from ordenes_trabajo
      where equipo_id = v_equipo and estado = 'Solicitada'
      order by creado_en desc limit 1;
      if found then
        update ordenes_trabajo
           set fallas = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(fallas || coalesce(
                           (select array_agg(value) from jsonb_array_elements_text(v_nueva->'fallas')), '{}')) x),
               imagenes = imagenes || coalesce(
                           (select array_agg(value) from jsonb_array_elements_text(v_nueva->'imagenes')), '{}')
         where id = v_ot.id;
      end if;
    end if;

    if v_ot.id is null then
      insert into ordenes_trabajo
        (estado, condicion_origen, nombre, tipo_ot, equipo_id, trabajo_general,
         obra_clave, ubicacion_texto, lider_cedula, fallas, sintomas,
         tipo_medicion, lectura_ingreso, estado_maquina_ingreso, ingreso_por_averia,
         paro_maquina, fecha_ingreso, fecha_estimada_cierre, imagenes,
         origen, submission_id, creado_por)
      values
        (case when v_cond = 'Reporte de Fallas' then 'Solicitada' else 'Abierta' end,
         case when v_cond = 'Cierre de OT - Taller' then 'Registro de Trabajos - OT' else v_cond end,
         left(coalesce(nullif(v_nueva->>'nombre', ''), 'OT sin nombre'), 200),
         nullif(v_nueva->>'tipo_ot', ''),
         v_equipo,
         case when v_equipo is null then coalesce(nullif(v_nueva->>'trabajo_general', ''), 'SERVICIOS GENERALES') end,
         v_obra, nullif(p->>'ubicacion_texto', ''),
         nullif(v_nueva->>'lider_cedula', ''),
         coalesce((select array_agg(value) from jsonb_array_elements_text(v_nueva->'fallas')), '{}'),
         nullif(v_nueva->>'sintomas', ''),
         nullif(coalesce(v_nueva->>'tipo_medicion', p->>'tipo_medicion'), ''),
         coalesce((v_nueva->>'lectura_ingreso')::numeric, (p->>'lectura')::numeric),
         nullif(coalesce(v_nueva->>'estado_maquina_ingreso', p->>'estado_maquina'), ''),
         (v_nueva->>'ingreso_por_averia')::boolean,
         (nullif(v_nueva->>'paro_maquina', ''))::timestamptz,
         coalesce((nullif(v_nueva->>'fecha_ingreso', ''))::timestamptz, now()),
         (nullif(v_nueva->>'fecha_estimada_cierre', ''))::date,
         coalesce((select array_agg(value) from jsonb_array_elements_text(v_nueva->'imagenes')), '{}'),
         'pwa', 'pwa-' || v_client, auth.uid())
      on conflict (submission_id) do nothing;
      select * into v_ot from ordenes_trabajo where submission_id = 'pwa-' || v_client;
    end if;
  else
    select * into v_ot from ordenes_trabajo where numero = (p->>'ot_numero')::bigint;
    if not found then
      raise exception 'OT_NO_EXISTE: no existe la OT %. Revisá el número.', p->>'ot_numero';
    end if;
    if v_ot.estado = 'Anulada' then
      raise exception 'OT_CERRADA: la OT % está anulada.', v_ot.numero;
    end if;
    if v_ot.estado = 'Cerrada' then
      -- SQL 65: 48 h para que los demás mecánicos carguen sus horas
      if v_cond = 'Registro de Trabajos - OT'
         and coalesce(v_ot.fecha_cierre, v_ot.actualizado_en) >= now() - interval '48 hours' then
        v_tarde := true;
      else
        raise exception 'OT_CERRADA: la OT % ya está cerrada%. Si se siguió trabajando, abrí una OT nueva.',
          v_ot.numero,
          case when v_cond = 'Registro de Trabajos - OT' then ' hace más de 48 h' else '' end;
      end if;
    end if;
  end if;

  -- ── ¿Este registro cierra la OT? (SQL 65) ──
  v_fin := coalesce((p->>'finaliza_ot')::boolean, false) or v_cond = 'Cierre de OT - Taller';
  if v_tarde then
    v_fin := false;
  elsif v_fin and v_cond = 'Registro de Trabajos - OT' and v_ot.equipo_id is not null then
    if ot_tipo_efectivo(v_ot.tipo_ot, v_ot.obra_clave, v_ot.ubicacion_texto) = 'Taller' then
      v_fin := false;
      v_aviso := 'La OT ' || v_ot.numero || ' es de taller: queda abierta hasta cargar la Inspección Final - Taller.';
    elsif not ot_estado_permite_cierre(nullif(p->>'estado_maquina', '')) then
      v_fin := false;
      v_aviso := 'La OT ' || v_ot.numero || ' quedó abierta: para cerrarla la máquina tiene que quedar Reparado, Reparado - Fallas menores o Servicio Tercerizado.';
    end if;
  end if;

  -- ── El registro ──
  insert into ot_registros
    (client_id, ot_id, condicion, fecha, tecnico_cedula, tecnico_texto,
     obra_clave, ubicacion_texto, trabajo_ejecutado, fallas,
     tipo_medicion, lectura, foto_lectura, tipo_mantenimiento, horas_mantenimiento,
     horas_supervision_tercerizada, realizo_traslado, horas_traslado,
     estado_maquina, finaliza_ot, boletas_salida, fotos_boletas, fotos,
     detalle, observaciones, firma, origen, usuario_id, extras)
  values
    (v_client, v_ot.id, v_cond,
     coalesce((nullif(p->>'fecha', ''))::date, current_date),
     nullif(p->>'tecnico_cedula', ''), nullif(p->>'tecnico_texto', ''),
     v_obra, nullif(p->>'ubicacion_texto', ''),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'trabajo_ejecutado')), '{}'),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'fallas')), '{}'),
     nullif(p->>'tipo_medicion', ''), (p->>'lectura')::numeric, nullif(p->>'foto_lectura', ''),
     nullif(p->>'tipo_mantenimiento', ''), (p->>'horas_mantenimiento')::numeric,
     (p->>'horas_supervision_tercerizada')::numeric,
     (p->>'realizo_traslado')::boolean, (p->>'horas_traslado')::numeric,
     -- en una OT ya cerrada el estado no se guarda (no pisa el de salida)
     case when v_tarde then null else nullif(p->>'estado_maquina', '') end,
     v_fin,
     coalesce(p->'boletas_salida', '[]'::jsonb),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'fotos_boletas')), '{}'),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'fotos')), '{}'),
     nullif(p->>'detalle', ''), nullif(p->>'observaciones', ''), nullif(p->>'firma', ''),
     'pwa', auth.uid(),
     case when jsonb_typeof(p->'extras') = 'object' and p->'extras' <> '{}'::jsonb then p->'extras' end)
  returning id into v_reg;

  insert into ot_registro_items (registro_id, sistema, componente, horas, estado_reparacion)
  select v_reg, i.sistema, i.componente, i.horas, nullif(i.estado_reparacion, '')
  from jsonb_to_recordset(coalesce(p->'items', '[]'::jsonb))
       as i(sistema text, componente text, horas numeric, estado_reparacion text)
  where i.sistema is not null and i.componente is not null
    and (coalesce(i.horas, 0) > 0 or nullif(i.estado_reparacion, '') is not null)
  on conflict do nothing;

  insert into ot_checklist (registro_id, checklist, item, resultado)
  select v_reg, c.checklist, c.item, c.resultado
  from jsonb_to_recordset(coalesce(p->'checklist', '[]'::jsonb))
       as c(checklist text, item text, resultado text)
  where c.checklist is not null and c.item is not null and nullif(c.resultado, '') is not null
  on conflict do nothing;

  return jsonb_build_object('registro_id', v_reg, 'numero', v_ot.numero,
                            'estado', (select estado from ordenes_trabajo where id = v_ot.id),
                            'aviso', v_aviso);
end;
$$;
revoke execute on function public.ot_registrar(jsonb) from public, anon;
grant execute on function public.ot_registrar(jsonb) to authenticated;

-- ── 6. v_ot: tipo de OT efectivo (columnas nuevas al final) ────────────
create or replace view public.v_ot with (security_invoker = true) as
SELECT o.id,
    o.numero,
    o.estado,
    o.condicion_origen,
    o.nombre,
    o.tipo_ot,
    o.equipo_id,
    COALESCE(e.descripcion, o.trabajo_general) AS equipo,
    e.tipo AS tipo_equipo,
    o.trabajo_general,
    o.obra_clave,
    COALESCE(ob.nombre, o.ubicacion_texto) AS ubicacion,
    o.lider_cedula,
    li.nombre AS lider,
    o.fallas,
    o.sintomas,
    COALESCE(o.fecha_ingreso, o.creado_en) AS abierta_el,
    o.fecha_estimada_cierre,
    o.fecha_cierre,
        CASE
            WHEN o.estado = ANY (ARRAY['Abierta'::text, 'Solicitada'::text]) THEN CURRENT_DATE - COALESCE(o.fecha_ingreso, o.creado_en)::date
            ELSE o.fecha_cierre::date - COALESCE(o.fecha_ingreso, o.creado_en)::date
        END AS dias,
        CASE
            WHEN o.estado = 'Abierta'::text AND o.fecha_estimada_cierre < CURRENT_DATE THEN true
            ELSE false
        END AS atrasada,
    r.registros,
    r.tecnicos,
    r.horas_trabajo,
    r.horas_traslado,
    r.ultimo_registro,
    r.ultimo_estado_maquina,
    o.estado_maquina_salida,
    o.parte_id,
    o.origen,
    COALESCE(NULLIF(TRIM(o.tipo_ot), ''),
      CASE WHEN COALESCE(ob.nombre, o.ubicacion_texto, '') ILIKE '%taller central%' THEN 'Taller' ELSE 'Pista' END) AS tipo_ot_efectivo,
    nullif(trim(o.tipo_ot), '') IS NULL AS tipo_ot_inferido
   FROM ordenes_trabajo o
     LEFT JOIN equipos e ON e.id = o.equipo_id
     LEFT JOIN obras ob ON ob.clave = o.obra_clave
     LEFT JOIN operadores li ON li.cedula = o.lider_cedula
     LEFT JOIN LATERAL ( SELECT count(*) AS registros,
            array_agg(DISTINCT COALESCE(t.nombre, x.tecnico_texto)) FILTER (WHERE COALESCE(t.nombre, x.tecnico_texto) IS NOT NULL) AS tecnicos,
            sum(COALESCE(it.horas, 0::numeric)) + sum(COALESCE(x.horas_mantenimiento, 0::numeric)) AS horas_trabajo,
            sum(COALESCE(x.horas_traslado, 0::numeric)) AS horas_traslado,
            max(x.fecha) AS ultimo_registro,
            (array_agg(x.estado_maquina ORDER BY x.creado_en DESC) FILTER (WHERE x.estado_maquina IS NOT NULL))[1] AS ultimo_estado_maquina
           FROM ot_registros x
             LEFT JOIN operadores t ON t.cedula = x.tecnico_cedula
             LEFT JOIN LATERAL ( SELECT sum(i.horas) AS horas
                   FROM ot_registro_items i
                  WHERE i.registro_id = x.id) it ON true
          WHERE x.ot_id = o.id) r ON true;

-- ── 7. Tarifa horaria por técnico ───────────────────────────────────────
create table if not exists public.tecnico_tarifas (
  id          bigint generated always as identity primary key,
  cedula      text not null references public.operadores(cedula) on update cascade on delete cascade,
  desde       date not null default date '2000-01-01',
  tarifa_hora numeric not null check (tarifa_hora >= 0),
  nota        text,
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now(),
  unique (cedula, desde)
);
alter table public.tecnico_tarifas enable row level security;

create or replace function public.ve_costos_taller()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol()::text in ('admin_central', 'gerente'), false)
$$;
revoke execute on function public.ve_costos_taller() from public, anon;
grant execute on function public.ve_costos_taller() to authenticated;

drop policy if exists tecnico_tarifas_lectura on public.tecnico_tarifas;
create policy tecnico_tarifas_lectura on public.tecnico_tarifas
  for select to authenticated using ((select public.ve_costos_taller()));
drop policy if exists tecnico_tarifas_escritura on public.tecnico_tarifas;
create policy tecnico_tarifas_escritura on public.tecnico_tarifas
  for all to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
grant select, insert, update, delete on public.tecnico_tarifas to authenticated;
revoke all on public.tecnico_tarifas from anon;

-- Tarifa del técnico para una fecha: la vigente a esa fecha; si la fecha es
-- anterior a la primera tarifa cargada, se usa la primera.
create or replace function public.tarifa_tecnico(p_cedula text, p_fecha date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(
    (select t.tarifa_hora from tecnico_tarifas t where t.cedula = p_cedula and t.desde <= p_fecha
      order by t.desde desc limit 1),
    (select t.tarifa_hora from tecnico_tarifas t where t.cedula = p_cedula order by t.desde limit 1))
$$;

-- ── 8. v_ot_horas: trabajos + mantenimiento + traslado, con costo ──────
-- Mismas columnas de antes (mes … estado_reparacion) y nuevas al final.
-- tarifa_hora y costo salen vacíos para quien no ve costos (la tabla de
-- tarifas tiene RLS y la vista corre con los permisos de quien consulta).
create or replace view public.v_ot_horas with (security_invoker = true) as
with h as (
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         i.sistema, i.componente, i.horas, i.estado_reparacion, 'trabajo'::text as tipo_hora
  from ot_registro_items i join ot_registros x on x.id = i.registro_id
  where coalesce(i.horas, 0) > 0
  union all
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         'MTTO. ACEITES', 'Service ' || coalesce(x.tipo_mantenimiento || ' h', ''), x.horas_mantenimiento, null, 'mantenimiento'
  from ot_registros x where coalesce(x.horas_mantenimiento, 0) > 0
  union all
  select x.fecha, x.ot_id, x.tecnico_cedula, x.tecnico_texto,
         'TRASLADO', 'Traslado', x.horas_traslado, null, 'traslado'
  from ot_registros x where coalesce(x.horas_traslado, 0) > 0
)
select date_trunc('month', h.fecha::timestamptz)::date as mes,
       h.fecha,
       o.numero as ot,
       o.equipo_id,
       h.tecnico_cedula,
       coalesce(t.nombre, h.tecnico_texto) as tecnico,
       h.sistema,
       h.componente,
       h.horas,
       h.estado_reparacion,
       h.tipo_hora,
       o.nombre as ot_nombre,
       o.estado as ot_estado,
       coalesce(nullif(trim(o.tipo_ot), ''),
         case when coalesce(ob.nombre, o.ubicacion_texto, '') ilike '%taller central%' then 'Taller' else 'Pista' end) as tipo_ot,
       coalesce(e.descripcion, o.trabajo_general) as equipo,
       e.tipo as tipo_equipo,
       tf.tarifa as tarifa_hora,
       round(h.horas * tf.tarifa) as costo
from h
join ordenes_trabajo o on o.id = h.ot_id
left join operadores t on t.cedula = h.tecnico_cedula
left join equipos e on e.id = o.equipo_id
left join obras ob on ob.clave = o.obra_clave
left join lateral (select tarifa_tecnico(h.tecnico_cedula, h.fecha) as tarifa) tf on true;

grant select on public.v_ot, public.v_ot_horas to authenticated;

create index if not exists ot_registros_ot_cond_idx on public.ot_registros (ot_id, condicion);
create index if not exists tecnico_tarifas_cedula_idx on public.tecnico_tarifas (cedula, desde desc);

-- ── Comprobación ────────────────────────────────────────────────────────
select
  (select count(*) from pg_trigger where tgname = 'trg_ot_cierre_valido')                    as trigger_ok_1,
  public.ot_estado_permite_cierre('Reparado- Fallas menores')                                 as reparado_fm_true,
  public.ot_estado_permite_cierre('Servicio Tercerizado')                                     as tercerizado_true,
  public.ot_estado_permite_cierre('Esperando repuestos')                                      as esperando_false,
  (select count(*) from information_schema.columns
    where table_name = 'v_ot' and column_name in ('tipo_ot_efectivo', 'tipo_ot_inferido'))     as columnas_v_ot_2,
  (select count(*) from information_schema.columns
    where table_name = 'v_ot_horas' and column_name in ('tipo_hora', 'tarifa_hora', 'costo'))  as columnas_horas_3,
  (select count(*) from public.ordenes_trabajo where tipo_ot is null)                           as ot_con_tipo_estimado;
