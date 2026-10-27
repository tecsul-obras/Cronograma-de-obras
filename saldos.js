/* =========================================================================
 * saldos.js — Avance / Informes › SALDOS DE OBRA · v20261020b
 *
 * Sub-pestaña dentro de Avance / Informes con dos vistas:
 *  · Ítems: por ítem de contrato, cantidad vigente, ejecutado, SALDO (cantidad
 *    pendiente de ejecutar), monto pendiente (saldo × precio unitario, con IVA)
 *    y costo directo pendiente (saldo × costo directo unitario, sin IVA).
 *    Títulos con subtotales. Ejecutado = producción (curva 3) o certificación.
 *  · Recursos pendientes: por recurso, lo que necesita el saldo por ejecutar
 *    (saldo × consumo unitario del APU) y lo que falta comprar
 *    (necesario total − pedido), con su costo.
 *
 * Fuente de costos y consumos: el mismo desglose que Compras › Necesidad
 * (RPC compras_desglose = APU de la pestaña Costos, último recosteo o el
 * presupuesto; si la obra no tiene APU, el desglose cargado en item_recurso).
 * Cantidades: cantVigente() del cronograma (fuente única). Sin redondeo en el
 * dato; en pantalla se muestran sin decimales los montos (el exacto en title).
 * Sobre-ejecución: saldo negativo en rojo, nunca se recorta; los totales de
 * "pendiente" suman solo saldos positivos (la sobre-ejecución de un ítem no
 * descuenta lo pendiente de otro) y la sobre-ejecución se informa aparte.
 *
 * Costos: los ven admin, gerente y residente (igual que Costos). Recursos:
 * además el rol compras. No escribe nada.
 * No toca la lógica de app.js: envuelve renderReport para refrescarse.
 * v20261020b: tablas ordenables con clic en el encabezado (2º clic invierte;
 *   «Ítem» vuelve al orden del cronograma con títulos). El Excel sale igual.
 *   También ordena la tabla «Resumen de avance por ítem» de la vista Avance.
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function leer(n) { try { return (0, eval)(n); } catch (e) { return undefined; } }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function rol() { return global.__role || ''; }
  function veCostos() { return ['admin', 'gerente', 'residente'].indexOf(rol()) >= 0; }
  function veRecursos() { return veCostos() || rol() === 'compras'; }
  function obraId() { try { return global.ObraAPI.getObraId(); } catch (e) { var o = leer('OBRA'); return o && o.id || ''; } }
  function key(v) { return String(v == null ? '' : v).trim().replace(/,/g, '.'); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  var EPS = 1e-9, IVA = 0.1;

  // ---------------------------------------------------------------- formatos
  function fg(v) { return v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('es-PY'); }
  function fq(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), d = a < 10 ? 4 : (a < 1000 ? 2 : 0);
    return Number(v).toLocaleString('es-PY', { maximumFractionDigits: d });
  }
  function fp(v) { return v == null || !isFinite(v) ? '—' : v.toLocaleString('es-PY', { maximumFractionDigits: 1 }) + ' %'; }
  function ex(v) { return v == null || !isFinite(v) ? '' : String(v); }
  function cls(v) { return v < -EPS ? 'sl-neg' : (Math.abs(v) <= EPS ? 'sl-cero' : ''); }
  // N° de ítem por número y no como texto: 1, 2, 3 … 10, 10.1 … 10.10
  function cmpItem(a, b) {
    var x = String(a == null ? '' : a).replace(/,/g, '.').split(/[.\s]+/), y = String(b == null ? '' : b).replace(/,/g, '.').split(/[.\s]+/);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
      var nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
      if (nx && ny) { var d = Number(x[i]) - Number(y[i]); if (d) return d; continue; }
      if (nx !== ny) return nx ? -1 : 1;
      var c = x[i].localeCompare(y[i], 'es', { numeric: true, sensitivity: 'base' }); if (c) return c;
    }
    return 0;
  }

  /* ---------------------------------------------- orden por encabezado
     COLS: { clave: { v: fila → valor, t: true si es texto } }. Vacíos siempre al final.
     Primer clic: texto A→Z, números de mayor a menor; el segundo invierte. */
  var COLS_I = {
    id: { v: function (x) { return x.i.id; }, id: true },
    desc: { v: function (x) { return x.i.desc || ''; }, t: true },
    um: { v: function (x) { return x.i.um || ''; }, t: true },
    cv: { v: function (x) { return x.cv; } }, ej: { v: function (x) { return x.ej; } },
    sd: { v: function (x) { return x.sd; } },
    monto: { v: function (x) { return x.sd < -EPS ? x.mSd : x.mPend; } },
    cu: { v: function (x) { return x.cu; } }, cPend: { v: function (x) { return x.cPend; } }
  };
  var COLS_R = {
    nombre: { v: function (r) { return r.nombre || r.id; }, t: true },
    tipo: { v: function (r) { return r.tipo; }, t: true }, um: { v: function (r) { return r.um; }, t: true },
    nec: { v: function (r) { return r.nec; } }, pedido: { v: function (r) { return r.pedido; } },
    porPedir: { v: function (r) { return r.porPedir; } }, costoPorPedir: { v: function (r) { return r.costoPorPedir; } },
    necSd: { v: function (r) { return r.necSd; } }, costoSd: { v: function (r) { return r.costoSd; } }, pu: { v: function (r) { return r.pu; } }
  };
  function ordenar(L, cols, st) {
    var c = cols[st.k]; if (!c) return L;
    var vac = function (v) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)); };
    return L.slice().sort(function (a, b) {
      var x = c.v(a), y = c.v(b);
      if (vac(x) || vac(y)) return vac(x) === vac(y) ? 0 : (vac(x) ? 1 : -1);
      var r = c.id ? cmpItem(x, y) : (c.t ? String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' }) : x - y);
      return r * st.d;
    });
  }
  function th(lab, k, grupo, st, cl, tit) {
    var on = st.k === k || (grupo === 'i' && k === 'id' && !st.k);
    var fl = on ? (st.d > 0 ? ' ▲' : ' ▼') : '';
    return '<th class="sl-sort' + (on ? ' on' : '') + (cl ? ' ' + cl : '') + '" data-sk="' + k + '" data-sg="' + grupo + '" title="' + esc((tit ? tit + ' · ' : '') + 'Clic para ordenar') + '">' + lab + '<span class="sl-fl">' + fl + '</span></th>';
  }
  function clicOrden(grupo, k) {
    var st = grupo === 'i' ? S.sortI : S.sortR, cols = grupo === 'i' ? COLS_I : COLS_R;
    if (grupo === 'i' && k === 'id') {          // «Ítem»: orden del cronograma (con títulos) ↔ inverso
      if (!st.k) { st.k = 'id'; st.d = -1; } else if (st.k === 'id' && st.d < 0) { st.k = ''; st.d = 1; } else { st.k = ''; st.d = 1; }
    } else if (st.k === k) st.d = -st.d;
    else { st.k = k; st.d = cols[k] && cols[k].t ? 1 : -1; }
    render();
  }

  // ---------------------------------------------------------------- estado
  var S = {
    sub: 'avance',                        // 'avance' | 'saldos'
    vista: 'items',                       // 'items' | 'recursos'
    base: null,                           // 'prod' | 'cert'
    txt: '', solo: true,                  // filtros de ítems
    rtxt: '', tipo: 'Materiales', modo: 'desg', rsolo: true,
    sortI: { k: '', d: 1 },               // ítems: '' = orden del cronograma (con títulos)
    sortR: { k: 'costoPorPedir', d: -1 }, // recursos
    abiertos: {}
  };
  try { var g = JSON.parse(localStorage.getItem('saldos:pref') || '{}'); ['sub', 'vista', 'tipo', 'modo'].forEach(function (k) { if (g[k] != null) S[k] = g[k]; }); } catch (e) {}
  function guardarPref() { try { localStorage.setItem('saldos:pref', JSON.stringify({ sub: S.sub, vista: S.vista, tipo: S.tipo, modo: S.modo })); } catch (e) {} }

  var DAT = { obra: null, p: null, d: null, err: '' };
  function datos(forzar) {
    var o = obraId();
    if (!forzar && DAT.obra === o && (DAT.d || DAT.p)) return DAT.p;
    DAT = { obra: o, p: null, d: null, err: '' };
    if (!global.ObraAPI || !global.ObraAPI.comprasDatos) { DAT.err = 'API no disponible'; return Promise.resolve(null); }
    var mio = DAT;
    mio.p = global.ObraAPI.comprasDatos(o).then(function (d) {
      if (DAT !== mio) return null;
      var rec = {}; (d.recursos || []).forEach(function (r) { rec[String(r.recurso_id)] = r; });
      d.REC = rec; mio.d = d; return d;
    }, function (e) { if (DAT === mio) mio.err = e && e.message || String(e); return null; });
    return mio.p;
  }

  /* ======================================================================
   * 1. CÁLCULO
   * ====================================================================== */
  function hayCert() { var C = leer('CERT') || {}; return Object.keys(C).length > 0; }
  function base() {
    if (S.base === 'cert' && !hayCert()) return 'prod';
    if (S.base) return S.base;
    var kr = leer('kpiReal'); var v = 'real'; try { v = kr ? kr() : 'real'; } catch (e) {}
    return v === 'certificado' && hayCert() ? 'cert' : 'prod';
  }
  function ejecutado(i, cv) {
    if (base() === 'cert') { var C = (leer('CERT') || {})[i.id]; return C && C.total ? n(C.total) : 0; }
    var P = (leer('PROD') || {})[i.id];
    if (P && P.total) return n(P.total);
    return i.avance_real_prod != null ? cv * n(i.avance_real_prod) / 100 : 0;
  }

  /* filas del desglose sin doble conteo de in situ (mismo criterio que Compras):
     'desg' = componentes (sin el renglón del in situ que los tiene); 'sin' = solo renglones sin padre */
  function filasDesglose(d, modo) {
    var up = function (v) { return String(v || '').trim().toUpperCase(); };
    var conHijos = {};
    d.itemRecurso.forEach(function (x) { if (x.recurso_padre) conHijos[key(x.item_id) + '|' + up(x.recurso_padre)] = 1; });
    return d.itemRecurso.filter(function (x) {
      if (modo === 'sin') return !x.recurso_padre;
      return !!x.recurso_padre || !conHijos[key(x.item_id) + '|' + up(x.recurso_id)];
    });
  }
  // costo directo unitario por ítem = Σ consumo × costo unitario (renglones sin padre)
  function costoUnitPorItem(d) {
    var cu = {};
    if (!d) return cu;
    filasDesglose(d, 'sin').forEach(function (x) {
      var k = key(x.item_id); cu[k] = (cu[k] || 0) + n(x.cant_unitaria) * n(x.costo_unitario);
    });
    return cu;
  }

  function calcItems() {
    var ITEMS = leer('ITEMS') || [], cantVig = leer('cantVigente'), tipoDe = leer('tipoDe'),
        colga = leer('colgaDeItem'), padre = leer('padreDeItem');
    var d = veCostos() ? DAT.d : null, CU = costoUnitPorItem(d), conCosto = !!(d && d.itemRecurso && d.itemRecurso.length);
    var filas = [], porId = new Map(), T = { vig: 0, pend: 0, costo: 0, montoCosto: 0, over: 0, nOver: 0, nPend: 0, nSinCosto: 0, n: 0, ejec: 0 };
    ITEMS.forEach(function (i) {
      if (colga && colga(i)) return;
      var t = tipoDe ? tipoDe(i) : 'item';
      if (t === 'grupo') { var g = { i: i, grupo: true, pend: 0, costo: 0, vig: 0, hay: false }; filas.push(g); porId.set(i, g); return; }
      if (t !== 'item') return;           // actividades / hitos: sin cantidad
      var cv = n(cantVig ? cantVig(i) : i.cant), ej = ejecutado(i, cv), sd = cv - ej, pu = n(i.pu);
      var k = key(i.id), cu = Object.prototype.hasOwnProperty.call(CU, k) ? CU[k] : null;
      var sp = Math.max(0, sd);
      var f = { i: i, cv: cv, ej: ej, sd: sd, pu: pu, mPend: sp * pu, mSd: sd * pu, cu: cu, cPend: cu == null ? null : sp * cu,
                pct: cv ? sd / cv * 100 : null };
      filas.push(f);
      T.n++; T.vig += cv * pu; T.ejec += ej * pu;
      if (sd > EPS) { T.nPend++; T.pend += f.mPend; }
      if (sd < -EPS) { T.nOver++; T.over += -sd * pu; }
      if (f.cPend != null) { T.costo += f.cPend; T.montoCosto += f.mPend; }
      else if (sd > EPS && conCosto) T.nSinCosto++;
      // subtotales de los títulos (cadena de padres)
      var p = padre ? padre(i) : null, guard = 0;
      while (p && guard++ < 30) {
        var gg = porId.get(p);
        if (gg) { gg.pend += f.mPend; gg.vig += cv * pu; if (f.cPend != null) gg.costo += f.cPend; }
        p = padre(p);
      }
    });
    return { filas: filas, T: T, conCosto: conCosto, d: d };
  }

  function calcRecursos(modo) {
    var d = DAT.d; if (!d) return null;
    var ITEMS = leer('ITEMS') || [], cantVig = leer('cantVigente'), tipoDe = leer('tipoDe');
    var it = {};
    ITEMS.forEach(function (i) {
      if (tipoDe && tipoDe(i) !== 'item') return;
      var cv = n(cantVig ? cantVig(i) : i.cant), ej = ejecutado(i, cv);
      it[key(i.id)] = { i: i, cv: cv, sd: cv - ej };
    });
    var REC = d.REC || {}, por = {};
    function r0(id, nom, um, tipo) {
      return por[id] = por[id] || { id: id, nombre: (REC[id] || {}).nombre || nom || id, um: (REC[id] || {}).um || um || '',
        tipo: (REC[id] || {}).tipo || tipo || '', nec: 0, necSd: 0, costo: 0, costoSd: 0, pedido: 0, recibido: 0, items: [] };
    }
    filasDesglose(d, modo).forEach(function (x) {
      var o = it[key(x.item_id)]; if (!o) return;
      var r = r0(String(x.recurso_id), x.nombre, '', x.tipo);
      var cu = n(x.cant_unitaria), pr = n(x.costo_unitario), qs = Math.max(0, o.sd) * cu, qt = o.cv * cu;
      r.nec += qt; r.necSd += qs; r.costo += qt * pr; r.costoSd += qs * pr;
      r.items.push({ o: o, cu: cu, pr: pr, qs: qs, padre: x.recurso_padre || '' });
    });
    (d.compras || []).forEach(function (c) {
      if (!c.recurso_id || c.aprobacion === 'Rechazado') return;
      var r = r0(String(c.recurso_id), c.descripcion, c.um, '');
      r.pedido += n(c.cantidad);
      if (c.entrega === 'Recibido') r.recibido += c.cant_recibida == null || c.cant_recibida === '' ? n(c.cantidad) : n(c.cant_recibida);
    });
    Object.keys(d.ajustes || {}).forEach(function (rid) { r0(rid, rid, '', '').pedido += n(d.ajustes[rid].cant_pedida); });
    return Object.keys(por).map(function (k) {
      var r = por[k];
      r.pu = r.nec ? r.costo / r.nec : (r.necSd ? r.costoSd / r.necSd : 0);
      r.porPedir = r.nec - r.pedido;                 // + falta pedir · − pedido de más
      r.costoPorPedir = Math.max(0, r.porPedir) * r.pu;
      return r;
    }).filter(function (r) { return r.nec > EPS || r.pedido > EPS; });
  }

  /* ======================================================================
   * 2. PANTALLA
   * ====================================================================== */
  function estilos() {
    if ($('#salCss')) return;
    var st = document.createElement('style'); st.id = 'salCss';
    st.textContent =
      '.rep-sub{display:flex;gap:4px;margin:-4px 0 16px;border-bottom:2px solid #dde3ec;flex-wrap:wrap}' +
      '.rep-sub button{border:0;background:none;padding:9px 16px;font-weight:800;font-size:calc(13px*var(--fs,1));color:#6a7889;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;letter-spacing:.2px}' +
      '.rep-sub button.on{color:#1c2836;border-bottom-color:#e8640a}' +
      '.sl-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}' +
      '.sl-bar input[type=search],.sl-bar select{padding:7px 10px;border:1px solid #cfd7e2;border-radius:8px;font-size:calc(13px*var(--fs,1));background:#fff;color:#1c2836}' +
      '.sl-bar input[type=search]{min-width:200px}.sl-bar label{font-size:calc(13px*var(--fs,1));display:flex;gap:6px;align-items:center;color:#3a4a5e}' +
      '.sl-seg{display:inline-flex;border:1px solid #cfd7e2;border-radius:9px;overflow:hidden;background:#fff}' +
      '.sl-seg button{border:0;background:none;padding:7px 13px;font-size:calc(13px*var(--fs,1));font-weight:700;color:#4a5768;cursor:pointer}' +
      '.sl-seg button+button{border-left:1px solid #cfd7e2}.sl-seg button.on{background:#1c2836;color:#fff}' +
      '.sl-btn{border:1px solid #cfd7e2;background:#fff;border-radius:8px;padding:7px 12px;font-size:calc(13px*var(--fs,1));font-weight:700;cursor:pointer;color:#1c2836}' +
      '.sl-btn:hover{background:#f4f6f9}.sl-grow{flex:1}' +
      '.sl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px}' +
      '.sl-kpis .rkpi small{display:block;font-size:calc(11px*var(--fs,1));color:#6a7889;margin-top:5px;font-weight:600;line-height:1.3}' +
      '.sl-kpis .rk-val{font-size:calc(20px*var(--fs,1))}' +
      '.sl-info{background:#eef4fb;border:1px solid #d5e2f2;color:#2c3e56;border-radius:10px;padding:9px 12px;font-size:calc(12.5px*var(--fs,1));margin-bottom:12px;line-height:1.45}' +
      '.sl-info.warn{background:#fff4e0;border-color:#f3dcb0}' +
      '.sl-tw{overflow:auto;max-height:calc(100vh - 330px);min-height:240px;background:#fff;border:1px solid #dde3ec;border-radius:12px}' +
      '.sl-t{width:100%;border-collapse:collapse;font-size:calc(13px*var(--fs,1))}' +
      '.sl-t th{position:sticky;top:0;z-index:1;background:#f4f6f9;text-align:left;padding:9px 10px;color:#3a4a5e;border-bottom:2px solid #cfd7e2;font-size:calc(11px*var(--fs,1));text-transform:uppercase;letter-spacing:.3px;font-weight:800;white-space:nowrap}' +
      '.sl-t th.r,.sl-t td.r{text-align:right}' +
      '.sl-t th.sl-sort{cursor:pointer;user-select:none}.sl-t th.sl-sort:hover{background:#e6ebf2;color:#1c2836}.sl-t th.sl-sort.on{color:#1c2836;background:#e9eef5}.sl-fl{color:#e8640a;font-size:calc(10px*var(--fs,1))}' +
      '.sl-t td{padding:7px 10px;border-bottom:1px solid #eef1f5;color:#26313f;vertical-align:top}' +
      '.sl-t td.r{font-family:var(--mono);font-weight:600;white-space:nowrap}' +
      '.sl-t td.id{font-family:var(--mono);color:#6a7889;font-weight:700;white-space:nowrap}' +
      '.sl-t td .ds{max-width:420px}' +
      '.sl-t tr.gr td{background:#f0f3f8;font-weight:800;color:#1c2836}' +
      '.sl-t tr.gr td.r{color:#1c2836}' +
      '.sl-t tr.cl{cursor:pointer}.sl-t tr.cl:hover td{background:#eef4fb}' +
      '.sl-t tr.sub td{background:#fafbfd;font-size:calc(12px*var(--fs,1));color:#4a5768}' +
      '.sl-t tr.tot td{background:#1c2836;color:#fff;font-weight:800;position:sticky;bottom:0}' +
      '.sl-t small{display:block;color:#8794a6;font-weight:500;font-size:calc(11px*var(--fs,1))}' +
      '.sl-neg{color:#c0392b!important;font-weight:800!important}.sl-cero{color:#a7b1be!important}.sl-pos{color:#1a7a3d!important}' +
      '.sl-mut{color:#a7b1be}' +
      '.sl-vacio{padding:40px 20px;text-align:center;color:#6a7889;background:#fff;border:1px dashed #cfd7e2;border-radius:12px}' +
      '@media(max-width:760px){.sl-kpis{grid-template-columns:1fr 1fr;gap:8px}.sl-kpis .rkpi{padding:10px 12px}.sl-kpis .rk-val{font-size:calc(16px*var(--fs,1))}.sl-t .hm{display:none}.sl-bar input[type=search]{min-width:0;flex:1}.sl-tw{max-height:none}}';
    document.head.appendChild(st);
  }

  function kpi(lab, val, sub, c) { return '<div class="rkpi"><div class="rk-lab">' + lab + '</div><div class="rk-val ' + (c || '') + '">' + val + '</div>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function seg(attr, cur, ops) {
    return '<div class="sl-seg">' + ops.map(function (o) {
      return '<button type="button" ' + attr + '="' + o[0] + '" class="' + (cur === o[0] ? 'on' : '') + '"' + (o[2] ? ' title="' + esc(o[2]) + '"' : '') + (o[3] ? ' disabled' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function render() {
    var box = $('#repSaldos'); if (!box) return;
    estilos();
    if (!veRecursos() && S.vista === 'recursos') S.vista = 'items';
    var cert = hayCert(), b = base();
    var h = '<div class="sl-bar">' +
      (veRecursos() ? seg('data-slv', S.vista, [['items', 'Saldos por ítem'], ['recursos', 'Recursos pendientes a comprar']]) : '') +
      '<label title="De dónde sale lo ejecutado que se descuenta de la cantidad vigente">Ejecutado según ' +
      '<select id="slBase"><option value="prod"' + (b === 'prod' ? ' selected' : '') + '>producción</option>' +
      '<option value="cert"' + (b === 'cert' ? ' selected' : '') + (cert ? '' : ' disabled') + '>certificación' + (cert ? '' : ' (sin datos)') + '</option></select></label>' +
      '<span class="sl-grow"></span>' +
      (veRecursos() ? '<button type="button" class="sl-btn" id="slRecargar" title="Volver a leer costos y pedidos de compra">↻</button>' : '') +
      '<button type="button" class="sl-btn" id="slXls">⬇ Excel</button></div>';
    var cuerpo;
    if (S.vista === 'recursos') cuerpo = htmlRecursos();
    else cuerpo = htmlItems();
    box.innerHTML = h + cuerpo;
    enlazar(box);
  }

  // ---------------------------------------------------------- vista ítems
  function htmlItems() {
    var vc = veCostos();
    if (vc && !DAT.d && !DAT.err) datos().then(function () { if (visible()) render(); });
    var R = calcItems(), T = R.T, f = norm(S.txt);
    var h = '';
    var marg = T.montoCosto - T.costo * (1 + IVA);
    h += '<div class="sl-kpis">' +
      kpi('Monto pendiente de ejecutar', fg(T.pend), (T.vig ? fp(T.pend / T.vig * 100) + ' del monto vigente · ' : '') + T.nPend + ' ítem(s) con saldo', 'tape') +
      kpi('Monto ejecutado', fg(T.ejec), (T.vig ? fp(T.ejec / T.vig * 100) + ' · ' : '') + (base() === 'cert' ? 'según certificación' : 'según producción')) +
      kpi('Monto vigente', fg(T.vig), 'Σ cantidad vigente × precio unitario (con IVA)', 'plan') +
      (vc ? kpi('Costo directo pendiente', R.conCosto ? fg(T.costo) : '—', R.conCosto
          ? 'saldo × costo directo unitario (sin IVA)' + (T.nSinCosto ? ' · <b style="color:#c0392b">' + T.nSinCosto + ' ítem(s) con saldo sin costo</b>' : '')
          : (DAT.err ? 'no se pudo leer: ' + esc(DAT.err) : (DAT.d ? 'la obra no tiene costos cargados' : 'cargando…'))) : '') +
      (vc && R.conCosto ? kpi('Margen pendiente estimado', fg(marg), 'monto pendiente − costo × ' + (1 + IVA).toLocaleString('es-PY') + (T.montoCosto ? ' · ' + fp(marg / T.montoCosto * 100) : ''), marg < 0 ? 'neg' : 'pos') : '') +
      kpi('Sobre-ejecución', T.nOver ? fg(T.over) : '0', T.nOver ? T.nOver + ' ítem(s) con saldo negativo (no descuentan del pendiente)' : 'ningún ítem pasado de la cantidad vigente', T.nOver ? 'neg' : '') +
      '</div>';
    if (vc && R.d && R.d.fuenteDesglose) h += '<div class="sl-info">Costos unitarios del <b>APU de Costos</b> (' + esc(R.d.fuenteDesglose.version) + '), igual que Compras › Necesidad.</div>';
    else if (vc && R.conCosto) h += '<div class="sl-info">Costos unitarios del desglose de recursos cargado en Compras (recosteo).</div>';
    h += '<div class="sl-bar"><input type="search" id="slTxt" placeholder="Buscar ítem…" value="' + esc(S.txt) + '">' +
      '<label><input type="checkbox" id="slSolo"' + (S.solo ? ' checked' : '') + '> Solo ítems con saldo</label></div>';
    // visibilidad: ítems que pasan el filtro + sus títulos
    var padre = leer('padreDeItem'), vis = new Set();
    R.filas.forEach(function (x) {
      if (x.grupo) return;
      if (S.solo && Math.abs(x.sd) <= EPS) return;
      if (f && norm(x.i.id + ' ' + (x.i.desc || '')).indexOf(f) < 0) return;
      vis.add(x.i);
      var p = padre ? padre(x.i) : null, g = 0; while (p && g++ < 30) { vis.add(p); p = padre(p); }
    });
    var nc = vc ? 9 : 7;
    var SI = S.sortI, plano = !!SI.k;            // ordenado por una columna: lista plana, sin títulos
    if (plano) h += '<div class="sl-info">Ordenado por columna: los títulos y sus subtotales no se muestran. Clic en <b>Ítem</b> para volver al orden del cronograma.</div>';
    h += '<div class="sl-tw"><table class="sl-t"><thead><tr>' + th('Ítem', 'id', 'i', SI) + th('Descripción', 'desc', 'i', SI) + th('UM', 'um', 'i', SI) +
      th('Cant. vigente', 'cv', 'i', SI, 'r hm') + th('Ejecutado', 'ej', 'i', SI, 'r hm') + th('Saldo (cant.)', 'sd', 'i', SI, 'r') + th('Monto pendiente', 'monto', 'i', SI, 'r') +
      (vc ? th('Costo unit.', 'cu', 'i', SI, 'r hm', 'Costo directo unitario del APU (sin IVA)') + th('Costo pendiente', 'cPend', 'i', SI, 'r') : '') + '</tr></thead><tbody>';
    var cuenta = 0;
    var lista = plano ? ordenar(R.filas.filter(function (x) { return !x.grupo; }), COLS_I, SI) : R.filas;
    lista.forEach(function (x) {
      if (!vis.has(x.i)) return;
      if (x.grupo) {
        h += '<tr class="gr"><td class="id">' + esc(x.i.id) + '</td><td colspan="2"><div class="ds">' + esc(x.i.desc || '') + '</div></td><td class="hm"></td><td class="hm"></td>' +
          '<td></td><td class="r" title="' + ex(x.pend) + '">' + fg(x.pend) + '</td>' +
          (vc ? '<td class="hm"></td><td class="r" title="' + ex(x.costo) + '">' + (R.conCosto ? fg(x.costo) : '') + '</td>' : '') + '</tr>';
        return;
      }
      cuenta++;
      var c = cls(x.sd);
      h += '<tr><td class="id">' + esc(x.i.id) + '</td><td><div class="ds">' + esc(x.i.desc || '') + '</div></td><td>' + esc(x.i.um || '') + '</td>' +
        '<td class="r hm" title="' + ex(x.cv) + '">' + fq(x.cv) + '</td>' +
        '<td class="r hm" title="' + ex(x.ej) + '">' + fq(x.ej) + '</td>' +
        '<td class="r ' + c + '" title="' + ex(x.sd) + '">' + fq(x.sd) + (x.pct != null && Math.abs(x.sd) > EPS ? '<small>' + fp(x.pct) + '</small>' : '') + '</td>' +
        '<td class="r ' + c + '" title="' + ex(x.mSd) + '">' + (x.sd < -EPS ? fg(x.mSd) : fg(x.mPend)) + '</td>' +
        (vc ? '<td class="r hm" title="' + ex(x.cu) + '">' + (x.cu == null ? '<span class="sl-mut">—</span>' : fg(x.cu)) + '</td>' +
              '<td class="r ' + (x.sd > EPS ? '' : 'sl-cero') + '" title="' + ex(x.cPend) + '">' + (x.cPend == null ? '<span class="sl-mut">—</span>' : fg(x.cPend)) + '</td>' : '') + '</tr>';
    });
    if (!cuenta) h += '<tr><td colspan="' + nc + '" style="text-align:center;padding:24px;color:#6a7889">' + (R.T.n ? 'Ningún ítem coincide con el filtro.' : 'La obra no tiene ítems con cantidad.') + '</td></tr>';
    h += '</tbody><tfoot><tr class="tot"><td colspan="3">Total pendiente</td><td class="hm"></td><td class="hm"></td><td></td>' +
      '<td class="r" title="' + ex(T.pend) + '">' + fg(T.pend) + '</td>' + (vc ? '<td class="hm"></td><td class="r" title="' + ex(T.costo) + '">' + (R.conCosto ? fg(T.costo) : '—') + '</td>' : '') + '</tr></tfoot></table></div>' +
      '<p style="font-size:calc(12px*var(--fs,1));color:#6a7889;margin:8px 2px">Saldo = cantidad vigente − ejecutado (' + (base() === 'cert' ? 'certificado acumulado' : 'producción acumulada') +
      '). Monto pendiente = saldo × precio unitario de contrato (con IVA)' + (vc ? '; costo pendiente = saldo × costo directo unitario del APU (sin IVA)' : '') +
      '. Los totales suman solo saldos positivos; un saldo negativo (en rojo) es sobre-ejecución. Al pasar el mouse se ve el valor exacto.</p>';
    return h;
  }

  // ---------------------------------------------------------- vista recursos
  function htmlRecursos() {
    if (!DAT.d) {
      if (!DAT.err) { datos().then(function () { if (visible()) render(); }); return '<div class="sl-vacio">Cargando recursos y pedidos…</div>'; }
      return '<div class="sl-vacio">No se pudieron leer los recursos: ' + esc(DAT.err) + '</div>';
    }
    var d = DAT.d;
    if (!d.itemRecurso || !d.itemRecurso.length)
      return '<div class="sl-vacio">Esta obra no tiene recursos por ítem: cargá los costos (pestaña Costos) o el desglose de recursos en Compras.</div>';
    var hayIS = d.itemRecurso.some(function (x) { return !!x.recurso_padre; });
    var L = calcRecursos(hayIS ? S.modo : 'sin'), tipos = {};
    L.forEach(function (r) { if (r.tipo) tipos[r.tipo] = 1; });
    if (S.tipo && !tipos[S.tipo]) S.tipo = '';
    var t = norm(S.rtxt);
    var V = L.filter(function (r) {
      if (S.tipo && r.tipo !== S.tipo) return false;
      if (S.rsolo && !(r.porPedir > EPS || r.necSd > EPS)) return false;
      return !t || norm(r.id + ' ' + r.nombre).indexOf(t) >= 0;
    });
    V = ordenar(V, COLS_R, S.sortR);
    var T = V.reduce(function (o, r) { o.costo += r.costo; o.costoSd += r.costoSd; o.porPedir += r.costoPorPedir; if (r.porPedir > EPS) o.n++; return o; }, { costo: 0, costoSd: 0, porPedir: 0, n: 0 });
    var h = '<div class="sl-kpis">' +
      kpi('Falta comprar (a costo previsto)', fg(T.porPedir), T.n + ' recurso(s) · (necesario total − pedido) × costo unitario', 'tape') +
      kpi('Recursos para el saldo por ejecutar', fg(T.costoSd), 'saldo de los ítems × consumo unitario × costo (no descuenta stock)', 'plan') +
      kpi('Costo previsto total', fg(T.costo), 'cantidad vigente × consumo × costo') +
      '</div>';
    h += '<div class="sl-info">' + (d.fuenteDesglose ? 'Consumos y costos del <b>APU de Costos</b> (' + esc(d.fuenteDesglose.version) + ')' : 'Consumos y costos del desglose de recursos cargado en Compras') +
      '. <b>Pedido</b> = pedidos de Compras no rechazados con ese recurso + lo cargado como «ya pedido fuera de la app». ' +
      '<b>Falta comprar</b> = necesario total − pedido: supone que lo ya pedido cubre lo ejecutado; si faltan pedidos viejos en el sistema, mirá <b>Para el saldo</b> (lo que necesita la obra que falta, sin descontar stock).</div>';
    var tipoOps = Object.keys(tipos).sort();
    h += '<div class="sl-bar"><input type="search" id="slRtxt" placeholder="Buscar recurso…" value="' + esc(S.rtxt) + '">' +
      '<select id="slTipo"><option value="">Todos los tipos</option>' + tipoOps.map(function (x) { return '<option' + (x === S.tipo ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      (hayIS ? seg('data-slm', S.modo, [['desg', 'Desglosado', 'Los materiales in situ (hormigones, mezcla, base…) reemplazados por sus componentes: lo que se compra'], ['sin', 'Sin desglosar', 'El material in situ como un solo recurso']]) : '') +
      '<label><input type="checkbox" id="slRsolo"' + (S.rsolo ? ' checked' : '') + '> Solo con pendiente</label></div>';
    var SR = S.sortR;
    h += '<div class="sl-tw"><table class="sl-t"><thead><tr>' + th('Recurso', 'nombre', 'r', SR) + th('Tipo', 'tipo', 'r', SR, 'hm') + th('UM', 'um', 'r', SR) +
      th('Necesario total', 'nec', 'r', SR, 'r hm') + th('Pedido', 'pedido', 'r', SR, 'r hm') + th('Falta comprar', 'porPedir', 'r', SR, 'r') + th('Costo falta comprar', 'costoPorPedir', 'r', SR, 'r') +
      th('Para el saldo', 'necSd', 'r', SR, 'r') + th('Costo para el saldo', 'costoSd', 'r', SR, 'r hm') + th('Costo unit.', 'pu', 'r', SR, 'r hm') + '</tr></thead><tbody>';
    if (!V.length) h += '<tr><td colspan="10" style="text-align:center;padding:24px;color:#6a7889">No hay recursos para mostrar con este filtro.</td></tr>';
    V.slice(0, 1500).forEach(function (r) {
      var ab = !!S.abiertos[r.id];
      h += '<tr class="cl" data-slr="' + esc(r.id) + '"><td>' + (ab ? '▾ ' : '▸ ') + '<b>' + esc(r.id) + '</b> · ' + esc(r.nombre) + '</td><td class="hm">' + esc(r.tipo) + '</td><td>' + esc(r.um) + '</td>' +
        '<td class="r hm" title="' + ex(r.nec) + '">' + fq(r.nec) + '</td><td class="r hm" title="' + ex(r.pedido) + '">' + fq(r.pedido) + '</td>' +
        '<td class="r ' + (r.porPedir < -EPS ? 'sl-pos' : (r.porPedir > EPS ? '' : 'sl-cero')) + '" title="' + ex(r.porPedir) + '">' + fq(r.porPedir) + (r.porPedir < -EPS ? '<small>pedido de más</small>' : '') + '</td>' +
        '<td class="r" title="' + ex(r.costoPorPedir) + '">' + fg(r.costoPorPedir) + '</td>' +
        '<td class="r ' + (r.necSd > EPS ? '' : 'sl-cero') + '" title="' + ex(r.necSd) + '">' + fq(r.necSd) + '</td>' +
        '<td class="r hm" title="' + ex(r.costoSd) + '">' + fg(r.costoSd) + '</td><td class="r hm" title="' + ex(r.pu) + '">' + fg(r.pu) + '</td></tr>';
      if (ab) {
        r.items.slice().sort(function (a, b) { return b.qs - a.qs; }).forEach(function (x) {
          h += '<tr class="sub"><td style="padding-left:26px">' + esc(x.o.i.id + ' · ' + (x.o.i.desc || '')) + (x.padre ? '<small>vía in situ ' + esc(x.padre) + '</small>' : '') + '</td><td class="hm"></td><td>' + esc(x.o.i.um || '') + '</td>' +
            '<td class="r hm">' + fq(x.o.cv * x.cu) + '</td><td class="hm"></td><td></td><td></td>' +
            '<td class="r" title="' + ex(x.qs) + '">' + fq(x.qs) + '<small>saldo ' + fq(x.o.sd) + ' × ' + fq(x.cu) + '</small></td><td class="r hm">' + fg(x.qs * x.pr) + '</td><td class="hm"></td></tr>';
        });
        if (!r.items.length) h += '<tr class="sub"><td colspan="10" style="padding-left:26px">Ningún ítem del APU usa este recurso: solo hay pedidos.</td></tr>';
      }
    });
    h += '</tbody><tfoot><tr class="tot"><td colspan="3">Total' + (V.length !== L.length ? ' (filtrado, ' + V.length + ' de ' + L.length + ')' : ' (' + V.length + ' recursos)') + '</td>' +
      '<td class="hm"></td><td class="hm"></td><td></td><td class="r" title="' + ex(T.porPedir) + '">' + fg(T.porPedir) + '</td><td></td>' +
      '<td class="r hm" title="' + ex(T.costoSd) + '">' + fg(T.costoSd) + '</td><td class="hm"></td></tr></tfoot></table></div>' +
      '<p style="font-size:calc(12px*var(--fs,1));color:#6a7889;margin:8px 2px">Tocá un recurso para ver de qué ítems sale. Costos sin IVA, al costo unitario del APU. Las cantidades de distinta unidad no se suman entre recursos.</p>';
    return h;
  }

  // ---------------------------------------------------------- eventos
  function enlazar(box) {
    var e;
    $$('[data-slv]', box).forEach(function (b) { b.onclick = function () { S.vista = b.getAttribute('data-slv'); guardarPref(); render(); }; });
    $$('[data-slm]', box).forEach(function (b) { b.onclick = function () { S.modo = b.getAttribute('data-slm'); guardarPref(); render(); }; });
    if ((e = $('#slBase', box))) e.onchange = function () { S.base = this.value; render(); };
    if ((e = $('#slSolo', box))) e.onchange = function () { S.solo = this.checked; render(); };
    if ((e = $('#slRsolo', box))) e.onchange = function () { S.rsolo = this.checked; render(); };
    if ((e = $('#slTipo', box))) e.onchange = function () { S.tipo = this.value; guardarPref(); render(); };
    $$('th[data-sk]', box).forEach(function (t) { t.onclick = function () { clicOrden(t.getAttribute('data-sg'), t.getAttribute('data-sk')); }; });
    if ((e = $('#slRecargar', box))) e.onclick = function () { datos(true); render(); };
    if ((e = $('#slXls', box))) e.onclick = exportar;
    [['#slTxt', 'txt'], ['#slRtxt', 'rtxt']].forEach(function (p) {
      var el = $(p[0], box); if (!el) return;
      el.oninput = function () {
        S[p[1]] = this.value; var pos = this.selectionStart;
        clearTimeout(S._t); S._t = setTimeout(function () { render(); var f = $(p[0]); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch (er) {} } }, 250);
      };
    });
    $$('tr[data-slr]', box).forEach(function (tr) { tr.onclick = function () { var k = tr.getAttribute('data-slr'); S.abiertos[k] = !S.abiertos[k]; render(); }; });
  }

  // ---------------------------------------------------------- Excel
  var libP = null;
  function excelLib() {
    if (global.ExcelJS) return Promise.resolve(global.ExcelJS);
    if (!libP) libP = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = 'exceljs.min.js?v=4.4.0';
      s.onload = function () { ok(global.ExcelJS); }; s.onerror = function () { libP = null; mal(new Error('No se pudo cargar la librería de Excel (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  async function exportar() {
    var ExcelJS;
    try { ExcelJS = await excelLib(); } catch (e) { alert(e.message); return; }
    var wb = new ExcelJS.Workbook(), O = leer('OBRA') || {}, hoy = new Date().toISOString().slice(0, 10);
    var so = $('#obraSel'), nomObra = O.nombre || (so && so.selectedOptions && so.selectedOptions[0] ? so.selectedOptions[0].textContent.trim() : '') || obraId();
    var cab = function (ws, cols, titulo) {
      ws.addRow([titulo + ' — ' + nomObra]).font = { bold: true, size: 13 };
      ws.addRow(['Fecha: ' + hoy + ' · Ejecutado según ' + (base() === 'cert' ? 'certificación' : 'producción')]);
      ws.addRow([]);
      var r = ws.addRow(cols.map(function (c) { return c[0]; }));
      r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C2836' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
      cols.forEach(function (c, k) { ws.getColumn(k + 1).width = c[1]; if (c[2]) ws.getColumn(k + 1).numFmt = c[2]; });
      ws.views = [{ state: 'frozen', ySplit: 4 }];
    };
    var Q = '#,##0.####', G = '#,##0';
    // hoja 1: ítems
    var vc = veCostos(), R = calcItems();
    var ws = wb.addWorksheet('Saldos por ítem');
    var cols = [['Ítem', 10], ['Descripción', 60], ['UM', 8], ['Cant. vigente', 14, Q], ['Ejecutado', 14, Q], ['Saldo (cant.)', 14, Q], ['% pendiente', 11, '0.0'],
                ['Precio unitario', 16, G], ['Monto pendiente', 18, G]];
    if (vc) cols.push(['Costo directo unit.', 16, G], ['Costo pendiente', 18, G]);
    cab(ws, cols, 'Saldos de obra por ítem');
    (S.sortI.k ? ordenar(R.filas.filter(function (x) { return !x.grupo; }), COLS_I, S.sortI) : R.filas).forEach(function (x) {
      if (x.grupo) { var r = ws.addRow([String(x.i.id), x.i.desc || '', '', null, null, null, null, null, x.pend].concat(vc ? [null, R.conCosto ? x.costo : null] : [])); r.font = { bold: true }; return; }
      ws.addRow([String(x.i.id), x.i.desc || '', x.i.um || '', x.cv, x.ej, x.sd, x.pct, x.pu, x.sd < -EPS ? x.mSd : x.mPend].concat(vc ? [x.cu, x.cPend] : []));
    });
    var tr = ws.addRow(['TOTAL PENDIENTE', '', '', null, null, null, null, null, R.T.pend].concat(vc ? [null, R.conCosto ? R.T.costo : null] : [])); tr.font = { bold: true };
    // hoja 2: recursos
    if (veRecursos() && DAT.d && DAT.d.itemRecurso && DAT.d.itemRecurso.length) {
      var hayIS = DAT.d.itemRecurso.some(function (x) { return !!x.recurso_padre; });
      var L = ordenar(calcRecursos(hayIS ? S.modo : 'sin'), COLS_R, S.sortR);
      var w2 = wb.addWorksheet('Recursos pendientes');
      cab(w2, [['Código', 12], ['Recurso', 46], ['Tipo', 14], ['UM', 8], ['Necesario total', 15, Q], ['Pedido', 14, Q], ['Falta comprar', 15, Q], ['Costo falta comprar', 18, G],
               ['Para el saldo', 15, Q], ['Costo para el saldo', 18, G], ['Costo unit.', 14, G]], 'Recursos pendientes a comprar' + (hayIS ? (S.modo === 'desg' ? ' (desglosado)' : ' (sin desglosar)') : ''));
      L.forEach(function (r) { w2.addRow([r.id, r.nombre, r.tipo, r.um, r.nec, r.pedido, r.porPedir, r.costoPorPedir, r.necSd, r.costoSd, r.pu]); });
    }
    var buf = await wb.xlsx.writeBuffer();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'Saldos_' + String(nomObra).replace(/[^\w\-]+/g, '_').slice(0, 40) + '_' + hoy + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ======================================================================
   * 2b. ORDEN DE LA TABLA «Resumen de avance por ítem» (#repTable, app.js)
   * La dibuja renderReport; acá se ordenan sus filas por la celda del
   * encabezado clicado y se vuelve a aplicar cada vez que se redibuja.
   * Números en formato es-PY (1.234,5) y porcentajes con punto (12.5%).
   * ====================================================================== */
  var REP = { c: -1, d: 1 };
  function valCelda(td, col) {
    var t = (td && td.textContent || '').trim();
    if (!t || t === '—' || t === '-') return null;
    if (col === 0) return { id: t };
    if (/%$/.test(t)) { var p = parseFloat(t.replace(/[%+\s]/g, '')); return isFinite(p) ? p : t; }
    if (/^[-+]?[\d.]+(,\d+)?$/.test(t)) { var x = Number(t.replace(/\./g, '').replace(',', '.')); if (isFinite(x)) return x; }
    return t;
  }
  function ordenarRep() {
    var tb = $('#repBody'), tabla = $('#repTable'); if (!tb || !tabla) return;
    $$('thead th', tabla).forEach(function (h, k) {
      var f = h.querySelector('.sl-fl'); if (!f) { f = document.createElement('span'); f.className = 'sl-fl'; h.appendChild(f); }
      f.textContent = k === REP.c ? (REP.d > 0 ? ' ▲' : ' ▼') : '';
    });
    if (REP.c < 0) return;
    var filas = $$('tr', tb), c = REP.c, d = REP.d;
    filas.map(function (tr, k) { return { tr: tr, v: valCelda(tr.children[c], c), k: k }; }).sort(function (a, b) {
      var x = a.v, y = b.v;
      if (x == null || y == null) return x == null && y == null ? a.k - b.k : (x == null ? 1 : -1);
      var r = (x.id != null) ? cmpItem(x.id, y.id) : (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' }));
      return (r * d) || (a.k - b.k);
    }).forEach(function (o) { tb.appendChild(o.tr); });
  }
  function engancharRep() {
    var tabla = $('#repTable'); if (!tabla) return;
    $$('thead th', tabla).forEach(function (h, k) {
      h.title = 'Clic para ordenar (otro clic invierte)';
      h.onclick = function () {
        if (REP.c === k) REP.d = -REP.d;
        else { REP.c = k; var t = (h.textContent || '').trim().toLowerCase(); REP.d = (k <= 2 || /^descrip|^um/.test(t)) ? 1 : -1; }
        ordenarRep();
      };
    });
  }

  /* ======================================================================
   * 3. SUB-PESTAÑAS Y ENGANCHE
   * ====================================================================== */
  function visible() { var v = $('#v-report'); return !!(v && v.classList.contains('on') && S.sub === 'saldos'); }
  function mostrarSub() {
    var a = $('#repAvance'), s = $('#repSaldos'); if (!a || !s) return;
    a.style.display = S.sub === 'saldos' ? 'none' : '';
    s.style.display = S.sub === 'saldos' ? '' : 'none';
    $$('#repSub [data-rsub]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rsub') === S.sub); });
    if (S.sub === 'saldos') render();
  }
  function enganchar() {
    estilos();
    $$('#repSub [data-rsub]').forEach(function (b) {
      b.onclick = function () {
        S.sub = b.getAttribute('data-rsub'); guardarPref(); mostrarSub();
        if (S.sub === 'avance') { try { var rr = leer('renderReport'), rc = leer('renderCurvas'); if (rr) rr(); if (rc) rc(); } catch (e) {} }
      };
    });
    mostrarSub();
    engancharRep();
    // refrescar cuando la app redibuja el informe (cambio de obra, producción, certificación…)
    var orig = global.renderReport;
    if (typeof orig === 'function' && !orig.__saldos) {
      var envuelta = function () { var r = orig.apply(this, arguments); try { ordenarRep(); } catch (e) {} try { if (visible()) render(); } catch (e) {} return r; };
      envuelta.__saldos = true; global.renderReport = envuelta;
    }
    var tabs = $('#tabs');
    if (tabs) tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'report' && S.sub === 'saldos') setTimeout(render, 0); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  }
  global.SaldosView = { abrir: function () { S.sub = 'saldos'; mostrarSub(); }, recargar: function () { datos(true); if (visible()) render(); },
                        _calcItems: calcItems, _calcRecursos: calcRecursos, _S: S };
})(typeof window !== 'undefined' ? window : globalThis);
