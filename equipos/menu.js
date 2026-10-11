// ══════════════════════════════════════════════════════════════════
// MENÚ COMÚN — Tecsul S.A.E.
//
// La app son dos páginas (parte_diario_v5.html y flota.html) pero el
// usuario tiene que ver UNA sola app: las dos dibujan exactamente las
// mismas solapas, en el mismo orden. Una solapa de la otra página es
// un enlace (pagina.html?p=solapa) que abre directo en esa solapa.
//
// Qué solapas ve cada uno:
//   · Formularios (parte, taller, combustible): según mis_formularios()
//   · Gestión (flota, OT, control de combustible, alertas): taller,
//     admin_obra y admin_central
//   · Administración: solo admin_central
// ══════════════════════════════════════════════════════════════════
window.Menu = (() => {
  const GESTION = ['taller', 'admin_obra', 'gerente', 'admin_central'];
  const TALLER = ['taller', 'gerente', 'admin_central'];   // plata: alquileres y seguros (gerente: solo ver)
  const ITEMS = [
    { id: 'form',        t: 'Nuevo parte',            pag: 'parte', ver: c => c.f.includes('parte') },
    { id: 'taller',      t: 'Reporte de taller',      pag: 'parte', ver: c => c.f.includes('taller') },
    { id: 'combustible', t: 'Carga de combustible',   pag: 'parte', ver: c => c.f.includes('combustible') },
    { id: 'historial',   t: 'Historial de partes',    pag: 'parte', ver: c => c.f.includes('parte') || c.rol === 'gerente' },
    { id: 'flota',       t: 'Flota',                  pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'ot',          t: 'Órdenes de trabajo',     pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'gasoil',      t: 'Control de combustible', pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'mant',        t: 'Mantenimiento',          pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'alq',         t: 'Alquileres',             pag: 'flota', ver: c => TALLER.includes(c.rol) },
    { id: 'seg',         t: 'Seguros',                pag: 'flota', ver: c => TALLER.includes(c.rol) },
    { id: 'pers',        t: 'Personal',               pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'cert',        t: 'Certificado de máquinas', pag: 'flota', ver: c => ['admin_central', 'gerente'].includes(c.rol) },
    { id: 'alertas',     t: 'Alertas',                pag: 'flota', ver: c => GESTION.includes(c.rol),
      extra: '<span class="n" id="n-alertas" style="display:none"></span>' },
    { id: 'bi',          t: 'Reportes',               pag: 'flota', ver: c => c.bi },
    { id: 'admin',       t: 'Administración',         pag: 'parte', ver: c => c.rol === 'admin_central' },
  ];
  const PAGINAS = { parte: './parte_diario_v5.html', flota: './flota.html' };
  const APP_OBRAS = '../index.html';   // la misma app: cronograma y gestión de obras

  let ctx = { rol: null, f: [] };
  let pagina = null;
  // La solapa pedida en la dirección se lee una sola vez, al cargar
  // (después la dirección se va actualizando con la solapa activa).
  const pedidaAlCargar = new URLSearchParams(location.search).get('p');

  // Formularios por defecto según el rol, por si todavía no se pudo
  // preguntar a la base (sin señal la primera vez).
  function formulariosPorDefecto(rol) {
    if (rol === 'gerente') return [];   // solo mira: sin formularios
    if (rol === 'admin_central' || rol === 'taller') return ['parte', 'taller', 'combustible'];
    if (rol === 'admin_obra') return ['parte', 'combustible'];
    return ['parte'];
  }

  function guardados(rol) {
    if (rol === 'gerente') return [];
    try {
      const g = JSON.parse(localStorage.getItem('fx_formularios') || 'null');
      if (Array.isArray(g) && g.length) return g;
    } catch (e) { /* nada */ }
    return formulariosPorDefecto(rol);
  }

  function pintar(pag, rol, formularios) {
    pagina = pag;
    ctx = { rol, f: rol === 'gerente' ? [] : (formularios || guardados(rol)), bi: hayReportes() };
    // El asistente IA no es una solapa: es el botón flotante (ia.js)
    if (window.Asistente) Asistente.activar(rol);
    botonApps();
    const nav = document.getElementById('menu');
    if (!nav) return;
    nav.innerHTML = visibles().map(it => it.pag === pagina
      ? `<button class="nav-tab" id="tab-${it.id}" onclick="mostrarPantalla('${it.id}')">${it.t}${it.extra || ''}</button>`
      : `<a class="nav-tab" id="tab-${it.id}" href="${PAGINAS[it.pag]}?p=${it.id}" style="text-decoration:none">${it.t}${it.extra || ''}</a>`
    ).join('');
  }

  const visibles = () => ITEMS.filter(it => it.ver(ctx));
  const puede = (id) => visibles().some(it => it.id === id);

  // La solapa con la que arranca esta página: la pedida en la dirección
  // (?p=ot) si la persona la puede ver, si no la primera de esta página.
  function inicial() {
    const pedida = pedidaAlCargar;
    const v = visibles();
    if (pedida && v.some(it => it.id === pedida && it.pag === pagina)) return pedida;
    const propia = v.find(it => it.pag === pagina);
    return propia ? propia.id : null;
  }

  // Marca la solapa activa, pone el título y deja la dirección lista
  // para que "volver" o recargar caigan en el mismo lugar.
  // ¿Tiene reportes de Power BI para ver? Se guarda en el teléfono y se
  // refresca en cada entrada (reportes()).
  function hayReportes() {
    try { return Number(localStorage.getItem('reportes_bi_n') || 0) > 0; } catch (e) { return false; }
  }
  async function reportes(sb) {
    try {
      const { data, error } = await sb.from('reportes_bi').select('id').eq('activo', true).limit(100);
      if (error) return;   // sin señal o sin la tabla todavía: queda lo guardado
      const n = (data || []).length;
      const antes = hayReportes();
      localStorage.setItem('reportes_bi_n', String(n));
      if ((n > 0) !== antes && pagina) {
        pintar(pagina, ctx.rol, ctx.f);
        if (actual) activar(actual);
      }
    } catch (e) { /* sin señal: queda lo guardado */ }
  }

  // ── Cambiar de app (igual que en la app de Cronograma y gestión de obras) ──
  function botonApps() {
    const cab = document.querySelector('.app-header');
    if (!cab) return;
    estilosApps();
    let b = document.getElementById('apps-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'apps-btn';
      b.type = 'button';
      b.title = 'Otras apps de Tecsul';
      b.setAttribute('aria-label', 'Otras apps de Tecsul');
      b.setAttribute('aria-haspopup', 'true');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
        + '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/></svg>';
      b.onclick = (e) => { e.stopPropagation(); alternarApps(); };
      cab.insertBefore(b, cab.querySelector('.logout-link'));
      document.addEventListener('click', (e) => { const p = document.getElementById('apps-menu'); if (p && !p.contains(e.target)) cerrarApps(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarApps(); });
    }
  }
  function cerrarApps() {
    const p = document.getElementById('apps-menu');
    if (p) p.remove();
    const b = document.getElementById('apps-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function alternarApps() {
    if (document.getElementById('apps-menu')) return cerrarApps();
    const enFlota = pagina === 'flota';
    const verFlota = GESTION.includes(ctx.rol);
    // Obras solo para quien tiene rol ahí (lo averigua la página al entrar)
    let accObras = false;
    try { accObras = localStorage.getItem('tecsul_acceso_obras') === '1'; } catch (e) {}
    const apps = [];
    if (accObras) apps.push({ ic: '📅', t: 'Obras', s: 'cronograma, producción, certificación, compras', url: APP_OBRAS });
    apps.push({ ic: '🚜', t: 'Parte diario de equipos', s: 'partes, taller, combustible', url: PAGINAS.parte, aqui: !enFlota });
    if (verFlota) apps.push({ ic: '🛠️', t: 'Flota y taller', s: 'flota, OT, mantenimiento, alquileres', url: PAGINAS.flota + '?p=flota', aqui: enFlota });
    const m = document.createElement('div');
    m.id = 'apps-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = apps.map(a => `<a role="menuitem" class="apps-item${a.aqui ? ' aqui' : ''}" href="${a.aqui ? '#' : a.url}"
        ${a.aqui ? 'onclick="event.preventDefault()"' : ''}>
        <span class="apps-ic">${a.ic}</span><span><b>${a.t}</b><small>${a.aqui ? 'esta app' : a.s}</small></span></a>`).join('')
      + '<div class="apps-pie">Un solo usuario para todo: lo que ves depende de tu rol.</div>';
    document.body.appendChild(m);
    const r = document.getElementById('apps-btn').getBoundingClientRect();
    m.style.top = (r.bottom + 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8)) + 'px';
    document.getElementById('apps-btn').setAttribute('aria-expanded', 'true');
  }
  function estilosApps() {
    if (document.getElementById('apps-estilos')) return;
    const st = document.createElement('style');
    st.id = 'apps-estilos';
    st.textContent = `
      #apps-btn { width: 38px; height: 38px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
        border: 1px solid rgba(255,255,255,.28); border-radius: 9px; background: rgba(255,255,255,.08); color: #fff; cursor: pointer; }
      #apps-btn:hover, #apps-btn[aria-expanded="true"] { background: rgba(255,255,255,.18); }
      #apps-menu { position: fixed; z-index: 600; width: min(340px, calc(100vw - 16px)); background: #fff; border-radius: 14px;
        box-shadow: 0 12px 36px rgba(26,39,68,.28); padding: 8px; }
      .apps-item { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 10px;
        color: #1a2744; text-decoration: none; }
      .apps-item:hover { background: #f3f5f9; }
      .apps-item.aqui { background: #eef2fb; cursor: default; }
      .apps-ic { font-size: 26px; width: 34px; text-align: center; }
      .apps-item b { display: block; font-size: 14.5px; }
      .apps-item small { display: block; font-size: 12px; color: #6b7487; margin-top: 2px; }
      .apps-pie { border-top: 1px solid #e5e9f0; margin-top: 6px; padding: 9px 12px 4px; font-size: 11.5px; color: #6b7487; }`;
    document.head.appendChild(st);
  }

  let actual = null;
  function activar(id) {
    actual = id;
    document.querySelectorAll('#menu .nav-tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + id));
    const it = ITEMS.find(x => x.id === id);
    const titulo = document.querySelector('.app-header .t b');
    if (it && titulo) titulo.textContent = it.t;
    if (it) document.title = it.t + ' - Tecsul';
    const tab = document.getElementById('tab-' + id);
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try { history.replaceState(null, '', location.pathname + '?p=' + id + location.hash); } catch (e) { /* nada */ }
  }

  return { pintar, puede, inicial, activar, formulariosPorDefecto, reportes, rol: () => ctx && ctx.rol };
})();
