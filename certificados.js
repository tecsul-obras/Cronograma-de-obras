/* =========================================================================
 * certificados.js — Pestaña CERTIFICACIÓN con formato de certificado MOPC
 * (v20261003e)
 *
 * - Certificados numerados por obra (N° correlativo), cada uno con su mes de
 *   imputación y período (desde/hasta): admite quincenales o varios por mes.
 * - Por ítem: cantidad contractual, vigente (C.M. / ajustada), certificado
 *   ANTERIOR (certificados de N° menor), PRESENTE (este) y ACUMULADO, % de
 *   ejecución y los mismos tres montos.
 * - Subtotales por capítulo, total general con IVA desglosado (los precios
 *   unitarios incluyen IVA, configurable en "Datos del contrato").
 * - Avances (%) del mes y acumulado: programado contractual (línea base
 *   inicial), programado vigente (plan actual), ejecutado y teórico (tiempo).
 * - Plantilla Excel para completar y volver a cargar.
 *
 * Reemplaza la vista vieja de produccion.js (define window.CertificacionView
 * después de ella). No toca app.js.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var D = null;            // datos de la obra (ObraAPI.certDatos)
  var SEL = null;          // cert_id elegido, o '__nuevo'
  var ED = null;           // edición en curso: { cab:{...}, pres:{id:num}, raw:{id:txt}, obs:{id:txt} }
  var SUCIO = false;
  var CARGANDO = false;

  // ------------------------------------------------------------ formato
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fq(v) { v = n(v); return v === 0 ? '–' : v.toLocaleString('es-PY', { maximumFractionDigits: 6 }); }
  function fg(v) { v = n(v); return v === 0 ? '–' : v.toLocaleString('es-PY', { maximumFractionDigits: 0 }); }
  function fgFull(v) { return n(v).toLocaleString('es-PY', { maximumFractionDigits: 6 }); }
  function fp(v) { return (n(v) * 100).toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; }
  // "1.234,56" · "1234,56" · "1234.56" → número (sin redondear)
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function mesLargo(m) { if (!m) return ''; var p = m.split('-'); return MESES[+p[1] - 1].replace(/^./, function (c) { return c.toUpperCase(); }) + '/' + p[0]; }
  function fd(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
  function finDeMes(m) { var p = m.split('-'); var d = new Date(+p[0], +p[1], 0); return p[0] + '-' + p[1] + '-' + ('0' + d.getDate()).slice(-2); }
  function mesSig(m) { var p = m.split('-'); var y = +p[0], mm = +p[1] + 1; if (mm > 12) { mm = 1; y++; } return y + '-' + ('0' + mm).slice(-2); }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function soloLectura() {
    return document.body.classList.contains('readonly') || document.body.classList.contains('solo-lectura') || global.__role === 'lectura';
  }
  function cfg(k, def) { var v = D && D.cfg ? D.cfg[k] : undefined; return (v === undefined || v === null || v === '') ? def : v; }
  function puConIva() { var v = cfg('pu_con_iva', true); return !(v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false'); }
  function ivaPct() { return n(cfg('iva_pct', 10)) || 10; }

  // ------------------------------------------------------------ estilos
  function estilos() {
    if ($('#ctCss')) return;
    var st = document.createElement('style');
    st.id = 'ctCss';
    st.textContent = [
      '#v-cert{overflow:auto}',
      '.ct-wrap{padding:14px 18px 40px;max-width:1700px;margin:0 auto;width:100%}',
      '.ct-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
      '.ct-bar select{min-width:260px;padding:8px 10px;border:1px solid #d0d6e0;border-radius:8px;font-size:14px;background:#fff;color:#1f2937}',
      '.ct-bar .grow{flex:1}',
      '.ct-btn{border:1px solid #d0d6e0;background:#fff;color:#1f2937;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.ct-btn:hover{background:#f7f9fc}',
      '.ct-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}',
      '.ct-btn.pri:hover{background:#24407a}',
      '.ct-btn.del{color:#c0392b}',
      '.ct-btn:disabled{opacity:.5;cursor:default}',
      '.ct-sucio{font-size:12px;color:#e8640a;font-weight:700}',
      '.ct-sheet{background:#fff;border:1px solid #1f2937;font-size:11.5px;color:#111}',
      '.ct-head{display:grid;grid-template-columns:1.1fr 3fr 1.3fr;border-bottom:1px solid #1f2937}',
      '.ct-head>div{padding:10px 12px}',
      '.ct-head>div+div{border-left:1px solid #1f2937}',
      '.ct-c{text-align:center}',
      '.ct-b{font-weight:700}',
      '.ct-kv{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:3px 10px;margin-top:10px;font-size:11px}',
      '.ct-kv b{font-weight:700;text-transform:uppercase}',
      '.ct-obra{font-weight:700;text-align:center;margin:8px 0;padding:8px 0;border-top:1px solid #1f2937;border-bottom:1px solid #1f2937}',
      '.ct-cert input,.ct-cert select{font:inherit;font-size:12px;padding:2px 4px;border:1px solid #d0d6e0;border-radius:4px;width:100%;background:#fffbe6}',
      '.ct-cert .fila{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;margin-top:4px}',
      '.ct-av{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}',
      '.ct-av td{padding:1px 2px}.ct-av td.r{text-align:right;white-space:nowrap}',
      '.ct-tw{overflow:auto}',
      '.ct-table{width:100%;border-collapse:collapse;font-size:11px;min-width:1250px}',
      '.ct-table th,.ct-table td{border:1px solid #1f2937;padding:2px 4px;vertical-align:middle}',
      '.ct-table th{background:#f0f2f5;font-weight:700;text-align:center;font-size:10.5px}',
      '.ct-table td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.ct-table tr.ct-grp td{font-weight:700;background:#f7f8fb}',
      '.ct-table tr.ct-sub td{font-weight:700;background:#fafbfc}',
      '.ct-table tr.ct-tot td{font-weight:700;background:#eef2f7}',
      '.ct-table tr.ct-exc td{background:#fdecea}',
      '.ct-table td.pres{background:#fffbe6;padding:0}',
      '.ct-table td.pres input{width:100%;border:0;background:transparent;text-align:right;font:inherit;padding:3px 4px}',
      '.ct-table td.pres input:focus{outline:2px solid #e8640a;background:#fff}',
      '.ct-table tr.ct-exc td.pres input{color:#c0392b;font-weight:700}',
      '.ct-empty{padding:40px;text-align:center;color:#4a5568}',
      '.ct-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.ct-modal .box{background:#fff;border-radius:12px;max-width:760px;width:100%;max-height:90vh;overflow:auto;padding:20px;color:#1f2937}',
      '.ct-modal h3{margin:0 0 4px;color:#1a2744}',
      '.ct-modal p{margin:0 0 12px;font-size:13px;color:#4a5568}',
      '.ct-modal .g{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}',
      '.ct-modal label{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:700;color:#4a5568}',
      '.ct-modal input,.ct-modal textarea{font:inherit;font-size:14px;font-weight:400;padding:7px 9px;border:1px solid #d0d6e0;border-radius:7px;color:#1f2937}',
      '.ct-modal .full{grid-column:1/-1}',
      '.ct-modal .acc{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}',
      '@media (max-width:900px){.ct-head{grid-template-columns:1fr}.ct-head>div+div{border-left:0;border-top:1px solid #1f2937}.ct-kv{grid-template-columns:auto 1fr}}',
      '@media print{body *{visibility:hidden}#v-cert .ct-sheet,#v-cert .ct-sheet *{visibility:visible}',
      '#v-cert .ct-sheet{position:absolute;left:0;top:0;width:100%;border:0}#v-cert .ct-tw{overflow:visible}',
      '.ct-table{min-width:0;font-size:8.5px}.ct-table td.pres{background:none}@page{size:A4 landscape;margin:8mm}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ cálculos
  function certsOrdenados() { return (D.certificados || []).slice().sort(function (a, b) { return a.nro - b.nro; }); }
  function certSel() { return SEL === '__nuevo' ? null : (D.certificados || []).filter(function (c) { return c.cert_id === SEL; })[0] || null; }
  function nroActual() { return n(ED.cab.nro) || 0; }

  // cantidad ANTERIOR de un ítem = certificados con N° menor que este
  function anteriores() {
    var nro = nroActual(), out = {};
    certsOrdenados().forEach(function (c) {
      if (c.cert_id === SEL || !(c.nro < nro)) return;
      var f = D.filas[c.cert_id] || {};
      Object.keys(f).forEach(function (id) { out[id] = (out[id] || 0) + n(f[id].cant); });
    });
    return out;
  }
  // todo lo certificado en OTROS certificados (para el tope)
  function otros() {
    var out = {};
    certsOrdenados().forEach(function (c) {
      if (c.cert_id === SEL) return;
      var f = D.filas[c.cert_id] || {};
      Object.keys(f).forEach(function (id) { out[id] = (out[id] || 0) + n(f[id].cant); });
    });
    return out;
  }
  function acumPlan(plan, mes) {
    if (!plan) return null;
    var s = 0; Object.keys(plan).forEach(function (m) { if (m <= mes) s += n(plan[m]); }); return s;
  }
  function dias(a, b) { return (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000; }

  // ------------------------------------------------------------ edición
  function empezarEdicion(certId) {
    SEL = certId;
    var c = certSel();
    var f = c ? (D.filas[c.cert_id] || {}) : {};
    ED = { cab: {}, pres: {}, raw: {}, obs: {} };
    if (c) {
      ED.cab = { cert_id: c.cert_id, nro: c.nro, mes: c.mes, periodo_desde: c.periodo_desde || '', periodo_hasta: c.periodo_hasta || '',
                 fecha: c.fecha || '', referencia: c.referencia || '', estado: c.estado || 'borrador' };
      Object.keys(f).forEach(function (id) { ED.pres[id] = n(f[id].cant); ED.obs[id] = f[id].obs || ''; });
    } else {
      var cs = certsOrdenados(), ult = cs[cs.length - 1];
      var mes = ult ? mesSig(ult.mes) : new Date().toISOString().slice(0, 7);
      ED.cab = { cert_id: null, nro: ult ? ult.nro + 1 : 1, mes: mes, periodo_desde: mes + '-01', periodo_hasta: finDeMes(mes),
                 fecha: '', referencia: '', estado: 'borrador' };
    }
    SUCIO = false;
  }

  // ------------------------------------------------------------ render
  function render() {
    var v = $('#v-cert'); if (!v) return;
    estilos();
    if (!D) { v.innerHTML = '<div class="ct-wrap"><div class="ct-empty">Cargando certificación…</div></div>'; return; }
    var ro = soloLectura();
    var cs = certsOrdenados();
    var opts = cs.slice().reverse().map(function (c) {
      return '<option value="' + esc(c.cert_id) + '"' + (c.cert_id === SEL ? ' selected' : '') + '>Certificado N° ' + c.nro + ' · ' +
             esc(mesLargo(c.mes)) + (c.periodo_desde && c.periodo_hasta ? ' (' + fd(c.periodo_desde) + '–' + fd(c.periodo_hasta) + ')' : '') +
             ' · ' + esc(c.estado) + '</option>';
    }).join('');
    if (SEL === '__nuevo') opts = '<option value="__nuevo" selected>Certificado N° ' + esc(ED.cab.nro) + ' · nuevo (sin guardar)</option>' + opts;

    var html = '<div class="ct-wrap"><div class="ct-bar">' +
      '<select id="ctSel">' + (opts || '<option value="">— sin certificados —</option>') + '</select>' +
      (ro ? '' : '<button class="ct-btn" id="ctNuevo">＋ Nuevo certificado</button>') +
      '<button class="ct-btn" id="ctDatos">Datos del contrato</button>' +
      '<button class="ct-btn" id="ctXls">⬇ Plantilla Excel</button>' +
      (ro ? '' : '<button class="ct-btn" id="ctXlsIn">⬆ Cargar Excel</button><input type="file" id="ctFile" accept=".xlsx" hidden>') +
      '<button class="ct-btn" id="ctPrint">🖨 Imprimir</button>' +
      '<span class="grow"></span>' +
      (SUCIO ? '<span class="ct-sucio">● Cambios sin guardar</span>' : '') +
      (ro || !ED ? '' : ((SEL && SEL !== '__nuevo' ? '<button class="ct-btn del" id="ctBorrar">Borrar</button>' : '') +
                         '<button class="ct-btn pri" id="ctGuardar">Guardar certificado</button>')) +
      '</div>';
    html += ED ? hoja(ro) : '<div class="ct-sheet"><div class="ct-empty">Esta obra todavía no tiene certificados.' +
      (ro ? '' : ' Tocá <b>＋ Nuevo certificado</b> para cargar el primero.') + '</div></div>';
    html += '</div>';
    v.innerHTML = html;
    enlazar();
  }

  function hoja(ro) {
    var o = D.obra || {}, P = D.plazo || {}, items = D.items || [];
    var ant = anteriores(), otr = otros();
    var publica = D.publica;
    // cantidad "vigente" del certificado: pública = contractual (contrato + convenios aprobados) · privada = ajustada
    var qv = function (it) { return n(publica ? it.cantContractual : it.cantVigente); };
    var progTotal = items.reduce(function (s, it) { return s + (it.certificable ? qv(it) * it.pu : 0); }, 0);
    var montoOrig = n(cfg('monto_original', P.monto_original));
    var montoCM = n(cfg('monto_cm', progTotal));
    var convApr = (P.convenios || []).filter(function (c) { return c.estado === 'aprobado'; });
    var etVig = publica ? (convApr.length ? 'C.M. ' + convApr.length : 'Contractual vig.') : 'Ajustada';

    // ---- filas ----
    var gruposNivel = items.filter(function (i) { return i.tipo === 'grupo'; }).map(function (i) { return i.nivel; });
    var nivelTop = gruposNivel.length ? Math.min.apply(null, gruposNivel) : null;
    var rows = [], cap = null, tot = { prog: 0, a: 0, p: 0, c: 0 };
    function cerrarCap() {
      if (!cap) return;
      var pct = cap.prog ? cap.c / cap.prog : 0;
      rows.push('<tr class="ct-sub"><td colspan="9" class="r">TOTAL PROGRAMADO ' + esc(cap.desc) + ' SEGÚN CANTIDADES ' +
                (publica ? 'CONTRACTUALES VIGENTES' : 'AJUSTADAS') + '</td><td colspan="3" class="r" title="' + fgFull(cap.prog) + '">' + fg(cap.prog) + '</td></tr>');
      rows.push('<tr class="ct-sub"><td colspan="9" class="r">TOTAL EJECUTADO ACUMULADO · ' + fp(pct) + '</td>' +
                '<td class="r" title="' + fgFull(cap.a) + '">' + fg(cap.a) + '</td><td class="r" title="' + fgFull(cap.p) + '">' + fg(cap.p) +
                '</td><td class="r" title="' + fgFull(cap.c) + '">' + fg(cap.c) + '</td></tr>');
      cap = null;
    }
    items.forEach(function (it) {
      if (it.tipo === 'grupo') {
        if (it.nivel === nivelTop) { cerrarCap(); cap = { desc: it.id + ' ' + it.desc, prog: 0, a: 0, p: 0, c: 0 }; }
        rows.push('<tr class="ct-grp"><td colspan="12">' + esc(it.id) + ' ' + esc(it.desc) + '</td></tr>');
        return;
      }
      if (!it.certificable) return;
      var a = n(ant[it.id]), p = n(ED.pres[it.id]), c = a + p;
      var vig = qv(it);
      var exc = it.cantTope != null && (n(otr[it.id]) + p) > n(it.cantTope) + 1e-6;
      var ma = a * it.pu, mp = p * it.pu, mc = c * it.pu;
      tot.prog += vig * it.pu; tot.a += ma; tot.p += mp; tot.c += mc;
      if (cap) { cap.prog += vig * it.pu; cap.a += ma; cap.p += mp; cap.c += mc; }
      var raw = ED.raw[it.id] != null ? ED.raw[it.id] : (p ? String(p).replace('.', ',') : '');
      rows.push('<tr data-id="' + esc(it.id) + '"' + (exc ? ' class="ct-exc" title="Supera el tope certificable (' + fq(it.cantTope) + ')"' : '') + '>' +
        '<td>' + esc(it.id) + ' ' + esc(it.desc) + '</td><td class="ct-c">' + esc(it.um) + '</td>' +
        '<td class="r">' + fq(it.cantContrato) + '</td><td class="r">' + fq(vig) + '</td>' +
        '<td class="r">' + fq(a) + '</td>' +
        '<td class="pres">' + (ro ? '<div style="text-align:right;padding:3px 4px">' + fq(p) + '</div>'
                                  : '<input data-id="' + esc(it.id) + '" inputmode="decimal" value="' + esc(raw) + '">') + '</td>' +
        '<td class="r">' + fq(c) + '</td><td class="r">' + (vig ? fp(c / vig) : '–') + '</td>' +
        '<td class="r" title="' + fgFull(it.pu) + '">' + fg(it.pu) + '</td>' +
        '<td class="r" title="' + fgFull(ma) + '">' + fg(ma) + '</td><td class="r" data-m="p" title="' + fgFull(mp) + '">' + fg(mp) + '</td>' +
        '<td class="r" title="' + fgFull(mc) + '">' + fg(mc) + '</td></tr>');
    });
    cerrarCap();

    // ---- totales con IVA ----
    var iva = ivaPct() / 100, conIva = puConIva();
    function sinIva(x) { return conIva ? x / (1 + iva) : x; }
    function conIvaF(x) { return conIva ? x : x * (1 + iva); }
    function filaTot(et, f) {
      return '<tr class="ct-tot"><td colspan="9" class="ct-c">' + et + '</td>' +
        ['a', 'p', 'c'].map(function (k) { var x = f(tot[k]); return '<td class="r" title="' + fgFull(x) + '">' + (x ? fg(x) : '0') + '</td>'; }).join('') + '</tr>';
    }
    rows.push('<tr class="ct-sub"><td colspan="9" class="r">TOTAL PROGRAMADO SEGÚN CANTIDADES ' + (publica ? 'CONTRACTUALES VIGENTES' : 'AJUSTADAS') +
              '</td><td colspan="3" class="r" title="' + fgFull(tot.prog) + '">' + fg(tot.prog) + '</td></tr>');
    rows.push(filaTot('TOTAL GENERAL (SIN IVA)', sinIva));
    rows.push(filaTot('IVA (' + ivaPct().toLocaleString('es-PY') + ' %)', function (x) { return conIvaF(x) - sinIva(x); }));
    rows.push(filaTot('TOTAL GENERAL (CON IVA)', conIvaF));

    // ---- avances (%) ----
    var mes = ED.cab.mes || '';
    var base = montoOrig || tot.prog || 1;
    var pc = D.progContractual, pv = D.progVigente;
    var ini = P.fecha_inicio, fin = P.fin_vigente || P.fin_original;
    var corte = ED.cab.periodo_hasta || (mes ? finDeMes(mes) : null);
    var tAc = null, tMes = null;
    if (ini && fin && corte && dias(ini, fin) > 0) {
      var tot0 = dias(ini, fin);
      tAc = Math.max(0, Math.min(1, dias(ini, corte) / tot0));
      var desde = ED.cab.periodo_desde || (mes ? mes + '-01' : corte);
      var d0 = desde < ini ? ini : desde, d1 = corte > fin ? fin : corte;
      tMes = Math.max(0, dias(d0, d1) + 1) / tot0;
    }
    function av(et, mesV, acV, tip) {
      return '<tr title="' + esc(tip) + '"><td>' + et + '</td><td class="r">' + (mesV == null ? '—' : fp(mesV)) + '</td><td class="r">' +
             (acV == null ? '—' : fp(acV)) + '</td></tr>';
    }
    var avances = '<table class="ct-av"><tr><td class="ct-b">AVANCES (%)</td><td class="r ct-b">Del mes</td><td class="r ct-b">Acumulado</td></tr>' +
      av('A. Prog. Contract.', pc ? n(pc[mes]) / base : null, pc ? acumPlan(pc, mes) / base : null,
         'Línea base inicial' + (D.lineaBase ? ' «' + D.lineaBase + '»' : ' (no hay línea base de tipo inicial)') + ' sobre el monto original') +
      av('A. Prog. Modif. Vig.', n(pv[mes]) / base, acumPlan(pv, mes) / base, 'Plan vigente del cronograma (distribución mensual) sobre el monto original') +
      av('Avance ejecutado', tot.p / base, tot.c / base, 'Monto certificado sobre el monto original') +
      av('Teórico', tMes, tAc, 'Tiempo transcurrido sobre el plazo vigente (orden de inicio → fin con convenios)') +
      '</table>';

    var c = ED.cab, dis = ro ? ' disabled' : '';
    var contratista = cfg('contratista', 'TECNOLOGIA DEL SUR S.A.E\n(TECSUL S.A.E)');
    var contratistaDatos = cfg('contratista_datos', '');
    return '<div class="ct-sheet">' +
      (cfg('codigo', '') ? '<div style="text-align:right;font-weight:700;font-size:14px;padding:4px 10px;border-bottom:1px solid #1f2937">COD. ' + esc(cfg('codigo', '')) + '</div>' : '') +
      '<div class="ct-head">' +
        '<div class="ct-c"><div class="ct-b">CONTRATISTA</div><div class="ct-b" style="white-space:pre-line">' + esc(contratista) + '</div>' +
          (contratistaDatos ? '<div style="white-space:pre-line;margin-top:10px">' + esc(contratistaDatos) + '</div>' : '') + '</div>' +
        '<div><div class="ct-c ct-b" style="white-space:pre-line">' + esc(cfg('comitente', publica ? 'MINISTERIO DE OBRAS PÚBLICAS Y COMUNICACIONES' : '')) +
          (cfg('dependencia', '') ? '\n' + esc(cfg('dependencia', '')) : '') + (cfg('contrato', '') ? '\n' + esc(cfg('contrato', '')) : '') + '</div>' +
          '<div class="ct-obra">OBRA: ' + esc(cfg('obra', o.nombre || '')) + (cfg('longitud', '') ? '<br>Longitud total: ' + esc(cfg('longitud', '')) : '') + '</div>' +
          '<div class="ct-kv">' +
            '<b>Resol. ministerial N°:</b><span>' + esc(cfg('resolucion', '–')) + '</span>' +
            '<b>Fecha presentación de oferta:</b><span>' + esc(fd(cfg('fecha_oferta', '')) || '–') + '</span>' +
            '<b>Fecha de contrato:</b><span>' + esc(fd(cfg('fecha_contrato', '')) || '–') + '</span>' +
            '<b>Orden de inicio:</b><span>' + esc(fd(P.fecha_inicio) || '–') + '</span>' +
            '<b>Monto original' + (puConIva() ? ' (con IVA)' : '') + ':</b><span>Gs ' + fg(montoOrig) + '</span>' +
            '<b>Plazo original:</b><span>' + esc(cfg('plazo_original', P.plazo_meses ? P.plazo_meses + ' Meses' : '–')) + '</span>' +
            '<b>Monto ' + esc(publica ? (convApr.length ? 'C.M. ' + convApr.length : 'vigente') : 'ajustado') + (puConIva() ? ' (con IVA)' : '') + ':</b><span>Gs ' + fg(montoCM) + '</span>' +
            '<b>Plazo ' + esc(convApr.length ? 'C.M. ' + convApr.length : 'vigente') + ':</b><span>' +
              esc(cfg('plazo_cm', P.fin_vigente ? 'hasta ' + fd(P.fin_vigente) : '–')) + '</span>' +
          '</div></div>' +
        '<div class="ct-cert"><div class="ct-c ct-b">' + esc(cfg('fiscalizacion', publica ? 'FISCALIZACIÓN: MOPC' : 'FISCALIZACIÓN')) + '</div>' +
          '<div class="ct-c ct-b" style="margin-top:8px">CERTIFICADO DE OBRA</div>' +
          '<div class="fila"><b>Certificado N°:</b><input id="ctNro" type="number" min="1" value="' + esc(c.nro) + '"' + dis + '></div>' +
          '<div class="fila"><b>Mes/Año:</b><input id="ctMes" type="month" value="' + esc(c.mes) + '"' + dis + '></div>' +
          '<div class="fila"><b>Desde:</b><input id="ctDesde" type="date" value="' + esc(c.periodo_desde || '') + '"' + dis + '></div>' +
          '<div class="fila"><b>Hasta:</b><input id="ctHasta" type="date" value="' + esc(c.periodo_hasta || '') + '"' + dis + '></div>' +
          '<div class="fila"><b>Referencia:</b><input id="ctRef" value="' + esc(c.referencia || '') + '" placeholder="ej. nota de presentación"' + dis + '></div>' +
          '<div class="fila"><b>Estado:</b><select id="ctEst"' + dis + '>' + ['borrador', 'presentado', 'aprobado'].map(function (e) {
            return '<option' + (c.estado === e ? ' selected' : '') + '>' + e + '</option>'; }).join('') + '</select></div>' +
          avances + '</div>' +
      '</div>' +
      '<div class="ct-tw"><table class="ct-table"><thead>' +
        '<tr><th rowspan="2" style="min-width:260px">DESCRIPCIÓN DEL ÍTEM</th><th rowspan="2">U/M</th><th colspan="2">Cantidad</th>' +
        '<th colspan="3">Cantidades certificadas</th><th rowspan="2">% Ejec.</th><th rowspan="2">Precio<br>unitario (Gs.)</th>' +
        '<th colspan="3">MONTO DE CERTIFICACIÓN EN GUARANÍES</th></tr>' +
        '<tr><th>Contractual</th><th>' + esc(etVig) + '</th><th>ANTERIOR</th><th>PRESENTE</th><th>ACUMULADO</th>' +
        '<th>ANTERIOR</th><th>PRESENTE</th><th>ACUMULADO</th></tr>' +
      '</thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
  }

  // ------------------------------------------------------------ eventos
  function marcarSucio() {
    if (!SUCIO) { SUCIO = true; var b = $('.ct-bar .grow'); if (b && !$('.ct-sucio')) b.insertAdjacentHTML('afterend', '<span class="ct-sucio">● Cambios sin guardar</span>'); }
  }
  function enlazar() {
    var sel = $('#ctSel');
    if (sel) sel.onchange = function () {
      if (SUCIO && !confirm('Hay cambios sin guardar en este certificado. ¿Descartarlos?')) { sel.value = SEL; return; }
      empezarEdicion(sel.value); render();
    };
    var b;
    if ((b = $('#ctNuevo'))) b.onclick = function () {
      if (SUCIO && !confirm('Hay cambios sin guardar. ¿Descartarlos y empezar un certificado nuevo?')) return;
      empezarEdicion('__nuevo'); render();
    };
    if ((b = $('#ctDatos'))) b.onclick = datosContrato;
    if ((b = $('#ctXls'))) b.onclick = function () { plantillaExcel().catch(function (e) { toast('No se pudo armar el Excel: ' + e.message); }); };
    if ((b = $('#ctXlsIn'))) b.onclick = function () { if (!ED) { toast('Elegí o creá un certificado primero'); return; } $('#ctFile').click(); };
    if ((b = $('#ctFile'))) b.onchange = function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (f) cargarExcel(f).catch(function (err) { toast('No se pudo leer el Excel: ' + err.message); });
    };
    if ((b = $('#ctPrint'))) b.onclick = function () { global.print(); };
    if ((b = $('#ctGuardar'))) b.onclick = guardar;
    if ((b = $('#ctBorrar'))) b.onclick = borrar;
    [['#ctNro', 'nro'], ['#ctMes', 'mes'], ['#ctDesde', 'periodo_desde'], ['#ctHasta', 'periodo_hasta'], ['#ctRef', 'referencia'], ['#ctEst', 'estado']]
      .forEach(function (x) {
        var el = $(x[0]); if (!el) return;
        el.onchange = function () {
          var old = ED.cab[x[1]];
          ED.cab[x[1]] = x[1] === 'nro' ? (parseInt(el.value) || '') : el.value;
          if (x[1] === 'mes' && el.value && (!ED.cab.periodo_desde || ED.cab.periodo_desde.slice(0, 7) === old)) {
            ED.cab.periodo_desde = el.value + '-01'; ED.cab.periodo_hasta = finDeMes(el.value);
          }
          marcarSucio();
          if (x[1] === 'nro' || x[1] === 'mes' || x[1] === 'periodo_desde' || x[1] === 'periodo_hasta') render();
        };
      });
    var tb = $('.ct-table tbody');
    if (tb) {
      tb.addEventListener('change', function (e) {
        var id = e.target.getAttribute && e.target.getAttribute('data-id'); if (!id) return;
        var raw = e.target.value, v = parseNum(raw);
        if (raw.trim() && v === null) { toast('Número no válido en el ítem ' + id); return; }
        ED.raw[id] = raw; ED.pres[id] = v || 0;
        marcarSucio();
        var y = $('.ct-tw') ? $('.ct-tw').scrollTop : 0, sx = $('#v-cert').scrollTop;
        render();
        $('#v-cert').scrollTop = sx; if ($('.ct-tw')) $('.ct-tw').scrollTop = y;
      });
      tb.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        var ins = Array.prototype.slice.call(tb.querySelectorAll('input[data-id]'));
        var i = ins.indexOf(e.target); if (i < 0) return;
        e.preventDefault();
        var sig = ins[i + (e.key === 'ArrowUp' ? -1 : 1)];
        e.target.blur();
        setTimeout(function () {
          var all = Array.prototype.slice.call(document.querySelectorAll('.ct-table input[data-id]'));
          var t = all.filter(function (x) { return sig && x.getAttribute('data-id') === sig.getAttribute('data-id'); })[0];
          if (t) { t.focus(); t.select(); }
        }, 30);
      });
    }
  }

  async function guardar() {
    if (!ED) return;
    if (!ED.cab.mes) { toast('Elegí el mes de imputación del certificado'); return; }
    var filas = [];
    (D.items || []).forEach(function (it) {
      if (!it.certificable) return;
      var p = n(ED.pres[it.id]), o = ED.obs[it.id] || '';
      if (p || o) filas.push({ item_id: it.id, cant_certificada: p, observacion: o });
    });
    var btn = $('#ctGuardar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      var r = await global.ObraAPI.certGuardarCertificado({
        cert_id: ED.cab.cert_id || null, nro: ED.cab.nro, mes: ED.cab.mes,
        periodo_desde: ED.cab.periodo_desde || null, periodo_hasta: ED.cab.periodo_hasta || null,
        fecha: ED.cab.fecha || null, referencia: ED.cab.referencia || '', estado: ED.cab.estado || 'borrador'
      }, filas, global.ObraAPI.getObraId());
      SUCIO = false;
      toast('Certificado N° <b>' + r.nro + '</b> guardado · ' + r.guardados + ' ítem(s)');
      await cargar(r.cert_id);
      if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
    } catch (e) {
      alert(e.message || String(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar certificado'; }
    }
  }

  async function borrar() {
    var c = certSel(); if (!c) return;
    if (!confirm('¿Borrar el certificado N° ' + c.nro + ' (' + mesLargo(c.mes) + ') con todas sus cantidades? No se puede deshacer.')) return;
    try {
      await global.ObraAPI.certBorrarCertificado(c.cert_id, global.ObraAPI.getObraId());
      toast('Certificado N° ' + c.nro + ' borrado');
      SUCIO = false;
      await cargar(null);
      if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
    } catch (e) { alert(e.message || String(e)); }
  }

  // ------------------------------------------------------- datos del contrato
  var CAMPOS = [
    ['contratista', 'Contratista (nombre)', 'textarea', 'TECNOLOGIA DEL SUR S.A.E\n(TECSUL S.A.E)'],
    ['contratista_datos', 'Contratista (dirección, teléfono, email)', 'textarea', ''],
    ['comitente', 'Comitente', 'text', 'MINISTERIO DE OBRAS PÚBLICAS Y COMUNICACIONES'],
    ['dependencia', 'Dependencia', 'text', 'ej. DIRECCIÓN DE CAMINOS VECINALES'],
    ['contrato', 'Contrato', 'text', 'ej. CONTRATO S.G. MINISTRO N° 2/2025'],
    ['fiscalizacion', 'Fiscalización', 'text', 'FISCALIZACIÓN: MOPC'],
    ['obra', 'Nombre de la obra en el certificado', 'textarea', ''],
    ['longitud', 'Longitud total', 'text', 'ej. 20,620 Km'],
    ['codigo', 'Código del certificado (COD.)', 'text', ''],
    ['resolucion', 'Resolución ministerial N°', 'text', ''],
    ['fecha_oferta', 'Fecha de presentación de oferta', 'date', ''],
    ['fecha_contrato', 'Fecha de contrato', 'date', ''],
    ['monto_original', 'Monto original (vacío = calculado)', 'text', ''],
    ['monto_cm', 'Monto C.M. / vigente (vacío = calculado)', 'text', ''],
    ['plazo_original', 'Plazo original (texto)', 'text', 'ej. 24 Meses'],
    ['plazo_cm', 'Plazo C.M. / vigente (texto)', 'text', 'ej. 29 Meses'],
    ['iva_pct', 'IVA (%)', 'text', '10']
  ];
  function datosContrato() {
    var P = D.plazo || {}, ro = soloLectura();
    var progT = (D.items || []).reduce(function (a, it) { return a + (it.certificable ? n(D.publica ? it.cantContractual : it.cantVigente) * it.pu : 0); }, 0);
    var ph = { obra: (D.obra || {}).nombre || '', monto_original: fgFull(P.monto_original), monto_cm: fgFull(progT),
               plazo_original: P.plazo_meses ? P.plazo_meses + ' Meses' : '' };
    var m = document.createElement('div');
    m.className = 'ct-modal';
    m.innerHTML = '<div class="box"><h3>Datos del contrato</h3><p>Se cargan una vez por obra y aparecen en la cabecera de todos sus certificados. ' +
      'La orden de inicio y el plazo vienen de la obra y sus convenios.</p><div class="g">' +
      CAMPOS.map(function (f) {
        var v = D.cfg[f[0]] == null ? '' : D.cfg[f[0]];
        var phv = ph[f[0]] || f[3];
        var full = f[2] === 'textarea' ? ' class="full"' : '';
        return '<label' + full + '>' + esc(f[1]) + (f[2] === 'textarea'
          ? '<textarea data-k="' + f[0] + '" rows="2" placeholder="' + esc(phv) + '"' + (ro ? ' disabled' : '') + '>' + esc(v) + '</textarea>'
          : '<input data-k="' + f[0] + '" type="' + f[2] + '" value="' + esc(v) + '" placeholder="' + esc(phv) + '"' + (ro ? ' disabled' : '') + '>') + '</label>';
      }).join('') +
      '<label class="full" style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input type="checkbox" data-k="pu_con_iva"' +
        (puConIva() ? ' checked' : '') + (ro ? ' disabled' : '') + '> Los precios unitarios del cronograma INCLUYEN IVA</label>' +
      '</div><div class="acc"><button class="ct-btn" data-x="no">Cerrar</button>' + (ro ? '' : '<button class="ct-btn pri" data-x="si">Guardar</button>') + '</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', async function (e) {
      var x = e.target.getAttribute('data-x');
      if (x === 'no' || e.target === m) { m.remove(); return; }
      if (x !== 'si') return;
      var c = {};
      m.querySelectorAll('[data-k]').forEach(function (el) {
        var k = el.getAttribute('data-k');
        var v = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
        if (k === 'monto_original' || k === 'monto_cm') { var nv = parseNum(v); v = nv == null ? '' : String(nv); }
        if (v !== '') c['cert:' + k] = v;
      });
      if (!Object.keys(c).length) c['cert:pu_con_iva'] = '1';
      try {
        await global.ObraAPI.saveConfig(c, global.ObraAPI.getObraId());
        m.remove(); toast('Datos del contrato guardados');
        await cargar(SEL);
      } catch (err) { alert(err.message || String(err)); }
    });
  }

  // ------------------------------------------------------------- Excel
  var excelJsPromesa = null;
  function cargarExcelJS() {
    if (global.ExcelJS) return Promise.resolve(global.ExcelJS);
    if (!excelJsPromesa) excelJsPromesa = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = 'exceljs.min.js?v=4.4.0';
      s.onload = function () { ok(global.ExcelJS); };
      s.onerror = function () { excelJsPromesa = null; mal(new Error('no se pudo cargar la librería de Excel (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return excelJsPromesa;
  }

  async function plantillaExcel() {
    if (!ED) { toast('Elegí o creá un certificado primero'); return; }
    var ExcelJS = await cargarExcelJS();
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Cronograma de Obra · TECSUL';
    var ws = wb.addWorksheet('Certificado', { views: [{ state: 'frozen', ySplit: 6 }] });
    var o = D.obra || {}, ant = anteriores();
    ws.columns = [{ width: 10 }, { width: 52 }, { width: 7 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
                  { width: 14 }, { width: 9 }, { width: 15 }, { width: 17 }, { width: 18 }, { width: 30 }];
    ws.getCell('A1').value = 'CERTIFICADO DE OBRA — ' + (o.nombre || '');
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = 'Obra ID'; ws.getCell('B2').value = String(o.obra_id || global.ObraAPI.getObraId());
    ws.getCell('A3').value = 'Certificado N°'; ws.getCell('B3').value = n(ED.cab.nro);
    ws.getCell('A4').value = 'Mes/Año'; ws.getCell('B4').value = mesLargo(ED.cab.mes);
    ws.getCell('D2').value = 'Completá solo la columna PRESENTE (amarilla) y, si querés, la observación. Después usá «Cargar Excel» en la app.';
    ws.getCell('D2').font = { italic: true, color: { argb: 'FF8A4B00' } };
    ['A2', 'A3', 'A4'].forEach(function (k) { ws.getCell(k).font = { bold: true }; });
    var H = ['ID ítem', 'Descripción', 'U/M', 'Cant. contractual', 'Cant. vigente', 'Anterior', 'PRESENTE', 'Acumulado', '% Ejec.',
             'P. unitario', 'Monto presente', 'Monto acumulado', 'Observación'];
    var hr = ws.getRow(6); hr.values = H; hr.font = { bold: true }; hr.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } }; c.border = { bottom: { style: 'thin' } }; });
    var r = 7, primera = 7;
    (D.items || []).forEach(function (it) {
      if (it.tipo === 'grupo') {
        var g = ws.getRow(r++); g.values = [it.id, it.desc]; g.font = { bold: true };
        g.getCell(1).fill = g.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FB' } };
        return;
      }
      if (!it.certificable) return;
      var row = ws.getRow(r);
      row.values = [it.id, it.desc, it.um, n(it.cantContrato), n(D.publica ? it.cantContractual : it.cantVigente), n(ant[it.id]),
                    ED.pres[it.id] ? n(ED.pres[it.id]) : null,
                    { formula: 'F' + r + '+G' + r }, { formula: 'IF(E' + r + '>0,H' + r + '/E' + r + ',0)' }, n(it.pu),
                    { formula: 'G' + r + '*J' + r }, { formula: 'H' + r + '*J' + r }, ED.obs[it.id] || null];
      row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } };
      row.getCell(7).protection = { locked: false };
      row.getCell(13).protection = { locked: false };
      [4, 5, 6, 7, 8].forEach(function (k) { row.getCell(k).numFmt = '#,##0.######'; });
      row.getCell(9).numFmt = '0.00%';
      [10, 11, 12].forEach(function (k) { row.getCell(k).numFmt = '#,##0'; });
      r++;
    });
    var t = ws.getRow(r);
    t.values = ['', 'TOTAL (con IVA si los P.U. lo incluyen)', '', '', '', '', '', '', '', '',
                { formula: 'SUM(K' + primera + ':K' + (r - 1) + ')' }, { formula: 'SUM(L' + primera + ':L' + (r - 1) + ')' }];
    t.font = { bold: true }; [11, 12].forEach(function (k) { t.getCell(k).numFmt = '#,##0'; });
    ws.autoFilter = { from: 'A6', to: 'M6' };
    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Certificado_N' + ED.cab.nro + '_' + (ED.cab.mes || '') + '_' + (o.obra_id || '') + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function cargarExcel(file) {
    var ExcelJS = await cargarExcelJS();
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    var ws = wb.worksheets[0];
    if (!ws) throw new Error('el archivo no tiene hojas');
    var oidArchivo = String(ws.getCell('B2').value || '').trim();
    var oid = String((D.obra || {}).obra_id || global.ObraAPI.getObraId());
    if (oidArchivo && oidArchivo !== oid &&
        !confirm('Esta plantilla es de la obra ' + oidArchivo + ' y estás en la obra ' + oid + '. ¿Cargarla igual?')) return;
    // fila de encabezado: la que tiene "ID ítem" en la columna A
    var hdr = 0, colP = 7, colO = 13;
    ws.eachRow(function (row, i) {
      if (hdr) return;
      if (String(row.getCell(1).value || '').trim().toLowerCase().indexOf('id') === 0) {
        hdr = i;
        row.eachCell(function (c, k) {
          var t = String(c.value || '').trim().toLowerCase();
          if (t === 'presente') colP = k;
          if (t.indexOf('observ') === 0) colO = k;
        });
      }
    });
    if (!hdr) throw new Error('no encontré la fila de encabezado (columna A = "ID ítem")');
    var cert = {}; (D.items || []).forEach(function (it) { if (it.certificable) cert[it.id] = true; });
    var leidos = 0, noEnc = [];
    function valor(c) {
      var v = c.value;
      if (v && typeof v === 'object') v = v.result != null ? v.result : (v.text != null ? v.text : null);
      return v;
    }
    ws.eachRow(function (row, i) {
      if (i <= hdr) return;
      var idv = valor(row.getCell(1));
      var id = idv == null ? '' : String(idv).trim();
      if (!id) return;
      var pv = valor(row.getCell(colP));
      var ov = valor(row.getCell(colO));
      if (!cert[id]) { if (pv != null && pv !== '') noEnc.push(id); return; }
      var p = (pv == null || pv === '') ? null : parseNum(pv);
      if (pv != null && pv !== '' && p === null) { noEnc.push(id + ' (número no válido)'); return; }
      ED.pres[id] = p || 0; ED.raw[id] = p ? String(p).replace('.', ',') : '';
      if (ov != null) ED.obs[id] = String(ov);
      leidos++;
    });
    SUCIO = true;
    render();
    toast('Excel cargado: <b>' + leidos + '</b> ítem(s). Revisá y tocá <b>Guardar certificado</b>.' +
          (noEnc.length ? ' Sin coincidencia: ' + noEnc.slice(0, 6).join(', ') + (noEnc.length > 6 ? '…' : '') : ''));
  }

  // ------------------------------------------------------------- carga
  async function cargar(certId) {
    CARGANDO = true;
    try {
      D = await global.ObraAPI.certDatos(global.ObraAPI.getObraId());
    } finally { CARGANDO = false; }
    var cs = certsOrdenados();
    var elegido = certId && cs.some(function (c) { return c.cert_id === certId; }) ? certId : (cs.length ? cs[cs.length - 1].cert_id : null);
    if (elegido) empezarEdicion(elegido); else { SEL = null; ED = null; }
    render();
  }

  var obraCargada = null;
  function abrir() {
    var oid = global.ObraAPI && global.ObraAPI.getObraId();
    if (D && obraCargada === oid) { render(); return; }
    if (SUCIO && !confirm('Hay cambios sin guardar en el certificado. ¿Descartarlos?')) return;
    D = null; render();
    obraCargada = oid;
    cargar(null).catch(function (e) {
      var v = $('#v-cert');
      if (v) v.innerHTML = '<div class="ct-wrap"><div class="ct-empty">No se pudo cargar la certificación: ' + esc(e.message) + '</div></div>';
    });
  }

  global.addEventListener('beforeunload', function (e) {
    if (SUCIO) { e.preventDefault(); e.returnValue = 'Hay un certificado sin guardar.'; return e.returnValue; }
  });

  global.CertificacionView = {
    abrir: abrir,
    reset: function () { D = null; obraCargada = null; SUCIO = false; },
    _estado: function () { return { D: D, SEL: SEL, ED: ED, SUCIO: SUCIO }; }
  };
})(window);
