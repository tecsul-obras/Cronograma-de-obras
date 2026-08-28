/* =========================================================================
 * pista.js — SITUACIÓN DE PISTA dentro de la PWA unificada
 *
 * Representación lineal del estado de la pista por progresivas. Reemplaza el
 * Excel manual que se mandaba por foto como informe de situación.
 *
 * Ventaja sobre el Excel: no se crean ni se borran filas a mano. Se aplica un
 * estado a un RANGO y el eje se reparticiona solo (aplicarTramo).
 *
 * Es CAPA VISUAL / DE REFERENCIA: no toca cantVigente, no alimenta
 * certificación ni avance físico. El resumen por estado es KPI informativo.
 *
 * Lo que DEPENDE DE LA OBRA y por eso se edita desde acá:
 *   · las PROGRESIVAS del eje (y puede haber varios ejes)
 *   · el PAQUETE ESTRUCTURAL: el catálogo de estados, su orden constructivo,
 *     su color y qué cuenta como capa o como neutro
 *
 * Depende de: ObraAPI (api.js) y de app.js para $, $$, toast, parseNum.
 * ========================================================================= */
(function (global) {
  'use strict';

  var $  = global.$  || function (s) { return document.querySelector(s); };
  function toast(h) { if (global.toast) global.toast(h); }
  var numPY = global.parseNum || function (v) { var n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

  /* ============ progresivas ============
     COPIA EXACTA de nprog_ / fprog_ (Code_Pista.gs). Si esta regla se desvía
     de la del servidor vuelve el bug clásico: la pantalla lee una progresiva y
     el backend otra. Al tocar una, tocar las dos. */
  function nprog(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    var t = String(v).trim().replace(/\s/g, '');
    if (!t) return null;
    var neg = t.charAt(0) === '-'; if (neg) t = t.substring(1);
    var n;
    if (t.indexOf('+') >= 0) {
      var p = t.split('+');
      n = numPY(p[0]) * 1000 + (parseFloat(String(p[1]).replace(',', '.')) || 0);
    } else { n = numPY(t); }
    if (isNaN(n)) return null;
    return neg ? -n : n;
  }
  function fprog(m, formato) {
    if (m === null || m === undefined || m === '') return '';
    var n = Number(m); if (isNaN(n)) return '';
    if ((formato || P.formato()) !== 'pk') return n.toLocaleString('es-PY', { maximumFractionDigits: 2 });
    var neg = n < 0; n = Math.abs(n);
    var km = Math.floor(n / 1000), res = n - km * 1000, ent = Math.floor(res), dec = res - ent;
    var s = String(ent); while (s.length < 3) s = '0' + s;
    if (dec > 0.0005) s += String(Math.round(dec * 100) / 100).substring(1);
    return (neg ? '-' : '') + km + '+' + s;
  }
  function fnum(n) { return Number(n || 0).toLocaleString('es-PY', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var EPS = 0.001;

  /* ============ estado de la vista ============ */
  var P = {
    obra: '', cargado: false, cargando: false,
    activo: false,
    ejes: [], estados: [], estadosDefault: false,
    tramos: {},            // eje_id → [{ini,fin,estado,cota,obs,proc}]
    ejeId: '',
    snapshots: [],
    sel: -1,
    undo: null,
    sucio: {},             // eje_id → true (hay cambios sin guardar)
    timer: null,
    guardando: false,
    eje: function () { var e = null; P.ejes.forEach(function (x) { if (x.eje_id === P.ejeId) e = x; }); return e; },
    formato: function () { var e = P.eje(); return e ? e.formato : 'pk'; },
    T: function () { return P.tramos[P.ejeId] || (P.tramos[P.ejeId] = []); }
  };

  function estado(id) {
    for (var i = 0; i < P.estados.length; i++) if (P.estados[i].estado_id === id) return P.estados[i];
    return { estado_id:id, nombre:'(estado borrado)', color:'#9aa7b1', orden:0, tipo:'neutro', derivable:false, alias_liberacion:'' };
  }

  /* ============ NÚCLEO: partición + fusión ============
     Mismo algoritmo que aplicarTramo_ en Code_Pista.gs.
       1. cortes = puntos de todos los tramos ∪ {ini, fin}
       2. reconstruir los tramos elementales entre cortes
       3. aplicar el estado nuevo solo en [ini, fin]
       4. fusionar contiguos con la misma clave (estado+cota+obs+en_proceso)
     Sin el paso 4, en tres cargas hay 200 tramos de 20 m y la vista es
     ilegible. Con él, 42 filas entran y salen 42.                          */
  function aplicarTramo(ini, fin, est, cota, obs, proc) {
    var e = P.eje(); if (!e) return false;
    if (fin < ini) { var t = ini; ini = fin; fin = t; }
    ini = Math.max(ini, e.prog_ini); fin = Math.min(fin, e.prog_fin);
    if (fin - ini <= EPS) return false;
    var out = [];
    P.T().forEach(function (s) {
      if (s.fin <= ini + EPS || s.ini >= fin - EPS) { out.push(s); return; }
      if (s.ini < ini - EPS) out.push(copia(s, s.ini, ini));
      if (s.fin > fin + EPS) out.push(copia(s, fin, s.fin));
    });
    out.push({ ini:ini, fin:fin, estado:est, cota:(cota === '' || cota === undefined) ? null : cota,
               obs:String(obs || ''), proc:!!proc });
    P.tramos[P.ejeId] = fusionar(out);
    return true;
  }
  function copia(s, ini, fin) { return { ini:ini, fin:fin, estado:s.estado, cota:s.cota, obs:s.obs, proc:s.proc }; }
  function fusionar(arr) {
    var a = arr.slice().sort(function (x, y) { return x.ini - y.ini; }), m = [];
    a.forEach(function (s) {
      if (s.fin - s.ini <= EPS) return;
      var p = m[m.length - 1];
      if (p && Math.abs(p.fin - s.ini) <= EPS && mismaClave(p, s)) { p.fin = s.fin; return; }
      m.push({ ini:s.ini, fin:s.fin, estado:s.estado, cota:s.cota, obs:s.obs, proc:!!s.proc });
    });
    return m;
  }
  function mismaClave(a, b) {
    var ca = (a.cota === null || a.cota === undefined) ? '' : Number(a.cota);
    var cb = (b.cota === null || b.cota === undefined) ? '' : Number(b.cota);
    return String(a.estado) === String(b.estado) && ca === cb &&
           String(a.obs || '') === String(b.obs || '') && !!a.proc === !!b.proc;
  }
  function snapUndo() { P.undo = { eje:P.ejeId, t:P.T().map(function (s) { return { ini:s.ini, fin:s.fin, estado:s.estado, cota:s.cota, obs:s.obs, proc:s.proc }; }) }; }
  function parseCota(v) { v = String(v == null ? '' : v).trim(); if (v === '') return null; return numPY(v); }

  /* ============ carga ============ */
  function obraId() { return global.ObraAPI ? global.ObraAPI.getObraId() : ''; }

  function cargar(force) {
    var oid = obraId();
    if (P.cargando) return Promise.resolve();
    if (P.cargado && P.obra === oid && !force) { render(); return Promise.resolve(); }
    P.cargando = true; pintarCargando();
    return global.ObraAPI.pistaCargar(oid).then(function (r) {
      P.obra = oid; P.cargado = true; P.cargando = false;
      P.activo = !!r.activo;
      P.ejes = r.ejes || [];
      P.estados = r.estados || [];
      P.estadosDefault = !!r.estados_default;
      P.snapshots = r.snapshots || [];
      P.tramos = {};
      (r.tramos || []).forEach(function (t) {
        (P.tramos[t.eje_id] = P.tramos[t.eje_id] || []).push({ ini:t.ini, fin:t.fin, estado:t.estado, cota:t.cota, obs:t.obs, proc:t.proc });
      });
      Object.keys(P.tramos).forEach(function (k) { P.tramos[k] = fusionar(P.tramos[k]); });
      if (!P.ejeId || !P.eje()) P.ejeId = P.ejes.length ? P.ejes[0].eje_id : '';
      P.sucio = {}; P.sel = -1; P.undo = null;
      sincronizarPestania();
      render();
    }).catch(function (e) {
      P.cargando = false;
      var el = $('#pistaBody'); if (el) el.innerHTML = '<div class="pi-vacio">No se pudo cargar la situación de pista.<br><span class="pi-mut">' + esc(e.message || e) + '</span></div>';
    });
  }

  function pintarCargando() {
    var el = $('#pistaBody'); if (el && !P.cargado) el.innerHTML = '<div class="pi-vacio">Cargando situación de pista…</div>';
  }

  /* ============ guardado ============ */
  function sucio() {
    P.sucio[P.ejeId] = true;
    pintarEstadoGuardado();
    if (P.timer) clearTimeout(P.timer);
    P.timer = setTimeout(function () { guardarTramos(true); }, 2500);
  }

  function guardarTramos(silencioso) {
    if (P.timer) { clearTimeout(P.timer); P.timer = null; }
    var pend = Object.keys(P.sucio).filter(function (k) { return P.sucio[k]; });
    if (!pend.length) { if (!silencioso) toast('No hay cambios para guardar'); return Promise.resolve(); }
    if (typeof global.ONLINE !== 'undefined' && !global.ONLINE) {
      pintarEstadoGuardado('Sin conexión: los cambios quedan en pantalla hasta volver');
      return Promise.resolve();
    }
    P.guardando = true; pintarEstadoGuardado();
    var cadena = Promise.resolve();
    pend.forEach(function (ejeId) {
      cadena = cadena.then(function () {
        return global.ObraAPI.pistaGuardarTramos(ejeId, (P.tramos[ejeId] || []).map(serieTramo), obraId())
          .then(function () { delete P.sucio[ejeId]; });
      });
    });
    return cadena.then(function () {
      P.guardando = false; pintarEstadoGuardado();
      if (!silencioso) toast('Situación de pista guardada');
    }).catch(function (e) {
      P.guardando = false; pintarEstadoGuardado('No se pudo guardar: ' + (e.message || e));
      toast('No se pudo guardar la situación de pista: ' + (e.message || e));
    });
  }
  function serieTramo(t) {
    return { prog_ini:t.ini, prog_fin:t.fin, estado_id:t.estado,
             cota:(t.cota === null || t.cota === undefined) ? '' : t.cota,
             en_proceso:t.proc ? 1 : '', obs:t.obs || '' };
  }
  function pintarEstadoGuardado(msg) {
    var el = $('#pistaEstadoGuardado'); if (!el) return;
    var pend = Object.keys(P.sucio).filter(function (k) { return P.sucio[k]; }).length;
    if (msg) { el.className = 'pi-save mal'; el.textContent = msg; return; }
    if (P.guardando) { el.className = 'pi-save'; el.textContent = 'Guardando…'; return; }
    if (pend) { el.className = 'pi-save pend'; el.textContent = '● Cambios sin guardar'; return; }
    el.className = 'pi-save ok'; el.textContent = P.cargado ? 'Guardado' : '';
  }

  /* ============ armado de la vista ============ */
  function render() {
    var body = $('#pistaBody'); if (!body) return;
    if (!P.cargado) { pintarCargando(); return; }

    pintarSelectorEjes();

    if (!P.ejes.length) { body.innerHTML = htmlSinEje(); return; }
    var e = P.eje();
    if (!e) { P.ejeId = P.ejes[0].eje_id; return render(); }
    if (!P.T().length) inicializarEje();

    body.innerHTML = htmlVista(e);
    renderCinta(); renderRegla(); renderResumen(); renderTabla(); renderCards();
    renderCatalogo(); renderSnaps(); pintarEstadoGuardado();
    bindVista();
  }

  /* Un eje recién creado arranca cubierto por un solo tramo: el eje siempre
     está íntegramente pintado, no hay huecos posibles. Se usa el primer estado
     neutro del catálogo (Sin intervención) y, si no hay ninguno, el primero. */
  function inicializarEje() {
    var e = P.eje(); if (!e || !P.estados.length) return;
    var neutro = null;
    P.estados.forEach(function (x) { if (!neutro && x.tipo === 'neutro') neutro = x; });
    var est = neutro || P.estados[0];
    P.tramos[P.ejeId] = [{ ini:e.prog_ini, fin:e.prog_fin, estado:est.estado_id, cota:null, obs:'', proc:false }];
    sucio();   // el eje nace cubierto y eso ya es un cambio que hay que guardar
  }

  function pintarSelectorEjes() {
    var sel = $('#pistaEje'); if (!sel) return;
    sel.innerHTML = P.ejes.map(function (e) {
      return '<option value="' + esc(e.eje_id) + '"' + (e.eje_id === P.ejeId ? ' selected' : '') + '>' +
             esc(e.nombre) + ' · ' + fprog(e.prog_ini, e.formato) + '–' + fprog(e.prog_fin, e.formato) + '</option>';
    }).join('');
    sel.style.display = P.ejes.length ? '' : 'none';
    var bPdf = $('#pistaPdf'); if (bPdf) bPdf.style.display = P.ejes.length ? '' : 'none';
    var bSave = $('#pistaGuardar'); if (bSave) bSave.style.display = P.ejes.length ? '' : 'none';
  }

  function htmlSinEje() {
    return '<div class="pi-card pi-alta">' +
      '<h2>Todavía no hay un eje definido</h2>' +
      '<p class="pi-mut">Las progresivas dependen de la obra: no hay nada que heredar. Definí el eje y la pista queda lista para cargar.</p>' +
      '<div class="pi-form">' +
        '<div class="pi-f"><label>Nombre</label><input type="text" id="ejeNom" value="Eje principal" style="width:180px"></div>' +
        '<div class="pi-f"><label>Desde</label><input type="text" id="ejeIni" placeholder="21+000"></div>' +
        '<div class="pi-f"><label>Hasta</label><input type="text" id="ejeFin" placeholder="38+136"></div>' +
        '<div class="pi-f"><label>Formato</label><select id="ejeFmt"><option value="pk">Progresiva (21+000)</option><option value="plano">Plano / metros</option></select></div>' +
        '<button class="pi-btn pri" id="ejeCrear">Crear eje</button>' +
      '</div></div>';
  }

  function htmlVista(e) {
    return '' +
    '<div class="pi-card">' +
      '<h2>Estado vigente por progresiva</h2>' +
      '<div style="position:relative">' +
        '<div class="pi-strip" id="pistaStrip"></div>' +
        '<div class="pi-ruler" id="pistaRuler"></div>' +
        '<div class="pi-tip" id="pistaTip"></div>' +
      '</div>' +
      '<p class="pi-note">Rayado diagonal claro = en proceso · Rayado gris = estado neutro (no participa del avance de pista)</p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Resumen por estado</h2>' +
      '<div class="pi-sum" id="pistaSum"></div>' +
      '<p class="pi-note" id="pistaSumFoot"></p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Aplicar estado a un rango</h2>' +
      '<div class="pi-form">' +
        '<div class="pi-f"><label>Desde</label><input type="text" id="pistaPi" value="' + esc(fprog(e.prog_ini, e.formato)) + '"></div>' +
        '<div class="pi-f"><label>Hasta</label><input type="text" id="pistaPf" value="' + esc(fprog(e.prog_fin, e.formato)) + '"></div>' +
        '<div class="pi-f"><label>Estado</label><select id="pistaPe"></select></div>' +
        '<div class="pi-f"><label>Cota</label><input type="text" id="pistaPc" style="width:78px" placeholder="—"></div>' +
        '<label class="pi-chk"><input type="checkbox" id="pistaPp"> En proceso</label>' +
        '<button class="pi-btn pri" id="pistaAplicar">Aplicar</button>' +
        '<button class="pi-btn" id="pistaUndo">Deshacer</button>' +
      '</div>' +
      '<p class="pi-note">El eje se reparticiona en los cortes nuevos y los contiguos con mismo estado, cota, observación y marca de proceso se fusionan solos.</p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Tramos <span class="pi-mut" id="pistaCnt" style="text-transform:none;letter-spacing:0"></span></h2>' +
      '<div class="pi-tw" id="pistaTw">' +
        '<table class="pi-tab"><thead><tr>' +
          '<th style="width:34px">N°</th><th>Prog. inicial</th><th>Prog. final</th>' +
          '<th style="text-align:right">Longitud</th><th>Situación</th>' +
          '<th style="text-align:right">Cota</th><th style="text-align:center">En proc.</th><th>Observación</th>' +
        '</tr></thead><tbody id="pistaTb"></tbody></table>' +
      '</div>' +
      '<div id="pistaCards"></div>' +
      '<p class="pi-note">La progresiva final de cada fila mueve el corte con el tramo siguiente. La del último tramo es el fin del eje: se cambia en «Ejes y progresivas».</p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Catálogo de estados de esta obra</h2>' +
      '<div class="pi-tw">' +
        '<table class="pi-tab pi-cat"><thead><tr>' +
          '<th style="width:34px">Color</th><th>Nombre</th><th style="text-align:right;width:70px">Orden</th>' +
          '<th style="width:96px">Tipo</th><th style="width:70px">Derivable</th><th>Alias en liberación</th><th style="width:34px"></th>' +
        '</tr></thead><tbody id="pistaCat"></tbody></table>' +
      '</div>' +
      '<div class="pi-form" style="margin-top:9px">' +
        '<button class="pi-btn" id="pistaEstNuevo">＋ Agregar estado</button>' +
        '<button class="pi-btn pri" id="pistaEstGuardar">Guardar catálogo</button>' +
        (P.estadosDefault ? '<span class="pi-mut" style="font-size:12px">Catálogo propuesto: se guarda recién cuando lo confirmes.</span>' : '') +
      '</div>' +
      '<p class="pi-note">El orden es la secuencia constructiva de esta obra: la derivación futura desde liberación nunca retrocede un tramo a un estado anterior. Los neutros quedan fuera del orden y fuera del denominador de pista computable.</p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Ejes y progresivas</h2>' +
      '<div class="pi-tw">' +
        '<table class="pi-tab"><thead><tr>' +
          '<th>Nombre</th><th style="width:120px">Desde</th><th style="width:120px">Hasta</th>' +
          '<th style="width:150px">Formato</th><th style="text-align:right;width:110px">Longitud</th><th style="width:34px"></th>' +
        '</tr></thead><tbody id="pistaEjes"></tbody></table>' +
      '</div>' +
      '<div class="pi-form" style="margin-top:9px">' +
        '<button class="pi-btn" id="pistaEjeNuevo">＋ Agregar eje</button>' +
        '<button class="pi-btn pri" id="pistaEjeGuardar">Guardar ejes</button>' +
      '</div>' +
      '<p class="pi-note">Las progresivas dependen de la obra. Achicar un eje recorta los tramos que quedan afuera; borrar un eje borra sus tramos.</p>' +
    '</div>' +

    '<div class="pi-card">' +
      '<h2>Snapshots</h2>' +
      '<div class="pi-snaps" id="pistaSnaps"></div>' +
      '<p class="pi-note">Se guarda uno automáticamente cada vez que exportás el PDF. Es la serie histórica del ritmo de avance.</p>' +
    '</div>';
  }

  /* ============ cinta + regla ============ */
  function renderCinta() {
    var el = $('#pistaStrip'); if (!el) return;
    var e = P.eje(), L = e.prog_fin - e.prog_ini;
    el.innerHTML = '';
    P.T().forEach(function (s, i) {
      var es = estado(s.estado), d = document.createElement('div');
      d.className = 'pi-seg' + (es.tipo === 'neutro' ? ' neutro' : '') + (s.proc ? ' proc' : '') + (i === P.sel ? ' sel' : '');
      d.style.width = ((s.fin - s.ini) / L * 100) + '%';
      d.style.background = es.color;
      d.tabIndex = 0;
      d.setAttribute('aria-label', es.nombre + ' ' + fprog(s.ini) + ' a ' + fprog(s.fin) + (s.proc ? ' en proceso' : ''));
      d.onmouseenter = function (ev) { tip(ev, s, es); };
      d.onmousemove  = function (ev) { tip(ev, s, es); };
      d.onmouseleave = function () { var t = $('#pistaTip'); if (t) t.classList.remove('on'); };
      d.onclick = function () { P.sel = (P.sel === i ? -1 : i); render(); irAFila(); };
      el.appendChild(d);
    });
  }
  function tip(ev, s, es) {
    var t = $('#pistaTip'), host = $('#pistaStrip'); if (!t || !host) return;
    var r = host.getBoundingClientRect();
    t.innerHTML = '<b>' + fprog(s.ini) + ' → ' + fprog(s.fin) + '</b> · ' + fnum(s.fin - s.ini) + ' m<br>' + esc(es.nombre) +
      ((s.cota !== null && s.cota !== undefined) ? ' · cota ' + fnum(s.cota) : '') +
      (s.proc ? ' · en proceso' : '') + (s.obs ? ' · ' + esc(s.obs) : '');
    t.classList.add('on');
    var x = ev.clientX - r.left;
    t.style.left = Math.max(4, Math.min(x - t.offsetWidth / 2, r.width - t.offsetWidth - 4)) + 'px';
    t.style.top = '-54px';
  }
  function renderRegla() {
    var r = $('#pistaRuler'); if (!r) return;
    var e = P.eje(), L = e.prog_fin - e.prog_ini;
    r.innerHTML = '';
    // paso adaptativo: la regla no puede tener más de ~60 marcas o se empasta
    var paso = 500; [500, 1000, 2000, 5000, 10000, 20000].some(function (p) { paso = p; return L / p <= 60; });
    var etiqueta = paso * (L / paso > 24 ? 4 : 2);
    for (var m = Math.ceil(e.prog_ini / paso) * paso; m <= e.prog_fin + 0.5; m += paso) {
      var pos = (m - e.prog_ini) / L * 100;
      var grande = (m % etiqueta === 0);
      var t = document.createElement('div');
      t.className = 'pi-tick' + (grande ? ' km' : ''); t.style.left = pos + '%'; r.appendChild(t);
      if (grande) {
        var l = document.createElement('div');
        l.className = 'pi-tlab'; l.style.left = pos + '%'; l.textContent = fprog(m); r.appendChild(l);
      }
    }
  }

  /* ============ resumen ============ */
  function totales() {
    var by = {}, proc = {}, totCapa = 0;
    P.T().forEach(function (s) {
      var L = s.fin - s.ini;
      by[s.estado] = (by[s.estado] || 0) + L;
      if (s.proc) proc[s.estado] = (proc[s.estado] || 0) + L;
      if (estado(s.estado).tipo === 'capa') totCapa += L;
    });
    return { by:by, proc:proc, totCapa:totCapa };
  }
  function renderResumen() {
    var el = $('#pistaSum'); if (!el) return;
    var t = totales(), e = P.eje(), L = e.prog_fin - e.prog_ini;
    el.innerHTML = '';
    P.estados.slice().sort(function (a, b) { return b.orden - a.orden; }).forEach(function (es) {
      var m = t.by[es.estado_id] || 0; if (!m) return;
      // DENOMINADOR = pista computable (solo estados 'capa'). Los neutros no se
      // pueden ejecutar: meterlos bajaría el avance por algo que nunca se va a
      // construir.
      var pct = (es.tipo === 'capa' && t.totCapa) ? (m / t.totCapa * 100).toFixed(1) + '%' : '—';
      var pr = t.proc[es.estado_id] || 0;
      var d = document.createElement('div'); d.className = 'pi-srow';
      d.innerHTML = '<span class="pi-sw' + (es.tipo === 'neutro' ? ' n' : '') + '" style="background:' + esc(es.color) + '"></span>' +
        '<span class="pi-snm">' + esc(es.nombre) + (pr ? ' <span class="pi-mut" style="font-size:11px">(' + fnum(pr) + ' en proceso)</span>' : '') + '</span>' +
        '<span class="pi-sm">' + fnum(m) + '</span><span class="pi-sp">' + pct + '</span>';
      el.appendChild(d);
    });
    var f = $('#pistaSumFoot');
    if (f) f.textContent = 'Eje ' + fnum(L) + ' m · pista computable ' + fnum(t.totCapa) + ' m · neutros ' +
      fnum(L - t.totCapa) + ' m. Informativo: no alimenta cantVigente ni certificación.';
  }

  /* ============ grilla ============ */
  function opcionesEstado(id) {
    return P.estados.map(function (c) {
      return '<option value="' + esc(c.estado_id) + '"' + (c.estado_id === id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
    }).join('');
  }
  function renderTabla() {
    var tb = $('#pistaTb'); if (!tb) return;
    tb.innerHTML = '';
    var T = P.T();
    T.forEach(function (s, i) {
      var es = estado(s.estado), tr = document.createElement('tr');
      if (i === P.sel) tr.className = 'sel';
      var ultimo = (i === T.length - 1);
      tr.innerHTML = '<td class="pi-num pi-mut">' + (i + 1) + '</td>' +
        '<td class="pi-num">' + fprog(s.ini) + '</td>' +
        '<td class="pi-num">' + (ultimo ? '<span class="pi-mut">' + fprog(s.fin) + '</span>'
              : '<input type="text" data-corte="' + i + '" value="' + esc(fprog(s.fin)) + '">') + '</td>' +
        '<td class="pi-num">' + fnum(s.fin - s.ini) + '</td>' +
        '<td><span class="pi-chip"><span class="pi-sw' + (es.tipo === 'neutro' ? ' n' : '') + (s.proc ? ' p' : '') + '" style="background:' + esc(es.color) + '"></span>' +
          '<select data-e="' + i + '">' + opcionesEstado(s.estado) + '</select></span></td>' +
        '<td class="pi-num"><input type="text" data-c="' + i + '" value="' + (s.cota === null || s.cota === undefined ? '' : esc(fnum(s.cota))) + '" placeholder="—"></td>' +
        '<td style="text-align:center"><input type="checkbox" data-p="' + i + '"' + (s.proc ? ' checked' : '') + '></td>' +
        '<td><input type="text" class="txt" data-o="' + i + '" value="' + esc(s.obs || '') + '" placeholder="—"></td>';
      tb.appendChild(tr);
    });
    var c = $('#pistaCnt'); if (c) c.textContent = '(' + T.length + ' filas)';
    bindGrilla(tb);
  }
  function renderCards() {
    var el = $('#pistaCards'); if (!el) return;
    el.innerHTML = '';
    var T = P.T();
    T.forEach(function (s, i) {
      var es = estado(s.estado), d = document.createElement('div');
      d.className = 'pi-tc' + (i === P.sel ? ' sel' : '');
      var ultimo = (i === T.length - 1);
      d.innerHTML = '<div class="l1"><span class="pg">' + fprog(s.ini) + ' → ' +
          (ultimo ? fprog(s.fin) : '<input type="text" data-corte="' + i + '" value="' + esc(fprog(s.fin)) + '" style="width:88px">') +
          '</span><span class="ln">' + fnum(s.fin - s.ini) + ' m</span></div>' +
        '<div class="l2"><span class="pi-sw' + (es.tipo === 'neutro' ? ' n' : '') + (s.proc ? ' p' : '') + '" style="background:' + esc(es.color) + '"></span>' +
          '<select data-e="' + i + '">' + opcionesEstado(s.estado) + '</select><span class="n">#' + (i + 1) + '</span></div>' +
        '<div class="l3"><label>Cota <input type="text" data-c="' + i + '" value="' + (s.cota === null || s.cota === undefined ? '' : esc(fnum(s.cota))) + '" placeholder="—"></label>' +
          '<label><input type="checkbox" data-p="' + i + '"' + (s.proc ? ' checked' : '') + '> En proceso</label>' +
          '<input type="text" class="txt" data-o="' + i + '" value="' + esc(s.obs || '') + '" placeholder="Observación"></div>';
      el.appendChild(d);
    });
    bindGrilla(el);
  }

  function editarEstado(i, v) { var s = P.T()[i]; snapUndo(); aplicarTramo(s.ini, s.fin, v, s.cota, s.obs, s.proc); P.sel = -1; sucio(); render(); }
  function editarCota(i, v)   { var s = P.T()[i]; snapUndo(); aplicarTramo(s.ini, s.fin, s.estado, parseCota(v), s.obs, s.proc); sucio(); render(); }
  function editarObs(i, v)    { var s = P.T()[i]; snapUndo(); aplicarTramo(s.ini, s.fin, s.estado, s.cota, String(v).trim(), s.proc); sucio(); render(); }
  function editarProc(i, v)   { var s = P.T()[i]; snapUndo(); aplicarTramo(s.ini, s.fin, s.estado, s.cota, s.obs, !!v); sucio(); render(); }

  /* Mover el CORTE entre el tramo i y el i+1. No se puede pasar de los vecinos:
     un corte que cruza al tramo siguiente lo haría desaparecer sin avisar. */
  function editarCorte(i, v) {
    var T = P.T(), s = T[i], sig = T[i + 1];
    if (!sig) { render(); return; }
    var x = nprog(v);
    if (x === null) { render(); return; }
    var min = s.ini + 1, max = sig.fin - 1;
    if (x <= min || x >= max) { toast('El corte tiene que quedar entre ' + fprog(min) + ' y ' + fprog(max)); render(); return; }
    snapUndo();
    s.fin = x; sig.ini = x;
    P.tramos[P.ejeId] = fusionar(T);
    sucio(); render();
  }

  function bindGrilla(root) {
    [].forEach.call(root.querySelectorAll('[data-e]'), function (x) { x.onchange = function () { editarEstado(+this.dataset.e, this.value); }; });
    [].forEach.call(root.querySelectorAll('[data-c]'), function (x) { x.onchange = function () { editarCota(+this.dataset.c, this.value); }; });
    [].forEach.call(root.querySelectorAll('[data-o]'), function (x) { x.onchange = function () { editarObs(+this.dataset.o, this.value); }; });
    [].forEach.call(root.querySelectorAll('[data-p]'), function (x) { x.onchange = function () { editarProc(+this.dataset.p, this.checked); }; });
    [].forEach.call(root.querySelectorAll('[data-corte]'), function (x) { x.onchange = function () { editarCorte(+this.dataset.corte, this.value); }; });
  }
  function irAFila() {
    if (P.sel < 0) return;
    var movil = window.matchMedia('(max-width:760px)').matches;
    var cont = movil ? $('#pistaCards') : $('#pistaTb');
    var n = cont && cont.children[P.sel];
    if (n && n.scrollIntoView) n.scrollIntoView({ block:'center', behavior:'smooth' });
  }

  /* ============ catálogo de estados (editable por obra) ============ */
  function renderCatalogo() {
    var tb = $('#pistaCat'); if (!tb) return;
    tb.innerHTML = '';
    P.estados.slice().sort(function (a, b) { return (a.tipo === b.tipo) ? a.orden - b.orden : (a.tipo === 'capa' ? -1 : 1); })
      .forEach(function (e) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><input type="color" value="' + esc(e.color) + '" data-cat-col="' + esc(e.estado_id) + '"></td>' +
          '<td><input type="text" class="txt" value="' + esc(e.nombre) + '" data-cat-nom="' + esc(e.estado_id) + '"></td>' +
          '<td class="pi-num">' + (e.tipo === 'capa'
              ? '<input type="text" value="' + esc(e.orden) + '" data-cat-ord="' + esc(e.estado_id) + '" style="width:52px">'
              : '<span class="pi-mut">—</span>') + '</td>' +
          '<td><select data-cat-tipo="' + esc(e.estado_id) + '">' +
            '<option value="capa"' + (e.tipo === 'capa' ? ' selected' : '') + '>Capa</option>' +
            '<option value="neutro"' + (e.tipo === 'neutro' ? ' selected' : '') + '>Neutro</option></select></td>' +
          '<td style="text-align:center"><input type="checkbox" data-cat-der="' + esc(e.estado_id) + '"' +
            (e.derivable ? ' checked' : '') + (e.tipo === 'neutro' ? ' disabled' : '') + '></td>' +
          '<td><input type="text" class="txt" value="' + esc(e.alias_liberacion || '') + '" data-cat-ali="' + esc(e.estado_id) + '" placeholder="nombre en el form"></td>' +
          '<td><button class="pi-x" data-cat-del="' + esc(e.estado_id) + '" title="Quitar del catálogo">✕</button></td>';
        tb.appendChild(tr);
      });

    function buscar(id) { for (var i = 0; i < P.estados.length; i++) if (P.estados[i].estado_id === id) return P.estados[i]; return null; }
    [].forEach.call(tb.querySelectorAll('[data-cat-col]'), function (x) { x.oninput  = function () { buscar(this.dataset.catCol).color = this.value; renderCinta(); renderResumen(); renderTabla(); renderCards(); }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-nom]'), function (x) { x.onchange = function () { buscar(this.dataset.catNom).nombre = this.value; render(); }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-ord]'), function (x) { x.onchange = function () { buscar(this.dataset.catOrd).orden = numPY(this.value); render(); }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-tipo]'), function (x) { x.onchange = function () {
      var e = buscar(this.dataset.catTipo); e.tipo = this.value;
      if (e.tipo === 'neutro') { e.orden = 0; e.derivable = false; }
      render(); }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-der]'), function (x) { x.onchange = function () { buscar(this.dataset.catDer).derivable = this.checked; }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-ali]'), function (x) { x.onchange = function () { buscar(this.dataset.catAli).alias_liberacion = this.value; }; });
    [].forEach.call(tb.querySelectorAll('[data-cat-del]'), function (x) { x.onclick = function () { borrarEstado(this.dataset.catDel); }; });
  }

  function borrarEstado(id) {
    var uso = 0;
    Object.keys(P.tramos).forEach(function (k) { (P.tramos[k] || []).forEach(function (t) { if (t.estado === id) uso++; }); });
    if (uso) { toast('Ese estado está usado en ' + uso + ' tramo(s). Cambiálos primero.'); return; }
    P.estados = P.estados.filter(function (e) { return e.estado_id !== id; });
    render();
  }
  function nuevoEstado() {
    var maxOrden = 0; P.estados.forEach(function (e) { if (e.tipo === 'capa' && e.orden > maxOrden) maxOrden = e.orden; });
    P.estados.push({ estado_id:'', nombre:'Estado nuevo', color:'#7f8c9b', orden:maxOrden + 10, tipo:'capa', derivable:false, alias_liberacion:'' });
    render();
  }
  function guardarCatalogo() {
    var vacio = P.estados.some(function (e) { return !String(e.nombre || '').trim(); });
    if (vacio) { toast('Hay un estado sin nombre'); return; }
    global.ObraAPI.pistaGuardarEstados(P.estados, obraId()).then(function (r) {
      // el backend asigna los ids nuevos; se recarga para quedar en sincronía
      P.estadosDefault = false;
      toast('Catálogo guardado · ' + r.estados + ' estados');
      return cargar(true);
    }).catch(function (e) { toast('No se pudo guardar el catálogo: ' + (e.message || e)); });
  }

  /* ============ ejes y progresivas (editables por obra) ============ */
  function renderEjes() {
    var tb = $('#pistaEjes'); if (!tb) return;
    tb.innerHTML = '';
    P.ejes.forEach(function (e, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="text" class="txt" value="' + esc(e.nombre) + '" data-eje-nom="' + i + '"></td>' +
        '<td class="pi-num"><input type="text" value="' + esc(fprog(e.prog_ini, e.formato)) + '" data-eje-ini="' + i + '"></td>' +
        '<td class="pi-num"><input type="text" value="' + esc(fprog(e.prog_fin, e.formato)) + '" data-eje-fin="' + i + '"></td>' +
        '<td><select data-eje-fmt="' + i + '">' +
          '<option value="pk"' + (e.formato === 'pk' ? ' selected' : '') + '>Progresiva (21+000)</option>' +
          '<option value="plano"' + (e.formato === 'plano' ? ' selected' : '') + '>Plano / metros</option></select></td>' +
        '<td class="pi-num">' + fnum(e.prog_fin - e.prog_ini) + '</td>' +
        '<td><button class="pi-x" data-eje-del="' + i + '" title="Borrar el eje y sus tramos">✕</button></td>';
      tb.appendChild(tr);
    });
    [].forEach.call(tb.querySelectorAll('[data-eje-nom]'), function (x) { x.onchange = function () { P.ejes[+this.dataset.ejeNom].nombre = this.value; renderEjes(); pintarSelectorEjes(); }; });
    [].forEach.call(tb.querySelectorAll('[data-eje-ini]'), function (x) { x.onchange = function () { var v = nprog(this.value); if (v !== null) P.ejes[+this.dataset.ejeIni].prog_ini = v; renderEjes(); }; });
    [].forEach.call(tb.querySelectorAll('[data-eje-fin]'), function (x) { x.onchange = function () { var v = nprog(this.value); if (v !== null) P.ejes[+this.dataset.ejeFin].prog_fin = v; renderEjes(); }; });
    [].forEach.call(tb.querySelectorAll('[data-eje-fmt]'), function (x) { x.onchange = function () { P.ejes[+this.dataset.ejeFmt].formato = this.value; renderEjes(); }; });
    [].forEach.call(tb.querySelectorAll('[data-eje-del]'), function (x) { x.onclick = function () {
      var i = +this.dataset.ejeDel, e = P.ejes[i];
      var n = (P.tramos[e.eje_id] || []).length;
      if (!confirm('Borrar el eje "' + e.nombre + '"' + (n ? ' y sus ' + n + ' tramos' : '') + '?')) return;
      P.ejes.splice(i, 1); renderEjes(); }; });
  }
  function nuevoEje() {
    var ult = P.ejes[P.ejes.length - 1];
    P.ejes.push({ eje_id:'', nombre:'Eje ' + (P.ejes.length + 1), prog_ini:0, prog_fin:1000,
                  formato: ult ? ult.formato : 'pk', orden:P.ejes.length });
    renderEjes();
  }
  function guardarEjes() {
    // guardar los tramos pendientes ANTES: si el eje se achica, el backend
    // recorta los tramos contra el eje NUEVO, y lo que esté solo en pantalla
    // se perdería.
    guardarTramos(true).then(function () {
      return global.ObraAPI.pistaGuardarEjes(P.ejes, obraId());
    }).then(function (r) {
      toast('Ejes guardados' + (r.tramos_borrados ? ' · ' + r.tramos_borrados + ' tramos de ejes borrados' : ''));
      // recortar en pantalla lo que el backend recortó, y volver a guardar los
      // tramos del eje activo contra sus progresivas nuevas
      P.ejes.forEach(function (e) {
        var T = P.tramos[e.eje_id]; if (!T) return;
        P.tramos[e.eje_id] = fusionar(T.map(function (t) {
          return { ini:Math.max(t.ini, e.prog_ini), fin:Math.min(t.fin, e.prog_fin), estado:t.estado, cota:t.cota, obs:t.obs, proc:t.proc };
        }).filter(function (t) { return t.fin - t.ini > EPS; }));
      });
      return cargar(true);
    }).catch(function (e) { toast('No se pudieron guardar los ejes: ' + (e.message || e)); });
  }
  function crearPrimerEje() {
    var nom = ($('#ejeNom') || {}).value || 'Eje principal';
    var ini = nprog(($('#ejeIni') || {}).value), fin = nprog(($('#ejeFin') || {}).value);
    var fmt = ($('#ejeFmt') || {}).value || 'pk';
    if (ini === null || fin === null) { toast('Poné la progresiva de inicio y la de fin'); return; }
    if (fin <= ini) { toast('La progresiva final tiene que ser mayor que la inicial'); return; }
    global.ObraAPI.pistaGuardarEjes([{ eje_id:'', nombre:nom, prog_ini:ini, prog_fin:fin, formato:fmt }], obraId())
      .then(function () { toast('Eje creado'); return cargar(true); })
      .then(function () { return guardarTramos(true); })
      .catch(function (e) { toast('No se pudo crear el eje: ' + (e.message || e)); });
  }

  /* ============ snapshots ============ */
  function renderSnaps() {
    var el = $('#pistaSnaps'); if (!el) return;
    var s = P.snapshots.filter(function (x) { return x.eje_id === P.ejeId; });
    el.innerHTML = s.length
      ? s.map(function (x) { return '<span class="pi-snap" title="' + esc(x.nota || '') + '">' + esc(x.fecha) + '</span>'; }).join('')
      : '<span class="pi-mut" style="font-size:12px">Todavía no hay ninguno. Se guarda al exportar el PDF.</span>';
  }

  /* ============ PDF ============
     El PDF ESPEJA LAS REGLAS de la pantalla (qué se muestra, colores,
     denominadores), NO el layout. El layout responde al papel: apaisado, ancho
     completo, siempre, independiente del dispositivo. */
  function exportarPDF() {
    var e = P.eje(); if (!e) return;
    var T = P.T(), t = totales(), L = e.prog_fin - e.prog_ini;
    var hoy = new Date();
    var fechaISO = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');

    var cinta = T.map(function (s) {
      var es = estado(s.estado);
      return '<div style="width:' + ((s.fin - s.ini) / L * 100) + '%;background:' + es.color + ';height:100%;position:relative;' +
        (es.tipo === 'neutro' ? 'background-image:repeating-linear-gradient(45deg,rgba(0,0,0,.10) 0 5px,transparent 5px 10px);' : '') +
        'border-right:1px solid rgba(255,255,255,.5)">' +
        (s.proc ? '<div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 4px,transparent 4px 9px)"></div>' : '') +
        '</div>';
    }).join('');

    var filas = T.map(function (s, i) {
      var es = estado(s.estado);
      return '<tr><td class="g">' + (i + 1) + '</td><td class="r">' + fprog(s.ini) + '</td><td class="r">' + fprog(s.fin) + '</td>' +
        '<td class="r">' + fnum(s.fin - s.ini) + '</td>' +
        '<td><span class="sw" style="background:' + es.color + '"></span>' + esc(es.nombre) + '</td>' +
        '<td class="r">' + (s.cota === null || s.cota === undefined ? '—' : fnum(s.cota)) + '</td>' +
        '<td>' + (s.proc ? 'En proceso' : '') + (s.obs ? (s.proc ? ' · ' : '') + esc(s.obs) : '') + '</td></tr>';
    });
    var mitad = Math.ceil(filas.length / 2);
    var cab = '<thead><tr><th>N°</th><th>Prog. inicial</th><th>Prog. final</th><th>Long.</th><th>Situación</th><th>Cota</th><th>Obs.</th></tr></thead>';

    var resumen = P.estados.slice().sort(function (a, b) { return b.orden - a.orden; }).map(function (es) {
      var m = t.by[es.estado_id] || 0; if (!m) return '';
      return '<tr><td><span class="sw" style="background:' + es.color + '"></span>' + esc(es.nombre) + '</td>' +
        '<td class="r">' + fnum(m) + '</td><td class="r">' + ((es.tipo === 'capa' && t.totCapa) ? (m / t.totCapa * 100).toFixed(1) + '%' : '—') + '</td></tr>';
    }).join('');

    var nombreObra = (global.D && global.D.obra && global.D.obra.nombre) ? global.D.obra.nombre : '';
    var w = window.open('', '_blank');
    if (!w) { toast('El navegador bloqueó la ventana. Permití las ventanas emergentes.'); return; }
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
      '<title>' + esc(nombreObra) + ' · Situación de pista</title><style>' +
      '@page{size:A3 landscape;margin:8mm}' +
      '*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
      'body{font-family:"Segoe UI",system-ui,sans-serif;color:#111;margin:0;font-size:10px}' +
      '.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0d1b2a;padding-bottom:6px;margin-bottom:10px}' +
      '.hdr h1{margin:0;font-size:17px;color:#0d1b2a}.hdr .sub{font-size:11px;color:#555;margin-top:2px}' +
      '.hdr .meta{text-align:right;font-size:9.5px;color:#666;line-height:1.5;font-family:ui-monospace,Consolas,monospace}' +
      '.cinta{display:flex;height:38px;border:1px solid #c9c3b2;border-radius:3px;overflow:hidden;margin-bottom:14px}' +
      '.cols{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}' +
      '.dos{display:grid;grid-template-columns:1fr 1fr;gap:16px}' +
      'table{width:100%;border-collapse:collapse;font-size:8.6px}' +
      'th{background:#1b3350;color:#fff;padding:4px;text-align:left;font-weight:600;border:1px solid #2a4668;font-size:7.6px}' +
      'td{padding:2.6px 4px;border:1px solid #ddd7c7;vertical-align:middle}' +
      'tr:nth-child(even) td{background:#faf8f2}' +
      '.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:ui-monospace,Consolas,monospace}' +
      '.g{color:#999;text-align:right}' +
      '.sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}' +
      '.tot td{background:#f2c200!important;font-weight:700;border-top:2px solid #0d1b2a}' +
      '.ft{margin-top:10px;font-size:8px;color:#888;display:flex;justify-content:space-between;border-top:1px solid #ddd7c7;padding-top:5px}' +
      '@media print{tr{page-break-inside:avoid}thead{display:table-header-group}}' +
      '</style></head><body>' +
      '<div class="hdr"><div><h1>Situación de pista</h1><div class="sub">' + esc(nombreObra) + ' · ' + esc(e.nombre) +
        ' · ' + fprog(e.prog_ini) + ' a ' + fprog(e.prog_fin) + '</div></div>' +
        '<div class="meta">' + hoy.toLocaleDateString('es-PY') + '<br>' + T.length + ' tramos<br>' + fnum(L) + ' m de eje</div></div>' +
      '<div class="cinta">' + cinta + '</div>' +
      '<div class="cols"><div class="dos">' +
        '<table>' + cab + '<tbody>' + filas.slice(0, mitad).join('') + '</tbody></table>' +
        '<table>' + cab + '<tbody>' + filas.slice(mitad).join('') + '</tbody></table>' +
      '</div><div><table><thead><tr><th>Resumen por estado</th><th>Longitud (m)</th><th>%</th></tr></thead><tbody>' +
        resumen +
        '<tr class="tot"><td>Pista computable</td><td class="r">' + fnum(t.totCapa) + '</td><td class="r">100%</td></tr>' +
        '<tr><td>Neutros</td><td class="r">' + fnum(L - t.totCapa) + '</td><td></td></tr>' +
        '<tr><td>Longitud del eje</td><td class="r">' + fnum(L) + '</td><td></td></tr>' +
      '</tbody></table>' +
      '<p style="font-size:8px;color:#777;margin-top:8px">El % se calcula sobre la pista computable (estados de tipo capa). ' +
      'Los neutros se pintan y se listan, pero quedan fuera del denominador. Informativo: no alimenta certificación.</p>' +
      '</div></div>' +
      '<div class="ft"><span>Cronograma de Obra · Plan de Trabajos</span><span>Snapshot ' + fechaISO + '</span></div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},350)}<\/script></body></html>');
    w.document.close();
    toast('Se abrió la vista de impresión — elegí "Guardar como PDF"');

    // SNAPSHOT AUTOMÁTICO: el informe ya se exporta, así que el evento existe.
    // No hace falta un ritual nuevo para tener la serie histórica.
    var resumenSnap = { total_eje:L, computable:t.totCapa, por_estado:t.by, en_proceso:t.proc };
    guardarTramos(true).then(function () {
      return global.ObraAPI.pistaSnapshot(P.ejeId, fechaISO, '', resumenSnap, obraId());
    }).then(function (r) {
      if (r && r.nuevo) { P.snapshots.push({ eje_id:P.ejeId, fecha:r.fecha, nota:'', resumen:resumenSnap }); renderSnaps(); }
    }).catch(function () { /* el PDF ya salió: un snapshot que falla no molesta al usuario */ });
  }

  /* ============ binds de la vista ============ */
  function bindVista() {
    renderEjes();
    var pe = $('#pistaPe'); if (pe) pe.innerHTML = opcionesEstado(P.estados.length ? P.estados[0].estado_id : '');

    var bAp = $('#pistaAplicar');
    if (bAp) bAp.onclick = function () {
      var ini = nprog(($('#pistaPi') || {}).value), fin = nprog(($('#pistaPf') || {}).value);
      if (ini === null || fin === null) { toast('Revisá las progresivas'); return; }
      snapUndo();
      var ok = aplicarTramo(ini, fin, ($('#pistaPe') || {}).value, parseCota(($('#pistaPc') || {}).value), '', ($('#pistaPp') || {}).checked);
      P.sel = -1;
      if (ok) { sucio(); render(); toast('Rango aplicado · ' + P.T().length + ' tramos'); }
      else toast('Ese rango queda fuera del eje');
    };
    var bUn = $('#pistaUndo');
    if (bUn) bUn.onclick = function () {
      if (!P.undo || P.undo.eje !== P.ejeId) { toast('Nada que deshacer'); return; }
      P.tramos[P.ejeId] = P.undo.t; P.undo = null; P.sel = -1; sucio(); render();
      toast('Deshecho · ' + P.T().length + ' tramos');
    };
    var bEN = $('#pistaEstNuevo');   if (bEN) bEN.onclick = nuevoEstado;
    var bEG = $('#pistaEstGuardar'); if (bEG) bEG.onclick = guardarCatalogo;
    var bJN = $('#pistaEjeNuevo');   if (bJN) bJN.onclick = nuevoEje;
    var bJG = $('#pistaEjeGuardar'); if (bJG) bJG.onclick = guardarEjes;
    var bC  = $('#ejeCrear');        if (bC)  bC.onclick  = crearPrimerEje;
  }

  function bindBarra() {
    var sel = $('#pistaEje');
    if (sel) sel.onchange = function () { guardarTramos(true); P.ejeId = this.value; P.sel = -1; P.undo = null; render(); };
    var g = $('#pistaGuardar'); if (g) g.onclick = function () { guardarTramos(false); };
    var p = $('#pistaPdf');     if (p) p.onclick = exportarPDF;
    var r = $('#pistaRefrescar'); if (r) r.onclick = function () {
      if (Object.keys(P.sucio).length && !confirm('Hay cambios sin guardar. ¿Recargar igual y perderlos?')) return;
      P.sucio = {}; cargar(true);
    };
  }

  /* ============ interruptor por obra + visibilidad de la pestaña ============
     La pestaña no cuelga de tipo_obra (ese eje es público/privado y no tiene
     nada que ver con que la obra sea lineal): se prende por obra con
     `pista:activo`. Ruta de la Banana lo prende; en CECON no existe el
     concepto y no se fuerza la analogía. */
  function activoEnConfig() {
    var cfg = global.CFG || {};
    var v = String(cfg['pista:activo'] == null ? '' : cfg['pista:activo']).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'si' || v === 'sí';
  }
  function sincronizarPestania() {
    var on = activoEnConfig();
    ['#tabs button[data-v="pista"]', '#mobinav button[data-v="pista"]'].forEach(function (s) {
      var b = document.querySelector(s); if (b) b.style.display = on ? '' : 'none';
    });
    // si estaba abierta y se apagó, volver al cronograma
    if (!on) {
      var v = document.getElementById('v-pista');
      if (v && v.classList.contains('on')) {
        var t = document.querySelector('#tabs button[data-v="gantt"]'); if (t) t.click();
      }
    }
    return on;
  }

  function togglePista(on) {
    global.CFG = global.CFG || {};
    global.CFG['pista:activo'] = on ? '1' : '0';
    if (typeof global.guardarConfigNS === 'function') global.guardarConfigNS('pista:');
    else if (global.ObraAPI && global.ObraAPI.saveConfig) global.ObraAPI.saveConfig({ 'pista:activo': on ? '1' : '0' });
    sincronizarPestania();
    toast(on ? 'Situación de pista activada para esta obra' : 'Situación de pista desactivada');
    if (on) { P.cargado = false; abrir(); }
  }

  /* Panel chico desde la barra del cronograma: prender/apagar la pestaña. */
  function panelConfig() {
    var on = activoEnConfig();
    var back = document.createElement('div');
    back.className = 'pi-modal-back';
    back.innerHTML = '<div class="pi-modal">' +
      '<h3>Situación de pista</h3>' +
      '<p>Representación lineal del estado de la pista por progresivas. Reemplaza el Excel que se manda por foto como informe de situación.</p>' +
      '<p class="pi-mut">Se prende por obra: solo tiene sentido en obras lineales. No toca cantVigente ni la certificación — es capa visual.</p>' +
      '<label class="pi-chk" style="margin:10px 0"><input type="checkbox" id="pistaOn"' + (on ? ' checked' : '') + '> Mostrar la pestaña en esta obra</label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button class="pi-btn" id="pistaCfgCerrar">Cerrar</button>' +
        '<button class="pi-btn pri" id="pistaCfgOk">Aplicar</button>' +
      '</div></div>';
    document.body.appendChild(back);
    function cerrar() { back.remove(); }
    back.addEventListener('click', function (ev) { if (ev.target === back) cerrar(); });
    back.querySelector('#pistaCfgCerrar').onclick = cerrar;
    back.querySelector('#pistaCfgOk').onclick = function () { togglePista(back.querySelector('#pistaOn').checked); cerrar(); };
  }

  /* ============ ciclo de vida ============ */
  var bindeado = false;
  function abrir() {
    if (!bindeado) { bindBarra(); bindeado = true; }
    cargar(false);
  }
  function reset() {
    if (P.timer) { clearTimeout(P.timer); P.timer = null; }
    P.obra = ''; P.cargado = false; P.ejes = []; P.estados = []; P.tramos = {};
    P.ejeId = ''; P.snapshots = []; P.sel = -1; P.undo = null; P.sucio = {};
  }

  // avisar si se cierra la pestaña del navegador con cambios sin guardar
  window.addEventListener('beforeunload', function (ev) {
    if (!Object.keys(P.sucio).length) return;
    guardarTramos(true);
    ev.preventDefault(); ev.returnValue = '';
  });

  global.PistaView = {
    abrir: abrir,
    reset: reset,
    refrescar: function () { return cargar(true); },
    sincronizarPestania: sincronizarPestania,
    panelConfig: panelConfig,
    guardar: function () { return guardarTramos(true); },
    _P: P,                     // para inspeccionar desde la consola
    // el núcleo, expuesto para poder probarlo desde la consola y para comparar
    // contra el del backend: son el mismo algoritmo escrito dos veces.
    _nucleo: { aplicarTramo: aplicarTramo, fusionar: fusionar, nprog: nprog, fprog: fprog }
  };

})(window);
