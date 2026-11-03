-- =========================================================================
-- 86_compras_taller_historico_unificar.sql · v20261103c — UN PEDIDO POR FILA
--  Correr DESPUÉS del 85. En Monday un mismo pedido pasaba de tablero en
--  tablero (Pedidos Taller → Consolidado → Compras / Caja Chica / UCC →
--  Traslados) y quedaba copiado en cada uno. Esto deja UNA fila por pedido en
--  tc_hist_fuente y borra las copias:
--    · mismo pedido = mismo «Name» + misma «Fecha solicitud» al minuto
--      (Consolidado y Pedidos de Compra UCC la traen como «Persona Jan 8, 2026
--      10:48 AM» en hora de Paraguay, UTC−3). Dentro de un mismo tablero, dos
--      filas con esa clave son pedidos distintos salvo que sean idénticas; se
--      emparejan entre tableros por centro de costo y cantidad;
--    · la fila que queda toma, columna por columna, el primer dato no vacío
--      según el tablero: Pedidos Taller, Compras Taller, Compras Taller UCC,
--      Compra Caja Chica, Traslados, Consolidado, Pedidos de Compra UCC;
--    · nada se pierde: «fuentes» guarda las filas originales de cada tablero
--      (la ficha las muestra) y «tableros» por cuáles pasó;
--    · tc_hist_absorbida guarda la clave de cada copia borrada, para que volver
--      a correr el script de carga no las cargue de nuevo;
--    · tc_hist_unificar() se puede volver a correr (el script de carga la
--      llama al terminar): rearma todo desde las filas originales.
--  Las filas sin nombre o sin fecha (proveedores, renglones vacíos de Monday)
--  quedan como están.
-- =========================================================================

alter table public.tc_hist_fuente add column if not exists tableros text[];
alter table public.tc_hist_fuente add column if not exists fuentes jsonb;
alter table public.tc_hist_fuente add column if not exists fecha_sol timestamptz;
create index if not exists tc_hist_fuente_fecha_ix on public.tc_hist_fuente (fecha_sol desc nulls last, id desc);
create index if not exists tc_hist_fuente_tableros_ix on public.tc_hist_fuente using gin (tableros);

create table if not exists public.tc_hist_absorbida (
  archivo_sha256 text not null,
  hoja text not null,
  fila int not null,
  campos_sha256 text not null,
  fuente_id bigint not null references public.tc_hist_fuente(id) on delete cascade,
  primary key (archivo_sha256, hoja, fila)
);
create index if not exists tc_hist_absorbida_fuente_ix on public.tc_hist_absorbida (fuente_id);
alter table public.tc_hist_absorbida enable row level security;
revoke all on public.tc_hist_absorbida from anon, authenticated;

-- «2025-06-06 13:52:55 UTC» o «Yamila Ascona Jan 8, 2026 10:48 AM» (hora de Paraguay, UTC−3)
create or replace function public._tc_hist_fecha(t text)
returns timestamptz language plpgsql immutable set timezone to 'UTC' as $$
begin
  if t ~ '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$' then return (left(t, 19) || '+00')::timestamptz; end if;
  if t ~ '[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d\d [AP]M$' then
    return to_timestamp(substring(t from '([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d\d [AP]M)$'), 'Mon DD, YYYY HH12:MI AM') + interval '3 hours';
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.tc_hist_unificar(p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare res jsonb;
begin
  -- desde la app: solo el administrador; desde el SQL Editor (sin sesión): el dueño de la base
  if auth.uid() is not null then perform public._tc_exigir(public.tc_yo(), 'super');
  elsif session_user not in ('postgres', 'supabase_admin') then raise exception 'auth_required' using errcode = '28000'; end if;
  if exists (select 1 from tc_hist_vinculo) then
    raise exception 'Hay decisiones cargadas en tc_hist_vinculo: unificar de nuevo las borraría.' using errcode = '22023'; end if;

  drop table if exists _tc_m, _tc_g, _tc_p;
  -- cada fila original (las ya unificadas se abren desde «fuentes»)
  create temp table _tc_m on commit drop as
  select x ->> 'archivo' archivo, x ->> 'archivo_sha256' archivo_sha256, x ->> 'hoja' hoja, (x ->> 'fila')::int fila,
         x -> 'campos' campos, x ->> 'campos_sha256' campos_sha256,
         f.estado src_estado, f.conflicto src_conflicto, f.source_id, f.cargado_por, f.cargado_en
    from tc_hist_fuente f,
         jsonb_array_elements(coalesce(f.fuentes, jsonb_build_array(jsonb_build_object('archivo', f.archivo, 'archivo_sha256', f.archivo_sha256,
           'hoja', f.hoja, 'fila', f.fila, 'campos', f.campos, 'campos_sha256', f.campos_sha256)))) x;

  create temp table _tc_g on commit drop as
  with k as (
    select m.*, coalesce(array_position(array['Pedidos_Taller', 'Compras_Taller', 'Compras_Taller_UCC', 'Compra_Caja_Chica', 'Traslados_Taller',
                                              'Consolidado_Taller', 'Pedidos_de_Compra_Taller_UCC'], regexp_replace(m.archivo, '_\d+\.xlsx$', '')), 99) pri,
           regexp_replace(m.archivo, '_\d+\.xlsx$', '') tab,
           nullif(upper(btrim(m.campos ->> 'Name')), '') nm,
           public._tc_hist_fecha(m.campos ->> 'Fecha solicitud') fecha,
           date_trunc('minute', public._tc_hist_fecha(m.campos ->> 'Fecha solicitud')) mi
      from _tc_m m
  ), r as (
    select k.*, case when nm is null or mi is null then null else
             dense_rank() over (partition by tab, nm, mi order by coalesce(campos ->> 'Centro de costo', campos ->> 'Centro de Costo', ''),
                                coalesce(campos ->> 'Cantidad requerida', campos ->> 'Cantidad', ''), campos_sha256) end rk
      from k
  )
  select r.*, case when rk is null then 'u:' || archivo_sha256 || ':' || hoja || ':' || fila
                   else nm || '|' || to_char(mi, 'YYYY-MM-DD HH24:MI') || '|' || rk end grp
    from r;

  create temp table _tc_p on commit drop as
  with pr as (select distinct on (grp) * from _tc_g order by grp, pri, archivo, fila),
  cu as (
    select grp, jsonb_object_agg(key, value) campos_u from (
      select distinct on (g.grp, e.key) g.grp, e.key, e.value from _tc_g g, jsonb_each(g.campos) e
       where e.value not in ('null'::jsonb, '""'::jsonb)
       order by g.grp, e.key, g.pri, g.archivo, g.fila) z
     group by grp
  ), ag as (
    select grp, jsonb_agg(jsonb_build_object('archivo', archivo, 'archivo_sha256', archivo_sha256, 'hoja', hoja, 'fila', fila,
                                             'campos', campos, 'campos_sha256', campos_sha256) order by pri, archivo, fila) fuentes_u,
           min(fecha) fecha_u, bool_or(src_estado = 'conflicto') hay_conflicto,
           (array_agg(src_conflicto) filter (where src_conflicto is not null))[1] conflicto_u
      from _tc_g group by grp
  ), tb as (
    select grp, array_agg(archivo order by pri, archivo) tableros_u
      from (select grp, archivo, min(pri) pri from _tc_g group by grp, archivo) t group by grp
  )
  select pr.*, cu.campos_u, tb.tableros_u, ag.fuentes_u, ag.fecha_u, ag.conflicto_u,
         case when ag.hay_conflicto then 'conflicto' end estado_c
    from pr left join cu using (grp) join ag using (grp) join tb using (grp);

  res := jsonb_build_object(
    'filas_antes', (select count(*) from tc_hist_fuente),
    'filas_originales', (select count(*) from _tc_m),
    'pedidos', (select count(*) from _tc_p),
    'copias_borradas', (select count(*) from _tc_m) - (select count(*) from _tc_p),
    'en_varios_tableros', (select count(*) from _tc_p where cardinality(tableros_u) > 1),
    'aplicado', p_aplicar);
  if not p_aplicar then return res; end if;

  delete from tc_hist_absorbida;
  delete from tc_hist_fuente;
  insert into tc_hist_fuente (archivo, archivo_sha256, hoja, fila, source_id, campos, campos_sha256, estado, conflicto,
                              cargado_por, cargado_en, tableros, fuentes, fecha_sol)
  select archivo, archivo_sha256, hoja, fila, source_id, coalesce(campos_u, '{}'::jsonb), campos_sha256,
         coalesce(estado_c, src_estado), conflicto_u,
         cargado_por, cargado_en, tableros_u, fuentes_u, fecha_u
    from _tc_p;
  insert into tc_hist_absorbida (archivo_sha256, hoja, fila, campos_sha256, fuente_id)
  select g.archivo_sha256, g.hoja, g.fila, g.campos_sha256, f.id
    from _tc_g g join _tc_p p on p.grp = g.grp
    join tc_hist_fuente f on f.archivo_sha256 = p.archivo_sha256 and f.hoja = p.hoja and f.fila = p.fila
   where (g.archivo_sha256, g.hoja, g.fila) is distinct from (p.archivo_sha256, p.hoja, p.fila)
  on conflict do nothing;
  return res || jsonb_build_object('filas_ahora', (select count(*) from tc_hist_fuente));
end $$;

-- Carga (reemplaza la del SQL 80): una copia ya unificada no se vuelve a cargar;
-- si cambió, marca «conflicto» en la fila del pedido.
create or replace function public.tc_hist_cargar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); r jsonb; v_sha text; ex tc_hist_fuente%rowtype; ab tc_hist_absorbida%rowtype;
  nuevos int := 0; iguales int := 0; conflictos int := 0;
begin
  perform public._tc_exigir(yo, 'super');
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 2000 then raise exception 'Mandá un arreglo de hasta 2.000 filas.' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p) loop
    if coalesce(r ->> 'archivo_sha256', '') !~ '^[0-9a-f]{64}$' or (r ->> 'fila') is null or jsonb_typeof(r -> 'campos') <> 'object' then
      raise exception 'Fila inválida: %', left(r::text, 200) using errcode = '22023'; end if;
    v_sha := encode(extensions.digest(convert_to((r -> 'campos')::text, 'UTF8'), 'sha256'), 'hex');
    select * into ex from tc_hist_fuente where archivo_sha256 = r ->> 'archivo_sha256' and hoja = coalesce(r ->> 'hoja', '') and fila = (r ->> 'fila')::int;
    if found then
      if ex.campos_sha256 = v_sha then iguales := iguales + 1;
      else
        update tc_hist_fuente set estado = 'conflicto', conflicto = jsonb_build_object('campos', r -> 'campos', 'en', now()) where id = ex.id;
        conflictos := conflictos + 1;
      end if;
      continue;
    end if;
    select * into ab from tc_hist_absorbida where archivo_sha256 = r ->> 'archivo_sha256' and hoja = coalesce(r ->> 'hoja', '') and fila = (r ->> 'fila')::int;
    if found then
      if ab.campos_sha256 = v_sha then iguales := iguales + 1;
      else
        update tc_hist_fuente set estado = 'conflicto', conflicto = jsonb_build_object('campos', r -> 'campos', 'en', now(),
          'archivo', r ->> 'archivo', 'hoja', r ->> 'hoja', 'fila', (r ->> 'fila')::int) where id = ab.fuente_id;
        conflictos := conflictos + 1;
      end if;
      continue;
    end if;
    insert into tc_hist_fuente (archivo, archivo_sha256, hoja, fila, source_id, campos, campos_sha256, cargado_por, fecha_sol)
    values (r ->> 'archivo', r ->> 'archivo_sha256', coalesce(r ->> 'hoja', ''), (r ->> 'fila')::int, r ->> 'source_id', r -> 'campos', v_sha,
            (yo ->> 'uid')::uuid, public._tc_hist_fecha(r -> 'campos' ->> 'Fecha solicitud'));
    nuevos := nuevos + 1;
  end loop;
  return jsonb_build_object('nuevos', nuevos, 'ya_estaban', iguales, 'conflictos', conflictos);
end $$;

-- Lista (reemplaza la del SQL 85): un pedido por fila, filtro por tablero por el que pasó
create or replace function public.tc_hist_listar(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  yo jsonb := public.tc_yo();
  v_q text := lower(coalesce(nullif(trim(p ->> 'q'), ''), ''));
  v_arch text := nullif(trim(p ->> 'archivo'), '');
  v_lim int := least(greatest(coalesce((p ->> 'limite')::int, 200), 1), 500);
  v_off int := greatest(coalesce((p ->> 'desplazar')::int, 0), 0);
  res jsonb;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> 'ver_todas')::boolean, false) then
    raise exception 'El histórico de Monday lo ven taller, bodega, compras, autorizadores y gerentes.' using errcode = '42501'; end if;

  with filt as (
    select f.id, f.archivo, f.hoja, f.fila, f.estado, f.campos, f.fecha_sol, coalesce(f.tableros, array[f.archivo]) tableros
      from tc_hist_fuente f
     where (v_arch is null or v_arch = any (coalesce(f.tableros, array[f.archivo])))
       and (v_q = '' or lower(f.campos::text) like '%' || v_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'tableros', coalesce((select jsonb_agg(jsonb_build_object('archivo', a, 'filas', n) order by a)
                            from (select a, count(*) n from tc_hist_fuente, unnest(coalesce(tableros, array[archivo])) a group by a) t), '[]'),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'archivo', x.archivo, 'hoja', x.hoja, 'fila', x.fila,
                                                           'estado', x.estado, 'campos', x.campos, 'tableros', to_jsonb(x.tableros))
                                        order by x.fecha_sol desc nulls last, x.id desc)
                         from (select * from filt order by fecha_sol desc nulls last, id desc limit v_lim offset v_off) x), '[]'))
  into res;
  return res;
end $$;

-- Ficha: el pedido unificado con las filas originales de cada tablero
create or replace function public.tc_hist_detalle(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); res jsonb;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not coalesce((yo ->> 'ver_todas')::boolean, false) then
    raise exception 'El histórico de Monday lo ven taller, bodega, compras, autorizadores y gerentes.' using errcode = '42501'; end if;
  select jsonb_build_object('id', f.id, 'archivo', f.archivo, 'hoja', f.hoja, 'fila', f.fila, 'estado', f.estado, 'conflicto', f.conflicto,
           'campos', f.campos, 'tableros', to_jsonb(coalesce(f.tableros, array[f.archivo])),
           'fuentes', coalesce(f.fuentes, jsonb_build_array(jsonb_build_object('archivo', f.archivo, 'hoja', f.hoja, 'fila', f.fila, 'campos', f.campos))))
    into res from tc_hist_fuente f where f.id = p_id;
  if res is null then raise exception 'No existe esa fila del histórico.' using errcode = 'P0002'; end if;
  return res;
end $$;

revoke all on function public._tc_hist_fecha(text) from public, anon, authenticated;
revoke all on function public.tc_hist_unificar(boolean), public.tc_hist_cargar(jsonb), public.tc_hist_listar(jsonb), public.tc_hist_detalle(bigint) from public, anon;
grant execute on function public.tc_hist_unificar(boolean), public.tc_hist_cargar(jsonb), public.tc_hist_listar(jsonb), public.tc_hist_detalle(bigint) to authenticated;

-- Unificar lo que ya está cargado
select 'SQL 86 ok' as resultado, public.tc_hist_unificar(true) as unificacion;
