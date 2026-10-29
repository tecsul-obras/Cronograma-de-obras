// ══════════════════════════════════════════════════════════════════
// AUSENCIAS DEL PERSONAL DE TALLER — Tecsul S.A.E. · v20261028f (SQL 69)
//
// Reemplaza el formulario de Jotform "Reportes - Varios": el supervisor
// elige a una o varias personas de su taller, desde y hasta, y el motivo
// (Vacaciones, Receso en obra, Ausencia justificada). Se guarda una fila
// por persona en taller_ausencias; Órdenes de trabajo › Horas y costos
// muestra cada día de cada persona con las horas trabajadas o el motivo.
//
// Quién: lo decide la base (puede_cargar_ausencias): supervisores
// (especialidad SUPERVISOR), taller y admin central cargan; gerente ve.
// Corregir y borrar: taller y admin central siempre; el supervisor, lo
// que cargó él. Necesita señal (no queda en el teléfono).
// ══════════════════════════════════════════════════════════════════
window.Ausencias = (() => {
  const MOTIVOS = [
    { k: 'Vacaciones', ic: '🏖️', c: 'vac' },
    { k: 'Receso en obra', ic: '🚧', c: 'rec' },
    { k: 'Ausencia justificada', ic: '📄', c: 'aj' },
  ];
  const TALLER = /MECANIC|ELECTRIC|GOMER|AYUDANTE|SUPERVISOR|SOLDADOR|TORNER|LUBRIC/i;
  const DIA_MS = 24 * 3600 * 1000;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const isoLocal = (d) => { d = new Date(d); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const hoy = () => isoLocal(new Date());
  const sumarDias = (f, n) => isoLocal(new Date(new Date(f + 'T12:00:00').getTime() + n * DIA_MS));
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DIA_MS) + 1;
  const fFecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
  const permiso = () => (window.Menu && Menu.permisoAusencias ? Menu.permisoAusencias() : null);
  const carga = () => permiso() === 'cargar';
  const esTaller = () => !!sesion && ['taller', 'admin_central'].includes(sesion.rol);

  const S = {
    personal: null,            // operadores de taller (cedula, nombre, especialidad, cargo, supervisor_cedula, activo)
    lista: null,               // ausencias del período
    desde: sumarDias(hoy(), -30), hasta: sumarDias(hoy(), 60),
    q: '', motivo: '',
    form: { supervisor: '', personas: new Set(), desde: hoy(), hasta: hoy(), motivo: '', obs: '', soloSuyos: true, buscar: '' },
    editando: null,            // id de la ausencia que se corrige
    sinTabla: false,
  };

  // ════════════════════════════════════════════════════════════════
  async function mostrar() {
    estilos();
    const caja = $('screen-ausencias');
    if (!caja) return;
    caja.innerHTML = `<div id="au-form"></div>
      <div class="card"><div class="card-header">📋 Ausencias cargadas</div><div class="card-body">
        <div class="filtros">
          <div class="filtro"><label>Desde</label><input type="date" id="au-desde" value="${S.desde}" onchange="Ausencias.periodo()"></div>
          <div class="filtro"><label>Hasta</label><input type="date" id="au-hasta" value="${S.hasta}" onchange="Ausencias.periodo()"></div>
          <div class="filtro"><label>Motivo</label><select id="au-motivo" onchange="Ausencias.filtrar()"><option value="">Todos</option>
            ${MOTIVOS.map(m => `<option ${S.motivo === m.k ? 'selected' : ''}>${m.k}</option>`).join('')}</select></div>
          <div class="filtro crece"><label>Buscar</label><input type="text" id="au-q" value="${esc(S.q)}" placeholder="Persona, supervisor…" oninput="Ausencias.filtrar()"></div>
          <div class="filtro"><label>&nbsp;</label><div style="display:flex;gap:6px">
            <button class="btn-filtro" onclick="Ausencias.cargar()">Actualizar</button>
            <button class="btn-filtro exportar" onclick="Ausencias.exportar()">Exportar</button></div></div>
        </div>
        <div class="hist-info" id="au-info"></div>
        <div id="au-lista"><div class="empty-state">Cargando…</div></div>
      </div></div>`;
    await cargarPersonal();
    pintarForm();
    cargar();
  }

  async function cargarPersonal() {
    if (S.personal) return;
    const r = await sb.from('operadores').select('cedula,nombre,especialidad,cargo,supervisor_cedula,activo').order('nombre');
    if (r.error) {   // sin el SQL 69 no están cargo ni supervisor
      const r2 = await sb.from('operadores').select('cedula,nombre,especialidad,activo').order('nombre');
      S.personal = r2.data || [];
      S.sinTabla = true;
      return;
    }
    S.personal = r.data || [];
  }
  const supervisores = () => (S.personal || []).filter(p => p.activo !== false && p.especialidad === 'SUPERVISOR');
  const delTaller = () => (S.personal || []).filter(p => p.activo !== false && (TALLER.test(p.especialidad || '') || p.supervisor_cedula || p.cargo));
  // El supervisor que entra: por cédula, o por nombre (los usuarios de taller de los
  // supervisores tienen un nombre de usuario en vez de la cédula: «lucas», «diegoflores»)
  const normNom = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  const yoSupervisor = (sups) => {
    if (!sesion) return null;
    const porCed = sups.find(s => s.cedula === sesion.cedula);
    if (porCed) return porCed;
    const yo = normNom(sesion.nombre);
    if (yo.length < 2) return null;
    const l = sups.filter(s => { const n = normNom(s.nombre); return yo.every(p => n.includes(p)); });
    return l.length === 1 ? l[0] : null;
  };
  const nombreDe = (ced) => { const p = (S.personal || []).find(x => x.cedula === ced); return p ? p.nombre : (ced || ''); };

  // ── Formulario ──────────────────────────────────────────────────
  function pintarForm() {
    const box = $('au-form');
    if (!box) return;
    if (S.sinTabla) { box.innerHTML = '<div class="aviso-caja">Falta correr en Supabase el SQL 69 (ausencias del personal de taller).</div>'; return; }
    if (!carga()) { box.innerHTML = '<div class="aviso-caja">Podés ver las ausencias cargadas. Las cargan los supervisores, taller y administración central.</div>'; return; }
    const f = S.form;
    const sups = supervisores();
    if (!f.supervisor) f.supervisor = (yoSupervisor(sups) || {}).cedula || '';
    const ed = S.editando ? (S.lista || []).find(a => a.id === S.editando) : null;
    box.innerHTML = `<div class="card"><div class="card-header">${ed ? '✏️ Corregir ausencia' : '🗓️ Cargar ausencia'}</div><div class="card-body">
      <div class="field"><label>Supervisor <span class="req">*</span></label>
        <select id="au-sup" onchange="Ausencias.campo('supervisor', this.value)"><option value="">Seleccioná el supervisor responsable</option>
          ${sups.map(s => `<option value="${esc(s.cedula)}" ${s.cedula === f.supervisor ? 'selected' : ''}>${esc(s.cedula)} · ${esc(s.nombre)}</option>`).join('')}</select></div>
      ${ed ? `<div class="field"><label>Persona</label><div class="computed-val">${esc(nombreDe(ed.cedula))}</div></div>` : `
      <div class="field"><label>Personal de taller <span class="req">*</span> <span id="au-nsel" class="au-n"></span></label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <input type="text" id="au-buscar" value="${esc(f.buscar)}" placeholder="Buscar por nombre o cédula…" oninput="Ausencias.buscarPersona(this.value)" style="flex:1;min-width:180px;padding:9px 11px;border:1.5px solid var(--gris-borde);border-radius:8px">
          ${f.supervisor ? `<label class="au-check"><input type="checkbox" ${f.soloSuyos ? 'checked' : ''} onchange="Ausencias.campo('soloSuyos', this.checked)"> Solo su personal</label>` : ''}
        </div>
        <div class="au-personas" id="au-personas"></div>
        <div class="ayuda">Se pueden marcar varias personas: se carga la misma ausencia para cada una.</div></div>`}
      <div class="field-row">
        <div class="field"><label>Fecha inicio <span class="req">*</span></label><input type="date" id="au-fd" value="${f.desde}" onchange="Ausencias.campo('desde', this.value)"></div>
        <div class="field"><label>Fecha final <span class="req">*</span></label><input type="date" id="au-fh" value="${f.hasta}" onchange="Ausencias.campo('hasta', this.value)"></div>
      </div>
      <div class="hist-info" id="au-dias" style="margin-top:-8px"></div>
      <div class="field"><label>Motivo <span class="req">*</span></label><div class="au-motivos">
        ${MOTIVOS.map(m => `<button type="button" class="au-mot ${m.c} ${f.motivo === m.k ? 'on' : ''}" onclick="Ausencias.campo('motivo', '${m.k}')">${m.ic} ${m.k}</button>`).join('')}</div></div>
      <div class="field"><label>Observaciones</label><textarea id="au-obs" oninput="Ausencias.campo('obs', this.value, true)" placeholder="Opcional">${esc(f.obs)}</textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${ed ? '<button class="btn-prev" onclick="Ausencias.cancelar()">Cancelar</button>' : ''}
        <button class="btn-submit" style="display:block" onclick="Ausencias.guardar()">${ed ? 'Guardar cambios' : 'Guardar ausencia'}</button></div>
    </div></div>`;
    pintarPersonas();
    pintarDias();
  }

  function pintarPersonas() {
    const box = $('au-personas');
    if (!box) return;
    const f = S.form;
    const q = f.buscar.toLowerCase().trim();
    let l = delTaller().filter(p => p.especialidad !== 'SUPERVISOR' || f.personas.has(p.cedula) || p.supervisor_cedula === f.supervisor);
    if (f.supervisor && f.soloSuyos) l = l.filter(p => p.supervisor_cedula === f.supervisor || f.personas.has(p.cedula));
    if (q) l = l.filter(p => (p.nombre + ' ' + p.cedula).toLowerCase().includes(q));
    box.innerHTML = !l.length ? `<div class="empty-state" style="padding:14px">${f.supervisor && f.soloSuyos
        ? 'Este supervisor no tiene personal asignado. Desmarcá "Solo su personal" para ver a todos.' : 'Nadie con esa búsqueda.'}</div>`
      : l.map(p => `<label class="au-persona ${f.personas.has(p.cedula) ? 'on' : ''}"><input type="checkbox" ${f.personas.has(p.cedula) ? 'checked' : ''}
          onchange="Ausencias.marcar('${esc(p.cedula)}', this.checked)"><span><b>${esc(p.nombre)}</b>
          <small>${esc([p.cedula, p.cargo || p.especialidad].filter(Boolean).join(' · '))}</small></span></label>`).join('');
    const n = $('au-nsel');
    if (n) n.textContent = f.personas.size ? `(${f.personas.size} elegida${f.personas.size > 1 ? 's' : ''})` : '';
  }
  function pintarDias() {
    const f = S.form, box = $('au-dias');
    if (!box) return;
    box.textContent = f.desde && f.hasta ? (f.hasta < f.desde ? '⚠️ La fecha final es anterior a la de inicio.'
      : `${dias(f.desde, f.hasta)} día(s), del ${fFecha(f.desde)} al ${fFecha(f.hasta)}.`) : '';
  }

  function campo(k, v, sinPintar) {
    S.form[k] = v;
    if (k === 'desde' && (!S.form.hasta || S.form.hasta < v)) { S.form.hasta = v; if ($('au-fh')) $('au-fh').value = v; }
    if (sinPintar) return;
    if (k === 'supervisor' || k === 'soloSuyos' || k === 'motivo') return pintarForm();
    pintarDias();
  }
  function buscarPersona(v) { S.form.buscar = v; pintarPersonas(); }
  function marcar(ced, on) { on ? S.form.personas.add(ced) : S.form.personas.delete(ced); pintarPersonas(); }
  function cancelar() { S.editando = null; limpiar(); pintarForm(); }
  function limpiar() { Object.assign(S.form, { personas: new Set(), desde: hoy(), hasta: hoy(), motivo: '', obs: '', buscar: '' }); }

  async function guardar() {
    const f = S.form, ed = S.editando;
    if (!navigator.onLine) return toast('Sin señal: las ausencias se cargan con conexión', 'warning');
    if (!f.supervisor) return toast('Elegí el supervisor', 'warning');
    if (!ed && !f.personas.size) return toast('Marcá al menos una persona', 'warning');
    if (!f.desde || !f.hasta) return toast('Completá las fechas', 'warning');
    if (f.hasta < f.desde) return toast('La fecha final es anterior a la de inicio', 'warning');
    if (dias(f.desde, f.hasta) > 367) return toast('Una ausencia no puede pasar de un año', 'warning');
    if (!f.motivo) return toast('Elegí el motivo', 'warning');
    const cedulas = ed ? [(S.lista || []).find(a => a.id === ed).cedula] : [...f.personas];
    mostrarCarga('Guardando…');
    try {
      // ¿Ya tiene otra ausencia que se pisa con estas fechas?
      let q = sb.from('taller_ausencias').select('id,cedula,desde,hasta,motivo').in('cedula', cedulas).lte('desde', f.hasta).gte('hasta', f.desde);
      if (ed) q = q.neq('id', ed);
      const { data: pisa, error: e1 } = await q;
      if (e1) throw e1;
      if (pisa && pisa.length) {
        ocultarCarga();
        if (!confirm('Ya hay ausencias cargadas en esas fechas:\n\n' + pisa.map(a => `· ${nombreDe(a.cedula)}: ${a.motivo} del ${fFecha(a.desde)} al ${fFecha(a.hasta)}`).join('\n')
          + '\n\n¿Guardar igual? (en Horas y costos se ve la última cargada)')) return;
        mostrarCarga('Guardando…');
      }
      const base = { desde: f.desde, hasta: f.hasta, motivo: f.motivo, supervisor_cedula: f.supervisor, observaciones: f.obs.trim() || null };
      const { data, error } = ed
        ? await sb.from('taller_ausencias').update(base).eq('id', ed).select('id')
        : await sb.from('taller_ausencias').insert(cedulas.map(c => Object.assign({ cedula: c }, base))).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('La base no dejó guardar (permisos)');
      ocultarCarga();
      toast(ed ? 'Ausencia corregida' : `Ausencia cargada (${cedulas.length} persona${cedulas.length > 1 ? 's' : ''})`, 'success');
      S.editando = null;
      const sup = f.supervisor;
      limpiar(); S.form.supervisor = sup;
      pintarForm();
      cargar();
    } catch (e) {
      ocultarCarga();
      toast('No se pudo guardar: ' + (e.message || e), 'error');
    }
  }

  // ── Lista ───────────────────────────────────────────────────────
  function periodo() {
    S.desde = $('au-desde').value || S.desde; S.hasta = $('au-hasta').value || S.hasta;
    if (S.desde > S.hasta) [S.desde, S.hasta] = [S.hasta, S.desde];
    cargar();
  }
  async function cargar() {
    if (S.sinTabla) { if ($('au-lista')) $('au-lista').innerHTML = ''; return; }
    if ($('au-lista') && !S.lista) $('au-lista').innerHTML = '<div class="empty-state">Cargando…</div>';
    const { data, error } = await sb.from('taller_ausencias').select('*').lte('desde', S.hasta).gte('hasta', S.desde)
      .order('desde', { ascending: false }).limit(2000);
    if (error) {
      if ($('au-lista')) $('au-lista').innerHTML = `<div class="aviso-caja">${/taller_ausencias/.test(error.message)
        ? 'Falta correr en Supabase el SQL 69 (ausencias del personal de taller).' : 'No se pudo cargar: ' + esc(error.message)}</div>`;
      return;
    }
    S.lista = data || [];
    filtrar();
  }
  function visibles() {
    const q = (($('au-q') || {}).value || '').toLowerCase().trim();
    S.q = q; S.motivo = ($('au-motivo') || {}).value || '';
    return (S.lista || []).filter(a => (!S.motivo || a.motivo === S.motivo)
      && (!q || [nombreDe(a.cedula), a.cedula, nombreDe(a.supervisor_cedula), a.observaciones].join(' ').toLowerCase().includes(q)));
  }
  const puedeCambiar = (a) => carga() && (esTaller() || (sesion && a.creado_por === sesion.id));
  function filtrar() {
    const box = $('au-lista');
    if (!box) return;
    const l = visibles();
    const tot = l.reduce((n, a) => n + dias(a.desde, a.hasta), 0);
    $('au-info').textContent = `${l.length} ausencia(s) · ${tot} día(s) · ${new Set(l.map(a => a.cedula)).size} persona(s)`;
    if (!l.length) { box.innerHTML = '<div class="empty-state">No hay ausencias en ese período.</div>'; return; }
    const m = (k) => MOTIVOS.find(x => x.k === k) || MOTIVOS[2];
    box.innerHTML = `<div class="au-lista">${l.map(a => `<div class="au-item">
        <div class="au-item-pri"><b>${esc(nombreDe(a.cedula))}</b>
          <span class="au-chip ${m(a.motivo).c}">${m(a.motivo).ic} ${esc(a.motivo)}</span></div>
        <div class="au-item-meta">${fFecha(a.desde)}${a.hasta !== a.desde ? ' al ' + fFecha(a.hasta) : ''} · ${dias(a.desde, a.hasta)} día(s)
          ${a.supervisor_cedula ? ' · Supervisor: ' + esc(nombreDe(a.supervisor_cedula)) : ''}</div>
        ${a.observaciones ? `<div class="au-item-meta">${esc(a.observaciones)}</div>` : ''}
        ${puedeCambiar(a) ? `<div class="au-item-acc"><button class="btn-mini btn-neutro" onclick="Ausencias.editar(${a.id})">Corregir</button>
          <button class="btn-mini btn-off" onclick="Ausencias.borrar(${a.id})">Borrar</button></div>` : ''}
      </div>`).join('')}</div>`;
  }
  function editar(id) {
    const a = (S.lista || []).find(x => x.id === id);
    if (!a) return;
    S.editando = id;
    Object.assign(S.form, { supervisor: a.supervisor_cedula || '', personas: new Set([a.cedula]), desde: a.desde, hasta: a.hasta,
      motivo: a.motivo, obs: a.observaciones || '' });
    pintarForm();
    window.scrollTo(0, 0);
  }
  async function borrar(id) {
    const a = (S.lista || []).find(x => x.id === id);
    if (!a || !confirm(`¿Borrar la ausencia de ${nombreDe(a.cedula)} (${a.motivo}, ${fFecha(a.desde)} al ${fFecha(a.hasta)})?`)) return;
    mostrarCarga('Borrando…');
    const { data, error } = await sb.from('taller_ausencias').delete().eq('id', id).select('id');
    ocultarCarga();
    if (error || !data || !data.length) return toast('No se pudo borrar' + (error ? ': ' + error.message : ' (permisos)'), 'error');
    toast('Ausencia borrada', 'success');
    if (S.editando === id) cancelar();
    cargar();
  }
  function exportar() {
    const l = visibles();
    if (!l.length) return toast('No hay nada para exportar', 'warning');
    const filas = [['Cédula', 'Nombre', 'Motivo', 'Desde', 'Hasta', 'Días', 'Supervisor', 'Observaciones']]
      .concat(l.map(a => [a.cedula, nombreDe(a.cedula), a.motivo, a.desde, a.hasta, dias(a.desde, a.hasta), nombreDe(a.supervisor_cedula), a.observaciones || '']));
    const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    el.download = `ausencias_taller_${S.desde}_${S.hasta}.csv`;
    el.click();
  }

  function estilos() {
    if ($('au-estilos')) return;
    const s = document.createElement('style');
    s.id = 'au-estilos';
    s.textContent = `
      #screen-ausencias { max-width: 900px; margin: 0 auto; }
      #screen-ausencias .field-row > .field { min-width: 0; }
      #screen-ausencias .field-row input[type=date] { min-width: 0; }
      .au-n { font-weight: 600; text-transform: none; color: var(--azul-medio); letter-spacing: 0; }
      .au-check { display: flex; align-items: center; gap: 6px; font-size: calc(13px*var(--fs,1)); white-space: nowrap; }
      .au-personas { max-height: 300px; overflow: auto; border: 1.5px solid var(--gris-borde); border-radius: 8px; padding: 4px; background: #fff; }
      .au-persona { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
      .au-persona.on { background: #eef2fb; }
      .au-persona input { width: 20px; height: 20px; accent-color: var(--azul-medio); flex: 0 0 auto; }
      .au-persona small { display: block; color: var(--gris-texto); font-size: calc(11.5px*var(--fs,1)); }
      .au-motivos { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
      .au-mot { padding: 13px 10px; border: 1.5px solid var(--gris-borde); border-radius: 8px; background: #fff; font-weight: 600; cursor: pointer;
        font-size: calc(14px*var(--fs,1)); color: var(--azul-oscuro); }
      .au-mot.on.vac { background: #6446b8; border-color: #6446b8; color: #fff; }
      .au-mot.on.rec { background: #8b4513; border-color: #8b4513; color: #fff; }
      .au-mot.on.aj { background: #0fa5b5; border-color: #0fa5b5; color: #fff; }
      .au-lista { display: flex; flex-direction: column; gap: 8px; }
      .au-item { border: 1px solid var(--gris-borde); border-radius: 8px; padding: 10px 12px; background: #fff; }
      .au-item-pri { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
      .au-item-meta { font-size: calc(12.5px*var(--fs,1)); color: var(--gris-texto); margin-top: 3px; }
      .au-item-acc { display: flex; gap: 6px; margin-top: 8px; }
      .au-chip { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: calc(12px*var(--fs,1)); font-weight: 700; color: #fff; }
      .au-chip.vac { background: #6446b8; } .au-chip.rec { background: #8b4513; } .au-chip.aj { background: #0fa5b5; }`;
    document.head.appendChild(s);
  }

  return { mostrar, campo, buscarPersona, marcar, guardar, cancelar, periodo, cargar, filtrar, editar, borrar, exportar };
})();
