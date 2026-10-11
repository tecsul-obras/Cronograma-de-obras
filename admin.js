/* =========================================================================
 * admin.js — Pestaña ADMINISTRACIÓN (solo admin) · v20261011a
 *
 *  Una sola pantalla para las personas de toda la app:
 *  - su cuenta de acceso (cédula o correo + contraseña),
 *  - su rol en OBRAS (cronograma, producción, certificación, compras…),
 *  - su rol en EQUIPOS (parte diario, flota, taller, combustible, alquileres).
 *  Por dentro siguen las dos tablas de permisos (usuario y perfiles), que son
 *  las que usan las reglas de la base (SQL 31). La cuenta y las contraseñas
 *  van por la Edge Function «usuarios».
 *  No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function fdt(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('es-PY') + ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }); }
  var CAMPO = '@campo.tecsul.com.py';
  function usuarioVisible(email) { email = String(email || ''); return email.slice(-CAMPO.length) === CAMPO ? email.slice(0, -CAMPO.length) : email; }

  var ROLES = [
    ['admin', 'Administrador', 'Todo, en todas las obras. Usuarios, maestros, obras nuevas.'],
    ['residente', 'Residente', 'Carga y corrige todo en sus obras (cronograma, producción, certificación, compras…).'],
    ['compras', 'Compras', 'Ve todas las obras. En Compras carga pedidos, cotiza, registra OC y entregas. Lo demás, solo ver.'],
    ['gerente', 'Gerente', 'Ve todas las obras, no carga datos. Aprueba pedidos y cotizaciones (sin su aprobación no hay OC).'],
    ['lectura', 'Solo lectura', 'Ve sus obras, no modifica nada.'],
    ['transporte', 'Campo · Transporte', 'Solo la pestaña Transporte, en las obras asignadas. Entra con su cédula.'],
    ['produccion', 'Campo · Producción', 'Solo la pestaña Producción, en las obras asignadas. Entra con su cédula.']
  ];
  var NOM_ROL = {}; ROLES.forEach(function (r) { NOM_ROL[r[0]] = r[1]; });
  var ROLES_EQ = [
    ['operador', 'Operador', 'Carga sus partes y ve solo los suyos (puede corregirlos dentro de las 24 h).'],
    ['admin_obra', 'Admin de obra', 'Carga y corrige los partes de sus frentes. Ve flota, OT, combustible y mantenimiento.'],
    ['taller', 'Taller', 'Ve todos los partes. Administra flota, OT, combustible, mantenimiento, alquileres, seguros y personal.'],
    ['admin_central', 'Admin central', 'Todo en equipos: todas las obras, certificado de máquinas, asistente y usuarios.']
  ];
  var NOM_EQ = {}; ROLES_EQ.forEach(function (r) { NOM_EQ[r[0]] = r[1]; });
  var FORMULARIOS = [
    ['', 'Automático (según especialidad)'], ['parte', 'Parte diario'], ['taller', 'Taller'],
    ['combustible', 'Combustible'], ['parte,combustible', 'Parte + combustible'],
    ['parte,taller', 'Parte + taller'], ['taller,combustible', 'Taller + combustible'],
    ['parte,taller,combustible', 'Los tres']];
  // ✎ carga · 👁 ve · ✓ aprueba · — no ve
  var MATRIZ = [
    ['Cronograma / Plan semanal', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '—', produccion: '—' }],
    ['Producción', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '—', produccion: '✎' }],
    ['Certificación / Cómputo / Convenios', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '—', produccion: '—' }],
    ['Transporte (cargas)', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '✎ (lo suyo)', produccion: '—' }],
    ['Transporte › stock (conteos)', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '👁', produccion: '—' }],
    ['Transporte › maestro de camiones', { admin: '✎', residente: '👁', compras: '—', gerente: '—', lectura: '—', transporte: '—', produccion: '—' }],
    ['Compras › pedidos y cotizaciones', { admin: '✎ ✓', residente: '✎', compras: '✎ (todas las obras)', gerente: '✓ aprueba', lectura: '👁', transporte: '—', produccion: '—' }],
    ['Compras › orden de compra', { admin: '✎', residente: '✎', compras: '✎', gerente: '👁', lectura: '👁', transporte: '—', produccion: '—' }],
    ['Comunicaciones (+ adjuntos)', { admin: '✎', residente: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '—', produccion: '—' }],
    ['Administración', { admin: '✎', residente: '—', compras: '—', gerente: '—', lectura: '—', transporte: '—', produccion: '—' }]
  ];

  var P = null, OBRAS = [], FRENTES = [], ED = null, FIL = '', VER = '';

  function estilos() {
    if ($('#admCss')) return;
    var st = document.createElement('style'); st.id = 'admCss';
    st.textContent = [
      '#v-admin{overflow:auto;background:#f4f6f9}',
      '.adm-wrap{padding:14px 18px 40px;max-width:1500px;margin:0 auto;color:#1f2937}',
      '.adm-card{background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:14px 16px;margin-bottom:14px}',
      '.adm-card h2{margin:0 0 10px;font-size:15px;color:#1a2744}',
      '.adm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.adm-bar input,.adm-bar select{font:inherit;font-size:13px;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px}',
      '.adm-bar input{min-width:240px}',
      '.adm-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer}',
      '.adm-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}',
      '.adm-btn:disabled{opacity:.6;cursor:default}',
      '.adm-tw{overflow:auto}',
      '.adm-t{width:100%;border-collapse:collapse;font-size:13px}',
      '.adm-t th{background:#f0f2f5;font-size:10.5px;text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;white-space:nowrap}',
      '.adm-t td{padding:6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.adm-chip{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#eef2f7;color:#2c4a8a;white-space:nowrap}',
      '.adm-chip.admin,.adm-chip.admin_central{background:#1a2744;color:#fff}.adm-chip.gerente{background:#fdecea;color:#b03a2e}.adm-chip.compras{background:#fff4e0;color:#9a6200}',
      '.adm-chip.transporte,.adm-chip.produccion,.adm-chip.operador{background:#e3f6ea;color:#1e7a43}',
      '.adm-chip.taller{background:#fff1e6;color:#b4570a}.adm-chip.off{background:#f0f0f0;color:#888;text-decoration:line-through}',
      '.adm-sub{display:block;font-size:11.5px;color:#6b7686;margin-top:2px;max-width:300px}',
      '.adm-ok{color:#1e7a43;font-weight:700}.adm-mal{color:#c0392b;font-weight:700}.adm-gris{color:#9aa4b2}',
      '.adm-mx td,.adm-mx th{text-align:center}.adm-mx td:first-child,.adm-mx th:first-child{text-align:left}',
      '.adm-info{font-size:12.5px;color:#4a5568;background:#f0f4fa;border-radius:8px;padding:8px 10px;margin-bottom:10px}',
      '.adm-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow:auto}',
      '.adm-box{background:#fff;border-radius:12px;max-width:720px;width:100%;padding:16px 18px;color:#1f2937}',
      '.adm-sec{border:1px solid #e1e6ee;border-radius:10px;padding:10px 12px;margin-bottom:12px}',
      '.adm-sec h4{margin:0 0 8px;font-size:13.5px;color:#1a2744}',
      '.adm-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
      '.adm-f label,.adm-lab{font-size:11.5px;font-weight:700;color:#4a5568;text-transform:uppercase}',
      '.adm-f input,.adm-f select{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px}',
      '.adm-f small{color:#7a8699;font-size:12px}',
      '.adm-fila{display:flex;gap:8px;align-items:center}',
      '.adm-obras{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 10px;max-height:200px;overflow:auto;border:1px solid #e1e6ee;border-radius:8px;padding:8px}',
      '.adm-obras label{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:400;text-transform:none;color:#1f2937}',
      '.adm-chk{display:flex;gap:6px;align-items:center;font-size:14px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function nomObra(id) { var o = OBRAS.filter(function (x) { return x.obra_id === id; })[0]; return o ? o.nombre : id; }
  function nomFrente(clave) { return String(clave || '').replace(/^[^_]*_\s*/, ''); }
  function celdaObras(p) {
    if (!p.ob_rol) return '<span class="adm-gris">—</span>';
    var obras = (p.ob_obras || []).length ? p.ob_obras.map(function (o) { return esc(nomObra(o)); }).join(', ') : 'todas las obras';
    return '<span class="adm-chip ' + esc(p.ob_rol) + (p.ob_activo === false ? ' off' : '') + '">' + esc(NOM_ROL[p.ob_rol] || p.ob_rol) + '</span><span class="adm-sub">' + obras + '</span>';
  }
  function celdaEquipos(p) {
    if (!p.eq_rol) return '<span class="adm-gris">—</span>';
    var det = p.eq_rol === 'admin_obra' ? ((p.eq_obras || []).map(nomFrente).map(esc).join(', ') || '<span class="adm-mal">sin frentes</span>')
            : p.eq_rol === 'operador' ? 'sus partes' : 'todas las obras';
    return '<span class="adm-chip ' + esc(p.eq_rol) + (p.eq_activo === false ? ' off' : '') + '">' + esc(NOM_EQ[p.eq_rol] || p.eq_rol) + '</span><span class="adm-sub">' + det + '</span>';
  }

  function visibles() {
    var t = FIL.trim().toLowerCase();
    return P.filter(function (p) {
      if (VER === 'obras' && !p.ob_rol) return false;
      if (VER === 'equipos' && !p.eq_rol) return false;
      if (VER === 'nada' && (p.ob_rol || p.eq_rol)) return false;
      if (VER === 'sincuenta' && p.tiene_acceso) return false;
      return !t || [p.nombre, p.email, p.ob_rol, NOM_ROL[p.ob_rol], p.eq_rol, NOM_EQ[p.eq_rol]].join(' ').toLowerCase().indexOf(t) >= 0;
    });
  }

  function render() {
    var v = $('#v-admin'); if (!v) return;
    estilos();
    if (global.__role !== 'admin') { v.innerHTML = '<div class="adm-wrap"><div class="adm-card">Solo el administrador ve esta pestaña.</div></div>'; return; }
    if (!P) { v.innerHTML = '<div class="adm-wrap"><div class="adm-card">Cargando personas…</div></div>'; return; }
    var nOb = P.filter(function (p) { return p.ob_rol && p.ob_activo !== false; }).length;
    var nEq = P.filter(function (p) { return p.eq_rol && p.eq_activo !== false; }).length;
    var opt = function (v, t) { return '<option value="' + v + '"' + (VER === v ? ' selected' : '') + '>' + t + '</option>'; };
    var h = '<div class="adm-wrap"><div class="adm-card"><h2>👥 Personas <small style="font-weight:400;color:#7a8699">' + nOb + ' con acceso a Obras · ' + nEq + ' a Equipos</small></h2>' +
      '<div class="adm-info">Una persona = <b>una cuenta</b> (cédula o correo, y su contraseña) que sirve para toda la app. ' +
      'En cada persona se decide <b>qué ve en Obras</b> (cronograma, producción, certificación, compras…) y <b>qué ve en Equipos</b> (parte diario, flota, taller, combustible, alquileres). ' +
      'Los de campo entran con su <b>cédula</b>.</div>' +
      '<div class="adm-bar"><input type="search" id="admBusca" placeholder="Buscar nombre, cédula, correo o rol…" value="' + esc(FIL) + '">' +
      '<select id="admVer">' + opt('', 'Todas') + opt('obras', 'Con acceso a Obras') + opt('equipos', 'Con acceso a Equipos') + opt('nada', 'Sin ningún rol') + opt('sincuenta', 'Sin cuenta creada') + '</select>' +
      '<span style="flex:1"></span><button class="adm-btn pri" id="admNuevo">＋ Persona</button></div>' +
      '<div class="adm-tw"><table class="adm-t"><thead><tr><th>Nombre</th><th>Usuario</th><th>Obras</th><th>Equipos</th><th>Cuenta</th><th>Último ingreso</th><th></th></tr></thead><tbody>';
    var L = visibles();
    h += L.map(function (p) {
      return '<tr><td><b>' + esc(p.nombre || '—') + '</b>' + (p.email === (global.ObraAPI && global.ObraAPI.miEmail ? global.ObraAPI.miEmail() : '') ? ' <small>(vos)</small>' : '') + '</td>' +
        '<td>' + esc(usuarioVisible(p.email)) + '</td><td>' + celdaObras(p) + '</td><td>' + celdaEquipos(p) + '</td>' +
        '<td>' + (p.tiene_acceso ? '<span class="adm-ok" title="Tiene usuario y contraseña">✓</span>' : '<span class="adm-mal" title="Falta crear la cuenta: abrí ✎ y poné una contraseña">⚠ sin cuenta</span>') + '</td>' +
        '<td>' + fdt(p.ultimo_ingreso) + '</td><td><button class="adm-btn" data-ped="' + esc(p.email) + '">✎</button></td></tr>';
    }).join('') || '<tr><td colspan="7" class="adm-gris">Nadie coincide con el filtro.</td></tr>';
    h += '</tbody></table></div><div class="adm-gris" style="font-size:12px;margin-top:6px">' + L.length + ' de ' + P.length + ' personas</div></div>';
    h += '<div class="adm-card"><h2>🔐 Qué puede hacer cada rol en Obras</h2><div class="adm-info">✎ carga y corrige · ✓ aprueba · 👁 solo ve · — no ve la pestaña.</div><div class="adm-tw"><table class="adm-t adm-mx"><thead><tr><th>Pestaña / función</th>' +
      ROLES.map(function (r) { return '<th>' + esc(r[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      MATRIZ.map(function (m) { return '<tr><td>' + esc(m[0]) + '</td>' + ROLES.map(function (r) { return '<td>' + esc(m[1][r[0]] || '—') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="adm-tw" style="margin-top:10px"><table class="adm-t"><tbody>' + ROLES.map(function (r) { return '<tr><td style="white-space:nowrap"><span class="adm-chip ' + r[0] + '">' + esc(r[1]) + '</span></td><td>' + esc(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    h += '<div class="adm-card"><h2>🚜 Roles en Equipos</h2><div class="adm-tw"><table class="adm-t"><tbody>' +
      ROLES_EQ.map(function (r) { return '<tr><td style="white-space:nowrap"><span class="adm-chip ' + r[0] + '">' + esc(r[1]) + '</span></td><td>' + esc(r[2]) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
    v.innerHTML = h;
    enlazar();
  }

  function claveAzar() { return String(Math.floor(100000 + Math.random() * 900000)); }

  function modal() {
    var p = ED, nuevo = !p.email;
    var m = document.createElement('div'); m.className = 'adm-modal';
    var obSel = p.ob_obras || [], eqSel = p.eq_obras || [];
    var formAct = (p.eq_formularios || []).join(',');
    m.innerHTML = '<div class="adm-box"><h3 style="margin:0 0 12px;color:#1a2744">' + (nuevo ? '＋ Persona nueva' : '✎ ' + esc(p.nombre || usuarioVisible(p.email))) + '</h3>' +
      '<div class="adm-sec"><h4>👤 Cuenta</h4>' +
        '<div class="adm-f"><label>Cédula o correo</label><input id="apUsr" value="' + esc(usuarioVisible(p.email)) + '"' + (nuevo ? '' : ' disabled') + ' placeholder="4123456  ·  nombre@tecsul.com.py">' +
          (nuevo ? '<small>Los de campo entran con la cédula; los de oficina, con su correo.</small>' : '') + '</div>' +
        '<div class="adm-f"><label>Nombre</label><input id="apNom" value="' + esc(p.nombre || '') + '"></div>' +
        (p.tiene_acceso
          ? '<div class="adm-f"><label>Contraseña</label><div class="adm-fila"><input id="apClave" placeholder="Nueva contraseña (mín. 6)" autocomplete="off" style="flex:1"><button class="adm-btn" id="apCambiar">Cambiar</button></div>' +
            '<small>Si se la olvidó: le ponés una nueva y se la pasás. Los de oficina también pueden usar «Olvidé mi contraseña».</small></div>'
          : '<div class="adm-f"><label>Contraseña inicial</label><input id="apClave" value="' + claveAzar() + '" autocomplete="off">' +
            '<small>' + (nuevo ? 'Se crea la cuenta con esta contraseña. Pasásela a la persona.' : '⚠ Esta persona todavía no tiene cuenta: se crea al guardar.') + '</small></div>') +
      '</div>' +
      '<div class="adm-sec"><h4>📅 Obras <small style="font-weight:400;color:#7a8699">cronograma, producción, certificación, compras…</small></h4>' +
        '<div class="adm-f"><label>Rol</label><select id="apObRol"><option value="">Sin acceso a Obras</option>' +
          ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (p.ob_rol === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select><small id="apObTx"></small></div>' +
        '<div id="apObMas"><div class="adm-f"><span class="adm-lab">Obras que ve <small style="text-transform:none;font-weight:400">(ninguna marcada = todas; los de campo necesitan al menos una)</small></span><div class="adm-obras" id="apObObras">' +
          OBRAS.map(function (o) { return '<label><input type="checkbox" value="' + esc(o.obra_id) + '"' + (obSel.indexOf(o.obra_id) >= 0 ? ' checked' : '') + '>' + esc(o.nombre) + '</label>'; }).join('') + '</div></div>' +
        '<label class="adm-chk"><input type="checkbox" id="apObAct"' + (p.ob_activo !== false ? ' checked' : '') + '> Activo en Obras</label></div>' +
      '</div>' +
      '<div class="adm-sec"><h4>🚜 Equipos <small style="font-weight:400;color:#7a8699">parte diario, flota, taller, combustible, alquileres</small></h4>' +
        '<div class="adm-f"><label>Rol</label><select id="apEqRol"><option value="">Sin acceso a Equipos</option>' +
          ROLES_EQ.map(function (r) { return '<option value="' + r[0] + '"' + (p.eq_rol === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select><small id="apEqTx"></small></div>' +
        '<div id="apEqMas"><div class="adm-f" id="apEqFrCampo"><span class="adm-lab">Frentes que ve</span><div class="adm-obras" id="apEqObras">' +
          FRENTES.map(function (f) { return '<label><input type="checkbox" value="' + esc(f.clave) + '"' + (eqSel.indexOf(f.clave) >= 0 ? ' checked' : '') + '>' + esc(nomFrente(f.clave)) + '</label>'; }).join('') + '</div></div>' +
          '<div class="adm-f"><label>Formularios</label><select id="apEqForm">' + FORMULARIOS.map(function (f) { return '<option value="' + f[0] + '"' + (formAct === f[0] ? ' selected' : '') + '>' + esc(f[1]) + '</option>'; }).join('') + '</select>' +
          '<small>«Automático»: operador → parte; mecánico, electricista, gomero, supervisor → taller; despachador → combustible.</small></div>' +
        '<label class="adm-chk"><input type="checkbox" id="apEqAct"' + (p.eq_activo !== false ? ' checked' : '') + '> Activo en Equipos</label></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="adm-btn" id="apNo">Cancelar</button><button class="adm-btn pri" id="apSi">Guardar</button></div></div>';
    document.body.appendChild(m);

    function refrescar() {
      var ob = $('#apObRol', m).value, eq = $('#apEqRol', m).value;
      var r1 = ROLES.filter(function (x) { return x[0] === ob; })[0], r2 = ROLES_EQ.filter(function (x) { return x[0] === eq; })[0];
      $('#apObTx', m).textContent = r1 ? r1[2] : 'No entra a Obras.';
      $('#apEqTx', m).textContent = r2 ? r2[2] : 'No entra a Equipos.';
      $('#apObMas', m).style.display = ob ? '' : 'none';
      $('#apEqMas', m).style.display = eq ? '' : 'none';
      $('#apEqFrCampo', m).style.display = eq === 'admin_obra' ? '' : 'none';
    }
    $('#apObRol', m).onchange = refrescar; $('#apEqRol', m).onchange = refrescar; refrescar();
    $('#apNo', m).onclick = function () { m.remove(); ED = null; };

    var bc = $('#apCambiar', m);
    if (bc) bc.onclick = async function () {
      var c = $('#apClave', m).value || '';
      if (c.length < 6) { alert('La contraseña tiene que tener al menos 6 caracteres.'); return; }
      bc.disabled = true;
      try { await global.ObraAPI.admFuncionUsuarios({ accion: 'clave', id: p.id, clave: c }); $('#apClave', m).value = ''; toast('Contraseña cambiada. Pasásela a la persona.'); }
      catch (e) { alert(e.message || String(e)); }
      bc.disabled = false;
    };

    $('#apSi', m).onclick = async function () {
      var usr = ($('#apUsr', m).value || '').trim().toLowerCase();
      var nombre = ($('#apNom', m).value || '').trim();
      var obRol = $('#apObRol', m).value, eqRol = $('#apEqRol', m).value;
      var obObras = $$('#apObObras input:checked', m).map(function (c) { return c.value; });
      var eqObras = $$('#apEqObras input:checked', m).map(function (c) { return c.value; });
      var form = $('#apEqForm', m).value;
      if (!usr) { alert('Falta la cédula o el correo.'); return; }
      if (!nombre) { alert('Falta el nombre.'); return; }
      if ((obRol === 'transporte' || obRol === 'produccion') && !obObras.length) { alert('A los usuarios de campo de Obras hay que asignarles al menos una obra.'); return; }
      if (eqRol === 'admin_obra' && !eqObras.length) { alert('Un admin de obra de Equipos necesita al menos un frente.'); return; }
      var b = $('#apSi', m); b.disabled = true; b.textContent = 'Guardando…';
      var hecho = [];
      try {
        var id = p.id, email = p.email;
        // 1. Cuenta (si no tiene): con la contraseña inicial
        if (!p.tiene_acceso) {
          var c = $('#apClave', m).value || '';
          if (c.length < 6) throw new Error('La contraseña inicial tiene que tener al menos 6 caracteres.');
          var cu = await global.ObraAPI.admFuncionUsuarios({ accion: 'cuenta', usuario: usr, nombre: nombre, clave: c });
          id = cu.id; email = cu.email;
          hecho.push(cu.ya_existia ? 'la cuenta ya existía' : 'cuenta creada');
        }
        email = email || usr;
        // 2. Obras
        if (obRol) {
          await global.ObraAPI.admUsuarioGuardar({ email: email, nombre: nombre, rol: obRol, activo: $('#apObAct', m).checked, obras: obObras });
          hecho.push('Obras: ' + NOM_ROL[obRol]);
        } else if (p.ob_rol) {
          await global.ObraAPI.admUsuarioQuitar(email);
          hecho.push('sin acceso a Obras');
        }
        // 3. Equipos
        var eqCambio = eqRol !== (p.eq_rol || '') || eqRol && (
          nombre !== (p.nombre || '') || $('#apEqAct', m).checked !== (p.eq_activo !== false) ||
          form !== (p.eq_formularios || []).join(',') || eqObras.slice().sort().join('|') !== (p.eq_obras || []).slice().sort().join('|'));
        if (eqCambio) {
          await global.ObraAPI.admPerfilGuardar({ id: id, rol: eqRol, nombre: nombre, cedula: p.eq_cedula || usuarioVisible(email).split('@')[0],
            obras: eqRol === 'admin_obra' ? eqObras : [], formularios: form ? form.split(',') : [], activo: $('#apEqAct', m).checked });
          hecho.push(eqRol ? 'Equipos: ' + NOM_EQ[eqRol] : 'sin acceso a Equipos');
        }
        m.remove(); ED = null;
        toast('Guardado <b>' + esc(nombre) + '</b>' + (hecho.length ? ' — ' + esc(hecho.join(' · ')) : ''));
        if (!p.tiene_acceso) toast('Usuario: <b>' + esc(usuarioVisible(email)) + '</b> · contraseña inicial: <b>' + esc($('#apClave', m).value) + '</b>');
        await cargar();
      } catch (e) {
        alert((hecho.length ? 'Se hizo: ' + hecho.join(' · ') + '.\n\nPero falló: ' : '') + (e.message || String(e)));
        b.disabled = false; b.textContent = 'Guardar';
        if (hecho.length) { m.remove(); ED = null; await cargar(); }
      }
    };
  }

  function enlazar() {
    var e;
    if ((e = $('#admBusca'))) e.oninput = function () { FIL = this.value; var pos = this.selectionStart; render(); var e2 = $('#admBusca'); if (e2) { e2.focus(); e2.setSelectionRange(pos, pos); } };
    if ((e = $('#admVer'))) e.onchange = function () { VER = this.value; render(); };
    if ((e = $('#admNuevo'))) e.onclick = function () { ED = { tiene_acceso: false, ob_rol: '', eq_rol: '', ob_obras: [], eq_obras: [] }; modal(); };
    $$('[data-ped]').forEach(function (b) {
      b.onclick = function () {
        var p = P.filter(function (x) { return x.email === b.getAttribute('data-ped'); })[0]; if (!p) return;
        ED = Object.assign({}, p); modal();
      };
    });
  }

  async function cargar() {
    try {
      var sb = global.ObraAPI._sb && global.ObraAPI._sb();
      var r = await Promise.all([
        global.ObraAPI.admPersonas(),
        global.ObraAPI.listObras(),
        sb ? sb.from('obras').select('clave,activa').order('clave') : Promise.resolve({ data: [] })
      ]);
      P = r[0]; OBRAS = r[1]; FRENTES = (r[2] && r[2].data || []).filter(function (f) { return f.activa !== false; });
    } catch (e) {
      var v = $('#v-admin');
      if (v) v.innerHTML = '<div class="adm-wrap"><div class="adm-card">No se pudieron cargar las personas: ' + esc(e.message) +
        (/adm_personas|function|schema/i.test(e.message || '') ? '<br>Falta correr en Supabase el SQL <b>31_admin_unificado.sql</b>.' : '') + '</div></div>';
      return;
    }
    render();
  }
  function abrir() { P = null; render(); cargar(); }
  function enganchar() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'admin') abrir(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  global.AdminView = { abrir: abrir };
})(window);
