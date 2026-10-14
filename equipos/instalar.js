// ══════════════════════════════════════════════════════════════════
// instalar.js — Botón "Descargar aplicación" del Parte Diario
//
// Por qué existe: el menú del navegador no ofrece "Instalar" en todos los
// celulares. Los casos típicos en obra:
//   · el enlace se abrió desde WhatsApp/Facebook (navegador interno: NO
//     puede instalar nada; hay que abrirlo en Chrome),
//   · iPhone (Safari nunca muestra el aviso: se hace con Compartir →
//     "Agregar a inicio"),
//   · Samsung Internet, Xiaomi, Firefox: la opción tiene otro nombre,
//   · Chrome todavía no habilitó el aviso o la app ya está instalada.
//
// Qué hace: si el navegador permite instalar directo (Chrome/Edge Android),
// el botón abre el diálogo nativo. Si no, muestra los pasos exactos para
// ESE celular (y, dentro de WhatsApp en Android, un botón que lo abre en
// Chrome). Si la app ya está abierta como app instalada, el botón no aparece.
//
// Se carga en el <head> para no perder el evento beforeinstallprompt, que
// Chrome puede disparar antes de que termine de cargar la página.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var aviso = null;   // evento beforeinstallprompt guardado

  var ua = navigator.userAgent || '';
  var esIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var esAndroid = /Android/i.test(ua);
  var enApp = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Telegram|; wv\)/i.test(ua);
  var esSamsung = /SamsungBrowser/i.test(ua);
  var esXiaomi = /MiuiBrowser|XiaoMi/i.test(ua);
  var esFirefox = /Firefox|FxiOS/i.test(ua);
  var esChromeIOS = /CriOS/i.test(ua);

  function instalada() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.matchMedia('(display-mode: fullscreen)').matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    aviso = e;
    marcarListo(true);
  });

  window.addEventListener('appinstalled', function () {
    aviso = null;
    ocultarBotones();
    mostrarModal('<h3>✅ Aplicación instalada</h3><p>Ya la tenés en la pantalla de inicio con el ícono de Tecsul. ' +
      'Desde ahora abrila desde ahí.</p>', true);
  });

  // ── estilos (todo autocontenido, usa los colores del parte diario) ──
  var CSS = '' +
    '.btn-instalar{background:var(--naranja,#e8640a)!important;font-weight:700}' +
    '.btn-instalar-login{display:block;width:100%;margin-top:10px;padding:12px;border-radius:9px;' +
      'border:2px solid var(--naranja,#e8640a);background:#fff;color:var(--naranja,#e8640a);font-weight:700;font-size:15px;cursor:pointer}' +
    '.inst-fondo{position:fixed;inset:0;background:rgba(10,18,35,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center}' +
    '.inst-caja{background:#fff;color:var(--azul-oscuro,#1a2744);width:100%;max-width:480px;border-radius:16px 16px 0 0;' +
      'padding:20px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -4px 24px rgba(0,0,0,.2);max-height:85vh;overflow:auto}' +
    '@media(min-width:600px){.inst-fondo{align-items:center}.inst-caja{border-radius:16px}}' +
    '.inst-caja h3{margin:0 0 10px;font-size:18px}' +
    '.inst-caja p{margin:0 0 10px;font-size:14.5px;line-height:1.5}' +
    '.inst-caja ol{margin:0 0 12px;padding-left:22px;font-size:14.5px;line-height:1.6}' +
    '.inst-caja ol li{margin-bottom:6px}' +
    '.inst-caja .ic{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:6px;background:var(--gris-fondo,#f0f2f5);font-weight:700}' +
    '.inst-caja .nota{font-size:12.5px;color:var(--gris-texto,#4a5568);background:var(--gris-fondo,#f0f2f5);padding:9px 11px;border-radius:8px}' +
    '.inst-botones{display:flex;gap:8px;margin-top:14px}' +
    '.inst-botones button,.inst-botones a{flex:1;padding:12px;border:0;border-radius:9px;font-weight:700;font-size:14.5px;cursor:pointer;text-align:center;text-decoration:none}' +
    '.inst-prim{background:var(--azul-medio,#2c4a8a);color:#fff}' +
    '.inst-sec{background:var(--gris-borde,#d0d6e0);color:var(--gris-texto,#4a5568)}';

  function ponerEstilos() {
    if (document.getElementById('inst-css')) return;
    var s = document.createElement('style');
    s.id = 'inst-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── botones ──
  function crearBotones() {
    if (instalada()) return;
    ponerEstilos();

    // 1) En la cabecera, al lado de "Clave" y "Salir"
    var cab = document.querySelector('.app-header');
    if (cab && !document.getElementById('btn-instalar')) {
      var b = document.createElement('button');
      b.id = 'btn-instalar';
      b.className = 'logout-link btn-instalar';
      b.type = 'button';
      b.title = 'Descargar la aplicación en este celular';
      b.textContent = '⤓ App';
      b.onclick = instalar;
      var clave = cab.querySelector('.logout-link');
      cab.insertBefore(b, clave || null);
    }

    // 2) En la pantalla de ingreso, debajo de "Ingresar"
    var login = document.querySelector('.login-card');
    if (login && !document.getElementById('btn-instalar-login')) {
      var l = document.createElement('button');
      l.id = 'btn-instalar-login';
      l.className = 'btn-instalar-login';
      l.type = 'button';
      l.textContent = '📲 Descargar aplicación';
      l.onclick = instalar;
      login.appendChild(l);
    }
  }

  function marcarListo() { /* el botón ya está visible; nada más que hacer */ }

  function ocultarBotones() {
    ['btn-instalar', 'btn-instalar-login'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  // ── acción principal ──
  function instalar() {
    if (aviso) {
      var e = aviso;
      aviso = null;   // el evento solo se puede usar una vez
      e.prompt();
      e.userChoice.then(function (r) {
        if (r && r.outcome === 'accepted') ocultarBotones();
      }).catch(function () {});
      return;
    }
    mostrarModal(pasos());
  }

  // Enlace para abrir esta misma página en Chrome (solo Android)
  function enlaceChrome() {
    var u = location.href.replace(/^https?:\/\//, '');
    return 'intent://' + u + '#Intent;scheme=https;package=com.android.chrome;end';
  }

  function pasos() {
    // a) Navegador interno de WhatsApp / Facebook / Instagram
    if (enApp) {
      if (esAndroid) {
        return '<h3>📲 Abrí la página en Chrome</h3>' +
          '<p>Estás viendo la página <b>dentro de WhatsApp</b> (u otra app). Desde ahí no se puede instalar.</p>' +
          '<ol><li>Tocá el botón de abajo <b>Abrir en Chrome</b>.</li>' +
          '<li>En Chrome tocá otra vez <b>📲 Descargar aplicación</b>.</li></ol>' +
          '<p class="nota">Si no funciona: tocá <span class="ic">⋮</span> arriba a la derecha → <b>Abrir en Chrome</b> (o "Abrir en el navegador").</p>' +
          '<div class="inst-botones"><button class="inst-sec" data-cerrar>Cerrar</button>' +
          '<a class="inst-prim" href="' + enlaceChrome() + '">Abrir en Chrome</a></div>';
      }
      return '<h3>📲 Abrí la página en Safari</h3>' +
        '<p>Estás viendo la página <b>dentro de WhatsApp</b> (u otra app). Desde ahí no se puede instalar.</p>' +
        '<ol><li>Tocá <span class="ic">⋯</span> o el ícono de brújula 🧭 y elegí <b>Abrir en Safari</b>.</li>' +
        '<li>En Safari seguí los pasos de <b>📲 Descargar aplicación</b>.</li></ol>' +
        '<p class="nota">Otra forma: copiá el enlace y pegalo en Safari.</p>' +
        botonesCopiar();
    }

    // b) iPhone / iPad
    if (esIOS) {
      var nav = esChromeIOS ? 'Chrome' : (esFirefox ? 'Firefox' : 'Safari');
      return '<h3>📲 Instalar en iPhone</h3>' +
        '<ol><li>Tocá el botón <b>Compartir</b> <span class="ic">⬆︎</span> ' +
        (nav === 'Safari' ? '(abajo en el centro, o arriba en iPad).' : '(arriba a la derecha, en la barra de direcciones).') + '</li>' +
        '<li>Bajá en la lista y tocá <b>Agregar a inicio</b> <span class="ic">⊞</span>.</li>' +
        '<li>Tocá <b>Agregar</b>. Aparece el ícono de Tecsul en la pantalla.</li></ol>' +
        '<p class="nota">En iPhone no aparece un aviso automático: siempre se instala así. ' +
        (nav !== 'Safari' ? 'Si en ' + nav + ' no ves "Agregar a inicio", abrí el enlace en <b>Safari</b>.' : '') + '</p>' +
        botonesCopiar();
    }

    // c) Samsung Internet
    if (esSamsung) {
      return '<h3>📲 Instalar en Samsung</h3>' +
        '<ol><li>Tocá el menú <span class="ic">≡</span> abajo a la derecha.</li>' +
        '<li>Tocá <b>Añadir página a</b> (o "Agregar página a").</li>' +
        '<li>Elegí <b>Pantalla de inicio</b>.</li></ol>' +
        '<p class="nota">Si no aparece, abrí el enlace en <b>Chrome</b> y tocá de nuevo 📲 Descargar aplicación.</p>' +
        botonesChrome();
    }

    // d) Firefox
    if (esFirefox) {
      return '<h3>📲 Instalar en Firefox</h3>' +
        '<ol><li>Tocá el menú <span class="ic">⋮</span>.</li>' +
        '<li>Tocá <b>Instalar</b> o <b>Agregar a la pantalla de inicio</b>.</li></ol>' +
        botonesChrome();
    }

    // e) Xiaomi u otro navegador de fábrica
    if (esXiaomi || (esAndroid && !/Chrome\//.test(ua))) {
      return '<h3>📲 Usá Chrome para instalar</h3>' +
        '<p>El navegador de este celular no permite instalar la aplicación.</p>' +
        '<ol><li>Tocá <b>Abrir en Chrome</b>.</li><li>En Chrome tocá otra vez <b>📲 Descargar aplicación</b>.</li></ol>' +
        botonesChrome();
    }

    // f) Chrome (Android o PC) sin aviso disponible
    return '<h3>📲 Instalar desde el menú</h3>' +
      '<ol><li>Tocá el menú <span class="ic">⋮</span> arriba a la derecha.</li>' +
      '<li>Tocá <b>Instalar aplicación</b> o <b>Agregar a la pantalla principal</b>.</li>' +
      '<li>Confirmá con <b>Instalar</b>.</li></ol>' +
      '<p class="nota">Si no aparece ninguna de las dos:<br>' +
      '• Puede que <b>ya esté instalada</b>: buscá el ícono de Tecsul entre tus aplicaciones.<br>' +
      '• Esperá unos segundos con la página abierta y volvé a tocar 📲.<br>' +
      '• Actualizá Chrome desde Play Store.</p>' +
      '<div class="inst-botones"><button class="inst-prim" data-cerrar>Entendido</button></div>';
  }

  function botonesChrome() {
    if (!esAndroid) return '<div class="inst-botones"><button class="inst-prim" data-cerrar>Entendido</button></div>';
    return '<div class="inst-botones"><button class="inst-sec" data-cerrar>Cerrar</button>' +
      '<a class="inst-prim" href="' + enlaceChrome() + '">Abrir en Chrome</a></div>';
  }

  function botonesCopiar() {
    return '<div class="inst-botones"><button class="inst-sec" data-copiar>Copiar enlace</button>' +
      '<button class="inst-prim" data-cerrar>Entendido</button></div>';
  }

  // ── ventana ──
  function mostrarModal(html, soloCerrar) {
    ponerEstilos();
    cerrarModal();
    var f = document.createElement('div');
    f.className = 'inst-fondo';
    f.id = 'inst-fondo';
    f.innerHTML = '<div class="inst-caja" role="dialog" aria-modal="true">' + html +
      (soloCerrar ? '<div class="inst-botones"><button class="inst-prim" data-cerrar>Listo</button></div>' : '') + '</div>';
    f.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === f || t.hasAttribute('data-cerrar')) { cerrarModal(); return; }
      if (t.hasAttribute('data-copiar')) copiarEnlace(t);
    });
    document.body.appendChild(f);
  }

  function cerrarModal() {
    var f = document.getElementById('inst-fondo');
    if (f) f.remove();
  }

  function copiarEnlace(btn) {
    // Se copia la entrada de la app (no esta página) para que, al pegarla,
    // abra con el login de siempre.
    var url = new URL('../index.html', location.href).href;
    var ok = function () { btn.textContent = '✓ Copiado'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(function () { window.prompt('Copiá este enlace:', url); });
    } else {
      window.prompt('Copiá este enlace:', url);
    }
  }

  window.instalarApp = instalar;   // por si se quiere llamar desde otro lado

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crearBotones);
  else crearBotones();
})();
