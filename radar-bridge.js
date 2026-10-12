/* =========================================================================
 * radar-bridge.js — pestaña Licitaciones (Radar) · v20261012a
 *
 * Muestra la pestaña solo a quien la base le da acceso (radar_access):
 * admin de Obras, admin central de Equipos, gerentes y los habilitados en
 * radar_permissions. Usa el mismo cliente/sesión de ObraAPI._sb(); no hay
 * otro login. Al abrir la pestaña le avisa al marco (radar/) que recargue.
 * ========================================================================= */
(function () {
  'use strict';
  function sb() { return window.ObraAPI && window.ObraAPI._sb && window.ObraAPI._sb(); }
  function mostrar(ok) {
    document.querySelectorAll('[data-v="radar"]').forEach(function (b) { b.style.display = ok ? '' : 'none'; });
    // si se pierde el acceso con la pestaña abierta, volver al cronograma
    if (!ok && document.getElementById('v-radar') && document.getElementById('v-radar').classList.contains('on')) {
      var g = document.querySelector('#tabs button[data-v="gantt"]'); if (g) g.click();
    }
  }
  async function actualizar() {
    var c = sb(); if (!c) return;
    var s = await c.auth.getSession();
    if (!s.data || !s.data.session) { mostrar(false); return; }
    var r = await c.rpc('radar_access', { p_write: false });
    mostrar(!r.error && r.data === true);
  }
  function avisarMarco() {
    var f = document.getElementById('radarFrame');
    if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'radar:activate' }, location.origin);
  }
  window.addEventListener('DOMContentLoaded', function () {
    var intentos = 0;
    (function enganchar() {
      var c = sb();
      if (!c) { if (++intentos < 40) setTimeout(enganchar, 250); return; }
      actualizar().catch(function () {});
      c.auth.onAuthStateChange(function () { setTimeout(function () { actualizar().catch(function () {}); }, 0); });
    })();
    ['tabs', 'mobinav'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.addEventListener('click', function (e) { if (e.target.closest('[data-v="radar"]')) avisarMarco(); });
    });
  });
})();
