-- 115b · Historial de ediciones más rápido (13/11/2026)
-- La 115 daba «statement timeout» con 7 días: comparaba campo por campo
-- leyendo el parte guardado entero (comprimido) una vez por cada campo
-- (46 veces por edición). Ahora cada versión del parte se lee una sola vez.
-- Mismo resultado, ~20 veces más rápido. Además filtra «Personas (app)» /
-- «JotForm / sistema» en la base (p_quien): la sincronización hace ~95 % de
-- las ediciones, así la vista por defecto (personas) trae muy poco.
-- Se puede correr dos veces.

drop function if exists public.partes_ediciones(date, date, uuid, int);

create index if not exists log_ediciones_momento_idx on public.log_ediciones (momento desc);

create or replace function public.partes_ediciones(
  p_desde  date default null,      -- día de la edición (hora de Paraguay)
  p_hasta  date default null,
  p_parte  uuid default null,      -- un solo parte (detalle del parte)
  p_limite int  default 3000,
  p_quien  text default null)      -- 'app' | 'sistema' | null (todos)
returns table (
  log_id bigint, momento timestamptz, usuario_id uuid, usuario text, quien text,
  parte_id uuid, parte_fecha date, equipo_id text, obra_clave text, obra_antes text,
  parte_origen text, submission_id text, client_id text, existe boolean, cambios jsonb)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_rol   text := (select rol::text from perfiles where id = auth.uid() and activo);
  v_obras text[];
  v_ini   timestamptz := case when p_desde is null then '-infinity'::timestamptz
                              else (p_desde::timestamp at time zone 'America/Asuncion') end;
  v_fin   timestamptz := case when p_hasta is null then 'infinity'::timestamptz
                              else ((p_hasta + 1)::timestamp at time zone 'America/Asuncion') end;
begin
  if v_rol is null or v_rol not in ('admin_central', 'gerente', 'admin_obra') then
    raise exception 'Sin permiso para ver el historial de ediciones';
  end if;
  if v_rol = 'admin_obra' then
    v_obras := (select coalesce(obras, '{}') from perfiles where id = auth.uid());
  end if;

  if p_parte is not null then
    return query
    select * from public._partes_ediciones_calc(
      array(select x.id from log_ediciones x where x.parte_id = p_parte), v_obras, p_limite);
  else
    return query
    select * from public._partes_ediciones_calc(
      array(select x.id from log_ediciones x where x.momento >= v_ini and x.momento < v_fin
                    and (p_quien is null or (p_quien = 'app') = (x.usuario_id is not null))), v_obras, p_limite);
  end if;
end;
$$;

-- El cálculo, aparte (lo usa solo partes_ediciones): cada jsonb se lee una vez
create or replace function public._partes_ediciones_calc(p_ids bigint[], p_obras text[], p_limite int)
returns table (
  log_id bigint, momento timestamptz, usuario_id uuid, usuario text, quien text,
  parte_id uuid, parte_fecha date, equipo_id text, obra_clave text, obra_antes text,
  parte_origen text, submission_id text, client_id text, existe boolean, cambios jsonb)
language sql stable security definer
set search_path = public
as $$
  with c as (
    select x.id, x.momento, x.usuario_id, x.parte_id, r.*,
           ch.cambios, ch.obra_a, ch.obra_d
      from log_ediciones x
      cross join lateral jsonb_to_record(coalesce(x.despues, x.antes)) as r(
             fecha date, equipo_id text, origen text, submission_id text, client_id text)
      cross join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'antes', av, 'despues', dv) order by k)
                 filter (where k not in ('editado_en', 'horas_hombre', 'horas_horometro', 'km_recorridos')
                           and av is distinct from dv
                           and not (jsonb_typeof(av) = 'number' and jsonb_typeof(dv) = 'number'
                                    and av::text::numeric = dv::text::numeric)), '[]'::jsonb) cambios,
               max(av #>> '{}') filter (where k = 'obra_clave') obra_a,
               max(dv #>> '{}') filter (where k = 'obra_clave') obra_d
          from (select coalesce(a.key, d.key) k, a.value av, d.value dv
                  from jsonb_each(coalesce(x.antes, '{}'::jsonb)) a
                  full join jsonb_each(coalesce(x.despues, '{}'::jsonb)) d on a.key = d.key) ks
      ) ch
     where x.id = any (p_ids)
  )
  select c.id, c.momento, c.usuario_id,
         case when c.usuario_id is null then null
              else coalesce(nullif(pf.nombre, ''), pf.cedula, 'Usuario borrado') end,
         case when c.usuario_id is null then 'sistema' else 'app' end,
         c.parte_id, c.fecha, c.equipo_id, c.obra_d, c.obra_a, c.origen, c.submission_id, c.client_id,
         exists (select 1 from partes p where p.id = c.parte_id),
         c.cambios
    from c
    left join perfiles pf on pf.id = c.usuario_id
   where jsonb_array_length(c.cambios) > 0     -- guardados sin ningún cambio real: no se muestran
     and (p_obras is null or c.obra_d = any (p_obras) or c.obra_a = any (p_obras))
   order by c.momento desc
   limit greatest(1, least(coalesce(p_limite, 3000), 10000));
$$;

revoke all on function public._partes_ediciones_calc(bigint[], text[], int) from public, anon, authenticated;
revoke all on function public.partes_ediciones(date, date, uuid, int, text) from public, anon;
grant execute on function public.partes_ediciones(date, date, uuid, int, text) to authenticated;

-- Control: 2 funciones, anon no puede, el cálculo no se llama directo
select count(*) filter (where proname in ('partes_ediciones', '_partes_ediciones_calc')) funciones_2,
       bool_or(has_function_privilege('anon', p.oid, 'execute')) anon_puede_false,
       bool_or(has_function_privilege('authenticated', p.oid, 'execute')) filter (where proname = '_partes_ediciones_calc') calc_directo_false
  from pg_proc p where proname in ('partes_ediciones', '_partes_ediciones_calc');
