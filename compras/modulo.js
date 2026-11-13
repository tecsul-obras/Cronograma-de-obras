/* =========================================================================
 * compras/modulo.js — MÓDULO COMPRAS · v20261112c
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
 *
 *  v20261103a: sección «Taller» (compras/taller.js, SQL 79) — pedidos de
 *  repuestos al taller central. Entra también la gente que solo tiene usuario
 *  de Equipos (taller, admin de obra, bodega). Con acceso a las dos, arriba se
 *  elige Obras / Taller; ?s=taller abre directo en Taller.
 *
 *  v20261112c: sección «⭐ Estratégicas UCC» (compras/taller.js con canal ucc,
 *  SQL 110) — pedidos especiales que el taller manda directo a Compras, sin
 *  pasar por bodega. Entra la misma gente que a Taller. ?s=ucc abre directo.
 * ========================================================================= */
(function () {
  'use strict';

  var ROLES = ['admin', 'compras', 'gerente'];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
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
    // v20261103a: entra quien tiene rol de Compras en Obras (sección Obras) y/o
    // acceso a Compras de taller (SQL 79: taller, admin de obra de Equipos,
    // bodega, compras, autorizadores). Mucha gente de taller no tiene usuario de Obras.
    var r = await Promise.all([c.rpc('app_whoami'), c.rpc('tc_yo'), c.rpc('mis_ajustes')]);
    var w = r[0], t = r[1];
    // v20261113d (SQL 116): si a esta persona le ocultaron «Compras de obra», no ve la sección Obras
    var ajO = r[2] && !r[2].error && r[2].data && r[2].data.ajustes ? r[2].data.ajustes['ob.compras'] : null;
    if (w.error && (t.error || !t.data)) { estado('No se pudo verificar tu usuario: ' + esc(w.error.message) + '<br><br><a href="">Reintentar</a>'); return; }
    var rol = w.data ? (w.data.rol === 'consulta' ? 'lectura' : w.data.rol) : '';
    var accObras = ROLES.indexOf(rol) >= 0 && ajO !== 'oculto';
    var yoT = !t.error && t.data ? t.data : null;
    var accTaller = !!(yoT && yoT.ver);
    try {
      if (w.data) localStorage.setItem('tecsul_acceso_obras', '1');
      if (accObras || accTaller) localStorage.setItem('tecsul_compras', '1'); else localStorage.removeItem('tecsul_compras');
    } catch (e) {}
    if (!accObras && !accTaller) {
      $('#btn-obras').hidden = !w.data;
      estado('Tu usuario no tiene acceso al módulo de Compras.<br>Compras de obras: roles <b>Compras</b>, <b>Gerente</b> y <b>Administrador</b> de Obras.<br>' +
        'Compras de taller: personal de taller, administradores de obra, bodega central y autorizadores.<br><br>' +
        (w.data ? 'Los pedidos de tu obra se cargan en <a href="../index.html?obras=1">Obras › Compras</a>.' : '<a href="../index.html">Volver a la app</a>'));
      return;
    }
    $('#btn-obras').hidden = !w.data;
    window.__role = accObras ? rol : '';
    window.YO_SOY = (w.data && (w.data.nombre || w.data.email)) || (yoT && yoT.nombre) || '';
    window.__email = (w.data && w.data.email) || (yoT && yoT.email) || '';
    $('#hdr-usuario').textContent = window.YO_SOY + (accObras ? ' · ' + (rol === 'gerente' ? 'gerente (solo ver)' : rol === 'compras' ? 'compras' : 'administrador') : '');

    var abiertas = {};
    function ir(sec) {
      if (['obras', 'taller', 'ucc'].indexOf(sec) < 0) sec = accObras ? 'obras' : 'taller';
      if (sec === 'obras' && !accObras) sec = 'taller';
      if ((sec === 'taller' || sec === 'ucc') && !accTaller) sec = 'obras';
      try { localStorage.setItem('compras_seccion', sec); } catch (e) {}
      $('#v-compras').hidden = sec !== 'obras';
      $('#v-taller').hidden = sec !== 'taller';
      $('#v-ucc').hidden = sec !== 'ucc';
      $$('#secciones button').forEach(function (bt) { bt.classList.toggle('on', bt.getAttribute('data-sec') === sec); });
      document.title = (sec === 'taller' ? 'Compras de taller' : sec === 'ucc' ? 'Compras estratégicas UCC' : 'Compras') + ' - Tecsul';
      if (abiertas[sec]) return;
      abiertas[sec] = true;
      if (sec === 'obras') {
        if (!window.ComprasView || !window.ComprasView.abrirModulo) { estado('Falta compras.js actualizado (v20261102a).'); return; }
        window.ComprasView.abrirModulo();
      } else if (sec === 'ucc') {
        if (!window.ComprasUCC) { $('#v-ucc').innerHTML = '<div class="estado">Falta compras/taller.js actualizado (v20261112c).</div>'; return; }
        window.ComprasUCC.abrir($('#v-ucc'));
      } else {
        if (!window.TallerCompras) { $('#v-taller').innerHTML = '<div class="estado">Falta compras/taller.js.</div>'; return; }
        window.TallerCompras.abrir($('#v-taller'));
      }
    }
    // con Taller hay siempre dos secciones (Taller y Estratégicas UCC); Obras se suma si tiene rol en Obras
    if (accTaller) {
      $('#secciones').hidden = false;
      $$('#secciones button').forEach(function (bt) {
        bt.hidden = bt.getAttribute('data-sec') === 'obras' && !accObras;
        bt.onclick = function () { ir(bt.getAttribute('data-sec')); };
      });
    }
    var pedida = (new URLSearchParams(location.search)).get('s');
    var guardada = ''; try { guardada = localStorage.getItem('compras_seccion') || ''; } catch (e) {}
    ir(['taller', 'obras', 'ucc'].indexOf(pedida) >= 0 ? pedida : guardada || (accObras ? 'obras' : 'taller'));
  }

  async function salir() {
    if (!confirm('¿Cerrar sesión?')) return;
    try { await sb().auth.signOut(); } catch (e) {}
    try { ['perfil', 'tecsul_acceso_obras', 'tecsul_rol_equipos', 'tecsul_rrhh', 'tecsul_compras', 'tecsul_ajustes'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
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
      apps.push(['🛒', 'Compras', 'esta app · obras, taller y estratégicas UCC', null]);
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
