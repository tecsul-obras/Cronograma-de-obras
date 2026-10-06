/* =========================================================================
 * ui.js — Ajustes de interfaz sin tocar app.js · v20261006a
 *
 *  1. Menú "☰ Funciones" de la barra del cronograma: agrupa Cargar ítems,
 *     Cargar mensual, Re-sincronizar, Línea base, Convenios, Calendario,
 *     Lluvia, Gantt con lluvia, Reprogramar, Situación de pista y Obra nueva.
 *     Los botones conservan su id, así que app.js y los módulos los siguen
 *     enlazando igual; acá solo se abre y cierra el menú.
 *  3. Situación de pista en el celular: solo consulta (sin Guardar ni
 *     herramientas de edición; los tramos se ven pero no se tocan).
 *  2. Plan semanal en el celular: vista simplificada de solo lectura
 *     (ítem, actividad y cantidad prevista de la semana). Lee los mismos datos
 *     que la vista de escritorio (WEEKLY, ALLWEEKS, byId de app.js).
 * ========================================================================= */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fq(v) { var x = Number(v); return isFinite(x) && v !== null && v !== '' ? x.toLocaleString('es-PY', { maximumFractionDigits: 6 }) : '–'; }
  // variables de app.js (let/const de nivel superior: se leen por nombre, no cuelgan de window)
  function leer(nombre) { try { return (0, eval)(nombre); } catch (e) { return undefined; } }

  function estilos() {
    if ($('#uiCss')) return;
    var st = document.createElement('style'); st.id = 'uiCss';
    st.textContent = [
      /* menú Funciones */
      '.xl-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}',
      '.xl-bar .chipbtn{display:inline-flex;align-items:center}',
      '.fnmenu{position:relative}',
      '.fnmenu .fncar{font-size:10px;margin-left:2px}',
      '.fnmenu.hay-activo #fnBtn::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#e8640a;margin-left:6px;vertical-align:middle}',
      '.fnpop{display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:400;background:#fff;border:1px solid #d0d6e0;border-radius:10px;',
      '  box-shadow:0 12px 32px rgba(15,30,60,.18);padding:10px;gap:6px;color:#1f2937}',
      '.fnmenu.open .fnpop{display:flex}',
      '.fncol{display:flex;flex-direction:column;min-width:200px;padding:0 4px}',
      '.fncol+.fncol{border-left:1px solid #eef0f4;padding-left:10px}',
      '.fnsec{font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#7a8699;padding:4px 8px 6px}',
      '.fnit{display:block;width:100%;text-align:left;background:none;border:0;border-radius:7px;padding:8px 10px;font-size:13px;font-weight:600;color:#1f2937;cursor:pointer;white-space:nowrap}',
      '.fnit:hover{background:#f0f4fa;color:#1a2744}',
      '.fnit.active{background:#fdecea;color:#c0392b}',
      '.fnit.active::after{content:" · activo";font-weight:400;font-size:11px}',
      '@media (max-width:1100px){.fnpop{flex-direction:column}.fncol+.fncol{border-left:0;border-top:1px solid #eef0f4;padding:8px 4px 0}}',
      /* plan semanal simplificado en el celular */
      'body.mobile #v-weekly .wk-wrap{display:none}',
      '#wkMovil{display:none}',
      /* la vista es absoluta y sin scroll: el contenedor del celular tiene que
         scrollear solo (antes se cortaba la lista y no se veían todos los ítems) */
      'body.mobile #wkMovil{display:block;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;',
      '  padding:10px 10px calc(28px + env(safe-area-inset-bottom));background:#fff;color:#1f2937}',
      'body.mobile #wkMovil .wm-nav{position:sticky;top:-10px;z-index:2;background:#fff;padding:6px 0}',
      '.wm-nav{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.wm-nav button{flex:0 0 42px;height:42px;border-radius:10px;border:1px solid #d0d6e0;background:#fff;font-size:22px;color:#1a2744}',
      '.wm-nav .wm-sem{flex:1;text-align:center;line-height:1.2}',
      '.wm-nav .wm-sem b{display:block;font-size:16px;color:#1a2744}',
      '.wm-nav .wm-sem span{font-size:11.5px;color:#4a5568}',
      '.wm-nav select{position:absolute;opacity:0;pointer-events:none;width:1px}',
      '.wm-res{display:flex;gap:8px;margin-bottom:10px}',
      '.wm-res div{flex:1;border:1px solid #d0d6e0;border-radius:10px;padding:7px 10px}',
      '.wm-res b{display:block;font-size:17px;color:#1a2744}.wm-res span{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#4a5568}',
      '.wm-filtro{width:100%;padding:9px 11px;border:1px solid #d0d6e0;border-radius:10px;font-size:14px;margin-bottom:10px;background:#fff;color:#1f2937}',
      '.wm-l{list-style:none;margin:0;padding:0}',
      '.wm-l li{display:flex;gap:10px;align-items:center;padding:10px 4px;border-bottom:1px solid #eef0f4}',
      '.wm-l .wm-id{flex:0 0 auto;font:600 12px var(--mono,monospace);color:#2c4a8a;min-width:38px}',
      '.wm-l .wm-tx{flex:1;min-width:0;font-size:13.5px;line-height:1.3}',
      '.wm-l .wm-tx small{display:block;color:#7a8699;font-size:11.5px;margin-top:1px}',
      '.wm-l .wm-q{flex:0 0 auto;text-align:right;font-weight:700;font-size:15px;color:#1a2744;white-space:nowrap}',
      '.wm-l .wm-q small{display:block;font-weight:400;font-size:11px;color:#7a8699}',
      '.wm-vacio{padding:30px 10px;text-align:center;color:#4a5568;font-size:14px}',
      '.wm-nota{font-size:11.5px;color:#7a8699;text-align:center;margin-top:12px}',
      /* situación de pista en el celular: solo consulta */
      'body.mobile #pistaGuardar{display:none !important}',
      'body.mobile .pi-card:has(#pistaAplicar),body.mobile .pi-card:has(#pistaCat),body.mobile .pi-card:has(#pistaEjes),body.mobile .pi-card.pi-alta{display:none}',
      'body.mobile .pi-card:has(#pistaCards)>.pi-note{display:none}',
      'body.mobile #pistaCards input,body.mobile #pistaCards select{pointer-events:none;border-color:transparent !important;background:transparent !important;-webkit-appearance:none;appearance:none;color:inherit}',
      'body.mobile #pistaCards input[type=checkbox]{display:none}',
      'body.mobile #pistaCards .l3 label{display:none}',
      'body.mobile #pistaCards .l3 label:has(input[data-c]:not(:placeholder-shown)),body.mobile #pistaCards .l3 label:has(input:checked){display:inline-flex;align-items:center;gap:4px}',
      'body.mobile #pistaCards .l3 label:has(input:checked){color:#b7791f;font-weight:700}',
      'body.mobile #pistaCards input.txt:placeholder-shown{display:none}',
      'body.mobile #pistaCards .l3:not(:has(input:checked)):not(:has(input[data-c]:not(:placeholder-shown))):not(:has(input.txt:not(:placeholder-shown))){display:none}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ----------------------------------------------------------- 1 · menú */
  function montarMenu() {
    var m = $('#fnMenu'), b = $('#fnBtn'); if (!m || !b) return;
    function abrir(on) { m.classList.toggle('open', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); }
    b.addEventListener('click', function (e) { e.stopPropagation(); abrir(!m.classList.contains('open')); });
    // al elegir una función se cierra (su propio onclick sigue funcionando)
    $('#fnPop').addEventListener('click', function (e) { if (e.target.closest('.fnit')) setTimeout(function () { abrir(false); }, 0); });
    document.addEventListener('click', function (e) { if (!m.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') abrir(false); });
    // punto naranja en el botón si hay una función prendida (p. ej. reprogramación por producción)
    function marcar() { m.classList.toggle('hay-activo', !!m.querySelector('.fnit.active')); }
    new MutationObserver(marcar).observe($('#fnPop'), { attributes: true, subtree: true, attributeFilter: ['class'] });
    marcar();
  }

  /* --------------------------------------- 2 · plan semanal en el celular */
  var WM = { idx: null, filtro: '' };
  function semanas() { return leer('ALLWEEKS') || []; }
  function rangoSemana(wk) { var f = leer('isoWeekRange'); try { return f ? f(wk) : wk; } catch (e) { return wk; } }

  function renderMovil() {
    if (!document.body.classList.contains('mobile')) return;
    var v = $('#v-weekly'); if (!v) return;
    var box = $('#wkMovil');
    if (!box) { box = document.createElement('div'); box.id = 'wkMovil'; v.insertBefore(box, v.firstChild); }
    var ws = semanas();
    if (WM.idx === null || WM.idx >= ws.length) { var d = leer('weeklyIdx'); WM.idx = typeof d === 'number' ? d : 0; }
    var wk = ws[WM.idx];
    var W = leer('WEEKLY') || [], byId = leer('byId') || {}, va = leer('vaAlPlanSemanal'), cmp = leer('cmpItemId');
    // una fila por ítem (suma lo previsto si hay más de una fila del mismo ítem en la semana)
    var por = {};
    W.forEach(function (w) {
      if (w.week !== wk) return;
      if (w._man && w.cant_prevista === 0) return;   // semana quitada a mano
      var it = byId[w.item_id];
      if (it && va && !va(it)) return;
      var k = String(w.item_id);
      var r = por[k] = por[k] || { id: k, desc: it ? (it.desc || '') : '', um: w.um || (it && it.um) || '', act: [], frentes: [], prev: 0, hay: false };
      if (w.actividad && r.act.indexOf(w.actividad) < 0 && w.actividad !== r.desc) r.act.push(w.actividad);
      if (w.frente && r.frentes.indexOf(w.frente) < 0) r.frentes.push(w.frente);
      if (w.cant_prevista !== null && w.cant_prevista !== undefined && w.cant_prevista !== '') { r.prev += Number(w.cant_prevista) || 0; r.hay = true; }
    });
    var filas = Object.keys(por).map(function (k) { return por[k]; });
    filas.sort(function (a, b) { return cmp ? cmp(a.id, b.id) : String(a.id).localeCompare(String(b.id), 'es', { numeric: true }); });
    var f = WM.filtro.trim().toLowerCase();
    var vis = f ? filas.filter(function (r) { return (r.id + ' ' + r.desc + ' ' + r.act.join(' ') + ' ' + r.frentes.join(' ')).toLowerCase().indexOf(f) >= 0; }) : filas;
    var wkTxt = wk ? wk.split('-')[1] + ' · ' + wk.split('-')[0] : '—';
    var html = '<div class="wm-nav"><button id="wmPrev" aria-label="Semana anterior"' + (WM.idx <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<div class="wm-sem" id="wmSem"><b>' + esc(wk ? rangoSemana(wk) : 'Sin semanas') + '</b><span>' + esc(wkTxt) + ' · tocá para elegir</span></div>' +
      '<select id="wmSel">' + ws.map(function (w, i) { return '<option value="' + i + '"' + (i === WM.idx ? ' selected' : '') + '>' + esc(rangoSemana(w)) + ' (' + esc(w.split('-')[1] || '') + ')</option>'; }).join('') + '</select>' +
      '<button id="wmNext" aria-label="Semana siguiente"' + (WM.idx >= ws.length - 1 ? ' disabled' : '') + '>›</button></div>' +
      '<div class="wm-res"><div><span>Ítems previstos</span><b>' + filas.length + '</b></div>' +
      '<div><span>Con cantidad</span><b>' + filas.filter(function (r) { return r.hay; }).length + '</b></div></div>' +
      (filas.length > 6 ? '<input type="search" class="wm-filtro" id="wmFiltro" placeholder="Buscar ítem, actividad o frente…" value="' + esc(WM.filtro) + '">' : '');
    if (!filas.length) html += '<div class="wm-vacio">No hay actividades previstas para esta semana.</div>';
    else if (!vis.length) html += '<div class="wm-vacio">Nada coincide con la búsqueda.</div>';
    else html += '<ul class="wm-l">' + vis.map(function (r) {
      var sub = r.act.concat(r.frentes.length ? ['Frente: ' + r.frentes.join(', ')] : []).join(' · ');
      return '<li><span class="wm-id">' + esc(r.id) + '</span><span class="wm-tx">' + esc(r.desc || r.act[0] || '') +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<span class="wm-q">' + (r.hay ? fq(r.prev) : '–') + '<small>' + esc(r.um) + '</small></span></li>';
    }).join('') + '</ul>';
    html += '<div class="wm-nota">Vista de consulta. El plan semanal se edita desde la computadora.</div>';
    box.innerHTML = html;
    function ir(i) { WM.idx = Math.max(0, Math.min(ws.length - 1, i)); renderMovil(); }
    $('#wmPrev').onclick = function () { ir(WM.idx - 1); };
    $('#wmNext').onclick = function () { ir(WM.idx + 1); };
    var sel = $('#wmSel');
    $('#wmSem').onclick = function () { try { sel.showPicker(); } catch (e) { sel.focus(); sel.click(); } };
    sel.onchange = function () { ir(+sel.value); };
    var fl = $('#wmFiltro');
    if (fl) fl.oninput = function () { WM.filtro = fl.value; var p = fl.selectionStart; renderMovil(); var f2 = $('#wmFiltro'); if (f2) { f2.focus(); f2.setSelectionRange(p, p); } };
  }

  function montarMovil() {
    var mn = $('#mobinav');
    if (mn && !mn.querySelector('button[data-v="weekly"]')) {
      var b = document.createElement('button');
      b.setAttribute('data-v', 'weekly');
      b.innerHTML = '<span class="ic">▦</span><span class="tx">Plan</span>';
      var ref = mn.querySelector('button[data-v="report"]');
      mn.insertBefore(b, ref ? ref.nextSibling : null);
    }
    var tabs = $('#tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b && b.dataset.v === 'weekly') setTimeout(renderMovil, 0);
    });
  }

  /* --------------------------------------- 4 · roles de campo
     'transporte' solo ve Transporte; 'produccion' solo ve Producción. La
     base ya no les deja escribir otra cosa; acá se les ordena la pantalla. */
  var PESTANA_ROL = { transporte: 'transporte', produccion: 'prod' };
  function aplicarRol(r) {
    ROL_ACTUAL = r;
    var v = PESTANA_ROL[r];
    document.body.classList.toggle('rol-campo', !!v);
    Object.keys(PESTANA_ROL).forEach(function (k) { document.body.classList.toggle('rol-' + k, k === r); });
    if (!v) return;
    asegurarPestana();
  }
  // si la app abre otra vista (p. ej. Producción al arrancar en el celular), volver a la del rol
  var ROL_ACTUAL = '';
  function asegurarPestana() {
    var v = PESTANA_ROL[ROL_ACTUAL]; if (!v) return;
    var t = document.querySelector('#tabs button[data-v="' + v + '"]');
    var vista = document.getElementById('v-' + v);
    if (t && (!t.classList.contains('on') || (vista && !vista.classList.contains('on')))) t.click();
  }
  function montarRoles() {
    var css = document.createElement('style');
    css.textContent = Object.keys(PESTANA_ROL).map(function (k) {
      var v = PESTANA_ROL[k];
      return 'body.rol-' + k + ' #tabs button:not([data-v="' + v + '"]),body.rol-' + k + ' #mobinav button:not([data-v="' + v + '"]){display:none !important}';
    }).join('\n') + '\nbody.rol-campo .kpistrip,body.rol-campo .expbtn,body.rol-campo .savebtn,body.rol-campo #fnMenu{display:none !important}' +
      '\nbody.rol-campo.mobile main{margin-bottom:0}body.rol-campo .mobinav{display:none !important}';
    document.head.appendChild(css);
    var chip = document.getElementById('userChip'); if (!chip) return;
    var leer = function () { var m = /\brole-([\w-]+)/.exec(chip.className || ''); aplicarRol(m ? m[1] : ''); };
    new MutationObserver(leer).observe(chip, { attributes: true, attributeFilter: ['class'] });
    var tabs = document.getElementById('tabs');
    if (tabs) new MutationObserver(function () { if (ROL_ACTUAL) setTimeout(asegurarPestana, 0); })
      .observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class'] });
    leer();
  }

  function init() { estilos(); montarMenu(); montarMovil(); montarRoles(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  global.UIExtra = {
    renderPlanMovil: renderMovil,
    // al cambiar de obra la semana elegida vuelve a la actual
    reset: function () { WM.idx = null; WM.filtro = ''; var box = $('#wkMovil'); if (box) box.innerHTML = ''; }
  };
})(window);
