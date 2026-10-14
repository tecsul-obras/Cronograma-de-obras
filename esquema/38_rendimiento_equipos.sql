-- =========================================================================
-- 38_rendimiento_equipos.sql · v20261014b  (app de Equipos: parte diario y flota)
--
-- 1) v_ultimo_parte (la usan v_flota, v_mantenimiento_plan y v_alertas_flota)
--    busca, por equipo, el último parte, el último con horómetro y el último
--    con km. El índice (equipo_id, fecha, creado_en) sirve para el primero, pero
--    para "el último con km" recorría TODOS los partes del equipo descartando los
--    que no tienen km (la mayoría de las máquinas no usa km): ~3 s por consulta.
--    Dos índices parciales lo dejan en una lectura por equipo.
--
-- 2) Políticas RLS: es_taller(), ve_flota(), mi_rol(), mi_cedula(), mis_obras()
--    y auth.uid() no dependen de la fila, pero escritas así Postgres las ejecuta
--    UNA VEZ POR FILA (partes: 45 mil filas). Envueltas en (select …) se calculan
--    una vez por consulta (recomendación "auth_rls_initplan" del asesor de
--    Supabase). Mismas expresiones, mismo resultado.
--    mis_obras() devuelve text[]: va con cast para que "= ANY" la tome como arreglo.
--
-- Verificado antes de aplicar, en una transacción descartada: mismas filas
-- (cantidad y hash del contenido) para cada usuario probado en todas las tablas
-- con políticas reescritas. Ver el resumen en el PR.
-- Para volver atrás: el bloque REVERTIR del final.
-- =========================================================================

create index if not exists partes_equipo_fecha_horometro_idx
  on public.partes (equipo_id, fecha desc, creado_en desc) where horometro_final is not null;
create index if not exists partes_equipo_fecha_km_idx
  on public.partes (equipo_id, fecha desc, creado_en desc) where km_final is not null;

do $$
declare p record; q text; w text; s text;
begin
  for p in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(es_taller|ve_flota|mi_rol|mi_cedula|mis_obras)\(\)|auth\.uid\(\)'
  loop
    q := p.qual; w := p.with_check;
    -- el orden importa: ningún reemplazo genera texto que otro vuelva a tocar
    q := replace(q, 'auth.uid()', '(select auth.uid())');
    w := replace(w, 'auth.uid()', '(select auth.uid())');
    q := replace(q, 'mis_obras()', '(select public.mis_obras())::text[]');
    w := replace(w, 'mis_obras()', '(select public.mis_obras())::text[]');
    q := replace(q, 'mi_cedula()', '(select public.mi_cedula())');
    w := replace(w, 'mi_cedula()', '(select public.mi_cedula())');
    q := replace(q, 'mi_rol()', '(select public.mi_rol())');
    w := replace(w, 'mi_rol()', '(select public.mi_rol())');
    q := replace(q, 've_flota()', '(select public.ve_flota())');
    w := replace(w, 've_flota()', '(select public.ve_flota())');
    q := replace(q, 'es_taller()', '(select public.es_taller())');
    w := replace(w, 'es_taller()', '(select public.es_taller())');
    s := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if q is not null then s := s || format(' using (%s)', q); end if;
    if w is not null then s := s || format(' with check (%s)', w); end if;
    execute s;
  end loop;
end $$;

-- ------------------------------------------------------------------ REVERTIR
-- drop index if exists public.partes_equipo_fecha_horometro_idx;
-- drop index if exists public.partes_equipo_fecha_km_idx;
-- do $$
-- declare p record; q text; w text; s text;
-- begin
--   for p in select tablename, policyname, qual, with_check from pg_policies
--             where schemaname = 'public' and (coalesce(qual,'') || coalesce(with_check,'')) ~ 'SELECT (auth\.uid|es_taller|ve_flota|mi_rol|mi_cedula|mis_obras)\(\)'
--   loop
--     q := p.qual; w := p.with_check;
--     q := regexp_replace(q, '\(\s*SELECT (auth\.uid|es_taller|ve_flota|mi_rol|mi_cedula|mis_obras)\(\) AS \w+\)(::text\[\])?', '\1()', 'g');
--     w := regexp_replace(w, '\(\s*SELECT (auth\.uid|es_taller|ve_flota|mi_rol|mi_cedula|mis_obras)\(\) AS \w+\)(::text\[\])?', '\1()', 'g');
--     s := format('alter policy %I on public.%I', p.policyname, p.tablename);
--     if q is not null then s := s || format(' using (%s)', q); end if;
--     if w is not null then s := s || format(' with check (%s)', w); end if;
--     execute s;
--   end loop;
-- end $$;
