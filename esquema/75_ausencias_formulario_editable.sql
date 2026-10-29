-- =========================================================================
-- 75_ausencias_formulario_editable.sql · equipos-v80 (29/10/2026)
--
-- El formulario «Ausencias de taller» se edita en el mismo formulario
-- («✏️ Editar formulario», admin central), igual que el parte diario, el
-- reporte de taller y la carga de combustible (SQL 49):
--   · etiqueta, ayuda, obligatorio y mostrar/ocultar de cada campo;
--   · las opciones de MOTIVO (se pueden agregar motivos nuevos; Vacaciones,
--     Receso en obra y Ausencia justificada no se pueden quitar);
--   · campos nuevos (texto, número, fecha, sí/no, lista, casillas), que se
--     guardan en taller_ausencias.extras.
--
--   1) form_secciones admite el formulario 'ausencias' + su sección y campos.
--   2) taller_ausencias.extras (jsonb) y el motivo deja de estar limitado a
--      los tres de siempre (cualquier motivo no vacío).
--   3) form_definicion_fx devuelve también 'ausencias'.
--
-- No borra datos. Se puede correr más de una vez.
-- =========================================================================

-- ── 1) Formulario, sección y campos ─────────────────────────────────────
alter table public.form_secciones drop constraint if exists form_secciones_formulario_valido;
alter table public.form_secciones add constraint form_secciones_formulario_valido
  check (formulario = any (array['parte', 'taller', 'combustible', 'ausencias']));

insert into public.form_secciones (clave, titulo, icono, orden, activa, formulario)
values ('a_ausencia', 'Cargar ausencia', '🗓️', 1, true, 'ausencias')
on conflict (clave) do nothing;

insert into public.form_campos (seccion_id, clave, etiqueta, tipo, orden, requerido, activo, es_sistema, bloqueado, ayuda, opciones)
select s.id, v.clave, v.etiqueta, v.tipo, v.orden, v.requerido, true, true, v.bloqueado, v.ayuda, v.opciones
  from public.form_secciones s,
       (values
         ('au_supervisor', 'Supervisor',          'select',   1, true,  false, null::text, null::jsonb),
         ('au_personas',   'Personal de taller',  'casillas', 2, true,  true,  'Se pueden marcar varias personas: se carga la misma ausencia para cada una.', null),
         ('au_desde',      'Fecha inicio',        'fecha',    3, true,  true,  null, null),
         ('au_hasta',      'Fecha final',         'fecha',    4, true,  true,  null, null),
         ('au_motivo',     'Motivo',              'select',   5, true,  true,  null, '["Vacaciones", "Receso en obra", "Ausencia justificada"]'::jsonb),
         ('au_obs',        'Observaciones',       'textarea', 6, false, false, null, null)
       ) v(clave, etiqueta, tipo, orden, requerido, bloqueado, ayuda, opciones)
 where s.clave = 'a_ausencia'
on conflict (clave) do nothing;

-- ── 2) Ausencias: campos nuevos y motivos nuevos ────────────────────────
alter table public.taller_ausencias add column if not exists extras jsonb not null default '{}'::jsonb;
alter table public.taller_ausencias drop constraint if exists taller_ausencias_motivo_check;
alter table public.taller_ausencias add constraint taller_ausencias_motivo_check check (btrim(motivo) <> '');

-- ── 3) La definición que bajan los formularios ──────────────────────────
create or replace function public.form_definicion_fx()
returns jsonb language sql stable set search_path = public as $$
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
     where s.formulario in ('taller', 'combustible', 'ausencias') and s.activa
     group by s.formulario
  ) f;
$$;

-- ── Comprobación ─────────────────────────────────────────────────────────
select
  (select count(*) from public.form_campos c join public.form_secciones s on s.id = c.seccion_id where s.formulario = 'ausencias') as campos_6,
  (select count(*) from information_schema.columns where table_name = 'taller_ausencias' and column_name = 'extras')          as extras_1,
  (public.form_definicion_fx() ? 'ausencias')                                                                                   as definicion_true;
