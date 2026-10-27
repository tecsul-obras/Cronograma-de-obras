// ══════════════════════════════════════════════════════════════════
// RECURSOS DE MANTENIMIENTO — Tecsul S.A.E.  (SQL 63 · equipos-v68)
//
// Una lista de recursos (filtros, lubricantes, piezas de desgaste) por
// modelo de máquina. Cada renglón dice en qué service se cambia
// (250 / 1.000 / 2.000 h); sin service = según desgaste o inspección.
// El precio aproximado es UNO por código y vale para todas las listas.
//
// Kit de un service N: el del mayor nivel de la lista que divide a N
// (500, 750, 1.250… → 250 · 1.000 → 1.000 · 2.000 → 2.000). Es la misma
// regla que usa la base (mant_nivel_kit) al registrar un service.
//
// Lo usan: la ficha del equipo (pestaña Mantenimiento) y la solapa
// Mantenimiento (columnas Kit / Costo, Recursos necesarios, Listas de
// recursos y los recursos usados de cada service realizado).
// Vive en flota.html y usa sus utilidades ($, esc, sb, sesion, flota,
// esTaller, abrirModal, cerrarModal, toast, fmtFecha, fmtNum, leerLocal,
// guardarLocal, compartir, mostrarCarga, ocultarCarga, abrirFicha).
// ══════════════════════════════════════════════════════════════════
window.Recursos = (() => {

  const SERVICES_BASE = [250, 1000, 2000];
  const GRUPOS = ['Filtros', 'Lubricantes y fluidos', 'Desgaste', 'Correas y otros', 'Otros'];
  const UNIDADES = ['un', 'L', 'kg', 'm', 'juego'];
  const ESTADOS = { sis: 'Verificado con SIS', ok: 'Compatible', ver: 'A verificar', na: 'Sin verificar' };
  const ETQ_EXCEL = { sis: 'SIS', ok: 'compatible', ver: 'verificar' };
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  const D = { listas: [], recursos: [], codigos: new Map(), eqLista: new Map(), promesa: null, ok: false, error: null };
  const F = { eq: null, lista: null, filtro: null, prox: null, cont: null };   // lo que se ve en la ficha / modal de lista

  // ── utilidades ─────────────────────────────────────────────────
  const clave = (c) => String(c ?? '').replace(/[\s\-./]/g, '').toUpperCase() || null;
  const gs = (n) => n === null || n === undefined || n === '' || isNaN(n) ? '' : Math.round(Number(n)).toLocaleString('es-PY');
  const nivTxt = (n) => Number(n).toLocaleString('es-PY');
  const hoy = () => new Date().toISOString().slice(0, 10);
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(/\./g, '').replace(',', '.')); return isNaN(x) ? null : x; };
  const numCant = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(',', '.')); return isNaN(x) ? null : x; };
  const puede = () => typeof esTaller === 'function' && esTaller();
  const fichaDe = (id) => (typeof flota !== 'undefined' ? flota : []).find(f => f.id === id) || {};

  async function todo(q) {
    let out = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await q().range(i, i + 999);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < 1000) return out;
    }
  }

  function cargar(forzar) {
    if (D.promesa && !forzar) return D.promesa;
    D.promesa = (async () => {
      const [l, r, c, e] = await Promise.all([
        todo(() => sb.from('mant_listas').select('*').order('nombre')),
        todo(() => sb.from('mant_recursos').select('*').order('lista_id').order('orden').order('id')),
        todo(() => sb.from('mant_codigos').select('*')),
        todo(() => sb.from('equipos').select('id, lista_recursos_id').not('lista_recursos_id', 'is', null))]);
      l.forEach(x => { x.id = Number(x.id); });
      r.forEach(x => { x.id = Number(x.id); x.lista_id = Number(x.lista_id); x.codigos = Array.isArray(x.codigos) ? x.codigos : []; });
      D.listas = l; D.recursos = r;
      D.codigos = new Map(c.map(x => [x.clave, x]));
      D.eqLista = new Map(e.map(x => [x.id, Number(x.lista_recursos_id)]));
      D.ok = true; D.error = null;
      return D;
    })().catch(err => { D.promesa = null; D.ok = false; D.error = err; throw err; });
    return D.promesa;
  }
  const faltaSQL = () => D.error && /mant_|lista_recursos_id|does not exist|schema cache/i.test(D.error.message || '');
  const avisoError = () => faltaSQL()
    ? '<div class="aviso-caja">Falta correr el <b>SQL 63</b> (recursos de mantenimiento) en Supabase.</div>'
    : `<div class="aviso-caja rojo">No se pudieron leer los recursos: ${esc(D.error ? D.error.message : '')}</div>`;

  const lista = (id) => D.listas.find(l => l.id === id) || null;
  const listaDe = (eq) => lista(D.eqLista.get(eq));
  const equiposDe = (lid) => [...D.eqLista].filter(([, l]) => l === lid).map(([e]) => e).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const renglonesLista = (lid) => D.recursos.filter(r => r.lista_id === lid);
  function recursosDe(eq) {
    const lid = D.eqLista.get(eq);
    if (!lid) return [];
    return D.recursos.filter(r => r.lista_id === lid && (!r.solo_equipo || r.solo_equipo === eq) && !(r.excluye || []).includes(eq));
  }
  // Para la vista de una lista sin equipo: los compartidos + los "solo para…"
  const recursosVista = (lid, eq) => eq ? recursosDe(eq) : renglonesLista(lid);

  const nivelesDe = (rs) => [...new Set(rs.flatMap(r => r.services || []))].filter(n => n > 0).sort((a, b) => a - b);
  function nivelKit(nivel, niveles) {
    if (!niveles.length) return null;
    const n = parseInt(String(nivel ?? '').replace(/\D/g, ''), 10);
    if (!n) return niveles[0];
    const div = niveles.filter(x => n % x === 0);
    if (div.length) return Math.max(...div);
    const menores = niveles.filter(x => x <= n);
    return menores.length ? Math.max(...menores) : niveles[0];
  }
  function precioDe(r) {
    for (const c of (r.codigos || [])) {
      const k = D.codigos.get(clave(c.c));
      if (k && k.precio_gs !== null && k.precio_gs !== undefined) return { precio: Number(k.precio_gs), codigo: c.c, fecha: k.precio_fecha, por: k.precio_por };
    }
    return null;
  }
  const subtotal = (r) => { const p = precioDe(r); return p && r.cantidad ? p.precio * Number(r.cantidad) : null; };

  // Kit de un equipo para un nivel de service
  function kit(eq, nivel) {
    const rs = recursosDe(eq);
    if (!D.eqLista.get(eq)) return { sinLista: true, filas: [], nivel: null, costo: 0, sinPrecio: 0 };
    const k = nivelKit(nivel, nivelesDe(rs));
    const filas = k ? rs.filter(r => (r.services || []).includes(k)) : [];
    let costo = 0, sinPrecio = 0;
    filas.forEach(r => { const s = subtotal(r); if (s === null) sinPrecio++; else costo += s; });
    return { sinLista: false, nivel: k, filas, costo, sinPrecio };
  }
  function resumenKit(eq, nivel) {
    if (!D.ok) return null;
    const k = kit(eq, nivel);
    if (k.sinLista) return { sinLista: true, texto: 'sin lista', costo: null };
    if (!k.nivel) return { sinLista: false, texto: 'sin service marcado', costo: null, vacio: true };
    return { sinLista: false, texto: `${nivTxt(k.nivel)} h · ${k.filas.length} ítems`, costo: k.filas.length ? k.costo : null, sinPrecio: k.sinPrecio, n: k.filas.length };
  }

  // ── estilos ────────────────────────────────────────────────────
  function estilos() {
    if (document.getElementById('rec-estilos')) return;
    const s = document.createElement('style');
    s.id = 'rec-estilos';
    s.textContent = `
      .rec-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; background: #f6f8fb;
        border-bottom: 1px solid #e6eaf0; font-size: calc(12.5px*var(--fs,1)); color: var(--gris-texto); }
      .rec-sub b { color: var(--azul-oscuro); }
      .rec-sub .der { margin-left: auto; }
      .rec-sub a { color: var(--azul-medio); font-weight: 600; cursor: pointer; }
      .rec-seg { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px 14px 4px; }
      .rec-seg button { border: 1.5px solid var(--gris-borde); background: #fff; color: var(--gris-texto); border-radius: 20px;
        padding: 5px 12px; font-size: calc(12.5px*var(--fs,1)); font-weight: 600; white-space: nowrap; }
      .rec-seg button .n { display: inline-block; margin-left: 5px; background: #eef1f6; border-radius: 10px; padding: 0 6px; font-size: calc(11px*var(--fs,1)); }
      .rec-seg button.on { background: var(--azul-medio); border-color: var(--azul-medio); color: #fff; }
      .rec-seg button.on .n { background: rgba(255,255,255,.22); color: #fff; }
      .rec-seg button.prox { border-color: var(--naranja); }
      .rec-seg .lp { font-size: calc(10px*var(--fs,1)); font-weight: 800; color: var(--naranja); text-transform: uppercase; margin-left: 4px; }
      .rec-seg button.on .lp { color: #ffd9bf; }
      .rec-wrap { overflow-x: auto; padding: 6px 4px 0; }
      .trec { width: 100%; border-collapse: collapse; font-size: calc(13px*var(--fs,1)); }
      .trec th { font-size: calc(10.5px*var(--fs,1)); text-transform: uppercase; letter-spacing: .3px; color: var(--gris-texto); text-align: left;
        padding: 8px 10px; border-bottom: 1.5px solid var(--gris-borde); font-weight: 700; white-space: nowrap; }
      .trec th.c, .trec td.c { text-align: center; } .trec th.r, .trec td.r { text-align: right; }
      .trec td { padding: 7px 10px; border-bottom: 1px solid #eef1f5; vertical-align: middle; }
      .trec td.cods { min-width: 180px; }
      .trec tr.grp td { background: #f3f5f9; font-size: calc(11px*var(--fs,1)); font-weight: 800; color: var(--azul-medio); text-transform: uppercase;
        letter-spacing: .4px; padding: 6px 10px; }
      .trec tr.grp td span { color: var(--gris-texto); font-weight: 600; margin-left: 6px; }
      .trec tr.clic { cursor: pointer; } .trec tr.clic:hover td { background: #f5f8ff; }
      .rcod { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #e1e6ee; background: #fafbfd; border-radius: 6px;
        padding: 1px 7px; margin: 2px 4px 2px 0; font-family: Consolas, 'Cascadia Mono', monospace; font-size: calc(12px*var(--fs,1)); white-space: nowrap; }
      .rcod.pri { border-color: #b9c6e4; background: #eef2ff; font-weight: 700; }
      .rcod i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: #cfd5df; }
      .rcod i.sis { background: #0ea5e9; } .rcod i.ok { background: #22a447; } .rcod i.ver { background: #f59e0b; }
      .rtick { display: inline-block; width: 20px; height: 20px; border-radius: 5px; line-height: 20px; font-size: calc(12px*var(--fs,1)); font-weight: 800; }
      .rtick.si { background: #e3f4e9; color: var(--verde); } .rtick.no { color: #cfd5df; }
      .rnota { font-size: calc(11px*var(--fs,1)); color: #a56a00; background: #fef3dc; border-radius: 4px; padding: 1px 6px; margin-left: 4px; font-weight: 600; }
      .rsolo { font-size: calc(10.5px*var(--fs,1)); color: #6b3fa0; background: #efe5fb; border-radius: 4px; padding: 1px 6px; margin-left: 4px; font-weight: 700; }
      .rsinp { font-size: calc(11px*var(--fs,1)); font-weight: 700; color: #a56a00; background: #fef3dc; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
      .rec-ley { display: flex; gap: 14px; flex-wrap: wrap; font-size: calc(11.5px*var(--fs,1)); color: var(--gris-texto); padding: 10px 14px; border-top: 1px solid #eef1f5; }
      .rec-ley span { display: inline-flex; align-items: center; gap: 5px; }
      .rec-ley i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .rec-pie { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fff8f0; border-top: 1px solid #f6dcc4;
        padding: 11px 14px; font-size: calc(13px*var(--fs,1)); }
      .rec-pie .der { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
      .rec-card { border-bottom: 1px solid #eef1f5; padding: 9px 12px; }
      .rec-card .t { display: flex; gap: 8px; align-items: flex-start; } .rec-card .t b { flex: 1; font-size: calc(14px*var(--fs,1)); font-weight: 600; }
      .rec-card .q { font-size: calc(13px*var(--fs,1)); font-weight: 700; white-space: nowrap; }
      .rec-card .sv { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
      .rec-card .sv span { font-size: calc(10.5px*var(--fs,1)); font-weight: 700; border-radius: 4px; padding: 1px 6px; background: #eef1f6; color: #9aa3b2; }
      .rec-card .sv span.si { background: #e3f4e9; color: var(--verde); }
      .rec-ed table { width: 100%; border-collapse: collapse; font-size: calc(13px*var(--fs,1)); margin-bottom: 8px; }
      .rec-ed th { font-size: calc(10.5px*var(--fs,1)); text-transform: uppercase; color: var(--gris-texto); text-align: left; padding: 6px 5px; border-bottom: 1.5px solid var(--gris-borde); }
      .rec-ed td { padding: 5px; border-bottom: 1px solid #eef1f5; vertical-align: middle; }
      .rec-ed td input, .rec-ed td select { width: 100%; padding: 6px 7px; border: 1.5px solid var(--gris-borde); border-radius: 6px; font-size: calc(13px*var(--fs,1)); background: #fff; }
      .rec-ed td input.cod { font-family: Consolas, monospace; }
      .rec-ed td input.r { text-align: right; }
      .rec-ed .mini { border: 0; background: #eef1f6; border-radius: 6px; padding: 5px 8px; font-size: calc(12px*var(--fs,1)); cursor: pointer; }
      .rec-ed .checks { display: flex; gap: 14px; flex-wrap: wrap; font-size: calc(14px*var(--fs,1)); padding-top: 4px; }
      .rec-ed .checks label { display: flex; gap: 6px; align-items: center; text-transform: none; font-weight: 500; letter-spacing: 0; font-size: calc(14px*var(--fs,1)); margin: 0; }
      .rec-ed .checks input { width: 17px; height: 17px; }
      .rec-sug { border: 1.5px solid var(--azul-medio); border-radius: 8px; margin: -6px 0 12px; max-height: 220px; overflow-y: auto; font-size: calc(13px*var(--fs,1)); }
      .rec-sug div { padding: 7px 10px; border-top: 1px solid #eef1f5; cursor: pointer; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .rec-sug div:first-child { border-top: 0; } .rec-sug div:hover { background: #eef4ff; }
      .rec-sug .mut { color: var(--gris-texto); font-size: calc(12px*var(--fs,1)); }
      .rec-us tr.no td { color: #9aa3b2; } .rec-us tr.no td .d { text-decoration: line-through; }
      .rec-us tr.ag td { background: #f2fbf5; }
      .rec-us input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--verde); }
      .chip.rest { background: #fef3dc; color: #a56a00; } .chip.rconf { background: #e3f4e9; color: var(--verde); }
      .chip.rclic { cursor: pointer; }
      .tarjeta.sinlista { border-left-color: #8b5cf6; } .tarjeta.sinlista .n { color: #6b3fa0; }
      .tarjeta.plata { border-left-color: var(--naranja); } .tarjeta.plata .n { color: var(--naranja); font-size: calc(19px*var(--fs,1)); }
      .rec-pronto { cursor: not-allowed; background: #fbe7d8 !important; color: #b4622a !important; border-color: #f3cfb3 !important; }
      .tabla tr.rtot td { background: #fff8f0 !important; font-weight: 800; border-top: 2px solid #f6dcc4; }
    `;
    document.head.appendChild(s);
  }

  const chipCod = (c, i) => `<span class="rcod ${i === 0 ? 'pri' : ''}" title="${esc(ESTADOS[c.e] || ESTADOS.na)}${(D.codigos.get(clave(c.c)) || {}).marca ? ' · ' + esc(D.codigos.get(clave(c.c)).marca) : ''}"><i class="${esc(c.e || 'na')}"></i>${esc(c.c)}</span>`;
  const chipsCod = (r) => (r.codigos || []).map(chipCod).join('') || '<span style="color:#9aa3b2">—</span>';
  const leyenda = (extra = '') => `<div class="rec-ley"><span><i style="background:#0ea5e9"></i>Verificado con SIS</span><span><i style="background:#22a447"></i>Compatible</span>
    <span><i style="background:#f59e0b"></i>A verificar</span><span><i style="background:#cfd5df"></i>Sin verificar</span>
    <span style="margin-left:auto">${extra || 'El primer código (resaltado) es el principal. Precios aproximados, con IVA.'}</span></div>`;

  // ══════════════════════════════════════════════════════════════
  // FICHA DEL EQUIPO / DETALLE DE UNA LISTA
  // ══════════════════════════════════════════════════════════════
  async function pintarFicha(eq, proxNivel) {
    estilos();
    const cont = document.getElementById('rec-ficha');
    if (!cont) return;
    F.eq = eq; F.prox = proxNivel || null; F.cont = 'rec-ficha';
    try { await cargar(); } catch (e) { cont.innerHTML = cardVacia(avisoError()); return; }
    if (fichaId !== eq || !document.getElementById('rec-ficha')) return;   // cambió de equipo mientras cargaba
    F.lista = D.eqLista.get(eq) || null;
    if (F.filtro === null || F.filtro === undefined) F.filtro = 'prox';
    repintar();
  }
  function cardVacia(cuerpo) {
    return `<div class="card"><div class="card-header">Recursos de mantenimiento</div><div class="card-body">${cuerpo}</div></div>`;
  }

  function repintar() {
    const cont = document.getElementById(F.cont);
    if (!cont) return;
    if (!F.lista) {
      const f = fichaDe(F.eq);
      cont.innerHTML = cardVacia(`<div class="empty-state" style="padding:16px">Esta máquina no tiene lista de recursos típicos.</div>
        ${puede() ? `<div class="acciones" style="justify-content:center">
          <button class="btn btn-gris" onclick="Recursos.asignar('${esc(F.eq)}')">Usar una lista existente</button>
          <button class="btn btn-primario" onclick="Recursos.nuevaLista('${esc(F.eq)}')">Crear lista ${esc([f.marca, f.modelo].filter(Boolean).join(' ')) || 'nueva'}</button></div>` : ''}`);
      return;
    }
    const l = lista(F.lista);
    const rs = recursosVista(F.lista, F.eq);
    const niveles = nivelesDe(rs);
    const prox = F.eq && F.prox ? nivelKit(F.prox, niveles) : null;
    let filtro = F.filtro === 'prox' ? (prox || 'todos') : F.filtro;
    if (typeof filtro === 'number' && !niveles.includes(filtro)) filtro = 'todos';
    const sinServ = rs.filter(r => !(r.services || []).length);
    const vis = filtro === 'todos' ? rs : filtro === 'sin' ? sinServ : rs.filter(r => (r.services || []).includes(filtro));
    const eqs = equiposDe(F.lista);
    const grupos = [...new Set(GRUPOS.concat(vis.map(r => r.grupo)))].filter(g => vis.some(r => r.grupo === g));
    const movil = window.innerWidth < 700;
    const t = puede();
    let cuerpo;
    if (!rs.length) cuerpo = `<div class="empty-state">La lista está vacía.${t ? ' Agregá recursos con <b>+ Recurso</b> o subí un Excel.' : ''}</div>`;
    else if (!vis.length) cuerpo = '<div class="empty-state">Nada en este filtro.</div>';
    else if (movil) {
      cuerpo = grupos.map(g => {
        const gr = vis.filter(r => r.grupo === g);
        return `<div style="background:#f3f5f9;font-size:calc(11px*var(--fs,1));font-weight:800;color:var(--azul-medio);text-transform:uppercase;padding:6px 12px">${esc(g)} · ${gr.length}</div>` +
          gr.map(r => `<div class="rec-card" ${t ? `onclick="Recursos.editar(${r.lista_id}, ${r.id})"` : ''}>
            <div class="t"><b>${esc(r.descripcion)}${r.solo_equipo ? `<span class="rsolo">solo ${esc(r.solo_equipo)}</span>` : ''}</b><span class="q">${r.cantidad !== null ? fmtNum(r.cantidad, 2) + ' ' + esc(r.unidad || '') : ''}</span></div>
            <div style="margin-top:4px">${chipsCod(r)}</div>
            <div class="sv">${niveles.map(n => `<span class="${(r.services || []).includes(n) ? 'si' : ''}">${nivTxt(n)} h</span>`).join('') || '<span>sin service</span>'}
              ${precioDe(r) ? `<span style="background:#fff8f0;color:var(--naranja)">Gs ${gs(subtotal(r) ?? precioDe(r).precio)}</span>` : ''}</div></div>`).join('');
      }).join('');
    } else {
      cuerpo = `<div class="rec-wrap"><table class="trec"><thead><tr><th>Recurso</th><th>Código principal · alternativos</th><th class="r">Cant.</th><th>Un.</th>
        ${niveles.map(n => `<th class="c">${nivTxt(n)} h</th>`).join('')}<th class="r">Precio aprox.</th><th class="r">Subtotal Gs</th></tr></thead><tbody>
        ${grupos.map(g => {
          const gr = vis.filter(r => r.grupo === g);
          return `<tr class="grp"><td colspan="${6 + niveles.length}">${esc(g)}<span>${gr.length}</span></td></tr>` + gr.map(r => {
            const p = precioDe(r), st = subtotal(r);
            return `<tr class="${t ? 'clic' : ''}" ${t ? `onclick="Recursos.editar(${r.lista_id}, ${r.id})" title="Editar"` : ''}>
              <td><b style="font-weight:600">${esc(r.descripcion)}</b>${r.nota ? `<span class="rnota">${esc(r.nota)}</span>` : ''}${r.solo_equipo ? `<span class="rsolo">solo ${esc(r.solo_equipo)}</span>` : ''}${!F.eq && (r.excluye || []).length ? `<span class="rsolo">no en ${esc(r.excluye.join(', '))}</span>` : ''}</td>
              <td class="cods">${chipsCod(r)}</td><td class="r"><b>${r.cantidad !== null ? fmtNum(r.cantidad, 2) : '—'}</b></td><td>${esc(r.unidad || '')}</td>
              ${niveles.map(n => (r.services || []).includes(n) ? '<td class="c"><span class="rtick si">✓</span></td>' : '<td class="c"><span class="rtick no">·</span></td>').join('')}
              <td class="r">${p ? `<span title="${esc([p.codigo, p.fecha ? fmtFecha(p.fecha) : '', p.por].filter(Boolean).join(' · '))}">${gs(p.precio)}</span>` : '<span class="rsinp">sin precio</span>'}</td>
              <td class="r"><b>${st !== null ? gs(st) : '—'}</b></td></tr>`;
          }).join('');
        }).join('')}</tbody></table></div>`;
    }
    let pie = '';
    if (typeof filtro === 'number' && vis.length) {
      const costo = vis.reduce((a, r) => a + (subtotal(r) || 0), 0), sp = vis.filter(r => !precioDe(r)).length,
        sc = vis.filter(r => precioDe(r) && (r.cantidad === null || r.cantidad === undefined)).length;
      const filtros = vis.filter(r => r.grupo === 'Filtros').length, litros = vis.filter(r => r.unidad === 'L').reduce((a, r) => a + Number(r.cantidad || 0), 0);
      pie = `<div class="rec-pie"><span>Kit <b>service ${nivTxt(filtro)} h</b>: <b>${vis.length} ítems</b>${filtros ? ` · ${filtros} filtros` : ''}${litros ? ` · ${fmtNum(litros, 1)} L` : ''}
          · costo estimado <b style="font-size:calc(15px*var(--fs,1))">Gs ${gs(costo)}</b> ${sp ? `<span class="rsinp">${sp} sin precio</span>` : ''} ${sc ? `<span class="rsinp">${sc} sin cantidad</span>` : ''}</span>
        <span class="der"><button class="btn-mini" style="background:#eef1f6;color:var(--azul-oscuro)" onclick="Recursos.copiar(${filtro})">Copiar lista</button>
          <button class="btn-mini" style="background:#eef1f6;color:var(--azul-oscuro)" onclick="Recursos.imprimir(${filtro})">Imprimir para taller</button>
          <button class="btn-mini rec-pronto" title="Se activa cuando esté Compras de taller" onclick="Recursos.pronto()">Pedir a Compras · pronto</button></span></div>`;
    }
    const enModal = F.cont === 'modal-cuerpo';
    cont.innerHTML = `<div class="card" style="${enModal ? 'box-shadow:none;margin:0' : ''}"><div class="card-header">${enModal ? esc(l.nombre) : 'Recursos de mantenimiento'}
        <span class="der" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn-mini" style="background:rgba(255,255,255,.16);color:#fff" title="Bajar Excel" onclick="Recursos.bajarExcel([${F.lista}])">${movil ? 'Excel ↓' : 'Bajar Excel'}</button>
          ${t ? `<button class="btn-mini" style="background:rgba(255,255,255,.16);color:#fff" title="Subir Excel" onclick="Recursos.subirExcel(${F.lista})">${movil ? 'Excel ↑' : 'Subir Excel'}</button>
          <button class="btn-mini" style="background:#fff;color:var(--azul-medio)" onclick="Recursos.editar(${F.lista}, null)">+ Recurso</button>` : ''}</span></div>
      <div class="rec-sub"><span>${enModal ? 'La usan' : `Lista <b>${esc(l.nombre)}</b> · la ${eqs.length > 1 ? 'comparten' : 'usa'}`}</span>
        ${eqs.map(e => `<span class="chip ${e === F.eq ? 'azul' : 'gris'}">${esc(e)}</span>`).join('') || '<span class="chip gris">ningún equipo</span>'}
        ${t ? `<a onclick="Recursos.${enModal ? `datosLista(${F.lista})` : `asignar('${esc(F.eq)}')`}">${enModal ? 'Nombre y equipos' : 'Cambiar'}</a>` : ''}
        <span class="der">Actualizada ${fmtFecha(l.actualizado_en)}${l.actualizado_por ? ' · ' + esc(l.actualizado_por) : ''}</span></div>
      ${rs.length ? `<div class="rec-seg"><button class="${filtro === 'todos' ? 'on' : ''}" onclick="Recursos.filtrar('todos')">Todos<span class="n">${rs.length}</span></button>
        ${niveles.map(n => `<button class="${filtro === n ? 'on' : ''} ${n === prox ? 'prox' : ''}" onclick="Recursos.filtrar(${n})">Service ${nivTxt(n)} h<span class="n">${rs.filter(r => (r.services || []).includes(n)).length}</span>${n === prox ? '<span class="lp">próximo</span>' : ''}</button>`).join('')}
        ${sinServ.length ? `<button class="${filtro === 'sin' ? 'on' : ''}" onclick="Recursos.filtrar('sin')" title="Sin service marcado: según desgaste o inspección">Desgaste / sin service<span class="n">${sinServ.length}</span></button>` : ''}</div>` : ''}
      ${cuerpo}
      ${rs.length ? leyenda() : ''}
      ${pie}</div>`;
  }
  function filtrar(f) { F.filtro = f; repintar(); }
  function pronto() { toast('Pedir a Compras se activa cuando esté listo el módulo de Compras de taller', 'warning'); }

  // Abrir una lista (desde Listas de recursos)
  async function abrirLista(lid) {
    estilos();
    await cargar();
    F.eq = null; F.lista = lid; F.prox = null; F.filtro = 'todos'; F.cont = 'modal-cuerpo';
    abrirModal('Lista de recursos', '');
    $('modal').querySelector('.modal-card').classList.add('ancho');
    $('modal').querySelector('.modal-card').style.maxWidth = '1100px';
    repintar();
  }
  // Volver a dibujar donde corresponda después de guardar
  async function refrescar() {
    await cargar(true);
    if (F.cont === 'modal-cuerpo' && F.lista) { abrirLista(F.lista); }
    else if (F.cont === 'rec-ficha' && document.getElementById('rec-ficha')) { F.lista = D.eqLista.get(F.eq) || null; repintar(); }
    if (typeof Gestion2 !== 'undefined' && Gestion2.recursosCambiaron) Gestion2.recursosCambiaron();
  }
  function volver() {
    if (F.cont === 'modal-cuerpo' && F.lista) abrirLista(F.lista); else cerrarModal();
  }

  // ── copiar / imprimir el kit ───────────────────────────────────
  function filasKitActual(n) {
    const rs = recursosVista(F.lista, F.eq);
    return rs.filter(r => (r.services || []).includes(n));
  }
  function copiar(n) {
    const l = lista(F.lista), filas = filasKitActual(n);
    const texto = `*Kit service ${nivTxt(n)} h — ${F.eq ? F.eq + ' · ' : ''}${l.nombre}*\n` + filas.map(r =>
      `• ${r.descripcion}${(r.codigos || [])[0] ? ' — ' + r.codigos[0].c : ''}${r.cantidad !== null ? ' — ' + fmtNum(r.cantidad, 2) + ' ' + (r.unidad || '') : ''}`).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(() => toast('Lista copiada', 'success'), () => compartir(texto));
    else compartir(texto);
  }
  function imprimir(n) {
    const l = lista(F.lista), filas = filasKitActual(n), f = fichaDe(F.eq);
    const w = window.open('', '_blank');
    if (!w) return toast('El navegador bloqueó la ventana nueva', 'warning');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Kit ${nivTxt(n)} h ${esc(F.eq || l.nombre)}</title>
      <style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1a2744}h1{font-size:calc(20px*var(--fs,1));margin:0}p{margin:4px 0 14px;color:#4a5568}
      table{width:100%;border-collapse:collapse;font-size:calc(13px*var(--fs,1))}th,td{border:1px solid #c9d1de;padding:6px 8px;text-align:left}th{background:#eef2f9}
      td.c{text-align:center;width:60px}td.r{text-align:right}.f{margin-top:40px;display:flex;gap:60px}.f div{flex:1;border-top:1px solid #1a2744;padding-top:4px;font-size:calc(12px*var(--fs,1))}</style></head><body>
      <h1>Kit service ${nivTxt(n)} h${F.eq ? ' — ' + esc(F.eq) : ''}</h1>
      <p>${esc([f.tipo, l.nombre].filter(Boolean).join(' · '))} · ${fmtFecha(hoy())}${f.ultimo_horometro ? ' · horómetro ' + fmtNum(f.ultimo_horometro) + ' h' : ''}</p>
      <table><thead><tr><th>Recurso</th><th>Código</th><th>Alternativos</th><th>Cant.</th><th>Un.</th><th>Cambiado</th></tr></thead><tbody>
      ${filas.map(r => `<tr><td>${esc(r.descripcion)}</td><td><b>${esc((r.codigos[0] || {}).c || '')}</b></td><td>${esc(r.codigos.slice(1).map(c => c.c).join(' / '))}</td>
        <td class="r">${r.cantidad !== null ? fmtNum(r.cantidad, 2) : ''}</td><td>${esc(r.unidad || '')}</td><td class="c">☐</td></tr>`).join('')}
      </tbody></table><div class="f"><div>Mecánico</div><div>Encargado de taller</div></div>
      <script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }

  // ══════════════════════════════════════════════════════════════
  // EDITAR / AGREGAR UN RECURSO
  // ══════════════════════════════════════════════════════════════
  const E = { lid: null, id: null, eq: null, cods: [] };
  function editar(lid, id) {
    estilos();
    const r = id ? D.recursos.find(x => x.id === id) : null;
    E.lid = lid; E.id = id; E.eq = F.eq;
    E.cods = (r ? r.codigos : []).map(c => { const k = D.codigos.get(clave(c.c)) || {}; return { c: c.c, e: c.e || 'na', marca: k.marca || '', precio: k.precio_gs ?? null, precio0: k.precio_gs ?? null }; });
    if (!E.cods.length) E.cods.push({ c: '', e: 'na', marca: '', precio: null, precio0: null });
    const eqs = equiposDe(lid);
    const niveles = [...new Set(SERVICES_BASE.concat(nivelesDe(renglonesLista(lid))))].sort((a, b) => a - b);
    const grupos = [...new Set(GRUPOS.concat(D.recursos.map(x => x.grupo)))];
    const compartido = r && !r.solo_equipo && eqs.length > 1;
    abrirModal(`${r ? 'Editar' : 'Nuevo'} recurso — ${lista(lid).nombre}`, `<div class="rec-ed">
      ${r ? '' : `<div class="field"><label>Buscar en recursos ya cargados</label><input id="re-buscar" placeholder="Nombre o código (ej.: correa, 1R0762)…" oninput="Recursos.sugerir(this.value)" autocomplete="off"></div>
        <div id="re-sug"></div>`}
      <div class="form-grid">
        <div class="field ancho"><label>Recurso</label><input id="re-desc" value="${esc(r ? r.descripcion : '')}" placeholder="Ej.: Filtro de aceite de motor"></div>
        <div class="field"><label>Grupo</label><select id="re-grupo">${grupos.map(g => `<option ${g === (r ? r.grupo : 'Filtros') ? 'selected' : ''}>${esc(g)}</option>`).join('')}<option value="__otro">Otro grupo…</option></select></div>
        <div class="field"><label>Cantidad · unidad</label><div style="display:flex;gap:6px"><input id="re-cant" type="number" step="any" min="0" value="${r && r.cantidad !== null ? r.cantidad : ''}" style="width:45%">
          <select id="re-un">${[...new Set(UNIDADES.concat(r && r.unidad ? [r.unidad] : []))].map(u => `<option ${u === (r ? r.unidad || 'un' : 'un') ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div></div>
        <div class="field ancho"><label>Se cambia en el service</label><div class="checks">
          ${niveles.map(n => `<label><input type="checkbox" class="re-sv" value="${n}" ${r && (r.services || []).includes(n) ? 'checked' : ''}>${nivTxt(n)} h</label>`).join('')}
          <label style="color:var(--gris-texto)">otro: <input id="re-sv-otro" type="number" min="1" placeholder="h" style="width:80px;padding:4px 6px;border:1.5px solid var(--gris-borde);border-radius:6px"></label></div>
          <div class="ayuda">Sin ningún service marcado = se cambia según desgaste o inspección (no entra en el kit automático).</div></div>
      </div>
      <div class="field" style="margin-bottom:4px"><label>Códigos <span style="text-transform:none;font-weight:500;color:var(--gris-texto)">— el primero es el principal (↑ para subir uno)</span></label></div>
      <div style="overflow-x:auto"><table><thead><tr><th></th><th>Código</th><th>Marca</th><th>Estado</th><th style="text-align:right">Precio aprox. Gs</th><th></th></tr></thead><tbody id="re-cods"></tbody></table></div>
      <button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio);margin-bottom:12px" onclick="Recursos.codMas()">+ Código alternativo</button>
      <div class="ayuda" style="font-size:calc(12px*var(--fs,1));color:var(--gris-texto);margin:-4px 0 12px">El precio es por unidad (un, L, kg), con IVA, y es uno solo por código: se actualiza en todas las listas que usan ese código.</div>
      <div class="field"><label>Nota</label><input id="re-nota" value="${esc(r ? r.nota || '' : '')}" placeholder="Ej.: extraer muestra para análisis antes de cambiar"></div>
      ${r && r.solo_equipo ? `<div class="aviso-caja">Este renglón es <b>solo para ${esc(r.solo_equipo)}</b>.</div>`
        : E.eq && eqs.length > 1 ? `<div class="aviso-caja">${r ? 'Este cambio aplica' : 'Se agrega'} a la lista de <b>${esc(eqs.join(', '))}</b>.
            <label style="display:inline-flex;gap:5px;align-items:center;margin-left:6px;text-transform:none;font-weight:600"><input type="checkbox" id="re-solo" style="width:auto"> Solo para ${esc(E.eq)}</label></div>` : ''}
      <div class="acciones">
        ${r ? `<button class="btn btn-rojo" style="margin-right:auto" onclick="Recursos.quitar()">Quitar${compartido && E.eq ? '…' : ''}</button>` : ''}
        <button class="btn btn-gris" onclick="Recursos.volver()">Cancelar</button>
        <button class="btn btn-verde" onclick="Recursos.guardar()">${r ? 'Guardar' : 'Agregar'}</button></div></div>`);
    pintarCods();
    const g = $('re-grupo');
    g.onchange = () => { if (g.value === '__otro') { const n = prompt('Nombre del grupo nuevo'); if (n && n.trim()) { g.insertAdjacentHTML('afterbegin', `<option selected>${esc(n.trim())}</option>`); } else g.value = 'Otros'; } };
  }
  function leerCods() {
    document.querySelectorAll('#re-cods tr').forEach((tr, i) => {
      const c = E.cods[i]; if (!c) return;
      c.c = tr.querySelector('.cod').value.trim(); c.marca = tr.querySelector('.marca').value.trim();
      c.e = tr.querySelector('.est').value; c.precio = num(tr.querySelector('.precio').value);
    });
  }
  function pintarCods() {
    $('re-cods').innerHTML = E.cods.map((c, i) => `<tr>
      <td style="width:30px">${i ? `<button class="mini" title="Hacer principal" onclick="Recursos.codSubir(${i})">↑</button>` : '<span class="chip azul" style="font-size:calc(10px*var(--fs,1))">principal</span>'}</td>
      <td><input class="cod" value="${esc(c.c)}" placeholder="Código" onchange="Recursos.codCompletar(${i}, this.value)"></td>
      <td><input class="marca" value="${esc(c.marca)}" placeholder="Marca"></td>
      <td><select class="est">${Object.entries(ESTADOS).map(([k, t]) => `<option value="${k}" ${k === c.e ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input class="precio r" inputmode="numeric" value="${c.precio !== null && c.precio !== undefined ? gs(c.precio) : ''}" placeholder="opcional"></td>
      <td style="width:30px"><button class="mini" title="Quitar código" onclick="Recursos.codQuitar(${i})">✕</button></td></tr>`).join('');
  }
  function codMas() { leerCods(); E.cods.push({ c: '', e: 'na', marca: '', precio: null, precio0: null }); pintarCods(); }
  function codQuitar(i) { leerCods(); E.cods.splice(i, 1); if (!E.cods.length) E.cods.push({ c: '', e: 'na', marca: '', precio: null, precio0: null }); pintarCods(); }
  function codSubir(i) { leerCods(); const [c] = E.cods.splice(i, 1); E.cods.splice(i - 1, 0, c); pintarCods(); }
  // Si el código ya existe, trae su marca y precio
  function codCompletar(i, v) {
    leerCods();
    const k = D.codigos.get(clave(v));
    if (k) { E.cods[i].marca = E.cods[i].marca || k.marca || ''; E.cods[i].precio = E.cods[i].precio ?? k.precio_gs; E.cods[i].precio0 = k.precio_gs; pintarCods(); }
  }
  function sugerir(q) {
    const s = $('re-sug');
    q = (q || '').trim().toLowerCase();
    if (q.length < 2) { s.innerHTML = ''; return; }
    const qc = clave(q), vistos = new Set(), out = [];
    for (const r of D.recursos) {
      const ok = r.descripcion.toLowerCase().includes(q) || (r.codigos || []).some(c => (clave(c.c) || '').includes(qc));
      if (!ok) continue;
      const k = r.descripcion.toLowerCase() + '|' + clave((r.codigos[0] || {}).c);
      if (vistos.has(k)) continue;
      vistos.add(k); out.push(r);
      if (out.length >= 8) break;
    }
    s.innerHTML = `<div class="rec-sug">${out.map(r => { const p = precioDe(r); return `<div onclick="Recursos.usarSugerencia(${r.id})"><b>${esc(r.descripcion)}</b> ${(r.codigos || []).slice(0, 2).map(chipCod).join('')}
        <span class="mut">· en ${esc((lista(r.lista_id) || {}).nombre || '')}${p ? ' · Gs ' + gs(p.precio) : ''}</span></div>`; }).join('')}
      <div style="color:var(--azul-medio);font-weight:700" onclick="Recursos.usarSugerencia(null)">+ Crear «${esc(q)}» como recurso nuevo</div></div>`;
  }
  function usarSugerencia(id) {
    const q = $('re-buscar').value.trim();
    $('re-sug').innerHTML = '';
    if (!id) { $('re-desc').value = q.charAt(0).toUpperCase() + q.slice(1); $('re-desc').focus(); return; }
    const r = D.recursos.find(x => x.id === id);
    $('re-desc').value = r.descripcion;
    if ([...$('re-grupo').options].some(o => o.value === r.grupo)) $('re-grupo').value = r.grupo;
    $('re-cant').value = r.cantidad ?? '';
    if (r.unidad && ![...$('re-un').options].some(o => o.value === r.unidad)) $('re-un').insertAdjacentHTML('beforeend', `<option>${esc(r.unidad)}</option>`);
    $('re-un').value = r.unidad || 'un';
    document.querySelectorAll('.re-sv').forEach(ch => ch.checked = (r.services || []).includes(Number(ch.value)));
    E.cods = (r.codigos || []).map(c => { const k = D.codigos.get(clave(c.c)) || {}; return { c: c.c, e: c.e || 'na', marca: k.marca || '', precio: k.precio_gs ?? null, precio0: k.precio_gs ?? null }; });
    if (!E.cods.length) E.cods.push({ c: '', e: 'na', marca: '', precio: null, precio0: null });
    pintarCods();
    toast('Copiado: revisá cantidad y services para este modelo', 'success');
  }

  async function guardarCodigos(cods) {
    const filas = cods.filter(c => clave(c.c)).map(c => {
      const k = D.codigos.get(clave(c.c)) || {};
      const cambioPrecio = (c.precio ?? null) !== (k.precio_gs === undefined || k.precio_gs === null ? null : Number(k.precio_gs));
      return { clave: clave(c.c), codigo: k.codigo || c.c, marca: c.marca || k.marca || null,
        precio_gs: c.precio ?? null,
        precio_fecha: cambioPrecio ? (c.precio === null ? null : hoy()) : (k.precio_fecha ?? null),
        precio_por: cambioPrecio ? (c.precio === null ? null : sesion.nombre) : (k.precio_por ?? null),
        actualizado_en: new Date().toISOString() };
    });
    const unicas = [...new Map(filas.map(f => [f.clave, f])).values()];
    if (!unicas.length) return null;
    const { error } = await sb.from('mant_codigos').upsert(unicas, { onConflict: 'clave' });
    return error;
  }
  const tocarLista = (lid) => sb.from('mant_listas').update({ actualizado_en: new Date().toISOString(), actualizado_por: sesion.nombre }).eq('id', lid);

  async function guardar() {
    leerCods();
    const desc = $('re-desc').value.trim();
    if (!desc) return toast('Poné el nombre del recurso', 'warning');
    const services = [...document.querySelectorAll('.re-sv:checked')].map(ch => Number(ch.value));
    const otro = Number($('re-sv-otro').value);
    if (otro > 0 && !services.includes(otro)) services.push(otro);
    services.sort((a, b) => a - b);
    const cods = E.cods.filter(c => c.c);
    const vistos = new Set();
    for (const c of cods) { const k = clave(c.c); if (vistos.has(k)) return toast(`El código ${c.c} está repetido`, 'warning'); vistos.add(k); }
    const datos = { descripcion: desc, grupo: $('re-grupo').value === '__otro' ? 'Otros' : $('re-grupo').value, cantidad: numCant($('re-cant').value),
      unidad: $('re-un').value || null, services, nota: $('re-nota').value.trim() || null,
      codigos: cods.map(c => ({ c: c.c, e: c.e || 'na' })), actualizado_en: new Date().toISOString() };
    const solo = $('re-solo') && $('re-solo').checked;
    mostrarCarga('Guardando…');
    let error = await guardarCodigos(cods);
    if (!error) {
      const r = E.id ? D.recursos.find(x => x.id === E.id) : null;
      if (!r) {
        const orden = Math.max(0, ...renglonesLista(E.lid).map(x => x.orden || 0)) + 1;
        ({ error } = await sb.from('mant_recursos').insert(Object.assign(datos, { lista_id: E.lid, orden, solo_equipo: solo ? E.eq : null })));
      } else if (solo) {
        // Copia solo para este equipo y el original deja de aplicarle
        ({ error } = await sb.from('mant_recursos').insert(Object.assign({}, datos, { lista_id: r.lista_id, orden: r.orden, solo_equipo: E.eq })));
        if (!error) ({ error } = await sb.from('mant_recursos').update({ excluye: [...new Set((r.excluye || []).concat(E.eq))] }).eq('id', r.id));
      } else {
        ({ error } = await sb.from('mant_recursos').update(datos).eq('id', r.id));
      }
    }
    if (!error) await tocarLista(E.lid);
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Guardado', 'success');
    if (F.cont !== 'modal-cuerpo') cerrarModal();
    refrescar();
  }

  async function quitar() {
    const r = D.recursos.find(x => x.id === E.id);
    if (!r) return;
    const eqs = equiposDe(r.lista_id);
    let soloEste = false;
    if (!r.solo_equipo && E.eq && eqs.length > 1) {
      const resp = prompt(`«${r.descripcion}» está en la lista de ${eqs.join(', ')}.\n\nEscribí 1 para quitarlo solo de ${E.eq}\nEscribí 2 para quitarlo de toda la lista`, '1');
      if (resp === null) return;
      if (!['1', '2'].includes(resp.trim())) return toast('No se quitó nada', 'warning');
      soloEste = resp.trim() === '1';
    } else if (!confirm(`¿Quitar «${r.descripcion}» de la lista?`)) return;
    const { error } = soloEste
      ? await sb.from('mant_recursos').update({ excluye: [...new Set((r.excluye || []).concat(E.eq))] }).eq('id', r.id)
      : await sb.from('mant_recursos').delete().eq('id', r.id);
    if (error) return toast('No se pudo quitar: ' + error.message, 'error');
    await tocarLista(r.lista_id);
    toast('Quitado', 'success');
    if (F.cont !== 'modal-cuerpo') cerrarModal();
    refrescar();
  }

  // ══════════════════════════════════════════════════════════════
  // LISTAS: crear, asignar a un equipo, nombre y equipos
  // ══════════════════════════════════════════════════════════════
  function asignar(eq) {
    estilos();
    const actual = D.eqLista.get(eq) || null;
    const f = fichaDe(eq);
    const base = [f.marca, f.modelo].filter(Boolean).join(' ').toLowerCase();
    const ordenadas = [...D.listas].sort((a, b) => {
      const pa = base && a.nombre.toLowerCase().includes(base) ? 0 : 1, pb = base && b.nombre.toLowerCase().includes(base) ? 0 : 1;
      return pa - pb || a.nombre.localeCompare(b.nombre, 'es');
    });
    abrirModal(`Lista de recursos de ${eq}`, `<div class="rec-ed">
      <div class="field"><label>Lista</label><select id="as-lista"><option value="">— sin lista —</option>
        ${ordenadas.map(l => `<option value="${l.id}" ${l.id === actual ? 'selected' : ''}>${esc(l.nombre)} · ${esc(equiposDe(l.id).join(', ') || 'sin equipos')}</option>`).join('')}</select>
        <div class="ayuda">Las máquinas del mismo modelo comparten la lista: lo que se cambia en una, se ve en todas.</div></div>
      <div class="acciones"><button class="btn btn-gris" style="margin-right:auto" onclick="Recursos.nuevaLista('${esc(eq)}')">Crear lista nueva</button>
        <button class="btn btn-gris" onclick="cerrarModal()">Cancelar</button><button class="btn btn-verde" onclick="Recursos.guardarAsignacion('${esc(eq)}')">Guardar</button></div></div>`);
  }
  async function guardarAsignacion(eq) {
    const lid = $('as-lista').value ? Number($('as-lista').value) : null;
    const { error } = await sb.from('equipos').update({ lista_recursos_id: lid }).eq('id', eq);
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    cerrarModal(); toast('Guardado', 'success'); refrescar();
  }
  async function nuevaLista(eq) {
    const f = eq ? fichaDe(eq) : {};
    const nombre = prompt('Nombre de la lista (marca y modelo)', [f.marca, f.modelo].filter(Boolean).join(' ') || f.tipo || '');
    if (!nombre || !nombre.trim()) return;
    const { data, error } = await sb.from('mant_listas').insert({ nombre: nombre.trim(), actualizado_por: sesion.nombre }).select().single();
    if (error) return toast('No se pudo crear: ' + error.message, 'error');
    if (eq) {
      const r = await sb.from('equipos').update({ lista_recursos_id: data.id }).eq('id', eq);
      if (r.error) return toast('Lista creada, pero no se pudo asignar: ' + r.error.message, 'error');
    }
    cerrarModal(); toast('Lista creada', 'success');
    await cargar(true);
    if (eq) { F.lista = data.id; refrescar(); } else abrirLista(data.id);
  }
  function datosLista(lid) {
    const l = lista(lid), eqs = equiposDe(lid);
    const candidatos = (typeof flota !== 'undefined' ? flota : []).filter(f => f.activo && f.propiedad !== 'Tercero' && ['equipo', 'vehiculo_liviano'].includes(f.categoria))
      .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
    abrirModal('Nombre y equipos de la lista', `<div class="rec-ed">
      <div class="field"><label>Nombre</label><input id="dl-nom" value="${esc(l.nombre)}"></div>
      <div class="field"><label>Notas</label><input id="dl-notas" value="${esc(l.notas || '')}"></div>
      <div class="field"><label>Equipos que la usan</label>
        <input id="dl-buscar" placeholder="Buscar equipo, tipo, marca…" oninput="Recursos.filtrarEquiposLista(this.value)" style="margin-bottom:6px">
        <div id="dl-eqs" style="max-height:260px;overflow-y:auto;border:1.5px solid var(--gris-borde);border-radius:8px;padding:4px 8px">
        ${candidatos.map(f => { const otra = D.eqLista.get(f.id); return `<label class="check-linea" data-t="${esc([f.id, f.tipo, f.marca, f.modelo].join(' ').toLowerCase())}" style="padding:4px 0">
          <input type="checkbox" class="dl-eq" value="${esc(f.id)}" ${eqs.includes(f.id) ? 'checked' : ''}> <b>${esc(f.id)}</b>
          <span style="color:var(--gris-texto);font-size:calc(12px*var(--fs,1))">${esc([f.tipo, f.marca, f.modelo].filter(Boolean).join(' · '))}${otra && otra !== lid ? ' · ahora en «' + esc((lista(otra) || {}).nombre || '') + '»' : ''}</span></label>`; }).join('')}</div>
        <div class="ayuda">Marcar un equipo que estaba en otra lista lo pasa a esta.</div></div>
      <div class="acciones"><button class="btn btn-rojo" style="margin-right:auto" onclick="Recursos.borrarLista(${lid})">Eliminar lista</button>
        <button class="btn btn-gris" onclick="Recursos.abrirLista(${lid})">Cancelar</button><button class="btn btn-verde" onclick="Recursos.guardarDatosLista(${lid})">Guardar</button></div></div>`);
  }
  function filtrarEquiposLista(q) {
    q = (q || '').toLowerCase().trim();
    document.querySelectorAll('#dl-eqs label').forEach(l => l.style.display = !q || l.dataset.t.includes(q) ? '' : 'none');
  }
  async function guardarDatosLista(lid) {
    const nombre = $('dl-nom').value.trim();
    if (!nombre) return toast('Poné un nombre', 'warning');
    const marcados = [...document.querySelectorAll('.dl-eq:checked')].map(c => c.value);
    const antes = equiposDe(lid);
    mostrarCarga('Guardando…');
    let { error } = await sb.from('mant_listas').update({ nombre, notas: $('dl-notas').value.trim() || null, actualizado_en: new Date().toISOString(), actualizado_por: sesion.nombre }).eq('id', lid);
    const sacar = antes.filter(e => !marcados.includes(e)), poner = marcados.filter(e => !antes.includes(e));
    if (!error && sacar.length) ({ error } = await sb.from('equipos').update({ lista_recursos_id: null }).in('id', sacar));
    if (!error && poner.length) ({ error } = await sb.from('equipos').update({ lista_recursos_id: lid }).in('id', poner));
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Guardado', 'success');
    await cargar(true); abrirLista(lid);
    if (typeof Gestion2 !== 'undefined' && Gestion2.recursosCambiaron) Gestion2.recursosCambiaron();
  }
  async function borrarLista(lid) {
    const l = lista(lid);
    const n = prompt(`Se borra la lista «${l.nombre}» con sus ${renglonesLista(lid).length} renglones, y ${equiposDe(lid).length} equipos quedan sin lista.\nLos services ya registrados no cambian.\n\nEscribí BORRAR para confirmar.`);
    if (!n || n.trim().toUpperCase() !== 'BORRAR') return;
    const { error } = await sb.from('mant_listas').delete().eq('id', lid);
    if (error) return toast('No se pudo borrar: ' + error.message, 'error');
    cerrarModal(); toast('Lista borrada', 'success');
    await cargar(true);
    if (typeof Gestion2 !== 'undefined' && Gestion2.recursosCambiaron) Gestion2.recursosCambiaron();
  }

  // ══════════════════════════════════════════════════════════════
  // RECURSOS USADOS EN UN MANTENIMIENTO
  // ══════════════════════════════════════════════════════════════
  const U = { m: null, filas: [], alGuardar: null };
  async function usados(mid, alGuardar) {
    estilos();
    U.alGuardar = alGuardar || null;
    abrirModal('Recursos usados', '<div class="empty-state">Cargando…</div>');
    $('modal').querySelector('.modal-card').classList.add('ancho');
    const [m, f] = await Promise.all([
      sb.from('mantenimientos').select('*').eq('id', mid).single(),
      sb.from('mantenimiento_recursos').select('*').eq('mantenimiento_id', mid).order('orden').order('id')]);
    if (m.error || f.error) return $('modal-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc((m.error || f.error).message)}</div>`;
    try { await cargar(); } catch (e) { /* sin listas igual se puede ver lo cargado */ }
    U.m = m.data;
    U.filas = f.data.map(x => Object.assign({}, x));
    pintarUsados();
  }
  function opcionesCodigo(x) {
    const r = x.recurso_id ? D.recursos.find(y => y.id === x.recurso_id) : null;
    const cods = [...new Set([x.codigo, ...((r && r.codigos) || []).map(c => c.c)].filter(Boolean))];
    return cods;
  }
  function pintarUsados() {
    const m = U.m, t = puede();
    const estado = m.recursos_estado === 'confirmado' ? '<span class="chip rconf">confirmado</span>'
      : m.recursos_estado === 'estandar' ? '<span class="chip rest">kit estándar · sin revisar</span>' : '';
    const lid = D.eqLista.get(m.equipo_id);
    const precio = (x) => { if (x.precio_gs !== null && x.precio_gs !== undefined) return Number(x.precio_gs); const k = D.codigos.get(clave(x.codigo)); return k && k.precio_gs !== null ? Number(k.precio_gs) : null; };
    const total = U.filas.filter(x => x.usado).reduce((a, x) => a + (precio(x) !== null && x.cantidad ? precio(x) * Number(x.cantidad) : 0), 0);
    const descs = [...new Set(recursosDe(m.equipo_id).map(r => r.descripcion))];
    $('modal-titulo').textContent = `Recursos usados — ${m.equipo_id}`;
    $('modal-cuerpo').innerHTML = `<div class="rec-ed rec-us">
      <div class="datos" style="margin-bottom:12px">
        <div class="dato"><div class="e">Mantenimiento</div><div class="v">${fmtFecha(m.fecha)} · ${esc(m.tipo || '')}${m.nivel ? ' ' + esc(m.nivel) + ' h' : ''}</div></div>
        <div class="dato"><div class="e">Lectura</div><div class="v">${m.horometro ? fmtNum(m.horometro, 1) + ' h' : m.km ? fmtNum(m.km) + ' km' : ''}</div></div>
        <div class="dato"><div class="e">Lista</div><div class="v">${lid ? esc(lista(lid).nombre) : 'sin lista'}</div></div>
        <div class="dato"><div class="e">Estado</div><div class="v">${estado || '—'}</div></div></div>
      ${m.descripcion ? `<p style="font-size:calc(13px*var(--fs,1));color:var(--gris-texto);margin:0 0 10px">${esc(m.descripcion)}</p>` : ''}
      ${m.recursos_estado === 'estandar' && t ? '<div class="aviso-caja">Se cargó solo el kit estándar del service. Destildá lo que no se cambió, corregí cantidades o códigos y agregá lo que falte; al guardar queda <b>confirmado</b>.</div>' : ''}
      ${!U.filas.length ? `<div class="empty-state" style="padding:14px">Sin recursos cargados.${!lid ? ' La máquina no tiene lista de recursos.' : ''}</div>` : ''}
      ${U.filas.length ? `<div style="overflow-x:auto"><table><thead><tr><th style="width:30px">Usado</th><th>Recurso</th><th style="width:170px">Código</th><th style="width:90px;text-align:right">Cant.</th><th style="width:60px">Un.</th><th style="width:110px;text-align:right">Precio Gs</th>${t ? '<th style="width:30px"></th>' : ''}</tr></thead><tbody>
        ${U.filas.map((x, i) => `<tr class="${x.usado ? '' : 'no'} ${x.agregado ? 'ag' : ''}">
          <td><input type="checkbox" ${x.usado ? 'checked' : ''} ${t ? '' : 'disabled'} onchange="Recursos.usadoMarcar(${i}, this.checked)"></td>
          <td>${x.agregado && t ? `<input value="${esc(x.descripcion)}" list="us-descs" onchange="Recursos.usadoCampo(${i}, 'descripcion', this.value)">` : `<span class="d">${esc(x.descripcion)}</span>`}
            ${x.agregado ? ' <span class="chip rconf" style="font-size:calc(10px*var(--fs,1))">agregado</span>' : ''}</td>
          <td>${t ? (opcionesCodigo(x).length > 1 && !x.agregado
              ? `<select onchange="Recursos.usadoCampo(${i}, 'codigo', this.value)">${opcionesCodigo(x).map(c => `<option ${c === x.codigo ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
              : `<input class="cod" value="${esc(x.codigo || '')}" onchange="Recursos.usadoCampo(${i}, 'codigo', this.value)">`) : `<span class="rcod pri"><i></i>${esc(x.codigo || '—')}</span>`}</td>
          <td>${t ? `<input class="r" type="number" step="any" min="0" value="${x.cantidad ?? ''}" onchange="Recursos.usadoCampo(${i}, 'cantidad', this.value)">` : `<span style="float:right">${fmtNum(x.cantidad, 2)}</span>`}</td>
          <td>${t && x.agregado ? `<input value="${esc(x.unidad || '')}" onchange="Recursos.usadoCampo(${i}, 'unidad', this.value)">` : esc(x.unidad || '')}</td>
          <td style="text-align:right">${precio(x) !== null ? gs(precio(x)) : '<span class="rsinp">sin precio</span>'}</td>
          ${t ? `<td>${x.agregado ? `<button class="mini" onclick="Recursos.usadoQuitar(${i})">✕</button>` : ''}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>` : ''}
      <datalist id="us-descs">${descs.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 12px">
        ${t ? '<button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio)" onclick="Recursos.usadoMas()">+ Otro recurso</button>' : ''}
        <span style="margin-left:auto;font-size:calc(13px*var(--fs,1))">${U.filas.filter(x => x.usado).length} recursos · costo estimado <b>Gs ${gs(total)}</b></span></div>
      ${t ? `<div class="acciones">
        ${lid ? '<button class="btn btn-gris" style="margin-right:auto" onclick="Recursos.usadoKit()">Volver al kit estándar</button>' : ''}
        <button class="btn btn-gris" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-verde" onclick="Recursos.usadoGuardar()">Guardar y confirmar</button></div>` : ''}</div>`;
  }
  function usadoMarcar(i, v) { U.filas[i].usado = v; pintarUsados(); }
  function usadoCampo(i, k, v) {
    const x = U.filas[i];
    if (k === 'cantidad') x.cantidad = numCant(v);
    else x[k] = (v || '').trim() || null;
    if (k === 'descripcion' && x.agregado) {   // si coincide con un recurso de la lista, trae código y unidad
      const r = recursosDe(U.m.equipo_id).find(y => y.descripcion === x.descripcion);
      if (r) { x.recurso_id = r.id; x.codigo = x.codigo || (r.codigos[0] || {}).c || null; x.unidad = x.unidad || r.unidad; x.cantidad = x.cantidad ?? r.cantidad; }
    }
    if (k === 'codigo') x.precio_gs = null;   // toma el precio del código elegido
    pintarUsados();
  }
  function usadoMas() { U.filas.push({ recurso_id: null, descripcion: '', codigo: null, cantidad: 1, unidad: 'un', precio_gs: null, usado: true, agregado: true }); pintarUsados(); }
  function usadoQuitar(i) { U.filas.splice(i, 1); pintarUsados(); }
  async function usadoKit() {
    if (!confirm('¿Reemplazar lo cargado por el kit estándar del service?')) return;
    const { data, error } = await sb.rpc('mant_recargar_kit', { p_mantenimiento: U.m.id });
    if (error) return toast('No se pudo: ' + error.message, 'error');
    toast(data ? `Kit estándar: ${data} recursos` : 'La lista no tiene recursos para ese service', data ? 'success' : 'warning');
    usados(U.m.id, U.alGuardar);
    if (U.alGuardar) U.alGuardar();
  }
  async function usadoGuardar() {
    if (U.filas.some(x => !String(x.descripcion || '').trim())) return toast('Hay un recurso agregado sin nombre', 'warning');
    const filas = U.filas.map(x => {
      const k = D.codigos.get(clave(x.codigo));
      return { recurso_id: x.recurso_id, descripcion: x.descripcion, codigo: x.codigo, cantidad: x.cantidad, unidad: x.unidad,
        precio_gs: x.precio_gs ?? (k && k.precio_gs !== null ? k.precio_gs : null), usado: !!x.usado, agregado: !!x.agregado };
    });
    const { error } = await sb.rpc('mant_guardar_recursos', { p_mantenimiento: U.m.id, p_filas: filas });
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    cerrarModal(); toast('Recursos confirmados', 'success');
    if (U.alGuardar) U.alGuardar();
  }

  // Totales de varios mantenimientos (para listas de realizados)
  async function totales(ids) {
    const out = new Map();
    ids = [...new Set(ids)].filter(Boolean);
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await sb.from('v_mantenimiento_recursos_total').select('*').in('mantenimiento_id', ids.slice(i, i + 150));
      if (error) return out;
      (data || []).forEach(x => out.set(Number(x.mantenimiento_id), x));
    }
    return out;
  }
  function chipUsados(m, tot, fn) {
    const t = tot && tot.get(m.id);
    if (!t && m.tipo !== 'Preventivo') return fn ? `<span class="chip gris rclic" onclick="event.stopPropagation();${fn}">+ recursos</span>` : '';
    if (!t) return `<span class="chip gris rclic" onclick="event.stopPropagation();${fn}">sin recursos</span>`;
    const cls = m.recursos_estado === 'confirmado' ? 'rconf' : 'rest';
    return `<span class="chip ${cls} rclic" title="${m.recursos_estado === 'confirmado' ? 'Confirmado' : 'Kit estándar, sin revisar'}" onclick="event.stopPropagation();${fn}">${t.recursos} recurso${t.recursos === 1 ? '' : 's'}${m.recursos_estado === 'confirmado' ? '' : ' · estándar'}</span>`;
  }

  // ══════════════════════════════════════════════════════════════
  // EXCEL (una lista o todas): bajar y subir
  // ══════════════════════════════════════════════════════════════
  async function cargarXLSX() {
    if (window.XLSX) return true;
    await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
      .catch(() => toast('No se pudo cargar el lector de Excel', 'error'));
    return !!window.XLSX;
  }
  const COLS_X = ['ID lista', 'Lista', 'Equipos', 'Grupo', 'Recurso', 'Códigos', 'Cantidad', 'Unidad', '250 h', '1.000 h', '2.000 h', 'Otros services', 'Nota', 'Solo para', 'Precio Gs (código principal)'];
  async function bajarExcel(lids) {
    if (!(await cargarXLSX())) return;
    lids = lids && lids.length ? lids : D.listas.map(l => l.id);
    const aoa = [COLS_X];
    lids.forEach(lid => {
      const l = lista(lid); if (!l) return;
      const eqs = equiposDe(lid).join(', ');
      const rs = renglonesLista(lid);
      if (!rs.length) aoa.push([lid, l.nombre, eqs]);
      rs.forEach(r => {
        const sv = r.services || [];
        const k = D.codigos.get(clave((r.codigos[0] || {}).c));
        aoa.push([lid, l.nombre, eqs, r.grupo, r.descripcion,
          (r.codigos || []).map(c => c.c + (ETQ_EXCEL[c.e] ? ` (${ETQ_EXCEL[c.e]})` : '')).join(' / '),
          r.cantidad ?? '', r.unidad || '', sv.includes(250) ? 'x' : '', sv.includes(1000) ? 'x' : '', sv.includes(2000) ? 'x' : '',
          sv.filter(n => !SERVICES_BASE.includes(n)).join(', '), r.nota || '', r.solo_equipo || '', k && k.precio_gs !== null ? Number(k.precio_gs) : '']);
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [8, 26, 22, 18, 36, 40, 9, 8, 6, 7, 7, 10, 28, 10, 14].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Recursos');
    const ley = XLSX.utils.aoa_to_sheet([['Cómo completar'], ['Códigos: separados por " / ". El primero es el principal. Estado entre paréntesis: (SIS) verificado con SIS, (compatible), (verificar). Sin paréntesis = sin verificar.'],
      ['250 h / 1.000 h / 2.000 h: una x en el service en que se cambia. Otros services: números separados por coma (ej.: 500, 3000). Sin ninguno = según desgaste o inspección.'],
      ['ID lista: no lo cambies. Para una lista nueva dejalo vacío y poné el nombre en Lista y los equipos en Equipos (separados por coma).'],
      ['Al subir, los renglones de cada lista del archivo reemplazan a los que tenía. Las listas que no están en el archivo no se tocan.'],
      ['Precio: por unidad, con IVA, del código principal. Vacío = no cambia el precio.']]);
    XLSX.utils.book_append_sheet(wb, ley, 'Cómo completar');
    const nom = lids.length === 1 ? 'recursos_' + lista(lids[0]).nombre.replace(/[^\w\-]+/g, '_') : 'recursos_mantenimiento';
    XLSX.writeFile(wb, `${nom}_${hoy()}.xlsx`);
  }

  const X = { soloLista: null, plan: null };
  function subirExcel(soloLista) {
    X.soloLista = soloLista || null;
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.xlsx,.xls';
    i.onchange = () => i.files[0] && leerExcel(i.files[0]);
    i.click();
  }
  function parsearCodigos(t) {
    return String(t || '').split(/\s*\/\s*|\s*;\s*|\n/).map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/^(.*?)\s*\((sis|compatible|verificar|ok|ver)\)\s*$/i);
      if (!m) return { c: s, e: 'na' };
      const e = m[2].toLowerCase();
      return { c: m[1].trim(), e: e === 'sis' ? 'sis' : (e === 'compatible' || e === 'ok') ? 'ok' : 'ver' };
    });
  }
  async function leerExcel(file) {
    if (!(await cargarXLSX())) return;
    mostrarCarga('Leyendo Excel…');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const g = new Map();
      const x = (v) => String(v || '').trim().toLowerCase() === 'x';
      for (const f of filas) {
        const desc = String(f['Recurso'] || '').trim();
        let lid = X.soloLista || (f['ID lista'] !== '' ? Number(f['ID lista']) : null);
        const nomLista = String(f['Lista'] || '').trim();
        if (!X.soloLista && !lid && !nomLista) continue;
        if (lid && !lista(lid)) lid = null;
        const k = lid ? 'id:' + lid : 'nueva:' + nomLista.toLowerCase();
        if (!g.has(k)) g.set(k, { lid, nombre: lid ? lista(lid).nombre : nomLista, equipos: null, filas: [] });
        const grp = g.get(k);
        const eqTxt = String(f['Equipos'] || '').trim();
        if (eqTxt && !grp.equipos) grp.equipos = eqTxt.toUpperCase().split(/[\s,;]+/).filter(Boolean);
        if (!desc) continue;
        const sv = [];
        if (x(f['250 h'])) sv.push(250); if (x(f['1.000 h'])) sv.push(1000); if (x(f['2.000 h'])) sv.push(2000);
        String(f['Otros services'] || '').split(/[,;\s]+/).map(s => parseInt(s.replace(/\D/g, ''), 10)).filter(n => n > 0 && !sv.includes(n)).forEach(n => sv.push(n));
        sv.sort((a, b) => a - b);
        grp.filas.push({ grupo: String(f['Grupo'] || '').trim() || 'Otros', descripcion: desc, codigos: parsearCodigos(f['Códigos']),
          cantidad: numCant(f['Cantidad']), unidad: String(f['Unidad'] || '').trim() || null, services: sv,
          nota: String(f['Nota'] || '').trim() || null, solo_equipo: String(f['Solo para'] || '').trim().toUpperCase() || null,
          precio: num(f['Precio Gs (código principal)']) });
      }
      X.plan = [...g.values()];
      ocultarCarga();
      if (!X.plan.length) return toast('El archivo no tiene renglones con el formato de la plantilla', 'warning');
      const ids = new Set((typeof flota !== 'undefined' ? flota : []).map(f => f.id));
      abrirModal('Subir Excel de recursos', `<div class="rec-ed">
        <p style="margin:0 0 10px;font-size:calc(13px*var(--fs,1))">Revisá antes de aplicar. Los renglones de cada lista se <b>reemplazan</b> por los del archivo; los services ya registrados no cambian.</p>
        <div class="tabla-wrap" style="max-height:50vh"><table class="tabla"><thead><tr><th>Lista</th><th>Renglones antes</th><th>Renglones nuevos</th><th>Equipos</th></tr></thead><tbody>
        ${X.plan.map(p => `<tr><td><b>${esc(p.nombre)}</b>${p.lid ? '' : ' <span class="chip verde">nueva</span>'}</td><td>${p.lid ? renglonesLista(p.lid).length : '—'}</td><td>${p.filas.length}</td>
          <td>${p.equipos ? esc(p.equipos.join(', ')) + (p.equipos.some(e => !ids.has(e)) ? ` <span class="rsinp">sin ficha: ${esc(p.equipos.filter(e => !ids.has(e)).join(', '))}</span>` : '') : '<span style="color:var(--gris-texto)">sin cambios</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="acciones" style="margin-top:12px"><button class="btn btn-gris" onclick="cerrarModal()">Cancelar</button><button class="btn btn-verde" onclick="Recursos.aplicarExcel()">Aplicar</button></div></div>`);
      $('modal').querySelector('.modal-card').classList.add('ancho');
    } catch (e) { ocultarCarga(); toast('No se pudo leer el archivo: ' + e.message, 'error'); }
  }
  async function aplicarExcel() {
    const plan = X.plan || [];
    mostrarCarga('Aplicando…');
    const ids = new Set((typeof flota !== 'undefined' ? flota : []).map(f => f.id));
    try {
      // Códigos y precios: uno por código
      const cods = new Map();
      plan.forEach(p => p.filas.forEach(f => f.codigos.forEach((c, i) => {
        const k = clave(c.c); if (!k) return;
        const prev = D.codigos.get(k) || {};
        const nuevo = cods.get(k) || { clave: k, codigo: prev.codigo || c.c, marca: prev.marca || null, precio_gs: prev.precio_gs ?? null,
          precio_fecha: prev.precio_fecha ?? null, precio_por: prev.precio_por ?? null, actualizado_en: new Date().toISOString() };
        if (i === 0 && f.precio !== null && f.precio !== Number(prev.precio_gs)) { nuevo.precio_gs = f.precio; nuevo.precio_fecha = hoy(); nuevo.precio_por = sesion.nombre + ' (Excel)'; }
        cods.set(k, nuevo);
      })));
      const lc = [...cods.values()];
      for (let i = 0; i < lc.length; i += 500) {
        const { error } = await sb.from('mant_codigos').upsert(lc.slice(i, i + 500), { onConflict: 'clave' });
        if (error) throw error;
      }
      for (const p of plan) {
        let lid = p.lid, viejos = [];
        if (!lid) {
          const { data, error } = await sb.from('mant_listas').insert({ nombre: p.nombre, actualizado_por: sesion.nombre }).select().single();
          if (error) throw error;
          lid = data.id;
        } else {
          viejos = renglonesLista(lid).map(r => r.id);
        }
        // Primero entran los renglones nuevos y recién después se borran los viejos:
        // si algo falla a mitad, la lista no queda vacía (a lo sumo, repetida).
        const filas = p.filas.map((f, i) => ({ lista_id: lid, orden: i + 1, grupo: f.grupo, descripcion: f.descripcion,
          codigos: f.codigos, cantidad: f.cantidad, unidad: f.unidad, services: f.services, nota: f.nota,
          solo_equipo: f.solo_equipo && ids.has(f.solo_equipo) ? f.solo_equipo : null }));
        for (let i = 0; i < filas.length; i += 500) {
          const { error } = await sb.from('mant_recursos').insert(filas.slice(i, i + 500));
          if (error) throw error;
        }
        for (let i = 0; i < viejos.length; i += 200) {
          const { error } = await sb.from('mant_recursos').delete().in('id', viejos.slice(i, i + 200));
          if (error) throw error;
        }
        if (p.lid) { const { error } = await tocarLista(lid); if (error) throw error; }
        if (p.equipos) {
          const eqs = p.equipos.filter(e => ids.has(e));
          if (eqs.length) { const { error } = await sb.from('equipos').update({ lista_recursos_id: lid }).in('id', eqs); if (error) throw error; }
        }
      }
      ocultarCarga(); cerrarModal();
      toast(`Listo: ${plan.length} lista${plan.length > 1 ? 's' : ''} actualizada${plan.length > 1 ? 's' : ''}`, 'success');
      refrescar();
    } catch (e) { ocultarCarga(); toast('Se cortó a mitad: ' + e.message + '. Revisá y volvé a subir.', 'error'); refrescar(); }
  }

  // ══════════════════════════════════════════════════════════════
  // SOLAPA MANTENIMIENTO › LISTAS DE RECURSOS
  // ══════════════════════════════════════════════════════════════
  const L = { q: '', mostrar: '', tarjeta: null };
  const propiosConPlan = () => (typeof flota !== 'undefined' ? flota : []).filter(f => f.activo && f.propiedad !== 'Tercero' && ['equipo', 'vehiculo_liviano'].includes(f.categoria));
  async function pintarListas(cid) {
    estilos();
    const c = $(cid);
    try { await cargar(); } catch (e) { c.innerHTML = avisoError(); return; }
    L.cid = cid;
    const propios = propiosConPlan();
    const sinLista = propios.filter(f => !D.eqLista.get(f.id));
    const aVerif = D.recursos.filter(r => (r.codigos || []).some(x => x.e === 'ver')).length;
    const sinServ = D.recursos.filter(r => !(r.services || []).length).length;
    const sinPrecio = D.recursos.filter(r => (r.codigos || []).length && !precioDe(r)).length;
    const tj = [['listas', D.listas.length, 'Listas', 'bien'], ['cub', `${propios.length - sinLista.length} / ${propios.length}`, 'Equipos propios con lista'],
      ['sinlista', sinLista.length, 'Equipos sin lista', 'sinlista'], ['ver', aVerif, 'Renglones con códigos a verificar', 'medio'],
      ['sinserv', sinServ, 'Renglones sin service', ''], ['sinprecio', sinPrecio, 'Renglones sin precio', 'medio']];
    c.innerHTML = `<div class="tarjetas">${tj.map(([k, n, t, cl]) => `<button class="tarjeta ${cl} ${L.tarjeta === k ? 'sel' : ''}" onclick="Recursos.listasTarjeta('${k}')"><span class="n">${n}</span><span class="t">${t}</span></button>`).join('')}</div>
      <div class="filtros"><div class="filtro crece"><label>Buscar</label><input id="rl-q" value="${esc(L.q)}" placeholder="Lista, equipo, recurso o código…" oninput="Recursos.listasBuscar(this.value)"></div></div>
      <div class="barra-acciones"><div class="info" id="rl-info"></div>
        <button class="btn-filtro" onclick="Recursos.bajarExcel()">Bajar Excel (todas)</button>
        ${puede() ? `<button class="btn-filtro" onclick="Recursos.subirExcel()">Subir Excel</button><button class="btn-filtro primario" onclick="Recursos.nuevaLista()">+ Lista nueva</button>` : ''}</div>
      <div id="rl-lista"></div>`;
    listasRepintar();
  }
  function listasTarjeta(k) { L.tarjeta = L.tarjeta === k ? null : k; pintarListas(L.cid); }
  function listasBuscar(q) { L.q = q; listasRepintar(); }
  function listasRepintar() {
    const el = $('rl-lista'); if (!el) return;
    const q = (L.q || '').toLowerCase().trim(), qc = clave(q);
    if (L.tarjeta === 'sinlista') {
      const l = propiosConPlan().filter(f => !D.eqLista.get(f.id) && (!q || [f.id, f.tipo, f.marca, f.modelo].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
      $('rl-info').textContent = `${l.length} equipos propios sin lista de recursos`;
      el.innerHTML = !l.length ? '<div class="empty-state">Todos tienen lista.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th>Marca</th><th>Modelo</th><th></th></tr></thead><tbody>
        ${l.map(f => `<tr onclick="Recursos.asignarDesdeListas('${esc(f.id)}')"><td><b>${esc(f.id)}</b></td><td>${esc(f.tipo || '')}</td><td>${esc(f.marca || '')}</td><td>${esc(f.modelo || '')}</td>
          <td>${puede() ? '<span class="chip azul">Asignar lista</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    let ls = D.listas.map(l => {
      const rs = renglonesLista(l.id), eqs = equiposDe(l.id), comp = rs.filter(r => !r.solo_equipo);
      const kits = SERVICES_BASE.map(n => { const f = comp.filter(r => (r.services || []).includes(n)); return f.length ? f.reduce((a, r) => a + (subtotal(r) || 0), 0) : null; });
      const tipo = (fichaDe(eqs[0]).tipo) || '';
      return { l, rs, eqs, kits, tipo, ver: rs.filter(r => (r.codigos || []).some(x => x.e === 'ver')).length,
        sinServ: rs.filter(r => !(r.services || []).length).length, sinPrecio: rs.filter(r => (r.codigos || []).length && !precioDe(r)).length };
    });
    if (q) ls = ls.filter(x => [x.l.nombre, x.tipo, x.eqs.join(' ')].join(' ').toLowerCase().includes(q)
      || x.rs.some(r => r.descripcion.toLowerCase().includes(q) || (r.codigos || []).some(c => (clave(c.c) || '').includes(qc))));
    if (L.tarjeta === 'ver') ls = ls.filter(x => x.ver);
    if (L.tarjeta === 'sinserv') ls = ls.filter(x => x.sinServ);
    if (L.tarjeta === 'sinprecio') ls = ls.filter(x => x.sinPrecio);
    ls.sort((a, b) => (a.tipo || 'zz').localeCompare(b.tipo || 'zz', 'es') || a.l.nombre.localeCompare(b.l.nombre, 'es'));
    $('rl-info').textContent = `${ls.length} listas · tocá una para verla o editarla`;
    if (!ls.length) { el.innerHTML = '<div class="empty-state">Nada con esos filtros.</div>'; return; }
    if (window.innerWidth < 700) {
      el.innerHTML = '<div class="equipos">' + ls.map(x => `<button class="eq" onclick="Recursos.abrirLista(${x.l.id})"><div class="fila1"><div><div class="cod" style="font-size:calc(14px*var(--fs,1))">${esc(x.l.nombre)}</div>
        <div class="tipo">${esc(x.tipo)} · ${esc(x.eqs.join(', ') || 'sin equipos')}</div></div><span class="chip gris">${x.rs.length}</span></div>
        <div class="chips">${x.kits.map((k, i) => k !== null ? `<span class="chip azul">${nivTxt(SERVICES_BASE[i])} h: ${gs(k)}</span>` : '').join('')}
        ${x.sinServ ? `<span class="chip gris">${x.sinServ} sin service</span>` : ''}</div></button>`).join('') + '</div>';
      return;
    }
    el.innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Lista (modelo)</th><th>Tipo</th><th>Equipos</th><th style="text-align:right">Renglones</th>
      ${SERVICES_BASE.map(n => `<th style="text-align:right">Kit ${nivTxt(n)} h Gs</th>`).join('')}<th>A verificar</th><th>Sin service</th><th>Sin precio</th><th>Actualizada</th></tr></thead><tbody>
      ${ls.map(x => `<tr onclick="Recursos.abrirLista(${x.l.id})"><td><b>${esc(x.l.nombre)}</b></td><td>${esc(x.tipo)}</td><td class="larga" title="${esc(x.eqs.join(', '))}">${esc(x.eqs.join(', ') || '—')}</td>
        <td style="text-align:right">${x.rs.length || '<span class="chip gris">vacía</span>'}</td>
        ${x.kits.map(k => `<td style="text-align:right">${k !== null ? gs(k) || '0' : '—'}</td>`).join('')}
        <td>${x.ver ? `<span class="chip amarillo">${x.ver}</span>` : ''}</td><td>${x.sinServ ? `<span class="chip gris">${x.sinServ}</span>` : ''}</td>
        <td>${x.sinPrecio ? `<span class="chip gris">${x.sinPrecio}</span>` : ''}</td><td>${fmtFecha(x.l.actualizado_en)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function asignarDesdeListas(eq) {
    if (!puede()) return;
    F.cont = null; F.eq = eq;
    asignar(eq);
  }

  // ══════════════════════════════════════════════════════════════
  // SOLAPA MANTENIMIENTO › RECURSOS NECESARIOS
  // ══════════════════════════════════════════════════════════════
  const N = { incluir: 'avisos', ubic: '', agrupar: 'codigo', q: '', planes: [], filas: [], sinLista: [] };
  const INCLUIR = [['avisos', 'Vencidos y próximos (según aviso del plan)'], ['vencidos', 'Solo vencidos'],
    ['100', 'Faltan ≤ 100 h / 1.000 km / 15 días'], ['250', 'Faltan ≤ 250 h / 3.000 km / 30 días'], ['500', 'Faltan ≤ 500 h / 6.000 km / 60 días']];
  function entra(p) {
    if (N.incluir === 'avisos') return ['VENCIDO', 'PRÓXIMO'].includes(p.semaforo);
    if (N.incluir === 'vencidos') return p.semaforo === 'VENCIDO';
    const h = Number(N.incluir), km = { 100: 1000, 250: 3000, 500: 6000 }[h], d = { 100: 15, 250: 30, 500: 60 }[h];
    return (p.horas_restantes !== null && p.horas_restantes <= h) || (p.km_restantes !== null && p.km_restantes <= km) || (p.dias_restantes !== null && p.dias_restantes <= d);
  }
  async function pintarNecesarios(cid, planes) {
    estilos();
    const c = $(cid);
    try { await cargar(); } catch (e) { c.innerHTML = avisoError(); return; }
    N.cid = cid; N.planes = planes || [];
    const ubics = [...new Set((typeof flota !== 'undefined' ? flota : []).map(f => f.ubicacion).filter(Boolean))].sort();
    c.innerHTML = `<div class="filtros">
        <div class="filtro siempre"><label>Services</label><select onchange="Recursos.necCambiar('incluir', this.value)">${INCLUIR.map(([k, t]) => `<option value="${k}" ${k === N.incluir ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Ubicación</label><select onchange="Recursos.necCambiar('ubic', this.value)"><option value="">Todas</option>${ubics.map(u => `<option ${u === N.ubic ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Agrupar por</label><div class="vista-toggle"><button class="${N.agrupar === 'codigo' ? 'on' : ''}" onclick="Recursos.necCambiar('agrupar','codigo')">Código</button><button class="${N.agrupar === 'equipo' ? 'on' : ''}" onclick="Recursos.necCambiar('agrupar','equipo')">Equipo</button></div></div>
        <div class="filtro crece"><label>Buscar</label><input value="${esc(N.q)}" placeholder="Recurso, código, equipo…" oninput="Recursos.necBuscar(this.value)"></div></div>
      <div id="rn-cuerpo"></div>`;
    necRepintar();
  }
  function necCambiar(k, v) { N[k] = v; pintarNecesarios(N.cid, N.planes); }
  function necBuscar(q) { N.q = q; necRepintar(); }
  function necCalcular() {
    const fl = typeof flota !== 'undefined' ? flota : [];
    const planes = N.planes.filter(p => p.equipo_activo && p.propiedad !== 'Tercero' && entra(p)
      && (!N.ubic || (fl.find(f => f.id === p.equipo_id) || {}).ubicacion === N.ubic));
    const eqs = [], sinLista = [], sinServ = [];
    planes.forEach(p => {
      const k = kit(p.equipo_id, p.proximo_nivel);
      if (k.sinLista) sinLista.push(p); else if (!k.filas.length) sinServ.push(p); else eqs.push({ p, k });
    });
    return { eqs, sinLista, sinServ, planes };
  }
  function necRepintar() {
    const el = $('rn-cuerpo'); if (!el) return;
    const { eqs, sinLista, sinServ, planes } = necCalcular();
    const q = (N.q || '').toLowerCase().trim(), qc = clave(q);
    // Por código
    const porCod = new Map();
    eqs.forEach(({ p, k }) => k.filas.forEach(r => {
      const cod = (r.codigos[0] || {}).c || '';
      const key = (clave(cod) || r.descripcion.toLowerCase()) + '|' + (r.unidad || '');
      if (!porCod.has(key)) porCod.set(key, { desc: r.descripcion, cod, e: (r.codigos[0] || {}).e, un: r.unidad, cant: 0, sinCant: false, eqs: [], precio: precioDe(r), r });
      const x = porCod.get(key);
      if (r.cantidad === null) x.sinCant = true; else x.cant += Number(r.cantidad);
      if (!x.eqs.includes(p.equipo_id)) x.eqs.push(p.equipo_id);
    }));
    let filas = [...porCod.values()].map(x => Object.assign(x, { sub: x.precio && x.cant ? x.precio.precio * x.cant : null }));
    if (q) filas = filas.filter(x => [x.desc, x.eqs.join(' ')].join(' ').toLowerCase().includes(q) || (clave(x.cod) || '').includes(qc));
    filas.sort((a, b) => (b.sub || 0) - (a.sub || 0) || a.desc.localeCompare(b.desc, 'es'));
    const total = eqs.reduce((a, { k }) => a + k.costo, 0);
    const sinPrecio = filas.filter(x => !x.precio).length;
    N.filas = filas; N.eqs = eqs;
    const tj = [[planes.length, 'Equipos con service'], [eqs.length, 'Con kit', 'bien'], [sinLista.length, 'Sin lista de recursos', 'sinlista'],
      [sinServ.length, 'Lista sin services marcados', 'medio'], [porCod.size, 'Recursos distintos'], ['Gs ' + gs(total), 'Costo estimado', 'plata']];
    let tabla;
    if (N.agrupar === 'equipo') {
      let l = eqs; if (q) l = l.filter(({ p, k }) => [p.equipo_id, p.equipo_tipo, ...k.filas.map(r => r.descripcion)].join(' ').toLowerCase().includes(q));
      tabla = !l.length ? '<div class="empty-state">Nada con esos filtros.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th>Próximo service</th><th>Falta</th><th>Kit</th><th style="text-align:right">Ítems</th><th style="text-align:right">Costo est. Gs</th><th>Estado</th></tr></thead><tbody>
        ${l.map(({ p, k }) => `<tr onclick="abrirFicha('${esc(p.equipo_id)}','mantenimiento')"><td><b>${esc(p.equipo_id)}</b></td><td>${esc(p.equipo_tipo || '')}</td>
          <td>${p.proximo_nivel ? 'Service ' + esc(p.proximo_nivel) + ' h' : esc(p.nombre || '')}</td><td>${p.horas_restantes !== null ? fmtNum(p.horas_restantes) + ' h' : p.km_restantes !== null ? fmtNum(p.km_restantes) + ' km' : p.dias_restantes !== null ? p.dias_restantes + ' d' : ''}</td>
          <td><span class="chip azul">${nivTxt(k.nivel)} h</span></td><td style="text-align:right">${k.filas.length}</td><td style="text-align:right">${gs(k.costo)}${k.sinPrecio ? ` <span class="rsinp">${k.sinPrecio} s/p</span>` : ''}</td>
          <td><span class="chip ${{ VENCIDO: 'rojo', 'PRÓXIMO': 'amarillo', OK: 'verde' }[p.semaforo] || 'gris'}">${esc(p.semaforo)}</span></td></tr>`).join('')}</tbody></table></div>`;
    } else {
      tabla = !filas.length ? '<div class="empty-state">Nada con esos filtros.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Recurso</th><th>Código</th><th style="text-align:right">Cantidad</th><th>Un.</th><th>Equipos</th><th style="text-align:right">Precio aprox.</th><th style="text-align:right">Subtotal Gs</th></tr></thead><tbody>
        ${filas.map(x => `<tr><td>${esc(x.desc)}</td><td>${x.cod ? chipCod({ c: x.cod, e: x.e }, 0) : '—'}</td><td style="text-align:right"><b>${fmtNum(x.cant, 2)}</b>${x.sinCant ? ' <span class="rsinp" title="Algún renglón no tiene cantidad">+?</span>' : ''}</td>
          <td>${esc(x.un || '')}</td><td class="larga" title="${esc(x.eqs.join(', '))}">${esc(x.eqs.join(', '))}</td>
          <td style="text-align:right">${x.precio ? gs(x.precio.precio) : '<span class="rsinp">sin precio</span>'}</td><td style="text-align:right"><b>${x.sub !== null ? gs(x.sub) : '—'}</b></td></tr>`).join('')}
        <tr class="rtot"><td colspan="6">Total estimado${sinPrecio ? ` (sin ${sinPrecio} recursos sin precio)` : ''}</td><td style="text-align:right">${gs(filas.reduce((a, x) => a + (x.sub || 0), 0))}</td></tr></tbody></table></div>`;
    }
    el.innerHTML = `<div class="tarjetas">${tj.map(([n, t, cl]) => `<div class="tarjeta ${cl || ''}"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('')}</div>
      <div class="barra-acciones"><div class="info">Suma el kit del próximo service de cada equipo. El mismo código en varias máquinas va en un solo renglón.</div>
        <button class="btn-filtro" onclick="Recursos.necExcel()">Exportar Excel</button><button class="btn-filtro" onclick="Recursos.necCompartir()">Compartir</button>
        <button class="btn-filtro rec-pronto" title="Se activa cuando esté Compras de taller" onclick="Recursos.pronto()">Pedir a Compras · pronto</button></div>
      ${tabla}
      ${sinLista.length ? `<div class="aviso-caja" style="margin-top:12px">Sin lista de recursos (no suman): ${sinLista.map(p => `<a href="#" onclick="abrirFicha('${esc(p.equipo_id)}','mantenimiento');return false"><b>${esc(p.equipo_id)}</b></a>`).join(', ')}</div>` : ''}
      ${sinServ.length ? `<div class="aviso-caja" style="margin-top:8px">Tienen lista pero sin services marcados (no suman): ${sinServ.map(p => `<a href="#" onclick="abrirFicha('${esc(p.equipo_id)}','mantenimiento');return false"><b>${esc(p.equipo_id)}</b></a>`).join(', ')}</div>` : ''}`;
  }
  async function necExcel() {
    if (!(await cargarXLSX())) return;
    const aoa = [['Recurso', 'Código', 'Cantidad', 'Unidad', 'Equipos', 'Precio aprox. Gs', 'Subtotal Gs']]
      .concat(N.filas.map(x => [x.desc, x.cod, x.cant, x.un || '', x.eqs.join(', '), x.precio ? x.precio.precio : '', x.sub ?? '']));
    const aoa2 = [['Equipo', 'Tipo', 'Próximo service', 'Kit', 'Recurso', 'Código', 'Cantidad', 'Unidad', 'Precio aprox. Gs', 'Subtotal Gs']];
    (N.eqs || []).forEach(({ p, k }) => k.filas.forEach(r => { const pr = precioDe(r); aoa2.push([p.equipo_id, p.equipo_tipo || '', p.proximo_nivel || '', k.nivel, r.descripcion, (r.codigos[0] || {}).c || '', r.cantidad ?? '', r.unidad || '', pr ? pr.precio : '', subtotal(r) ?? '']); }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Por código');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa2), 'Por equipo');
    XLSX.writeFile(wb, `recursos_necesarios_${hoy()}.xlsx`);
  }
  function necCompartir() {
    if (!N.filas.length) return toast('No hay recursos con esos filtros', 'warning');
    compartir(`*Recursos para los próximos services – ${new Date().toLocaleDateString('es-PY')}*\n` + N.filas.map(x =>
      `• ${x.desc}${x.cod ? ' ' + x.cod : ''}: ${fmtNum(x.cant, 2)} ${x.un || ''} (${x.eqs.join(', ')})`).join('\n'));
  }

  return {
    cargar, kit, resumenKit, listaDe, totales, chipUsados, estilos, ok: () => D.ok, faltaSQL,
    pintarFicha, filtrar, editar, guardar, quitar, volver, sugerir, usarSugerencia, codMas, codQuitar, codSubir, codCompletar,
    asignar, guardarAsignacion, nuevaLista, datosLista, filtrarEquiposLista, guardarDatosLista, borrarLista, abrirLista,
    copiar, imprimir, pronto,
    usados, usadoMarcar, usadoCampo, usadoMas, usadoQuitar, usadoKit, usadoGuardar,
    bajarExcel, subirExcel, aplicarExcel,
    pintarListas, listasTarjeta, listasBuscar, asignarDesdeListas,
    pintarNecesarios, necCambiar, necBuscar, necExcel, necCompartir
  };
})();
