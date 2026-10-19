-- =========================================================================
-- 49_formularios_editables.sql · v20261019a  (Equipos › editar los formularios)
--
-- El administrador central puede editar los tres formularios (parte diario,
-- reporte de taller y carga de combustible) desde el mismo formulario, como en
-- JotForm: etiqueta, ayuda, obligatorio, ocultar, opciones, catálogos, reglas y
-- campos nuevos.
--
-- 1) form_secciones.formulario: a qué formulario pertenece cada sección
--    ('parte' — todas las que ya existían —, 'taller' o 'combustible').
-- 2) form_campos.bloqueado: campo esencial para la lógica del formulario
--    (condición, OT, máquina, litros…): se puede renombrar y cambiar su ayuda,
--    pero no ocultar ni volver opcional.
-- 3) Se registran los campos que hoy tienen taller y combustible (mismas
--    etiquetas y obligatorios que el código), para poder configurarlos.
-- 4) form_definicion() devuelve SOLO el parte diario (como hasta ahora).
--    form_definicion_fx() devuelve la configuración de taller y combustible
--    (incluye los campos ocultos, con activo = false).
-- 5) Campos nuevos de taller y combustible: se guardan en la columna extras
--    (jsonb) de ot_registros y combustible_movimientos, como el parte diario
--    ya hace con partes.extras. No tocan Power BI.
--
-- Todo es aditivo: la app vieja sigue funcionando igual (no manda extras y
-- form_definicion() le devuelve lo mismo que antes).
-- =========================================================================

alter table public.form_secciones add column if not exists formulario text not null default 'parte';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'form_secciones_formulario_valido') then
    alter table public.form_secciones add constraint form_secciones_formulario_valido
      check (formulario in ('parte', 'taller', 'combustible'));
  end if;
end $$;
alter table public.form_campos add column if not exists bloqueado boolean not null default false;

alter table public.ot_registros add column if not exists extras jsonb;
alter table public.combustible_movimientos add column if not exists extras jsonb;

-- ── Secciones y campos de taller y combustible ──────────────────────────
insert into public.form_secciones (clave, titulo, icono, orden, activa, formulario) values
  ('t_inicio',   'Reportes - Taller',             '🛠️', 1, true, 'taller'),
  ('t_fallas',   'Reporte de Fallas',             '⚠️', 2, true, 'taller'),
  ('t_diag',     'Generación OT',                 '📋', 3, true, 'taller'),
  ('t_registro', 'Gestión de OT - Obra',          '🔧', 4, true, 'taller'),
  ('t_cierre',   'Inspección Final - Taller',     '✅', 5, true, 'taller'),
  ('t_final',    '¡Casi terminamos!',             '✍️', 6, true, 'taller'),
  ('c_inicio',   'Carga de combustible',          '⛽', 1, true, 'combustible'),
  ('c_despacho', 'Despacho',                      '',   2, true, 'combustible'),
  ('c_ingreso',  'Ingreso',                       '',   3, true, 'combustible'),
  ('c_medicion', 'Medición',                      '',   4, true, 'combustible'),
  ('c_prueba',   'Prueba',                        '',   5, true, 'combustible')
on conflict (clave) do nothing;

-- (sección, clave, etiqueta, tipo, obligatorio, bloqueado, opciones)
insert into public.form_campos (seccion_id, clave, etiqueta, tipo, orden, requerido, activo, es_sistema, bloqueado, opciones)
select s.id, x.clave, x.etiqueta, x.tipo, x.orden, x.req, true, true, x.bloq, x.ops
  from (values
  -- Taller · página 1
  ('t_inicio', 'ini_condicion',  'Condición de Carga',                        'select',     1, true,  true,  null::jsonb),
  ('t_inicio', 'ini_fecha',      'Fecha de Reporte',                          'fecha',      2, true,  true,  null),
  ('t_inicio', 'ini_tecnico',    'Personal Taller',                           'catalogo',   3, true,  false, null),
  ('t_inicio', 'ini_ubicacion',  'Ubicación',                                 'catalogo',   4, true,  false, null),
  -- Taller · Reporte de Fallas
  ('t_fallas', 'fal_tipo_reporte','Tipo de Reporte',                          'select',     1, false, true,  null),
  ('t_fallas', 'fal_maquina',    'Máquina',                                   'catalogo',   2, true,  true,  null),
  ('t_fallas', 'fal_fallas',     'Falla(s)',                                  'casillas',   3, true,  false, null),
  ('t_fallas', 'fal_tipo_medicion','Tipo de Medición',                        'select',     4, true,  false, null),
  ('t_fallas', 'fal_lectura',    'Horómetro/Kilometraje (Odómetro)',          'numero',     5, true,  false, null),
  ('t_fallas', 'fal_sintomas',   'Síntomas de la máquina',                    'textarea',   6, true,  false, null),
  ('t_fallas', 'fal_fotos',      'Imágenes de la falla',                      'foto',       7, true,  false, null),
  -- Taller · Diagnóstico Inicial - Generación OT
  ('t_diag', 'dia_nombre',       'Nombre de la OT',                           'texto',      1, true,  true,  null),
  ('t_diag', 'dia_tipo_ot',      'Tipo de OT',                                'select',     2, true,  true,  null),
  ('t_diag', 'dia_lider',        'Líder de trabajo',                          'catalogo',   3, true,  false, null),
  ('t_diag', 'dia_maquinas',     'Máquina(s)',                                'catalogo',   4, true,  true,  null),
  ('t_diag', 'dia_fallas',       'Falla(s)',                                  'casillas',   5, true,  false, null),
  ('t_diag', 'dia_maquina',      'Máquina',                                   'catalogo',   6, true,  true,  null),
  ('t_diag', 'dia_tipo_medicion','Tipo de Medición',                          'select',     7, true,  false, null),
  ('t_diag', 'dia_lectura',      'Horómetro/Kilometraje (Odómetro)',          'numero',     8, true,  false, null),
  ('t_diag', 'dia_estado',       'Estado General de la Máquina',              'select',     9, true,  false,
     '["Diagnóstico","Espera de Repuestos","Pruebas de funcionamiento","Reparación","Servicio Tercerizado","Servicios Generales","Urgencia en otros equipos","Otros"]'),
  ('t_diag', 'dia_fecha_cierre', 'Fecha estimada de cierre',                  'fecha',     10, true,  false, null),
  ('t_diag', 'dia_averia',       'Ingreso a taller por avería',               'si_no',     11, true,  false, null),
  ('t_diag', 'dia_paro',         'Paro de máquina',                           'fecha_hora',12, false, false, null),
  ('t_diag', 'dia_fotos',        'Imágenes de la falla',                      'foto',      13, false, false, null),
  ('t_diag', 'dia_sintomas',     'Síntomas de la máquina/ Trabajo a ejecutar','textarea',  14, true,  false, null),
  -- Taller · Registro de Trabajos - OT
  ('t_registro', 'reg_tiene_ot', '¿Ya tienes OT?',                            'si_no',      1, true,  true,  null),
  ('t_registro', 'reg_ot',       'OT',                                        'catalogo',   2, true,  true,  null),
  ('t_registro', 'reg_nombre',   'Nombre del Trabajo',                        'texto',      3, true,  true,  null),
  ('t_registro', 'reg_maquina',  'Máquina',                                   'catalogo',   4, true,  true,  null),
  ('t_registro', 'reg_fallas',   'Falla(s)',                                  'casillas',   5, true,  false, null),
  ('t_registro', 'reg_trabajo',  'Trabajo Ejecutado',                         'casillas',   6, true,  true,  null),
  ('t_registro', 'reg_tipo_medicion','Tipo de Medición',                      'select',     7, true,  false, null),
  ('t_registro', 'reg_lectura',  'Horómetro/Kilometraje (Odómetro)',          'numero',     8, true,  false, null),
  ('t_registro', 'reg_foto_lectura','Imagen del Horómetro o Kilometraje (Odómetro)','foto', 9, true,  false, null),
  ('t_registro', 'reg_tipo_mtto','Tipo mantenimiento:',                       'select',    10, true,  false, null),
  ('t_registro', 'reg_horas_mtto','Cantidad de horas de mantenimiento',       'numero',    11, true,  false, null),
  ('t_registro', 'reg_horas_supervision','Cantidad de horas de supervisión tercerizada','numero',12, true, false, null),
  ('t_registro', 'reg_estado_reparacion','Estado de Reparación',              'select',    13, false, false,
     '["Diagnóstico en curso","Esperando repuesto","Reparación en curso","Revisión de pruebas","Reparado"]'),
  ('t_registro', 'reg_estado',   'Estado General de la Máquina',              'select',    14, true,  false,
     '["En Reparación","Esperando pruebas en Campo","Esperando repuestos","Reparado","Reparado- Fallas menores","Pendiente diagnóstico","Servicio Tercerizado","Servicios Generales","Urgencia en otros equipos","Otros"]'),
  ('t_registro', 'reg_finaliza', 'Trabajo Finalizado (Cierre de OT)',         'si_no',     15, true,  false, null),
  ('t_registro', 'reg_boletas',  'Boletas de salida',                         'texto',     16, false, false, null),
  ('t_registro', 'reg_fotos_boletas','Fotos las boletas de salida',           'foto',      17, false, false, null),
  ('t_registro', 'reg_detalle',  'Detalle del trabajo',                       'textarea',  18, true,  false, null),
  ('t_registro', 'reg_traslado', '¿Realizaste Traslado para este trabajo?',   'si_no',     19, true,  false, null),
  ('t_registro', 'reg_horas_traslado','Cantidad de horas de traslado',        'numero',    20, true,  false, null),
  -- Taller · Inspección Final
  ('t_cierre', 'cie_ot',         'OT',                                        'catalogo',   1, true,  true,  null),
  ('t_cierre', 'cie_tipo_medicion','Tipo de Medición',                        'select',     2, true,  false, null),
  ('t_cierre', 'cie_lectura',    'Horómetro/Kilometraje (Odómetro)',          'numero',     3, true,  false, null),
  ('t_cierre', 'cie_sistemas',   'Sistemas Intervenidos',                     'casillas',   4, true,  true,  null),
  ('t_cierre', 'cie_estado',     'Salida - Estado General de la Máquina',     'select',     5, true,  false,
     '["Funcional","Funcional - Fallando","Funcional - Pruebas en Campo","Otros"]'),
  ('t_cierre', 'cie_fotos',      'Salida - Fotos de la reparación',           'foto',       6, true,  false, null),
  ('t_cierre', 'cie_detalle',    'Detalle del trabajo y estado de la máquina','textarea',   7, true,  false, null),
  -- Taller · cierre del formulario
  ('t_final', 'fin_observaciones','Observaciones Generales',                  'textarea',   1, false, false, null),
  ('t_final', 'fin_firma',       'Firma de responsable',                      'firma',      2, true,  false, null),
  -- Combustible · encabezado
  ('c_inicio', 'com_actividad',  'Actividad realizada',                       'select',     1, true,  true,  null),
  ('c_inicio', 'com_fecha',      'Fecha',                                     'fecha',      2, true,  true,  null),
  ('c_inicio', 'com_hora',       'Hora',                                      'texto',      3, false, false, null),
  ('c_inicio', 'com_obra',       'Obra',                                      'catalogo',   4, false, false, null),
  ('c_inicio', 'com_despachador','Despachador',                               'catalogo',   5, true,  false, null),
  ('c_inicio', 'com_observaciones','Observaciones',                           'textarea',   6, false, false, null),
  -- Combustible · Despacho
  ('c_despacho', 'des_tanque',   'Tanque de salida',                          'catalogo',   1, true,  true,  null),
  ('c_despacho', 'des_propietario','El que recibe es',                        'select',     2, true,  true,  null),
  ('c_despacho', 'des_equipo',   'Equipo que recibe',                         'catalogo',   3, true,  true,  null),
  ('c_despacho', 'des_operador', 'Operador',                                  'catalogo',   4, false, false, null),
  ('c_despacho', 'des_receptor', 'Chapa / descripción del equipo',            'texto',      5, true,  true,  null),
  ('c_despacho', 'des_operador_texto','Operador / chofer',                    'texto',      6, false, false, null),
  ('c_despacho', 'des_lectura',  'Horómetro / Kilometraje',                   'numero',     7, false, false, null),
  ('c_despacho', 'des_cl_inicial','Cuenta litros inicial',                    'numero',     8, false, false, null),
  ('c_despacho', 'des_cl_final', 'Cuenta litros final',                       'numero',     9, false, false, null),
  ('c_despacho', 'des_litros',   'Litros despachados',                        'numero',    10, true,  true,  null),
  ('c_despacho', 'des_boleta',   'Nº de boleta / remisión',                   'texto',     11, false, false, null),
  ('c_despacho', 'des_foto_cl_ini','Foto cuenta litros inicial',              'foto',      12, false, false, null),
  ('c_despacho', 'des_foto_cl_fin','Foto cuenta litros final',                'foto',      13, false, false, null),
  ('c_despacho', 'des_foto_boleta','Foto de la boleta',                       'foto',      14, false, false, null),
  -- Combustible · Ingreso
  ('c_ingreso', 'ing_tanque',    'Tanque fijo que recibe',                    'catalogo',   1, true,  true,  null),
  ('c_ingreso', 'ing_proveedor', 'Proveedor',                                 'texto',      2, true,  false, null),
  ('c_ingreso', 'ing_litros',    'Litros ingresados',                         'numero',     3, true,  true,  null),
  ('c_ingreso', 'ing_boleta',    'Nº de boleta / remisión',                   'texto',      4, false, false, null),
  ('c_ingreso', 'ing_foto_boleta','Foto de la boleta',                        'foto',       5, false, false, null),
  -- Combustible · Medición
  ('c_medicion', 'med_tanque',   'Tanque medido',                             'catalogo',   1, true,  true,  null),
  ('c_medicion', 'med_stock',    'Cantidad de combustible en el tanque (litros)','numero',  2, true,  true,  null),
  -- Combustible · Prueba de desviación
  ('c_prueba', 'pru_tanque',     'Tanque / surtidor',                         'catalogo',   1, true,  true,  null),
  ('c_prueba', 'pru_1',          '1ra prueba',                                'numero',     2, true,  true,  null),
  ('c_prueba', 'pru_2',          '2da prueba',                                'numero',     3, false, false, null),
  ('c_prueba', 'pru_3',          '3ra prueba',                                'numero',     4, false, false, null)
  ) as x(seccion, clave, etiqueta, tipo, orden, req, bloq, ops)
  join public.form_secciones s on s.clave = x.seccion
on conflict (clave) do nothing;

-- ── El parte diario: solo sus secciones (como hasta ahora) ──────────────
CREATE OR REPLACE FUNCTION public.form_definicion()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'version', (
      select greatest(
        coalesce((select max(actualizado_en) from form_campos),    'epoch'),
        coalesce((select max(actualizado_en) from form_secciones), 'epoch')
      )
    ),
    'reglas', (select jsonb_object_agg(clave, valor) from form_reglas),
    -- {'CV-01': 'CV', 'PH-01': 'PH', ...}
    'familias', (select jsonb_object_agg(id, familia)
                 from equipos where activo and familia is not null),
    'secciones', coalesce(jsonb_agg(sec order by sec->>'orden'), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'clave',  s.clave,
      'titulo', s.titulo,
      'icono',  s.icono,
      'orden',  s.orden,
      'campos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'clave',       c.clave,
          'etiqueta',    c.etiqueta,
          'tipo',        c.tipo,
          'orden',       c.orden,
          'requerido',   c.requerido,
          'placeholder', c.placeholder,
          'ayuda',       c.ayuda,
          'opciones',    c.opciones,
          'catalogo',    c.catalogo,
          'minimo',      c.minimo,
          'maximo',      c.maximo,
          'paso',        c.paso,
          'visible_si',  c.visible_si,
          'solo_roles',  c.solo_roles,
          'defecto',     c.valor_defecto,
          'destino',     c.columna_destino
        ) order by c.orden)
        from form_campos c
        where c.seccion_id = s.id and c.activo
      ), '[]'::jsonb)
    ) as sec
    from form_secciones s
    where s.activa and s.formulario = 'parte'   -- v20261019a: taller y combustible van por form_definicion_fx()
  ) x;
$function$;

-- ── Taller y combustible: configuración de cada campo (también los ocultos) ──
CREATE OR REPLACE FUNCTION public.form_definicion_fx()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(f.formulario, f.def), '{}'::jsonb)
  from (
    select s.formulario,
           jsonb_agg(jsonb_build_object(
             'clave', s.clave, 'titulo', s.titulo, 'icono', s.icono, 'orden', s.orden,
             'campos', coalesce((
               select jsonb_agg(jsonb_build_object(
                 'clave', c.clave, 'etiqueta', c.etiqueta, 'tipo', c.tipo, 'orden', c.orden,
                 'requerido', c.requerido, 'activo', c.activo, 'ayuda', c.ayuda,
                 'placeholder', c.placeholder, 'opciones', c.opciones,
                 'es_sistema', c.es_sistema, 'bloqueado', c.bloqueado
               ) order by c.orden)
               from form_campos c where c.seccion_id = s.id
             ), '[]'::jsonb)
           ) order by s.orden) as def
      from form_secciones s
     where s.formulario in ('taller', 'combustible') and s.activa
     group by s.formulario
  ) f;
$function$;
grant execute on function public.form_definicion_fx() to authenticated;

-- Un campo bloqueado no se puede ocultar ni volver opcional (se puede renombrar)
CREATE OR REPLACE FUNCTION public.fn_proteger_campos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.es_sistema then
      raise exception 'El campo "%" lo necesita la aplicación para '
        'funcionar. Se puede desactivar (activo = false) pero no borrar.',
        old.etiqueta;
    end if;
    return old;
  end if;

  if old.es_sistema then
    if new.clave <> old.clave then
      raise exception 'No se puede cambiar la clave de un campo del sistema';
    end if;
    if new.columna_destino is distinct from old.columna_destino then
      raise exception 'No se puede cambiar dónde se guarda un campo del sistema';
    end if;
    if new.tipo <> old.tipo then
      raise exception 'No se puede cambiar el tipo de un campo del sistema';
    end if;
    new.es_sistema := true;   -- que nadie se lo saque de encima
  end if;
  -- v20261019a: los campos esenciales siempre se muestran y son obligatorios
  if old.bloqueado then
    new.bloqueado := true;
    if not new.activo then
      raise exception 'El campo "%" es esencial para el formulario: no se puede ocultar.', old.etiqueta;
    end if;
    if new.requerido is distinct from old.requerido then
      raise exception 'El campo "%" es esencial para el formulario: no se puede cambiar si es obligatorio.', old.etiqueta;
    end if;
  end if;
  return new;
end;
$function$;

-- ── ot_registrar: guarda también los campos nuevos (extras) ─────────────
CREATE OR REPLACE FUNCTION public.ot_registrar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Un reporte de falla de una máquina que ya tiene una OT abierta
    -- se suma a esa OT (igual que hace el parte diario).
    if v_cond = 'Reporte de Fallas' and v_equipo is not null then
      select * into v_ot from ordenes_trabajo
      where equipo_id = v_equipo and estado in ('Solicitada', 'Abierta')
      order by creado_en desc limit 1;
      if found then
        update ordenes_trabajo
           set fallas = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(fallas || coalesce(
                           (select array_agg(value) from jsonb_array_elements_text(v_nueva->'fallas')), '{}')) x)
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

-- REVERTIR (las columnas y filas nuevas pueden quedar; no molestan):
--   volver a crear form_definicion() sin "and s.formulario = 'parte'" y
--   ot_registrar() sin la columna extras; drop function form_definicion_fx().
