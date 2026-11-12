/* Prueba de la sección «⭐ Estratégicas UCC» del módulo Compras (SQL 110) con la base simulada.
 *   node compras/pruebas/ucc_ui.test.cjs       (Chromium + Playwright; levanta un servidor local)
 * Abre compras/index.html de verdad (modulo.js + taller.js) con supabase/api/compras.js simulados.
 * Verifica: las tres secciones arriba, que UCC pide con canal ucc, que no hay bodega, que compras
 * puede pedir aclaración / rechazar y el solicitante editar mientras no hay cotización, y que Taller
 * sigue pidiendo canal taller. Capturas en compras/pruebas/capturas/ (no se publican). */
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });

const MOCK = `
window.__llamadas = [];
var YO = { uid: 'u1', nombre: 'Compras Demo', ver: true, ver_todas: true, solicitar: true, sol_todas: true, sol_obras: [], bodega: false, compras: true, autorizar: false, super: false };
var base = { obra_clave: 'O1', obra_nombre: 'TALLER CENTRAL', tipo: 'producto', unidad: 'un', prioridad: 'normal', solicitante_id: 'u1', solicitante_nombre: 'Compras Demo',
  creado_en: '2026-11-12T13:00:00Z', version: 1, n_fotos: 0, n_cotizaciones: 0, q: { c: 0, d: 0, p: 0, e: 0, r: 0, s: 0 }, ruta: 'central', canal: 'ucc' };
var UCC = [
  Object.assign({}, base, { id: 'u1p', codigo: 'UCC-000001', descripcion: 'Juego de cubiertas 17.5R25', cantidad: 4, estado: 'compra', fase: 'cotizacion', prioridad: 'alta', notas: 'Importación, cotizar 3 proveedores' }),
  Object.assign({}, base, { id: 'u2p', codigo: 'UCC-000002', descripcion: 'Baterías 12V 200Ah (lote)', cantidad: 20, estado: 'revision', fase: 'aclaracion', bodega_nombre: 'Compras Demo', bodega_nota: '¿Qué marca?', bodega_en: '2026-11-12T14:00:00Z' }),
  Object.assign({}, base, { id: 'u3p', codigo: 'UCC-000003', descripcion: 'Motor de arranque', cantidad: 1, estado: 'rechazado', fase: 'rechazado', bodega_nombre: 'Compras Demo', bodega_nota: 'Lo compra la obra', bodega_en: '2026-11-12T14:00:00Z' })];
var TAL = [Object.assign({}, base, { id: 't1', codigo: 'TAL-000001', canal: 'taller', descripcion: 'Filtro', cantidad: 1, estado: 'pendiente', fase: 'bodega' })];
function det(id) { var p = UCC.concat(TAL).filter(function (x) { return x.id === id; })[0]; return Object.assign({}, p, { cotizaciones: [], autorizaciones: [], movimientos: [], adjuntos: [], eventos: [{ id: 1, en: p.creado_en, actor_nombre: 'Compras Demo', titulo: 'Pedido estratégico (UCC) cargado · va directo a compras' }] }); }
var cliente = {
  auth: { getSession: async function () { return { data: { session: { user: {} } } }; }, signOut: async function () {} },
  from: function () { return { select: function () { return { limit: async function () { return { data: [{ canal: 'ucc' }], error: null }; } }; } }; },
  storage: { from: function () { return { createSignedUrls: async function () { return { data: [] }; } }; } },
  rpc: async function (fn, a) {
    window.__llamadas.push([fn, a]);
    if (fn === 'app_whoami') return { data: { rol: 'compras', nombre: 'Compras Demo', email: 'c@t.py' } };
    if (fn === 'tc_yo') return { data: YO };
    if (fn === 'tc_inicio') return { data: { yo: YO, obras: [{ clave: 'O1', nombre: 'TALLER CENTRAL', pide: true }], equipos: [{ id: 'TC-04', d: 'Tractor' }], proveedores: [] } };
    if (fn === 'tc_listar') { var L = a.p.canal === 'ucc' ? UCC : TAL; return { data: { total: L.length, conteos: { cotizacion: 1, aclaracion: 1, rechazado: 1, bodega: a.p.canal === 'ucc' ? 0 : 1 }, obras: [{ clave: 'O1', nombre: 'TALLER CENTRAL' }], filas: L } }; }
    if (fn === 'tc_detalle') return { data: det(a.p_pedido) };
    if (fn === 'tc_kpis') return { data: { desde: '2026-08-14', n: 3, fases: { cotizacion: 1, aclaracion: 1, rechazado: 1 }, caja_chica: 0, comprados: 0, con_fecha: 0, a_tiempo: 0, atrasados_abiertos: 0, por_obra: [] } };
    if (fn === 'tc_pedido_crear') return { data: { ok: true, id: 'u1p', codigo: 'UCC-000004', version: 1 } };
    if (fn === 'tc_accion') return { data: { ok: true, id: a.p_pedido, version: a.p_version + 1 } };
    return { data: null };
  }
};
window.ObraAPI = { _sb: function () { return cliente; } };
`;
const COMPRAS_JS = `window.ComprasView = { abrirModulo: function () { document.getElementById('v-compras').innerHTML = '<div class="estado">(compras de obras simulado)</div>'; } };`;

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (/\/supabase\.min\.js$/.test(u) || /\/exceljs\.min\.js$/.test(u) || /\/visor\.js$/.test(u)) { res.end(''); return; }
  if (/\/api\.js$/.test(u)) { res.setHeader('content-type', 'text/javascript'); res.end(MOCK); return; }
  if (/\/compras\.js$/.test(u)) { res.setHeader('content-type', 'text/javascript'); res.end(COMPRAS_JS); return; }
  const f = path.join(RAIZ, u);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/compras/index.html';
  const nav = await chromium.launch();
  const pag = await nav.newPage({ viewport: { width: 1400, height: 900 } });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errores.push(m.text()); });
  pag.on('dialog', (d) => d.accept('motivo de prueba'));
  const llam = (fn) => pag.evaluate((f) => window.__llamadas.filter((x) => x[0] === f), fn);

  await pag.goto(URL + '?s=ucc');
  await pag.waitForSelector('#v-ucc tr[data-id]');
  const secs = await pag.$$eval('#secciones button:not([hidden])', (b) => b.map((x) => x.textContent.trim()));
  assert.deepStrictEqual(secs, ['Obras', '🔧 Taller', '⭐ Estratégicas UCC'], 'tres secciones');
  const tabs = await pag.$$eval('#v-ucc [data-tab]', (b) => b.map((x) => x.textContent.trim()));
  assert.ok(!tabs.some((t) => /Bodega|Permisos|Histórico/.test(t)), 'UCC sin bodega, permisos ni histórico: ' + tabs);
  assert.strictEqual((await llam('tc_listar'))[0][1].p.canal, 'ucc', 'lista con canal ucc');
  assert.strictEqual(await pag.title(), 'Compras estratégicas UCC - Tecsul');
  const filas = await pag.$$eval('#v-ucc tr[data-id] td:first-child b', (b) => b.map((x) => x.textContent));
  assert.deepStrictEqual(filas, ['UCC-000001', 'UCC-000002', 'UCC-000003']);
  await pag.screenshot({ path: path.join(OUT, 'ucc_bandeja.png') });
  console.log('✓ sección UCC: tres secciones, bandeja con canal ucc, sin bodega');

  // nuevo pedido
  await pag.click('#tcNuevo');
  assert.match(await pag.textContent('.tc-modal h3'), /Nuevo pedido estratégico/);
  await pag.fill('#fp_descripcion', 'Neumáticos para motoniveladora');
  await pag.fill('#fp_cantidad', '6');
  await pag.selectOption('#fp_obra_clave', 'O1');
  await pag.screenshot({ path: path.join(OUT, 'ucc_nuevo.png') });
  assert.strictEqual((await pag.textContent('#fpOk')).trim(), 'Enviar a compras');
  await pag.click('#fpOk');
  await pag.waitForFunction(() => window.__llamadas.some((x) => x[0] === 'tc_pedido_crear'));
  const cr = (await llam('tc_pedido_crear'))[0][1];
  assert.strictEqual(cr.p.canal, 'ucc', 'crea con canal ucc');
  await pag.waitForSelector('.tc-modal.tc-ficha .tc-hd h3');
  console.log('✓ nuevo pedido con canal ucc');

  // ficha en cotización: compras pide aclaración; el solicitante puede editar (sin cotizaciones)
  const ficha = await pag.textContent('.tc-modal.tc-ficha');
  assert.match(ficha, /Pedir aclaración/); assert.match(ficha, /Rechazar/); assert.match(ficha, /Editar/);
  assert.ok(!/Bodega central/.test(ficha), 'la ficha UCC no habla de bodega');
  await pag.screenshot({ path: path.join(OUT, 'ucc_ficha.png') });
  await pag.click('[data-ucc="ucc_aclaracion"]');
  assert.match(await pag.textContent('#toast'), /motivo/i, 'pide motivo');
  await pag.fill('#sg_motivo', 'Indicar medida exacta');
  await pag.click('[data-ucc="ucc_aclaracion"]');
  await pag.waitForFunction(() => window.__llamadas.some((x) => x[0] === 'tc_accion' && x[1].p_accion === 'ucc_aclaracion'));
  console.log('✓ compras pide aclaración con motivo');

  // ficha rechazada: reabrir
  await pag.evaluate(() => document.querySelectorAll('.tc-modal').forEach((m) => m.remove()));
  await pag.click('#v-ucc tr[data-id="u3p"]');
  await pag.waitForSelector('#sgReabrir');
  await pag.click('#sgReabrir');
  await pag.waitForFunction(() => window.__llamadas.some((x) => x[0] === 'tc_accion' && x[1].p_accion === 'ucc_reabrir'));
  console.log('✓ reabrir un rechazado');

  // KPIs
  await pag.evaluate(() => document.querySelectorAll('.tc-modal').forEach((m) => m.remove()));
  await pag.click('#v-ucc [data-tab="kpis"]');
  await pag.waitForSelector('#v-ucc .tc-kst');
  assert.strictEqual((await llam('tc_kpis'))[0][1].p.canal, 'ucc');
  assert.ok(!/decisión de bodega/.test(await pag.textContent('#v-ucc')));
  console.log('✓ KPIs con canal ucc');

  // Taller sigue igual
  await pag.click('#secciones [data-sec="taller"]');
  await pag.waitForSelector('#v-taller tr[data-id]');
  const lt = (await llam('tc_listar')).filter((x) => x[1].p.canal === 'taller');
  assert.ok(lt.length >= 1, 'Taller pide canal taller');
  assert.ok(await pag.isHidden('#v-ucc'));
  assert.match(await pag.textContent('#v-taller'), /Bodega central/);
  console.log('✓ Taller sigue con bodega y canal taller');

  // celular
  await pag.setViewportSize({ width: 390, height: 800 });
  await pag.click('#secciones [data-sec="ucc"]');
  await pag.screenshot({ path: path.join(OUT, 'ucc_celular.png') });

  assert.deepStrictEqual(errores, [], 'errores de JavaScript: ' + errores.join(' | '));
  console.log('✓ sin errores de JavaScript · capturas en ' + OUT);
  await nav.close(); srv.close();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
