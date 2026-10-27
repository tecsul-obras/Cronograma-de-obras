// ══════════════════════════════════════════════════════════════════
// MINUTAS DE REUNIÓN — Tecsul S.A.E.
//
// Reemplaza el tablero de Monday "Minuta COPAC Obras - Taller - Compras":
// compromisos de cada reunión con responsable, fecha de comité, estado,
// prioridad, fecha límite y actualizaciones (comentarios con autor y hora).
//
// Ven: taller, admin de obra (residentes), admin central y gerente.
// Cargan y editan: taller, admin de obra y admin central (SQL 46).
//
// Vive en flota.html y usa sus utilidades ($, esc, fmtFecha, fmtNum,
// abrirModal, cerrarModal, toast, leerLocal, guardarLocal, sb, sesion, flota).
// ══════════════════════════════════════════════════════════════════
window.Minutas = (() => {
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const ESTADOS = ['No iniciado', 'Programado', 'En curso', 'En espera de definición', 'Detenido', 'Listo'];
  const EST_CLASE = { 'No iniciado': 'gris', 'Programado': 'azul', 'En curso': 'amarillo', 'En espera de definición': 'violeta', 'Detenido': 'rojo', 'Listo': 'verde' };
  const PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];
  const PRI_CLASE = { 'Crítica': 'mi-critica', 'Alta': 'rojo', 'Media': 'amarillo', 'Baja': 'azul' };
  const PRI_ORDEN = { 'Crítica': 0, 'Alta': 1, 'Media': 2, 'Baja': 3 };

  const M = { tableros: null, tab: null, items: null, f: null, orden: { col: 'prioridad', asc: true }, verListos: false, limListos: 60, abierto: null };

  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const edita = () => sesion && ['admin_central', 'taller', 'admin_obra'].includes(sesion.rol);
  const puedeBorrar = (it) => sesion && (sesion.rol === 'admin_central' || it.creado_por === sesion.id);
  const sinAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const vencido = (it) => it.estado !== 'Listo' && it.fecha_limite && it.fecha_limite < hoy();
  const cuando = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  };
  const leerF = () => { try { return leerLocal('minutas_filtros') || {}; } catch (e) { return {}; } };
  const guardarF = () => { try { guardarLocal('minutas_filtros', M.f); } catch (e) { /* nada */ } };

  // ════════════════════════════════════════════════════════════════
  // DATOS
  // ════════════════════════════════════════════════════════════════
  async function cargar() {
    if (!M.tableros) {
      const { data, error } = await sb.from('minuta_tableros').select('*').eq('activo', true).order('orden').order('nombre');
      if (error) throw error;
      M.tableros = data;
      if (!M.tab || !data.some(t => t.id === M.tab)) M.tab = (data.find(t => t.id === M.f.tab) || data[0] || {}).id || null;
    }
    if (!M.tab) { M.items = []; return; }
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from('minuta_items').select('*').eq('tablero_id', M.tab).order('id').range(desde, desde + 999);
      if (error) throw error;
      filas.push(...data);
      if (data.length < 1000) break;
    }
    M.items = filas;
  }

  // ════════════════════════════════════════════════════════════════
  // PANTALLA
  // ════════════════════════════════════════════════════════════════
  async function mostrar() {
    estilos();
    if (!M.f) M.f = Object.assign({ q: '', estado: '', resp: '', comite: '', pri: '', mios: false }, leerF());
    const pant = $('screen-minutas');
    if (!M.items) pant.innerHTML = '<div class="empty-state">Cargando minutas…</div>';
    try { await cargar(); }
    catch (e) {
      pant.innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}${/minuta_/.test(e.message) ? '<br>Falta correr <b>46_minutas.sql</b> en Supabase.' : ''}</div>`;
      return;
    }
    pintar();
  }

  function responsables() {
    const s = new Set();
    (M.items || []).forEach(it => (it.responsables || []).forEach(r => s.add(r)));
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }
  function comites() {
    return [...new Set((M.items || []).map(it => it.fecha_comite).filter(Boolean))].sort().reverse();
  }

  // v20261027a: estado, responsable, prioridad y reunión admiten varios valores
  // (array). Lo guardado antes era un texto: se acepta igual.
  const arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  const uno = (v) => { const a = arr(v); return a.length === 1 ? a[0] : ''; };
  function filtrados() {
    const f = M.f, q = sinAcento(f.q).trim(), yo = sinAcento(sesion && sesion.nombre);
    const est = arr(f.estado), resp = arr(f.resp), pri = arr(f.pri), com = arr(f.comite);
    return (M.items || []).filter(it => {
      if (est.length && !est.some(e => e === 'vencidos' ? vencido(it) : it.estado === e)) return false;
      if (resp.length && !(it.responsables || []).some(r => resp.includes(r))) return false;
      if (pri.length && !pri.includes(it.prioridad)) return false;
      if (com.length && !com.includes(it.fecha_comite)) return false;
      if (f.mios && !(it.responsables || []).some(r => sinAcento(r) === yo || (yo && yo.includes(sinAcento(r))) || (yo && sinAcento(r).includes(yo)))) return false;
      if (q) {
        const pajar = sinAcento([it.titulo, (it.responsables || []).join(' '), it.notas, it.equipo_id, it.estado].join(' '));
        if (!q.split(/\s+/).every(p => pajar.includes(p))) return false;
      }
      return true;
    });
  }

  function ordenar(l, o) {
    const val = (it) => o.col === 'prioridad' ? (PRI_ORDEN[it.prioridad] ?? 9) : o.col === 'responsables' ? (it.responsables || []).join(', ') : it[o.col];
    return [...l].sort((a, b) => {
      let x = val(a), y = val(b);
      if (x === y) { x = a.fecha_comite || ''; y = b.fecha_comite || ''; if (x === y) return a.id - b.id; return x < y ? -1 : 1; }
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true });
      return o.asc ? r : -r;
    });
  }

  function pintar() {
    const pant = $('screen-minutas');
    if (!M.tableros || !M.tableros.length) {
      pant.innerHTML = `<div class="empty-state">No hay ninguna minuta creada.${sesion && sesion.rol === 'admin_central' ? '<br><button class="btn-filtro primario" onclick="Minutas.nuevoTablero()">+ Nueva minuta</button>' : ''}</div>`;
      return;
    }
    const f = M.f, todos = M.items || [];
    const pend = todos.filter(it => it.estado !== 'Listo');
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const t = {
      pend: pend.length, venc: pend.filter(vencido).length,
      crit: pend.filter(it => it.prioridad === 'Crítica').length,
      cerr: todos.filter(it => it.estado === 'Listo' && it.cerrado_en && it.cerrado_en >= hace30).length,
    };
    const resp = responsables(), com = comites();
    pant.innerHTML = `
      <div class="mi-cab">
        ${M.tableros.length > 1 || (sesion && sesion.rol === 'admin_central') ? `<select class="mi-tab" onchange="Minutas.tablero(+this.value)">
          ${M.tableros.map(x => `<option value="${x.id}" ${x.id === M.tab ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>` : `<h2 class="mi-tit">${esc(M.tableros[0].nombre)}</h2>`}
        ${sesion && sesion.rol === 'admin_central' ? '<button class="btn-filtro" onclick="Minutas.nuevoTablero()" title="Otra minuta (otro comité)">+ Minuta</button>' : ''}
        <span style="flex:1"></span>
        <button class="btn-filtro" onclick="Minutas.pedirImpresion()">Imprimir minuta</button>
        <button class="btn-filtro" onclick="Minutas.excel()">Descargar Excel</button>
      </div>
      <div class="tarjetas">
        <button class="tarjeta ${!arr(f.estado).length && !arr(f.pri).length ? 'sel' : ''}" onclick="Minutas.filtro('estado', '')"><span class="n">${t.pend}</span><span class="t">Pendientes</span></button>
        <button class="tarjeta malo ${uno(f.estado) === 'vencidos' ? 'sel' : ''}" onclick="Minutas.filtro('estado', 'vencidos')"><span class="n">${t.venc}</span><span class="t">Vencidos</span></button>
        <button class="tarjeta medio ${uno(f.pri) === 'Crítica' ? 'sel' : ''}" onclick="Minutas.filtroPrioridad()"><span class="n">${t.crit}</span><span class="t">Críticos pendientes</span></button>
        <button class="tarjeta bien ${uno(f.estado) === 'Listo' ? 'sel' : ''}" onclick="Minutas.filtro('estado', 'Listo')"><span class="n">${t.cerr}</span><span class="t">Cerrados (30 días)</span></button>
      </div>
      <div class="filtros">
        <div class="filtro crece siempre"><label>Buscar</label><input type="text" id="mi-q" value="${esc(f.q)}" placeholder="Compromiso, responsable, equipo…" oninput="Minutas.filtro('q', this.value, true)"></div>
        <div class="filtro siempre"><label>Estado</label><select class="ms" onchange="Minutas.filtro('estado', MS.valores(this))">
          <option value="" ${arr(f.estado).length ? '' : 'selected'}>Todos</option><option value="vencidos" ${arr(f.estado).includes('vencidos') ? 'selected' : ''}>Vencidos</option>
          ${ESTADOS.map(e => `<option ${arr(f.estado).includes(e) ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Responsable</label><select class="ms" onchange="Minutas.filtro('resp', MS.valores(this))">
          <option value="" ${arr(f.resp).length ? '' : 'selected'}>Todos</option>${resp.map(r => `<option ${arr(f.resp).includes(r) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Prioridad</label><select class="ms" onchange="Minutas.filtro('pri', MS.valores(this))">
          <option value="" ${arr(f.pri).length ? '' : 'selected'}>Todas</option>${PRIORIDADES.map(p => `<option ${arr(f.pri).includes(p) ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>Reunión (comité)</label><select class="ms" onchange="Minutas.filtro('comite', MS.valores(this))">
          <option value="" ${arr(f.comite).length ? '' : 'selected'}>Todas</option>${com.map(c => `<option value="${c}" ${arr(f.comite).includes(c) ? 'selected' : ''}>${fmtFecha(c)}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>&nbsp;</label><label class="check-linea"><input type="checkbox" ${f.mios ? 'checked' : ''} onchange="Minutas.filtro('mios', this.checked)"> Míos</label></div>
        <div class="filtro siempre"><label>&nbsp;</label><button class="btn-filtro" onclick="Minutas.limpiar()">Limpiar</button></div>
      </div>
      <div id="mi-lista"></div>`;
    pintarLista();
  }

  function pintarLista() {
    const l = filtrados();
    const pend = ordenar(l.filter(it => it.estado !== 'Listo'), M.orden);
    const listos = [...l.filter(it => it.estado === 'Listo')].sort((a, b) => String(b.cerrado_en || b.actualizado_en).localeCompare(String(a.cerrado_en || a.actualizado_en)));
    const verListos = M.verListos || arr(M.f.estado).includes('Listo') || !!M.f.q;
    $('mi-lista').innerHTML = `
      <div class="mi-grupo mi-g-pend"><div class="mi-gt">Compromisos pendientes <span>${pend.length}</span></div>
        ${tabla(pend, true)}
        ${edita() && uno(M.f.estado) !== 'Listo' ? `<div class="mi-nuevo"><input type="text" id="mi-nuevo" placeholder="+ Nuevo compromiso (escribí y Enter)" onkeydown="if(event.key==='Enter')Minutas.crear()">
          <button class="btn-filtro primario" onclick="Minutas.crear()">Agregar</button></div>` : ''}
      </div>
      <div class="mi-grupo mi-g-listo"><div class="mi-gt" onclick="Minutas.toggleListos()" style="cursor:pointer">${verListos ? '▾' : '▸'} Compromisos ejecutados <span>${listos.length}</span></div>
        ${verListos ? tabla(listos.slice(0, M.limListos), false) + (listos.length > M.limListos ? `<div style="text-align:center;margin:8px"><button class="btn-filtro" onclick="Minutas.masListos()">Mostrar más (${listos.length - M.limListos})</button></div>` : '') : ''}
      </div>`;
  }

  function tabla(l, ordenable) {
    if (!l.length) return '<div class="empty-state" style="padding:14px">Nada por acá.</div>';
    const o = M.orden, ed = edita();
    const th = (k, t, cls = '') => ordenable ? `<th class="${o.col === k ? 'activo' : ''} ${cls}" onclick="Minutas.ordenarPor('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>` : `<th class="${cls}">${t}</th>`;
    return `<div class="tabla-wrap" style="max-height:none"><table class="tabla mi-t"><thead><tr>
        ${th('titulo', 'Compromiso')}${th('responsables', 'Responsable')}${th('fecha_comite', 'Fecha comité')}${th('estado', 'Estado')}
        ${th('prioridad', 'Prioridad')}${th('fecha_limite', 'Fecha límite')}${th('actualizado_en', 'Últ. actualización')}</tr></thead><tbody>
      ${l.map(it => `<tr>
        <td class="mi-titulo" onclick="Minutas.abrir(${it.id})"><b>${esc(it.titulo)}</b>${it.equipo_id ? ` <span class="chip azul">${esc(it.equipo_id)}</span>` : ''}${it.notas ? ' <span title="Tiene notas">📝</span>' : ''}</td>
        <td class="mi-resp" onclick="Minutas.abrir(${it.id})">${(it.responsables || []).map(r => `<span class="mi-persona">${esc(r)}</span>`).join(' ') || '<span class="cambio">—</span>'}</td>
        <td>${fmtFecha(it.fecha_comite)}</td>
        <td>${ed ? `<select class="mi-pill chip ${EST_CLASE[it.estado]}" onchange="Minutas.cambiar(${it.id}, 'estado', this.value)">${ESTADOS.map(e => `<option ${e === it.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>`
          : `<span class="chip ${EST_CLASE[it.estado]}">${esc(it.estado)}</span>`}</td>
        <td>${ed ? `<select class="mi-pill chip ${PRI_CLASE[it.prioridad] || 'mi-vacia'}" onchange="Minutas.cambiar(${it.id}, 'prioridad', this.value || null)"><option value="">—</option>${PRIORIDADES.map(p => `<option ${p === it.prioridad ? 'selected' : ''}>${p}</option>`).join('')}</select>`
          : it.prioridad ? `<span class="chip ${PRI_CLASE[it.prioridad]}">${esc(it.prioridad)}</span>` : ''}</td>
        <td class="${vencido(it) ? 'mi-venc' : ''}">${fmtFecha(it.fecha_limite)}${vencido(it) ? ' ⚠' : ''}</td>
        <td class="mi-act" onclick="Minutas.abrir(${it.id})">${esc(it.actualizado_por_nombre || '')}<br><span>${cuando(it.actualizado_en)}</span></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // ── Filtros ─────────────────────────────────────────────────────
  let espera;
  function filtro(k, v, escribiendo) {
    M.f[k] = v;
    guardarF();
    if (escribiendo) { clearTimeout(espera); espera = setTimeout(pintarLista, 200); return; }
    pintar();
  }
  function filtroPrioridad() { M.f.pri = uno(M.f.pri) === 'Crítica' ? '' : 'Crítica'; guardarF(); pintar(); }
  function limpiar() { M.f = { q: '', estado: '', resp: '', comite: '', pri: '', mios: false, tab: M.tab }; guardarF(); pintar(); }
  function ordenarPor(col) { M.orden = { col, asc: M.orden.col === col ? !M.orden.asc : col !== 'actualizado_en' }; pintarLista(); }
  function toggleListos() { M.verListos = !M.verListos; pintarLista(); }
  function masListos() { M.limListos += 100; pintarLista(); }
  async function tablero(id) { M.tab = id; M.f.tab = id; guardarF(); M.items = null; mostrar(); }

  // ── Cambios ─────────────────────────────────────────────────────
  async function crear() {
    const inp = $('mi-nuevo');
    const titulo = (inp.value || '').trim();
    if (!titulo) return inp.focus();
    inp.disabled = true;
    const fila = { tablero_id: M.tab, titulo, fecha_comite: uno(M.f.comite) || hoy(), estado: 'No iniciado',
      responsables: uno(M.f.resp) ? [uno(M.f.resp)] : [] };
    const { data, error } = await sb.from('minuta_items').insert(fila).select('*').single();
    inp.disabled = false;
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    M.items.push(data);
    pintar();
    setTimeout(() => { const x = $('mi-nuevo'); if (x) x.focus(); }, 30);
    toast('Compromiso agregado', 'success');
  }

  async function cambiar(id, campo, valor) {
    const it = M.items.find(x => x.id === id);
    if (!it) return;
    const cambio = { [campo]: valor };
    const { data, error } = await sb.from('minuta_items').update(cambio).eq('id', id).select('*').single();
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return pintarLista(); }
    Object.assign(it, data);
    if (campo === 'estado' && valor === 'Listo') toast('¡Listo! Pasó a ejecutados', 'success');
    if (M.abierto === id) abrir(id); else pintar();
  }

  // ── Detalle (como el panel de Monday) ───────────────────────────
  async function abrir(id) {
    const it = M.items.find(x => x.id === id);
    if (!it) return;
    M.abierto = id;
    const ed = edita();
    const ids = [...new Set((typeof flota !== 'undefined' ? flota || [] : []).map(f => f.id))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    abrirModal(it.titulo.length > 60 ? it.titulo.slice(0, 57) + '…' : it.titulo, `
      <div class="mi-det">
        <div class="form-grid">
          <div class="field ancho"><label for="md-titulo">Compromiso</label>${ed ? `<textarea id="md-titulo" rows="2">${esc(it.titulo)}</textarea>` : `<div><b>${esc(it.titulo)}</b></div>`}</div>
          <div class="field ancho"><label for="md-resp">Responsables (separados por coma)</label>${ed
            ? `<input type="text" id="md-resp" value="${esc((it.responsables || []).join(', '))}" list="md-personas"><datalist id="md-personas">${responsables().map(r => `<option value="${esc(r)}">`).join('')}</datalist>`
            : `<div>${esc((it.responsables || []).join(', ') || '—')}</div>`}</div>
          <div class="field"><label for="md-comite">Fecha comité</label>${ed ? `<input type="date" id="md-comite" value="${it.fecha_comite || ''}">` : `<div>${fmtFecha(it.fecha_comite) || '—'}</div>`}</div>
          <div class="field"><label for="md-limite">Fecha límite</label>${ed ? `<input type="date" id="md-limite" value="${it.fecha_limite || ''}">` : `<div>${fmtFecha(it.fecha_limite) || '—'}</div>`}</div>
          <div class="field"><label for="md-estado">Estado</label>${ed ? `<select id="md-estado">${ESTADOS.map(e => `<option ${e === it.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>` : `<div><span class="chip ${EST_CLASE[it.estado]}">${esc(it.estado)}</span></div>`}</div>
          <div class="field"><label for="md-pri">Prioridad</label>${ed ? `<select id="md-pri"><option value="">—</option>${PRIORIDADES.map(p => `<option ${p === it.prioridad ? 'selected' : ''}>${p}</option>`).join('')}</select>` : `<div>${esc(it.prioridad || '—')}</div>`}</div>
          <div class="field"><label for="md-eq">Equipo (opcional)</label>${ed ? `<input type="text" id="md-eq" value="${esc(it.equipo_id || '')}" list="md-ids" placeholder="Ej.: TA-03"><datalist id="md-ids">${ids.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : `<div>${esc(it.equipo_id || '—')}</div>`}</div>
          <div class="field ancho"><label for="md-notas">Notas</label>${ed ? `<textarea id="md-notas" rows="3">${esc(it.notas || '')}</textarea>` : `<div style="white-space:pre-wrap">${esc(it.notas || '—')}</div>`}</div>
        </div>
        <div class="cambio">Creado por ${esc(it.creado_por_nombre || '—')} el ${cuando(it.creado_en)}${it.cerrado_en ? ` · cerrado el ${cuando(it.cerrado_en)}` : ''}</div>
        ${ed ? `<div class="acciones">${puedeBorrar(it) ? `<button class="btn-mini" style="background:#fdeceb;color:var(--rojo)" onclick="Minutas.borrar(${it.id})">Borrar</button>` : ''}
          <button class="btn btn-primario" onclick="Minutas.guardar(${it.id})">Guardar</button></div>` : ''}
        <h4 class="mi-h4">Actualizaciones</h4>
        ${ed ? `<div class="mi-escribir"><textarea id="md-act" rows="2" placeholder="Escribí una actualización (qué se hizo, qué falta, quién…)"></textarea>
          <button class="btn-filtro primario" onclick="Minutas.comentar(${it.id})">Publicar</button></div>` : ''}
        <div id="md-acts"><div class="empty-state">Cargando…</div></div>
      </div>`);
    $('modal').querySelector('.modal-card').classList.add('ancho');
    const { data, error } = await sb.from('minuta_actualizaciones').select('*').eq('item_id', id).order('creado_en', { ascending: false });
    const caja = $('md-acts');
    if (!caja || M.abierto !== id) return;
    if (error) { caja.innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`; return; }
    caja.innerHTML = !data.length ? '<div class="cambio" style="padding:8px 0">Sin actualizaciones todavía.</div>'
      : data.map(a => `<div class="mi-upd ${a.tipo}">
          <div class="mi-upd-cab"><b>${esc(a.autor_nombre || '—')}</b> <span>${cuando(a.creado_en)}</span>
            ${a.tipo === 'comentario' && sesion && (a.autor_id === sesion.id || sesion.rol === 'admin_central') ? `<button class="cm-x" title="Borrar" onclick="Minutas.borrarAct(${a.id}, ${id})">✕</button>` : ''}</div>
          <div class="mi-upd-txt">${esc(a.texto)}${a.tipo === 'monday' && it.monday_texto ? ` <span class="cambio">(${esc(it.monday_texto)})</span>` : ''}</div></div>`).join('');
  }

  async function guardar(id) {
    const titulo = $('md-titulo').value.trim();
    if (!titulo) return toast('Escribí el compromiso', 'warning');
    const resp = [...new Set($('md-resp').value.split(',').map(s => s.trim()).filter(Boolean))];
    const cambio = { titulo, responsables: resp, fecha_comite: $('md-comite').value || null, fecha_limite: $('md-limite').value || null,
      estado: $('md-estado').value, prioridad: $('md-pri').value || null, equipo_id: $('md-eq').value.trim().toUpperCase() || null,
      notas: $('md-notas').value.trim() || null };
    const { data, error } = await sb.from('minuta_items').update(cambio).eq('id', id).select('*').single();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    Object.assign(M.items.find(x => x.id === id), data);
    toast('Guardado', 'success');
    M.abierto = null;
    cerrarModal();
    pintar();
  }
  async function comentar(id) {
    const txt = ($('md-act').value || '').trim();
    if (!txt) return $('md-act').focus();
    const { error } = await sb.from('minuta_actualizaciones').insert({ item_id: id, texto: txt, tipo: 'comentario', autor_id: sesion.id });
    if (error) return toast('No se pudo publicar: ' + error.message, 'error');
    const it = M.items.find(x => x.id === id);
    it.actualizado_en = new Date().toISOString(); it.actualizado_por_nombre = sesion.nombre;
    abrir(id);
    pintarLista();
  }
  async function borrarAct(aid, id) {
    if (!confirm('¿Borrar esta actualización?')) return;
    const { error } = await sb.from('minuta_actualizaciones').delete().eq('id', aid);
    if (error) return toast(error.message, 'error');
    abrir(id);
  }
  async function borrar(id) {
    const it = M.items.find(x => x.id === id);
    if (!confirm(`¿Borrar el compromiso "${it.titulo}"? Se borran también sus actualizaciones.`)) return;
    const { error } = await sb.from('minuta_items').delete().eq('id', id);
    if (error) return toast('No se pudo borrar: ' + error.message, 'error');
    M.items = M.items.filter(x => x.id !== id);
    M.abierto = null;
    cerrarModal();
    pintar();
  }
  async function nuevoTablero() {
    const nombre = (prompt('Nombre de la nueva minuta (ej.: "Comité semanal de obras")') || '').trim();
    if (!nombre) return;
    const { data, error } = await sb.from('minuta_tableros').insert({ nombre, orden: (M.tableros || []).length + 1 }).select('*').single();
    if (error) return toast('No se pudo crear: ' + error.message, 'error');
    M.tableros = null; M.tab = data.id; M.f.tab = data.id; guardarF(); M.items = null;
    mostrar();
  }

  // ════════════════════════════════════════════════════════════════
  // IMPRIMIR LA MINUTA DE UNA REUNIÓN
  // ════════════════════════════════════════════════════════════════
  function pedirImpresion() {
    const com = comites();
    const prox = uno(M.f.comite) || com[0] || hoy();
    abrirModal('Imprimir minuta de reunión', `
      <div class="form-grid">
        <div class="field"><label for="mp-fecha">Reunión del</label><input type="date" id="mp-fecha" value="${prox}" list="mp-fechas">
          <datalist id="mp-fechas">${com.map(c => `<option value="${c}">`).join('')}</datalist></div>
        <div class="field ancho"><label for="mp-asist">Asistentes (opcional)</label><input type="text" id="mp-asist" placeholder="Nombres separados por coma"></div>
      </div>
      <p class="cambio">Salen: los compromisos nuevos de esa reunión, los pendientes de reuniones anteriores y los cerrados desde la reunión anterior.</p>
      <div class="acciones"><button class="btn btn-primario" onclick="Minutas.imprimir()">Imprimir</button></div>`);
  }

  function imprimir() {
    const fecha = $('mp-fecha').value || hoy();
    const asist = ($('mp-asist').value || '').trim();
    cerrarModal();
    const tab = (M.tableros || []).find(t => t.id === M.tab) || {};
    const todos = M.items || [];
    const anterior = comites().filter(c => c < fecha)[0] || null;
    const nuevos = todos.filter(it => it.fecha_comite === fecha).sort((a, b) => (PRI_ORDEN[a.prioridad] ?? 9) - (PRI_ORDEN[b.prioridad] ?? 9) || a.id - b.id);
    const pend = todos.filter(it => it.estado !== 'Listo' && (!it.fecha_comite || it.fecha_comite < fecha))
      .sort((a, b) => (PRI_ORDEN[a.prioridad] ?? 9) - (PRI_ORDEN[b.prioridad] ?? 9) || String(a.fecha_comite).localeCompare(String(b.fecha_comite)));
    const fin = fecha + 'T23:59:59';
    const cerrados = todos.filter(it => it.estado === 'Listo' && it.fecha_comite !== fecha && it.cerrado_en && it.cerrado_en <= fin
      && (!anterior || it.cerrado_en.slice(0, 10) > anterior)).sort((a, b) => String(a.cerrado_en).localeCompare(String(b.cerrado_en)));
    let n = 0;
    const tabla = (l, titulo, conCierre) => !l.length ? '' : `<h2>${titulo} <small>(${l.length})</small></h2>
      <table><thead><tr><th>N°</th><th>Compromiso</th><th>Responsable</th><th>Comité</th><th>Estado</th><th>Prioridad</th><th>Límite</th><th>${conCierre ? 'Cerrado' : 'Últ. actualización'}</th></tr></thead><tbody>
      ${l.map(it => `<tr><td class="c">${++n}</td><td>${esc(it.titulo)}${it.notas ? `<div class="nota">${esc(it.notas)}</div>` : ''}</td><td>${esc((it.responsables || []).join(', '))}</td>
        <td class="c">${fmtFecha(it.fecha_comite)}</td><td class="c">${esc(it.estado)}</td><td class="c">${esc(it.prioridad || '')}</td>
        <td class="c ${vencido(it) ? 'v' : ''}">${fmtFecha(it.fecha_limite)}</td><td class="c">${conCierre ? fmtFecha((it.cerrado_en || '').slice(0, 10)) : esc(it.actualizado_por_nombre || '') + '<br>' + cuando(it.actualizado_en)}</td></tr>`).join('')}
      </tbody></table>`;
    const logo = new URL('./logo_tecsul.png', location.href).href;
    const w = window.open('', '_blank');
    if (!w) return toast('El navegador bloqueó la ventana de impresión', 'warning');
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Minuta ${esc(tab.nombre || '')} ${fmtFecha(fecha)}</title>
      <style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:calc(10px*var(--fs,1));color:#111;margin:0}
      .cab{display:flex;align-items:center;gap:18px;border-bottom:2px solid #1a2744;padding-bottom:6px}.cab img{width:120px}
      h1{font-size:calc(15px*var(--fs,1));margin:0}.sub{color:#444;margin-top:2px}h2{font-size:calc(12px*var(--fs,1));margin:14px 0 4px;color:#1a2744}h2 small{font-weight:400;color:#666}
      table{border-collapse:collapse;width:100%}th,td{border:.6px solid #999;padding:3px 5px;vertical-align:top}th{background:#e6e9ef;font-size:calc(9px*var(--fs,1))}
      td.c{text-align:center;white-space:nowrap}td.v{color:#b00020;font-weight:700}.nota{color:#555;font-size:calc(9px*var(--fs,1));margin-top:2px;white-space:pre-wrap}
      .pie{margin-top:16px;color:#666;font-size:calc(9px*var(--fs,1))}</style></head><body>
      <div class="cab"><img src="${logo}" alt="Tecsul"><div><h1>${esc(tab.nombre || 'Minuta de reunión')}</h1>
        <div class="sub">Reunión del ${fmtFecha(fecha)}${anterior ? ` · reunión anterior: ${fmtFecha(anterior)}` : ''}${asist ? ` · Asistentes: ${esc(asist)}` : ''}</div></div></div>
      ${tabla(nuevos, 'Compromisos de esta reunión')}
      ${tabla(pend, 'Pendientes de reuniones anteriores')}
      ${tabla(cerrados, anterior ? 'Cerrados desde la reunión anterior' : 'Cerrados', true)}
      ${!nuevos.length && !pend.length && !cerrados.length ? '<p>No hay compromisos para esta reunión.</p>' : ''}
      <div class="pie">Impreso el ${cuando(new Date().toISOString())} por ${esc(sesion ? sesion.nombre : '')} · Tecsul S.A.E.</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
    w.document.close();
  }

  // ── Excel ───────────────────────────────────────────────────────
  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = SHEETJS; s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el generador de Excel (¿hay señal?)'));
      document.head.appendChild(s);
    });
  }
  async function excel() {
    try { await cargarSheetJS(); } catch (e) { return toast(e.message, 'error'); }
    const tab = (M.tableros || []).find(t => t.id === M.tab) || {};
    const f = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400000 + 25569; };
    const l = filtrados().sort((a, b) => (a.estado === 'Listo') - (b.estado === 'Listo') || String(a.fecha_comite).localeCompare(String(b.fecha_comite)));
    const aoa = [[tab.nombre || 'Minuta'], [`${l.length} compromisos · descargado ${fmtFecha(hoy())}`], [],
      ['Grupo', 'Compromiso', 'Responsable', 'Fecha comité', 'Estado', 'Prioridad', 'Fecha límite', 'Equipo', 'Notas', 'Últ. actualización', 'Actualizado por', 'Cerrado']];
    l.forEach(it => aoa.push([it.estado === 'Listo' ? 'Ejecutados' : 'Pendientes', it.titulo, (it.responsables || []).join(', '), f(it.fecha_comite), it.estado,
      it.prioridad || '', f(it.fecha_limite), it.equipo_id || '', it.notas || '', cuando(it.actualizado_en), it.actualizado_por_nombre || '', f(it.cerrado_en)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (let r = 5; r <= aoa.length; r++) ['D', 'G', 'L'].forEach(c => { const x = ws[c + r]; if (x && x.t === 'n') x.z = 'dd/mm/yyyy'; });
    ws['!cols'] = [12, 60, 30, 12, 20, 10, 12, 10, 40, 16, 22, 12].map(wch => ({ wch }));
    ws['!autofilter'] = { ref: `A4:L${aoa.length}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Minuta');
    XLSX.writeFile(wb, `minuta_${(tab.nombre || 'reunion').replace(/[^\wÁÉÍÓÚÑáéíóúñ -]/g, '').trim().replace(/\s+/g, '_').slice(0, 40)}_${hoy()}.xlsx`);
  }

  // ════════════════════════════════════════════════════════════════
  function estilos() {
    if ($('mi-estilos')) return;
    const st = document.createElement('style');
    st.id = 'mi-estilos';
    st.textContent = `
      .mi-cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px; }
      .mi-tit { font-size: calc(17px*var(--fs,1)); margin: 0; color: var(--azul-oscuro); }
      .mi-tab { font-size: calc(15px*var(--fs,1)); font-weight: 700; padding: 7px 10px; border-radius: 8px; border: 1px solid #dde3ec; color: var(--azul-oscuro); max-width: 100%; }
      .mi-grupo { background: #fff; border-radius: 10px; box-shadow: var(--sombra); margin: 12px 0; overflow: hidden; border-left: 5px solid var(--azul-medio); }
      .mi-g-listo { border-left-color: var(--verde); }
      .mi-gt { font-weight: 700; padding: 10px 14px; color: var(--azul-oscuro); font-size: calc(14.5px*var(--fs,1)); }
      .mi-g-listo .mi-gt { color: var(--verde); }
      .mi-gt span { background: #eef1f6; color: var(--gris-texto); border-radius: 10px; padding: 1px 8px; font-size: calc(12px*var(--fs,1)); margin-left: 6px; }
      .mi-t { white-space: normal; }
      .mi-t td { vertical-align: middle; }
      .mi-titulo { min-width: 280px; max-width: 520px; cursor: pointer; }
      .mi-titulo b { font-weight: 600; }
      .mi-resp { min-width: 150px; max-width: 240px; cursor: pointer; }
      .mi-persona { display: inline-block; background: #eef3ff; color: var(--azul-medio); border-radius: 12px; padding: 1px 8px; margin: 1px 0; font-size: calc(11.5px*var(--fs,1)); white-space: nowrap; }
      .mi-act { font-size: calc(11.5px*var(--fs,1)); color: var(--gris-texto); white-space: nowrap; cursor: pointer; }
      .mi-act span { font-size: calc(11px*var(--fs,1)); color: #8a93a3; }
      .mi-venc { color: var(--rojo); font-weight: 700; white-space: nowrap; }
      .mi-pill { border: none; font: inherit; font-size: calc(12px*var(--fs,1)); font-weight: 600; padding: 4px 6px; border-radius: 12px; cursor: pointer; -webkit-appearance: none; appearance: none; text-align: center; min-width: 96px; }
      .mi-critica { background: #7a1020 !important; color: #fff !important; }
      .chip.mi-critica { background: #7a1020; color: #fff; }
      .mi-vacia { background: #f3f5f9; color: #9aa3b2; }
      .mi-nuevo { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #eef1f5; }
      .mi-nuevo input { flex: 1; border: 1px dashed #c5cede; border-radius: 8px; padding: 9px 10px; font: inherit; }
      .mi-det textarea { width: 100%; }
      .mi-h4 { margin: 18px 0 8px; color: var(--azul-oscuro); }
      .mi-escribir { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; }
      .mi-escribir textarea { flex: 1; border: 1px solid #dde3ec; border-radius: 8px; padding: 8px; font: inherit; }
      .mi-upd { border: 1px solid #eef1f5; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: #fbfcfe; }
      .mi-upd.estado, .mi-upd.monday { background: #f5f6f8; font-size: calc(12.5px*var(--fs,1)); }
      .mi-upd-cab { display: flex; gap: 8px; align-items: center; font-size: calc(12.5px*var(--fs,1)); }
      .mi-upd-cab span { color: #8a93a3; font-size: calc(11.5px*var(--fs,1)); flex: 1; }
      .mi-upd-txt { margin-top: 4px; white-space: pre-wrap; }
      .cm-x { border: none; background: none; cursor: pointer; color: var(--azul-medio); font-size: calc(13px*var(--fs,1)); padding: 0 3px; }
      @media (max-width: 700px) { .mi-titulo { min-width: 220px; } }`;
    document.head.appendChild(st);
  }

  return { mostrar, filtro, filtroPrioridad, limpiar, ordenarPor, toggleListos, masListos, tablero, crear, cambiar, abrir, guardar,
           comentar, borrarAct, borrar, nuevoTablero, pedirImpresion, imprimir, excel };
})();
