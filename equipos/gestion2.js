// ══════════════════════════════════════════════════════════════════
// GESTIÓN (2) — Mantenimiento, Alquileres, Seguros y Personal
// Tecsul S.A.E.
//
// Viven en flota.html y usan sus utilidades ($, esc, fmtFecha, fmtNum,
// abrirModal, toast, cat, flota, esTaller, campo, inp, sel, txt, val…).
// ══════════════════════════════════════════════════════════════════
window.Gestion2 = (() => {

  const hoy = () => new Date().toISOString().slice(0, 10);
  const mesActual = () => hoy().slice(0, 7);
  const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
  const num = (v) => v === null || v === undefined || v === '' ? 0 : Number(v);
  const gs = (v) => v === null || v === undefined ? '' : 'Gs ' + fmtNum(v);
  const dato = (e, v) => `<div class="dato"><div class="e">${e}</div><div class="v">${v ?? ''}</div></div>`;
  const nombreDe = (ced) => ((cat.ops || []).find(o => o.cedula === ced) || {}).nombre || ced || '';
  const filtroTexto = (q, campos) => !q || q.split(/\s+/).every(p => campos.join(' ').toLowerCase().includes(p));
  const SEM = { VENCIDO: 'rojo', 'PRÓXIMO': 'amarillo', OK: 'verde', 'SIN DATOS': 'gris' };
  const NIVELES = ['250', '500', '750', '1.000', '5.000', '10.000'];

  function bajarCSV(nombre, cols, filas, sep = ';') {
    const csv = [cols.join(sep)].concat(filas.map(f => f.map(v =>
      `"${String(Array.isArray(v) ? v.join(', ') : (v ?? '')).replace(/"/g, '""')}"`).join(sep))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nombre.endsWith('.csv') ? nombre : `${nombre}_${hoy()}.csv`;
    a.click();
  }
  function ordenar(filas, o) {
    return [...filas].sort((a, b) => {
      const x = a[o.col], y = b[o.col];
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
      return o.asc ? r : -r;
    });
  }
  // Tabla genérica con columnas ordenables
  function tabla(cols, filas, o, fnOrden, fnClick, celda) {
    return `<div class="tabla-wrap"><table class="tabla"><thead><tr>${cols.map(([k, t]) =>
      `<th class="${o.col === k ? 'activo' : ''}" onclick="Gestion2.${fnOrden}('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((f, i) => `<tr onclick="Gestion2.${fnClick}(${i})">${cols.map(([k]) => celda(f, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const subTabs = (lista, actual, fn) => `<div class="g-sub">${lista.map(([k, t]) =>
    `<button class="${actual === k ? 'on' : ''}" onclick="Gestion2.${fn}('${k}')">${t}</button>`).join('')}</div>`;
  const tarjetas = (lista, actual, fn) => `<div class="tarjetas">${lista.map(t =>
    `<button class="tarjeta ${t.c || ''} ${actual === t.k ? 'sel' : ''}" onclick="Gestion2.${fn}('${t.k}')"><span class="n">${t.n}</span><span class="t">${t.t}</span></button>`).join('')}</div>`;

  // ════════════════════════════════════════════════════════════════
  // MANTENIMIENTO
  // ════════════════════════════════════════════════════════════════
  const M = { vista: 'planes', planes: null, hechos: null, tarjeta: null, orden: { col: 'orden_sem', asc: true },
              desde: hoy().slice(0, 8) + '01', hasta: hoy(), visibles: [], hechosVis: [] };

  function descPlan(p) {
    const partes = [];
    if (p.cada_horas) partes.push(p.ciclo && p.ciclo.length ? `ciclo ${p.ciclo.join('/')} cada ${fmtNum(p.cada_horas)} h` : `cada ${fmtNum(p.cada_horas)} h`);
    if (p.cada_km) partes.push(`cada ${fmtNum(p.cada_km)} km`);
    if (p.cada_dias) partes.push(`cada ${p.cada_dias} días`);
    return partes.join(' o ');
  }
  function proximo(p) {
    const l = [];
    if (p.proximo_horometro !== null) l.push(`${p.proximo_nivel ? 'Service ' + p.proximo_nivel + ' h · ' : ''}a las ${fmtNum(p.proximo_horometro)} h`);
    if (p.proximo_km !== null) l.push(`a los ${fmtNum(p.proximo_km)} km`);
    if (p.proxima_fecha) l.push(`el ${fmtFecha(p.proxima_fecha)}`);
    return l.join(' · ');
  }
  function falta(p) {
    const l = [];
    if (p.horas_restantes !== null) l.push(p.horas_restantes < 0 ? `pasado ${fmtNum(-p.horas_restantes)} h` : `${fmtNum(p.horas_restantes)} h`);
    if (p.km_restantes !== null) l.push(p.km_restantes < 0 ? `pasado ${fmtNum(-p.km_restantes)} km` : `${fmtNum(p.km_restantes)} km`);
    if (p.dias_restantes !== null) l.push(p.dias_restantes < 0 ? `pasado ${-p.dias_restantes} d` : `${p.dias_restantes} d`);
    return l.join(' · ');
  }
  function sinPlan() {
    const con = new Set((M.planes || []).map(p => p.equipo_id));
    return flota.filter(f => f.activo && f.propiedad !== 'Tercero' && ['equipo', 'vehiculo_liviano'].includes(f.categoria) && !con.has(f.id));
  }

  async function cargarMant() {
    const [p, h] = await Promise.all([
      sb.from('v_mantenimiento_plan').select('*').limit(3000),
      sb.from('mantenimientos').select('*').gte('fecha', M.desde).lte('fecha', M.hasta).order('fecha', { ascending: false }).limit(3000)
    ]);
    if (p.error) return $('mant-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(p.error.message)}</div>`;
    M.planes = (p.data || []).map(x => Object.assign(x, {
      orden_sem: { VENCIDO: 0, 'PRÓXIMO': 1, OK: 2, 'SIN DATOS': 3 }[x.semaforo],
      lectura: x.cada_horas ? x.horometro_actual : x.km_actual,
      restante: x.horas_restantes ?? x.km_restantes ?? x.dias_restantes }));
    M.hechos = h.data || [];
    pintarMantCuerpo();
  }

  function pintarMant() {
    $('screen-mant').innerHTML = subTabs([['planes', 'Próximos services'], ['hechos', 'Services realizados']], M.vista, 'mantVista')
      + '<div id="mant-cuerpo"><div class="empty-state">Cargando…</div></div>';
    if (M.planes) pintarMantCuerpo();
    cargarMant();
  }
  function mantVista(v) { M.vista = v; pintarMant(); }

  const MANT_TJ = [
    { k: 'VENCIDO', t: 'Vencidos', c: 'malo' }, { k: 'PRÓXIMO', t: 'Próximos', c: 'medio' },
    { k: 'OK', t: 'Al día', c: 'bien' }, { k: 'SIN DATOS', t: 'Sin lectura' }, { k: 'SINPLAN', t: 'Equipos sin plan' }];

  function pintarMantCuerpo() {
    if (!$('mant-cuerpo')) return;
    if (M.vista === 'hechos') return pintarHechos();
    const propios = M.planes.filter(p => p.equipo_activo && p.propiedad !== 'Tercero');
    const tj = MANT_TJ.map(t => Object.assign({}, t, { n: t.k === 'SINPLAN' ? sinPlan().length : propios.filter(p => p.semaforo === t.k).length }));
    const prev = { q: ($('mt-buscar') || {}).value || '', c: ($('mt-cat') || {}).value || '' };
    $('mant-cuerpo').innerHTML = tarjetas(tj, M.tarjeta, 'mantTarjeta') + `
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label><input type="text" id="mt-buscar" value="${esc(prev.q)}" placeholder="Equipo, tipo, plan…" oninput="Gestion2.mantRepintar()"></div>
        <div class="filtro siempre"><label>Categoría</label><select id="mt-cat" onchange="Gestion2.mantRepintar()">
          <option value="">Todas</option><option value="equipo" ${prev.c === 'equipo' ? 'selected' : ''}>Máquinas</option>
          <option value="vehiculo_liviano" ${prev.c === 'vehiculo_liviano' ? 'selected' : ''}>Vehículos</option></select></div>
      </div>
      <div class="barra-acciones"><div class="info" id="mt-info"></div>
        <button class="btn-filtro" onclick="Gestion2.mantExportar()">Exportar</button>
        <button class="btn-filtro" onclick="Gestion2.mantCompartir()">Compartir</button></div>
      <div id="mt-lista"></div>`;
    mantRepintar();
  }

  const MANT_COLS = [['equipo_id', 'Equipo'], ['equipo_tipo', 'Tipo'], ['plan', 'Plan'], ['prox', 'Próximo service'],
    ['lectura', 'Lectura actual'], ['restante', 'Falta'], ['ultimo', 'Último service'], ['orden_sem', 'Estado']];

  function mantRepintar() {
    const q = (($('mt-buscar') || {}).value || '').toLowerCase().trim(), c = ($('mt-cat') || {}).value || '';
    if (M.tarjeta === 'SINPLAN') {
      const l = sinPlan().filter(f => (!c || f.categoria === c) && filtroTexto(q, [f.id, f.tipo, f.descripcion]));
      $('mt-info').textContent = `${l.length} equipos propios sin plan de mantenimiento`;
      $('mt-lista').innerHTML = !l.length ? '<div class="empty-state">Todos los equipos tienen plan.</div>' : `
        ${esTaller() ? `<div class="acciones" style="justify-content:flex-start;margin-bottom:10px">
          <button class="btn btn-primario" onclick="Gestion2.crearPlanesFaltantes()">Crear el plan a los ${l.length}</button></div>
          <div class="aviso-caja">Máquinas con horómetro: service cada 250 h con ciclo 250/500/750/1.000. Vehículos: cada 10.000 km. Después se ajusta cada uno.</div>` : ''}
        <ul class="lista-simple card" style="padding:4px 14px">${l.map(f => `<li><div class="pri"><b>${esc(f.id)}</b><span>${esc(f.tipo || f.descripcion || '')}${f.ultimo_horometro ? ' · ' + fmtNum(f.ultimo_horometro) + ' h' : ''}${f.ultimo_km ? ' · ' + fmtNum(f.ultimo_km) + ' km' : ''}</span></div>
          ${esTaller() ? `<button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio)" onclick="Gestion2.nuevoPlan('${esc(f.id)}')">Crear plan</button>` : ''}</li>`).join('')}</ul>`;
      return;
    }
    M.visibles = ordenar(M.planes.filter(p => p.equipo_activo && p.propiedad !== 'Tercero'
      && (!M.tarjeta || p.semaforo === M.tarjeta) && (!c || p.categoria === c)
      && filtroTexto(q, [p.equipo_id, p.equipo_tipo, p.equipo_descripcion, p.nombre, p.proximo_nivel])), M.orden);
    $('mt-info').textContent = `${M.visibles.length} planes`;
    if (!M.visibles.length) return $('mt-lista').innerHTML = '<div class="empty-state">Nada con esos filtros.</div>';
    if (window.innerWidth < 700) {
      $('mt-lista').innerHTML = '<div class="equipos">' + M.visibles.map((p, i) => `
        <button class="eq" onclick="Gestion2.abrirPlan(${i})"><div class="fila1"><div><div class="cod">${esc(p.equipo_id)}</div>
          <div class="tipo">${esc(p.equipo_tipo || p.equipo_descripcion || '')}</div></div><span class="chip ${SEM[p.semaforo]}">${esc(p.semaforo)}</span></div>
          <div class="meta">${esc(proximo(p) || descPlan(p))}</div>
          <div class="chips">${falta(p) ? `<span class="chip ${SEM[p.semaforo]}">${esc(falta(p))}</span>` : ''}
            ${p.ultimo_fecha ? `<span class="chip gris">último ${fmtFecha(p.ultimo_fecha)}${p.ultimo_nivel ? ' · ' + esc(p.ultimo_nivel) : ''}</span>` : ''}</div></button>`).join('') + '</div>';
      return;
    }
    $('mt-lista').innerHTML = tabla(MANT_COLS, M.visibles, M.orden, 'mantOrdenar', 'abrirPlan', (p, k) => {
      if (k === 'equipo_id') return `<td><b>${esc(p.equipo_id)}</b></td>`;
      if (k === 'plan') return `<td>${esc(descPlan(p))}</td>`;
      if (k === 'prox') return `<td>${esc(proximo(p))}</td>`;
      if (k === 'lectura') return `<td>${p.lectura !== null ? fmtNum(p.lectura) + (p.cada_horas ? ' h' : ' km') : ''}</td>`;
      if (k === 'restante') return `<td>${esc(falta(p))}</td>`;
      if (k === 'ultimo') return `<td>${p.ultimo_fecha ? fmtFecha(p.ultimo_fecha) : ''}${p.ultimo_nivel ? ' · ' + esc(p.ultimo_nivel) + ' h' : ''}${p.ultimo_horometro ? ' · ' + fmtNum(p.ultimo_horometro) + ' h' : ''}</td>`;
      if (k === 'orden_sem') return `<td><span class="chip ${SEM[p.semaforo]}">${esc(p.semaforo)}</span></td>`;
      return `<td>${esc(p[k] ?? '')}</td>`;
    });
  }
  function mantTarjeta(k) { M.tarjeta = M.tarjeta === k ? null : k; mantRepintar(); pintarMantCuerpo(); }
  function mantOrdenar(col) { M.orden = { col, asc: M.orden.col === col ? !M.orden.asc : true }; mantRepintar(); }
  function mantExportar() {
    bajarCSV('mantenimiento', ['Equipo', 'Tipo', 'Plan', 'Próximo service', 'Lectura actual', 'Falta', 'Último service', 'Último nivel', 'Estado'],
      M.visibles.map(p => [p.equipo_id, p.equipo_tipo, descPlan(p), proximo(p), p.lectura, falta(p), p.ultimo_fecha, p.ultimo_nivel, p.semaforo]));
  }
  function mantCompartir() {
    const l = M.visibles.filter(p => ['VENCIDO', 'PRÓXIMO'].includes(p.semaforo));
    if (!l.length) return toast('No hay services vencidos ni próximos con esos filtros', 'warning');
    compartir(`*Services – ${new Date().toLocaleDateString('es-PY')}*\n` + l.map(p =>
      `${p.semaforo === 'VENCIDO' ? '⛔' : '⚠️'} ${p.equipo_id} ${p.equipo_tipo ? '(' + p.equipo_tipo + ')' : ''}: ${proximo(p)} – ${falta(p)}`).join('\n'));
  }

  // Detalle de un plan: editar, registrar service, historial
  async function abrirPlan(i) {
    const p = M.visibles[i];
    M.abierto = p;
    const t = esTaller();
    const modo = p.cada_horas ? (p.ciclo && p.ciclo.length ? 'ciclo' : 'horas') : p.cada_km ? 'km' : 'dias';
    abrirModal(`${p.equipo_id} · ${p.nombre}`, '<div class="empty-state">Cargando…</div>');
    const { data: h } = await sb.from('mantenimientos').select('*').eq('equipo_id', p.equipo_id).order('fecha', { ascending: false }).limit(15);
    const tecnicos = (cat.ops || []).filter(o => o.activo && o.especialidad !== 'OPERADOR');
    $('modal-cuerpo').innerHTML = `
      <div class="datos" style="margin-bottom:12px">
        ${dato('Equipo', `<a href="#" onclick="cerrarModal();abrirFicha('${esc(p.equipo_id)}','mantenimiento');return false">${esc(p.equipo_id)}</a> · ${esc(p.equipo_tipo || p.equipo_descripcion || '')}`)}
        ${dato('Plan', esc(descPlan(p)))}
        ${dato('Próximo', esc(proximo(p)))}
        ${dato('Falta', `<span class="chip ${SEM[p.semaforo]}">${esc(falta(p) || p.semaforo)}</span>`)}
        ${dato('Lectura actual', p.horometro_actual !== null ? fmtNum(p.horometro_actual, 1) + ' h' : (p.km_actual !== null ? fmtNum(p.km_actual) + ' km' : ''))}
        ${dato('Último service', p.ultimo_fecha ? fmtFecha(p.ultimo_fecha) + (p.ultimo_nivel ? ' · ' + esc(p.ultimo_nivel) + ' h' : '') : '')}
      </div>
      ${t ? `<div class="card"><div class="card-header">Registrar service hecho</div><div class="card-body"><div class="form-grid">
        ${campo('sv-fecha', 'Fecha', inp('sv-fecha', hoy(), 'date'))}
        ${p.ciclo && p.ciclo.length ? campo('sv-nivel', 'Service', sel('sv-nivel', NIVELES, p.proximo_nivel)) : ''}
        ${p.cada_horas ? campo('sv-horo', 'Horómetro', inp('sv-horo', p.horometro_actual, 'number', 'step="any"')) : ''}
        ${p.cada_km ? campo('sv-km', 'Km', inp('sv-km', p.km_actual, 'number', 'step="any"')) : ''}
        ${campo('sv-tec', 'Técnico', `<select id="sv-tec"><option value="">—</option>${tecnicos.map(o => `<option value="${esc(o.cedula)}">${esc(o.nombre)}</option>`).join('')}</select>`)}
        ${campo('sv-costo', 'Costo (Gs)', inp('sv-costo', '', 'number'))}
        ${campo('sv-desc', 'Qué se hizo', txt('sv-desc', ''), 'ancho')}
      </div><div class="ayuda" style="font-size:12px;color:var(--gris-texto);margin-bottom:8px">Si el service se carga en el reporte de taller (Tipo de mantenimiento), queda registrado solo: no hace falta cargarlo acá.</div>
      <div class="acciones"><button class="btn btn-verde" onclick="Gestion2.registrarService()">Registrar</button></div></div></div>
      <div class="card"><div class="card-header">Cambiar el plan</div><div class="card-body"><div class="form-grid">
        ${campo('pl-modo', 'Por', `<select id="pl-modo" onchange="Gestion2.planModo(this.value)">
          <option value="ciclo" ${modo === 'ciclo' ? 'selected' : ''}>Horas, con ciclo 250/500/750/1.000</option>
          <option value="horas" ${modo === 'horas' ? 'selected' : ''}>Horas, siempre el mismo service</option>
          <option value="km" ${modo === 'km' ? 'selected' : ''}>Kilómetros</option>
          <option value="dias" ${modo === 'dias' ? 'selected' : ''}>Días</option></select>`)}
        ${campo('pl-cada', 'Cada', inp('pl-cada', p.cada_horas ?? p.cada_km ?? p.cada_dias, 'number'))}
        ${campo('pl-dias', 'Y además cada (días, opcional)', inp('pl-dias', p.cada_horas || p.cada_km ? p.cada_dias : '', 'number'))}
        ${campo('pl-aviso', 'Avisar con (h, km o días de anticipación)', inp('pl-aviso', p.cada_horas ? p.aviso_horas : p.cada_km ? p.aviso_km : p.aviso_dias, 'number'))}
        ${campo('pl-nombre', 'Nombre', inp('pl-nombre', p.nombre), 'ancho')}
      </div><div class="acciones">
        <button class="btn btn-rojo" onclick="Gestion2.desactivarPlan()">Quitar plan</button>
        <button class="btn btn-verde" onclick="Gestion2.guardarPlan()">Guardar plan</button></div></div></div>` : ''}
      <div class="card"><div class="card-header">Últimos mantenimientos</div><div class="card-body">${(h || []).length ? `<ul class="lista-simple">${h.map(x => `
        <li><div class="pri"><b>${fmtFecha(x.fecha)} · ${esc(x.tipo)}${x.nivel ? ' ' + esc(x.nivel) + ' h' : ''}</b>
          <span>${esc(x.descripcion)}</span><span>${[x.horometro && fmtNum(x.horometro, 1) + ' h', x.km && fmtNum(x.km) + ' km', x.tecnico_nombre || nombreDe(x.tecnico_cedula)].filter(Boolean).map(esc).join(' · ')}</span></div></li>`).join('')}</ul>`
        : '<div class="empty-state">Sin registros.</div>'}</div></div>`;
  }
  function planModo() { /* el formulario no cambia de forma: se interpreta al guardar */ }
  async function guardarPlan() {
    const p = M.abierto, modo = val('pl-modo'), cada = val('pl-cada');
    if (!cada || cada <= 0) return toast('Poné cada cuánto', 'warning');
    const aviso = val('pl-aviso');
    const d = { nombre: val('pl-nombre') || p.nombre, cada_horas: null, cada_km: null, cada_dias: val('pl-dias'), ciclo: null };
    if (modo === 'ciclo' || modo === 'horas') { d.cada_horas = cada; if (aviso !== null) d.aviso_horas = aviso; }
    if (modo === 'ciclo') d.ciclo = ['250', '500', '750', '1.000'];
    if (modo === 'km') { d.cada_km = cada; if (aviso !== null) d.aviso_km = aviso; }
    if (modo === 'dias') { d.cada_dias = cada; if (aviso !== null) d.aviso_dias = aviso; }
    const { error } = await sb.from('planes_mantenimiento').update(d).eq('id', p.id);
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Plan guardado', 'success'); cerrarModal(); cargarMant(); cargarAlertas();
  }
  async function desactivarPlan() {
    if (!confirm(`¿Quitar el plan de ${M.abierto.equipo_id}? Deja de avisar.`)) return;
    const { error } = await sb.from('planes_mantenimiento').update({ activo: false }).eq('id', M.abierto.id);
    if (error) return toast('No se pudo: ' + error.message, 'error');
    cerrarModal(); cargarMant(); cargarAlertas();
  }
  async function registrarService() {
    const p = M.abierto, desc = val('sv-desc');
    const nivel = $('sv-nivel') ? val('sv-nivel') : null;
    const tec = (cat.ops || []).find(o => o.cedula === val('sv-tec'));
    const { error } = await sb.from('mantenimientos').insert({
      equipo_id: p.equipo_id, plan_id: p.id, fecha: val('sv-fecha'), tipo: 'Preventivo', nivel,
      horometro: $('sv-horo') ? val('sv-horo') : null, km: $('sv-km') ? val('sv-km') : null,
      tecnico_cedula: val('sv-tec'), tecnico_nombre: tec ? tec.nombre : null, costo_gs: val('sv-costo'),
      descripcion: desc || ('Service' + (nivel ? ' ' + nivel + ' h' : '')) });
    if (error) return toast('No se pudo registrar: ' + error.message, 'error');
    toast('Service registrado', 'success'); cerrarModal(); cargarMant(); cargarAlertas();
  }
  async function nuevoPlan(id) {
    const f = flota.find(x => x.id === id);
    const porKm = f && f.categoria === 'vehiculo_liviano' && !f.ultimo_horometro;
    const { error } = await sb.from('planes_mantenimiento').insert(porKm
      ? { equipo_id: id, nombre: 'Service por km', cada_km: 10000 }
      : { equipo_id: id, nombre: 'Service por horas', cada_horas: 250, ciclo: ['250', '500', '750', '1.000'] });
    if (error) return toast('No se pudo crear: ' + error.message, 'error');
    toast(`Plan creado para ${id}`, 'success'); await cargarMant();
  }
  async function crearPlanesFaltantes() {
    const l = sinPlan();
    if (!confirm(`¿Crear el plan de mantenimiento a ${l.length} equipos?`)) return;
    mostrarCarga('Creando planes…');
    const { error } = await sb.from('planes_mantenimiento').insert(l.map(f =>
      f.categoria === 'vehiculo_liviano' && !f.ultimo_horometro
        ? { equipo_id: f.id, nombre: 'Service por km', cada_km: 10000 }
        : { equipo_id: f.id, nombre: 'Service por horas', cada_horas: 250, ciclo: ['250', '500', '750', '1.000'] }));
    ocultarCarga();
    if (error) return toast('No se pudo: ' + error.message, 'error');
    M.tarjeta = null; toast('Planes creados', 'success'); cargarMant(); cargarAlertas();
  }

  // Services realizados
  function pintarHechos() {
    const l = M.hechos || [];
    $('mant-cuerpo').innerHTML = `<div class="filtros">
        <div class="filtro siempre"><label>Desde</label><input type="date" id="mh-desde" value="${M.desde}" onchange="Gestion2.hechosPeriodo()"></div>
        <div class="filtro siempre"><label>Hasta</label><input type="date" id="mh-hasta" value="${M.hasta}" onchange="Gestion2.hechosPeriodo()"></div>
        <div class="filtro crece"><label>Buscar</label><input type="text" id="mh-buscar" placeholder="Equipo, técnico, detalle…" oninput="Gestion2.hechosRepintar()"></div>
        <div class="filtro"><label>Tipo</label><select id="mh-tipo" onchange="Gestion2.hechosRepintar()"><option value="">Todos</option>
          ${[...new Set(l.map(x => x.tipo))].map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="barra-acciones"><div class="info" id="mh-info"></div><button class="btn-filtro" onclick="Gestion2.hechosExportar()">Exportar</button></div>
      <div id="mh-lista"></div>`;
    hechosRepintar();
  }
  function hechosRepintar() {
    const q = ($('mh-buscar').value || '').toLowerCase().trim(), t = $('mh-tipo').value;
    M.hechosVis = (M.hechos || []).filter(x => (!t || x.tipo === t) && filtroTexto(q, [x.equipo_id, x.descripcion, x.tecnico_nombre, nombreDe(x.tecnico_cedula), x.nivel]));
    const prev = M.hechosVis.filter(x => x.tipo === 'Preventivo').length;
    $('mh-info').textContent = `${M.hechosVis.length} registros · ${prev} preventivos · ${M.hechosVis.length - prev} correctivos y otros`;
    $('mh-lista').innerHTML = !M.hechosVis.length ? '<div class="empty-state">Sin registros en el período.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr>
      <th>Fecha</th><th>Equipo</th><th>Tipo</th><th>Service</th><th>Horómetro / km</th><th>Técnico</th><th>Detalle</th><th>Costo</th></tr></thead><tbody>${
      M.hechosVis.map(x => `<tr onclick="abrirFicha('${esc(x.equipo_id)}','mantenimiento')"><td>${fmtFecha(x.fecha)}</td><td><b>${esc(x.equipo_id)}</b></td><td>${esc(x.tipo)}</td>
        <td>${x.nivel ? esc(x.nivel) + ' h' : ''}</td><td>${x.horometro ? fmtNum(x.horometro, 1) + ' h' : x.km ? fmtNum(x.km) + ' km' : ''}</td>
        <td>${esc(x.tecnico_nombre || nombreDe(x.tecnico_cedula))}</td><td class="larga">${esc(x.descripcion)}</td><td>${x.costo_gs ? fmtNum(x.costo_gs) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function hechosPeriodo() { M.desde = $('mh-desde').value || M.desde; M.hasta = $('mh-hasta').value || hoy(); M.hechos = null; $('mh-lista').innerHTML = '<div class="empty-state">Cargando…</div>'; cargarMant(); }
  function hechosExportar() {
    bajarCSV('mantenimientos_realizados', ['Fecha', 'Equipo', 'Tipo', 'Service', 'Horómetro', 'Km', 'Técnico', 'Detalle', 'Repuestos', 'Costo Gs'],
      M.hechosVis.map(x => [x.fecha, x.equipo_id, x.tipo, x.nivel, x.horometro, x.km, x.tecnico_nombre || nombreDe(x.tecnico_cedula), x.descripcion, x.repuestos, x.costo_gs]));
  }

  // ════════════════════════════════════════════════════════════════
  // ALQUILERES
  // ════════════════════════════════════════════════════════════════
  const A = { vista: 'liquidacion', mes: mesAnterior(), liq: null, contratos: null, equipos: null, fact: null,
              estado: 'En Vigencia', visibles: [] };
  const TIPOS_CONTRATO = ['Alquiler a terceros', 'Alquiler a consorcios', 'Obras propias', 'Vehículos livianos', 'Contenedores y tanques'];
  const ESTADOS_FACT = ['PENDIENTE', 'EN VERIFICACIÓN', 'FACTURADO'];

  async function cargarAlq() {
    const [c, e, l] = await Promise.all([
      sb.from('alquiler_contratos').select('*').order('arrendatario'),
      sb.from('alquiler_equipos').select('*').order('id'),
      sb.from('v_alquiler_liquidacion').select('*').eq('mes', A.mes + '-01')
    ]);
    const err = [c, e, l].find(x => x.error);
    if (err) return $('alq-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(err.error.message)}</div>`;
    A.contratos = c.data; A.equipos = e.data; A.liq = l.data;
    pintarAlqCuerpo();
  }
  function pintarAlq() {
    $('screen-alq').innerHTML = subTabs([['liquidacion', 'Liquidación del mes'], ['contratos', 'Contratos']], A.vista, 'alqVista')
      + '<div id="alq-cuerpo"><div class="empty-state">Cargando…</div></div>';
    if (A.contratos) pintarAlqCuerpo();
    cargarAlq();
  }
  function alqVista(v) { A.vista = v; pintarAlq(); }
  function pintarAlqCuerpo() { if ($('alq-cuerpo')) (A.vista === 'liquidacion' ? pintarLiq : pintarContratos)(); }

  function pintarLiq() {
    const grupos = {};
    (A.liq || []).forEach(r => (grupos[r.contrato_id] = grupos[r.contrato_id] || []).push(r));
    const ids = Object.keys(grupos).sort((a, b) => grupos[b].reduce((s, r) => s + num(r.monto_gs), 0) - grupos[a].reduce((s, r) => s + num(r.monto_gs), 0));
    const total = (A.liq || []).reduce((s, r) => s + num(r.monto_gs), 0);
    const estadoDe = id => (grupos[id][0] || {}).estado_facturacion || 'PENDIENTE';
    $('alq-cuerpo').innerHTML = `
      <div class="filtros"><div class="filtro siempre"><label>Mes</label><input type="month" value="${A.mes}" onchange="Gestion2.alqMes(this.value)"></div>
        <div class="filtro siempre"><label>&nbsp;</label><button class="btn-filtro" onclick="Gestion2.liqExportar()">Exportar</button></div></div>
      <div class="tarjetas">
        <div class="tarjeta"><span class="n">${fmtNum(total / 1e6, 1)} M</span><span class="t">Gs liquidados</span></div>
        <div class="tarjeta"><span class="n">${ids.length}</span><span class="t">Contratos</span></div>
        <div class="tarjeta bien"><span class="n">${ids.filter(i => estadoDe(i) === 'FACTURADO').length}</span><span class="t">Facturados</span></div>
        <div class="tarjeta medio"><span class="n">${ids.filter(i => estadoDe(i) !== 'FACTURADO').length}</span><span class="t">Por facturar</span></div></div>
      <div class="aviso-caja">Horas = diferencia de horómetro de los partes diarios del equipo en el mes. Si no llega a las horas mínimas
        (prorrateadas por los días alquilados), se cobra el mínimo.</div>
      ${!ids.length ? '<div class="empty-state">No hay equipos alquilados en ese mes.</div>' : ids.map(id => {
        const l = grupos[id], c = l[0], sub = l.reduce((s, r) => s + num(r.monto_gs), 0);
        const f = (A.fact || {})[id] || {};
        return `<div class="card"><div class="card-header">${esc(c.arrendatario)}<span class="der" style="font-weight:600">${gs(sub)}</span></div><div class="card-body">
          <div class="cambio" style="margin-bottom:8px">${esc(c.obra || '')}</div>
          <div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr><th>Equipo</th><th>Días</th><th>Partes</th><th>Horas</th><th>Mínimo</th><th>A cobrar</th><th>Precio/h</th><th>Monto</th><th>Incluye</th></tr></thead><tbody>
            ${l.map(r => `<tr style="cursor:default"><td><b>${esc(r.equipo_id || r.equipo_texto)}</b></td><td>${r.dias_alquilado}</td><td>${r.partes}</td>
              <td>${fmtNum(r.horas_trabajadas, 1)}</td><td>${fmtNum(r.horas_minimas, 1)}</td>
              <td>${num(r.horas_trabajadas) < num(r.horas_minimas) ? `<span class="chip amarillo">${fmtNum(r.horas_facturables, 1)} (mín.)</span>` : fmtNum(r.horas_facturables, 1)}</td>
              <td>${fmtNum(r.precio_hora_gs)}</td><td><b>${fmtNum(r.monto_gs)}</b></td>
              <td>${[r.incluye_operador && 'operador', r.incluye_combustible && 'combustible'].filter(Boolean).join(', ')}</td></tr>`).join('')}</tbody></table></div>
          ${esTaller() ? `<div class="form-grid" style="margin-top:12px">
            ${campo('fa-est-' + id, 'Facturación', sel('fa-est-' + id, ESTADOS_FACT, c.estado_facturacion || 'PENDIENTE', '', 'PENDIENTE'))}
            ${campo('fa-nro-' + id, 'N° de factura', inp('fa-nro-' + id, c.nro_factura || f.nro_factura))}
            ${campo('fa-monto-' + id, 'Monto facturado (Gs)', inp('fa-monto-' + id, f.monto_facturado_gs, 'number'))}
          </div><div class="acciones"><button class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio)" onclick="Gestion2.liqCompartir(${id})">Compartir liquidación</button>
            <button class="btn-mini btn-verde" style="background:var(--verde);color:#fff" onclick="Gestion2.guardarFact(${id})">Guardar facturación</button></div>` : ''}
        </div></div>`;
      }).join('')}`;
    A.grupos = grupos;
    // monto facturado guardado (no viene en la vista)
    sb.from('alquiler_facturacion').select('*').eq('mes', A.mes + '-01').then(({ data }) => {
      A.fact = Object.fromEntries((data || []).map(f => [f.contrato_id, f]));
      (data || []).forEach(f => { const el = $('fa-monto-' + f.contrato_id); if (el && !el.value && f.monto_facturado_gs) el.value = f.monto_facturado_gs; });
    });
  }
  function alqMes(m) { A.mes = m || mesAnterior(); A.liq = null; cargarAlq(); }
  async function guardarFact(id) {
    const { error } = await sb.from('alquiler_facturacion').upsert({ contrato_id: id, mes: A.mes + '-01',
      estado: val('fa-est-' + id) || 'PENDIENTE', nro_factura: val('fa-nro-' + id), monto_facturado_gs: val('fa-monto-' + id),
      actualizado_en: new Date().toISOString() }, { onConflict: 'contrato_id,mes' });
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Facturación guardada', 'success'); cargarAlq();
  }
  function liqCompartir(id) {
    const l = A.grupos[id], c = l[0], sub = l.reduce((s, r) => s + num(r.monto_gs), 0);
    compartir(`*Liquidación ${A.mes.slice(5)}/${A.mes.slice(0, 4)} – ${c.arrendatario}*\n${c.obra || ''}\n` + l.map(r =>
      `• ${r.equipo_id || r.equipo_texto}: ${fmtNum(r.horas_facturables, 1)} h${num(r.horas_trabajadas) < num(r.horas_minimas) ? ' (mínimo)' : ''} × Gs ${fmtNum(r.precio_hora_gs)} = Gs ${fmtNum(r.monto_gs)}`).join('\n')
      + `\n*Total: Gs ${fmtNum(sub)}* (IVA incluido)`);
  }
  function liqExportar() {
    bajarCSV('liquidacion_alquileres_' + A.mes, ['Arrendatario', 'Obra', 'Equipo', 'Desde', 'Hasta', 'Días', 'Partes', 'Horas trabajadas', 'Horas mínimas', 'Horas a cobrar', 'Precio/h Gs', 'Monto Gs', 'Facturación', 'N° factura'],
      (A.liq || []).map(r => [r.arrendatario, r.obra, r.equipo_id || r.equipo_texto, r.desde_mes, r.hasta_mes, r.dias_alquilado, r.partes, r.horas_trabajadas, r.horas_minimas, r.horas_facturables, r.precio_hora_gs, r.monto_gs, r.estado_facturacion, r.nro_factura]));
  }

  // Contratos
  function pintarContratos() {
    $('alq-cuerpo').innerHTML = `<div class="filtros">
        <div class="filtro crece"><label>Buscar</label><input type="text" id="ac-buscar" placeholder="Arrendatario, obra, equipo…" oninput="Gestion2.contratosRepintar()"></div>
        <div class="filtro siempre"><label>Estado</label><select id="ac-estado" onchange="Gestion2.contratosRepintar()">
          <option value="En Vigencia" ${A.estado === 'En Vigencia' ? 'selected' : ''}>En vigencia</option><option value="Culminado" ${A.estado === 'Culminado' ? 'selected' : ''}>Culminados</option><option value="">Todos</option></select></div>
        <div class="filtro"><label>Tipo</label><select id="ac-tipo" onchange="Gestion2.contratosRepintar()"><option value="">Todos</option>${TIPOS_CONTRATO.map(t => `<option>${t}</option>`).join('')}</select></div>
      </div>
      <div class="barra-acciones"><div class="info" id="ac-info"></div>
        ${esTaller() ? '<button class="btn-filtro primario" onclick="Gestion2.abrirContrato(null)">+ Nuevo contrato</button>' : ''}</div>
      <div id="ac-lista"></div>`;
    contratosRepintar();
  }
  function contratosRepintar() {
    A.estado = $('ac-estado').value;
    const q = ($('ac-buscar').value || '').toLowerCase().trim(), t = $('ac-tipo').value;
    const eqDe = id => (A.equipos || []).filter(e => e.contrato_id === id);
    A.visibles = (A.contratos || []).filter(c => (!A.estado || c.estado === A.estado) && (!t || c.tipo === t)
      && filtroTexto(q, [c.arrendatario, c.obra, c.ubicacion, c.ruc, ...eqDe(c.id).map(e => e.equipo_id || e.equipo_texto)]));
    $('ac-info').textContent = `${A.visibles.length} contratos`;
    $('ac-lista').innerHTML = !A.visibles.length ? '<div class="empty-state">Sin contratos con esos filtros.</div>' : '<div class="equipos">' + A.visibles.map(c => {
      const eq = eqDe(c.id);
      return `<button class="eq" onclick="Gestion2.abrirContrato(${c.id})"><div class="fila1"><div><div class="cod">${esc(c.arrendatario)}</div>
        <div class="tipo">${esc(c.obra || '')}</div></div><span class="chip ${c.estado === 'En Vigencia' ? 'verde' : 'gris'}">${esc(c.estado)}</span></div>
        <div class="meta">${esc(c.tipo)}${c.fecha_inicio ? ' · desde ' + fmtFecha(c.fecha_inicio) : ''}${c.fecha_fin ? ' hasta ' + fmtFecha(c.fecha_fin) : ''}</div>
        <div class="chips">${eq.map(e => `<span class="chip azul">${esc(e.equipo_id || e.equipo_texto)}${e.precio_hora_gs ? ' · ' + fmtNum(e.precio_hora_gs / 1000) + ' mil/h' : ''}</span>`).join('')}</div></button>`;
    }).join('') + '</div>';
  }

  function abrirContrato(id) {
    const c = id ? A.contratos.find(x => x.id === id) : { estado: 'En Vigencia', tipo: 'Alquiler a terceros' };
    A.abierto = c;
    A.filasEq = id ? (A.equipos || []).filter(e => e.contrato_id === id).map(e => Object.assign({}, e)) : [];
    const t = esTaller(), dis = t ? '' : 'disabled';
    abrirModal(id ? c.arrendatario : 'Nuevo contrato', `
      <div class="form-grid">
        ${campo('co-arr', 'Arrendatario', inp('co-arr', c.arrendatario, 'text', dis), 'ancho')}
        ${campo('co-ruc', 'RUC', inp('co-ruc', c.ruc, 'text', dis))}
        ${campo('co-tipo', 'Tipo', sel('co-tipo', TIPOS_CONTRATO, c.tipo, dis))}
        ${campo('co-estado', 'Estado', sel('co-estado', ['En Vigencia', 'Culminado'], c.estado, dis))}
        ${campo('co-obra', 'Obra', inp('co-obra', c.obra, 'text', dis), 'ancho')}
        ${campo('co-ubic', 'Ubicación', inp('co-ubic', c.ubicacion, 'text', dis))}
        ${campo('co-ini', 'Inicio', inp('co-ini', c.fecha_inicio, 'date', dis))}
        ${campo('co-fin', 'Fin', inp('co-fin', c.fecha_fin, 'date', dis))}
        ${campo('co-cont', 'Contacto', inp('co-cont', c.contacto, 'text', dis))}
        ${campo('co-tel', 'Teléfono', inp('co-tel', c.telefono, 'text', dis))}
        ${campo('co-mail', 'Correo', inp('co-mail', c.email, 'text', dis))}
        ${campo('co-notas', 'Notas', txt('co-notas', c.notas, dis), 'ancho')}
      </div>
      <h3 style="font-size:14px;margin:6px 0 8px">Equipos alquilados</h3>
      <div id="co-equipos"></div>
      ${t ? `<button class="add-btn" style="width:100%;padding:9px;border:1.5px dashed var(--azul-medio);background:#eef2f9;color:var(--azul-medio);border-radius:8px;font-weight:700;margin-bottom:12px" onclick="Gestion2.contratoSumarEquipo()">+ Agregar equipo</button>
      <div class="acciones"><button class="btn btn-verde" onclick="Gestion2.guardarContrato()">Guardar contrato</button></div>` : ''}`);
    $('modal').querySelector('.modal-card').classList.add('ancho');
    pintarFilasEq();
  }
  function pintarFilasEq() {
    const t = esTaller(), dis = t ? '' : 'disabled';
    const ids = flota.filter(f => f.activo).map(f => f.id);
    $('co-equipos').innerHTML = !A.filasEq.length ? '<div class="empty-state">Sin equipos.</div>' : A.filasEq.map((e, i) => e._borrar ? '' : `
      <div class="card" style="margin-bottom:8px"><div class="card-body" style="padding:10px 12px"><div class="form-grid">
        ${campo('ce-eq-' + i, 'Equipo', `<select id="ce-eq-${i}" ${dis}><option value="">${esc(e.equipo_texto || '—')}</option>${ids.map(x => `<option ${x === e.equipo_id ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
        ${campo('ce-pr-' + i, 'Precio por hora (Gs, con IVA)', inp('ce-pr-' + i, e.precio_hora_gs, 'number', dis))}
        ${campo('ce-min-' + i, 'Horas mínimas por mes', inp('ce-min-' + i, e.horas_minimas_mes, 'number', dis + ' step="any"'))}
        ${campo('ce-de-' + i, 'Desde', inp('ce-de-' + i, e.desde, 'date', dis))}
        ${campo('ce-ha-' + i, 'Hasta', inp('ce-ha-' + i, e.hasta, 'date', dis))}
        ${campo('ce-inc-' + i, 'Incluye', `<label class="check-linea"><input type="checkbox" id="ce-op-${i}" ${e.incluye_operador ? 'checked' : ''} ${dis}> Operador</label>
          <label class="check-linea"><input type="checkbox" id="ce-co-${i}" ${e.incluye_combustible ? 'checked' : ''} ${dis}> Combustible</label>`)}
      </div>${t ? `<div class="acciones"><button class="btn-mini btn-rojo" onclick="Gestion2.contratoQuitarEquipo(${i})">Quitar</button></div>` : ''}</div></div>`).join('');
  }
  function leerFilasEq() {
    A.filasEq.forEach((e, i) => {
      if (e._borrar || !$('ce-eq-' + i)) return;
      Object.assign(e, { equipo_id: val('ce-eq-' + i), precio_hora_gs: val('ce-pr-' + i), horas_minimas_mes: val('ce-min-' + i),
        desde: val('ce-de-' + i), hasta: val('ce-ha-' + i), incluye_operador: val('ce-op-' + i), incluye_combustible: val('ce-co-' + i) });
    });
  }
  function contratoSumarEquipo() { leerFilasEq(); A.filasEq.push({ incluye_operador: true, incluye_combustible: false }); pintarFilasEq(); }
  function contratoQuitarEquipo(i) { leerFilasEq(); A.filasEq[i]._borrar = true; pintarFilasEq(); }
  async function guardarContrato() {
    leerFilasEq();
    const d = { arrendatario: val('co-arr'), ruc: val('co-ruc'), tipo: val('co-tipo') || 'Alquiler a terceros', estado: val('co-estado') || 'En Vigencia',
      obra: val('co-obra'), ubicacion: val('co-ubic'), fecha_inicio: val('co-ini'), fecha_fin: val('co-fin'),
      contacto: val('co-cont'), telefono: val('co-tel'), email: val('co-mail'), notas: val('co-notas') };
    if (!d.arrendatario) return toast('Falta el arrendatario', 'warning');
    if (A.filasEq.some(e => !e._borrar && !e.equipo_id && !e.equipo_texto)) return toast('Elegí el equipo en cada fila (o quitala)', 'warning');
    mostrarCarga('Guardando…');
    try {
      let id = A.abierto.id;
      if (id) { const r = await sb.from('alquiler_contratos').update(d).eq('id', id); if (r.error) throw r.error; }
      else { const r = await sb.from('alquiler_contratos').insert(d).select('id').single(); if (r.error) throw r.error; id = r.data.id; }
      for (const e of A.filasEq) {
        const fila = { contrato_id: id, equipo_id: e.equipo_id, equipo_texto: e.equipo_id ? null : e.equipo_texto,
          precio_hora_gs: e.precio_hora_gs, horas_minimas_mes: e.horas_minimas_mes, desde: e.desde, hasta: e.hasta,
          incluye_operador: e.incluye_operador, incluye_combustible: e.incluye_combustible };
        let r;
        if (e._borrar && e.id) r = await sb.from('alquiler_equipos').delete().eq('id', e.id);
        else if (e._borrar) continue;
        else if (e.id) r = await sb.from('alquiler_equipos').update(fila).eq('id', e.id);
        else r = await sb.from('alquiler_equipos').insert(fila);
        if (r.error) throw r.error;
      }
      ocultarCarga(); toast('Contrato guardado', 'success'); cerrarModal(); cargarAlq();
    } catch (e) { ocultarCarga(); toast('No se pudo guardar: ' + e.message, 'error'); }
  }

  // ════════════════════════════════════════════════════════════════
  // SEGUROS
  // ════════════════════════════════════════════════════════════════
  const S = { datos: null, tarjeta: null, orden: { col: 'vencimiento', asc: true }, visibles: [] };
  async function cargarSeg() {
    const { data, error } = await sb.from('seguros').select('*').order('vencimiento', { nullsFirst: false }).limit(3000);
    if (error) return $('screen-seg').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    // El vigente de cada bien es el de vencimiento más lejano
    const ultimo = {};
    data.forEach(s => { const k = s.bien_asegurado; if (!ultimo[k] || (s.vencimiento || '') > (ultimo[k].vencimiento || '')) ultimo[k] = s; });
    const h = hoy();
    S.datos = data.map(s => Object.assign(s, {
      vigente: ultimo[s.bien_asegurado] === s,
      dias: s.vencimiento ? Math.round((new Date(s.vencimiento) - new Date(h)) / 864e5) : null,
      est: s.situacion ? 'sin' : !s.vencimiento ? 'sin' : s.vencimiento < h ? 'vencido' : (new Date(s.vencimiento) - new Date(h)) / 864e5 <= 30 ? 'porvencer' : 'vigente' }));
    pintarSegCuerpo();
  }
  function pintarSeg() {
    $('screen-seg').innerHTML = '<div id="seg-cuerpo"><div class="empty-state">Cargando…</div></div>';
    if (S.datos) pintarSegCuerpo();
    cargarSeg();
  }
  const SEG_TJ = [{ k: 'vigente', t: 'Vigentes', c: 'bien' }, { k: 'porvencer', t: 'Vencen en 30 días', c: 'medio' },
                  { k: 'vencido', t: 'Vencidos', c: 'malo' }, { k: 'sin', t: 'Sin póliza / no aplica' }];
  function pintarSegCuerpo() {
    const act = S.datos.filter(s => s.vigente);
    const prev = { q: ($('sg-buscar') || {}).value || '', c: ($('sg-comp') || {}).value || '', h: ($('sg-hist') || {}).checked || false };
    const comps = [...new Set(S.datos.map(s => (s.compania || '').replace(/\s+S\.?A\.?$/i, ' S.A.').trim()).filter(Boolean))].sort();
    $('seg-cuerpo').innerHTML = tarjetas(SEG_TJ.map(t => Object.assign({}, t, { n: act.filter(s => s.est === t.k).length })), S.tarjeta, 'segTarjeta') + `
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label><input type="text" id="sg-buscar" value="${esc(prev.q)}" placeholder="Bien, chapa, póliza, grupo…" oninput="Gestion2.segRepintar()"></div>
        <div class="filtro siempre"><label>Compañía</label><select id="sg-comp" onchange="Gestion2.segRepintar()"><option value="">Todas</option>
          ${comps.map(c => `<option ${prev.c === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="filtro"><label>&nbsp;</label><label class="check-linea"><input type="checkbox" id="sg-hist" ${prev.h ? 'checked' : ''} onchange="Gestion2.segRepintar()"> Ver pólizas anteriores</label></div>
      </div>
      <div class="barra-acciones"><div class="info" id="sg-info"></div>
        <button class="btn-filtro" onclick="Gestion2.segExportar()">Exportar</button>
        <button class="btn-filtro primario" onclick="Gestion2.abrirSeguro(-1)">+ Nuevo seguro</button></div>
      <div id="sg-lista"></div>`;
    segRepintar();
  }
  const SEG_COLS = [['bien_asegurado', 'Bien'], ['descripcion_bien', 'Descripción'], ['compania', 'Compañía'], ['poliza', 'Póliza'],
    ['tipo_seguro', 'Tipo'], ['inicio_vigencia', 'Inicio'], ['vencimiento', 'Vence'], ['monto_asegurado', 'Monto asegurado'],
    ['costo_total', 'Costo total'], ['cuotas', 'Cuotas'], ['grupo', 'Grupo']];
  function segRepintar() {
    const q = ($('sg-buscar').value || '').toLowerCase().trim(), comp = $('sg-comp').value, hist = $('sg-hist').checked;
    S.visibles = ordenar(S.datos.filter(s => (hist || s.vigente) && (!S.tarjeta || s.est === S.tarjeta)
      && (!comp || (s.compania || '').replace(/\s+S\.?A\.?$/i, ' S.A.').trim() === comp)
      && filtroTexto(q, [s.bien_asegurado, s.equipo_id, s.descripcion_bien, s.poliza, s.compania, s.grupo, s.tipo_seguro])).map(s =>
      Object.assign(s, { cuotas: s.cantidad_cuotas ? `${s.cantidad_cuotas} × ${fmtNum(s.monto_cuota)}` : '' })), S.orden);
    const costo = S.visibles.filter(s => s.moneda !== 'USD').reduce((a, s) => a + num(s.costo_total), 0);
    $('sg-info').textContent = `${S.visibles.length} pólizas · costo Gs ${fmtNum(costo)}`;
    const chipV = s => s.est === 'sin' ? `<span class="chip gris">${esc(s.situacion || 'sin fecha')}</span>`
      : `<span class="chip ${s.est === 'vencido' ? 'rojo' : s.est === 'porvencer' ? 'amarillo' : 'verde'}">${fmtFecha(s.vencimiento)}</span>`;
    if (!S.visibles.length) return $('sg-lista').innerHTML = '<div class="empty-state">Sin pólizas con esos filtros.</div>';
    if (window.innerWidth < 700) {
      $('sg-lista').innerHTML = '<div class="equipos">' + S.visibles.map((s, i) => `<button class="eq" onclick="Gestion2.abrirSeguro(${i})">
        <div class="fila1"><div><div class="cod">${esc(s.bien_asegurado)}</div><div class="tipo">${esc(s.descripcion_bien || '')}</div></div>${chipV(s)}</div>
        <div class="meta">${[s.compania, s.poliza && 'póliza ' + s.poliza, s.tipo_seguro].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="meta">${s.costo_total ? (s.moneda === 'USD' ? 'USD ' : 'Gs ') + fmtNum(s.costo_total) : ''}</div></button>`).join('') + '</div>';
      return;
    }
    $('sg-lista').innerHTML = tabla(SEG_COLS, S.visibles, S.orden, 'segOrdenar', 'abrirSeguro', (s, k) => {
      if (k === 'bien_asegurado') return `<td><b>${esc(s.bien_asegurado)}</b>${s.vigente ? '' : ' <span class="chip gris">anterior</span>'}</td>`;
      if (k === 'vencimiento') return `<td>${chipV(s)}</td>`;
      if (k === 'inicio_vigencia') return `<td>${fmtFecha(s[k])}</td>`;
      if (k === 'monto_asegurado' || k === 'costo_total') return `<td>${s[k] ? (s.moneda === 'USD' ? 'USD ' : '') + fmtNum(s[k]) : ''}</td>`;
      return `<td class="${k === 'descripcion_bien' || k === 'grupo' ? 'larga' : ''}">${esc(s[k] ?? '')}</td>`;
    });
  }
  function segTarjeta(k) { S.tarjeta = S.tarjeta === k ? null : k; pintarSegCuerpo(); }
  function segOrdenar(col) { S.orden = { col, asc: S.orden.col === col ? !S.orden.asc : true }; segRepintar(); }
  function segExportar() {
    bajarCSV('seguros', ['Bien', 'Equipo', 'Descripción', 'Compañía', 'Póliza', 'Tipo', 'Moneda', 'Inicio', 'Vence', 'Monto asegurado', 'Costo total', 'Cuota inicial', 'Monto cuota', 'Cuotas', 'Situación', 'Grupo', 'Notas'],
      S.visibles.map(s => [s.bien_asegurado, s.equipo_id, s.descripcion_bien, s.compania, s.poliza, s.tipo_seguro, s.moneda, s.inicio_vigencia, s.vencimiento, s.monto_asegurado, s.costo_total, s.cuota_inicial, s.monto_cuota, s.cantidad_cuotas, s.situacion, s.grupo, s.notas]));
  }
  function abrirSeguro(i, base) {
    const s = base || (i >= 0 ? S.visibles[i] : { moneda: 'PYG' });
    S.abierto = base ? {} : s;
    const t = esTaller(), dis = t ? '' : 'disabled';
    const grupos = [...new Set(S.datos.map(x => x.grupo).filter(Boolean))];
    abrirModal(base ? 'Renovar seguro' : (s.id ? `Seguro · ${s.bien_asegurado}` : 'Nuevo seguro'), `
      <div class="form-grid">
        ${campo('sg-eq', 'Equipo', `<select id="sg-eq" ${dis} onchange="if(this.value&&!$('sg-bien').value)$('sg-bien').value=this.value"><option value="">— no es un equipo —</option>${flota.map(f =>
          `<option ${f.id === s.equipo_id ? 'selected' : ''}>${esc(f.id)}</option>`).join('')}</select>`)}
        ${campo('sg-bien', 'Bien asegurado', inp('sg-bien', s.bien_asegurado, 'text', dis))}
        ${campo('sg-desc', 'Descripción', inp('sg-desc', s.descripcion_bien, 'text', dis + ' placeholder="Ej.: TOYOTA HILUX 2016 OBX534"'), 'ancho')}
        ${campo('sg-comp2', 'Compañía', inp('sg-comp2', s.compania, 'text', dis))}
        ${campo('sg-pol', 'Póliza', inp('sg-pol', s.poliza, 'text', dis))}
        ${campo('sg-tipo', 'Tipo de seguro', inp('sg-tipo', s.tipo_seguro, 'text', dis))}
        ${campo('sg-mon', 'Moneda', sel('sg-mon', ['PYG', 'USD'], s.moneda, dis))}
        ${campo('sg-ini', 'Inicio de vigencia', inp('sg-ini', s.inicio_vigencia, 'date', dis))}
        ${campo('sg-ven', 'Vencimiento', inp('sg-ven', s.vencimiento, 'date', dis))}
        ${campo('sg-masg', 'Monto asegurado', inp('sg-masg', s.monto_asegurado, 'number', dis))}
        ${campo('sg-costo', 'Costo total', inp('sg-costo', s.costo_total, 'number', dis))}
        ${campo('sg-cini', 'Cuota inicial', inp('sg-cini', s.cuota_inicial, 'number', dis))}
        ${campo('sg-mcuota', 'Monto de cuota', inp('sg-mcuota', s.monto_cuota, 'number', dis))}
        ${campo('sg-ncuota', 'Cantidad de cuotas', inp('sg-ncuota', s.cantidad_cuotas, 'number', dis))}
        ${campo('sg-sit', 'Situación', sel('sg-sit', ['No aplica', 'Sin póliza'], s.situacion, dis, 'Con póliza'))}
        ${campo('sg-grupo', 'Grupo', `<input id="sg-grupo" list="sg-grupos" value="${esc(s.grupo || '')}" ${dis}><datalist id="sg-grupos">${grupos.map(g => `<option>${esc(g)}</option>`).join('')}</datalist>`)}
        ${campo('sg-notas', 'Notas', txt('sg-notas', s.notas, dis), 'ancho')}
      </div>
      ${t ? `<div class="acciones">
        ${s.id && !base ? `<button class="btn btn-gris" onclick="Gestion2.renovarSeguro()">Renovar (nueva póliza)</button>` : ''}
        <button class="btn btn-verde" onclick="Gestion2.guardarSeguro()">Guardar</button></div>` : ''}
      ${s.id && !base ? '<p class="cambio" style="margin-top:10px">Los documentos de la póliza se suben en la ficha del equipo → Documentos.</p>' : ''}`);
  }
  function renovarSeguro() {
    const s = S.abierto, mas1 = f => { if (!f) return null; const d = new Date(f); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
    abrirSeguro(-1, Object.assign({}, s, { id: null, poliza: '', inicio_vigencia: s.vencimiento, vencimiento: mas1(s.vencimiento) }));
  }
  async function guardarSeguro() {
    const d = { equipo_id: val('sg-eq'), bien_asegurado: val('sg-bien') || val('sg-eq'), descripcion_bien: val('sg-desc'),
      compania: val('sg-comp2'), poliza: val('sg-pol'), tipo_seguro: val('sg-tipo'), moneda: val('sg-mon'),
      inicio_vigencia: val('sg-ini'), vencimiento: val('sg-ven'), monto_asegurado: val('sg-masg'), costo_total: val('sg-costo'),
      cuota_inicial: val('sg-cini'), monto_cuota: val('sg-mcuota'), cantidad_cuotas: val('sg-ncuota'),
      situacion: val('sg-sit'), grupo: val('sg-grupo'), notas: val('sg-notas') };
    if (!d.bien_asegurado) return toast('Falta el bien asegurado', 'warning');
    const r = S.abierto.id ? await sb.from('seguros').update(d).eq('id', S.abierto.id) : await sb.from('seguros').insert(d);
    if (r.error) return toast('No se pudo guardar: ' + r.error.message, 'error');
    toast('Seguro guardado', 'success'); cerrarModal(); cargarSeg(); cargarAlertas();
  }

  // ════════════════════════════════════════════════════════════════
  // PERSONAL
  // ════════════════════════════════════════════════════════════════
  const ESPECIALIDADES = ['OPERADOR', 'CHOFER', 'MECANICO', 'MECANICO A', 'MECANICO B', 'ELECTRICISTA', 'GOMERO',
    'AYUDANTE MECANICO', 'SUPERVISOR', 'DESPACHADOR', 'OTRO'];
  const P = { mes: mesActual(), datos: null, tarjeta: null, orden: { col: 'nombre', asc: true }, visibles: [] };
  const formulariosDe = (p) => {
    if (p.formularios && p.formularios.length) return p.formularios;
    if (p.rol === 'admin_central' || p.rol === 'taller') return ['parte', 'taller', 'combustible'];
    if (p.rol === 'admin_obra') return ['parte', 'combustible'];
    if (p.especialidad === 'DESPACHADOR') return ['combustible'];
    if (['MECANICO', 'MECANICO A', 'MECANICO B', 'ELECTRICISTA', 'GOMERO', 'AYUDANTE MECANICO', 'SUPERVISOR'].includes(p.especialidad)) return ['taller'];
    return ['parte'];
  };
  async function cargarPers() {
    const [a, m] = P.mes.split('-').map(Number);
    const hasta = new Date(a, m, 0).toISOString().slice(0, 10);
    const { data, error } = await sb.rpc('personal_resumen', { p_desde: P.mes + '-01', p_hasta: hasta });
    if (error) return $('screen-pers').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    P.datos = data.map(p => Object.assign(p, {
      usuario: p.tiene_usuario ? (p.usuario_activo ? etiquetaRol(p.rol) : 'desactivado') : '',
      actividad: [p.ultimo_parte, p.ultimo_taller, p.ultimo_despacho].filter(Boolean).sort().pop() || null }));
    pintarPersCuerpo();
  }
  function pintarPers() {
    $('screen-pers').innerHTML = '<div id="pers-cuerpo"><div class="empty-state">Cargando…</div></div>';
    if (P.datos) pintarPersCuerpo();
    cargarPers();
  }
  const PERS_TJ = [{ k: 'activos', t: 'Personas activas', fn: p => p.activo },
    { k: 'conusr', t: 'Con usuario', c: 'bien', fn: p => p.activo && p.tiene_usuario },
    { k: 'sinusr', t: 'Sin usuario', c: 'medio', fn: p => p.activo && !p.tiene_usuario },
    { k: 'taller', t: 'Taller', fn: p => p.activo && formulariosDe(p).includes('taller') && !['admin_central', 'taller'].includes(p.rol) },
    { k: 'desp', t: 'Despachadores', fn: p => p.activo && p.especialidad === 'DESPACHADOR' },
    { k: 'sinact', t: 'Sin actividad en el mes', c: 'malo', fn: p => p.activo && p.tiene_usuario && !p.partes && !p.registros_taller && !p.despachos }];
  function pintarPersCuerpo() {
    const prev = { q: ($('pe-buscar') || {}).value || '', e: ($('pe-esp') || {}).value || '' };
    $('pers-cuerpo').innerHTML = tarjetas(PERS_TJ.map(t => Object.assign({}, t, { n: P.datos.filter(t.fn).length })), P.tarjeta, 'persTarjeta') + `
      <div class="filtros">
        <div class="filtro siempre"><label>Mes</label><input type="month" value="${P.mes}" onchange="Gestion2.persMes(this.value)"></div>
        <div class="filtro crece"><label>Buscar</label><input type="text" id="pe-buscar" value="${esc(prev.q)}" placeholder="Nombre, cédula, teléfono, ubicación…" oninput="Gestion2.persRepintar()"></div>
        <div class="filtro"><label>Especialidad</label><select id="pe-esp" onchange="Gestion2.persRepintar()"><option value="">Todas</option>
          ${ESPECIALIDADES.map(e => `<option ${prev.e === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <div class="barra-acciones"><div class="info" id="pe-info"></div>
        <button class="btn-filtro" onclick="Gestion2.persExportar()">Exportar</button>
        ${sesion.rol === 'admin_central' ? '<button class="btn-filtro" onclick="Gestion2.persParaUsuarios()">CSV para crear usuarios</button>' : ''}</div>
      <div id="pe-lista"></div>`;
    persRepintar();
  }
  const PERS_COLS = [['nombre', 'Nombre'], ['cedula', 'Cédula'], ['especialidad', 'Especialidad'], ['telefono', 'Teléfono'],
    ['ubicacion', 'Ubicación'], ['usuario', 'Usuario'], ['forms', 'Formularios'], ['partes', 'Partes'], ['horas_hombre', 'Horas hombre'],
    ['horas_taller', 'Horas taller'], ['litros', 'Litros despachados'], ['actividad', 'Última actividad']];
  function persRepintar() {
    const q = ($('pe-buscar').value || '').toLowerCase().trim(), e = $('pe-esp').value;
    const tj = PERS_TJ.find(t => t.k === P.tarjeta);
    P.visibles = ordenar(P.datos.filter(p => (tj ? tj.fn(p) : p.activo) && (!e || p.especialidad === e)
      && filtroTexto(q, [p.nombre, p.cedula, p.telefono, p.ubicacion, p.equipo_habitual, p.especialidad]))
      .map(p => Object.assign(p, { forms: formulariosDe(p).map(f => ({ parte: 'Parte', taller: 'Taller', combustible: 'Combustible' }[f])).join(', ') })), P.orden);
    $('pe-info').textContent = `${P.visibles.length} personas`;
    const chipU = p => p.tiene_usuario ? `<span class="chip ${p.usuario_activo ? 'verde' : 'gris'}">${esc(p.usuario)}</span>` : '<span class="chip amarillo">sin usuario</span>';
    if (!P.visibles.length) return $('pe-lista').innerHTML = '<div class="empty-state">Nadie con esos filtros.</div>';
    if (window.innerWidth < 700) {
      $('pe-lista').innerHTML = '<div class="equipos">' + P.visibles.map((p, i) => `<button class="eq" onclick="Gestion2.abrirPersona(${i})">
        <div class="fila1"><div><div class="cod" style="font-size:14.5px">${esc(p.nombre)}</div><div class="tipo">${esc(p.especialidad)} · ${esc(p.cedula)}</div></div>${chipU(p)}</div>
        <div class="meta">${[p.telefono, p.ubicacion].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="chips">${p.partes ? `<span class="chip gris">${p.partes} partes · ${fmtNum(p.horas_hombre, 1)} hh</span>` : ''}
          ${p.registros_taller ? `<span class="chip gris">${fmtNum(p.horas_taller, 1)} h taller</span>` : ''}
          ${p.despachos ? `<span class="chip gris">${fmtNum(p.litros)} L</span>` : ''}</div></button>`).join('') + '</div>';
      return;
    }
    $('pe-lista').innerHTML = tabla(PERS_COLS, P.visibles, P.orden, 'persOrdenar', 'abrirPersona', (p, k) => {
      if (k === 'nombre') return `<td><b>${esc(p.nombre)}</b></td>`;
      if (k === 'usuario') return `<td>${chipU(p)}</td>`;
      if (k === 'partes') return `<td>${p.partes || ''}</td>`;
      if (k === 'horas_hombre' || k === 'horas_taller') return `<td>${num(p[k]) ? fmtNum(p[k], 1) : ''}</td>`;
      if (k === 'litros') return `<td>${num(p.litros) ? fmtNum(p.litros) : ''}</td>`;
      if (k === 'actividad') return `<td>${fmtFecha(p.actividad)}</td>`;
      return `<td>${esc(p[k] ?? '')}</td>`;
    });
  }
  function persTarjeta(k) { P.tarjeta = P.tarjeta === k ? null : k; pintarPersCuerpo(); }
  function persOrdenar(col) { P.orden = { col, asc: P.orden.col === col ? !P.orden.asc : true }; persRepintar(); }
  function persMes(m) { P.mes = m || mesActual(); cargarPers(); }
  function persExportar() {
    bajarCSV('personal_' + P.mes, ['Cédula', 'Nombre', 'Especialidad', 'Teléfono', 'Ubicación', 'Equipo habitual', 'Usuario', 'Formularios',
      'Partes', 'Horas hombre', 'Registros taller', 'Horas taller', 'Despachos', 'Litros', 'Última actividad'],
      P.visibles.map(p => [p.cedula, p.nombre, p.especialidad, p.telefono, p.ubicacion, p.equipo_habitual, p.usuario || 'sin usuario', p.forms,
        p.partes, p.horas_hombre, p.registros_taller, p.horas_taller, p.despachos, p.litros, p.actividad]));
  }
  // usuarios.csv tal como lo lee crear_usuarios.py (clave inicial = cédula)
  function persParaUsuarios() {
    const l = P.visibles.filter(p => !p.tiene_usuario && p.activo);
    if (!l.length) return toast('Todos los de la lista ya tienen usuario', 'warning');
    bajarCSV('usuarios.csv', ['cedula', 'password', 'nombre', 'rol', 'obras'], l.map(p => [p.cedula, p.cedula.length >= 6 ? p.cedula : p.cedula + 'tecsul', p.nombre, 'operador', '']), ',');
    toast(`${l.length} personas. Guardalo junto a crear_usuarios.py y corré el script.`, 'success');
  }
  function abrirPersona(i) {
    const p = P.visibles[i];
    P.abierta = p;
    const t = esTaller(), dis = t ? '' : 'disabled';
    const tel = (p.telefono || '').replace(/\D/g, '').replace(/^0/, '595');
    abrirModal(p.nombre, `
      <div class="datos" style="margin-bottom:12px">
        ${dato('Usuario', p.tiene_usuario ? esc(p.usuario) : 'Sin usuario: no puede entrar a la app')}
        ${dato('Ve en la app', esc(p.forms))}
        ${dato('En ' + P.mes.slice(5) + '/' + P.mes.slice(0, 4), [p.partes && `${p.partes} partes (${fmtNum(p.horas_hombre, 1)} hh)`,
          p.registros_taller && `${p.registros_taller} registros de taller (${fmtNum(p.horas_taller, 1)} h)`,
          p.despachos && `${p.despachos} despachos (${fmtNum(p.litros)} L)`].filter(Boolean).join(' · ') || 'Sin actividad')}
        ${dato('Última actividad', fmtFecha(p.actividad))}
      </div>
      ${tel ? `<p style="margin:0 0 12px"><a class="btn-mini" style="background:#25d366;color:#fff;text-decoration:none;padding:8px 12px" href="https://wa.me/${tel}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn-mini" style="background:#e0e7ff;color:var(--azul-medio);text-decoration:none;padding:8px 12px" href="tel:${esc(p.telefono)}">Llamar</a></p>` : ''}
      <div class="form-grid">
        ${campo('pe-nom', 'Nombre', inp('pe-nom', p.nombre, 'text', dis), 'ancho')}
        ${campo('pe-esp2', 'Especialidad', sel('pe-esp2', ESPECIALIDADES, p.especialidad, dis))}
        ${campo('pe-tel', 'Teléfono', inp('pe-tel', p.telefono, 'text', dis))}
        ${campo('pe-ubic', 'Ubicación', inp('pe-ubic', p.ubicacion, 'text', dis))}
        ${campo('pe-eq', 'Equipo habitual', inp('pe-eq', p.equipo_habitual, 'text', dis))}
        ${campo('pe-act', 'Activo', `<label class="check-linea"><input type="checkbox" id="pe-act" ${p.activo ? 'checked' : ''} ${dis}> Sigue en la empresa</label>`)}
        ${campo('pe-ver', 'Verificado', `<label class="check-linea"><input type="checkbox" id="pe-ver" ${p.verificado ? 'checked' : ''} ${dis}> Datos revisados</label>`)}
      </div>
      <div class="ayuda" style="font-size:12px;color:var(--gris-texto);margin-bottom:10px">La especialidad decide qué formulario ve en la app (si no se cambió a mano en Administración → Usuarios).</div>
      ${t ? '<div class="acciones"><button class="btn btn-verde" onclick="Gestion2.guardarPersona()">Guardar</button></div>' : ''}`);
  }
  async function guardarPersona() {
    const p = P.abierta;
    const { error } = await sb.from('operadores').update({ nombre: val('pe-nom'), especialidad: val('pe-esp2') || 'OPERADOR',
      telefono: val('pe-tel'), ubicacion: val('pe-ubic'), equipo_habitual: val('pe-eq'), activo: val('pe-act'), verificado: val('pe-ver') }).eq('cedula', p.cedula);
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Guardado', 'success'); cerrarModal(); cargarPers();
  }

  // ════════════════════════════════════════════════════════════════
  // REPORTES DE POWER BI
  //
  // Se cargan en Administración → Reportes. Power BI pide que la
  // persona inicie sesión con su cuenta de Microsoft la primera vez.
  // ════════════════════════════════════════════════════════════════
  const R = { lista: null, actual: null };
  async function pintarBI() {
    const s = $('screen-bi');
    s.innerHTML = '<div class="empty-state">Cargando…</div>';
    const { data, error } = await sb.from('reportes_bi').select('*').eq('activo', true).order('orden').order('nombre');
    if (error) return s.innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    R.lista = data || [];
    if (!R.lista.length) return s.innerHTML = '<div class="empty-state">No hay reportes cargados. Se agregan en Administración → Reportes.</div>';
    let guardado = null;
    try { guardado = Number(localStorage.getItem('reporte_bi_actual')); } catch (e) { /* nada */ }
    R.actual = R.lista.find(r => r.id === guardado) || R.lista[0];
    pintarReporte();
  }
  function pintarReporte() {
    const r = R.actual;
    $('screen-bi').innerHTML = `
      <div class="barra-acciones" style="margin-bottom:8px">
        ${R.lista.length > 1 ? `<div class="g-sub" style="margin:0;flex:1">${R.lista.map(x =>
          `<button class="${x.id === r.id ? 'on' : ''}" onclick="Gestion2.verReporte(${x.id})">${esc(x.nombre)}</button>`).join('')}</div>`
          : `<div class="info"><b style="font-size:14px;color:var(--azul-oscuro)">${esc(r.nombre)}</b></div>`}
        <button class="btn-filtro" onclick="Gestion2.reporteCompleto()">Pantalla completa</button>
        <a class="btn-filtro" style="text-decoration:none;color:inherit" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir en Power BI</a>
      </div>
      <div id="bi-marco" class="bi-marco"><iframe title="${esc(r.nombre)}" src="${esc(r.url)}" allowfullscreen></iframe></div>
      <p class="cambio" style="margin-top:6px">Si pide iniciar sesión, entrá con tu cuenta de Microsoft de Tecsul. Los datos se actualizan según la programación del reporte en Power BI.</p>`;
  }
  function verReporte(id) {
    R.actual = R.lista.find(r => r.id === id) || R.lista[0];
    try { localStorage.setItem('reporte_bi_actual', String(R.actual.id)); } catch (e) { /* nada */ }
    pintarReporte();
  }
  function reporteCompleto() {
    const el = $('bi-marco');
    if (el.requestFullscreen) el.requestFullscreen(); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else window.open(R.actual.url, '_blank');
  }

  // ════════════════════════════════════════════════════════════════
  function mostrar(n) {
    if (!document.getElementById('g2-estilos')) {
      const st = document.createElement('style');
      st.id = 'g2-estilos';
      st.textContent = `.bi-marco { width: 100%; height: calc(100vh - 190px); min-height: 420px; background: #fff;
          border: 1px solid var(--gris-borde); border-radius: 8px; overflow: hidden; }
        .bi-marco iframe { width: 100%; height: 100%; border: 0; display: block; }
        .bi-marco:fullscreen { border-radius: 0; height: 100vh; }`;
      document.head.appendChild(st);
    }
    ({ mant: pintarMant, alq: pintarAlq, seg: pintarSeg, pers: pintarPers, bi: pintarBI })[n]();
  }

  return {
    mostrar, mantVista, mantTarjeta, mantOrdenar, mantRepintar, mantExportar, mantCompartir, abrirPlan, planModo, guardarPlan,
    desactivarPlan, registrarService, nuevoPlan, crearPlanesFaltantes, hechosPeriodo, hechosRepintar, hechosExportar,
    alqVista, alqMes, guardarFact, liqCompartir, liqExportar, contratosRepintar, abrirContrato, contratoSumarEquipo,
    contratoQuitarEquipo, guardarContrato,
    segTarjeta, segOrdenar, segRepintar, segExportar, abrirSeguro, renovarSeguro, guardarSeguro,
    persTarjeta, persOrdenar, persRepintar, persMes, persExportar, persParaUsuarios, abrirPersona, guardarPersona,
    verReporte, reporteCompleto
  };
})();
