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
  function cargarListas(force) {
    var obra = ObraAPI.getObraId();
    if (listasCargadas && cargandoObra === obra && !force) return Promise.resolve();
    return ObraAPI.prodListas(obra).then(function (r) {
      PROD_ITEMS = r.items || [];
      PROD_LADOS = r.lados || [];
      PROD_ESTADOS = r.estados || [];
      ITEM_BY_ID = {};
      PROD_ITEMS.forEach(function (it) { ITEM_BY_ID[String(it.idItem)] = it; });
      listasCargadas = true;
      cargandoObra = obra;
      poblarEstados();
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
  var PASTE_COLS = ['item_id', 'lado', 'prog_ini', 'prog_fin', 'longitud', 'ancho', 'espesor', 'cantidad'];

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

    if (!validas.length && !esLluvia) {
      toast('No hay ítems válidos para guardar');
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
      filas: (validas.length ? validas : [filaVacia()]).map(function (f) {
        return {
          item_id: f.item_id, lado: f.lado,
          prog_ini: f.prog_ini, prog_fin: f.prog_fin,
          longitud: f.longitud, ancho: f.ancho, espesor: f.espesor,
          area: f.area, volumen: f.volumen, cantidad: f.cantidad,
          observaciones: f.observaciones || ''
        };
      })
    };

    var btn = $('#prodGuardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    ObraAPI.prodGuardar(jornada, ObraAPI.getObraId()).then(function (r) {
      toast('Jornada guardada · <b>' + r.guardados + '</b> registro(s)');
      filas = [filaVacia()];
      render();
      cargarHistorial();
    }).catch(function (err) {
      toast('Error al guardar: ' + err.message);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar jornada'; }
    });
  }

  /* ---------------- historial ---------------- */
  function cargarHistorial() {
    var body = $('#prodHistBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" style="color:#8a94a3">Cargando…</td></tr>';
    ObraAPI.prodHistorial(200, ObraAPI.getObraId()).then(function (regs) {
      if (!regs.length) {
        body.innerHTML = '<tr><td colspan="7" style="color:#8a94a3">Sin registros aún.</td></tr>';
        return;
      }
      body.innerHTML = regs.map(function (r) {
        var cls = /lluvia|humedad/i.test(r.estado) ? 'lluvia' : (/receso/i.test(r.estado) ? 'receso' : 'trab');
        var estCorto = r.estado.replace('Con Actividad con liberaciones', 'Trabajó')
                               .replace('Con actividad sin liberaciones', 'Trabajó (s/lib)')
                               .replace('Sin Actividad por lluvia', 'Lluvia')
                               .replace('Sin Actividad Exceso de Humedad', 'Humedad');
        return '<tr>' +
          '<td>' + esc(r.fecha) + '</td>' +
          '<td><span class="prod-badge ' + cls + '">' + esc(estCorto) + '</span></td>' +
          '<td>' + esc(r.idItem) + ' · ' + esc(r.descItem || '') + '</td>' +
          '<td>' + esc(r.lado || '') + '</td>' +
          '<td class="r">' + (r.cantFinal === '' || r.cantFinal == null ? '—' : fmtNum(r.cantFinal)) + '</td>' +
          '<td>' + esc(r.um || '') + '</td>' +
          '<td class="r">' + (r.lluvia === '' || r.lluvia == null ? '' : fmtNum(r.lluvia)) + '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (err) {
      body.innerHTML = '<tr><td colspan="7" style="color:#b3311f">Error: ' + esc(err.message) + '</td></tr>';
    });
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
      cargarHistorial();
    }).catch(function (err) {
      toast('No se pudieron cargar los ítems: ' + err.message);
    });

    if (iniciado) return;
    iniciado = true;
    bindEventos();
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
    $('#prodRefreshHist') && ($('#prodRefreshHist').onclick = cargarHistorial);
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
    reset: function () { listasCargadas = false; filas = [filaVacia()]; }
  };

})(window);
