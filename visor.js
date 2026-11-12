/* =========================================================================
 * visor.js — Visor ampliado de fotos y PDF sin descargar · v20261109b
 *
 *   Visor.abrir(lista, idx)
 *     lista: [{ url | obtenerUrl(): Promise<url>, nombre, mime }]
 *   - Fotos: ajustadas a la pantalla; tocar/clic alterna tamaño real.
 *   - PDF: el visor de PDF del navegador dentro de la página.
 *   - Flechas / deslizar para pasar, Esc o ✕ para cerrar, ⤢ abre en otra
 *     pestaña (ahí se puede descargar si hace falta).
 *   Además: cualquier <img data-visor> o elemento [data-visor-url] abre el
 *   visor con sus "hermanos" del mismo contenedor [data-visor-grupo].
 *
 * v20261109a (SQL 112) — fotos en todas las pestañas:
 *   · <img data-vfoto="VALOR" data-bucket="partes" data-visor-nombre="…">
 *     VALOR puede ser una ruta de Storage, una URL de JotForm, una URL
 *     pública o un link de Drive (las fotos pasan a la unidad compartida
 *     «Fotos Tecsul», que es privada: se piden a la Edge Function «foto»).
 *     La miniatura se carga sola (también si la imagen se agrega después)
 *     y al tocarla se abre el visor en grande con las demás del grupo.
 *   · Visor.galeria(valores, bucket, clase) arma esas miniaturas.
 *   · Visor.resolver(valor, {bucket, w}) → Promise<url para mostrar>.
 *   · Tocar una foto dentro de un enlace (<a><img></a>) abre el visor en
 *     vez de ir al enlace (las de JotForm se descargaban).
 * v20261109b — VALOR = 'vencida' (foto borrada por tener más de un año,
 *     o que JotForm ya no tenía): se ve un recuadro gris «Foto vencida»,
 *     sin visor. Visor.vencida(valor) dice si lo es.
 * ========================================================================= */
(function (global) {
  'use strict';
  var L = [], I = 0, nodo = null, x0 = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function esPdf(x) { return /pdf/i.test(x.mime || '') || /\.pdf(\?|$)/i.test(x.nombre || x.url || ''); }
  function esImg(x) { return /^image\//i.test(x.mime || '') || /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(x.nombre || x.url || ''); }

  /* ---------------- de dónde sale cada foto ---------------- */
  function cliente() {
    try { if (global.ObraAPI && typeof global.ObraAPI._sb === 'function' && global.ObraAPI._sb()) return global.ObraAPI._sb(); } catch (e) {}
    try { /* global sb */ if (typeof sb !== 'undefined' && sb) return sb; } catch (e) {}
    return global.__visorSb || null;
  }
  function driveId(u) {
    var m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{10,})/.exec(String(u || ''));
    return m ? m[1] : null;
  }
  function vencida(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'vencida'; }
  var IMG_VENCIDA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">' +
    '<rect width="160" height="120" fill="#eceff4"/>' +
    '<g fill="none" stroke="#9aa3b2" stroke-width="3"><rect x="58" y="26" width="44" height="34" rx="5"/><circle cx="80" cy="43" r="9"/><path d="M52 66 108 22"/></g>' +
    '<text x="80" y="90" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" font-size="15" font-weight="600" fill="#6b7383">Foto vencida</text></svg>');
  var cache = {};          // clave → Promise<url>
  function fotoDrive(id, w) {
    var c = cliente();
    if (!c) return Promise.reject(new Error('sin sesión'));
    var base = c.supabaseUrl || c.restUrl && c.restUrl.replace(/\/rest\/v1\/?$/, '') || '';
    return c.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      if (!tok) throw new Error('Iniciá sesión para ver la foto');
      return fetch(base + '/functions/v1/foto?id=' + encodeURIComponent(id) + '&w=' + w, {
        headers: { Authorization: 'Bearer ' + tok, apikey: c.supabaseKey || '' }
      });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('Error ' + r.status)); });
      return r.blob();
    }).then(function (b) { return URL.createObjectURL(b); });
  }
  function firmada(bucket, ruta) {
    var c = cliente();
    if (!c || !bucket) return Promise.reject(new Error('sin sesión'));
    return c.storage.from(bucket).createSignedUrl(ruta, 3600).then(function (r) {
      if (r.error || !r.data) throw (r.error || new Error('No se pudo abrir la foto'));
      return r.data.signedUrl;
    });
  }
  // Devuelve una dirección que el navegador puede mostrar
  function resolver(valor, op) {
    op = op || {};
    var v = String(valor || '').trim();
    if (!v) return Promise.reject(new Error('sin foto'));
    if (vencida(v)) { var ev = new Error('Foto vencida: se borró por tener más de un año.'); ev.vencida = true; return Promise.reject(ev); }
    if (/^(data|blob):/i.test(v)) return Promise.resolve(v);
    var id = driveId(v), w = op.w || 1600;
    var k = (id ? 'd:' + id + ':' + w : (/^https?:/i.test(v) ? 'u:' + v : 's:' + (op.bucket || '') + ':' + v));
    if (cache[k]) return cache[k];
    var p = id ? fotoDrive(id, w).catch(function (e) {
          // no es de la unidad «Fotos Tecsul» o la función no está: Drive la muestra a quien tenga acceso
          if (/sesi[oó]n/i.test(e && e.message || '')) throw e;
          return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + w;
        })
      : /^https?:/i.test(v) ? Promise.resolve(v)
      : firmada(op.bucket, v);
    cache[k] = p;
    p.catch(function () { delete cache[k]; });
    return p;
  }

  /* ---------------- miniaturas ---------------- */
  // <img data-vfoto> sin cargar → se pide la miniatura (también las que se agregan después)
  function cargarMini(img) {
    resolver(img.getAttribute('data-vfoto'), { bucket: img.getAttribute('data-bucket'), w: Number(img.getAttribute('data-w')) || 400 })
      .then(function (u) { img.src = u; img.classList.remove('vz-rota'); })
      .catch(function (e) {
        img.removeAttribute('src'); img.alt = 'No se pudo cargar'; img.classList.add('vz-rota');
        img.title = (e && e.message) || 'No se pudo cargar la foto';
      });
  }
  // se piden recién cuando se van a ver (tablas con cientos de fotos)
  var io = global.IntersectionObserver ? new IntersectionObserver(function (ents) {
    ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); cargarMini(en.target); } });
  }, { rootMargin: '300px' }) : null;
  function pintar(raiz) {
    var r = raiz || document;
    if (!r.querySelectorAll) return;
    Array.prototype.forEach.call(r.querySelectorAll('img[data-vfoto]:not([data-vz-ok])'), function (img) {
      img.setAttribute('data-vz-ok', '1');
      if (vencida(img.getAttribute('data-vfoto'))) {
        img.src = IMG_VENCIDA; img.alt = 'Foto vencida'; img.classList.add('vz-vencida');
        img.title = 'Foto vencida: se borró por tener más de un año';
        return;
      }
      if (!img.style.cursor) img.style.cursor = 'zoom-in';
      if (!img.title) img.title = 'Ver en grande';
      if (io) io.observe(img); else cargarMini(img);
    });
  }
  function galeria(valores, bucket, clase) {
    var l = (valores || []).filter(Boolean);
    if (!l.length) return '';
    return '<div class="' + esc(clase || 'vz-galeria') + '" data-visor-grupo>' + l.map(function (v, i) {
      return '<img data-vfoto="' + esc(v) + '" data-bucket="' + esc(bucket || '') + '" loading="lazy" alt="Foto ' + (i + 1) + '">';
    }).join('') + '</div>';
  }

  function estilos() {
    if (document.getElementById('visorCss')) return;
    var st = document.createElement('style'); st.id = 'visorCss';
    st.textContent = [
      '.vz{position:fixed;inset:0;z-index:2000;background:rgba(10,16,28,.94);display:flex;flex-direction:column;color:#fff}',
      '.vz-h{display:flex;align-items:center;gap:10px;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top));font-size:calc(14px*var(--fs,1))}',
      '.vz-h .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vz-h small{opacity:.7;margin-left:6px}',
      '.vz-b{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:9px;min-width:40px;height:38px;font-size:calc(18px*var(--fs,1));cursor:pointer;padding:0 10px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}',
      '.vz-b:hover{background:rgba(255,255,255,.22)}',
      '.vz-c{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:auto}',
      '.vz-c img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;user-select:none}',
      '.vz-c img.real{max-width:none;max-height:none;cursor:zoom-out}',
      '.vz-c iframe{width:100%;height:100%;border:0;background:#fff}',
      '.vz-n{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:64px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-size:calc(28px*var(--fs,1));cursor:pointer}',
      '.vz-n.p{left:8px}.vz-n.s{right:8px}',
      '.vz-msg{padding:30px;text-align:center;opacity:.85;line-height:1.5}',
      '.vz-msg a{color:#ffd59a}',
      '.vz-galeria{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.vz-galeria img{width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #d6dce8;background:#eef2f9}',
      'img.vz-rota{background:#f4f4f4;outline:1px dashed #c9ced8}',
      'img.vz-vencida{cursor:default!important;object-fit:contain!important;background:#eceff4}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function cerrar() { if (nodo) { nodo.remove(); nodo = null; document.removeEventListener('keydown', tecla); } }
  function tecla(e) {
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowRight') ir(1);
    else if (e.key === 'ArrowLeft') ir(-1);
  }
  function ir(p) { if (L.length < 2) return; I = (I + p + L.length) % L.length; pintarVisor(); }
  function url(x) {
    if (x.url) return Promise.resolve(x.url);
    if (typeof x.obtenerUrl === 'function') return x.obtenerUrl().then(function (u) { x.url = u; return u; });
    return Promise.reject(new Error('sin dirección'));
  }
  function pintarVisor() {
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
    }).catch(function (e) { c.innerHTML = '<div class="vz-msg">' + (e && e.vencida ? '' : 'No se pudo abrir: ') + esc(e.message || e) + '</div>'; });
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
    pintarVisor();
  }
  // Abre una foto suelta por su valor (ruta, URL o link de Drive)
  function abrirFoto(valor, bucket, nombre) {
    abrir([{ nombre: nombre || 'Foto', mime: 'image/jpeg', obtenerUrl: function () { return resolver(valor, { bucket: bucket, w: 1600 }); } }], 0);
  }

  function grupoDe(t) {
    return t.closest('[data-visor-grupo]') || t.closest('.g-fotos,.mc-fotos,.fotos,.vz-galeria,.tr-fotos,.hist-fotos') || t.parentNode;
  }

  // delegación (fase de captura: gana antes que los enlaces)
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    // 1) miniaturas data-vfoto
    var f = e.target.closest('img[data-vfoto]');
    if (f && !f.closest('[data-novisor]')) {
      e.preventDefault(); e.stopPropagation();
      if (vencida(f.getAttribute('data-vfoto'))) return;   // nada que ampliar
      var g1 = grupoDe(f);
      var els1 = Array.prototype.slice.call(g1.querySelectorAll('img[data-vfoto]'))
        .filter(function (el) { return !vencida(el.getAttribute('data-vfoto')); });
      abrir(els1.map(function (el) {
        var v = el.getAttribute('data-vfoto'), b = el.getAttribute('data-bucket');
        return { nombre: el.getAttribute('data-visor-nombre') || el.getAttribute('alt') || 'Foto', mime: 'image/jpeg',
                 obtenerUrl: function () { return resolver(v, { bucket: b, w: 1600 }); } };
      }), els1.indexOf(f));
      return;
    }
    // 2) <img data-visor> / [data-visor-url]
    var t = e.target.closest('[data-visor],[data-visor-url]');
    if (t) {
      e.preventDefault(); e.stopPropagation();
      var g = t.closest('[data-visor-grupo]') || t.parentNode;
      var els = Array.prototype.slice.call(g.querySelectorAll('[data-visor],[data-visor-url]'));
      abrir(els.map(function (el) {
        var u = el.getAttribute('data-visor-url') || el.getAttribute('src') || el.getAttribute('href');
        return { nombre: el.getAttribute('data-visor-nombre') || el.getAttribute('alt') || el.getAttribute('title') || '',
                 mime: el.getAttribute('data-visor-mime') || '',
                 obtenerUrl: driveId(u) ? function () { return resolver(u, { w: 1600 }); } : null, url: driveId(u) ? null : u };
      }), els.indexOf(t));
      return;
    }
    // 3) una foto dentro de un enlace: visor en vez de abrir / descargar el enlace
    var img = e.target.closest('a img');
    if (img && !img.hasAttribute('data-lb') && !img.closest('[data-novisor]')) {
      var a = img.closest('a'), src = img.currentSrc || img.src;
      if (!src) return;
      e.preventDefault(); e.stopPropagation();
      var g3 = grupoDe(a);
      var imgs = Array.prototype.slice.call(g3.querySelectorAll('a img')).filter(function (x) { return x.currentSrc || x.src; });
      abrir(imgs.map(function (x) {
        return { nombre: x.getAttribute('alt') || 'Foto', mime: 'image/jpeg', url: x.currentSrc || x.src };
      }), Math.max(0, imgs.indexOf(img)));
    }
  }, true);

  // miniaturas que aparecen después (detalles, modales, historiales)
  function vigilar() {
    estilos();
    pintar(document);
    if (global.MutationObserver) {
      var pend = false;
      new MutationObserver(function () {
        if (pend) return; pend = true;
        (global.requestAnimationFrame || setTimeout)(function () { pend = false; pintar(document); });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();

  global.Visor = { abrir: abrir, cerrar: cerrar, abrirFoto: abrirFoto, resolver: resolver, pintar: pintar,
                   galeria: galeria, driveId: driveId, vencida: vencida, usarCliente: function (c) { global.__visorSb = c; } };
})(window);
