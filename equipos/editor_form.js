// ══════════════════════════════════════════════════════════════════
// EDITOR DE FORMULARIOS EN EL MISMO FORMULARIO — Tecsul S.A.E.
// (v20261019a)
//
// Como en JotForm: el administrador central abre "✏️ Editar formulario"
// en el parte diario, el reporte de taller o la carga de combustible y,
// sobre cada campo, cambia la etiqueta, la ayuda, si es obligatorio, si
// se muestra, las opciones de la lista, el catálogo y las reglas; y
// agrega campos nuevos. Lo guardado viaja a todos los teléfonos con la
// definición del formulario (form_campos / form_reglas en la base).
//
// Cada formulario se registra con EditorForm.registrar(nombre, {...}):
//   recargar()        vuelve a bajar su definición y se redibuja
//   catalogos(clave)  [{ tabla, t }] catálogos que alimentan ese campo
//                     (tabla 'flota' = equipos: se editan en Flota)
//   reglas(clave)     [clave de form_reglas] que se aplican a ese campo
//   protegidas(clave) opciones que la lógica usa: no se pueden quitar
//   notaOpciones(clave) texto de ayuda al editar las opciones
// ══════════════════════════════════════════════════════════════════
window.EditorForm = (() => {
  const NOMBRES = { parte: 'Parte diario', taller: 'Reporte de taller', combustible: 'Carga de combustible' };
  const TIPOS_NUEVOS = [['texto', 'Texto corto'], ['textarea', 'Texto largo'], ['numero', 'Número'], ['fecha', 'Fecha'],
    ['si_no', 'Sí / No'], ['select', 'Lista (una opción)'], ['casillas', 'Casillas (varias opciones)'], ['foto', 'Foto']];
  const conOpciones = (tipo) => tipo === 'select' || tipo === 'casillas';

  const reg = {};            // formularios registrados
  const activo = {};         // modo edición por formulario
  let secciones = [];        // form_secciones (todas)
  let campos = [];           // form_campos (todos, también ocultos)
  let reglas = [];           // form_reglas
  let cargado = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const aviso = (m, t) => (typeof toast === 'function' ? toast(m, t) : alert(m));
  const cargando = (on, txt) => { try { on ? mostrarCarga(txt) : ocultarCarga(); } catch (e) { /* sin overlay */ } };

  function puede() {
    try { return !!(sesion && sesion.rol === 'admin_central'); } catch (e) { return false; }
  }

  // ── Datos ────────────────────────────────────────────────────────
  async function cargar() {
    const r = await Promise.all([
      sb.from('form_secciones').select('*').order('orden'),
      sb.from('form_campos').select('*').order('orden'),
      sb.from('form_reglas').select('*').order('clave')
    ]);
    const mal = r.find(x => x.error);
    if (mal) throw mal.error;
    [secciones, campos, reglas] = r.map(x => x.data || []);
    cargado = true;
  }
  const seccion = (form, clave) => secciones.find(s => s.clave === clave && (s.formulario || 'parte') === form);
  const seccionDe = (c) => secciones.find(s => s.id === c.seccion_id) || {};
  const campo = (form, clave) => campos.find(c => c.clave === clave && (seccionDe(c).formulario || 'parte') === form);
  // Campos ocultos de una sección (para mostrarlos en gris en modo edición)
  function ocultos(form, secClave) {
    const s = seccion(form, secClave);
    return s ? campos.filter(c => c.seccion_id === s.id && !c.activo) : [];
  }
  // Campos nuevos (no del sistema) de una sección
  function extras(form, secClave) {
    const s = seccion(form, secClave);
    return s ? campos.filter(c => c.seccion_id === s.id && !c.es_sistema).sort((a, b) => a.orden - b.orden) : [];
  }

  // ── Modo edición ─────────────────────────────────────────────────
  async function alternar(form) {
    if (!puede()) return;
    if (!activo[form]) {
      if (!navigator.onLine) return aviso('Para editar el formulario hace falta señal.', 'warning');
      cargando(true, 'Abriendo el editor…');
      try { await cargar(); } catch (e) { cargando(false); return aviso('No se pudo abrir el editor: ' + e.message, 'error'); }
      cargando(false);
    }
    activo[form] = !activo[form];
    redibujar(form);
  }
  function redibujar(form) { const r = reg[form]; if (r && r.redibujar) r.redibujar(); }
  async function trasGuardar(form) {
    try { await cargar(); } catch (e) { /* se reintenta al próximo cambio */ }
    const r = reg[form];
    if (r && r.recargar) await r.recargar();
    else redibujar(form);
  }

  // Barra superior del formulario: botón para entrar / salir del modo edición
  function barra(form) {
    estilos();
    if (!puede()) return '';
    if (!activo[form]) {
      return `<div class="ef-barra"><button type="button" class="btn-mini btn-neutro" onclick="EditorForm.alternar('${form}')">✏️ Editar formulario</button></div>`;
    }
    return `<div class="ef-barra on"><span><b>Modo edición · ${NOMBRES[form]}</b><br>
      Tocá ✏️ en un campo para cambiarlo, o «+ Agregar campo». Los cambios llegan a todos los teléfonos.</span>
      <button type="button" class="btn-mini btn-ok" onclick="EditorForm.alternar('${form}')">Terminar</button></div>`;
  }
  // El lápiz al lado de la etiqueta de un campo
  function lapiz(form, clave) {
    if (!activo[form]) return '';
    return ` <button type="button" class="ef-lapiz" title="Editar este campo" onclick="event.stopPropagation();EditorForm.editar('${form}','${esc(clave)}')">✏️</button>`;
  }
  // Pie de cada sección en modo edición: campos ocultos y «+ Agregar campo»
  function pie(form, secClave) {
    if (!activo[form]) return '';
    const oc = ocultos(form, secClave);
    return `<div class="ef-pie">${oc.length ? `<div class="ef-ocultos">Ocultos en esta sección: ${oc.map(c =>
      `<button type="button" class="ef-oculto" onclick="EditorForm.editar('${form}','${esc(c.clave)}')">${esc(c.etiqueta)} ✏️</button>`).join(' ')}</div>` : ''}
      <button type="button" class="add-btn" onclick="EditorForm.nuevo('${form}','${esc(secClave)}')">+ Agregar campo a esta sección</button></div>`;
  }

  // ── Modal propio ─────────────────────────────────────────────────
  function modal(titulo, cuerpo, pieHtml) {
    estilos();
    let m = $('ef-modal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal'; m.id = 'ef-modal';
      m.addEventListener('click', (e) => { if (e.target === m) cerrar(); });
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="modal-card ef-card">
      <div class="modal-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b>${titulo}</b><button type="button" class="btn-mini btn-neutro" onclick="EditorForm.cerrar()">Cerrar</button></div>
      <div class="modal-body">${cuerpo}</div>
      ${pieHtml ? `<div class="ef-acciones">${pieHtml}</div>` : ''}</div>`;
    m.classList.add('show');
    return m;
  }
  function cerrar() { const m = $('ef-modal'); if (m) m.classList.remove('show'); }

  // ── Editar un campo ──────────────────────────────────────────────
  let editando = null;   // { form, fila }
  function editar(form, clave) {
    const f = campo(form, clave);
    if (!f) return aviso('Ese campo no está en la base todavía. Recargá la página.', 'warning');
    editando = { form, fila: f };
    const r = reg[form] || {};
    const cats = (r.catalogos && r.catalogos(clave, f)) || [];
    const rg = ((r.reglas && r.reglas(clave, f)) || []).map(k => reglas.find(x => x.clave === k)).filter(Boolean);
    const editarOpciones = conOpciones(f.tipo) && (!f.es_sistema || Array.isArray(f.opciones));
    const prot = (r.protegidas && r.protegidas(clave, f)) || [];
    const nota = r.notaOpciones && r.notaOpciones(clave, f);

    let h = `<div class="field"><label>Etiqueta</label><input id="ef-etiqueta" value="${esc(f.etiqueta)}"></div>
      <div class="field"><label>Ayuda (texto chico debajo del campo)</label><input id="ef-ayuda" value="${esc(f.ayuda || '')}" placeholder="Opcional"></div>`;
    if (f.bloqueado) {
      h += `<div class="aviso-caja">Campo esencial: siempre se muestra${f.requerido ? ' y es obligatorio' : ''}. Se puede cambiar el nombre y la ayuda.</div>`;
    } else {
      h += `<label class="ef-check"><input type="checkbox" id="ef-requerido" ${f.requerido ? 'checked' : ''}> Obligatorio</label>
        <label class="ef-check"><input type="checkbox" id="ef-activo" ${f.activo ? 'checked' : ''}> Se muestra en el formulario</label>`;
    }
    if (!f.es_sistema) {
      h += `<div class="field"><label>Tipo de campo</label><select id="ef-tipo" onchange="EditorForm.cambiarTipo(this.value)">${
        TIPOS_NUEVOS.map(([v, t]) => `<option value="${v}" ${v === f.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    }
    h += `<div class="field" id="ef-opciones-box" style="${editarOpciones || (!f.es_sistema && conOpciones(f.tipo)) ? '' : 'display:none'}">
      <label>Opciones (una por línea)</label>
      <textarea id="ef-opciones" rows="6">${esc((f.opciones || []).join('\n'))}</textarea>
      ${prot.length ? `<div class="ayuda">No se pueden quitar ni renombrar (las usa el formulario): <b>${prot.map(esc).join(', ')}</b></div>` : ''}
      ${nota ? `<div class="ayuda">${nota}</div>` : ''}</div>`;
    if (cats.length) {
      h += `<div class="field"><label>Catálogo de este campo</label>${cats.map(c => c.tabla === 'flota'
        ? `<a class="btn-mini btn-neutro ef-cat" href="./flota.html" target="_blank" rel="noopener">🚜 ${esc(c.t)} → se editan en Flota</a>`
        : `<button type="button" class="btn-mini btn-neutro ef-cat" onclick="EditorForm.catalogo('${c.tabla}','${esc(c.filtro || '')}')">📋 Editar ${esc(c.t)}</button>`).join(' ')}</div>`;
    }
    if (rg.length) {
      h += `<div class="field"><label>Reglas de este campo</label>${rg.map((x, i) => {
        const bool = !x.unidad && (Number(x.valor) === 0 || Number(x.valor) === 1);
        return `<div class="ef-regla"><span>${esc(x.descripcion)}</span>${bool
          ? `<select data-regla="${esc(x.clave)}"><option value="1" ${Number(x.valor) === 1 ? 'selected' : ''}>Activa</option><option value="0" ${Number(x.valor) === 0 ? 'selected' : ''}>Desactivada</option></select>`
          : `<span><input type="number" step="any" data-regla="${esc(x.clave)}" value="${esc(x.valor)}" style="width:90px"> ${esc(x.unidad || '')}</span>`}</div>`;
      }).join('')}</div>`;
    }
    const pieH = (!f.es_sistema ? `<button type="button" class="btn-mini btn-off" onclick="EditorForm.borrar()">Borrar campo</button>` : '<span></span>')
      + `<button type="button" class="btn-submit ef-guardar" onclick="EditorForm.guardar()">Guardar</button>`;
    modal(`✏️ ${esc(f.etiqueta)}`, h, pieH);
  }
  function cambiarTipo(v) { const b = $('ef-opciones-box'); if (b) b.style.display = conOpciones(v) ? '' : 'none'; }
  const leerOpciones = () => [...new Set(String(($('ef-opciones') || {}).value || '').split('\n').map(x => x.trim()).filter(Boolean))];

  async function guardar() {
    if (!editando) return;
    const { form, fila: f } = editando;
    const r = reg[form] || {};
    const cambios = { etiqueta: $('ef-etiqueta').value.trim(), ayuda: $('ef-ayuda').value.trim() || null };
    if (!cambios.etiqueta) return aviso('La etiqueta no puede quedar vacía', 'warning');
    if (!f.bloqueado) {
      cambios.requerido = $('ef-requerido').checked;
      cambios.activo = $('ef-activo').checked;
      if (!cambios.activo) cambios.requerido = false;   // oculto y obligatorio no tiene sentido
    }
    const tipo = !f.es_sistema && $('ef-tipo') ? $('ef-tipo').value : f.tipo;
    if (tipo !== f.tipo) cambios.tipo = tipo;
    const box = $('ef-opciones-box');
    if (conOpciones(tipo) && box && box.style.display !== 'none') {
      const ops = leerOpciones();
      if (!ops.length) return aviso('Cargá al menos una opción', 'warning');
      const prot = (r.protegidas && r.protegidas(f.clave, f)) || [];
      const falta = prot.filter(p => !ops.includes(p));
      if (falta.length) return aviso('Estas opciones las usa el formulario y no se pueden quitar: ' + falta.join(', '), 'warning');
      cambios.opciones = ops;
    }
    // reglas que cambiaron
    const rcambios = [...document.querySelectorAll('#ef-modal [data-regla]')].map(el => {
      const x = reglas.find(y => y.clave === el.dataset.regla);
      const v = parseFloat(el.value);
      return x && !isNaN(v) && v !== Number(x.valor) ? { clave: x.clave, valor: v } : null;
    }).filter(Boolean);

    cargando(true, 'Guardando…');
    try {
      const { data, error } = await sb.from('form_campos').update(cambios).eq('id', f.id).select();
      if (error) throw error;
      if (!data || !data.length) throw new Error('La base rechazó el cambio (¿sesión de administrador?)');
      for (const x of rcambios) {
        const q = await sb.from('form_reglas').update({ valor: x.valor }).eq('clave', x.clave).select();
        if (q.error) throw q.error;
      }
      cargando(false); cerrar();
      aviso('Campo actualizado', 'success');
      await trasGuardar(form);
    } catch (e) { cargando(false); aviso(e.message || 'No se pudo guardar', 'error'); }
  }

  async function borrar() {
    if (!editando) return;
    const { form, fila: f } = editando;
    if (!confirm(`¿Borrar el campo "${f.etiqueta}"?\n\nLo ya cargado se conserva, pero deja de pedirse.`)) return;
    cargando(true, 'Borrando…');
    try {
      const { error } = await sb.from('form_campos').delete().eq('id', f.id);
      if (error) throw error;
      cargando(false); cerrar(); aviso('Campo borrado', 'success');
      await trasGuardar(form);
    } catch (e) { cargando(false); aviso(e.message || 'No se pudo borrar', 'error'); }
  }

  // ── Agregar un campo ─────────────────────────────────────────────
  let agregando = null;   // { form, sec }
  function nuevo(form, secClave) {
    const s = seccion(form, secClave);
    if (!s) return aviso('No se encontró la sección. Recargá la página.', 'warning');
    agregando = { form, sec: s };
    const enSec = campos.filter(c => c.seccion_id === s.id && c.activo).sort((a, b) => a.orden - b.orden);
    // En el parte el orden de la sección es el del formulario: se elige dónde va.
    // En taller y combustible los campos nuevos van al final de la sección.
    const conPos = form === 'parte' && enSec.length;
    const h = `<div class="field"><label>Etiqueta (lo que ve el operador)</label><input id="ef-etiqueta" placeholder="Ej.: Patente del camión"></div>
      <div class="field"><label>Tipo de campo</label><select id="ef-tipo" onchange="EditorForm.cambiarTipo(this.value)">${
        TIPOS_NUEVOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
      <div class="field" id="ef-opciones-box" style="display:none"><label>Opciones (una por línea)</label><textarea id="ef-opciones" rows="5"></textarea></div>
      <div class="field"><label>Ayuda (opcional)</label><input id="ef-ayuda"></div>
      <label class="ef-check"><input type="checkbox" id="ef-requerido"> Obligatorio</label>
      ${conPos ? `<div class="field"><label>Ubicación</label><select id="ef-despues">${enSec.map(c =>
        `<option value="${c.orden}" ${c === enSec[enSec.length - 1] ? 'selected' : ''}>Después de «${esc(c.etiqueta)}»</option>`).join('')}</select></div>` : ''}
      <div class="ayuda">Lo que se cargue en este campo se guarda con el ${NOMBRES[form].toLowerCase()} (no cambia la estructura de la base ni Power BI).</div>`;
    modal(`+ Nuevo campo · ${esc(s.titulo)}`, h, `<span></span><button type="button" class="btn-submit ef-guardar" onclick="EditorForm.crear()">Agregar</button>`);
    setTimeout(() => $('ef-etiqueta') && $('ef-etiqueta').focus(), 60);
  }

  // clave interna: del nombre, sin tildes ni espacios; única en toda la base
  function claveNueva(etiqueta) {
    let base = String(etiqueta).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'campo';
    if (/^[0-9]/.test(base)) base = 'c_' + base;
    let k = base, n = 2;
    while (campos.some(c => c.clave === k)) k = base + '_' + n++;
    return k;
  }

  async function crear() {
    if (!agregando) return;
    const { form, sec } = agregando;
    const etiqueta = $('ef-etiqueta').value.trim();
    if (!etiqueta) return aviso('Poné la etiqueta del campo', 'warning');
    const tipo = $('ef-tipo').value;
    const ops = conOpciones(tipo) ? leerOpciones() : null;
    if (conOpciones(tipo) && !ops.length) return aviso('Cargá al menos una opción', 'warning');
    const enSec = campos.filter(c => c.seccion_id === sec.id).sort((a, b) => a.orden - b.orden);
    const maxOrden = enSec.length ? enSec[enSec.length - 1].orden : 0;
    const despues = $('ef-despues') ? Number($('ef-despues').value) : maxOrden;

    cargando(true, 'Agregando…');
    try {
      // Correr un lugar los que van después (de atrás para adelante: el orden es único por sección)
      const mover = enSec.filter(c => c.orden > despues).sort((a, b) => b.orden - a.orden);
      for (const c of mover) {
        const { error } = await sb.from('form_campos').update({ orden: c.orden + 1 }).eq('id', c.id);
        if (error) throw error;
      }
      const fila = { seccion_id: sec.id, clave: claveNueva(etiqueta), etiqueta, tipo, orden: despues + 1,
        requerido: $('ef-requerido').checked, activo: true, es_sistema: false,
        ayuda: $('ef-ayuda').value.trim() || null, opciones: ops };
      const { error } = await sb.from('form_campos').insert(fila);
      if (error) throw error;
      cargando(false); cerrar(); aviso('Campo agregado', 'success');
      await trasGuardar(form);
    } catch (e) { cargando(false); aviso('No se pudo agregar: ' + (e.message || e), 'error'); }
  }

  // ── Editar un catálogo (obras, personal, fallas, insumos, trabajos…) ──
  // Usa la misma descripción de columnas que Administración › Catálogos.
  let catTabla = null, catFilas = [], catFiltro = '';
  async function catalogo(tabla, filtro) {
    const C = (typeof CATALOGOS !== 'undefined') ? CATALOGOS : null;
    if (!C || !C[tabla]) return aviso('Ese catálogo se edita en Administración', 'warning');
    catTabla = tabla; catFiltro = filtro || '';
    cargando(true, 'Cargando catálogo…');
    try {
      const c = C[tabla];
      const q = await sb.from(tabla).select('*').order(c.cols[0][0]).limit(5000);
      if (q.error) throw q.error;
      catFilas = q.data || [];
      cargando(false);
      pintarCatalogo();
    } catch (e) { cargando(false); aviso('No se pudo abrir el catálogo: ' + e.message, 'error'); }
  }
  function pintarCatalogo() {
    const c = CATALOGOS[catTabla];
    const f = catFiltro.toLowerCase();
    const vis = catFilas.map((x, i) => [x, i]).filter(([x]) => !f || c.cols.some(col => String(x[col[0]] ?? '').toLowerCase().includes(f)));
    const ctl = (col, v, i) => {
      const [k, t, flag, x] = col, tipo = (x || {}).tipo;
      const on = i === null ? '' : `onchange="EditorForm.catPoner(${i},'${k}',this.value)"`;
      const id = i === null ? `id="efc-nv-${k}"` : '';
      if (flag === 2 && i !== null) return `<span>${esc(v)}</span>`;
      if (tipo === 'sel' || tipo === 'obra') {
        const ops = tipo === 'obra' ? ((typeof cat !== 'undefined' && cat.obras) || []).map(o => o.v) : x.ops;
        return `<select ${id} ${on}><option value="">${i === null ? esc(t) : '—'}</option>${ops.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      }
      const vv = Array.isArray(v) ? v.join(' | ') : v;
      return `<input ${id} ${on} value="${i === null ? '' : esc(vv)}" placeholder="${esc(t)}" ${flag === 1 && i !== null ? 'readonly' : ''} ${tipo === 'num' || k === 'orden' ? 'type="number"' : ''}>`;
    };
    const h = `<input class="ef-buscar" placeholder="Buscar…" value="${esc(catFiltro)}" oninput="EditorForm.catBuscar(this.value)">
      <div class="ef-cat-nuevo">${c.cols.filter(col => col[2] !== 2).map(col => ctl(col, null, null)).join('')}
        <button type="button" class="btn-mini btn-ok" onclick="EditorForm.catAgregar()">Agregar</button></div>
      <div class="ayuda" style="margin:6px 0">${vis.length} de ${catFilas.length}. Desactivar no borra: deja de aparecer en el formulario y lo ya cargado se conserva.</div>
      <div class="ef-cat-lista">${vis.slice(0, 400).map(([x, i]) => `<div class="ef-cat-fila${c.act && x[c.act] === false ? ' inactivo' : ''}">
        ${c.cols.map(col => ctl(col, x[col[0]], i)).join('')}
        <span class="ef-cat-bot">${c.act ? `<button type="button" class="btn-mini ${x[c.act] === false ? 'btn-ok' : 'btn-off'}" onclick="EditorForm.catActivar(${i})">${x[c.act] === false ? 'Activar' : 'Desactivar'}</button>` : ''}
        <button type="button" class="btn-mini btn-neutro" onclick="EditorForm.catGuardar(${i})">Guardar</button></span></div>`).join('')}</div>`;
    modal(`📋 ${esc(c.t)}`, h);
  }
  function catBuscar(v) {
    catFiltro = v; pintarCatalogo();
    const b = document.querySelector('#ef-modal .ef-buscar');
    if (b) { b.focus(); b.setSelectionRange(v.length, v.length); }
  }
  const catValor = (col, v) => (typeof admValor === 'function') ? admValor(col, v) : v;
  const catClaveFila = (c, f) => Object.fromEntries((Array.isArray(c.pk) ? c.pk : [c.pk]).map(k => [k, f[k]]));
  function catPoner(i, k, v) {
    const c = CATALOGOS[catTabla], col = c.cols.find(x => x[0] === k);
    (catFilas[i]._cambios = catFilas[i]._cambios || {})[k] = catValor(col, v);
  }
  async function catEscribir(fn, ok) {
    cargando(true, 'Guardando…');
    try {
      const { data, error } = await fn();
      if (error) throw error;
      if (Array.isArray(data) && !data.length) throw new Error('La base no permitió el cambio');
      cargando(false); aviso(ok, 'success');
      await catalogo(catTabla, catFiltro);
      catRefrescarFormularios();
    } catch (e) { cargando(false); aviso(e.message || 'No se pudo guardar', 'error'); }
  }
  function catGuardar(i) {
    const c = CATALOGOS[catTabla], f = catFilas[i];
    if (!f._cambios || !Object.keys(f._cambios).length) return aviso('No hay cambios en esa fila', 'warning');
    return catEscribir(() => sb.from(catTabla).update(f._cambios).match(catClaveFila(c, f)).select(), 'Guardado');
  }
  function catActivar(i) {
    const c = CATALOGOS[catTabla], f = catFilas[i];
    return catEscribir(() => sb.from(catTabla).update({ [c.act]: f[c.act] === false }).match(catClaveFila(c, f)).select(),
      f[c.act] === false ? 'Activado' : 'Desactivado');
  }
  function catAgregar() {
    const c = CATALOGOS[catTabla], fila = {};
    for (const col of c.cols) {
      if (col[2] === 2) continue;
      const el = $('efc-nv-' + col[0]);
      const v = el ? el.value.trim() : '';
      if (v !== '') fila[col[0]] = catValor(col, v);
    }
    const pk = Array.isArray(c.pk) ? c.pk : [c.pk];
    if (!c.idNum && pk.some(k => fila[k] === undefined || fila[k] === '')) return aviso('Completá ' + pk.join(' y '), 'warning');
    if (!Object.keys(fila).length) return aviso('Completá los datos', 'warning');
    return catEscribir(() => sb.from(catTabla).insert(fila).select(), 'Agregado');
  }
  // Los formularios vuelven a bajar sus catálogos (sin perder lo cargado)
  // (en orden: primero el parte, que baja personal y obras que también usan taller y combustible)
  async function catRefrescarFormularios() {
    for (const r of Object.values(reg)) {
      try { if (r.catalogosCambiaron) await r.catalogosCambiaron(); } catch (e) { /* sigue con el próximo */ }
    }
  }

  // ── Estilos ──────────────────────────────────────────────────────
  function estilos() {
    if ($('ef-estilos')) return;
    const s = document.createElement('style');
    s.id = 'ef-estilos';
    s.textContent = `
      .ef-barra{display:flex;justify-content:flex-end;margin:0 0 10px}
      .ef-barra.on{justify-content:space-between;align-items:center;gap:10px;background:#fff7e6;border:1.5px dashed #e8a33d;
        border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.35}
      .ef-lapiz{border:0;background:#fff3d6;border-radius:6px;padding:1px 6px;cursor:pointer;font-size:13px;vertical-align:middle}
      .ef-pie{border-top:1.5px dashed #e8a33d;margin-top:10px;padding-top:10px}
      .ef-ocultos{font-size:12.5px;color:#7a8699;margin-bottom:8px}
      .ef-oculto{border:1px dashed #b7c0cf;background:#f4f6fa;color:#7a8699;border-radius:14px;padding:3px 9px;margin:2px;cursor:pointer;font-size:12.5px}
      .ef-campo-oculto{opacity:.55;border:1px dashed #b7c0cf;border-radius:8px;padding:6px 8px;margin-bottom:10px;font-size:13px}
      #ef-modal .ef-card{max-width:720px;margin:0 auto}
      #ef-modal .modal-body .field input,#ef-modal .modal-body .field select,#ef-modal .modal-body .field textarea{width:100%}
      .ef-check{display:flex;gap:8px;align-items:center;margin:6px 0 10px;font-weight:600}
      .ef-check input{width:18px;height:18px}
      .ef-acciones{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--gris-borde)}
      .ef-guardar{width:auto;padding:10px 22px;margin:0}
      .ef-cat{display:inline-block;margin:0 6px 6px 0;text-decoration:none}
      .ef-regla{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #eef1f5;font-size:13px}
      .ef-buscar{width:100%;padding:9px;border:1.5px solid var(--gris-borde);border-radius:8px;margin-bottom:8px}
      .ef-cat-nuevo,.ef-cat-fila{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:6px 0;border-bottom:1px solid #eef1f5}
      .ef-cat-nuevo{background:#eef2f9;border-radius:8px;padding:8px}
      .ef-cat-nuevo input,.ef-cat-nuevo select,.ef-cat-fila input,.ef-cat-fila select{flex:1 1 140px;min-width:0;padding:7px;border:1.5px solid var(--gris-borde);border-radius:6px}
      .ef-cat-fila.inactivo{opacity:.55}
      .ef-cat-bot{display:flex;gap:6px}`;
    document.head.appendChild(s);
  }

  return {
    registrar: (form, r) => { reg[form] = r; },
    puede, activo: (form) => !!activo[form], alternar, barra, lapiz, pie,
    campo, extras, ocultos,
    editar, cambiarTipo, guardar, borrar, nuevo, crear, cerrar,
    catalogo, catBuscar, catPoner, catGuardar, catActivar, catAgregar,
    conOpciones
  };
})();
