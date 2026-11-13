/* =========================================================================
 * permisos_app.js — aplica los PERMISOS A MEDIDA (SQL 116) en la app
 *  v20261113d
 *
 *  Lee mis_ajustes() (lo que el administrador ajustó para esta persona,
 *  propio o de su plantilla), lo guarda en el teléfono y:
 *    · oculta las pestañas en «oculto» (Obras, Equipos, Compras),
 *    · avisa «solo ver» / «solo en tus obras» al abrir esas pestañas.
 *  La base igual rechaza cargar en lo quitado: esto es para que no aparezca.
 *
 *  Uso: PermisosApp.cargar(clienteSupabase) · PermisosApp.valor('eq.flota')
 *       PermisosApp.oculto('ob.prod')
 * ========================================================================= */
(function (global) {
  'use strict';
  var LS = 'tecsul_ajustes';
  // pestañas de Obras (index.html: data-v) por clave
  var OB_TABS = {
    'ob.cronograma': ['gantt', 'weekly'], 'ob.prod': ['prod'], 'ob.pista': ['pista'], 'ob.cert': ['cert'],
    'ob.computo': ['computo'], 'ob.transporte': ['transporte'], 'ob.compras': ['compras'], 'ob.costos': ['costos'],
    'ob.report': ['report'], 'ob.com': ['com'], 'ob.archivos': ['archivos'], 'ob.radar': ['radar'], 'ob.pbi': ['pbi']
  };
  function leer() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  var A = leer();
  function valor(k) { return (A.ajustes || {})[k] || null; }
  function oculto(k) { return valor(k) === 'oculto'; }

  function css() {
    var reglas = [];
    Object.keys(OB_TABS).forEach(function (k) {
      if (!oculto(k)) return;
      OB_TABS[k].forEach(function (v) {
        reglas.push('#tabs button[data-v="' + v + '"],.navtabs button[data-v="' + v + '"]{display:none!important}');
      });
    });
    var st = document.getElementById('permisosAppCss');
    if (!st) { st = document.createElement('style'); st.id = 'permisosAppCss'; (document.head || document.documentElement).appendChild(st); }
    st.textContent = reglas.join('\n');
    // si la pestaña abierta quedó oculta, ir a la primera visible
    var on = document.querySelector('#tabs button.on');
    if (on && getComputedStyle(on).display === 'none') {
      var otra = [].slice.call(document.querySelectorAll('#tabs button')).filter(function (b) { return getComputedStyle(b).display !== 'none'; })[0];
      if (otra) otra.click();
    }
  }
  function aviso(k) {
    var v = valor(k); if (!v || v === 'oculto') return;
    var t = v === 'ver' ? 'Esta pestaña la tenés solo para ver: los cambios no se van a guardar.'
          : v === 'editar_sus' ? 'En esta pestaña solo podés cargar en tus obras.' : '';
    if (!t) return;
    if (typeof global.toast === 'function') { try { global.toast('🔐 ' + t, 'info'); return; } catch (e) {} }
  }
  // Obras: aviso al abrir una pestaña restringida
  // «Solo ver» en Obras: la pestaña se abre en modo lectura (la misma clase
  // «readonly» que usan Lectura y Gerente) y vuelve a lo del rol al salir.
  var BASE_RO = null;
  function base(ro) { BASE_RO = !!ro; }
  function claveDeVista(v) { var r = null; Object.keys(OB_TABS).forEach(function (k) { if (OB_TABS[k].indexOf(v) >= 0) r = k; }); return r; }
  function modoVista(v) {
    if (BASE_RO === null) return;
    var k = claveDeVista(v);
    document.body.classList.toggle('readonly', BASE_RO || (!!k && valor(k) === 'ver'));
  }
  function engancharObras() {
    var tabs = document.getElementById('tabs');
    if (!tabs || tabs._permisos) return;
    tabs._permisos = true;
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b) return;
      modoVista(b.dataset.v);
      var k = claveDeVista(b.dataset.v); if (k) aviso(k);
    }, true);
  }
  async function cargar(sb) {
    if (!sb || !sb.rpc) return A;
    try {
      var r = await sb.rpc('mis_ajustes');
      if (r.error) return A;            // sin señal o sin el SQL 116: queda lo guardado
      var antes = JSON.stringify(A);
      A = r.data || {};
      try { localStorage.setItem(LS, JSON.stringify(A)); } catch (e) {}
      aplicar();
      if (antes !== JSON.stringify(A) && global.Menu && global.Menu.repintar) global.Menu.repintar();
    } catch (e) {}
    return A;
  }
  function aplicar() {
    css(); engancharObras();
    var on = document.querySelector('#tabs button.on'); if (on) modoVista(on.dataset.v);
  }
  function limpiar() { A = {}; try { localStorage.removeItem(LS); } catch (e) {} aplicar(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar); else aplicar();
  global.PermisosApp = { base: base, cargar: cargar, valor: valor, oculto: oculto, aviso: aviso, aplicar: aplicar, limpiar: limpiar };
})(window);
