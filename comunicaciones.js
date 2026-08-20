/* =========================================================================
 * comunicaciones.js — archivo de correspondencia de la obra
 *
 * Contesta dos preguntas y las pone arriba de todo:
 *     ¿qué nos pidieron y no contestamos?   (Debemos responder)
 *     ¿qué pedimos y no nos contestaron?    (Sin respuesta de ellos)
 *
 * La vista NO calcula estado ni dirección: eso viene resuelto del backend
 * (comListar). Acá solo se filtra, se dibuja y se manda a guardar.
 *
 * En el celular la vista es de CONSULTA + ALTA. Editar y cerrar quedan en
 * escritorio: cerrar una nota es irreversible y tiene peso legal, no es algo
 * para resolver con el pulgar arriba de un andamio.
 *
 * Depende de: ObraAPI (api.js), y de app.js para $, $$, toast.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $  = global.$  || function (s) { return document.querySelector(s); };
  var $$ = global.$$ || function (s) { return [].slice.call(document.querySelectorAll(s)); };
  function toast(h) { if (global.toast) global.toast(h); }

  var COM = {
    registros: [],
    porId: {},
    kpi: { debemos: 0, esperamos: 0, vencidas: 0, total: 0 },
    miRol: '',
    partes: [],
    tipos: [],
    medios: [],
    obra: '',
    cargando: false,
    // filtros de la vista
    fDir: '',            // '' | 'entra' | 'sale'
    fEstado: 'pendiente',// '' | 'pendiente' | 'cerrada'
    fTexto: '',
    editando: null       // com_id en edición, o null si es alta
  };

  function esMovil() { return document.body.classList.contains('mobile'); }
  function esLectura() { return document.body.classList.contains('readonly'); }
  function esAdmin() { return global.__role === 'admin'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* dd/mm para la lista (compacto), dd/mm/aaaa para la ficha */
  function fCorta(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1]) : iso;
  }
  function fLarga(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
  }
  function hoyISO() {
    var d = new Date(), m = ('0' + (d.getMonth() + 1)).slice(-2), a = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + a;
  }
  /* días hasta el vencimiento; negativo = vencida */
  function diasHasta(iso) {
    if (!iso) return null;
    var h = new Date(hoyISO() + 'T00:00:00'), v = new Date(iso + 'T00:00:00');
    if (isNaN(v)) return null;
    return Math.round((v - h) / 86400000);
  }

  var ETIQ_ESTADO = {
    pendiente:  { t: 'Pendiente',  c: 'pend' },
    respondida: { t: 'Respondida', c: 'resp' },
    cerrada:    { t: 'Cerrada',    c: 'cerr' },
    archivada:  { t: 'Antecedente',c: 'arch' }
  };
  var ETIQ_DIR = {
    entra:       { t: '↙ Entra',  c: 'in' },
    sale:        { t: '↗ Sale',   c: 'out' },
    sin_definir: { t: '? Sin definir', c: 'nd' }
  };

  /* ---------------------------------------------------------------- datos */

  function comCargar(force) {
    var oid = global.ObraAPI ? global.ObraAPI.getObraId() : '';
    if (!force && COM.obra === oid && COM.registros.length) return Promise.resolve();
    if (COM.cargando) return Promise.resolve();
    COM.cargando = true;
    comPintarEstado('Cargando el archivo de correspondencia…');
    return global.ObraAPI.comListar(oid).then(function (r) {
      COM.registros = r.registros || [];
      COM.kpi = r.kpi || { debemos: 0, esperamos: 0, vencidas: 0, total: 0 };
      COM.miRol = r.mi_rol || '';
      COM.partes = r.partes || [];
      COM.tipos = r.tipos || [];
      COM.medios = r.medios || [];
      COM.obra = oid;
      COM.porId = {};
      COM.registros.forEach(function (n) { COM.porId[n.com_id] = n; });
      comRender();
    }).catch(function (e) {
      comPintarEstado('No se pudo cargar: ' + esc(e.message));
    }).then(function () { COM.cargando = false; });
  }

  function comPintarEstado(html) {
    var c = $('#comLista'); if (c) c.innerHTML = '<div class="com-empty">' + html + '</div>';
  }

  /* ------------------------------------------------------------- filtrado */

  function comFiltradas() {
    var t = COM.fTexto.trim().toLowerCase();
    return COM.registros.filter(function (n) {
      if (COM.fDir && n.direccion !== COM.fDir) return false;
      if (COM.fEstado === 'pendiente' && n.estado_hilo !== 'pendiente') return false;
      if (COM.fEstado === 'cerrada' && n.estado_hilo !== 'cerrada') return false;
      if (!t) return true;
      return (n.nro + ' ' + n.asunto + ' ' + n.de + ' ' + n.para + ' ' + n.resumen)
             .toLowerCase().indexOf(t) >= 0;
    });
  }

  /* -------------------------------------------------------------- render */

  function comRender() {
    comRenderKpis();
    comRenderRolWarn();
    var filas = comFiltradas();
    var c = $('#comLista'); if (!c) return;

    if (!filas.length) {
      c.innerHTML = '<div class="com-empty">' +
        (COM.registros.length
          ? 'Ninguna nota coincide con el filtro.'
          : 'Todavía no hay notas registradas en esta obra.') + '</div>';
      return;
    }
    // el celular no tiene ancho para una tabla de 7 columnas: va en tarjetas
    c.innerHTML = esMovil() ? comCards(filas) : comTabla(filas);
  }

  function comRenderKpis() {
    var k = COM.kpi, c = $('#comKpis'); if (!c) return;
    function tile(lab, val, cls, sub) {
      return '<div class="com-kpi ' + cls + '"><div class="lab">' + lab + '</div>' +
             '<div class="val">' + val + '</div><div class="sub">' + sub + '</div></div>';
    }
    c.innerHTML =
      tile('Debemos responder', k.debemos, k.debemos ? 'alerta' : '', 'notas que entraron sin contestar') +
      tile('Sin respuesta de ellos', k.esperamos, '', 'notas que salieron sin respuesta') +
      tile('Vencidas', k.vencidas, k.vencidas ? 'malo' : '', 'pasaron su fecha límite') +
      tile('Total archivado', k.total, '', 'notas de esta obra');
  }

  /* Sin mi_rol configurado la dirección no se puede derivar y los KPIs mienten
     por omisión (todo queda 'sin definir'). Se avisa fuerte, con el dato de
     cómo arreglarlo, en vez de mostrar ceros que parecen buenas noticias. */
  function comRenderRolWarn() {
    var w = $('#comRolWarn'); if (!w) return;
    if (COM.miRol) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    w.innerHTML = '⚠ <b>Falta definir quiénes somos en esta obra.</b> Sin eso no se puede ' +
      'saber si una nota entra o sale, y los contadores de arriba quedan en cero. ' +
      'Cargá en la hoja <b>Config</b> la fila <code>com:mi_rol</code> con el nombre que usás ' +
      'en las notas (por ejemplo <code>TECSUL</code>), y el <code>obra_id</code> de esta obra.';
  }

  function chip(map, key) {
    var e = map[key] || { t: key, c: 'nd' };
    return '<span class="com-chip ' + e.c + '">' + esc(e.t) + '</span>';
  }

  function venceHtml(n) {
    if (!n.vence || n.estado_hilo !== 'pendiente') return '';
    var d = diasHasta(n.vence);
    if (d === null) return '';
    if (d < 0)  return '<span class="com-vence malo">vencida hace ' + (-d) + ' d</span>';
    if (d === 0) return '<span class="com-vence malo">vence hoy</span>';
    if (d <= 3) return '<span class="com-vence alerta">vence en ' + d + ' d</span>';
    return '<span class="com-vence">vence en ' + d + ' d</span>';
  }

  function comTabla(filas) {
    var h = '<table class="com-table"><thead><tr>' +
      '<th>Nº</th><th>Dirección</th><th>Fecha</th><th>De → Para</th>' +
      '<th>Asunto</th><th>Estado</th><th></th>' +
      '</tr></thead><tbody>';
    filas.forEach(function (n) {
      h += '<tr data-com="' + esc(n.com_id) + '" class="' + (n.vencida ? 'com-row-vencida' : '') + '">' +
        '<td class="com-nro">' + esc(n.nro || '—') + '</td>' +
        '<td>' + chip(ETIQ_DIR, n.direccion) + '</td>' +
        '<td class="com-fecha">' + fCorta(n.fecha_recepcion || n.fecha_nota) + '</td>' +
        '<td class="com-partes">' + esc(n.de) + ' <span class="fl">→</span> ' + esc(n.para) + '</td>' +
        '<td class="com-asunto">' + esc(n.asunto) +
          (n.resp_a ? ' <span class="com-hilo" title="Responde a una nota anterior">↳ respuesta</span>' : '') +
        '</td>' +
        '<td>' + chip(ETIQ_ESTADO, n.estado_hilo) + ' ' + venceHtml(n) + '</td>' +
        '<td class="com-acts"><button class="com-ver" data-ver="' + esc(n.com_id) + '">Ver</button></td>' +
      '</tr>';
    });
    return h + '</tbody></table>';
  }

  function comCards(filas) {
    var h = '<div class="com-cards">';
    filas.forEach(function (n) {
      h += '<button class="com-card' + (n.vencida ? ' vencida' : '') + '" data-ver="' + esc(n.com_id) + '">' +
        '<div class="cc-top">' + chip(ETIQ_DIR, n.direccion) + chip(ETIQ_ESTADO, n.estado_hilo) +
          '<span class="cc-fecha">' + fCorta(n.fecha_recepcion || n.fecha_nota) + '</span></div>' +
        '<div class="cc-asunto">' + esc(n.asunto) + '</div>' +
        '<div class="cc-partes">' + esc(n.de) + ' → ' + esc(n.para) + '</div>' +
        '<div class="cc-pie">' + (n.nro ? '<span class="cc-nro">' + esc(n.nro) + '</span>' : '') +
          venceHtml(n) + '</div>' +
      '</button>';
    });
    return h + '</div>';
  }

  /* ---------------------------------------------------------- ficha (ver) */

  function comVer(comId) {
    var n = COM.porId[comId]; if (!n) return;
    var padre = n.resp_a ? COM.porId[n.resp_a] : null;
    var hijas = COM.registros.filter(function (x) { return x.resp_a === comId; });

    var h = '<div class="com-ficha">';
    h += '<div class="cf-head"><div>' + chip(ETIQ_DIR, n.direccion) + chip(ETIQ_ESTADO, n.estado_hilo) +
         venceHtml(n) + '</div>' +
         '<button class="cf-x" data-com-cerrar-ficha>✕</button></div>';
    h += '<h3>' + esc(n.asunto) + '</h3>';
    h += '<div class="cf-nro">' + (n.nro ? 'Nº ' + esc(n.nro) : '<i>sin número asignado</i>') + '</div>';

    h += '<dl class="cf-datos">';
    function dato(k, v) { h += '<dt>' + k + '</dt><dd>' + v + '</dd>'; }
    dato('De', esc(n.de));
    dato('Para', esc(n.para));
    dato('Fecha de la nota', fLarga(n.fecha_nota));
    dato('Fecha de recepción', fLarga(n.fecha_recepcion));
    if (n.tipo)  dato('Tipo', esc(n.tipo));
    if (n.medio) dato('Medio', esc(n.medio));
    if (n.requiere_resp) dato('Respuesta', 'requerida' + (n.vence ? ' antes del ' + fLarga(n.vence) : ''));
    if (n.responsable) dato('Responsable', esc(n.responsable));
    if (n.link) dato('Documento', '<a href="' + esc(n.link) + '" target="_blank" rel="noopener">abrir</a>');
    h += '</dl>';

    if (n.resumen) h += '<div class="cf-resumen">' + esc(n.resumen).replace(/\n/g, '<br>') + '</div>';

    if (padre || hijas.length) {
      h += '<div class="cf-hilo"><div class="cf-hilo-tit">Hilo</div>';
      if (padre) h += '<button class="cf-link" data-ver="' + esc(padre.com_id) + '">↑ Responde a: ' +
                      esc(padre.nro || padre.asunto) + '</button>';
      hijas.forEach(function (x) {
        h += '<button class="cf-link" data-ver="' + esc(x.com_id) + '">↓ Respondida por: ' +
             esc(x.nro || x.asunto) + '</button>';
      });
      h += '</div>';
    }

    h += '<div class="cf-acts">';
    if (!esMovil() && !esLectura() && !n.cerrada) {
      h += '<button class="chipbtn" data-com-editar="' + esc(n.com_id) + '">✎ Editar</button>';
      h += '<button class="chipbtn tape" data-com-responder="' + esc(n.com_id) + '">↩ Registrar respuesta</button>';
      h += '<button class="chipbtn" data-com-cerrar="' + esc(n.com_id) + '">✓ Cerrar nota</button>';
      if (esAdmin()) h += '<button class="chipbtn peligro" data-com-borrar="' + esc(n.com_id) + '">🗑 Borrar</button>';
    } else if (esMovil() && !esLectura() && !n.cerrada) {
      h += '<button class="chipbtn tape" data-com-responder="' + esc(n.com_id) + '">↩ Registrar respuesta</button>';
      h += '<div class="cf-nota-movil">Editar y cerrar notas se hace desde la computadora.</div>';
    } else if (n.cerrada) {
      h += '<div class="cf-nota-movil">Nota cerrada: es un registro definitivo y ya no se modifica.</div>';
    }
    h += '</div></div>';

    var panel = $('#comFicha');
    if (!panel) return;
    panel.innerHTML = h;
    panel.style.display = 'block';
  }

  function comCerrarFicha() {
    var p = $('#comFicha'); if (p) { p.style.display = 'none'; p.innerHTML = ''; }
  }

  /* ------------------------------------------------------------ formulario */

  function opts(lista, sel) {
    return '<option value=""></option>' + lista.map(function (x) {
      return '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
  }

  /* n = nota a editar, o null para alta. respA = com_id al que responde. */
  function comForm(n, respA) {
    n = n || {};
    COM.editando = n.com_id || null;

    var padre = respA ? COM.porId[respA] : (n.resp_a ? COM.porId[n.resp_a] : null);
    // al responder, las partes se dan vuelta solas: el destinatario pasa a ser
    // el remitente. Es lo que el usuario iba a tipear de todos modos.
    var de   = n.de   || (padre ? padre.para : (COM.miRol || ''));
    var para = n.para || (padre ? padre.de : '');
    // al responder, el asunto arranca como "Re: <el de ellos>": es lo que se
    // escribe en el papel y ahorra volver a tipearlo. Sigue siendo editable.
    var asunto = n.asunto || (padre ? ('Re: ' + padre.asunto) : '');

    var h = '<div class="com-form">';
    h += '<div class="cfm-head"><h3>' +
         (COM.editando ? 'Editar nota' : (padre ? 'Registrar respuesta' : 'Registrar nota')) +
         '</h3><button class="cf-x" data-com-cancelar>✕</button></div>';

    if (padre) {
      h += '<div class="cfm-padre">Responde a <b>' + esc(padre.nro || padre.asunto) + '</b>' +
           '<input type="hidden" id="comRespA" value="' + esc(padre.com_id) + '"></div>';
    } else {
      h += '<input type="hidden" id="comRespA" value="">';
    }

    h += '<div class="cfm-grid">';
    h += '<label class="cfm-f"><span>Nº de nota</span>' +
         '<input id="comNro" value="' + esc(n.nro || '') + '" placeholder="' +
         (padre ? 'nuestro número de salida' : 'FIS-014/2026') + '"></label>';
    h += '<label class="cfm-f"><span>Tipo</span><select id="comTipo">' + opts(COM.tipos, n.tipo) + '</select></label>';
    h += '<label class="cfm-f"><span>Medio</span><select id="comMedio">' + opts(COM.medios, n.medio) + '</select></label>';

    h += '<label class="cfm-f"><span>De</span>' +
         '<input id="comDe" list="comPartes" value="' + esc(de) + '" placeholder="Fiscalización"></label>';
    h += '<label class="cfm-f"><span>Para</span>' +
         '<input id="comPara" list="comPartes" value="' + esc(para) + '" placeholder="TECSUL"></label>';
    h += '<div class="cfm-f cfm-dir"><span>Dirección</span><div id="comDirCalc" class="cfm-dircalc">—</div></div>';

    h += '<label class="cfm-f"><span>Fecha de la nota</span>' +
         '<input type="date" id="comFechaNota" value="' + esc(n.fecha_nota || hoyISO()) + '"></label>';
    h += '<label class="cfm-f"><span>Fecha de recepción</span>' +
         '<input type="date" id="comFechaRec" value="' + esc(n.fecha_recepcion || hoyISO()) + '"></label>';
    h += '<label class="cfm-f"><span>Responsable</span>' +
         '<input id="comResponsable" value="' + esc(n.responsable || '') + '" placeholder="quién la atiende"></label>';
    h += '</div>';

    h += '<label class="cfm-full"><span>Asunto</span>' +
         '<input id="comAsunto" value="' + esc(asunto) + '" placeholder="Solicita plan de trabajos actualizado"></label>';
    h += '<label class="cfm-full"><span>Resumen / observaciones</span>' +
         '<textarea id="comResumen" rows="3" placeholder="Qué pide, qué se respondió, qué quedó pendiente.">' +
         esc(n.resumen || '') + '</textarea></label>';

    h += '<div class="cfm-resp">' +
         '<label class="cfm-ck"><input type="checkbox" id="comReqResp"' +
           (n.requiere_resp === undefined ? ' checked' : (n.requiere_resp ? ' checked' : '')) +
           '> Requiere respuesta</label>' +
         '<label class="cfm-f"><span>Vence el</span>' +
           '<input type="date" id="comVence" value="' + esc(n.vence || '') + '"></label>' +
         '</div>';

    h += '<label class="cfm-full"><span>Link al documento (Drive, Gmail…)</span>' +
         '<input id="comLink" value="' + esc(n.link || '') + '" placeholder="https://…"></label>';

    h += '<div class="cfm-foot">' +
         '<button class="chipbtn" data-com-cancelar>Cancelar</button>' +
         '<button class="chipbtn tape" id="comGuardarBtn">💾 Guardar</button></div>';
    h += '</div>';

    var panel = $('#comFicha');
    if (!panel) return;
    panel.innerHTML = h + '<datalist id="comPartes">' +
      COM.partes.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>';
    panel.style.display = 'block';
    comActualizarDir();
    var a = $('#comAsunto'); if (a && !esMovil()) a.focus();
  }

  /* Espeja en vivo la misma regla que aplica el backend, para que el usuario
     vea entra/sale mientras tipea y no descubra el error después de guardar.
     La verdad sigue siendo del servidor: acá es solo una vista previa. */
  function comActualizarDir() {
    var d = $('#comDirCalc'); if (!d) return;
    if (!COM.miRol) { d.innerHTML = '<span class="com-chip nd">sin definir · falta com:mi_rol</span>'; return; }
    function norm(s) {
      return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    var mio = norm(COM.miRol);
    var de = norm($('#comDe') && $('#comDe').value);
    var para = norm($('#comPara') && $('#comPara').value);
    var dir = 'sin_definir';
    if (de && (de.indexOf(mio) >= 0 || mio.indexOf(de) >= 0)) dir = 'sale';
    else if (para && (para.indexOf(mio) >= 0 || mio.indexOf(para) >= 0)) dir = 'entra';
    d.innerHTML = chip(ETIQ_DIR, dir);
  }

  function comGuardar() {
    var nota = {
      com_id:          COM.editando || '',
      nro:             ($('#comNro') || {}).value || '',
      tipo:            ($('#comTipo') || {}).value || '',
      medio:           ($('#comMedio') || {}).value || '',
      de:              ($('#comDe') || {}).value || '',
      para:            ($('#comPara') || {}).value || '',
      fecha_nota:      ($('#comFechaNota') || {}).value || '',
      fecha_recepcion: ($('#comFechaRec') || {}).value || '',
      asunto:          ($('#comAsunto') || {}).value || '',
      resumen:         ($('#comResumen') || {}).value || '',
      requiere_resp:   !!($('#comReqResp') && $('#comReqResp').checked),
      vence:           ($('#comVence') || {}).value || '',
      resp_a:          ($('#comRespA') || {}).value || '',
      responsable:     ($('#comResponsable') || {}).value || '',
      link:            ($('#comLink') || {}).value || ''
    };
    if (!nota.asunto.trim()) { toast('Falta el <b>asunto</b> de la nota'); return; }
    if (!nota.de.trim() || !nota.para.trim()) { toast('Falta <b>de quién</b> viene o <b>a quién</b> va'); return; }

    var btn = $('#comGuardarBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    global.ObraAPI.comGuardar(nota).then(function (r) {
      toast(r.alta ? '✓ Nota registrada' : '✓ Nota actualizada');
      comCerrarFicha();
      return comCargar(true);
    }).catch(function (e) {
      toast('No se pudo guardar: ' + esc(e.message));
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
    });
  }

  function comCerrarNota(comId) {
    var n = COM.porId[comId]; if (!n) return;
    if (!confirm('Cerrar la nota "' + (n.nro || n.asunto) + '".\n\n' +
                 'Es irreversible: una vez cerrada no se edita ni se borra. ' +
                 'Si el asunto sigue, registrá una nota nueva encadenada.\n\n¿Cerrarla?')) return;
    global.ObraAPI.comCerrar(comId).then(function () {
      toast('✓ Nota cerrada');
      comCerrarFicha();
      return comCargar(true);
    }).catch(function (e) { toast('No se pudo cerrar: ' + esc(e.message)); });
  }

  function comBorrarNota(comId) {
    var n = COM.porId[comId]; if (!n) return;
    if (!confirm('Borrar del archivo la nota "' + (n.nro || n.asunto) + '".\n\n' +
                 'Usá esto solo para corregir una carga equivocada.\n\n¿Borrar?')) return;
    global.ObraAPI.comBorrar(comId).then(function () {
      toast('Nota borrada');
      comCerrarFicha();
      return comCargar(true);
    }).catch(function (e) { toast('No se pudo borrar: ' + esc(e.message)); });
  }

  /* ---------------------------------------------------------------- eventos */

  function comBind() {
    var seg = $('#comDir');
    seg && seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#comDir button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); COM.fDir = b.dataset.d || ''; comRender();
    });
    var segE = $('#comEstado');
    segE && segE.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('#comEstado button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); COM.fEstado = b.dataset.e || ''; comRender();
    });
    var busc = $('#comBuscar');
    busc && busc.addEventListener('input', function () { COM.fTexto = busc.value; comRender(); });

    var nueva = $('#comNueva');
    nueva && nueva.addEventListener('click', function () {
      if (esLectura()) { toast('Tu usuario es de solo lectura'); return; }
      comForm(null, null);
    });
    var refr = $('#comRefrescar');
    refr && refr.addEventListener('click', function () { comCargar(true); });

    // delegación: la lista se redibuja entera, así que no se enganchan botones
    var lista = $('#comLista');
    lista && lista.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ver]'); if (!b) return;
      comVer(b.getAttribute('data-ver'));
    });

    var ficha = $('#comFicha');
    ficha && ficha.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-com-cerrar-ficha') || t.hasAttribute('data-com-cancelar')) { comCerrarFicha(); return; }
      if (t.hasAttribute('data-ver'))            { comVer(t.getAttribute('data-ver')); return; }
      if (t.hasAttribute('data-com-editar'))     { comForm(COM.porId[t.getAttribute('data-com-editar')], null); return; }
      if (t.hasAttribute('data-com-responder'))  { comForm(null, t.getAttribute('data-com-responder')); return; }
      if (t.hasAttribute('data-com-cerrar'))     { comCerrarNota(t.getAttribute('data-com-cerrar')); return; }
      if (t.hasAttribute('data-com-borrar'))     { comBorrarNota(t.getAttribute('data-com-borrar')); return; }
      if (t.id === 'comGuardarBtn')              { comGuardar(); return; }
    });
    ficha && ficha.addEventListener('input', function (e) {
      if (e.target.id === 'comDe' || e.target.id === 'comPara') comActualizarDir();
    });

    // Escape cierra la ficha/formulario, como en el resto de la app
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var v = $('#v-com'); if (!v || !v.classList.contains('on')) return;
      comCerrarFicha();
    });
  }

  var bindeado = false;
  function comAbrir() {
    if (!bindeado) { comBind(); bindeado = true; }
    comCargar(false);
  }

  global.ComunicacionesView = {
    abrir: comAbrir,
    refrescar: function () { return comCargar(true); },
    reset: function () { COM.obra = ''; COM.registros = []; COM.porId = {}; }
  };

})(window);
