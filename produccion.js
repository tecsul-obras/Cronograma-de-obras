/* =========================================================================
 * produccion.js — Vista de PRODUCCIÓN dentro de la PWA unificada
 *
 * Grilla tipo Excel: una cabecera de jornada (fecha, estado, lluvia) + N filas
 * de ítems producidos. Los ítems se eligen de los MAESTROS del cronograma
 * (mismos obra_id / item_id). Guarda al backend en la hoja 'Produccion' con el
 * formato Power BI. Reutiliza los helpers globales de app.js ($ , fmtG, toast).
 *
 * Depende de: ObraAPI (api.js), y de app.js para $, $$, fmtG, toast, parsePasted.
 * ========================================================================= */
(function (global) {
  'use strict';

  // helpers globales (definidos en app.js); fallback mínimo por seguridad
  var $  = global.$  || function (s) { return document.querySelector(s); };
  var $$ = global.$$ || function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var fmtG = global.fmtG || function (n) { return '₲ ' + Math.round(n || 0).toLocaleString('es-PY'); };
  function toast(h) { if (global.toast) global.toast(h); }

  // estado de la vista
  var PROD_ITEMS = [];    // catálogo de ítems de la obra: {idItem,descItem,codigoCc,um,pu}
  var PROD_LADOS = [];
  var PROD_ESTADOS = [];
  var ITEM_BY_ID = {};    // idItem → objeto ítem
  var listasCargadas = false;
  var cargandoObra = '';

  // filas de la grilla en memoria (cada una es un ítem producido)
  var filas = [];

  // fotos del día (libro diario) en memoria mientras se arma la jornada.
  // Cada una: { key, name, mime, dataUrl, dataBase64 }
  var fotos = [];

  function espesorEnMetros(v) {
    v = Number(v) || 0;
    if (!v) return 0;
    if (v > 10) return v / 100;   // 25 → 0.25
    if (v > 1)  return v / 10;    // 3  → 0.30
    return v;                      // 0.25 → 0.25
  }

  // cascada: calcula área, volumen y cantidad final de una fila
  function calcFila(f) {
    var lng = Number(f.longitud) || 0;
    var anc = Number(f.ancho) || 0;
    var esp = Number(f.espesor) || 0;
    var cant = Number(f.cantidad) || 0;
    var area = (f.area !== '' && f.area != null) ? Number(f.area) : (lng && anc ? lng * anc : '');
    var vol  = (f.volumen !== '' && f.volumen != null) ? Number(f.volumen)
               : (area && esp ? area * espesorEnMetros(esp) : '');
    var estadoTrabaja = ($('#prodEstado') && $('#prodEstado').value) === 'Con Actividad con liberaciones';
    var cf = '';
    if (estadoTrabaja) {
      if (cant) cf = cant;
      else if (vol) cf = vol;
      else if (area) cf = area;
      else if (lng) cf = lng;
    }
    return { area: area, volumen: vol, cantFinal: cf };
  }

  function filaVacia() {
    return { item_id: '', lado: '', prog_ini: '', prog_fin: '',
             longitud: '', ancho: '', espesor: '', area: '', volumen: '',
             cantidad: '', observaciones: '' };
  }

  /* ---------------- carga de listas (maestros) ---------------- */
  function aplicarListas(obra, r) {
    PROD_ITEMS = r.items || [];
    PROD_LADOS = r.lados || [];
    PROD_ESTADOS = r.estados || [];
    ITEM_BY_ID = {};
    PROD_ITEMS.forEach(function (it) { ITEM_BY_ID[String(it.idItem)] = it; });
    listasCargadas = true;
    cargandoObra = obra;
    poblarEstados();
  }
  // caché local del catálogo (ítems/estados/lados) para poder cargar offline
  function guardarListasCache(obra, r) {
    try {
      localStorage.setItem('obra_prodlistas_' + obra, JSON.stringify({
        items: r.items || [], lados: r.lados || [], estados: r.estados || [], ts: Date.now()
      }));
    } catch (e) {}
  }
  function leerListasCache(obra) {
    try { return JSON.parse(localStorage.getItem('obra_prodlistas_' + obra) || 'null'); }
    catch (e) { return null; }
  }

  function cargarListas(force) {
    var obra = ObraAPI.getObraId();
    if (listasCargadas && cargandoObra === obra && !force) return Promise.resolve();
    return ObraAPI.prodListas(obra).then(function (r) {
      aplicarListas(obra, r);
      guardarListasCache(obra, r);       // guardar para uso offline
    }).catch(function (err) {
      // sin conexión / fallo de red: usar el catálogo cacheado si existe
      var c = leerListasCache(obra);
      if (c) { aplicarListas(obra, c); return; }
      throw err;                          // no hay caché → no se puede poblar ítems
    });
  }

  function poblarEstados() {
    var sel = $('#prodEstado');
    if (!sel) return;
    sel.innerHTML = PROD_ESTADOS.map(function (e) {
      return '<option value="' + esc(e) + '">' + esc(e) + '</option>';
    }).join('');
    toggleLluvia();
  }

  function toggleLluvia() {
    var est = $('#prodEstado') ? $('#prodEstado').value : '';
    var esLluvia = /lluvia|humedad/i.test(est);
    var w = $('#prodLluviaWrap');
    if (w) w.classList.toggle('show', esLluvia);
  }

  /* ---------------- opciones de ítem (datalist por fila) ---------------- */
  function itemOptionsHTML(selId) {
    var opts = '<option value="">— elegir ítem —</option>';
    opts += PROD_ITEMS.map(function (it) {
      var label = it.idItem + ' · ' + (it.descItem || '');
      var sel = String(it.idItem) === String(selId) ? ' selected' : '';
      return '<option value="' + esc(it.idItem) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');
    return opts;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- render de la grilla ---------------- */
  function render() {
    var body = $('#prodBody');
    if (!body) return;
    if (!filas.length) filas.push(filaVacia());

    body.innerHTML = filas.map(function (f, i) {
      var c = calcFila(f);
      var it = ITEM_BY_ID[String(f.item_id)];
      var um = it ? (it.um || '') : '';
      var pu = it ? (Number(it.pu) || 0) : 0;
      var monto = (Number(c.cantFinal) || 0) * pu;
      var ladoOpts = '<option value=""></option>' + PROD_LADOS.map(function (l) {
        return '<option value="' + esc(l) + '"' + (l === f.lado ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');

      return '<tr data-i="' + i + '">' +
        '<td class="prod-itemcell"><select data-k="item_id">' + itemOptionsHTML(f.item_id) + '</select></td>' +
        '<td><select data-k="lado">' + ladoOpts + '</select></td>' +
        '<td><input class="r" data-k="prog_ini" inputmode="decimal" value="' + esc(f.prog_ini) + '"></td>' +
        '<td><input class="r" data-k="prog_fin" inputmode="decimal" value="' + esc(f.prog_fin) + '"></td>' +
        '<td><input class="r" data-k="longitud" inputmode="decimal" value="' + esc(f.longitud) + '"></td>' +
        '<td><input class="r" data-k="ancho" inputmode="decimal" value="' + esc(f.ancho) + '"></td>' +
        '<td><input class="r" data-k="espesor" inputmode="decimal" value="' + esc(f.espesor) + '"></td>' +
        '<td class="calc">' + (c.area === '' ? '—' : fmtNum(c.area)) + '</td>' +
        '<td class="calc">' + (c.volumen === '' ? '—' : fmtNum(c.volumen)) + '</td>' +
        '<td><input class="r" data-k="cantidad" inputmode="decimal" value="' + esc(f.cantidad) + '"></td>' +
        '<td class="calc">' + (c.cantFinal === '' ? '—' : fmtNum(c.cantFinal)) + '</td>' +
        '<td>' + esc(um) + '</td>' +
        '<td class="calc">' + (monto ? fmtG(monto) : '—') + '</td>' +
        '<td class="prod-obscell"><input data-k="observaciones" value="' + esc(f.observaciones) + '" placeholder="observación…"></td>' +
        '<td class="del"><button data-del="' + i + '" title="Quitar fila">✕</button></td>' +
      '</tr>';
    }).join('');

    actualizarTotales();
  }

  function fmtNum(n) {
    if (n === '' || n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-PY', { maximumFractionDigits: 3 });
  }

  function actualizarTotales() {
    var nItems = 0, monto = 0;
    filas.forEach(function (f) {
      if (!f.item_id) return;
      var c = calcFila(f);
      var it = ITEM_BY_ID[String(f.item_id)];
      var pu = it ? (Number(it.pu) || 0) : 0;
      if (c.cantFinal !== '') { nItems++; monto += (Number(c.cantFinal) || 0) * pu; }
    });
    if ($('#prodTotItems')) $('#prodTotItems').textContent = nItems;
    if ($('#prodTotMonto')) $('#prodTotMonto').textContent = fmtG(monto);
  }

  /* ---------------- edición de celdas (delegación) ---------------- */
  function onGridInput(e) {
    var el = e.target;
    var k = el.getAttribute('data-k');
    if (!k) return;
    var tr = el.closest('tr');
    var i = Number(tr.getAttribute('data-i'));
    if (isNaN(i) || !filas[i]) return;
    filas[i][k] = el.value;
    // recalcular solo esta fila (área/vol/cantfinal/monto) sin re-render completo
    // (para no perder foco); actualizamos las celdas calc de la fila
    var c = calcFila(filas[i]);
    var calcs = tr.querySelectorAll('td.calc');
    // orden de celdas calc: área, volumen, cantFinal, monto
    if (calcs[0]) calcs[0].textContent = c.area === '' ? '—' : fmtNum(c.area);
    if (calcs[1]) calcs[1].textContent = c.volumen === '' ? '—' : fmtNum(c.volumen);
    if (calcs[2]) calcs[2].textContent = c.cantFinal === '' ? '—' : fmtNum(c.cantFinal);
    var it = ITEM_BY_ID[String(filas[i].item_id)];
    var pu = it ? (Number(it.pu) || 0) : 0;
    var monto = (Number(c.cantFinal) || 0) * pu;
    if (calcs[3]) calcs[3].textContent = monto ? fmtG(monto) : '—';
    // si cambió el ítem, actualizar UM
    if (k === 'item_id') {
      var umCell = tr.children[11];
      if (umCell) umCell.textContent = it ? (it.um || '') : '';
    }
    actualizarTotales();
  }

  function onGridClick(e) {
    var del = e.target.getAttribute('data-del');
    if (del == null) return;
    var i = Number(del);
    filas.splice(i, 1);
    if (!filas.length) filas.push(filaVacia());
    render();
  }

  /* ---------------- pegar desde Excel ---------------- */
  // columnas esperadas al pegar: item · lado · prog_ini · prog_fin · longitud · ancho · espesor · cantidad
  var PASTE_COLS = ['item_id', 'lado', 'prog_ini', 'prog_fin', 'longitud', 'ancho', 'espesor', 'cantidad', 'observaciones'];

  function pegarDesde(text) {
    var parse = global.parsePasted;
    var grid;
    if (parse) {
      grid = parse(text);
    } else {
      grid = String(text || '').replace(/\r/g, '').replace(/\n+$/, '')
        .split('\n').map(function (l) { return l.split('\t'); });
    }
    if (!grid || !grid.length) return;

    var nuevas = [];
    grid.forEach(function (cols) {
      if (!cols.length || cols.every(function (c) { return String(c).trim() === ''; })) return;
      var f = filaVacia();
      PASTE_COLS.forEach(function (k, idx) {
        if (idx < cols.length) f[k] = String(cols[idx] == null ? '' : cols[idx]).trim();
      });
      // el ítem puede venir como "1012500010 · Terraplén" o solo el id: extraer id
      f.item_id = resolverItemId(f.item_id);
      nuevas.push(f);
    });
    if (!nuevas.length) return;

    // si la grilla está vacía (una fila en blanco), reemplazar; si no, agregar
    var soloVacia = filas.length === 1 && !filas[0].item_id && !filas[0].cantidad;
    filas = soloVacia ? nuevas : filas.concat(nuevas);
    render();
    toast('Pegadas <b>' + nuevas.length + '</b> fila(s)');
  }

  // acepta id exacto, "id · desc", o descripción; devuelve el id del maestro si matchea
  function resolverItemId(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    // "id · desc" → id
    var idParte = s.split('·')[0].trim();
    if (ITEM_BY_ID[idParte]) return idParte;
    if (ITEM_BY_ID[s]) return s;
    // buscar por descripción exacta (case-insensitive)
    var low = s.toLowerCase();
    for (var k = 0; k < PROD_ITEMS.length; k++) {
      if (String(PROD_ITEMS[k].descItem || '').toLowerCase() === low) return PROD_ITEMS[k].idItem;
    }
    // no matcheó: devolver el id crudo (quedará marcado como no seleccionado)
    return idParte || s;
  }

  /* ---------------- guardar jornada ---------------- */
  function guardar() {
    var fecha = $('#prodFecha') ? $('#prodFecha').value : '';
    var estado = $('#prodEstado') ? $('#prodEstado').value : '';
    if (!fecha) { toast('Elegí la fecha de la jornada'); return; }
    if (!estado) { toast('Elegí el estado de actividad'); return; }

    // filas válidas: con ítem del maestro
    var validas = filas.filter(function (f) { return f.item_id && ITEM_BY_ID[String(f.item_id)]; });
    var esLluvia = /lluvia|humedad|receso/i.test(estado);
    var hayNota = !!($('#prodObsDia') && $('#prodObsDia').value.trim());
    var hayFotos = fotos.length > 0;

    // se puede guardar sin ítems si es día de lluvia/receso, o si hay nota/fotos
    // (para que sirva de libro diario aunque no haya producción medida ese día)
    if (!validas.length && !esLluvia && !hayNota && !hayFotos) {
      toast('No hay ítems válidos para guardar (ni nota ni fotos del día)');
      return;
    }
    // ítems que no matchean el maestro: avisar
    var invalidas = filas.filter(function (f) { return f.item_id && !ITEM_BY_ID[String(f.item_id)]; });
    if (invalidas.length) {
      if (!confirm(invalidas.length + ' fila(s) tienen un ítem que no está en el cronograma y se omitirán. ¿Continuar?')) return;
    }

    var jornada = {
      fecha: fecha,
      estado: estado,
      responsable: '',
      lluvia_mm: $('#prodLluvia') ? $('#prodLluvia').value : '',
      obs_jornada: $('#prodObsDia') ? $('#prodObsDia').value.trim() : '',   // libro diario
      filas: (validas.length ? validas : [filaVacia()]).map(function (f) {
        return {
          item_id: f.item_id, lado: f.lado,
          prog_ini: f.prog_ini, prog_fin: f.prog_fin,
          longitud: f.longitud, ancho: f.ancho, espesor: f.espesor,
          area: f.area, volumen: f.volumen, cantidad: f.cantidad,
          observaciones: f.observaciones || ''
        };
      }),
      fotos: fotos.map(function (p) { return { name: p.name, mime: p.mime, dataBase64: p.dataBase64 }; })
    };

    var btn = $('#prodGuardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    ObraAPI.prodGuardar(jornada, ObraAPI.getObraId()).then(function (r) {
      var nF = r.fotos != null ? r.fotos : fotos.length;
      var sufFotos = nF ? (' · ' + nF + ' foto(s)') : '';
      if (r.queued) {
        toast('📴 Sin conexión — jornada guardada en el teléfono (' + r.guardados +
              ' ítem/s' + sufFotos + '). Se enviará sola al recuperar señal.');
      } else {
        toast('Jornada guardada · <b>' + r.guardados + '</b> registro(s)' + sufFotos);
      }
      filas = [filaVacia()];
      fotos = [];
      render();
      renderFotos();
      if ($('#prodObsDia')) $('#prodObsDia').value = '';   // limpiar la nota del día
      cargarHistorial();
      // sólo refrescamos el modelo del cronograma si la producción llegó al
      // servidor; si quedó en cola, el avance se actualizará al sincronizar.
      if (!r.queued && typeof global.refrescarObraActual === 'function') {
        global.refrescarObraActual();
      }
    }).catch(function (err) {
      toast('Error al guardar: ' + err.message);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar jornada'; }
    });
  }

  /* ---------------- fotos del día (libro diario) ---------------- */
  var MAX_FOTOS = 12;

  function agregarFotos(fileList) {
    var files = [].slice.call(fileList || []).filter(function (f) { return /^image\//i.test(f.type); });
    if (!files.length) return;
    if (fotos.length + files.length > MAX_FOTOS) {
      toast('Máximo ' + MAX_FOTOS + ' fotos por día.');
      files = files.slice(0, Math.max(0, MAX_FOTOS - fotos.length));
    }
    if (!global.PhotoStore) { toast('No se pudo preparar la foto.'); return; }
    var cont = $('#prodFotoCount'); if (cont) cont.textContent = 'Procesando…';
    Promise.all(files.map(function (f) {
      return global.PhotoStore.compressImage(f, 1600, 0.72).then(function (r) {
        r.key = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        fotos.push(r);
      }).catch(function () { /* imagen ilegible: se omite */ });
    })).then(function () { renderFotos(); });
  }

  function quitarFoto(key) {
    fotos = fotos.filter(function (p) { return p.key !== key; });
    renderFotos();
  }

  function renderFotos() {
    var strip = $('#prodFotos'); if (!strip) return;
    strip.innerHTML = fotos.map(function (p) {
      return '<div class="thumb" data-fk="' + esc(p.key) + '">' +
        '<img src="' + p.dataUrl + '" alt="foto">' +
        '<button type="button" data-fdel="' + esc(p.key) + '" title="Quitar">✕</button>' +
      '</div>';
    }).join('');
    var cont = $('#prodFotoCount');
    if (cont) cont.textContent = fotos.length ? (fotos.length + ' foto(s)') : '';
  }

  // miniaturas de fotos YA subidas (historial), a partir de las URLs de Drive
  function fotoThumbsHTML(fotosStr) {
    if (!fotosStr) return '';
    var urls = String(fotosStr).split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!urls.length) return '';
    return '<div class="hist-fotos">' + urls.map(function (u) {
      var m = u.match(/\/d\/([^/]+)/) || u.match(/[?&]id=([^&]+)/);
      var id = m ? m[1] : '';
      var thumb = id ? ('https://drive.google.com/thumbnail?id=' + id + '&sz=w200') : u;
      return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' +
             '<img loading="lazy" src="' + esc(thumb) + '" alt="foto"></a>';
    }).join('') + '</div>';
  }

  /* ---------------- historial ---------------- */
  var HIST = [];   // registros del historial en memoria (para editar)

  function cargarHistorial() {
    var body = $('#prodHistBody');
    if (!body) return;
    actualizarPendChip();
    var pend = pendRowsHTML();   // jornadas en cola de esta obra (van arriba)

    // sin conexión: mostramos sólo lo pendiente, sin intentar el servidor
    if (!navigator.onLine) {
      body.innerHTML = pend +
        '<tr><td colspan="8" style="color:#8a94a3">📴 Sin conexión — el historial del servidor se verá al reconectar.</td></tr>';
      return;
    }

    body.innerHTML = pend + '<tr><td colspan="8" style="color:#8a94a3">Cargando…</td></tr>';
    ObraAPI.prodHistorial(200, ObraAPI.getObraId()).then(function (regs) {
      HIST = regs || [];
      body.innerHTML = pend + (HIST.length
        ? HIST.map(histRowHTML).join('')
        : '<tr><td colspan="8" style="color:#8a94a3">Sin registros en el servidor todavía.</td></tr>');
    }).catch(function (err) {
      body.innerHTML = pend +
        '<tr><td colspan="8" style="color:#b3311f">Error: ' + esc(err.message) + '</td></tr>';
    });
  }

  // fila del historial ya guardado en el servidor
  function histRowHTML(r, i) {
    var cls = /lluvia|humedad/i.test(r.estado) ? 'lluvia' : (/receso/i.test(r.estado) ? 'receso' : 'trab');
    var estCorto = String(r.estado || '')
      .replace('Con Actividad con liberaciones', 'Trabajó')
      .replace('Con actividad sin liberaciones', 'Trabajó (s/lib)')
      .replace('Sin Actividad por lluvia', 'Lluvia')
      .replace('Sin Actividad Exceso de Humedad', 'Humedad');
    // nota del día y fotos: una sola vez por jornada (primera fila del bloque)
    var primeraDelBloque = (i === 0 ||
      HIST[i - 1].fecha !== r.fecha || HIST[i - 1].estado !== r.estado);
    return '<tr data-h="' + i + '">' +
      '<td>' + esc(r.fecha) + '</td>' +
      '<td><span class="prod-badge ' + cls + '">' + esc(estCorto) + '</span></td>' +
      '<td>' + esc(r.idItem) + ' · ' + esc(r.descItem || '') +
        (r.observaciones ? '<div class="hist-obs">📝 ' + esc(r.observaciones) + '</div>' : '') +
        (primeraDelBloque && r.obsJornada ? '<div class="hist-obs dia">📖 ' + esc(r.obsJornada) + '</div>' : '') +
        (primeraDelBloque ? fotoThumbsHTML(r.fotos) : '') +
      '</td>' +
      '<td>' + esc(r.lado || '') + '</td>' +
      '<td class="r">' + (r.cantFinal === '' || r.cantFinal == null ? '—' : fmtNum(r.cantFinal)) + '</td>' +
      '<td>' + esc(r.um || '') + '</td>' +
      '<td class="r">' + (r.lluvia === '' || r.lluvia == null ? '' : fmtNum(r.lluvia)) + '</td>' +
      '<td class="r" style="white-space:nowrap">' +
        '<button class="hist-act" data-edit="' + i + '" title="Editar">✎</button>' +
        '<button class="hist-act del" data-del="' + i + '" title="Borrar">🗑</button>' +
      '</td>' +
    '</tr>';
  }

  /* ---------------- jornadas pendientes (cola offline) ---------------- */
  function pendRowsHTML() {
    if (!global.Outbox) return '';
    var pend = global.Outbox.forObra(ObraAPI.getObraId());
    if (!pend.length) return '';
    return pend.map(function (p) {
      var j = p.payload || {};
      var nItems = (j.filas || []).filter(function (f) { return f.item_id; }).length;
      var nFotos = (j.fotos_ids || []).length;
      var errTxt = p.error ? ' · ⚠ ' + esc(p.error) : '';
      var lluvia = (j.lluvia_mm === '' || j.lluvia_mm == null) ? '' : fmtNum(j.lluvia_mm);
      return '<tr class="prod-pend" data-pend="' + esc(p.id) + '">' +
        '<td>' + esc(j.fecha || '') + '</td>' +
        '<td><span class="prod-badge pend">⏳ Sin enviar</span></td>' +
        '<td colspan="4">' + nItems + ' ítem(s) en cola' + (nFotos ? ' · 📷 ' + nFotos : '') + errTxt +
          (j.obs_jornada ? '<div class="hist-obs dia">📖 ' + esc(j.obs_jornada) + '</div>' : '') + '</td>' +
        '<td class="r">' + lluvia + '</td>' +
        '<td class="r" style="white-space:nowrap">' +
          '<button class="hist-act" data-pend-retry="' + esc(p.id) + '" title="Reintentar ahora">⟳</button>' +
          '<button class="hist-act del" data-pend-del="' + esc(p.id) + '" title="Descartar (no se enviará)">🗑</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  // chip "N sin enviar" junto a los botones de guardar
  function actualizarPendChip() {
    var chip = $('#prodPendChip');
    if (!chip) return;
    var n = global.Outbox ? global.Outbox.forObra(ObraAPI.getObraId()).length : 0;
    if (n) { chip.style.display = ''; chip.textContent = '⏳ ' + n + ' jornada(s) sin enviar'; }
    else   { chip.style.display = 'none'; }
  }

  function pendReintentar(id) {
    if (!global.Outbox) return;
    if (!navigator.onLine) { toast('Seguís sin conexión — se enviará solo al recuperar señal.'); return; }
    toast('Reintentando envío…');
    global.Outbox.retry(id).then(function (res) {
      cargarHistorial();
      if (res && res.sent) {
        toast('Sincronizado ✓ · ' + res.sent + ' jornada(s)');
        if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
      } else if (res && res.offline) {
        toast('No se pudo enviar: seguís sin conexión.');
      }
    });
  }

  function pendDescartar(id) {
    if (!confirm('¿Descartar esta jornada de la cola?\nNo se enviará al servidor y se perderá.')) return;
    if (global.Outbox) global.Outbox.remove(id);
    cargarHistorial();
    toast('Jornada descartada de la cola.');
  }

  /* ---- editar un registro del historial (inline en un mini-form) ---- */
  function histEditar(i) {
    var r = HIST[i]; if (!r) return;
    var tr = $('#prodHistBody').querySelector('tr[data-h="' + i + '"]');
    if (!tr) return;
    // fila de edición debajo, con los campos editables
    var editRow = document.createElement('tr');
    editRow.className = 'hist-edit-row';
    editRow.innerHTML = '<td colspan="8">' +
      '<div class="hist-edit">' +
        '<label>Lado <input data-e="lado" value="' + esc(r.lado || '') + '"></label>' +
        '<label>Long. <input data-e="longitud" inputmode="decimal" value="' + esc(numOr(r.longitud)) + '"></label>' +
        '<label>Ancho <input data-e="ancho" inputmode="decimal" value="' + esc(numOr(r.ancho)) + '"></label>' +
        '<label>Espesor <input data-e="espesor" inputmode="decimal" value="' + esc(numOr(r.espesor)) + '"></label>' +
        '<label>Cantidad <input data-e="cantidad" inputmode="decimal" value="' + esc(numOr(r.cantidad)) + '"></label>' +
        '<label>Lluvia mm <input data-e="lluvia_mm" inputmode="decimal" value="' + esc(numOr(r.lluvia)) + '"></label>' +
        '<label style="flex:1">Obs. <input data-e="observaciones" value="' + esc(r.observaciones || '') + '"></label>' +
        '<button class="chipbtn tape" data-savehist="' + i + '">Guardar</button>' +
        '<button class="chipbtn" data-cancelhist="' + i + '">Cancelar</button>' +
      '</div></td>';
    // quitar cualquier fila de edición previa
    var prev = $('#prodHistBody').querySelector('.hist-edit-row');
    if (prev) prev.remove();
    tr.parentNode.insertBefore(editRow, tr.nextSibling);
  }

  function numOr(v){ return (v === '' || v == null) ? '' : v; }

  function histGuardar(i) {
    var r = HIST[i]; if (!r) return;
    var editRow = $('#prodHistBody').querySelector('.hist-edit-row');
    if (!editRow) return;
    var cambios = {};
    editRow.querySelectorAll('[data-e]').forEach(function (inp) {
      cambios[inp.getAttribute('data-e')] = inp.value.trim();
    });
    ObraAPI.prodEditar(r.submissionId, cambios, ObraAPI.getObraId()).then(function () {
      toast('Registro actualizado');
      cargarHistorial();
      if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
    }).catch(function (err) { toast('Error al editar: ' + err.message); });
  }

  function histBorrar(i) {
    var r = HIST[i]; if (!r) return;
    if (!confirm('¿Borrar este registro?\n' + r.fecha + ' · ' + r.idItem + ' · ' + (r.descItem || '') +
                 '\nCant: ' + (r.cantFinal || '—'))) return;
    ObraAPI.prodBorrar(r.submissionId, ObraAPI.getObraId()).then(function () {
      toast('Registro borrado');
      cargarHistorial();
      if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
    }).catch(function (err) { toast('Error al borrar: ' + err.message); });
  }

  /* ---------------- init de la vista (lazy, al abrir la pestaña) ---------------- */
  var iniciado = false;
  function abrir() {
    // fecha por defecto = hoy
    if ($('#prodFecha') && !$('#prodFecha').value) {
      $('#prodFecha').value = new Date().toISOString().slice(0, 10);
    }
    cargarListas().then(function () {
      if (!filas.length) filas = [filaVacia()];
      render();
      renderFotos();
      cargarHistorial();
      // si hay señal y quedaron jornadas en cola, intentá enviarlas ya
      if (navigator.onLine && global.Outbox && global.Outbox.count()) {
        global.Outbox.flush().then(function (res) {
          if (res && res.sent) {
            cargarHistorial();
            if (typeof global.refrescarObraActual === 'function') global.refrescarObraActual();
          }
        });
      }
    }).catch(function (err) {
      // sin conexión y sin catálogo cacheado: igual mostramos la vista
      render();
      cargarHistorial();
      toast('No se pudieron cargar los ítems (' + err.message + '). ' +
            'Abrí esta obra con conexión al menos una vez para cargar producción offline.');
    });

    if (iniciado) return;
    iniciado = true;
    bindEventos();
    engancharOutbox();
  }

  // refresca la vista/chip cuando cambia la cola y al reconectar
  var outboxHooked = false;
  var pendRefreshT = null;
  function engancharOutbox() {
    if (outboxHooked || !global.Outbox) return;
    outboxHooked = true;
    global.Outbox.onChange(function () {
      actualizarPendChip();                 // el chip se actualiza al instante
      clearTimeout(pendRefreshT);           // el historial, con debounce
      pendRefreshT = setTimeout(function () {
        var v = $('#v-prod');
        if (v && v.classList.contains('on')) cargarHistorial();
      }, 400);
    });
    global.addEventListener('online', function () {
      var v = $('#v-prod');
      if (v && v.classList.contains('on')) setTimeout(cargarHistorial, 1800);
    });
  }

  function bindEventos() {
    var body = $('#prodBody');
    if (body) {
      body.addEventListener('input', onGridInput);
      body.addEventListener('change', onGridInput);
      body.addEventListener('click', onGridClick);
    }
    $('#prodEstado') && $('#prodEstado').addEventListener('change', function () { toggleLluvia(); render(); });
    $('#prodAddRow') && ($('#prodAddRow').onclick = function () { filas.push(filaVacia()); render(); });
    $('#prodLimpiar') && ($('#prodLimpiar').onclick = function () {
      if (confirm('¿Limpiar todas las filas?')) { filas = [filaVacia()]; render(); }
    });
    $('#prodGuardar') && ($('#prodGuardar').onclick = guardar);
    // fotos del día
    $('#prodFotoBtn') && ($('#prodFotoBtn').onclick = function () {
      var inp = $('#prodFotoInput'); if (inp) inp.click();
    });
    $('#prodFotoInput') && $('#prodFotoInput').addEventListener('change', function (e) {
      agregarFotos(e.target.files);
      e.target.value = '';   // permite volver a elegir la misma foto
    });
    $('#prodFotos') && $('#prodFotos').addEventListener('click', function (e) {
      var k = e.target.getAttribute('data-fdel');
      if (k) quitarFoto(k);
    });
    $('#prodRefreshHist') && ($('#prodRefreshHist').onclick = cargarHistorial);
    // acciones del historial: editar / borrar / guardar edición / cancelar
    $('#prodHistBody') && $('#prodHistBody').addEventListener('click', function (e) {
      var t = e.target;
      var pr = t.getAttribute('data-pend-retry'); if (pr != null) { pendReintentar(pr); return; }
      var pd = t.getAttribute('data-pend-del');   if (pd != null) { pendDescartar(pd); return; }
      var ed = t.getAttribute('data-edit');   if (ed != null) { histEditar(Number(ed)); return; }
      var dl = t.getAttribute('data-del');    if (dl != null) { histBorrar(Number(dl)); return; }
      var sv = t.getAttribute('data-savehist'); if (sv != null) { histGuardar(Number(sv)); return; }
      var cx = t.getAttribute('data-cancelhist'); if (cx != null) {
        var er = $('#prodHistBody').querySelector('.hist-edit-row'); if (er) er.remove(); return;
      }
    });
    $('#prodPegar') && ($('#prodPegar').onclick = function () {
      var t = prompt('Pegá aquí las filas copiadas de Excel:');
      if (t) pegarDesde(t);
    });

    // pegar directo con Ctrl+V cuando la vista de producción está activa
    document.addEventListener('paste', function (e) {
      var view = $('#v-prod');
      if (!view || !view.classList.contains('on')) return;
      // no interceptar si el foco está en un input de texto libre (deja pegar normal)
      var t = (e.clipboardData || global.clipboardData).getData('text');
      if (!t || t.indexOf('\t') < 0 && t.indexOf('\n') < 0) return; // pegado simple de una celda
      e.preventDefault();
      pegarDesde(t);
    });
  }

  // API pública mínima para que app.js enganche la pestaña
  global.ProduccionView = {
    abrir: abrir,
    recargarListas: function () { return cargarListas(true); },
    reset: function () { listasCargadas = false; filas = [filaVacia()]; fotos = []; }
  };

  /* =======================================================================
   * CERTIFICACIÓN — grilla por mes (item × cantidad certificada del mes)
   * ===================================================================== */
  var CERT = {
    items: [],           // ítems del maestro (mismos de producción)
    porMesItem: {},      // 'mes|item_id' → {cant, obs, nro}
    meses: [],           // meses ya certificados
    listasOk: false,
    obra: ''
  };

  function certCargarBase(force) {
    var obra = ObraAPI.getObraId();
    var pItems = (listasCargadas && cargandoObra === obra && !force)
      ? Promise.resolve()
      : cargarListas(force);
    return pItems.then(function () {
      // certificación es SOLO por ítem de contrato: se excluyen las subdivisiones
      // (que sirven para planear/producir, pero no se certifican por tramo).
      CERT.items = PROD_ITEMS.filter(function(it){
        return it.tipo !== 'subdivision' && !(it.padreId && it.tipo === 'subdivision');
      });
      return ObraAPI.certListar(obra);
    }).then(function (r) {
      CERT.porMesItem = {};
      (r.registros || []).forEach(function (x) {
        CERT.porMesItem[x.mes + '|' + String(x.item_id)] = {
          cant: x.cant, obs: x.observacion, nro: x.nro_certificado
        };
      });
      CERT.meses = r.meses || [];
      CERT.listasOk = true;
      CERT.obra = obra;
    });
  }

  function certMesActual() {
    var el = $('#certMes');
    return el ? el.value : '';   // 'YYYY-MM'
  }

  function certRender() {
    var body = $('#certBody');
    if (!body) return;
    var mes = certMesActual();
    // precargar nro de certificado del mes si existe
    var nroMes = '';
    CERT.items.some(function (it) {
      var k = mes + '|' + String(it.idItem);
      if (CERT.porMesItem[k] && CERT.porMesItem[k].nro) { nroMes = CERT.porMesItem[k].nro; return true; }
      return false;
    });
    if ($('#certNro') && nroMes && !$('#certNro').value) $('#certNro').value = nroMes;

    body.innerHTML = CERT.items.map(function (it) {
      var k = mes + '|' + String(it.idItem);
      var reg = CERT.porMesItem[k] || {};
      var cant = reg.cant != null ? reg.cant : '';
      var obs = reg.obs || '';
      var pu = Number(it.pu) || 0;
      var monto = (Number(cant) || 0) * pu;
      var cantContrato = it.cantContrato != null ? it.cantContrato : '';
      var pctItem = (Number(cant) && cantContrato) ? (Number(cant) / Number(cantContrato) * 100) : null;

      return '<tr data-item="' + esc(it.idItem) + '">' +
        '<td class="prod-itemcell">' + esc(it.idItem) + ' · ' + esc(it.descItem || '') + '</td>' +
        '<td>' + esc(it.um || '') + '</td>' +
        '<td class="calc">' + (pu ? fmtG(pu) : '—') + '</td>' +
        '<td class="calc">' + (cantContrato === '' ? '—' : fmtNum(cantContrato)) + '</td>' +
        '<td><input class="r" data-ck="cant" inputmode="decimal" value="' + esc(cant) + '"></td>' +
        '<td class="calc" data-mc="monto">' + (monto ? fmtG(monto) : '—') + '</td>' +
        '<td class="calc" data-mc="pct">' + (pctItem == null ? '—' : pctItem.toFixed(1) + '%') + '</td>' +
        '<td><input data-ck="obs" value="' + esc(obs) + '" placeholder=""></td>' +
      '</tr>';
    }).join('');

    certTotales();
    certRenderMeses();
  }

  function certTotales() {
    var mes = certMesActual();
    var nItems = 0, montoMes = 0, acum = 0;
    // monto del mes visible (desde los inputs) + acumulado de todos los meses
    CERT.items.forEach(function (it) {
      var pu = Number(it.pu) || 0;
      Object.keys(CERT.porMesItem).forEach(function (k) {
        if (k.split('|')[1] === String(it.idItem)) {
          acum += (Number(CERT.porMesItem[k].cant) || 0) * pu;
        }
      });
    });
    // recorrer inputs actuales para el mes en edición
    $$('#certBody tr').forEach(function (tr) {
      var itemId = tr.getAttribute('data-item');
      var it = ITEM_BY_ID[String(itemId)];
      var pu = it ? (Number(it.pu) || 0) : 0;
      var inp = tr.querySelector('[data-ck="cant"]');
      var cant = inp ? Number(inp.value) || 0 : 0;
      if (cant) { nItems++; montoMes += cant * pu; }
    });

    if ($('#certTotItems')) $('#certTotItems').textContent = nItems;
    if ($('#certTotMonto')) $('#certTotMonto').textContent = fmtG(montoMes);
    if ($('#certMontoMes')) $('#certMontoMes').textContent = fmtG(montoMes);
    if ($('#certAcum')) $('#certAcum').textContent = fmtG(acum);
  }

  function certRenderMeses() {
    var body = $('#certMesesBody');
    if (!body) return;
    // agrupar monto por mes
    var porMes = {};
    Object.keys(CERT.porMesItem).forEach(function (k) {
      var parts = k.split('|'); var mes = parts[0]; var itemId = parts[1];
      var it = ITEM_BY_ID[String(itemId)];
      var pu = it ? (Number(it.pu) || 0) : 0;
      var monto = (Number(CERT.porMesItem[k].cant) || 0) * pu;
      if (!porMes[mes]) porMes[mes] = { n: 0, monto: 0 };
      porMes[mes].n++; porMes[mes].monto += monto;
    });
    var meses = Object.keys(porMes).sort();
    if (!meses.length) {
      body.innerHTML = '<tr><td colspan="4" style="color:#8a94a3">Sin certificaciones aún.</td></tr>';
      return;
    }
    body.innerHTML = meses.map(function (m) {
      return '<tr>' +
        '<td>' + esc(m) + '</td>' +
        '<td class="r">' + porMes[m].n + '</td>' +
        '<td class="r">' + fmtG(porMes[m].monto) + '</td>' +
        '<td class="r"><button class="chipbtn" data-cert-mes="' + esc(m) + '" style="font-size:11px;padding:3px 8px">Editar</button></td>' +
      '</tr>';
    }).join('');
  }

  function certOnInput(e) {
    var el = e.target;
    var ck = el.getAttribute('data-ck');
    if (!ck) return;
    var tr = el.closest('tr');
    var itemId = tr.getAttribute('data-item');
    var it = ITEM_BY_ID[String(itemId)];
    var pu = it ? (Number(it.pu) || 0) : 0;
    if (ck === 'cant') {
      var cant = Number(el.value) || 0;
      var monto = cant * pu;
      var mc = tr.querySelector('[data-mc="monto"]');
      if (mc) mc.textContent = monto ? fmtG(monto) : '—';
      var pctc = tr.querySelector('[data-mc="pct"]');
      var cc = it && it.cantContrato ? Number(it.cantContrato) : 0;
      if (pctc) pctc.textContent = (cant && cc) ? (cant / cc * 100).toFixed(1) + '%' : '—';
      certTotales();
    }
  }

  function certGuardar() {
    var mes = certMesActual();
    if (!mes) { toast('Elegí el mes a certificar'); return; }
    var nro = $('#certNro') ? $('#certNro').value.trim() : '';
    var filasCert = [];
    $$('#certBody tr').forEach(function (tr) {
      var itemId = tr.getAttribute('data-item');
      var cant = tr.querySelector('[data-ck="cant"]');
      var obs = tr.querySelector('[data-ck="obs"]');
      var cv = cant ? cant.value.trim() : '';
      var ov = obs ? obs.value.trim() : '';
      if (cv === '' && ov === '') return;   // fila vacía
      filasCert.push({ item_id: itemId, cant_certificada: cv, observacion: ov });
    });

    var btn = $('#certGuardarBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    ObraAPI.certGuardar(mes, filasCert, nro, ObraAPI.getObraId()).then(function (r) {
      toast('Certificación de <b>' + r.mes + '</b> guardada · ' + r.guardados + ' ítem(s)');
      return certCargarBase(true);
    }).then(function () {
      certRender();
      // actualizar el modelo global (CERT) para que la curva de certificado y
      // el KPI de monto certificado reflejen lo recién guardado, sin recargar.
      if (typeof global.aplicarCertAlModelo === 'function') {
        global.aplicarCertAlModelo(CERT.porMesItem);
      }
    }).catch(function (err) {
      toast('Error al guardar: ' + err.message);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar certificación del mes'; }
    });
  }

  // pegar de Excel: item · cantidad · observación
  function certPegar(text) {
    var parse = global.parsePasted;
    var grid = parse ? parse(text)
      : String(text || '').replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function (l) { return l.split('\t'); });
    if (!grid || !grid.length) return;
    var mes = certMesActual();
    if (!mes) { toast('Elegí el mes antes de pegar'); return; }
    var n = 0;
    grid.forEach(function (cols) {
      if (!cols.length) return;
      var id = resolverItemId(String(cols[0] || '').trim());
      if (!ITEM_BY_ID[String(id)]) return;
      var cant = cols.length > 1 ? String(cols[1] || '').trim() : '';
      var obs = cols.length > 2 ? String(cols[2] || '').trim() : '';
      CERT.porMesItem[mes + '|' + String(id)] = {
        cant: cant === '' ? '' : Number(cant.replace(',', '.')) || 0,
        obs: obs, nro: $('#certNro') ? $('#certNro').value.trim() : ''
      };
      n++;
    });
    if (n) { certRender(); toast('Pegadas <b>' + n + '</b> fila(s) — revisá y guardá'); }
    else toast('No se reconoció ningún ítem de esta obra');
  }

  var certIniciado = false;
  function certAbrir() {
    if ($('#certMes') && !$('#certMes').value) {
      $('#certMes').value = new Date().toISOString().slice(0, 7);   // mes actual
    }
    certCargarBase(CERT.obra !== ObraAPI.getObraId()).then(function () {
      certRender();
    }).catch(function (err) {
      toast('No se pudo cargar la certificación: ' + err.message);
    });

    if (certIniciado) return;
    certIniciado = true;
    var body = $('#certBody');
    if (body) { body.addEventListener('input', certOnInput); }
    $('#certMes') && ($('#certMes').onchange = function () {
      if ($('#certNro')) $('#certNro').value = '';
      certRender();
    });
    $('#certGuardarBtn') && ($('#certGuardarBtn').onclick = certGuardar);
    $('#certPegar') && ($('#certPegar').onclick = function () {
      var t = prompt('Pegá aquí las filas de Excel (ítem · cantidad · observación):');
      if (t) certPegar(t);
    });
    // editar un mes ya certificado
    $('#certMesesBody') && $('#certMesesBody').addEventListener('click', function (e) {
      var m = e.target.getAttribute('data-cert-mes');
      if (!m) return;
      if ($('#certMes')) $('#certMes').value = m;
      if ($('#certNro')) $('#certNro').value = '';
      certRender();
      $('#v-cert').scrollTop = 0;
    });
    document.addEventListener('paste', function (e) {
      var view = $('#v-cert');
      if (!view || !view.classList.contains('on')) return;
      var t = (e.clipboardData || global.clipboardData).getData('text');
      if (!t || (t.indexOf('\t') < 0 && t.indexOf('\n') < 0)) return;
      e.preventDefault();
      certPegar(t);
    });
  }

  global.CertificacionView = {
    abrir: certAbrir,
    reset: function () { CERT.listasOk = false; CERT.obra = ''; }
  };

})(window);
