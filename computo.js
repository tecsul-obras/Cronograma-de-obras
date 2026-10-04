/* =========================================================================
 * computo.js — Pestaña CÓMPUTO (cómputo métrico ligero) · v20261004b
 *
 * Idea: el cómputo se sigue trabajando en Excel; la app lo guarda por ítem
 * para tenerlo a mano y compararlo con la cantidad de contrato o del C.M.
 *
 * - Etapas: "Contrato original" y cada convenio modificatorio de la obra.
 * - Por ítem: líneas de cómputo (tramo, progresivas, L, a, e, N, total) y la
 *   cantidad ADOPTADA. Sin redondeos: se guarda lo que se carga.
 * - ⬇ Planilla Excel con el formato de la hoja "Computo Métrico" del C.M.
 *   (un bloque por ítem: fila del ítem, líneas, fila de TOTAL y Cantidad
 *   Adoptada) y ⬆ Cargar Excel para volver a subirla.
 * - Las planillas pesadas (terraplén, pavimento) van como una sola línea con
 *   el total ("ver hoja Terraplén").
 * No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var D = null;              // ObraAPI.compDatos
  var ETAPA = 'contrato';
  var ED = {};               // item_id → { lineas:[...], adoptada, obs }  (solo los editados)
  var ABIERTO = {};          // item_id → true (detalle desplegado)
  var FILTRO = 'todos', BUSCA = '';
  var obraCargada = null;

  // ------------------------------------------------------------ formato
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fq(v) { if (v === null || v === undefined || v === '') return '–'; v = n(v); return v === 0 ? '0' : v.toLocaleString('es-PY', { maximumFractionDigits: 6 }); }
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
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function soloLectura() {
    return document.body.classList.contains('readonly') || document.body.classList.contains('solo-lectura') || global.__role === 'lectura';
  }
  function sucio() { return Object.keys(ED).length > 0; }

  // ------------------------------------------------------------ estilos
  function estilos() {
    if ($('#cpCss')) return;
    var st = document.createElement('style'); st.id = 'cpCss';
    st.textContent = [
      '#v-computo{overflow:auto;background:#fff}',
      '.cp-wrap{padding:14px 18px 40px;max-width:1700px;margin:0 auto;width:100%;color:#1f2937}',
      '.cp-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.cp-bar select,.cp-bar input[type=search]{padding:8px 10px;border:1px solid #d0d6e0;border-radius:8px;font-size:14px;background:#fff;color:#1f2937}',
      '.cp-bar select{min-width:260px}',
      '.cp-bar .grow{flex:1}',
      '.cp-btn{border:1px solid #d0d6e0;background:#fff;color:#1f2937;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}',
      '.cp-btn:hover{background:#f7f9fc}.cp-btn.on{background:#1a2744;color:#fff;border-color:#1a2744}',
      '.cp-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}.cp-btn.del{color:#c0392b}',
      '.cp-btn:disabled{opacity:.5;cursor:default}',
      '.cp-mini{border:1px solid #d0d6e0;background:#fff;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer}',
      '.cp-nota{font-size:12.5px;color:#4a5568;margin:0 0 10px}',
      '.cp-sucio{font-size:12px;color:#e8640a;font-weight:700}',
      '.cp-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.cp-kpi{border:1px solid #d0d6e0;border-left:4px solid #2c4a8a;border-radius:8px;padding:8px 12px;min-width:170px}',
      '.cp-kpi b{display:block;font-size:18px}.cp-kpi span{font-size:11px;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.cp-tw{overflow:auto;border:1px solid #d0d6e0;border-radius:8px}',
      '.cp-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1100px}',
      '.cp-t th{position:sticky;top:0;background:#f0f2f5;font-size:11px;text-align:center;padding:6px;border-bottom:1px solid #d0d6e0;z-index:1}',
      '.cp-t td{padding:4px 6px;border-bottom:1px solid #eef0f4;vertical-align:middle}',
      '.cp-t td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.cp-t tr.g td{font-weight:700;background:#f7f8fb}',
      '.cp-t tr.it{cursor:pointer}.cp-t tr.it:hover td{background:#f7f9fc}',
      '.cp-t tr.it.ab td{background:#eef3fb}',
      '.cp-t td.dif.mas{color:#1e8449;font-weight:700}.cp-t td.dif.menos{color:#c0392b;font-weight:700}',
      '.cp-t tr.ed td:first-child{box-shadow:inset 3px 0 0 #e8640a}',
      '.cp-det td{background:#fbfcfe;padding:8px 10px 12px 28px}',
      '.cp-l{border-collapse:collapse;font-size:12px;width:100%}',
      '.cp-l th{font-size:10.5px;background:#eef1f6;padding:4px;text-align:center}',
      '.cp-l td{padding:1px 2px;border-bottom:1px solid #eef0f4}',
      '.cp-l input{width:100%;border:1px solid #e1e5ec;border-radius:4px;padding:3px 5px;font:inherit;background:#fff}',
      '.cp-l input.num{text-align:right}.cp-l input.tot{background:#fffbe6}',
      '.cp-l input:focus{outline:2px solid #e8640a}',
      '.cp-pie{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12.5px}',
      '.cp-pie input{border:1px solid #d0d6e0;border-radius:6px;padding:4px 6px;font:inherit;background:#fffbe6;width:140px;text-align:right}',
      '.cp-pie input.obs{width:320px;text-align:left;background:#fff}',
      '.cp-empty{padding:40px;text-align:center;color:#4a5568}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ datos
  function convenios() { return (D.convenios || []).filter(function (c) { return c.estado !== 'rechazado'; }); }
  function etapaTxt(e) {
    if (e === 'contrato') return 'Contrato original';
    var c = (D.convenios || []).filter(function (x) { return x.convenio_id === e; })[0];
    return c ? c.nro + (c.estado === 'aprobado' ? ' (aprobado)' : ' (en trámite)') : e;
  }
  // cantidad de referencia: contrato, o la resultante del C.M. elegido (encadenada con los anteriores)
  function referencia(it) {
    if (ETAPA === 'contrato') return it.cantContrato;
    var q = it.cantContrato, cs = convenios(), sel = cs.filter(function (c) { return c.convenio_id === ETAPA; })[0];
    if (!sel) return q;
    cs.forEach(function (c) {
      if (c.orden > sel.orden) return;
      var d = D.det[c.convenio_id]; if (d && d[it.id] !== undefined) q = d[it.id];
    });
    return q;
  }
  function datosItem(id) {
    if (ED[id]) return ED[id];
    var l = ((D.lineas[ETAPA] || {})[id] || []).map(function (x) { return Object.assign({}, x); });
    var a = (D.adoptadas[ETAPA] || {})[id] || {};
    return { lineas: l, adoptada: a.adoptada === undefined ? null : a.adoptada, obs: a.obs || '', por: a.por, actualizado: a.actualizado };
  }
  function editable(id) { if (!ED[id]) ED[id] = datosItem(id); return ED[id]; }
  function totalLinea(l) {
    if (l.total !== null && l.total !== undefined && l.total !== '') return n(l.total);
    return 0;
  }
  // propuesta de total cuando la línea no lo trae: producto de L, a, e, N cargados
  function productoLinea(l) {
    var f = [l.largo, l.ancho, l.espesor, l.n].filter(function (v) { return v !== null && v !== undefined && v !== ''; });
    if (!f.length) return null;
    return f.reduce(function (p, v) { return p * n(v); }, 1);
  }
  function computado(d) { return d.lineas.reduce(function (s, l) { return s + totalLinea(l); }, 0); }
  function adoptada(d) { return d.adoptada !== null && d.adoptada !== undefined ? n(d.adoptada) : (d.lineas.length ? computado(d) : null); }

  // ------------------------------------------------------------ render
  function render() {
    var v = $('#v-computo'); if (!v) return;
    estilos();
    if (!D) { v.innerHTML = '<div class="cp-wrap"><div class="cp-empty">Cargando cómputo…</div></div>'; return; }
    var ro = soloLectura();
    var opts = '<option value="contrato"' + (ETAPA === 'contrato' ? ' selected' : '') + '>Contrato original</option>' +
      convenios().map(function (c) { return '<option value="' + esc(c.convenio_id) + '"' + (ETAPA === c.convenio_id ? ' selected' : '') + '>' + esc(etapaTxt(c.convenio_id)) + '</option>'; }).join('');

    var items = D.items, conComp = 0, conDif = 0, rows = [];
    items.forEach(function (it) {
      if (it.tipo === 'grupo') { rows.push({ g: true, it: it }); return; }
      var d = datosItem(it.id), ref = referencia(it), ad = adoptada(d);
      var tiene = d.lineas.length > 0 || d.adoptada !== null;
      var dif = ad === null ? null : ad - ref;
      if (tiene) conComp++;
      if (dif !== null && Math.abs(dif) > 1e-9) conDif++;
      var txt = (it.id + ' ' + it.desc).toLowerCase();
      if (BUSCA && txt.indexOf(BUSCA.toLowerCase()) < 0) return;
      if (FILTRO === 'con' && !tiene) return;
      if (FILTRO === 'sin' && tiene) return;
      if (FILTRO === 'dif' && !(dif !== null && Math.abs(dif) > 1e-9)) return;
      rows.push({ it: it, d: d, ref: ref, ad: ad, dif: dif });
    });
    rows = rows.filter(function (x, k) { if (!x.g) return true; var s = rows[k + 1]; return s && !s.g; });
    var nItems = items.filter(function (i) { return i.tipo !== 'grupo'; }).length;

    var html = '<div class="cp-wrap"><div class="cp-bar">' +
      '<select id="cpEtapa">' + opts + '</select>' +
      ['todos', 'con', 'sin', 'dif'].map(function (f) {
        return '<button class="cp-btn' + (FILTRO === f ? ' on' : '') + '" data-flt="' + f + '">' +
          { todos: 'Todos', con: 'Con cómputo', sin: 'Sin cómputo', dif: 'Con diferencia' }[f] + '</button>';
      }).join('') +
      '<input type="search" id="cpBusca" placeholder="Buscar ítem…" value="' + esc(BUSCA) + '">' +
      '<span class="grow"></span>' +
      '<button class="cp-btn" id="cpXls">⬇ Planilla Excel</button>' +
      (ro ? '' : '<button class="cp-btn" id="cpXlsIn">⬆ Cargar Excel</button><input type="file" id="cpFile" accept=".xlsx" hidden>') +
      (sucio() ? '<span class="cp-sucio">● ' + Object.keys(ED).length + ' ítem(s) sin guardar</span><button class="cp-btn" id="cpDescartar">Descartar</button>' : '') +
      (ro ? '' : '<button class="cp-btn pri" id="cpGuardar"' + (sucio() ? '' : ' disabled') + '>Guardar cómputo</button>') +
      '</div>' +
      '<p class="cp-nota">Cómputo de <b>' + esc(etapaTxt(ETAPA)) + '</b>. Bajá la planilla, trabajala en Excel y volvé a subirla; o tocá un ítem para ver y corregir sus líneas. ' +
      'La <b>cantidad adoptada</b> es la que vale; si no se carga se toma la suma de las líneas. Las hojas pesadas (terraplén, pavimento) van como una sola línea con el total.</p>' +
      '<div class="cp-kpis"><div class="cp-kpi"><span>Ítems con cómputo</span><b>' + conComp + ' / ' + nItems + '</b></div>' +
      '<div class="cp-kpi" style="border-left-color:' + (conDif ? '#e8640a' : '#2e9c63') + '"><span>Con diferencia vs ' + (ETAPA === 'contrato' ? 'contrato' : 'el C.M.') + '</span><b>' + conDif + '</b></div></div>';

    if (!rows.length) html += '<div class="cp-empty">No hay ítems para mostrar con ese filtro.</div>';
    else {
      html += '<div class="cp-tw"><table class="cp-t"><thead><tr><th style="width:56px">Ítem</th><th>Descripción</th><th>UM</th>' +
        '<th>Cant. ' + (ETAPA === 'contrato' ? 'contrato' : esc(etapaTxt(ETAPA).replace(/ \(.*/, ''))) + '</th><th>Computado (suma)</th><th>Adoptada</th><th>Diferencia</th><th>Líneas</th><th>Actualizado</th></tr></thead><tbody>';
      rows.forEach(function (x) {
        if (x.g) { html += '<tr class="g"><td>' + esc(x.it.id) + '</td><td colspan="8">' + esc(x.it.desc) + '</td></tr>'; return; }
        var it = x.it, d = x.d, ab = !!ABIERTO[it.id];
        var dcls = x.dif === null || Math.abs(x.dif) < 1e-9 ? '' : (x.dif > 0 ? ' mas' : ' menos');
        html += '<tr class="it' + (ab ? ' ab' : '') + (ED[it.id] ? ' ed' : '') + '" data-it="' + esc(it.id) + '"><td>' + (ab ? '▾ ' : '▸ ') + esc(it.id) + '</td><td>' + esc(it.desc) + '</td><td>' + esc(it.um) + '</td>' +
          '<td class="r">' + fq(x.ref) + '</td><td class="r">' + (d.lineas.length ? fq(computado(d)) : '–') + '</td>' +
          '<td class="r"><b>' + (x.ad === null ? '–' : fq(x.ad)) + '</b>' + (d.adoptada === null && d.lineas.length ? ' <small title="Suma de líneas">Σ</small>' : '') + '</td>' +
          '<td class="r dif' + dcls + '">' + (x.dif === null || Math.abs(x.dif) < 1e-9 ? '–' : (x.dif > 0 ? '+' : '') + fq(x.dif)) + '</td>' +
          '<td class="r">' + (d.lineas.length || '–') + '</td><td style="font-size:11px;color:#4a5568">' + (d.actualizado ? esc(String(d.actualizado).slice(0, 10)) + (d.por ? ' · ' + esc(d.por.split('@')[0]) : '') : '') + '</td></tr>';
        if (ab) html += '<tr class="cp-det"><td colspan="9">' + detalle(it, d, ro) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    var tw = $('.cp-tw', v), y = tw ? tw.scrollTop : 0, wy = v.scrollTop;
    v.innerHTML = html;
    if ($('.cp-tw', v)) $('.cp-tw', v).scrollTop = y;
    v.scrollTop = wy;
    enlazar();
  }

  function detalle(it, d, ro) {
    var dis = ro ? ' disabled' : '';
    var campos = [['tramo', 'Tramo / descripción', ''], ['prog_ini', 'Prog. inicial', 'num'], ['prog_fin', 'Prog. final', 'num'],
                  ['largo', 'L', 'num'], ['ancho', 'a', 'num'], ['espesor', 'e / h', 'num'], ['n', 'N', 'num'], ['total', 'Total', 'num tot'], ['obs', 'Obs.', '']];
    var h = '<table class="cp-l"><thead><tr>' + campos.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';
    d.lineas.forEach(function (l, k) {
      h += '<tr>' + campos.map(function (c) {
        var val = c[2] ? fin(l[c[0]]) : (l[c[0]] || ''), ph = '';
        if (c[0] === 'total' && (l.total === null || l.total === undefined || l.total === '')) { var p = productoLinea(l); ph = p === null ? '' : fin(p); }
        return '<td' + (c[0] === 'tramo' ? ' style="min-width:220px"' : c[0] === 'obs' ? ' style="min-width:140px"' : '') + '><input class="' + c[2] + '" data-li="' + k + '" data-f="' + c[0] + '" value="' + esc(val) + '"' +
          (ph ? ' placeholder="' + esc(ph) + '" title="Vacío: se propone L×a×e×N. Escribí el total si la fórmula es otra (ej. ÷10.000 para Ha)."' : '') + dis + '></td>';
      }).join('') + '<td>' + (ro ? '' : '<button class="cp-mini" data-del="' + k + '" title="Quitar línea">×</button>') + '</td></tr>';
    });
    if (!d.lineas.length) h += '<tr><td colspan="10" style="color:#4a5568;padding:6px">Sin líneas de cómputo.</td></tr>';
    h += '</tbody></table><div class="cp-pie" data-pie="' + esc(it.id) + '">' +
      (ro ? '' : '<button class="cp-mini" data-add="1">＋ Línea</button><button class="cp-mini" data-prod="1" title="Completa los totales vacíos con L×a×e×N">Completar totales vacíos</button>') +
      '<span>Computado: <b>' + fq(computado(d)) + '</b></span>' +
      '<span>Adoptada: <input data-ad="1" value="' + esc(fin(d.adoptada)) + '" placeholder="' + esc(d.lineas.length ? fin(computado(d)) : '') + '"' + dis + '></span>' +
      '<span>Obs.: <input class="obs" data-obs="1" value="' + esc(d.obs) + '"' + dis + '></span></div>';
    return h;
  }

  function enlazar() {
    var sel = $('#cpEtapa');
    if (sel) sel.onchange = function () {
      if (sucio() && !confirm('Hay cambios sin guardar en el cómputo. ¿Descartarlos?')) { sel.value = ETAPA; return; }
      ED = {}; ABIERTO = {}; ETAPA = sel.value; render();
    };
    $$('[data-flt]').forEach(function (b) { b.onclick = function () { FILTRO = b.getAttribute('data-flt'); render(); }; });
    var bu = $('#cpBusca'); if (bu) bu.oninput = function () { BUSCA = bu.value; var pos = bu.selectionStart; render(); var b2 = $('#cpBusca'); b2.focus(); b2.setSelectionRange(pos, pos); };
    $$('tr.it').forEach(function (tr) { tr.onclick = function () { var id = tr.getAttribute('data-it'); ABIERTO[id] = !ABIERTO[id]; render(); }; });
    $$('.cp-det').forEach(function (row) {
      var pie = $('[data-pie]', row); if (!pie) return;
      var id = pie.getAttribute('data-pie');
      $$('input[data-li]', row).forEach(function (inp) {
        inp.onchange = function () {
          var d = editable(id), l = d.lineas[+inp.getAttribute('data-li')], f = inp.getAttribute('data-f');
          if (f === 'tramo' || f === 'obs') l[f] = inp.value;
          else {
            var v = parseNum(inp.value);
            if (inp.value.trim() && v === null) { alert('Número no válido'); inp.value = fin(l[f]); return; }
            l[f] = v;
            if ((f === 'prog_ini' || f === 'prog_fin') && l.prog_ini !== null && l.prog_fin !== null && (l.largo === null || l.largo === undefined)) l.largo = l.prog_fin - l.prog_ini;
          }
          render();
        };
      });
      $$('[data-del]', row).forEach(function (b) { b.onclick = function () { editable(id).lineas.splice(+b.getAttribute('data-del'), 1); render(); }; });
      var add = $('[data-add]', row); if (add) add.onclick = function () {
        editable(id).lineas.push({ tramo: '', prog_ini: null, prog_fin: null, largo: null, ancho: null, espesor: null, n: null, total: null, obs: '' }); render();
      };
      var pr = $('[data-prod]', row); if (pr) pr.onclick = function () {
        var d = editable(id); d.lineas.forEach(function (l) { if (l.total === null || l.total === undefined || l.total === '') { var p = productoLinea(l); if (p !== null) l.total = p; } }); render();
      };
      var ad = $('[data-ad]', row); if (ad) ad.onchange = function () {
        var v = parseNum(ad.value); if (ad.value.trim() && v === null) { alert('Número no válido'); return; }
        editable(id).adoptada = ad.value.trim() ? v : null; render();
      };
      var ob = $('[data-obs]', row); if (ob) ob.onchange = function () { editable(id).obs = ob.value; render(); };
    });
    if ($('#cpGuardar')) $('#cpGuardar').onclick = function () { guardar(Object.keys(ED), false); };
    if ($('#cpDescartar')) $('#cpDescartar').onclick = function () { ED = {}; render(); };
    if ($('#cpXls')) $('#cpXls').onclick = function () { excel().catch(function (e) { alert('No se pudo armar el Excel: ' + e.message); }); };
    if ($('#cpXlsIn')) $('#cpXlsIn').onclick = function () { $('#cpFile').click(); };
    if ($('#cpFile')) $('#cpFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (f) cargarExcel(f).catch(function (err) { alert('No se pudo leer el Excel: ' + err.message); });
    };
  }

  function payload(ids) {
    return ids.map(function (id) {
      var d = ED[id] || datosItem(id);
      return { item_id: id, adoptada: d.adoptada, obs: d.obs || '',
               lineas: d.lineas.map(function (l) {
                 return { tramo: l.tramo || '', prog_ini: l.prog_ini, prog_fin: l.prog_fin, largo: l.largo, ancho: l.ancho,
                          espesor: l.espesor, n: l.n, total: totalLinea(l), obs: l.obs || '' };
               }) };
    });
  }

  async function guardar(ids, reemplazar, desdeExcel) {
    if (!ids.length) return;
    var vacias = 0;
    ids.forEach(function (id) { (ED[id] || datosItem(id)).lineas.forEach(function (l) { if ((l.total === null || l.total === '' || l.total === undefined) && productoLinea(l) !== null) vacias++; }); });
    if (vacias && !desdeExcel && !confirm(vacias + ' línea(s) no tienen total (se guardan en 0). Usá "Completar totales vacíos" si corresponde L×a×e×N. ¿Guardar igual?')) return;
    var btn = $('#cpGuardar'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      var r = await global.ObraAPI.compGuardar(ETAPA, payload(ids), reemplazar, global.ObraAPI.getObraId());
      ED = {};
      toast('Cómputo guardado · ' + r.items + ' ítem(s), ' + r.lineas + ' línea(s)');
      await cargar();
    } catch (e) {
      alert(e.message || String(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar cómputo'; }
    }
  }

  // ------------------------------------------------------------ Excel
  var libs = {};
  function cargarLib(nombre, src, g) {
    if (global[g]) return Promise.resolve(global[g]);
    if (!libs[nombre]) libs[nombre] = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ok(global[g]); };
      s.onerror = function () { libs[nombre] = null; mal(new Error('no se pudo cargar ' + nombre + ' (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return libs[nombre];
  }
  function descargar(blob, nombre) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // Formato de la hoja "Computo Métrico": columnas B..P
  // B Nº · C ítem / tramo · D unid · E prog. inicial · F prog. final · G L · H a · I e · J tasa · K m2 · L m3 · M lts · N cantidad · O total · P adoptada · Q obs
  async function excel() {
    var ExcelJS = await cargarLib('Excel', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Computo Métrico', { views: [{ state: 'frozen', ySplit: 4 }] });
    var obra = D.obra || {};
    [4, 8, 46, 8, 13, 13, 12, 10, 10, 8, 10, 10, 8, 11, 14, 14, 30].forEach(function (w, k) { ws.getColumn(k + 1).width = w; });
    var borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    var gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EBF0' } };
    var amar = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    ws.mergeCells('B1:Q1'); ws.getCell('B1').value = 'Computo Metrico - ' + etapaTxt(ETAPA).replace(/ \(.*/, '');
    ws.getCell('B1').font = { bold: true, size: 14 }; ws.getCell('B1').alignment = { horizontal: 'center' };
    ws.mergeCells('B2:Q2'); ws.getCell('B2').value = obra.nombre || ''; ws.getCell('B2').font = { bold: true }; ws.getCell('B2').alignment = { horizontal: 'center' };
    ws.mergeCells('B3:Q3');
    ws.getCell('B3').value = 'Obra ID ' + (obra.obra_id || '') + ' · etapa ' + ETAPA + ' · Completá las líneas debajo de cada ítem (agregá filas si hace falta, dentro del bloque) y la Cantidad Adoptada. Las columnas J–M son solo de apoyo; lo que vale es TOTAL (O) y Cantidad Adoptada (P).';
    ws.getCell('B3').font = { italic: true, size: 9, color: { argb: 'FF555555' } }; ws.getCell('B3').alignment = { wrapText: true };
    ws.getRow(3).height = 28;
    var r = 5;
    var head1 = ['Nº', 'ITEMS DE OBRA', 'UNID.', 'Progresiva', 'Progresiva', 'Longitud', 'Ancho', 'Esp.', 'TASA', 'SUP.', 'VOL.', 'VOL.', 'CANTIDAD', 'TOTAL', 'Cantidad Adoptada', 'Obs.'];
    var head2 = ['Nº', 'ITEMS DE OBRA', 'UNID.', 'Inicial', 'Final', 'L', 'a', 'e', 'TASA', 'm2', 'm3', 'lts', 'N', 'TOTAL', 'Cantidad Adoptada', ''];
    function fila(vals, estilo) {
      var row = ws.getRow(r);
      vals.forEach(function (v, k) { var c = row.getCell(k + 2); if (v !== null && v !== undefined && v !== '') c.value = v; if (estilo) estilo(c, k); });
      r++; return row;
    }
    D.items.forEach(function (it) {
      if (it.tipo === 'grupo') {
        ws.mergeCells(r, 2, r, 17); var c = ws.getCell(r, 2); c.value = it.id + '. ' + it.desc; c.font = { bold: true }; c.fill = gris; r += 2; return;
      }
      fila(head1, function (c) { c.font = { bold: true, size: 9 }; c.fill = gris; c.border = borde; c.alignment = { horizontal: 'center' }; });
      fila(head2, function (c) { c.font = { bold: true, size: 9 }; c.fill = gris; c.border = borde; c.alignment = { horizontal: 'center' }; });
      fila([it.id, it.desc, it.um], function (c) { c.font = { bold: true }; c.border = borde; });
      var d = datosItem(it.id), ini = r;
      var lin = d.lineas.length ? d.lineas : [{}, {}];
      lin.forEach(function (l) {
        fila([null, l.tramo || null, null, l.prog_ini, l.prog_fin, l.largo, l.ancho, l.espesor, null, null, null, null, l.n,
              l.total !== undefined && l.total !== null && d.lineas.length ? l.total : null, null, l.obs || null],
             function (c, k) { c.border = borde; if (k >= 3 && k <= 13) c.numFmt = '#,##0.######'; });
      });
      var fin_ = r - 1;
      var ad = d.adoptada !== null && d.adoptada !== undefined ? d.adoptada : null;
      var tot = computado(d);
      fila([null, null, null, null, null, null, null, null, null, null, null, null, null,
            { formula: 'SUM(O' + ini + ':O' + fin_ + ')', result: tot }, ad, null],
           function (c, k) { c.border = borde; if (k === 13) { c.font = { bold: true }; c.numFmt = '#,##0.######'; } if (k === 14) { c.fill = amar; c.font = { bold: true }; c.numFmt = '#,##0.######'; } });
      r++;
    });
    var buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      'Computo_' + etapaTxt(ETAPA).replace(/ \(.*/, '').replace(/[^\w]+/g, '_') + '_' + (obra.obra_id || '') + '.xlsx');
  }

  function valor(c) {
    var v = c && c.value;
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') {
      if (v instanceof Date) return v;
      if ('result' in v) return v.result === undefined ? (v.formula || v.sharedFormula ? { formula: true } : null) : v.result;
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join('');
      if (v.text) return v.text;
      if (v.formula || v.sharedFormula) return { formula: true };
      return null;
    }
    return v;
  }
  function numCelda(c) {
    var v = valor(c);
    if (v === null || v === '' || (typeof v === 'object')) return null;
    return typeof v === 'number' ? v : parseNum(v);
  }
  function txtCelda(c) { var v = valor(c); return v === null || typeof v === 'object' ? '' : String(v).trim(); }

  // Lee la hoja de cómputo: bloques que empiezan con una fila cuyo Nº (col. B) es un ítem de la obra
  function parsear(ws) {
    var ids = {}, grupos = {};
    D.items.forEach(function (it) { (it.tipo === 'grupo' ? grupos : ids)[String(it.id).trim()] = it; });
    var bloques = [], cur = null, avisos = [];
    function cerrar() { if (cur) bloques.push(cur); cur = null; }
    for (var i = 1; i <= ws.rowCount; i++) {
      var row = ws.getRow(i);
      var b = txtCelda(row.getCell(2)), c = txtCelda(row.getCell(3));
      if (b === 'Nº' || c === 'ITEMS DE OBRA') { cerrar(); continue; }
      if (b && ids[b] && c) {
        cerrar();
        cur = { item_id: b, lineas: [], adoptada: null, obs: '' };
        var o = numCelda(row.getCell(15));
        if (o !== null) cur.lineas.push({ tramo: '(cantidad directa del ítem)', prog_ini: null, prog_fin: null, largo: null, ancho: null, espesor: null, n: null, total: o, obs: '' });
        continue;
      }
      if (b && grupos[b]) { cerrar(); continue; }
      if (!cur) continue;
      var vals = {
        tramo: c, prog_ini: numCelda(row.getCell(5)), prog_fin: numCelda(row.getCell(6)), largo: numCelda(row.getCell(7)),
        ancho: numCelda(row.getCell(8)), espesor: numCelda(row.getCell(9)), n: numCelda(row.getCell(14)),
        total: numCelda(row.getCell(15)), obs: txtCelda(row.getCell(17))
      };
      var p = valor(row.getCell(16));
      var esCierre = !c && !b && vals.prog_ini === null && vals.prog_fin === null && vals.largo === null && vals.ancho === null && (p !== null || valor(row.getCell(15)) !== null);
      if (esCierre) {
        var pn = numCelda(row.getCell(16));
        cur.adoptada = pn;
        if (p && typeof p === 'object' && pn === null) avisos.push('Ítem ' + cur.item_id + ': la Cantidad Adoptada no tiene un valor numérico (fórmula sin calcular o con error); se toma la suma de las líneas.');
        cerrar(); continue;
      }
      var vacia = !c && vals.prog_ini === null && vals.prog_fin === null && vals.largo === null && vals.ancho === null && vals.espesor === null && vals.n === null && vals.total === null;
      if (vacia) continue;
      if (vals.total === null) {
        var tv = valor(row.getCell(15));
        if (tv && typeof tv === 'object') {
          var pr = productoLinea(vals); vals.total = pr;
          avisos.push('Ítem ' + cur.item_id + (c ? ' (' + c + ')' : '') + ': total con fórmula sin valor calculado; se usó L×a×e×N = ' + fq(pr) + '.');
        }
      }
      cur.lineas.push(vals);
    }
    cerrar();
    return { bloques: bloques, avisos: avisos };
  }

  async function cargarExcel(file) {
    var ExcelJS = await cargarLib('Excel', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    var ws = wb.worksheets.filter(function (s) { return /c[oó]mputo/i.test(s.name); })[0] || wb.worksheets[0];
    if (!ws) throw new Error('el archivo no tiene hojas');
    var r = parsear(ws);
    if (!r.bloques.length) throw new Error('no se encontró ningún bloque de ítem en la hoja "' + ws.name + '" (la columna B tiene que tener el N° de ítem como en la obra).');
    var nl = r.bloques.reduce(function (s, b) { return s + b.lineas.length; }, 0);
    var msg = 'Hoja "' + ws.name + '": ' + r.bloques.length + ' ítem(s) y ' + nl + ' línea(s) para ' + etapaTxt(ETAPA) + '.\n' +
      'Reemplaza el cómputo de esos ítems; los ítems que no están en el archivo no se tocan.' +
      (r.avisos.length ? '\n\nAvisos:\n· ' + r.avisos.slice(0, 8).join('\n· ') + (r.avisos.length > 8 ? '\n· … y ' + (r.avisos.length - 8) + ' más' : '') : '') +
      '\n\n¿Guardar?';
    if (!confirm(msg)) return;
    ED = {};
    r.bloques.forEach(function (b) { ED[b.item_id] = { lineas: b.lineas, adoptada: b.adoptada, obs: '' }; });
    await guardar(Object.keys(ED), false, true);
  }

  // ------------------------------------------------------------ carga / API pública
  async function cargar() {
    var oid = global.ObraAPI.getObraId();
    D = await global.ObraAPI.compDatos(oid);
    if (ETAPA !== 'contrato' && !convenios().some(function (c) { return c.convenio_id === ETAPA; })) ETAPA = 'contrato';
    render();
  }
  function abrir() {
    var oid = global.ObraAPI && global.ObraAPI.getObraId();
    if (D && obraCargada === oid) { render(); return; }
    D = null; ED = {}; ABIERTO = {}; ETAPA = 'contrato'; render();
    obraCargada = oid;
    cargar().catch(function (e) {
      var v = $('#v-computo');
      if (v) v.innerHTML = '<div class="cp-wrap"><div class="cp-empty">No se pudo cargar el cómputo: ' + esc(e.message) + '</div></div>';
    });
  }

  // la pestaña: app.js cambia la vista; acá solo se carga el contenido
  function engancharPestana() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b && b.dataset.v === 'computo') abrir();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', engancharPestana); else engancharPestana();

  global.addEventListener('beforeunload', function (e) {
    if (sucio()) { e.preventDefault(); e.returnValue = 'Hay cómputo sin guardar.'; return e.returnValue; }
  });

  global.ComputoView = {
    abrir: abrir,
    reset: function () { D = null; obraCargada = null; ED = {}; ABIERTO = {}; },
    _parsear: function (ws) { return parsear(ws); },
    _estado: function () { return { D: D, ETAPA: ETAPA, ED: ED }; }
  };
})(window);
