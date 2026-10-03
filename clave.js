/* =========================================================================
 * clave.js — "Olvidé mi contraseña" y elegir una contraseña nueva  (v20261003c)
 *
 * 1. En la tarjeta de ingreso agrega el enlace «Olvidé mi contraseña»: manda un
 *    correo con un enlace (Supabase Auth) a la dirección escrita arriba.
 * 2. Al volver por ese enlace, la PWA entra con una sesión temporal y este
 *    archivo muestra la tarjeta «Elegí tu contraseña nueva».
 *
 * No toca app.js: usa la tarjeta de login que ya existe (#loginOverlay) y
 * ObraAPI.recuperarClave / enRecuperacion / cambiarClave (api.js).
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  function estilos() {
    if ($('#claveCss')) return;
    var st = document.createElement('style');
    st.id = 'claveCss';
    st.textContent =
      '.login-card button.clave-link{display:block;margin-top:10px !important;background:none !important;border:0;color:#2c4a8a !important;' +
      'font-size:13px;font-weight:600 !important;text-decoration:underline;cursor:pointer;padding:4px 0 !important;text-align:center;width:100%;box-shadow:none}' +
      '.clave-msg{font-size:13px;margin-top:8px;line-height:1.35;color:#2d8a4e}' +
      '.clave-msg.err{color:#c0392b}' +
      '#claveOverlay{position:fixed;inset:0;z-index:260;background:rgba(26,39,68,.92);display:none;' +
      'align-items:center;justify-content:center;padding:16px}' +
      '#claveOverlay .clave-card{background:#fff;border-radius:14px;padding:26px 26px 22px;width:340px;max-width:100%;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:6px;color:#1f2937}' +
      '#claveOverlay h3{margin:0 0 6px;font-size:18px;color:#1a2744}' +
      '#claveOverlay p{margin:0 0 6px;font-size:13px;color:#4a5568;line-height:1.4}' +
      '#claveOverlay label{font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#4a5568;margin-top:4px}' +
      '#claveOverlay input{border:1px solid #d0d6e0;border-radius:8px;padding:10px 12px;font-size:16px}' +
      '#claveOverlay button{margin-top:12px;background:#2c4a8a;color:#fff;border:0;border-radius:10px;padding:11px;' +
      'font-size:15px;font-weight:700;cursor:pointer}' +
      '#claveOverlay button:disabled{opacity:.6}';
    document.head.appendChild(st);
  }

  /* ---- 1. enlace en la tarjeta de ingreso ---- */
  function agregarEnlace() {
    var card = $('#loginOverlay .login-card');
    if (!card || $('#claveOlvide')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'claveOlvide'; b.className = 'clave-link';
    b.textContent = 'Olvidé mi contraseña';
    var msg = document.createElement('div');
    msg.className = 'clave-msg'; msg.id = 'claveMsg';
    card.appendChild(b); card.appendChild(msg);
    b.onclick = async function () {
      msg.className = 'clave-msg'; msg.textContent = 'Enviando…';
      b.disabled = true;
      try {
        var email = await global.ObraAPI.recuperarClave(($('#loginUser') || {}).value);
        msg.textContent = 'Listo. Si ' + email + ' está habilitado, te llega un correo con un enlace para ' +
                          'elegir la contraseña nueva. Abrilo en este mismo dispositivo.';
      } catch (e) {
        msg.className = 'clave-msg err'; msg.textContent = e.message || String(e);
      } finally { b.disabled = false; }
    };
  }

  /* ---- 2. tarjeta de contraseña nueva ---- */
  function tarjeta() {
    var ov = $('#claveOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'claveOverlay';
    ov.innerHTML =
      '<div class="clave-card">' +
      '<h3>Elegí tu contraseña nueva</h3>' +
      '<p>Entraste por el enlace del correo. Escribí la contraseña nueva dos veces (mínimo 8 caracteres).</p>' +
      '<label for="claveN1">Contraseña nueva</label><input id="claveN1" type="password" autocomplete="new-password">' +
      '<label for="claveN2">Repetila</label><input id="claveN2" type="password" autocomplete="new-password">' +
      '<div class="clave-msg err" id="claveErr"></div>' +
      '<button id="claveOk">Guardar contraseña</button>' +
      '</div>';
    document.body.appendChild(ov);
    var guardar = async function () {
      var a = $('#claveN1').value, b = $('#claveN2').value, err = $('#claveErr'), btn = $('#claveOk');
      err.textContent = '';
      if (a !== b) { err.textContent = 'Las dos contraseñas no coinciden.'; return; }
      btn.disabled = true;
      try {
        await global.ObraAPI.cambiarClave(a);
        ov.style.display = 'none';
        location.reload();      // arranca limpio con la sesión normal
      } catch (e) {
        err.textContent = e.message || String(e);
      } finally { btn.disabled = false; }
    };
    $('#claveOk').onclick = guardar;
    $('#claveN2').onkeydown = function (e) { if (e.key === 'Enter') guardar(); };
    return ov;
  }
  function pedirClaveNueva() {
    var ov = tarjeta();
    var login = $('#loginOverlay'); if (login) login.style.display = 'none';
    ov.style.display = 'flex';
    setTimeout(function () { var i = $('#claveN1'); if (i) i.focus(); }, 50);
  }

  function iniciar() {
    if (!global.ObraAPI || !global.ObraAPI.recuperarClave) return;
    estilos();
    agregarEnlace();
    if (global.ObraAPI.enRecuperacion()) pedirClaveNueva();
    global.addEventListener('obra-recuperar-clave', pedirClaveNueva);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
  global.ClaveUI = { pedirClaveNueva: pedirClaveNueva };
})(window);
