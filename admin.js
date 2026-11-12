/* =========================================================================
 * admin.js — Pestaña ADMINISTRACIÓN de Obras · v20261112g
 *
 *  Monta la pantalla única de usuarios (usuarios.js, SQL 113): la misma
 *  que se ve en Equipos › Administración › Usuarios. Ahí está todo lo de
 *  cada persona: cuenta, rol en Obras, rol en Equipos, formularios a
 *  medida, compras de taller, plantas, responsable de máquinas, aprobador
 *  de partes certificados y recursos humanos.
 *  No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';
  function abrir() {
    var v = document.getElementById('v-admin'); if (!v) return;
    if (global.__role !== 'admin') { v.innerHTML = '<div style="padding:18px">Solo el administrador ve esta pestaña.</div>'; return; }
    if (!global.UsuariosAdm) { v.innerHTML = '<div style="padding:18px">Falta usuarios.js — recargá la página.</div>'; return; }
    var sb = global.ObraAPI && global.ObraAPI._sb && global.ObraAPI._sb();
    var yo = global.ObraAPI && global.ObraAPI.miEmail ? global.ObraAPI.miEmail() : '';
    global.UsuariosAdm.montar(v, sb, { yo: yo });
  }
  function enganchar() {
    var tabs = document.getElementById('tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'admin') abrir(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  global.AdminView = { abrir: abrir };
})(window);
