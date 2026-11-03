-- =========================================================================
-- Prueba de SQL 79 (Compras de taller). Se corre DESPUÉS del 79 en la misma
-- transacción y termina con un error a propósito: así NO queda nada guardado
-- y el mensaje trae el resultado («PRUEBA OK …» o el paso que falló).
--
--   begin;  \i 79_compras_taller.sql  \i pruebas/79_compras_taller_prueba.sql
--
-- Usa usuarios reales solo como identidad (los permisos de prueba se dan y se
-- deshacen con la transacción). Ajustar los correos si cambian.
-- =========================================================================
do $$
declare
  u_sol uuid; u_bod uuid; u_com uuid; u_aut uuid; u_otro uuid;
  e_sol text := 'alicia.villalba@tecsul.com.py';    -- admin de obra (Equipos) de Arborea Hills
  e_bod text := 'fatima.cantero@tecsul.com.py';     -- se le da «bodega»
  e_com text := 'guido.franco@tecsul.com.py';       -- se le da «compras»
  e_aut text := 'petercacerez@tecsul.com.py';       -- admin central (super)
  e_otro text := 'edgar.bobadilla@tecsul.com.py';   -- admin de obra de otra obra, sin permisos extra
  obra text := '1080100000_ARBOREA HILLS';
  eq text := (select id from equipos where activo order by id limit 1);
  r jsonb; pid uuid; pid2 uuid; ver int; q1 uuid; q2 uuid; aid uuid; mid uuid; log text := '';
  ok boolean;

  -- (sin funciones anidadas en plpgsql: se repite el patrón)
begin
  select id into u_sol from auth.users where lower(email) = e_sol;
  select id into u_bod from auth.users where lower(email) = e_bod;
  select id into u_com from auth.users where lower(email) = e_com;
  select id into u_aut from auth.users where lower(email) = e_aut;
  select id into u_otro from auth.users where lower(email) = e_otro;
  insert into tc_permiso (user_id, capacidad) values (u_bod, 'bodega'), (u_com, 'compras');

  -- 1. solicitud
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol, 'role', 'authenticated')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', obra, 'equipo_id', eq, 'descripcion', 'Kit de filtros prueba',
        'cantidad', '10', 'unidad', 'kit', 'prioridad', 'alta', 'fecha_requerida', current_date + 5));
  pid := (r ->> 'id')::uuid; ver := (r ->> 'version')::int;
  log := log || '1 crear ' || (r ->> 'codigo') || E'\n';

  begin
    perform tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', '1012400000_ACCESO A GENERAL BRUGUEZ', 'descripcion', 'xx otra', 'cantidad', 1, 'unidad', 'un'));
    raise exception 'FALLA 2: pidió para una obra ajena';
  exception when insufficient_privilege then log := log || '2 obra ajena rechazada' || E'\n'; end;

  -- 3. compras no hace de bodega
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  begin
    perform tc_accion(pid, 'bodega_compra', ver, gen_random_uuid(), '{}');
    raise exception 'FALLA 3';
  exception when insufficient_privilege then log := log || '3 sin permiso de bodega' || E'\n'; end;

  -- 4-6. bodega
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  begin
    perform tc_accion(pid, 'bodega_stock', ver, gen_random_uuid(), '{"stock": 4}');
    raise exception 'FALLA 4';
  exception when sqlstate '22023' then log := log || '4 stock insuficiente rechazado' || E'\n'; end;
  begin
    perform tc_accion(pid, 'bodega_compra', ver - 1, gen_random_uuid(), '{}');
    raise exception 'FALLA 5';
  exception when sqlstate '40001' then log := log || '5 versión vieja → conflicto' || E'\n'; end;
  declare op uuid := gen_random_uuid();
  begin
    r := tc_accion(pid, 'bodega_compra', ver, op, '{"stock": 0, "motivo": "no hay en central"}');
    ver := (r ->> 'version')::int;
    r := tc_accion(pid, 'bodega_compra', ver - 1, op, '{"stock": 0}');
    if not coalesce((r ->> 'repetida')::boolean, false) or (r ->> 'version')::int <> ver then raise exception 'FALLA 6: %', r; end if;
    log := log || '6 derivado a compras; reintento idempotente' || E'\n';
  end;

  -- 7-8. cotizaciones y autorización
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre": "Prov A", "precio_unit": "100000", "flete": 50000}'); ver := (r ->> 'version')::int;
  select id into q1 from tc_cotizacion where pedido_id = pid and proveedor_nombre = 'Prov A';
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre": "Prov B", "precio_unit": "95000", "flete": 0}'); ver := (r ->> 'version')::int;
  select id into q2 from tc_cotizacion where pedido_id = pid and proveedor_nombre = 'Prov B';
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', q2, 'motivo', 'menor total')); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'autorizacion' then raise exception 'FALLA 7 fase'; end if;
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar'));
    raise exception 'FALLA 7b';
  exception when insufficient_privilege then log := log || '7 compras no autoriza' || E'\n'; end;
  insert into tc_permiso (user_id, capacidad) values (u_com, 'autorizar');
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar'));
    raise exception 'FALLA 7c';
  exception when insufficient_privilege then log := log || '7 quien pide no autoriza su pedido' || E'\n'; end;
  delete from tc_permiso where user_id = u_com and capacidad = 'autorizar';
  -- cambiar la oferta elegida deja sin efecto el pedido de autorización
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), jsonb_build_object('id', q2, 'proveedor_nombre', 'Prov B', 'precio_unit', '96000')); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'cotizacion' then raise exception 'FALLA 8: no invalidó'; end if;
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', q2, 'motivo', 'menor total')); ver := (r ->> 'version')::int;
  log := log || '8 cambiar la cotización invalida la autorización' || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', u_aut, 'email', e_aut)::text, true);
  begin
    perform tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'devolver'));
    raise exception 'FALLA 9';
  exception when sqlstate '22023' then log := log || '9 devolver sin motivo rechazado' || E'\n'; end;
  r := tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', (select aut_id from v_tc_pedido where id = pid), 'decision', 'autorizar')); ver := (r ->> 'version')::int;

  -- 10. compra
  perform set_config('request.jwt.claims', json_build_object('sub', u_com, 'email', e_com)::text, true);
  begin
    perform tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo": "oc", "doc_numero": "OC-1", "fecha_compra": "2026-11-02", "ruta": "mixta"}');
    raise exception 'FALLA 10';
  exception when sqlstate '22023' then log := log || '10 caja chica sí/no obligatorio' || E'\n'; end;
  r := tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo": "oc", "doc_numero": "OC-1", "fecha_compra": "2026-11-02", "ruta": "mixta", "uso_caja_chica": false}'); ver := (r ->> 'version')::int;
  if (select compra_total from v_tc_pedido where id = pid) <> 960000 then raise exception 'FALLA 10 total %', (select compra_total from v_tc_pedido where id = pid); end if;

  -- 11. entregas parciales (ejemplo del documento: 6 central, 2 directo, 4 preparado y enviado, 3 recibido)
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 6}'); ver := (r ->> 'version')::int;
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 1}');
    raise exception 'FALLA 11a';
  exception when insufficient_privilege then log := log || '11 bodega no confirma recepción en obra' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "directa", "cantidad": 2, "referencia": "remito 55"}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 4}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 4}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 3}'); ver := (r ->> 'version')::int;
  select (q_central = 6 and q_directa = 2 and q_prepara = 4 and q_envio = 4 and q_recepcion = 3 and fase = 'entrega') into ok from v_tc_pedido where id = pid;
  if not ok then raise exception 'FALLA 11 saldos'; end if;
  log := log || '11 saldos del ejemplo: prov 2 · central 2 · tránsito 1 · en obra 5' || E'\n';
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 2}');
    raise exception 'FALLA 12';
  exception when sqlstate '22023' then log := log || '12 no se recibe más de lo enviado' || E'\n'; end;
  begin
    perform tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "directa", "cantidad": 3}');
    raise exception 'FALLA 13';
  exception when sqlstate '22023' then log := log || '13 proveedor no entrega más de lo pedido' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  select id into mid from tc_movimiento where pedido_id = pid and tipo = 'prepara';
  begin
    perform tc_accion(pid, 'mov_anular', ver, gen_random_uuid(), jsonb_build_object('movimiento_id', mid, 'motivo', 'error'));
    raise exception 'FALLA 14';
  exception when sqlstate '22023' then log := log || '14 no se anula lo preparado ya enviado' || E'\n'; end;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 2}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 4}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 4}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 4}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'entrega' then raise exception 'FALLA 15 cerró antes'; end if;
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 1}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid) <> 'cerrado' then raise exception 'FALLA 15 no cerró'; end if;
  log := log || '15 cerrado recién con todo recibido en obra (R 8 + D 2 = 10)' || E'\n';

  -- 16. rama stock
  r := tc_pedido_crear(gen_random_uuid(), jsonb_build_object('obra_clave', obra, 'descripcion', 'Espejo retrovisor prueba', 'cantidad', 3, 'unidad', 'un'));
  pid2 := (r ->> 'id')::uuid; ver := 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bod, 'email', e_bod)::text, true);
  r := tc_accion(pid2, 'bodega_stock', ver, gen_random_uuid(), '{"stock": 5}'); ver := (r ->> 'version')::int;
  begin
    perform tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "central", "cantidad": 1}');
    raise exception 'FALLA 16a';
  exception when sqlstate '22023' then null; end;
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "prepara", "cantidad": 3}'); ver := (r ->> 'version')::int;
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "envio", "cantidad": 2}'); ver := (r ->> 'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sol, 'email', e_sol)::text, true);
  r := tc_accion(pid2, 'mov_registrar', ver, gen_random_uuid(), '{"tipo": "recepcion", "cantidad": 2}'); ver := (r ->> 'version')::int;
  if (select fase from v_tc_pedido where id = pid2) <> 'entrega' or exists (select 1 from tc_cotizacion where pedido_id = pid2) or exists (select 1 from tc_compra where pedido_id = pid2) then
    raise exception 'FALLA 16'; end if;
  log := log || '16 desde stock: sin compra ni cotizaciones, recepción parcial' || E'\n';

  -- 17. lecturas y alcance
  r := tc_listar('{"bandeja": "entregas"}');
  if (r ->> 'total')::int < 1 then raise exception 'FALLA 17 listar %', r; end if;
  r := tc_detalle(pid);
  if jsonb_array_length(r -> 'eventos') < 10 or jsonb_array_length(r -> 'movimientos') <> 10 then raise exception 'FALLA 17 detalle'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_otro, 'email', e_otro)::text, true);
  r := tc_listar('{}');
  if exists (select 1 from jsonb_array_elements(r -> 'filas') f where (f ->> 'id')::uuid in (pid, pid2)) then raise exception 'FALLA 17 ve ajena'; end if;
  begin
    perform tc_detalle(pid);
    raise exception 'FALLA 17b';
  exception when insufficient_privilege then log := log || '17 otra obra no ve los pedidos' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_aut, 'email', e_aut)::text, true);
  r := tc_kpis('{}');
  log := log || '18 kpis n=' || (r ->> 'n') || E'\n';
  r := tc_permisos_listar();
  log := log || '19 permisos: ' || jsonb_array_length(r) || ' personas' || E'\n';

  raise exception 'PRUEBA OK (se deshace todo)%', E'\n' || log;
end $$;
