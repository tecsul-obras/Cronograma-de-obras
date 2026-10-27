// ══════════════════════════════════════════════════════════════════
// multisel.js — filtros con selección múltiple y buscador (v20261027a)
//
// Cualquier <select class="ms"> pasa a ser un botón que abre una lista con
// casillas (se pueden marcar varios) y un buscador por letras. Un
// <select class="ms-uno"> abre la misma lista con buscador pero elige uno
// solo (para los selectores que cargan datos de UNA obra, por ejemplo).
//
// El <select> original queda escondido y sigue siendo la fuente de verdad:
// cada cambio dispara su evento "change" (los onchange de siempre siguen
// andando). Para leer lo elegido:
//   MS.valores(sel)     → ['A','B']  ([] = todos)
//   MS.ok(sel, valor)   → true si no hay nada elegido o el valor está elegido
//   MS.poner(sel, vals) → elige esos valores (array o texto)
// `sel` puede ser el elemento o su id.
//
// Se aplica solo: también a los <select class="ms"> que se dibujan después
// (las bandejas que rearman su HTML). La opción con value="" es "Todos".
// ══════════════════════════════════════════════════════════════════
(function () {
  if (window.MS) return;

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Devuelve el <select> ya mejorado (si se acaba de dibujar, se mejora en el momento)
  const el = (x) => {
    const s = typeof x === 'string' ? document.getElementById(x) : x;
    if (s && !s._ms && s.tagName === 'SELECT' && s.matches('.ms, .ms-uno')) mejorar(s);
    return s;
  };
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NATIVO = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const esMulti = (s) => s.classList.contains('ms');

  function valores(x) {
    const s = el(x);
    if (!s) return [];
    if (!s._ms) return s.value ? [s.value] : [];
    return [...s.options].filter(o => o.selected && o.value !== '').map(o => o.value);
  }
  function ok(x, v) {
    const l = valores(x);
    return !l.length || l.includes(v === null || v === undefined ? '' : String(v));
  }
  function poner(x, vals) {
    const s = el(x);
    if (!s) return;
    const l = (Array.isArray(vals) ? vals : (vals === null || vals === undefined || vals === '' ? [] : [vals])).map(String);
    if (!s._ms || !esMulti(s)) { NATIVO.set.call(s, l[0] ?? ''); refrescar(s); return; }
    let alguno = false;
    [...s.options].forEach(o => { o.selected = o.value !== '' && l.includes(o.value); alguno = alguno || o.selected; });
    if (!alguno) { const t = [...s.options].find(o => o.value === ''); if (t) t.selected = true; }
    refrescar(s);
  }
  function textoDe(s) {
    const elegidas = [...s.options].filter(o => o.selected && (o.value !== '' || !esMulti(s)));
    if (!elegidas.length || (elegidas.length === 1 && elegidas[0].value === '' && esMulti(s))) {
      const t = [...s.options].find(o => o.value === '');
      return { txt: t ? t.text : 'Todos', n: 0 };
    }
    if (elegidas.length === 1) return { txt: elegidas[0].text, n: 1 };
    const juntos = elegidas.map(o => o.text).join(', ');
    return { txt: juntos.length <= 28 ? juntos : `${elegidas.length} elegidos`, n: elegidas.length };
  }
  function refrescar(s) {
    if (!s || !s._msBtn) return;
    const { txt, n } = textoDe(s);
    s._msBtn.querySelector('span').textContent = txt;
    s._msBtn.classList.toggle('con', n > 0 && esMulti(s));
    s._msBtn.title = n > 1 ? [...s.options].filter(o => o.selected && o.value !== '').map(o => o.text).join('\n') : txt;
    s._msBtn.disabled = s.disabled;
  }

  function mejorar(s) {
    if (s._ms || !s.isConnected) return;
    s._ms = true;
    if (esMulti(s)) {
      // Al pasar a múltiple se conserva lo elegido. Si el HTML trae varias
      // opciones con "selected" (un select simple se queda solo con la última),
      // valen todas.
      const v = NATIVO.get.call(s);
      const marcadas = [...s.options].filter(o => o.defaultSelected);
      s.multiple = true;
      [...s.options].forEach(o => { o.selected = marcadas.length > 1 ? o.defaultSelected : o.value === v; });
    }
    s.style.display = 'none';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ms-btn' + (s.classList.contains('btn-filtro') ? ' btn-filtro' : '');
    if (s.style.maxWidth) b.style.maxWidth = s.style.maxWidth;
    b.innerHTML = '<span></span><i>▾</i>';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrir(s); });
    s.after(b);
    s._msBtn = b;
    // Si el código pone .value a mano, el botón se entera
    Object.defineProperty(s, 'value', {
      configurable: true,
      get() { return NATIVO.get.call(s); },
      set(v) { NATIVO.set.call(s, v); refrescar(s); }
    });
    refrescar(s);
  }

  // ── La lista ──
  let abierto = null;   // { s, caja }
  function cerrar() {
    if (!abierto) return;
    abierto.caja.remove();
    document.removeEventListener('mousedown', fuera, true);
    document.removeEventListener('touchstart', fuera, true);
    window.removeEventListener('resize', cerrar);
    abierto = null;
  }
  function fuera(e) {
    if (abierto && !abierto.caja.contains(e.target) && e.target !== abierto.s._msBtn && !abierto.s._msBtn.contains(e.target)) cerrar();
  }
  function avisar(s) {
    delete s._pend;   // lo eligió la persona: manda sobre lo que se restauró
    refrescar(s);
    const q = abierto && abierto.s === s ? (abierto.caja.querySelector('.ms-buscar') || {}).value : null;
    const scroll = abierto && abierto.s === s ? abierto.caja.querySelector('.ms-lista').scrollTop : 0;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    // Si la pantalla se redibujó con el cambio (el <select> ya no está), la
    // lista se vuelve a abrir sobre el nuevo para seguir marcando.
    if (q !== null && !s.isConnected && esMulti(s)) {
      const nuevo = (s.id && document.getElementById(s.id))
        || [...document.querySelectorAll('select.ms')].find(x => x.getAttribute('onchange') === s.getAttribute('onchange'));
      cerrar();
      if (nuevo) {
        mejorar(nuevo);
        abrir(nuevo, q);
        if (abierto) abierto.caja.querySelector('.ms-lista').scrollTop = scroll;
      }
    }
  }

  function abrir(s, qInicial) {
    if (abierto && abierto.s === s) return cerrar();
    cerrar();
    if (s.disabled) return;
    const multi = esMulti(s);
    const caja = document.createElement('div');
    caja.className = 'ms-caja';
    const opciones = [...s.options].filter(o => !multi || o.value !== '');
    const muchas = opciones.length > 7;
    caja.innerHTML = `
      ${muchas || multi ? `<input type="search" class="ms-buscar" placeholder="Buscar…" autocomplete="off">` : ''}
      ${multi ? `<div class="ms-acc"><button type="button" data-a="todos">Todos</button><button type="button" data-a="vis">Marcar visibles</button><button type="button" data-a="ok">Listo</button></div>` : ''}
      <div class="ms-lista"></div>`;
    document.body.appendChild(caja);
    const lista = caja.querySelector('.ms-lista');
    const buscar = caja.querySelector('.ms-buscar');
    if (buscar && qInicial) buscar.value = qInicial;

    const pintar = () => {
      const q = buscar ? norm(buscar.value).trim() : '';
      const partes = q ? q.split(/\s+/) : [];
      const vis = opciones.filter(o => !partes.length || partes.every(p => norm(o.text + ' ' + o.value).includes(p)));
      lista.innerHTML = vis.length ? vis.map(o => {
        const i = [...s.options].indexOf(o);
        return `<label class="ms-op${o.selected && (multi || true) ? ' on' : ''}" data-i="${i}">
          ${multi ? `<input type="checkbox" ${o.selected ? 'checked' : ''}>` : ''}<span>${escH(o.text) || '&nbsp;'}</span></label>`;
      }).join('') : '<div class="ms-vacio">Nada coincide</div>';
      caja._vis = vis;
    };
    pintar();

    lista.addEventListener('click', (e) => {
      const lab = e.target.closest('.ms-op');
      if (!lab) return;
      e.preventDefault();
      const o = s.options[+lab.dataset.i];
      if (!o) return;
      if (multi) {
        o.selected = !o.selected;
        const todos = [...s.options].find(x => x.value === '');
        const alguno = [...s.options].some(x => x.selected && x.value !== '');
        if (todos) todos.selected = !alguno;
        pintar();
        avisar(s);
      } else {
        NATIVO.set.call(s, o.value);
        cerrar();
        avisar(s);
      }
    });
    if (multi) {
      caja.querySelector('.ms-acc').addEventListener('click', (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        if (a === 'ok') return cerrar();
        if (a === 'todos') poner(s, []);
        if (a === 'vis') poner(s, [...new Set([...valores(s), ...(caja._vis || []).map(o => o.value)])]);
        pintar();
        avisar(s);
      });
    }
    if (buscar) {
      buscar.addEventListener('input', pintar);
      buscar.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cerrar();
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = caja._vis || [];
          if (!multi && v.length) { NATIVO.set.call(s, v[0].value); cerrar(); avisar(s); }
          else if (multi && v.length === 1) { v[0].selected = true; const t = [...s.options].find(x => x.value === ''); if (t) t.selected = false; pintar(); avisar(s); }
        }
      });
    }
    caja.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });

    // Posición: debajo del botón (en el celular, abajo a lo ancho)
    const r = s._msBtn.getBoundingClientRect();
    if (window.innerWidth < 600) {
      caja.classList.add('abajo');
    } else {
      const ancho = Math.max(r.width, 240);
      caja.style.width = ancho + 'px';
      caja.style.left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
      const espacioAbajo = window.innerHeight - r.bottom;
      if (espacioAbajo < 260 && r.top > espacioAbajo) {
        caja.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        caja.style.maxHeight = Math.min(420, r.top - 12) + 'px';
      } else {
        caja.style.top = (r.bottom + 4) + 'px';
        caja.style.maxHeight = Math.min(420, espacioAbajo - 12) + 'px';
      }
    }
    abierto = { s, caja };
    setTimeout(() => {
      document.addEventListener('mousedown', fuera, true);
      document.addEventListener('touchstart', fuera, true);
      window.addEventListener('resize', cerrar);
    }, 0);
    // En el teclado de celular no se abre solo (tapa la lista)
    if (buscar && !matchMedia('(pointer: coarse)').matches) buscar.focus();
  }

  // ── Aplicar solo a todo lo que aparezca ──
  function barrer(raiz) {
    (raiz || document).querySelectorAll('select.ms, select.ms-uno').forEach(mejorar);
  }
  const obs = new MutationObserver((muts) => {
    const tocados = new Set();
    for (const m of muts) {
      if (m.target && m.target.tagName === 'SELECT' && m.target._ms) tocados.add(m.target);
      else if (m.target && m.target.parentElement && m.target.parentElement.tagName === 'SELECT' && m.target.parentElement._ms) tocados.add(m.target.parentElement);
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SELECT') { if (n.matches('.ms, .ms-uno')) mejorar(n); }
        else if (n.querySelector && n.tagName !== 'OPTION') barrer(n);
      });
      m.removedNodes.forEach(n => { if (abierto && n.nodeType === 1 && (n === abierto.s || (n.contains && n.contains(abierto.s)))) cerrar(); });
    }
    tocados.forEach(refrescar);
  });
  function arrancar() {
    barrer(document);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  // ── Estilos ──
  const css = document.createElement('style');
  css.textContent = `
    .ms-btn { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border: 1.5px solid var(--gris-borde, #d6dbe4); border-radius: 7px;
      font: inherit; font-size: calc(13px*var(--fs,1)); background: var(--blanco, #fff); color: inherit; cursor: pointer;
      min-width: 120px; max-width: 100%; text-align: left; }
    .ms-btn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .ms-btn i { font-style: normal; font-size: calc(10px*var(--fs,1)); opacity: .6; }
    .ms-btn.con { border-color: var(--azul-medio, #2c4a8a); background: #eef2ff; font-weight: 600; }
    .ms-btn:disabled { opacity: .6; cursor: default; }
    .filtro .ms-btn { width: 100%; }
    .ms-caja { position: fixed; z-index: 10050; background: #fff; border: 1px solid #cfd6e2; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(20,30,60,.22); display: flex; flex-direction: column; overflow: hidden;
      font-size: calc(13.5px*var(--fs,1)); color: #1a2744; }
    .ms-caja.abajo { left: 8px; right: 8px; bottom: 8px; max-height: 70vh; }
    .ms-buscar { margin: 8px 8px 4px; padding: 9px 10px; border: 1.5px solid #d6dbe4; border-radius: 7px;
      font-size: calc(14px*var(--fs,1)); outline: none; }
    .ms-buscar:focus { border-color: var(--azul-medio, #2c4a8a); }
    .ms-acc { display: flex; gap: 6px; padding: 2px 8px 6px; flex-wrap: wrap; }
    .ms-acc button { border: 0; background: #eef1f6; border-radius: 6px; padding: 5px 9px; font-size: calc(12px*var(--fs,1));
      font-weight: 600; color: #2c4a8a; cursor: pointer; }
    .ms-acc button[data-a="ok"] { margin-left: auto; background: var(--azul-medio, #2c4a8a); color: #fff; }
    .ms-lista { overflow-y: auto; padding: 0 4px 6px; flex: 1; min-height: 40px; }
    .ms-op { display: flex; align-items: center; gap: 8px; padding: 8px 8px; border-radius: 6px; cursor: pointer;
      line-height: 1.25; user-select: none; }
    .ms-op:hover { background: #f1f4f9; }
    .ms-op.on { background: #e8eeff; font-weight: 600; }
    .ms-op input { width: 16px; height: 16px; margin: 0; flex: none; pointer-events: none; }
    .ms-vacio { padding: 12px; color: #6b7487; text-align: center; }
  `;
  document.head.appendChild(css);

  // Lo guardado puede ser un array (ahora) o un texto (antes de la v20261027a)
  const restaurar = (x, v) => { if (v !== undefined && v !== null) poner(x, Array.isArray(v) ? v : (v ? [v] : [])); };
  window.MS = { valores, ok, poner, restaurar, refrescar, mejorar, cerrar };
})();
