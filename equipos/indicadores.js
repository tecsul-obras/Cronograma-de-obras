// ══════════════════════════════════════════════════════════════════
// INDICADORES — Tecsul S.A.E. · v20261028f (SQL 69)
//
// Lo que se miraba en Power BI y ahora sale de la app (flota.html):
//   · Disponibilidad %: por equipo, tipo o asignación y por mes. Un día
//     cuenta como parado con OT de taller abierta, OT de pista ≥ 6 h, paro
//     del parte > 6 h o el equipo Inoperativo en la flota (desde 01/10/2025;
//     antes de octubre de 2026 sale de las OT y los partes con falla).
//     La cuenta la hace la base: indicadores_equipo_mes(), la misma que
//     usa Power BI (v_powerbi_indicadores_equipo_mes).
//   · Utilización %: horas de horómetro del parte contra horas laborales
//     (10 h × días laborales: lun-vie 1, sábado ½, domingo y feriado 0) y
//     contra las horas mínimas del mes.
//   · Control de carga: equipos asignados sin parte o sin carga de
//     combustible hace N días (v_alertas_carga).
// Usa las utilidades de flota.html ($, esc, fmtNum, fmtFecha, abrirModal,
// toast, abrirFicha, flota, MS, leerLocal, guardarLocal).
// ══════════════════════════════════════════════════════════════════
window.Indicadores = (() => {
  const mesActual = () => new Date().toISOString().slice(0, 7);
  const sumarMeses = (m, n) => { const [a, b] = m.split('-').map(Number); const d = new Date(Date.UTC(a, b - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const finDeMes = (m) => { const [a, b] = m.split('-').map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };
  const NOMBRE_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const etiquetaMes = (m) => NOMBRE_MES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(2, 4);
  const num = (v) => v === null || v === undefined || v === '' ? 0 : Number(v);
  const pct = (v) => v === null || v === undefined || isNaN(v) ? '' : fmtNum(v * 100, 0) + ' %';
  const SIN = '(sin dato)';

  const guardado = (typeof leerLocal === 'function' && leerLocal('ind_estado')) || {};
  const I = {
    vista: guardado.vista || 'disp',                  // disp | uso | carga
    desde: sumarMeses(mesActual(), -2), hasta: mesActual(),
    agrupar: guardado.agrupar || 'tipo',               // equipo | tipo | asignacion
    contra: guardado.contra || 'laborales',            // laborales | minimas
    datos: null, clave: null, cargando: false, error: null,
    carga: null, nParte: guardado.nParte || 3, nComb: guardado.nComb || 7, cargaFiltro: guardado.cargaFiltro || 'alguno',
  };
  const recordar = () => typeof guardarLocal === 'function' && guardarLocal('ind_estado',
    { vista: I.vista, agrupar: I.agrupar, contra: I.contra, nParte: I.nParte, nComb: I.nComb, cargaFiltro: I.cargaFiltro });

  // ════════════════════════════════════════════════════════════════
  function mostrar() {
    estilos();
    const s = $('screen-ind');
    s.innerHTML = `
      <div class="g-sub">${[['disp', 'Disponibilidad'], ['uso', 'Utilización'], ['carga', 'Control de carga']].map(([k, t]) =>
        `<button class="${I.vista === k ? 'on' : ''}" onclick="Indicadores.vista('${k}')">${t}</button>`).join('')}</div>
      <div id="ind-cuerpo"></div>`;
    if (I.vista === 'carga') return pintarCarga();
    pintarFiltros();
    cargar();
  }
  function vista(v) { I.vista = v; recordar(); mostrar(); }
  function ir(v) { I.vista = v; recordar(); mostrarPantalla('ind'); }

  // ── Disponibilidad y utilización ────────────────────────────────
  function pintarFiltros() {
    const prev = (id) => $(id) ? MS.valores(id) : (I['f_' + id] || []);
    const d = I.datos || [];
    const opciones = (k) => [...new Set(d.map(x => x[k] || SIN))].sort((a, b) => a.localeCompare(b, 'es'));
    const ms = (id, t, k) => { const v = prev(id); return `<div class="filtro"><label>${t}</label><select id="${id}" class="ms" onchange="Indicadores.repintar()">
      <option value="" ${v.length ? '' : 'selected'}>Todos</option>${opciones(k).map(o => `<option ${v.includes(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`; };
    $('ind-cuerpo').innerHTML = `
      <div class="filtros">
        <div class="filtro siempre"><label>Desde</label><input type="month" id="ind-desde" value="${I.desde}" min="2025-10" onchange="Indicadores.periodo()"></div>
        <div class="filtro siempre"><label>Hasta</label><input type="month" id="ind-hasta" value="${I.hasta}" min="2025-10" onchange="Indicadores.periodo()"></div>
        <div class="filtro siempre"><label>Ver por</label><select id="ind-agrupar" onchange="Indicadores.agrupar(this.value)">
          ${[['tipo', 'Tipo de equipo'], ['asignacion', 'Asignación'], ['equipo', 'Equipo']].map(([k, t]) => `<option value="${k}" ${I.agrupar === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${I.vista === 'uso' ? `<div class="filtro siempre"><label>Contra</label><select id="ind-contra" onchange="Indicadores.contra(this.value)">
          <option value="laborales" ${I.contra === 'laborales' ? 'selected' : ''}>Horas laborales</option>
          <option value="minimas" ${I.contra === 'minimas' ? 'selected' : ''}>Horas mínimas</option></select></div>` : ''}
        ${ms('ind-cat', 'Categoría', 'categoria_txt')}
        ${ms('ind-prop', 'Propiedad', 'propiedad')}
        ${ms('ind-tipo', 'Tipo', 'tipo_equipo')}
        ${ms('ind-asig', 'Asignación', 'asignacion')}
        <div class="filtro crece"><label>Buscar</label><input type="text" id="ind-q" value="${esc(I.q || '')}" placeholder="Equipo, tipo…" oninput="Indicadores.repintar()"></div>
        <div class="filtro siempre"><label>&nbsp;</label><div style="display:flex;gap:6px">
          <button class="btn-filtro" onclick="Indicadores.recargar()">Actualizar</button>
          <button class="btn-filtro" onclick="Indicadores.exportar()">Exportar</button></div></div>
      </div>
      <div class="tarjetas" id="ind-tarjetas"></div>
      <div id="ind-lista"><div class="empty-state">Cargando…</div></div>`;
  }

  async function cargar(forzar) {
    const clave = I.desde + '|' + I.hasta;
    if (!forzar && I.datos && I.clave === clave) return repintar();
    if (I.cargando) return;
    I.cargando = true; I.error = null;
    try {
      const out = [];
      for (let i = 0; i < 20; i++) {
        const { data, error } = await sb.rpc('indicadores_equipo_mes', { p_desde: I.desde + '-01', p_hasta: finDeMes(I.hasta) })
          .order('mes').order('equipo_id').range(i * 1000, i * 1000 + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      I.datos = out.map(x => Object.assign(x, { mes: String(x.mes).slice(0, 7),
        categoria_txt: x.categoria === 'vehiculo_liviano' ? 'Vehículo liviano' : 'Equipo', asignacion: x.asignacion || SIN,
        tipo_equipo: x.tipo_equipo || SIN, propiedad: x.propiedad || 'Propio' }));
      I.clave = clave;
    } catch (e) {
      I.error = /indicadores_equipo_mes/.test(e.message || '') ? 'Falta correr en Supabase el SQL 69 (indicadores).' : 'No se pudo cargar: ' + (e.message || e);
    } finally { I.cargando = false; }
    if (I.vista === 'carga' || !$('ind-lista')) return;
    pintarFiltros();
    repintar();
  }
  function periodo() {
    let d = $('ind-desde').value || I.desde, h = $('ind-hasta').value || I.hasta;
    if (d < '2025-10') d = '2025-10';
    if (d > h) [d, h] = [h, d];
    I.desde = d; I.hasta = h;
    $('ind-lista').innerHTML = '<div class="empty-state">Cargando…</div>';
    cargar();
  }
  function recargar() { cargar(true); }
  function agrupar(v) { I.agrupar = v; recordar(); repintar(); }
  function contra(v) { I.contra = v; recordar(); repintar(); }

  function filtradas() {
    const q = (($('ind-q') || {}).value || '').toLowerCase().trim();
    I.q = q;
    return (I.datos || []).filter(x => MS.ok('ind-cat', x.categoria_txt) && MS.ok('ind-prop', x.propiedad) && MS.ok('ind-tipo', x.tipo_equipo)
      && MS.ok('ind-asig', x.asignacion) && (I.vista !== 'uso' || x.usa_horometro !== false)
      && (!q || [x.equipo_id, x.equipo, x.tipo_equipo, x.asignacion].join(' ').toLowerCase().includes(q)));
  }
  const meses = () => { const l = []; for (let m = I.desde; m <= I.hasta && l.length < 36; m = sumarMeses(m, 1)) l.push(m); return l; };

  // Suma lo necesario para el % (no se promedian porcentajes)
  function acumular(filas) {
    const a = { equipos: new Set(), dias: 0, parado: 0, taller: 0, pista: 0, operador: 0, flota: 0, horas: 0, lab: 0, min: 0, horasConMin: 0, partes: 0 };
    filas.forEach(x => {
      a.equipos.add(x.equipo_id);
      a.dias += num(x.dias_calendario); a.parado += num(x.dias_parado); a.taller += num(x.dias_ot_taller); a.pista += num(x.dias_ot_pista);
      a.operador += num(x.dias_paro_operador); a.flota += num(x.dias_inoperativo_flota); a.partes += num(x.dias_con_parte);
      a.horas += num(x.horas_maquina); a.lab += num(x.horas_laborales);
      if (num(x.minimo_periodo) > 0) { a.min += num(x.minimo_periodo); a.horasConMin += num(x.horas_maquina); }
    });
    return Object.assign(a, { n: a.equipos.size, disp: a.dias ? 1 - a.parado / a.dias : null,
      uso: a.lab ? a.horas / a.lab : null, cumpl: a.min ? a.horasConMin / a.min : null });
  }
  const valor = (a) => I.vista === 'disp' ? a.disp : I.contra === 'minimas' ? a.cumpl : a.uso;
  function color(v) {
    if (v === null || v === undefined) return '';
    if (I.vista === 'disp') return v >= 0.9 ? 'verde' : v >= 0.8 ? 'amarillo' : 'rojo';
    if (I.contra === 'minimas') return v >= 1 ? 'verde' : v >= 0.8 ? 'amarillo' : 'rojo';
    return v >= 0.6 ? 'verde' : v >= 0.4 ? 'amarillo' : 'rojo';
  }
  const claveDe = (x) => I.agrupar === 'equipo' ? x.equipo_id : I.agrupar === 'tipo' ? x.tipo_equipo : x.asignacion;

  function repintar() {
    if (!$('ind-lista')) return;
    if (I.error) { $('ind-lista').innerHTML = `<div class="aviso-caja rojo">${esc(I.error)}</div>`; $('ind-tarjetas').innerHTML = ''; return; }
    if (!I.datos) return;
    const f = filtradas(), ms = meses(), tot = acumular(f);
    const tj = I.vista === 'disp'
      ? [[pct(tot.disp), 'Disponibilidad', color(tot.disp)], [tot.n, 'Equipos'], [fmtNum(tot.parado), 'Días parados'],
         [fmtNum(tot.taller), 'Días en OT de taller'], [fmtNum(tot.pista), 'Días en OT de pista'], [fmtNum(tot.operador), 'Días con paro del parte'], [fmtNum(tot.flota), 'Días Inoperativo (flota)']]
      : [[pct(tot.uso), 'Contra horas laborales', I.contra === 'laborales' ? color(tot.uso) : ''], [pct(tot.cumpl), 'Contra horas mínimas', I.contra === 'minimas' ? color(tot.cumpl) : ''],
         [fmtNum(tot.horas), 'Horas del parte'], [fmtNum(tot.lab), 'Horas laborales'], [fmtNum(tot.min), 'Horas mínimas'], [tot.n, 'Equipos']];
    $('ind-tarjetas').innerHTML = tj.map(([n, t, c]) => `<div class="tarjeta ${c === 'verde' ? 'bien' : c === 'amarillo' ? 'medio' : c === 'rojo' ? 'malo' : ''}">
      <span class="n">${n || '—'}</span><span class="t">${t}</span></div>`).join('');
    if (!f.length) { $('ind-lista').innerHTML = '<div class="empty-state">No hay equipos con esos filtros.</div>'; return; }

    const grupos = new Map();
    f.forEach(x => { const k = claveDe(x); (grupos.get(k) || grupos.set(k, []).get(k)).push(x); });
    const filas = [...grupos.entries()].map(([k, l]) => {
      const a = acumular(l), porMes = {};
      ms.forEach(m => { const lm = l.filter(x => x.mes === m); porMes[m] = lm.length ? acumular(lm) : null; });
      return { k, l, a, porMes, v: valor(a) };
    }).sort((x, y) => (x.v ?? 9) - (y.v ?? 9) || String(x.k).localeCompare(String(y.k), 'es'));
    I.filas = filas;
    const eq = I.agrupar === 'equipo';
    const extra = I.vista === 'disp'
      ? [['Días', a => fmtNum(a.dias)], ['Parado', a => fmtNum(a.parado)], ['Taller', a => fmtNum(a.taller)], ['Pista', a => fmtNum(a.pista)],
         ['Paro parte', a => fmtNum(a.operador)], ['Inop. flota', a => fmtNum(a.flota)]]
      : [['Horas parte', a => fmtNum(a.horas)], ['Horas laborales', a => fmtNum(a.lab)], ['Mínimas', a => a.min ? fmtNum(a.min) : ''],
         [I.contra === 'minimas' ? 'Contra laborales' : 'Contra mínimas', a => pct(I.contra === 'minimas' ? a.uso : a.cumpl)]];
    const celda = (a) => { if (!a) return '<td></td>'; const v = valor(a); return `<td>${v === null ? '' : `<span class="chip ${color(v)}">${pct(v)}</span>`}</td>`; };
    $('ind-lista').innerHTML = `<div class="tabla-wrap"><table class="tabla ind-tabla"><thead><tr>
        <th>${eq ? 'Equipo' : I.agrupar === 'tipo' ? 'Tipo de equipo' : 'Asignación'}</th>${eq ? '<th>Tipo</th><th>Asignación</th>' : '<th>Equipos</th>'}
        ${ms.map(m => `<th>${etiquetaMes(m)}</th>`).join('')}<th>Período</th>${extra.map(([t]) => `<th>${t}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((g, i) => `<tr onclick="Indicadores.detalle(${i})">
        <td><b>${esc(g.k)}</b>${eq && g.l[0].equipo ? `<br><small>${esc(g.l[0].equipo)}</small>` : ''}</td>
        ${eq ? `<td>${esc(g.l[0].tipo_equipo)}</td><td>${esc(g.l[0].asignacion)}</td>` : `<td>${g.a.n}</td>`}
        ${ms.map(m => celda(g.porMes[m])).join('')}${celda(g.a).replace('<td>', '<td class="ind-total">')}
        ${extra.map(([, fn]) => `<td>${fn(g.a)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">${I.vista === 'disp'
        ? 'Disponibilidad = 1 − días parados ÷ días calendario. Parado: OT de taller abierta (sin preventivos programados), OT de pista con 6 h o más de un técnico, más de 6 h de paro en el parte o Inoperativo en la flota. Asignación y tipo: los de hoy en la flota.'
        : 'Horas de horómetro del parte. Horas laborales = 10 h × días laborales (lunes a viernes 1, sábado ½, domingo y feriado 0). Mínimas = horas mínimas del mes de la ficha (o Mínimo Hr del maestro de tarifas), prorrateadas por los días del período. Solo equipos con horómetro.'}
        Tocá una fila para ver el detalle.</p>`;
  }

  // Detalle: días parados del grupo (o del equipo) en el período
  function detalle(i) {
    const g = (I.filas || [])[i];
    if (!g) return;
    if (I.agrupar === 'equipo') return detalleEquipo(g.k);
    const k = g.k, l = g.l;
    {
      const por = new Map();
      l.forEach(x => (por.get(x.equipo_id) || por.set(x.equipo_id, []).get(x.equipo_id)).push(x));
      const filas = [...por.entries()].map(([id, lx]) => ({ id, eq: lx[0], a: acumular(lx) })).sort((x, y) => (valor(x.a) ?? 9) - (valor(y.a) ?? 9));
      abrirModal(`${k} · ${etiquetaMes(I.desde)} a ${etiquetaMes(I.hasta)}`, `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Asignación</th>
        <th>${I.vista === 'disp' ? 'Disponibilidad' : 'Utilización'}</th>${I.vista === 'disp' ? '<th>Días parado</th><th>Taller</th><th>Pista</th><th>Paro parte</th>' : '<th>Horas parte</th><th>Laborales</th><th>Mínimas</th>'}</tr></thead>
        <tbody>${filas.map(x => `<tr onclick="Indicadores.detalleEquipo('${esc(x.id)}')"><td><b>${esc(x.id)}</b></td><td>${esc(x.eq.asignacion)}</td>
          <td><span class="chip ${color(valor(x.a))}">${pct(valor(x.a))}</span></td>
          ${I.vista === 'disp' ? `<td>${x.a.parado}</td><td>${x.a.taller}</td><td>${x.a.pista}</td><td>${x.a.operador}</td>`
            : `<td>${fmtNum(x.a.horas)}</td><td>${fmtNum(x.a.lab)}</td><td>${x.a.min ? fmtNum(x.a.min) : ''}</td>`}</tr>`).join('')}</tbody></table></div>`);
    }
  }
  async function detalleEquipo(k) {
    const l = filtradas().filter(x => x.equipo_id === k);
    abrirModal(`${k} · días parados`, '<div class="empty-state">Cargando…</div>');
    const { data, error } = await sb.rpc('equipo_dia_estado', { p_desde: I.desde + '-01', p_hasta: finDeMes(I.hasta) })
      .eq('equipo_id', k).eq('parado', true).order('fecha', { ascending: false }).limit(1000);
    if (error) return $('modal-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    const a = acumular(l);
    $('modal-cuerpo').innerHTML = `<div class="datos" style="margin-bottom:10px">
        ${[['Disponibilidad', pct(a.disp)], ['Días parado', a.parado + ' de ' + a.dias], ['Horas del parte', fmtNum(a.horas)], ['Utilización', pct(a.uso)],
           ['Contra mínimas', pct(a.cumpl)]].map(([e, v]) => `<div class="dato"><div class="e">${e}</div><div class="v">${v || '—'}</div></div>`).join('')}</div>
      ${!data.length ? '<div class="empty-state">No estuvo parado en el período. 👍</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr>
        <th>Fecha</th><th>Motivo</th><th>OT</th><th>Horas de paro (parte)</th><th>Estado flota</th></tr></thead><tbody>${data.map(d => `<tr style="cursor:default">
        <td>${fmtFecha(d.fecha)}</td><td>${esc(d.motivo)}</td><td>${d.ot_taller || d.ot_pista || ''}${d.ot_pista && !d.ot_taller ? ` (${fmtNum(d.horas_ot_pista, 1)} h)` : ''}</td>
        <td>${num(d.horas_paro) ? fmtNum(d.horas_paro, 1) : ''}</td><td>${esc(d.estado_flota || '')}</td></tr>`).join('')}</tbody></table></div>`}
      ${flota.some(f => f.id === k) ? `<div class="acciones" style="margin-top:10px"><button class="btn btn-gris" onclick="cerrarModal();abrirFicha('${esc(k)}')">Abrir la ficha</button></div>` : ''}`;
  }

  function exportar() {
    const f = filtradas();
    if (!f.length) return toast('No hay nada para exportar', 'warning');
    const cols = ['Mes', 'Equipo', 'Descripción', 'Tipo', 'Categoría', 'Propiedad', 'Asignación', 'Días calendario', 'Días parado', 'OT taller', 'OT pista',
      'Paro parte', 'Inoperativo flota', 'Días con parte', 'Disponibilidad %', 'Horas parte', 'Días laborales', 'Horas laborales', 'Mínimas del período',
      'Utilización %', 'Cumplimiento mínimas %'];
    const n = (v, d = 1) => v === null || v === undefined ? '' : String(Math.round(Number(v) * 10 ** d) / 10 ** d).replace('.', ',');
    const csv = [cols.join(';')].concat(f.map(x => [x.mes, x.equipo_id, x.equipo, x.tipo_equipo, x.categoria_txt, x.propiedad, x.asignacion, x.dias_calendario,
      x.dias_parado, x.dias_ot_taller, x.dias_ot_pista, x.dias_paro_operador, x.dias_inoperativo_flota, x.dias_con_parte, n(num(x.disponibilidad) * 100),
      n(x.horas_maquina), n(x.dias_laborales), n(x.horas_laborales), n(x.minimo_periodo), x.utilizacion === null ? '' : n(x.utilizacion * 100),
      x.cumplimiento_minimo === null ? '' : n(x.cumplimiento_minimo * 100)].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `indicadores_equipos_${I.desde}_${I.hasta}.csv`;
    a.click();
  }

  // ── Control de carga ────────────────────────────────────────────
  async function pintarCarga() {
    const prev = $('cg-asig') ? MS.valores('cg-asig') : [];
    $('ind-cuerpo').innerHTML = `
      <div class="filtros">
        <div class="filtro siempre"><label>Sin parte hace más de</label><div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="cg-np" value="${I.nParte}" min="1" max="90" style="width:70px" onchange="Indicadores.cargaN()"> días</div></div>
        <div class="filtro siempre"><label>Sin combustible hace más de</label><div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="cg-nc" value="${I.nComb}" min="1" max="90" style="width:70px" onchange="Indicadores.cargaN()"> días</div></div>
        <div class="filtro"><label>Mostrar</label><select id="cg-ver" onchange="Indicadores.cargaN()">
          ${[['alguno', 'Sin parte o sin combustible'], ['parte', 'Sin parte'], ['comb', 'Sin combustible'], ['ambos', 'Sin los dos'], ['todos', 'Todos los asignados']]
            .map(([k, t]) => `<option value="${k}" ${I.cargaFiltro === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro"><label>Asignación</label><select id="cg-asig" class="ms" onchange="Indicadores.cargaRepintar()"><option value="" ${prev.length ? '' : 'selected'}>Todas</option>
          ${[...new Set((I.carga || []).map(x => x.asignacion))].sort().map(a => `<option ${prev.includes(a) ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
        <div class="filtro crece"><label>Buscar</label><input type="text" id="cg-q" placeholder="Equipo, operador…" oninput="Indicadores.cargaRepintar()"></div>
        <div class="filtro siempre"><label>&nbsp;</label><div style="display:flex;gap:6px">
          <button class="btn-filtro" onclick="Indicadores.cargaRecargar()">Actualizar</button>
          <button class="btn-filtro" onclick="Indicadores.cargaExportar()">Exportar</button></div></div>
      </div>
      <div class="tarjetas" id="cg-tarjetas"></div>
      <div id="cg-lista"><div class="empty-state">Cargando…</div></div>`;
    if (!I.carga) {
      const { data, error } = await sb.from('v_alertas_carga').select('*').order('equipo_id');
      if (error) return $('cg-lista').innerHTML = `<div class="aviso-caja rojo">${/v_alertas_carga/.test(error.message)
        ? 'Falta correr en Supabase el SQL 69 (control de carga).' : esc(error.message)}</div>`;
      I.carga = data || [];
      return pintarCarga();
    }
    cargaRepintar();
  }
  const sinParte = (x) => x.dias_sin_parte === null || x.dias_sin_parte > I.nParte;
  const sinComb = (x) => x.dias_sin_carga === null || x.dias_sin_carga > I.nComb;
  function cargaN() {
    I.nParte = Math.max(1, Number($('cg-np').value) || 3); I.nComb = Math.max(1, Number($('cg-nc').value) || 7);
    I.cargaFiltro = $('cg-ver').value; recordar(); cargaRepintar();
  }
  function cargaVisibles() {
    const q = (($('cg-q') || {}).value || '').toLowerCase().trim();
    const fn = { alguno: x => sinParte(x) || sinComb(x), parte: sinParte, comb: sinComb, ambos: x => sinParte(x) && sinComb(x), todos: () => true }[I.cargaFiltro] || (() => true);
    return (I.carga || []).filter(x => fn(x) && MS.ok('cg-asig', x.asignacion)
      && (!q || [x.equipo_id, x.descripcion, x.tipo, x.operador_habitual, x.ubicacion].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.dias_sin_parte ?? 9999) - (a.dias_sin_parte ?? 9999) || (b.dias_sin_carga ?? 9999) - (a.dias_sin_carga ?? 9999));
  }
  function cargaRepintar() {
    if (!$('cg-lista') || !I.carga) return;
    const todos = (I.carga || []).filter(x => MS.ok('cg-asig', x.asignacion));
    const nP = todos.filter(sinParte).length, nC = todos.filter(sinComb).length, nA = todos.filter(x => sinParte(x) && sinComb(x)).length;
    $('cg-tarjetas').innerHTML = [[todos.length, 'Equipos asignados', ''], [nP, `Sin parte hace +${I.nParte} días`, nP ? 'malo' : 'bien', 'parte'],
      [nC, `Sin combustible hace +${I.nComb} días`, nC ? 'medio' : 'bien', 'comb'], [nA, 'Sin los dos', nA ? 'malo' : 'bien', 'ambos']]
      .map(([n, t, c, k]) => `<button class="tarjeta ${c} ${k && I.cargaFiltro === k ? 'sel' : ''}" ${k ? `onclick="Indicadores.cargaTarjeta('${k}')"` : ''}>
        <span class="n">${n}</span><span class="t">${t}</span></button>`).join('');
    const l = cargaVisibles();
    const dias = (d, n) => d === null || d === undefined ? '<span class="chip rojo">nunca</span>' : `<span class="chip ${d > n ? (d > n * 3 ? 'rojo' : 'amarillo') : 'verde'}">${d === 0 ? 'hoy' : d + ' d'}</span>`;
    $('cg-lista').innerHTML = !l.length ? '<div class="empty-state">Todos los equipos asignados están al día. 👍</div>' : `
      <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th>Asignación</th><th>Ubicación</th><th>Estado</th><th>Operador</th>
        <th>Último parte</th><th>Sin parte</th><th>Última carga</th><th>Sin combustible</th></tr></thead><tbody>${l.map(x => `
        <tr onclick="${flota.some(f => f.id === x.equipo_id) ? `abrirFicha('${esc(x.equipo_id)}')` : ''}"><td><b>${esc(x.equipo_id)}</b></td><td>${esc(x.tipo || x.descripcion || '')}</td>
          <td>${esc(x.asignacion || '')}</td><td>${esc(x.ubicacion || '')}</td><td>${esc(x.estado || '')}</td><td>${esc(x.operador_habitual || '')}</td>
          <td>${fmtFecha(x.ultimo_parte)}</td><td>${dias(x.dias_sin_parte, I.nParte)}</td>
          <td>${fmtFecha(x.ultima_carga)}${x.ultima_carga && x.ultima_carga === x.ultima_carga_en_parte && x.ultima_carga !== x.ultimo_despacho ? ' <small>(parte)</small>' : ''}</td>
          <td>${dias(x.dias_sin_carga, I.nComb)}</td></tr>`).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">Equipos y vehículos activos que llevan parte diario, con asignación en la flota (sin "Sin Asignación" ni Taller)
        y que no están Inoperativos. Carga de combustible: despacho del formulario de combustible o gasoil declarado en el parte. Tocá un equipo para abrir su ficha.</p>`;
  }
  function cargaTarjeta(k) { I.cargaFiltro = I.cargaFiltro === k ? 'alguno' : k; if ($('cg-ver')) $('cg-ver').value = I.cargaFiltro; recordar(); cargaRepintar(); }
  function cargaRecargar() { I.carga = null; pintarCarga(); }
  function cargaExportar() {
    const l = cargaVisibles();
    if (!l.length) return toast('No hay nada para exportar', 'warning');
    const csv = [['Equipo', 'Descripción', 'Tipo', 'Asignación', 'Ubicación', 'Estado', 'Operador', 'Último parte', 'Días sin parte', 'Último despacho',
      'Última carga en parte', 'Días sin combustible'].join(';')].concat(l.map(x => [x.equipo_id, x.descripcion, x.tipo, x.asignacion, x.ubicacion, x.estado,
      x.operador_habitual, x.ultimo_parte, x.dias_sin_parte, x.ultimo_despacho, x.ultima_carga_en_parte, x.dias_sin_carga]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `control_de_carga_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function estilos() {
    if ($('ind-estilos')) return;
    const s = document.createElement('style');
    s.id = 'ind-estilos';
    s.textContent = `
      .ind-tabla td, .ind-tabla th { text-align: center; }
      .ind-tabla td:first-child, .ind-tabla th:first-child { text-align: left; }
      .ind-tabla td small { color: var(--gris-texto); font-size: calc(11px*var(--fs,1)); }
      .ind-tabla td.ind-total { background: #f3f6fb; }`;
    document.head.appendChild(s);
  }

  return { mostrar, vista, ir, periodo, recargar, agrupar, contra, repintar, detalle, detalleEquipo, exportar,
           cargaN, cargaRepintar, cargaTarjeta, cargaRecargar, cargaExportar };
})();
