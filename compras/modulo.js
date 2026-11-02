/* =========================================================================
 * compras/modulo.js — MÓDULO COMPRAS · v20261102a
 *
 *  Página propia para la gente de Compras (como Recursos humanos): la bandeja
 *  de pedidos de TODAS las obras y los KPIs, sin las tarjetas de monto de
 *  contrato / avance ni las pestañas de la obra. La pantalla la dibuja
 *  compras.js (window.COMPRAS_MODULO = true); este archivo solo arranca la
 *  sesión, decide quién entra y arma la cabecera.
 *
 *  Quién entra (rol en Obras): admin, compras y gerente — los mismos que ya
 *  veían «Todas las obras» en la pestaña Compras. Los permisos de verdad los
 *  pone la base (RLS de compra): no hace falta SQL nuevo.
 *  Compras carga, cotiza y registra la OC; gerente solo ve.
 *  Los residentes siguen haciendo sus pedidos en Obras › Compras.
 * ========================================================================= */
(function () {
  'use strict';

  var ROLES = ['admin', 'compras', 'gerente'];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // compras.js usa toast(html) y YO_SOY (en Obras es un let de app.js)
  var tT = null;
  window.toast = function (html) {
    var t = $('#toast'); if (!t) return;
    t.innerHTML = String(html == null ? '' : html); t.hidden = false;
    clearTimeout(tT); tT = setTimeout(function () { t.hidden = true; }, 4200);
  };
  window.YO_SOY = '';

  function estado(html) { var v = $('#v-compras'); if (v) v.innerHTML = '<div class="estado">' + html + '</div>'; }
  function sb() { return window.ObraAPI && window.ObraAPI._sb && window.ObraAPI._sb(); }

  async function iniciar() {
    if (window.innerWidth < 760) document.body.classList.add('mobile');
    $('#btn-salir').onclick = salir;
    botonApps();
    var c = sb();
    if (!c) { estado('No se pudo iniciar la conexión.'); return; }
    var s = await c.auth.getSession();
    if (!s.data || !s.data.session) { location.href = '../index.html'; return; }   // el ingreso es el de Obras
    var w = await c.rpc('app_whoami');
    if (w.error) { estado('No se pudo verificar tu usuario: ' + esc(w.error.message) + '<br><br><a href="">Reintentar</a>'); return; }
    var rol = w.data ? (w.data.rol === 'consulta' ? 'lectura' : w.data.rol) : '';
    try {
      if (w.data) localStorage.setItem('tecsul_acceso_obras', '1');
      if (ROLES.indexOf(rol) >= 0) localStorage.setItem('tecsul_compras', '1'); else localStorage.removeItem('tecsul_compras');
    } catch (e) {}
    if (ROLES.indexOf(rol) < 0) {
      $('#btn-obras').hidden = !w.data;
      estado('Tu usuario no tiene acceso al módulo de Compras.<br>Lo usan los roles <b>Compras</b>, <b>Gerente</b> y <b>Administrador</b> de Obras.<br><br>' +
        (w.data ? 'Los pedidos de tu obra se cargan en <a href="../index.html?obras=1">Obras › Compras</a>.' : '<a href="../index.html">Volver a la app</a>'));
      return;
    }
    window.__role = rol;
    window.YO_SOY = w.data.nombre || w.data.email || '';
    window.__email = w.data.email || '';
    $('#hdr-usuario').textContent = (w.data.nombre || w.data.email || '') + ' · ' +
      (rol === 'gerente' ? 'gerente (solo ver)' : rol === 'compras' ? 'compras' : 'administrador');
    if (!window.ComprasView || !window.ComprasView.abrirModulo) { estado('Falta compras.js actualizado (v20261102a).'); return; }
    window.ComprasView.abrirModulo();
  }

  async function salir() {
    if (!confirm('¿Cerrar sesión?')) return;
    try { await sb().auth.signOut(); } catch (e) {}
    try { ['perfil', 'tecsul_acceso_obras', 'tecsul_rol_equipos', 'tecsul_rrhh', 'tecsul_compras'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    location.href = '../index.html';
  }

  // Botón «Otras apps de Tecsul» (igual que en Obras, Equipos y RRHH)
  function botonApps() {
    var b = $('#apps-btn'); if (!b) return;
    b.onclick = function (e) {
      e.stopPropagation();
      var ab = $('#apps-menu'); if (ab) { ab.remove(); return; }
      var obras = false, rolEq = '', rrhh = '';
      try { obras = localStorage.getItem('tecsul_acceso_obras') === '1'; rolEq = localStorage.getItem('tecsul_rol_equipos') || ''; rrhh = localStorage.getItem('tecsul_rrhh') || ''; } catch (er) {}
      var apps = [];
      if (obras) apps.push(['📅', 'Obras', 'cronograma, producción, certificación', '../index.html?obras=1']);
      if (rolEq) apps.push(['🚜', 'Parte diario de equipos', 'partes, taller, combustible', '../equipos/parte_diario_v5.html']);
      if (['taller', 'admin_obra', 'admin_central', 'gerente'].indexOf(rolEq) >= 0) apps.push(['🛠️', 'Flota y taller', 'flota, OT, mantenimiento, alquileres', '../equipos/flota.html?p=flota']);
      if (rrhh) apps.push(['👥', 'Recursos humanos', 'planilla de salarios, personal', '../rrhh/index.html']);
      apps.push(['🛒', 'Compras', 'esta app', null]);
      var m = document.createElement('div');
      m.id = 'apps-menu';
      m.style.cssText = 'position:fixed;z-index:600;width:min(330px,calc(100vw - 16px));background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(26,39,68,.28);padding:8px';
      m.innerHTML = apps.map(function (a) {
        return '<a href="' + (a[3] || '#') + '" style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;color:#1a2744;text-decoration:none;' + (a[3] ? '' : 'background:#eef2fb') + '">' +
          '<span style="font-size:24px;width:32px;text-align:center">' + a[0] + '</span><span><b style="display:block">' + a[1] + '</b><small style="color:#6b7487">' + a[2] + '</small></span></a>';
      }).join('') + '<div style="font-size:11.5px;color:#6b7487;padding:6px 12px 2px">Un solo usuario para todo: lo que ves depende de tu rol.</div>';
      document.body.appendChild(m);
      var r = b.getBoundingClientRect();
      m.style.top = (r.bottom + 8) + 'px';
      m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
      var aqui = m.querySelector('a[href="#"]'); if (aqui) aqui.onclick = function (ev) { ev.preventDefault(); m.remove(); };
    };
    document.addEventListener('click', function (e) { var m = $('#apps-menu'); if (m && !m.contains(e.target) && e.target !== b) m.remove(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
