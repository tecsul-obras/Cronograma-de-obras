-- ══════════════════════════════════════════════════════════════════
-- 60 · Un "Reporte de Fallas" deja la OT SOLICITADA, nunca la abre
-- (equipos-v65, 27/10/2026)
--
-- Antes: si la máquina tenía cualquier OT Solicitada o ABIERTA, el reporte
-- de falla se sumaba a esa OT. Caso real (26/10): un reporte de EX-11 cayó
-- en la OT 11673, una OT vieja de JotForm que había quedado "Abierta".
--
-- Ahora:
--   · Si la máquina tiene una OT Solicitada → la falla (y sus fotos) se
--     suman a esa OT, que sigue Solicitada.
--   · Si no (aunque tenga una OT Abierta) → se crea una OT nueva
--     Solicitada. Taller decide si la toma o la anula/suma.
--   · Una OT pasa a Abierta solo cuando taller la toma o carga un
--     Diagnóstico / Registro de Trabajos (eso no cambia).
--
-- Se corre una vez en el SQL Editor. No toca datos.
-- ══════════════════════════════════════════════════════════════════

create or replace function public.ot_registrar(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_client   text := nullif(p->>'client_id', '');
  v_cond     text := coalesce(nullif(p->>'condicion', ''), 'Registro de Trabajos - OT');
  v_nueva    jsonb := p->'ot_nueva';
  v_ot       ordenes_trabajo%rowtype;
  v_reg      uuid;
  v_existe   record;
  v_equipo   text;
  v_obra     text := nullif(p->>'obra_clave', '');
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
    if v_ot.estado in ('Cerrada', 'Anulada') then
      raise exception 'OT_CERRADA: la OT % ya está %. Si se siguió trabajando, abrí una OT nueva.',
        v_ot.numero, lower(v_ot.estado);
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
     nullif(p->>'estado_maquina', ''),
     coalesce((p->>'finaliza_ot')::boolean, false) or v_cond = 'Cierre de OT - Taller',
     coalesce(p->'boletas_salida', '[]'::jsonb),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'fotos_boletas')), '{}'),
     coalesce((select array_agg(value) from jsonb_array_elements_text(p->'fotos')), '{}'),
     nullif(p->>'detalle', ''), nullif(p->>'observaciones', ''), nullif(p->>'firma', ''),
     'pwa', auth.uid(),
     -- v20261019a: campos agregados por el administrador
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
                            'estado', (select estado from ordenes_trabajo where id = v_ot.id));
end;
$function$;

-- Comprobación: tiene que decir "solo Solicitada".
select case when pg_get_functiondef('public.ot_registrar(jsonb)'::regprocedure) like '%estado = ''Solicitada''%'
            then 'OK: reporte de fallas solo se suma a OT Solicitada' else 'NO SE APLICÓ' end as sql_60;
