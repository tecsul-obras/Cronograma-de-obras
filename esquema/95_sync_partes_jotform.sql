-- ══════════════════════════════════════════════════════════════════
-- 95 · Sincronización automática JotForm → partes (06/11/2026)
--
-- La llama el Apps Script de la hoja «DATA REGISTRO PARTE DIARIO
-- EQUIPOS» (la que JotForm mantiene al día). Reemplaza el trabajo a
-- mano de bajar el Excel y correr migrar_partes_jotform.py.
--
--   sync_partes_jotform(filas, probar)
--     · partes nuevos  → se cargan (y se dan de alta equipo, operador,
--       obra, propietario e ítem si no existen, como hacía el script).
--     · partes que ya están y cambiaron en JotForm → se corrigen solo
--       los campos que cambiaron (queda en log_ediciones, sin usuario).
--     · NO se tocan: partes cargados desde la app, partes que alguien
--       corrigió a mano en la app (log con usuario) ni la fecha de envío.
--
--   sync_partes_jotform_borrados(ids, dias, probar)
--     · partes de JotForm de los últimos «dias» que ya no están en la
--       hoja (se eliminaron en JotForm) → van a la PAPELERA (7 días,
--       se restauran desde la app) y se quitan de partes.
--     · Freno: si faltan demasiados (más de 30 o del 3 %), no borra
--       nada y lo avisa (hoja incompleta o error de lectura).
--
-- Con probar = true hace todo y lo deshace al final: solo devuelve el
-- informe. Cada corrida queda en sync_jotform_log.
--
-- Solo la puede llamar la clave secreta (service_role). Correr una vez
-- en el SQL Editor; se puede volver a correr sin problema.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.sync_jotform_log (
  id       bigserial primary key,
  momento  timestamptz not null default now(),
  etapa    text not null,                 -- 'filas' | 'borrados'
  probar   boolean not null,
  resumen  jsonb not null
);
alter table public.sync_jotform_log enable row level security;
drop policy if exists sync_jotform_log_ver on public.sync_jotform_log;
create policy sync_jotform_log_ver on public.sync_jotform_log
  for select to authenticated using (es_admin());

-- Partes que la sincronización ya mandó a la papelera: si alguien los
-- restaura, no se vuelven a borrar en la próxima corrida.
create table if not exists public.sync_jotform_borrados (
  client_id  text primary key,
  borrado_en timestamptz not null default now()
);
alter table public.sync_jotform_borrados enable row level security;

-- La papelera (SQL 54) solo aceptaba combustible y taller: se suman los partes.
-- Se ven y se restauran desde Parte diario › Administración › Papelera.
alter table public.papelera drop constraint if exists papelera_tabla_check;
alter table public.papelera add constraint papelera_tabla_check
  check (tabla = any (array['combustible_movimientos', 'ot_registros', 'partes']));


-- Texto comparable: sin \r, sin espacios en los bordes, vacío = null.
-- (JotForm a veces guarda los saltos de línea como \r\n y a veces \n.)
create or replace function public.sync_jf_txt(v jsonb)
returns text language sql immutable as $$
  select nullif(btrim(replace(case when jsonb_typeof(v) = 'string' then v #>> '{}'
                                   when v is null or jsonb_typeof(v) = 'null' then null
                                   else v::text end, E'\r', '')), '')
$$;


-- ¿Hay un certificado de máquinas EMITIDO que cubre esa obra y ese día?
-- Devuelve «N° x (dd/mm–dd/mm)» o null. Un parte que ya está en un
-- certificado emitido no se corrige ni se borra solo: se avisa.
create or replace function public.sync_jf_cert_emitido(p_obra text, p_fecha date)
returns text language sql stable set search_path to 'public' as $$
  select 'N° ' || c.numero || ' (' || to_char(c.desde, 'DD/MM') || '–' || to_char(c.hasta, 'DD/MM') || ')'
    from cert_maq c
   where c.estado = 'emitido' and p_fecha between c.desde and c.hasta
     and (c.obra_clave = p_obra or p_obra = any (coalesce(c.obras, '{}')))
   order by c.desde limit 1
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


create or replace function public.sync_partes_jotform_borrados(p_ids text[], p_dias integer default 60, p_probar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p        partes;
  n_vent   int;
  n_falta  int;
  tope     int;
  r_borr   jsonb := '[]';
  r_rev    jsonb := '[]';
  resumen  jsonb;
  motivo   text;
begin
  if coalesce(array_length(p_ids, 1), 0) < 200 then
    resumen := jsonb_build_object('probar', p_probar, 'frenado',
      'La hoja mandó ' || coalesce(array_length(p_ids, 1), 0) || ' envíos: parece incompleta, no se borra nada.');
    insert into sync_jotform_log (etapa, probar, resumen) values ('borrados', p_probar, resumen);
    return resumen;
  end if;

  -- Ventana: el parte y su envío tienen que estar dentro de los «dias».
  -- (El Apps Script manda los envíos de unos días más, así ninguno
  -- de la ventana queda afuera por un borde.)
  select count(*) into n_vent from partes
   where origen = 'jotform' and fecha >= current_date - p_dias and creado_en >= now() - make_interval(days => p_dias);

  create temp table if not exists _sync_ids (submission_id text primary key) on commit drop;
  truncate _sync_ids;
  insert into _sync_ids select distinct x from unnest(p_ids) x where x is not null on conflict do nothing;

  create temp table if not exists _sync_faltan on commit drop as select * from partes limit 0;
  truncate _sync_faltan;
  insert into _sync_faltan
  select q.* from partes q
   where q.origen = 'jotform' and q.fecha >= current_date - p_dias
     and q.creado_en >= now() - make_interval(days => p_dias)
     and not exists (select 1 from _sync_ids i where i.submission_id = q.submission_id)
     and not exists (select 1 from sync_jotform_borrados b where b.client_id = q.client_id);
  select count(*) into n_falta from _sync_faltan;

  tope := greatest(30, ceil(n_vent * 0.03)::int);
  if n_falta > tope then
    resumen := jsonb_build_object('probar', p_probar, 'en_ventana', n_vent, 'faltan', n_falta,
      'frenado', 'Faltan ' || n_falta || ' partes en la hoja (tope ' || tope || '): no se borra nada. Revisar la hoja.');
    insert into sync_jotform_log (etapa, probar, resumen) values ('borrados', p_probar, resumen);
    return resumen;
  end if;

  begin
    for p in select * from _sync_faltan order by fecha, equipo_id loop
      motivo := null;
      if exists (select 1 from log_ediciones l where l.parte_id = p.id and l.usuario_id is not null) then
        motivo := 'corregido a mano en la app';
      elsif exists (select 1 from ordenes_trabajo o where o.parte_id = p.id) then
        motivo := 'tiene una OT asociada';
      elsif exists (select 1 from horometro_saltos h where h.parte_id = p.id or h.puente_id = p.id or h.parte_anterior_id = p.id) then
        motivo := 'tiene un salto de horómetro asociado';
      elsif sync_jf_cert_emitido(p.obra_clave, p.fecha) is not null then
        motivo := 'está en el certificado de máquinas emitido ' || sync_jf_cert_emitido(p.obra_clave, p.fecha);
      end if;

      if motivo is not null then
        r_rev := r_rev || jsonb_build_object('parte', p.client_id, 'equipo', p.equipo_id, 'fecha', p.fecha, 'por_que', motivo);
        continue;
      end if;

      insert into papelera (tabla, registro_id, resumen, datos, motivo)
      values ('partes', p.id,
              'Parte ' || p.equipo_id || ' · ' || to_char(p.fecha, 'DD/MM/YYYY') || ' · ' || p.obra_clave,
              to_jsonb(p), 'Eliminado en JotForm (sincronización automática)');
      delete from partes where id = p.id;
      insert into sync_jotform_borrados (client_id) values (p.client_id) on conflict do nothing;
      r_borr := r_borr || jsonb_build_object('parte', p.client_id, 'equipo', p.equipo_id, 'fecha', p.fecha, 'obra', p.obra_clave);
    end loop;

    if p_probar then
      raise exception using errcode = 'PRB01', message = 'ensayo: se deshace todo';
    end if;
  exception when sqlstate 'PRB01' then
    null;
  end;

  resumen := jsonb_build_object('probar', p_probar, 'en_ventana', n_vent, 'ids_hoja', array_length(p_ids, 1),
                                'a_papelera', r_borr, 'revisar_a_mano', r_rev);
  insert into sync_jotform_log (etapa, probar, resumen) values ('borrados', p_probar, resumen);
  return resumen;
end
$function$;


-- Solo la clave secreta (service_role) puede llamarlas.
revoke all on function public.sync_partes_jotform(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sync_partes_jotform_borrados(text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.sync_partes_jotform(jsonb, boolean) to service_role;
grant execute on function public.sync_partes_jotform_borrados(text[], integer, boolean) to service_role;

-- Comprobación
select
  (select count(*) from pg_proc where proname in ('sync_partes_jotform','sync_partes_jotform_borrados')) as funciones_2,
  (select count(*) from information_schema.tables where table_name in ('sync_jotform_log','sync_jotform_borrados')) as tablas_2,
  has_function_privilege('anon', 'public.sync_partes_jotform(jsonb, boolean)', 'execute') as anon_puede_false;
