-- Prueba local del SQL 111 (Postgres de prueba con usuarios ficticios; NO correr en Supabase). Termina con «PRUEBA OK» como error a propósito.
do $$
declare
  tal uuid := '00000000-0000-0000-0000-000000000001'; com uuid := '00000000-0000-0000-0000-000000000002';
  aut uuid := '00000000-0000-0000-0000-000000000003'; bod uuid := '00000000-0000-0000-0000-000000000004';
  r jsonb; pid uuid; ver int; log text := ''; cid uuid; aid uuid;
  procedure_dummy int;
begin
  insert into tc_permiso (user_id, capacidad) values (aut, 'autorizar') on conflict do nothing;
  insert into usuario values ('aut@t.py', 'lectura', 'Autorizador', true) on conflict do nothing;
  -- 0 pedido viejo con preparado: se envía igual
  select id, version into pid, ver from tc_pedido where descripcion = 'Viejo';
  perform set_config('request.jwt.claims', json_build_object('sub', bod, 'email', 'bod@t.py')::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"3","doc_tipo":"nota_remision","doc_numero":"001-001-0000123"}'); ver := (r->>'version')::int;
  log := log || '0 viejo con preparado: envío OK' || E'\n';
  -- 1 pide 2, hay 1 (stock parcial)
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), '{"obra_clave":"O1","descripcion":"Bomba de agua","cantidad":"2","unidad":"un"}');
  pid := (r->>'id')::uuid; ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', bod, 'email', 'bod@t.py')::text, true);
  begin perform tc_accion(pid, 'bodega_stock', ver, gen_random_uuid(), '{"stock":"0"}'); raise exception 'FALLA 1';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid, 'bodega_stock', ver, gen_random_uuid(), '{"stock":"1"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'entrega' then raise exception 'FALLA 1b'; end if;
  log := log || '1 stock parcial (1 de 2) aceptado' || E'\n';
  -- 2 preparado ya no; envío sin documento no; envío con documento sí
  begin perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"prepara","cantidad":"1"}'); raise exception 'FALLA 2';
  exception when sqlstate '22023' then null; end;
  begin perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"1"}'); raise exception 'FALLA 2b';
  exception when sqlstate '22023' then null; end;
  begin perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"3","doc_tipo":"remito","doc_numero":"R-1"}'); raise exception 'FALLA 2c';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"1","doc_tipo":"remito","doc_numero":"R-1"}'); ver := (r->>'version')::int;
  if (select doc_numero from tc_movimiento where pedido_id = pid and tipo = 'envio') <> 'R-1' then raise exception 'FALLA 2d'; end if;
  log := log || '2 sin preparado; envío pide documento; no supera lo pedido' || E'\n';
  -- 3 con tránsito no se cierra; recibe y cierra con lo entregado
  begin perform tc_accion(pid, 'cerrar_parcial', ver, gen_random_uuid(), '{"motivo":"urgencia"}'); raise exception 'FALLA 3';
  exception when sqlstate '22023' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"recepcion","cantidad":"1"}'); ver := (r->>'version')::int;
  begin perform tc_accion(pid, 'cerrar_parcial', ver, gen_random_uuid(), '{"motivo":"x"}'); raise exception 'FALLA 3b';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', bod, 'email', 'bod@t.py')::text, true);
  begin perform tc_accion(pid, 'cerrar_parcial', ver, gen_random_uuid(), '{}'); raise exception 'FALLA 3c';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid, 'cerrar_parcial', ver, gen_random_uuid(), '{"motivo":"Solo había 1, se mandó por urgencia"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'cerrado' or tc_detalle(pid)->>'cierre_motivo' is null then raise exception 'FALLA 3d'; end if;
  begin perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"1","doc_tipo":"remito","doc_numero":"R-2"}'); raise exception 'FALLA 3e';
  exception when sqlstate '22023' then null; end;
  log := log || '3 cierre: no con tránsito, no la obra, pide motivo; cerrado bloquea movimientos' || E'\n';
  -- 4 deshacer cierre
  r := tc_accion(pid, 'cierre_deshacer', ver, gen_random_uuid(), '{"motivo":"llegó otro"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'entrega' then raise exception 'FALLA 4'; end if;
  log := log || '4 deshacer cierre vuelve a entrega' || E'\n';
  -- 5 compra por central: envío ≤ recibido en central; compras puede cerrar
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), '{"canal":"ucc","obra_clave":"O1","descripcion":"Cubiertas","cantidad":"4","unidad":"un"}');
  pid := (r->>'id')::uuid; ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre":"G","precio_unit":"10","moneda":"PYG"}'); ver := (r->>'version')::int;
  select id into cid from tc_cotizacion where pedido_id = pid;
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', cid, 'motivo', 'm')); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', aut, 'email', 'aut@t.py')::text, true);
  select id into aid from tc_autorizacion where pedido_id = pid and estado = 'pendiente';
  r := tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', aid, 'decision', 'autorizar')); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo":"oc","doc_numero":"OC-9","fecha_compra":"2026-11-12","uso_caja_chica":false,"ruta":"central"}'); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', bod, 'email', 'bod@t.py')::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"central","cantidad":"2"}'); ver := (r->>'version')::int;
  begin perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"3","doc_tipo":"otro","doc_numero":"x"}'); raise exception 'FALLA 5';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"envio","cantidad":"2","doc_tipo":"vale_salida","doc_numero":"V-7"}'); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"recepcion","cantidad":"2"}'); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'cerrar_parcial', ver, gen_random_uuid(), '{"motivo":"El proveedor no tiene más"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'cerrado' then raise exception 'FALLA 5b'; end if;
  log := log || '5 compra: envío ≤ recibido en central; compras cierra con lo entregado' || E'\n';
  -- 6 anular el preparado viejo sigue andando
  select id, version into pid, ver from tc_pedido where descripcion = 'Viejo';
  perform set_config('request.jwt.claims', json_build_object('sub', bod, 'email', 'bod@t.py')::text, true);
  r := tc_accion(pid, 'mov_anular', ver, gen_random_uuid(), jsonb_build_object('movimiento_id', (select id from tc_movimiento where pedido_id = pid and tipo = 'prepara'), 'motivo', 'ya no se usa'));
  log := log || '6 anular un preparado viejo OK' || E'\n';
  raise exception E'PRUEBA OK\n%', log;
end $$;
