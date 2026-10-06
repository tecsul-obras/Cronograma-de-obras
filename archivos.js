/* =========================================================================
 * archivos.js — Pestaña ARCHIVOS (repositorio en Google Drive) · v20261006e
 *
 * Muestra, dentro de la app, las carpetas de Google Drive de la obra:
 *   · Carpeta de la obra   (config 'drive:obra')
 *   · Carpeta compartida   (config 'drive:general', p. ej. la de la PWA)
 * con la vista embebida de Drive. Cada uno ve lo que SU cuenta @tecsul tiene
 * permitido: el permiso lo da Google Drive, no la app. Botones para abrir en
 * Drive, Mi unidad y Compartidos conmigo. Admin/residente cargan los links.
 * No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function leer(n) { try { return (0, eval)(n); } catch (e) { return undefined; } }
  function cfg() { return leer('CFG') || {}; }
  function rol() { return global.__role || ''; }
  function editor() { return rol() === 'admin' || rol() === 'residente'; }
  var VISTA = 'obra', MODO = 'list', EDIT = false;

  // Cuenta de Google con la que se abre Drive: la @tecsul del usuario que
  // entró a la app (authuser=correo). Sin esto Google usa la primera cuenta
  // del navegador, que suele ser la personal.
  var CORREO = '', PIDIENDO = false;
  function correoGoogle() {
    var c = String(CORREO || '').toLowerCase();
    return /@tecsul\.com\.py$/.test(c) ? c : '';
  }
  function conCuenta(url) {
    var c = correoGoogle(); if (!c) return url;
    var i = url.indexOf('#'), h = i >= 0 ? url.slice(i) : '', b = i >= 0 ? url.slice(0, i) : url;
    return b + (b.indexOf('?') >= 0 ? '&' : '?') + 'authuser=' + encodeURIComponent(c) + h;
  }
  function elegirCuenta(url) {
    return 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(url) +
      (correoGoogle() ? '&Email=' + encodeURIComponent(correoGoogle()) : '');
  }
  async function cargarCorreo() {
    if (CORREO || PIDIENDO) return;
    PIDIENDO = true;
    try {
      var sb = global.ObraAPI && global.ObraAPI._sb && global.ObraAPI._sb();
      if (sb) { var r = await sb.auth.getUser(); CORREO = (r && r.data && r.data.user && r.data.user.email) || ''; }
    } catch (e) {}
    PIDIENDO = false;
    if (CORREO && $('#v-archivos') && $('#v-archivos').classList.contains('on')) render();
  }

  // id de carpeta desde un link de Drive (…/folders/ID, ?id=ID) o el id solo
  function idCarpeta(u) {
    u = String(u || '').trim(); if (!u) return '';
    var m = u.match(/\/folders\/([\w-]{10,})/) || u.match(/[?&]id=([\w-]{10,})/);
    if (m) return m[1];
    return /^[\w-]{10,}$/.test(u) ? u : '';
  }
  function estilos() {
    if ($('#arCss')) return;
    var st = document.createElement('style'); st.id = 'arCss';
    st.textContent = [
      '#v-archivos{background:#f4f6f9;display:none;flex-direction:column}#v-archivos.on{display:flex}',
      '.ar-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px;background:#fff;border-bottom:1px solid #d0d6e0;color:#1f2937}',
      '.ar-seg{display:inline-flex;border:1px solid #c9d1dc;border-radius:9px;overflow:hidden}',
      '.ar-seg button{border:0;background:#fff;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer;color:#1f2937}',
      '.ar-seg button.on{background:#1a2744;color:#fff}',
      '.ar-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}',
      '.ar-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}',
      '.ar-frame{flex:1;min-height:0;position:relative}',
      '.ar-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}',
      '.ar-vacio{padding:30px;text-align:center;color:#4a5568;max-width:720px;margin:20px auto;background:#fff;border:1px solid #d0d6e0;border-radius:12px}',
      '.ar-nota{font-size:12px;color:#4a5568;padding:6px 14px;background:#f0f4fa;border-bottom:1px solid #e1e6ee}',
      '.ar-cfg{padding:12px 14px;background:#fffbe6;border-bottom:1px solid #f0e0a0;display:grid;gap:8px;color:#1f2937}',
      '.ar-cfg label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:700;color:#4a5568}',
      '.ar-cfg input{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function render() {
    var v = $('#v-archivos'); if (!v) return;
    estilos();
    if (!CORREO) cargarCorreo();
    var c = cfg(), urlObra = c['drive:obra'] || '', urlGen = c['drive:general'] || '';
    var url = VISTA === 'obra' ? urlObra : urlGen, id = idCarpeta(url);
    var abrir = id ? conCuenta('https://drive.google.com/drive/folders/' + id) : '';
    var cuenta = correoGoogle();
    var h = '<div class="ar-bar"><div class="ar-seg"><button data-arv="obra" class="' + (VISTA === 'obra' ? 'on' : '') + '">📁 Carpeta de la obra</button>' +
      '<button data-arv="general" class="' + (VISTA === 'general' ? 'on' : '') + '">📁 Carpeta compartida</button></div>' +
      (id ? '<div class="ar-seg"><button data-arm="list" class="' + (MODO === 'list' ? 'on' : '') + '">☰ Lista</button><button data-arm="grid" class="' + (MODO === 'grid' ? 'on' : '') + '">▦ Íconos</button></div>' : '') +
      '<span style="flex:1"></span>' +
      (abrir ? '<a class="ar-btn pri" href="' + esc(abrir) + '" target="_blank" rel="noopener" title="Para subir archivos, crear carpetas o compartir">↗ Abrir en Drive</a>' : '') +
      '<a class="ar-btn" href="' + esc(conCuenta('https://drive.google.com/drive/my-drive')) + '" target="_blank" rel="noopener">🗂 Mi unidad</a>' +
      '<a class="ar-btn" href="' + esc(conCuenta('https://drive.google.com/drive/shared-with-me')) + '" target="_blank" rel="noopener">👥 Compartidos conmigo</a>' +
      '<a class="ar-btn" href="' + esc(elegirCuenta(abrir || 'https://drive.google.com/drive/my-drive')) + '" target="_blank" rel="noopener" title="Si Drive abre con otra cuenta, iniciá sesión o elegí la de Tecsul">👤 Cambiar cuenta</a>' +
      (editor() ? '<button class="ar-btn" id="arCfg">⚙ Carpetas</button>' : '') + '</div>';
    if (EDIT) {
      h += '<div class="ar-cfg"><label>Link de la carpeta de Drive de ESTA obra<input id="arUObra" value="' + esc(urlObra) + '" placeholder="https://drive.google.com/drive/folders/…"></label>' +
        '<label>Link de la carpeta compartida (general)<input id="arUGen" value="' + esc(urlGen) + '" placeholder="https://drive.google.com/drive/folders/…"></label>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="ar-btn" id="arCfgNo">Cancelar</button><button class="ar-btn pri" id="arCfgSi">Guardar</button></div></div>';
    }
    h += '<div class="ar-nota">' + (cuenta ? 'Drive se abre con <b>' + esc(cuenta) + '</b>. ' : 'Ves lo que tu cuenta <b>@tecsul</b> tiene permitido en Drive. ') +
      'Si aparece «Necesitás acceso» con otra cuenta, o un pedido de inicio de sesión, tocá <b>👤 Cambiar cuenta</b> e iniciá sesión con la de Tecsul en este navegador (queda junto a la personal, no la reemplaza); después volvé y recargá. Si el navegador bloquea cookies de terceros, usá «↗ Abrir en Drive». Para subir archivos, abrí la carpeta en Drive.</div>';
    if (!id) {
      h += '<div class="ar-vacio">' + (url ? 'El link cargado no parece una carpeta de Drive.' : 'Todavía no hay una carpeta de Drive para ' + (VISTA === 'obra' ? 'esta obra' : 'la carpeta compartida') + '.') +
        (editor() ? ' Tocá <b>⚙ Carpetas</b> y pegá el link de la carpeta (en Drive: clic derecho › Compartir › Copiar vínculo).' : ' Pedile al residente o al administrador que la configure.') + '</div>';
    } else {
      h += '<div class="ar-frame"><iframe src="' + esc(conCuenta('https://drive.google.com/embeddedfolderview?id=' + id + '#' + MODO)) + '" title="Carpeta de Drive" referrerpolicy="no-referrer-when-downgrade"></iframe></div>';
    }
    v.innerHTML = h;
    Array.prototype.forEach.call(v.querySelectorAll('[data-arv]'), function (b) { b.onclick = function () { VISTA = b.getAttribute('data-arv'); render(); }; });
    Array.prototype.forEach.call(v.querySelectorAll('[data-arm]'), function (b) { b.onclick = function () { MODO = b.getAttribute('data-arm'); render(); }; });
    var e;
    if ((e = $('#arCfg'))) e.onclick = function () { EDIT = !EDIT; render(); };
    if ((e = $('#arCfgNo'))) e.onclick = function () { EDIT = false; render(); };
    if ((e = $('#arCfgSi'))) e.onclick = async function () {
      var uo = $('#arUObra').value.trim(), ug = $('#arUGen').value.trim();
      if ((uo && !idCarpeta(uo)) || (ug && !idCarpeta(ug))) { alert('Alguno de los links no es de una carpeta de Drive.'); return; }
      try {
        await global.ObraAPI.saveConfig({ 'drive:obra': uo, 'drive:general': ug });
        var c2 = cfg(); c2['drive:obra'] = uo; c2['drive:general'] = ug;
        EDIT = false; toast('Carpetas guardadas'); render();
      } catch (er) { alert(er.message || String(er)); }
    };
  }
  function enganchar() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'archivos') render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  global.ArchivosView = { abrir: render, reset: function () { EDIT = false; } };
})(window);
