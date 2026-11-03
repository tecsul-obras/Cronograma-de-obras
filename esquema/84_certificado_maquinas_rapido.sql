-- =========================================================================
-- 84_certificado_maquinas_rapido.sql · v20261103d — correr DESPUÉS del 83
-- Tecsul S.A.E.
--
-- «Resumen de horas» (y el armado de certificados) daba «canceling statement
-- due to statement timeout» con «Todas las obras» cuando la base estaba
-- cargada: la función certificado_maquinas revisaba el permiso y las reglas
-- de lectura de partes y tarifas FILA POR FILA (≈1.750 partes del mes).
-- Ahora revisa el permiso una sola vez (solo admin central y gerente) y lee
-- directo: mismo resultado, ≈5 veces más rápida (probado: 557 ms → 102 ms,
-- 150 filas y 4.627,1 h en octubre, idénticas).
-- Se puede volver a correr.
-- =========================================================================

create or replace function public.certificado_maquinas(p_desde date, p_hasta date, p_obra text default null)
 returns table(obra_clave text, obra_nombre text, unidad_negocio text, equipo_id text, descripcion text, propiedad text, partes integer, dias integer, horas numeric, horas_sin_tarifa numeric, tarifa_min numeric, tarifa_max numeric, costo numeric, tarifa_vencida boolean)
 language sql stable security definer
 set search_path to 'public'
as $function$
  with permiso as (select public.edita_certificados() as ok),
  p as (
    select pa.obra_clave, pa.equipo_id, pa.fecha,
           coalesce(pa.horas_horometro, pa.horas_horometro_reportada, 0) as horas,
           unidad_negocio(o.codigo) as un
    from partes pa
    join obras o on o.clave = pa.obra_clave
    where (select ok from permiso)
      and pa.fecha between p_desde and p_hasta
      and (p_obra is null or pa.obra_clave = p_obra)
  ), c as (
    select p.*, t.tarifa1, t.fecha_hasta < p.fecha as vencida
    from p
    left join lateral (
      select te.tarifa1, te.fecha_hasta from tarifas_equipos te
      where te.equipo_id = p.equipo_id and te.unidad_negocio = p.un
      order by (te.fecha_hasta < p.fecha), case when te.fecha_hasta >= p.fecha then te.fecha_hasta end, te.fecha_hasta desc, te.id desc
      limit 1
    ) t on true
  )
  select c.obra_clave, o.nombre, max(c.un), c.equipo_id, coalesce(e.tipo, e.descripcion), e.propiedad,
         count(*)::int, count(distinct c.fecha)::int, round(sum(c.horas), 2),
         round(sum(c.horas) filter (where c.tarifa1 is null), 2),
         min(c.tarifa1), max(c.tarifa1),
         round(sum(c.horas * c.tarifa1)), coalesce(bool_or(c.vencida), false)
  from c
  join obras o on o.clave = c.obra_clave
  left join equipos e on e.id = c.equipo_id
  group by c.obra_clave, o.nombre, c.equipo_id, e.tipo, e.descripcion, e.propiedad
$function$;

revoke all on function public.certificado_maquinas(date, date, text) from public, anon;
grant execute on function public.certificado_maquinas(date, date, text) to authenticated;

select 'ok' as listo;
