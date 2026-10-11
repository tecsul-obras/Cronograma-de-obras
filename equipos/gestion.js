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
  const ESTADOS_SALIDA = ['Reparado', 'Reparado- Fallas menores', 'Esperando pruebas en Campo'];
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

  // ── Fotos: las de la app están en Storage (se firman), las de JotForm
  //    son direcciones web ─────────────────────────────────────────
  function galeria(rutas, bucket) {
    const l = (rutas || []).filter(Boolean);
    if (!l.length) return '';
    return `<div class="g-fotos">${l.map(r => /^https?:/i.test(r)
      ? `<a href="${esc(r)}" target="_blank" rel="noopener"><img src="${esc(r)}" loading="lazy" alt=""></a>`
      : `<a data-bucket="${bucket}" data-ruta="${esc(r)}" target="_blank" rel="noopener"><img alt="" data-bucket="${bucket}" data-ruta="${esc(r)}"></a>`).join('')}</div>`;
  }
  async function firmarFotos(cont) {
    const porBucket = {};
    cont.querySelectorAll('img[data-ruta]').forEach(img => {
      (porBucket[img.dataset.bucket] = porBucket[img.dataset.bucket] || new Set()).add(img.dataset.ruta);
    });
    for (const [bucket, rutas] of Object.entries(porBucket)) {
      const { data } = await sb.storage.from(bucket).createSignedUrls([...rutas], 3600);
      (data || []).forEach(d => {
        if (!d.signedUrl) return;
        cont.querySelectorAll(`[data-bucket="${bucket}"][data-ruta="${CSS.escape(d.path)}"]`).forEach(el => {
          if (el.tagName === 'IMG') el.src = d.signedUrl; else el.href = d.signedUrl;
        });
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ÓRDENES DE TRABAJO
  // ════════════════════════════════════════════════════════════════
  let ots = null;
  let otCargando = false;
  let otVista = 'lista';                 // lista | horas
  let otTarjeta = null;
  let otOrden = { col: 'numero', asc: false };
  let otFormato = null;                  // tarjetas | tabla
  let otAbierta = null;                  // OT en el detalle
  let horasMes = hoy().slice(0, 7);
  let horasDatos = null;

  const OT_TARJETAS = [
    { k: 'sol', t: 'Pendientes de tomar', c: 'medio', fn: o => o.estado === 'Solicitada' },
    { k: 'abi', t: 'Abiertas', fn: o => o.estado === 'Abierta' },
    { k: 'atr', t: 'Atrasadas', c: 'malo', fn: o => o.atrasada && ['Solicitada', 'Abierta'].includes(o.estado) },
    { k: 'vie', t: 'Abiertas hace +30 días', c: 'malo', fn: o => ['Solicitada', 'Abierta'].includes(o.estado) && o.dias > 30 },
    { k: 'cer', t: 'Cerradas este mes', c: 'bien', fn: o => o.estado === 'Cerrada' && String(o.fecha_cierre || '').slice(0, 7) === hoy().slice(0, 7) },
  ];
  const OT_COLS = [
    ['numero', 'OT'], ['estado', 'Estado'], ['equipo_id', 'Equipo'], ['tipo_equipo', 'Tipo'], ['nombre', 'Nombre'],
    ['ubicacion', 'Ubicación'], ['abierta_el', 'Abierta'], ['dias', 'Días'], ['fecha_estimada_cierre', 'Cierre estimado'],
    ['registros', 'Registros'], ['horas_trabajo', 'Horas'], ['ultimo_registro', 'Último registro'],
    ['ultimo_estado_maquina', 'Estado máquina'], ['lider', 'Líder'], ['tipo_ot', 'Taller/Pista'], ['origen', 'Origen']
  ];

  async function cargarOTs() {
    if (otCargando) return;
    otCargando = true;
    try {
      const { data, error } = await sb.from('v_ot').select('*').order('numero', { ascending: false }).limit(5000);
      if (error) throw error;
      ots = data || [];
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
        <button class="${otVista === 'horas' ? 'on' : ''}" onclick="Gestion.otCambiarVista('horas')">Horas por técnico</button>
      </div>
      <div id="ot-cuerpo"></div>`;
    if (otVista === 'horas') return pintarHoras();
    $('ot-cuerpo').innerHTML = `
      <div class="tarjetas" id="ot-tarjetas"></div>
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label>
          <input type="text" id="ot-buscar" placeholder="N° de OT, equipo, nombre, falla, técnico…" oninput="Gestion.otFiltrar()"></div>
        <div class="filtro siempre"><label>Estado</label>
          <select id="ot-estado" onchange="Gestion.otFiltrar()">
            <option value="activas">Pendientes y abiertas</option>
            ${ESTADOS_OT.map(e => `<option>${e}</option>`).join('')}
            <option value="">Todas</option></select></div>
        <div class="filtro"><label>Taller / Pista</label>
          <select id="ot-tipo" onchange="Gestion.otFiltrar()"><option value="">Todas</option><option>Taller</option><option>Pista</option></select></div>
        <div class="filtro"><label>Ubicación</label><select id="ot-ubic" onchange="Gestion.otFiltrar()"><option value="">Todas</option></select></div>
        <div class="filtro"><label>Origen</label>
          <select id="ot-origen" onchange="Gestion.otFiltrar()"><option value="">Todos</option>
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
    ['ot-buscar', 'ot-estado', 'ot-tipo', 'ot-origen'].forEach(id => { if (f[id] !== undefined) $(id).value = f[id]; });
    otUbicGuardada = f['ot-ubic'] || '';
    if (ots) pintarOTLista();
  }
  let otUbicGuardada = '';

  function otFiltradas(sinTarjeta) {
    const v = id => ($(id) || {}).value || '';
    const q = v('ot-buscar').toLowerCase().trim(), est = v('ot-estado');
    return (ots || []).filter(o => {
      if (est === 'activas' && !['Solicitada', 'Abierta'].includes(o.estado)) return false;
      if (est && est !== 'activas' && o.estado !== est) return false;
      if (v('ot-tipo') && o.tipo_ot !== v('ot-tipo')) return false;
      if (v('ot-ubic') && o.ubicacion !== v('ot-ubic')) return false;
      if (v('ot-origen') && o.origen !== v('ot-origen')) return false;
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
    ['ot-buscar', 'ot-estado', 'ot-tipo', 'ot-ubic', 'ot-origen'].forEach(id => f[id] = $(id).value);
    guardarLocal('ot_filtros', f);
    pintarOTLista();
  }

  function pintarOTLista() {
    if (!$('ot-lista') || !ots) return;
    // ubicaciones que existen
    const sel = $('ot-ubic'), actual = sel.value || otUbicGuardada;
    otUbicGuardada = '';
    sel.innerHTML = '<option value="">Todas</option>' + [...new Set(ots.map(o => o.ubicacion).filter(Boolean))].sort()
      .map(u => `<option ${u === actual ? 'selected' : ''}>${esc(u)}</option>`).join('');
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
        <div class="meta">${[o.tipo_equipo, o.ubicacion, o.tipo_ot].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="chips">
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
    if (otTarjeta && otTarjeta.k === 'cer' && $('ot-estado').value === 'activas') $('ot-estado').value = '';
    if (otTarjeta && otTarjeta.k !== 'cer' && $('ot-estado').value === 'Cerrada') $('ot-estado').value = 'activas';
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
    const v = (ots || []).find(x => x.numero === numero) || {};
    const t = esTaller(), activa = ['Solicitada', 'Abierta'].includes(o.estado);
    const dato = (e, val) => `<div class="dato"><div class="e">${e}</div><div class="v">${val ?? ''}</div></div>`;
    $('modal-titulo').innerHTML = `OT ${o.numero} · ${esc(o.equipo_id || o.trabajo_general || '')} ${chipOT(o.estado)}`;
    const acciones = !t ? '' : `<div class="acciones" style="justify-content:flex-start;margin-bottom:12px">
      ${o.estado === 'Solicitada' ? `<button class="btn btn-primario" onclick="Gestion.otTomar()">Tomar OT</button>` : ''}
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
          ${dato('Taller / Pista', esc(o.tipo_ot))}
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
      <h3 style="font-size:14px;margin:4px 0 8px">Registros (${(regs || []).length})</h3>
      ${(regs || []).length ? regs.map(pintarRegistro).join('') : '<div class="empty-state">Todavía no se cargó ningún trabajo en esta OT.</div>'}`;
    firmarFotos($('modal-cuerpo'));
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
  function otTomar() { otActualizar({ estado: 'Abierta' }, `OT ${otAbierta.numero} abierta`); }
  function otReabrir() {
    if (!confirm(`¿Reabrir la OT ${otAbierta.numero}?`)) return;
    otActualizar({ estado: 'Abierta', fecha_cierre: null }, `OT ${otAbierta.numero} reabierta`);
  }
  function otFormEditar() {
    const o = otAbierta, ops = (cat.ops || []).filter(x => x.activo !== false);
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Editar OT</div><div class="card-body"><div class="form-grid">
      ${campo('ot-e-nombre', 'Nombre', inp('ot-e-nombre', o.nombre), 'ancho')}
      ${campo('ot-e-tipo', 'Taller / Pista', sel('ot-e-tipo', ['Taller', 'Pista'], o.tipo_ot))}
      ${campo('ot-e-lider', 'Líder', `<select id="ot-e-lider"><option value="">—</option>${ops.map(x =>
        `<option value="${esc(x.cedula)}" ${x.cedula === o.lider_cedula ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>`)}
      ${campo('ot-e-fest', 'Cierre estimado', inp('ot-e-fest', o.fecha_estimada_cierre, 'date'))}
      ${campo('ot-e-sint', 'Síntomas', txt('ot-e-sint', o.sintomas), 'ancho')}
    </div><div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-verde" onclick="Gestion.otGuardarEdicion()">Guardar</button></div></div></div>`;
  }
  function otGuardarEdicion() {
    if (!val('ot-e-nombre')) return toast('El nombre no puede quedar vacío', 'warning');
    otActualizar({ nombre: val('ot-e-nombre'), tipo_ot: val('ot-e-tipo'), lider_cedula: val('ot-e-lider'),
      fecha_estimada_cierre: val('ot-e-fest'), sintomas: val('ot-e-sint') }, 'OT actualizada');
  }
  function otFormCerrar() {
    $('ot-accion').innerHTML = `<div class="card"><div class="card-header">Cerrar la OT</div><div class="card-body">
      <div class="aviso-caja">Lo normal es que el mecánico la cierre desde su formulario ("Cierre de OT"), con el checklist de salida.
        Cerrala desde acá solo si eso no va a pasar.</div><div class="form-grid">
      ${campo('ot-c-est', 'Estado de la máquina a la salida', sel('ot-c-est', ESTADOS_SALIDA, null))}
      ${campo('ot-c-lec', 'Lectura de salida', inp('ot-c-lec', '', 'number', 'step="any"'))}
      ${campo('ot-c-det', 'Detalle del cierre', txt('ot-c-det', ''), 'ancho')}
    </div><div class="acciones"><button class="btn btn-gris" onclick="$('ot-accion').innerHTML=''">Cancelar</button>
      <button class="btn btn-verde" onclick="Gestion.otCerrar()">Cerrar OT</button></div></div></div>`;
  }
  function otCerrar() {
    if (!val('ot-c-est')) return toast('Elegí el estado de la máquina', 'warning');
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

  // ── Horas por técnico ──
  async function pintarHoras() {
    $('ot-cuerpo').innerHTML = `<div class="filtros">
        <div class="filtro siempre"><label>Mes</label><input type="month" id="h-mes" value="${horasMes}" onchange="Gestion.horasCambiarMes(this.value)"></div>
        <div class="filtro siempre"><label>&nbsp;</label><button class="btn-filtro" onclick="Gestion.horasExportar()">Exportar</button></div>
      </div><div id="h-lista"><div class="empty-state">Cargando…</div></div>`;
    const { data, error } = await sb.from('v_ot_horas').select('*').eq('mes', horasMes + '-01').limit(10000);
    if (error) return $('h-lista').innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}</div>`;
    horasDatos = data || [];
    const por = {};
    horasDatos.forEach(h => {
      const k = h.tecnico || 'Sin técnico';
      const p = por[k] = por[k] || { tecnico: k, horas: 0, ots: new Set(), dias: new Set(), sistemas: {} };
      p.horas += num(h.horas); p.ots.add(h.ot); p.dias.add(h.fecha);
      p.sistemas[h.sistema] = (p.sistemas[h.sistema] || 0) + num(h.horas);
    });
    const filas = Object.values(por).sort((a, b) => b.horas - a.horas);
    const total = filas.reduce((a, f) => a + f.horas, 0);
    $('h-lista').innerHTML = !filas.length ? '<div class="empty-state">No hay horas cargadas en ese mes.</div>' : `
      <div class="tarjetas"><div class="tarjeta"><span class="n">${fmtNum(total, 1)}</span><span class="t">Horas en el mes</span></div>
        <div class="tarjeta"><span class="n">${filas.length}</span><span class="t">Técnicos</span></div>
        <div class="tarjeta"><span class="n">${new Set(horasDatos.map(h => h.ot)).size}</span><span class="t">OT trabajadas</span></div></div>
      <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Técnico</th><th>Horas</th><th>Días</th><th>OT</th><th>Por sistema</th></tr></thead>
      <tbody>${filas.map(f => `<tr style="cursor:default"><td><b>${esc(f.tecnico)}</b></td><td>${fmtNum(f.horas, 1)}</td><td>${f.dias.size}</td><td>${f.ots.size}</td>
        <td class="larga">${Object.entries(f.sistemas).sort((a, b) => b[1] - a[1]).map(([s, h]) => `${esc(s)} ${fmtNum(h, 1)}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>
      <p class="cambio" style="margin-top:8px">Son las horas que cada técnico cargó por componente en los registros de trabajo.</p>`;
  }
  function horasCambiarMes(m) { horasMes = m || hoy().slice(0, 7); pintarHoras(); }
  function horasExportar() {
    if (!horasDatos) return;
    bajarCSV('horas_taller_' + horasMes, ['Fecha', 'OT', 'Equipo', 'Técnico', 'Sistema', 'Componente', 'Horas', 'Estado'],
      horasDatos.map(h => [h.fecha, h.ot, h.equipo_id, h.tecnico, h.sistema, h.componente, h.horas, h.estado_reparacion]));
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROL DE COMBUSTIBLE
  // ════════════════════════════════════════════════════════════════
  const G = { vista: 'movimientos', desde: primeroDelMes(), hasta: hoy(), movs: null, stock: null,
              conc: null, cons: null, anom: null, orden: { col: 'fecha', asc: false }, concFiltro: 'dif' };
  const VISTAS_G = [['movimientos', 'Movimientos'], ['stock', 'Stock de tanques'], ['conciliacion', 'Conciliación con partes'],
                    ['consumo', 'Consumo por equipo'], ['anomalias', 'Anomalías']];
  const ACT_CORTA = { 'Despacho de combustible': 'Despacho', 'Ingreso de combustible': 'Ingreso',
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
      if (forzar || !G.movs) pedidos.push(sb.from('combustible_movimientos').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
        .order('fecha', { ascending: false }).order('hora', { ascending: false, nullsFirst: false }).limit(10000).then(r => { if (r.error) throw r.error; G.movs = r.data; }));
      if (forzar || !G.stock) pedidos.push(sb.from('v_stock_tanques').select('*').order('porcentaje', { nullsFirst: false }).then(r => { if (r.error) throw r.error; G.stock = r.data; }));
      if (forzar || !G.anom) pedidos.push(sb.from('v_combustible_anomalias').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
        .order('fecha', { ascending: false }).limit(3000).then(r => { if (r.error) throw r.error; G.anom = r.data; }));
      if (v === 'conciliacion' && (forzar || !G.conc)) pedidos.push(sb.from('v_combustible_conciliacion').select('*').gte('fecha', G.desde).lte('fecha', G.hasta)
        .order('fecha', { ascending: false }).limit(10000).then(r => { if (r.error) throw r.error; G.conc = r.data; }));
      if (v === 'consumo' && (forzar || !G.cons)) pedidos.push(sb.from('v_combustible_consumo').select('*').gte('mes', G.desde.slice(0, 8) + '01').lte('mes', G.hasta)
        .order('mes', { ascending: false }).limit(5000).then(r => { if (r.error) throw r.error; G.cons = r.data; }));
      await Promise.all(pedidos);
    } catch (e) {
      if ($('g-cuerpo')) $('g-cuerpo').innerHTML = `<div class="aviso-caja rojo">No se pudo cargar: ${esc(e.message)}</div>`;
      return;
    }
    pintarGTarjetas();
    ({ movimientos: pintarMovs, stock: pintarStock, conciliacion: pintarConc, consumo: pintarCons, anomalias: pintarAnom })[v]();
  }

  function gPeriodo() {
    G.desde = $('g-desde').value || primeroDelMes();
    G.hasta = $('g-hasta').value || hoy();
    guardarLocal('gasoil_periodo', { desde: G.desde, hasta: G.hasta });
    G.movs = G.anom = G.conc = G.cons = null;
    $('g-cuerpo').innerHTML = '<div class="empty-state">Cargando…</div>';
    cargarGasoil();
  }
  function gAtajo(a) {
    $('g-hasta').value = hoy();
    if (a === 'mes') $('g-desde').value = primeroDelMes();
    else { const d = new Date(); d.setDate(d.getDate() - 30); $('g-desde').value = d.toISOString().slice(0, 10); }
    gPeriodo();
  }
  function gRecargar() { G.movs = G.stock = G.anom = G.conc = G.cons = null; cargarGasoil(true); }
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
      if (v('m-act') && x.actividad !== v('m-act')) return false;
      if (v('m-tanque') && x.tanque !== v('m-tanque')) return false;
      if (q) {
        const pajar = [x.tanque, x.recibe, x.operador, x.despachador, x.nro_boleta, x.obra, x.observaciones].join(' ').toLowerCase();
        if (!q.split(/\s+/).every(p => pajar.includes(p))) return false;
      }
      return true;
    });
  }
  function pintarMovs() {
    const previo = { q: ($('m-buscar') || {}).value || '', a: ($('m-act') || {}).value || '', t: ($('m-tanque') || {}).value || '' };
    const tanques = [...new Set((G.movs || []).map(x => x.tanque_salida_id || x.tanque_fijo_id).filter(Boolean))].sort();
    $('g-cuerpo').innerHTML = `
      <div class="filtros">
        <div class="filtro crece"><label>Buscar</label><input type="text" id="m-buscar" value="${esc(previo.q)}" placeholder="Equipo, chapa, operador, boleta…" oninput="Gestion.movRepintar()"></div>
        <div class="filtro siempre"><label>Actividad</label><select id="m-act" onchange="Gestion.movRepintar()"><option value="">Todas</option>
          ${Object.entries(ACT_CORTA).map(([k, t]) => `<option value="${k}" ${previo.a === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro"><label>Tanque</label><select id="m-tanque" onchange="Gestion.movRepintar()"><option value="">Todos</option>
          ${tanques.map(t => `<option ${previo.t === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
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
      ${t && x.actividad === 'Despacho de combustible' ? `<div class="card" style="margin-top:12px"><div class="card-header">Corregir</div><div class="card-body"><div class="form-grid">
        ${campo('mv-eq', 'Equipo que recibe', `<select id="mv-eq"><option value="">${esc(x.receptor_texto || '—')}</option>${flota.filter(e => e.activo || e.id === x.equipo_id).map(e =>
          `<option ${e.id === x.equipo_id ? 'selected' : ''}>${esc(e.id)}</option>`).join('')}</select>`)}
        ${campo('mv-lit', 'Litros', inp('mv-lit', x.litros, 'number', 'step="any"'))}
        ${campo('mv-hor', x.odometro !== null ? 'Odómetro' : 'Horómetro', inp('mv-hor', f.lectura, 'number', 'step="any"'))}
        ${campo('mv-bol', 'Boleta', inp('mv-bol', x.nro_boleta))}
        ${campo('mv-obs', 'Observaciones', txt('mv-obs', x.observaciones), 'ancho')}
      </div><div class="acciones"><button class="btn btn-verde" onclick="Gestion.guardarMov('${x.id}')">Guardar</button></div></div></div>` : ''}`);
    firmarFotos($('modal-cuerpo'));
  }
  async function guardarMov(id) {
    const x = (G.movs || []).find(m => m.id === id) || {};
    const lectura = x.odometro !== null && x.odometro !== undefined ? { odometro: val('mv-hor') } : { horometro: val('mv-hor') };
    mostrarCarga('Guardando…');
    const { error } = await sb.from('combustible_movimientos').update(Object.assign({
      equipo_id: val('mv-eq'), litros: val('mv-lit'), nro_boleta: val('mv-bol'), observaciones: val('mv-obs') }, lectura)).eq('id', id);
    ocultarCarga();
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Guardado', 'success');
    cerrarModal();
    gRecargar();
  }

  // ── Stock de tanques ──
  function pintarStock() {
    const l = G.stock || [];
    $('g-cuerpo').innerHTML = !l.length ? '<div class="empty-state">No hay tanques activos.</div>' : `
      <div class="aviso-caja">Stock estimado = última medición del tanque + ingresos y traspasos recibidos − despachos desde esa medición.
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

  // ── Consumo ──
  function pintarCons() {
    const l = [...(G.cons || [])].sort((a, b) => (b.mes || '').localeCompare(a.mes || '') || Math.abs(num(b.desvio_pct)) - Math.abs(num(a.desvio_pct)));
    $('g-cuerpo').innerHTML = !l.length ? '<div class="empty-state">No hay despachos a equipos en esos meses.</div>' : `
      <div class="aviso-caja">Litros despachados a cada equipo en el mes contra las horas de horómetro (o km) de sus partes diarios.
        El desvío se compara con el consumo de referencia de la ficha técnica.</div>
      <div class="barra-acciones"><div class="info">${l.length} filas</div><button class="btn-filtro" onclick="Gestion.consExportar()">Exportar</button></div>
      <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Mes</th><th>Equipo</th><th>Tipo</th><th>Litros</th><th>Horas</th><th>L/h</th>
        <th>Referencia L/h</th><th>Desvío</th><th>Km</th><th>L/100 km</th></tr></thead><tbody>${l.map(x => {
          const d = x.desvio_pct, c = d === null ? '' : Math.abs(d) > 30 ? 'rojo' : Math.abs(d) > 15 ? 'amarillo' : 'verde';
          return `<tr onclick="${flota.some(f => f.id === x.equipo_id) ? `abrirFicha('${esc(x.equipo_id)}','ficha')` : ''}">
            <td>${esc(String(x.mes).slice(0, 7))}</td><td><b>${esc(x.equipo_id)}</b></td><td>${esc(x.tipo || x.descripcion || '')}</td>
            <td>${fmtNum(x.litros)}</td><td>${fmtNum(x.horas, 1)}</td><td>${fmtNum(x.litros_hora, 2)}</td><td>${fmtNum(x.referencia_lh, 2)}</td>
            <td>${d === null ? '' : `<span class="chip ${c}">${d > 0 ? '+' : ''}${d} %</span>`}</td><td>${fmtNum(x.km)}</td><td>${fmtNum(x.litros_100km, 1)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  }
  function consExportar() {
    bajarCSV('consumo_combustible', ['Mes', 'Equipo', 'Tipo', 'Litros', 'Horas', 'L/h', 'Referencia L/h', 'Desvío %', 'Km', 'L/100km'],
      (G.cons || []).map(x => [x.mes, x.equipo_id, x.tipo, x.litros, x.horas, x.litros_hora, x.referencia_lh, x.desvio_pct, x.km, x.litros_100km]));
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
        font-size: 13px; font-weight: 600; color: var(--gris-texto); }
      .g-sub button.on { background: var(--azul-medio); color: #fff; border-color: var(--azul-medio); }
      .g-sub.chico button { padding: 6px 11px; font-size: 12px; }
      .eq.g-ot.Solicitada { border-left-color: var(--amarillo-alerta); }
      .eq.g-ot.Abierta { border-left-color: var(--azul-medio); }
      .eq.g-ot.Cerrada { border-left-color: var(--verde); }
      .modal-card.ancho { max-width: 860px; }
      .g-texto { font-size: 13px; margin: 8px 0 0; }
      .g-texto summary { cursor: pointer; }
      .g-reg .card-body { padding: 11px 13px; }
      .g-mini { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
      .g-mini th { text-align: left; background: #eef2f9; padding: 5px 7px; font-size: 11px; }
      .g-mini td { padding: 5px 7px; border-bottom: 1px solid #eef1f5; }
      .g-fotos { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .g-fotos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid var(--gris-borde); background: #eef2f9; }
      .g-barra { height: 9px; border-radius: 5px; background: #e9edf3; overflow: hidden; margin: 8px 0 4px; }
      .g-barra i { display: block; height: 100%; }
      .g-barra i.verde { background: var(--verde); } .g-barra i.amarillo { background: var(--amarillo-alerta); }
      .g-barra i.rojo { background: var(--rojo); } .g-barra i.gris { background: #aab3c2; }
    `;
    document.head.appendChild(s);
  }

  inyectarEstilos();   // los usan también las pantallas de gestion2.js

  return {
    mostrar, cargarOTs, otFiltrar, otTocarTarjeta, otOrdenar, otFormato: otCambiarFormato, otCambiarVista,
    otExportar, otCompartir, abrirOT, otTomar, otReabrir, otFormEditar, otGuardarEdicion, otFormCerrar, otCerrar,
    otFormAnular, otAnular, otDeEquipo, horasCambiarMes, horasExportar,
    gVista, gPeriodo, gAtajo, gRecargar, movRepintar, movOrdenar, movExportar, abrirMov, guardarMov,
    concFiltrar, concExportar, consExportar
  };
})();
