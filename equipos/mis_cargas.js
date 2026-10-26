// ══════════════════════════════════════════════════════════════════
// MIS CARGAS — Historial de taller e Historial de combustible
// Tecsul S.A.E. · v20261026c
//
// Igual que el "Historial de partes" del operador: el mecánico ve sus
// reportes de taller y el despachador sus cargas de combustible, con
// filtro de fechas, buscador, detalle con fotos y exportar. Dentro de
// las 24 h de cargado puede corregirlo o eliminarlo (va a la papelera,
// 7 días). La base vuelve a controlar todo:
//   · lectura: RLS otr_lectura / comb_lectura (lo suyo: usuario_id,
//     técnico o despachador = su cédula) — SQL 43
//   · corregir / eliminar: corregir_registro() y eliminar_registro()
//     (24 h y solo lo propio) — SQL 54
// No hace falta correr ningún SQL nuevo.
//
// Lo ven quienes tienen el formulario de taller o de combustible y no
// tienen ya la vista completa (Órdenes de trabajo / Control de
// combustible): o sea, operadores mecánicos y despachadores.
// ══════════════════════════════════════════════════════════════════
window.MisCargas = (() => {
  const DIA_MS = 24 * 3600 * 1000;
  const CONDICION = {
    'Reporte de Fallas': 'Reporte de fallas',
    'Diagnóstico Inicial - Generación OT': 'Diagnóstico inicial',
    'Registro de Trabajos - OT': 'Registro de trabajos',
    'Cierre de OT - Taller': 'Inspección final'
  };
  const ACT = {
    'Despacho de combustible': 'Despacho', 'Ingreso de combustible': 'Ingreso',
    'Medición de tanque': 'Medición', 'Prueba de desviación': 'Prueba'
  };
  // pantalla → tipo de registro
  const TIPO = { histtaller: 'taller', histcomb: 'combustible' };

  const S = {
    taller:      { datos: null, desde: '', hasta: '', q: '', act: '', persona: '' },
    combustible: { datos: null, desde: '', hasta: '', q: '', act: '', persona: '' }
  };
  let abierto = null;   // { tipo, x } en el detalle

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const haceDias = (n) => { const d = new Date(Date.now() - n * DIA_MS); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fFecha = (f) => { if (!f) return ''; const p = String(f).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f); };
  const fMomento = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return String(v);
    const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fNum = (v, dec = 1) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? ''
    : Number(v).toLocaleString('es-PY', { maximumFractionDigits: dec });
  const n0 = (v) => isNaN(Number(v)) ? 0 : Number(v);
  const nombre = (ced, texto) => {
    if (!ced) return texto || '';
    const o = ((typeof cat !== 'undefined' && cat ? cat : {}).operadores || []).find(x => x.v === ced);
    return o ? o.t.replace(/^[^_]*_/, '') : (texto || ced);
  };
  const obraCorta = (clave) => String(clave || '').replace(/^[^_]*_\s*/, '');
  const fxCat = () => { try { return JSON.parse(localStorage.getItem('fx_cat') || '{}') || {}; } catch (e) { return {}; } };
  // v20261026c: el administrador central ve lo de todos y corrige siempre
  const esAdmin = () => !!sesion && sesion.rol === 'admin_central';
  const editable = (x) => !!x && !!sesion && (esAdmin() || (x.usuario_id === sesion.id
    && Date.now() - new Date(x.creado_en).getTime() < DIA_MS));
  const enLineaAhora = () => navigator.onLine;

  // ════════════════════════════════════════════════════════════════
  // PANTALLA
  // ════════════════════════════════════════════════════════════════
  function mostrar(pantalla) {
    const tipo = TIPO[pantalla];
    if (!tipo) return;
    estilos();
    const s = S[tipo];
    if (!s.desde) { s.desde = haceDias(30); s.hasta = hoy(); }
    const caja = $('screen-' + pantalla);
    const esT = tipo === 'taller';
    caja.innerHTML = `
      <div id="mc-${tipo}-pend"></div>
      <div class="filtros">
        <div class="filtro"><label>Desde</label><input type="date" id="mc-${tipo}-desde" value="${s.desde}" onchange="MisCargas.fechas('${tipo}')"></div>
        <div class="filtro"><label>Hasta</label><input type="date" id="mc-${tipo}-hasta" value="${s.hasta}" onchange="MisCargas.fechas('${tipo}')"></div>
        ${esT ? '' : `<div class="filtro"><label>Actividad</label><select id="mc-${tipo}-act" onchange="MisCargas.filtrar('${tipo}')">
          <option value="">Todas</option>${Object.entries(ACT).map(([k, t]) => `<option value="${esc(k)}" ${s.act === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`}
        ${esAdmin() ? `<div class="filtro"><label>Persona</label><select id="mc-${tipo}-persona" onchange="MisCargas.persona('${tipo}')">
          <option value="">Todos</option><option value="yo" ${s.persona === 'yo' ? 'selected' : ''}>Solo lo mío</option>
          ${((typeof cat !== 'undefined' && cat && cat.operadores) || []).map(o => `<option value="${esc(o.v)}" ${s.persona === o.v ? 'selected' : ''}>${esc(o.t.replace(/^[^_]*_/, ''))}</option>`).join('')}</select></div>` : ''}
        <div class="filtro crece"><label>Buscar</label><input type="text" id="mc-${tipo}-q" value="${esc(s.q)}"
          placeholder="${esT ? 'OT, equipo, falla, detalle…' : 'Equipo, tanque, boleta, operador…'}" oninput="MisCargas.filtrar('${tipo}')"></div>
        <div class="filtro"><label>&nbsp;</label><div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-filtro" onclick="MisCargas.atajo('${tipo}',7)">7 días</button>
          <button class="btn-filtro" onclick="MisCargas.atajo('${tipo}',30)">30 días</button>
          <button class="btn-filtro" onclick="MisCargas.cargar('${tipo}',true)">Actualizar</button>
          <button class="btn-filtro exportar" onclick="MisCargas.exportar('${tipo}')">Exportar</button></div></div>
      </div>
      <div class="hist-info" id="mc-${tipo}-info"></div>
      <div id="mc-${tipo}-lista"><div class="empty-state">Cargando…</div></div>
      <p class="hist-info" style="margin-top:8px">Tocá una carga para ver el detalle. Lo que cargaste en las últimas 24 h lo podés corregir o eliminar.</p>`;
    pendientes(tipo);
    cargar(tipo);
  }

  // Lo que todavía está en el teléfono sin enviar (cola de formularios.js)
  function pendientes(tipo) {
    const box = $(`mc-${tipo}-pend`);
    if (!box) return;
    let l = [];
    try { l = (window.FX && FX.pendientes ? FX.pendientes() : []).filter(p => p.tipo === tipo); } catch (e) { l = []; }
    box.innerHTML = !l.length ? '' : `<div class="card"><div class="card-header">⏳ ${l.length} sin enviar (en este teléfono)</div><div class="card-body">
      ${l.map(p => `<div class="history-item-header" style="margin-bottom:8px"><div><b>${esc(p.resumen)}</b>
        <div class="meta">${fFecha(p.fecha)}${p.error ? ' · ' + esc(p.error) : ''}</div></div>
        <span class="badge ${p.error ? 'badge-error' : 'badge-pendiente'}">${p.error ? 'Error' : 'Pendiente'}</span></div>`).join('')}
      <button class="btn-mini btn-neutro" onclick="FX.sincronizar().then(()=>MisCargas.cargar('${tipo}',true))">Enviar ahora</button>
      <span class="ayuda" style="margin-left:6px">Para descartar uno con error, andá al formulario.</span></div></div>`;
  }

  function fechas(tipo) {
    S[tipo].desde = $(`mc-${tipo}-desde`).value;
    S[tipo].hasta = $(`mc-${tipo}-hasta`).value;
    cargar(tipo, true);
  }
  function persona(tipo) {
    S[tipo].persona = $(`mc-${tipo}-persona`).value;
    cargar(tipo, true);
  }
  function atajo(tipo, dias) {
    S[tipo].desde = haceDias(dias); S[tipo].hasta = hoy();
    $(`mc-${tipo}-desde`).value = S[tipo].desde; $(`mc-${tipo}-hasta`).value = S[tipo].hasta;
    cargar(tipo, true);
  }

  // ════════════════════════════════════════════════════════════════
  // DATOS — siempre lo propio, aunque la base deje ver más
  // ════════════════════════════════════════════════════════════════
  const CLAVE_LOCAL = (tipo) => 'mc_' + tipo + '_' + (sesion ? sesion.id : '');

  async function cargar(tipo, forzar) {
    const s = S[tipo];
    pendientes(tipo);
    if (!enLineaAhora()) {
      try { s.datos = JSON.parse(localStorage.getItem(CLAVE_LOCAL(tipo)) || 'null'); } catch (e) { s.datos = null; }
      if (!s.datos) return lista(tipo, 'Sin conexión y sin historial guardado en este teléfono.');
      toast('Sin señal: se muestra lo último guardado', 'warning');
      return filtrar(tipo);
    }
    if (!forzar && s.datos && s.cargadoDesde === s.desde && s.cargadoHasta === s.hasta && s.cargadoPersona === s.persona) return filtrar(tipo);
    lista(tipo, 'Cargando…');
    try {
      // Operador: siempre lo suyo. Admin central: todos, solo lo suyo o una persona.
      const col = tipo === 'taller' ? 'tecnico_cedula' : 'despachador_cedula';
      const mios = [`usuario_id.eq.${sesion.id}`];
      if (sesion.cedula) mios.push(`${col}.eq.${sesion.cedula}`);
      const per = esAdmin() ? s.persona : 'yo';
      let q;
      if (tipo === 'taller') {
        q = sb.from('ot_registros')
          .select('*, ordenes_trabajo(numero,nombre,equipo_id,trabajo_general,estado), ot_registro_items(*), ot_checklist(*)')
          .order('fecha', { ascending: false }).order('creado_en', { ascending: false });
      } else {
        q = sb.from('combustible_movimientos').select('*')
          .order('fecha', { ascending: false }).order('hora', { ascending: false, nullsFirst: false });
      }
      if (per === 'yo') q = q.or(mios.join(','));
      else if (per) q = q.eq(col, per);
      if (s.desde) q = q.gte('fecha', s.desde);
      if (s.hasta) q = q.lte('fecha', s.hasta);
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      s.datos = data || [];
      s.cargadoDesde = s.desde; s.cargadoHasta = s.hasta; s.cargadoPersona = s.persona;
      try { localStorage.setItem(CLAVE_LOCAL(tipo), JSON.stringify(s.datos.slice(0, 300))); } catch (e) { /* sin lugar: no importa */ }
      filtrar(tipo);
    } catch (e) {
      lista(tipo, 'No se pudo cargar: ' + esc(e.message || e));
    }
  }

  function lista(tipo, msg) {
    const l = $(`mc-${tipo}-lista`);
    if (l) l.innerHTML = `<div class="empty-state">${msg}</div>`;
    const i = $(`mc-${tipo}-info`);
    if (i) i.textContent = '';
  }

  // Filas con los textos ya armados (para mostrar, buscar y exportar)
  function filaTaller(r) {
    const o = r.ordenes_trabajo || {};
    const horas = (r.ot_registro_items || []).reduce((a, i) => a + n0(i.horas), 0)
      + n0(r.horas_mantenimiento) + n0(r.horas_supervision_tercerizada) + n0(r.horas_traslado);
    return Object.assign({}, r, {
      _ot: o.numero || '', _equipo: o.equipo_id || o.trabajo_general || '', _nombre: o.nombre || '',
      _estadoOT: o.estado || '', _cond: CONDICION[r.condicion] || r.condicion || '',
      _tecnico: nombre(r.tecnico_cedula, r.tecnico_texto), _horas: horas,
      _fallas: (r.fallas || []).join(', ')
    });
  }
  function filaComb(x) {
    return Object.assign({}, x, {
      _act: ACT[x.actividad] || x.actividad || '',
      _tanque: x.tanque_salida_id || x.tanque_fijo_id || x.tanque_salida_texto || '',
      _recibe: x.actividad === 'Ingreso de combustible' ? (x.proveedor || '') : (x.equipo_id || x.receptor_texto || ''),
      _litros: x.litros ?? x.litros_ingresados ?? x.stock_medido ?? null,
      _lectura: x.horometro ?? x.odometro ?? null,
      _operador: nombre(x.operador_cedula, x.operador_texto),
      _despachador: nombre(x.despachador_cedula, x.despachador_texto),
      _obra: obraCorta(x.obra_clave) || x.obra_texto || ''
    });
  }

  function filtradas(tipo) {
    const s = S[tipo];
    const qEl = $(`mc-${tipo}-q`), aEl = $(`mc-${tipo}-act`);
    if (qEl) s.q = qEl.value; if (aEl) s.act = aEl.value;
    const palabras = (s.q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filas = (s.datos || []).map(tipo === 'taller' ? filaTaller : filaComb);
    return filas.filter(x => {
      if (tipo === 'combustible' && s.act && x.actividad !== s.act) return false;
      if (!palabras.length) return true;
      const pajar = (tipo === 'taller'
        ? [x._ot, x._equipo, x._nombre, x._cond, x._tecnico, x._fallas, x.estado_maquina, x.detalle, x.observaciones, x.ubicacion_texto, fFecha(x.fecha)]
        : [x._act, x._tanque, x._recibe, x._operador, x._despachador, x.nro_boleta, x._obra, x.observaciones, fFecha(x.fecha)]
      ).join(' ').toLowerCase();
      return palabras.every(p => pajar.includes(p));
    });
  }

  function filtrar(tipo) {
    const filas = filtradas(tipo);
    const info = $(`mc-${tipo}-info`), l = $(`mc-${tipo}-lista`);
    if (!l) return;
    if (tipo === 'taller') {
      const h = filas.reduce((a, x) => a + x._horas, 0);
      info.textContent = `${filas.length} reporte(s)${h ? ' · ' + fNum(h) + ' h cargadas' : ''}`;
    } else {
      const desp = filas.filter(x => x.actividad === 'Despacho de combustible');
      const ing = filas.filter(x => x.actividad === 'Ingreso de combustible');
      info.textContent = `${filas.length} carga(s) · ${fNum(desp.reduce((a, x) => a + n0(x.litros), 0))} L despachados`
        + (ing.length ? ` · ${fNum(ing.reduce((a, x) => a + n0(x.litros_ingresados), 0))} L ingresados` : '');
    }
    if (!filas.length) {
      l.innerHTML = `<div class="empty-state">${(S[tipo].datos || []).length ? 'Nada coincide con la búsqueda.' : 'No cargaste nada en ese período.'}</div>`;
      return;
    }
    const chip24 = (x) => editable(x) && !esAdmin() ? '<span class="badge badge-pendiente" title="Todavía lo podés corregir">✎ 24 h</span>' : '';
    l.innerHTML = filas.map(x => tipo === 'taller'
      ? `<div class="history-item" onclick="MisCargas.abrir('taller','${x.id}')"><div class="history-item-header">
          <div><h3>${x._ot ? 'OT ' + esc(x._ot) + ' · ' : ''}${esc(x._equipo)}</h3>
          <div class="meta">${fFecha(x.fecha)} · ${esc(x._cond)}${x.estado_maquina ? ' · ' + esc(x.estado_maquina) : ''}${x._horas ? ' · ' + fNum(x._horas) + ' h' : ''}
            ${esAdmin() && x._tecnico ? ' · ' + esc(x._tecnico) : ''}${x._nombre ? '<br>' + esc(x._nombre) : ''}</div></div>
          <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            ${x._estadoOT ? `<span class="badge ${x._estadoOT === 'Cerrada' ? 'badge-enviado' : 'badge-pendiente'}">OT ${esc(x._estadoOT)}</span>` : ''}${chip24(x)}</span>
        </div></div>`
      : `<div class="history-item" onclick="MisCargas.abrir('combustible','${x.id}')"><div class="history-item-header">
          <div><h3>${esc(x._act)} · ${fNum(x._litros)} L${x._recibe ? ' → ' + esc(x._recibe) : ''}</h3>
          <div class="meta">${fFecha(x.fecha)}${x.hora ? ' ' + String(x.hora).slice(0, 5) : ''}${x._tanque ? ' · ' + esc(x._tanque) : ''}
            ${x.nro_boleta ? ' · boleta ' + esc(x.nro_boleta) : ''}${x._operador ? ' · ' + esc(x._operador) : ''}${esAdmin() && x._despachador ? ' · desp. ' + esc(x._despachador) : ''}</div></div>
          <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            <span class="badge badge-enviado">Enviado</span>${chip24(x)}</span>
        </div></div>`).join('');
  }

  function exportar(tipo) {
    const filas = filtradas(tipo);
    if (!filas.length) return toast('No hay nada para exportar', 'warning');
    if (tipo === 'taller') {
      const cols = [['fecha', 'Fecha'], ['_ot', 'OT'], ['_equipo', 'Equipo'], ['_nombre', 'Nombre OT'], ['_cond', 'Condición'],
        ['_tecnico', 'Técnico'], ['estado_maquina', 'Estado máquina'], ['tipo_medicion', 'Medición'], ['lectura', 'Lectura'],
        ['_horas', 'Horas'], ['_fallas', 'Fallas'], ['detalle', 'Detalle'], ['observaciones', 'Observaciones'], ['creado_en', 'Cargado']];
      bajarCSV('mis_reportes_taller', cols.map(c => c[1]), filas.map(x => cols.map(([k]) => x[k])));
    } else {
      const cols = [['fecha', 'Fecha'], ['hora', 'Hora'], ['_act', 'Actividad'], ['_tanque', 'Tanque'], ['_recibe', 'Recibe / proveedor'],
        ['_operador', 'Operador'], ['_litros', 'Litros'], ['_lectura', 'Horóm./Km'], ['cuenta_litros_inicial', 'C. L. inicial'],
        ['cuenta_litros_final', 'C. L. final'], ['nro_boleta', 'Boleta'], ['_despachador', 'Despachador'], ['_obra', 'Obra'],
        ['observaciones', 'Observaciones'], ['creado_en', 'Cargado']];
      bajarCSV('mis_cargas_combustible', cols.map(c => c[1]), filas.map(x => cols.map(([k]) => x[k])));
    }
    toast(`${filas.length} registros exportados`, 'success');
  }

  // ════════════════════════════════════════════════════════════════
  // DETALLE
  // ════════════════════════════════════════════════════════════════
  const dato = (e, v) => (v === null || v === undefined || v === '') ? ''
    : `<div class="mc-dato"><div class="e">${e}</div><div class="v">${v}</div></div>`;
  function galeria(rutas, bucket) {
    const l = (rutas || []).filter(Boolean);
    if (!l.length) return '';
    return `<div class="mc-fotos">${l.map(r => /^https?:/i.test(r)
      ? `<a href="${esc(r)}" target="_blank" rel="noopener"><img src="${esc(r)}" loading="lazy" alt=""></a>`
      : `<a data-bucket="${bucket}" data-ruta="${esc(r)}" target="_blank" rel="noopener"><img alt="" data-bucket="${bucket}" data-ruta="${esc(r)}"></a>`).join('')}</div>`;
  }
  async function firmarFotos(cont) {
    const porBucket = {};
    cont.querySelectorAll('img[data-ruta]').forEach(img => {
      (porBucket[img.dataset.bucket] = porBucket[img.dataset.bucket] || new Set()).add(img.dataset.ruta);
    });
    for (const [bucket, rutas] of Object.entries(porBucket)) {
      try {
        const { data } = await sb.storage.from(bucket).createSignedUrls([...rutas], 3600);
        (data || []).forEach(d => {
          if (!d.signedUrl) return;
          cont.querySelectorAll(`[data-bucket="${bucket}"][data-ruta="${CSS.escape(d.path)}"]`).forEach(el => {
            if (el.tagName === 'IMG') el.src = d.signedUrl; else el.href = d.signedUrl;
          });
        });
      } catch (e) { /* sin señal o sin permiso: quedan sin foto */ }
    }
    // Las que no se pudieron firmar no se muestran rotas
    cont.querySelectorAll('img[data-ruta]').forEach(img => { if (!img.getAttribute('src')) img.closest('a').style.display = 'none'; });
  }

  function modal(titulo, cuerpo) {
    let m = $('mc-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'mc-modal';
      m.className = 'modal';
      m.onclick = (e) => { if (e.target === m) cerrar(); };
      m.innerHTML = `<div class="modal-card"><div class="modal-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <b id="mc-titulo"></b><button class="btn-mini btn-neutro" onclick="MisCargas.cerrar()">Cerrar</button></div>
        <div class="modal-body" id="mc-cuerpo"></div></div>`;
      document.body.appendChild(m);
    }
    $('mc-titulo').innerHTML = titulo;
    $('mc-cuerpo').innerHTML = cuerpo;
    m.classList.add('show');
  }
  function cerrar() { const m = $('mc-modal'); if (m) m.classList.remove('show'); abierto = null; }

  function abrir(tipo, id) {
    const x = (S[tipo].datos || []).find(r => String(r.id) === String(id));
    if (!x) return toast('No se encontró', 'error');
    abierto = { tipo, x };
    if (tipo === 'taller') abrirTaller(x); else abrirComb(x);
    firmarFotos($('mc-cuerpo'));
  }

  function abrirTaller(r) {
    const f = filaTaller(r);
    const items = r.ot_registro_items || [], chk = r.ot_checklist || [];
    const boletas = Array.isArray(r.boletas_salida) ? r.boletas_salida : [];
    const atencion = chk.filter(c => /^requiere/i.test(c.resultado || ''));
    modal(`${f._ot ? 'OT ' + esc(f._ot) + ' · ' : ''}${esc(f._equipo)}`, `
      <div class="mc-datos">
        ${dato('Fecha', fFecha(r.fecha))}
        ${dato('Condición', esc(f._cond))}
        ${dato('Orden de trabajo', esc(f._nombre) + (f._estadoOT ? ` <span class="badge ${f._estadoOT === 'Cerrada' ? 'badge-enviado' : 'badge-pendiente'}">${esc(f._estadoOT)}</span>` : ''))}
        ${dato('Técnico', esc(f._tecnico))}
        ${dato('Ubicación', esc(r.ubicacion_texto))}
        ${dato('Obra', esc(obraCorta(r.obra_clave)))}
        ${r.lectura !== null && r.lectura !== undefined ? dato(esc(r.tipo_medicion || 'Lectura'), fNum(r.lectura)) : ''}
        ${dato('Estado de la máquina', esc(r.estado_maquina))}
        ${r.finaliza_ot ? dato('Finalizó la OT', 'Sí') : ''}
        ${f._horas ? dato('Horas cargadas', fNum(f._horas)) : ''}
        ${dato('Cargado', fMomento(r.creado_en))}
      </div>
      ${(r.fallas || []).length ? `<div style="margin:10px 0 4px">${r.fallas.map(x => `<span class="mc-chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${(r.trabajo_ejecutado || []).length ? `<p class="mc-texto"><b>Trabajo ejecutado:</b> ${r.trabajo_ejecutado.map(esc).join(', ')}</p>` : ''}
      ${items.length ? `<table class="mc-tabla"><thead><tr><th>Sistema</th><th>Componente</th><th>Horas</th><th>Estado</th></tr></thead><tbody>${
        items.map(i => `<tr><td>${esc(i.sistema)}</td><td>${esc(i.componente)}</td><td>${fNum(i.horas)}</td><td>${esc(i.estado_reparacion || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${r.tipo_mantenimiento ? `<p class="mc-texto"><b>Mantenimiento ${esc(r.tipo_mantenimiento)} h</b>${r.horas_mantenimiento ? ' · ' + fNum(r.horas_mantenimiento) + ' h de trabajo' : ''}</p>` : ''}
      ${r.horas_supervision_tercerizada ? `<p class="mc-texto">Supervisión tercerizada: ${fNum(r.horas_supervision_tercerizada)} h</p>` : ''}
      ${r.realizo_traslado ? `<p class="mc-texto">Traslado: ${fNum(r.horas_traslado)} h</p>` : ''}
      ${boletas.length ? `<p class="mc-texto"><b>Boletas de salida:</b> ${boletas.map(b => esc([b.numero, fFecha(b.fecha)].filter(Boolean).join(' del '))).join(' · ')}</p>` : ''}
      ${chk.length ? `<details class="mc-texto"><summary>Checklist: ${chk.length} ítems${atencion.length ? ` · <b style="color:var(--rojo)">${atencion.length} requieren atención</b>` : ''}</summary>
        ${chk.map(c => `<div class="meta">${esc(c.checklist)} · ${esc(c.item)}: <i>${esc(c.resultado)}</i></div>`).join('')}</details>` : ''}
      ${r.detalle ? `<p class="mc-texto">${esc(r.detalle)}</p>` : ''}
      ${r.observaciones ? `<p class="mc-texto"><b>Obs.:</b> ${esc(r.observaciones)}</p>` : ''}
      ${galeria([r.foto_lectura, ...(r.fotos || []), ...(r.fotos_boletas || [])], 'taller')}
      ${bloqueEdicion(r, 'taller')}`);
  }

  function abrirComb(x) {
    const f = filaComb(x);
    modal(`${esc(f._act)} · ${fFecha(x.fecha)}`, `
      <div class="mc-datos">
        ${dato('Fecha y hora', fFecha(x.fecha) + (x.hora ? ' ' + String(x.hora).slice(0, 5) : ''))}
        ${dato('Tanque', esc(f._tanque))}
        ${x.actividad === 'Ingreso de combustible' ? dato('Proveedor', esc(x.proveedor)) : dato('Recibe', esc(f._recibe))}
        ${dato('Propietario', esc(x.propietario))}
        ${dato('Operador', esc(f._operador))}
        ${dato('Litros', fNum(f._litros))}
        ${x.litros_contador !== null && x.litros_contador !== undefined ? dato('Según cuenta litros', fNum(x.litros_contador) + ` (${fNum(x.cuenta_litros_inicial)} → ${fNum(x.cuenta_litros_final)})`) : ''}
        ${f._lectura !== null && f._lectura !== undefined ? dato(x.odometro !== null && x.odometro !== undefined ? 'Odómetro' : 'Horómetro', fNum(f._lectura)) : ''}
        ${dato('Boleta', esc(x.nro_boleta))}
        ${dato('Despachador', esc(f._despachador))}
        ${dato('Obra', esc(f._obra))}
        ${x.prueba_desviacion_1 !== null && x.prueba_desviacion_1 !== undefined ? dato('Pruebas de desviación', [x.prueba_desviacion_1, x.prueba_desviacion_2, x.prueba_desviacion_3].filter(v => v !== null && v !== undefined).join(' · ')) : ''}
        ${dato('Cargado', fMomento(x.creado_en))}
      </div>
      ${x.observaciones ? `<p class="mc-texto">${esc(x.observaciones)}</p>` : ''}
      ${galeria([x.foto_cuenta_inicial, x.foto_cuenta_final, x.foto_boleta], 'combustible')}
      ${bloqueEdicion(x, 'combustible')}`);
  }

  // ════════════════════════════════════════════════════════════════
  // CORREGIR Y ELIMINAR (24 h, lo propio — la base lo vuelve a controlar)
  // ════════════════════════════════════════════════════════════════
  // [columna, etiqueta, tipo]
  function camposComb(x) {
    const tq = x.actividad === 'Despacho de combustible' ? 'tanque_salida_id' : 'tanque_fijo_id';
    const base = [['fecha', 'Fecha', 'fecha'], ['hora', 'Hora', 'hora'], [tq, 'Tanque', 'tanque']];
    const fin = [['nro_boleta', 'Boleta', 'texto'], ['obra_clave', 'Obra', 'obra'], ['observaciones', 'Observaciones', 'txt']];
    const odo = x.odometro !== null && x.odometro !== undefined;
    if (x.actividad === 'Despacho de combustible') return base.concat([
      ['equipo_id', 'Equipo que recibe', 'equipo'], ['operador_cedula', 'Operador', 'persona'], ['litros', 'Litros', 'num'],
      ['cuenta_litros_inicial', 'Cuenta litros inicial', 'num'], ['cuenta_litros_final', 'Cuenta litros final', 'num'],
      [odo ? 'odometro' : 'horometro', odo ? 'Odómetro' : 'Horómetro', 'num']], fin);
    if (x.actividad === 'Ingreso de combustible') return base.concat([
      ['proveedor', 'Proveedor', 'texto'], ['litros_ingresados', 'Litros ingresados', 'num']], fin);
    if (x.actividad === 'Medición de tanque') return base.concat([['stock_medido', 'Stock medido (L)', 'num']], fin);
    return base.concat([['prueba_desviacion_1', 'Prueba 1', 'num'], ['prueba_desviacion_2', 'Prueba 2', 'num'],
      ['prueba_desviacion_3', 'Prueba 3', 'num']], fin);
  }
  function camposTaller(r) {
    return [['fecha', 'Fecha', 'fecha'], ['estado_maquina', 'Estado de la máquina', 'texto'],
      ['tipo_medicion', 'Tipo de medición', 'texto'], ['lectura', 'Lectura', 'num'],
      ...(r.tipo_mantenimiento ? [['horas_mantenimiento', 'Horas de mantenimiento', 'num']] : []),
      ...(r.horas_supervision_tercerizada !== null && r.horas_supervision_tercerizada !== undefined ? [['horas_supervision_tercerizada', 'Horas supervisión tercerizada', 'num']] : []),
      ...(r.realizo_traslado ? [['horas_traslado', 'Horas de traslado', 'num']] : []),
      ['detalle', 'Detalle', 'txt'], ['observaciones', 'Observaciones', 'txt']];
  }

  function control(x, [k, et, tipo]) {
    const id = 'mc-c-' + k, v = x[k] ?? '';
    const opcs = (lista) => `<select id="${id}"><option value="">—</option>${
      (v && !lista.some(o => o[0] === v) ? [[v, v]] : []).concat(lista).map(([val, tx]) =>
        `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(tx)}</option>`).join('')}</select>`;
    const C = fxCat(), cat0 = (typeof cat !== 'undefined' && cat) || {};
    let html;
    if (tipo === 'tanque') html = opcs((C.equipos || []).filter(e => e.categoria === 'tanque').map(e => [e.id, e.id + (e.descripcion ? ' · ' + e.descripcion : '')]));
    else if (tipo === 'equipo') html = opcs((C.equipos || cat0.equipos || []).map(e => e.id ? [e.id, e.id + (e.descripcion ? ' · ' + e.descripcion : '')] : [e.v, e.t.replace('_', ' · ')]));
    else if (tipo === 'persona') html = opcs((cat0.operadores || []).map(o => [o.v, o.t.replace(/^[^_]*_/, '')]));
    else if (tipo === 'obra') html = opcs((cat0.obras || []).map(o => [o.v, obraCorta(o.v)]));
    else if (tipo === 'txt') html = `<textarea id="${id}">${esc(v)}</textarea>`;
    else if (tipo === 'num') html = `<input id="${id}" type="number" step="any" inputmode="decimal" value="${esc(v)}">`;
    else if (tipo === 'hora') html = `<input id="${id}" type="time" value="${esc(v ? String(v).slice(0, 5) : '')}">`;
    else if (tipo === 'fecha') html = `<input id="${id}" type="date" value="${esc(String(v).slice(0, 10))}">`;
    else html = `<input id="${id}" type="text" value="${esc(v)}">`;
    return `<div class="field${tipo === 'txt' ? ' mc-ancho' : ''}"><label for="${id}">${et}</label>${html}</div>`;
  }

  function bloqueEdicion(x, tipo) {
    if (!editable(x)) return x.usuario_id === (sesion && sesion.id)
      ? '<p class="hist-info" style="margin-top:12px">Pasaron más de 24 h: para corregirlo pedíselo a taller o a administración.</p>' : '';
    const vence = new Date(new Date(x.creado_en).getTime() + DIA_MS);
    const campos = tipo === 'taller' ? camposTaller(x) : camposComb(x);
    const items = tipo === 'taller' ? (x.ot_registro_items || []) : [];
    return `
      <div class="mc-acciones"><button class="btn-mini btn-neutro" onclick="MisCargas.verEdicion()">✎ Corregir o eliminar</button>
        <span class="hist-info">${esAdmin() ? 'como administrador lo podés corregir siempre' : 'hasta el ' + fMomento(vence)}</span></div>
      <div id="mc-edicion" style="display:none">
        <div class="card" style="margin-top:12px"><div class="card-header">Corregir</div><div class="card-body">
          <div class="mc-grid">${campos.map(c => control(x, c)).join('')}</div>
          ${items.length ? `<table class="mc-tabla"><thead><tr><th>Sistema</th><th>Componente</th><th>Horas</th><th>Estado</th></tr></thead><tbody>${
            items.map((i, n) => `<tr><td>${esc(i.sistema)}</td><td>${esc(i.componente)}</td>
              <td><input id="mc-ih-${n}" type="number" step="0.5" value="${esc(i.horas ?? '')}" style="width:70px"></td>
              <td><input id="mc-ie-${n}" value="${esc(i.estado_reparacion || '')}"></td></tr>`).join('')}</tbody></table>` : ''}
          <button class="btn-submit mc-btn" onclick="MisCargas.guardar()">Guardar corrección</button>
        </div></div>
        <div class="card" style="border:1px solid #f3c4c0"><div class="card-header" style="background:#fdeceb;color:var(--rojo)">Eliminar</div><div class="card-body">
          <p class="mc-texto" style="margin-top:0">Si quedó cargado dos veces o no corresponde. Va a la papelera: administración lo puede recuperar durante 7 días.</p>
          <div class="field"><label for="mc-motivo">Motivo</label><input id="mc-motivo" type="text" placeholder="Ej.: cargado dos veces"></div>
          <button class="btn-mini btn-off mc-btn" onclick="MisCargas.eliminar()">Eliminar</button>
        </div></div>
      </div>`;
  }
  function verEdicion() {
    const e = $('mc-edicion');
    if (e) { e.style.display = e.style.display === 'none' ? '' : 'none'; if (e.style.display === '') e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  async function guardar() {
    if (!abierto) return;
    const { tipo, x } = abierto;
    if (!editable(x)) return toast('Pasaron más de 24 h: ya no se puede corregir desde acá', 'warning');
    const campos = tipo === 'taller' ? camposTaller(x) : camposComb(x);
    const cambios = {};
    campos.forEach(([k, , t]) => {
      const el = $('mc-c-' + k);
      if (!el) return;
      let v = el.value.trim();
      v = v === '' ? null : t === 'num' ? Number(v) : v;
      let antes = x[k] ?? null;
      if (t === 'hora' && antes) antes = String(antes).slice(0, 5);
      if (t === 'fecha' && antes) antes = String(antes).slice(0, 10);
      if (String(v ?? '') !== String(antes ?? '')) cambios[k] = v;
    });
    const its = tipo === 'taller' ? (x.ot_registro_items || []) : [];
    const items = its.map((i, n) => ({ sistema: i.sistema, componente: i.componente,
        horas: ($('mc-ih-' + n).value || '').trim(), estado_reparacion: ($('mc-ie-' + n).value || '').trim() }))
      .filter((i, n) => String(i.horas) !== String(its[n].horas ?? '') || i.estado_reparacion !== (its[n].estado_reparacion || ''));
    if (!Object.keys(cambios).length && !items.length) return toast('No hay cambios para guardar');
    if (!navigator.onLine) return toast('Sin señal: la corrección necesita conexión', 'warning');
    mostrarCarga('Guardando…');
    const { error } = await sb.rpc('corregir_registro', {
      p_tabla: tipo === 'taller' ? 'ot_registros' : 'combustible_movimientos',
      p_id: x.id, p_cambios: cambios, p_items: items.length ? items : null });
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Corregido', 'success');
    cerrar();
    await cargar(tipo, true);
  }

  async function eliminar() {
    if (!abierto) return;
    const { tipo, x } = abierto;
    if (!editable(x)) return toast('Pasaron más de 24 h: ya no se puede eliminar desde acá', 'warning');
    const motivo = ($('mc-motivo').value || '').trim();
    if (!motivo) return toast('Escribí el motivo', 'warning');
    const aviso = tipo === 'taller' && x.finaliza_ot ? '\n\nEs el que cerró la OT: la OT vuelve a quedar abierta.' : '';
    if (!confirm(`¿Eliminar esta carga?${aviso}\n\nAdministración la puede recuperar durante 7 días.`)) return;
    if (!navigator.onLine) return toast('Sin señal: eliminar necesita conexión', 'warning');
    mostrarCarga('Eliminando…');
    const { error } = await sb.rpc('eliminar_registro', {
      p_tabla: tipo === 'taller' ? 'ot_registros' : 'combustible_movimientos', p_id: x.id, p_motivo: motivo });
    ocultarCarga();
    if (error) return toast('No se pudo eliminar: ' + error.message, 'error');
    toast('Eliminado. Administración lo puede recuperar durante 7 días.', 'success');
    cerrar();
    await cargar(tipo, true);
  }

  // ════════════════════════════════════════════════════════════════
  function estilos() {
    if ($('mc-estilos')) return;
    const s = document.createElement('style');
    s.id = 'mc-estilos';
    s.textContent = `
      #screen-histtaller, #screen-histcomb { max-width: 100%; }
      @media (min-width: 900px) { #screen-histtaller, #screen-histcomb { padding: 14px 24px; } }
      #mc-modal .modal-card { max-width: 760px; margin: 0 auto; }
      .mc-datos { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px 14px; }
      .mc-dato .e { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: var(--gris-texto); }
      .mc-dato .v { font-size: 14px; margin-top: 2px; word-break: break-word; }
      .mc-texto { font-size: 13.5px; margin: 10px 0 0; }
      .mc-chip { display: inline-block; background: #e0e7ff; color: var(--azul-medio); border-radius: 14px; padding: 3px 9px;
        font-size: 12px; font-weight: 600; margin: 0 4px 4px 0; }
      .mc-tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 10px; }
      .mc-tabla th, .mc-tabla td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eef1f5; }
      .mc-tabla th { font-size: 10.5px; text-transform: uppercase; color: var(--gris-texto); }
      .mc-tabla input { width: 100%; padding: 6px; border: 1.5px solid var(--gris-borde); border-radius: 6px; }
      .mc-fotos { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      .mc-fotos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1.5px solid var(--gris-borde); background: #eef2f9; }
      .mc-acciones { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
      .mc-acciones .hist-info { margin: 0; }
      .mc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0 12px; }
      .mc-grid .mc-ancho { grid-column: 1 / -1; }
      .mc-btn { margin-top: 8px; }
      .btn-submit.mc-btn { padding: 11px 18px; border: 0; border-radius: 8px; font-weight: 700; cursor: pointer; }
    `;
    document.head.appendChild(s);
  }

  return { mostrar, cargar, fechas, persona, atajo, filtrar, exportar, abrir, cerrar, verEdicion, guardar, eliminar };
})();
