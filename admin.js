/* =========================================================================
 * admin.js — Pestaña ADMINISTRACIÓN (solo admin) · v20261006d
 *
 *  - Usuarios: nombre, correo (o cédula para los de campo), rol, obras que ve,
 *    activo, si ya tiene acceso creado y último ingreso. Alta y corrección.
 *  - Qué puede hacer cada rol, pestaña por pestaña.
 *  El ACCESO (contraseña) se crea en Supabase › Authentication › Add user con
 *  el mismo correo; acá se decide qué ve y qué hace (SQL 23).
 *  No toca app.js: escucha el click de su pestaña.
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t) { if (global.toast) global.toast(t); else alert(String(t).replace(/<[^>]+>/g, '')); }
  function fdt(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('es-PY') + ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }); }

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

  var U = null, OBRAS = [], ED = null, FIL = '';

  function estilos() {
    if ($('#admCss')) return;
    var st = document.createElement('style'); st.id = 'admCss';
    st.textContent = [
      '#v-admin{overflow:auto;background:#f4f6f9}',
      '.adm-wrap{padding:14px 18px 40px;max-width:1500px;margin:0 auto;color:#1f2937}',
      '.adm-card{background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:14px 16px;margin-bottom:14px}',
      '.adm-card h2{margin:0 0 10px;font-size:15px;color:#1a2744}',
      '.adm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
      '.adm-bar input{font:inherit;font-size:13px;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;min-width:260px}',
      '.adm-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer}',
      '.adm-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}',
      '.adm-tw{overflow:auto}',
      '.adm-t{width:100%;border-collapse:collapse;font-size:13px}',
      '.adm-t th{background:#f0f2f5;font-size:10.5px;text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;white-space:nowrap}',
      '.adm-t td{padding:6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.adm-t tr.off td{opacity:.5}',
      '.adm-chip{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:#eef2f7;color:#2c4a8a;white-space:nowrap}',
      '.adm-chip.admin{background:#1a2744;color:#fff}.adm-chip.gerente{background:#fdecea;color:#b03a2e}.adm-chip.compras{background:#fff4e0;color:#9a6200}',
      '.adm-chip.transporte,.adm-chip.produccion{background:#e3f6ea;color:#1e7a43}',
      '.adm-ok{color:#1e7a43;font-weight:700}.adm-mal{color:#c0392b;font-weight:700}',
      '.adm-mx td,.adm-mx th{text-align:center}.adm-mx td:first-child,.adm-mx th:first-child{text-align:left}',
      '.adm-info{font-size:12.5px;color:#4a5568;background:#f0f4fa;border-radius:8px;padding:8px 10px;margin-bottom:10px}',
      '.adm-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow:auto}',
      '.adm-box{background:#fff;border-radius:12px;max-width:640px;width:100%;padding:16px 18px;color:#1f2937}',
      '.adm-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
      '.adm-f label,.adm-lab{font-size:11.5px;font-weight:700;color:#4a5568;text-transform:uppercase}',
      '.adm-f input,.adm-f select{font:inherit;font-size:14px;padding:8px 9px;border:1px solid #c9d1dc;border-radius:8px}',
      '.adm-obras{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 10px;max-height:240px;overflow:auto;border:1px solid #e1e6ee;border-radius:8px;padding:8px}',
      '.adm-obras label{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:400;text-transform:none;color:#1f2937}',
      '.adm-rol small{display:block;color:#7a8699;font-size:12px;margin-top:3px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function render() {
    var v = $('#v-admin'); if (!v) return;
    estilos();
    if (global.__role !== 'admin') { v.innerHTML = '<div class="adm-wrap"><div class="adm-card">Solo el administrador ve esta pestaña.</div></div>'; return; }
    if (!U) { v.innerHTML = '<div class="adm-wrap"><div class="adm-card">Cargando usuarios…</div></div>'; return; }
    var nomObra = {}; OBRAS.forEach(function (o) { nomObra[o.obra_id] = o.nombre; });
    var t = FIL.trim().toLowerCase();
    var L = U.filter(function (u) { return !t || [u.nombre, u.email, u.rol, NOM_ROL[u.rol]].join(' ').toLowerCase().indexOf(t) >= 0; });
    var h = '<div class="adm-wrap"><div class="adm-card"><h2>👥 Usuarios <small style="font-weight:400;color:#7a8699">' + U.filter(function (u) { return u.activo; }).length + ' activos</small></h2>' +
      '<div class="adm-info">Acá se decide <b>qué ve y qué hace</b> cada uno. La <b>contraseña</b> se crea en Supabase › Authentication › Users › <i>Add user</i> con el mismo correo (marcá «Auto Confirm User»). ' +
      'Los de campo entran con su cédula: el correo es <code>&lt;cédula&gt;@campo.tecsul.com.py</code>. La columna «Acceso» avisa si todavía falta crearlo.</div>' +
      '<div class="adm-bar"><input type="search" id="admBusca" placeholder="Buscar nombre, correo o rol…" value="' + esc(FIL) + '"><span style="flex:1"></span><button class="adm-btn pri" id="admNuevo">＋ Usuario</button></div>' +
      '<div class="adm-tw"><table class="adm-t"><thead><tr><th>Nombre</th><th>Correo / usuario</th><th>Rol</th><th>Obras que ve</th><th>Acceso</th><th>Último ingreso</th><th></th></tr></thead><tbody>' +
      L.map(function (u) {
        var obras = (u.obras || []).length ? u.obras.map(function (o) { return esc(nomObra[o] || o); }).join(', ') : '<i>todas</i>';
        return '<tr' + (u.activo ? '' : ' class="off"') + '><td><b>' + esc(u.nombre || '—') + '</b>' + (u.activo ? '' : ' <small>(inactivo)</small>') + '</td><td>' + esc(u.email) + '</td>' +
          '<td><span class="adm-chip ' + esc(u.rol) + '">' + esc(NOM_ROL[u.rol] || u.rol) + '</span></td><td style="max-width:320px">' + obras + '</td>' +
          '<td>' + (u.tiene_acceso ? '<span class="adm-ok">✓</span>' : '<span class="adm-mal" title="Crear el usuario en Supabase › Authentication">⚠ falta crear</span>') + '</td>' +
          '<td>' + fdt(u.ultimo_ingreso) + '</td><td><button class="adm-btn" data-ued="' + esc(u.email) + '">✎</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="adm-card"><h2>🔐 Qué puede hacer cada rol</h2><div class="adm-info">✎ carga y corrige · ✓ aprueba · 👁 solo ve · — no ve la pestaña.</div><div class="adm-tw"><table class="adm-t adm-mx"><thead><tr><th>Pestaña / función</th>' +
      ROLES.map(function (r) { return '<th>' + esc(r[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      MATRIZ.map(function (m) { return '<tr><td>' + esc(m[0]) + '</td>' + ROLES.map(function (r) { return '<td>' + esc(m[1][r[0]] || '—') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="adm-tw" style="margin-top:10px"><table class="adm-t"><tbody>' + ROLES.map(function (r) { return '<tr><td style="white-space:nowrap"><span class="adm-chip ' + r[0] + '">' + esc(r[1]) + '</span></td><td>' + esc(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></div></div>';
    v.innerHTML = h;
    enlazar();
  }

  function modal() {
    var u = ED, nuevo = !u.email_orig;
    var m = document.createElement('div'); m.className = 'adm-modal';
    var sel = u.obras || [];
    m.innerHTML = '<div class="adm-box"><h3 style="margin:0 0 10px;color:#1a2744">' + (nuevo ? '＋ Usuario nuevo' : '✎ ' + esc(u.nombre || u.email)) + '</h3>' +
      '<div class="adm-f"><label>Correo (o cédula, para los de campo)</label><input id="auEmail" value="' + esc(u.email || '') + '"' + (nuevo ? '' : ' disabled') + ' placeholder="nombre@tecsul.com.py  ·  4123456"></div>' +
      '<div class="adm-f"><label>Nombre</label><input id="auNom" value="' + esc(u.nombre || '') + '"></div>' +
      '<div class="adm-f adm-rol"><label>Rol</label><select id="auRol">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (u.rol === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select><small id="auRolTx"></small></div>' +
      '<div class="adm-f"><span class="adm-lab">Obras que ve <small style="text-transform:none;font-weight:400">(ninguna marcada = todas; los de campo necesitan al menos una)</small></span><div class="adm-obras">' +
        OBRAS.map(function (o) { return '<label><input type="checkbox" value="' + esc(o.obra_id) + '"' + (sel.indexOf(o.obra_id) >= 0 ? ' checked' : '') + '>' + esc(o.nombre) + '</label>'; }).join('') + '</div></div>' +
      '<label style="display:flex;gap:6px;align-items:center;font-size:14px;margin-bottom:12px"><input type="checkbox" id="auAct"' + (u.activo !== false ? ' checked' : '') + '> Activo (puede entrar)</label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="adm-btn" id="auNo">Cancelar</button><button class="adm-btn pri" id="auSi">Guardar</button></div></div>';
    document.body.appendChild(m);
    var tx = function () { var r = ROLES.filter(function (x) { return x[0] === $('#auRol', m).value; })[0]; $('#auRolTx', m).textContent = r ? r[2] : ''; };
    $('#auRol', m).onchange = tx; tx();
    $('#auNo', m).onclick = function () { m.remove(); ED = null; };
    $('#auSi', m).onclick = async function () {
      var p = { email: ($('#auEmail', m).value || '').trim(), nombre: ($('#auNom', m).value || '').trim(), rol: $('#auRol', m).value,
                activo: $('#auAct', m).checked, obras: $$('.adm-obras input:checked', m).map(function (c) { return c.value; }) };
      if (!p.email) { alert('Falta el correo o la cédula.'); return; }
      if ((p.rol === 'transporte' || p.rol === 'produccion') && !p.obras.length) { alert('A los usuarios de campo hay que asignarles al menos una obra.'); return; }
      var b = $('#auSi', m); b.disabled = true; b.textContent = 'Guardando…';
      try {
        var r = await global.ObraAPI.admUsuarioGuardar(p);
        m.remove(); ED = null;
        toast('Usuario guardado: <b>' + esc(r.email) + '</b>' + (nuevo ? ' — creá su acceso en Supabase › Authentication con ese correo.' : ''));
        await cargar();
      } catch (e) { alert(e.message || String(e)); b.disabled = false; b.textContent = 'Guardar'; }
    };
  }

  function enlazar() {
    var e;
    if ((e = $('#admBusca'))) e.oninput = function () { FIL = this.value; var p = this.selectionStart; render(); var e2 = $('#admBusca'); if (e2) { e2.focus(); e2.setSelectionRange(p, p); } };
    if ((e = $('#admNuevo'))) e.onclick = function () { ED = { rol: 'residente', activo: true, obras: [] }; modal(); };
    $$('[data-ued]').forEach(function (b) {
      b.onclick = function () {
        var u = U.filter(function (x) { return x.email === b.getAttribute('data-ued'); })[0]; if (!u) return;
        ED = Object.assign({ email_orig: u.email }, u); modal();
      };
    });
  }

  async function cargar() {
    try {
      var r = await Promise.all([global.ObraAPI.admUsuarios(), global.ObraAPI.listObras()]);
      U = r[0]; OBRAS = r[1];
    } catch (e) {
      var v = $('#v-admin');
      if (v) v.innerHTML = '<div class="adm-wrap"><div class="adm-card">No se pudieron cargar los usuarios: ' + esc(e.message) +
        (/adm_usuarios|function|schema/i.test(e.message || '') ? '<br>Falta correr en Supabase el SQL <b>23_roles_compras_gerente_admin.sql</b>.' : '') + '</div></div>';
      return;
    }
    render();
  }
  function abrir() { U = null; render(); cargar(); }
  function enganchar() {
    var tabs = $('#tabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.v === 'admin') abrir(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar); else enganchar();
  global.AdminView = { abrir: abrir };
})(window);
