-- =========================================================================
-- 85_compras_taller_historico_ver.sql · v20261103b — VER EL HISTÓRICO DE MONDAY
--  Correr DESPUÉS del 80. Solo lectura: la pestaña «🕘 Histórico Monday» de
--  Compras › Taller consulta tc_hist_fuente con esta función.
--
--    · lo ve quien ve los pedidos de todas las obras (ver_todas: taller,
--      bodega, compras, autorizadores, gerentes, admin). Las filas de Monday
--      no tienen obra confiable, así que el admin de obra con alcance por
--      obra NO las ve;
--    · busca en todo el texto de la fila; filtra por tablero (archivo);
--    · ordena por «Fecha solicitud» (la más nueva primero) y pagina;
--    · no cambia nada: las tablas siguen sin permiso directo.
-- =========================================================================

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
    select f.id, f.archivo, f.hoja, f.fila, f.estado, f.campos,
           coalesce(f.campos ->> 'Fecha solicitud', '') as orden
      from tc_hist_fuente f
     where (v_arch is null or f.archivo = v_arch)
       and (v_q = '' or lower(f.campos::text) like '%' || v_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'tableros', coalesce((select jsonb_agg(jsonb_build_object('archivo', archivo, 'filas', n) order by archivo)
                            from (select archivo, count(*) n from tc_hist_fuente group by archivo) t), '[]'),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'archivo', x.archivo, 'hoja', x.hoja, 'fila', x.fila,
                                                           'estado', x.estado, 'campos', x.campos) order by x.orden desc, x.id desc)
                         from (select * from filt order by orden desc, id desc limit v_lim offset v_off) x), '[]'))
  into res;
  return res;
end $$;

revoke all on function public.tc_hist_listar(jsonb) from public, anon;
grant execute on function public.tc_hist_listar(jsonb) to authenticated;

select 'SQL 85 ok' as resultado;
