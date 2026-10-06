/* =========================================================================
 * visor.js — Visor ampliado de fotos y PDF sin descargar · v20261006c
 *
 *   Visor.abrir(lista, idx)
 *     lista: [{ url | obtenerUrl(): Promise<url>, nombre, mime }]
 *   - Fotos: ajustadas a la pantalla; tocar/clic alterna tamaño real.
 *   - PDF: el visor de PDF del navegador dentro de la página.
 *   - Flechas / deslizar para pasar, Esc o ✕ para cerrar, ⤢ abre en otra
 *     pestaña (ahí se puede descargar si hace falta).
 *   Además: cualquier <img data-visor> o elemento [data-visor-url] abre el
 *   visor con sus "hermanos" del mismo contenedor [data-visor-grupo].
 * ========================================================================= */
(function (global) {
  'use strict';
  var L = [], I = 0, nodo = null, x0 = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function esPdf(x) { return /pdf/i.test(x.mime || '') || /\.pdf(\?|$)/i.test(x.nombre || x.url || ''); }
  function esImg(x) { return /^image\//i.test(x.mime || '') || /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(x.nombre || x.url || ''); }

  function estilos() {
    if (document.getElementById('visorCss')) return;
    var st = document.createElement('style'); st.id = 'visorCss';
    st.textContent = [
      '.vz{position:fixed;inset:0;z-index:2000;background:rgba(10,16,28,.94);display:flex;flex-direction:column;color:#fff}',
      '.vz-h{display:flex;align-items:center;gap:10px;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top));font-size:14px}',
      '.vz-h .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vz-h small{opacity:.7;margin-left:6px}',
      '.vz-b{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:9px;min-width:40px;height:38px;font-size:18px;cursor:pointer;padding:0 10px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}',
      '.vz-b:hover{background:rgba(255,255,255,.22)}',
      '.vz-c{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:auto}',
      '.vz-c img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;user-select:none}',
      '.vz-c img.real{max-width:none;max-height:none;cursor:zoom-out}',
      '.vz-c iframe{width:100%;height:100%;border:0;background:#fff}',
      '.vz-n{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:64px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-size:28px;cursor:pointer}',
      '.vz-n.p{left:8px}.vz-n.s{right:8px}',
      '.vz-msg{padding:30px;text-align:center;opacity:.85;line-height:1.5}',
      '.vz-msg a{color:#ffd59a}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function cerrar() { if (nodo) { nodo.remove(); nodo = null; document.removeEventListener('keydown', tecla); } }
  function tecla(e) {
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowRight') ir(1);
    else if (e.key === 'ArrowLeft') ir(-1);
  }
  function ir(p) { if (L.length < 2) return; I = (I + p + L.length) % L.length; pintar(); }
  function url(x) {
    if (x.url) return Promise.resolve(x.url);
    if (typeof x.obtenerUrl === 'function') return x.obtenerUrl().then(function (u) { x.url = u; return u; });
    return Promise.reject(new Error('sin dirección'));
  }
  function pintar() {
    var x = L[I]; if (!x || !nodo) return;
    nodo.querySelector('.t').innerHTML = esc(x.nombre || 'Archivo') + (L.length > 1 ? '<small>' + (I + 1) + ' de ' + L.length + '</small>' : '');
    var c = nodo.querySelector('.vz-c'), ab = nodo.querySelector('.vz-ab');
    c.innerHTML = '<div class="vz-msg">Cargando…</div>';
    ab.removeAttribute('href');
    url(x).then(function (u) {
      if (L[I] !== x) return;
      ab.href = u;
      if (esImg(x)) {
        c.innerHTML = '<img alt="">';
        var img = c.querySelector('img');
        img.onerror = function () { c.innerHTML = '<div class="vz-msg">No se pudo mostrar la imagen. <a href="' + esc(u) + '" target="_blank" rel="noopener">Abrir aparte</a></div>'; };
        img.onclick = function () { img.classList.toggle('real'); };
        img.src = u;
      } else if (esPdf(x)) {
        c.innerHTML = '<iframe title="' + esc(x.nombre || 'PDF') + '" src="' + esc(u) + '#view=FitH"></iframe>';
      } else {
        c.innerHTML = '<div class="vz-msg">Este tipo de archivo no se puede previsualizar acá.<br><a href="' + esc(u) + '" target="_blank" rel="noopener">Abrir / descargar</a></div>';
      }
    }).catch(function (e) { c.innerHTML = '<div class="vz-msg">No se pudo abrir: ' + esc(e.message || e) + '</div>'; });
    var n = nodo.querySelectorAll('.vz-n'); for (var i = 0; i < n.length; i++) n[i].style.display = L.length > 1 ? '' : 'none';
  }
  function abrir(lista, idx) {
    L = (lista || []).filter(Boolean); I = Math.max(0, Math.min(L.length - 1, idx || 0));
    if (!L.length) return;
    estilos(); cerrar();
    nodo = document.createElement('div'); nodo.className = 'vz';
    nodo.innerHTML = '<div class="vz-h"><span class="t"></span><a class="vz-b vz-ab" target="_blank" rel="noopener" title="Abrir en otra pestaña">⤢</a>' +
      '<button class="vz-b vz-x" title="Cerrar (Esc)">✕</button></div>' +
      '<div class="vz-c"></div><button class="vz-n p" title="Anterior">‹</button><button class="vz-n s" title="Siguiente">›</button>';
    document.body.appendChild(nodo);
    nodo.querySelector('.vz-x').onclick = cerrar;
    nodo.querySelector('.vz-n.p').onclick = function () { ir(-1); };
    nodo.querySelector('.vz-n.s').onclick = function () { ir(1); };
    nodo.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    nodo.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      var img = nodo.querySelector('.vz-c img.real'); if (img) return;
      if (Math.abs(dx) > 60) ir(dx < 0 ? 1 : -1);
    });
    document.addEventListener('keydown', tecla);
    pintar();
  }

  // delegación: <img data-visor> / [data-visor-url] dentro de [data-visor-grupo]
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-visor],[data-visor-url]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    var g = t.closest('[data-visor-grupo]') || t.parentNode;
    var els = Array.prototype.slice.call(g.querySelectorAll('[data-visor],[data-visor-url]'));
    var lista = els.map(function (el) {
      return { url: el.getAttribute('data-visor-url') || el.getAttribute('src') || el.getAttribute('href'),
               nombre: el.getAttribute('data-visor-nombre') || el.getAttribute('alt') || el.getAttribute('title') || '',
               mime: el.getAttribute('data-visor-mime') || '' };
    });
    abrir(lista, els.indexOf(t));
  }, true);

  global.Visor = { abrir: abrir, cerrar: cerrar };
})(window);
