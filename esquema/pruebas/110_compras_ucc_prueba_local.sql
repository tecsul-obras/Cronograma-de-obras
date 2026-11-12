-- Prueba local del SQL 110 (Postgres de prueba con usuarios ficticios u1..u3; NO correr en Supabase).
-- Termina con «PRUEBA OK» como error a propósito (no guarda nada).
do $$
declare
  tal uuid := '00000000-0000-0000-0000-000000000001'; com uuid := '00000000-0000-0000-0000-000000000002';
  aut uuid := '00000000-0000-0000-0000-000000000003';
  r jsonb; pid uuid; ver int; d jsonb; cid uuid; aid uuid; log text := '';
begin
  insert into tc_permiso (user_id, capacidad) values (aut, 'autorizar') on conflict do nothing;
  insert into usuario values ('aut@t.py', 'lectura', 'Autorizador', true) on conflict do nothing;
  -- 1 taller crea UCC
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), '{"canal":"ucc","obra_clave":"O1","descripcion":"Juego de cubiertas 17.5R25","cantidad":"4","unidad":"un","prioridad":"alta"}');
  if r->>'codigo' <> 'UCC-000001' then raise exception 'FALLA 1 codigo %', r->>'codigo'; end if;
  pid := (r->>'id')::uuid; ver := (r->>'version')::int;
  d := tc_detalle(pid);
  if d->>'fase' <> 'cotizacion' or d->>'canal' <> 'ucc' then raise exception 'FALLA 1b % %', d->>'fase', d->>'canal'; end if;
  log := log || '1 UCC creado en cotizacion' || E'\n';
  -- 2 listar separado
  if (tc_listar('{"canal":"ucc"}')->>'total')::int <> 1 or (tc_listar('{}')->>'total')::int <> 1 then raise exception 'FALLA 2'; end if;
  if tc_listar('{}')->'filas'->0->>'codigo' <> 'TAL-000001' then raise exception 'FALLA 2b'; end if;
  log := log || '2 bandejas separadas' || E'\n';
  -- 3 taller edita (sin cotizaciones)
  r := tc_accion(pid, 'editar', ver, gen_random_uuid(), '{"cantidad":"6"}'); ver := (r->>'version')::int;
  if (tc_detalle(pid)->>'cantidad')::numeric <> 6 or tc_detalle(pid)->>'fase' <> 'cotizacion' then raise exception 'FALLA 3'; end if;
  log := log || '3 editado, sigue en compras' || E'\n';
  -- 4 bodega no aplica
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  begin perform tc_accion(pid, 'bodega_compra', ver, gen_random_uuid(), '{}'); raise exception 'FALLA 4';
  exception when sqlstate '22023' or insufficient_privilege then log := log || '4 sin bodega' || E'\n'; end;
  -- 5 compras pide aclaración
  r := tc_accion(pid, 'ucc_aclaracion', ver, gen_random_uuid(), '{"motivo":"¿Qué marca?"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'aclaracion' then raise exception 'FALLA 5'; end if;
  begin perform tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre":"X","precio_unit":"1"}'); raise exception 'FALLA 5b';
  exception when sqlstate '22023' then log := log || '5 aclaración (no cotiza mientras tanto)' || E'\n'; end;
  -- 6 taller corrige → vuelve a compras
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_accion(pid, 'editar', ver, gen_random_uuid(), '{"marca_modelo":"Michelin"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'cotizacion' then raise exception 'FALLA 6'; end if;
  log := log || '6 corregido vuelve a compras' || E'\n';
  -- 7 compras cotiza; taller ya no edita
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'cot_guardar', ver, gen_random_uuid(), '{"proveedor_nombre":"Gomería SA","precio_unit":"2500000","moneda":"PYG"}'); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  begin perform tc_accion(pid, 'editar', ver, gen_random_uuid(), '{"cantidad":"7"}'); raise exception 'FALLA 7';
  exception when sqlstate '22023' then log := log || '7 con cotización no se edita' || E'\n'; end;
  begin perform tc_accion(pid, 'anular', ver, gen_random_uuid(), '{"motivo":"x"}'); raise exception 'FALLA 7b';
  exception when sqlstate '22023' then log := log || '7b ni se anula' || E'\n'; end;
  -- 8 autorización y compra
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  select id into cid from tc_cotizacion where pedido_id = pid;
  r := tc_accion(pid, 'aut_solicitar', ver, gen_random_uuid(), jsonb_build_object('cotizacion_id', cid, 'motivo', 'mejor precio')); ver := (r->>'version')::int;
  begin perform tc_accion(pid, 'ucc_rechazar', ver, gen_random_uuid(), '{"motivo":"x"}'); raise exception 'FALLA 8';
  exception when sqlstate '22023' then log := log || '8 con autorización pedida no se rechaza' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', aut, 'email', 'aut@t.py')::text, true);
  select id into aid from tc_autorizacion where pedido_id = pid and estado = 'pendiente';
  r := tc_accion(pid, 'aut_resolver', ver, gen_random_uuid(), jsonb_build_object('autorizacion_id', aid, 'decision', 'autorizar')); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'compra_registrar', ver, gen_random_uuid(), '{"doc_tipo":"oc","doc_numero":"OC-55","fecha_compra":"2026-11-12","uso_caja_chica":false,"ruta":"directa"}'); ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_accion(pid, 'mov_registrar', ver, gen_random_uuid(), '{"tipo":"directa","cantidad":"6"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'cerrado' then raise exception 'FALLA 8b %', tc_detalle(pid)->>'fase'; end if;
  log := log || '8 autorizado, comprado y recibido: cerrado' || E'\n';
  -- 9 rechazo y reabrir en otro
  r := tc_pedido_crear(gen_random_uuid(), '{"canal":"ucc","obra_clave":"O1","descripcion":"Motor de arranque","cantidad":"1","unidad":"un"}');
  if r->>'codigo' <> 'UCC-000002' then raise exception 'FALLA 9 %', r->>'codigo'; end if;
  pid := (r->>'id')::uuid; ver := (r->>'version')::int;
  perform set_config('request.jwt.claims', json_build_object('sub', com, 'email', 'compras@t.py')::text, true);
  r := tc_accion(pid, 'ucc_rechazar', ver, gen_random_uuid(), '{"motivo":"Lo compra la obra"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'rechazado' then raise exception 'FALLA 9b'; end if;
  r := tc_accion(pid, 'ucc_reabrir', ver, gen_random_uuid(), '{"motivo":"Error"}'); ver := (r->>'version')::int;
  if tc_detalle(pid)->>'fase' <> 'cotizacion' then raise exception 'FALLA 9c'; end if;
  log := log || '9 rechazar y reabrir' || E'\n';
  -- 10 taller sigue igual
  perform set_config('request.jwt.claims', json_build_object('sub', tal, 'email', 'taller@t.py')::text, true);
  r := tc_pedido_crear(gen_random_uuid(), '{"obra_clave":"O1","descripcion":"Filtro nuevo","cantidad":"1","unidad":"un"}');
  if r->>'codigo' <> 'TAL-000002' or tc_detalle((r->>'id')::uuid)->>'fase' <> 'bodega' then raise exception 'FALLA 10'; end if;
  if (tc_kpis('{"canal":"ucc"}')->>'n')::int <> 2 or (tc_kpis('{}')->>'n')::int <> 2 then raise exception 'FALLA 10b % %', tc_kpis('{"canal":"ucc"}')->>'n', tc_kpis('{}')->>'n'; end if;
  log := log || '10 taller igual (TAL-000002 en bodega), KPIs separados' || E'\n';
  raise exception E'PRUEBA OK\n%', log;
end $$;
