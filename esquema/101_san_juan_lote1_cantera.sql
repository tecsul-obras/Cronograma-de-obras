-- =====================================================================
-- 101 · San Juan Misiones (09/11/2026)
--   A) Oculta la obra «San Juan Misiones Lote 1» (1012600000).
--      No borra nada: queda activo = false. Desde app v20261109b
--      (api.js) las obras inactivas no salen en los selectores.
--   B) Separa los ítems 99.1 a 99.5 de «San Juan Misiones Lote 2»
--      (1012300000) a una obra nueva «Cantera San Juan» (1012300099),
--      con su producción, su línea del C.M. N° 1 y su línea base.
--      El ítem 99 (Gastos Generales) queda en el Lote 2.
-- Correr entero en el SQL Editor. Es una sola transacción: si algo
-- falla, no cambia nada. Si se corre dos veces, la 2.ª avisa y no hace nada.
-- =====================================================================
begin;

do $$
declare
  o_l2  text := '1012300000';
  o_new text := '1012300099';
  n int;
begin
  if exists (select 1 from obra where obra_id = o_new) then
    raise exception 'La obra % ya existe: este script ya se corrió.', o_new;
  end if;

  -- seguridad: no hay certificación ni distribución mensual de 99.x
  -- (al 09/11/2026 eran 0). Si aparecieron, frenar y revisar a mano.
  select count(*) into n from certificacion
   where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  if n > 0 then
    raise exception 'Hay % filas de certificación de 99.x: revisar antes de separar.', n;
  end if;

  -- ---------- A) Lote 1: ocultar ----------
  update obra set activo = false, rev = rev + 1, rev_por = 'SQL 101'
   where obra_id = '1012600000';

  -- ---------- B) Cantera San Juan ----------
  -- 1. obra nueva (mismos datos generales del Lote 2)
  insert into obra (obra_id, nombre, llamado, lote, moneda, tipo_obra,
                    fecha_inicio, fecha_fin, plazo_meses, dias_por_mes, activo)
  select o_new, 'Cantera San Juan', llamado, '', moneda, tipo_obra,
         date '2026-05-01', null, null, dias_por_mes, true
    from obra where obra_id = o_l2;

  insert into categoria (obra_id, nombre, color, orden)
  select o_new, nombre, color, orden from categoria where obra_id = o_l2;

  -- mismos usuarios con acceso al Lote 2
  insert into usuario_obra (email, obra_id)
  select email, o_new from usuario_obra where obra_id = o_l2
  on conflict do nothing;

  -- 2. ítems (mismos números y centros de costo 1012300063…67)
  -- (cant_contractual y cant_vigente son columnas calculadas: no se copian)
  insert into item (obra_id, item_id, descripcion, id_nivel3, desc_nivel3, codigo_cc, um, cant_contrato, cant_convenio, cant_ajustada, precio_unit, incidencia, categoria, estado, fecha_ini, fecha_fin, avance_esperado, avance_manual, nivel, es_grupo, tipo, padre_id, orden)
  select o_new,
         i.item_id,
         i.descripcion,
         i.id_nivel3,
         i.desc_nivel3,
         i.codigo_cc,
         i.um,
         i.cant_contrato,
         i.cant_convenio,
         i.cant_ajustada,
         i.precio_unit,
         i.incidencia,
         i.categoria,
         i.estado,
         i.fecha_ini,
         i.fecha_fin,
         i.avance_esperado,
         i.avance_manual,
         i.nivel,
         i.es_grupo,
         i.tipo,
         i.padre_id,
         array_position(array['99.1','99.2','99.3','99.4','99.5'], i.item_id) - 1
    from item i
   where i.obra_id = o_l2 and i.item_id in ('99.1','99.2','99.3','99.4','99.5');

  -- 3. convenio C.M. N° 1 (los 99.1–99.4 entraron como ítems nuevos)
  insert into convenio
  select (jsonb_populate_record(c, jsonb_build_object('obra_id', o_new))).*
    from convenio c
   where c.obra_id = o_l2
     and c.convenio_id in (select convenio_id from convenio_detalle
                            where obra_id = o_l2 and item_id like '99.%' and item_id <> '99');

  insert into convenio_detalle
  select (jsonb_populate_record(d, jsonb_build_object('obra_id', o_new))).*
    from convenio_detalle d
   where d.obra_id = o_l2 and d.item_id in ('99.1','99.2','99.3','99.4','99.5');
  delete from convenio_detalle
   where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');

  -- 4. líneas base que tienen 99.x (copia del encabezado + detalle)
  insert into linea_base
  select (jsonb_populate_record(b, jsonb_build_object(
            'obra_id', o_new,
            'convenio_id', case when exists (select 1 from convenio c2
                                              where c2.obra_id = o_new and c2.convenio_id = b.convenio_id)
                                then b.convenio_id end))).*
    from linea_base b
   where b.obra_id = o_l2
     and b.baseline_id in (select baseline_id from linea_base_detalle
                            where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5'));

  insert into linea_base_detalle
  select (jsonb_populate_record(d, jsonb_build_object('obra_id', o_new))).*
    from linea_base_detalle d
   where d.obra_id = o_l2 and d.item_id in ('99.1','99.2','99.3','99.4','99.5');
  delete from linea_base_detalle
   where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');

  -- 5. producción: jornadas que solo tienen filas de 99.x (son 223; ninguna mezcla)
  create temp table _jor on commit drop as
  select j.submission_id from produccion_jornada j
   where j.obra_id = o_l2
     and exists (select 1 from produccion_fila f where f.obra_id = j.obra_id and f.submission_id = j.submission_id
                   and f.item_id in ('99.1','99.2','99.3','99.4','99.5'))
     and not exists (select 1 from produccion_fila f where f.obra_id = j.obra_id and f.submission_id = j.submission_id
                   and f.item_id not in ('99.1','99.2','99.3','99.4','99.5'));

  select count(*) into n from produccion_fila f
   where f.obra_id = o_l2 and f.item_id in ('99.1','99.2','99.3','99.4','99.5')
     and f.submission_id not in (select submission_id from _jor);
  if n > 0 then
    raise exception 'Hay % filas de 99.x en jornadas mezcladas con otros ítems: revisar a mano.', n;
  end if;

  insert into produccion_jornada
  select (jsonb_populate_record(j, jsonb_build_object('obra_id', o_new))).*
    from produccion_jornada j
   where j.obra_id = o_l2 and j.submission_id in (select submission_id from _jor);

  insert into produccion_fila
  select (jsonb_populate_record(f, jsonb_build_object('obra_id', o_new))).*
    from produccion_fila f
   where f.obra_id = o_l2 and f.submission_id in (select submission_id from _jor);

  delete from produccion_fila
   where obra_id = o_l2 and submission_id in (select submission_id from _jor);
  delete from produccion_jornada
   where obra_id = o_l2 and submission_id in (select submission_id from _jor);

  -- 6. resto de tablas por ítem (hoy en 0 para 99.x; por si se cargó algo hoy)
  update distribucion_mensual set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update plan_semanal         set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update plan_semanal_foto    set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update item_recurso         set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update computo_item         set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update computo_linea        set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update transporte_carga     set obra_id = o_new where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');

  -- 7. sacar los ítems del Lote 2 y avisar a quien lo tenga abierto
  delete from item_dependencia
   where obra_id = o_l2 and (item_id in ('99.1','99.2','99.3','99.4','99.5') or pred_id in ('99.1','99.2','99.3','99.4','99.5'));
  delete from item where obra_id = o_l2 and item_id in ('99.1','99.2','99.3','99.4','99.5');
  update obra set rev = rev + 1, rev_por = 'SQL 101' where obra_id = o_l2;
end $$;

-- verificación (esperado al 09/11/2026: Cantera 5 ítems · 223 jornadas · 223 filas · 4 convenio · 4 línea base; Lote 2 queda con 46 ítems · 712 jornadas · 344 filas)
select o.obra_id, o.nombre, o.activo,
       (select count(*) from item i where i.obra_id = o.obra_id)                 as items,
       (select count(*) from produccion_jornada j where j.obra_id = o.obra_id)   as jornadas,
       (select count(*) from produccion_fila f where f.obra_id = o.obra_id)      as filas,
       (select count(*) from convenio_detalle d where d.obra_id = o.obra_id)     as conv_det,
       (select count(*) from linea_base_detalle d where d.obra_id = o.obra_id)   as lb_det
  from obra o
 where o.obra_id in ('1012600000', '1012300000', '1012300099')
 order by o.obra_id;

commit;
