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
   *  5 · MODAL "CARGAR CONVENIO"  (con preview OBLIGATORIO)
   * ====================================================================*/
  var BORRADOR = null;   // { cabecera + filas } mientras el modal está abierto

  function filasDesdeConvenio(convenioId) {
    return (A.CONV_DET || [])
      .filter(function (d) { return String(d.convenio_id) === String(convenioId); })
      .map(function (d) {
        var it = (A.ITEMS || []).find(function (x) { return x.id === d.item_id; }) || {};
        return { item_id: d.item_id, tipo: d.tipo || 'modificacion', cant: d.cant,
                 pu: d.pu, desc: it.desc || '', um: it.um || '' };
      });
  }

  /* Precarga: los ítems cuya cant_ajustada difiere de la contractual. En la
     práctica el convenio formaliza lo que ya se venía ajustando. */
  function filasSugeridas() {
    var out = [];
    (A.ITEMS || []).forEach(function (i) {
      if (typeof global.esComputable === 'function' && !global.esComputable(i)) return;
      if (i.cant_ajustada == null) return;
      var cc = A.cantContractual(i);
      if (i.cant_ajustada === cc) return;
      out.push({ item_id: i.id, desc: i.desc || '', um: i.um || '',
                 tipo: (i.cant_ajustada === 0 ? 'supresion' : 'modificacion'),
                 cant: i.cant_ajustada, pu: '', _sug: true });
    });
    return out;
  }

  function abrirModalConvenio(convenioId) {
    var c = convenioId ? (global.convenioPorId(convenioId) || {}) : {};
    var esPub = global.esObraPublica();
    BORRADOR = {
      convenio_id: convenioId || '',
      nro: c.nro || ('CM-' + String(((A.CONVENIOS || []).length + 1)).padStart(2, '0')),
      tipo: c.tipo || (esPub ? 'modificatorio' : 'ampliacion_informal'),
      estado: c.estado || 'en_tramite',
      fecha_presentacion: c.fecha_presentacion || '',
      fecha_resolucion: c.fecha_resolucion || '',
      descripcion: c.descripcion || '',
      doc_url: c.doc_url || '',
      dias_ampliacion: convenioId ? c.dias_ampliacion : '',
      items: convenioId ? filasDesdeConvenio(convenioId) : filasSugeridas()
    };
    pintarModalConvenio();
  }

  function filaItemHTML(r, k) {
    var it = (A.ITEMS || []).find(function (x) { return x.id === r.item_id; });
    var prev = it ? A.cantContractual(it) : null;
    var puRef = r.pu !== '' && r.pu != null ? r.pu : (it ? it.pu : 0);
    var delta = (prev == null) ? r.cant : (num(r.cant) || 0) - prev;
    return '<tr data-k="' + k + '">' +
      '<td><input class="cvi-id" data-k="' + k + '" value="' + esc(r.item_id) + '" style="width:74px"></td>' +
      '<td class="cv-desc">' + esc((r.desc || (it ? it.desc : '') || '').slice(0, 46)) + '</td>' +
      '<td><select class="cvi-tipo" data-k="' + k + '">' +
        '<option value="modificacion"' + (r.tipo === 'modificacion' ? ' selected' : '') + '>modificación</option>' +
        '<option value="item_nuevo"' + (r.tipo === 'item_nuevo' ? ' selected' : '') + '>ítem nuevo</option>' +
        '<option value="supresion"' + (r.tipo === 'supresion' ? ' selected' : '') + '>supresión</option>' +
      '</select></td>' +
      '<td class="r mono">' + (prev == null ? '<span class="hint">nuevo</span>' : A.fmtN(prev)) + '</td>' +
      '<td><input class="cvi-cant r" data-k="' + k + '" inputmode="decimal" value="' +
        esc(r.tipo === 'supresion' ? 0 : (r.cant == null ? '' : r.cant)) + '"' +
        (r.tipo === 'supresion' ? ' disabled' : '') + '></td>' +
      '<td><input class="cvi-pu r" data-k="' + k + '" inputmode="decimal" value="' +
        esc(r.pu === '' || r.pu == null ? '' : r.pu) + '" placeholder="' + esc(puRef || 0) + '"' +
        (r.tipo === 'item_nuevo' ? '' : ' disabled title="Los PU de ítems existentes nunca cambian. Si hace falta otro precio, se crea un ítem nuevo."') + '></td>' +
      '<td class="r mono ' + (delta < 0 ? 'cv-neg' : '') + '">' + (delta >= 0 ? '+' : '') + A.fmtN(delta) + '</td>' +
      '<td class="r"><button class="cv-mini cv-del" data-cvi-del="' + k + '" title="Quitar del convenio">×</button></td>' +
    '</tr>';
  }

  function pintarModalConvenio() {
    var B = BORRADOR;
    var esPub = global.esObraPublica();
    var soloPlazo = B.tipo === 'ampliacion_informal';
    var m = $('#modal');

    m.innerHTML = '<div class="modal-card wide">' +
      '<button class="x" onclick="closeModal()">×</button>' +
      '<h3>' + (B.convenio_id ? 'Editar convenio' : (soloPlazo ? 'Ampliación informal de plazo' : 'Cargar convenio modificatorio')) + '</h3>' +

      '<div class="dgrid2">' +
        '<div class="dfield"><label>Número</label><input id="cvNro" value="' + esc(B.nro) + '" placeholder="CM-01"></div>' +
        '<div class="dfield"><label>Tipo</label><select id="cvTipo">' +
          '<option value="modificatorio"' + (B.tipo === 'modificatorio' ? ' selected' : '') + (esPub ? '' : ' disabled') + '>Modificatorio (cantidades + plazo)</option>' +
          '<option value="ampliacion_informal"' + (B.tipo === 'ampliacion_informal' ? ' selected' : '') + '>Ampliación informal (solo plazo)</option>' +
        '</select></div>' +
        '<div class="dfield"><label>Estado</label><select id="cvEstado">' +
          '<option value="en_tramite"' + (B.estado === 'en_tramite' ? ' selected' : '') + '>En trámite</option>' +
          '<option value="aprobado"' + (B.estado === 'aprobado' ? ' selected' : '') + '>Aprobado</option>' +
          '<option value="rechazado"' + (B.estado === 'rechazado' ? ' selected' : '') + '>Rechazado</option>' +
        '</select></div>' +
        '<div class="dfield"><label>Fecha de presentación</label><input type="date" id="cvFp" value="' + esc(B.fecha_presentacion || '') + '"></div>' +
        '<div class="dfield"><label>Fecha de resolución</label><input type="date" id="cvFr" value="' + esc(B.fecha_resolucion || '') + '"></div>' +
        '<div class="dfield"><label>Link al PDF</label><input id="cvDoc" value="' + esc(B.doc_url || '') + '" placeholder="https://…"></div>' +
        '<div class="dfield" style="grid-column:1/-1"><label>Descripción</label>' +
          '<input id="cvDesc" value="' + esc(B.descripcion || '') + '" placeholder="Objeto del convenio"></div>' +
      '</div>' +

      (soloPlazo ? '' :
      '<div style="margin-top:12px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
          '<b style="font-size:13px">Ítems afectados</b>' +
          '<span class="hint" style="flex:1">Precargado con los ítems cuya cantidad ajustada difiere de la contractual. Todo editable.</span>' +
          '<button class="cv-mini" id="cvAddItem" title="Agregar un ítem al convenio">＋</button>' +
          '<button class="cv-mini" id="cvSug" title="Volver a precargar desde las cantidades ajustadas">↺</button>' +
        '</div>' +
        '<div class="prev-wrap" style="max-height:230px">' +
          '<table class="prev-tbl cv-items"><thead><tr>' +
            '<th>ID</th><th>Ítem</th><th>Tipo</th><th class="r">Contractual</th>' +
            '<th class="r">Cant. resultante</th><th class="r">PU (ítem nuevo)</th><th class="r">Δ</th><th></th>' +
          '</tr></thead><tbody id="cvItemsBody">' +
            (B.items.length ? B.items.map(filaItemHTML).join('')
              : '<tr><td colspan="8" class="hint">Sin ítems. Agregá los que el convenio modifica.</td></tr>') +
          '</tbody></table>' +
        '</div>' +
      '</div>') +

      '<div id="cvPreview" class="cv-preview"><p class="hint">Generá el preview para ver el impacto en monto y plazo.</p></div>' +

      '<div class="dactions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span class="hint" style="flex:1;min-width:200px">El convenio tiene peso legal: <b>nada se guarda sin preview aceptado</b>.</span>' +
        '<button class="minibtn" id="cvPrev" style="width:auto;padding:8px 14px">Calcular preview</button>' +
        '<button class="dsave" id="cvSave" disabled>Guardar convenio</button>' +
      '</div>' +
    '</div>';
    m.classList.add('open');
    enlazarModalConvenio();
  }

  function leerCabecera() {
    BORRADOR.nro = $('#cvNro').value.trim();
    BORRADOR.tipo = $('#cvTipo').value;
    BORRADOR.estado = $('#cvEstado').value;
    BORRADOR.fecha_presentacion = $('#cvFp').value || '';
    BORRADOR.fecha_resolucion = $('#cvFr').value || '';
    BORRADOR.descripcion = $('#cvDesc').value;
    BORRADOR.doc_url = $('#cvDoc').value;
  }

  function enlazarModalConvenio() {
    ['#cvNro', '#cvFp', '#cvFr', '#cvDesc', '#cvDoc'].forEach(function (s) {
      var el = $(s); if (el) el.oninput = invalidarPreview;
    });
    $('#cvTipo').onchange = function () { leerCabecera(); pintarModalConvenio(); };
    $('#cvEstado').onchange = invalidarPreview;

    if ($('#cvAddItem')) $('#cvAddItem').onclick = function () {
      leerCabecera(); leerFilas();
      BORRADOR.items.push({ item_id: '', desc: '', um: '', tipo: 'modificacion', cant: '', pu: '' });
      pintarModalConvenio();
    };
    if ($('#cvSug')) $('#cvSug').onclick = function () {
      leerCabecera();
      if (!confirm('Se reemplazan los ítems cargados por la precarga desde las cantidades ajustadas. ¿Seguir?')) return;
      BORRADOR.items = filasSugeridas();
      pintarModalConvenio();
    };
    $$('[data-cvi-del]').forEach(function (b) {
      b.onclick = function () {
        leerCabecera(); leerFilas();
        BORRADOR.items.splice(+b.getAttribute('data-cvi-del'), 1);
        pintarModalConvenio();
      };
    });
    $$('.cvi-tipo').forEach(function (sel) {
      sel.onchange = function () {
        leerCabecera(); leerFilas();
        BORRADOR.items[+sel.getAttribute('data-k')].tipo = sel.value;
        pintarModalConvenio();
      };
    });
    $$('.cvi-id,.cvi-cant,.cvi-pu').forEach(function (inp) { inp.oninput = invalidarPreview; });

    $('#cvPrev').onclick = calcularPreview;
    $('#cvSave').onclick = guardar;
  }

  function leerFilas() {
    if (!$('#cvItemsBody')) return;
    $$('#cvItemsBody tr[data-k]').forEach(function (tr) {
      var k = +tr.getAttribute('data-k');
      var r = BORRADOR.items[k]; if (!r) return;
      var id = tr.querySelector('.cvi-id'), ca = tr.querySelector('.cvi-cant'), pu = tr.querySelector('.cvi-pu');
      if (id) r.item_id = id.value.trim();
      if (ca) r.cant = (r.tipo === 'supresion') ? 0 : num(ca.value);
      if (pu) r.pu = (r.tipo === 'item_nuevo' && pu.value !== '') ? num(pu.value) : '';
    });
  }

  function invalidarPreview() {
    var b = $('#cvSave'); if (b) b.disabled = true;
    var p = $('#cvPreview');
    if (p) p.innerHTML = '<p class="hint">Los datos cambiaron: volvé a generar el preview antes de guardar.</p>';
  }

  function payloadActual() {
    leerCabecera(); leerFilas();
    return {
      convenio_id: BORRADOR.convenio_id || '',
      nro: BORRADOR.nro, tipo: BORRADOR.tipo, estado: BORRADOR.estado,
      fecha_presentacion: BORRADOR.fecha_presentacion,
      fecha_resolucion: BORRADOR.fecha_resolucion,
      descripcion: BORRADOR.descripcion, doc_url: BORRADOR.doc_url,
      dias_ampliacion: BORRADOR.dias_ampliacion === '' || BORRADOR.dias_ampliacion == null ? '' : BORRADOR.dias_ampliacion,
      items: (BORRADOR.items || []).filter(function (r) { return r.item_id; })
    };
  }

  function calcularPreview() {
    var btn = $('#cvPrev'); btn.disabled = true; btn.textContent = 'Calculando…';
    global.ObraAPI.convPreview(payloadActual()).then(function (pv) {
      btn.disabled = false; btn.textContent = 'Calcular preview';
      if (!pv || !pv.ok) throw new Error((pv && pv.error) || 'sin respuesta');
      pintarPreview(pv);
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Calcular preview';
      $('#cvPreview').innerHTML = '<div class="cv-alert">No se pudo calcular: ' + esc(e.message) + '</div>';
    });
  }

  function pintarPreview(pv) {
    var bloqueante = (pv.avisos || []).some(function (a) { return a.nivel === 'error'; });
    var avisos = (pv.avisos || []).map(function (a) {
      var cls = a.nivel === 'error' ? 'cv-alert' : (a.nivel === 'warn' ? 'cv-alert cv-alert-amb' : 'cv-alert cv-alert-info');
      return '<div class="' + cls + '">' + esc(a.txt) + '</div>';
    }).join('');

    $('#cvPreview').innerHTML =
      '<h4 style="margin:12px 0 6px;font-size:13px">Impacto</h4>' +
      '<table class="cv-tbl cv-prev">' +
        '<tr><td>Monto contractual original</td><td class="r mono">' + A.fmtG(pv.monto_original) + '</td></tr>' +
        '<tr><td>Monto antes de este convenio</td><td class="r mono">' + A.fmtG(pv.monto_previo) + '</td></tr>' +
        '<tr><td><b>Monto resultante</b></td><td class="r mono"><b>' + A.fmtG(pv.monto_convenio) + '</b></td></tr>' +
        '<tr><td>Variación de este convenio</td><td class="r mono">' + A.fmtG(pv.monto_delta) + '</td></tr>' +
        '<tr><td>% que aporta este convenio <small>(sobre el original)</small></td>' +
          '<td class="r mono">' + pctTxt(pv.pct_incremento) + '</td></tr>' +
        '<tr class="' + (pv.supera_tope ? 'cv-over' : '') + '"><td><b>% acumulado sobre el original</b></td>' +
          '<td class="r mono"><b>' + pctTxt(pv.pct_acumulado) + '</b></td></tr>' +
        '<tr><td>Plazo original</td><td class="r mono">' + pv.plazo_dias_original + ' días · fin ' + fD(pv.fin_original) + '</td></tr>' +
        '<tr><td>Días calculados por el sistema</td><td class="r mono">+' + pv.dias_calculados + ' d</td></tr>' +
        '<tr><td>Días a aplicar <small>(editable, para quedar fiel al papel firmado)</small></td>' +
          '<td class="r"><input id="cvDias" class="r" inputmode="numeric" style="width:80px" value="' + pv.dias_ampliacion + '"> d</td></tr>' +
        '<tr class="cv-firme"><td><b>Nueva fecha de fin de contrato</b></td>' +
          '<td class="r mono"><b>' + fD(pv.fecha_fin_contrato) + '</b></td></tr>' +
      '</table>' +
      avisos +
      '<div class="cv-alert cv-alert-info"><b>No se crea línea base.</b> Cargar el convenio y crear la línea base son dos acciones ' +
        'separadas: ajustá el cronograma primero y creá la línea base cuando esté listo, desde <b>＋ Línea base</b>.</div>';

    $('#cvDias').oninput = function () {
      BORRADOR.dias_ampliacion = num($('#cvDias').value);
      // cambiar los días obliga a recalcular: el fin resultante depende de esto
      var b = $('#cvSave'); if (b) b.disabled = true;
      $('#cvDias').style.outline = '2px solid #c9820b';
    };
    $('#cvSave').disabled = bloqueante;
    if (bloqueante) global.toast('Hay que resolver los errores antes de guardar');
  }

  function guardar() {
    var btn = $('#cvSave'); btn.disabled = true; btn.textContent = 'Guardando…';
    global.ObraAPI.convGuardar(payloadActual()).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'sin respuesta');
      global.toast(esc(r.aviso || 'Convenio guardado'));
      return recargar();
    }).then(function () {
      global.closeModal();
      abrirPanel();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Guardar convenio';
      alert('No se pudo guardar: ' + e.message);
    });
  }

  function cambiarEstado(convenioId, estado) {
    var c = global.convenioPorId(convenioId) || {};
    var txt = estado === 'aprobado'
      ? 'Aprobar ' + (c.nro || '') + ' sube el tope de certificación, suma los días al fin vigente y limpia la cantidad ajustada de los ítems afectados.\n\n¿Confirmás?'
      : '¿Pasar ' + (c.nro || '') + ' a ' + (ESTADO_TXT[estado] || estado) + '?';
    if (!confirm(txt)) return;
    global.ObraAPI.convEstado(convenioId, estado).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'sin respuesta');
      global.toast('Convenio ' + esc(c.nro || '') + ' → <b>' + (ESTADO_TXT[estado] || estado) + '</b>');
      return recargar();
    }).then(abrirPanel).catch(function (e) { alert('No se pudo cambiar el estado: ' + e.message); });
  }

  function borrar(convenioId) {
    var c = global.convenioPorId(convenioId) || {};
    var conf = '';
    if (c.estado === 'aprobado') {
      conf = prompt('El convenio ' + c.nro + ' está APROBADO. Borrarlo reescribe el tope de certificación y el plazo vigente.\n\n' +
        'Escribí su número exacto (' + c.nro + ') para confirmar:', '');
      if (conf === null) return;
    } else if (!confirm('¿Borrar el convenio ' + (c.nro || '') + '?')) return;

    global.ObraAPI.convBorrar(convenioId, conf).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'sin respuesta');
      global.toast('Convenio borrado');
      return recargar();
    }).then(abrirPanel).catch(function (e) { alert('No se pudo borrar: ' + e.message); });
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
