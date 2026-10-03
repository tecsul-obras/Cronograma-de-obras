/* ============================================================================
 *  convenios.js — Convenios modificatorios y ampliación de plazo (UI)
 *  ---------------------------------------------------------------------------
 *  Se carga DESPUÉS de app.js. Usa sus globales: $, $$, ITEMS, OBRA, PLAZO,
 *  CONVENIOS, CONV_DET, CURVA_VER, cantContractual, cantVigente, toast, fmtN,
 *  fmtG, fmtGshort, pct, closeModal, ObraAPI.
 *
 *  Reglas que este archivo hace cumplir:
 *   · El sistema PROPONE, el usuario CONFIRMA. Nada se guarda sin preview
 *     aceptado: el convenio tiene peso legal.
 *   · Cargar el convenio y crear la línea base son DOS acciones separadas.
 *     Acá NUNCA se crea una línea base: solo se avisa.
 *   · En trámite ≠ aprobado. El trámite no sube el tope de certificación ni
 *     suma días al fin vigente.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* Las globales de app.js declaradas con let/const NO están en window: se leen
     por el puente APPCTX (getters vivos). Las `function` sí están en window y
     se usan directo (global.renderGantt, global.esObraPublica, etc.). */
  var A = global.APPCTX || {};

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var num = function (v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  };
  var pctTxt = function (p) {
    return (p == null || isNaN(p)) ? '—' : ((p >= 0 ? '+' : '') + (p * 100).toFixed(2).replace('.', ',') + ' %');
  };
  var fD = function (iso) {
    if (!iso) return '—';
    var m = String(iso).slice(0, 10).split('-');
    return m.length === 3 ? (m[2] + '/' + m[1] + '/' + m[0]) : iso;
  };

  var ESTADO_TXT = { en_tramite: 'en trámite', aprobado: 'aprobado', rechazado: 'rechazado' };

  /* ======================================================================
   *  1 · PANEL DE PLAZO
   *  Tres niveles bien separados, NO sumados en un solo número:
   *    fin original   = orden de inicio + plazo contractual
   *    fin vigente    = fin original + días de convenios APROBADOS (firme)
   *    fin con lluvia = fin vigente + días de lluvia y humedad (argumentado)
   * ====================================================================*/

  /* días de clima reconocidos hasta hoy (los calcula app.js con la regla de la
     obra). Si la función no está, se devuelve 0 y el nivel no se muestra. */
  function diasLluvia() {
    try {
      if (typeof global.diasGanadosRetro === 'function') return global.diasGanadosRetro() || 0;
    } catch (e) {}
    return 0;
  }

  function sumarDias(iso, d) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    var f = new Date(+p[0], +p[1] - 1, +p[2]);
    f.setDate(f.getDate() + (d || 0));
    return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  }

  function filaPlazo(c) {
    var enTramite = c.estado === 'en_tramite';
    var rechazado = c.estado === 'rechazado';
    var cls = rechazado ? 'cv-rech' : (enTramite ? 'cv-tram' : '');
    var badge = '<span class="cv-badge cv-b-' + c.estado + '">' + (ESTADO_TXT[c.estado] || c.estado) + '</span>';
    var alerta = c.dias_difieren
      ? ' <span class="cv-warn" title="El sistema calculó ' + c.dias_calculados +
        ' días; se están aplicando ' + c.dias_ampliacion + ' (valor cargado a mano).">⚠</span>'
      : '';
    var tope = c.supera_tope
      ? ' <span class="cv-warn" title="El acumulado supera el tope legal del 20 %.">▲</span>' : '';
    return '<tr class="' + cls + '">' +
      '<td>' + esc(c.nro || '—') + '</td>' +
      // El % de la fila es lo que aporta ESE convenio, medido contra el monto
      // ORIGINAL (no contra el vigente). El acumulado va en el tooltip.
      '<td class="r" title="Acumulado de todos los convenios sobre el monto original: ' +
        pctTxt(c.pct_acumulado) + '">' +
        (rechazado ? '—' : pctTxt(c.pct_incremento != null ? c.pct_incremento : c.pct_acumulado)) +
        tope + '</td>' +
      '<td class="r">' + (rechazado ? '—' : ('+' + c.dias_ampliacion + ' d')) + alerta + '</td>' +
      '<td class="r">' + (rechazado ? '—' : fD(c.fecha_fin_contrato)) + '</td>' +
      '<td>' + badge + '</td>' +
      '<td class="r cv-acts">' + accionesConvenio(c) + '</td>' +
      '</tr>';
  }

  function accionesConvenio(c) {
    var b = '';
    b += '<button class="cv-mini" data-cv-edit="' + esc(c.convenio_id) + '" title="Ver / editar el convenio">✎</button>';
    if (c.estado !== 'aprobado')
      b += '<button class="cv-mini cv-ok" data-cv-est="' + esc(c.convenio_id) + '" data-est="aprobado" title="Aprobar: sube el tope de certificación y suma los días al fin vigente">✔</button>';
    if (c.estado !== 'en_tramite')
      b += '<button class="cv-mini" data-cv-est="' + esc(c.convenio_id) + '" data-est="en_tramite" title="Volver a trámite">↺</button>';
    if (c.estado !== 'rechazado')
      b += '<button class="cv-mini" data-cv-est="' + esc(c.convenio_id) + '" data-est="rechazado" title="Rechazar">✖</button>';
    b += '<button class="cv-mini cv-del" data-cv-del="' + esc(c.convenio_id) + '" title="Borrar el convenio">🗑</button>';
    return b;
  }

  function htmlPanelPlazo() {
    var P = A.PLAZO;
    if (!P) return '<p class="hint">Todavía no se pudo calcular el plazo. Guardá la obra y volvé a entrar.</p>';

    var faltaPlazo = !P.plazo_dias_original;
    var dLlu = diasLluvia();
    var finLluvia = P.fin_vigente ? sumarDias(P.fin_vigente, dLlu) : null;

    var filas = (P.convenios || []).map(filaPlazo).join('');

    return '' +
      '<div class="cv-plazo">' +
        '<table class="cv-tbl cv-cab">' +
          '<tr><td>Orden de inicio</td><td class="r mono">' + fD(P.fecha_inicio) + '</td></tr>' +
          '<tr><td>Plazo original</td><td class="r mono">' +
            (faltaPlazo ? '<span class="cv-warn">sin cargar</span>'
                        : (P.plazo_meses + ' meses (' + P.plazo_dias_original + ' días · ' + P.dias_por_mes + ' d/mes)')) +
          '</td></tr>' +
          '<tr><td>Fin original</td><td class="r mono">' + fD(P.fin_original) + '</td></tr>' +
          '<tr><td>Monto contractual original</td><td class="r mono">' + A.fmtG(P.monto_original) + '</td></tr>' +
        '</table>' +

        (filas
          ? '<table class="cv-tbl cv-lista"><thead><tr>' +
              '<th>Convenio</th><th class="r">%</th><th class="r">Días</th>' +
              '<th class="r">Fin resultante</th><th>Estado</th><th class="r">Acciones</th>' +
            '</tr></thead><tbody>' + filas + '</tbody></table>'
          : '<p class="hint" style="margin:10px 0">No hay convenios cargados en esta obra.</p>') +

        '<table class="cv-tbl cv-tot">' +
          '<tr class="cv-firme"><td><b>Fin vigente</b> <small>(contractualmente firme)</small></td>' +
            '<td class="r mono"><b>' + fD(P.fin_vigente) + '</b></td></tr>' +
          '<tr><td>Días de convenios aprobados</td><td class="r mono">+' + P.dias_ampliacion_total + ' d</td></tr>' +
          (P.dias_escenario_total > P.dias_ampliacion_total
            ? '<tr class="cv-tram"><td>Escenario con convenios en trámite</td><td class="r mono">' +
              fD(P.fin_escenario) + ' <small>(+' + (P.dias_escenario_total - P.dias_ampliacion_total) + ' d)</small></td></tr>'
            : '') +
          (dLlu
            ? '<tr><td>Días de lluvia + humedad <small>(argumentado, NO otorgado)</small></td>' +
              '<td class="r mono">+' + dLlu + ' d</td></tr>' +
              '<tr><td><b>Techo de extensión</b> <small>(fin con lluvia)</small></td>' +
              '<td class="r mono"><b>' + fD(finLluvia) + '</b></td></tr>'
            : '<tr><td class="hint" colspan="2">Sin días de lluvia reconocidos todavía: el techo de extensión es el fin vigente.</td></tr>') +
        '</table>' +

        (P.supera_tope
          ? '<div class="cv-alert">El acumulado de convenios llega a ' + pctTxt(P.pct_vigente) +
            ', por encima del tope legal del ' + (P.tope_pct * 100).toFixed(0) + ' %. No se bloquea nada, pero conviene revisar el sustento.</div>'
          : '') +
        (faltaPlazo
          ? '<div class="cv-alert">La obra no tiene <b>plazo original</b> cargado. Sin él no se pueden calcular los días de ampliación. Cargalo en <b>Datos del contrato</b>.</div>'
          : '') +
      '</div>';
  }

  /* ======================================================================
   *  2 · KPI "EJECUTADO NO CERTIFICABLE"
   *  Durante el trámite de un convenio se ejecuta pero no se puede certificar
   *  por encima de lo aprobado. Es la realidad contractual, no un bug — pero
   *  hay que verlo.
   * ====================================================================*/
  function ejecutadoNoCertificable() {
    var total = 0, n = 0, det = [];
    (A.ITEMS || []).forEach(function (i) {
      if (typeof global.esComputable === 'function' && !global.esComputable(i)) return;
      var pr = (A.PROD || {})[i.id];
      var ejec = pr && pr.total ? pr.total : 0;
      if (!ejec) return;
      var tope = A.cantContractual(i);
      if (ejec <= tope + 1e-6) return;
      var exc = ejec - tope;
      total += exc * (i.pu || 0); n++;
      det.push({ id: i.id, desc: i.desc, um: i.um, tope: tope, ejec: ejec, exc: exc, monto: exc * (i.pu || 0) });
    });
    det.sort(function (a, b) { return b.monto - a.monto; });
    return { monto: total, items: n, detalle: det };
  }

  function htmlNoCertificable() {
    var k = ejecutadoNoCertificable();
    if (!k.items) return '';
    var tram = (A.CONVENIOS || []).filter(function (c) { return c.estado === 'en_tramite'; });
    var ref = tram.length ? (' Está pendiente de aprobación ' + tram.map(function (c) { return c.nro; }).join(', ') + '.')
                          : ' No hay ningún convenio en trámite que lo respalde.';
    return '<div class="cv-alert cv-alert-amb">' +
      '<b>Ejecutado no certificable: ' + A.fmtGshort(k.monto) + '</b> en ' + k.items + ' ítem(s).' +
      ' Se ejecutó por encima de la cantidad contractual aprobada, así que no se puede certificar.' + esc(ref) +
      '<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">Ver detalle</summary>' +
      '<table class="cv-tbl" style="margin-top:6px"><thead><tr><th>Ítem</th><th class="r">Tope</th>' +
      '<th class="r">Ejecutado</th><th class="r">Exceso</th><th class="r">Monto</th></tr></thead><tbody>' +
      k.detalle.slice(0, 25).map(function (d) {
        return '<tr><td>' + esc(d.id) + ' · ' + esc((d.desc || '').slice(0, 40)) + '</td>' +
          '<td class="r mono">' + A.fmtN(d.tope) + '</td>' +
          '<td class="r mono">' + A.fmtN(d.ejec) + '</td>' +
          '<td class="r mono cv-warn">' + A.fmtN(d.exc) + '</td>' +
          '<td class="r mono">' + A.fmtGshort(d.monto) + '</td></tr>';
      }).join('') + '</tbody></table></details></div>';
  }

  /* ======================================================================
   *  3 · PANEL PRINCIPAL DE CONVENIOS
   * ====================================================================*/
  function abrirPanel() {
    var m = $('#modal');
    var esPub = global.esObraPublica();
    m.innerHTML = '<div class="modal-card wide">' +
      '<button class="x" onclick="closeModal()">×</button>' +
      '<h3>Convenios y plazo</h3>' +
      '<p class="hint" style="margin-bottom:10px">' +
        (esPub
          ? 'Obra <b>pública</b>: los cambios de cantidad se formalizan en convenios modificatorios. ' +
            'Cargar el convenio y crear la línea base son <b>dos acciones separadas</b>: primero se carga el convenio, después se ajusta el cronograma y recién ahí se crea la línea base.'
          : 'Obra <b>privada</b>: las cantidades se ajustan informalmente con <i>cant. ajustada</i>. Acá solo se cargan <b>ampliaciones informales de plazo</b>.') +
      '</p>' +
      htmlNoCertificable() +
      htmlPanelPlazo() +
      '<div class="dactions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button class="minibtn" id="cvObra" style="width:auto;padding:8px 12px">⚙ Datos del contrato</button>' +
        '<div class="grow" style="flex:1"></div>' +
        '<button class="dsave" id="cvNuevo">＋ ' + (esPub ? 'Cargar convenio' : 'Cargar ampliación de plazo') + '</button>' +
      '</div>' +
    '</div>';
    m.classList.add('open');

    $('#cvNuevo').onclick = function () { abrirModalConvenio(null); };
    $('#cvObra').onclick = abrirDatosContrato;
    $$('[data-cv-edit]').forEach(function (b) {
      b.onclick = function () { abrirModalConvenio(b.getAttribute('data-cv-edit')); };
    });
    $$('[data-cv-est]').forEach(function (b) {
      b.onclick = function () { cambiarEstado(b.getAttribute('data-cv-est'), b.getAttribute('data-est')); };
    });
    $$('[data-cv-del]').forEach(function (b) {
      b.onclick = function () { borrar(b.getAttribute('data-cv-del')); };
    });
  }

  /* ======================================================================
   *  4 · DATOS DEL CONTRATO (tipo de obra + plazo original)
   * ====================================================================*/
  function abrirDatosContrato() {
    var m = $('#modal');
    var O = A.OBRA || {};
    m.innerHTML = '<div class="modal-card">' +
      '<button class="x" onclick="closeModal()">×</button>' +
      '<h3>Datos del contrato</h3>' +
      '<p class="hint">La <b>orden de inicio</b> es el día 0 del plazo. El <b>fin original</b> es inmutable: ' +
        'el fin vigente se deriva de los convenios aprobados, nunca se escribe a mano.</p>' +
      '<div class="dgrid2">' +
        '<div class="dfield"><label>Tipo de obra</label><select id="coTipo">' +
          '<option value="privada"' + (!global.esObraPublica() ? ' selected' : '') + '>Privada (ajuste informal)</option>' +
          '<option value="publica"' + (global.esObraPublica() ? ' selected' : '') + '>Pública (convenios modificatorios)</option>' +
        '</select></div>' +
        '<div class="dfield"><label>Orden de inicio</label>' +
          '<input type="date" id="coIni" value="' + esc(O.fecha_inicio || '') + '"></div>' +
        '<div class="dfield"><label>Plazo original (meses)</label>' +
          '<input id="coMeses" inputmode="decimal" value="' + esc(O.plazo_meses == null ? '' : O.plazo_meses) + '" placeholder="18"></div>' +
        '<div class="dfield"><label>Días por mes</label>' +
          '<input id="coDpm" inputmode="numeric" value="' + esc(O.dias_por_mes == null ? 30 : O.dias_por_mes) + '" placeholder="30"></div>' +
        '<div class="dfield" style="grid-column:1/-1"><label>Fin contractual original ' +
          '<small>(vacío = se calcula desde la orden de inicio + plazo)</small></label>' +
          '<input type="date" id="coFin" value="' + esc(O.fecha_fin || '') + '"></div>' +
      '</div>' +
      '<div class="hint" id="coPrev" style="margin-top:8px"></div>' +
      '<div class="dactions"><button class="dsave" id="coSave">Guardar</button></div>' +
    '</div>';
    m.classList.add('open');

    function prev() {
      var meses = num($('#coMeses').value), dpm = num($('#coDpm').value) || 30, ini = $('#coIni').value;
      if (!meses || !ini) { $('#coPrev').textContent = 'Cargá la orden de inicio y el plazo para ver el fin original.'; return; }
      var d = Math.round(meses * dpm);
      $('#coPrev').innerHTML = 'Plazo: <b>' + d + ' días</b> · fin original calculado: <b>' + fD(sumarDias(ini, d)) + '</b>';
    }
    ['#coMeses', '#coDpm', '#coIni'].forEach(function (s) { $(s).oninput = prev; $(s).onchange = prev; });
    prev();

    $('#coSave').onclick = function () {
      var payload = {
        tipo_obra: $('#coTipo').value,
        fecha_inicio: $('#coIni').value || '',
        fecha_fin: $('#coFin').value || '',
        plazo_meses: $('#coMeses').value === '' ? '' : num($('#coMeses').value),
        dias_por_mes: $('#coDpm').value === '' ? 30 : num($('#coDpm').value)
      };
      $('#coSave').disabled = true;
      global.ObraAPI.saveObra(payload).then(function () {
        global.toast('Datos del contrato guardados');
        return recargar();
      }).then(abrirPanel).catch(function (e) {
        $('#coSave').disabled = false;
        alert('No se pudo guardar: ' + e.message);
      });
    };
  }

  /* ======================================================================
   *  5 · CONVENIO MODIFICATORIO — PLANILLA COMPARATIVA  (v20261004a)
   *  Igual a la planilla del C.M.: por ítem, cantidad contractual ANTERIOR
   *  (contrato + convenios anteriores no rechazados) → cantidad RESULTANTE del
   *  C.M. → diferencia, con sus montos. Ítems nuevos con su precio. Monto,
   *  % de incremento acumulado sobre el contrato original (tope legal 20 %),
   *  plazo proporcional y justificación por ítem.
   *  Excel de ida y vuelta y borrador de la memoria técnica (.docx).
   * ====================================================================*/
  var ED = null;        // edición en curso
  var TOPE = 0.20;

  var fq = function (v) { v = Number(v) || 0; return v === 0 ? '–' : v.toLocaleString('es-PY', { maximumFractionDigits: 6 }); };
  var fg = function (v) { v = Number(v) || 0; return v === 0 ? '–' : v.toLocaleString('es-PY', { maximumFractionDigits: 0 }); };
  var fgFull = function (v) { return (Number(v) || 0).toLocaleString('es-PY', { maximumFractionDigits: 6 }); };
  var pc2 = function (v) { return ((Number(v) || 0) * 100).toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'; };
  function parseNum(s) {
    if (typeof s === 'number') return s;
    s = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }
  function itemPorId(id) { return (A.ITEMS || []).find(function (x) { return x.id === id; }) || null; }
  function tipoItem(i) { try { return global.tipoDe ? global.tipoDe(i) : (i.es_grupo ? 'grupo' : 'item'); } catch (e) { return 'item'; } }

  // cantidad contractual de cada ítem ANTES del convenio de orden `orden`
  function previo(orden) {
    var out = {};
    (A.ITEMS || []).forEach(function (i) { out[i.id] = Number(i.cant) || 0; });
    var convs = (A.CONVENIOS || []).filter(function (c) { return c.estado !== 'rechazado' && (c.orden || 0) < orden; })
      .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    convs.forEach(function (c) {
      (A.CONV_DET || []).forEach(function (d) { if (String(d.convenio_id) === String(c.convenio_id)) out[d.item_id] = Number(d.cant) || 0; });
    });
    return out;
  }
  function finAntesDe(orden) {
    var P = A.PLAZO || {}, fin = P.fin_original;
    (P.convenios || []).forEach(function (c) { if (c.estado === 'aprobado' && (c.orden || 0) < orden && c.fecha_fin_contrato) fin = c.fecha_fin_contrato; });
    return fin;
  }

  function abrirModalConvenio(convenioId) {
    var conv = convenioId ? (A.CONVENIOS || []).find(function (c) { return String(c.convenio_id) === String(convenioId); }) : null;
    var orden = conv ? (conv.orden || 1) : ((A.CONVENIOS || []).reduce(function (m, c) { return Math.max(m, c.orden || 0); }, 0) + 1);
    var pub = global.esObraPublica();
    ED = {
      id: conv ? conv.convenio_id : null, orden: orden,
      cab: {
        nro: conv ? conv.nro : 'C.M. N° ' + orden,
        tipo: conv ? (conv.tipo || 'modificatorio') : (pub ? 'modificatorio' : 'ampliacion_informal'),
        estado: conv ? conv.estado : 'en_tramite',
        fecha_presentacion: conv ? (conv.fecha_presentacion || '') : '',
        fecha_suscripcion: conv ? (conv.fecha_suscripcion || '') : '',
        fecha_resolucion: conv ? (conv.fecha_resolucion || '') : '',
        descripcion: conv ? (conv.descripcion || '') : '',
        doc_url: conv ? (conv.doc_url || '') : '',
        dias: conv && conv.dias_difieren ? conv.dias_ampliacion : null
      },
      prev: previo(orden), cant: {}, raw: {}, just: {}, nuevos: [], filtro: 'todos', sucio: false
    };
    (A.CONV_DET || []).forEach(function (d) {
      if (!conv || String(d.convenio_id) !== String(conv.convenio_id)) return;
      var it = itemPorId(d.item_id);
      var esNuevo = it && !(Number(it.cant) > 0) && !(ED.prev[d.item_id] > 0);
      if (esNuevo) ED.nuevos.push({ id: d.item_id, desc: it.desc || '', um: it.um || '', cant: Number(d.cant) || 0, pu: Number(it.pu) || Number(d.pu) || 0, just: d.justificacion || '', existe: true });
      else { ED.cant[d.item_id] = Number(d.cant) || 0; ED.just[d.item_id] = d.justificacion || ''; }
    });
    pintarConvenio();
  }

  // ítems de la planilla principal: computables con cantidad anterior o de contrato
  function filasPrincipales() {
    var nuevosIds = {}; ED.nuevos.forEach(function (n) { nuevosIds[n.id] = true; });
    return (A.ITEMS || []).filter(function (i) {
      if (nuevosIds[i.id]) return false;
      var t = tipoItem(i);
      if (t === 'grupo') return true;
      if (t !== 'item') return false;
      return (Number(i.cant) > 0) || (ED.prev[i.id] > 0) || ED.cant[i.id] != null;
    });
  }
  function calcular() {
    var P = A.PLAZO || {};
    var r = { antes: 0, despues: 0, aum: 0, dis: 0, nuevos: 0, n: { aum: 0, dis: 0, igual: 0, nuevo: 0 } };
    filasPrincipales().forEach(function (i) {
      if (tipoItem(i) !== 'item') return;
      var a = ED.prev[i.id] || 0, c = ED.cant[i.id] != null ? ED.cant[i.id] : a, pu = Number(i.pu) || 0;
      r.antes += a * pu; r.despues += c * pu;
      if (c > a + 1e-9) { r.aum += (c - a) * pu; r.n.aum++; }
      else if (c < a - 1e-9) { r.dis += (a - c) * pu; r.n.dis++; }
      else r.n.igual++;
    });
    ED.nuevos.forEach(function (n) { var m = (Number(n.cant) || 0) * (Number(n.pu) || 0); r.despues += m; r.nuevos += m; if (n.cant) r.n.nuevo++; });
    r.original = Number(P.monto_original) || 0;
    r.dif = r.despues - r.antes;
    r.pctIncr = r.original ? r.dif / r.original : 0;
    r.pctAcum = r.original ? (r.despues - r.original) / r.original : 0;
    r.margen = r.original * (1 + TOPE) - r.despues;
    var meses = Number(P.plazo_meses) || 0, dpm = Number(P.dias_por_mes) || 30;
    r.diasExactos = Math.max(0, r.pctIncr * meses * dpm);
    r.diasProp = Math.round(r.diasExactos);
    r.dias = ED.cab.dias != null && ED.cab.dias !== '' ? Math.max(0, Math.round(Number(ED.cab.dias) || 0)) : r.diasProp;
    r.finAntes = finAntesDe(ED.orden);
    r.finNuevo = r.finAntes ? sumarDias(r.finAntes, r.dias) : null;
    r.meses = meses; r.dpm = dpm;
    return r;
  }

  function cssConvenio() {
    if ($('#cvCss2')) return;
    var st = document.createElement('style'); st.id = 'cvCss2';
    st.textContent = [
      '.cv2{max-width:min(1500px,96vw)!important;width:96vw!important;max-height:94vh;overflow:auto;background:#fff!important;color:#1f2937!important}',
      '.cv2 h3{color:#1a2744}',
      '.cv2-cab{display:grid;grid-template-columns:repeat(6,1fr);gap:8px 12px;margin:8px 0 12px}',
      '.cv2-cab label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:700;color:#4a5568}',
      '.cv2-cab input,.cv2-cab select,.cv2-cab textarea{font:inherit;font-size:13px;font-weight:400;padding:6px 8px;border:1px solid #d0d6e0;border-radius:7px;color:#1f2937;background:#fff}',
      '.cv2-cab .w2{grid-column:span 2}.cv2-cab .w6{grid-column:1/-1}',
      '.cv2-res{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}',
      '.cv2-k{border:1px solid #d0d6e0;border-left:5px solid #2c4a8a;border-radius:8px;padding:8px 10px}',
      '.cv2-k b{display:block;font-size:16px;font-variant-numeric:tabular-nums}.cv2-k span{font-size:10.5px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.3px}',
      '.cv2-k small{display:block;color:#4a5568;font-size:11px;margin-top:2px}',
      '.cv2-k.ok{border-left-color:#2d8a4e}.cv2-k.mal{border-left-color:#c0392b}.cv2-k.av{border-left-color:#f59e0b}',
      '.cv2-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}',
      '.cv2-bar .grow{flex:1}',
      '.cv2-btn{border:1px solid #d0d6e0;background:#fff;color:#1f2937;border-radius:7px;padding:6px 10px;font-size:12.5px;font-weight:600;cursor:pointer}',
      '.cv2-btn.on{background:#2c4a8a;color:#fff;border-color:#2c4a8a}.cv2-btn.pri{background:#2c4a8a;color:#fff;border-color:#2c4a8a}',
      '.cv2-tw{overflow:auto;max-height:52vh;border:1px solid #d0d6e0;border-radius:8px}',
      '.cv2-t{width:100%;border-collapse:collapse;font-size:11.5px;min-width:1150px}',
      '.cv2-t th{position:sticky;top:0;background:#f0f2f5;font-size:10.5px;padding:5px;border-bottom:1px solid #d0d6e0;z-index:1;text-align:center}',
      '.cv2-t td{padding:2px 5px;border-bottom:1px solid #eef1f5;vertical-align:middle}',
      '.cv2-t td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.cv2-t tr.g td{background:#f7f8fb;font-weight:700}',
      '.cv2-t tr.aum td.d{color:#2d8a4e;font-weight:700}.cv2-t tr.dis td.d{color:#c0392b;font-weight:700}',
      '.cv2-t td.in{background:#fffbe6;padding:0}.cv2-t td.in input{width:100%;border:0;background:transparent;font:inherit;padding:4px 5px;text-align:right}',
      '.cv2-t td.tx input{width:100%;border:1px solid transparent;background:transparent;font:inherit;padding:3px 4px}',
      '.cv2-t td.tx input:hover,.cv2-t td.tx input:focus{border-color:#d0d6e0;background:#fff}',
      '.cv2-t input:focus{outline:2px solid #e8640a}',
      '.cv2-t tfoot td{font-weight:700;background:#eef2f7;border-top:1px solid #1f2937}',
      '.cv2-plazo{border:1px solid #d0d6e0;border-radius:8px;padding:10px 12px;margin:10px 0;font-size:13px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}',
      '.cv2-plazo input{width:80px;padding:5px 7px;border:1px solid #d0d6e0;border-radius:6px;font:inherit;text-align:right}',
      '@media (max-width:900px){.cv2-cab{grid-template-columns:1fr 1fr}.cv2-res{grid-template-columns:1fr 1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function pintarConvenio() {
    cssConvenio();
    var m = $('#modal'), c = ED.cab, r = calcular();
    var soloPlazo = c.tipo === 'ampliacion_informal';
    var ro = document.body.classList.contains('readonly');
    var dis = ro ? ' disabled' : '';
    var cab = '<div class="cv2-cab">' +
      '<label>N° de convenio<input id="cvNro" value="' + esc(c.nro) + '"' + dis + '></label>' +
      '<label>Tipo<select id="cvTipo"' + dis + '><option value="modificatorio"' + (soloPlazo ? '' : ' selected') + '>Convenio modificatorio</option>' +
        '<option value="ampliacion_informal"' + (soloPlazo ? ' selected' : '') + '>Solo ampliación de plazo</option></select></label>' +
      '<label>Presentación<input type="date" id="cvFp" value="' + esc(c.fecha_presentacion) + '"' + dis + '></label>' +
      '<label>Suscripción<input type="date" id="cvFs" value="' + esc(c.fecha_suscripcion) + '"' + dis + '></label>' +
      '<label>Aprobación / resolución<input type="date" id="cvFr" value="' + esc(c.fecha_resolucion) + '"' + dis + '></label>' +
      '<label>Estado<input value="' + esc(ESTADO_TXT[c.estado] || c.estado) + '" disabled></label>' +
      '<label class="w6">Alcance / motivo (va a la memoria técnica)<textarea id="cvDesc" rows="2"' + dis + '>' + esc(c.descripcion) + '</textarea></label>' +
      '<label class="w6">Enlace al documento (Drive, PDF)<input id="cvDoc" value="' + esc(c.doc_url) + '" placeholder="https://…"' + dis + '></label>' +
    '</div>';
    var res = soloPlazo ? '' : '<div class="cv2-res">' +
      '<div class="cv2-k"><span>Contrato original</span><b>' + fg(r.original) + '</b><small>IVA incluido</small></div>' +
      '<div class="cv2-k"><span>Vigente antes de este C.M.</span><b>' + fg(r.antes + (r.nuevos ? 0 : 0)) + '</b><small>' + pc2(r.original ? (r.antes - r.original) / r.original : 0) + ' sobre el original</small></div>' +
      '<div class="cv2-k ' + (r.dif >= 0 ? 'ok' : 'av') + '"><span>Este C.M.</span><b>' + (r.dif >= 0 ? '+' : '') + fg(r.dif) + '</b><small>' + (r.dif >= 0 ? '+' : '') + pc2(r.pctIncr) + ' · ↑' + r.n.aum + ' ↓' + r.n.dis + ' nuevos ' + r.n.nuevo + '</small></div>' +
      '<div class="cv2-k"><span>Monto contractual con este C.M.</span><b>' + fg(r.despues) + '</b><small>aumentos ' + fg(r.aum + r.nuevos) + ' · disminuciones ' + fg(r.dis) + '</small></div>' +
      '<div class="cv2-k ' + (r.pctAcum > TOPE + 1e-9 ? 'mal' : 'ok') + '"><span>Incremento acumulado</span><b>' + pc2(r.pctAcum) + '</b><small>' +
        (r.pctAcum > TOPE + 1e-9 ? 'SUPERA el tope del 20 % por ' + fg(-r.margen) : 'margen hasta el 20 %: ' + fg(r.margen)) + '</small></div>' +
    '</div>';
    var plazo = '<div class="cv2-plazo">' +
      (soloPlazo ? '<span>Ampliación informal de plazo (sin cambio de cantidades).</span>'
        : '<span title="% de incremento de este convenio × plazo original en meses × días por mes">Plazo proporcional: <b>' +
          pc2(r.pctIncr) + ' × ' + r.meses + ' meses × ' + r.dpm + ' días = ' + r.diasExactos.toLocaleString('es-PY', { maximumFractionDigits: 2 }) +
          ' → ' + r.diasProp + ' días</b></span>') +
      '<span>Días que se aplican: <input id="cvDias" inputmode="numeric" value="' + esc(c.dias != null && c.dias !== '' ? c.dias : r.diasProp) + '"' + dis + '></span>' +
      '<span>Fin antes de este convenio: <b>' + fD(r.finAntes) + '</b></span>' +
      '<span>Fin con este convenio: <b>' + fD(r.finNuevo) + '</b>' + (c.estado === 'aprobado' ? '' : ' <small>(se aplica al aprobar)</small>') + '</span>' +
    '</div>';

    var tabla = '';
    if (!soloPlazo) {
      var rows = [];
      filasPrincipales().forEach(function (i) {
        if (tipoItem(i) === 'grupo') { rows.push({ g: true, i: i }); return; }
        var a = ED.prev[i.id] || 0, cq = ED.cant[i.id] != null ? ED.cant[i.id] : a;
        var cls = cq > a + 1e-9 ? 'aum' : (cq < a - 1e-9 ? 'dis' : 'igual');
        if (ED.filtro === 'cambios' && cls === 'igual') return;
        if (ED.filtro === 'aum' && cls !== 'aum') return;
        if (ED.filtro === 'dis' && cls !== 'dis') return;
        rows.push({ i: i, a: a, c: cq, cls: cls });
      });
      // grupos sin hijos visibles fuera
      rows = rows.filter(function (x, k) { if (!x.g) return true; var s = rows[k + 1]; return s && !s.g; });
      var html = rows.map(function (x) {
        var i = x.i;
        if (x.g) return '<tr class="g"><td>' + esc(i.id) + '</td><td colspan="10">' + esc(i.desc) + '</td></tr>';
        var pu = Number(i.pu) || 0, raw = ED.raw[i.id] != null ? ED.raw[i.id] : (ED.cant[i.id] != null ? String(ED.cant[i.id]).replace('.', ',') : '');
        return '<tr class="' + x.cls + '" data-id="' + esc(i.id) + '"><td>' + esc(i.id) + '</td><td>' + esc(i.desc) + '</td><td>' + esc(i.um || '') + '</td>' +
          '<td class="r">' + fq(x.a) + '</td>' +
          '<td class="in">' + (ro ? '<div style="text-align:right;padding:4px">' + fq(x.c) + '</div>' : '<input data-q="' + esc(i.id) + '" value="' + esc(raw) + '" placeholder="' + esc(fq(x.a)) + '">') + '</td>' +
          '<td class="r d">' + (x.c - x.a ? ((x.c - x.a > 0 ? '+' : '') + fq(x.c - x.a)) : '–') + '</td>' +
          '<td class="r">' + fg(pu) + '</td><td class="r" title="' + fgFull(x.a * pu) + '">' + fg(x.a * pu) + '</td>' +
          '<td class="r" title="' + fgFull(x.c * pu) + '">' + fg(x.c * pu) + '</td><td class="r d">' + (x.c - x.a ? fg((x.c - x.a) * pu) : '–') + '</td>' +
          '<td class="tx"><input data-j="' + esc(i.id) + '" value="' + esc(ED.just[i.id] || '') + '" placeholder="' + (x.cls === 'igual' ? '' : 'justificación…') + '"' + dis + '></td></tr>';
      }).join('');
      var nuevos = ED.nuevos.map(function (n, k) {
        return '<tr class="aum" data-n="' + k + '"><td class="tx"><input data-nk="' + k + '" data-f="id" value="' + esc(n.id) + '"' + (n.existe || ro ? ' disabled' : '') + ' style="width:56px"></td>' +
          '<td class="tx"><input data-nk="' + k + '" data-f="desc" value="' + esc(n.desc) + '" placeholder="descripción"' + dis + '></td>' +
          '<td class="tx"><input data-nk="' + k + '" data-f="um" value="' + esc(n.um) + '" placeholder="um" style="width:48px"' + dis + '></td>' +
          '<td class="r">–</td><td class="in"><input data-nk="' + k + '" data-f="cant" value="' + esc(n.cant ? String(n.cant).replace('.', ',') : '') + '"' + dis + '></td>' +
          '<td class="r d">' + fq(n.cant) + '</td><td class="in"><input data-nk="' + k + '" data-f="pu" value="' + esc(n.pu ? String(n.pu).replace('.', ',') : '') + '" placeholder="precio"' + dis + '></td>' +
          '<td class="r">–</td><td class="r">' + fg(n.cant * n.pu) + '</td><td class="r d">' + fg(n.cant * n.pu) + '</td>' +
          '<td class="tx" style="display:flex;gap:4px"><input data-nk="' + k + '" data-f="just" value="' + esc(n.just) + '" placeholder="justificación…"' + dis + '>' +
          (ro || n.existe ? '' : '<button class="cv-mini cv-del" data-nd="' + k + '" title="Quitar">×</button>') + '</td></tr>';
      }).join('');
      tabla = '<div class="cv2-bar">' +
        ['todos', 'cambios', 'aum', 'dis'].map(function (f) {
          return '<button class="cv2-btn' + (ED.filtro === f ? ' on' : '') + '" data-flt="' + f + '">' +
            ({ todos: 'Todos', cambios: 'Con cambios', aum: 'Aumentan', dis: 'Disminuyen' })[f] + '</button>'; }).join('') +
        '<span class="grow"></span>' +
        '<button class="cv2-btn" id="cvXls">⬇ Excel</button>' + (ro ? '' : '<button class="cv2-btn" id="cvXlsIn">⬆ Cargar Excel</button><input type="file" id="cvFile" accept=".xlsx" hidden>') +
        '<button class="cv2-btn" id="cvMem">📝 Memoria técnica (.docx)</button>' +
      '</div>' +
      '<div class="cv2-tw"><table class="cv2-t"><thead><tr><th>Ítem</th><th style="min-width:240px">Descripción</th><th>UM</th>' +
        '<th>Cant. contractual<br>anterior</th><th>Cant. ' + esc(c.nro) + '</th><th>Diferencia</th><th>P.U. (IVA incl.)</th>' +
        '<th>Monto anterior</th><th>Monto ' + esc(c.nro) + '</th><th>Diferencia</th><th style="min-width:200px">Justificación</th></tr></thead>' +
        '<tbody>' + html + '<tr class="g"><td></td><td colspan="10">ÍTEMS NUEVOS ' + (ro ? '' : '<button class="cv2-btn" id="cvAddNuevo" style="margin-left:8px">＋ Agregar ítem nuevo</button>') + '</td></tr>' +
        (nuevos || '<tr><td colspan="11" class="hint" style="padding:6px">Sin ítems nuevos.</td></tr>') + '</tbody>' +
        '<tfoot><tr><td colspan="7" style="text-align:right">TOTAL GS. IVA INCLUIDO</td><td class="r">' + fg(r.antes) + '</td><td class="r">' + fg(r.despues) + '</td><td class="r">' + fg(r.dif) + '</td><td></td></tr></tfoot>' +
      '</table></div>';
    }

    m.innerHTML = '<div class="modal-card wide cv2"><button class="x" onclick="closeModal()">×</button>' +
      '<h3>' + (ED.id ? esc(c.nro) : (soloPlazo ? 'Nueva ampliación de plazo' : 'Nuevo convenio modificatorio')) +
        ' <small style="font-weight:400;color:#4a5568">' + (ED.id ? '· ' + esc(ESTADO_TXT[c.estado] || c.estado) : '') + '</small></h3>' +
      '<p class="hint">Cargá la <b>cantidad resultante</b> de cada ítem (como en la planilla del C.M.). La diferencia se calcula contra la cantidad contractual anterior. ' +
        'Mientras esté <b>en trámite</b> no sube el tope de certificación ni suma días; los ítems nuevos ya se pueden planificar en el cronograma.</p>' +
      cab + res + plazo + tabla +
      '<div class="dactions" style="display:flex;gap:8px;align-items:center">' + (ED.sucio ? '<span style="color:#e8640a;font-weight:700;font-size:12px">● Cambios sin guardar</span>' : '') +
        '<span class="grow" style="flex:1"></span><button class="cv2-btn" onclick="Convenios.abrirPanel()">← Volver</button>' +
        (ro ? '' : '<button class="dsave" id="cvGuardar">Guardar convenio</button>') + '</div>' +
    '</div>';
    m.classList.add('open');
    enlazarConvenio();
  }

  function enlazarConvenio() {
    var c = ED.cab;
    [['#cvNro', 'nro'], ['#cvFp', 'fecha_presentacion'], ['#cvFs', 'fecha_suscripcion'], ['#cvFr', 'fecha_resolucion'], ['#cvDesc', 'descripcion'], ['#cvDoc', 'doc_url']]
      .forEach(function (x) { var el = $(x[0]); if (el) el.onchange = function () { c[x[1]] = el.value; ED.sucio = true; }; });
    if ($('#cvTipo')) $('#cvTipo').onchange = function () { c.tipo = $('#cvTipo').value; ED.sucio = true; pintarConvenio(); };
    if ($('#cvDias')) $('#cvDias').onchange = function () {
      var v = $('#cvDias').value.trim(); var r = calcular();
      c.dias = (v === '' || Number(v) === r.diasProp) ? null : Math.max(0, Math.round(Number(v) || 0)); ED.sucio = true; pintarConvenio();
    };
    $$('[data-flt]').forEach(function (b) { b.onclick = function () { ED.filtro = b.getAttribute('data-flt'); pintarConvenio(); }; });
    var tw = $('.cv2-tw');
    function repintarConScroll() { var y = tw ? tw.scrollTop : 0; pintarConvenio(); if ($('.cv2-tw')) $('.cv2-tw').scrollTop = y; }
    $$('[data-q]').forEach(function (inp) {
      inp.onchange = function () {
        var id = inp.getAttribute('data-q'), v = parseNum(inp.value);
        if (inp.value.trim() && v === null) { alert('Número no válido en el ítem ' + id); return; }
        if (!inp.value.trim()) { delete ED.cant[id]; delete ED.raw[id]; } else { ED.cant[id] = v; ED.raw[id] = inp.value; }
        ED.sucio = true; repintarConScroll();
      };
    });
    $$('[data-j]').forEach(function (inp) { inp.onchange = function () { ED.just[inp.getAttribute('data-j')] = inp.value; ED.sucio = true; }; });
    $$('[data-nk]').forEach(function (inp) {
      inp.onchange = function () {
        var n = ED.nuevos[+inp.getAttribute('data-nk')], f = inp.getAttribute('data-f');
        if (f === 'cant' || f === 'pu') { var v = parseNum(inp.value); if (inp.value.trim() && v === null) { alert('Número no válido'); return; } n[f] = v || 0; }
        else n[f] = inp.value.trim();
        ED.sucio = true; if (f === 'cant' || f === 'pu') repintarConScroll();
      };
    });
    $$('[data-nd]').forEach(function (b) { b.onclick = function () { ED.nuevos.splice(+b.getAttribute('data-nd'), 1); ED.sucio = true; repintarConScroll(); }; });
    if ($('#cvAddNuevo')) $('#cvAddNuevo').onclick = function () {
      var maxN = 0;
      (A.ITEMS || []).concat(ED.nuevos).forEach(function (i) { var x = parseInt(String(i.id), 10); if (String(x) === String(i.id) && x > maxN) maxN = x; });
      ED.nuevos.push({ id: String(maxN + 1), desc: '', um: '', cant: 0, pu: 0, just: '', existe: false });
      ED.sucio = true; pintarConvenio(); if ($('.cv2-tw')) $('.cv2-tw').scrollTop = 1e9;
    };
    if ($('#cvGuardar')) $('#cvGuardar').onclick = guardarConvenio;
    if ($('#cvXls')) $('#cvXls').onclick = function () { excelConvenio().catch(function (e) { alert('No se pudo armar el Excel: ' + e.message); }); };
    if ($('#cvXlsIn')) $('#cvXlsIn').onclick = function () { $('#cvFile').click(); };
    if ($('#cvFile')) $('#cvFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (f) cargarExcelConvenio(f).catch(function (err) { alert('No se pudo leer el Excel: ' + err.message); });
    };
    if ($('#cvMem')) $('#cvMem').onclick = function () { memoriaTecnica().catch(function (e) { alert('No se pudo armar la memoria: ' + e.message); }); };
  }

  function guardarConvenio() {
    var c = ED.cab, soloPlazo = c.tipo === 'ampliacion_informal';
    var filas = [];
    if (!soloPlazo) {
      Object.keys(ED.cant).forEach(function (id) { filas.push({ item_id: id, cant: ED.cant[id], justificacion: ED.just[id] || '' }); });
      Object.keys(ED.just).forEach(function (id) { if (ED.cant[id] == null && ED.just[id]) filas.push({ item_id: id, cant: ED.prev[id] || 0, justificacion: ED.just[id] }); });
      for (var k = 0; k < ED.nuevos.length; k++) {
        var n = ED.nuevos[k];
        if (!n.id || !n.desc || !n.pu) { alert('El ítem nuevo ' + (n.id || '(sin número)') + ' necesita número, descripción y precio unitario.'); return; }
        if (!n.existe && itemPorId(n.id)) { alert('Ya existe un ítem con el número ' + n.id + ' en la obra.'); return; }
        filas.push({ item_id: n.id, cant: n.cant || 0, pu: n.pu, descripcion: n.desc, um: n.um, justificacion: n.just || '' });
      }
    }
    var r = calcular();
    if (!soloPlazo && r.pctAcum > TOPE + 1e-9 &&
        !confirm('El incremento acumulado llega a ' + pc2(r.pctAcum) + ', por encima del tope legal del 20 %. ¿Guardar igual?')) return;
    var b = $('#cvGuardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    global.ObraAPI.convGuardar({
      convenio_id: ED.id, nro: c.nro, tipo: c.tipo,
      fecha_presentacion: c.fecha_presentacion || null, fecha_suscripcion: c.fecha_suscripcion || null,
      fecha_resolucion: c.fecha_resolucion || null, descripcion: c.descripcion || '', doc_url: c.doc_url || '',
      dias_ampliacion: c.dias != null && c.dias !== '' ? c.dias : null
    }, filas).then(function (res) {
      global.toast(esc(res.nro) + ' guardado · ' + res.filas + ' ítem(s)' + (res.items_nuevos ? ' · ' + res.items_nuevos + ' ítem(s) nuevo(s) en el cronograma' : ''));
      ED.sucio = false;
      var id = res.convenio_id;
      return recargar().then(function () { abrirModalConvenio(id); });
    }).catch(function (e) {
      if (b) { b.disabled = false; b.textContent = 'Guardar convenio'; }
      alert('No se pudo guardar: ' + e.message);
    });
  }

  function cambiarEstado(convenioId, estado) {
    var c = (A.CONVENIOS || []).find(function (x) { return String(x.convenio_id) === String(convenioId); }) || {};
    var txt = estado === 'aprobado' ? 'Aprobar ' + c.nro + ': sube el tope de certificación de sus ítems y suma ' + (c.dias_ampliacion || 0) + (c.dias_ampliacion === 1 ? ' día' : ' días') + ' al fin vigente.'
            : estado === 'rechazado' ? 'Rechazar ' + c.nro + ': deja de contar para el tope, el plazo y los convenios siguientes.'
            : 'Volver ' + c.nro + ' a trámite: baja el tope de certificación a lo aprobado antes.';
    if (!confirm(txt + '\n\n¿Confirmás?')) return;
    global.ObraAPI.convEstado(convenioId, estado).then(function () {
      global.toast(esc(c.nro) + ' → ' + (ESTADO_TXT[estado] || estado));
      return recargar();
    }).then(abrirPanel).catch(function (e) { alert('No se pudo cambiar el estado: ' + e.message); });
  }

  function borrar(convenioId) {
    var c = (A.CONVENIOS || []).find(function (x) { return String(x.convenio_id) === String(convenioId); }) || {};
    var conf = prompt('Borrar ' + c.nro + ' con todo su detalle. Los ítems nuevos que creó y no tengan nada cargado también se borran.\n\nEscribí el número exacto para confirmar: ' + c.nro);
    if (conf == null) return;
    global.ObraAPI.convBorrar(convenioId, conf).then(function (r) {
      global.toast(esc(c.nro) + ' borrado' + (r.items_borrados ? ' · ' + r.items_borrados + ' ítem(s) nuevo(s) quitados' : ''));
      return recargar();
    }).then(abrirPanel).catch(function (e) { alert('No se pudo borrar: ' + e.message); });
  }

  // ---------------------------------------------------------- librerías
  var libs = {};
  function cargarLib(nombre, src, global_) {
    if (global[global_]) return Promise.resolve(global[global_]);
    if (!libs[nombre]) libs[nombre] = new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { ok(global[global_]); };
      s.onerror = function () { libs[nombre] = null; mal(new Error('no se pudo cargar ' + nombre + ' (¿sin conexión?)')); };
      document.head.appendChild(s);
    });
    return libs[nombre];
  }
  function descargar(blob, nombre) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function nombreArchivo(ext) { return (ED.cab.nro || 'Convenio').replace(/[^\w]+/g, '_') + '_' + ((A.OBRA || {}).id || '') + '.' + ext; }

  // ------------------------------------------------- Excel (planilla del C.M.)
  async function excelConvenio() {
    var ExcelJS = await cargarLib('Excel', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Presupuesto', { views: [{ state: 'frozen', ySplit: 6 }] });
    var O = A.OBRA || {}, c = ED.cab, r = calcular();
    ws.columns = [{ width: 8 }, { width: 50 }, { width: 9 }, { width: 15 }, { width: 15 }, { width: 14 }, { width: 15 }, { width: 19 }, { width: 19 }, { width: 18 }, { width: 45 }];
    ws.getCell('A1').value = 'PLANILLA DE CÓMPUTO MÉTRICO Y PRESUPUESTO'; ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = O.nombre || ''; ws.getCell('A3').value = 'CANTIDADES PARA ' + String(c.nro).toUpperCase();
    ws.getCell('A4').value = 'Obra ID'; ws.getCell('B4').value = String(O.id || '');
    ws.getCell('D4').value = 'Completá la columna amarilla (cantidad RESULTANTE del convenio) y la justificación. Ítems nuevos: agregá filas debajo de ÍTEMS NUEVOS con número, descripción, unidad, cantidad y precio.';
    ws.getCell('D4').font = { italic: true, color: { argb: 'FF8A4B00' } };
    var H = ['ITEM', 'DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD ANTERIOR', 'CANTIDAD ' + String(c.nro).toUpperCase(), 'DIFERENCIA', 'P.U. GS. IVA INCL.',
             'PRECIO TOTAL ANTERIOR', 'PRECIO TOTAL ' + String(c.nro).toUpperCase(), 'DIFERENCIA GS.', 'JUSTIFICACIÓN'];
    var hr = ws.getRow(6); hr.values = H; hr.font = { bold: true }; hr.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    hr.eachCell(function (x) { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } }; });
    var row = 7, ini = 7;
    function fila(vals, amarillas) {
      var rr = ws.getRow(row);
      rr.values = vals;
      [4, 5, 6].forEach(function (k) { rr.getCell(k).numFmt = '#,##0.######'; });
      [7, 8, 9, 10].forEach(function (k) { rr.getCell(k).numFmt = '#,##0'; });
      (amarillas || []).forEach(function (k) { rr.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } }; });
      row++; return rr;
    }
    var t = ws.getRow(row++); t.values = ['', 'ÍTEMS DE CONTRATO']; t.font = { bold: true };
    filasPrincipales().forEach(function (i) {
      if (tipoItem(i) === 'grupo') { var g = ws.getRow(row++); g.values = [i.id, i.desc]; g.font = { bold: true }; return; }
      var a = ED.prev[i.id] || 0, cq = ED.cant[i.id] != null ? ED.cant[i.id] : a, k = row;
      fila([i.id, i.desc, i.um || '', a, cq, { formula: 'E' + k + '-D' + k }, Number(i.pu) || 0,
            { formula: 'D' + k + '*G' + k }, { formula: 'E' + k + '*G' + k }, { formula: 'I' + k + '-H' + k }, ED.just[i.id] || null], [5]);
    });
    var tn = ws.getRow(row++); tn.values = ['', 'ÍTEMS NUEVOS']; tn.font = { bold: true };
    ED.nuevos.forEach(function (n) {
      var k = row;
      fila([n.id, n.desc, n.um, 0, n.cant || 0, { formula: 'E' + k + '-D' + k }, n.pu || 0,
            { formula: 'D' + k + '*G' + k }, { formula: 'E' + k + '*G' + k }, { formula: 'I' + k + '-H' + k }, n.just || null], [5, 7]);
    });
    for (var e = 0; e < 5; e++) { var k2 = row; fila(['', '', '', 0, null, { formula: 'E' + k2 + '-D' + k2 }, null, { formula: 'D' + k2 + '*G' + k2 }, { formula: 'E' + k2 + '*G' + k2 }, { formula: 'I' + k2 + '-H' + k2 }, null], [1, 2, 3, 5, 7]); }
    var fin = row - 1, tot = row;
    var tr = ws.getRow(row++); tr.values = ['', 'TOTAL GS. IVA INCLUIDO', '', '', '', '', '', { formula: 'SUM(H' + ini + ':H' + fin + ')' }, { formula: 'SUM(I' + ini + ':I' + fin + ')' }, { formula: 'SUM(J' + ini + ':J' + fin + ')' }];
    tr.font = { bold: true }; [8, 9, 10].forEach(function (k) { tr.getCell(k).numFmt = '#,##0'; });
    var mo = ws.getRow(row++); mo.values = ['', 'MONTO CONTRATO ORIGINAL', '', '', '', '', '', r.original]; mo.getCell(8).numFmt = '#,##0';
    var inc = ws.getRow(row++); inc.values = ['', 'INCREMENTO ACUMULADO SOBRE EL ORIGINAL (máximo 20 %)', '', '', '', '', '', '', { formula: 'I' + tot + '/H' + (tot + 1) + '-1' }];
    inc.getCell(9).numFmt = '0.00%'; inc.font = { bold: true };
    var mx = ws.getRow(row++); mx.values = ['', 'MONTO MÁXIMO (20 %)', '', '', '', '', '', '', { formula: 'H' + (tot + 1) + '*1.2' }, { formula: 'I' + (tot + 3) + '-I' + tot }];
    mx.getCell(9).numFmt = '#,##0'; mx.getCell(10).numFmt = '#,##0';
    var buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo('xlsx'));
  }

  async function cargarExcelConvenio(file) {
    var ExcelJS = await cargarLib('Excel', 'exceljs.min.js?v=4.4.0', 'ExcelJS');
    var wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    var ws = wb.worksheets[0];
    function val(cell) { var v = cell.value; if (v && typeof v === 'object') v = v.result != null ? v.result : (v.text != null ? v.text : (v.richText ? v.richText.map(function (t) { return t.text; }).join('') : null)); return v; }
    var hdr = 0, colC = 5, colJ = 11, colPU = 7;
    ws.eachRow(function (rw, i) {
      if (hdr) return;
      if (String(val(rw.getCell(1)) || '').trim().toUpperCase() === 'ITEM') {
        hdr = i;
        rw.eachCell(function (cl, k) {
          var t = String(val(cl) || '').toUpperCase();
          if (k > 4 && /CANTIDAD/.test(t) && !/ANTERIOR|CONTRATO/.test(t) && colC === 5) colC = k;
          if (/JUSTIFIC/.test(t)) colJ = k;
          if (/P\.?\s?U|PRECIO UNITARIO/.test(t)) colPU = k;
        });
      }
    });
    if (!hdr) throw new Error('no encontré la fila de encabezado (columna A = "ITEM")');
    var enNuevos = false, leidos = 0, nuevos = 0, avisos = [];
    var princ = {}; filasPrincipales().forEach(function (i) { if (tipoItem(i) === 'item') princ[i.id] = i; });
    ws.eachRow(function (rw, i) {
      if (i <= hdr) return;
      var id = String(val(rw.getCell(1)) == null ? '' : val(rw.getCell(1))).trim();
      var desc = String(val(rw.getCell(2)) || '').trim();
      if (!id && /NUEVOS/i.test(desc)) { enNuevos = true; return; }
      if (!id) return;
      var cv = val(rw.getCell(colC)), q = (cv == null || cv === '') ? null : parseNum(cv);
      var just = val(rw.getCell(colJ)); just = just == null ? '' : String(just);
      if (princ[id]) {
        if (q === null) return;
        var a = ED.prev[id] || 0;
        if (Math.abs(q - a) > 1e-9) { ED.cant[id] = q; ED.raw[id] = String(q).replace('.', ','); } else { delete ED.cant[id]; delete ED.raw[id]; }
        if (just) ED.just[id] = just;
        leidos++;
      } else if (enNuevos && q) {
        var pu = parseNum(val(rw.getCell(colPU)));
        var ya = ED.nuevos.find(function (n) { return n.id === id; });
        var um = String(val(rw.getCell(3)) || '').trim();
        if (ya) { ya.cant = q; if (pu) ya.pu = pu; if (desc) ya.desc = desc; if (um) ya.um = um; if (just) ya.just = just; }
        else if (itemPorId(id)) avisos.push(id + ' ya existe en la obra');
        else ED.nuevos.push({ id: id, desc: desc, um: um, cant: q, pu: pu || 0, just: just, existe: false });
        nuevos++;
      } else if (q !== null && !princ[id]) avisos.push(id);
    });
    ED.sucio = true; pintarConvenio();
    global.toast('Excel cargado: ' + leidos + ' ítem(s) de contrato, ' + nuevos + ' nuevo(s). Revisá y guardá.' +
                 (avisos.length ? ' Sin coincidencia: ' + avisos.slice(0, 5).join(', ') : ''));
  }

  // ------------------------------------------------- número a letras (guaraníes)
  function enLetras(n) {
    n = Math.round(Math.abs(Number(n) || 0));
    if (n === 0) return 'cero';
    var U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
             'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
             'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    var D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    var C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    function cien(x) {
      if (x === 100) return 'cien';
      var c = Math.floor(x / 100), r = x % 100, s = C[c];
      if (r) s += (s ? ' ' : '') + (r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' y ' + U[r % 10] : ''));
      return s;
    }
    function mil(x) {
      var m = Math.floor(x / 1000), r = x % 1000, s = '';
      if (m) s = (m === 1 ? 'mil' : cien(m).replace(/uno$/, 'un') + ' mil');
      if (r) s += (s ? ' ' : '') + cien(r);
      return s;
    }
    var partes = [], millonesDeMillones = Math.floor(n / 1e12), millones = Math.floor((n % 1e12) / 1e6), resto = n % 1e6;
    if (millonesDeMillones) partes.push(millonesDeMillones === 1 ? 'un billón' : mil(millonesDeMillones).replace(/uno$/, 'un') + ' billones');
    if (millones) partes.push(millones === 1 ? 'un millón' : mil(millones).replace(/uno$/, 'un') + ' millones');
    if (resto) partes.push(mil(resto));
    var s = partes.join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ------------------------------------------------- memoria técnica (.docx)
  async function memoriaTecnica() {
    var docx = await cargarLib('Word', 'docx.min.js?v=8.5.0', 'docx');
    var cfg = {};
    try { cfg = (await global.ObraAPI.certDatos((A.OBRA || {}).id)).cfg || {}; } catch (e) {}
    var O = A.OBRA || {}, P = A.PLAZO || {}, c = ED.cab, r = calcular();
    var Pg = docx.Paragraph, T = docx.TextRun, H = docx.HeadingLevel, AL = docx.AlignmentType;
    function p(txt, op) { op = op || {}; return new Pg({ alignment: op.al || AL.JUSTIFIED, spacing: { after: 120 }, children: [new T({ text: txt, bold: !!op.b, size: op.size || 22 })] }); }
    function tit(txt) { return new Pg({ heading: H.HEADING_2, spacing: { before: 240, after: 120 }, children: [new T({ text: txt, bold: true })] }); }
    function gs(v) { return '₲ ' + (Number(v) || 0).toLocaleString('es-PY', { maximumFractionDigits: 0 }); }
    var grupos = { aum: [], dis: [], igual: [], nuevo: [] };
    filasPrincipales().forEach(function (i) {
      if (tipoItem(i) !== 'item') return;
      var a = ED.prev[i.id] || 0, cq = ED.cant[i.id] != null ? ED.cant[i.id] : a;
      var k = cq > a + 1e-9 ? 'aum' : (cq < a - 1e-9 ? 'dis' : 'igual');
      grupos[k].push({ id: i.id, desc: i.desc, um: i.um || '', a: a, c: cq, just: ED.just[i.id] || '' });
    });
    ED.nuevos.forEach(function (n) { grupos.nuevo.push({ id: n.id, desc: n.desc, um: n.um, a: 0, c: n.cant, pu: n.pu, just: n.just || '' }); });
    function lista(arr) {
      return arr.map(function (x) {
        return new Pg({ bullet: { level: 0 }, spacing: { after: 80 }, alignment: AL.JUSTIFIED, children: [
          new T({ text: 'Ítem N° ' + x.id + ' – ' + x.desc + ': ', bold: true }),
          new T({ text: x.just || '[completar justificación]' })] });
      });
    }
    function cuadro(arr) {
      if (!arr.length) return [];
      var cel = function (t, b, al) { return new docx.TableCell({ children: [new Pg({ alignment: al || AL.LEFT, children: [new T({ text: String(t), bold: !!b, size: 18 })] })] }); };
      var fn = function (v) { return (Number(v) || 0).toLocaleString('es-PY', { maximumFractionDigits: 6 }); };
      return [p('Cuadro comparativo:', { b: true }), new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows:
        [new docx.TableRow({ tableHeader: true, children: ['Ítem', 'Descripción', 'U/M', 'Cant. anterior', 'Cant. ' + c.nro, 'Diferencia'].map(function (h) { return cel(h, true, AL.CENTER); }) })]
        .concat(arr.map(function (x) { return new docx.TableRow({ children: [cel(x.id), cel(x.desc), cel(x.um, false, AL.CENTER), cel(fn(x.a), false, AL.RIGHT), cel(fn(x.c), false, AL.RIGHT), cel(fn(x.c - x.a), false, AL.RIGHT)] }); })) })];
    }
    var nroCorto = String(c.nro).replace(/^C\.?M\.?\s*N?°?\s*/i, '') || ED.orden;
    var hijos = [
      p(cfg.comitente || 'MINISTERIO DE OBRAS PÚBLICAS Y COMUNICACIONES', { b: true, al: AL.CENTER }),
      cfg.dependencia ? p(cfg.dependencia, { b: true, al: AL.CENTER }) : null,
      p(cfg.obra || O.nombre || '', { b: true, al: AL.CENTER }),
      p('DOCUMENTACIÓN TÉCNICA', { b: true, al: AL.CENTER, size: 26 }),
      p('CONVENIO MODIFICATORIO Nº ' + nroCorto, { b: true, al: AL.CENTER, size: 26 }),
      p('Por cuanto, en atención a que el ' + (cfg.contrato || '[Contrato N°]') + (cfg.fecha_contrato ? ', suscrito en fecha ' + fD(cfg.fecha_contrato) : '') +
        ', para la ejecución de la Obra "' + (cfg.obra || O.nombre || '') + '"' + (cfg.resolucion ? ', adjudicada por Resolución Ministerial N° ' + cfg.resolucion : '') +
        ', entre el ' + (cfg.comitente || 'MINISTERIO DE OBRAS PÚBLICAS Y COMUNICACIONES') + ' y la Empresa ' + String(cfg.contratista || 'TECNOLOGÍA DEL SUR S.A.E. (TECSUL S.A.E.)').replace(/\n/g, ' ') +
        ', que prevé que cuando fuere necesario ampliar, modificar o complementar las obras objeto del contrato debido a causas imprevistas o técnicas presentadas durante su ejecución serán acordados mediante convenios modificatorios, se expide la presente documentación técnica para la emisión del Convenio Modificatorio N° ' + nroCorto + ', de acuerdo a los siguientes términos:'),
      tit('ALCANCE'),
      p(c.descripcion || '[Describir el alcance y los motivos del convenio]'),
      tit('DESCRIPCIÓN DE LA VARIACIÓN DE LOS ÍTEMS'),
      p('Los cambios a realizarse involucran la variación de las cantidades de trabajos contractuales ajustados a las necesidades reales de la obra' + (grupos.nuevo.length ? ' y la incorporación de ítems no previstos en el contrato.' : '.')),
      grupos.aum.length ? p('Ítems cuyas cantidades estimadas aumentaron:', { b: true }) : null
    ].concat(lista(grupos.aum), cuadro(grupos.aum),
      [grupos.dis.length ? p('Ítems cuyas cantidades estimadas disminuyeron:', { b: true }) : null], lista(grupos.dis), cuadro(grupos.dis),
      [grupos.igual.length ? p('Ítems cuyas cantidades no sufrieron variación: ' + grupos.igual.map(function (x) { return x.id; }).join(', ') + '.', { b: true }) : null],
      [grupos.nuevo.length ? p('Ítems nuevos:', { b: true }) : null], lista(grupos.nuevo), cuadro(grupos.nuevo),
      [tit('PLANILLA COMPARATIVA'),
       p('El presupuesto actualizado de la obra se presenta en el Anexo 1, en el cual se incluye además el cuadro comparativo con relación a las cantidades originalmente previstas. De allí se desprenden los siguientes datos:'),
       p('El precio contractual asciende a la suma de ' + gs(r.original) + ' (guaraníes ' + enLetras(r.original) + ') IVA incluido.'),
       p('El presente Convenio Modificatorio N° ' + nroCorto + ' ' + (r.dif >= 0 ? 'incrementa' : 'disminuye') + ' el monto contractual vigente en la cantidad de ' + gs(Math.abs(r.dif)) +
         ' (guaraníes ' + enLetras(Math.abs(r.dif)) + ') IVA incluido, lo que representa un ' + (r.dif >= 0 ? 'incremento' : 'decremento') + ' del ' + pc2(Math.abs(r.pctIncr)) + ' sobre el monto de Contrato' +
         (Math.abs(r.pctAcum - r.pctIncr) > 1e-9 ? ' (acumulado con convenios anteriores: ' + pc2(r.pctAcum) + ')' : '') + '.'),
       p('El monto Contractual final del Convenio Modificatorio N° ' + nroCorto + ' asciende a ' + gs(r.despues) + ' (guaraníes ' + enLetras(r.despues) + ') IVA incluido.'),
       tit('PLAZO DE LA OBRA'),
       p('Orden de Inicio: ' + fD(P.fecha_inicio)),
       p('Plazo Original: ' + (P.plazo_meses || '[ ]') + ' meses'),
       p('Fecha de Culminación Original: ' + fD(P.fin_original) + '.'),
       p('Plazo ampliado debido al mayor alcance de las obras comprendidas en el C.M. Nº ' + nroCorto + ': ' + r.dias + ' días, determinado de la siguiente manera:'),
       p('Proporcional al aumento de alcance de Obra: ' + pc2(r.pctIncr) + ' x ' + r.meses + ' meses x ' + r.dpm + ' días = ' + r.diasProp + ' días'),
       p('Fecha de culminación con el presente convenio: ' + fD(r.finNuevo) + '.'),
       p('El Cronograma Físico – Financiero y su correspondiente Curva de Avance se incluyen en el Anexo 2.'),
       tit('ÍNDICE DE ANEXOS'),
       p('Anexo 1 – Planilla de Montos, Cómputos Métricos.'), p('Anexo 2 – Cronograma Físico – Financiero y Curva de Avance.'),
       p('Anexo 3 – Análisis de Costos Unitarios de ítems nuevos incorporados.'), p('Anexo 4 – Especificaciones Técnicas de ítems nuevos incorporados.'),
       p('Anexo 5 – Planos ejecutivos.')]).filter(Boolean);
    var doc = new docx.Document({ styles: { default: { document: { run: { font: 'Arial', size: 22 } } } }, sections: [{ children: hijos }] });
    var blob = await docx.Packer.toBlob(doc);
    descargar(blob, 'Memoria_tecnica_' + nombreArchivo('docx'));
  }

  /* ======================================================================
   *  6 · SELECTOR DE VERSIÓN DE LA CURVA CONTRACTUAL
   *  Se alimenta de los convenios APROBADOS, ordenados por `orden`. La curva
   *  se reconstruye desde ConvenioDetalle.
   * ====================================================================*/
  function opcionesVersion() {
    var aps = global.conveniosAprobados();
    var o = '<option value="">v0 · contrato original</option>';
    aps.forEach(function (c, k) {
      o += '<option value="' + esc(c.convenio_id) + '"' + (A.CURVA_VER === c.convenio_id ? ' selected' : '') + '>' +
        'v' + (k + 1) + ' · ' + esc(c.nro) + (k === aps.length - 1 ? ' (vigente)' : '') + '</option>';
    });
    return o;
  }

  function montarSelectorVersion() {
    var host = $('#curvasVersion');
    if (!host) return;
    if (!global.esObraPublica() || !global.conveniosAprobados().length) { host.innerHTML = ''; return; }
    host.innerHTML = '<label class="hint" style="display:flex;align-items:center;gap:6px">Contractual: ' +
      '<select id="cvVerSel">' + opcionesVersion() + '</select></label>';
    $('#cvVerSel').onchange = function () {
      A.CURVA_VER = $('#cvVerSel').value || null;
      // encender/apagar la curva de versión junto con la selección
      try {
        var sel = global.curvasSel();
        sel.contractualVer = !!A.CURVA_VER;
        global.guardarCurvasSel();
      } catch (e) {}
      if (typeof global.renderCurvas === 'function') global.renderCurvas();
    };
  }

  /* ======================================================================
   *  7 · RECARGA DEL MODELO
   * ====================================================================*/
  function recargar() {
    return global.ObraAPI.getObra(A.OBRA.id).then(function (data) {
      global.reloadModel(data);
      if (typeof global.renderGantt === 'function') global.renderGantt();
      if (typeof global.renderCurvas === 'function') global.renderCurvas();
      montarSelectorVersion();
    });
  }

  /* ======================================================================
   *  8 · LÍNEA BASE CON CONVENIO (bloque 8)
   *  Reemplaza el prompt() por un modal con el selector opcional
   *  "Corresponde al convenio: [CM-01 ▾]".
   * ====================================================================*/
  function abrirModalLineaBase() {
    var m = $('#modal');
    var aps = global.conveniosAprobados();
    var n = (A.BASELINES || []).length + 1;
    m.innerHTML = '<div class="modal-card">' +
      '<button class="x" onclick="closeModal()">×</button>' +
      '<h3>Nueva línea base</h3>' +
      '<p class="hint">Congela fechas, distribución mensual y cantidades (la operativa y la contractual).</p>' +
      '<div class="dfield"><label>Nombre</label><input id="lbNom" value="Línea base ' + n + '"></div>' +
      (aps.length
        ? '<div class="dfield" style="margin-top:8px"><label>Corresponde al convenio <small>(opcional)</small></label>' +
          '<select id="lbConv"><option value="">— ninguno (replanificación) —</option>' +
          aps.map(function (c) { return '<option value="' + esc(c.convenio_id) + '">' + esc(c.nro) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="hint" style="margin-top:6px">Etiquetarla con un convenio la marca como <b>línea base de convenio</b>: ' +
          'queda protegida contra borrado accidental.</div>'
        : '<div class="hint" style="margin-top:8px">No hay convenios aprobados para asociar.</div>') +
      '<div class="dactions"><button class="dsave" id="lbSave">Crear línea base</button></div>' +
    '</div>';
    m.classList.add('open');
    $('#lbSave').onclick = function () {
      var nom = $('#lbNom').value.trim();
      if (!nom) { alert('Poné un nombre'); return; }
      var cid = $('#lbConv') ? ($('#lbConv').value || null) : null;
      var b = global.snapshotBaseline(nom, cid);
      A.activeBaseline = b.id;
      if (typeof global.renderBaselineControls === 'function') global.renderBaselineControls();
      var sb = $('#showBase'); if (sb) sb.checked = true;
      if (typeof global.renderGantt === 'function') global.renderGantt();
      global.closeModal();
      global.toast('Línea base <b>' + esc(b.name) + '</b> guardada' + (cid ? ' (convenio)' : ''));
    };
  }

  /* ======================================================================
   *  9 · ARRANQUE
   * ====================================================================*/
  function init() {
    var btn = $('#convBtn');
    if (btn) {
      btn.onclick = abrirPanel;
      // en obra privada el botón habla de plazo, no de convenios modificatorios
      btn.title = global.esObraPublica()
        ? 'Convenios modificatorios, tope de certificación y plazo vigente'
        : 'Plazo contractual y ampliaciones informales de plazo';
    }
    // el flujo de línea base pasa por el modal (agrega el selector de convenio)
    var bl = $('#blSave');
    if (bl) bl.onclick = abrirModalLineaBase;
    montarSelectorVersion();
  }

  global.Convenios = {
    abrirPanel: abrirPanel,
    abrirModalConvenio: abrirModalConvenio,
    abrirModalLineaBase: abrirModalLineaBase,
    montarSelectorVersion: montarSelectorVersion,
    ejecutadoNoCertificable: ejecutadoNoCertificable,
    init: init
  };

  // app.js ya corrió (este script va después), pero el modelo se carga en boot():
  // se engancha en DOMContentLoaded y además se re-monta el selector al recargar.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);

})(window);
