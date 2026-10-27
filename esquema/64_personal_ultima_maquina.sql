-- =========================================================================
-- 64_personal_ultima_maquina.sql · equipos-v68 (27/10/2026)
--
-- Personal: la última máquina que operó cada persona (último parte diario,
-- sin importar el período elegido), con la fecha y si es de terceros.
-- La pantalla además filtra por fecha desde / hasta (antes, solo por mes):
-- la función ya recibía desde y hasta, no cambia.
--
-- Cambia las columnas que devuelve personal_resumen, por eso se borra y se
-- vuelve a crear (no toca datos). Se puede correr más de una vez.
-- =========================================================================
drop function if exists public.personal_resumen(date, date);

create function public.personal_resumen(p_desde date, p_hasta date)
returns table (cedula text, nombre text, especialidad text, telefono text, ubicacion text, equipo_habitual text,
               activo boolean, verificado boolean, tiene_usuario boolean, rol text, usuario_activo boolean,
               formularios text[], partes integer, horas_hombre numeric, ultimo_parte date,
               registros_taller integer, horas_taller numeric, ultimo_taller date,
               despachos integer, litros numeric, ultimo_despacho date,
               ultima_maquina text, ultima_maquina_tipo text, ultima_maquina_fecha date, ultima_maquina_tercero boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ve_flota() then raise exception 'Sin permiso'; end if;
  return query
  select o.cedula, o.nombre, o.especialidad, o.telefono, o.ubicacion, o.equipo_habitual,
         o.activo, o.verificado,
         pr.id is not null, pr.rol::text, pr.activo, pr.formularios,
         coalesce(pa.n, 0)::int, coalesce(pa.hh, 0), pa.ult,
         coalesce(t.n, 0)::int, coalesce(t.h, 0), t.ult,
         coalesce(c.n, 0)::int, coalesce(c.l, 0), c.ult,
         um.equipo_id, coalesce(um.tipo, um.descripcion), um.fecha, um.tercero
  from operadores o
  left join perfiles pr on pr.cedula = o.cedula
  left join lateral (select count(*) n, sum(p.horas_hombre) hh,
                            (select max(p2.fecha) from partes p2 where p2.operador_cedula = o.cedula) ult
                     from partes p where p.operador_cedula = o.cedula
                       and p.fecha between p_desde and p_hasta) pa on true
  left join lateral (select count(distinct r.id) n,
                            coalesce(sum(i.horas), 0) + coalesce((select sum(r2.horas_mantenimiento) from ot_registros r2
                              where r2.tecnico_cedula = o.cedula and r2.fecha between p_desde and p_hasta), 0) h,
                            (select max(r3.fecha) from ot_registros r3 where r3.tecnico_cedula = o.cedula) ult
                     from ot_registros r left join ot_registro_items i on i.registro_id = r.id
                     where r.tecnico_cedula = o.cedula and r.fecha between p_desde and p_hasta) t on true
  left join lateral (select count(*) n, sum(m.litros) l,
                            (select max(m2.fecha) from combustible_movimientos m2 where m2.despachador_cedula = o.cedula) ult
                     from combustible_movimientos m
                     where m.despachador_cedula = o.cedula and m.fecha between p_desde and p_hasta
                       and m.actividad = 'Despacho de combustible') c on true
  left join lateral (select p.equipo_id, p.fecha, e.tipo, e.descripcion,
                            coalesce(e.propiedad = 'Tercero', false) as tercero
                     from partes p left join equipos e on e.id = p.equipo_id
                     where p.operador_cedula = o.cedula and p.equipo_id is not null
                     order by p.fecha desc, p.inicio_turno desc nulls last
                     limit 1) um on true;
end;
$$;
revoke execute on function public.personal_resumen(date, date) from public, anon;
grant execute on function public.personal_resumen(date, date) to authenticated;

create index if not exists partes_operador_fecha_idx on public.partes (operador_cedula, fecha desc);

-- Comprobación (en el editor no hay usuario, así que se mira directo):
-- la función tiene que devolver las 4 columnas nuevas.
select count(*) as columnas_nuevas_4
  from information_schema.parameters
 where specific_schema = 'public' and specific_name like 'personal_resumen%'
   and parameter_name in ('ultima_maquina', 'ultima_maquina_tipo', 'ultima_maquina_fecha', 'ultima_maquina_tercero');
