-- ══════════════════════════════════════════════════════════════════
-- 102 · Horómetro con 2 decimales (10/11/2026)
--
-- Hasta ahora la base guardaba los horómetros con 1 decimal
-- (numeric(10,1)): un parte con 1757,54 quedaba 1757,5 y las horas del
-- certificado de máquinas nunca podían tener 2 decimales.
--
-- Pasan a 2 decimales:
--   partes.horometro_inicial, horometro_final      numeric(12,2)
--   partes.horas_horometro (calculada, ahora round(…, 2))
--   partes.horas_horometro_reportada               numeric(8,2)
--   combustible_movimientos.horometro              numeric(12,2)
--   mantenimientos.horometro                       numeric(12,2)
--   planes_mantenimiento.ultimo_horometro          numeric(12,2)
--
-- Para poder cambiar el tipo, Postgres obliga a borrar y volver a crear
-- las vistas que usan esas columnas (unas 26, incluidas las v_powerbi_*).
-- El script las guarda tal cual están (definición, opciones como
-- security_invoker, dueño, permisos, comentario) y las recrea igual.
-- Lo mismo con las funciones que devuelven una de esas vistas
-- (combustible_conciliacion) y con los disparadores «UPDATE OF» sobre
-- esas columnas (trg_parte_salto).
--
-- También pasa a 2 decimales el redondeo de horas en:
--   salto_evaluar, salto_resolver, salto_crear_puente, panel_resumen.
--
-- La sincronización con JotForm (SQL 95) no necesita cambios: toma los
-- tipos de la tabla, así que desde ahora guarda los 2 decimales y en su
-- próxima corrida corrige los partes de los últimos 60 días.
-- Los anteriores se recuperan con 103_recuperar_decimales_jotform.sql.
--
-- Todo va en una transacción: si algo falla no queda nada a medias.
-- Correr en Supabase › SQL Editor. Al final muestra la verificación.
-- ══════════════════════════════════════════════════════════════════

begin;

do $migracion$
declare
  r        record;
  g        record;
  def      text;
  nuevo    text;
  v_tablas regclass[] := array['public.partes', 'public.combustible_movimientos',
                               'public.mantenimientos', 'public.planes_mantenimiento']::regclass[];
  v_acl_hh aclitem[];
  v_n      int;
begin
  -- ── 1. Guardar las vistas que dependen (directa o indirectamente) ──
  create temp table _vistas on commit drop as
  with recursive dep(oid, lvl) as (
    select distinct rw.ev_class, 1
      from pg_depend d join pg_rewrite rw on rw.oid = d.objid
     where d.classid = 'pg_rewrite'::regclass and d.refobjid = any(v_tablas) and rw.ev_class <> d.refobjid
    union
    select rw.ev_class, dep.lvl + 1
      from dep join pg_depend d on d.refobjid = dep.oid and d.classid = 'pg_rewrite'::regclass
      join pg_rewrite rw on rw.oid = d.objid
     where rw.ev_class <> dep.oid
  )
  select c.oid, n.nspname, c.relname, c.relkind, c.reltype, max(dep.lvl) as lvl,
         pg_get_viewdef(c.oid) as def, c.reloptions, c.relacl,
         pg_get_userbyid(c.relowner) as dueno, obj_description(c.oid, 'pg_class') as comentario
    from dep join pg_class c on c.oid = dep.oid join pg_namespace n on n.oid = c.relnamespace
   group by c.oid, n.nspname, c.relname, c.relkind, c.reltype, c.reloptions, c.relacl, c.relowner;

  if exists (select 1 from _vistas where relkind <> 'v') then
    raise exception 'Hay una vista materializada u otro objeto dependiente no previsto: %',
      (select string_agg(relname, ', ') from _vistas where relkind <> 'v');
  end if;
  select count(*) into v_n from _vistas;
  raise notice 'Vistas a recrear: %', v_n;

  -- Funciones que devuelven o reciben el tipo de fila de una de esas vistas
  create temp table _funciones on commit drop as
  select p.oid, p.oid::regprocedure::text as firma, pg_get_functiondef(p.oid) as def,
         pg_get_userbyid(p.proowner) as dueno, p.proacl, obj_description(p.oid, 'pg_proc') as comentario
    from pg_proc p
   where p.prorettype in (select reltype from _vistas)
      or exists (select 1 from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) t where t in (select reltype from _vistas));
  raise notice 'Funciones a recrear: %', (select coalesce(string_agg(firma, ', '), 'ninguna') from _funciones);

  -- Disparadores con «UPDATE OF» sobre las columnas que cambian (ej. trg_parte_salto)
  create temp table _disparadores on commit drop as
  select distinct t.oid, t.tgname, t.tgrelid::regclass::text as tabla, pg_get_triggerdef(t.oid) as def,
         t.tgenabled, obj_description(t.oid, 'pg_trigger') as comentario
    from pg_trigger t join pg_depend d on d.classid = 'pg_trigger'::regclass and d.objid = t.oid
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where not t.tgisinternal and d.refobjid = any(v_tablas)
     and (a.attrelid, a.attname) in (('public.partes'::regclass, 'horometro_inicial'), ('public.partes'::regclass, 'horometro_final'),
                                     ('public.partes'::regclass, 'horas_horometro'), ('public.partes'::regclass, 'horas_horometro_reportada'),
                                     ('public.combustible_movimientos'::regclass, 'horometro'), ('public.mantenimientos'::regclass, 'horometro'),
                                     ('public.planes_mantenimiento'::regclass, 'ultimo_horometro'));
  raise notice 'Disparadores a recrear: %', (select coalesce(string_agg(tabla || '.' || tgname, ', '), 'ninguno') from _disparadores);

  -- Permisos por columna de partes.horas_horometro (ej. lector_ia), que se va a recrear
  select attacl into v_acl_hh from pg_attribute
   where attrelid = 'public.partes'::regclass and attname = 'horas_horometro';

  -- ── 2. Borrar funciones y vistas (de la más dependiente a la base) ──
  for r in select * from _funciones loop
    execute format('drop function %s', r.firma);
  end loop;
  for r in select * from _vistas order by lvl desc, relname loop
    execute format('drop view %I.%I', r.nspname, r.relname);
  end loop;
  for r in select * from _disparadores loop
    execute format('drop trigger %I on %s', r.tgname, r.tabla);
  end loop;

  -- ── 3. Cambiar las columnas ──
  alter table public.partes drop column horas_horometro;
  alter table public.partes
    alter column horometro_inicial         type numeric(12,2),
    alter column horometro_final           type numeric(12,2),
    alter column horas_horometro_reportada type numeric(8,2);
  alter table public.partes add column horas_horometro numeric(12,2) generated always as (
    case when horometro_inicial is null or horometro_final is null then null::numeric
         else greatest(round(horometro_final - horometro_inicial, 2), 0::numeric) end) stored;
  if v_acl_hh is not null then
    for g in select a.grantee, a.privilege_type from aclexplode(v_acl_hh) a loop
      execute format('grant %s (horas_horometro) on public.partes to %s', g.privilege_type,
                     case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end);
    end loop;
  end if;

  alter table public.combustible_movimientos alter column horometro        type numeric(12,2);
  alter table public.mantenimientos          alter column horometro        type numeric(12,2);
  alter table public.planes_mantenimiento    alter column ultimo_horometro type numeric(12,2);

  -- Disparadores, igual que estaban (incluido si estaba deshabilitado)
  for r in select * from _disparadores loop
    execute r.def;
    if r.tgenabled = 'D' then execute format('alter table %s disable trigger %I', r.tabla, r.tgname); end if;
    if r.comentario is not null then execute format('comment on trigger %I on %s is %L', r.tgname, r.tabla, r.comentario); end if;
  end loop;

  -- ── 4. Recrear las vistas igual que estaban ──
  for r in select * from _vistas order by lvl, relname loop
    execute format('create view %I.%I %s as %s', r.nspname, r.relname,
                   case when r.reloptions is not null then 'with (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
                   r.def);
    execute format('alter view %I.%I owner to %I', r.nspname, r.relname, r.dueno);
    if r.comentario is not null then
      execute format('comment on view %I.%I is %L', r.nspname, r.relname, r.comentario);
    end if;
    -- Permisos: se sacan los que puso la base por defecto y se vuelven los de antes
    for g in select distinct a.grantee from pg_class c, aclexplode(c.relacl) a
              where c.oid = format('%I.%I', r.nspname, r.relname)::regclass
                and a.grantee <> (select oid from pg_roles where rolname = r.dueno) loop
      execute format('revoke all on %I.%I from %s', r.nspname, r.relname,
                     case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end);
    end loop;
    if r.relacl is not null then
      for g in select a.grantee, a.privilege_type, a.is_grantable from aclexplode(r.relacl) a
                where a.grantee <> (select oid from pg_roles where rolname = r.dueno) loop
        execute format('grant %s on %I.%I to %s%s', g.privilege_type, r.nspname, r.relname,
                       case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end,
                       case when g.is_grantable then ' with grant option' else '' end);
      end loop;
    end if;
  end loop;

  -- ── 5. Recrear las funciones ──
  for r in select * from _funciones loop
    execute r.def;
    execute format('alter function %s owner to %I', r.firma, r.dueno);
    if r.comentario is not null then execute format('comment on function %s is %L', r.firma, r.comentario); end if;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.firma);
    if r.proacl is null then
      execute format('grant execute on function %s to public', r.firma);
    else
      for g in select a.grantee, a.is_grantable from aclexplode(r.proacl) a
                where a.grantee <> (select oid from pg_roles where rolname = r.dueno) loop
        execute format('grant execute on function %s to %s%s', r.firma,
                       case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end,
                       case when g.is_grantable then ' with grant option' else '' end);
      end loop;
    end if;
  end loop;

  -- ── 6. Redondeo de horas a 2 decimales en las funciones de saltos y el panel ──
  for r in select * from (values
      ('salto_evaluar',      'round(p.horometro_inicial - ant.horometro_final, 1)', 'round(p.horometro_inicial - ant.horometro_final, 2)'),
      ('salto_resolver',     'round(hasta - desde, 1)',                             'round(hasta - desde, 2)'),
      ('salto_resolver',     'round(horometro_final - hasta, 1)',                   'round(horometro_final - hasta, 2)'),
      ('salto_crear_puente', 'round(p_hasta - p_desde, 1)',                         'round(p_hasta - p_desde, 2)'),
      ('panel_resumen',      'round(coalesce(sum(horas_horometro), 0), 1)',         'round(coalesce(sum(horas_horometro), 0), 2)')
    ) as x(fn, viejo, nuevo_txt) loop
    for g in select p.oid from pg_proc p where p.proname = r.fn and p.pronamespace = 'public'::regnamespace loop
      def := pg_get_functiondef(g.oid);
      if position(r.viejo in def) = 0 then
        raise notice '% : no se encontró «%» (¿ya estaba cambiado?)', r.fn, r.viejo;
        continue;
      end if;
      nuevo := replace(def, r.viejo, r.nuevo_txt);
      execute nuevo;   -- CREATE OR REPLACE: conserva dueño y permisos
    end loop;
  end loop;

  -- ── 7. Formulario del parte: el horómetro acepta 2 decimales ──
  update public.form_campos set paso = 0.01
   where clave in ('horometro_ini', 'horometro_fin') and paso = 0.1;

  raise notice 'Listo: horómetros con 2 decimales.';
end
$migracion$;

-- ── Verificación ──
select
  (select string_agg(table_name || '.' || column_name || ' (' || numeric_precision || ',' || numeric_scale || ')', ' · ' order by table_name, column_name)
     from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (('partes','horometro_inicial'), ('partes','horometro_final'), ('partes','horas_horometro'),
                                        ('partes','horas_horometro_reportada'), ('combustible_movimientos','horometro'),
                                        ('mantenimientos','horometro'), ('planes_mantenimiento','ultimo_horometro'))) as columnas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'partes' and column_name like '%horometro%' and numeric_scale = 1) as quedan_con_1_decimal_deberia_0,
  (select count(*) from pg_views where schemaname = 'public' and viewname in ('v_flota', 'v_partes_powerbi', 'v_powerbi_parte_diario_equipos', 'v_combustible_conciliacion')) as vistas_clave_deberia_4,
  (select count(*) from pg_proc where proname = 'combustible_conciliacion') as combustible_conciliacion_deberia_1,
  (select string_agg(clave || ' paso ' || coalesce(paso::text, '—'), ', ') from public.form_campos where clave in ('horometro_ini', 'horometro_fin')) as formulario_paso_001;

commit;
