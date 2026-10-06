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

  /* ---- Navegador propio (API de Google Drive) --------------------------
   * Con un ID de cliente OAuth de Google (proyecto interno de Tecsul) la app
   * lista las carpetas ella misma: se entra a las subcarpetas sin salir de
   * la app y los archivos se abren en una pestaña nueva del navegador.
   * Sin ID de cliente se usa la vista embebida de Drive (que abre las
   * subcarpetas en Drive).
   * El ID de cliente no es secreto (es público por diseño). Permiso pedido:
   * drive.metadata.readonly = ver nombres y carpetas, no leer ni cambiar
   * el contenido de los archivos. */
  var CLIENT_ID_FIJO = '';
  var SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
  var TOKEN = null, TOKEN_VENCE = 0, CLIENTE = null, GIS_CARGANDO = null;
  var PILA = [], RAIZ = '', CACHE = {}, FILTRO = '', CARGANDO = false, ERROR = '';
  var M_CARPETA = 'application/vnd.google-apps.folder', M_ATAJO = 'application/vnd.google-apps.shortcut';
  function clienteId() { return String(cfg()['google:client_id'] || CLIENT_ID_FIJO || '').trim(); }
  try {
    var t0 = JSON.parse(sessionStorage.getItem('ar:token') || 'null');
    if (t0 && t0.vence > Date.now() + 60000) { TOKEN = t0.token; TOKEN_VENCE = t0.vence; }
  } catch (e) {}
  function tokenVigente() { return TOKEN && TOKEN_VENCE > Date.now() + 30000; }
  function cargarGis() {
    if (global.google && global.google.accounts && global.google.accounts.oauth2) return Promise.resolve();
    if (GIS_CARGANDO) return GIS_CARGANDO;
    GIS_CARGANDO = new Promise(function (ok, mal) {
      var sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = function () { ok(); };
      sc.onerror = function () { GIS_CARGANDO = null; mal(new Error('No se pudo cargar el inicio de sesión de Google')); };
      document.head.appendChild(sc);
    });
    return GIS_CARGANDO;
  }
  // tiene que llamarse desde un clic (Google abre una ventanita)
  function conectar() {
    ERROR = '';
    return cargarGis().then(function () {
      if (!CLIENTE) {
        CLIENTE = global.google.accounts.oauth2.initTokenClient({
          client_id: clienteId(), scope: SCOPE, hint: correoGoogle() || undefined, prompt: '',
          callback: function (r) {
            if (r && r.access_token) {
              TOKEN = r.access_token; TOKEN_VENCE = Date.now() + (Number(r.expires_in) || 3600) * 1000;
              try { sessionStorage.setItem('ar:token', JSON.stringify({ token: TOKEN, vence: TOKEN_VENCE })); } catch (e) {}
              render();
            } else { ERROR = 'Google no dio el permiso' + (r && r.error ? ' (' + r.error + ')' : '') + '.'; render(); }
          },
          error_callback: function (r) { ERROR = 'No se completó el ingreso a Google' + (r && r.type ? ' (' + r.type + ')' : '') + '.'; render(); }
        });
      }
      CLIENTE.requestAccessToken();
    }).catch(function (e) { ERROR = e.message || String(e); render(); });
  }
  function api(ruta, params) {
    var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch('https://www.googleapis.com/drive/v3/' + ruta + (q ? '?' + q : ''), { headers: { Authorization: 'Bearer ' + TOKEN } })
      .then(function (r) {
        if (r.status === 401) { TOKEN = null; try { sessionStorage.removeItem('ar:token'); } catch (e) {} throw new Error('La sesión de Google venció: tocá «Conectar».'); }
        return r.json().then(function (d) {
          if (!r.ok) {
            var m = (d && d.error && d.error.message) || ('Drive respondió ' + r.status);
            if (r.status === 404) m = 'No encontré la carpeta, o tu cuenta no tiene acceso a ella.';
            if (r.status === 403 && /has not been used|disabled/i.test(m)) m = 'Falta habilitar la API de Google Drive en el proyecto de Google Cloud.';
            throw new Error(m);
          }
          return d;
        });
      });
  }
  async function listar(id) {
    if (CACHE[id]) return CACHE[id];
    var todo = [], pag = '';
    do {
      var p = { q: "'" + id + "' in parents and trashed = false", pageSize: 1000, orderBy: 'folder,name_natural',
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink,lastModifyingUser(displayName),shortcutDetails)',
        supportsAllDrives: true, includeItemsFromAllDrives: true };
      if (pag) p.pageToken = pag;
      var d = await api('files', p);
      todo = todo.concat(d.files || []); pag = d.nextPageToken || '';
    } while (pag);
    CACHE[id] = todo; return todo;
  }
  function esCarpeta(f) { return f.mimeType === M_CARPETA || (f.mimeType === M_ATAJO && f.shortcutDetails && f.shortcutDetails.targetMimeType === M_CARPETA); }
  function fecha(iso) {
    if (!iso) return ''; var d = new Date(iso), hoy = new Date();
    if (d.toDateString() === hoy.toDateString()) return d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function tamano(b) {
    b = Number(b); if (!b) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; }
    return (i ? b.toFixed(1).replace('.', ',') : String(b)) + ' ' + u[i];
  }
  async function pintarLista() {
    var cont = $('#arLista'); if (!cont) return;
    var actual = PILA[PILA.length - 1];
    var crumbs = $('#arCrumbs');
    if (crumbs) {
      crumbs.innerHTML = PILA.map(function (c, i) {
        return (i ? '<span class="ar-sep">›</span>' : '') + (i === PILA.length - 1 ? '<b>' + esc(c.name) + '</b>' : '<button data-arc="' + i + '">' + esc(c.name) + '</button>');
      }).join('');
      Array.prototype.forEach.call(crumbs.querySelectorAll('[data-arc]'), function (b) {
        b.onclick = function () { PILA = PILA.slice(0, Number(b.getAttribute('data-arc')) + 1); FILTRO = ''; var f = $('#arFiltro'); if (f) f.value = ''; pintarLista(); };
      });
    }
    var ab = $('#arAbrirAct'); if (ab) ab.href = conCuenta('https://drive.google.com/drive/folders/' + actual.id);
    if (!CACHE[actual.id]) cont.innerHTML = '<div class="ar-msg">Cargando…</div>';
    var lista;
    try { lista = await listar(actual.id); }
    catch (e) {
      if (!TOKEN) { render(); return; }
      cont.innerHTML = '<div class="ar-msg err">' + esc(e.message || String(e)) + '</div>'; return;
    }
    if (PILA[PILA.length - 1] !== actual) return;   // ya navegó a otra
    var f = FILTRO.toLowerCase();
    var ver = lista.filter(function (x) { return !f || String(x.name).toLowerCase().indexOf(f) >= 0; });
    if (!ver.length) { cont.innerHTML = '<div class="ar-msg">' + (lista.length ? 'Nada coincide con «' + esc(FILTRO) + '».' : 'Carpeta vacía.') + '</div>'; return; }
    var h;
    if (MODO === 'grid') {
      h = '<div class="ar-grid">' + ver.map(function (x, i) {
        var carp = esCarpeta(x);
        var img = !carp && x.thumbnailLink ? '<img src="' + esc(x.thumbnailLink) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
        return '<button class="ar-card' + (carp ? ' carp' : '') + '" data-ari="' + i + '" title="' + esc(x.name) + '">' +
          '<span class="ar-th">' + (img || (carp ? '📁' : '<img class="ar-ic" src="' + esc(x.iconLink || '') + '" alt="">')) + '</span>' +
          '<span class="ar-nm">' + esc(x.name) + '</span></button>';
      }).join('') + '</div>';
    } else {
      h = '<table class="ar-tab"><thead><tr><th>Nombre</th><th class="ar-c2">Modificado</th><th class="ar-c3">Tamaño</th></tr></thead><tbody>' +
        ver.map(function (x, i) {
          var carp = esCarpeta(x);
          return '<tr data-ari="' + i + '" class="' + (carp ? 'carp' : '') + '"><td><span class="ar-fn">' +
            (carp ? '<span class="ar-ico">📁</span>' : '<img class="ar-ic" src="' + esc(x.iconLink || '') + '" alt="">') +
            '<span>' + esc(x.name) + '</span>' + (carp ? '' : '<span class="ar-ext">↗</span>') + '</span></td>' +
            '<td class="ar-c2">' + esc(fecha(x.modifiedTime)) + (x.lastModifyingUser ? ' <span class="ar-por">' + esc(x.lastModifyingUser.displayName || '') + '</span>' : '') + '</td>' +
            '<td class="ar-c3">' + esc(carp ? '' : tamano(x.size)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    cont.innerHTML = h;
    Array.prototype.forEach.call(cont.querySelectorAll('[data-ari]'), function (el) {
      el.onclick = function () {
        var x = ver[Number(el.getAttribute('data-ari'))];
        if (esCarpeta(x)) {
          var id = x.mimeType === M_ATAJO ? x.shortcutDetails.targetId : x.id;
          PILA.push({ id: id, name: x.name }); FILTRO = ''; var fi = $('#arFiltro'); if (fi) fi.value = '';
          cont.scrollTop = 0; pintarLista();
        } else {
          var u = x.webViewLink || ('https://drive.google.com/file/d/' + x.id + '/view');
          if (x.mimeType === M_ATAJO && x.shortcutDetails) u = 'https://drive.google.com/file/d/' + x.shortcutDetails.targetId + '/view';
          global.open(conCuenta(u), '_blank', 'noopener');
        }
      };
    });
  }
  async function iniciarRaiz(id) {
    if (RAIZ === id && PILA.length) return pintarLista();
    RAIZ = id; PILA = [{ id: id, name: '…' }];
    pintarLista();
    try {
      var m = await api('files/' + id, { fields: 'id,name', supportsAllDrives: true });
      if (PILA.length && PILA[0].id === id) { PILA[0].name = m.name || 'Carpeta'; pintarLista(); }
    } catch (e) { if (PILA.length && PILA[0].id === id) PILA[0].name = 'Carpeta'; }
  }

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
      '.ar-cfg input{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px}',
      '.ar-nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 14px;background:#fff;border-bottom:1px solid #e1e6ee}',
      '.ar-crumbs{flex:1;min-width:200px;display:flex;flex-wrap:wrap;align-items:center;gap:2px;font-size:14px;color:#1f2937}',
      '.ar-crumbs button{border:0;background:none;color:#2c4a8a;font:inherit;font-size:14px;cursor:pointer;padding:3px 5px;border-radius:6px}',
      '.ar-crumbs button:hover{background:#eef2f9}.ar-crumbs b{padding:3px 5px}.ar-sep{color:#9aa4b2}',
      '#arFiltro{font:inherit;font-size:13.5px;padding:7px 10px;border:1px solid #c9d1dc;border-radius:8px;min-width:220px}',
      '.ar-lista{flex:1;min-height:0;overflow:auto;background:#fff}',
      '.ar-msg{padding:24px;text-align:center;color:#4a5568}.ar-msg.err{color:#b42318}',
      '.ar-tab{width:100%;border-collapse:collapse;font-size:14px;color:#1f2937}',
      '.ar-tab th{position:sticky;top:0;background:#f7f9fc;text-align:left;font-size:12px;font-weight:700;color:#4a5568;padding:8px 14px;border-bottom:1px solid #d0d6e0}',
      '.ar-tab td{padding:9px 14px;border-bottom:1px solid #eef1f5;vertical-align:middle}',
      '.ar-tab tr[data-ari]{cursor:pointer}.ar-tab tr[data-ari]:hover td{background:#f0f4fa}',
      '.ar-fn{display:inline-flex;align-items:center;gap:9px}.ar-ic{width:16px;height:16px}.ar-ico{font-size:16px;line-height:1}',
      '.ar-ext{color:#9aa4b2;font-size:12px}.ar-por{color:#6b7280}.ar-c2{white-space:nowrap;width:260px}.ar-c3{white-space:nowrap;width:90px;text-align:right}',
      '.ar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:14px}',
      '.ar-card{border:1px solid #d0d6e0;background:#fff;border-radius:10px;padding:0;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;text-align:left;font:inherit;color:#1f2937}',
      '.ar-card:hover{border-color:#2c4a8a;box-shadow:0 2px 8px rgba(0,0,0,.08)}',
      '.ar-th{height:100px;display:flex;align-items:center;justify-content:center;background:#f4f6f9;font-size:40px;overflow:hidden}',
      '.ar-th img{width:100%;height:100%;object-fit:cover}.ar-th img.ar-ic{width:32px;height:32px;object-fit:contain}',
      '.ar-nm{padding:8px 10px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '@media (max-width:700px){.ar-c2,.ar-c3{display:none}#arFiltro{min-width:0;flex:1}}'
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
    var propio = !!(id && clienteId());
    var h = '<div class="ar-bar"><div class="ar-seg"><button data-arv="obra" class="' + (VISTA === 'obra' ? 'on' : '') + '">📁 Carpeta de la obra</button>' +
      '<button data-arv="general" class="' + (VISTA === 'general' ? 'on' : '') + '">📁 Carpeta compartida</button></div>' +
      (id ? '<div class="ar-seg"><button data-arm="list" class="' + (MODO === 'list' ? 'on' : '') + '">☰ Lista</button><button data-arm="grid" class="' + (MODO === 'grid' ? 'on' : '') + '">▦ Íconos</button></div>' : '') +
      '<span style="flex:1"></span>' +
      (abrir ? '<a class="ar-btn pri" id="arAbrirAct" href="' + esc(abrir) + '" target="_blank" rel="noopener" title="Para subir archivos, crear carpetas o compartir">↗ Abrir en Drive</a>' : '') +
      '<a class="ar-btn" href="' + esc(conCuenta('https://drive.google.com/drive/my-drive')) + '" target="_blank" rel="noopener">🗂 Mi unidad</a>' +
      '<a class="ar-btn" href="' + esc(conCuenta('https://drive.google.com/drive/shared-with-me')) + '" target="_blank" rel="noopener">👥 Compartidos conmigo</a>' +
      '<a class="ar-btn" href="' + esc(elegirCuenta(abrir || 'https://drive.google.com/drive/my-drive')) + '" target="_blank" rel="noopener" title="Si Drive abre con otra cuenta, iniciá sesión o elegí la de Tecsul">👤 Cambiar cuenta</a>' +
      (editor() ? '<button class="ar-btn" id="arCfg">⚙ Carpetas</button>' : '') + '</div>';
    if (EDIT) {
      h += '<div class="ar-cfg"><label>Link de la carpeta de Drive de ESTA obra<input id="arUObra" value="' + esc(urlObra) + '" placeholder="https://drive.google.com/drive/folders/…"></label>' +
        '<label>Link de la carpeta compartida (general)<input id="arUGen" value="' + esc(urlGen) + '" placeholder="https://drive.google.com/drive/folders/…"></label>' +
        (rol() === 'admin' && !CLIENT_ID_FIJO ? '<label>ID de cliente de Google (para navegar las carpetas dentro de la app; opcional)<input id="arCid" value="' + esc(c['google:client_id'] || '') + '" placeholder="123456789-xxxx.apps.googleusercontent.com"></label>' : '') +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="ar-btn" id="arCfgNo">Cancelar</button><button class="ar-btn pri" id="arCfgSi">Guardar</button></div></div>';
    }
    if (propio) {
      h += '<div class="ar-nota">Las carpetas se abren acá; los archivos, en una pestaña nueva' + (cuenta ? ' con <b>' + esc(cuenta) + '</b>' : '') + '. Para subir archivos, usá «↗ Abrir en Drive».</div>';
    } else {
      h += '<div class="ar-nota">' + (cuenta ? 'Drive se abre con <b>' + esc(cuenta) + '</b>. ' : 'Ves lo que tu cuenta <b>@tecsul</b> tiene permitido en Drive. ') +
        'Si aparece «Necesitás acceso» con otra cuenta, o un pedido de inicio de sesión, tocá <b>👤 Cambiar cuenta</b> e iniciá sesión con la de Tecsul en este navegador (queda junto a la personal, no la reemplaza); después volvé y recargá. Si el navegador bloquea cookies de terceros, usá «↗ Abrir en Drive». Para subir archivos, abrí la carpeta en Drive.</div>';
    }
    if (!id) {
      h += '<div class="ar-vacio">' + (url ? 'El link cargado no parece una carpeta de Drive.' : 'Todavía no hay una carpeta de Drive para ' + (VISTA === 'obra' ? 'esta obra' : 'la carpeta compartida') + '.') +
        (editor() ? ' Tocá <b>⚙ Carpetas</b> y pegá el link de la carpeta (en Drive: clic derecho › Compartir › Copiar vínculo).' : ' Pedile al residente o al administrador que la configure.') + '</div>';
    } else if (propio && !tokenVigente()) {
      h += '<div class="ar-vacio"><div style="font-size:30px">📁</div><p>Para ver las carpetas dentro de la app, conectá tu cuenta de Google' + (cuenta ? ' <b>' + esc(cuenta) + '</b>' : ' de Tecsul') + '.<br>' +
        '<span style="font-size:12.5px">Solo pide ver nombres y carpetas. Dura una hora; después se vuelve a conectar con un clic.</span></p>' +
        (ERROR ? '<p style="color:#b42318">' + esc(ERROR) + '</p>' : '') +
        '<button class="ar-btn pri" id="arConectar">Conectar Google Drive</button></div>';
    } else if (propio) {
      h += '<div class="ar-nav"><div class="ar-crumbs" id="arCrumbs"></div><input id="arFiltro" type="search" placeholder="Buscar en esta carpeta…" value="' + esc(FILTRO) + '"></div>' +
        '<div class="ar-lista" id="arLista"></div>';
    } else {
      h += '<div class="ar-frame"><iframe src="' + esc(conCuenta('https://drive.google.com/embeddedfolderview?id=' + id + '#' + MODO)) + '" title="Carpeta de Drive" referrerpolicy="no-referrer-when-downgrade"></iframe></div>';
    }
    v.innerHTML = h;
    Array.prototype.forEach.call(v.querySelectorAll('[data-arv]'), function (b) { b.onclick = function () { VISTA = b.getAttribute('data-arv'); FILTRO = ''; render(); }; });
    Array.prototype.forEach.call(v.querySelectorAll('[data-arm]'), function (b) { b.onclick = function () { MODO = b.getAttribute('data-arm'); render(); }; });
    var e;
    if ((e = $('#arConectar'))) e.onclick = function () { conectar(); };
    if ((e = $('#arFiltro'))) e.oninput = function () { FILTRO = this.value; pintarLista(); };
    if (propio && tokenVigente()) iniciarRaiz(id);
    if ((e = $('#arCfg'))) e.onclick = function () { EDIT = !EDIT; render(); };
    if ((e = $('#arCfgNo'))) e.onclick = function () { EDIT = false; render(); };
    if ((e = $('#arCfgSi'))) e.onclick = async function () {
      var uo = $('#arUObra').value.trim(), ug = $('#arUGen').value.trim();
      if ((uo && !idCarpeta(uo)) || (ug && !idCarpeta(ug))) { alert('Alguno de los links no es de una carpeta de Drive.'); return; }
      var datos = { 'drive:obra': uo, 'drive:general': ug };
      var ci = $('#arCid'); if (ci) datos['google:client_id'] = ci.value.trim();
      try {
        await global.ObraAPI.saveConfig(datos);
        var c2 = cfg(); Object.keys(datos).forEach(function (k) { c2[k] = datos[k]; });
        CLIENTE = null; RAIZ = '';
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
