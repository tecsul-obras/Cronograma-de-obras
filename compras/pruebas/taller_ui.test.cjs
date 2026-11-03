/* Prueba de la pantalla de Compras de taller con la base simulada.
 *   node compras/pruebas/taller_ui.test.cjs           (Chromium + Playwright)
 * Verifica saldos, acciones disponibles por permiso y que la bandeja, la ficha,
 * los formularios y los KPIs se dibujen sin errores. Deja capturas en
 * compras/pruebas/capturas/ (no se publican: la carpeta está en .gitignore). */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });

const YO = { uid: 'u1', nombre: 'Bodega Demo', ver: true, ver_todas: true, solicitar: true, sol_todas: true, sol_obras: [], bodega: true, compras: true, autorizar: true, super: true };
const base = { obra_clave: 'O1', obra_nombre: 'ARBOREA HILLS', tipo: 'producto', unidad: 'kit', prioridad: 'normal', solicitante_id: 'u2', solicitante_nombre: 'Encargado Demo',
  creado_en: '2026-10-27T13:00:00Z', version: 3, n_fotos: 0, n_cotizaciones: 0, q: { c: 0, d: 0, p: 0, e: 0, r: 0, s: 0 }, ruta: 'central' };
const FILAS = [
  Object.assign({}, base, { id: 'p1', codigo: 'TAL-000001', descripcion: 'Espejo retrovisor', cantidad: 1, unidad: 'un', estado: 'pendiente', fase: 'bodega', prioridad: 'urgente', equipo_id: 'TC-04', fecha_requerida: '2026-11-01' }),
  Object.assign({}, base, { id: 'p2', codigo: 'TAL-000002', descripcion: 'Kit de filtros', cantidad: 6, estado: 'compra', fase: 'autorizacion', n_cotizaciones: 2, aut_id: 'a1', aut_estado: 'pendiente', aut_proveedor: 'Repuestos Central', aut_total: 950000, aut_moneda: 'PYG' }),
  Object.assign({}, base, { id: 'p4', codigo: 'TAL-000004', descripcion: 'Cubiertas', cantidad: 10, unidad: 'un', estado: 'compra', fase: 'entrega', comprado: true, ruta: 'mixta', doc_tipo: 'oc', doc_numero: 'OC-77', compra_total: 9600000, compra_moneda: 'PYG', compra_proveedor: 'Ruedas PY', uso_caja_chica: false, q: { c: 6, d: 2, p: 4, e: 4, r: 3, s: 0 } }),
  Object.assign({}, base, { id: 'p6', codigo: 'TAL-000006', descripcion: 'Batería 12V', cantidad: 3, unidad: 'un', estado: 'stock', fase: 'entrega', q: { c: 0, d: 0, p: 3, e: 2, r: 1, s: 0 } })
];
const DET = {
  p2: Object.assign({}, FILAS[1], {
    cotizaciones: [
      { id: 'c1', proveedor_nombre: 'Repuestos Central', precio_unit: 150000, flete: 50000, moneda: 'PYG', impuesto: 'incluido', plazo_dias: 3, anulada: false, creado_en: '2026-10-28T10:00:00Z' },
      { id: 'c2', proveedor_nombre: 'Taller Norte', precio_unit: 160000, flete: 0, moneda: 'PYG', impuesto: 'incluido', plazo_dias: 1, anulada: false, creado_en: '2026-10-28T11:00:00Z' }],
    autorizaciones: [{ id: 'a1', cotizacion_id: 'c1', estado: 'pendiente', solicitado_por: 'u3', solicitado_nombre: 'Compras Demo', solicitado_en: '2026-10-29T10:00:00Z', motivo: 'menor total', total: 950000, moneda: 'PYG', oferta: { proveedor_nombre: 'Repuestos Central', precio_unit: 150000, flete: 50000, plazo_dias: 3 } }],
    movimientos: [], adjuntos: [], eventos: [{ id: 1, en: '2026-10-27T13:00:00Z', actor_nombre: 'Encargado Demo', titulo: 'Solicitud cargada', detalle: '6 kit' }]
  }),
  p4: Object.assign({}, FILAS[2], {
    cotizaciones: [], autorizaciones: [], adjuntos: [], eventos: [],
    compra: { doc_tipo: 'oc', doc_numero: 'OC-77', fecha_compra: '2026-10-30', total: 9600000, moneda: 'PYG', uso_caja_chica: false, oferta: { proveedor_nombre: 'Ruedas PY', precio_unit: 960000, flete: 0 } },
    movimientos: [
      { id: 'm1', tipo: 'central', cantidad: 6, fecha: '2026-10-31' }, { id: 'm2', tipo: 'directa', cantidad: 2, fecha: '2026-10-31', referencia: 'remito 55' },
      { id: 'm3', tipo: 'prepara', cantidad: 4, fecha: '2026-11-01' }, { id: 'm4', tipo: 'envio', cantidad: 4, fecha: '2026-11-01' }, { id: 'm5', tipo: 'recepcion', cantidad: 3, fecha: '2026-11-02' }]
  })
};
const HIST = { total: 3, tableros: [{ archivo: 'Compras_Taller_1792287446.xlsx', filas: 1 }, { archivo: 'Pedidos_Taller_1792287466.xlsx', filas: 2 }], filas: [
  { id: 2, archivo: 'Pedidos_Taller_1792287466.xlsx', hoja: 'pedidos taller', fila: 5, estado: 'conflicto', campos: { Name: 'PULMON DE FRENO', 'Fecha solicitud': '2025-07-01 10:00:00 UTC', 'Cantidad requerida': 4 } },
  { id: 1, archivo: 'Pedidos_Taller_1792287466.xlsx', hoja: 'pedidos taller', fila: 4, estado: 'nuevo', campos: { Name: 'FILTRO DE ACEITE', 'Fecha solicitud': '2025-06-06 13:52:55 UTC', 'Cantidad requerida': 2, 'Nombre solicitante': 'Encargado Demo', 'Taller solicitante': 'Taller Central', 'Centro de costo': '301', 'Validación': 'Trasladar', _grupo: 'Pedidos Ingresados', 'Imagen de referencia': 'https://tecsul-force.monday.com/protected_static/1/resources/2/FILTRO%20ACEITE.jpg' } },
  { id: 3, archivo: 'Compras_Taller_1792287446.xlsx', hoja: 'compras taller', fila: 4, estado: 'nuevo', campos: { Name: 'ESPEJO RETROVISOR', 'Fecha solicitud': '2025-05-01 09:00:00 UTC', 'Orden de Compra': 'OC-123', 'Estado de Compra': 'Comprado' } }] };
DET.p1 = Object.assign({}, FILAS[0], { cotizaciones: [], autorizaciones: [], movimientos: [], adjuntos: [], eventos: [] });
DET.p6 = Object.assign({}, FILAS[3], { cotizaciones: [], autorizaciones: [], movimientos: [], adjuntos: [], eventos: [] });

(async () => {
  // 1. reglas en node (mismas funciones que usa la pantalla)
  global.window = global; global.document = { querySelector: () => null };
  require(path.join(RAIZ, 'compras', 'taller.js'));
  const T = global.TallerCompras;
  const S = T._saldos(FILAS[2]);
  assert.deepStrictEqual([S.provPend, S.enCentral, S.transito, S.enObra, S.pendFinal], [2, 2, 1, 5, 5], 'saldos del ejemplo del documento');
  assert.deepStrictEqual(T._movsPosibles(FILAS[2], YO).sort(), ['central', 'directa', 'prepara', 'recepcion'].sort(), 'movimientos posibles en mixta');
  assert.deepStrictEqual(T._movsPosibles(FILAS[3], Object.assign({}, YO, { bodega: false })), ['recepcion'], 'la obra solo recibe');
  assert.deepStrictEqual(T._movsPosibles(FILAS[3], Object.assign({}, YO, { solicitar: false })), ['envio'], 'bodega envía lo preparado');
  console.log('✓ saldos y movimientos');
  delete global.TallerCompras;

  // 2. pantalla
  const navegador = await chromium.launch();
  const pag = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><section id="v-taller"></section><div id="toast"></div>' +
    '<script>window.__llamadas=[];window.toast=function(t){document.getElementById("toast").innerHTML=t};' +
    'var FIL=' + JSON.stringify(FILAS) + ',DET=' + JSON.stringify(DET) + ',YO=' + JSON.stringify(YO) + ',HIST=' + JSON.stringify(HIST) + ';' +
    'window.ObraAPI={_sb:function(){return{rpc:async function(fn,a){window.__llamadas.push([fn,a]);' +
    'if(fn==="tc_inicio")return{data:{yo:YO,obras:[{clave:"O1",nombre:"ARBOREA HILLS",pide:true}],equipos:[{id:"TC-04",d:"Tractor"}],proveedores:[]}};' +
    'if(fn==="tc_listar")return{data:{total:FIL.length,conteos:{bodega:1,autorizacion:1,entrega:2},obras:[{clave:"O1",nombre:"ARBOREA HILLS"}],filas:FIL}};' +
    'if(fn==="tc_detalle")return{data:DET[a.p_pedido]};' +
    'if(fn==="tc_kpis")return{data:{desde:"2026-08-01",n:4,fases:{bodega:1,autorizacion:1,entrega:2},desde_stock:1,por_compra:3,caja_chica:0,comprados:1,dias_bodega:0.5,dias_total:null,con_fecha:0,a_tiempo:0,atrasados_abiertos:1,por_obra:[{obra_nombre:"ARBOREA HILLS",n:4,abiertos:4,atrasados:1,cerrados:0}]}};' +
    'if(fn==="tc_accion")return{data:{ok:true,version:a.p_version+1}};' +
    'if(fn==="tc_hist_listar")return{data:JSON.parse(JSON.stringify(HIST))};' +
    'return{data:null}},storage:{from:function(){return{createSignedUrls:async function(){return{data:[]}}}}}}}};<\/script>' +
    '<script src="file://' + path.join(RAIZ, 'compras', 'taller.js') + '"><\/script>' +
    '<script>TallerCompras.abrir(document.getElementById("v-taller"))<\/script></body></html>';
  const f = path.join(OUT, 'pagina.html');
  fs.writeFileSync(f, html);
  await pag.goto('file://' + f);
  await pag.waitForSelector('tr[data-id="p4"]');
  await pag.screenshot({ path: path.join(OUT, '1_bandeja.png') });
  assert.strictEqual(await pag.locator('tr[data-id]').count(), 4);
  console.log('✓ bandeja con 4 pedidos');

  await pag.click('tr[data-id="p2"]');
  await pag.waitForSelector('[data-aut="autorizar"]');
  await pag.click('[data-dtab="cotizaciones"]');
  await pag.waitForSelector('.tc-cot');
  await pag.screenshot({ path: path.join(OUT, '2_autorizacion_cotizaciones.png') });
  assert.ok(await pag.locator('text=menor total').count() >= 1, 'marca la oferta de menor total');
  // devolver sin motivo no llama a la base
  await pag.click('[data-dtab="resumen"]');
  const antes = await pag.evaluate(() => window.__llamadas.filter((x) => x[0] === 'tc_accion').length);
  await pag.click('[data-aut="devolver"]');
  assert.strictEqual(await pag.evaluate(() => window.__llamadas.filter((x) => x[0] === 'tc_accion').length), antes, 'devolver exige motivo');
  await pag.fill('#sg_motivo', 'pedir otra cotización');
  await pag.click('[data-aut="devolver"]');
  await pag.waitForFunction(() => window.__llamadas.some((x) => x[0] === 'tc_accion' && x[1].p_accion === 'aut_resolver'));
  const ll = await pag.evaluate(() => window.__llamadas.filter((x) => x[0] === 'tc_accion').pop()[1]);
  assert.strictEqual(ll.p_version, 3); assert.ok(/^[0-9a-f-]{36}$/.test(ll.p_op)); assert.strictEqual(ll.p.decision, 'devolver');
  console.log('✓ autorización: versión, clave de operación y motivo');

  await pag.keyboard.press('Escape'); await pag.waitForTimeout(150);
  await pag.click('tr[data-id="p4"]');
  await pag.waitForSelector('[data-mov="recepcion"]');
  await pag.click('[data-dtab="movimientos"]');
  await pag.waitForSelector('.tc-saldos');
  await pag.screenshot({ path: path.join(OUT, '3_entrega_mixta.png') });
  await pag.click('.tc-sigue [data-mov="recepcion"], .sigue [data-mov="recepcion"]');
  await pag.waitForSelector('#mv_cant');
  assert.strictEqual(await pag.inputValue('#mv_cant'), '1', 'propone lo que está en tránsito');
  await pag.fill('#mv_cant', '2'); await pag.click('#mvOk');
  assert.ok(/máximo/.test(await pag.textContent('#toast')), 'no deja recibir más que lo enviado');
  console.log('✓ entrega parcial con tope');
  await pag.keyboard.press('Escape'); await pag.keyboard.press('Escape'); await pag.waitForTimeout(150);

  await pag.click('tr[data-id="p1"]');
  await pag.waitForSelector('[data-bod="bodega_stock"]');
  await pag.fill('#sg_stock', '0'); await pag.click('[data-bod="bodega_stock"]');
  assert.ok(/al menos/.test(await pag.textContent('#toast')), 'stock insuficiente');
  await pag.screenshot({ path: path.join(OUT, '4_bodega.png') });
  await pag.keyboard.press('Escape'); await pag.waitForTimeout(150);

  await pag.click('#tcNuevo');
  await pag.waitForSelector('#fp_descripcion');
  await pag.screenshot({ path: path.join(OUT, '5_nuevo.png') });
  await pag.keyboard.press('Escape');

  await pag.click('[data-tab="kpis"]');
  await pag.waitForSelector('.tc-kc');
  await pag.screenshot({ path: path.join(OUT, '6_kpis.png') });

  await pag.click('[data-tab="historico"]');
  await pag.waitForSelector('tr[data-hist]');
  assert.strictEqual(await pag.locator('tr[data-hist]').count(), 3);
  await pag.click('tr[data-hist="1"]');
  await pag.waitForSelector('.tc-modal a[href*="monday.com"]');
  assert.ok(await pag.locator('.tc-modal >> text=Centro de costo').count() >= 1, 'la ficha muestra todas las columnas');
  await pag.screenshot({ path: path.join(OUT, '6b_historico.png') });
  await pag.keyboard.press('Escape');
  console.log('✓ histórico de Monday (lista y ficha)');

  await pag.setViewportSize({ width: 390, height: 800 });
  await pag.evaluate(() => document.body.classList.add('mobile'));
  await pag.click('[data-tab="pedidos"]');
  await pag.waitForSelector('tr[data-id]');
  await pag.click('tr[data-id="p4"]');
  await pag.waitForSelector('.tc-saldos, [data-mov]');
  await pag.screenshot({ path: path.join(OUT, '7_celular_ficha.png') });

  await navegador.close();
  assert.deepStrictEqual(errores, [], 'errores en la página: ' + errores.join(' | '));
  console.log('✓ sin errores de JavaScript · capturas en ' + OUT);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
