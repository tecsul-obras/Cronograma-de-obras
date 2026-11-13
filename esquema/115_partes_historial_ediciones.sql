-- 115 · Historial de partes › «Historial de ediciones» (13/11/2026)
--
-- Cada cambio a un parte diario ya queda en log_ediciones (disparador
-- trg_log_edicion: antes / después completos, usuario y hora). Esta función
-- lo devuelve listo para la pantalla: solo los campos que cambiaron, con el
-- nombre de quien lo hizo.
--   · usuario_id con valor → lo cambió una persona en la app
--   · usuario_id vacío     → sincronización de JotForm o un script (sistema)
-- Ve: admin central y gerente (todo), admin de obra (partes de sus obras:
-- la obra de antes o la de después).
-- No cambia nada de lo guardado. Se puede correr dos veces.

create index if not exists log_ediciones_momento_idx on public.log_ediciones (momento desc);

create or replace function public.partes_ediciones(
  p_desde  date default null,      -- día de la edición (hora de Paraguay)
  p_hasta  date default null,
  p_parte  uuid default null,      -- un solo parte (detalle del parte)
  p_limite int  default 3000)
returns table (
  log_id        bigint,
  momento       timestamptz,
  usuario_id    uuid,
  usuario       text,
  quien         text,              -- 'app' | 'sistema'
  parte_id      uuid,
  parte_fecha   date,
  equipo_id     text,
  obra_clave    text,              -- obra después del cambio
  obra_antes    text,
  parte_origen  text,              -- 'jotform' | 'pwa'
  submission_id text,
  client_id     text,
  existe        boolean,           -- false: el parte ya se borró
  cambios       jsonb)             -- [{campo, antes, despues}]
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_rol   text := (select rol::text from perfiles where id = auth.uid() and activo);
  v_obras text[];
begin
  if v_rol is null or v_rol not in ('admin_central', 'gerente', 'admin_obra') then
    raise exception 'Sin permiso para ver el historial de ediciones';
  end if;
  if v_rol = 'admin_obra' then
    v_obras := (select coalesce(obras, '{}') from perfiles where id = auth.uid());
  end if;

  return query
  with l as (
    select x.id, x.momento, x.usuario_id, x.parte_id,
           coalesce(x.antes, '{}'::jsonb) a, coalesce(x.despues, '{}'::jsonb) d
      from log_ediciones x
     where (p_parte is null or x.parte_id = p_parte)
       and (p_desde is null or x.momento >= (p_desde::timestamp at time zone 'America/Asuncion'))
       and (p_hasta is null or x.momento <  ((p_hasta + 1)::timestamp at time zone 'America/Asuncion'))
       and (v_obras is null
            or x.despues ->> 'obra_clave' = any (v_obras)
            or x.antes   ->> 'obra_clave' = any (v_obras))
  ), c as (
    select l.*,
           (select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'antes', l.a -> k, 'despues', l.d -> k) order by k), '[]'::jsonb)
              from (select jsonb_object_keys(l.a || l.d) k) ks
             -- horas_hombre, horas_horometro y km_recorridos son columnas
             -- calculadas: en el disparador «después» salen vacías siempre.
             -- Se ven igual por el turno, el horómetro y el km que sí cambian.
             where k not in ('editado_en', 'horas_hombre', 'horas_horometro', 'km_recorridos')
               and (l.a -> k) is distinct from (l.d -> k)
               -- 5.7 y 5.70 son el mismo número
               and not (jsonb_typeof(l.a -> k) = 'number' and jsonb_typeof(l.d -> k) = 'number'
                        and (l.a ->> k)::numeric = (l.d ->> k)::numeric)) cambios
      from l
  )
  select c.id, c.momento, c.usuario_id,
         case when c.usuario_id is null then null
              else coalesce(nullif(pf.nombre, ''), pf.cedula, 'Usuario borrado') end,
         case when c.usuario_id is null then 'sistema' else 'app' end,
         c.parte_id,
         coalesce(c.d ->> 'fecha', c.a ->> 'fecha')::date,
         coalesce(c.d ->> 'equipo_id', c.a ->> 'equipo_id'),
         c.d ->> 'obra_clave',
         c.a ->> 'obra_clave',
         coalesce(c.d ->> 'origen', c.a ->> 'origen'),
         coalesce(c.d ->> 'submission_id', c.a ->> 'submission_id'),
         coalesce(c.d ->> 'client_id', c.a ->> 'client_id'),
         exists (select 1 from partes p where p.id = c.parte_id),
         c.cambios
    from c
    left join perfiles pf on pf.id = c.usuario_id
   where jsonb_array_length(c.cambios) > 0     -- guardados sin ningún cambio real: no se muestran
   order by c.momento desc
   limit greatest(1, least(coalesce(p_limite, 3000), 10000));
end;
$$;

revoke all on function public.partes_ediciones(date, date, uuid, int) from public, anon;
grant execute on function public.partes_ediciones(date, date, uuid, int) to authenticated;

-- Control: la función existe y anon no la puede usar
select count(*) filter (where proname = 'partes_ediciones') funciones_1,
       bool_or(has_function_privilege('anon', p.oid, 'execute')) filter (where proname = 'partes_ediciones') anon_puede_false
  from pg_proc p where proname = 'partes_ediciones';
