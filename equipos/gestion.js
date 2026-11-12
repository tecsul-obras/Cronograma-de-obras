// ══════════════════════════════════════════════════════════════════
// GESTIÓN — Órdenes de trabajo y Control de combustible
// Tecsul S.A.E.
//
// Las dos bandejas de oficina de lo que se carga en campo con los
// formularios de taller y combustible. Viven en flota.html y usan sus
// utilidades ($, esc, fmtFecha, abrirModal, toast, cat, flota...).
//
//   Órdenes de trabajo: lo que está pendiente, abierto o atrasado, con
//     todo lo que se cargó en cada OT (trabajos, checklists, fotos).
//     Taller la toma, la edita, la cierra o la anula desde acá.
//   Control de combustible: movimientos, stock estimado de tanques,
//     conciliación con el parte diario, consumo y anomalías.
// ══════════════════════════════════════════════════════════════════
window.Gestion = (() => {

  const ESTADOS_OT = ['Solicitada', 'Abierta', 'Cerrada', 'Anulada'];
  const COLOR_OT = { Solicitada: 'amarillo', Abierta: 'azul', Cerrada: 'verde', Anulada: 'gris' };
  // v20261027f (SQL 65): una OT de pista solo se cierra con la máquina en uno
  // de estos estados; una OT de taller, solo con la Inspección Final - Taller.
  const ESTADOS_SALIDA = ['Reparado', 'Reparado- Fallas menores', 'Servicio Tercerizado'];
  // v20261028 (SQL 66): TALLER CENTRAL = siempre Taller; abierta por Registro de
  // Trabajos = siempre Pista; si no, la elegida (Diagnóstico sin elegir = Taller)
  const enTallerCentral = (o) => /taller central/i.test(o.ubicacion || o.ubicacion_texto || '');
  const tipoFijo = (o) => !o ? null : enTallerCentral(o) ? 'Taller' : o.condicion_origen === 'Registro de Trabajos - OT' ? 'Pista' : null;
  const tipoOT = (o) => !o ? '' : (tipoFijo(o) || o.tipo_ot_efectivo || o.tipo_ot || 'Pista');
  const inferido = (o) => !!o && (o.tipo_ot_inferido === true || (o.tipo_ot_inferido === undefined && !o.tipo_ot));
  const chipTipo = (o) => { const x = tipoOT(o); return !x ? '' : `<span class="chip ${x === 'Taller' ? 'azul' : 'amarillo'}"${inferido(o)
    ? ' title="No se cargó el tipo: estimado por la ubicación (TALLER CENTRAL = Taller)" style="opacity:.75"' : ''}>${esc(x)}${inferido(o) ? ' ≈' : ''}</span>`; };
  const CONDICION_CORTA = {
    'Diagnóstico Inicial - Generación OT': 'Diagnóstico inicial', 'Registro de Trabajos - OT': 'Registro de trabajos',
    'Reporte de Fallas': 'Reporte de falla', 'Cierre de OT - Taller': 'Cierre de OT', 'Parte diario': 'Falla en parte diario'
  };
  const hoy = () => new Date().toISOString().slice(0, 10);
  const primeroDelMes = () => hoy().slice(0, 8) + '01';
  const nombre = (ced, texto) => {
    if (!ced) return texto || '';
    const o = (cat.ops || []).find(x => x.cedula === ced);
    return o ? o.nombre : (texto || ced);
  };
  const chipOT = (e) => `<span class="chip ${COLOR_OT[e] || 'gris'}">${esc(e)}</span>`;
  const linkEquipo = (id) => id && flota.some(f => f.id === id)
    ? `<a href="#" onclick="event.stopPropagation();cerrarModal();abrirFicha('${esc(id)}');return false">${esc(id)}</a>` : esc(id || '');
  const num = (v) => v === null || v === undefined || v === '' ? 0 : Number(v);

  function bajarCSV(nombreArchivo, cols, filas) {
    const csv = [cols.join(';')].concat(filas.map(f => f.map(v =>
      `"${String(Array.isArray(v) ? v.join(', ') : (v ?? '')).replace(/"/g, '""')}"`).join(';'))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${nombreArchivo}_${hoy()}.csv`;
    a.click();
  }

  function ordenarFilas(filas, o) {
    return [...filas].sort((a, b) => {
      const x = a[o.col], y = b[o.col];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
      return o.asc ? r : -r;
    });
  }

  // ── Fotos: rutas de Storage (se firman), URLs de JotForm o links de
  //    Drive (unidad «Fotos Tecsul», SQL 112). Las resuelve visor.js y al
  //    tocarlas se ven en grande (v20261109a) ─────────────────────────
  function galeria(rutas, bucket) {
    const l = (rutas || []).filter(Boolean);
    if (!l.length) return '';
    if (window.Visor && Visor.galeria) return Visor.galeria(l, bucket, 'g-fotos');
    return `<div class="g-fotos">${l.map(r => `<a href="${esc(r)}" target="_blank" rel="noopener">Foto</a>`).join(' ')}</div>`;
  }
  async function firmarFotos(cont) {
    if (window.Visor && Visor.pintar) Visor.pintar(cont);
  }

  // ════════════════════════════════════════════════════════════════
  // ÓRDENES DE TRABAJO
  // ════════════════════════════════════════════════════════════════
  let ots = null;
  let otTrabajando = [];   // v20261102g (SQL 78): OT de taller abiertas con la máquina ya trabajando
  let otCargando = false;
  let otVista = 'lista';                 // lista | horas
  let otTarjeta = null;
  let otOrden = { col: 'numero', asc: false };
  let otFormato = null;                  // tarjetas | tabla
  let otAbierta = null;                  // OT en el detalle

  const OT_TARJETAS = [
    { k: 'sol', t: 'Pendientes de tomar', c: 'medio', fn: o => o.estado === 'Solicitada' },
    { k: 'abi', t: 'Abiertas', fn: o => o.estado === 'Abierta' },
    { k: 'atr', t: 'Atrasadas', c: 'malo', fn: o => o.atrasada && ['Solicitada', 'Abierta'].includes(o.estado) },
    { k: 'vie', t: 'Abiertas hace +30 días', c: 'malo', fn: o => ['Solicitada', 'Abierta'].includes(o.estado) && o.dias > 30 },
    { k: 'cer', t: 'Cerradas este mes', c: 'bien', fn: o => o.estado === 'Cerrada' && String(o.fecha_cierre || '').slice(0, 7) === hoy().slice(0, 7) },
  ];
  const OT_COLS = [
    ['numero', 'OT'], ['estado', 'Estado'], ['tipo_ot_efectivo', 'Tipo OT'], ['equipo_id', 'Equipo'], ['tipo_equipo', 'Tipo'], ['nombre', 'Nombre'],
    ['ubicacion', 'Ubicación'], ['abierta_el', 'Abierta'], ['dias', 'Días'], ['fecha_estimada_cierre', 'Cierre estimado'],
    ['registros', 'Registros'], ['horas_trabajo', 'Horas'], ['ultimo_registro', 'Último registro'],
    ['ultimo_estado_maquina', 'Estado máquina'], ['lider', 'Líder'], ['origen', 'Origen']
  ];

  async function cargarOTs() {
    if (otCargando) return;
    otCargando = true;
    try {
      const [r, tr] = await Promise.all([
        sb.from('v_ot').select('*').order('numero', { ascending: false }).limit(5000),
        sb.from('v_ot_abierta_trabajando').select('*').order('trabaja_desde').then(x => x, () => ({ data: [] }))
      ]);
      const { data, error } = r;
      if (error) throw error;
      otTrabajando = (tr && !tr.error && tr.data) || [];
      ots = (data || []).map(o => Object.assign(o, { tipo_ot_efectivo: tipoOT(o) }));
      guardarLocal('ot_cache', ots);
    } catch (e) {
      ots = leerLocal('ot_cache') || [];
      toast('No se pudieron actualizar las OT: ' + e.message, 'error');
    } finally { otCargando = false; }
    pintarOTLista();
  }

  function pintarOT() {
    const s = $('screen-ot');
    if (!otFormato) otFormato = leerLocal('ot_formato') || (window.innerWidth >= 900 ? 'tabla' : 'tarjetas');
    s.innerHTML = `
      <div class="g-sub">
        <button class="${otVista === 'lista' ? 'on' : ''}" onclick="Gestion.otCambiarVista('lista')">Órdenes</button>
        <button class="${otVista === 'horas' ? 'on' : ''}" onclick="Gestion.otCambiarVista('horas')">Horas y costos</button>
      </div>
      <div id="ot-cuerpo"></div>`;
    if (otVista === 'horas') return pintarHoras();
    $('ot-cuerpo').innerHTML = `
      <div id="ot-trabajando"></div>
      <div class="tarjetas" id="ot-tarjetas"></div>
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label>
          <input type="text" id="ot-buscar" placeholder="N° de OT, equipo, nombre, falla, técnico…" oninput="Gestion.otFiltrar()"></div>
        <div class="filtro siempre"><label>Estado</label>
          <select id="ot-estado" class="ms" onchange="Gestion.otFiltrar()">
            <option value="activas">Pendientes y abiertas</option>
            ${ESTADOS_OT.map(e => `<option>${e}</option>`).join('')}
            <option value="">Todas</option></select></div>
        <div class="filtro"><label>Taller / Pista</label>
          <select id="ot-tipo" class="ms" onchange="Gestion.otFiltrar()"><option value="">Todas</option><option>Taller</option><option>Pista</option></select></div>
        <div class="filtro"><label>Ubicación</label><select id="ot-ubic" class="ms" onchange="Gestion.otFiltrar()"><option value="">Todas</option></select></div>
        <div class="filtro"><label>Origen</label>
          <select id="ot-origen" class="ms" onchange="Gestion.otFiltrar()"><option value="">Todos</option>
            <option value="pwa">App</option><option value="parte">Parte diario</option><option value="jotform">JotForm</option></select></div>
      </div>
      <div class="barra-acciones">
        <div class="info" id="ot-info"></div>
        <div class="vista-toggle">
          <button id="otv-tarjetas" onclick="Gestion.otFormato('tarjetas')">Tarjetas</button>
          <button id="otv-tabla" onclick="Gestion.otFormato('tabla')">Tabla</button>
        </div>
        <button class="btn-filtro" onclick="Gestion.otCompartir()">Compartir</button>
        <button class="btn-filtro" onclick="Gestion.otExportar()">Exportar</button>
        <button class="btn-filtro" onclick="Gestion.cargarOTs()">Actualizar</button>
      </div>
      <div id="ot-lista"><div class="empty-state">Cargando…</div></div>`;
    const f = leerLocal('ot_filtros') || {};
    if (f['ot-buscar'] !== undefined) $('ot-buscar').value = f['ot-buscar'];
    ['ot-estado', 'ot-tipo', 'ot-origen'].forEach(id => MS.restaurar(id, f[id]));
    otUbicGuardada = Array.isArray(f['ot-ubic']) ? f['ot-ubic'] : (f['ot-ubic'] ? [f['ot-ubic']] : null);
    if (ots) pintarOTLista();
  }
  let otUbicGuardada = null;

  function otFiltradas(sinTarjeta) {
    const v = id => ($(id) || {}).value || '';
    const q = v('ot-buscar').toLowerCase().trim();
    const est = $('ot-estado') ? MS.valores('ot-estado') : [];   // varios a la vez; "activas" = Solicitada + Abierta
    const ms = (id, x) => !$(id) || MS.ok(id, x);
    return (ots || []).filter(o => {
      if (est.length && !est.some(e => e === 'activas' ? ['Solicitada', 'Abierta'].includes(o.estado) : o.estado === e)) return false;
      if (!ms('ot-tipo', tipoOT(o))) return false;
      if (!ms('ot-ubic', o.ubicacion)) return false;
      if (!ms('ot-origen', o.origen)) return false;
      if (!sinTarjeta && otTarjeta && !otTarjeta.fn(o)) return false;
      if (q) {
        const pajar = [o.numero, o.equipo_id, o.equipo, o.tipo_equipo, o.trabajo_general, o.nombre, o.ubicacion,
          o.lider, (o.fallas || []).join(' '), o.sintomas, o.tecnicos, o.ultimo_estado_maquina].join(' ').toLowerCase();
        if (!q.split(/\s+/).every(p => pajar.includes(p))) return false;
      }
      return true;
    });
  }

  function otFiltrar() {
    const f = {};
    f['ot-buscar'] = $('ot-buscar').value;
    ['ot-estado', 'ot-tipo', 'ot-ubic', 'ot-origen'].forEach(id => f[id] = MS.valores(id));
    guardarLocal('ot_filtros', f);
    pintarOTLista();
  }

  // v20261102g (SQL 78): la máquina ya volvió a una obra y la OT de taller
  // sigue abierta. No se cierra sola: taller la cierra con la Inspección Final.
  function pintarOTTrabajando() {
    const c = $('ot-trabajando');
    if (!c) return;
    if (!otTrabajando.length) { c.innerHTML = ''; return; }
    const cierra = sesion && ['admin_central', 'taller'].includes(sesion.rol);
    const sinCod = (x) => String(x || '').replace(/^[0-9A-Z]+_/, '');
    c.innerHTML = `<div class="aviso-caja rojo" style="margin-bottom:10px">
      <b>⚠️ ${otTrabajando.length === 1 ? 'Una OT de taller sigue abierta' : otTrabajando.length + ' OT de taller siguen abiertas'} con la máquina ya trabajando en obra.</b>
      Mientras no se cierren, la flota y los indicadores las cuentan como en reparación.
      ${otTrabajando.map(t => `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px">
        <span><b>${esc(t.equipo_id)}</b> trabaja en ${esc(sinCod(t.obra_nombre || t.obra_clave))} desde el ${fmtFecha(t.trabaja_desde)}
          con la <b>OT ${esc(t.numero)}</b> abierta (${t.partes_en_obra} ${t.partes_en_obra === 1 ? 'parte' : 'partes'})</span>
        ${cierra ? `<a class="btn-mini btn-verde" style="text-decoration:none" href="./parte_diario_v5.html?p=taller&cierre=${encodeURIComponent(t.numero)}">Ir a la Inspección Final</a>` : ''}
      </div>`).join('')}</div>`;
  }

  function pintarOTLista() {
    if (!$('ot-lista') || !ots) return;
    pintarOTTrabajando();
    // ubicaciones que existen
    const sel = $('ot-ubic'), actual = otUbicGuardada || MS.valores(sel);
    otUbicGuardada = null;
    sel.innerHTML = '<option value="">Todas</option>' + [...new Set(ots.map(o => o.ubicacion).filter(Boolean))].sort()
      .map(u => `<option>${esc(u)}</option>`).join('');
    MS.poner(sel, actual);
    // tarjetas: cuentan sobre todo, sin el filtro de estado
    $('ot-tarjetas').innerHTML = OT_TARJETAS.map(t => `<button class="tarjeta ${t.c || ''} ${otTarjeta && otTarjeta.k === t.k ? 'sel' : ''}"
      onclick="Gestion.otTocarTarjeta('${t.k}')"><span class="n">${ots.filter(t.fn).length}</span><span class="t">${t.t}</span></button>`).join('');
    $('otv-tarjetas').classList.toggle('on', otFormato === 'tarjetas');
    $('otv-tabla').classList.toggle('on', otFormato === 'tabla');
    const filas = ordenarFilas(otFiltradas(), otOrden);
    $('ot-info').textContent = `${filas.length} OT${otTarjeta ? ' · ' + otTarjeta.t.toLowerCase() : ''}`;
    if (!filas.length) { $('ot-lista').innerHTML = '<div class="empty-state">No hay OT con esos filtros.</div>'; return; }
    if (otFormato === 'tabla') {
      $('ot-lista').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr>${OT_COLS.map(([k, t]) =>
        `<th class="${otOrden.col === k ? 'activo' : ''}" onclick="Gestion.otOrdenar('${k}')">${t}${otOrden.col === k ? (otOrden.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${filas.slice(0, 1500).map(o => `<tr onclick="Gestion.abrirOT(${o.numero})">${OT_COLS.map(([k]) => {
          let v = o[k];
          if (k === 'tipo_ot_efectivo') return `<td>${chipTipo(o)}</td>`;
          if (k === 'estado') return `<td>${chipOT(v)}${o.atrasada && ['Solicitada', 'Abierta'].includes(v) ? ' <span class="chip rojo">atrasada</span>' : ''}</td>`;
          if (k === 'equipo_id') v = v || o.trabajo_general;
          if (k === 'abierta_el' || k === 'ultimo_registro' || k === 'fecha_estimada_cierre') v = fmtFecha(v);
          if (k === 'horas_trabajo') v = fmtNum(v, 1);
          if (k === 'numero') return `<td><b>${v}</b></td>`;
          return `<td class="${k === 'nombre' ? 'larga' : ''}">${esc(v ?? '')}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`;
      return;
    }
    $('ot-lista').innerHTML = '<div class="equipos">' + filas.slice(0, 600).map(o => `
      <button class="eq g-ot ${o.estado}" onclick="Gestion.abrirOT(${o.numero})">
        <div class="fila1"><div><div class="cod">OT ${o.numero} · ${esc(o.equipo_id || o.trabajo_general || '')}</div>
          <div class="tipo">${esc(o.nombre)}</div></div>${chipOT(o.estado)}</div>
        <div class="meta">${[o.tipo_equipo, o.ubicacion].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="chips">${chipTipo(o)}
          ${o.estado === 'Cerrada' ? `<span class="chip gris">cerrada ${fmtFecha(o.fecha_cierre)}</span>`
            : `<span class="chip ${o.dias > 30 ? 'rojo' : 'gris'}">${o.dias ?? 0} d abierta</span>`}
          ${o.atrasada && ['Solicitada', 'Abierta'].includes(o.estado) ? '<span class="chip rojo">atrasada</span>' : ''}
          ${o.registros ? `<span class="chip gris">${o.registros} registro(s) · ${fmtNum(o.horas_trabajo, 1)} h</span>` : ''}
          ${o.ultimo_estado_maquina ? `<span class="chip amarillo">${esc(o.ultimo_estado_maquina)}</span>` : ''}
          ${(o.fallas || []).slice(0, 2).map(f => `<span class="chip azul">${esc(f)}</span>`).join('')}
        </div></button>`).join('') + '</div>';
  }

  function otTocarTarjeta(k) {
    otTarjeta = otTarjeta && otTarjeta.k === k ? null : OT_TARJETAS.find(t => t.k === k);
    // Una tarjeta de cerradas no se ve con el filtro "pendientes y abiertas"
    const est = MS.valores('ot-estado');
    if (otTarjeta && otTarjeta.k === 'cer' && est.length && !est.includes('Cerrada')) MS.poner('ot-estado', []);
    if (otTarjeta && otTarjeta.k !== 'cer' && est.length === 1 && est[0] === 'Cerrada') MS.poner('ot-estado', ['activas']);
    otFiltrar();
  }
  function otOrdenar(col) { otOrden = { col, asc: otOrden.col === col ? !otOrden.asc : col !== 'numero' }; pintarOTLista(); }
  function otCambiarFormato(f) { otFormato = f; guardarLocal('ot_formato', f); pintarOTLista(); }
  function otCambiarVista(v) { otVista = v; pintarOT(); }

  function otExportar() {
    const filas = ordenarFilas(otFiltradas(), otOrden);
    const cols = OT_COLS.concat([['fallas', 'Fallas'], ['sintomas', 'Síntomas'], ['tecnicos', 'Técnicos'],
      ['fecha_cierre', 'Fecha cierre'], ['estado_maquina_salida', 'Estado salida'], ['trabajo_general', 'Trabajo general']]);
    bajarCSV('ordenes_de_trabajo', cols.map(c => c[1]), filas.map(o => cols.map(([k]) => o[k])));
  }

  function otCompartir() {
    const l = otFiltradas().filter(o => ['Solicitada', 'Abierta'].includes(o.estado));
    if (!l.length) return toast('No hay OT pendientes ni abiertas con esos filtros', 'warning');
    const t = `*OT pendientes y abiertas – ${new Date().toLocaleDateString('es-PY')}*\n` + l.map(o =>
      `${o.estado === 'Solicitada' ? '🟡' : o.atrasada || o.dias > 30 ? '🔴' : '🔵'} OT ${o.numero} ${o.equipo_id || o.trabajo_general || ''}: ${o.nombre} (${o.dias ?? 0} d${o.ultimo_estado_maquina ? ', ' + o.ultimo_estado_maquina : ''})`).join('\n');
    compartir(t);
  }

  // ── Detalle de una OT ──
  async function abrirOT(numero) {
    abrirModal(`OT ${numero}`, '<div class="empty-state">Cargando…</div>');
    $('modal').querySelector('.modal-card').classList.add('ancho');
    const { data: o, error } = await sb.from('ordenes_trabajo').select('*').eq('numero', numero).single();
    if (error) { $('modal-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`; return; }
    const { data: regs } = await sb.from('ot_registros').select('*, ot_registro_items(*), ot_checklist(*)')
      .eq('ot_id', o.id).order('fecha').order('creado_en');
    otAbierta = o;
    regsOT = regs || [];
    const v = (ots || []).find(x => x.numero === numero) || {};
    const t = esTaller(), activa = ['Solicitada', 'Abierta'].includes(o.estado);
    const dato = (e, val) => `<div class="dato"><div class="e">${e}</div><div class="v">${val ?? ''}</div></div>`;
    $('modal-titulo').innerHTML = `OT ${o.numero} · ${esc(o.equipo_id || o.trabajo_general || '')} ${chipOT(o.estado)}`;
    const acciones = !t ? '' : `<div class="acciones" style="justify-content:flex-start;margin-bottom:12px">
      ${o.estado === 'Solicitada' ? `<button class="btn btn-primario" onclick="Gestion.otFormTomar()">Tomar OT</button>` : ''}
      ${activa ? `<button class="btn btn-verde" onclick="Gestion.otFormCerrar()">Cerrar OT</button>
                  <button class="btn btn-gris" onclick="Gestion.otFormEditar()">Editar</button>
                  <button class="btn btn-rojo" onclick="Gestion.otFormAnular()">Anular</button>` : ''}
      ${!activa && sesion.rol === 'admin_central' ? `<button class="btn btn-gris" onclick="Gestion.otReabrir()">Reabrir</button>` : ''}
    </div><div id="ot-accion"></div>`;
    $('modal-cuerpo').innerHTML = acciones + `
      <div class="card"><div class="card-header">${esc(o.nombre)}</div><div class="card-body">
        <div class="datos">
          ${dato('Equipo', o.equipo_id ? linkEquipo(o.equipo_id) + (v.equipo ? ' · ' + esc(v.equipo) : '') : esc(o.trabajo_general))}
          ${dato('Origen', esc({ pwa: 'App', parte: 'Parte diario', jotform: 'JotForm' }[o.origen] || o.origen) + ' · ' + esc(CONDICION_CORTA[o.condicion_origen] || o.condicion_origen))}
          ${dato('Taller / Pista', chipTipo(Object.assign({}, o, { ubicacion: v.ubicacion, tipo_ot_efectivo: v.tipo_ot_efectivo, tipo_ot_inferido: v.tipo_ot_inferido })))}
          ${dato('Ubicación', esc(v.ubicacion || o.ubicacion_texto))}
          ${dato('Líder', esc(nombre(o.lider_cedula)))}
          ${dato('Abierta', fmtMomento(o.fecha_ingreso || o.creado_en))}
          ${dato('Paro de máquina', fmtMomento(o.paro_maquina))}
          ${dato('Cierre estimado', fmtFecha(o.fecha_estimada_cierre))}
          ${dato('Estado al ingresar', esc(o.estado_maquina_ingreso))}
          ${dato('Lectura al ingresar', fmtNum(o.lectura_ingreso, 1))}
          ${o.fecha_cierre ? dato('Cerrada', fmtMomento(o.fecha_cierre)) : ''}
          ${o.estado_maquina_salida ? dato('Estado de salida', esc(o.estado_maquina_salida)) : ''}
          ${o.lectura_salida ? dato('Lectura de salida', fmtNum(o.lectura_salida, 1)) : ''}
          ${dato('Horas cargadas', fmtNum(v.horas_trabajo, 1))}
        </div>
        ${(o.fallas || []).length ? `<div style="margin-top:10px">${o.fallas.map(f => `<span class="chip azul" style="margin:0 4px 4px 0">${esc(f)}</span>`).join('')}</div>` : ''}
        ${o.sintomas ? `<p class="g-texto"><b>Síntomas:</b> ${esc(o.sintomas)}</p>` : ''}
        ${(o.sistemas_intervenidos || []).length ? `<p class="g-texto"><b>Sistemas intervenidos:</b> ${o.sistemas_intervenidos.map(esc).join(', ')}</p>` : ''}
        ${o.detalle_cierre ? `<p class="g-texto"><b>Cierre:</b> ${esc(o.detalle_cierre)}</p>` : ''}
        ${galeria(o.imagenes, 'taller')}${galeria(o.fotos_salida, 'taller')}
      </div></div>
      <div id="ot-horas-${o.numero}"></div>
      <h3 style="font-size:calc(14px*var(--fs,1));margin:4px 0 8px">Registros (${(regs || []).length})</h3>
      ${(regs || []).length ? regs.map(pintarRegistro).join('') : '<div class="empty-state">Todavía no se cargó ningún trabajo en esta OT.</div>'}`;
    firmarFotos($('modal-cuerpo'));
    horasDeOT(o.numero);
  }

  function pintarRegistro(r) {
    const items = r.ot_registro_items || [], chk = r.ot_checklist || [];
    const atencion = chk.filter(c => /^requiere/i.test(c.resultado));
    const boletas = Array.isArray(r.boletas_salida) ? r.boletas_salida : [];
    return `<div class="card g-reg"><div class="card-body">
      <div class="fila1" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div><b>${fmtFecha(r.fecha)} · ${esc(CONDICION_CORTA[r.condicion] || r.condicion)}</b>
          <div class="cambio">${esc(nombre(r.tecnico_cedula, r.tecnico_texto))}${r.ubicacion_texto ? ' · ' + esc(r.ubicacion_texto) : ''}
            ${r.lectura ? ' · ' + esc(r.tipo_medicion || 'Lectura') + ' ' + fmtNum(r.lectura, 1) : ''}</div></div>
        <span>${r.estado_maquina ? `<span class="chip amarillo">${esc(r.estado_maquina)}</span>` : ''}
          ${r.finaliza_ot ? '<span class="chip verde">finalizó</span>' : ''}</span>
      </div>
      ${(r.fallas || []).length ? `<div style="margin-top:6px">${r.fallas.map(f => `<span class="chip azul" style="margin:0 4px 4px 0">${esc(f)}</span>`).join('')}</div>` : ''}
      ${items.length ? `<table class="g-mini"><thead><tr><th>Sistema</th><th>Componente</th><th>Horas</th><th>Estado</th></tr></thead><tbody>${
        items.map(i => `<tr><td>${esc(i.sistema)}</td><td>${esc(i.componente)}</td><td>${fmtNum(i.horas, 1)}</td><td>${esc(i.estado_reparacion || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${r.tipo_mantenimiento ? `<p class="g-texto"><b>Mantenimiento ${esc(r.tipo_mantenimiento)} h</b>${r.horas_mantenimiento ? ' · ' + fmtNum(r.horas_mantenimiento, 1) + ' h de trabajo' : ''}</p>` : ''}
      ${r.horas_supervision_tercerizada ? `<p class="g-texto">Supervisión tercerizada: ${fmtNum(r.horas_supervision_tercerizada, 1)} h</p>` : ''}
      ${r.realizo_traslado ? `<p class="g-texto">Traslado: ${fmtNum(r.horas_traslado, 1)} h</p>` : ''}
      ${boletas.length ? `<p class="g-texto"><b>Boletas de salida:</b> ${boletas.map(b => esc([b.numero, fmtFecha(b.fecha)].filter(Boolean).join(' del '))).join(' · ')}</p>` : ''}
      ${chk.length ? `<details class="g-texto"><summary>Checklist: ${chk.length} ítems${atencion.length ? ` · <span style="color:var(--rojo);font-weight:700">${atencion.length} requieren atención</span>` : ''}</summary>
        ${chk.map(c => `<div class="cambio">${esc(c.checklist)} · ${esc(c.item)}: <i>${esc(c.resultado)}</i></div>`).join('')}</details>` : ''}
      ${r.detalle ? `<p class="g-texto">${esc(r.detalle)}</p>` : ''}
      ${r.observaciones ? `<p class="g-texto"><b>Obs.:</b> ${esc(r.observaciones)}</p>` : ''}
      ${galeria([r.foto_lectura, ...(r.fotos || []), ...(r.fotos_boletas || [])], 'taller')}
      ${puedeCorregir(r) ? `<div style="margin-top:8px"><button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio)" onclick="Gestion.regEditar('${r.id}')">Corregir o eliminar</button></div>
        <div id="reg-acc-${r.id}"></div>` : ''}
    </div></div>`;
  }

  // ── Acciones de taller ──
  async function otActualizar(cambios, mensaje) {
    mostrarCarga('Guardando…');
    const { error } = await sb.from('ordenes_trabajo').update(cambios).eq('id', otAbierta.id);
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast(mensaje, 'success');
    await cargarOTs();
    abrirOT(otAbierta.numero);
    if (typeof cargarFlota === 'function') cargarFlota();
  }
  // Al tomar una OT se confirma si es de taller o de pista (de eso depende cómo se cierra)
  function otFormTomar() {
    const o = otAbierta, v = (ots || []).find(x => x.numero === o.numero) || o;
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Tomar la OT</div><div class="card-body"><div class="form-grid">
      ${campo('ot-t-tipo', 'Tipo de OT', sel('ot-t-tipo', ['Taller', 'Pista'], tipoFijo(Object.assign({}, v, o)) || o.tipo_ot || tipoOT(v),
        tipoFijo(Object.assign({}, v, o)) ? 'disabled' : ''))}</div>
      <div class="cambio" style="margin-top:6px">Taller: se cierra con la Inspección Final - Taller. Pista: con la máquina Reparado, Reparado - Fallas menores o Servicio Tercerizado.</div>
      <div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-primario" onclick="Gestion.otTomar()">Tomar OT</button></div></div></div>`;
  }
  function otTomar() {
    const tipo = val('ot-t-tipo');
    if ($('ot-t-tipo') && !tipo) return toast('Elegí si la OT es de taller o de pista', 'warning');
    otActualizar(Object.assign({ estado: 'Abierta' }, tipo ? { tipo_ot: tipo } : {}), `OT ${otAbierta.numero} abierta`);
  }
  function otReabrir() {
    if (!confirm(`¿Reabrir la OT ${otAbierta.numero}?`)) return;
    otActualizar({ estado: 'Abierta', fecha_cierre: null }, `OT ${otAbierta.numero} reabierta`);
  }
  function otFormEditar() {
    const o = otAbierta, ops = (cat.ops || []).filter(x => x.activo !== false);
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Editar OT</div><div class="card-body"><div class="form-grid">
      ${campo('ot-e-nombre', 'Nombre', inp('ot-e-nombre', o.nombre), 'ancho')}
      ${campo('ot-e-tipo', 'Taller / Pista', sel('ot-e-tipo', ['Taller', 'Pista'], tipoFijo(Object.assign({}, (ots || []).find(x => x.numero === o.numero) || {}, o)) || o.tipo_ot,
        tipoFijo(Object.assign({}, (ots || []).find(x => x.numero === o.numero) || {}, o)) ? 'disabled title="TALLER CENTRAL es siempre Taller; abierta por Registro de Trabajos es siempre Pista"' : ''))}
      ${campo('ot-e-lider', 'Líder', `<select id="ot-e-lider"><option value="">—</option>${ops.map(x =>
        `<option value="${esc(x.cedula)}" ${x.cedula === o.lider_cedula ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>`)}
      ${campo('ot-e-fest', 'Cierre estimado', inp('ot-e-fest', o.fecha_estimada_cierre, 'date'))}
      ${campo('ot-e-sint', 'Síntomas', txt('ot-e-sint', o.sintomas), 'ancho')}
    </div><div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-verde" onclick="Gestion.otGuardarEdicion()">Guardar</button></div></div></div>`;
  }
  function otGuardarEdicion() {
    if (!val('ot-e-nombre')) return toast('El nombre no puede quedar vacío', 'warning');
    otActualizar({ nombre: val('ot-e-nombre'), ...($('ot-e-tipo').disabled ? {} : { tipo_ot: val('ot-e-tipo') }), lider_cedula: val('ot-e-lider'),
      fecha_estimada_cierre: val('ot-e-fest'), sintomas: val('ot-e-sint') }, 'OT actualizada');
  }
  function otFormCerrar() {
    const o = otAbierta, v = (ots || []).find(x => x.numero === o.numero) || o;
    // OT de taller con máquina: solo con la Inspección Final (el formulario
    // está en la página del parte, solapa Reporte de taller)
    if (o.equipo_id && tipoOT(Object.assign({}, v, { tipo_ot: o.tipo_ot })) === 'Taller') {
      $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Cerrar la OT</div><div class="card-body">
        <div class="aviso-caja">Es una OT de <b>taller</b>${inferido(v) && !o.tipo_ot ? ' (estimado por la ubicación: si es de pista, cambialo con Editar)' : ''}:
          se cierra completando la <b>Inspección Final - Taller</b> (checklist de salida y fotos).</div>
        <div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
          <a class="btn btn-verde" style="text-decoration:none" href="./parte_diario_v5.html?p=taller&cierre=${o.numero}">Ir a la Inspección Final</a></div></div></div>`;
      return;
    }
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Cerrar la OT</div><div class="card-body">
      <div class="aviso-caja">Lo normal es que el mecánico la cierre desde su formulario, con Trabajo Finalizado = SI.
        Cerrala desde acá solo si eso no va a pasar. ${o.equipo_id ? 'La máquina tiene que quedar Reparado, Reparado - Fallas menores o Servicio Tercerizado.' : ''}</div><div class="form-grid">
      ${campo('ot-c-est', 'Estado de la máquina a la salida', sel('ot-c-est', ESTADOS_SALIDA, null))}
      ${campo('ot-c-lec', 'Lectura de salida', inp('ot-c-lec', '', 'number', 'step="any"'))}
      ${campo('ot-c-det', 'Detalle del cierre', txt('ot-c-det', ''), 'ancho')}
    </div><div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-verde" onclick="Gestion.otCerrar()">Cerrar OT</button></div></div></div>`;
  }
  function otCerrar() {
    if (!val('ot-c-est') && otAbierta.equipo_id) return toast('Elegí el estado de la máquina', 'warning');
    otActualizar({ estado: 'Cerrada', fecha_cierre: new Date().toISOString(), estado_maquina_salida: val('ot-c-est'),
      lectura_salida: val('ot-c-lec'), detalle_cierre: val('ot-c-det') }, `OT ${otAbierta.numero} cerrada`);
  }
  function otFormAnular() {
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Anular la OT</div><div class="card-body">
      ${campo('ot-a-mot', 'Motivo', inp('ot-a-mot', '', 'text', 'placeholder="Ej.: duplicada de la OT 20015"'))}
      <div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-rojo" onclick="Gestion.otAnular()">Anular</button></div></div></div>`;
  }
  function otAnular() {
    if (!val('ot-a-mot')) return toast('Escribí el motivo', 'warning');
    otActualizar({ estado: 'Anulada', detalle_cierre: 'Anulada: ' + val('ot-a-mot') }, `OT ${otAbierta.numero} anulada`);
  }

  // ── Las OT de un equipo (pestaña de la ficha) ──
  async function otDeEquipo(id) {
    const { data, error } = await sb.from('v_ot').select('numero,estado,nombre,abierta_el,fecha_cierre,dias,registros,horas_trabajo,ultimo_estado_maquina,estado_maquina_salida')
      .eq('equipo_id', id).order('numero', { ascending: false }).limit(200);
    if (error) return $('ficha-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    $('ficha-cuerpo').innerHTML = !data.length ? '<div class="empty-state">Este equipo no tiene órdenes de trabajo.</div>'
      : `<div class="card"><div class="card-body"><ul class="lista-simple">${data.map(o => `
        <li style="cursor:pointer" onclick="Gestion.abrirOT(${o.numero})"><div class="pri"><b>OT ${o.numero} · ${esc(o.nombre)}</b>
          <span>${fmtFecha(o.abierta_el)}${o.fecha_cierre ? ' → ' + fmtFecha(o.fecha_cierre) : ` · ${o.dias ?? 0} días`} ·
            ${o.registros || 0} registro(s) · ${fmtNum(o.horas_trabajo, 1)} h${o.estado_maquina_salida || o.ultimo_estado_maquina ? ' · ' + esc(o.estado_maquina_salida || o.ultimo_estado_maquina) : ''}</span></div>
          ${chipOT(o.estado)}</li>`).join('')}</ul></div></div>`;
  }

  // ── Horas y costos de taller (v20261027f, SQL 65) ──
  // Horas hombre por técnico, por máquina o por OT, con el costo según la
  // tarifa horaria de cada técnico (la cargan los admin centrales; la ven
  // admin central y gerente). Incluye trabajos por componente, horas de
  // mantenimiento (service) y traslados.
  const H = { agrupar: 'tecnico', desde: primeroDelMes(), hasta: hoy(), datos: null, equipo: null, tipo: '', q: '',
              orden: { col: 'horas', asc: false }, tarifas: null, editando: null,
              aus: null, fer: null, pers: null, sup: '', prodGrupo: 'tecnico' };
  const veCostos = () => sesion && ['admin_central', 'gerente'].includes(sesion.rol);
  const editaTarifas = () => sesion && sesion.rol === 'admin_central';
  const ESPECIALIDADES_TALLER = /MECANIC|ELECTRIC|GOMER|SUPERVISOR|SOLDADOR|TORNER|LUBRIC/i;
  const gs = (v) => v === null || v === undefined ? '' : fmtNum(Math.round(v));

  // PostgREST devuelve de a 1.000 filas: se pide por páginas
  async function todasLasFilas(consulta) {
    const out = [];
    for (let i = 0; i < 50; i++) {
      const { data, error } = await consulta().range(i * 1000, i * 1000 + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async function pintarHoras() {
    const conTarifas = veCostos();
    $('ot-cuerpo').innerHTML = `
      <div class="g-sub" style="margin-top:-4px">${[['tecnico', 'Por técnico'], ['equipo', 'Por máquina'], ['ot', 'Por OT'],
        ['dia', 'Por día'], ['prod', 'Productividad'],
        ...(conTarifas ? [['tarifas', 'Tarifas por técnico']] : [])].map(([k, t]) =>
        `<button class="${H.agrupar === k ? 'on' : ''}" onclick="Gestion.horasAgrupar('${k}')">${t}</button>`).join('')}</div>
      <div class="filtros">
        <div class="filtro siempre"><label>Mes</label><input type="month" id="h-mes" value="${H.desde.slice(0, 7) === H.hasta.slice(0, 7) ? H.desde.slice(0, 7) : ''}" onchange="Gestion.horasCambiarMes(this.value)"></div>
        <div class="filtro siempre"><label>Desde</label><input type="date" id="h-desde" value="${H.desde}" onchange="Gestion.horasPeriodo()"></div>
        <div class="filtro siempre"><label>Hasta</label><input type="date" id="h-hasta" value="${H.hasta}" onchange="Gestion.horasPeriodo()"></div>
        ${H.agrupar === 'tarifas' ? '' : `
        <div class="filtro"><label>Taller / Pista</label><select id="h-tipo" onchange="Gestion.horasFiltrar()">
          <option value="">Todas</option><option ${H.tipo === 'Taller' ? 'selected' : ''}>Taller</option><option ${H.tipo === 'Pista' ? 'selected' : ''}>Pista</option></select></div>
        ${H.agrupar === 'dia' || H.agrupar === 'prod' ? `<div class="filtro"><label>Supervisor</label><select id="h-sup" onchange="Gestion.horasFiltrar()">
          <option value="">Todos</option>${supervisoresTaller().map(x => `<option value="${esc(x.cedula)}" ${H.sup === x.cedula ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}
          <option value="-" ${H.sup === '-' ? 'selected' : ''}>Sin supervisor</option></select></div>` : ''}
        <div class="filtro crece"><label>Buscar</label><input type="text" id="h-buscar" value="${esc(H.q)}" placeholder="Técnico, equipo, OT…" oninput="Gestion.horasFiltrar()"></div>`}
        <div class="filtro siempre"><label>&nbsp;</label><button class="btn-filtro" onclick="Gestion.horasExportar()">Exportar</button></div>
      </div><div id="h-lista"><div class="empty-state">Cargando…</div></div>`;
    try {
      const pedidos = [H.datos ? Promise.resolve(H.datos)
        : todasLasFilas(() => sb.from('v_ot_horas').select('*').gte('fecha', H.desde).lte('fecha', H.hasta).order('fecha'))];
      if (conTarifas && !H.tarifas) pedidos.push(sb.from('tecnico_tarifas').select('*').order('desde', { ascending: false })
        .then(r => r.error ? (H.sinTabla = true, []) : r.data || []));
      if (H.agrupar === 'dia' || H.agrupar === 'prod') pedidos.push(cargarExtrasTaller());
      const [d, tf] = await Promise.all(pedidos);
      H.datos = d;
      if (tf && Array.isArray(tf)) H.tarifas = tf;
    } catch (e) { return $('h-lista').innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}</div>`; }
    pintarHorasLista();
  }

  function horasFiltradas() {
    const q = H.q.toLowerCase().trim();
    return (H.datos || []).filter(h => (!H.tipo || (h.tipo_ot || '') === H.tipo) && (!H.equipo || h.equipo_id === H.equipo)
      && (!q || q.split(/\s+/).every(p => [h.tecnico, h.equipo_id, h.equipo, h.ot, h.ot_nombre, h.sistema, h.componente].join(' ').toLowerCase().includes(p))));
  }

  // Agrupa las filas por técnico / equipo / OT
  function agrupar(filas, clave) {
    const por = new Map();
    filas.forEach(h => {
      const k = clave === 'tecnico' ? (h.tecnico_cedula || 'texto:' + (h.tecnico || ''))
        : clave === 'equipo' ? (h.equipo_id || 'sin:' + (h.equipo || 'Sin máquina')) : h.ot;
      let g = por.get(k);
      if (!g) por.set(k, g = { k, tecnico: h.tecnico || 'Sin técnico', cedula: h.tecnico_cedula, equipo_id: h.equipo_id,
        equipo: h.equipo, tipo_equipo: h.tipo_equipo, ot: h.ot, ot_nombre: h.ot_nombre, ot_estado: h.ot_estado, tipo_ot: h.tipo_ot,
        horas: 0, costo: 0, sinTarifa: 0, ots: new Set(), dias: new Set(), equipos: new Set(), tecnicos: new Set(), sistemas: {} });
      const hs = num(h.horas);
      g.horas += hs;
      if (h.costo === null || h.costo === undefined) g.sinTarifa += hs; else g.costo += num(h.costo);
      g.ots.add(h.ot); g.dias.add(h.fecha); if (h.equipo_id) g.equipos.add(h.equipo_id); g.tecnicos.add(h.tecnico || 'Sin técnico');
      g.sistemas[h.sistema] = (g.sistemas[h.sistema] || 0) + hs;
    });
    return [...por.values()].map(g => Object.assign(g, { n_ots: g.ots.size, n_dias: g.dias.size, n_eq: g.equipos.size,
      n_tec: g.tecnicos.size, tarifa: tarifaVigente(g.cedula), costo: g.horas - g.sinTarifa > 0 ? g.costo : null }));
  }

  function tarifaVigente(ced, fecha) {
    const l = (H.tarifas || []).filter(t => t.cedula === ced);
    if (!l.length) return null;
    const f = fecha || hoy();
    return (l.find(t => t.desde <= f) || l[l.length - 1]).tarifa_hora;
  }

  const porSistema = (g) => Object.entries(g.sistemas).sort((a, b) => b[1] - a[1]).map(([s, h]) => `${esc(s)} ${fmtNum(h, 1)}`).join(' · ');

  function pintarHorasLista() {
    if (!$('h-lista')) return;
    if (H.agrupar === 'tarifas') return pintarTarifas();
    if (H.agrupar === 'dia') return pintarPorDia();
    if (H.agrupar === 'prod') return pintarProductividad();
    const filas = horasFiltradas(), c = veCostos() && !H.sinTabla;
    const total = filas.reduce((a, h) => a + num(h.horas), 0);
    const costo = filas.reduce((a, h) => a + num(h.costo), 0);
    const sinTar = filas.filter(h => h.costo === null || h.costo === undefined).reduce((a, h) => a + num(h.horas), 0);
    const viejo = filas.length && filas[0].tipo_hora === undefined;
    const tj = [[fmtNum(total, 1), 'Horas hombre'], [new Set(filas.map(h => h.tecnico)).size, 'Técnicos'],
      [new Set(filas.filter(h => h.equipo_id).map(h => h.equipo_id)).size, 'Máquinas'], [new Set(filas.map(h => h.ot)).size, 'OT trabajadas']];
    if (c) tj.push(['Gs ' + (costo >= 1e6 ? fmtNum(costo / 1e6, 1) + ' M' : fmtNum(costo)), 'Costo mano de obra'],
      [fmtNum(sinTar, 1), 'Horas sin tarifa']);
    let h = `<div class="tarjetas">${tj.map(([n, t], i) => `<div class="tarjeta${c && i === 5 && sinTar ? ' medio' : ''}"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('')}</div>`;
    if (H.equipo) h += `<div style="margin:0 0 8px"><span class="chip azul">Máquina: ${esc(H.equipo)} <a href="#" onclick="Gestion.horasEquipo(null);return false" style="margin-left:4px">✕</a></span></div>`;
    if (viejo) h += `<div class="aviso-caja">Falta correr el SQL 65: se ven solo las horas por componente, sin mantenimiento, traslados ni costos.</div>`;
    if (c && H.sinTabla) h += `<div class="aviso-caja">Falta correr el SQL 65 para cargar tarifas.</div>`;
    if (!filas.length) { $('h-lista').innerHTML = h + '<div class="empty-state">No hay horas cargadas en ese período.</div>'; return; }

    const g = agrupar(filas, H.agrupar);
    let cols;
    if (H.agrupar === 'tecnico') cols = [['tecnico', 'Técnico'], ...(c ? [['tarifa', 'Tarifa Gs/h']] : []), ['horas', 'Horas'], ['n_dias', 'Días'],
      ['n_ots', 'OT'], ['n_eq', 'Máquinas'], ...(c ? [['costo', 'Costo Gs']] : []), ['sis', 'Por sistema']];
    else if (H.agrupar === 'equipo') cols = [['equipo_id', 'Máquina'], ['tipo_equipo', 'Tipo'], ['horas', 'Horas'], ['n_ots', 'OT'],
      ['n_tec', 'Técnicos'], ...(c ? [['costo', 'Costo Gs']] : []), ['sis', 'Por sistema']];
    else cols = [['ot', 'OT'], ['tipo_ot', 'Tipo OT'], ['equipo_id', 'Máquina'], ['ot_nombre', 'Nombre'], ['ot_estado', 'Estado'],
      ['horas', 'Horas'], ['n_tec', 'Técnicos'], ...(c ? [['costo', 'Costo Gs']] : []), ['sis', 'Por sistema']];
    const ord = ordenarFilas(g, H.orden);
    const click = (x) => H.agrupar === 'ot' ? `Gestion.abrirOT(${x.ot})` : H.agrupar === 'equipo' && x.equipo_id ? `Gestion.horasEquipo('${esc(x.equipo_id)}')` : '';
    h += `<div class="tabla-wrap"><table class="tabla"><thead><tr>${cols.map(([k, t]) => `<th class="${H.orden.col === k ? 'activo' : ''}"
        ${k === 'sis' ? '' : `onclick="Gestion.horasOrdenar('${k}')"`}>${t}${H.orden.col === k ? (H.orden.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${ord.map(x => `<tr ${click(x) ? `onclick="${click(x)}"` : 'style="cursor:default"'}>${cols.map(([k]) => {
        if (k === 'tecnico') return `<td><b>${esc(x.tecnico)}</b></td>`;
        if (k === 'equipo_id') return `<td><b>${esc(x.equipo_id || x.equipo || '')}</b></td>`;
        if (k === 'ot') return `<td><b>${x.ot}</b></td>`;
        if (k === 'tipo_ot') return `<td>${x.tipo_ot ? `<span class="chip ${x.tipo_ot === 'Taller' ? 'azul' : 'amarillo'}">${esc(x.tipo_ot)}</span>` : ''}</td>`;
        if (k === 'ot_estado') return `<td>${x.ot_estado ? chipOT(x.ot_estado) : ''}</td>`;
        if (k === 'horas') return `<td>${fmtNum(x.horas, 1)}</td>`;
        if (k === 'tarifa') return `<td style="text-align:right">${x.tarifa !== null ? gs(x.tarifa) : '<span class="chip amarillo">sin tarifa</span>'}</td>`;
        if (k === 'costo') return `<td style="text-align:right">${x.costo !== null ? gs(x.costo) : ''}${x.sinTarifa && x.costo !== null ? ` <span class="chip amarillo" title="Horas de técnicos sin tarifa">+${fmtNum(x.sinTarifa, 1)} h</span>` : ''}</td>`;
        if (k === 'sis') return `<td class="larga">${porSistema(x)}</td>`;
        if (k === 'ot_nombre') return `<td class="larga">${esc(x.ot_nombre || '')}</td>`;
        return `<td>${esc(x[k] ?? '')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">Horas que cada técnico cargó en los registros de trabajo: por componente, de mantenimiento (service) y de traslado${
        c ? '. Costo = horas × tarifa del técnico vigente a la fecha del trabajo' : ''}.${H.agrupar === 'equipo' ? ' Tocá una máquina para ver sus OT.' : H.agrupar === 'ot' ? ' Tocá una OT para abrirla.' : ''}</p>`;
    $('h-lista').innerHTML = h;
  }

  // ── Por día y Productividad (v20261028f, SQL 69) ──
  // Por día: cada persona y cada día, con las horas que cargó en OT o el
  // motivo de la ausencia (como el reporte Control OT de Power BI).
  // Productividad: horas cargadas contra una jornada de 10 h en los días
  // laborables (lunes a sábado sin feriados) menos los días de ausencia;
  // trabajo contra traslado.
  const JORNADA = 10;
  const DEL_TALLER = /MECANIC|ELECTRIC|GOMER|AYUDANTE|SUPERVISOR|SOLDADOR|TORNER|LUBRIC/i;
  const MOTIVO_AUS = { 'Vacaciones': ['VAC', 'vac'], 'Receso en obra': ['REC', 'rec'], 'Ausencia justificada': ['AJ', 'aj'] };
  const sumarDia = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const diaSemana = (f) => new Date(f + 'T12:00:00Z').getUTCDay();   // 0 = domingo
  const DIAS_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  async function cargarExtrasTaller() {
    const t = [];
    if (!H.aus) t.push(todasLasFilas(() => sb.from('v_taller_ausencias_dia').select('fecha,cedula,motivo,ausencia_id')
        .gte('fecha', H.desde).lte('fecha', H.hasta).order('ausencia_id'))
      .then(d => { H.aus = d; H.sinAus = false; }, () => { H.aus = []; H.sinAus = true; }));
    if (!H.fer) t.push(sb.from('feriados').select('fecha,descripcion').gte('fecha', H.desde).lte('fecha', H.hasta)
      .then(r => { H.fer = r.error ? [] : r.data || []; }));
    if (!H.pers) t.push(sb.from('operadores').select('cedula,nombre,especialidad,cargo,supervisor_cedula,activo')
      .then(r => r.error ? sb.from('operadores').select('cedula,nombre,especialidad,activo') : r)
      .then(r => { H.pers = r.data || []; }));
    await Promise.all(t);
  }
  const supervisoresTaller = () => (H.pers || cat.ops || []).filter(o => o.especialidad === 'SUPERVISOR' && o.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const persona = (ced) => (H.pers || []).find(o => o.cedula === ced) || (cat.ops || []).find(o => o.cedula === ced) || null;
  const supDe = (ced) => { const p = persona(ced); return p ? p.supervisor_cedula || '' : ''; };

  // Días del período (hasta hoy) con su tipo: domingo, feriado o laborable
  function diasDelPeriodo() {
    const fer = new Map((H.fer || []).map(f => [f.fecha, f.descripcion]));
    const fin = H.hasta < hoy() ? H.hasta : hoy();
    const l = [];
    for (let f = H.desde; f <= fin && l.length < 400; f = sumarDia(f, 1))
      l.push({ f, dow: diaSemana(f), feriado: fer.get(f) || null, laboral: diaSemana(f) !== 0 && !fer.has(f) });
    return l;
  }

  // Personas: las que cargaron horas o tienen ausencias, más el personal de taller activo
  function filasTaller() {
    const q = H.q.toLowerCase().trim();
    const horas = horasFiltradas();
    const por = new Map();
    const fila = (ced, nombreTxt) => {
      const k = ced || 'texto:' + nombreTxt;
      let g = por.get(k);
      if (!g) {
        const p = ced ? persona(ced) : null;
        por.set(k, g = { k, cedula: ced, tecnico: p ? p.nombre : (nombreTxt || ced || 'Sin técnico'), cargo: p ? p.cargo || p.especialidad || '' : '',
          supervisor: ced ? supDe(ced) : '', dias: {}, aus: {}, horas: 0, trabajo: 0, traslado: 0, ots: new Set() });
      }
      return g;
    };
    horas.forEach(h => {
      const g = fila(h.tecnico_cedula, h.tecnico);
      const hs = num(h.horas);
      g.dias[h.fecha] = (g.dias[h.fecha] || 0) + hs;
      g.horas += hs;
      if (h.tipo_hora === 'traslado') g.traslado += hs; else g.trabajo += hs;
      g.ots.add(h.ot);
    });
    (H.aus || []).forEach(a => { fila(a.cedula).aus[a.fecha] = a.motivo; });   // ordenadas: la última cargada gana
    if (!H.tipo) (H.pers || []).filter(o => o.activo !== false && DEL_TALLER.test(o.especialidad || '') && !/AUXILIAR/i.test(o.cargo || ''))
      .forEach(o => fila(o.cedula));
    return [...por.values()].filter(g => (!H.sup || (H.sup === '-' ? !g.supervisor : g.supervisor === H.sup))
        && (!q || q.split(/\s+/).every(p => [g.tecnico, g.cedula, g.cargo].join(' ').toLowerCase().includes(p))))
      .sort((a, b) => (b.horas - a.horas) || a.tecnico.localeCompare(b.tecnico, 'es'));
  }

  // Color de las horas del día (los mismos cortes del reporte de Power BI)
  const claseHoras = (h) => h <= 0 ? '' : h < 4 ? 'h-poco' : h <= 11 ? 'h-bien' : h <= 15 ? 'h-mucho' : 'h-exceso';

  function pintarPorDia() {
    const dias = diasDelPeriodo(), filas = filasTaller();
    let h = '';
    if (H.sinAus) h += '<div class="aviso-caja">Falta correr el SQL 69: no se ven las ausencias ni los feriados.</div>';
    if (dias.length > 62) h += '<div class="aviso-caja">Se muestran los primeros 62 días. Elegí un período más corto para ver el resto.</div>';
    const ds = dias.slice(0, 62);
    if (!filas.length || !ds.length) { $('h-lista').innerHTML = h + '<div class="empty-state">Nadie con esos filtros en el período.</div>'; return; }
    const nAus = filas.reduce((n, g) => n + ds.filter(d => g.aus[d.f]).length, 0);
    h += `<div class="tarjetas">${[[fmtNum(filas.reduce((a, g) => a + g.horas, 0), 1), 'Horas cargadas'], [filas.length, 'Personas'],
        [nAus, 'Días de ausencia'], [ds.filter(d => d.laboral).length, 'Días laborables']].map(([n, t]) =>
        `<div class="tarjeta"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('')}</div>
      <div class="h-leyenda"><span class="h-poco">menos de 4 h</span><span class="h-bien">4 a 11 h</span><span class="h-mucho">11 a 15 h</span>
        <span class="h-exceso">más de 15 h</span><span class="aus vac">VAC vacaciones</span><span class="aus rec">REC receso en obra</span>
        <span class="aus aj">AJ ausencia justificada</span><span class="nolab">domingo / feriado</span></div>
      <div class="tabla-wrap h-dia-wrap"><table class="tabla h-dia"><thead><tr><th class="fija">Persona</th>
        ${ds.map(d => `<th class="${d.laboral ? '' : 'nolab'}" title="${esc(d.feriado || '')}">${DIAS_CORTO[d.dow]}<br>${d.f.slice(8)}</th>`).join('')}
        <th>Horas</th><th>Días con horas</th><th>Ausente</th></tr></thead><tbody>${filas.map(g => {
          const conH = ds.filter(d => g.dias[d.f] > 0).length, aus = ds.filter(d => g.aus[d.f]).length;
          return `<tr style="cursor:default"><td class="fija"><b>${esc(g.tecnico)}</b>${g.cargo ? `<br><small>${esc(g.cargo)}</small>` : ''}</td>
            ${ds.map(d => {
              const m = g.aus[d.f], hs = g.dias[d.f] || 0;
              if (m) { const [c, cl] = MOTIVO_AUS[m] || ['AUS', 'aj']; return `<td class="aus ${cl}" title="${esc(m)}${hs ? ' · ' + fmtNum(hs, 1) + ' h cargadas' : ''}">${c}${hs ? '*' : ''}</td>`; }
              return `<td class="${d.laboral ? '' : 'nolab'} ${claseHoras(hs)}">${hs ? fmtNum(hs, 1) : ''}</td>`;
            }).join('')}
            <td><b>${fmtNum(g.horas, 1)}</b></td><td>${conH}</td><td>${aus || ''}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">Horas que cada persona cargó en las OT (trabajo, mantenimiento y traslado) o el motivo de su ausencia
        (Ausencias de taller). Con * cargó horas en un día de ausencia.</p>`;
    $('h-lista').innerHTML = h;
  }
  function exportarPorDia() {
    const ds = diasDelPeriodo().slice(0, 62), filas = filasTaller();
    bajarCSV(`horas_por_dia_${H.desde}_${H.hasta}`, ['Cédula', 'Persona', 'Cargo', 'Supervisor', ...ds.map(d => d.f), 'Horas'],
      filas.map(g => [g.cedula, g.tecnico, g.cargo, (persona(g.supervisor) || {}).nombre || '',
        ...ds.map(d => g.aus[d.f] || (g.dias[d.f] ? String(g.dias[d.f]).replace('.', ',') : '')), String(g.horas).replace('.', ',')]));
  }

  function calcularProductividad() {
    const dias = diasDelPeriodo(), lab = dias.filter(d => d.laboral);
    return filasTaller().map(g => {
      const ausentes = lab.filter(d => g.aus[d.f]).length;
      const disponibles = Math.max(0, lab.length - ausentes);
      return Object.assign(g, { n_ots: g.ots.size, dias_lab: lab.length, ausentes, disponibles, conHoras: Object.keys(g.dias).filter(f => g.dias[f] > 0).length,
        prod: disponibles ? g.horas / (JORNADA * disponibles) : null, pct_trabajo: g.horas ? g.trabajo / g.horas : null });
    });
  }
  const clasePct = (p) => p === null ? 'gris' : p >= 0.85 ? 'verde' : p >= 0.6 ? 'amarillo' : 'rojo';
  const pct = (p) => p === null || p === undefined ? '' : fmtNum(p * 100, 0) + ' %';

  function pintarProductividad() {
    const l = calcularProductividad();
    let h = H.sinAus ? '<div class="aviso-caja">Falta correr el SQL 69: no se descuentan las ausencias ni los feriados.</div>' : '';
    h += `<div class="g-sub chico">${[['tecnico', 'Por persona'], ['supervisor', 'Por supervisor']].map(([k, t]) =>
      `<button class="${H.prodGrupo === k ? 'on' : ''}" onclick="Gestion.prodGrupo('${k}')">${t}</button>`).join('')}</div>`;
    if (!l.length) { $('h-lista').innerHTML = h + '<div class="empty-state">Nadie con esos filtros en el período.</div>'; return; }
    const tot = l.reduce((a, g) => ({ horas: a.horas + g.horas, trabajo: a.trabajo + g.trabajo, traslado: a.traslado + g.traslado,
      disp: a.disp + (g.horas > 0 ? g.disponibles : 0) }), { horas: 0, trabajo: 0, traslado: 0, disp: 0 });
    const pTot = tot.disp ? tot.horas / (JORNADA * tot.disp) : null;
    h += `<div class="tarjetas">${[[pct(pTot), 'Productividad', clasePct(pTot)], [fmtNum(tot.horas, 1), 'Horas cargadas'],
        [pct(tot.horas ? tot.trabajo / tot.horas : null), 'Trabajo'], [pct(tot.horas ? tot.traslado / tot.horas : null), 'Traslado'],
        [l.filter(g => g.horas > 0).length, 'Personas con horas']].map(([n, t, c]) =>
        `<div class="tarjeta ${c === 'verde' ? 'bien' : c === 'amarillo' ? 'medio' : c === 'rojo' ? 'malo' : ''}"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('')}</div>`;
    let filas = l, cols;
    if (H.prodGrupo === 'supervisor') {
      const por = new Map();
      l.forEach(g => {
        const k = g.supervisor || '-';
        let s = por.get(k);
        if (!s) por.set(k, s = { tecnico: k === '-' ? 'Sin supervisor' : ((persona(k) || {}).nombre || k), personas: 0, horas: 0, trabajo: 0, traslado: 0, disponibles: 0, ausentes: 0 });
        s.personas++; s.horas += g.horas; s.trabajo += g.trabajo; s.traslado += g.traslado; s.ausentes += g.ausentes;
        if (g.horas > 0) s.disponibles += g.disponibles;
      });
      filas = [...por.values()].map(s => Object.assign(s, { prod: s.disponibles ? s.horas / (JORNADA * s.disponibles) : null,
        pct_trabajo: s.horas ? s.trabajo / s.horas : null })).sort((a, b) => (b.prod ?? -1) - (a.prod ?? -1));
      cols = [['tecnico', 'Supervisor'], ['personas', 'Personas'], ['horas', 'Horas'], ['trabajo', 'Trabajo'], ['traslado', 'Traslado'],
        ['pct_trabajo', '% trabajo'], ['ausentes', 'Días ausente'], ['disponibles', 'Días-persona disponibles'], ['prod', 'Productividad']];
    } else {
      filas = [...l].sort((a, b) => (b.prod ?? -1) - (a.prod ?? -1));
      cols = [['tecnico', 'Persona'], ['cargo', 'Cargo'], ['sup', 'Supervisor'], ['horas', 'Horas'], ['trabajo', 'Trabajo'], ['traslado', 'Traslado'],
        ['pct_trabajo', '% trabajo'], ['n_ots', 'OT'], ['conHoras', 'Días con horas'], ['dias_lab', 'Días laborables'], ['ausentes', 'Ausente'],
        ['disponibles', 'Disponibles'], ['prod', 'Productividad']];
    }
    h += `<div class="tabla-wrap"><table class="tabla"><thead><tr>${cols.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${filas.map(g =>
      `<tr style="cursor:default">${cols.map(([k]) => {
        if (k === 'tecnico') return `<td><b>${esc(g.tecnico)}</b></td>`;
        if (k === 'sup') return `<td>${esc((persona(g.supervisor) || {}).nombre || '')}</td>`;
        if (['horas', 'trabajo', 'traslado'].includes(k)) return `<td>${g[k] ? fmtNum(g[k], 1) : ''}</td>`;
        if (k === 'pct_trabajo') return `<td>${pct(g.pct_trabajo)}</td>`;
        if (k === 'prod') return `<td>${g.prod === null ? '' : `<span class="chip ${clasePct(g.prod)}">${pct(g.prod)}</span>`}</td>`;
        return `<td>${esc(g[k] ?? '')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">Productividad = horas cargadas en OT ÷ (${JORNADA} h × días disponibles). Días disponibles = lunes a sábado
        sin feriados (Administración › Catálogos › Calendario), hasta hoy, menos los días de ausencia. Por supervisor cuentan solo los días de quienes cargaron horas.
        Trabajo = horas por componente y de mantenimiento; traslado = horas de traslado.</p>`;
    $('h-lista').innerHTML = h;
  }
  function exportarProductividad() {
    bajarCSV(`productividad_taller_${H.desde}_${H.hasta}`, ['Cédula', 'Persona', 'Cargo', 'Supervisor', 'Horas', 'Trabajo', 'Traslado', 'OT',
      'Días con horas', 'Días laborables', 'Días ausente', 'Días disponibles', 'Productividad %'],
      calcularProductividad().map(g => [g.cedula, g.tecnico, g.cargo, (persona(g.supervisor) || {}).nombre || '', g.horas, g.trabajo, g.traslado, g.n_ots,
        g.conHoras, g.dias_lab, g.ausentes, g.disponibles, g.prod === null ? '' : Math.round(g.prod * 1000) / 10].map(v => String(v ?? '').replace('.', ','))));
  }
  function prodGrupo(k) { H.prodGrupo = k; pintarHorasLista(); }

  // ── Tarifas por técnico ──
  function pintarTarifas() {
    if (H.sinTabla) return $('h-lista').innerHTML = '<div class="aviso-caja">Falta correr el SQL 65 para cargar tarifas.</div>';
    const conHoras = new Map();
    (H.datos || []).forEach(h => { if (h.tecnico_cedula) conHoras.set(h.tecnico_cedula, (conHoras.get(h.tecnico_cedula) || 0) + num(h.horas)); });
    const conTarifa = new Set((H.tarifas || []).map(t => t.cedula));
    const lista = (cat.ops || []).filter(o => conHoras.has(o.cedula) || conTarifa.has(o.cedula)
      || (o.activo !== false && ESPECIALIDADES_TALLER.test(o.especialidad || '')))
      .map(o => ({ cedula: o.cedula, nombre: o.nombre, especialidad: o.especialidad, horas: conHoras.get(o.cedula) || 0,
        tarifa: tarifaVigente(o.cedula), hist: (H.tarifas || []).filter(t => t.cedula === o.cedula) }))
      .sort((a, b) => (b.horas - a.horas) || a.nombre.localeCompare(b.nombre, 'es'));
    const ed = editaTarifas();
    const sin = lista.filter(x => x.tarifa === null && x.horas > 0).length;
    $('h-lista').innerHTML = `
      ${sin ? `<div class="aviso-caja">${sin} técnico(s) con horas en el período no tienen tarifa: su costo no se calcula.</div>` : ''}
      <div class="cambio" style="margin-bottom:8px">Tarifa en Gs por hora (costo para la empresa). Cada tarifa vale desde su fecha; un aumento no cambia el costo de los trabajos anteriores.
        ${ed ? '' : 'Solo los admin centrales las cargan.'}</div>
      <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Técnico</th><th>Especialidad</th><th>Horas en el período</th><th>Tarifa vigente Gs/h</th><th>Desde</th>${ed ? '<th></th>' : ''}</tr></thead>
      <tbody>${lista.map(x => `<tr style="cursor:default"><td><b>${esc(x.nombre)}</b></td><td>${esc(x.especialidad || '')}</td><td>${x.horas ? fmtNum(x.horas, 1) : ''}</td>
        <td style="text-align:right">${x.tarifa !== null ? gs(x.tarifa) : '<span class="chip amarillo">sin tarifa</span>'}</td>
        <td>${x.hist.length ? (x.hist.find(t => t.desde <= hoy()) || x.hist[x.hist.length - 1]).desde.startsWith('2000-') ? 'siempre' : fmtFecha((x.hist.find(t => t.desde <= hoy()) || x.hist[x.hist.length - 1]).desde) : ''}${x.hist.length > 1 ? ` <span class="chip gris">${x.hist.length} tarifas</span>` : ''}</td>
        ${ed ? `<td><button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio)" onclick="Gestion.tarifaEditar('${esc(x.cedula)}')">${x.hist.length ? 'Cambiar' : 'Cargar'}</button></td>` : ''}</tr>
        ${H.editando === x.cedula ? `<tr style="cursor:default;background:#f6f8fc"><td colspan="${ed ? 6 : 5}">${formTarifa(x)}</td></tr>` : ''}`).join('')}</tbody></table></div>`;
  }
  function formTarifa(x) {
    const primera = !x.hist.length;
    return `<div class="form-grid" style="margin:4px 0">
        ${campo('tf-monto', 'Tarifa Gs por hora', inp('tf-monto', x.tarifa ?? '', 'number', 'min="0" step="1"'))}
        ${campo('tf-desde', 'Vale desde', inp('tf-desde', primera ? '' : hoy(), 'date'))}
        ${campo('tf-nota', 'Nota', inp('tf-nota', '', 'text', 'placeholder="Ej.: aumento enero"'))}</div>
      <div class="cambio">${primera ? 'Sin fecha = vale para todos los trabajos (también los anteriores).' : 'Los trabajos desde esa fecha usan la tarifa nueva.'}</div>
      ${x.hist.length ? `<ul class="lista-simple" style="margin:6px 0">${x.hist.map(t => `<li><div class="pri"><b>Gs ${gs(t.tarifa_hora)}/h</b>
        <span>${t.desde.startsWith('2000-') ? 'desde siempre' : 'desde el ' + fmtFecha(t.desde)}${t.nota ? ' · ' + esc(t.nota) : ''}</span></div>
        <button class="btn-mini btn-rojo" onclick="Gestion.tarifaBorrar(${t.id})">Quitar</button></li>`).join('')}</ul>` : ''}
      <div class="acciones"><button class="btn btn-gris" onclick="Gestion.tarifaEditar(null)">Cancelar</button>
        <button class="btn btn-verde" onclick="Gestion.tarifaGuardar('${esc(x.cedula)}')">Guardar</button></div>`;
  }
  function tarifaEditar(ced) { H.editando = ced; pintarTarifas(); }
  async function tarifaGuardar(ced) {
    const monto = val('tf-monto');
    if (monto === null || monto === undefined || isNaN(monto) || monto < 0) return toast('Escribí la tarifa por hora', 'warning');
    const fila = { cedula: ced, tarifa_hora: monto, desde: val('tf-desde') || '2000-01-01', nota: val('tf-nota') };
    mostrarCarga('Guardando…');
    const { error } = await sb.from('tecnico_tarifas').upsert(fila, { onConflict: 'cedula,desde' });
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Tarifa guardada', 'success');
    H.editando = null; H.tarifas = null; H.datos = null;   // el costo se recalcula en la base
    pintarHoras();
  }
  async function tarifaBorrar(id) {
    if (!confirm('¿Quitar esta tarifa?')) return;
    const { error } = await sb.from('tecnico_tarifas').delete().eq('id', id);
    if (error) return toast('No se pudo quitar: ' + error.message, 'error');
    H.tarifas = null; H.datos = null; pintarHoras();
  }

  function horasAgrupar(k) { H.agrupar = k; H.orden = { col: k === 'ot' ? 'ot' : 'horas', asc: false }; if (k !== 'ot') H.equipo = null; pintarHoras(); }
  function horasEquipo(id) { H.equipo = id; if (id) { H.agrupar = 'ot'; H.orden = { col: 'ot', asc: false }; pintarHoras(); } else pintarHorasLista(); }
  function horasOrdenar(col) { H.orden = { col, asc: H.orden.col === col ? !H.orden.asc : ['tecnico', 'equipo_id', 'tipo_equipo', 'ot_nombre'].includes(col) }; pintarHorasLista(); }
  function horasFiltrar() { H.tipo = ($('h-tipo') || {}).value || ''; H.q = ($('h-buscar') || {}).value || ''; H.sup = ($('h-sup') || {}).value || ''; pintarHorasLista(); }
  function horasCambiarMes(m) {
    if (!m) return;
    const [a, me] = m.split('-').map(Number);
    H.desde = m + '-01';
    H.hasta = new Date(Date.UTC(a, me, 0)).toISOString().slice(0, 10);
    H.datos = H.aus = H.fer = null; pintarHoras();
  }
  function horasPeriodo() {
    H.desde = $('h-desde').value || H.desde; H.hasta = $('h-hasta').value || H.hasta;
    if (H.desde > H.hasta) [H.desde, H.hasta] = [H.hasta, H.desde];
    H.datos = H.aus = H.fer = null; pintarHoras();
  }
  function horasExportar() {
    if (!H.datos) return;
    if (H.agrupar === 'dia') return exportarPorDia();
    if (H.agrupar === 'prod') return exportarProductividad();
    const c = veCostos();
    bajarCSV(`horas_taller_${H.desde}_${H.hasta}`, ['Fecha', 'OT', 'Tipo OT', 'Nombre OT', 'Equipo', 'Técnico', 'Sistema', 'Componente', 'Tipo de hora', 'Horas',
      'Estado', ...(c ? ['Tarifa Gs/h', 'Costo Gs'] : [])],
      horasFiltradas().map(h => [h.fecha, h.ot, h.tipo_ot, h.ot_nombre, h.equipo_id, h.tecnico, h.sistema, h.componente, h.tipo_hora,
        String(h.horas ?? '').replace('.', ','), h.estado_reparacion, ...(c ? [h.tarifa_hora, h.costo] : [])]));
  }

  // Horas y costo de una OT (en su detalle)
  async function horasDeOT(numero) {
    const cont = $('ot-horas-' + numero);
    if (!cont) return;
    const { data, error } = await sb.from('v_ot_horas').select('*').eq('ot', numero).limit(1000);
    if (error || !data || !data.length) { cont.innerHTML = ''; return; }
    const g = agrupar(data, 'tecnico').sort((a, b) => b.horas - a.horas);
    const c = veCostos() && data[0].tipo_hora !== undefined;   // sin el SQL 65 no hay costos
    const tot = g.reduce((a, x) => a + x.horas, 0), costo = g.reduce((a, x) => a + (x.costo || 0), 0);
    cont.innerHTML = `<div class="card"><div class="card-header">Horas hombre${c ? ' y costo' : ''}: ${fmtNum(tot, 1)} h${c ? ' · Gs ' + gs(costo) : ''}</div><div class="card-body">
      <table class="g-mini"><thead><tr><th>Técnico</th><th>Horas</th>${c ? '<th>Costo Gs</th>' : ''}<th>Por sistema</th></tr></thead><tbody>${g.map(x =>
        `<tr><td>${esc(x.tecnico)}</td><td>${fmtNum(x.horas, 1)}</td>${c ? `<td style="text-align:right">${x.costo !== null ? gs(x.costo) : 'sin tarifa'}</td>` : ''}<td>${porSistema(x)}</td></tr>`).join('')}</tbody></table>
      </div></div>`;
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROL DE COMBUSTIBLE
  // ════════════════════════════════════════════════════════════════
  const G = { vista: 'movimientos', desde: primeroDelMes(), hasta: hoy(), movs: null, stock: null,
              conc: null, cons: null, anom: null, orden: { col: 'fecha', asc: false }, concFiltro: 'dif' };
  const VISTAS_G = [['movimientos', 'Movimientos'], ['stock', 'Stock de tanques'], ['conciliacion', 'Conciliación con partes'],
                    ['consumo', 'Consumo por equipo'], ['obras', 'Consumo por obra'], ['semanal', 'Rendimiento semanal'], ['ranking', 'Sobreconsumo'], ['anomalias', 'Anomalías']];
  const ACT_CORTA = { 'Despacho de combustible': 'Despacho', 'Traspaso entre tanques': 'Traspaso', 'Ingreso de combustible': 'Ingreso',
                      'Medición de tanque': 'Medición', 'Prueba de desviación': 'Prueba' };

  function pintarGasoil() {
    const g = leerLocal('gasoil_periodo');
    if (g && !G._restaurado) { G.desde = g.desde || G.desde; G.hasta = g.hasta || G.hasta; }
    G._restaurado = true;
    $('screen-gasoil').innerHTML = `
      <div class="g-sub">${VISTAS_G.map(([k, t]) => `<button class="${G.vista === k ? 'on' : ''}" onclick="Gestion.gVista('${k}')">${t}</button>`).join('')}</div>
      <div class="filtros">
        <div class="filtro siempre"><label>Desde</label><input type="date" id="g-desde" value="${G.desde}" onchange="Gestion.gPeriodo()"></div>
        <div class="filtro siempre"><label>Hasta</label><input type="date" id="g-hasta" value="${G.hasta}" onchange="Gestion.gPeriodo()"></div>
        <div class="filtro siempre"><label>&nbsp;</label><div style="display:flex;gap:6px">
          <button class="btn-filtro" onclick="Gestion.gAtajo('mes')">Este mes</button>
          <button class="btn-filtro" onclick="Gestion.gAtajo('30')">30 días</button>
          <button class="btn-filtro" onclick="Gestion.gAtajo('6m')">6 meses</button>
          <button class="btn-filtro" onclick="Gestion.gRecargar()">Actualizar</button></div></div>
      </div>
      <div class="tarjetas" id="g-tarjetas"></div>
      <div id="g-cuerpo"><div class="empty-state">Cargando…</div></div>`;
    cargarGasoil();
  }

  async function cargarGasoil(forzar) {
    const v = G.vista;
    try {
      const pedidos = [];
      // v20261111f: de a 1.000 filas (el servidor corta cada pedido en 1.000: con un período largo
      // las tarjetas y la lista quedaban cortas)
      if (forzar || !G.movs) pedidos.push((async () => {
        const out = [];
        for (let i = 0; i < 40; i++) {
          const r = await sb.from('combustible_movimientos').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
            .order('fecha', { ascending: false }).order('hora', { ascending: false, nullsFirst: false }).order('id').range(i * 1000, i * 1000 + 999);
          if (r.error) throw r.error;
          out.push(...(r.data || []));
          if (!r.data || r.data.length < 1000) break;
        }
        G.movs = out;
      })());
      if (forzar || !G.stock) pedidos.push(sb.from('v_stock_tanques').select('*').order('porcentaje', { nullsFirst: false }).then(r => { if (r.error) throw r.error; G.stock = r.data; }));
      if (forzar || !G.anom) pedidos.push(sb.from('v_combustible_anomalias').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
        .order('fecha', { ascending: false }).limit(3000).then(r => { if (r.error) throw r.error; G.anom = r.data; }));
      // v20261014c: la función filtra por fecha ANTES de agrupar (SQL 39; la vista
      // agrupaba los 45 mil partes y recién después filtraba). Misma respuesta;
      // si la función no está, se usa la vista como antes.
      if (v === 'conciliacion' && (forzar || !G.conc)) pedidos.push(
        sb.rpc('combustible_conciliacion', { p_desde: G.desde, p_hasta: G.hasta })
          .order('fecha', { ascending: false }).limit(10000)
          .then(r => r.error ? sb.from('v_combustible_conciliacion').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
            .order('fecha', { ascending: false }).limit(10000) : r)
          .then(r => { if (r.error) throw r.error; G.conc = r.data; }));
      // v20261111f (SQL 107): consumo por equipo, OBRA y mes, de a 1.000 filas (antes se cortaba en 1.000).
      // Sin el SQL 107: la función del SQL 70 (o la vista) como antes, también paginada, sin obra.
      if (v === 'consumo' && (forzar || !G.ceo)) pedidos.push((async () => {
        const pagina = async (pedir) => {
          const out = [];
          for (let i = 0; i < 60; i++) {
            const r = await pedir().range(i * 1000, i * 1000 + 999);
            if (r.error) return { error: r.error };
            out.push(...(r.data || []));
            if (!r.data || r.data.length < 1000) break;
          }
          return { data: out };
        };
        let r = await pagina(() => sb.rpc('combustible_consumo_obra', { p_desde: G.desde, p_hasta: G.hasta })
          .order('mes').order('equipo_id', { nullsFirst: false }).order('receptor', { nullsFirst: false }).order('obra_clave', { nullsFirst: false }));
        G.ceoSinObra = false;
        if (r.error) {
          if (!/combustible_consumo_obra/.test(r.error.message || '')) throw r.error;
          G.ceoSinObra = true;
          r = await pagina(() => sb.rpc('combustible_consumo', { p_desde: G.desde, p_hasta: G.hasta }).order('mes').order('equipo_id'));
          if (r.error && /combustible_consumo/.test(r.error.message || ''))
            r = await pagina(() => sb.from('v_combustible_consumo').select('*').gte('mes', G.desde.slice(0, 8) + '01').lte('mes', G.hasta).order('mes').order('equipo_id'));
          if (r.error) throw r.error;
          r.data = r.data.map(x => Object.assign({ receptor: null, obra_clave: null, despachos: null }, x));
        }
        G.ceo = r.data;
      })());
      // v20261028f (SQL 69): L/h por equipo y semana contra la meta y el máximo de la ficha
      if ((v === 'semanal' || v === 'ranking') && (forzar || !G.sem)) pedidos.push((async () => {
        const out = [];
        for (let i = 0; i < 20; i++) {
          const r = await sb.rpc('combustible_semanal', { p_desde: G.desde, p_hasta: G.hasta }).order('semana').order('equipo_id').range(i * 1000, i * 1000 + 999);
          if (r.error) { G.semError = /combustible_semanal/.test(r.error.message) ? 'Falta correr en Supabase el SQL 69 (consumo semanal).' : r.error.message; break; }
          G.semError = null;
          out.push(...(r.data || []));
          if (!r.data || r.data.length < 1000) break;
        }
        G.sem = out;
      })());
      // v20261111e: consumo por obra y mes — solo los despachos del período, de a 1.000 filas
      // v20261111i (SQL 108): gasoil de los partes en alquileres (305AM) en los meses sin ningún despacho del equipo
      if ((v === 'obras' || v === 'consumo') && (forzar || !G.pa)) pedidos.push((async () => {
        const out = [];
        G.paFalta = false;
        for (let i = 0; i < 20; i++) {
          const r = await sb.rpc('combustible_partes_alquiler', { p_desde: G.desde, p_hasta: G.hasta })
            .order('fecha').order('equipo_id').order('obra_clave').range(i * 1000, i * 1000 + 999);
          if (r.error) { G.paFalta = true; break; }
          out.push(...(r.data || []));
          if (!r.data || r.data.length < 1000) break;
        }
        G.pa = out;
      })());
      if (v === 'obras' && (forzar || !G.ob)) pedidos.push((async () => {
        const out = [];
        for (let i = 0; i < 100; i++) {
          const r = await sb.from('combustible_movimientos').select('id,fecha,obra_clave,obra_texto,litros')
            .eq('actividad', 'Despacho de combustible').gte('fecha', G.desde).lte('fecha', G.hasta)
            .order('fecha').order('id').range(i * 1000, i * 1000 + 999);
          if (r.error) throw r.error;
          out.push(...(r.data || []));
          if (!r.data || r.data.length < 1000) break;
        }
        G.ob = out;
      })());
      await Promise.all(pedidos);
    } catch (e) {
      if ($('g-cuerpo')) $('g-cuerpo').innerHTML = `<div class="aviso-caja rojo">No se pudo cargar: ${esc(e.message)}</div>`;
      return;
    }
    pintarGTarjetas();
    ({ movimientos: pintarMovs, stock: pintarStock, conciliacion: pintarConc, consumo: pintarCons, obras: pintarObras, semanal: pintarSemanal,
       ranking: pintarRanking, anomalias: pintarAnom })[v]();
  }

  function gPeriodo() {
    G.desde = $('g-desde').value || primeroDelMes();
    G.hasta = $('g-hasta').value || hoy();
    guardarLocal('gasoil_periodo', { desde: G.desde, hasta: G.hasta });
    G.movs = G.anom = G.conc = G.cons = G.ceo = G.sem = G.ob = G.pa = null;
    $('g-cuerpo').innerHTML = '<div class="empty-state">Cargando…</div>';
    cargarGasoil();
  }
  function gAtajo(a) {
    $('g-hasta').value = hoy();
    if (a === 'mes') $('g-desde').value = primeroDelMes();
    else if (a === '6m') { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5); $('g-desde').value = d.toISOString().slice(0, 8) + '01'; }
    else { const d = new Date(); d.setDate(d.getDate() - 30); $('g-desde').value = d.toISOString().slice(0, 10); }
    gPeriodo();
  }
  function gRecargar() { G.movs = G.stock = G.anom = G.conc = G.cons = G.ceo = G.sem = G.ob = G.pa = null; cargarGasoil(true); }
  function gVista(v) { G.vista = v; pintarGasoil(); }

  function pintarGTarjetas() {
    const m = G.movs || [], desp = m.filter(x => x.actividad === 'Despacho de combustible');
    const bajos = (G.stock || []).filter(s => s.porcentaje !== null && s.porcentaje < 20).length;
    const tj = [
      { n: fmtNum(desp.reduce((a, x) => a + num(x.litros), 0)), t: 'Litros despachados', v: 'movimientos' },
      { n: desp.length, t: 'Despachos', v: 'movimientos' },
      { n: fmtNum(m.filter(x => x.actividad === 'Ingreso de combustible').reduce((a, x) => a + num(x.litros_ingresados), 0)), t: 'Litros ingresados', v: 'movimientos' },
      { n: new Set(desp.map(x => x.equipo_id || x.receptor_texto)).size, t: 'Equipos cargados', v: 'consumo' },
      { n: bajos, t: 'Tanques bajo 20 %', c: bajos ? 'malo' : 'bien', v: 'stock' },
      { n: (G.anom || []).length, t: 'Anomalías', c: (G.anom || []).length ? 'medio' : 'bien', v: 'anomalias' },
    ];
    $('g-tarjetas').innerHTML = tj.map(t => `<button class="tarjeta ${t.c || ''}" onclick="Gestion.gVista('${t.v}')">
      <span class="n">${t.n}</span><span class="t">${t.t}</span></button>`).join('');
  }

  // ── Movimientos ──
  const MOV_COLS = [['fecha', 'Fecha'], ['hora', 'Hora'], ['actividad', 'Actividad'], ['tanque', 'Tanque'], ['recibe', 'Recibe'],
    ['operador', 'Operador'], ['cantidad', 'Litros'], ['lectura', 'Horóm./Km'], ['cuenta_litros_inicial', 'C. L. inicial'],
    ['cuenta_litros_final', 'C. L. final'], ['nro_boleta', 'Boleta'], ['despachador', 'Despachador'], ['obra', 'Obra'], ['origen', 'Origen']];
  function movFila(x) {
    return Object.assign({}, x, {
      tanque: x.tanque_salida_id || x.tanque_fijo_id || x.tanque_salida_texto || '',
      recibe: x.actividad === 'Ingreso de combustible' ? (x.proveedor || '') : (x.equipo_id || x.receptor_texto || ''),
      operador: nombre(x.operador_cedula, x.operador_texto),
      despachador: nombre(x.despachador_cedula, x.despachador_texto),
      cantidad: x.litros ?? x.litros_ingresados ?? x.stock_medido ?? null,
      lectura: x.horometro ?? x.odometro ?? null,
      obra: x.obra_clave || x.obra_texto || '',
      fotos: [x.foto_boleta, x.foto_cuenta_inicial, x.foto_cuenta_final].filter(Boolean).length
    });
  }
  function movFiltradas() {
    const v = id => ($(id) || {}).value || '';
    const q = v('m-buscar').toLowerCase().trim();
    return (G.movs || []).map(movFila).filter(x => {
      if ($('m-act') && !MS.ok('m-act', x.actividad)) return false;
      if ($('m-tanque') && !MS.ok('m-tanque', x.tanque)) return false;
      if (q) {
        const pajar = [x.tanque, x.recibe, x.operador, x.despachador, x.nro_boleta, x.obra, x.observaciones].join(' ').toLowerCase();
        if (!q.split(/\s+/).every(p => pajar.includes(p))) return false;
      }
      return true;
    });
  }
  function pintarMovs() {
    const previo = { q: ($('m-buscar') || {}).value || '', a: $('m-act') ? MS.valores('m-act') : [], t: $('m-tanque') ? MS.valores('m-tanque') : [] };
    const tanques = [...new Set((G.movs || []).map(x => x.tanque_salida_id || x.tanque_fijo_id).filter(Boolean))].sort();
    $('g-cuerpo').innerHTML = `
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label><input type="text" id="m-buscar" value="${esc(previo.q)}" placeholder="Equipo, chapa, operador, boleta…" oninput="Gestion.movRepintar()"></div>
        <div class="filtro siempre"><label>Actividad</label><select id="m-act" class="ms" onchange="Gestion.movRepintar()"><option value="" ${previo.a.length ? '' : 'selected'}>Todas</option>
          ${Object.entries(ACT_CORTA).map(([k, t]) => `<option value="${k}" ${previo.a.includes(k) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro"><label>Tanque</label><select id="m-tanque" class="ms" onchange="Gestion.movRepintar()"><option value="" ${previo.t.length ? '' : 'selected'}>Todos</option>
          ${tanques.map(t => `<option ${previo.t.includes(t) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="barra-acciones"><div class="info" id="m-info"></div>
        <button class="btn-filtro" onclick="Gestion.movExportar()">Exportar</button></div>
      <div id="m-lista"></div>`;
    movRepintar();
  }
  function movRepintar() {
    const filas = ordenarFilas(movFiltradas(), G.orden);
    const litros = filas.filter(x => x.actividad === 'Despacho de combustible').reduce((a, x) => a + num(x.litros), 0);
    $('m-info').textContent = `${filas.length} movimientos · ${fmtNum(litros)} L despachados`;
    if (!filas.length) return $('m-lista').innerHTML = '<div class="empty-state">No hay movimientos en ese período.</div>';
    if (window.innerWidth < 700) {
      $('m-lista').innerHTML = '<div class="equipos">' + filas.slice(0, 500).map(x => `
        <button class="eq" onclick="Gestion.abrirMov('${x.id}')"><div class="fila1">
          <div><div class="cod">${fmtNum(x.cantidad, 1)} L · ${esc(x.recibe)}</div>
          <div class="tipo">${fmtFecha(x.fecha)} ${x.hora ? String(x.hora).slice(0, 5) : ''} · ${esc(ACT_CORTA[x.actividad] || x.actividad)} · ${esc(x.tanque)}</div></div>
          ${x.fotos ? '<span class="chip gris">📷</span>' : ''}</div>
          <div class="meta">${[x.operador, x.nro_boleta ? 'boleta ' + x.nro_boleta : '', x.despachador].filter(Boolean).map(esc).join(' · ')}</div></button>`).join('') + '</div>';
      return;
    }
    $('m-lista').innerHTML = `<div class="tabla-wrap"><table class="tabla"><thead><tr>${MOV_COLS.map(([k, t]) =>
      `<th class="${G.orden.col === k ? 'activo' : ''}" onclick="Gestion.movOrdenar('${k}')">${t}${G.orden.col === k ? (G.orden.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${filas.slice(0, 2000).map(x => `<tr onclick="Gestion.abrirMov('${x.id}')">${MOV_COLS.map(([k]) => {
        let v = x[k];
        if (k === 'fecha') v = fmtFecha(v);
        if (k === 'hora') v = v ? String(v).slice(0, 5) : '';
        if (k === 'actividad') v = ACT_CORTA[v] || v;
        if (k === 'origen') v = { pwa: 'App', jotform: 'JotForm' }[v] || v;
        if (['cantidad', 'lectura', 'cuenta_litros_inicial', 'cuenta_litros_final'].includes(k)) v = fmtNum(v, 1);
        return `<td class="${k === 'obra' ? 'larga' : ''}">${esc(v ?? '')}</td>`;
      }).join('')}<td>${x.fotos ? '📷' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function movOrdenar(col) { G.orden = { col, asc: G.orden.col === col ? !G.orden.asc : true }; movRepintar(); }
  function movExportar() {
    const filas = ordenarFilas(movFiltradas(), G.orden);
    const cols = MOV_COLS.concat([['tipo_medicion', 'Tipo medición'], ['litros_contador', 'Litros según contador'], ['observaciones', 'Observaciones']]);
    bajarCSV('combustible_' + G.desde + '_a_' + G.hasta, cols.map(c => c[1]), filas.map(x => cols.map(([k]) => x[k])));
  }

  async function abrirMov(id) {
    let x = (G.movs || []).find(m => m.id === id);
    if (!x) {
      const { data } = await sb.from('combustible_movimientos').select('*').eq('id', id).single();
      x = data;
    }
    if (!x) return toast('No se encontró el movimiento', 'error');
    const f = movFila(x), t = esTaller();
    const dato = (e, v) => `<div class="dato"><div class="e">${e}</div><div class="v">${v ?? ''}</div></div>`;
    abrirModal(`${ACT_CORTA[x.actividad] || x.actividad} · ${fmtFecha(x.fecha)}`, `
      <div class="datos">
        ${dato('Fecha y hora', fmtFecha(x.fecha) + (x.hora ? ' ' + String(x.hora).slice(0, 5) : ''))}
        ${dato('Tanque', esc(f.tanque))}
        ${x.actividad === 'Ingreso de combustible' ? dato('Proveedor', esc(x.proveedor)) : dato('Recibe', x.equipo_id ? linkEquipo(x.equipo_id) : esc(x.receptor_texto))}
        ${dato('Propietario', esc(x.propietario))}
        ${dato('Operador', esc(f.operador))}
        ${dato('Litros', fmtNum(f.cantidad, 1))}
        ${x.litros_contador !== null ? dato('Según cuenta litros', fmtNum(x.litros_contador, 1) + ` (${fmtNum(x.cuenta_litros_inicial, 1)} → ${fmtNum(x.cuenta_litros_final, 1)})`) : ''}
        ${f.lectura !== null ? dato(x.odometro !== null ? 'Odómetro' : 'Horómetro', fmtNum(f.lectura, 1)) : ''}
        ${dato('Boleta', esc(x.nro_boleta))}
        ${dato('Despachador', esc(f.despachador))}
        ${dato('Obra', esc(f.obra))}
        ${x.prueba_desviacion_1 !== null ? dato('Pruebas de desviación', [x.prueba_desviacion_1, x.prueba_desviacion_2, x.prueba_desviacion_3].filter(v => v !== null).join(' · ')) : ''}
        ${dato('Cargado', fmtMomento(x.creado_en) + ' · ' + esc({ pwa: 'App', jotform: 'JotForm' }[x.origen] || x.origen))}
      </div>
      ${x.observaciones ? `<p class="g-texto">${esc(x.observaciones)}</p>` : ''}
      ${galeria([x.foto_cuenta_inicial, x.foto_cuenta_final, x.foto_boleta], 'combustible')}
      ${puedeCorregir(x) ? `<div id="mov-corregir"></div>` : ''}`);
    if (puedeCorregir(x)) pintarCorregirMov(x);
    firmarFotos($('modal-cuerpo'));
  }
  // ══════════════════════════════════════════════════════════════
  // CORREGIR Y ELIMINAR (v20261023a, SQL 54)
  //
  // Administración central siempre; dentro de las 24 h de cargado, quien
  // lo cargó y el rol taller (la base lo vuelve a controlar). Eliminar
  // manda el registro a la papelera: se puede restaurar 7 días.
  // ══════════════════════════════════════════════════════════════
  const DIA_MS = 24 * 3600 * 1000;
  function puedeCorregir(x) {
    if (!sesion || !x) return false;
    if (sesion.rol === 'admin_central') return true;
    return Date.now() - new Date(x.creado_en).getTime() < DIA_MS && (x.usuario_id === sesion.id || esTaller());
  }
  const vacioANull = (v) => (v === undefined || v === '' ? null : v);
  let obrasCache = null;
  async function obrasActivas() {
    if (!obrasCache) {
      const { data } = await sb.from('obras').select('clave').eq('activa', true).order('clave');
      obrasCache = (data || []).map(o => o.clave);
    }
    return obrasCache;
  }
  // Un campo de corrección: [columna, etiqueta, tipo]
  function campoCorr(x, [k, et, tipo], obras) {
    const id = 'cr-' + k, v = x[k];
    const opcs = (lista, actual, texto) => `<select id="${id}"><option value="">—</option>${
      (actual && !lista.some(o => o[0] === actual) ? [[actual, actual]] : []).concat(lista).map(([val, tx]) =>
        `<option value="${esc(val)}" ${val === actual ? 'selected' : ''}>${esc(tx)}</option>`).join('')}</select>`;
    let html;
    if (tipo === 'tanque') html = opcs(flota.filter(e => e.categoria === 'tanque' && ((e.activo && !/emulsi|diluid/i.test(e.tipo || '')) || e.id === v)).map(e => [e.id, e.id + (e.descripcion ? ' · ' + e.descripcion : '')]), v);
    else if (tipo === 'equipo') html = opcs(flota.filter(e => e.activo || e.id === v).map(e => [e.id, e.id]), v);
    else if (tipo === 'persona') html = opcs((cat.ops || []).filter(o => o.activo || o.cedula === v).map(o => [o.cedula, o.nombre]), v);
    else if (tipo === 'obra') html = opcs((obras || []).map(o => [o, o]), v);
    else if (tipo === 'txt') html = txt(id, v);
    else if (tipo === 'num') html = inp(id, v, 'number', 'step="any"');
    else if (tipo === 'hora') html = inp(id, v ? String(v).slice(0, 5) : '', 'time');
    else html = inp(id, v, tipo === 'fecha' ? 'date' : 'text');
    return campo(id, et, html, tipo === 'txt' ? 'ancho' : '');
  }
  function leerCorr(x, campos) {
    const cambios = {};
    campos.forEach(([k, , tipo]) => {
      const el = $('cr-' + k);
      if (!el) return;
      let v = el.value.trim();
      v = v === '' ? null : tipo === 'num' ? Number(v) : v;
      let antes = x[k] ?? null;
      if (tipo === 'hora' && antes) antes = String(antes).slice(0, 5);
      if (String(v ?? '') !== String(antes ?? '')) cambios[k] = v;
    });
    return cambios;
  }
  function bloqueEliminar(fn) {
    return `<div class="card" style="margin-top:12px;border:1px solid #f3c4c0"><div class="card-header" style="color:var(--rojo)">Eliminar</div><div class="card-body">
      <p class="g-texto" style="margin-top:0">Va a la papelera: deja de contar en stock, consumo y horas. Administración lo puede restaurar durante 7 días; después se borra solo.</p>
      <div class="form-grid">${campo('cr-motivo', 'Motivo', inp('cr-motivo', '', 'text', 'placeholder="Ej.: cargado dos veces"'), 'ancho')}</div>
      <div class="acciones"><button class="btn btn-rojo" onclick="${fn}">Eliminar</button></div></div></div>`;
  }

  // ── Combustible ──
  function camposMov(x) {
    const tq = ['Despacho de combustible', 'Traspaso entre tanques'].includes(x.actividad) ? 'tanque_salida_id' : 'tanque_fijo_id';
    const base = [['fecha', 'Fecha', 'fecha'], ['hora', 'Hora', 'hora'], [tq, x.actividad === 'Traspaso entre tanques' ? 'Tanque de salida' : 'Tanque', 'tanque']];
    const fin = [['nro_boleta', 'Boleta', 'texto'], ['despachador_cedula', 'Despachador', 'persona'], ['obra_clave', 'Obra', 'obra'],
                 ['observaciones', 'Observaciones', 'txt']];
    if (x.actividad === 'Traspaso entre tanques') return base.concat([
      ['equipo_id', 'Tanque que recibe', 'tanque'], ['litros', 'Litros', 'num'],
      ['cuenta_litros_inicial', 'Cuenta litros inicial', 'num'], ['cuenta_litros_final', 'Cuenta litros final', 'num']], fin);
    if (x.actividad === 'Despacho de combustible') return base.concat([
      ['equipo_id', 'Equipo que recibe', 'equipo'], ['operador_cedula', 'Operador', 'persona'], ['litros', 'Litros', 'num'],
      ['cuenta_litros_inicial', 'Cuenta litros inicial', 'num'], ['cuenta_litros_final', 'Cuenta litros final', 'num'],
      [x.odometro !== null && x.odometro !== undefined ? 'odometro' : 'horometro', x.odometro !== null && x.odometro !== undefined ? 'Odómetro' : 'Horómetro', 'num']], fin);
    if (x.actividad === 'Ingreso de combustible') return base.concat([
      ['proveedor', 'Proveedor', 'texto'], ['litros_ingresados', 'Litros ingresados', 'num']], fin);
    if (x.actividad === 'Medición de tanque') return base.concat([['stock_medido', 'Stock medido (L)', 'num']], fin);
    return base.concat([['prueba_desviacion_1', 'Prueba 1', 'num'], ['prueba_desviacion_2', 'Prueba 2', 'num'],
      ['prueba_desviacion_3', 'Prueba 3', 'num']], fin);
  }
  async function pintarCorregirMov(x) {
    const obras = await obrasActivas();
    const caja = $('mov-corregir');
    if (!caja) return;
    caja.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-header">Corregir</div><div class="card-body">
      <div class="form-grid">${camposMov(x).map(c => campoCorr(x, c, obras)).join('')}</div>
      <div class="acciones"><button class="btn btn-verde" onclick="Gestion.guardarMov('${x.id}')">Guardar</button></div></div></div>
      ${bloqueEliminar(`Gestion.eliminarMov('${x.id}')`)}`;
  }
  async function movActual(id) {
    let x = (G.movs || []).find(m => m.id === id);
    if (!x) { const { data } = await sb.from('combustible_movimientos').select('*').eq('id', id).single(); x = data; }
    return x;
  }
  async function guardarMov(id) {
    const x = await movActual(id);
    if (!x) return toast('No se encontró el movimiento', 'error');
    const cambios = leerCorr(x, camposMov(x));
    if (!Object.keys(cambios).length) return toast('No hay cambios para guardar');
    mostrarCarga('Guardando…');
    const { error } = await sb.rpc('corregir_registro', { p_tabla: 'combustible_movimientos', p_id: id, p_cambios: cambios, p_items: null });
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Corregido', 'success');
    cerrarModal();
    gRecargar();
  }
  async function eliminarMov(id) {
    const motivo = ($('cr-motivo').value || '').trim();
    if (!motivo) return toast('Escribí el motivo', 'warning');
    if (!confirm('¿Eliminar este movimiento? Se puede restaurar durante 7 días.')) return;
    mostrarCarga('Eliminando…');
    const { error } = await sb.rpc('eliminar_registro', { p_tabla: 'combustible_movimientos', p_id: id, p_motivo: motivo });
    ocultarCarga();
    if (error) return toast('No se pudo eliminar: ' + error.message, 'error');
    toast('Eliminado (queda 7 días en la papelera)', 'success');
    cerrarModal();
    gRecargar();
  }

  // ── Taller: un reporte diario dentro de la OT ──
  const CAMPOS_REG = [['fecha', 'Fecha', 'fecha'], ['tecnico_cedula', 'Técnico', 'persona'], ['estado_maquina', 'Estado de la máquina', 'texto'],
    ['tipo_medicion', 'Tipo de medición', 'texto'], ['lectura', 'Lectura', 'num'], ['horas_mantenimiento', 'Horas de mantenimiento', 'num'],
    ['horas_supervision_tercerizada', 'Horas supervisión tercerizada', 'num'], ['horas_traslado', 'Horas de traslado', 'num'],
    ['detalle', 'Detalle', 'txt'], ['observaciones', 'Observaciones', 'txt']];
  let regsOT = [];
  function regEditar(id) {
    const r = regsOT.find(x => x.id === id);
    const caja = $('reg-acc-' + id);
    if (!r || !caja) return;
    if (caja.innerHTML) { caja.innerHTML = ''; return; }
    const items = r.ot_registro_items || [];
    caja.innerHTML = `<div class="card" style="margin-top:10px"><div class="card-header">Corregir reporte</div><div class="card-body">
      <div class="form-grid">${CAMPOS_REG.filter(([k]) => k !== 'horas_traslado' || r.realizo_traslado)
        .filter(([k]) => k !== 'horas_mantenimiento' || r.tipo_mantenimiento)
        .map(c => campoCorr(r, c)).join('')}</div>
      ${items.length ? `<table class="g-mini"><thead><tr><th>Sistema</th><th>Componente</th><th>Horas</th><th>Estado</th></tr></thead><tbody>${
        items.map((i, n) => `<tr><td>${esc(i.sistema)}</td><td>${esc(i.componente)}</td>
          <td><input id="ri-h-${n}" type="number" step="0.5" value="${esc(i.horas ?? '')}" style="width:70px"></td>
          <td><input id="ri-e-${n}" value="${esc(i.estado_reparacion || '')}"></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="acciones"><button class="btn btn-verde" onclick="Gestion.regGuardar('${r.id}')">Guardar</button></div></div></div>
      ${bloqueEliminar(`Gestion.regEliminar('${r.id}')`)}`;
  }
  async function regGuardar(id) {
    const r = regsOT.find(x => x.id === id);
    if (!r) return;
    const cambios = leerCorr(r, CAMPOS_REG);
    const items = (r.ot_registro_items || []).map((i, n) => ({
      sistema: i.sistema, componente: i.componente,
      horas: ($('ri-h-' + n).value || '').trim(), estado_reparacion: ($('ri-e-' + n).value || '').trim() }))
      .filter((i, n) => String(i.horas) !== String(r.ot_registro_items[n].horas ?? '') || i.estado_reparacion !== (r.ot_registro_items[n].estado_reparacion || ''));
    if (!Object.keys(cambios).length && !items.length) return toast('No hay cambios para guardar');
    mostrarCarga('Guardando…');
    const { error } = await sb.rpc('corregir_registro', { p_tabla: 'ot_registros', p_id: id, p_cambios: cambios, p_items: items.length ? items : null });
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Reporte corregido', 'success');
    await cargarOTs();
    abrirOT(otAbierta.numero);
  }
  async function regEliminar(id) {
    const motivo = ($('cr-motivo').value || '').trim();
    if (!motivo) return toast('Escribí el motivo', 'warning');
    const r = regsOT.find(x => x.id === id) || {};
    if (!confirm(`¿Eliminar este reporte de la OT ${otAbierta.numero}?${r.finaliza_ot ? '\n\nEs el que cerró la OT: la OT vuelve a quedar abierta.' : ''}\n\nSe puede restaurar durante 7 días.`)) return;
    mostrarCarga('Eliminando…');
    const { error } = await sb.rpc('eliminar_registro', { p_tabla: 'ot_registros', p_id: id, p_motivo: motivo });
    ocultarCarga();
    if (error) return toast('No se pudo eliminar: ' + error.message, 'error');
    toast('Reporte eliminado (queda 7 días en la papelera)', 'success');
    await cargarOTs();
    abrirOT(otAbierta.numero);
    if (typeof cargarFlota === 'function') cargarFlota();
  }

  // ── Stock de tanques ──
  function pintarStock() {
    const l = G.stock || [];
    $('g-cuerpo').innerHTML = !l.length ? '<div class="empty-state">No hay tanques activos.</div>' : `
      <div class="aviso-caja">Stock estimado = última medición del tanque + ingresos y traspasos recibidos − despachos y traspasos enviados desde esa medición.
        Los tanques de emulsión / diluido no se listan.
        Para que sea confiable, el despachador tiene que cargar una "Medición de tanque" cada tanto.</div>
      <div class="equipos">${l.map(s => {
        const p = s.porcentaje, color = p === null ? 'gris' : p < 20 ? 'rojo' : p < 40 ? 'amarillo' : 'verde';
        return `<div class="eq" style="cursor:default"><div class="fila1"><div><div class="cod">${esc(s.tanque_id)}</div>
          <div class="tipo">${esc(s.descripcion || '')}${s.asignacion || s.ubicacion ? ' · ' + esc(s.asignacion || s.ubicacion) : ''}</div></div>
          <span class="chip ${color}">${p === null ? 'sin capacidad' : p + ' %'}</span></div>
          <div class="g-barra"><i class="${color}" style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>
          <div class="meta"><b>${fmtNum(s.stock_estimado)} L</b>${s.capacidad ? ' de ' + fmtNum(s.capacidad) + ' L' : ''}
            · ingresó ${fmtNum(num(s.ingresos) + num(s.traspasos_recibidos))} L · salió ${fmtNum(s.despachos)} L</div>
          <div class="chips">${s.sin_medicion ? '<span class="chip amarillo">sin medición: arranca de 0</span>'
            : `<span class="chip gris">medido el ${fmtFecha(s.fecha_medicion)}</span>`}
            ${s.ultimo_movimiento ? `<span class="chip gris">último movimiento ${fmtFecha(s.ultimo_movimiento)}</span>` : ''}</div></div>`;
      }).join('')}</div>`;
  }

  // ── Conciliación ──
  function pintarConc() {
    const l = G.conc || [];
    const cuenta = (r) => l.filter(x => x.resultado === r).length;
    const filtros = [['dif', 'Con diferencias', l.filter(x => x.resultado !== 'OK').length], ['OK', 'OK', cuenta('OK')],
      ['Diferencia de litros', 'Diferencia de litros', cuenta('Diferencia de litros')],
      ['Solo en el despacho', 'Solo en el despacho', cuenta('Solo en el despacho')], ['Solo en el parte', 'Solo en el parte', cuenta('Solo en el parte')], ['', 'Todo', l.length]];
    const filas = l.filter(x => G.concFiltro === '' ? true : G.concFiltro === 'dif' ? x.resultado !== 'OK' : x.resultado === G.concFiltro);
    $('g-cuerpo').innerHTML = `
      <div class="aviso-caja">Compara, por equipo y día, los litros que cargó el despachador con los que el operador declaró en su parte diario
        (tolerancia: 5 L o 2 %).</div>
      <div class="g-sub chico">${filtros.map(([k, t, n]) => `<button class="${G.concFiltro === k ? 'on' : ''}" onclick="Gestion.concFiltrar('${k}')">${t} (${n})</button>`).join('')}
        <button onclick="Gestion.concExportar()">Exportar</button></div>
      ${!filas.length ? '<div class="empty-state">Nada para mostrar.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr>
        <th>Fecha</th><th>Equipo</th><th>Despacho (L)</th><th>Parte (L)</th><th>Diferencia</th><th>Boletas</th><th>Remisiones del parte</th><th>Resultado</th></tr></thead>
        <tbody>${filas.slice(0, 2000).map(x => `<tr onclick="${x.equipo_id && flota.some(f => f.id === x.equipo_id) ? `abrirFicha('${esc(x.equipo_id)}','partes')` : ''}">
          <td>${fmtFecha(x.fecha)}</td><td><b>${esc(x.equipo_id)}</b></td><td>${fmtNum(x.litros_despacho, 1)}</td><td>${fmtNum(x.litros_parte, 1)}</td>
          <td>${fmtNum(x.diferencia, 1)}</td><td>${esc((x.boletas || []).join(', '))}</td><td>${esc((x.remisiones || []).join(', '))}</td>
          <td><span class="chip ${x.resultado === 'OK' ? 'verde' : x.resultado === 'Diferencia de litros' ? 'rojo' : 'amarillo'}">${esc(x.resultado)}</span></td></tr>`).join('')}</tbody></table></div>`}`;
  }
  function concFiltrar(k) { G.concFiltro = k; pintarConc(); }
  function concExportar() {
    bajarCSV('conciliacion_combustible', ['Fecha', 'Equipo', 'Litros despacho', 'Litros parte', 'Diferencia', 'Boletas', 'Remisiones', 'Resultado'],
      (G.conc || []).map(x => [x.fecha, x.equipo_id, x.litros_despacho, x.litros_parte, x.diferencia, x.boletas, x.remisiones, x.resultado]));
  }

  // ── Consumo por equipo (v20261111f, SQL 107) ──
  // Una fila de la función = equipo × mes × obra: litros de los despachos con
  // esa obra y horas / km de los partes con esa obra. La pantalla agrupa como se
  // pida (equipo y mes, equipo y obra, …), filtra por equipo, obra, tipo y
  // desvío, y dibuja barras de litros (apiladas por obra) o de L/h.
  // Obra «por código» = une las obras con el mismo código de centro de costo
  // (Chaco Sur / Acceso a Gral. Bruguez, sub-obras de Cruzmonte): el despacho
  // y el parte a veces se cargan con nombres distintos del mismo código.
  const CE_AGRUPAR = [['eqmes', 'Equipo y mes'], ['eqobra', 'Equipo y obra'], ['eqobrames', 'Equipo, obra y mes'], ['eq', 'Equipo (total)'], ['obra', 'Obra (total)']];
  const CE_DESVIO = [['', 'Todos'], ['sobre', 'Sobre la referencia'], ['30', 'Más de +30 %'], ['max', 'Sobre el máximo de la ficha'], ['sinh', 'Litros sin horas']];
  const ce = () => G.ce || (G.ce = { agrupar: 'eqmes', obraPor: 'cod', graf: 'eq', met: 'litros', desvio: '', sinFlota: false, orden: { col: 'litros', asc: false } });
  const ceEqKey = (x) => x.equipo_id || '~' + (x.receptor || '');
  const litrosP = (x) => usaParte() ? num(x.litros_parte) : 0;   // gasoil del parte (alquiler sin despacho en el mes) que cuenta
  const litrosDe = (x) => num(x.litros) + litrosP(x);
  function ceObra(x) {
    if (G.ceoSinObra) return { k: '', nom: '' };
    const o = obraDe(x);
    if (!x.obra_clave) return { k: '', nom: 'Sin obra' };
    return ce().obraPor === 'cod' && o.cod ? { k: o.cod, nom: o.nom, cod: o.cod } : { k: o.clave, nom: o.nom, cod: o.cod };
  }
  function ceBase() {
    // filas de la función con su equipo y obra resueltos, antes de filtrar
    const nombresCod = {};
    const l = (G.ceo || []).map(x => {
      const o = ceObra(x);
      if (o.cod) (nombresCod[o.k] = nombresCod[o.k] || new Set()).add(o.nom);
      return Object.assign({}, x, { _eq: ceEqKey(x), _flota: !!x.equipo_id, _ok: o.k, _onom: o.nom, _ocod: o.cod || '', _mes: String(x.mes).slice(0, 7) });
    });
    if (ce().obraPor === 'cod') l.forEach(x => { if (x._ocod && nombresCod[x._ok]) x._onom = [...nombresCod[x._ok]].join(' / '); });
    return l;
  }
  function ceFiltrar(base) {
    const c = ce();
    return base.filter(x => (c.sinFlota || x._flota)
      && (!$('ce-eq') || MS.ok('ce-eq', x._eq)) && (!$('ce-obra') || MS.ok('ce-obra', x._ok))
      && (!$('ce-tipo') || MS.ok('ce-tipo', x._flota ? (x.tipo || x.descripcion || '(sin tipo)') : 'Sin equipo de flota')));
  }
  function ceAgrupar(filas, modo) {
    const por = new Map();
    const clave = { eqmes: x => x._eq + '|' + x._mes, eqobra: x => x._eq + '|' + x._ok, eqobrames: x => x._eq + '|' + x._ok + '|' + x._mes,
                    eq: x => x._eq, obra: x => x._ok, mes: x => x._mes }[modo];
    filas.forEach(x => {
      const k = clave(x);
      let g = por.get(k);
      if (!g) por.set(k, g = { k, eq: x._eq, equipo_id: x.equipo_id, receptor: x.receptor, flota: x._flota, tipo: x._flota ? (x.tipo || x.descripcion || '') : 'Sin equipo de flota',
        mes: modo === 'eqmes' || modo === 'eqobrames' || modo === 'mes' ? x._mes : null, ok: x._ok, onom: x._onom, ocod: x._ocod,
        ref: x.referencia_lh, meta: x.meta_lh, max: x.max_lh, litros: 0, parte: 0, horas: 0, km: 0, despachos: 0, porObra: {}, porObraParte: {}, litrosSinHoras: 0 });
      const lp = litrosP(x), l = num(x.litros) + lp, h = num(x.horas);
      g.litros += l; g.parte += lp; g.horas += h; g.km += num(x.km); g.despachos += num(x.despachos);
      if (l) g.porObra[x._ok] = (g.porObra[x._ok] || 0) + l;
      if (lp) g.porObraParte[x._ok] = (g.porObraParte[x._ok] || 0) + lp;
      if (l && !h) g.litrosSinHoras += l;
    });
    return [...por.values()].map(g => {
      const unEq = modo !== 'obra' && modo !== 'mes';
      const lh = g.litros > 0 && g.horas > 0 ? g.litros / g.horas : null;
      const ref = unEq ? num(g.ref) : 0;
      return Object.assign(g, { lh, l100: g.litros > 0 && g.km > 0 ? 100 * g.litros / g.km : null,
        desvio: unEq && lh !== null && ref > 0 ? Math.round(100 * (lh - ref) / ref) : null,
        ref: unEq ? g.ref : null, meta: unEq ? g.meta : null, max: unEq ? g.max : null });
    });
  }
  function ceFiltroDesvio(l) {
    const d = ce().desvio;
    return !d ? l : l.filter(g => d === 'sobre' ? g.desvio > 0 : d === '30' ? g.desvio > 30
      : d === 'max' ? g.lh !== null && g.max !== null && g.max !== undefined && g.lh > g.max : g.litros > 0 && !g.horas);
  }
  const ceEqNombre = (g) => g.flota ? g.equipo_id : (g.receptor || '(sin receptor)');

  function pintarCons() {
    const c = ce(), base = ceBase();
    const prev = { eq: $('ce-eq') ? MS.valores('ce-eq') : (c.eqPrevio || []), ob: $('ce-obra') ? MS.valores('ce-obra') : [], ti: $('ce-tipo') ? MS.valores('ce-tipo') : [] };
    c.eqPrevio = null;
    const eqs = new Map(), obras = new Map(), tipos = new Set();
    base.forEach(x => {
      if (!c.sinFlota && !x._flota) return;
      if (!eqs.has(x._eq)) eqs.set(x._eq, x._flota ? `${x.equipo_id} · ${x.tipo || x.descripcion || ''}` : `${x.receptor || '(sin receptor)'} · sin equipo de flota`);
      if (!G.ceoSinObra && !obras.has(x._ok)) obras.set(x._ok, (x._ocod ? x._ocod + ' · ' : '') + x._onom);
      tipos.add(x._flota ? (x.tipo || x.descripcion || '(sin tipo)') : 'Sin equipo de flota');
    });
    const litSin = base.filter(x => !x._flota).reduce((a, x) => a + num(x.litros), 0);
    const opt = (m, sel) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, t]) => `<option value="${esc(k)}" ${sel.includes(k) ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const tg = (campo, val, txt) => `<button class="${c[campo] === val ? 'on' : ''}" onclick="Gestion.ceSet('${campo}','${val}')">${txt}</button>`;
    $('g-cuerpo').innerHTML = `
      ${!G.ceoSinObra && G.paFalta ? '<div class="aviso-caja">Para sumar el gasoil que declaran los partes en alquileres sin despacho falta correr en Supabase el <b>SQL 108</b>.</div>' : ''}
      ${G.ceoSinObra ? '<div class="aviso-caja rojo">Para filtrar y agrupar por obra falta correr en Supabase el <b>SQL 107</b> (consumo por obra). Mientras tanto se ve por equipo y mes, como antes.</div>' : ''}
      <div class="aviso-caja">Litros de gasoil despachados a cada equipo contra las horas de horómetro (o km) de sus partes diarios. Litros y horas se reparten por la obra
        cargada en el despacho y en el parte; «por código» une las obras del mismo centro de costo. El desvío compara el L/h con la referencia de la ficha técnica.</div>
      <div class="filtros">
        <div class="filtro crece"><label>Equipo</label><select id="ce-eq" class="ms" onchange="Gestion.ceRepintar()"><option value="" ${prev.eq.length ? '' : 'selected'}>Todos</option>${opt(eqs, prev.eq)}</select></div>
        ${G.ceoSinObra ? '' : `<div class="filtro crece"><label>Obra</label><select id="ce-obra" class="ms" onchange="Gestion.ceRepintar()"><option value="" ${prev.ob.length ? '' : 'selected'}>Todas</option>${opt(obras, prev.ob)}</select></div>`}
        <div class="filtro"><label>Tipo de equipo</label><select id="ce-tipo" class="ms" onchange="Gestion.ceRepintar()"><option value="" ${prev.ti.length ? '' : 'selected'}>Todos</option>
          ${[...tipos].sort().map(t => `<option ${prev.ti.includes(t) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Desvío</label><select onchange="Gestion.ceSet('desvio',this.value)">${CE_DESVIO.map(([k, t]) => `<option value="${k}" ${c.desvio === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Agrupar</label><select onchange="Gestion.ceSet('agrupar',this.value)">${CE_AGRUPAR.filter(([k]) => !G.ceoSinObra || !/obra/.test(k))
          .map(([k, t]) => `<option value="${k}" ${c.agrupar === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${G.ceoSinObra ? '' : `<div class="filtro siempre"><label>Obra por</label><div class="vista-toggle">${tg('obraPor', 'cod', 'Código')}${tg('obraPor', 'nom', 'Nombre')}</div></div>`}
      </div>
      <div class="ce-opciones">
        <div class="vista-toggle">${tg('met', 'litros', 'Litros')}${tg('met', 'lh', 'L/h')}</div>
        <div class="vista-toggle">${tg('graf', 'eq', 'Por equipo')}${tg('graf', 'mes', 'Por mes')}${G.ceoSinObra ? '' : tg('graf', 'obra', 'Por obra')}${tg('graf', 'dia', 'Por día')}</div>
        ${G.ceoSinObra ? '' : checkParte((G.pa || []).reduce((a, x) => a + num(x.litros), 0))}
        ${litSin ? `<label class="check-linea"><input type="checkbox" ${c.sinFlota ? 'checked' : ''} onchange="Gestion.ceSet('sinFlota',this.checked)">
          Incluir despachos a receptores sin equipo de flota (${fmtNum(litSin)} L)</label>` : ''}
      </div>
      <div id="ce-graf"></div>
      <div class="barra-acciones"><div class="info" id="ce-info"></div><button class="btn-filtro" onclick="Gestion.consExportar()">Exportar</button></div>
      <div id="ce-tabla"></div>`;
    ceRepintar();
  }

  function ceRepintar() {
    const c = ce();
    const filas = ceFiltrar(ceBase());
    const modo = G.ceoSinObra && /obra/.test(c.agrupar) ? 'eqmes' : c.agrupar;
    const tabla = ceFiltroDesvio(ceAgrupar(filas, modo));
    // el gráfico usa las filas de los equipos que quedan en la tabla (el filtro de desvío también vale)
    const eqVis = new Set(tabla.map(g => g.eq)), okVis = new Set(tabla.map(g => g.ok));
    const filasG = c.desvio ? filas.filter(x => modo === 'obra' ? okVis.has(x._ok) : eqVis.has(x._eq)) : filas;
    const tot = ceAgrupar(filasG, 'eq').reduce((a, g) => ({ l: a.l + g.litros, h: a.h + g.horas, lh: a.lh + (g.lh !== null ? g.litros : 0), hh: a.hh + (g.lh !== null ? g.horas : 0) }), { l: 0, h: 0, lh: 0, hh: 0 });
    const totP = tabla.reduce((a, g) => a + g.parte, 0);
    $('ce-info').textContent = `${tabla.length} filas · ${fmtNum(tot.l)} L${totP ? ` (${fmtNum(totP)} de partes de alquiler)` : ''} · ${fmtNum(tot.h, 1)} h${tot.hh ? ' · ' + fmtNum(tot.lh / tot.hh, 2) + ' L/h' : ''}`;
    if (c.graf === 'dia') return ceDia();
    $('ce-graf').innerHTML = filasG.length ? ceGrafico(filasG) : '';
    if (!tabla.length) return $('ce-tabla').innerHTML = '<div class="empty-state">No hay despachos con esos filtros.</div>';
    ceTabla(tabla, modo);
  }

  // ── gráficos de Consumo por equipo ──
  function ceColoresObra(filas) {
    const por = {};
    filas.forEach(x => por[x._ok] = (por[x._ok] || 0) + litrosDe(x));
    const col = {}, nom = {};
    Object.entries(por).sort((a, b) => b[1] - a[1]).forEach(([k], i) => col[k] = i < OB_COLORES.length ? OB_COLORES[i] : null);
    filas.forEach(x => nom[x._ok] = x._onom || 'Sin obra');
    return { col, nom, orden: Object.entries(por).sort((a, b) => b[1] - a[1]).map(e => e[0]) };
  }
  const leyRayado = '<span><svg width="11" height="11" style="vertical-align:-1px;margin-right:5px">' + '${DEFS}' + '</svg>Rayado: gasoil del parte (alquiler sin despacho en el mes)</span>';
  const ceLeyenda = (co, usadas, conParte) => G.ceoSinObra ? '' : `<div class="ob-ley">${co.orden.filter(k => co.col[k] && usadas.has(k)).map(k =>
    `<span><i style="background:${co.col[k]}"></i>${esc(co.nom[k])}</span>`).join('')}${co.orden.some(k => !co.col[k] && usadas.has(k)) ? `<span><i style="background:${OB_OTRAS}"></i>Otras</span>` : ''}${conParte
    ? leyRayado.replace('${DEFS}', defsRayado() + `<rect width="11" height="11" rx="2" fill="${rayado('#2c4a8a')}"/>`) : ''}</div>`;
  const ceLeyendaLh = '<div class="ob-ley"><span><i style="background:var(--rojo)"></i>Sobre el máximo</span><span><i style="background:var(--verde)"></i>Entre meta y máximo</span>' +
    '<span><i style="background:var(--azul-medio)"></i>Bajo la meta</span><span><i style="background:#aab3c2"></i>Sin meta en la ficha</span><span><i style="background:#1a2744;height:3px"></i>Máximo</span></div>';
  const colorLh = (lh, meta, max) => { const k = claseLh(lh, meta, max); return k === 'rojo' ? '#c0392b' : k === 'verde' ? '#2e9e6a' : k === 'azul' ? '#2c4a8a' : '#aab3c2'; };
  const segsObra = (porObra, co, porParte = {}) => {
    const segs = []; let otras = 0, otrasP = 0;
    co.orden.forEach(k => { const v = porObra[k] || 0; if (!v) return; const vp = porParte[k] || 0;
      if (co.col[k]) { if (v - vp) segs.push({ nom: co.nom[k], v: v - vp, c: co.col[k] }); if (vp) segs.push({ nom: co.nom[k] + ' · del parte (alquiler)', v: vp, c: rayado(co.col[k]) }); }
      else { otras += v - vp; otrasP += vp; } });
    if (otras) segs.push({ nom: 'Otras', v: otras, c: OB_OTRAS });
    if (otrasP) segs.push({ nom: 'Otras · del parte (alquiler)', v: otrasP, c: rayado(OB_OTRAS) });
    return segs;
  };

  function ceGrafico(filas) {
    const c = ce(), co = ceColoresObra(filas);
    const graf = G.ceoSinObra && c.graf === 'obra' ? 'eq' : c.graf;
    const unEq = new Set(filas.map(x => x._eq));
    const solo = unEq.size === 1 ? ceAgrupar(filas, 'eq')[0] : null;
    const titEq = solo ? ` · <b>${esc(ceEqNombre(solo))}</b> ${esc(solo.tipo)}` : '';
    if (graf === 'mes') {
      const meses = obMeses(), g = ceAgrupar(filas, 'mes'), porMes = {};
      g.forEach(x => porMes[x.mes] = x);
      if (c.met === 'litros') {
        const usadas = new Set(filas.filter(x => litrosDe(x)).map(x => x._ok));
        return ceBarrasV(meses.map(m => ({ et: mesCorto(m), segs: porMes[m] ? segsObra(porMes[m].porObra, co, porMes[m].porObraParte) : [], txt: porMes[m] ? fmtCorto(porMes[m].litros) : '' })),
          `Litros por mes${titEq}${G.ceoSinObra ? '' : ', por obra'}`, {}) + ceLeyenda(co, usadas, g.some(x => x.parte)) + '</div>';
      }
      const meta = solo ? solo.meta : null, max = solo ? solo.max : null;
      return ceBarrasV(meses.map(m => { const x = porMes[m]; const lh = x ? x.lh : null;
        return { et: mesCorto(m), segs: lh === null ? [] : [{ nom: `${fmtNum(x.litros)} L / ${fmtNum(x.horas, 1)} h`, v: lh, c: solo ? colorLh(lh, meta, max) : '#2c4a8a' }],
          txt: lh === null ? (x && x.litros ? 'sin h' : '') : fmtNum(lh, 1) }; }),
        `L/h por mes${titEq}${solo ? '' : ' (todos los equipos filtrados juntos: elegí un equipo para compararlo con su meta)'}`,
        { lineas: solo ? [[meta, 'meta', '#2e9e6a'], [max, 'máx.', '#c0392b']] : [] }) + (solo ? ceLeyendaLh : '') + '</div>';
    }
    if (graf === 'obra') {
      const g = ceAgrupar(filas, 'obra').filter(x => c.met === 'litros' ? x.litros : x.lh !== null).sort((a, b) => c.met === 'litros' ? b.litros - a.litros : b.lh - a.lh).slice(0, 30);
      return ceBarrasH(g.map(x => ({ et: (x.ocod ? x.ocod + ' ' : '') + (x.onom || 'Sin obra'), k: x.ok, clic: 'obra',
          segs: c.met === 'litros' ? [{ nom: x.onom, v: x.litros - x.parte, c: co.col[x.ok] || OB_OTRAS }].concat(x.parte ? [{ nom: x.onom + ' · del parte (alquiler)', v: x.parte, c: rayado(co.col[x.ok] || OB_OTRAS) }] : [])
            : [{ nom: x.onom, v: x.lh, c: co.col[x.ok] || OB_OTRAS }],
          txt: c.met === 'litros' ? fmtCorto(x.litros) : fmtNum(x.lh, 1) + ' L/h' })),
        `${c.met === 'litros' ? 'Litros' : 'L/h'} por obra${titEq} · clic en una barra para filtrar esa obra`) + '</div>';
    }
    // por equipo
    let g = ceAgrupar(filas, 'eq');
    if (c.met === 'litros') {
      g = g.filter(x => x.litros).sort((a, b) => b.litros - a.litros).slice(0, 25);
      const usadas = new Set(filas.filter(x => litrosDe(x) && g.some(e => e.eq === x._eq)).map(x => x._ok));
      return ceBarrasH(g.map(x => ({ et: ceEqNombre(x) + (x.tipo ? ' · ' + x.tipo : ''), k: x.eq, clic: 'eq', segs: segsObra(x.porObra, co, x.porObraParte), txt: fmtCorto(x.litros) })),
        `Litros por equipo${unEq.size > 25 ? ' (los 25 de más litros)' : ''}${G.ceoSinObra ? '' : ', por obra'} · clic en una barra para ver ese equipo`) + ceLeyenda(co, usadas, g.some(x => x.parte)) + '</div>';
    }
    g = g.filter(x => x.lh !== null).sort((a, b) => (b.desvio ?? -999) - (a.desvio ?? -999) || b.lh - a.lh).slice(0, 25);
    return ceBarrasH(g.map(x => ({ et: ceEqNombre(x) + (x.tipo ? ' · ' + x.tipo : ''), k: x.eq, clic: 'eq', marca: x.max,
        segs: [{ nom: `${fmtNum(x.litros)} L / ${fmtNum(x.horas, 1)} h${x.ref ? ' · ref. ' + fmtNum(x.ref, 2) : ''}`, v: x.lh, c: colorLh(x.lh, x.meta, x.max) }],
        txt: fmtNum(x.lh, 1) + (x.desvio !== null ? ` (${x.desvio > 0 ? '+' : ''}${x.desvio} %)` : '') })),
      `L/h por equipo · ordenado por desvío contra la referencia${unEq.size > 25 ? ' (25 primeros)' : ''} · clic en una barra para ver ese equipo`) + ceLeyendaLh + '</div>';
  }

  // ── Detalle diario de un equipo (v20261111g) ──
  // Horas de cada parte y cargas de combustible de cada día, con el acumulado
  // de litros contra las horas × meta / máximo de la ficha (el L/h de un día
  // suelto no dice nada: se carga el tanque un día y se gasta en varios).
  async function ceDia() {
    const eqSel = $('ce-eq') ? MS.valores('ce-eq') : [];
    const eq = eqSel.length === 1 && !eqSel[0].startsWith('~') ? eqSel[0] : null;
    if (!eq) {
      $('ce-info').textContent = '';
      $('ce-graf').innerHTML = '<div class="aviso-caja">Elegí <b>un equipo</b> en el filtro Equipo (o tocá su barra o su fila) para ver sus horas y sus cargas de combustible día por día.</div>';
      $('ce-tabla').innerHTML = '';
      return;
    }
    const clave = eq + '|' + G.desde + '|' + G.hasta;
    if (!G.ceDia || G.ceDia.clave !== clave) {
      $('ce-graf').innerHTML = '<div class="empty-state">Cargando partes del equipo…</div>'; $('ce-tabla').innerHTML = '';
      const partes = [];
      for (let i = 0; i < 10; i++) {
        const r = await sb.from('partes').select('id,fecha,obra_clave,operador_cedula,horometro_inicial,horometro_final,horas_horometro,horas_horometro_reportada,km_inicial,km_final,km_recorridos')
          .eq('equipo_id', eq).gte('fecha', G.desde).lte('fecha', G.hasta).order('fecha').order('id').range(i * 1000, i * 1000 + 999);
        if (r.error) { $('ce-graf').innerHTML = `<div class="aviso-caja rojo">No se pudieron leer los partes: ${esc(r.error.message)}</div>`; return; }
        partes.push(...(r.data || []));
        if (!r.data || r.data.length < 1000) break;
      }
      G.ceDia = { clave, partes };
    }
    if (G.ce.graf !== 'dia' || !$('ce-graf')) return;   // cambió de vista mientras cargaba
    const c = ce(), info = (G.ceo || []).find(x => x.equipo_id === eq) || {}, f = flota.find(x => x.id === eq) || {};
    const meta = info.meta_lh ?? null, max = info.max_lh ?? null, ref = info.referencia_lh ?? null;
    const okObra = (oc) => !$('ce-obra') || MS.ok('ce-obra', ceObra({ obra_clave: oc }).k);
    const desp = (G.movs || []).filter(x => x.actividad === 'Despacho de combustible' && x.equipo_id === eq && (!x.insumo || x.insumo === 'gasoil') && okObra(x.obra_clave));
    const partes = G.ceDia.partes.filter(p => okObra(p.obra_clave));
    const dias = new Map();
    const dia = (fch) => { let d = dias.get(fch); if (!d) dias.set(fch, d = { fecha: fch, horas: 0, km: 0, partes: [], cargas: [], litros: 0, parte: 0, obras: new Set() }); return d; };
    partes.forEach(p => { const d = dia(String(p.fecha).slice(0, 10)); d.partes.push(p); d.horas += num(p.horas_horometro ?? p.horas_horometro_reportada); d.km += num(p.km_recorridos);
      if (p.obra_clave) d.obras.add(obraDe(p).nom); });
    desp.forEach(x => { const d = dia(String(x.fecha).slice(0, 10)); d.cargas.push(x); d.litros += num(x.litros); if (x.obra_clave) d.obras.add(obraDe(x).nom); });
    if (usaParte()) (G.pa || []).filter(x => x.equipo_id === eq && okObra(x.obra_clave)).forEach(x => { const d = dia(String(x.fecha).slice(0, 10)); d.parte += num(x.litros); });
    // todos los días del período (máx. 370), con o sin movimiento, para que el gráfico muestre los huecos
    const todos = [];
    for (let t = new Date(G.desde + 'T12:00:00Z'); t <= new Date(G.hasta + 'T12:00:00Z') && todos.length < 370; t.setUTCDate(t.getUTCDate() + 1)) todos.push(dia(t.toISOString().slice(0, 10)));
    let aL = 0, aH = 0;
    todos.forEach(d => { aL += d.litros + d.parte; aH += d.horas; d.aL = aL; d.aH = aH; });
    const totParte = todos.reduce((a, d) => a + d.parte, 0);
    // el gráfico va del primer al último día con parte o carga (sin los meses vacíos de las puntas)
    const hay = (d) => d.horas || d.litros || d.parte || d.partes.length;
    const i0 = todos.findIndex(hay), i1 = todos.length - 1 - [...todos].reverse().findIndex(hay);
    const tramo = i0 < 0 ? todos : todos.slice(i0, i1 + 1);
    const conMov = todos.filter(d => d.horas || d.litros || d.parte || d.partes.length);
    const lhAcum = aH > 0 ? aL / aH : null;
    $('ce-info').textContent = `${eq} · ${conMov.length} días con parte o carga · ${desp.length} cargas · ${fmtNum(aL)} L${totParte ? ` (${fmtNum(totParte)} L del parte, alquiler sin despacho en el mes)` : ''} · ${fmtNum(aH, 1)} h${lhAcum !== null ? ' · ' + fmtNum(lhAcum, 2) + ' L/h en el período' : ''}`;
    const tit = `<b>${esc(eq)}</b> ${esc(info.tipo || f.tipo || '')}${meta !== null ? ` · meta ${fmtNum(meta, 1)} L/h · máx. ${fmtNum(max, 1)} L/h` : ref ? ` · referencia ${fmtNum(ref, 1)} L/h` : ''}`;
    $('ce-graf').innerHTML = ceGrafDia(tramo, tit) + ceGrafAcum(tramo, meta ?? ref, max);
    // tabla: un renglón por día con movimiento
    const nombre = (ced) => ((cat.ops || []).find(o => o.cedula === ced) || {}).nombre || ced || '';
    const filas = conMov.slice().reverse();
    G.ceDiaFilas = { eq, filas, nombre };
    if (!filas.length) return $('ce-tabla').innerHTML = '<div class="empty-state">Sin partes ni cargas de este equipo en el período.</div>';
    $('ce-tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla ce-tab ce-dia"><thead><tr><th>Fecha</th><th>Obra</th><th>Operador</th><th>Horómetro</th><th>Horas</th><th>Km</th>
      <th>Cargas</th><th>Litros</th>${totParte ? '<th>Del parte</th>' : ''}<th>Horóm. / km en la carga</th><th>Boleta</th><th>Litros acum.</th><th>Horas acum.</th><th>L/h acum.</th></tr></thead><tbody>
      ${filas.map(d => {
        const p0 = d.partes[0], pN = d.partes[d.partes.length - 1];
        const horo = p0 && p0.horometro_inicial !== null && p0.horometro_inicial !== undefined ? `${fmtNum(p0.horometro_inicial, 2)} → ${fmtNum(pN.horometro_final, 2)}` : '';
        const unaCarga = d.cargas.length === 1 ? d.cargas[0].id : '';
        return `<tr class="${d.litros || d.parte ? 'con-carga' : ''}" ${unaCarga ? `onclick="Gestion.abrirMov('${unaCarga}')" title="Ver la carga"` : ''}>
          <td>${esc(fmtFecha(d.fecha))}</td><td class="larga">${esc([...d.obras].join(' / '))}</td>
          <td class="larga">${esc([...new Set(d.partes.map(p => nombre(p.operador_cedula)))].filter(Boolean).join(', '))}</td>
          <td>${horo}</td><td>${d.partes.length ? fmtNum(d.horas, 2) : '<small>sin parte</small>'}</td><td>${d.km ? fmtNum(d.km) : ''}</td>
          <td>${d.cargas.length ? d.cargas.map(x => `<a href="#" onclick="event.stopPropagation();Gestion.abrirMov('${x.id}');return false">${x.hora ? String(x.hora).slice(0, 5) : 'ver'}</a>`).join(' ') : ''}</td>
          <td>${d.litros ? `<b>${fmtNum(d.litros, 1)}</b>` : ''}</td>${totParte ? `<td>${d.parte ? `<span class="chip gris">${fmtNum(d.parte, 1)}</span>` : ''}</td>` : ''}
          <td>${d.cargas.map(x => fmtNum(x.horometro ?? x.odometro, 1)).filter(Boolean).join(' / ')}</td>
          <td>${esc(d.cargas.map(x => x.nro_boleta).filter(Boolean).join(', '))}</td>
          <td>${fmtNum(d.aL)}</td><td>${fmtNum(d.aH, 1)}</td><td>${d.aH > 0 ? fmtNum(d.aL / d.aH, 2) : ''}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td><td></td><td></td><td></td><td><b>${fmtNum(aH, 1)}</b></td><td>${(() => { const k = todos.reduce((a, d) => a + d.km, 0); return k ? fmtNum(k) : ''; })()}</td>
        <td>${desp.length}</td><td><b>${fmtNum(aL - totParte)}</b></td>${totParte ? `<td>${fmtNum(totParte)}</td>` : ''}<td></td><td></td><td></td><td></td><td>${lhAcum !== null ? '<b>' + fmtNum(lhAcum, 2) + '</b>' : ''}</td></tr></tfoot></table></div>`;
  }

  // barras por día: litros cargados (eje izquierdo) y horas de parte (eje derecho)
  function ceGrafDia(dias, tit) {
    const n = dias.length, paso = Math.max(9, Math.min(34, Math.floor((anchoGraf() - 110) / Math.max(1, n))));
    const L = 54, R = 46, T = 24, B = 40, W = Math.max(anchoGraf(), L + R + paso * n), H = 290;
    const maxL = nTope(Math.max(1, ...dias.map(d => d.litros + d.parte)) * 1.1), maxH = nTope(Math.max(1, ...dias.map(d => d.horas)) * 1.1);
    const yL = (v) => T + (H - T - B) * (1 - v / maxL), yH = (v) => T + (H - T - B) * (1 - v / maxH);
    const bw = Math.max(3, paso * 0.4);
    let svg = '';
    for (let k = 0; k <= 4; k++) { const vl = maxL * k / 4, vh = maxH * k / 4;
      svg += `<line x1="${L}" x2="${W - R}" y1="${yL(vl)}" y2="${yL(vl)}" stroke="#e6eaf0"/>
        <text x="${L - 6}" y="${yL(vl) + 4}" text-anchor="end" font-size="11" fill="#2c4a8a">${fmtCorto(vl)}</text>
        <text x="${W - R + 6}" y="${yH(vh) + 4}" font-size="11" fill="#c86a2a">${fmtNum(vh, vh < 10 ? 1 : 0)}</text>`; }
    const cadaEt = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 46)));
    dias.forEach((d, i) => {
      const x = L + paso * i;
      const finde = [0, 6].includes(new Date(d.fecha + 'T12:00:00Z').getUTCDay());
      if (finde) svg += `<rect x="${x}" y="${T}" width="${paso}" height="${H - T - B}" fill="#f6f7fa"/>`;
      if (d.litros) svg += `<rect x="${x + paso / 2 - bw}" y="${yL(d.litros)}" width="${bw}" height="${yL(0) - yL(d.litros)}" fill="#2c4a8a"><title>${esc(fmtFecha(d.fecha))}: ${fmtNum(d.litros, 1)} L en ${d.cargas.length} carga(s)</title></rect>`;
      if (d.parte) svg += `<rect x="${x + paso / 2 - bw}" y="${yL(d.litros + d.parte)}" width="${bw}" height="${yL(d.litros) - yL(d.litros + d.parte)}" fill="${rayado('#2c4a8a')}"><title>${esc(fmtFecha(d.fecha))}: ${fmtNum(d.parte, 1)} L declarados en el parte (alquiler, sin despacho en el mes)</title></rect>`;
      if (d.horas) svg += `<rect x="${x + paso / 2}" y="${yH(d.horas)}" width="${bw}" height="${yH(0) - yH(d.horas)}" fill="#e07b39"><title>${esc(fmtFecha(d.fecha))}: ${fmtNum(d.horas, 2)} h de parte</title></rect>`;
      else if (d.partes.length) svg += `<circle cx="${x + paso / 2 + bw / 2}" cy="${yH(0) - 3}" r="2.5" fill="#e07b39"><title>${esc(fmtFecha(d.fecha))}: parte con 0 h</title></circle>`;
      if (i % cadaEt === 0) svg += `<text x="${x + paso / 2}" y="${H - B + 15}" text-anchor="middle" font-size="10.5" fill="#1a2744">${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}</text>`;
    });
    svg += `<line x1="${L}" x2="${W - R}" y1="${yL(0)}" y2="${yL(0)}" stroke="#9aa4b4"/>`;
    return `<div class="ob-graf"><div class="ob-tit">Por día · ${tit}</div>${svgAbre(W, H, 'Litros y horas por día')}${svg}</svg>
      <div class="ob-ley"><span><i style="background:#2c4a8a"></i>Litros cargados (eje izq.)</span>${dias.some(d => d.parte) ? `<span><svg width="11" height="11" style="vertical-align:-1px;margin-right:5px">${defsRayado()}<rect width="11" height="11" rx="2" fill="${rayado('#2c4a8a')}"/></svg>Gasoil del parte (alquiler sin despacho en el mes)</span>` : ''}<span><i style="background:#e07b39"></i>Horas de parte (eje der.)</span>
      <span><i style="background:#f6f7fa;border:1px solid #dde"></i>Sábado y domingo</span></div></div>`;
  }

  // acumulado: litros cargados contra horas × meta y horas × máximo
  function ceGrafAcum(dias, meta, max) {
    const L = 60, R = 90, T = 18, B = 30, W = anchoGraf(), H = 230, n = dias.length;
    const fin = dias[n - 1] || { aL: 0, aH: 0 };
    const esper = meta ? fin.aH * meta : 0, tope = max ? fin.aH * max : 0;
    const mx = nTope(Math.max(1, fin.aL, esper, tope) * 1.08);
    const x = (i) => L + (W - L - R) * (n <= 1 ? 0 : i / (n - 1)), y = (v) => T + (H - T - B) * (1 - v / mx);
    const linea = (f, col, dash, t) => `<polyline fill="none" stroke="${col}" stroke-width="2.2" ${dash ? 'stroke-dasharray="6 4"' : ''} points="${dias.map((d, i) => `${x(i).toFixed(1)},${y(f(d)).toFixed(1)}`).join(' ')}"/>
      <text x="${W - R + 6}" y="${y(f(fin)) + 4}" font-size="11" font-weight="700" fill="${col}">${esc(t)}</text>`;
    let svg = '';
    for (let k = 0; k <= 4; k++) { const v = mx * k / 4; svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e6eaf0"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b7586">${fmtCorto(v)}</text>`; }
    const cadaEt = Math.ceil(n / Math.max(1, Math.floor((W - L - R) / 60)));
    dias.forEach((d, i) => { if (i % cadaEt === 0) svg += `<text x="${x(i)}" y="${H - B + 15}" text-anchor="middle" font-size="10.5" fill="#1a2744">${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}</text>`; });
    if (max) svg += linea(d => d.aH * max, '#c0392b', true, 'h × máx.');
    if (meta) svg += linea(d => d.aH * meta, '#2e9e6a', true, 'h × meta');
    svg += linea(d => d.aL, '#2c4a8a', false, fmtCorto(fin.aL) + ' L');
    const dif = meta && fin.aH ? fin.aL - esper : null;
    return `<div class="ob-graf"><div class="ob-tit">Acumulado del período: litros cargados contra lo que debió gastar con sus horas
      ${dif !== null ? `<span class="chip ${max && fin.aL > tope ? 'rojo' : dif > 0 ? 'amarillo' : 'verde'}">${dif > 0 ? '+' : ''}${fmtNum(dif)} L contra la meta</span>` : '<small>(sin meta ni referencia en la ficha)</small>'}</div>
      ${svgAbre(W, H, 'Acumulado')}${svg}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#9aa4b4"/></svg>
      <div class="ob-ley"><span><i style="background:#2c4a8a"></i>Litros cargados</span>${meta ? '<span><i style="background:#2e9e6a"></i>Horas × meta</span>' : ''}${max ? '<span><i style="background:#c0392b"></i>Horas × máximo</span>' : ''}</div></div>`;
  }

  // barras verticales apiladas; devuelve el bloque abierto (quien llama agrega la leyenda y cierra el div)
  function ceBarrasV(cols, titulo, o) {
    const W = anchoGraf(), H = 300, L = 60, R = 40, T = 22, B = 32;
    const lineas = (o.lineas || []).filter(l => l[0] !== null && l[0] !== undefined);
    const max = nTope(Math.max(0, ...cols.map(p => p.segs.reduce((a, s) => a + s.v, 0)), ...lineas.map(l => num(l[0]))) * 1.1);
    const ancho = (W - L - R) / Math.max(1, cols.length), bw = Math.min(64, ancho * 0.62);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let svg = '';
    for (let k = 0; k <= 5; k++) { const v = max * k / 5;
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e6eaf0"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b7586">${fmtCorto(v)}</text>`; }
    cols.forEach((p, i) => {
      const x = L + ancho * i + (ancho - bw) / 2; let base = 0;
      p.segs.forEach(s => { const y1 = y(base + s.v);
        svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y(base) - y1)}" fill="${s.c}"><title>${esc(s.nom)} · ${esc(p.et)}: ${esc(fmtNum(s.v, 2))}</title></rect>`; base += s.v; });
      if (p.txt) svg += `<text x="${x + bw / 2}" y="${y(base) - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#1a2744">${esc(p.txt)}</text>`;
      svg += `<text x="${x + bw / 2}" y="${H - B + 17}" text-anchor="middle" font-size="12" fill="#1a2744">${esc(p.et)}</text>`;
    });
    lineas.forEach(([v, t, col]) => svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="5 4" stroke-width="1.5"/>
      <text x="${W - R + 3}" y="${y(v) + 4}" font-size="10.5" fill="${col}">${esc(t)}</text>`);
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#9aa4b4"/>`;
    return `<div class="ob-graf"><div class="ob-tit">${titulo}</div>${svgAbre(W, H)}${svg}</svg>`;
  }
  // barras horizontales apiladas, una por fila; clic = filtrar ese equipo u obra
  function ceBarrasH(filas, titulo) {
    const W = anchoGraf(), fila = 24, T = 6, L = Math.min(290, Math.round(W * 0.36)), R = 120, H = T + Math.max(1, filas.length) * fila + 6;
    const max = nTope(Math.max(0, ...filas.map(f => Math.max(f.segs.reduce((a, s) => a + s.v, 0), num(f.marca)))));
    const ancho = (v) => (W - L - R) * v / max;
    let svg = '';
    filas.forEach((f, i) => {
      const yy = T + i * fila, et = f.et.length > 42 ? f.et.slice(0, 41) + '…' : f.et;
      let x = L;
      svg += `<g style="cursor:pointer" data-k="${esc(f.k)}" data-c="${f.clic}" onclick="Gestion.ceClic(this.getAttribute('data-c'),this.getAttribute('data-k'))">
        <rect x="0" y="${yy}" width="${W}" height="${fila}" fill="transparent"/>
        <text x="${L - 8}" y="${yy + 16}" text-anchor="end" font-size="12" fill="#1a2744">${esc(et)}</text>`;
      f.segs.forEach(s => { const w = Math.max(0.5, ancho(s.v));
        svg += `<rect x="${x}" y="${yy + 4}" width="${w}" height="${fila - 8}" fill="${s.c}"><title>${esc(f.et)} · ${esc(s.nom)}: ${esc(fmtNum(s.v, 2))}</title></rect>`; x += w; });
      if (f.marca) svg += `<line x1="${L + ancho(f.marca)}" x2="${L + ancho(f.marca)}" y1="${yy + 1}" y2="${yy + fila - 1}" stroke="#1a2744" stroke-width="2" opacity=".8"><title>Máximo de la ficha: ${esc(fmtNum(f.marca, 2))}</title></line>`;
      svg += `<text x="${x + 6 + (f.marca && Math.abs(L + ancho(f.marca) - x) < 4 ? 4 : 0)}" y="${yy + 16}" font-size="11.5" font-weight="700" fill="#1a2744" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(f.txt)}</text></g>`;
    });
    return `<div class="ob-graf"><div class="ob-tit">${titulo}</div>${filas.length ? `${svgAbre(W, H)}${svg}</svg>`
      : '<div class="empty-state">Nada para graficar con esos filtros.</div>'}`;
  }

  // ── tabla de Consumo por equipo ──
  function ceCols(modo) {
    const mes = modo === 'eqmes' || modo === 'eqobrames', obra = /obra/.test(modo), eq = modo !== 'obra';
    return [mes && ['mes', 'Mes'], eq && ['equipo', 'Equipo'], eq && ['tipo', 'Tipo'], obra && ['obra', 'Obra'], !G.ceoSinObra && ['despachos', 'Desp.'],
      ['litros', 'Litros'], ceHayParte() && ['parte', 'Del parte'], ['horas', 'Horas'], ['lh', 'L/h'], eq && ['ref', 'Ref. L/h'], eq && ['desvio', 'Desvío'], eq && ['meta', 'Meta L/h'], eq && ['max', 'Máx. L/h'],
      ['km', 'Km'], ['l100', 'L/100 km']].filter(Boolean);
  }
  const ceHayParte = () => usaParte() && (G.ceo || []).some(x => num(x.litros_parte));
  const ceValor = (g, k) => k === 'equipo' ? ceEqNombre(g) : k === 'obra' ? ((g.ocod ? g.ocod + ' ' : '') + (g.onom || 'Sin obra')) : g[k];
  function ceTabla(l, modo) {
    const c = ce(), o = c.orden, cols = ceCols(modo);
    const ord = [...l].sort((a, b) => {
      const x = ceValor(a, o.col), y = ceValor(b, o.col);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const r = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return o.asc ? r : -r;
    });
    const celda = (g, k) => {
      const v = g[k];
      if (k === 'mes') return esc(mesCorto(v));
      if (k === 'equipo') return `<b>${esc(ceEqNombre(g))}</b>${g.flota && flota.some(f => f.id === g.equipo_id)
        ? ` <a href="#" title="Ficha del equipo" onclick="event.stopPropagation();abrirFicha('${esc(g.equipo_id)}','ficha');return false">↗</a>` : ''}`;
      if (k === 'tipo') return esc(g.tipo || '');
      if (k === 'obra') return `${esc(g.onom || 'Sin obra')}${g.ocod ? `<br><small>${esc(g.ocod)}</small>` : ''}`;
      if (k === 'despachos') return v ? fmtNum(v) : '';
      if (k === 'parte') return v ? `<span class="chip gris" title="Gasoil declarado en el parte (alquiler, sin despacho en el mes)">${fmtNum(v)}</span>` : '';
      if (k === 'litros') return v ? `<b>${fmtNum(v)}</b>` : (g.horas ? '<small>sin despacho</small>' : '');
      if (k === 'horas') return v ? fmtNum(v, 2) : (g.litros ? '<small>sin horas</small>' : '');
      if (k === 'lh') return g.max !== null && g.max !== undefined && v !== null && v > g.max ? `<span class="chip rojo">${fmtNum(v, 2)}</span>` : fmtNum(v, 2);
      if (k === 'desvio') { if (v === null) return ''; const cl = Math.abs(v) > 30 ? 'rojo' : Math.abs(v) > 15 ? 'amarillo' : 'verde'; return `<span class="chip ${cl}">${v > 0 ? '+' : ''}${v} %</span>`; }
      if (k === 'km') return v ? fmtNum(v) : '';
      if (k === 'l100') return fmtNum(v, 1);
      return fmtNum(v, 2);
    };
    const th = (k, t) => `<th class="${o.col === k ? 'activo' : ''}" onclick="Gestion.ceOrdenar('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
    const T = l.reduce((a, g) => ({ l: a.l + g.litros, p: a.p + g.parte, h: a.h + g.horas, km: a.km + g.km, d: a.d + g.despachos }), { l: 0, p: 0, h: 0, km: 0, d: 0 });
    const pie = cols.map(([k], i) => `<td>${i === 0 ? '<b>Total</b>' : k === 'litros' ? `<b>${fmtNum(T.l)}</b>` : k === 'horas' ? fmtNum(T.h, 1) : k === 'despachos' ? fmtNum(T.d) : k === 'parte' ? (T.p ? fmtNum(T.p) : '')
      : k === 'km' ? (T.km ? fmtNum(T.km) : '') : ''}</td>`).join('');
    $('ce-tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla ce-tab"><thead><tr>${cols.map(([k, t]) => th(k, t)).join('')}</tr></thead>
      <tbody>${ord.slice(0, 3000).map(g => `<tr data-k="${esc(modo === 'obra' ? g.ok : g.eq)}" data-c="${modo === 'obra' ? 'obra' : 'eq'}" title="Clic: ver solo esta ${modo === 'obra' ? 'obra' : 'máquina'}"
        onclick="Gestion.ceClic(this.getAttribute('data-c'),this.getAttribute('data-k'))">${cols.map(([k]) => `<td>${celda(g, k)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr>${pie}</tr></tfoot></table></div>${ord.length > 3000 ? `<div class="info">Se muestran 3.000 de ${ord.length} filas; Exportar baja todas.</div>` : ''}`;
  }

  function ceRepintarFiltros() { const eq = $('ce-eq') ? MS.valores('ce-eq') : []; ce().eqPrevio = eq; pintarCons(); }
  function ceSet(campo, v) {
    const c = ce();
    c[campo] = v;
    if (campo === 'agrupar') c.orden = { col: 'litros', asc: false };
    if (campo === 'obraPor' || campo === 'sinFlota') {   // cambian las opciones de los filtros
      const ob = $('ce-obra'); if (ob && campo === 'obraPor') MS.poner(ob, []);
      return ceRepintarFiltros();
    }
    pintarCons();
  }
  function ceOrdenar(col) { const o = ce().orden; ce().orden = { col, asc: o.col === col ? !o.asc : ['mes', 'equipo', 'tipo', 'obra'].includes(col) }; ceRepintar(); }
  function ceClic(cual, k) {
    const sel = $(cual === 'obra' ? 'ce-obra' : 'ce-eq');
    if (!sel) return;
    const ya = MS.valores(sel);
    MS.poner(sel, ya.length === 1 && ya[0] === k ? [] : [k]);
    if (cual === 'eq' && ce().graf === 'eq' && !(ya.length === 1 && ya[0] === k)) ce().graf = 'mes';
    pintarCons();
  }
  function consExportar() {
    if (ce().graf === 'dia') {
      const x = G.ceDiaFilas;
      if (!x || !$('ce-tabla') || !$('ce-tabla').querySelector('.ce-dia')) return toast('Elegí un equipo para exportar su detalle diario', 'error');
      const n = (v, d = 2) => v === null || v === undefined || v === '' ? '' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
      return bajarCSV(`consumo_diario_${x.eq}_${G.desde}_a_${G.hasta}`, ['Fecha', 'Obra', 'Operador', 'Horómetro inicial', 'Horómetro final', 'Horas', 'Km', 'Cargas', 'Litros', 'Del parte (alquiler)',
        'Horóm./km en la carga', 'Boletas', 'Litros acumulados', 'Horas acumuladas', 'L/h acumulado'],
        x.filas.slice().reverse().map(d => { const p0 = d.partes[0], pN = d.partes[d.partes.length - 1];
          return [d.fecha, [...d.obras].join(' / '), [...new Set(d.partes.map(p => x.nombre(p.operador_cedula)))].join(', '), n(p0 && p0.horometro_inicial), n(pN && pN.horometro_final),
            d.partes.length ? n(d.horas) : '', d.km ? n(d.km, 0) : '', d.cargas.length || '', d.litros ? n(d.litros, 1) : '', d.parte ? n(d.parte, 1) : '',
            d.cargas.map(c => n(c.horometro ?? c.odometro, 1)).filter(Boolean).join(' / '), d.cargas.map(c => c.nro_boleta).filter(Boolean).join(', '),
            n(d.aL, 1), n(d.aH, 1), d.aH > 0 ? n(d.aL / d.aH) : '']; }));
    }
    const c = ce(), modo = G.ceoSinObra && /obra/.test(c.agrupar) ? 'eqmes' : c.agrupar;
    const l = ceFiltroDesvio(ceAgrupar(ceFiltrar(ceBase()), modo)).sort((a, b) => b.litros - a.litros);
    const cols = ceCols(modo).flatMap(([k, t]) => k === 'obra' ? [['ocod', 'Código obra'], ['onom', 'Obra']] : [[k, t]]);
    const n = (v, d = 2) => v === null || v === undefined || v === '' ? '' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
    bajarCSV(`consumo_por_equipo_${G.desde}_a_${G.hasta}`, cols.map(x => x[1]),
      l.map(g => cols.map(([k]) => k === 'mes' ? g.mes : k === 'equipo' ? ceEqNombre(g) : ['tipo', 'ocod', 'onom'].includes(k) ? (g[k] || '') : n(g[k]))));
  }

  // ── Consumo por obra y mes (v20261111e) ──
  // Litros de los despachos de combustible del período, por la obra (centro de
  // costo) que se cargó en el despacho. Tabla obra × mes y gráfico de barras:
  // por mes (apilado por obra) o total por obra. Clic en una fila = el gráfico
  // por mes muestra solo esa obra.
  // v20261111g: los gráficos se dibujan al ancho real de la pantalla, sin escalar
  const anchoGraf = () => { const c = $('g-cuerpo'); return Math.max(340, Math.min(1700, ((c && c.clientWidth) || 920) - 26)); };
  const svgAbre = (W, H, rot) => `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"${rot ? ` aria-label="${esc(rot)}"` : ''}>${defsRayado()}`;
  // ── Gasoil de partes en alquileres sin despacho (v20261111h, SQL 108) ──
  // Regla: parte de una obra 305AM (alquiler), con gasoil en litros, y el equipo
  // sin ningún despacho en todo ese mes → cuenta el gasoil del parte (lo cargó
  // el cliente), con la fecha de cada parte. Las obras propias no entran. Se
  // dibuja rayado y se puede apagar.
  const usaParte = () => { if (G.usarParte === undefined) { const v = leerLocal('gasoil_parte_alq'); G.usarParte = v === null || v === undefined ? true : !!v; } return G.usarParte && !G.paFalta; };
  function gParte(v) { G.usarParte = !!v; guardarLocal('gasoil_parte_alq', G.usarParte); if (G.vista === 'obras') pintarObras(); else pintarCons(); }
  const checkParte = (litros) => G.paFalta ? '' : `<label class="check-linea" title="Alquileres (305AM) en los que el combustible lo carga el cliente: se toma lo que declara el parte en los meses en que la máquina no tuvo ningún despacho. Obras propias no.">
    <input type="checkbox" ${usaParte() ? 'checked' : ''} onchange="Gestion.gParte(this.checked)"> Sumar gasoil de partes en alquileres sin despacho en el mes${litros ? ` (${fmtNum(litros)} L)` : ''}</label>`;
  const rayadoId = (c) => 'ry-' + String(c).replace(/[^a-z0-9]/gi, '');
  const defsRayado = () => `<defs>${[...OB_COLORES, OB_OTRAS, '#2c4a8a'].map(c => `<pattern id="${rayadoId(c)}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="${c}" opacity=".28"/><rect width="3" height="6" fill="${c}"/></pattern>`).join('')}</defs>`;
  const rayado = (c) => `url(#${rayadoId(c)})`;
  const OB_COLORES = ['#2c4a8a', '#e07b39', '#2e9e6a', '#c0392b', '#8e5bb5', '#d4a017', '#1f9bb5', '#b5527f', '#5d7a3a'];
  const OB_OTRAS = '#aab3c2';
  const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mesCorto = (m) => MESES_C[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
  const OB_GRUPOS = [['', 'Todas'], ['obra', 'Obras'], ['alq', 'Alquileres (305AM)'], ['gg', 'Gastos generales / taller']];
  const grupoObra = (cod) => /^305AM/i.test(cod) ? 'alq' : /^305/.test(cod) ? 'gg' : 'obra';
  function obraDe(x) {
    const c = String(x.obra_clave || '').trim();
    if (!c) return { clave: '—' + (x.obra_texto || ''), cod: '', nom: 'Sin obra' + (x.obra_texto ? ` (${x.obra_texto})` : '') };
    const i = c.indexOf('_');
    return { clave: c, cod: i > 0 ? c.slice(0, i) : '', nom: (i > 0 ? c.slice(i + 1) : c).trim() };
  }
  function obMeses() {
    const out = [];
    for (let m = G.desde.slice(0, 7); m <= G.hasta.slice(0, 7) && out.length < 60; ) {
      out.push(m);
      let y = +m.slice(0, 4), n = +m.slice(5, 7) + 1;
      if (n > 12) { n = 1; y++; }
      m = y + '-' + String(n).padStart(2, '0');
    }
    return out;
  }
  function obAgrupar() {
    const por = new Map();
    const filas = (G.ob || []).concat(usaParte() ? (G.pa || []).map(x => Object.assign({ _parte: true }, x)) : []);
    filas.forEach(x => {
      const o = obraDe(x), l = num(x.litros);
      if (!l) return;
      let g = por.get(o.clave);
      if (!g) por.set(o.clave, g = Object.assign(o, { grupo: o.cod ? grupoObra(o.cod) : 'obra', meses: {}, mesesParte: {}, total: 0, parte: 0, n: 0 }));
      const m = String(x.fecha).slice(0, 7);
      g.meses[m] = (g.meses[m] || 0) + l;
      g.total += l; g.n++;
      if (x._parte) { g.parte += l; g.mesesParte[m] = (g.mesesParte[m] || 0) + l; }
    });
    return [...por.values()];
  }
  function obFiltradas() {
    const gr = G.obGrupo || '';
    return obAgrupar().filter(g => (!gr || g.grupo === gr) && (!$('ob-obra') || MS.ok('ob-obra', g.clave)));
  }
  function obColores(filas) {
    // mismo color para la misma obra mientras no cambien los filtros: las 9 de más litros, el resto «Otras»
    const top = [...filas].sort((a, b) => b.total - a.total);
    const col = {};
    top.forEach((g, i) => col[g.clave] = i < OB_COLORES.length ? OB_COLORES[i] : null);
    return col;
  }
  const nTope = (v) => { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * e).find(k => k >= v); };
  const fmtCorto = (v) => v >= 1e6 ? fmtNum(v / 1e6, 1) + ' M' : v >= 1e4 ? fmtNum(v / 1e3, 0) + ' mil' : fmtNum(v);

  function obGraficoMes(filas, meses, col) {
    const sel = G.obSel && filas.find(g => g.clave === G.obSel);
    const usar = sel ? [sel] : [...filas].sort((a, b) => b.total - a.total);
    const pilas = meses.map(m => {
      const segs = [];
      let otras = 0;
      let otrasP = 0;
      usar.forEach(g => { const v = g.meses[m] || 0; if (!v) return; const vp = g.mesesParte[m] || 0;
        if (sel || col[g.clave]) { const c = sel ? (col[g.clave] || OB_COLORES[0]) : col[g.clave];
          if (v - vp) segs.push({ nom: g.nom, v: v - vp, c }); if (vp) segs.push({ nom: g.nom + ' · del parte (alquiler)', v: vp, c: rayado(c) }); }
        else { otras += v - vp; otrasP += vp; } });
      if (otras) segs.push({ nom: 'Otras', v: otras, c: OB_OTRAS });
      if (otrasP) segs.push({ nom: 'Otras · del parte (alquiler)', v: otrasP, c: rayado(OB_OTRAS) });
      return { m, segs, tot: segs.reduce((a, s) => a + s.v, 0) };
    });
    const W = anchoGraf(), H = 320, L = 64, R = 12, T = 22, B = 34;
    const max = nTope(Math.max(0, ...pilas.map(p => p.tot)) * 1.08);
    const ancho = (W - L - R) / Math.max(1, meses.length), bw = Math.min(70, ancho * 0.62);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let svg = '';
    for (let k = 0; k <= 5; k++) {
      const v = max * k / 5, yy = y(v);
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e6eaf0"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7586">${fmtCorto(v)}</text>`;
    }
    pilas.forEach((p, i) => {
      const x = L + ancho * i + (ancho - bw) / 2;
      let base = 0;
      p.segs.forEach(s => {
        const y1 = y(base + s.v), h = y(base) - y1;
        svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, h)}" fill="${s.c}"><title>${esc(s.nom)} · ${esc(mesCorto(p.m))}: ${fmtNum(s.v)} L</title></rect>`;
        base += s.v;
      });
      if (p.tot) svg += `<text x="${x + bw / 2}" y="${y(p.tot) - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#1a2744">${fmtCorto(p.tot)}</text>`;
      svg += `<text x="${x + bw / 2}" y="${H - B + 17}" text-anchor="middle" font-size="12" fill="#1a2744">${esc(mesCorto(p.m))}</text>`;
    });
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#9aa4b4"/>`;
    const ley = sel ? [{ nom: sel.nom, c: col[sel.clave] || OB_COLORES[0] }]
      : usar.filter(g => col[g.clave]).map(g => ({ nom: g.nom, c: col[g.clave] })).concat(usar.some(g => !col[g.clave]) ? [{ nom: 'Otras', c: OB_OTRAS }] : []);
    if (usar.some(g => g.parte)) ley.push({ nom: 'Rayado: gasoil del parte (alquiler sin despacho en el mes)', c: rayado('#2c4a8a'), svg: true });
    return `<div class="ob-graf"><div class="ob-tit">${sel ? `Litros por mes · <b>${esc(sel.nom)}</b> <button class="btn-filtro" onclick="Gestion.obSel('')">Ver todas</button>` : 'Litros por mes, por obra'}</div>
      ${svgAbre(W, H, 'Litros por mes')}${svg}</svg>
      <div class="ob-ley">${ley.map(l => l.svg ? `<span><svg width="11" height="11" style="vertical-align:-1px;margin-right:5px">${defsRayado()}<rect width="11" height="11" rx="2" fill="${l.c}"/></svg>${esc(l.nom)}</span>`
        : `<span><i style="background:${l.c}"></i>${esc(l.nom)}</span>`).join('')}</div></div>`;
  }

  function obGraficoObra(filas, col) {
    const l = [...filas].sort((a, b) => b.total - a.total).slice(0, 30);
    const W = anchoGraf(), fila = 26, T = 8, L = Math.min(300, Math.round(W * 0.38)), R = 70, H = T + l.length * fila + 8;
    const max = nTope(Math.max(0, ...l.map(g => g.total)));
    let svg = '';
    l.forEach((g, i) => {
      const yy = T + i * fila, w = (W - L - R) * g.total / max;
      const nom = g.nom.length > 44 ? g.nom.slice(0, 43) + '…' : g.nom;
      svg += `<g style="cursor:pointer" data-k="${esc(g.clave)}" onclick="Gestion.obSel(this.getAttribute('data-k'))">
        <text x="${L - 8}" y="${yy + 17}" text-anchor="end" font-size="12" fill="#1a2744">${esc(nom)}</text>
        <rect x="${L}" y="${yy + 4}" width="${Math.max(1, w)}" height="${fila - 8}" rx="3" fill="${col[g.clave] || OB_OTRAS}"><title>${esc(g.nom)}: ${fmtNum(g.total)} L</title></rect>
        ${g.parte ? `<rect x="${L + w * (1 - g.parte / g.total)}" y="${yy + 4}" width="${Math.max(1, w * g.parte / g.total)}" height="${fila - 8}" fill="${rayado(col[g.clave] || OB_OTRAS)}"><title>${esc(g.nom)} · del parte (alquiler sin despacho en el mes): ${fmtNum(g.parte)} L</title></rect>` : ''}
        <text x="${L + w + 6}" y="${yy + 17}" font-size="11.5" font-weight="700" fill="#1a2744">${fmtCorto(g.total)}</text></g>`;
    });
    return `<div class="ob-graf"><div class="ob-tit">Total del período por obra${filas.length > 30 ? ' (las 30 de más litros)' : ''} · clic en una barra para ver sus meses</div>
      ${svgAbre(W, H, 'Litros por obra')}${svg}</svg></div>`;
  }

  function pintarObras() {
    const previo = $('ob-obra') ? MS.valores('ob-obra') : [];
    const todas = obAgrupar().sort((a, b) => a.nom.localeCompare(b.nom));
    $('g-cuerpo').innerHTML = `
      <div class="aviso-caja">Litros de gasoil <b>despachados</b> (actividad «Despacho de combustible») por la obra que se cargó en cada despacho, mes a mes.
        No suma traspasos entre tanques ni ingresos. En alquileres (305AM) donde el combustible lo carga el cliente se puede sumar lo que declara el parte (rayado). Usá «6 meses» arriba para ver el semestre; los meses de las puntas pueden estar incompletos.</div>
      <div class="filtros">
        <div class="filtro siempre"><label>Tipo</label><select id="ob-grupo" onchange="Gestion.obGrupo(this.value)">
          ${OB_GRUPOS.map(([k, t]) => `<option value="${k}" ${(G.obGrupo || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro crece"><label>Obra</label><select id="ob-obra" class="ms" onchange="Gestion.obRepintar()"><option value="" ${previo.length ? '' : 'selected'}>Todas</option>
          ${todas.map(g => `<option value="${esc(g.clave)}" ${previo.includes(g.clave) ? 'selected' : ''}>${esc(g.nom)}${g.cod ? ' · ' + esc(g.cod) : ''}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Gráfico</label><div class="vista-toggle">
          <button class="${(G.obGraf || 'mes') === 'mes' ? 'on' : ''}" onclick="Gestion.obGraf('mes')">Por mes</button>
          <button class="${G.obGraf === 'obra' ? 'on' : ''}" onclick="Gestion.obGraf('obra')">Por obra</button></div></div>
      </div>
      <div class="ce-opciones">${checkParte((G.pa || []).reduce((a, x) => a + num(x.litros), 0))}</div>
      ${G.paFalta ? '<div class="aviso-caja">Para sumar el gasoil que declaran los partes en alquileres sin despacho falta correr en Supabase el <b>SQL 108</b>.</div>' : ''}
      <div id="ob-graf"></div>
      <div class="barra-acciones"><div class="info" id="ob-info"></div><button class="btn-filtro" onclick="Gestion.obExportar()">Exportar</button></div>
      <div id="ob-tabla"></div>`;
    obRepintar();
  }

  function obRepintar() {
    const filas = obFiltradas(), meses = obMeses(), col = obColores(filas);
    if (G.obSel && !filas.some(g => g.clave === G.obSel)) G.obSel = null;
    const tot = filas.reduce((a, g) => a + g.total, 0);
    const totP = filas.reduce((a, g) => a + (g.parte || 0), 0);
    $('ob-info').textContent = `${filas.length} obras · ${fmtNum(tot)} L${totP ? ` (${fmtNum(totP)} L de partes de alquiler)` : ' despachados'} · ${meses.length} meses`;
    if (!filas.length) { $('ob-graf').innerHTML = ''; $('ob-tabla').innerHTML = '<div class="empty-state">No hay despachos en ese período.</div>'; return; }
    $('ob-graf').innerHTML = G.obGraf === 'obra' ? obGraficoObra(filas, col) : obGraficoMes(filas, meses, col);
    const o = G.obOrden || { col: 'total', asc: false };
    const val = (g) => o.col === 'nom' ? g.nom : o.col === 'total' ? g.total : o.col === 'parte' ? g.parte : (g.meses[o.col] || 0);
    const l = [...filas].sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return o.asc ? c : -c; });
    const th = (k, t) => `<th class="${o.col === k ? 'activo' : ''}" onclick="Gestion.obOrdenar('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
    const totMes = (m) => filas.reduce((a, g) => a + (g.meses[m] || 0), 0);
    $('ob-tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla ob-tab"><thead><tr>${th('nom', 'Obra')}${meses.map(m => th(m, mesCorto(m))).join('')}${th('total', 'Total L')}${totP ? th('parte', 'Del parte') : ''}<th>%</th></tr></thead>
      <tbody>${l.map(g => `<tr class="${G.obSel === g.clave ? 'sel' : ''}" data-k="${esc(g.clave)}" onclick="Gestion.obSel(this.getAttribute('data-k'))">
        <td class="larga"><i class="ob-pt" style="background:${col[g.clave] || OB_OTRAS}"></i><b>${esc(g.nom)}</b>${g.cod ? `<br><small>${esc(g.cod)}</small>` : ''}</td>
        ${meses.map(m => `<td>${g.meses[m] ? fmtNum(g.meses[m]) : ''}</td>`).join('')}
        <td><b>${fmtNum(g.total)}</b></td>${totP ? `<td>${g.parte ? fmtNum(g.parte) : ''}</td>` : ''}<td>${tot ? fmtNum(g.total * 100 / tot, 1) + ' %' : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td>${meses.map(m => `<td><b>${fmtNum(totMes(m))}</b></td>`).join('')}<td><b>${fmtNum(tot)}</b></td>${totP ? `<td>${fmtNum(totP)}</td>` : ''}<td>100 %</td></tr></tfoot></table></div>`;
  }
  function obOrdenar(c) { const o = G.obOrden || { col: 'total', asc: false }; G.obOrden = { col: c, asc: o.col === c ? !o.asc : c === 'nom' }; obRepintar(); }
  function obSelFn(k) { G.obSel = !k || G.obSel === k ? null : k; if (G.obSel) G.obGraf = 'mes'; pintarObrasGraf(); }
  function pintarObrasGraf() {
    // el botón de gráfico cambia de estado: se rearma la barra de filtros sin perder lo elegido
    const tg = $('g-cuerpo').querySelectorAll('.vista-toggle button');
    if (tg.length === 2) { tg[0].classList.toggle('on', (G.obGraf || 'mes') === 'mes'); tg[1].classList.toggle('on', G.obGraf === 'obra'); }
    obRepintar();
  }
  function obGrafFn(v) { G.obGraf = v; if (v === 'obra') G.obSel = null; pintarObrasGraf(); }
  function obGrupoFn(v) { G.obGrupo = v; G.obSel = null; obRepintar(); }
  function obExportar() {
    const meses = obMeses(), filas = obFiltradas().sort((a, b) => b.total - a.total);
    const n = (v) => String(Math.round((v || 0) * 10) / 10).replace('.', ',');
    bajarCSV(`consumo_por_obra_${G.desde}_a_${G.hasta}`, ['Código', 'Obra', ...meses, 'Total L', 'De partes (alquiler sin despacho en el mes)'],
      filas.map(g => [g.cod, g.nom, ...meses.map(m => g.meses[m] ? n(g.meses[m]) : ''), n(g.total), g.parte ? n(g.parte) : ''])
        .concat([['', 'Total', ...meses.map(m => n(filas.reduce((a, g) => a + (g.meses[m] || 0), 0))), n(filas.reduce((a, g) => a + g.total, 0)), n(filas.reduce((a, g) => a + (g.parte || 0), 0))]]));
  }

  // ── Rendimiento semanal y ranking de sobreconsumo (v20261028f, SQL 69) ──
  // L/h = litros despachados ÷ horas de horómetro de los partes de la semana.
  // Meta y máximo: los de la ficha técnica (Flota › Consumo y valores); si no
  // hay meta se usa el consumo promedio y el máximo = meta × 1,2.
  const semLunes = (f) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const claseLh = (lh, meta, max) => lh === null || lh === undefined || meta === null || meta === undefined ? '' : lh > max ? 'rojo' : lh < meta ? 'azul' : 'verde';
  const variacionPct = (v) => v === null || v === undefined ? '' : (v > 0 ? '+' : '') + fmtNum(v * 100, 0) + ' %';

  function porEquipoSemanal() {
    const por = new Map();
    (G.sem || []).forEach(x => {
      let g = por.get(x.equipo_id);
      if (!g) por.set(x.equipo_id, g = { equipo_id: x.equipo_id, tipo: x.tipo || x.descripcion || '', meta: x.meta_lh, max: x.max_lh, ref: x.referencia,
        litros: 0, horas: 0, sinHoras: 0, semanas: {}, sobre: 0, bajo: 0, nSem: 0 });
      g.semanas[String(x.semana).slice(0, 10)] = x;
      g.litros += num(x.litros);
      if (num(x.horas) > 0) { g.horas += num(x.horas); g.nSem++; if (num(x.variacion) > 0) g.sobre++; if (num(x.variacion) < 0) g.bajo++; }
      else g.sinHoras += num(x.litros);
    });
    return [...por.values()].map(g => {
      const lhLit = g.litros - g.sinHoras;   // litros de las semanas con horas
      const lh = g.horas > 0 ? lhLit / g.horas : null;
      const v = lh === null || g.meta === null ? null : lh > g.max ? (lh - g.max) / g.max : lh < g.meta ? -(g.meta - lh) / g.meta : 0;
      return Object.assign(g, { lh, variacion: v, exceso: lh !== null && g.max !== null ? Math.max(0, lhLit - g.max * g.horas) : null,
        excesoMeta: lh !== null && g.meta !== null ? Math.max(0, lhLit - g.meta * g.horas) : null });
    });
  }

  function pintarSemanal() {
    if (G.semError) return $('g-cuerpo').innerHTML = `<div class="aviso-caja">${esc(G.semError)}</div>`;
    const sems = [];
    for (let f = semLunes(G.desde); f <= G.hasta && sems.length < 30; ) { sems.push(f); const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); f = d.toISOString().slice(0, 10); }
    const q = (G.semQ || '').toLowerCase();
    const l = porEquipoSemanal().filter(g => (!G.semSolo || g.sobre > 0) && (!q || [g.equipo_id, g.tipo].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.sobre - a.sobre || (b.variacion ?? -9) - (a.variacion ?? -9));
    $('g-cuerpo').innerHTML = `
      <div class="aviso-caja">Litros de gasoil despachados a cada equipo por semana (lunes a domingo) contra las horas de horómetro de sus partes.
        <b style="color:var(--rojo)">Rojo</b>: sobre el máximo · <b style="color:var(--verde)">verde</b>: entre la meta y el máximo · <b style="color:var(--azul-medio)">azul</b>: bajo la meta.
        Meta y máximo se cargan en Flota › ficha › Consumo y valores.</div>
      <div class="barra-acciones"><div class="info">${l.length} equipos · ${sems.length} semanas</div>
        <input type="text" placeholder="Buscar equipo…" value="${esc(G.semQ || '')}" oninput="Gestion.semBuscar(this.value)" style="padding:7px 10px;border:1.5px solid var(--gris-borde);border-radius:8px">
        <label class="check-linea"><input type="checkbox" ${G.semSolo ? 'checked' : ''} onchange="Gestion.semSolo(this.checked)"> Solo con sobreconsumo</label>
        <button class="btn-filtro" onclick="Gestion.semExportar()">Exportar</button></div>
      ${!l.length ? '<div class="empty-state">No hay despachos a equipos con horómetro en el período.</div>' : `
      <div class="tabla-wrap"><table class="tabla g-sem"><thead><tr><th>Equipo</th><th>Meta</th><th>Máx.</th>
        ${sems.map(f => `<th>${f.slice(8, 10)}/${f.slice(5, 7)}</th>`).join('')}<th>Período</th><th>Sem. sobre máx.</th></tr></thead>
      <tbody>${l.map(g => `<tr onclick="${flota.some(f => f.id === g.equipo_id) ? `abrirFicha('${esc(g.equipo_id)}','ficha')` : ''}">
        <td><b>${esc(g.equipo_id)}</b><br><small>${esc(g.tipo)}</small></td>
        <td>${fmtNum(g.meta, 1)}${g.ref === 'promedio' ? '<small title="Sin meta cargada: se usa el consumo promedio"> ≈</small>' : ''}</td><td>${fmtNum(g.max, 1)}</td>
        ${sems.map(f => { const x = g.semanas[f]; if (!x) return '<td></td>';
          return num(x.horas) > 0 ? `<td class="lh ${claseLh(num(x.litros_hora), x.meta_lh, x.max_lh)}" title="${fmtNum(x.litros)} L / ${fmtNum(x.horas, 1)} h">${fmtNum(x.litros_hora, 1)}</td>`
            : `<td title="${fmtNum(x.litros)} L sin horas de parte en la semana"><small>${fmtNum(x.litros)} L</small></td>`; }).join('')}
        <td class="lh ${claseLh(g.lh, g.meta, g.max)}"><b>${fmtNum(g.lh, 1)}</b></td><td>${g.sobre ? `<span class="chip rojo">${g.sobre} de ${g.nSem}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`}`;
  }
  function semBuscar(v) { G.semQ = v; const pos = v.length; pintarSemanal(); const i = $('g-cuerpo').querySelector('input[type=text]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  function semSolo(v) { G.semSolo = v; pintarSemanal(); }
  function semExportar() {
    bajarCSV('rendimiento_semanal', ['Semana', 'Equipo', 'Tipo', 'Litros', 'Horas', 'L/h', 'Meta L/h', 'Máx. L/h', 'Referencia', 'Variación %', 'Litros sobre el máximo'],
      (G.sem || []).map(x => [String(x.semana).slice(0, 10), x.equipo_id, x.tipo, x.litros, x.horas, x.litros_hora, x.meta_lh, x.max_lh, x.referencia,
        x.variacion === null ? '' : Math.round(x.variacion * 1000) / 10, x.litros_sobre_max].map(v => String(v ?? '').replace('.', ','))));
  }

  function pintarRanking() {
    if (G.semError) return $('g-cuerpo').innerHTML = `<div class="aviso-caja">${esc(G.semError)}</div>`;
    const l = porEquipoSemanal().filter(g => g.lh !== null);
    const sobre = l.filter(g => g.variacion > 0).sort((a, b) => (b.exceso || 0) - (a.exceso || 0) || b.variacion - a.variacion);
    const resto = l.filter(g => !(g.variacion > 0)).sort((a, b) => (b.variacion ?? -9) - (a.variacion ?? -9));
    const sinMeta = l.filter(g => g.meta === null).length;
    const totExceso = sobre.reduce((a, g) => a + (g.exceso || 0), 0);
    const fila = (g, i) => `<tr onclick="${flota.some(f => f.id === g.equipo_id) ? `abrirFicha('${esc(g.equipo_id)}','ficha')` : ''}">
      <td>${i + 1}</td><td><b>${esc(g.equipo_id)}</b><br><small>${esc(g.tipo)}</small></td><td>${fmtNum(g.litros)}</td><td>${fmtNum(g.horas, 1)}</td>
      <td class="lh ${claseLh(g.lh, g.meta, g.max)}"><b>${fmtNum(g.lh, 2)}</b></td><td>${fmtNum(g.meta, 2)}${g.ref === 'promedio' ? ' ≈' : ''}</td><td>${fmtNum(g.max, 2)}</td>
      <td>${g.variacion === null ? '' : `<span class="chip ${g.variacion > 0 ? 'rojo' : g.variacion < 0 ? 'azul' : 'verde'}">${variacionPct(g.variacion)}</span>`}</td>
      <td>${g.exceso ? `<b>${fmtNum(g.exceso)}</b>` : ''}</td><td>${g.excesoMeta ? fmtNum(g.excesoMeta) : ''}</td><td>${g.sobre ? `${g.sobre} de ${g.nSem}` : ''}</td></tr>`;
    const cab = '<thead><tr><th>#</th><th>Equipo</th><th>Litros</th><th>Horas</th><th>L/h</th><th>Meta</th><th>Máx.</th><th>Variación</th><th>Litros sobre el máximo</th><th>Litros sobre la meta</th><th>Semanas sobre máx.</th></tr></thead>';
    $('g-cuerpo').innerHTML = `
      <div class="tarjetas">${[[sobre.length, 'Equipos con sobreconsumo', sobre.length ? 'malo' : 'bien'], [fmtNum(totExceso), 'Litros sobre el máximo', totExceso ? 'malo' : ''],
        [l.length, 'Equipos con despachos y horas', ''], [sinMeta, 'Sin meta ni promedio', sinMeta ? 'medio' : '']].map(([n, t, c]) =>
        `<div class="tarjeta ${c}"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('')}</div>
      <div class="aviso-caja">Ranking del período: L/h = litros ÷ horas de horómetro (solo semanas con horas de parte). Variación como en Power BI: sobre el máximo
        (L/h − máx.) ÷ máx.; bajo la meta −(meta − L/h) ÷ meta; entre los dos, 0. «≈» = sin meta cargada, se usa el consumo promedio.</div>
      <div class="barra-acciones"><div class="info">Ordenado por litros consumidos sobre el máximo</div><button class="btn-filtro" onclick="Gestion.rankExportar()">Exportar</button></div>
      ${!sobre.length ? '<div class="empty-state">Ningún equipo pasó su consumo máximo en el período. 👍</div>'
        : `<div class="tabla-wrap"><table class="tabla g-sem">${cab}<tbody>${sobre.map(fila).join('')}</tbody></table></div>`}
      ${resto.length ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Dentro del rango o bajo la meta (${resto.length})</summary>
        <div class="tabla-wrap" style="margin-top:8px"><table class="tabla g-sem">${cab}<tbody>${resto.map(fila).join('')}</tbody></table></div></details>` : ''}`;
  }
  function rankExportar() {
    bajarCSV('ranking_sobreconsumo', ['Equipo', 'Tipo', 'Litros', 'Horas', 'L/h', 'Meta L/h', 'Máx. L/h', 'Referencia', 'Variación %', 'Litros sobre el máximo',
      'Litros sobre la meta', 'Semanas sobre el máximo', 'Semanas con horas'],
      porEquipoSemanal().sort((a, b) => (b.exceso || 0) - (a.exceso || 0)).map(g => [g.equipo_id, g.tipo, Math.round(g.litros), g.horas, g.lh === null ? '' : Math.round(g.lh * 100) / 100,
        g.meta, g.max, g.ref, g.variacion === null ? '' : Math.round(g.variacion * 1000) / 10, g.exceso === null ? '' : Math.round(g.exceso),
        g.excesoMeta === null ? '' : Math.round(g.excesoMeta), g.sobre, g.nSem].map(v => String(v ?? '').replace('.', ','))));
  }

  // ── Anomalías ──
  function pintarAnom() {
    const l = G.anom || [];
    const tipos = {};
    l.forEach(a => tipos[a.anomalia] = (tipos[a.anomalia] || 0) + 1);
    $('g-cuerpo').innerHTML = !l.length ? '<div class="empty-state">Ninguna anomalía en el período. 👍</div>' : `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${Object.entries(tipos).map(([t, n]) => `<span class="chip amarillo">${esc(t)}: ${n}</span>`).join('')}</div>
      <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Fecha</th><th>Equipo</th><th>Boleta</th><th>Anomalía</th><th>Detalle</th></tr></thead>
      <tbody>${l.map(a => `<tr onclick="Gestion.abrirMov('${a.id}')"><td>${fmtFecha(a.fecha)}</td><td><b>${esc(a.equipo_id || '')}</b></td>
        <td>${esc(a.nro_boleta || '')}</td><td><span class="chip rojo">${esc(a.anomalia)}</span></td><td>${esc(a.detalle)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ════════════════════════════════════════════════════════════════
  function mostrar(n) {
    inyectarEstilos();
    if (n === 'ot') { pintarOT(); if (!ots) { const c = leerLocal('ot_cache'); if (c) { ots = c; pintarOTLista(); } } cargarOTs(); }
    if (n === 'gasoil') pintarGasoil();
  }

  function inyectarEstilos() {
    if ($('g-estilos')) return;
    const s = document.createElement('style');
    s.id = 'g-estilos';
    s.textContent = `
      .g-sub { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .g-sub button { padding: 8px 14px; border: 1.5px solid var(--gris-borde); background: var(--blanco); border-radius: 20px;
        font-size: calc(13px*var(--fs,1)); font-weight: 600; color: var(--gris-texto); }
      .g-sub button.on { background: var(--azul-medio); color: #fff; border-color: var(--azul-medio); }
      .g-sub.chico button { padding: 6px 11px; font-size: calc(12px*var(--fs,1)); }
      .eq.g-ot.Solicitada { border-left-color: var(--amarillo-alerta); }
      .eq.g-ot.Abierta { border-left-color: var(--azul-medio); }
      .eq.g-ot.Cerrada { border-left-color: var(--verde); }
      .modal-card.ancho { max-width: 860px; }
      .g-texto { font-size: calc(13px*var(--fs,1)); margin: 8px 0 0; }
      .g-texto summary { cursor: pointer; }
      .g-reg .card-body { padding: 11px 13px; }
      .g-mini { width: 100%; border-collapse: collapse; font-size: calc(12px*var(--fs,1)); margin-top: 8px; }
      .g-mini th { text-align: left; background: #eef2f9; padding: 5px 7px; font-size: calc(11px*var(--fs,1)); }
      .g-mini td { padding: 5px 7px; border-bottom: 1px solid #eef1f5; }
      .g-fotos { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .g-fotos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid var(--gris-borde); background: #eef2f9; cursor: zoom-in; }
      .g-barra { height: 9px; border-radius: 5px; background: #e9edf3; overflow: hidden; margin: 8px 0 4px; }
      .g-barra i { display: block; height: 100%; }
      .g-barra i.verde { background: var(--verde); } .g-barra i.amarillo { background: var(--amarillo-alerta); }
      .g-barra i.rojo { background: var(--rojo); } .g-barra i.gris { background: #aab3c2; }
      .g-sem td, .g-sem th { text-align: center; } .g-sem td:nth-child(-n+2), .g-sem th:nth-child(-n+2) { text-align: left; }
      .g-sem small { color: var(--gris-texto); font-size: calc(10.5px*var(--fs,1)); }
      .g-sem td.lh.rojo { background: #fde8e6; color: var(--rojo); font-weight: 700; } .g-sem td.lh.verde { background: #e3f4e9; }
      .g-sem td.lh.azul { background: #e0e7ff; }
      .h-dia-wrap { max-height: 70vh; }
      .ob-graf { background: var(--blanco); border-radius: 10px; box-shadow: var(--sombra); padding: 10px 12px; margin-bottom: 12px; }
      .ob-graf { overflow-x: auto; } .ob-graf svg { display: block; max-width: none; }
      .ob-tit { font-weight: 700; font-size: calc(13px*var(--fs,1)); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ob-ley { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: calc(11.5px*var(--fs,1)); }
      .ob-ley span { display: inline-flex; align-items: center; }
      .ob-ley i, .ob-pt { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
      .ob-tab td, .ob-tab th { text-align: right; white-space: nowrap; } .ob-tab td:first-child, .ob-tab th:first-child { text-align: left; white-space: normal; min-width: 220px; }
      .ob-tab small { color: var(--gris-texto); font-size: calc(10.5px*var(--fs,1)); }
      .ob-tab tr.sel td { background: #eef2ff; }
      .ce-opciones { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 10px; }
      .ce-tab td, .ce-tab th { white-space: nowrap; } .ce-tab td:has(br) { white-space: normal; min-width: 200px; }
      .ce-dia tr.con-carga td { background: #eef3ff; }
      .ce-tab td small { color: var(--gris-texto); font-size: calc(10.5px*var(--fs,1)); }
      .ce-tab tfoot td { border-top: 2px solid var(--azul-oscuro); background: #f4f6fa; }
      .ob-tab tfoot td { border-top: 2px solid var(--azul-oscuro); background: #f4f6fa; }
      .h-dia th, .h-dia td { padding: 4px 5px; text-align: center; font-size: calc(11.5px*var(--fs,1)); min-width: 30px; }
      .h-dia th.fija, .h-dia td.fija { position: sticky; left: 0; background: #fff; text-align: left; min-width: 150px; z-index: 1; }
      .h-dia th.fija { z-index: 2; }
      .h-dia td.fija small { color: var(--gris-texto); font-size: calc(10.5px*var(--fs,1)); }
      .h-dia th.fija { background: var(--azul-oscuro); }
      .h-dia tr td.nolab, .h-leyenda .nolab { background: #eceff3; color: #8a93a3; }
      .h-dia tr td.h-poco, .h-leyenda .h-poco { background: #fff3c4; } .h-dia tr td.h-bien, .h-leyenda .h-bien { background: #c9f0d3; }
      .h-dia tr td.h-mucho, .h-leyenda .h-mucho { background: #fbd0cc; } .h-dia tr td.h-exceso, .h-leyenda .h-exceso { background: #f6c6ef; }
      .h-dia td.aus, .h-leyenda .aus { color: #fff; font-weight: 700; }
      .h-dia tr td.aus.vac, .h-leyenda .aus.vac { background: #6446b8; } .h-dia tr td.aus.rec, .h-leyenda .aus.rec { background: #8b4513; }
      .h-dia tr td.aus.aj, .h-leyenda .aus.aj { background: #0fa5b5; }
      .h-leyenda { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; font-size: calc(11.5px*var(--fs,1)); }
      .h-leyenda span { padding: 3px 8px; border-radius: 10px; border: 1px solid #e3e7ee; }
    `;
    document.head.appendChild(s);
  }

  inyectarEstilos();   // los usan también las pantallas de gestion2.js

  return {
    mostrar, cargarOTs, otFiltrar, otTocarTarjeta, otOrdenar, otFormato: otCambiarFormato, otCambiarVista,
    otExportar, otCompartir, abrirOT, otTomar, otReabrir, otFormEditar, otGuardarEdicion, otFormCerrar, otCerrar, otFormTomar,
    otFormAnular, otAnular, otDeEquipo, horasCambiarMes, horasExportar, horasAgrupar, horasEquipo, horasOrdenar, horasFiltrar,
    horasPeriodo, tarifaEditar, tarifaGuardar, tarifaBorrar, prodGrupo,
    gVista, gPeriodo, gAtajo, gRecargar, movRepintar, movOrdenar, movExportar, abrirMov, guardarMov, eliminarMov,
    regEditar, regGuardar, regEliminar,
    concFiltrar, concExportar, consExportar, gParte, ceRepintar, ceSet, ceOrdenar, ceClic, obRepintar, obOrdenar, obSel: obSelFn, obGraf: obGrafFn, obGrupo: obGrupoFn, obExportar, semBuscar, semSolo, semExportar, rankExportar
  };
})();
