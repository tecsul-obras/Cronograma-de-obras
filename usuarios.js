/* =========================================================================
 * usuarios.js — USUARIOS (pantalla única) · v20261112g · SQL 113
 *
 *  La misma pantalla en:
 *    · Obras › Administración          (admin.js la monta)
 *    · Equipos › Administración › Usuarios (parte_diario_v5.html la monta)
 *
 *  Una fila por persona y, en su ficha, TODO lo que puede hacer:
 *    cuenta · rol en Obras · rol en Equipos · formularios a medida ·
 *    compras de taller · plantas · responsable de máquinas ·
 *    aprueba partes certificados · recursos humanos.
 *
 *  El rol es la base; lo demás se suma por persona (usuario «a medida»):
 *  ej. Compras (taller) + formulario de combustible.
 *
 *  Quién edita (lo decide la base, adm_contexto):
 *    · Administrador de Obras: todo.
 *    · Admin central de Equipos: todo menos el rol en Obras (lo ve).
 *
 *  Uso: UsuariosAdm.montar(contenedor, clienteSupabase, { yo: correo })
 * ========================================================================= */
(function (global) {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function aviso(t, tipo) {
    var plano = String(t).replace(/<[^>]+>/g, '');
    if (typeof global.toast === 'function') { try { global.toast(esc(plano), tipo); return; } catch (e) {} }
    alert(plano);
  }
  function fdt(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('es-PY') + ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }); }
  var CAMPO = '@campo.tecsul.com.py';
  function usuarioVisible(email) { email = String(email || ''); return email.slice(-CAMPO.length) === CAMPO ? email.slice(0, -CAMPO.length) : email; }
  function nomFrente(clave) { return String(clave || '').replace(/^[^_]*_\s*/, ''); }
  function igualLista(a, b) { return (a || []).slice().sort().join('|') === (b || []).slice().sort().join('|'); }

  // ── Roles ──────────────────────────────────────────────────────────────
  var ROLES_OB = [
    ['admin', 'Administrador', 'Todo, en todas las obras. Usuarios, maestros, obras nuevas.'],
    ['residente', 'Residente', 'Carga y corrige todo en sus obras (cronograma, producción, certificación, compras…).'],
    ['admin_obra', 'Administrador de obra', 'Ve todo en sus obras (ninguna marcada = todas). Carga y corrige Producción, Transporte y Compras; lo demás solo ver.'],
    ['compras', 'Compras', 'Ve todas las obras. En Compras carga pedidos, cotiza, registra OC y entregas. Lo demás, solo ver.'],
    ['gerente', 'Gerente', 'Ve todas las obras, no carga datos. En Compras ve pedidos, cotizaciones, OC y los KPI de tiempos.'],
    ['lectura', 'Solo lectura', 'Ve sus obras, no modifica nada.'],
    ['rrhh', 'Recursos humanos', 'Solo la sección Recursos humanos (planilla de salarios, personal y categorías). No ve obras.'],
    ['transporte', 'Campo · Transporte', 'Solo la pestaña Transporte, en las obras asignadas. Entra con su cédula.'],
    ['produccion', 'Campo · Producción', 'Solo la pestaña Producción, en las obras asignadas. Entra con su cédula.']
  ];
  var ROLES_EQ = [
    ['operador', 'Operador', 'Carga sus partes (o lo de su especialidad) y ve solo lo suyo; lo corrige dentro de las 24 h.'],
    ['admin_obra', 'Admin de obra', 'Carga y corrige los partes de sus frentes. Ve flota (cambia la disponibilidad).'],
    ['taller', 'Taller', 'Reportes de taller; ve todos los partes. Administra flota, OT, control de combustible y mantenimiento.'],
    ['gerente', 'Gerente', 'Ve todo; edita la flota y los certificados de máquinas (con sus tarifas).'],
    ['compras', 'Compras (taller)', 'Compras de taller: cotiza, pide autorización y registra la compra. En Equipos ve solo la Flota, sin modificar.'],
    ['admin_central', 'Admin central', 'Todo en Equipos: todas las obras, certificado de máquinas, asistente y usuarios.']
  ];
  var NOM_OB = {}, NOM_EQ = {};
  ROLES_OB.forEach(function (r) { NOM_OB[r[0]] = r[1]; });
  ROLES_EQ.forEach(function (r) { NOM_EQ[r[0]] = r[1]; });
  var FORMS = [['parte', 'Parte diario'], ['taller', 'Reporte de taller'], ['combustible', 'Carga de combustible']];
  var NOM_FORM = { parte: 'Parte', taller: 'Taller', combustible: 'Combustible' };
  var TC = [
    ['ver', 'Ver', 've los pedidos de taller de todas las obras'],
    ['solicitar', 'Solicitar', 'pide repuestos / servicios y confirma la recepción'],
    ['bodega', 'Bodega', 'entrega desde la bodega central y traslados'],
    ['compras', 'Compras', 'cotiza, pide autorización y registra la compra'],
    ['autorizar', 'Autorizar', 'autoriza las compras cotizadas']
  ];
  var ROL_PLANTA = [['encargado', 'Encargado'], ['operador', 'Operador'], ['bascula', 'Báscula']];

  // Lo que el rol ya da en Compras de taller (igual que tc_yo, SQL 99)
  function tcPorRol(p) {
    var super_ = p.ob_rol === 'admin' || p.eq_rol === 'admin_central';
    var r = {};
    if (super_) { TC.forEach(function (c) { r[c[0]] = 'todo (administrador)'; }); return r; }
    if (p.eq_rol === 'compras' || p.ob_rol === 'compras') r.compras = 'por su rol';
    if (p.eq_rol === 'taller') r.solicitar = 'todas las obras (Taller)';
    else if (p.eq_rol === 'admin_obra') r.solicitar = 'sus frentes (Admin de obra)';
    if (p.ob_rol === 'gerente' || p.ob_rol === 'compras' || p.eq_rol === 'gerente') r.ver = 'por su rol';
    return r;
  }
  function rrhhPorRol(p) {
    if (p.ob_rol === 'admin' || p.ob_rol === 'rrhh' || p.eq_rol === 'admin_central') return 'editar';
    if (p.ob_rol === 'gerente') return 'ver';
    return '';
  }
  function formsEfectivos(p) { return p.eq_formularios || p.eq_forms_auto || []; }

  // ── Matrices (qué da cada rol) ─────────────────────────────────────────
  var MATRIZ_OB = [
    ['Cronograma / Plan semanal', { admin: '✎', residente: '✎', admin_obra: '👁', compras: '👁', gerente: '👁', lectura: '👁' }],
    ['Producción', { admin: '✎', residente: '✎', admin_obra: '✎', compras: '👁', gerente: '👁', lectura: '👁', produccion: '✎' }],
    ['Certificación / Cómputo / Convenios', { admin: '✎', residente: '✎', admin_obra: '👁', compras: '👁', gerente: '👁', lectura: '👁' }],
    ['Transporte (cargas)', { admin: '✎', residente: '✎', admin_obra: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '✎ lo suyo' }],
    ['Transporte › stock', { admin: '✎', residente: '✎', admin_obra: '✎', compras: '👁', gerente: '👁', lectura: '👁', transporte: '👁' }],
    ['Transporte › maestro de camiones', { admin: '✎', residente: '👁', admin_obra: '👁' }],
    ['Compras › pedidos, cotizaciones, OC', { admin: '✎', residente: '✎', admin_obra: '✎', compras: '✎ todas', gerente: '👁', lectura: '👁' }],
    ['Comunicaciones', { admin: '✎', residente: '✎', admin_obra: '👁', compras: '👁', gerente: '👁', lectura: '👁' }],
    ['Recursos humanos', { admin: '✎', gerente: '👁', rrhh: '✎' }],
    ['Usuarios', { admin: '✎' }]
  ];
  var MATRIZ_EQ = [
    ['Formularios (por defecto)', { operador: 'según especialidad', admin_obra: 'parte', taller: 'taller', gerente: '—', compras: '—', admin_central: 'los tres' }],
    ['Historial de partes', { operador: '👁 los suyos', admin_obra: '✎ sus frentes', taller: '👁', gerente: '👁', admin_central: '✎' }],
    ['Flota y fichas', { admin_obra: '👁 · ✎ disponibilidad', taller: '✎', gerente: '✎', compras: '👁', admin_central: '✎' }],
    ['OT, control de combustible, mantenimiento', { taller: '✎', gerente: '👁', admin_central: '✎' }],
    ['Personal, alertas, seguros', { gerente: '👁', admin_central: '✎' }],
    ['Certificado de máquinas y tarifas', { gerente: '✎', admin_central: '✎' }],
    ['Compras de taller', { admin_obra: 'pide (sus frentes)', taller: 'pide', gerente: '👁', compras: '✎', admin_central: '✎' }],
    ['Usuarios', { admin_central: '✎ (menos el rol en Obras)' }]
  ];

  // ── Estado ─────────────────────────────────────────────────────────────
  var S = { sb: null, cont: null, yo: '', P: null, C: null, fil: '', ver: '', rol: '', act: '', err: '' };

  function estilos() {
    if ($('#usCss')) return;
    var st = document.createElement('style'); st.id = 'usCss';
    st.textContent = [
      '#v-admin{overflow:auto;background:#f4f6f9}',
      '.us-wrap{padding:14px 18px 40px;max-width:1600px;margin:0 auto;color:#1f2937;font-size:calc(13.5px*var(--fs,1))}',
      '.us-card{background:#fff;border:1px solid #d0d6e0;border-radius:12px;padding:14px 16px;margin-bottom:14px}',
      '.us-card h2{margin:0 0 10px;font-size:calc(16px*var(--fs,1));color:#1a2744}',
      '.us-card h2 small{font-weight:400;color:#7a8699;font-size:calc(12.5px*var(--fs,1))}',
      '.us-info{font-size:calc(12.5px*var(--fs,1));color:#4a5568;background:#f0f4fa;border-radius:8px;padding:8px 10px;margin-bottom:10px;line-height:1.45}',
      '.us-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}',
      '.us-bar input,.us-bar select{font:inherit;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937}',
      '.us-bar input{min-width:240px}',
      '.us-btn{border:1px solid #c9d1dc;background:#fff;color:#1f2937;border-radius:9px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer}',
      '.us-btn.pri{background:#2c4a8a;border-color:#2c4a8a;color:#fff}.us-btn.ok{background:#1e7a43;border-color:#1e7a43;color:#fff}',
      '.us-btn:disabled{opacity:.6;cursor:default}.us-btn.mini{padding:3px 9px;font-size:calc(12px*var(--fs,1))}',
      '.us-tw{overflow:auto;max-height:70vh}',
      '.us-t{width:100%;border-collapse:collapse}',
      '.us-t th{position:sticky;top:0;background:#f0f2f5;font-size:calc(10.5px*var(--fs,1));text-transform:uppercase;padding:6px;text-align:left;border-bottom:1px solid #d0d6e0;white-space:nowrap;z-index:1}',
      '.us-t td{padding:6px;border-bottom:1px solid #eef0f4;vertical-align:top}',
      '.us-t tr.off td{color:#9aa4b2}',
      '.us-chip{display:inline-block;font-size:calc(11px*var(--fs,1));font-weight:700;padding:2px 8px;border-radius:10px;background:#eef2f7;color:#2c4a8a;white-space:nowrap;margin:0 3px 3px 0}',
      '.us-chip.admin,.us-chip.admin_central{background:#1a2744;color:#fff}.us-chip.gerente{background:#fdecea;color:#b03a2e}',
      '.us-chip.compras{background:#fff4e0;color:#9a6200}.us-chip.rrhh{background:#efe7fb;color:#5b3a9a}',
      '.us-chip.transporte,.us-chip.produccion,.us-chip.operador{background:#e3f6ea;color:#1e7a43}.us-chip.taller{background:#fff1e6;color:#b4570a}',
      '.us-chip.off{background:#f0f0f0;color:#888;text-decoration:line-through}',
      '.us-chip.extra{background:#e8f4fd;color:#0b5c8f;font-weight:600}.us-chip.medida{background:#fff8d6;color:#7a5b00;font-weight:600}',
      '.us-sub{display:block;font-size:calc(11.5px*var(--fs,1));color:#6b7686;margin-top:2px;max-width:280px}',
      '.us-ok{color:#1e7a43;font-weight:700}.us-mal{color:#c0392b;font-weight:700}.us-gris{color:#9aa4b2}',
      '.us-mx td,.us-mx th{text-align:center;font-size:calc(12px*var(--fs,1))}.us-mx td:first-child,.us-mx th:first-child{text-align:left}',
      '.us-modal{position:fixed;inset:0;background:rgba(26,39,68,.55);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding:20px 10px;overflow:auto}',
      '.us-box{background:#fff;border-radius:12px;max-width:820px;width:100%;padding:16px 18px;color:#1f2937;font-size:calc(13.5px*var(--fs,1))}',
      '.us-box h3{margin:0 0 4px;color:#1a2744;font-size:calc(17px*var(--fs,1))}',
      '.us-res{font-size:calc(12.5px*var(--fs,1));color:#4a5568;margin-bottom:12px}',
      '.us-sec{border:1px solid #e1e6ee;border-radius:10px;padding:10px 12px;margin-bottom:10px}',
      '.us-sec h4{margin:0 0 8px;font-size:calc(14px*var(--fs,1));color:#1a2744}',
      '.us-sec h4 small{font-weight:400;color:#7a8699}',
      '.us-sec.ro{background:#fafbfc}',
      '.us-f{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}',
      '.us-f label,.us-lab{font-size:calc(11.5px*var(--fs,1));font-weight:700;color:#4a5568;text-transform:uppercase}',
      '.us-f input,.us-f select,.us-sel{font:inherit;padding:7px 9px;border:1px solid #c9d1dc;border-radius:8px;background:#fff;color:#1f2937}',
      '.us-f small,.us-nota{color:#7a8699;font-size:calc(12px*var(--fs,1))}',
      '.us-fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.us-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 10px;max-height:180px;overflow:auto;border:1px solid #e1e6ee;border-radius:8px;padding:8px}',
      '.us-lista label,.us-chk{display:flex;gap:6px;align-items:center;font-weight:400;text-transform:none;color:#1f2937;font-size:calc(13px*var(--fs,1))}',
      '.us-chk{margin:3px 0}.us-chk input{width:17px;height:17px}',
      '.us-f label.us-chk,.us-fila label.us-chk{text-transform:none;font-weight:400;font-size:calc(13.5px*var(--fs,1));color:#1f2937}',
      '.us-chk.dis{color:#9aa4b2}',
      '.us-pl{display:grid;grid-template-columns:1fr 130px 1.4fr 30px;gap:6px;margin-bottom:6px;align-items:center}',
      '.us-pie{display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:-16px;background:#fff;padding:10px 0 2px}',
      '@media (max-width:640px){.us-pl{grid-template-columns:1fr 1fr}.us-bar input{min-width:0;flex:1}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── Celdas de la tabla ─────────────────────────────────────────────────
  function nomObra(id) { var o = (S.C.obras_ob || []).filter(function (x) { return x.id === id; })[0]; return o ? o.nombre : id; }
  function nomPlanta(id) { var o = (S.C.plantas || []).filter(function (x) { return x.id === id; })[0]; return o ? o.nombre : id; }
  function celdaObras(p) {
    if (!p.ob_rol) return '<span class="us-gris">—</span>';
    var obras = (p.ob_obras || []).length ? p.ob_obras.map(function (o) { return esc(nomObra(o)); }).join(', ') : 'todas las obras';
    return '<span class="us-chip ' + esc(p.ob_rol) + (p.ob_activo === false ? ' off' : '') + '">' + esc(NOM_OB[p.ob_rol] || p.ob_rol) + '</span><span class="us-sub">' + obras + '</span>';
  }
  function celdaEquipos(p) {
    if (!p.eq_rol) return '<span class="us-gris">—</span>';
    var det = p.eq_rol === 'admin_obra' ? ((p.eq_obras || []).map(nomFrente).map(esc).join(', ') || '<span class="us-mal">sin frentes</span>')
      : p.eq_rol === 'operador' ? 'sus partes' : p.eq_rol === 'compras' ? 'flota (solo ver)' : 'todas las obras';
    return '<span class="us-chip ' + esc(p.eq_rol) + (p.eq_activo === false ? ' off' : '') + '">' + esc(NOM_EQ[p.eq_rol] || p.eq_rol) + '</span><span class="us-sub">' + det + '</span>';
  }
  function celdaForms(p) {
    if (!p.eq_rol) return '<span class="us-gris">—</span>';
    var f = formsEfectivos(p);
    var txt = f.length ? f.map(function (x) { return NOM_FORM[x] || x; }).join(' + ') : 'ninguno';
    return p.eq_formularios ? '<span class="us-chip medida" title="A medida (no automático)">✎ ' + esc(txt) + '</span>'
                            : '<span class="us-gris">' + esc(txt) + ' · auto</span>';
  }
  function extrasDe(p) {
    var r = [];
    var tc = Object.keys(p.tc || {});
    if (tc.length) r.push(['🛒 Compras taller: ' + tc.join(', '), 'Permisos de compras de taller dados a mano']);
    (p.plantas || []).forEach(function (x) { r.push(['🏭 ' + x.planta + ' · ' + x.rol, nomPlanta(x.planta)]); });
    if (p.responsable) r.push(['🔧 Responsable de máquinas', 'Aparece en Flota › Responsable']);
    if (p.aprobador) r.push(['✓ Aprueba partes certificados', 'Aprueba ediciones de partes ya certificados']);
    (p.extras || []).forEach(function (x) { r.push([x === 'rrhh_editar' ? '👥 RRHH (editar)' : '👥 RRHH (ver)', 'Recursos humanos, además de su rol']); });
    return r;
  }
  function celdaExtras(p) {
    var r = extrasDe(p);
    return r.length ? r.map(function (x) { return '<span class="us-chip extra" title="' + esc(x[1]) + '">' + esc(x[0]) + '</span>'; }).join('') : '<span class="us-gris">—</span>';
  }
  function aMedida(p) { return !!(p.eq_formularios || extrasDe(p).length); }

  function visibles() {
    var t = S.fil.trim().toLowerCase();
    return S.P.filter(function (p) {
      if (S.ver === 'obras' && !p.ob_rol) return false;
      if (S.ver === 'equipos' && !p.eq_rol) return false;
      if (S.ver === 'medida' && !aMedida(p)) return false;
      if (S.ver === 'nada' && (p.ob_rol || p.eq_rol)) return false;
      if (S.ver === 'sincuenta' && p.tiene_acceso) return false;
      if (S.rol) { var k = S.rol.split(':'); if (k[0] === 'ob' ? p.ob_rol !== k[1] : p.eq_rol !== k[1]) return false; }
      var activo = (p.ob_rol && p.ob_activo !== false) || (p.eq_rol && p.eq_activo !== false);
      if (S.act === 'si' && !activo) return false;
      if (S.act === 'no' && activo) return false;
      return !t || [p.nombre, p.email, p.eq_cedula, NOM_OB[p.ob_rol], NOM_EQ[p.eq_rol], extrasDe(p).map(function (x) { return x[0]; }).join(' ')]
        .join(' ').toLowerCase().indexOf(t) >= 0;
    });
  }

  // ── Pantalla ───────────────────────────────────────────────────────────
  function render() {
    var v = S.cont; if (!v) return;
    estilos();
    if (S.err) { v.innerHTML = '<div class="us-wrap"><div class="us-card">' + S.err + '</div></div>'; return; }
    if (!S.P) { v.innerHTML = '<div class="us-wrap"><div class="us-card">Cargando usuarios…</div></div>'; return; }
    var nOb = S.P.filter(function (p) { return p.ob_rol && p.ob_activo !== false; }).length;
    var nEq = S.P.filter(function (p) { return p.eq_rol && p.eq_activo !== false; }).length;
    var opt = function (val, t, cur) { return '<option value="' + val + '"' + (cur === val ? ' selected' : '') + '>' + t + '</option>'; };
    var h = '<div class="us-wrap"><div class="us-card"><h2>👥 Usuarios <small>' + nOb + ' con acceso a Obras · ' + nEq + ' a Equipos</small></h2>' +
      '<div class="us-info">Una persona = <b>una cuenta</b> (cédula o correo y su contraseña) para toda la app. En su ficha (✎) está <b>todo</b> lo que puede hacer: ' +
      'rol en <b>Obras</b>, rol en <b>Equipos</b> y, encima del rol, lo que se le suma <b>a medida</b>: formularios (parte, taller, combustible), compras de taller, plantas, ' +
      'responsable de máquinas, aprobar partes certificados y recursos humanos. Los de campo entran con su <b>cédula</b>.' +
      (S.C.obras ? '' : '<br>ℹ Sos admin central de Equipos: el <b>rol en Obras</b> lo ve pero lo cambia el Administrador de Obras.') + '</div>' +
      '<div class="us-bar"><input type="search" id="usBusca" placeholder="Buscar nombre, cédula, correo, rol o permiso…" value="' + esc(S.fil) + '">' +
      '<select id="usVer">' + opt('', 'Todas', S.ver) + opt('obras', 'Con acceso a Obras', S.ver) + opt('equipos', 'Con acceso a Equipos', S.ver) +
        opt('medida', 'Con permisos a medida', S.ver) + opt('nada', 'Sin ningún rol', S.ver) + opt('sincuenta', 'Sin cuenta creada', S.ver) + '</select>' +
      '<select id="usRol">' + opt('', 'Todos los roles', S.rol) +
        '<optgroup label="Obras">' + ROLES_OB.map(function (r) { return opt('ob:' + r[0], r[1], S.rol); }).join('') + '</optgroup>' +
        '<optgroup label="Equipos">' + ROLES_EQ.map(function (r) { return opt('eq:' + r[0], r[1], S.rol); }).join('') + '</optgroup></select>' +
      '<select id="usAct">' + opt('', 'Activos e inactivos', S.act) + opt('si', 'Solo activos', S.act) + opt('no', 'Solo inactivos', S.act) + '</select>' +
      '<span style="flex:1"></span><button class="us-btn" id="usExp">Exportar</button><button class="us-btn pri" id="usNuevo">＋ Usuario</button></div>' +
      '<div class="us-nota" id="usCuenta"></div>' +
      '<div class="us-tw"><table class="us-t"><thead><tr><th>Nombre</th><th>Cédula / usuario</th><th>Obras</th><th>Equipos</th><th>Formularios</th><th>Además</th><th>Cuenta</th><th>Último ingreso</th><th></th></tr></thead><tbody id="usFilas"></tbody></table></div></div>';
    h += '<div class="us-card"><h2>🔐 Qué da cada rol <small>✎ carga y corrige · 👁 solo ve · — no ve</small></h2>' +
      '<div class="us-info">El rol es la base. Lo que haga falta de más para una persona se le suma en su ficha (permisos a medida).</div>' +
      tablaMatriz('Obras', ROLES_OB, MATRIZ_OB) + '<div style="height:12px"></div>' + tablaMatriz('Equipos', ROLES_EQ, MATRIZ_EQ) + '</div></div>';
    v.innerHTML = h;
    filas();
    enlazar();
  }
  function tablaMatriz(tit, roles, M) {
    return '<div class="us-tw" style="max-height:none"><table class="us-t us-mx"><thead><tr><th>' + tit + '</th>' +
      roles.map(function (r) { return '<th title="' + esc(r[2]) + '">' + esc(r[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      M.map(function (m) { return '<tr><td>' + esc(m[0]) + '</td>' + roles.map(function (r) { return '<td>' + esc(m[1][r[0]] || '—') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function filas() {
    var L = visibles(), tb = $('#usFilas', S.cont); if (!tb) return;
    $('#usCuenta', S.cont).textContent = L.length + ' de ' + S.P.length + ' personas';
    tb.innerHTML = L.map(function (p) {
      var activo = (p.ob_rol && p.ob_activo !== false) || (p.eq_rol && p.eq_activo !== false);
      return '<tr class="' + (activo || !(p.ob_rol || p.eq_rol) ? '' : 'off') + '"><td><b>' + esc(p.nombre || '—') + '</b>' + (p.email === S.yo ? ' <small>(vos)</small>' : '') + '</td>' +
        '<td>' + esc(usuarioVisible(p.email)) + '</td><td>' + celdaObras(p) + '</td><td>' + celdaEquipos(p) + '</td><td>' + celdaForms(p) + '</td><td>' + celdaExtras(p) + '</td>' +
        '<td>' + (p.tiene_acceso ? '<span class="us-ok" title="Tiene usuario y contraseña">✓</span>' + (p.eq_cambiar_clave ? ' <span title="Tiene que cambiar la contraseña al entrar">🔑</span>' : '')
                                 : '<span class="us-mal" title="Falta crear la cuenta: abrí ✎ y poné una contraseña">⚠ sin cuenta</span>') + '</td>' +
        '<td>' + fdt(p.ultimo_ingreso) + '</td><td><button class="us-btn mini" data-ped="' + esc(p.email) + '">✎</button></td></tr>';
    }).join('') || '<tr><td colspan="9" class="us-gris">Nadie coincide con el filtro.</td></tr>';
    $$('[data-ped]', tb).forEach(function (b) {
      b.onclick = function () { var p = S.P.filter(function (x) { return x.email === b.getAttribute('data-ped'); })[0]; if (p) ficha(p); };
    });
  }
  function enlazar() {
    var c = S.cont;
    $('#usBusca', c).oninput = function () { S.fil = this.value; filas(); };
    $('#usVer', c).onchange = function () { S.ver = this.value; filas(); };
    $('#usRol', c).onchange = function () { S.rol = this.value; filas(); };
    $('#usAct', c).onchange = function () { S.act = this.value; filas(); };
    $('#usNuevo', c).onclick = function () { ficha(null); };
    $('#usExp', c).onclick = exportar;
  }
  function exportar() {
    var cab = ['Nombre', 'Usuario', 'Rol Obras', 'Obras', 'Activo Obras', 'Rol Equipos', 'Frentes', 'Activo Equipos', 'Formularios', 'A medida', 'Además', 'Cuenta', 'Último ingreso'];
    var q = function (v) { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var L = visibles().map(function (p) {
      return [p.nombre, usuarioVisible(p.email), NOM_OB[p.ob_rol] || '', (p.ob_obras || []).map(nomObra).join(', '), p.ob_rol ? (p.ob_activo !== false ? 'sí' : 'no') : '',
        NOM_EQ[p.eq_rol] || '', (p.eq_obras || []).map(nomFrente).join(', '), p.eq_rol ? (p.eq_activo !== false ? 'sí' : 'no') : '',
        p.eq_rol ? formsEfectivos(p).map(function (x) { return NOM_FORM[x]; }).join(' + ') : '', p.eq_formularios ? 'sí' : '',
        extrasDe(p).map(function (x) { return x[0].replace(/^\S+\s/, ''); }).join(' · '), p.tiene_acceso ? 'sí' : 'no', fdt(p.ultimo_ingreso)];
    });
    var csv = '﻿' + [cab].concat(L).map(function (f) { return f.map(q).join(';'); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'usuarios_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
  }

  // ── Ficha de la persona ────────────────────────────────────────────────
  function claveAzar() { return String(Math.floor(100000 + Math.random() * 900000)); }
  function checks(nombre, lista, sel) {
    return lista.map(function (v) {
      return '<label><input type="checkbox" name="' + nombre + '" value="' + esc(v[0]) + '"' + (sel.indexOf(v[0]) >= 0 ? ' checked' : '') + '>' + esc(v[1]) + '</label>';
    }).join('');
  }

  function ficha(p0) {
    var nuevo = !p0;
    var p = nuevo ? { tiene_acceso: false, ob_rol: '', eq_rol: '', ob_obras: [], eq_obras: [], eq_formularios: null, tc: {}, plantas: [], extras: [] } : JSON.parse(JSON.stringify(p0));
    var C = S.C, edObras = !!C.obras;
    var m = document.createElement('div'); m.className = 'us-modal';
    var obrasOb = (C.obras_ob || []).map(function (o) { return [o.id, o.nombre]; });
    var frentes = (C.frentes || []).map(function (f) { return [f, nomFrente(f)]; });
    var formMedida = !!p.eq_formularios;
    var fSel = formsEfectivos(p);
    var tcSel = Object.keys(p.tc || {});
    var solObras = (p.tc && p.tc.solicitar) || [];
    var rrhhExtra = (p.extras || []).indexOf('rrhh_editar') >= 0 ? 'rrhh_editar' : (p.extras || []).indexOf('rrhh_ver') >= 0 ? 'rrhh_ver' : '';

    m.innerHTML = '<div class="us-box"><h3>' + (nuevo ? '＋ Usuario nuevo' : '✎ ' + esc(p.nombre || usuarioVisible(p.email))) + '</h3>' +
      '<div class="us-res" id="ufRes"></div>' +
      // Cuenta
      '<div class="us-sec"><h4>👤 Cuenta</h4>' +
        '<div class="us-fila"><div class="us-f" style="flex:1;min-width:200px"><label>Cédula o correo</label><input id="ufUsr" value="' + esc(usuarioVisible(p.email)) + '"' + (nuevo ? '' : ' disabled') + ' placeholder="4123456  ·  nombre@tecsul.com.py"></div>' +
        '<div class="us-f" style="flex:1.4;min-width:220px"><label>Nombre</label><input id="ufNom" value="' + esc(p.nombre || '') + '"></div></div>' +
        (nuevo ? '<small class="us-nota">Los de campo entran con la cédula; los de oficina, con su correo.</small>' : '') +
        (p.tiene_acceso
          ? '<div class="us-f"><label>Contraseña</label><div class="us-fila"><input id="ufClave" placeholder="Nueva contraseña (mín. 6)" autocomplete="off" style="flex:1"><button class="us-btn" id="ufCambiar">Cambiar</button></div>' +
            '<small>Si se la olvidó: le ponés una nueva y se la pasás (al entrar se le pide cambiarla).</small></div>'
          : '<div class="us-f"><label>Contraseña inicial</label><input id="ufClave" value="' + claveAzar() + '" autocomplete="off">' +
            '<small>' + (nuevo ? 'Se crea la cuenta con esta contraseña. Pasásela a la persona.' : '⚠ Esta persona todavía no tiene cuenta: se crea al guardar.') + '</small></div>') +
      '</div>' +
      // Obras
      '<div class="us-sec' + (edObras ? '' : ' ro') + '"><h4>📅 Obras <small>cronograma, producción, certificación, compras…' + (edObras ? '' : ' · solo lo cambia el Administrador de Obras') + '</small></h4>' +
        '<div class="us-f"><label>Rol</label><select id="ufObRol"' + (edObras ? '' : ' disabled') + '><option value="">Sin acceso a Obras</option>' +
          ROLES_OB.map(function (r) { return '<option value="' + r[0] + '"' + (p.ob_rol === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select><small id="ufObTx"></small></div>' +
        '<div id="ufObMas"><div class="us-f"><span class="us-lab">Obras que ve <small style="text-transform:none;font-weight:400">(ninguna marcada = todas; los de campo necesitan al menos una)</small></span>' +
          '<div class="us-lista" id="ufObObras">' + checks('ob', obrasOb, p.ob_obras || []) + '</div></div>' +
          '<label class="us-chk"><input type="checkbox" id="ufObAct"' + (p.ob_activo !== false ? ' checked' : '') + (edObras ? '' : ' disabled') + '> Activo en Obras</label></div>' +
      '</div>' +
      // Equipos
      '<div class="us-sec"><h4>🚜 Equipos <small>parte diario, flota, taller, combustible, alquileres</small></h4>' +
        '<div class="us-f"><label>Rol</label><select id="ufEqRol"><option value="">Sin acceso a Equipos</option>' +
          ROLES_EQ.map(function (r) { return '<option value="' + r[0] + '"' + (p.eq_rol === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') + '</select><small id="ufEqTx"></small></div>' +
        '<div id="ufEqMas"><div class="us-f" id="ufEqFr"><span class="us-lab">Frentes que ve</span><div class="us-lista" id="ufEqObras">' + checks('eq', frentes, p.eq_obras || []) + '</div></div>' +
          '<div class="us-f"><span class="us-lab">Formularios que carga</span>' +
            '<label class="us-chk"><input type="checkbox" id="ufFAuto"' + (formMedida ? '' : ' checked') + '> Automático <span class="us-nota" id="ufFAutoTx"></span></label>' +
            '<div class="us-fila" id="ufForms">' + FORMS.map(function (f) { return '<label class="us-chk"><input type="checkbox" name="form" value="' + f[0] + '"' + (fSel.indexOf(f[0]) >= 0 ? ' checked' : '') + '> ' + f[1] + '</label>'; }).join('') + '</div>' +
            '<small>Destildá «Automático» para darle a esta persona otros formularios que los de su rol (ej.: Compras de taller + Carga de combustible).</small></div>' +
          '<label class="us-chk"><input type="checkbox" id="ufEqAct"' + (p.eq_activo !== false ? ' checked' : '') + '> Activo en Equipos <span class="us-nota">(desactivado no entra; sus partes quedan)</span></label></div>' +
      '</div>' +
      // Compras de taller
      '<div class="us-sec"><h4>🛒 Compras de taller <small>pedidos al taller central (Otras apps › Compras de taller)</small></h4>' +
        '<div id="ufTc">' + TC.map(function (c) {
          return '<label class="us-chk" data-tc="' + c[0] + '"><input type="checkbox" name="tc" value="' + c[0] + '"' + (tcSel.indexOf(c[0]) >= 0 ? ' checked' : '') + '> <b>' + c[1] + '</b> — ' + esc(c[2]) + ' <span class="us-nota" data-tcrol="' + c[0] + '"></span></label>';
        }).join('') + '</div>' +
        '<div class="us-f" id="ufTcSol" style="margin-top:6px"><span class="us-lab">Solicitar en <small style="text-transform:none;font-weight:400">(ninguna marcada = todas)</small></span><div class="us-lista">' + checks('tcs', frentes, solObras) + '</div></div>' +
      '</div>' +
      // Plantas
      '<div class="us-sec"><h4>🏭 Plantas <small>parte de planta, báscula, costos y configuración de esa planta</small></h4>' +
        '<div id="ufPl"></div><button class="us-btn mini" id="ufPlMas">＋ Planta</button>' +
        '<div class="us-nota" style="margin-top:4px">Encargado: ve y configura todo en su planta. Operador: carga el parte de planta. Báscula: carga los tickets. La persona tiene que estar en el Personal (cédula).</div>' +
      '</div>' +
      // Flota y partes
      '<div class="us-sec"><h4>🔧 Flota y partes</h4>' +
        '<label class="us-chk"><input type="checkbox" id="ufResp"' + (p.responsable ? ' checked' : '') + '> Responsable de máquinas <span class="us-nota">(aparece para elegir en Flota › Responsable)</span></label>' +
        '<label class="us-chk"><input type="checkbox" id="ufAprob"' + (p.aprobador ? ' checked' : '') + '> Aprueba ediciones de partes ya certificados <span class="us-nota">(solicitudes de edición / eliminación)</span></label>' +
      '</div>' +
      // RRHH
      '<div class="us-sec"><h4>👥 Recursos humanos <small>planilla de salarios (Otras apps › Recursos humanos)</small></h4>' +
        '<div class="us-fila"><select class="us-sel" id="ufRrhh"><option value="">Según su rol</option><option value="rrhh_ver"' + (rrhhExtra === 'rrhh_ver' ? ' selected' : '') + '>Además: solo ver</option>' +
          '<option value="rrhh_editar"' + (rrhhExtra === 'rrhh_editar' ? ' selected' : '') + '>Además: cargar y editar</option></select><span class="us-nota" id="ufRrhhTx"></span></div>' +
      '</div>' +
      '<div class="us-pie"><button class="us-btn" id="ufNo">Cancelar</button><button class="us-btn pri" id="ufSi">Guardar</button></div></div>';
    document.body.appendChild(m);

    // Plantas: renglones
    var PL = (p.plantas || []).map(function (x) { return { planta: x.planta, rol: x.rol, cedula: x.cedula }; });
    function pintarPlantas() {
      var ced = p.eq_cedula || '';
      var pers = C.personal || [];
      var hayCed = pers.some(function (o) { return o.cedula === ced; });
      $('#ufPl', m).innerHTML = PL.map(function (x, i) {
        var c = x.cedula || (hayCed ? ced : '');
        return '<div class="us-pl"><select class="us-sel" data-pl="' + i + '" data-k="planta">' + (C.plantas || []).map(function (pl) { return '<option value="' + esc(pl.id) + '"' + (pl.id === x.planta ? ' selected' : '') + '>' + esc(pl.id + ' · ' + pl.nombre) + '</option>'; }).join('') + '</select>' +
          '<select class="us-sel" data-pl="' + i + '" data-k="rol">' + ROL_PLANTA.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === x.rol ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' +
          '<select class="us-sel" data-pl="' + i + '" data-k="cedula"><option value="">— elegir del Personal —</option>' + pers.map(function (o) { return '<option value="' + esc(o.cedula) + '"' + (o.cedula === c ? ' selected' : '') + '>' + esc(o.nombre + ' · ' + o.cedula) + '</option>'; }).join('') + '</select>' +
          '<button class="us-btn mini" data-plq="' + i + '" title="Quitar">✕</button></div>';
      }).join('') || '<div class="us-nota">No está en ninguna planta.</div>';
      $$('[data-pl]', m).forEach(function (s) { s.onchange = function () { PL[+s.getAttribute('data-pl')][s.getAttribute('data-k')] = s.value; }; });
      $$('[data-plq]', m).forEach(function (b) { b.onclick = function () { PL.splice(+b.getAttribute('data-plq'), 1); pintarPlantas(); }; });
      PL.forEach(function (x) { if (!x.cedula && hayCed) x.cedula = ced; });
    }
    $('#ufPlMas', m).onclick = function () {
      if (!(C.plantas || []).length) { aviso('No hay plantas activas.'); return; }
      PL.push({ planta: C.plantas[0].id, rol: 'operador', cedula: '' }); pintarPlantas();
    };
    pintarPlantas();

    // Ayudas que dependen de los roles elegidos
    function actual() {
      return { ob_rol: $('#ufObRol', m).value, eq_rol: $('#ufEqRol', m).value };
    }
    function refrescar() {
      var a = actual();
      var r1 = ROLES_OB.filter(function (x) { return x[0] === a.ob_rol; })[0], r2 = ROLES_EQ.filter(function (x) { return x[0] === a.eq_rol; })[0];
      $('#ufObTx', m).textContent = r1 ? r1[2] : 'No entra a Obras.';
      $('#ufEqTx', m).textContent = r2 ? r2[2] : 'No entra a Equipos.';
      $('#ufObMas', m).style.display = a.ob_rol ? '' : 'none';
      $('#ufEqMas', m).style.display = a.eq_rol ? '' : 'none';
      $('#ufEqFr', m).style.display = a.eq_rol === 'admin_obra' ? '' : 'none';
      // formularios automáticos del rol elegido
      var auto = a.eq_rol === p.eq_rol && p.eq_forms_auto ? p.eq_forms_auto : autoCliente(a.eq_rol, p.eq_especialidad);
      $('#ufFAutoTx', m).textContent = '(según rol' + (a.eq_rol === 'operador' ? ' y especialidad' : '') + ': ' + (auto.length ? auto.map(function (x) { return NOM_FORM[x]; }).join(' + ') : 'ninguno') + ')';
      var esAuto = $('#ufFAuto', m).checked;
      $$('#ufForms input', m).forEach(function (c) {
        if (esAuto) c.checked = auto.indexOf(c.value) >= 0;
        c.disabled = esAuto; c.parentNode.classList.toggle('dis', esAuto);
      });
      // compras de taller: lo que ya da el rol
      var porRol = tcPorRol({ ob_rol: a.ob_rol, eq_rol: a.eq_rol });
      TC.forEach(function (c) { var s = $('[data-tcrol="' + c[0] + '"]', m); s.textContent = porRol[c[0]] ? '· ya lo tiene ' + porRol[c[0]] : ''; });
      $('#ufTcSol', m).style.display = $('#ufTc input[value="solicitar"]', m).checked ? '' : 'none';
      var rr = rrhhPorRol({ ob_rol: a.ob_rol, eq_rol: a.eq_rol });
      $('#ufRrhhTx', m).textContent = rr ? 'Por su rol ya puede ' + (rr === 'editar' ? 'cargar y editar' : 'ver') + '.' : 'Por su rol no entra.';
      // resumen arriba
      var forms = $$('#ufForms input:checked', m).map(function (c) { return NOM_FORM[c.value]; });
      var partes = [];
      if (a.ob_rol) partes.push('Obras: ' + NOM_OB[a.ob_rol]);
      if (a.eq_rol) partes.push('Equipos: ' + NOM_EQ[a.eq_rol] + (forms.length ? ' (' + forms.join(' + ') + (esAuto ? '' : ', a medida') + ')' : ''));
      $('#ufRes', m).textContent = partes.length ? partes.join(' · ') : 'Sin rol: no entra a ninguna parte (salvo lo que se le dé abajo).';
    }
    $('#ufObRol', m).onchange = refrescar; $('#ufEqRol', m).onchange = refrescar;
    $('#ufFAuto', m).onchange = refrescar;
    $$('#ufForms input, #ufTc input', m).forEach(function (c) { c.addEventListener('change', refrescar); });
    refrescar();

    $('#ufNo', m).onclick = function () { m.remove(); };
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') m.remove(); });

    var bc = $('#ufCambiar', m);
    if (bc) bc.onclick = async function () {
      var c = $('#ufClave', m).value || '';
      if (c.length < 6) { alert('La contraseña tiene que tener al menos 6 caracteres.'); return; }
      bc.disabled = true;
      try { await funcion({ accion: 'clave', id: p.id, clave: c }); $('#ufClave', m).value = ''; aviso('Contraseña cambiada. Pasásela a la persona.', 'success'); }
      catch (e) { alert(e.message || String(e)); }
      bc.disabled = false;
    };

    $('#ufSi', m).onclick = async function () {
      var a = actual();
      var usr = ($('#ufUsr', m).value || '').trim().toLowerCase();
      var nombre = ($('#ufNom', m).value || '').trim();
      var obObras = $$('#ufObObras input:checked', m).map(function (c) { return c.value; });
      var eqObras = $$('#ufEqObras input:checked', m).map(function (c) { return c.value; });
      var formsA = $('#ufFAuto', m).checked ? null : $$('#ufForms input:checked', m).map(function (c) { return c.value; });
      var tc = {};
      $$('#ufTc input:checked', m).forEach(function (c) { tc[c.value] = c.value === 'solicitar' ? $$('#ufTcSol input:checked', m).map(function (x) { return x.value; }) : []; });
      var extras = $('#ufRrhh', m).value ? [$('#ufRrhh', m).value] : [];
      var resp = $('#ufResp', m).checked, aprob = $('#ufAprob', m).checked;
      var plantas = PL.map(function (x) { return { planta: x.planta, rol: x.rol, cedula: x.cedula || '' }; });

      if (!usr) { alert('Falta la cédula o el correo.'); return; }
      if (!nombre) { alert('Falta el nombre.'); return; }
      if (edObras && (a.ob_rol === 'transporte' || a.ob_rol === 'produccion') && !obObras.length) { alert('A los usuarios de campo de Obras hay que asignarles al menos una obra.'); return; }
      if (a.eq_rol === 'admin_obra' && !eqObras.length) { alert('Un admin de obra de Equipos necesita al menos un frente.'); return; }
      if (resp && !a.eq_rol) { alert('Para ser responsable de máquinas necesita un rol en Equipos.'); return; }
      if (plantas.some(function (x) { return !x.cedula; })) { alert('En cada planta elegí la persona del Personal (cédula).'); return; }
      var dup = {}; if (plantas.some(function (x) { var k = x.planta + '|' + x.cedula; if (dup[k]) return true; dup[k] = 1; return false; })) { alert('Hay una planta repetida.'); return; }

      var b = $('#ufSi', m); b.disabled = true; b.textContent = 'Guardando…';
      var hecho = [];
      try {
        var id = p.id, email = p.email;
        // 1. Cuenta
        if (!p.tiene_acceso) {
          var c = $('#ufClave', m).value || '';
          if (c.length < 6) throw new Error('La contraseña inicial tiene que tener al menos 6 caracteres.');
          var cu = await funcion({ accion: 'cuenta', usuario: usr, nombre: nombre, clave: c });
          id = cu.id; email = cu.email;
          hecho.push(cu.ya_existia ? 'la cuenta ya existía' : 'cuenta creada');
        }
        email = email || usr;
        // 2. Obras (solo el Administrador de Obras)
        if (edObras) {
          var obCambio = a.ob_rol !== (p.ob_rol || '') || a.ob_rol && (nombre !== (p.nombre || '') || $('#ufObAct', m).checked !== (p.ob_activo !== false) || !igualLista(obObras, p.ob_obras));
          if (obCambio && a.ob_rol) {
            await rpc('adm_usuario_guardar', { p: { email: email, nombre: nombre, rol: a.ob_rol, activo: $('#ufObAct', m).checked, obras: obObras } });
            hecho.push('Obras: ' + NOM_OB[a.ob_rol]);
          } else if (obCambio && p.ob_rol) {
            await rpc('adm_usuario_quitar', { p_email: email });
            hecho.push('sin acceso a Obras');
          }
        }
        // 3. Equipos
        var eqCambio = a.eq_rol !== (p.eq_rol || '') || a.eq_rol && (
          nombre !== (p.nombre || '') || $('#ufEqAct', m).checked !== (p.eq_activo !== false) ||
          JSON.stringify(formsA) !== JSON.stringify(p.eq_formularios || null) || !igualLista(a.eq_rol === 'admin_obra' ? eqObras : [], a.eq_rol === 'admin_obra' ? p.eq_obras : []));
        if (eqCambio) {
          await rpc('adm_perfil_guardar', { p: { id: id, rol: a.eq_rol, nombre: nombre, cedula: p.eq_cedula || usuarioVisible(email).split('@')[0],
            obras: a.eq_rol === 'admin_obra' ? eqObras : [], formularios: formsA, activo: $('#ufEqAct', m).checked } });
          hecho.push(a.eq_rol ? 'Equipos: ' + NOM_EQ[a.eq_rol] + (formsA ? ' (formularios a medida)' : '') : 'sin acceso a Equipos');
        }
        // 4. Lo demás (solo lo que cambió)
        var ex = { id: id }, hayEx = false;
        var tcAntes = p.tc || {};
        if (JSON.stringify(Object.keys(tc).sort().map(function (k) { return [k, (tc[k] || []).slice().sort()]; })) !==
            JSON.stringify(Object.keys(tcAntes).sort().map(function (k) { return [k, k === 'solicitar' ? (tcAntes[k] || []).slice().sort() : []]; }))) { ex.tc = tc; hayEx = true; hecho.push('compras de taller'); }
        if (!!resp !== !!p.responsable) { ex.responsable = resp; hayEx = true; hecho.push(resp ? 'responsable de máquinas' : 'ya no es responsable'); }
        if (!!aprob !== !!p.aprobador) { ex.aprobador = aprob; hayEx = true; hecho.push(aprob ? 'aprueba partes' : 'ya no aprueba partes'); }
        if (!igualLista(extras, p.extras)) { ex.extras = extras; hayEx = true; hecho.push('recursos humanos'); }
        var plK = function (L) { return (L || []).map(function (x) { return x.planta + '|' + x.rol + '|' + (x.cedula || ''); }).sort().join(','); };
        if (plK(plantas) !== plK(p.plantas)) { ex.plantas = plantas; hayEx = true; hecho.push('plantas'); }
        if (hayEx) await rpc('adm_extras_guardar', { p: ex });

        m.remove();
        aviso('Guardado ' + nombre + (hecho.length ? ' — ' + hecho.join(' · ') : ' (sin cambios)'), 'success');
        if (!p.tiene_acceso) aviso('Usuario: ' + usuarioVisible(email) + ' · contraseña inicial: ' + $('#ufClave', m).value, 'success');
        await cargar();
      } catch (e) {
        alert((hecho.length ? 'Se hizo: ' + hecho.join(' · ') + '.\n\nPero falló: ' : '') + (e.message || String(e)));
        b.disabled = false; b.textContent = 'Guardar';
        if (hecho.length) { m.remove(); await cargar(); }
      }
    };
  }
  // Formularios automáticos (igual que formularios_auto en la base) para un rol recién elegido
  function autoCliente(rol, esp) {
    if (rol === 'admin_central') return ['parte', 'taller', 'combustible'];
    if (rol === 'taller') return ['taller'];
    if (rol === 'admin_obra') return ['parte'];
    if (rol === 'gerente' || rol === 'compras' || !rol) return [];
    if (esp === 'DESPACHADOR') return ['combustible'];
    if (['MECANICO', 'MECANICO A', 'MECANICO B', 'ELECTRICISTA', 'GOMERO', 'AYUDANTE MECANICO', 'SUPERVISOR'].indexOf(esp) >= 0) return ['taller'];
    return ['parte'];
  }

  // ── Base ───────────────────────────────────────────────────────────────
  async function rpc(fn, args) {
    var r = await S.sb.rpc(fn, args || {});
    if (r.error) {
      var msg = r.error.message || String(r.error);
      if (/function .* does not exist|Could not find the function|schema cache/i.test(msg)) msg += ' — falta correr en Supabase el SQL 113_usuarios_unificados.sql.';
      throw new Error(msg);
    }
    return r.data;
  }
  async function funcion(cuerpo) {
    var r = await S.sb.functions.invoke('usuarios', { body: cuerpo });
    if (r.error) {
      var msg = r.error.message;
      try { var c = await r.error.context.json(); if (c && c.error) msg = c.error; } catch (e) {}
      if (/not found|404|Failed to send/i.test(msg)) msg += ' — falta publicar la Edge Function «usuarios».';
      throw new Error(msg);
    }
    if (r.data && r.data.error) throw new Error(r.data.error);
    return r.data || {};
  }
  async function cargar() {
    S.err = '';
    try {
      var r = await Promise.all([rpc('adm_contexto'), rpc('adm_personas')]);
      S.C = r[0] || {}; S.P = r[1] || [];
    } catch (e) {
      S.err = 'No se pudieron cargar los usuarios: ' + esc(e.message || String(e));
    }
    render();
  }

  function montar(cont, sb, opc) {
    if (!cont || !sb) return;
    S.cont = cont; S.sb = sb; S.yo = String((opc && opc.yo) || '').toLowerCase();
    S.P = null; render(); cargar();
  }
  global.UsuariosAdm = { montar: montar, _autoCliente: autoCliente, _tcPorRol: tcPorRol };
})(window);
