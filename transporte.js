/* =========================================================================
 * transporte.js — Pestaña TRANSPORTE / CAMIONES · v20261006d
 *
 * Reemplaza el formulario de Jotform "Planilla de carga de pista" con el mismo
 * formato: fecha, tipo de actividad, centro de costo, material, origen,
 * destino, distancia, progresivas, emulsión (litros y m²), hormigón (m³),
 * volquetes (chapa, viajes y toneladas TOTALES de la fila), observaciones y
 * foto de la planilla (obligatoria en "Carga en pista"). Sin firma: el que
 * carga queda registrado por su usuario.
 *
 * - Se carga desde el celular, con o sin señal (cola offline como Producción).
 * - Lista de cargas con filtros, totales y Excel (un renglón por camión).
 * - Corregir / borrar: admin y residente cualquiera; el rol de campo solo lo suyo.
 * - v20261006c: STOCK de materiales en depósitos (Campamento, Cantera,
 *   Acopio Intermedio) que sale solo de las cargas: entra lo que tiene ese
 *   depósito como destino y sale lo que lo tiene como origen. Se ajusta con
 *   CONTEOS (admin/residente): "tal día había T toneladas"; desde ahí siguen
 *   sumando y restando los viajes.
 * - v20261006c: MAESTRO DE CAMIONES: solo se aceptan chapas del maestro (lo
 *   mantiene el admin central). "bjt 884" se guarda como "BJT-884".
 * No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ACTIVIDADES = ['Carga en pista', 'Entrada de materiales a campamento', 'Descarga en Acopio Intermedio'];
  var MATERIALES = ['Suelo/Terraplen', 'Limpieza/Desbroce', 'Excavación No clasificada', 'Excavación Estructural', 'Excavacion de Bolson',
    'Triturada 4ta', 'Triturada 5ta', 'Triturada 6ta', 'Triturada 6ta segunda', 'Piedra cero', 'Piedra Rechazo Primaria',
    'Base', 'Base sin arena', 'SubBase', 'Macadan', 'Suelo cal', 'Cal Hidratada', 'Arena Lavada', 'Arena Yacimiento',
    'Concreto Asfaltico Convencional', 'Emulsión Asfáltica',
    'Hormigón fck 90', 'Hormigón fck 150', 'Hormigón fck 180', 'Hormigón fck 210', 'Hormigón fck 240', 'Hormigón fck 250', 'Otros'];
  var ORIGENES = ['Prestamo', 'Pista', 'Proveedor', 'Cantera', 'Campamento', 'Planta de suelos', 'Planta de asfalto', 'Progresiva'];
  var DESTINOS = ['Pista', 'Campamento', 'Botadero', 'Cantera', 'Acopio Intermedio', 'Planta de asfalto', 'Planta de suelos'];
  var MAX_FOTOS = 6;
  var DEPOSITOS = ['Campamento', 'Cantera', 'Acopio Intermedio'];
  var STK = { corte: '', ajuste: null };     // panel de stock: fecha de corte y ajuste en edición
  var CAM = { txt: '', ed: null, inact: false };   // panel de camiones

  var D = null, obraCargada = null, CARGANDO = false;
  var F = null;          // formulario en curso
  var EDIT = null;       // carga_id en edición (null = nueva)
  var MODO = 'cargar';   // celular: 'cargar' | 'lista'
  var FIL = { desde: '', hasta: '', act: '', mat: '', txt: '' };

  // ------------------------------------------------------------ utilidades
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fq(v) { return v === null || v === undefined || v === '' ? '–' : n(v).toLocaleString('es-PY', { maximumFractionDigits: 6 }); }
  function fin(v) { return v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','); }
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function haceDias(k) { var d = new Date(); d.setDate(d.getDate() - k); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fd(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
  // YO_SOY es un let de app.js: se lee por nombre
  function yoSoy() { try { return (typeof YO_SOY !== 'undefined' && YO_SOY) || ''; } catch (e) { return ''; } }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function rol() { return global.__role || ''; }
  function esEditor() { return rol() === 'admin' || rol() === 'residente'; }
  function puedeCargar() { return esEditor() || rol() === 'transporte'; }
  function puedeTocar(c) { return esEditor() || (rol() === 'transporte' && D && D.yo && c.cargado_por === D.yo); }
  function esMovil() { return document.body.classList.contains('mobile'); }
  function oid() { return global.ObraAPI && global.ObraAPI.getObraId(); }
  function esEmulsion(m) { return /emulsi/i.test(m || ''); }
  function esHormigon(m) { return /^hormig/i.test(m || ''); }
  function esCargaPista(a) { return a === 'Carga en pista'; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem('tr:' + k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem('tr:' + k, JSON.stringify(v)); } catch (e) {} }
  function totViajes(c) { return (c.viajes || []).reduce(function (s, v) { return s + n(v.viajes); }, 0); }
  function totTon(c) { return (c.viajes || []).reduce(function (s, v) { return s + n(v.toneladas); }, 0); }
  function esAdmin() { return rol() === 'admin'; }
  function chapaKey(s) { return String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase(); }
  // maestro de camiones activos por chapa normalizada (vacío = todavía no hay maestro: no se valida)
  function maestro() {
    var m = {}; ((D && D.camiones) || []).forEach(function (c) { if (c.activo) m[c.chapa_key || chapaKey(c.chapa)] = c; });
    return m;
  }
  function hayMaestro() { return Object.keys(maestro()).length > 0; }
  function chapaOk(ch) {
    var k = chapaKey(ch); if (!k) return true;
    return !hayMaestro() || !!maestro()[k] || !!(F && F.chapasOrig && F.chapasOrig[k]);
  }
  function ccTxt(c) {
    var it = D && D.items.filter(function (i) { return i.cc === c.codigo_cc; })[0];
    if (it) return it.id + ' · ' + it.desc;
    var t = c.cc_texto || c.codigo_cc || '';
    return t.indexOf(' _ ') >= 0 ? t.split(' _ ')[1].replace(/^\d+_/, '') : t;
  }

  // ------------------------------------------------------------ estilos
  function estilos() {
    if ($('#trCss')) return;
    var st = document.createElement('style'); st.id = 'trCss';
    st.textContent = [
      '#v-transporte{overflow:auto;background:#f4f6f9}',
      '.tr-wrap{display:grid;grid-template-columns:minmax(360px,460px) 1fr;gap:16px;padding:14px 18px 40px;max-width:1800px;margin:0 auto;color:#1f2937;align-items:start}',
      '.tr-card{background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:14px 16px}',
      '.tr-card h2{margin:0 0 10px;font-size:15px;color:#1a2744;display:flex;align-items:center;gap:8px}',
      '.tr-card h2 small{font-weight:400;color:#7a8699;font-size:12px}',
      '.tr-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
      '.tr-f>label,.tr-lab{font-size:11.5px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.tr-f input,.tr-f select,.tr-f textarea{font:inherit;font-size:15px;padding:9px 10px;border:1px solid #c9d1dc;border-radius:9px;background:#fff;color:#1f2937;width:100%;box-sizing:border-box}',
      '.tr-f input:focus,.tr-f select:focus,.tr-f textarea:focus{outline:2px solid #e8640a;border-color:#e8640a}',
      '.tr-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.tr-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}',
      '.tr-seg{display:flex;flex-direction:column;gap:6px}',
      '.tr-seg button{text-align:left;padding:10px 12px;border:1px solid #c9d1dc;border-radius:9px;background:#fff;font-size:14px;font-weight:600;color:#1f2937;cursor:pointer}',
      '.tr-seg button.on{background:#1a2744;border-color:#1a2744;color:#fff}',
      '.tr-req{color:#c0392b}',
      '.tr-vq{border:1px solid #e1e6ee;border-radius:10px;padding:8px;background:#fafbfd}',
      '.tr-vq-h,.tr-vq-r{display:grid;grid-template-columns:1.3fr .8fr 1fr 34px;gap:6px;align-items:center}',
      '.tr-vq-h{font-size:10.5px;font-weight:700;color:#7a8699;text-transform:uppercase;padding:0 2px 4px}',
      '.tr-vq-r{margin-bottom:6px}',
      '.tr-vq-r input{font:inherit;font-size:15px;padding:8px;border:1px solid #c9d1dc;border-radius:8px;width:100%;box-sizing:border-box;background:#fff}',
      '.tr-vq-r input.n{text-align:right}',
      '.tr-x{border:1px solid #e1e6ee;background:#fff;border-radius:8px;height:36px;color:#c0392b;font-size:16px;cursor:pointer}',
      '.tr-vq-tot{display:flex;justify-content:space-between;font-size:13px;color:#4a5568;padding:4px 2px 0}',
      '.tr-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer}',
      '.tr-btn:hover{background:#f4f7fb}.tr-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}',
      '.tr-btn.big{width:100%;padding:13px;font-size:16px}',
      '.tr-btn:disabled{opacity:.55;cursor:default}',
      '.tr-fotos{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}',
      '.tr-fotos .th{position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid #d0d6e0}',
      '.tr-fotos .th img{width:100%;height:100%;object-fit:cover}',
      '.tr-fotos .th button{position:absolute;top:2px;right:2px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:12px}',
      '.tr-foto-btn{display:inline-flex;align-items:center;gap:6px}',
      '.tr-info{font-size:12.5px;color:#4a5568;background:#f0f4fa;border-radius:8px;padding:8px 10px;margin-bottom:10px}',
      '.tr-edit{background:#fff4e5;border:1px solid #f5c26b;color:#7a4b00}',
      '.tr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.tr-bar input,.tr-bar select{font:inherit;font-size:13px;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937}',
      '.tr-bar .grow{flex:1}',
      '.tr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}',
      '.tr-kpi{border:1px solid #d0d6e0;border-left:4px solid #2c4a8a;border-radius:9px;padding:7px 10px;background:#fff}',
      '.tr-kpi span{display:block;font-size:10.5px;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.tr-kpi b{font-size:18px;color:#1a2744}',
      '.tr-tw{overflow:auto;border:1px solid #d0d6e0;border-radius:10px;background:#fff;max-height:calc(100vh - 330px)}',
      '.tr-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1050px}',
      '.tr-t th{position:sticky;top:0;background:#f0f2f5;font-size:10.5px;text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;z-index:1}',
      '.tr-t td{padding:5px 6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.tr-t td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tr-t td small{color:#7a8699}',
      '.tr-t tr.sel td{background:#fff4e5}',
      '.tr-mini{border:1px solid #d0d6e0;background:#fff;border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer}',
      '.tr-mini.del{color:#c0392b}',
      '.tr-chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:#eef2f7;color:#2c4a8a;margin:1px 0}',
      '.tr-chip.jf{background:#f3eefc;color:#6b3fa0}',
      '.tr-vacio{padding:30px;text-align:center;color:#4a5568}',
      '.tr-vq-hint{grid-column:1/-1;font-size:11.5px;color:#4a5568;margin:-3px 2px 2px}',
      '.tr-vq-hint.mal{color:#c0392b;font-weight:700}',
      '.tr-vq-r input.mal{border-color:#c0392b;background:#fdecea}',
      '.tr-tabs{display:flex;gap:6px;margin:0 0 12px;grid-column:1/-1}',
      '.tr-tabs button{padding:8px 14px;border:1px solid #c9d1dc;border-radius:10px;background:#fff;font-weight:700;font-size:13.5px;color:#1f2937;cursor:pointer}',
      '.tr-tabs button.on{background:#1a2744;color:#fff;border-color:#1a2744}',
      'body:not(.mobile) .tr-tabs button[data-modo="lista"]{display:none}',
      '.tr-wrap.uno{grid-template-columns:1fr}',
      '.tr-st{width:100%;border-collapse:collapse;font-size:13px}',
      '.tr-st th{background:#f0f2f5;font-size:10.5px;text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0}',
      '.tr-st td{padding:6px;border-bottom:1px solid #eef0f4;vertical-align:middle}',
      '.tr-st td.r,.tr-st th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tr-st td.neg{color:#c0392b;font-weight:700}',
      '.tr-st td.big{font-size:15px;font-weight:700;color:#1a2744}',
      '.tr-stw{overflow-x:auto}',
      '.tr-dep{margin-bottom:14px}',
      '.tr-dep h3{margin:0 0 6px;font-size:14px;color:#1a2744}',
      '.tr-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:14px}',
      '.tr-modal .box{background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:16px 18px;color:#1f2937}',
      '.tr-modal h3{margin:0 0 10px;color:#1a2744}',
      '.tr-off td{opacity:.5}',
      /* celular */
      'body.mobile .tr-wrap{display:block;padding:10px 10px 90px}',
      'body.mobile .tr-tabs{display:flex;gap:6px;margin-bottom:10px;overflow-x:auto}',
      'body.mobile .tr-tabs button{flex:1 0 auto;padding:10px;border:1px solid #c9d1dc;border-radius:10px;background:#fff;font-weight:700;font-size:14px;color:#1f2937}',
      'body.mobile .tr-tabs button.on{background:#1a2744;color:#fff;border-color:#1a2744}',
      'body.mobile .tr-wrap[data-modo="cargar"] .tr-col-lista,body.mobile .tr-wrap[data-modo="lista"] .tr-col-form{display:none}',
      'body.mobile .tr-card{padding:12px}',
      'body.mobile .tr-bar input,body.mobile .tr-bar select{flex:1 1 45%;min-width:0;font-size:14px;padding:8px}',
      'body.mobile .tr-bar .grow{display:none}',
      'body.mobile .tr-kpis{grid-template-columns:1fr 1fr}',
      'body.mobile .tr-tw{display:none}',
      '.tr-cards{display:none}',
      'body.mobile .tr-cards{display:block}',
      '.tr-c{background:#fff;border:1px solid #d0d6e0;border-radius:10px;padding:10px 12px;margin-bottom:8px}',
      '.tr-c .l1{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#4a5568}',
      '.tr-c .l2{font-size:14.5px;font-weight:700;color:#1a2744;margin:3px 0}',
      '.tr-c .l3{font-size:12.5px;color:#4a5568}',
      '.tr-c .l4{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:13px}',
      '.tr-c .l4 b{color:#1a2744}',
      '@media (max-width:1100px){.tr-wrap{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ formulario
  function nuevoForm() {
    var ult = lsGet('ult:' + oid()) || {};
    return {
      fecha: hoy(), tipo_actividad: ult.tipo_actividad || 'Carga en pista', codigo_cc: ult.codigo_cc || '', cc_otro: '',
      tipo_material: ult.tipo_material || '', origen: ult.origen || '', destino: ult.destino || '',
      distancia_km: ult.distancia_km != null ? ult.distancia_km : null, prog_origen: '', prog_ini: '', prog_fin: '',
      litros_ini: null, litros_fin: null, litros_usados: null, m2_pista: null, m3_hormigon: null,
      encargado: '', observaciones: '', viajes: [{ chapa: '', viajes: null, toneladas: null }], fotos: []
    };
  }
  function formDeCarga(c) {
    return {
      fecha: c.fecha, tipo_actividad: c.tipo_actividad, codigo_cc: c.codigo_cc, cc_otro: '', tipo_material: c.tipo_material,
      origen: c.origen, destino: c.destino, distancia_km: c.distancia_km, prog_origen: c.prog_origen, prog_ini: c.prog_ini,
      prog_fin: c.prog_fin, litros_ini: c.litros_ini, litros_fin: c.litros_fin, litros_usados: c.litros_usados,
      m2_pista: c.m2_pista, m3_hormigon: c.m3_hormigon, encargado: c.encargado, observaciones: c.observaciones,
      viajes: (c.viajes || []).length ? c.viajes.map(function (v) { return Object.assign({}, v); }) : [{ chapa: '', viajes: null, toneladas: null }],
      fotos: [], fotosGuardadas: c.fotos || [],
      chapasOrig: (c.viajes || []).reduce(function (o, v) { if (v.chapa) o[chapaKey(v.chapa)] = true; return o; }, {})
    };
  }
  function opts(lista, sel, vacio) {
    var l = lista.slice(); if (sel && l.indexOf(sel) < 0) l.push(sel);
    return (vacio ? '<option value="">' + vacio + '</option>' : '') + l.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }
  function optsCC(sel) {
    var items = D.items.filter(function (i) { return !i.grupo; });
    var hay = !sel || items.some(function (i) { return i.cc === sel; });
    return '<option value="">— elegí el centro de costo —</option>' +
      items.map(function (i) { return '<option value="' + esc(i.cc) + '"' + (i.cc === sel ? ' selected' : '') + '>' + esc(i.id + ' · ' + i.desc) + '</option>'; }).join('') +
      (hay ? '' : '<option value="' + esc(sel) + '" selected>' + esc(sel) + ' (código)</option>') +
      '<option value="__otro">Otro código de centro de costo…</option>';
  }
  function chapasConocidas() {
    if (hayMaestro()) {
      var m = maestro();
      return Object.keys(m).map(function (k) { return { v: m[k].chapa, l: (m[k].propio ? 'Propio' : (m[k].proveedor || '')) + (m[k].chofer ? ' · ' + m[k].chofer : '') }; })
        .sort(function (a, b) { return a.v.localeCompare(b.v); });
    }
    var c = {}; (D.cargas || []).slice(0, 600).forEach(function (x) { (x.viajes || []).forEach(function (v) { if (v.chapa) c[v.chapa] = (c[v.chapa] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 80).map(function (v) { return { v: v, l: '' }; });
  }
  function hintChapa(ch) {
    var k = chapaKey(ch); if (!k) return '';
    var m = maestro()[k];
    if (m) return '<div class="tr-vq-hint">' + esc(m.propio ? 'Flota propia' : (m.proveedor || '')) + (m.chofer ? ' · ' + esc(m.chofer) : '') + (m.descripcion ? ' · ' + esc(m.descripcion) : '') + '</div>';
    if (!hayMaestro()) return '';
    if (F && F.chapasOrig && F.chapasOrig[k]) return '<div class="tr-vq-hint">Chapa de la carga original (no está en el maestro)</div>';
    return '<div class="tr-vq-hint mal">⚠ ' + esc(ch) + ' no está en el maestro de camiones. Pedile al admin central que la agregue.</div>';
  }

  function htmlForm() {
    var f = F, ro = !puedeCargar();
    var cp = esCargaPista(f.tipo_actividad);
    var h = '<div class="tr-card"><h2>' + (EDIT ? '✎ Corregir carga' : '🚚 Nueva carga') + ' <small>' + esc((D.obraNombre || '')) + '</small></h2>';
    if (ro) return h + '<div class="tr-info">Tu usuario no puede cargar viajes en esta obra.</div></div>';
    if (EDIT) h += '<div class="tr-info tr-edit">Estás corrigiendo una carga ya guardada. Las fotos no se cambian desde acá.</div>';
    h += '<div class="tr-row"><div class="tr-f"><label>Fecha <span class="tr-req">*</span></label><input type="date" id="trFecha" value="' + esc(f.fecha) + '" max="' + hoy() + '"></div>' +
      '<div class="tr-f"><label>Distancia (km)</label><input id="trDist" inputmode="decimal" value="' + esc(fin(f.distancia_km)) + '" placeholder="0,0"></div></div>';
    h += '<div class="tr-f"><span class="tr-lab">Tipo de actividad <span class="tr-req">*</span></span><div class="tr-seg">' +
      ACTIVIDADES.map(function (a) { return '<button type="button" data-act="' + esc(a) + '" class="' + (a === f.tipo_actividad ? 'on' : '') + '">' + esc(a) + '</button>'; }).join('') + '</div></div>';
    h += '<div class="tr-f"><label>Obra / centro de costo <span class="tr-req">*</span></label><select id="trCC">' + optsCC(f.codigo_cc) + '</select>' +
      (f.codigo_cc === '__otro' ? '<input id="trCCotro" placeholder="Código del centro de costo (ej. 2240100002)" value="' + esc(f.cc_otro) + '">' : '') + '</div>';
    h += '<div class="tr-f"><label>Tipo de material <span class="tr-req">*</span></label><select id="trMat">' + opts(MATERIALES, f.tipo_material, '— elegí —') + '</select></div>';
    h += '<div class="tr-row"><div class="tr-f"><label>Origen</label><select id="trOri">' + opts(ORIGENES, f.origen, '—') + '</select></div>' +
      '<div class="tr-f"><label>Destino</label><select id="trDes">' + opts(DESTINOS, f.destino, '—') + '</select></div></div>';
    if (cp) {
      h += '<div class="tr-row3">' +
        (/pista|progresiva/i.test(f.origen) ? '<div class="tr-f"><label>Prog. origen</label><input id="trPo" value="' + esc(f.prog_origen) + '" placeholder="25+350"></div>' : '') +
        '<div class="tr-f"><label>Prog. inicio</label><input id="trPi" value="' + esc(f.prog_ini) + '" placeholder="25+100"></div>' +
        '<div class="tr-f"><label>Prog. final</label><input id="trPf" value="' + esc(f.prog_fin) + '" placeholder="25+300"></div></div>';
    }
    if (esEmulsion(f.tipo_material)) {
      h += '<div class="tr-row"><div class="tr-f"><label>Litros inicial</label><input id="trLi" inputmode="decimal" value="' + esc(fin(f.litros_ini)) + '"></div>' +
        '<div class="tr-f"><label>Litros final</label><input id="trLf" inputmode="decimal" value="' + esc(fin(f.litros_fin)) + '"></div></div>' +
        '<div class="tr-row"><div class="tr-f"><label>Litros usados</label><input id="trLu" inputmode="decimal" value="' + esc(fin(f.litros_usados)) + '" placeholder="inicial − final"></div>' +
        '<div class="tr-f"><label>M² pista</label><input id="trM2" inputmode="decimal" value="' + esc(fin(f.m2_pista)) + '"></div></div>' +
        (n(f.litros_usados) && n(f.m2_pista) ? '<div class="tr-info">Tasa de riego: <b>' + fq(n(f.litros_usados) / n(f.m2_pista)) + ' l/m²</b></div>' : '');
    }
    if (esHormigon(f.tipo_material)) {
      h += '<div class="tr-f"><label>M³ hormigón</label><input id="trM3" inputmode="decimal" value="' + esc(fin(f.m3_hormigon)) + '"></div>';
    }
    var tv = f.viajes.reduce(function (s, v) { return s + n(v.viajes); }, 0), tt = f.viajes.reduce(function (s, v) { return s + n(v.toneladas); }, 0);
    h += '<div class="tr-f"><span class="tr-lab">Volquetes</span><div class="tr-vq"><div class="tr-vq-h"><span>Chapa / código</span><span style="text-align:right">Viajes</span><span style="text-align:right">Toneladas (total)</span><span></span></div>' +
      f.viajes.map(function (v, k) {
        return '<div class="tr-vq-r"><input data-vq="' + k + '" data-f="chapa" value="' + esc(v.chapa) + '" placeholder="ABC-123" list="trChapas" autocapitalize="characters"' + (chapaOk(v.chapa) ? '' : ' class="mal"') + '>' +
          '<input class="n" data-vq="' + k + '" data-f="viajes" inputmode="decimal" value="' + esc(fin(v.viajes)) + '">' +
          '<input class="n" data-vq="' + k + '" data-f="toneladas" inputmode="decimal" value="' + esc(fin(v.toneladas)) + '">' +
          '<button type="button" class="tr-x" data-vqdel="' + k + '" title="Quitar">×</button>' + hintChapa(v.chapa) + '</div>';
      }).join('') +
      '<datalist id="trChapas">' + chapasConocidas().map(function (c) { return '<option value="' + esc(c.v) + '"' + (c.l ? ' label="' + esc(c.l) + '"' : '') + '>'; }).join('') + '</datalist>' +
      '<button type="button" class="tr-btn" id="trVqAdd" style="width:100%">＋ Camión</button>' +
      '<div class="tr-vq-tot"><span>' + f.viajes.filter(function (v) { return v.chapa; }).length + ' camión(es)</span><span><b>' + fq(tv) + '</b> viajes · <b>' + fq(tt) + '</b> t</span></div></div></div>';
    h += '<div class="tr-f"><label>Observaciones</label><textarea id="trObs" rows="2">' + esc(f.observaciones) + '</textarea></div>';
    if (!EDIT) {
      h += '<div class="tr-f"><span class="tr-lab">Foto de la planilla de carga ' + (cp ? '<span class="tr-req">* obligatoria en carga en pista</span>' : '(opcional)') + '</span>' +
        '<label class="tr-btn tr-foto-btn" style="width:100%;justify-content:center;box-sizing:border-box">📷 Sacar / elegir foto<input type="file" id="trFoto" accept="image/*" capture="environment" multiple hidden></label>' +
        '<div class="tr-fotos">' + f.fotos.map(function (p, k) { return '<div class="th"><img src="' + p.dataUrl + '" data-lb="' + p.dataUrl + '"><button type="button" data-fdel="' + k + '">✕</button></div>'; }).join('') + '</div></div>';
    } else if ((f.fotosGuardadas || []).length) {
      h += '<div class="tr-f"><span class="tr-lab">Fotos</span><div class="tr-fotos">' + f.fotosGuardadas.map(function (u) { return '<div class="th"><img src="' + esc(u) + '" data-lb="' + esc(u) + '" loading="lazy"></div>'; }).join('') + '</div></div>';
    }
    if (esEditor()) {
      h += '<div class="tr-f"><label>Encargado de recepción</label><input id="trEnc" value="' + esc(f.encargado) + '" placeholder="vacío = vos (' + esc(yoSoy() || '') + ')" list="trEncs">' +
        '<datalist id="trEncs">' + encargados().map(function (e) { return '<option value="' + esc(e) + '">'; }).join('') + '</datalist></div>';
    } else {
      h += '<div class="tr-info">Encargado de recepción: <b>' + esc(EDIT ? f.encargado : (yoSoy() || 'vos')) + '</b></div>';
    }
    h += '<div style="display:flex;gap:8px">' + (EDIT ? '<button class="tr-btn" id="trCancelar">Cancelar</button>' : '') +
      '<button class="tr-btn pri big" id="trGuardar">' + (EDIT ? 'Guardar corrección' : 'Guardar carga') + '</button></div></div>';
    return h;
  }
  function encargados() {
    var c = {}; (D.cargas || []).slice(0, 800).forEach(function (x) { if (x.encargado) c[x.encargado] = 1; });
    return Object.keys(c).sort();
  }

  // ------------------------------------------------------------ lista
  function filtradas() {
    var t = FIL.txt.trim().toLowerCase();
    return (D.cargas || []).filter(function (c) {
      if (FIL.desde && c.fecha < FIL.desde) return false;
      if (FIL.hasta && c.fecha > FIL.hasta) return false;
      if (FIL.act && c.tipo_actividad !== FIL.act) return false;
      if (FIL.mat && c.tipo_material !== FIL.mat) return false;
      if (t) {
        var s = [c.encargado, c.origen, c.destino, c.prog_ini, c.prog_fin, c.observaciones, ccTxt(c)].concat((c.viajes || []).map(function (v) { return v.chapa; })).join(' ').toLowerCase();
        if (s.indexOf(t) < 0) return false;
      }
      return true;
    });
  }
  function htmlLista() {
    var L = filtradas();
    var mats = {}; (D.cargas || []).forEach(function (c) { if (c.tipo_material) mats[c.tipo_material] = 1; });
    var tv = 0, tt = 0, tkm = 0, cam = 0;
    L.forEach(function (c) { var t = totTon(c); tv += totViajes(c); tt += t; cam += (c.viajes || []).length; tkm += t * n(c.distancia_km); });
    var h = '<div class="tr-card"><h2>Cargas <small>' + L.length + ' de ' + (D.cargas || []).length + '</small></h2>' +
      '<div class="tr-bar"><input type="date" id="trFd" value="' + esc(FIL.desde) + '" title="Desde"><input type="date" id="trFh" value="' + esc(FIL.hasta) + '" title="Hasta">' +
      '<select id="trFa"><option value="">Toda actividad</option>' + ACTIVIDADES.map(function (a) { return '<option' + (a === FIL.act ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select>' +
      '<select id="trFm"><option value="">Todo material</option>' + Object.keys(mats).sort().map(function (m) { return '<option' + (m === FIL.mat ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' +
      '<input type="search" id="trFt" placeholder="Chapa, encargado, progresiva…" value="' + esc(FIL.txt) + '">' +
      '<span class="grow"></span><button class="tr-btn" id="trXls">⬇ Excel</button></div>' +
      '<div class="tr-kpis"><div class="tr-kpi"><span>Viajes</span><b>' + fq(tv) + '</b></div><div class="tr-kpi"><span>Toneladas</span><b>' + fq(tt) + '</b></div>' +
      '<div class="tr-kpi"><span>Camiones (filas)</span><b>' + fq(cam) + '</b></div><div class="tr-kpi" title="Toneladas × distancia"><span>t·km</span><b>' + fq(tkm) + '</b></div></div>';
    if (!L.length) return h + '<div class="tr-vacio">No hay cargas con esos filtros.</div></div>';
    var MAXF = 400, vis = L.slice(0, MAXF);
    h += '<div class="tr-tw"><table class="tr-t"><thead><tr><th>Fecha</th><th>Actividad</th><th>Material</th><th>Centro de costo</th><th>Origen → destino</th><th>Progresivas</th>' +
      '<th style="text-align:right">km</th><th>Camiones</th><th style="text-align:right">Viajes</th><th style="text-align:right">t</th><th>Encargado</th><th>Foto</th><th></th></tr></thead><tbody>';
    vis.forEach(function (c) {
      var extra = [];
      if (c.m3_hormigon) extra.push(fq(c.m3_hormigon) + ' m³');
      if (c.litros_usados) extra.push(fq(c.litros_usados) + ' l / ' + fq(c.m2_pista) + ' m²');
      h += '<tr' + (EDIT === c.id ? ' class="sel"' : '') + '><td>' + fd(c.fecha) + '</td><td>' + esc(c.tipo_actividad) + '</td><td>' + esc(c.tipo_material) + (extra.length ? '<br><small>' + esc(extra.join(' · ')) + '</small>' : '') + '</td>' +
        '<td><small>' + esc(ccTxt(c)) + '</small></td><td>' + esc(c.origen) + (c.destino ? ' → ' + esc(c.destino) : '') + '</td>' +
        '<td>' + esc([c.prog_ini, c.prog_fin].filter(Boolean).join(' – ')) + (c.prog_origen ? '<br><small>origen ' + esc(c.prog_origen) + '</small>' : '') + '</td>' +
        '<td class="r">' + fq(c.distancia_km) + '</td><td>' + (c.viajes || []).map(function (v) { return '<span class="tr-chip">' + esc(v.chapa || '?') + ' ×' + fq(v.viajes) + (v.toneladas ? ' · ' + fq(v.toneladas) + ' t' : '') + '</span>'; }).join(' ') + '</td>' +
        '<td class="r">' + fq(totViajes(c)) + '</td><td class="r">' + fq(totTon(c)) + '</td>' +
        '<td>' + esc(c.encargado) + (c.origen_dato === 'jotform' ? ' <span class="tr-chip jf" title="Importada de Jotform">JF</span>' : '') + '</td>' +
        '<td>' + (c.fotos || []).map(function (u, i) { return /jotform\.com/.test(u) ? '<a href="#" data-visor-url="' + esc(u) + '" data-visor-nombre="Planilla ' + esc(fd(c.fecha)) + '" data-visor-mime="image/jpeg" title="Ver la foto (Jotform)">📷' + (c.fotos.length > 1 ? i + 1 : '') + '</a>' : '<img src="' + esc(u) + '" data-lb="' + esc(u) + '" style="width:34px;height:34px;object-fit:cover;border-radius:4px;cursor:pointer" loading="lazy">'; }).join(' ') + '</td>' +
        '<td style="white-space:nowrap">' + (puedeTocar(c) ? '<button class="tr-mini" data-ed="' + esc(c.id) + '">✎</button> <button class="tr-mini del" data-del="' + esc(c.id) + '">🗑</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (L.length > MAXF) h += '<div class="tr-info" style="margin-top:8px">Se muestran las ' + MAXF + ' más recientes; el Excel trae las ' + L.length + '.</div>';
    // celular: tarjetas
    h += '<div class="tr-cards">' + L.slice(0, 120).map(function (c) {
      return '<div class="tr-c"><div class="l1"><span>' + fd(c.fecha) + ' · ' + esc(c.tipo_actividad) + '</span><span>' + (c.fotos || []).map(function (u, i) { return '<a href="#" data-visor-url="' + esc(u) + '" data-visor-nombre="Planilla ' + esc(fd(c.fecha)) + '" data-visor-mime="image/jpeg" style="text-decoration:none">📷' + (c.fotos.length > 1 ? i + 1 : '') + '</a>'; }).join(' ') + '</span></div>' +
        '<div class="l2">' + esc(c.tipo_material) + '</div><div class="l3">' + esc(ccTxt(c)) + '</div>' +
        '<div class="l3">' + esc(c.origen) + (c.destino ? ' → ' + esc(c.destino) : '') + (c.distancia_km != null ? ' · ' + fq(c.distancia_km) + ' km' : '') +
        (c.prog_ini || c.prog_fin ? ' · ' + esc([c.prog_ini, c.prog_fin].filter(Boolean).join('–')) : '') + '</div>' +
        '<div class="l3">' + (c.viajes || []).map(function (v) { return esc(v.chapa || '?') + ' ×' + fq(v.viajes); }).join(', ') + '</div>' +
        '<div class="l4"><span><b>' + fq(totViajes(c)) + '</b> viajes · <b>' + fq(totTon(c)) + '</b> t</span><span>' +
        (puedeTocar(c) ? '<button class="tr-mini" data-ed="' + esc(c.id) + '">✎</button> <button class="tr-mini del" data-del="' + esc(c.id) + '">🗑</button>' : '<small>' + esc(c.encargado) + '</small>') + '</span></div></div>';
    }).join('') + (L.length > 120 ? '<div class="tr-info">Se muestran las 120 más recientes.</div>' : '') + '</div>';
    return h + '</div>';
  }

  // ------------------------------------------------------------ STOCK
  /* Movimientos que salen de las cargas (misma regla que la vista SQL
     v_transporte_stock_mov):
       entrada: el destino es un depósito y el origen es otro lugar
       salida : el origen es un depósito y el destino es otro lugar
     Origen = destino = mismo depósito: movimiento interno (no cambia nada).
     Toneladas = las de la planilla (total de la fila); los viajes sin
     toneladas se cuentan aparte para que se vea qué falta pesar.          */
  function movimientos() {
    var out = [];
    (D.cargas || []).forEach(function (c) {
      var esDepD = DEPOSITOS.indexOf(c.destino) >= 0, esDepO = DEPOSITOS.indexOf(c.origen) >= 0;
      if (!esDepD && !esDepO) return;
      if (c.origen === c.destino) return;
      var t = totTon(c), vj = totViajes(c);
      var vSin = (c.viajes || []).reduce(function (s2, v) { return s2 + (n(v.toneladas) ? 0 : n(v.viajes)); }, 0);
      if (esDepD) out.push({ c: c, dep: c.destino, mat: c.tipo_material, fecha: c.fecha, t: t, vj: vj, vSin: vSin, tipo: 'entrada' });
      if (esDepO) out.push({ c: c, dep: c.origen, mat: c.tipo_material, fecha: c.fecha, t: -t, vj: vj, vSin: vSin, tipo: 'salida' });
    });
    return out;
  }
  // stock por depósito y material a la fecha de corte (incluida)
  function stockA(corte) {
    var R = {};
    function fila(dep, mat) {
      var k = dep + '|' + mat;
      return R[k] || (R[k] = { dep: dep, mat: mat, conteo: null, ent: 0, sal: 0, vEnt: 0, vSal: 0, vSin: 0, ult: '' });
    }
    (D.conteos || []).forEach(function (q) {
      if (corte && q.fecha > corte) return;
      var f = fila(q.deposito, q.material);
      if (!f.conteo || q.fecha > f.conteo.fecha || (q.fecha === f.conteo.fecha && String(q.cargado_en) > String(f.conteo.cargado_en))) f.conteo = q;
    });
    movimientos().forEach(function (m) {
      if (corte && m.fecha > corte) return;
      var f = fila(m.dep, m.mat);
      if (m.fecha > f.ult) f.ult = m.fecha;
      f._movs = f._movs || []; f._movs.push(m);
    });
    Object.keys(R).forEach(function (k) {
      var f = R[k], desde = f.conteo ? f.conteo.fecha : '';
      (f._movs || []).forEach(function (m) {
        if (desde && m.fecha <= desde) return;          // el conteo ya incluye lo de ese día
        if (m.t >= 0 && m.tipo === 'entrada') { f.ent += m.t; f.vEnt += m.vj; } else { f.sal += -m.t; f.vSal += m.vj; }
        f.vSin += m.vSin;
      });
      f.saldo = (f.conteo ? n(f.conteo.toneladas) : 0) + f.ent - f.sal;
      delete f._movs;
    });
    return Object.keys(R).map(function (k) { return R[k]; });
  }
  function materialesStock() {
    var m = {}; MATERIALES.forEach(function (x) { m[x] = 1; });
    (D.cargas || []).forEach(function (c) { if (c.tipo_material) m[c.tipo_material] = 1; });
    (D.conteos || []).forEach(function (c) { m[c.material] = 1; });
    return Object.keys(m).sort();
  }
  function htmlStock() {
    var corte = STK.corte || hoy();
    var filas = stockA(corte);
    var h = '<div class="tr-card"><h2>📦 Stock de materiales <small>' + esc(D.obraNombre || '') + '</small></h2>';
    if (D.sinStock) h += '<div class="tr-info tr-edit">Falta correr en Supabase el SQL <b>21_transporte_stock_camiones.sql</b>: el stock se calcula con las cargas, pero todavía no se pueden guardar ajustes.</div>';
    h += '<div class="tr-bar"><label style="font-size:12px;font-weight:700;color:#4a5568">Stock al</label><input type="date" id="trStCorte" value="' + esc(corte) + '" max="' + hoy() + '">' +
      '<span class="grow"></span>' + (esEditor() && !D.sinStock ? '<button class="tr-btn pri" id="trStNuevo">＋ Ajustar stock (conteo)</button>' : '') + '</div>' +
      '<div class="tr-info">Entra lo que se descarga en un depósito (destino Campamento, Cantera o Acopio Intermedio) y sale lo que se carga desde él (origen). ' +
      'Para que el número tenga sentido en obras ya en curso, cargá un <b>conteo</b>: «tal día había T toneladas»; desde ese día en adelante siguen sumando y restando los viajes.</div>';
    var hay = false;
    DEPOSITOS.forEach(function (dep) {
      var fs = filas.filter(function (f) { return f.dep === dep; }).sort(function (a, b) { return a.mat.localeCompare(b.mat); });
      if (!fs.length) return;
      hay = true;
      var tot = fs.reduce(function (s2, f) { return s2 + f.saldo; }, 0);
      h += '<div class="tr-dep"><h3>' + esc(dep) + ' <small style="font-weight:400;color:#4a5568">· ' + fq(tot) + ' t en total</small></h3><div class="tr-stw"><table class="tr-st"><thead><tr>' +
        '<th>Material</th><th>Último conteo</th><th class="r">Entradas (t)</th><th class="r">Salidas (t)</th><th class="r">Stock (t)</th><th class="r">Viajes sin t</th><th>Último mov.</th><th></th></tr></thead><tbody>' +
        fs.map(function (f) {
          return '<tr><td><b>' + esc(f.mat || '(sin material)') + '</b></td>' +
            '<td>' + (f.conteo ? fq(f.conteo.toneladas) + ' t <small>al ' + fd(f.conteo.fecha) + '</small>' : '<small>—</small>') + '</td>' +
            '<td class="r" title="' + fq(f.vEnt) + ' viajes">' + fq(f.ent) + '</td><td class="r" title="' + fq(f.vSal) + ' viajes">' + fq(f.sal) + '</td>' +
            '<td class="r big' + (f.saldo < 0 ? ' neg' : '') + '">' + fq(f.saldo) + '</td>' +
            '<td class="r"' + (f.vSin ? ' style="color:#b7791f;font-weight:700" title="Viajes sin toneladas cargadas: no suman al stock"' : '') + '>' + (f.vSin ? fq(f.vSin) : '–') + '</td>' +
            '<td>' + (f.ult ? fd(f.ult) : '–') + '</td>' +
            '<td>' + (esEditor() && !D.sinStock ? '<button class="tr-mini" data-staj="' + esc(f.dep + '|' + f.mat) + '" data-stsal="' + f.saldo + '">Ajustar</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    });
    if (!hay) h += '<div class="tr-vacio">Todavía no hay movimientos hacia o desde Campamento, Cantera o Acopio Intermedio en esta obra.</div>';
    var cs = (D.conteos || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    if (cs.length) {
      h += '<h3 style="font-size:14px;color:#1a2744;margin:14px 0 6px">Conteos / ajustes cargados</h3><div class="tr-stw"><table class="tr-st"><thead><tr><th>Fecha</th><th>Depósito</th><th>Material</th><th class="r">Toneladas</th><th>Motivo</th><th>Cargado por</th><th></th></tr></thead><tbody>' +
        cs.map(function (q) {
          return '<tr><td>' + fd(q.fecha) + '</td><td>' + esc(q.deposito) + '</td><td>' + esc(q.material) + '</td><td class="r">' + fq(q.toneladas) + '</td><td>' + esc(q.motivo) + '</td><td><small>' + esc(q.cargado_por) + '</small></td>' +
            '<td style="white-space:nowrap">' + (esEditor() ? '<button class="tr-mini" data-sted="' + esc(q.conteo_id) + '">✎</button> <button class="tr-mini del" data-stdel="' + esc(q.conteo_id) + '">🗑</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return h + '</div>';
  }
  function htmlModal() {
    if (MODO === 'stock' && STK.ajuste) {
      var a = STK.ajuste;
      var ref = stockA(a.fecha || hoy()).filter(function (f) { return f.dep === a.deposito && f.mat === a.material; })[0];
      return '<div class="tr-modal" id="trModal"><div class="box"><h3>' + (a.conteo_id ? '✎ Corregir conteo' : 'Ajustar stock (conteo)') + '</h3>' +
        '<div class="tr-row"><div class="tr-f"><label>Depósito</label><select id="trAjDep">' + opts(DEPOSITOS, a.deposito, '— elegí —') + '</select></div>' +
        '<div class="tr-f"><label>Fecha del conteo</label><input type="date" id="trAjFecha" value="' + esc(a.fecha || hoy()) + '" max="' + hoy() + '"></div></div>' +
        '<div class="tr-f"><label>Material</label><select id="trAjMat">' + opts(materialesStock(), a.material, '— elegí —') + '</select></div>' +
        '<div class="tr-f"><label>Stock real a esa fecha (toneladas)</label><input id="trAjTon" inputmode="decimal" value="' + esc(fin(a.toneladas)) + '" placeholder="0,0"></div>' +
        (ref ? '<div class="tr-info">Según los viajes y conteos anteriores, el stock al ' + fd(a.fecha || hoy()) + ' sería <b>' + fq(ref.saldo) + ' t</b>.</div>' : '') +
        '<div class="tr-f"><label>Motivo / observación</label><input id="trAjMot" value="' + esc(a.motivo || '') + '" placeholder="ej. stock inicial, medición topográfica, inventario"></div>' +
        '<div class="tr-info">El valor que cargues REEMPLAZA al calculado a esa fecha. Los viajes posteriores siguen sumando y restando.</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="tr-btn" id="trAjNo">Cancelar</button><button class="tr-btn pri" id="trAjSi">Guardar conteo</button></div></div></div>';
    }
    if (MODO === 'camiones' && CAM.ed) {
      var c = CAM.ed, ro = !esAdmin();
      var campo = function (id, lab, v, ph) { return '<div class="tr-f"><label>' + lab + '</label><input id="' + id + '" value="' + esc(v || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (ro ? ' disabled' : '') + '></div>'; };
      return '<div class="tr-modal" id="trModal"><div class="box"><h3>' + (c.chapa_anterior ? (ro ? 'Camión ' : '✎ Camión ') + esc(c.chapa_anterior) : '＋ Camión nuevo') + '</h3>' +
        '<div class="tr-row">' + campo('trCmCh', 'Chapa / código *', c.chapa, 'ABC-123') + campo('trCmTipo', 'Tipo', c.tipo || 'CAMION VOLQUETE') + '</div>' +
        '<div class="tr-row">' + campo('trCmDesc', 'Descripción', c.descripcion, 'doble eje, triple eje…') + campo('trCmMarca', 'Marca / modelo', [c.marca, c.modelo].filter(Boolean).join(' · ')) + '</div>' +
        campo('trCmProv', 'Proveedor (fletero)', c.proveedor) +
        '<div class="tr-row">' + campo('trCmRuc', 'RUC', c.ruc) + campo('trCmChasis', 'N° chasis', c.chasis) + '</div>' +
        '<div class="tr-row">' + campo('trCmChof', 'Chofer', c.chofer) + campo('trCmTel', 'Teléfono', c.telefono) + '</div>' +
        campo('trCmCont', 'Contacto', c.contacto) + campo('trCmObs', 'Observaciones', c.observaciones) +
        '<div class="tr-row"><label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" id="trCmProp"' + (c.propio ? ' checked' : '') + (ro ? ' disabled' : '') + '> Flota propia</label>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" id="trCmAct"' + (c.activo !== false ? ' checked' : '') + (ro ? ' disabled' : '') + '> Activo (se acepta al cargar)</label></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="tr-btn" id="trCmNo">' + (ro ? 'Cerrar' : 'Cancelar') + '</button>' + (ro ? '' : '<button class="tr-btn pri" id="trCmSi">Guardar</button>') + '</div></div></div>';
    }
    return '';
  }
  // ------------------------------------------------------------ CAMIONES
  function htmlCamiones() {
    var t = CAM.txt.trim().toLowerCase();
    var uso = {}; (D.cargas || []).forEach(function (c) { (c.viajes || []).forEach(function (v) { var k = chapaKey(v.chapa); if (k) { uso[k] = uso[k] || { n: 0, ult: '', ch: v.chapa }; uso[k].n += n(v.viajes); if (c.fecha > uso[k].ult) uso[k].ult = c.fecha; } }); });
    var L = (D.camiones || []).filter(function (c) {
      if (!CAM.inact && !c.activo) return false;
      return !t || [c.chapa, c.proveedor, c.chofer, c.ruc, c.descripcion].join(' ').toLowerCase().indexOf(t) >= 0;
    });
    var h = '<div class="tr-card"><h2>🚚 Maestro de camiones <small>' + (D.camiones || []).filter(function (c) { return c.activo; }).length + ' activos · común a todas las obras</small></h2>';
    if (D.sinMaestro) h += '<div class="tr-info tr-edit">Falta correr en Supabase <b>21_transporte_stock_camiones.sql</b> y <b>21b_camiones_datos.sql</b>. Mientras tanto no se validan las chapas.</div>';
    h += '<div class="tr-bar"><input type="search" id="trCmBusca" placeholder="Chapa, proveedor, chofer, RUC…" value="' + esc(CAM.txt) + '">' +
      '<label style="font-size:13px;display:flex;gap:5px;align-items:center"><input type="checkbox" id="trCmInact"' + (CAM.inact ? ' checked' : '') + '> ver inactivos</label>' +
      '<span class="grow"></span>' + (esAdmin() && !D.sinMaestro ? '<button class="tr-btn pri" id="trCmNuevo">＋ Camión</button>' : '') + '</div>';
    if (!esAdmin()) h += '<div class="tr-info">Solo el administrador central agrega o corrige camiones. Si falta una chapa, pedísela.</div>';
    // chapas usadas en esta obra que no están en el maestro (para completarlo)
    var m = maestro(), faltan = Object.keys(uso).filter(function (k) { return !m[k] && uso[k].ult >= haceDias(120); });
    if (faltan.length && hayMaestro()) h += '<div class="tr-info tr-edit">Chapas usadas en esta obra (últimos 4 meses) que no están en el maestro: <b>' + faltan.map(function (k) { return esc(uso[k].ch); }).join(', ') + '</b>.</div>';
    h += '<div class="tr-stw"><table class="tr-st"><thead><tr><th>Chapa</th><th>Proveedor</th><th>Chofer</th><th>Teléfono</th><th>Tipo</th><th class="r">Viajes en la obra</th><th>Último</th><th></th></tr></thead><tbody>' +
      L.map(function (c) {
        var u = uso[c.chapa_key || chapaKey(c.chapa)] || { n: 0, ult: '' };
        return '<tr' + (c.activo ? '' : ' class="tr-off"') + '><td><b>' + esc(c.chapa) + '</b>' + (c.propio ? ' <span class="tr-chip">propio</span>' : '') + (c.activo ? '' : ' <small>inactivo</small>') + '</td>' +
          '<td>' + esc(c.proveedor) + (c.ruc ? '<br><small>RUC ' + esc(c.ruc) + '</small>' : '') + '</td><td>' + esc(c.chofer) + '</td><td>' + esc(c.telefono) + '</td>' +
          '<td><small>' + esc([c.descripcion, c.marca, c.modelo].filter(Boolean).join(' · ')) + '</small></td>' +
          '<td class="r">' + (u.n ? fq(u.n) : '–') + '</td><td>' + (u.ult ? fd(u.ult) : '–') + '</td>' +
          '<td><button class="tr-mini" data-cmed="' + esc(c.chapa) + '">' + (esAdmin() ? '✎' : 'Ver') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    if (!L.length) h += '<div class="tr-vacio">Sin camiones con ese filtro.</div>';
    return h + '</div>';
  }

  function enlazarPaneles() {
    var e;
    if ((e = $('#trStCorte'))) e.onchange = function () { STK.corte = this.value; render(); };
    if ((e = $('#trStNuevo'))) e.onclick = function () { STK.ajuste = { deposito: '', material: '', fecha: hoy(), toneladas: null, motivo: '' }; render(); };
    $$('[data-staj]').forEach(function (b) {
      b.onclick = function () {
        var p = b.getAttribute('data-staj').split('|');
        STK.ajuste = { deposito: p[0], material: p.slice(1).join('|'), fecha: hoy(), toneladas: null, motivo: '' }; render();
      };
    });
    $$('[data-sted]').forEach(function (b) {
      b.onclick = function () {
        var q = (D.conteos || []).filter(function (x) { return x.conteo_id === b.getAttribute('data-sted'); })[0]; if (!q) return;
        STK.ajuste = { conteo_id: q.conteo_id, deposito: q.deposito, material: q.material, fecha: q.fecha, toneladas: q.toneladas, motivo: q.motivo }; render();
      };
    });
    $$('[data-stdel]').forEach(function (b) {
      b.onclick = async function () {
        var q = (D.conteos || []).filter(function (x) { return x.conteo_id === b.getAttribute('data-stdel'); })[0]; if (!q) return;
        if (!confirm('¿Borrar el conteo del ' + fd(q.fecha) + ' (' + q.deposito + ' · ' + q.material + ' · ' + fq(q.toneladas) + ' t)?')) return;
        try { await global.ObraAPI.stockConteoBorrar(q.conteo_id, oid()); toast('Conteo borrado'); await cargar(); } catch (err) { alert(err.message || String(err)); }
      };
    });
    var leerAj = function () {
      var a = STK.ajuste; if (!a) return;
      a.deposito = $('#trAjDep').value; a.material = $('#trAjMat').value; a.fecha = $('#trAjFecha').value;
      a.toneladas = parseNum($('#trAjTon').value); a.motivo = $('#trAjMot').value.trim();
    };
    ['#trAjDep', '#trAjMat', '#trAjFecha'].forEach(function (id) { if ((e = $(id))) e.onchange = function () { leerAj(); render(); }; });
    if ((e = $('#trAjNo'))) e.onclick = function () { STK.ajuste = null; render(); };
    if ((e = $('#trAjSi'))) e.onclick = async function () {
      leerAj(); var a = STK.ajuste;
      if (!a.deposito || !a.material || !a.fecha) { alert('Completá depósito, material y fecha.'); return; }
      if (a.toneladas === null || !$('#trAjTon').value.trim()) { alert('Cargá las toneladas contadas (puede ser 0).'); return; }
      if (a.fecha > hoy()) { alert('La fecha no puede ser futura.'); return; }
      var bt = $('#trAjSi'); bt.disabled = true; bt.textContent = 'Guardando…';
      try { await global.ObraAPI.stockConteoGuardar(a, oid()); STK.ajuste = null; toast('Stock ajustado'); await cargar(); }
      catch (err) { alert(err.message || String(err)); bt.disabled = false; bt.textContent = 'Guardar conteo'; }
    };
    // camiones
    if ((e = $('#trCmBusca'))) e.oninput = function () { CAM.txt = this.value; render(); var x = $('#trCmBusca'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } };
    if ((e = $('#trCmInact'))) e.onchange = function () { CAM.inact = this.checked; render(); };
    if ((e = $('#trCmNuevo'))) e.onclick = function () { CAM.ed = { activo: true, tipo: 'CAMION VOLQUETE' }; render(); };
    $$('[data-cmed]').forEach(function (b) {
      b.onclick = function () {
        var c = (D.camiones || []).filter(function (x) { return x.chapa === b.getAttribute('data-cmed'); })[0]; if (!c) return;
        CAM.ed = Object.assign({}, c, { chapa_anterior: c.chapa }); render();
      };
    });
    if ((e = $('#trCmNo'))) e.onclick = function () { CAM.ed = null; render(); };
    if ((e = $('#trCmSi'))) e.onclick = async function () {
      var g = function (id) { return ($('#' + id).value || '').trim(); };
      var mm = g('trCmMarca').split('·');
      var c = { chapa: g('trCmCh').toUpperCase(), chapa_anterior: CAM.ed.chapa_anterior || '', tipo: g('trCmTipo').toUpperCase(), descripcion: g('trCmDesc'),
        marca: (mm[0] || '').trim(), modelo: mm.slice(1).join('·').trim(), proveedor: g('trCmProv'), ruc: g('trCmRuc'), chasis: g('trCmChasis'),
        chofer: g('trCmChof'), telefono: g('trCmTel'), contacto: g('trCmCont'), observaciones: g('trCmObs'),
        propio: $('#trCmProp').checked, activo: $('#trCmAct').checked };
      if (!chapaKey(c.chapa)) { alert('Falta la chapa.'); return; }
      var bt = $('#trCmSi'); bt.disabled = true; bt.textContent = 'Guardando…';
      try { await global.ObraAPI.trCamionGuardar(c); CAM.ed = null; toast('Camión ' + esc(c.chapa) + ' guardado'); await cargar(); }
      catch (err) { alert(err.message || String(err)); bt.disabled = false; bt.textContent = 'Guardar'; }
    };
  }

  // ------------------------------------------------------------ render
  function render() {
    var v = $('#v-transporte'); if (!v) return;
    estilos();
    if (!D) { v.innerHTML = '<div class="tr-vacio">Cargando transporte…</div>'; return; }
    if (!F) F = nuevoForm();
    var y = v.scrollTop;
    if ((MODO === 'camiones' && !esAdmin() && !esEditor()) || (MODO === 'lista' && !esMovil())) MODO = 'cargar';
    var tabs = '<div class="tr-tabs"><button data-modo="cargar" class="' + (MODO === 'cargar' ? 'on' : '') + '">' + (esMovil() ? (EDIT ? '✎ Corregir' : '＋ Cargar') : 'Cargas') + '</button>' +
      '<button data-modo="lista" class="' + (MODO === 'lista' ? 'on' : '') + '">Cargas (' + (D.cargas || []).length + ')</button>' +
      '<button data-modo="stock" class="' + (MODO === 'stock' ? 'on' : '') + '">📦 Stock</button>' +
      (esAdmin() || esEditor() ? '<button data-modo="camiones" class="' + (MODO === 'camiones' ? 'on' : '') + '">🚚 Camiones</button>' : '') + '</div>';
    if (MODO === 'stock' || MODO === 'camiones') {
      v.innerHTML = '<div class="tr-wrap uno" data-modo="' + MODO + '">' + tabs + (MODO === 'stock' ? htmlStock() : htmlCamiones()) + '</div>' + htmlModal();
    } else {
      v.innerHTML = '<div class="tr-wrap" data-modo="' + MODO + '">' + tabs +
        '<div class="tr-col-form">' + htmlForm() + '</div><div class="tr-col-lista">' + htmlLista() + '</div></div>';
    }
    v.scrollTop = y;
    enlazar();
  }
  function renderLista() {
    var col = $('.tr-col-lista'); if (!col) return render();
    col.innerHTML = htmlLista(); enlazarLista();
  }

  function leerForm() {
    var g = function (id) { var e = $('#' + id); return e ? e.value : undefined; };
    var nums = { trDist: 'distancia_km', trLi: 'litros_ini', trLf: 'litros_fin', trLu: 'litros_usados', trM2: 'm2_pista', trM3: 'm3_hormigon' };
    var txts = { trFecha: 'fecha', trMat: 'tipo_material', trOri: 'origen', trDes: 'destino', trPo: 'prog_origen', trPi: 'prog_ini', trPf: 'prog_fin', trObs: 'observaciones', trEnc: 'encargado', trCCotro: 'cc_otro' };
    Object.keys(nums).forEach(function (id) { var v = g(id); if (v !== undefined) F[nums[id]] = parseNum(v); });
    Object.keys(txts).forEach(function (id) { var v = g(id); if (v !== undefined) F[txts[id]] = v.trim(); });
    var cc = g('trCC'); if (cc !== undefined) F.codigo_cc = cc;
  }

  function enlazar() {
    $$('.tr-tabs button').forEach(function (b) { b.onclick = function () { if ($('.tr-col-form')) leerForm(); MODO = b.getAttribute('data-modo'); render(); }; });
    if (MODO === 'stock' || MODO === 'camiones') { enlazarPaneles(); return; }
    var v = $('#v-transporte');
    // cambios que redibujan (campos condicionales)
    ['trMat', 'trOri', 'trCC'].forEach(function (id) { var e = $('#' + id); if (e) e.onchange = function () { leerForm(); render(); }; });
    $$('[data-act]').forEach(function (b) { b.onclick = function () { leerForm(); F.tipo_actividad = b.getAttribute('data-act'); render(); }; });
    ['trLi', 'trLf'].forEach(function (id) {
      var e = $('#' + id); if (e) e.onchange = function () {
        leerForm();
        if (F.litros_ini != null && F.litros_fin != null) F.litros_usados = F.litros_ini - F.litros_fin;
        render();
      };
    });
    ['trLu', 'trM2'].forEach(function (id) { var e = $('#' + id); if (e) e.onchange = function () { leerForm(); render(); }; });
    $$('[data-vq]').forEach(function (inp) {
      inp.onchange = function () {
        var k = +inp.getAttribute('data-vq'), f = inp.getAttribute('data-f');
        if (f === 'chapa') {
          var ch = inp.value.trim().toUpperCase(), mm = maestro()[chapaKey(ch)];
          F.viajes[k].chapa = mm ? mm.chapa : ch;      // se guarda tal como figura en el maestro
        }
        else {
          var x = parseNum(inp.value);
          if (inp.value.trim() && x === null) { alert('Número no válido'); inp.value = fin(F.viajes[k][f]); return; }
          F.viajes[k][f] = x;
        }
        leerForm(); render();
      };
    });
    $$('[data-vqdel]').forEach(function (b) { b.onclick = function () { leerForm(); F.viajes.splice(+b.getAttribute('data-vqdel'), 1); if (!F.viajes.length) F.viajes.push({ chapa: '', viajes: null, toneladas: null }); render(); }; });
    if ($('#trVqAdd')) $('#trVqAdd').onclick = function () {
      leerForm();
      F.viajes.push({ chapa: '', viajes: null, toneladas: null });
      render();
      var ins = $$('[data-f="chapa"]'); if (ins.length) ins[ins.length - 1].focus();
    };
    if ($('#trFoto')) $('#trFoto').onchange = function (e) { leerForm(); agregarFotos(e.target.files); e.target.value = ''; };
    $$('[data-fdel]').forEach(function (b) { b.onclick = function () { leerForm(); F.fotos.splice(+b.getAttribute('data-fdel'), 1); render(); }; });
    if ($('#trGuardar')) $('#trGuardar').onclick = guardar;
    if ($('#trCancelar')) $('#trCancelar').onclick = function () { EDIT = null; F = nuevoForm(); render(); };
    enlazarLista();
  }
  function enlazarLista() {
    var fl = function (id, k, ev) { var e = $('#' + id); if (e) e[ev || 'onchange'] = function () { FIL[k] = e.value; renderLista(); if (ev === 'oninput') { var e2 = $('#' + id); e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); } }; };
    fl('trFd', 'desde'); fl('trFh', 'hasta'); fl('trFa', 'act'); fl('trFm', 'mat'); fl('trFt', 'txt', 'oninput');
    if ($('#trXls')) $('#trXls').onclick = function () { excel().catch(function (e) { alert('No se pudo armar el Excel: ' + e.message); }); };
    $$('[data-ed]').forEach(function (b) { b.onclick = function () { editar(b.getAttribute('data-ed')); }; });
    $$('[data-del]').forEach(function (b) { b.onclick = function () { borrar(b.getAttribute('data-del')); }; });
  }

  function agregarFotos(files) {
    files = [].slice.call(files || []).filter(function (f) { return /^image\//i.test(f.type); });
    if (!files.length) return;
    if (F.fotos.length + files.length > MAX_FOTOS) { toast('Máximo ' + MAX_FOTOS + ' fotos por carga.'); files = files.slice(0, Math.max(0, MAX_FOTOS - F.fotos.length)); }
    if (!global.PhotoStore) { toast('No se pudo preparar la foto.'); return; }
    Promise.all(files.map(function (f) {
      return global.PhotoStore.compressImage(f, 1600, 0.72).then(function (r) { F.fotos.push(r); }).catch(function () {});
    })).then(render);
  }

  // ------------------------------------------------------------ guardar
  function validar() {
    if (!F.fecha) return 'Elegí la fecha.';
    if (F.fecha > hoy()) return 'La fecha no puede ser futura.';
    if (!F.tipo_actividad) return 'Elegí el tipo de actividad.';
    var cc = F.codigo_cc === '__otro' ? F.cc_otro : F.codigo_cc;
    if (!cc) return 'Elegí el centro de costo.';
    if (!F.tipo_material) return 'Elegí el tipo de material.';
    var vq = F.viajes.filter(function (v) { return v.chapa || v.viajes != null || v.toneladas != null; });
    if (!vq.length) return 'Cargá al menos un camión (chapa y viajes).';
    if (vq.some(function (v) { return !v.chapa; })) return 'Falta la chapa de algún camión.';
    if (vq.some(function (v) { return !(n(v.viajes) > 0); })) return 'Falta la cantidad de viajes de algún camión.';
    var malas = vq.filter(function (v) { return !chapaOk(v.chapa); }).map(function (v) { return v.chapa; });
    if (malas.length) return 'Chapa(s) que no están en el maestro de camiones: ' + malas.join(', ') + '.\nNo se acepta una chapa fuera de la lista: pedile al administrador central que la agregue.';
    if (!EDIT && esCargaPista(F.tipo_actividad) && !F.fotos.length) return 'En carga en pista la foto de la planilla es obligatoria.';
    return '';
  }
  function payload() {
    var cc = F.codigo_cc === '__otro' ? F.cc_otro.replace(/\s/g, '') : F.codigo_cc;
    return {
      fecha: F.fecha, tipo_actividad: F.tipo_actividad, codigo_cc: cc, tipo_material: F.tipo_material,
      origen: F.origen || '', destino: F.destino || '', distancia_km: F.distancia_km,
      prog_origen: esCargaPista(F.tipo_actividad) ? (F.prog_origen || '') : '',
      prog_ini: esCargaPista(F.tipo_actividad) ? (F.prog_ini || '') : '',
      prog_fin: esCargaPista(F.tipo_actividad) ? (F.prog_fin || '') : '',
      litros_ini: esEmulsion(F.tipo_material) ? F.litros_ini : null, litros_fin: esEmulsion(F.tipo_material) ? F.litros_fin : null,
      litros_usados: esEmulsion(F.tipo_material) ? F.litros_usados : null, m2_pista: esEmulsion(F.tipo_material) ? F.m2_pista : null,
      m3_hormigon: esHormigon(F.tipo_material) ? F.m3_hormigon : null,
      encargado: esEditor() ? (F.encargado || '') : '', observaciones: F.observaciones || ''
    };
  }
  async function guardar() {
    leerForm();
    var err = validar(); if (err) { alert(err); return; }
    var btn = $('#trGuardar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    var p = payload();
    var vq = F.viajes.filter(function (v) { return v.chapa || v.viajes != null || v.toneladas != null; });
    try {
      if (EDIT) {
        await global.ObraAPI.trEditar(EDIT, p, vq, oid());
        toast('Carga corregida');
        EDIT = null; F = nuevoForm();
      } else {
        var r = await global.ObraAPI.trGuardar(Object.assign({}, p, { viajes: vq, fotos: F.fotos }), oid());
        lsSet('ult:' + oid(), { tipo_actividad: p.tipo_actividad, codigo_cc: F.codigo_cc === '__otro' ? '' : F.codigo_cc, tipo_material: p.tipo_material, origen: p.origen, destino: p.destino, distancia_km: p.distancia_km });
        var tv = vq.reduce(function (s, v) { return s + n(v.viajes); }, 0);
        toast(r && r.queued ? '📴 Sin señal: la carga quedó guardada en el celular y se envía sola al volver la conexión'
                            : 'Carga guardada · <b>' + vq.length + '</b> camión(es), <b>' + fq(tv) + '</b> viajes');
        var keep = { fecha: F.fecha };
        F = nuevoForm(); F.fecha = keep.fecha;
        if (r && r.queued) { render(); return; }
      }
      await cargar();
    } catch (e) {
      alert(e.message || String(e));
      if (btn) { btn.disabled = false; btn.textContent = EDIT ? 'Guardar corrección' : 'Guardar carga'; }
    }
  }
  function editar(id) {
    var c = (D.cargas || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    EDIT = id; F = formDeCarga(c); MODO = 'cargar'; render();
    var v = $('#v-transporte'); if (v) v.scrollTop = 0;
  }
  async function borrar(id) {
    var c = (D.cargas || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    if (!confirm('¿Borrar la carga del ' + fd(c.fecha) + ' (' + c.tipo_material + ', ' + fq(totViajes(c)) + ' viajes)?')) return;
    try { await global.ObraAPI.trBorrar(id, oid()); toast('Carga borrada'); if (EDIT === id) { EDIT = null; F = nuevoForm(); } await cargar(); }
    catch (e) { alert(e.message || String(e)); }
  }

  // ------------------------------------------------------------ Excel
  function cargarLib(src, g) {
    if (global[g]) return Promise.resolve(global[g]);
    return new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ok(global[g]); }; s.onerror = function () { mal(new Error('no se pudo cargar la librería (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
  }
  async function excel() {
    var ExcelJS = await cargarLib('exceljs.min.js?v=4.4.0', 'ExcelJS');
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Transporte', { views: [{ state: 'frozen', ySplit: 1 }] });
    var cols = [['Fecha', 11], ['Tipo de actividad', 26], ['Centro de costo', 14], ['Ítem', 8], ['Descripción del ítem', 34], ['Tipo de material', 22],
      ['Origen', 14], ['Destino', 14], ['Prog. origen', 11], ['Prog. inicio', 11], ['Prog. final', 11], ['Distancia (km)', 11],
      ['Chapa', 12], ['Viajes', 9], ['Toneladas', 11], ['t·km', 12], ['Litros inicial', 11], ['Litros final', 11], ['Litros usados', 11],
      ['M² pista', 10], ['M³ hormigón', 11], ['Encargado', 22], ['Observaciones', 30], ['Fotos', 40], ['Cargado por', 24], ['Cargado el', 18], ['ID carga', 22], ['Origen del dato', 10]];
    ws.columns = cols.map(function (c) { return { header: c[0], width: c[1] }; });
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EBF0' } };
    var nf = '#,##0.######';
    filtradas().slice().reverse().forEach(function (c) {
      var it = D.items.filter(function (i) { return i.cc === c.codigo_cc; })[0] || {};
      var vs = (c.viajes || []).length ? c.viajes : [{}];
      vs.forEach(function (v, k) {
        var row = ws.addRow([c.fecha ? new Date(c.fecha + 'T12:00:00') : null, c.tipo_actividad, c.codigo_cc, it.id || '', it.desc || ccTxt(c), c.tipo_material,
          c.origen, c.destino, c.prog_origen, c.prog_ini, c.prog_fin, c.distancia_km,
          v.chapa || '', v.viajes == null ? null : v.viajes, v.toneladas == null ? null : v.toneladas,
          v.toneladas != null && c.distancia_km != null ? v.toneladas * c.distancia_km : null,
          k === 0 ? c.litros_ini : null, k === 0 ? c.litros_fin : null, k === 0 ? c.litros_usados : null, k === 0 ? c.m2_pista : null, k === 0 ? c.m3_hormigon : null,
          c.encargado, c.observaciones, (c.fotos || []).join(' '), c.cargado_por, c.cargado_en ? new Date(c.cargado_en) : null, c.id, c.origen_dato]);
        row.getCell(1).numFmt = 'dd/mm/yyyy'; row.getCell(26).numFmt = 'dd/mm/yyyy hh:mm';
        [12, 14, 15, 16, 17, 18, 19, 20, 21].forEach(function (i) { row.getCell(i).numFmt = nf; });
      });
    });
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
    var buf = await wb.xlsx.writeBuffer();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'Transporte_' + oid() + '_' + hoy() + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // ------------------------------------------------------------ carga / API
  async function cargar() {
    if (CARGANDO) return; CARGANDO = true;
    try {
      D = await global.ObraAPI.trDatos(oid());
      var sel = $('#obraSel'); D.obraNombre = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
      if (!FIL.desde && (D.cargas || []).length > 300) FIL.desde = haceDias(60);
    } finally { CARGANDO = false; }
    render();
  }
  function abrir() {
    var o = oid();
    if (D && obraCargada === o) { render(); return; }
    D = null; F = null; EDIT = null; FIL = { desde: '', hasta: '', act: '', mat: '', txt: '' }; render();
    obraCargada = o;
    cargar().catch(function (e) {
      var v = $('#v-transporte'); if (v) v.innerHTML = '<div class="tr-vacio">No se pudo cargar el transporte: ' + esc(e.message) + '</div>';
    });
  }
  function engancharPestana() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'transporte') abrir(); });
    // al vaciarse la cola offline, refrescar la lista si está abierta
    if (global.Outbox && global.Outbox.onChange) global.Outbox.onChange(function (k) {
      var v = $('#v-transporte'); if (k === 0 && v && v.classList.contains('on') && D) cargar().catch(function () {});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', engancharPestana); else engancharPestana();

  global.addEventListener('beforeunload', function (e) {
    if (F && !EDIT && (F.fotos.length || F.viajes.some(function (v) { return v.chapa; }))) { e.preventDefault(); e.returnValue = 'Hay una carga sin guardar.'; return e.returnValue; }
  });

  global.TransporteView = {
    abrir: abrir,
    reset: function () { D = null; obraCargada = null; F = null; EDIT = null; },
    _estado: function () { return { D: D, F: F, EDIT: EDIT }; }
  };
})(window);
