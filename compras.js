/* =========================================================================
 * compras.js — Pestaña COMPRAS · v20261004f
 *
 * Tres vistas:
 *  · Pedidos: el circuito del tablero de Monday "Pedidos de Compra Obra UCC"
 *    (pedido → aprobación → 3 cotizaciones → OC → entrega), por obra, con el
 *    ítem de obra / centro de costo y el recurso del maestro.
 *  · Necesidad por recurso: lo que piden los ítems (cantidad vigente × cantidad
 *    unitaria del recurso, de CONSOLIDADO_RECURSOS_RECOSTEO) contra lo pedido y
 *    lo recibido.
 *  · Maestro de recursos (MAESTRO_RECURSOS_PRESUPUESTO).
 * Importa desde Excel: el export de Monday, el maestro y los recursos por ítem.
 * Sin redondeos. No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var APROB = ['', 'Aprobado', 'Falta Especificación', 'Rechazado'];
  var EST_OC = ['', 'Pendiente', 'Creada', 'Aprobación', 'Enviado Proveedor'];
  var ENTREGA = ['', 'Pendiente', 'Recibido', 'Atrasado'];
  var UMS = ['Un', 'Kg', 'Ton', 'Lt', 'Gal', 'Bolsa', 'Rollo', 'Pza', 'Cajas', 'M2', 'M3', 'ML', 'Gl', 'Hs', 'Mes'];

  var D = null, obraCargada = null, VISTA = 'pedidos';
  var FIL = { txt: '', aprob: '', oc: '', ent: '' };
  var FILN = { tipo: 'Materiales', txt: '', solo: false }, FILR = { txt: '', tipo: '' };
  var ABIERTO = {};
  var REC = {};          // recurso_id → recurso

  // ------------------------------------------------------------ utilidades
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function vacio(v) { return v === null || v === undefined || v === ''; }
  function fq(v) { return vacio(v) ? '–' : n(v).toLocaleString('es-PY', { maximumFractionDigits: 6 }); }
  function fg(v) { return vacio(v) ? '–' : '₲ ' + n(v).toLocaleString('es-PY', { maximumFractionDigits: 0 }); }
  function fin(v) { return vacio(v) ? '' : String(v).replace('.', ','); }
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().replace(/[\s₲$]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fd(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : s; }
  function dias(a, b) { if (!a || !b) return null; return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
  // YO_SOY es un let de app.js: se lee por nombre
  function yoSoy() { try { return (typeof YO_SOY !== 'undefined' && YO_SOY) || ''; } catch (e) { return ''; } }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function rol() { return global.__role || ''; }
  function esEditor() { return rol() === 'admin' || rol() === 'residente'; }
  function esAdmin() { return rol() === 'admin'; }
  function oid() { return global.ObraAPI && global.ObraAPI.getObraId(); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function puElegido(c) { var k = c.cot_elegida; return k ? c['pu' + k] : null; }
  function provElegido(c) { var k = c.cot_elegida; return k ? c['prov' + k] : ''; }
  function montoRef(c) { if (!vacio(c.monto_logrado)) return n(c.monto_logrado); var pu = puElegido(c); return !vacio(pu) && !vacio(c.cantidad) ? n(pu) * n(c.cantidad) : null; }
  function itemDe(id) { return D && D.items.filter(function (i) { return i.id === id; })[0]; }
  function recNombre(id) { var r = REC[id]; return r ? r.nombre : ''; }
  function precioLista(id) { return id && D && D.precios ? D.precios[id] : null; }   // sin IVA, lista de licitación de la obra

  // ------------------------------------------------------------ estilos
  function estilos() {
    if ($('#cmCss')) return;
    var st = document.createElement('style'); st.id = 'cmCss';
    st.textContent = [
      '#v-compras{overflow:auto;background:#f4f6f9}',
      '.cm-wrap{padding:14px 18px 40px;max-width:1800px;margin:0 auto;color:#1f2937}',
      '.cm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.cm-bar input,.cm-bar select{font:inherit;font-size:13px;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937}',
      '.cm-bar .grow{flex:1}',
      '.cm-seg{display:flex;border:1px solid #c9d1dc;border-radius:9px;overflow:hidden;background:#fff}',
      '.cm-seg button{padding:8px 14px;font-size:13px;font-weight:700;color:#4a5568;background:none;border:0;cursor:pointer}',
      '.cm-seg button.on{background:#1a2744;color:#fff}',
      '.cm-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}',
      '.cm-btn:hover{background:#f4f7fb}.cm-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}.cm-btn.del{color:#c0392b}',
      '.cm-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px}',
      '.cm-kpi{background:#fff;border:1px solid #d0d6e0;border-left:4px solid #2c4a8a;border-radius:9px;padding:7px 10px}',
      '.cm-kpi span{display:block;font-size:10.5px;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}.cm-kpi b{font-size:17px;color:#1a2744}',
      '.cm-tw{overflow:auto;border:1px solid #d0d6e0;border-radius:10px;background:#fff;max-height:calc(100vh - 330px)}',
      '.cm-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1150px}',
      '.cm-t th{position:sticky;top:0;background:#f0f2f5;font-size:10.5px;text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;z-index:1;white-space:nowrap}',
      '.cm-t td{padding:5px 6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.cm-t td.r,.cm-t th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.cm-t td small{color:#7a8699;display:block}',
      '.cm-t tr.cl{cursor:pointer}.cm-t tr.cl:hover td{background:#f7f9fc}',
      '.cm-t tr.sub td{background:#fbfcfe;font-size:12px}',
      '.cm-chip{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#eef2f7;color:#4a5568;white-space:nowrap}',
      '.cm-chip.ok{background:#e3f6ea;color:#1e7a43}.cm-chip.mal{background:#fdecea;color:#b03a2e}.cm-chip.am{background:#fff4e0;color:#9a6200}.cm-chip.az{background:#e6eefb;color:#2c4a8a}',
      '.cm-sem{font-size:11px;white-space:nowrap}',
      '.cm-mini{border:1px solid #d0d6e0;background:#fff;border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer}',
      '.cm-mini.del{color:#c0392b}',
      '.cm-vacio{padding:30px;text-align:center;color:#4a5568;background:#fff;border:1px solid #d0d6e0;border-radius:10px}',
      '.cm-info{font-size:12.5px;color:#4a5568;background:#eef3fa;border-radius:8px;padding:8px 10px;margin-bottom:10px}',
      '.cm-neg{color:#c0392b;font-weight:700}.cm-pos{color:#1e7a43;font-weight:700}',
      /* modal */
      '.cm-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto}',
      '.cm-box{background:#fff;border-radius:12px;max-width:980px;width:100%;padding:18px 20px;color:#1f2937}',
      '.cm-box h3{margin:0 0 4px;color:#1a2744}.cm-box .sub{font-size:12.5px;color:#4a5568;margin:0 0 12px}',
      '.cm-sec{border:1px solid #e1e6ee;border-radius:10px;padding:10px 12px;margin-bottom:10px}',
      '.cm-sec>h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#2c4a8a}',
      '.cm-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px}',
      '.cm-g .w2{grid-column:span 2}.cm-g .w4{grid-column:1/-1}',
      '.cm-f{display:flex;flex-direction:column;gap:3px}',
      '.cm-f label{font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.cm-f input,.cm-f select,.cm-f textarea{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937;width:100%;box-sizing:border-box}',
      '.cm-f input:focus,.cm-f select:focus,.cm-f textarea:focus{outline:2px solid #e8640a;border-color:#e8640a}',
      '.cm-cot{display:grid;grid-template-columns:36px 2fr 1fr 1fr;gap:6px 10px;align-items:center}',
      '.cm-cot .h{font-size:10.5px;font-weight:700;color:#7a8699;text-transform:uppercase}',
      '.cm-cot input[type=text],.cm-cot input:not([type]){font:inherit;font-size:14px;padding:7px 8px;border:1px solid #c9d1dc;border-radius:8px;width:100%;box-sizing:border-box}',
      '.cm-cot .tot{text-align:right;font-variant-numeric:tabular-nums}',
      '.cm-acc{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}',
      '.cm-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 12px;max-height:240px;overflow:auto;border:1px solid #e1e6ee;border-radius:8px;padding:8px}',
      '.cm-map label{font-size:13px;display:flex;gap:6px;align-items:center}',
      'body.mobile .cm-wrap{padding:10px 10px 80px}',
      'body.mobile .cm-kpis{grid-template-columns:1fr 1fr}',
      'body.mobile .cm-g{grid-template-columns:1fr 1fr}',
      'body.mobile .cm-modal{padding:0}body.mobile .cm-box{border-radius:0;min-height:100%}',
      '@media (max-width:1100px){.cm-kpis{grid-template-columns:repeat(3,1fr)}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ render general
  function render() {
    var v = $('#v-compras'); if (!v) return;
    estilos();
    if (!D) { v.innerHTML = '<div class="cm-wrap"><div class="cm-vacio">Cargando compras…</div></div>'; return; }
    var y = v.scrollTop;
    var h = '<div class="cm-wrap"><div class="cm-bar"><div class="cm-seg">' +
      [['pedidos', 'Pedidos (' + D.compras.length + ')'], ['necesidad', 'Necesidad por recurso'], ['recursos', 'Maestro de recursos (' + D.recursos.length + ')']].map(function (x) {
        return '<button data-vista="' + x[0] + '" class="' + (VISTA === x[0] ? 'on' : '') + '">' + x[1] + '</button>';
      }).join('') + '</div><span class="grow"></span>';
    if (VISTA === 'pedidos') {
      h += '<button class="cm-btn" id="cmXls">⬇ Excel</button>' +
        (esEditor() ? '<label class="cm-btn" style="cursor:pointer">⬆ Importar de Monday (Excel)<input type="file" id="cmMonday" accept=".xlsx" hidden></label>' +
          (D.compras.some(function (c) { return !c.recurso_id; }) ? '<button class="cm-btn" id="cmEnlazar" title="Sugiere el recurso del maestro para los pedidos que no lo tienen">🔗 Enlazar recursos (' + D.compras.filter(function (c) { return !c.recurso_id; }).length + ')</button>' : '') +
          '<button class="cm-btn pri" id="cmNuevo">＋ Nuevo pedido</button>' : '');
    } else if (VISTA === 'necesidad') {
      h += '<button class="cm-btn" id="cmIrPlant">⬇ Planilla recursos por ítem</button>' +
        (esEditor() ? '<label class="cm-btn" style="cursor:pointer">⬆ Cargar recursos por ítem (Excel)<input type="file" id="cmIrFile" accept=".xlsx" hidden></label>' : '');
    } else {
      h += '<button class="cm-btn" id="cmRecXls">⬇ Excel</button>' +
        (esAdmin() ? '<label class="cm-btn" style="cursor:pointer">⬆ Cargar maestro (Excel)<input type="file" id="cmRecFile" accept=".xlsx" hidden></label>' : '');
    }
    h += '</div>';
    h += VISTA === 'pedidos' ? htmlPedidos() : VISTA === 'necesidad' ? htmlNecesidad() : htmlRecursos();
    v.innerHTML = h + '</div>';
    v.scrollTop = y;
    enlazar();
  }

  // ------------------------------------------------------------ pedidos
  function filtrados() {
    var t = norm(FIL.txt);
    return D.compras.filter(function (c) {
      if (FIL.aprob && (FIL.aprob === '—' ? c.aprobacion : c.aprobacion !== FIL.aprob)) return false;
      if (FIL.oc && (FIL.oc === '—' ? c.estado_oc : c.estado_oc !== FIL.oc)) return false;
      if (FIL.ent && (FIL.ent === '—' ? c.entrega : c.entrega !== FIL.ent)) return false;
      if (t) {
        var it = itemDe(c.item_id);
        var s = norm([c.descripcion, c.recurso_id, recNombre(c.recurso_id), c.solicitante, c.orden_compra, c.prov1, c.prov2, c.prov3, c.obs_pedido, c.codigo_cc, it ? it.id + ' ' + it.desc : ''].join(' '));
        if (s.indexOf(t) < 0) return false;
      }
      return true;
    });
  }
  function chipAprob(a) { return a ? '<span class="cm-chip ' + (a === 'Aprobado' ? 'ok' : a === 'Rechazado' ? 'mal' : 'am') + '">' + esc(a) + '</span>' : '<span class="cm-chip">Sin revisar</span>'; }
  function chipOC(e) { return e ? '<span class="cm-chip ' + (e === 'Enviado Proveedor' ? 'ok' : e === 'Creada' ? 'az' : e === 'Pendiente' ? 'mal' : 'am') + '">' + esc(e) + '</span>' : ''; }
  function chipEnt(e) { return e ? '<span class="cm-chip ' + (e === 'Recibido' ? 'ok' : e === 'Atrasado' ? 'mal' : 'am') + '">' + esc(e) + '</span>' : ''; }
  function semaforo(c) {
    var d = dias(c.fecha_solicitud, c.fecha_requerida); if (d === null) return '';
    return '<span class="cm-sem" title="Anticipación: ' + d + ' días entre el pedido y la fecha requerida">' + (d < 7 ? '🔴' : d < 14 ? '🟡' : '🟢') + ' ' + d + ' d</span>';
  }
  function htmlPedidos() {
    var L = filtrados();
    var sinAprob = 0, enviadas = 0, recib = 0, logrado = 0, ahorro = 0;
    L.forEach(function (c) {
      if (!c.aprobacion) sinAprob++;
      if (c.estado_oc === 'Enviado Proveedor') enviadas++;
      if (c.entrega === 'Recibido') recib++;
      var m = montoRef(c); if (m !== null) logrado += m;
      if (!vacio(c.monto_regular) && !vacio(c.monto_logrado) && n(c.monto_regular) > 0) ahorro += n(c.monto_regular) - n(c.monto_logrado);
    });
    var h = '<div class="cm-bar"><input type="search" id="cmFt" placeholder="Buscar recurso, ítem, proveedor, OC, solicitante…" value="' + esc(FIL.txt) + '" style="min-width:300px">' +
      selFil('cmFa', 'aprob', 'Aprobación', APROB.slice(1)) + selFil('cmFo', 'oc', 'Estado OC', EST_OC.slice(1)) + selFil('cmFe', 'ent', 'Entrega', ENTREGA.slice(1)) + '</div>' +
      '<div class="cm-kpis"><div class="cm-kpi"><span>Pedidos</span><b>' + L.length + '</b></div><div class="cm-kpi" style="border-left-color:#e8640a"><span>Sin revisar</span><b>' + sinAprob + '</b></div>' +
      '<div class="cm-kpi"><span>OC enviadas</span><b>' + enviadas + '</b></div><div class="cm-kpi" style="border-left-color:#2e9c63"><span>Recibidos</span><b>' + recib + '</b></div>' +
      '<div class="cm-kpi"><span>Monto comprado</span><b>' + fg(logrado) + '</b></div><div class="cm-kpi" style="border-left-color:#2e9c63"><span>Ahorro vs regular</span><b>' + fg(ahorro) + '</b></div></div>';
    if (!D.compras.length) return h + '<div class="cm-vacio">Todavía no hay pedidos en esta obra.' + (esEditor() ? ' Tocá <b>＋ Nuevo pedido</b> o importá el tablero de Monday (en Monday: ⋯ › Exportar tablero a Excel).' : '') + '</div>';
    if (!L.length) return h + '<div class="cm-vacio">Ningún pedido coincide con los filtros.</div>';
    h += '<div class="cm-tw"><table class="cm-t"><thead><tr><th>Pedido</th><th>Requerido</th><th>Recurso</th><th>Ítem / CC</th><th class="r">Cant.</th><th>UM</th><th>Solicitante</th><th>Aprobación</th>' +
      '<th>Cotización elegida</th><th class="r" title="Precio de lista de la obra (licitación, sin IVA)">P.U. presupuesto</th><th class="r">Monto</th><th>OC</th><th>Entrega</th><th></th></tr></thead><tbody>';
    L.slice(0, 600).forEach(function (c) {
      var it = itemDe(c.item_id), pu = puElegido(c), m = montoRef(c);
      h += '<tr class="cl" data-ed="' + esc(c.compra_id) + '"><td>' + fd(c.fecha_solicitud) + '</td><td>' + fd(c.fecha_requerida) + '<br>' + semaforo(c) + '</td>' +
        '<td><b>' + esc(c.descripcion) + '</b>' + (c.recurso_id ? '<small>' + esc(c.recurso_id + ' · ' + recNombre(c.recurso_id)) + '</small>' : '') + (c.obs_pedido ? '<small>' + esc(c.obs_pedido) + '</small>' : '') + '</td>' +
        '<td>' + (it ? esc(it.id + ' · ' + it.desc) : '') + (c.codigo_cc ? '<small>CC ' + esc(c.codigo_cc) + '</small>' : '') + '</td>' +
        '<td class="r">' + fq(c.cantidad) + '</td><td>' + esc(c.um) + '</td><td>' + esc(c.solicitante) + '</td><td>' + chipAprob(c.aprobacion) + '</td>' +
        '<td>' + (c.cot_elegida ? esc(provElegido(c) || 'Cotización ' + c.cot_elegida) + '<small>' + fg(pu) + ' c/u</small>' : cotizResumen(c)) + '</td>' +
        '<td class="r">' + (vacio(precioLista(c.recurso_id)) ? '–' : fg(precioLista(c.recurso_id)) + (pu != null && n(precioLista(c.recurso_id)) > 0 ? '<small class="' + (n(pu) > n(precioLista(c.recurso_id)) * 1.1 ? 'cm-neg' : 'cm-pos') + '">cotizado ' + ((n(pu) / n(precioLista(c.recurso_id)) - 1) * 100 >= 0 ? '+' : '') + ((n(pu) / n(precioLista(c.recurso_id)) - 1) * 100).toLocaleString('es-PY', { maximumFractionDigits: 1 }) + ' %</small>' : '')) + '</td>' +
        '<td class="r">' + fg(m) + (!vacio(c.monto_regular) && !vacio(c.monto_logrado) && n(c.monto_regular) > n(c.monto_logrado) ? '<small class="cm-pos">ahorro ' + fg(n(c.monto_regular) - n(c.monto_logrado)) + '</small>' : '') + '</td>' +
        '<td>' + chipOC(c.estado_oc) + (c.orden_compra ? '<small>N° ' + esc(c.orden_compra) + '</small>' : '') + '</td>' +
        '<td>' + chipEnt(c.entrega) + (c.fecha_entrega ? '<small>' + fd(c.fecha_entrega) + '</small>' : '') + '</td>' +
        '<td style="white-space:nowrap">' + (esEditor() ? '<button class="cm-mini del" data-del="' + esc(c.compra_id) + '" title="Borrar">🗑</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (L.length > 600) h += '<div class="cm-info" style="margin-top:8px">Se muestran los 600 más recientes; el Excel trae los ' + L.length + '.</div>';
    return h;
  }
  function cotizResumen(c) {
    var k = [1, 2, 3].filter(function (i) { return !vacio(c['pu' + i]); });
    return k.length ? '<small>' + k.length + ' cotización(es)</small>' : '';
  }
  function selFil(id, k, txt, ops) {
    return '<select id="' + id + '"><option value="">' + txt + ': todas</option><option value="—"' + (FIL[k] === '—' ? ' selected' : '') + '>' + txt + ': sin dato</option>' +
      ops.map(function (o) { return '<option' + (FIL[k] === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
  }

  // ------------------------------------------------------------ formulario de pedido
  function abrirPedido(id) {
    var c = id ? D.compras.filter(function (x) { return x.compra_id === id; })[0] : null;
    var nuevo = !c;
    c = Object.assign({ descripcion: '', recurso_id: '', item_id: '', cantidad: null, um: 'Un', fecha_solicitud: hoy(), fecha_requerida: '', solicitante: yoSoy() || '',
      obs_pedido: '', aprobacion: '', fecha_aprobacion: '', prov1: '', pu1: null, prov2: '', pu2: null, prov3: '', pu3: null, cot_elegida: null, obs_cotizacion: '',
      estado_oc: '', orden_compra: '', fecha_oc: '', monto_regular: null, monto_logrado: null, entrega: '', fecha_entrega: '', cant_recibida: null }, c || {});
    var ro = !esEditor();
    var dis = ro ? ' disabled' : '';
    var items = D.items.filter(function (i) { return !i.grupo; });
    var recs = D.recursos.filter(function (r) { return r.activo !== false; });
    var m = document.createElement('div'); m.className = 'cm-modal';
    var f = function (lab, html, cls) { return '<div class="cm-f ' + (cls || '') + '"><label>' + lab + '</label>' + html + '</div>'; };
    var inp = function (k, extra) { return '<input id="cf_' + k + '" value="' + esc(c[k] == null ? '' : (typeof c[k] === 'number' ? fin(c[k]) : c[k])) + '"' + (extra || '') + dis + '>'; };
    var sel = function (k, ops) { return '<select id="cf_' + k + '"' + dis + '>' + ops.map(function (o) { return '<option value="' + esc(o) + '"' + (String(c[k] || '') === o ? ' selected' : '') + '>' + esc(o || '—') + '</option>'; }).join('') + '</select>'; };
    var cot = function (i) {
      return '<input type="radio" name="cf_cot" value="' + i + '"' + (c.cot_elegida == i ? ' checked' : '') + dis + ' title="Elegir esta cotización">' +
        '<input id="cf_prov' + i + '" value="' + esc(c['prov' + i]) + '" placeholder="Proveedor ' + i + '"' + dis + '>' +
        '<input id="cf_pu' + i + '" value="' + esc(fin(c['pu' + i])) + '" placeholder="P.U." inputmode="decimal"' + dis + '>' +
        '<div class="tot" id="cf_tot' + i + '"></div>';
    };
    var umOps = UMS.slice(); if (c.um && umOps.indexOf(c.um) < 0) umOps.unshift(c.um);
    m.innerHTML = '<div class="cm-box"><h3>' + (nuevo ? '＋ Nuevo pedido de compra' : '✎ Pedido de compra') + '</h3>' +
      '<p class="sub">' + (nuevo ? 'Cargá el recurso, la cantidad y para qué ítem de la obra es. Las cotizaciones y la OC se completan después.' :
        'Cargado ' + fd(c.fecha_solicitud) + (c.creado_por ? ' por ' + esc(c.creado_por) : '') + (c.monday_id ? ' · importado de Monday' : '')) + '</p>' +
      '<div class="cm-sec"><h4>Pedido</h4><div class="cm-g">' +
        f('Descripción del recurso *', '<input id="cf_descripcion" list="cfRecs" value="' + esc(c.descripcion) + '" placeholder="Ej. Cemento CPII 50 kg"' + dis + '>', 'w2') +
        f('Recurso del maestro', '<input id="cf_recurso_id" list="cfRecIds" value="' + esc(c.recurso_id || '') + '" placeholder="código"' + dis + '><small id="cf_recnom" style="color:#7a8699">' + esc(recNombre(c.recurso_id) + (vacio(precioLista(c.recurso_id)) ? '' : ' · presupuesto ' + fg(precioLista(c.recurso_id)) + ' s/IVA')) + '</small>') +
        f('Cantidad', inp('cantidad', ' inputmode="decimal"')) +
        f('UM', sel('um', umOps)) +
        f('Ítem de obra (centro de costo)', '<select id="cf_item_id"' + dis + '><option value="">— sin imputar —</option>' + items.map(function (i) {
          return '<option value="' + esc(i.id) + '"' + (i.id === c.item_id ? ' selected' : '') + '>' + esc(i.id + ' · ' + i.desc.slice(0, 60) + (i.cc ? ' · CC ' + i.cc : '')) + '</option>'; }).join('') + '</select>', 'w2') +
        f('Fecha requerida', '<input type="date" id="cf_fecha_requerida" value="' + esc(c.fecha_requerida || '') + '"' + dis + '>') +
        f('Solicitante', inp('solicitante')) +
        f('Observaciones del pedido', '<textarea id="cf_obs_pedido" rows="2"' + dis + '>' + esc(c.obs_pedido) + '</textarea>', 'w4') +
        '<datalist id="cfRecs">' + recs.slice(0, 1500).map(function (r) { return '<option value="' + esc(r.nombre) + '">' + esc(r.recurso_id) + '</option>'; }).join('') + '</datalist>' +
        '<datalist id="cfRecIds">' + recs.slice(0, 1500).map(function (r) { return '<option value="' + esc(r.recurso_id) + '">' + esc(r.nombre) + '</option>'; }).join('') + '</datalist>' +
      '</div></div>' +
      '<div class="cm-sec"><h4>Aprobación</h4><div class="cm-g">' + f('Estado', sel('aprobacion', APROB)) + f('Fecha de aprobación', '<input type="date" id="cf_fecha_aprobacion" value="' + esc(c.fecha_aprobacion || '') + '"' + dis + '>') + '</div></div>' +
      '<div class="cm-sec"><h4>Cotizaciones</h4><div class="cm-cot"><span class="h">Elegida</span><span class="h">Proveedor</span><span class="h">P.U.</span><span class="h" style="text-align:right">Total</span>' + cot(1) + cot(2) + cot(3) + '</div>' +
        '<div class="cm-g" style="margin-top:8px">' + f('Observaciones de cotización', '<input id="cf_obs_cotizacion" value="' + esc(c.obs_cotizacion) + '"' + dis + '>', 'w4') + '</div></div>' +
      '<div class="cm-sec"><h4>Orden de compra</h4><div class="cm-g">' + f('Estado OC', sel('estado_oc', EST_OC)) + f('N° de OC', inp('orden_compra')) +
        f('Fecha OC', '<input type="date" id="cf_fecha_oc" value="' + esc(c.fecha_oc || '') + '"' + dis + '>') + '<div></div>' +
        f('Monto regular (máx.)', inp('monto_regular', ' inputmode="decimal" placeholder="referencia"')) + f('Monto logrado', inp('monto_logrado', ' inputmode="decimal"')) +
        '<div class="cm-f w2"><label>Ahorro</label><div id="cf_ahorro" style="padding:8px 0;font-weight:700"></div></div></div></div>' +
      '<div class="cm-sec"><h4>Entrega</h4><div class="cm-g">' + f('Estado', sel('entrega', ENTREGA)) + f('Fecha de recepción', '<input type="date" id="cf_fecha_entrega" value="' + esc(c.fecha_entrega || '') + '"' + dis + '>') +
        f('Cantidad recibida', inp('cant_recibida', ' inputmode="decimal" placeholder="vacío = todo"')) + '</div></div>' +
      '<div class="cm-acc">' + (!nuevo && esEditor() ? '<button class="cm-btn del" id="cfBorrar">Borrar</button><span style="flex:1"></span>' : '') +
        '<button class="cm-btn" id="cfCerrar">' + (ro ? 'Cerrar' : 'Cancelar') + '</button>' + (ro ? '' : '<button class="cm-btn pri" id="cfGuardar">Guardar pedido</button>') + '</div></div>';
    document.body.appendChild(m);
    var g = function (k) { var e = $('#cf_' + k, m); return e ? e.value.trim() : ''; };
    function recalc() {
      var q = parseNum(g('cantidad'));
      [1, 2, 3].forEach(function (i) { var pu = parseNum(g('pu' + i)); $('#cf_tot' + i, m).textContent = pu !== null && q !== null ? fg(pu * q) : ''; });
      var mr = parseNum(g('monto_regular')), ml = parseNum(g('monto_logrado'));
      var el = $('#cf_ahorro', m);
      if (mr !== null && ml !== null && mr > 0) { var a = mr - ml; el.innerHTML = '<span class="' + (a >= 0 ? 'cm-pos' : 'cm-neg') + '">' + fg(a) + ' (' + (a / mr * 100).toLocaleString('es-PY', { maximumFractionDigits: 2 }) + ' %)</span>'; }
      else el.textContent = '—';
      var k = (m.querySelector('input[name=cf_cot]:checked') || {}).value;
      var ml$ = $('#cf_monto_logrado', m);
      if (k && ml$) { var pu = parseNum(g('pu' + k)); ml$.placeholder = pu !== null && q !== null ? fin(pu * q) + ' (cant. × P.U. elegido)' : ''; }
    }
    $$('input', m).forEach(function (e) { e.addEventListener('input', recalc); e.addEventListener('change', recalc); });
    recalc();
    var desc = $('#cf_descripcion', m), rid = $('#cf_recurso_id', m);
    if (desc) desc.addEventListener('change', function () {
      if (rid.value.trim()) return;
      var r = recs.filter(function (x) { return norm(x.nombre) === norm(desc.value); })[0];
      if (r) { rid.value = r.recurso_id; $('#cf_recnom', m).textContent = r.nombre + (vacio(precioLista(r.recurso_id)) ? '' : ' · presupuesto ' + fg(precioLista(r.recurso_id)) + ' s/IVA'); if (r.um) { var um = $('#cf_um', m); if (UMS.indexOf(r.um) >= 0 || [].some.call(um.options, function (o) { return o.value === r.um; })) um.value = r.um; } }
    });
    if (rid) rid.addEventListener('change', function () {
      var r = REC[rid.value.trim()], pl = r ? precioLista(r.recurso_id) : null;
      $('#cf_recnom', m).textContent = r ? r.nombre + (vacio(pl) ? '' : ' · presupuesto ' + fg(pl) + ' s/IVA') : (rid.value.trim() ? 'no está en el maestro' : '');
      if (r && !desc.value.trim()) desc.value = r.nombre;
    });
    function cerrar() { m.remove(); }
    $('#cfCerrar', m).onclick = cerrar;
    m.addEventListener('click', function (e) { if (e.target === m) cerrar(); });
    if ($('#cfBorrar', m)) $('#cfBorrar', m).onclick = function () { cerrar(); borrar(c.compra_id); };
    if ($('#cfGuardar', m)) $('#cfGuardar', m).onclick = async function () {
      var p = { compra_id: nuevo ? null : c.compra_id, monday_id: c.monday_id || null, fecha_solicitud: c.fecha_solicitud };
      ['descripcion', 'recurso_id', 'item_id', 'um', 'fecha_requerida', 'solicitante', 'obs_pedido', 'aprobacion', 'fecha_aprobacion', 'prov1', 'prov2', 'prov3',
       'obs_cotizacion', 'estado_oc', 'orden_compra', 'fecha_oc', 'entrega', 'fecha_entrega'].forEach(function (k) { p[k] = g(k); });
      var malo = '';
      ['cantidad', 'pu1', 'pu2', 'pu3', 'monto_regular', 'monto_logrado', 'cant_recibida'].forEach(function (k) {
        var t = g(k), x = parseNum(t); if (t && x === null) malo = k; p[k] = x;
      });
      if (malo) { alert('Número no válido en ' + malo.replace('_', ' ')); return; }
      var k = (m.querySelector('input[name=cf_cot]:checked') || {}).value; p.cot_elegida = k ? +k : null;
      if (!p.descripcion) { alert('Falta la descripción del recurso.'); return; }
      if (p.aprobacion === 'Aprobado' && !p.fecha_aprobacion) p.fecha_aprobacion = hoy();
      if (p.entrega === 'Recibido' && !p.fecha_entrega) p.fecha_entrega = hoy();
      var b = $('#cfGuardar', m); b.disabled = true; b.textContent = 'Guardando…';
      try { await global.ObraAPI.compraGuardar(p, oid()); cerrar(); toast(nuevo ? 'Pedido cargado' : 'Pedido guardado'); await cargar(); }
      catch (e) { alert(e.message || String(e)); b.disabled = false; b.textContent = 'Guardar pedido'; }
    };
  }
  async function borrar(id) {
    var c = D.compras.filter(function (x) { return x.compra_id === id; })[0]; if (!c) return;
    if (!confirm('¿Borrar el pedido "' + c.descripcion + '"?')) return;
    try { await global.ObraAPI.compraBorrar(id, oid()); toast('Pedido borrado'); await cargar(); } catch (e) { alert(e.message || String(e)); }
  }

  // ------------------------------------------------------------ enlazar pedidos ↔ maestro
  var VACIAS = { de: 1, del: 1, la: 1, el: 1, los: 1, las: 1, para: 1, con: 1, por: 1, en: 1, y: 1, x: 1, a: 1, tipo: 1, provision: 1, compra: 1, un: 1, una: 1 };
  var UNID = { mm: 1, cm: 1, m: 1, m2: 1, m3: 1, mm2: 1, kg: 1, tn: 1, ton: 1, lt: 1, l: 1, ml: 1, un: 1, u: 1, w: 1, a: 1, p: 1, hp: 1, ka: 1, kv: 1, cc: 1, ta: 1, gl: 1, metro: 1, metros: 1 };
  function tokens(s) {
    return norm(s).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s*\/\s*(\d)/g, '$1/$2').replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9.\/]+/g, ' ').split(' ')
      .map(function (t) { return t.replace(/^[.\/]+|[.\/]+$/g, ''); }).filter(function (t) { return t && !VACIAS[t]; });
  }
  function indiceMaestro() {
    var idx = {}, lista = D.recursos.map(function (r) { var tk = tokens(r.nombre); return { r: r, tk: tk, set: tk.reduce(function (o, t) { o[t] = 1; return o; }, {}) }; });
    lista.forEach(function (x, i) { Object.keys(x.set).forEach(function (t) { (idx[t] = idx[t] || []).push(i); }); });
    var usados = {}; D.itemRecurso.forEach(function (x) { usados[x.recurso_id] = 1; });
    return { idx: idx, lista: lista, usados: usados };
  }
  function candidatos(desc, IM) {
    var tk = tokens(desc); if (!tk.length) return [];
    var cuenta = {};
    tk.forEach(function (t) { (IM.idx[t] || []).forEach(function (i) { cuenta[i] = (cuenta[i] || 0) + 1; }); });
    var esNum = function (t) { return /\d/.test(t); };
    return Object.keys(cuenta).map(function (i) {
      var x = IM.lista[+i], comunes = tk.filter(function (t) { return x.set[t]; });
      var score = comunes.length / Math.max(tk.length, x.tk.length);
      // tiene que coincidir al menos una palabra que no sea número ni unidad ("10 mm" solo no alcanza)
      if (!comunes.some(function (t) { return !esNum(t) && !UNID[t]; })) score *= 0.4;
      // medidas: "2P 25A 30 mA" no es "4P 25A 300 mA"; "1 1/2"" no es "1/2""
      var nA = tk.filter(esNum), nB = x.tk.filter(esNum), setA = {};
      nA.forEach(function (t) { setA[t] = 1; });
      var difA = nA.filter(function (t) { return !x.set[t]; }).length, difB = nB.filter(function (t) { return !setA[t]; }).length;
      var distintas = nA.length && nB.length && (difA || difB);
      if (distintas) score *= Math.pow(0.7, Math.min(3, Math.max(difA, difB)));
      if (/materiales/i.test(x.r.tipo)) score += 0.02;
      if (!vacio(precioLista(x.r.recurso_id))) score += 0.01;   // recurso presupuestado en esta obra
      if (IM.usados[x.r.recurso_id]) score += 0.03;              // lo usa algún ítem de esta obra (recosteo)
      return { r: x.r, score: Math.min(1, score), distintas: !!distintas };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 4);
  }
  function enlazarRecursos() {
    var IM = indiceMaestro();
    var sin = D.compras.filter(function (c) { return !c.recurso_id; });
    // agrupar por descripción: los pedidos repetidos se enlazan juntos
    var grupos = {}; sin.forEach(function (c) { var k = norm(c.descripcion); (grupos[k] = grupos[k] || { desc: c.descripcion, um: c.um, ids: [] }).ids.push(c.compra_id); });
    var G = Object.keys(grupos).map(function (k) { var g = grupos[k]; g.cand = candidatos(g.desc, IM); return g; })
      .sort(function (a, b) { return ((b.cand[0] || {}).score || 0) - ((a.cand[0] || {}).score || 0); });
    var UMBRAL = 0.6;
    function pct(c) { return c ? Math.round(c.score * 100) + ' %' + (c.distintas ? '<br><small style="color:#b7791f" title="Los números de la descripción no coinciden">⚠ medidas distintas</small>' : '') : ''; }
    var m = document.createElement('div'); m.className = 'cm-modal';
    m.innerHTML = '<div class="cm-box" style="max-width:1100px"><h3>🔗 Enlazar pedidos con el maestro de recursos</h3>' +
      '<p class="sub">' + sin.length + ' pedidos sin recurso, ' + G.length + ' descripciones distintas. La sugerencia compara las palabras de la descripción con el nombre del recurso. ' +
      'Quedan marcadas las de coincidencia alta (≥ ' + (UMBRAL * 100) + ' %) y con las mismas medidas; revisá, cambiá la sugerencia si hace falta y guardá. Lo que no marques queda como está.</p>' +
      '<div class="cm-bar"><input type="search" id="enBusca" placeholder="Filtrar…" style="min-width:260px"><label style="font-size:13px"><input type="checkbox" id="enTodos"> marcar todas las que tienen sugerencia</label></div>' +
      '<div class="cm-tw" style="max-height:60vh"><table class="cm-t" style="min-width:900px"><thead><tr><th style="width:30px">✓</th><th>Descripción en el pedido</th><th class="r">Pedidos</th><th>Recurso sugerido</th><th class="r">Coincidencia</th></tr></thead><tbody>' +
      G.map(function (g, k) {
        var c0 = g.cand[0];
        return '<tr data-k="' + k + '" data-txt="' + esc(norm(g.desc)) + '"><td><input type="checkbox" class="enOk"' + (c0 && c0.score >= UMBRAL && !c0.distintas ? ' checked' : '') + (c0 ? '' : ' disabled') + '></td>' +
          '<td>' + esc(g.desc) + '<small>' + esc(g.um || '') + '</small></td><td class="r">' + g.ids.length + '</td>' +
          '<td>' + (g.cand.length ? '<select class="enSel" style="max-width:520px">' + g.cand.map(function (c) {
            return '<option value="' + esc(c.r.recurso_id) + '">' + esc(c.r.recurso_id + ' · ' + c.r.nombre + (c.r.um ? ' (' + c.r.um + ')' : '')) + '</option>'; }).join('') +
            '<option value="">— ninguno —</option></select>' : '<small>sin sugerencia: asignalo desde el pedido</small>') + '</td>' +
          '<td class="r enSc">' + pct(c0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="cm-acc"><span id="enCuenta" style="margin-right:auto;font-size:13px;color:#4a5568"></span><button class="cm-btn" id="enNo">Cancelar</button><button class="cm-btn pri" id="enSi">Enlazar marcados</button></div></div>';
    document.body.appendChild(m);
    function cuenta() { var n = 0; $$('tr[data-k]', m).forEach(function (tr) { if ($('.enOk', tr).checked && $('.enSel', tr) && $('.enSel', tr).value) n += G[+tr.getAttribute('data-k')].ids.length; }); $('#enCuenta', m).textContent = n + ' pedido(s) a enlazar'; }
    $$('.enOk,.enSel', m).forEach(function (e) { e.addEventListener('change', function () {
      if (e.classList.contains('enSel')) { var tr = e.closest('tr'), g = G[+tr.getAttribute('data-k')], c = g.cand.filter(function (x) { return x.r.recurso_id === e.value; })[0];
        $('.enSc', tr).innerHTML = pct(c); if (e.value) $('.enOk', tr).checked = true; }
      cuenta(); }); });
    $('#enTodos', m).onchange = function () { var v = this.checked; $$('tr[data-k]', m).forEach(function (tr) { var ok = $('.enOk', tr); if (!ok.disabled && tr.style.display !== 'none') ok.checked = v; }); cuenta(); };
    $('#enBusca', m).oninput = function () { var t = norm(this.value); $$('tr[data-k]', m).forEach(function (tr) { tr.style.display = !t || tr.getAttribute('data-txt').indexOf(t) >= 0 ? '' : 'none'; }); };
    $('#enNo', m).onclick = function () { m.remove(); };
    $('#enSi', m).onclick = async function () {
      var pares = [];
      $$('tr[data-k]', m).forEach(function (tr) { var sel = $('.enSel', tr); if ($('.enOk', tr).checked && sel && sel.value) G[+tr.getAttribute('data-k')].ids.forEach(function (id) { pares.push({ compra_id: id, recurso_id: sel.value }); }); });
      if (!pares.length) { m.remove(); return; }
      var b = this; b.disabled = true; b.textContent = 'Guardando…';
      try { var tot = 0; for (var i = 0; i < pares.length; i += 500) tot += (await global.ObraAPI.compraEnlazar(pares.slice(i, i + 500), oid())).enlazados;
        m.remove(); toast('<b>' + tot + '</b> pedido(s) enlazados con el maestro'); await cargar(); }
      catch (e) { alert(e.message || String(e)); b.disabled = false; b.textContent = 'Enlazar marcados'; }
    };
    cuenta();
  }

  // ------------------------------------------------------------ necesidad por recurso
  function necesidad() {
    var porRec = {};
    var itemsById = {}; D.items.forEach(function (i) { itemsById[i.id] = i; });
    D.itemRecurso.forEach(function (x) {
      var it = itemsById[x.item_id]; if (!it) return;
      var r = porRec[x.recurso_id] = porRec[x.recurso_id] || { id: x.recurso_id, nombre: (REC[x.recurso_id] || {}).nombre || x.nombre, um: (REC[x.recurso_id] || {}).um || '',
        tipo: (REC[x.recurso_id] || {}).tipo || x.tipo, nec: 0, costo: 0, items: [], pedido: 0, recibido: 0, monto: 0, nPed: 0 };
      var q = n(it.cantVigente) * n(x.cant_unitaria);
      r.nec += q; r.costo += q * n(x.costo_unitario);
      r.items.push({ it: it, cu: x.cant_unitaria, q: q, costo: x.costo_unitario });
    });
    D.compras.forEach(function (c) {
      if (!c.recurso_id || c.aprobacion === 'Rechazado') return;
      var r = porRec[c.recurso_id] = porRec[c.recurso_id] || { id: c.recurso_id, nombre: recNombre(c.recurso_id) || c.descripcion, um: (REC[c.recurso_id] || {}).um || c.um,
        tipo: (REC[c.recurso_id] || {}).tipo || '', nec: 0, costo: 0, items: [], pedido: 0, recibido: 0, monto: 0, nPed: 0 };
      r.pedido += n(c.cantidad); r.nPed++;
      if (c.entrega === 'Recibido') r.recibido += vacio(c.cant_recibida) ? n(c.cantidad) : n(c.cant_recibida);
      var m = montoRef(c); if (m !== null) r.monto += m;
    });
    return Object.keys(porRec).map(function (k) { return porRec[k]; });
  }
  function htmlNecesidad() {
    var L = necesidad();
    var tipos = {}; L.forEach(function (r) { if (r.tipo) tipos[r.tipo] = 1; });
    var t = norm(FILN.txt);
    var V = L.filter(function (r) {
      if (FILN.tipo && r.tipo !== FILN.tipo) return false;
      if (FILN.solo && !(r.nec - r.pedido > 1e-9)) return false;
      return !t || norm(r.id + ' ' + r.nombre).indexOf(t) >= 0;
    }).sort(function (a, b) { return b.costo - a.costo || b.nec - a.nec; });
    var sinRec = D.compras.filter(function (c) { return !c.recurso_id; }).length;
    var h = '<div class="cm-info">Necesidad = cantidad vigente del ítem × cantidad unitaria del recurso (desglose del recosteo). Pedido = pedidos no rechazados con ese recurso; recibido = los marcados como recibidos.' +
      (sinRec ? ' <b>' + sinRec + ' pedido(s) no tienen recurso asignado</b> y no suman acá: abrilos y elegí el recurso del maestro.' : '') + '</div>';
    if (!D.itemRecurso.length) h += '<div class="cm-info" style="background:#fff4e0">Esta obra todavía no tiene cargados los recursos por ítem. Bajá la planilla o exportá <b>CONSOLIDADO_RECURSOS_RECOSTEO</b> desde Power BI y subila con «⬆ Cargar recursos por ítem».</div>';
    h += '<div class="cm-bar"><input type="search" id="cmNt" placeholder="Buscar recurso…" value="' + esc(FILN.txt) + '">' +
      '<select id="cmNtipo"><option value="">Todos los tipos</option>' + Object.keys(tipos).sort().map(function (x) { return '<option' + (x === FILN.tipo ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<label style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="cmNsolo"' + (FILN.solo ? ' checked' : '') + '> Solo con saldo por pedir</label></div>';
    if (!V.length) return h + '<div class="cm-vacio">No hay recursos para mostrar.</div>';
    h += '<div class="cm-tw"><table class="cm-t"><thead><tr><th>Recurso</th><th>Tipo</th><th>UM</th><th class="r">Necesario</th><th class="r">Pedido</th><th class="r">Saldo por pedir</th><th class="r">Recibido</th><th class="r">Costo previsto</th><th class="r">Comprado</th><th class="r">Ítems</th></tr></thead><tbody>';
    V.forEach(function (r) {
      var saldo = r.nec - r.pedido, ab = !!ABIERTO[r.id];
      h += '<tr class="cl" data-rec="' + esc(r.id) + '"><td>' + (r.items.length ? (ab ? '▾ ' : '▸ ') : '') + '<b>' + esc(r.id) + '</b> · ' + esc(r.nombre) + '</td><td>' + esc(r.tipo) + '</td><td>' + esc(r.um) + '</td>' +
        '<td class="r">' + fq(r.nec) + '</td><td class="r">' + fq(r.pedido) + (r.nPed ? '<small>' + r.nPed + ' pedido(s)</small>' : '') + '</td>' +
        '<td class="r ' + (saldo > 1e-9 ? 'cm-neg' : saldo < -1e-9 ? 'cm-pos' : '') + '">' + fq(saldo) + '</td><td class="r">' + fq(r.recibido) + '</td>' +
        '<td class="r">' + fg(r.costo) + '</td><td class="r">' + fg(r.monto) + '</td><td class="r">' + r.items.length + '</td></tr>';
      if (ab) r.items.forEach(function (x) {
        h += '<tr class="sub"><td style="padding-left:28px">' + esc(x.it.id + ' · ' + x.it.desc) + '</td><td></td><td>' + esc(x.it.um) + '</td><td class="r">' + fq(x.q) + '<small>' + fq(x.it.cantVigente) + ' × ' + fq(x.cu) + '</small></td>' +
          '<td colspan="3"></td><td class="r">' + fg(x.q * n(x.costo)) + '</td><td colspan="2"></td></tr>';
      });
    });
    return h + '</tbody></table></div>';
  }

  // ------------------------------------------------------------ maestro de recursos
  function htmlRecursos() {
    var t = norm(FILR.txt), tipos = {};
    D.recursos.forEach(function (r) { if (r.tipo) tipos[r.tipo] = 1; });
    var usos = {}; D.compras.forEach(function (c) { if (c.recurso_id) usos[c.recurso_id] = (usos[c.recurso_id] || 0) + 1; });
    var V = D.recursos.filter(function (r) {
      if (FILR.tipo && r.tipo !== FILR.tipo) return false;
      return !t || norm([r.recurso_id, r.nombre, r.clase, r.codigo_unysoft, r.nombre_unysoft, r.modelo_equipo].join(' ')).indexOf(t) >= 0;
    });
    var h = '<div class="cm-bar"><input type="search" id="cmRt" placeholder="Buscar por código, nombre, clase o código Unysoft…" value="' + esc(FILR.txt) + '" style="min-width:320px">' +
      '<select id="cmRtipo"><option value="">Todos los tipos</option>' + Object.keys(tipos).sort().map(function (x) { return '<option' + (x === FILR.tipo ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<span style="font-size:13px;color:#4a5568">' + V.length + ' recurso(s)</span></div>';
    if (!D.recursos.length) return h + '<div class="cm-vacio">El maestro de recursos está vacío.' + (esAdmin() ? ' Exportá <b>MAESTRO_RECURSOS_PRESUPUESTO</b> desde Power BI (o la planilla de origen) y subila con «⬆ Cargar maestro».' : '') + '</div>';
    h += '<div class="cm-tw"><table class="cm-t"><thead><tr><th>Código</th><th>Nombre</th><th>UM</th><th>Tipo</th><th>Clase</th><th>Modelo equipo</th><th>Código Unysoft</th><th>Nombre Unysoft</th><th class="r">Precio en la obra (s/IVA)</th><th class="r">Pedidos en la obra</th></tr></thead><tbody>' +
      V.slice(0, 800).map(function (r) {
        return '<tr><td><b>' + esc(r.recurso_id) + '</b></td><td>' + esc(r.nombre) + '</td><td>' + esc(r.um) + '</td><td>' + esc(r.tipo) + '</td><td>' + esc(r.clase) + '</td><td>' + esc(r.modelo_equipo) + '</td>' +
          '<td>' + esc(r.codigo_unysoft) + '</td><td>' + esc(r.nombre_unysoft) + '</td><td class="r">' + fg(precioLista(r.recurso_id)) + '</td><td class="r">' + (usos[r.recurso_id] || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (V.length > 800) h += '<div class="cm-info" style="margin-top:8px">Se muestran 800; afiná la búsqueda.</div>';
    return h;
  }

  // ------------------------------------------------------------ enlaces
  function enlazar() {
    $$('[data-vista]').forEach(function (b) { b.onclick = function () { VISTA = b.getAttribute('data-vista'); render(); }; });
    var txt = function (id, obj, k) {
      var e = $('#' + id); if (!e) return;
      e.oninput = function () { obj[k] = e.value; var p = e.selectionStart; render(); var e2 = $('#' + id); if (e2) { e2.focus(); e2.setSelectionRange(p, p); } };
    };
    var sel = function (id, obj, k) { var e = $('#' + id); if (e) e.onchange = function () { obj[k] = e.type === 'checkbox' ? e.checked : e.value; render(); }; };
    txt('cmFt', FIL, 'txt'); sel('cmFa', FIL, 'aprob'); sel('cmFo', FIL, 'oc'); sel('cmFe', FIL, 'ent');
    txt('cmNt', FILN, 'txt'); sel('cmNtipo', FILN, 'tipo'); sel('cmNsolo', FILN, 'solo');
    txt('cmRt', FILR, 'txt'); sel('cmRtipo', FILR, 'tipo');
    $$('tr[data-ed]').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('[data-del]')) return; abrirPedido(tr.getAttribute('data-ed')); }; });
    $$('[data-del]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); borrar(b.getAttribute('data-del')); }; });
    $$('tr[data-rec]').forEach(function (tr) { tr.onclick = function () { var k = tr.getAttribute('data-rec'); ABIERTO[k] = !ABIERTO[k]; render(); }; });
    if ($('#cmNuevo')) $('#cmNuevo').onclick = function () { abrirPedido(null); };
    if ($('#cmEnlazar')) $('#cmEnlazar').onclick = enlazarRecursos;
    if ($('#cmXls')) $('#cmXls').onclick = function () { excelPedidos().catch(err); };
    if ($('#cmRecXls')) $('#cmRecXls').onclick = function () { excelRecursos().catch(err); };
    if ($('#cmIrPlant')) $('#cmIrPlant').onclick = function () { plantillaIR().catch(err); };
    archivo('cmMonday', importarMonday); archivo('cmIrFile', importarIR); archivo('cmRecFile', importarRecursos);
  }
  function err(e) { alert('No se pudo completar: ' + (e && e.message || e)); }
  function archivo(id, fn) {
    var e = $('#' + id); if (!e) return;
    e.onchange = function (ev) { var f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) fn(f).catch(err); };
  }

  // ------------------------------------------------------------ Excel: utilidades
  function cargarLib() {
    if (global.ExcelJS) return Promise.resolve(global.ExcelJS);
    return new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = 'exceljs.min.js?v=4.4.0';
      s.onload = function () { ok(global.ExcelJS); }; s.onerror = function () { mal(new Error('no se pudo cargar la librería de Excel (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
  }
  function bajar(wb, nombre) {
    return wb.xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
  }
  function hoja(wb, nombre, cols) {
    var ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map(function (c) { return { header: c[0], width: c[1] }; });
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EBF0' } };
    return ws;
  }
  function valor(c) {
    var v = c && c.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if ('result' in v) return v.result === undefined || (v.result && v.result.error) ? '' : v.result;
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join('');
      if (v.text) return v.text;
      if (v.hyperlink) return v.text || v.hyperlink;
      return '';
    }
    return v;
  }
  function iso(v) {
    if (v instanceof Date) return v.getUTCFullYear() + '-' + ('0' + (v.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + v.getUTCDate()).slice(-2);
    var s = String(v || '').trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/))) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    if (typeof v === 'number' && v > 20000 && v < 80000) { var d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return iso(d); }
    // "Apr 30, 2026 10:49 AM" (export de Monday en inglés) o "30 abr 2026"
    var MES = { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12 };
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MES[m[1].toLowerCase()]) return m[3] + '-' + ('0' + MES[m[1].toLowerCase()]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/)) && MES[m[2].toLowerCase()]) return m[3] + '-' + ('0' + MES[m[2].toLowerCase()]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }
  function txt(v) { return v instanceof Date ? iso(v) : String(v == null ? '' : v).trim(); }
  function num(v) { if (typeof v === 'number') return v; return parseNum(v); }
  // lee una hoja como lista de filas {encabezado normalizado: valor} a partir de la fila de encabezado
  function filas(ws, filaEnc) {
    var enc = []; ws.getRow(filaEnc).eachCell({ includeEmpty: true }, function (c, k) { enc[k] = norm(txt(valor(c))); });
    var out = [];
    for (var r = filaEnc + 1; r <= ws.rowCount; r++) {
      var row = ws.getRow(r), o = {}, hay = false;
      enc.forEach(function (h, k) { if (!h) return; var v = valor(row.getCell(k)); if (v !== '' && v !== null) { o[h] = v; hay = true; } });
      if (hay) out.push(o);
    }
    return out;
  }
  function buscarEnc(ws, palabras) {
    for (var r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      var t = []; ws.getRow(r).eachCell(function (c) { t.push(norm(txt(valor(c)))); });
      if (palabras.every(function (p) { return t.some(function (x) { return x === p || x.indexOf(p) >= 0; }); })) return r;
    }
    return 0;
  }
  function campo(o, nombres) { for (var i = 0; i < nombres.length; i++) { var k = norm(nombres[i]); if (o[k] !== undefined && o[k] !== '') return o[k]; } return ''; }

  // ------------------------------------------------------------ Excel: exportar
  async function excelPedidos() {
    var ExcelJS = await cargarLib(), wb = new ExcelJS.Workbook();
    var ws = hoja(wb, 'Pedidos', [['Fecha solicitud', 12], ['Fecha requerida', 12], ['Anticipación (d)', 10], ['Descripción', 40], ['Recurso', 10], ['Nombre recurso', 32], ['Ítem', 8], ['Descripción ítem', 32], ['Centro de costo', 13],
      ['Cantidad', 11], ['UM', 7], ['Solicitante', 20], ['Observaciones pedido', 30], ['Aprobación', 14], ['Fecha aprobación', 12], ['Proveedor 1', 20], ['P.U. 1', 13], ['Proveedor 2', 20], ['P.U. 2', 13], ['Proveedor 3', 20], ['P.U. 3', 13],
      ['Cotización elegida', 10], ['Estado OC', 16], ['N° OC', 12], ['Fecha OC', 12], ['Monto regular', 15], ['Monto logrado', 15], ['Ahorro', 14], ['Entrega', 12], ['Fecha recepción', 12], ['Cant. recibida', 11], ['Cargado por', 22], ['Monday ID', 14]]);
    var dt = function (s) { return s ? new Date(s + 'T12:00:00') : null; };
    filtrados().slice().reverse().forEach(function (c) {
      var it = itemDe(c.item_id) || {};
      var row = ws.addRow([dt(c.fecha_solicitud), dt(c.fecha_requerida), dias(c.fecha_solicitud, c.fecha_requerida), c.descripcion, c.recurso_id || '', recNombre(c.recurso_id), c.item_id || '', it.desc || '', c.codigo_cc,
        c.cantidad, c.um, c.solicitante, c.obs_pedido, c.aprobacion, dt(c.fecha_aprobacion), c.prov1, c.pu1, c.prov2, c.pu2, c.prov3, c.pu3, c.cot_elegida, c.estado_oc, c.orden_compra, dt(c.fecha_oc),
        c.monto_regular, c.monto_logrado, !vacio(c.monto_regular) && !vacio(c.monto_logrado) ? c.monto_regular - c.monto_logrado : null, c.entrega, dt(c.fecha_entrega), c.cant_recibida, c.creado_por, c.monday_id || '']);
      [1, 2, 15, 25, 30].forEach(function (k) { row.getCell(k).numFmt = 'dd/mm/yyyy'; });
      [10, 17, 19, 21, 26, 27, 28, 31].forEach(function (k) { row.getCell(k).numFmt = '#,##0.######'; });
    });
    ws.autoFilter = { from: 'A1', to: { row: 1, column: 33 } };
    await bajar(wb, 'Compras_' + oid() + '_' + hoy() + '.xlsx');
  }
  async function excelRecursos() {
    var ExcelJS = await cargarLib(), wb = new ExcelJS.Workbook();
    var ws = hoja(wb, 'Recursos', [['ID Recurso', 11], ['Nombre de recurso', 46], ['U.M.', 8], ['Tipo Recurso', 16], ['Clase Recurso', 20], ['Modelo Equipo', 18], ['Ubicación Material', 16], ['DMT (Km)', 9], ['ID Alternativo', 12], ['CODIGO RECURSO UNYSOFT', 16], ['NOMBRE RECURSO UNYSOFT', 34]]);
    D.recursos.forEach(function (r) { ws.addRow([r.recurso_id, r.nombre, r.um, r.tipo, r.clase, r.modelo_equipo, r.ubicacion, r.dmt_km, r.id_alternativo, r.codigo_unysoft, r.nombre_unysoft]); });
    await bajar(wb, 'Maestro_recursos_' + hoy() + '.xlsx');
  }
  async function plantillaIR() {
    var ExcelJS = await cargarLib(), wb = new ExcelJS.Workbook();
    var ws = hoja(wb, 'Recursos por item', [['Codigo UN', 12], ['ID Item Obra', 10], ['Desc. Item Obra', 40], ['ID Recurso', 11], ['Nombre de recurso', 36], ['Tipo Recurso', 14], ['Cant. Unitaria Final Recurso', 14], ['Costo unitario', 14], ['ID Recurso Padre', 12]]);
    var cuenta = 0;
    D.itemRecurso.forEach(function (x) {
      var it = itemDe(x.item_id) || {};
      ws.addRow([oid(), x.item_id, it.desc || '', x.recurso_id, x.nombre || recNombre(x.recurso_id), x.tipo, x.cant_unitaria, x.costo_unitario, x.recurso_padre]); cuenta++;
    });
    if (!cuenta) D.items.filter(function (i) { return !i.grupo; }).forEach(function (i) { ws.addRow([oid(), i.id, i.desc, '', '', '', null, null, '']); });
    await bajar(wb, 'Recursos_por_item_' + oid() + '.xlsx');
  }

  // ------------------------------------------------------------ Excel: importar
  async function abrirLibro(file) {
    var ExcelJS = await cargarLib(), wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer()); return wb;
  }
  async function importarRecursos(file) {
    var wb = await abrirLibro(file), ws = null, fe = 0;
    wb.worksheets.some(function (w) { fe = buscarEnc(w, ['id recurso', 'nombre de recurso']); if (fe) { ws = w; return true; } return false; });
    if (!ws) throw new Error('no encontré las columnas "ID Recurso" y "Nombre de recurso".');
    var F = filas(ws, fe).map(function (o) {
      return { recurso_id: txt(campo(o, ['ID Recurso'])), nombre: txt(campo(o, ['Nombre de recurso'])), um: txt(campo(o, ['U.M.', 'UM', 'Unidad'])),
        tipo: txt(campo(o, ['Tipo Recurso'])), clase: txt(campo(o, ['Clase Recurso'])), modelo_equipo: txt(campo(o, ['Modelo Equipo'])),
        ubicacion: txt(campo(o, ['Ubicación Material'])), dmt_km: txt(campo(o, ['DMT (Km)'])), id_alternativo: txt(campo(o, ['ID Alternativo'])),
        codigo_unysoft: txt(campo(o, ['CODIGO RECURSO UNYSOFT'])), nombre_unysoft: txt(campo(o, ['NOMBRE RECURSO UNYSOFT'])) };
    }).filter(function (r) { return r.recurso_id; });
    if (!F.length) throw new Error('la hoja no tiene recursos.');
    var nuevos = F.filter(function (r) { return !REC[r.recurso_id]; }).length;
    if (!confirm('Maestro de recursos: ' + F.length + ' recursos (' + nuevos + ' nuevos, ' + (F.length - nuevos) + ' se actualizan). Los que no están en el archivo no se borran. ¿Cargar?')) return;
    var tot = 0;
    for (var i = 0; i < F.length; i += 400) { var r = await global.ObraAPI.recImportar(F.slice(i, i + 400)); tot += r.recursos; }
    toast('Maestro cargado · <b>' + tot + '</b> recursos'); await cargar();
  }
  async function importarIR(file) {
    var wb = await abrirLibro(file), ws = null, fe = 0;
    wb.worksheets.some(function (w) { fe = buscarEnc(w, ['id recurso']); if (fe) { ws = w; return true; } return false; });
    if (!ws) throw new Error('no encontré la columna "ID Recurso".');
    var o = oid(), otros = 0, sinItem = 0, ids = {};
    D.items.forEach(function (i) { ids[i.id] = 1; });
    var F = [];
    filas(ws, fe).forEach(function (r) {
      var un = txt(campo(r, ['Codigo UN', 'CODIGO UN'])), oi = txt(campo(r, ['ID OBRA - ITEM', 'ID OBRA -ITEM']));
      // "ID OBRA - ITEM" es texto y conserva "10.10"; "ID Item Obra" puede venir como número (10.1)
      var item = oi.indexOf('-') > 0 ? oi.slice(oi.indexOf('-') + 1) : txt(campo(r, ['ID Item Obra', 'ID ITEM DE OBRA CONTRATO', 'Item']));
      if (oi.indexOf('-') > 0) un = un || oi.split('-')[0];
      if (!ids[item]) { var a1 = item.replace('.', ','), a2 = item.replace(/\./g, ','); if (ids[a1]) item = a1; else if (ids[a2]) item = a2; }   // CECON usa coma
      if (un && un !== o) { otros++; return; }
      if (!ids[item]) { sinItem++; return; }
      var cu = num(campo(r, ['Cant. Unitaria Final Recurso'])); if (cu === null) cu = num(campo(r, ['Consumo', 'Cuantía']));
      F.push({ item_id: item, recurso_id: txt(campo(r, ['ID Recurso'])), nombre: txt(campo(r, ['Nombre de recurso'])), tipo: txt(campo(r, ['Tipo Recurso'])),
        cant_unitaria: cu, costo_unitario: num(campo(r, ['Costo unitario', 'Costo Unitario'])), recurso_padre: txt(campo(r, ['ID Recurso Padre'])) });
    });
    F = F.filter(function (x) { return x.recurso_id; });
    if (!F.length) throw new Error('no hay filas de esta obra (' + o + ')' + (otros ? ': ' + otros + ' filas son de otras obras' : '') + (sinItem ? ', ' + sinItem + ' con ítems que no existen en el cronograma' : '') + '.');
    if (!confirm('Recursos por ítem de esta obra: ' + F.length + ' filas.' + (otros ? '\n' + otros + ' filas de otras obras se ignoran.' : '') + (sinItem ? '\n' + sinItem + ' filas con ítems que no están en el cronograma se ignoran.' : '') +
      '\n\nReemplaza todo el desglose cargado antes para esta obra. ¿Cargar?')) return;
    var r = await global.ObraAPI.irImportar(F, o);
    toast('Recursos por ítem cargados · <b>' + r.filas + '</b> filas'); await cargar();
  }

  // Export de Monday: fila de grupo, fila de encabezados ("Name" …), filas de ítems.
  var MD = {
    descripcion: ['Name', 'Nombre', 'Descripción de recurso', 'Elemento'], cantidad: ['Cantidad'], um: ['UM'],
    fecha_solicitud: ['Fecha Solicitud', 'Fecha registro', 'Fecha Creación', 'Creation Log'], fecha_requerida: ['Fecha Requerida'],
    solicitante: ['Nombre solicitante'], obra: ['Obra solicitante'], obs_pedido: ['Observaciones de pedido', 'Observaciones de compra'],
    aprobacion: ['Aprobación'], pu1: ['Precio Unit 1'], pu2: ['Precio Unit 2'], pu3: ['Precio Unit 3'], obs_cotizacion: ['Observaciones de cotización'],
    cot: ['Cotización aprobada'], estado_oc: ['Estado OC', 'Estado de compra'], orden_compra: ['Orden de compra'], monto_regular: ['Monto regular (max)'],
    monto_logrado: ['Monto logrado'], entrega: ['Entrega'], fecha_aprobacion: ['Fecha aprobación'], fecha_oc: ['Fecha creación OC', 'Fecha compra'],
    pu_regular: ['PU regular (max)'], pu_logrado: ['PU logrado'], item_id: ['Item ID', 'ID del elemento', 'ID de elemento']
  };
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  async function importarMonday(file) {
    var wb = await abrirLibro(file), ws = wb.worksheets[0];
    if (!ws) throw new Error('el archivo no tiene hojas');
    var tablero = txt(valor(ws.getRow(1).getCell(1)));
    var regs = [], enc = null, grupo = '';
    for (var r = 1; r <= ws.rowCount; r++) {
      var row = ws.getRow(r), cells = [];
      row.eachCell({ includeEmpty: true }, function (c, k) { cells[k] = valor(c); });
      var a = norm(txt(cells[1]));
      var llenas = cells.filter(function (x) { return x !== '' && x !== null && x !== undefined; }).length;
      if (!llenas) continue;
      if (['name', 'nombre', 'elemento', 'descripcion de recurso'].indexOf(a) >= 0 && llenas > 3) {
        enc = {}; cells.forEach(function (v, k) { if (v !== '' && v != null) enc[norm(txt(v))] = k; }); continue;
      }
      if (a === 'subitems' || a === 'subelementos') { enc = null; continue; }   // los subelementos no se importan
      if (!enc) { if (llenas === 1 && r > 1) grupo = txt(cells[1]); continue; }
      if (llenas === 1 && r > 1 && txt(cells[1])) { grupo = txt(cells[1]); enc = null; continue; }
      // se copian los valores YA (cells/enc cambian en la próxima vuelta)
      var vals = {};
      Object.keys(MD).forEach(function (k) { var ns = MD[k]; for (var i = 0; i < ns.length; i++) { var c = enc[norm(ns[i])]; if (c && cells[c] !== '' && cells[c] != null) { vals[k] = cells[c]; return; } } vals[k] = ''; });
      var desc = txt(vals.descripcion); if (!desc) continue;
      regs.push({ g: (function (v) { return function (k) { return v[k]; }; })(vals), grupo: grupo, desc: desc });
    }
    if (!regs.length) throw new Error('no reconocí el formato del export de Monday (busco una fila de encabezados que empiece con "Name").');
    // ¿qué etiquetas de obra corresponden a esta obra?
    var claves = {}; regs.forEach(function (x) { var k = txt(x.g('obra')) || x.grupo || '(sin obra)'; claves[k] = (claves[k] || 0) + 1; x.clave = k; });
    var nombreObra = norm(($('#obraSel') && $('#obraSel').selectedOptions[0] ? $('#obraSel').selectedOptions[0].textContent : '') + ' ' + oid());
    var GENERICAS = { ruta: 1, obra: 1, obras: 1, consorcio: 1, lote: 1, pedidos: 1, pedido: 1, grupo: 1, zona: 1, urbana: 1 };
    var palabras = nombreObra.split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3 && !GENERICAS[w]; });
    var elegidas = await elegirClaves(tablero, claves, function (k) { var nk = norm(k), sin = nk.replace(/[^a-z0-9]/g, ''); return palabras.some(function (w) { return nk.indexOf(w) >= 0 || sin.indexOf(w) >= 0; }); });
    if (!elegidas) return;
    var vistos = {};
    var F = regs.filter(function (x) { return elegidas[x.clave]; }).map(function (x) {
      var g = x.g, cot = txt(g('cot')).match(/(\d)/);
      var q = num(g('cantidad'));
      var p = { descripcion: x.desc, cantidad: q, um: txt(g('um')), fecha_solicitud: iso(g('fecha_solicitud')), fecha_requerida: iso(g('fecha_requerida')),
        solicitante: txt(g('solicitante')), obs_pedido: txt(g('obs_pedido')), aprobacion: txt(g('aprobacion')), fecha_aprobacion: iso(g('fecha_aprobacion')),
        pu1: num(g('pu1')), pu2: num(g('pu2')), pu3: num(g('pu3')), cot_elegida: cot ? +cot[1] : null, obs_cotizacion: txt(g('obs_cotizacion')),
        estado_oc: txt(g('estado_oc')), orden_compra: txt(g('orden_compra')), fecha_oc: iso(g('fecha_oc')),
        monto_regular: num(g('monto_regular')), monto_logrado: num(g('monto_logrado')), entrega: txt(g('entrega')), creado_por: 'monday' };
      if (estadoCompraEstrategica(p.estado_oc)) { p.entrega = p.estado_oc === 'Recibido' ? 'Recibido' : p.entrega; }
      var pr = num(g('pu_regular')), pl = num(g('pu_logrado'));
      if (pl !== null && p.pu1 === null) { p.pu1 = pl; p.cot_elegida = 1; }
      if (pr !== null && p.monto_regular === null && q !== null) p.monto_regular = pr * q;
      var mid = txt(g('item_id'));
      p.monday_id = mid || ('h' + hash([tablero, x.desc, p.fecha_solicitud, p.solicitante, q, x.clave].join('|')));
      // pedidos idénticos en el mismo archivo: el 2º, 3º… llevan sufijo (igual que la carga inicial)
      vistos[p.monday_id] = (vistos[p.monday_id] || 0) + 1;
      if (vistos[p.monday_id] > 1) p.monday_id += '_' + vistos[p.monday_id];
      var r = D.recursos.filter(function (rr) { return norm(rr.nombre) === norm(x.desc); })[0]; if (r) p.recurso_id = r.recurso_id;
      return p;
    });
    if (!F.length) { toast('No se eligió ninguna obra: no se importó nada.'); return; }
    var tot = { nuevos: 0, actualizados: 0 };
    for (var i = 0; i < F.length; i += 300) { var res = await global.ObraAPI.compraImportar(F.slice(i, i + 300), oid()); tot.nuevos += res.nuevos; tot.actualizados += res.actualizados; }
    toast('Monday importado · <b>' + tot.nuevos + '</b> nuevos · <b>' + tot.actualizados + '</b> actualizados'); await cargar();
  }
  function estadoCompraEstrategica(e) { return /recibid/i.test(e || ''); }
  function elegirClaves(tablero, claves, sugerida) {
    return new Promise(function (ok) {
      var m = document.createElement('div'); m.className = 'cm-modal';
      var ks = Object.keys(claves).sort();
      m.innerHTML = '<div class="cm-box" style="max-width:720px"><h3>Importar de Monday</h3><p class="sub">' + esc(tablero) + ' · ' +
        Object.keys(claves).reduce(function (s, k) { return s + claves[k]; }, 0) + ' pedidos. Marcá qué obra solicitante (o grupo) corresponde a <b>esta</b> obra. ' +
        'Los pedidos que ya estaban se actualizan; no se duplican.</p><div class="cm-map">' +
        ks.map(function (k, i) { return '<label><input type="checkbox" data-k="' + i + '"' + (sugerida(k) ? ' checked' : '') + '> ' + esc(k) + ' <span style="color:#7a8699">(' + claves[k] + ')</span></label>'; }).join('') +
        '</div><div class="cm-acc"><button class="cm-btn" id="mdNo">Cancelar</button><button class="cm-btn pri" id="mdSi">Importar</button></div></div>';
      document.body.appendChild(m);
      $('#mdNo', m).onclick = function () { m.remove(); ok(null); };
      $('#mdSi', m).onclick = function () { var r = {}; $$('input[data-k]', m).forEach(function (c) { if (c.checked) r[ks[+c.getAttribute('data-k')]] = true; }); m.remove(); ok(r); };
    });
  }

  // ------------------------------------------------------------ carga / API pública
  async function cargar() {
    D = await global.ObraAPI.comprasDatos(oid());
    REC = {}; D.recursos.forEach(function (r) { REC[String(r.recurso_id)] = r; });
    render();
  }
  function abrir() {
    var o = oid();
    if (D && obraCargada === o) { render(); return; }
    D = null; ABIERTO = {}; render();
    obraCargada = o;
    cargar().catch(function (e) { var v = $('#v-compras'); if (v) v.innerHTML = '<div class="cm-wrap"><div class="cm-vacio">No se pudo cargar compras: ' + esc(e.message) + '</div></div>'; });
  }
  function engancharPestana() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'compras') abrir(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', engancharPestana); else engancharPestana();

  global.ComprasView = {
    abrir: abrir,
    reset: function () { D = null; obraCargada = null; },
    _estado: function () { return { D: D, VISTA: VISTA }; }
  };
})(window);
