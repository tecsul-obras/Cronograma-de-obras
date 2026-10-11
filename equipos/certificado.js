// ══════════════════════════════════════════════════════════════════
// CERTIFICADO DE MÁQUINAS y MAESTRO DE TARIFAS — Tecsul S.A.E.
//
// Solo admin_central. Vive en flota.html y usa sus utilidades ($, esc,
// fmtFecha, fmtNum, abrirModal, cerrarModal, toast, campo, inp, val,
// flota, mostrarCarga, ocultarCarga).
//
// Certificado: horas de horómetro de los partes × tarifa por hora del
// maestro (certificado_maquinas en la base). Maestro: tarifas por
// equipo, unidad de negocio y "fecha hasta", importables desde el
// Excel que se descarga de Unysoft.
// ══════════════════════════════════════════════════════════════════
window.Certificado = (() => {
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const hoy = () => new Date().toISOString().slice(0, 10);
  const primeroDeMes = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const num = (v) => v === null || v === undefined || v === '' ? 0 : Number(v);
  const gs = (v) => v === null || v === undefined ? '' : fmtNum(Math.round(v));
  const millones = (v) => fmtNum(num(v) / 1e6, 1) + ' M';
  const sinAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const filtroTexto = (q, campos) => !q || q.split(/\s+/).every(p => sinAcento(campos.join(' ')).includes(p));
  const unDe = (codigo) => /^[0-9A-Za-z]{5}/.test(codigo || '') ? String(codigo).slice(0, 5).toUpperCase() + '00000' : null;

  const C = {
    vista: 'cert', desde: iso(primeroDeMes()), hasta: hoy(), obra: '',
    obras: null, datos: null, orden: { col: 'costo', asc: false },
    tarifas: null, soloUltima: true, sinVincular: false, tOrden: { col: 'equipo_unysoft', asc: true }, tLimite: 300,
    importar: null,
  };

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
  const th = (k, t, o, fn, clase = '') =>
    `<th class="${o.col === k ? 'activo' : ''} ${clase}" onclick="Certificado.${fn}('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;

  // Trae todas las filas de una consulta, de a 1000 (límite de Supabase)
  async function todas(armar) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await armar().range(desde, desde + 999);
      if (error) throw error;
      filas.push(...data);
      if (data.length < 1000) return filas;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PANTALLA
  // ════════════════════════════════════════════════════════════════
  function mostrar() {
    estilos();
    $('screen-cert').innerHTML = `<div class="g-sub">
        <button class="${C.vista === 'cert' ? 'on' : ''}" onclick="Certificado.vista('cert')">Certificado</button>
        <button class="${C.vista === 'tarifas' ? 'on' : ''}" onclick="Certificado.vista('tarifas')">Maestro de tarifas</button></div>
      <div id="cert-cuerpo"><div class="empty-state">Cargando…</div></div>`;
    if (C.vista === 'cert') pintarCert(); else pintarTarifas();
  }
  function vista(v) { C.vista = v; mostrar(); }

  async function cargarObras() {
    if (C.obras) return;
    const { data, error } = await sb.from('obras').select('clave, codigo, nombre, activa').order('nombre');
    if (error) throw error;
    C.obras = data;
  }

  // ════════════════════════════════════════════════════════════════
  // CERTIFICADO
  // ════════════════════════════════════════════════════════════════
  async function pintarCert() {
    try { await cargarObras(); } catch (e) { return $('cert-cuerpo').innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}</div>`; }
    const obras = [...C.obras].sort((a, b) => (b.activa - a.activa) || a.nombre.localeCompare(b.nombre, 'es'));
    $('cert-cuerpo').innerHTML = `
      <div class="filtros">
        <div class="filtro siempre"><label>Desde</label><input type="date" id="ce-desde" value="${C.desde}" onchange="Certificado.periodo()"></div>
        <div class="filtro siempre"><label>Hasta</label><input type="date" id="ce-hasta" value="${C.hasta}" onchange="Certificado.periodo()"></div>
        <div class="filtro siempre"><label>&nbsp;</label><div style="display:flex;gap:6px">
          <button class="btn-filtro" onclick="Certificado.mes(0)">Este mes</button>
          <button class="btn-filtro" onclick="Certificado.mes(-1)">Mes pasado</button></div></div>
        <div class="filtro crece siempre"><label>Obra</label><select id="ce-obra" onchange="Certificado.elegirObra(this.value)">
          <option value="">Todas las obras</option>
          ${obras.map(o => `<option value="${esc(o.clave)}" ${o.clave === C.obra ? 'selected' : ''}>${esc(o.nombre)}${o.activa ? '' : ' (inactiva)'} · ${esc(o.codigo || '')}</option>`).join('')}
        </select></div>
      </div>
      <div id="ce-res"><div class="empty-state">Calculando…</div></div>`;
    cargarCert();
  }

  async function cargarCert() {
    const res = $('ce-res');
    if (!res) return;
    res.innerHTML = '<div class="empty-state">Calculando…</div>';
    const { data, error } = await sb.rpc('certificado_maquinas', { p_desde: C.desde, p_hasta: C.hasta, p_obra: C.obra || null });
    if (error) {
      res.innerHTML = `<div class="aviso-caja rojo">${esc(error.message)}${/certificado_maquinas|tarifas_equipos/.test(error.message)
        ? '<br>Falta correr <b>23_certificado_maquinas.sql</b> en Supabase.' : ''}</div>`;
      return;
    }
    C.datos = (data || []).map(r => Object.assign(r, {
      horas: num(r.horas), costo: r.costo === null ? null : num(r.costo), horas_sin_tarifa: num(r.horas_sin_tarifa),
      tarifa: r.tarifa_max === null ? null : num(r.tarifa_max) }));
    pintarResultado();
  }

  function periodo() {
    C.desde = $('ce-desde').value || C.desde;
    C.hasta = $('ce-hasta').value || C.hasta;
    if (C.desde > C.hasta) [C.desde, C.hasta] = [C.hasta, C.desde];
    cargarCert();
  }
  function mes(delta) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta);
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    C.desde = iso(d);
    C.hasta = delta === 0 ? hoy() : iso(fin);
    $('ce-desde').value = C.desde; $('ce-hasta').value = C.hasta;
    cargarCert();
  }
  function elegirObra(clave) {
    C.obra = clave || '';
    if ($('ce-obra')) $('ce-obra').value = C.obra;
    C.orden = { col: 'costo', asc: false };
    cargarCert();
    window.scrollTo(0, 0);
  }
  function ordenarCert(col) {
    C.orden = { col, asc: C.orden.col === col ? !C.orden.asc : col === 'equipo_id' || col === 'obra_nombre' };
    pintarResultado();
  }

  // Agrupa las filas (obra × equipo) por una clave
  function agrupar(filas, clave, extra) {
    const g = {};
    filas.forEach(r => {
      const k = r[clave];
      const a = g[k] || (g[k] = Object.assign({ horas: 0, costo: 0, horas_sin_tarifa: 0, partes: 0, n: new Set() }, extra(r)));
      a.horas += r.horas; a.costo += num(r.costo); a.horas_sin_tarifa += r.horas_sin_tarifa; a.partes += r.partes;
      a.n.add(clave === 'obra_clave' ? r.equipo_id : r.obra_clave);
    });
    return Object.values(g).map(a => Object.assign(a, { cuantos: a.n.size }));
  }

  function resumen(filas) {
    const t = { horas: 0, costo: 0, sin: 0, equipos: new Set(), sinEq: new Set(), vencidas: 0 };
    filas.forEach(r => {
      t.horas += r.horas; t.costo += num(r.costo); t.sin += r.horas_sin_tarifa; t.equipos.add(r.equipo_id);
      if (r.horas_sin_tarifa > 0) t.sinEq.add(r.equipo_id);
      if (r.tarifa_vencida) t.vencidas++;
    });
    return t;
  }

  function pintarResultado() {
    const res = $('ce-res');
    if (!res) return;
    const filas = C.datos || [];
    if (!filas.length) { res.innerHTML = '<div class="empty-state">No hay partes en ese período' + (C.obra ? ' para esta obra' : '') + '.</div>'; return; }
    const t = resumen(filas);
    const obraSel = C.obra ? filas[0] : null;
    let html = `<div class="tarjetas">
        <div class="tarjeta"><span class="n">${millones(t.costo)}</span><span class="t">Gs certificables</span></div>
        <div class="tarjeta"><span class="n">${fmtNum(t.horas)}</span><span class="t">Horas trabajadas</span></div>
        <div class="tarjeta"><span class="n">${t.equipos.size}</span><span class="t">Equipos</span></div>
        ${C.obra ? '' : `<div class="tarjeta"><span class="n">${new Set(filas.map(r => r.obra_clave)).size}</span><span class="t">Obras</span></div>`}
        <div class="tarjeta ${t.sin > 0 ? 'malo' : 'bien'}"><span class="n">${fmtNum(t.sin)}</span><span class="t">Horas sin tarifa</span></div>
      </div>`;
    if (t.sin > 0) {
      html += `<div class="aviso-caja">${t.sinEq.size} equipo${t.sinEq.size > 1 ? 's' : ''} con horas sin tarifa (${fmtNum(t.sin)} h): no suman al costo.
        Cargá la tarifa en el <a href="#" onclick="Certificado.vista('tarifas');return false">maestro de tarifas</a>
        ${C.obra ? 'o tocá la fila del equipo' : ''}.</div>`;
    }
    if (t.vencidas) {
      html += `<div class="aviso-caja">${t.vencidas} caso${t.vencidas > 1 ? 's' : ''} con la tarifa vencida ("fecha hasta" anterior al parte): se usó la última tarifa cargada. <span class="chip amarillo">vencida</span></div>`;
    }
    html += `<div class="barra-acciones"><div class="info">${fmtFecha(C.desde)} al ${fmtFecha(C.hasta)} · ${C.obra ? esc(obraSel.obra_nombre) + ' · UN ' + esc(obraSel.unidad_negocio || '—') : 'todas las obras'}
        · horas de horómetro × tarifa 1</div>
      ${C.obra ? '<button class="btn-filtro" onclick="Certificado.elegirObra(\'\')">← Todas las obras</button>' : ''}
      <button class="btn-filtro" onclick="Certificado.exportar()">Descargar Excel</button>
      <button class="btn-filtro" onclick="Certificado.imprimir()">Imprimir</button></div>`;

    if (C.obra) {
      html += tablaEquipos(filas, true);
    } else {
      const porObra = agrupar(filas, 'obra_clave', r => ({ obra_clave: r.obra_clave, obra_nombre: r.obra_nombre, unidad_negocio: r.unidad_negocio }));
      const o = C.orden.col in (porObra[0] || {}) ? C.orden : { col: 'costo', asc: false };
      html += `<h3 class="ce-tit">Por obra</h3><div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          ${th('obra_nombre', 'Obra', o, 'ordenarCert')}${th('unidad_negocio', 'Unidad de negocio', o, 'ordenarCert')}
          ${th('cuantos', 'Equipos', o, 'ordenarCert', 'nro')}${th('horas', 'Horas', o, 'ordenarCert', 'nro')}
          ${th('costo', 'Costo Gs', o, 'ordenarCert', 'nro')}<th class="nro">% del total</th>${th('horas_sin_tarifa', 'Sin tarifa (h)', o, 'ordenarCert', 'nro')}</tr></thead><tbody>
        ${ordenar(porObra, o).map(r => `<tr onclick="Certificado.elegirObra(${esc(JSON.stringify(r.obra_clave))})">
          <td><b>${esc(r.obra_nombre)}</b></td><td>${esc(r.unidad_negocio || '—')}</td><td class="nro">${r.cuantos}</td>
          <td class="nro">${fmtNum(r.horas, 1)}</td><td class="nro"><b>${gs(r.costo)}</b></td>
          <td class="nro">${t.costo ? fmtNum(r.costo / t.costo * 100, 1) + ' %' : ''}</td>
          <td class="nro">${r.horas_sin_tarifa > 0 ? `<span class="chip rojo">${fmtNum(r.horas_sin_tarifa, 1)}</span>` : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="3">Total</td><td class="nro">${fmtNum(t.horas, 1)}</td><td class="nro">${gs(t.costo)}</td><td></td><td class="nro">${t.sin ? fmtNum(t.sin, 1) : ''}</td></tr></tfoot></table></div>
        <h3 class="ce-tit">Por equipo, en todas las obras</h3>` + tablaEquipos(filas, false);
    }
    res.innerHTML = html;
  }

  // Tabla por equipo. En una obra: una fila por equipo (con su tarifa).
  // En todas: suma cada equipo en todas las obras.
  function tablaEquipos(filas, unaObra) {
    const lista = unaObra ? filas.map(r => Object.assign({}, r, { cuantos: 1 }))
      : agrupar(filas, 'equipo_id', r => ({ equipo_id: r.equipo_id, descripcion: r.descripcion, propiedad: r.propiedad, tarifa: null }));
    const o = C.orden.col in (lista[0] || {}) ? C.orden : { col: 'costo', asc: false };
    const t = resumen(filas);
    C.visibles = ordenar(lista, o);
    return `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
        ${th('equipo_id', 'Equipo', o, 'ordenarCert')}${th('descripcion', 'Tipo', o, 'ordenarCert')}
        ${th('propiedad', 'Propiedad', o, 'ordenarCert')}
        ${unaObra ? th('dias', 'Días', o, 'ordenarCert', 'nro') : th('cuantos', 'Obras', o, 'ordenarCert', 'nro')}
        ${th('horas', 'Horas', o, 'ordenarCert', 'nro')}
        ${unaObra ? th('tarifa', 'Tarifa Gs/h', o, 'ordenarCert', 'nro') : ''}
        ${th('costo', 'Costo Gs', o, 'ordenarCert', 'nro')}<th></th></tr></thead><tbody>
      ${C.visibles.map((r, i) => `<tr onclick="Certificado.clicEquipo(${i}, ${unaObra})">
        <td><b>${esc(r.equipo_id)}</b></td><td>${esc(r.descripcion || '')}</td><td>${esc(r.propiedad || '')}</td>
        <td class="nro">${unaObra ? r.dias : r.cuantos}</td><td class="nro">${fmtNum(r.horas, 1)}</td>
        ${unaObra ? `<td class="nro">${r.tarifa_min === null ? '' : num(r.tarifa_min) === num(r.tarifa_max) ? gs(r.tarifa_min) : gs(r.tarifa_min) + ' – ' + gs(r.tarifa_max)}</td>` : ''}
        <td class="nro"><b>${gs(r.costo)}</b></td>
        <td>${r.horas_sin_tarifa > 0 ? `<span class="chip rojo">${r.horas_sin_tarifa === r.horas ? 'Sin tarifa' : fmtNum(r.horas_sin_tarifa, 1) + ' h sin tarifa'}</span>` : ''}
          ${r.tarifa_vencida ? '<span class="chip amarillo">vencida</span>' : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">Total</td><td class="nro">${fmtNum(t.horas, 1)}</td>${unaObra ? '<td></td>' : ''}
        <td class="nro">${gs(t.costo)}</td><td></td></tr></tfoot></table></div>`;
  }

  function clicEquipo(i, unaObra) {
    const r = C.visibles[i];
    if (!r) return;
    if (unaObra) {
      const un = r.unidad_negocio;
      if (r.horas_sin_tarifa > 0) return editarTarifa(null, { equipo_unysoft: r.equipo_id, equipo_id: r.equipo_id, unidad_negocio: un,
        unidad_negocio_nombre: r.obra_nombre, descripcion: r.descripcion });
      verTarifasDe(r.equipo_id, un);
    } else {
      // Detalle del equipo por obra
      const l = (C.datos || []).filter(x => x.equipo_id === r.equipo_id).sort((a, b) => num(b.costo) - num(a.costo));
      abrirModal(`${r.equipo_id} · ${r.descripcion || ''}`, `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          <th>Obra</th><th class="nro">Días</th><th class="nro">Horas</th><th class="nro">Tarifa</th><th class="nro">Costo Gs</th></tr></thead><tbody>
        ${l.map(x => `<tr style="cursor:default"><td>${esc(x.obra_nombre)}</td><td class="nro">${x.dias}</td><td class="nro">${fmtNum(x.horas, 1)}</td>
          <td class="nro">${x.tarifa_max === null ? '<span class="chip rojo">Sin tarifa</span>' : gs(x.tarifa_max)}</td><td class="nro">${gs(x.costo)}</td></tr>`).join('')}
        </tbody></table></div>`);
    }
  }

  async function verTarifasDe(equipo, un) {
    C.vista = 'tarifas';
    C.soloUltima = false;
    C.sinVincular = false;
    C.buscar = equipo;
    C.un = un || '';
    mostrar();
  }

  // ── Excel (.xlsx) ──────────────────────────────────────────────
  // Cada hoja: título, subtítulo, encabezados en la fila 4, datos con
  // formato de número y una fila de total con fórmulas SUMA.
  const FMT = { h: '#,##0.0', gs: '#,##0', n: '0', f: 'dd/mm/yyyy' };
  function hoja(titulo, sub, cols, filas, total) {
    const aoa = [[titulo], [sub], [], cols.map(c => c.t), ...filas];
    const ws = XLSX.utils.aoa_to_sheet(aoa, { dateNF: FMT.f });
    const ini = 5, fin = 4 + filas.length;          // filas de datos (base 1)
    cols.forEach((c, j) => {
      const L = XLSX.utils.encode_col(j);
      if (c.fmt) for (let i = ini; i <= fin; i++) { const cel = ws[L + i]; if (cel && cel.t === 'n') cel.z = FMT[c.fmt]; }
      if (total && filas.length) {
        const ref = L + (fin + 1);
        if (j === 0) ws[ref] = { t: 's', v: 'Total' };
        else if (c.sum) ws[ref] = { t: 'n', f: `SUM(${L}${ini}:${L}${fin})`, z: FMT[c.fmt] || FMT.gs };
      }
    });
    if (total && filas.length) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: fin, c: cols.length - 1 } });
    ws['!cols'] = cols.map(c => ({ wch: c.w || 12 }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(cols.length - 1, 6) } }];
    if (filas.length) ws['!autofilter'] = { ref: `A4:${XLSX.utils.encode_col(cols.length - 1)}${fin}` };
    return ws;
  }
  async function guardarLibro(hojas, nombre) {
    try { await cargarSheetJS(); } catch (e) { return toast(e.message, 'error'); }
    const libro = XLSX.utils.book_new();
    hojas.forEach(([n, ws]) => XLSX.utils.book_append_sheet(libro, ws, n.slice(0, 31)));
    XLSX.writeFile(libro, nombre + '.xlsx');
  }

  async function exportar() {
    const filas = C.datos || [];
    if (!filas.length) return toast('No hay datos para descargar', 'warning');
    if (!window.XLSX) { try { await cargarSheetJS(); } catch (e) { return toast(e.message, 'error'); } }
    const obraNom = C.obra ? filas[0].obra_nombre : 'Todas las obras';
    const sub = `Período ${fmtFecha(C.desde)} al ${fmtFecha(C.hasta)} · ${obraNom} · horas de horómetro × tarifa 1 · generado ${fmtFecha(hoy())}`;
    const titulo = 'Certificado de máquinas — Tecsul S.A.E.';
    const obs = r => [r.horas_sin_tarifa > 0 ? (r.horas_sin_tarifa === r.horas ? 'Sin tarifa' : `${fmtNum(r.horas_sin_tarifa, 1)} h sin tarifa`) : '',
      r.tarifa_vencida ? 'Tarifa vencida' : '', r.tarifa_min !== null && num(r.tarifa_min) !== num(r.tarifa_max) ? 'Cambió la tarifa en el período' : '']
      .filter(Boolean).join(' · ');
    const hojas = [];

    if (!C.obra) {
      const porObra = agrupar(filas, 'obra_clave', r => ({ obra_nombre: r.obra_nombre, unidad_negocio: r.unidad_negocio })).sort((a, b) => b.costo - a.costo);
      hojas.push(['Por obra', hoja(titulo, sub, [
        { t: 'Obra', w: 48 }, { t: 'Unidad de negocio', w: 16 }, { t: 'Equipos', w: 9, fmt: 'n' },
        { t: 'Horas', w: 11, fmt: 'h', sum: true }, { t: 'Costo Gs', w: 16, fmt: 'gs', sum: true }, { t: 'Horas sin tarifa', w: 14, fmt: 'h', sum: true }],
        porObra.map(r => [r.obra_nombre, r.unidad_negocio, r.cuantos, r.horas, Math.round(r.costo), r.horas_sin_tarifa]), true)]);
    }

    const det = ordenar(filas, { col: 'costo', asc: false }).sort((a, b) => a.obra_nombre.localeCompare(b.obra_nombre, 'es'));
    hojas.push([C.obra ? 'Certificado' : 'Detalle por obra', hoja(titulo, sub, [
      { t: 'Obra', w: 40 }, { t: 'Unidad de negocio', w: 16 }, { t: 'Equipo', w: 12 }, { t: 'Tipo', w: 26 }, { t: 'Propiedad', w: 10 },
      { t: 'Partes', w: 8, fmt: 'n', sum: true }, { t: 'Días', w: 7, fmt: 'n' }, { t: 'Horas', w: 10, fmt: 'h', sum: true },
      { t: 'Tarifa Gs/h', w: 13, fmt: 'gs' }, { t: 'Costo Gs', w: 16, fmt: 'gs', sum: true }, { t: 'Horas sin tarifa', w: 13, fmt: 'h', sum: true },
      { t: 'Observaciones', w: 34 }],
      det.map(r => [r.obra_nombre, r.unidad_negocio, r.equipo_id, r.descripcion || '', r.propiedad || '', r.partes, r.dias, r.horas,
        r.tarifa_max === null ? '' : num(r.tarifa_max), r.costo === null ? 0 : r.costo, r.horas_sin_tarifa, obs(r)]), true)]);

    if (!C.obra) {
      const porEq = agrupar(filas, 'equipo_id', r => ({ equipo_id: r.equipo_id, descripcion: r.descripcion, propiedad: r.propiedad })).sort((a, b) => b.costo - a.costo);
      hojas.push(['Por equipo', hoja(titulo, sub, [
        { t: 'Equipo', w: 12 }, { t: 'Tipo', w: 26 }, { t: 'Propiedad', w: 10 }, { t: 'Obras', w: 7, fmt: 'n' },
        { t: 'Horas', w: 10, fmt: 'h', sum: true }, { t: 'Costo Gs', w: 16, fmt: 'gs', sum: true }, { t: 'Horas sin tarifa', w: 13, fmt: 'h', sum: true }],
        porEq.map(r => [r.equipo_id, r.descripcion || '', r.propiedad || '', r.cuantos, r.horas, Math.round(r.costo), r.horas_sin_tarifa]), true)]);
    }
    const nombreObra = C.obra ? '_' + obraNom.replace(/[^\wÁÉÍÓÚÑáéíóúñ -]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) : '';
    guardarLibro(hojas, `certificado_maquinas${nombreObra}_${C.desde}_${C.hasta}`);
  }

  // Hoja limpia para imprimir o guardar en PDF
  function imprimir() {
    const filas = C.datos || [];
    if (!filas.length) return toast('No hay datos para imprimir', 'warning');
    const t = resumen(filas);
    const grupos = agrupar(filas, 'obra_clave', r => ({ obra_clave: r.obra_clave, obra_nombre: r.obra_nombre, unidad_negocio: r.unidad_negocio }))
      .sort((a, b) => b.costo - a.costo);
    const bloque = (g) => {
      const l = filas.filter(r => r.obra_clave === g.obra_clave).sort((a, b) => num(b.costo) - num(a.costo));
      return `<h2>${esc(g.obra_nombre)} <small>UN ${esc(g.unidad_negocio || '—')}</small></h2>
        <table><thead><tr><th>Equipo</th><th>Tipo</th><th>Propiedad</th><th>Días</th><th>Horas</th><th>Tarifa Gs/h</th><th>Costo Gs</th></tr></thead><tbody>
        ${l.map(r => `<tr><td>${esc(r.equipo_id)}</td><td>${esc(r.descripcion || '')}</td><td>${esc(r.propiedad || '')}</td><td class="n">${r.dias}</td>
          <td class="n">${fmtNum(r.horas, 1)}</td><td class="n">${r.tarifa_max === null ? 'sin tarifa' : gs(r.tarifa_max)}</td><td class="n">${gs(r.costo)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4">Subtotal</td><td class="n">${fmtNum(g.horas, 1)}</td><td></td><td class="n">${gs(g.costo)}</td></tr></tfoot></table>`;
    };
    const w = window.open('', '_blank');
    if (!w) return toast('El navegador bloqueó la ventana de impresión', 'warning');
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Certificado de máquinas ${fmtFecha(C.desde)} al ${fmtFecha(C.hasta)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;color:#1a2744;margin:18px}h1{font-size:17px;margin:0}h2{font-size:13px;margin:16px 0 4px}
      h2 small{font-weight:400;color:#667}.sub{color:#556;margin:3px 0 12px}table{border-collapse:collapse;width:100%;margin-bottom:6px}
      th{background:#1a2744;color:#fff;text-align:left;padding:4px 6px}td{padding:3px 6px;border-bottom:1px solid #dde}td.n,th:nth-child(n+4){text-align:right}
      tfoot td{font-weight:700;border-top:2px solid #1a2744}.total{font-size:14px;font-weight:700;margin-top:14px;text-align:right}
      @page{margin:14mm}</style></head><body>
      <h1>Certificado de máquinas — Tecsul S.A.E.</h1>
      <div class="sub">Período ${fmtFecha(C.desde)} al ${fmtFecha(C.hasta)} · ${C.obra ? esc(filas[0].obra_nombre) : 'Todas las obras'} · horas de horómetro × tarifa por hora</div>
      ${grupos.map(bloque).join('')}
      <div class="total">Total: ${fmtNum(t.horas, 1)} h · Gs ${gs(t.costo)}</div>
      ${t.sin > 0 ? `<p>Atención: ${fmtNum(t.sin, 1)} horas sin tarifa no están incluidas en el costo.</p>` : ''}
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  // ════════════════════════════════════════════════════════════════
  // MAESTRO DE TARIFAS
  // ════════════════════════════════════════════════════════════════
  async function cargarTarifas() {
    C.tarifas = await todas(() => sb.from('tarifas_equipos').select('*').order('id'));
  }

  async function pintarTarifas(forzar) {
    const cuerpo = $('cert-cuerpo');
    if (forzar || !C.tarifas) {
      cuerpo.innerHTML = '<div class="empty-state">Cargando tarifas…</div>';
      try { await Promise.all([cargarTarifas(), cargarObras()]); }
      catch (e) {
        cuerpo.innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}${/tarifas_equipos/.test(e.message) ? '<br>Falta correr <b>23_certificado_maquinas.sql</b> en Supabase.' : ''}</div>`;
        return;
      }
    }
    const uns = unidades();
    cuerpo.innerHTML = `
      <div class="filtros">
        <div class="filtro crece siempre"><label>Buscar</label><input type="text" id="ta-buscar" value="${esc(C.buscar || '')}" placeholder="Equipo, descripción, proveedor…" oninput="Certificado.tRepintar()"></div>
        <div class="filtro siempre"><label>Unidad de negocio</label><select id="ta-un" onchange="Certificado.tRepintar()">
          <option value="">Todas</option>${uns.map(u => `<option value="${esc(u.codigo)}" ${u.codigo === C.un ? 'selected' : ''}>${esc(u.codigo)} · ${esc(u.nombre)}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>&nbsp;</label><label class="ta-check"><input type="checkbox" id="ta-ultima" ${C.soloUltima ? 'checked' : ''} onchange="Certificado.tRepintar()"> Solo la más reciente</label></div>
        <div class="filtro siempre"><label>&nbsp;</label><label class="ta-check"><input type="checkbox" id="ta-sinv" ${C.sinVincular ? 'checked' : ''} onchange="Certificado.tRepintar()"> Sin vincular a la app</label></div>
      </div>
      <div class="barra-acciones"><div class="info" id="ta-info"></div>
        <button class="btn-filtro" onclick="Certificado.tExportar()">Descargar Excel</button>
        <button class="btn-filtro" onclick="Certificado.editarTarifa(null)">+ Agregar tarifa</button>
        <button class="btn-filtro primario" onclick="Certificado.importar()">Importar de Unysoft</button></div>
      <div id="ta-lista"></div>`;
    tRepintar();
  }

  // Unidades de negocio conocidas: las del maestro y las de las obras
  function unidades() {
    const m = new Map();
    (C.obras || []).forEach(o => { const u = unDe(o.codigo); if (u && !m.has(u)) m.set(u, o.nombre); });
    (C.tarifas || []).forEach(t => { if (t.unidad_negocio_nombre || !m.has(t.unidad_negocio)) m.set(t.unidad_negocio, t.unidad_negocio_nombre || m.get(t.unidad_negocio) || ''); });
    return [...m].map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function tFiltradas() {
    C.buscar = ($('ta-buscar') || {}).value || '';
    C.un = ($('ta-un') || {}).value || '';
    C.soloUltima = ($('ta-ultima') || {}).checked ?? C.soloUltima;
    C.sinVincular = ($('ta-sinv') || {}).checked ?? C.sinVincular;
    const q = sinAcento(C.buscar);
    let l = C.tarifas || [];
    if (C.soloUltima) {
      const ult = new Map();
      l.forEach(t => {
        const k = (t.equipo_id || '#' + t.equipo_unysoft) + '|' + t.unidad_negocio;
        const a = ult.get(k);
        if (!a || t.fecha_hasta > a.fecha_hasta || (t.fecha_hasta === a.fecha_hasta && t.id > a.id)) ult.set(k, t);
      });
      l = [...ult.values()];
    }
    return l.filter(t => (!C.un || t.unidad_negocio === C.un) && (!C.sinVincular || !t.equipo_id)
      && filtroTexto(q, [t.equipo_unysoft, t.equipo_id, t.descripcion, t.unidad_negocio, t.unidad_negocio_nombre, t.proveedor]));
  }

  function tRepintar() {
    if (!$('ta-lista')) return;
    const l = ordenar(tFiltradas(), C.tOrden);
    const sinV = (C.tarifas || []).filter(t => !t.equipo_id).length;
    C.tVisibles = l;
    $('ta-info').textContent = `${l.length} tarifa${l.length === 1 ? '' : 's'}${l.length > C.tLimite ? ` (se muestran ${C.tLimite})` : ''} · ${(C.tarifas || []).length} en el maestro`
      + (sinV ? ` · ${sinV} sin vincular a un equipo de la app` : '');
    if (!(C.tarifas || []).length) {
      $('ta-lista').innerHTML = `<div class="empty-state">El maestro está vacío.<br>Importá el Excel que descargás de Unysoft con el botón <b>Importar de Unysoft</b>.</div>`;
      return;
    }
    const o = C.tOrden;
    $('ta-lista').innerHTML = !l.length ? '<div class="empty-state">Nada coincide con el filtro.</div>' : `<div class="tabla-wrap"><table class="tabla"><thead><tr>
        ${th('equipo_unysoft', 'Equipo', o, 'tOrdenar')}${th('equipo_id', 'En la app', o, 'tOrdenar')}${th('descripcion', 'Descripción', o, 'tOrdenar')}
        ${th('unidad_negocio_nombre', 'Unidad de negocio', o, 'tOrdenar')}${th('fecha_hasta', 'Fecha hasta', o, 'tOrdenar')}
        ${th('tarifa1', 'Tarifa 1', o, 'tOrdenar', 'nro')}${th('tarifa2', 'Tarifa 2', o, 'tOrdenar', 'nro')}${th('minimo_hr', 'Mín. h', o, 'tOrdenar', 'nro')}
        ${th('proveedor', 'Proveedor', o, 'tOrdenar')}</tr></thead><tbody>
      ${l.slice(0, C.tLimite).map((t, i) => `<tr onclick="Certificado.editarTarifa(${i})">
        <td><b>${esc(t.equipo_unysoft)}</b></td><td>${t.equipo_id ? esc(t.equipo_id) : '<span class="chip amarillo">sin vincular</span>'}</td>
        <td class="larga">${esc(t.descripcion || '')}</td><td class="larga">${esc(t.unidad_negocio_nombre || '')} <span class="cambio">${esc(t.unidad_negocio)}</span></td>
        <td>${fmtFecha(t.fecha_hasta)}</td><td class="nro">${gs(t.tarifa1)}</td><td class="nro">${num(t.tarifa2) ? gs(t.tarifa2) : ''}</td>
        <td class="nro">${num(t.minimo_hr) ? fmtNum(t.minimo_hr, 1) : ''}</td><td>${esc(t.proveedor || '')}${t.origen === 'manual' ? ' <span class="chip azul">manual</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${l.length > C.tLimite ? `<div style="text-align:center;margin:10px"><button class="btn-filtro" onclick="Certificado.tMas()">Mostrar más</button></div>` : ''}`;
  }
  function tOrdenar(col) { C.tOrden = { col, asc: C.tOrden.col === col ? !C.tOrden.asc : true }; tRepintar(); }
  function tMas() { C.tLimite += 500; tRepintar(); }
  async function tExportar() {
    const l = ordenar(tFiltradas(), C.tOrden);
    if (!window.XLSX) { try { await cargarSheetJS(); } catch (e) { return toast(e.message, 'error'); } }
    // fecha como número de Excel (evita el corrimiento por zona horaria)
    const f = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400000 + 25569; };
    guardarLibro([['Tarifas', hoja('Maestro de tarifas de equipos — Tecsul S.A.E.', `${l.length} tarifas · generado ${fmtFecha(hoy())}`, [
      { t: 'Id Unysoft', w: 10, fmt: 'n' }, { t: 'Equipo', w: 12 }, { t: 'Equipo en la app', w: 14 }, { t: 'Descripción', w: 40 },
      { t: 'Fecha hasta', w: 12, fmt: 'f' }, { t: 'Unidad de negocio', w: 14 }, { t: 'Nombre unidad', w: 40 }, { t: 'Mínimo h', w: 9, fmt: 'h' },
      { t: 'Tarifa 1', w: 13, fmt: 'gs' }, { t: 'Proveedor', w: 28 }, { t: 'Tarifa 2', w: 13, fmt: 'gs' }, { t: 'Origen', w: 9 }],
      l.map(t => [t.unysoft_id ?? '', t.equipo_unysoft, t.equipo_id || '', t.descripcion || '', f(t.fecha_hasta), t.unidad_negocio,
        t.unidad_negocio_nombre || '', num(t.minimo_hr), num(t.tarifa1), t.proveedor || '', num(t.tarifa2), t.origen]), false)]],
      `maestro_tarifas_${hoy()}`);
  }


  // ── Alta / edición manual ───────────────────────────────────────
  function editarTarifa(i, base) {
    const t = i === null ? Object.assign({ fecha_hasta: `${new Date().getFullYear()}-12-31`, tarifa1: '', tarifa2: 0, minimo_hr: 0 }, base || {}) : C.tVisibles[i];
    C.editando = t;
    const uns = unidades();
    const ids = [...new Set((flota || []).map(f => f.id))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    abrirModal(t.id ? `Tarifa · ${t.equipo_unysoft}` : 'Nueva tarifa', `
      ${t.origen === 'unysoft' ? '<div class="aviso-caja">Viene de Unysoft: si la cambiás acá, la próxima importación la vuelve a pisar (salvo el equipo vinculado).</div>' : ''}
      <div class="form-grid">
        ${campo('tf-eq', 'Equipo (como en Unysoft)', inp('tf-eq', t.equipo_unysoft))}
        ${campo('tf-app', 'Equipo en la app', inp('tf-app', t.equipo_id, 'text', 'list="tf-ids" placeholder="Ej.: CV-14"') + `<datalist id="tf-ids">${ids.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`)}
        ${campo('tf-desc', 'Descripción', inp('tf-desc', t.descripcion), 'ancho')}
        ${campo('tf-un', 'Unidad de negocio', `<select id="tf-un">${uns.map(u => `<option value="${esc(u.codigo)}" ${u.codigo === t.unidad_negocio ? 'selected' : ''}>${esc(u.codigo)} · ${esc(u.nombre)}</option>`).join('')}
          ${t.unidad_negocio && !uns.some(u => u.codigo === t.unidad_negocio) ? `<option selected value="${esc(t.unidad_negocio)}">${esc(t.unidad_negocio)}</option>` : ''}</select>`, 'ancho')}
        ${campo('tf-hasta', 'Fecha hasta', inp('tf-hasta', t.fecha_hasta, 'date'))}
        ${campo('tf-t1', 'Tarifa 1 (Gs por hora)', inp('tf-t1', t.tarifa1, 'number', 'min="0" step="1"'))}
        ${campo('tf-t2', 'Tarifa 2 (Gs)', inp('tf-t2', t.tarifa2, 'number', 'min="0" step="1"'))}
        ${campo('tf-min', 'Mínimo de horas', inp('tf-min', t.minimo_hr, 'number', 'min="0" step="any"'))}
        ${campo('tf-prov', 'Proveedor (si es alquilado)', inp('tf-prov', t.proveedor))}
      </div>
      <div class="acciones">
        ${t.id ? '<button class="btn-mini" style="background:#fdeceb;color:var(--rojo)" onclick="Certificado.borrarTarifa()">Borrar</button>' : ''}
        <button class="btn btn-primario" onclick="Certificado.guardarTarifa()">Guardar</button></div>`);
  }

  async function guardarTarifa() {
    const t = C.editando;
    const un = val('tf-un');
    const unNombre = (unidades().find(u => u.codigo === un) || {}).nombre || null;
    const app = val('tf-app');
    if (app && !(flota || []).some(f => f.id === app)) return toast(`El equipo ${app} no existe en la app`, 'warning');
    const fila = {
      equipo_unysoft: val('tf-eq') || app, equipo_id: app || null, descripcion: val('tf-desc'), unidad_negocio: un,
      unidad_negocio_nombre: unNombre, fecha_hasta: val('tf-hasta'), tarifa1: val('tf-t1'), tarifa2: val('tf-t2') || 0,
      minimo_hr: val('tf-min') || 0, proveedor: val('tf-prov'), actualizado_en: new Date().toISOString(),
    };
    if (!fila.equipo_unysoft || !fila.unidad_negocio || !fila.fecha_hasta || fila.tarifa1 === null) {
      return toast('Completá equipo, unidad de negocio, fecha hasta y tarifa 1', 'warning');
    }
    const q = t.id ? sb.from('tarifas_equipos').update(fila).eq('id', t.id) : sb.from('tarifas_equipos').insert(Object.assign(fila, { origen: 'manual' }));
    const { error } = await q;
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Tarifa guardada', 'success');
    cerrarModal();
    C.tarifas = null;
    if (C.vista === 'tarifas') pintarTarifas(true); else cargarCert();
  }

  async function borrarTarifa() {
    const t = C.editando;
    if (!confirm(`¿Borrar la tarifa de ${t.equipo_unysoft} hasta ${fmtFecha(t.fecha_hasta)}?`)) return;
    const { error } = await sb.from('tarifas_equipos').delete().eq('id', t.id);
    if (error) return toast('No se pudo borrar: ' + error.message, 'error');
    toast('Tarifa borrada', 'success');
    cerrarModal();
    pintarTarifas(true);
  }

  // ── Importar el Excel de Unysoft ────────────────────────────────
  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = SHEETJS;
      s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el lector de Excel (¿hay señal?)'));
      document.head.appendChild(s);
    });
  }

  function importar() {
    C.importar = null;
    abrirModal('Importar tarifas de Unysoft', `
      <p style="margin-top:0">Elegí el Excel del maestro de tarifas de equipos que descargás de Unysoft
        (columnas Id, Equipo, Descripción, Fecha Hasta, Unidad Negocio, Mínimo Hr, Tarifa 1, Proveedor, Tarifa 2).</p>
      <input type="file" id="ti-archivo" accept=".xlsx,.xls,.csv" onchange="Certificado.leerArchivo(this.files[0])">
      <div id="ti-res" style="margin-top:12px"></div>`);
  }

  // Número escrito de cualquier forma: 545454,54 · 1.250.000 · 250000
  function numero(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  // Fecha de texto (dd-mm-aaaa o dd/mm/aaaa) o de Excel (número de serie)
  function fecha(v, invertir) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400000));
      let dia = d.getUTCDate(), mes = d.getUTCMonth() + 1;
      if (invertir) [dia, mes] = [mes, dia];
      return `${d.getUTCFullYear()}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    const m = String(v).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const m2 = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m2 ? m2[0] : null;
  }

  async function leerArchivo(archivo) {
    if (!archivo) return;
    const res = $('ti-res');
    res.innerHTML = '<div class="empty-state">Leyendo el archivo…</div>';
    try {
      await cargarSheetJS();
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', raw: false });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
      C.importar = interpretar(filas);
      pintarVistaPrevia();
    } catch (e) {
      res.innerHTML = `<div class="aviso-caja rojo">${esc(e.message || e)}</div>`;
    }
  }

  function interpretar(filas) {
    const ic = filas.findIndex(f => f && f.some(c => sinAcento(c) === 'equipo') && f.some(c => sinAcento(c).startsWith('tarifa')));
    if (ic < 0) throw new Error('No encontré los encabezados (Id, Equipo, Descripción, Fecha Hasta, Unidad Negocio, Tarifa 1…). ¿Es el archivo de tarifas de Unysoft?');
    const cab = filas[ic].map(sinAcento);
    const col = (n, desde = 0) => cab.findIndex((c, i) => i >= desde && c === n);
    const c = { id: col('id'), equipo: col('equipo'), fecha: col('fecha hasta'), un: col('unidad negocio'),
                min: col('minimo hr'), t1: col('tarifa 1'), prov: col('proveedor'), t2: col('tarifa 2') };
    c.desc = col('descripcion', c.equipo + 1);
    c.unNom = col('descripcion', c.un + 1);
    const faltan = ['equipo', 'fecha', 'un', 't1'].filter(k => c[k] < 0);
    if (faltan.length) throw new Error('Faltan columnas en el archivo: ' + faltan.map(k => ({ equipo: 'Equipo', fecha: 'Fecha Hasta', un: 'Unidad Negocio', t1: 'Tarifa 1' })[k]).join(', '));

    const datos = filas.slice(ic + 1).filter(f => f && f.some(v => v !== null && v !== ''));
    // Excel suele dar vuelta día y mes de las fechas que puede leer
    // como mes-día (ej. "03-12-2023" → 12 de marzo). Si el archivo trae
    // fechas en texto y TODAS las de Excel tienen día ≤ 12, se corrigen.
    const nums = datos.map(f => f[c.fecha]).filter(v => typeof v === 'number');
    const textos = datos.map(f => f[c.fecha]).filter(v => typeof v === 'string' && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(v.trim()));
    const invertir = nums.length > 0 && textos.length > 0 && nums.every(v => new Date(Math.round((v - 25569) * 86400000)).getUTCDate() <= 12);

    const ok = [], malas = [];
    datos.forEach((f, i) => {
      const r = {
        unysoft_id: c.id >= 0 && f[c.id] !== null && /^\d+$/.test(String(f[c.id]).trim()) ? Number(f[c.id]) : null,
        equipo_unysoft: f[c.equipo] === null ? '' : String(f[c.equipo]).trim(),
        descripcion: c.desc >= 0 && f[c.desc] !== null ? String(f[c.desc]).replace(/\s+/g, ' ').trim() : null,
        fecha_hasta: fecha(f[c.fecha], invertir),
        unidad_negocio: f[c.un] === null ? '' : String(f[c.un]).trim().toUpperCase(),
        unidad_negocio_nombre: c.unNom >= 0 && f[c.unNom] !== null ? String(f[c.unNom]).trim() : null,
        minimo_hr: c.min >= 0 ? numero(f[c.min]) : 0,
        tarifa1: numero(f[c.t1]),
        tarifa2: c.t2 >= 0 ? numero(f[c.t2]) : 0,
        proveedor: c.prov >= 0 && f[c.prov] !== null ? String(f[c.prov]).trim() : null,
      };
      const problema = !r.equipo_unysoft ? 'sin equipo' : !r.unidad_negocio ? 'sin unidad de negocio' : !r.fecha_hasta ? 'fecha inválida'
        : r.tarifa1 === null ? 'tarifa inválida' : null;
      if (problema) malas.push({ fila: ic + 2 + i, problema });
      else { r.minimo_hr = r.minimo_hr || 0; r.tarifa2 = r.tarifa2 || 0; ok.push(r); }
    });

    // ¿Qué equipos no están en la app? (propios: por código; alquilados: por la descripción)
    const ids = new Set((flota || []).map(f => f.id.toUpperCase()));
    const noEsta = new Set();
    ok.forEach(r => {
      const primero = (r.descripcion || '').split(' ')[0].toUpperCase();
      if (!ids.has(r.equipo_unysoft.toUpperCase()) && !ids.has(primero)) noEsta.add(/^\d+$/.test(r.equipo_unysoft) ? (primero || r.equipo_unysoft) : r.equipo_unysoft);
    });
    return { ok, malas, invertidas: invertir ? nums.length : 0, noEsta: [...noEsta].sort() };
  }

  function pintarVistaPrevia() {
    const r = C.importar;
    const equipos = new Set(r.ok.map(x => x.equipo_unysoft)).size;
    const uns = new Set(r.ok.map(x => x.unidad_negocio)).size;
    $('ti-res').innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta bien"><span class="n">${fmtNum(r.ok.length)}</span><span class="t">Tarifas leídas</span></div>
        <div class="tarjeta"><span class="n">${equipos}</span><span class="t">Equipos</span></div>
        <div class="tarjeta"><span class="n">${uns}</span><span class="t">Unidades de negocio</span></div>
        ${r.malas.length ? `<div class="tarjeta malo"><span class="n">${r.malas.length}</span><span class="t">Filas descartadas</span></div>` : ''}</div>
      ${r.invertidas ? `<div class="aviso-caja">Se corrigieron ${r.invertidas} fechas que Excel había dado vuelta (día y mes).</div>` : ''}
      ${r.malas.length ? `<details style="margin-bottom:10px"><summary>Filas descartadas</summary><div class="cambio">${r.malas.slice(0, 50).map(m => `Fila ${m.fila}: ${m.problema}`).join('<br>')}</div></details>` : ''}
      ${r.noEsta.length ? `<div class="aviso-caja">${r.noEsta.length} equipo${r.noEsta.length > 1 ? 's' : ''} del archivo no está${r.noEsta.length > 1 ? 'n' : ''} en la app: sus tarifas se guardan
        igual, pero quedan "sin vincular" hasta que se elija el equipo.<details><summary>Ver</summary><div class="cambio">${r.noEsta.map(esc).join(', ')}</div></details></div>` : ''}
      <p class="cambio">Las tarifas que ya estaban (mismo Id de Unysoft) se actualizan; las que no vienen en el archivo no se borran.</p>
      <div class="acciones"><button class="btn btn-primario" id="ti-ok" onclick="Certificado.confirmarImportar()" ${r.ok.length ? '' : 'disabled'}>Importar ${fmtNum(r.ok.length)} tarifas</button></div>`;
  }

  async function confirmarImportar() {
    const filas = C.importar && C.importar.ok;
    if (!filas || !filas.length) return;
    $('ti-ok').disabled = true;
    mostrarCarga('Importando tarifas…');
    const tot = { leidas: 0, nuevas: 0, actualizadas: 0, sin_equipo: 0 };
    try {
      for (let i = 0; i < filas.length; i += 500) {
        mostrarCarga(`Importando tarifas… ${Math.min(i + 500, filas.length)} de ${filas.length}`);
        const { data, error } = await sb.rpc('tarifas_importar', { p: filas.slice(i, i + 500) });
        if (error) throw error;
        tot.leidas += data.leidas; tot.nuevas += data.nuevas; tot.actualizadas += data.actualizadas; tot.sin_equipo = data.sin_equipo;
      }
      ocultarCarga();
      cerrarModal();
      toast(`${fmtNum(tot.nuevas)} tarifas nuevas y ${fmtNum(tot.actualizadas)} actualizadas`, 'success');
      C.vista = 'tarifas';
      C.tarifas = null;
      mostrar();
    } catch (e) {
      ocultarCarga();
      $('ti-ok').disabled = false;
      toast('No se pudo importar: ' + (e.message || e), 'error');
    }
  }

  // ════════════════════════════════════════════════════════════════
  function estilos() {
    if ($('cert-estilos')) return;
    const st = document.createElement('style');
    st.id = 'cert-estilos';
    st.textContent = `
      #screen-cert .tabla td.nro, #screen-cert .tabla th.nro { text-align: right; white-space: nowrap; }
      #screen-cert .tabla tfoot td { font-weight: 700; background: #f3f5f9; border-top: 2px solid var(--azul-oscuro); padding: 8px 11px; }
      #screen-cert .tabla tfoot td.nro { text-align: right; }
      .ce-tit { font-size: 15px; color: var(--azul-oscuro); margin: 18px 2px 8px; }
      .ta-check { display: flex !important; align-items: center; gap: 6px; font-size: 13px; text-transform: none !important;
        letter-spacing: 0 !important; padding: 8px 0; white-space: nowrap; color: var(--gris-texto); }
      #modal .tabla td.nro, #modal .tabla th.nro { text-align: right; }`;
    document.head.appendChild(st);
  }

  return { mostrar, vista, periodo, mes, elegirObra, ordenarCert, clicEquipo, exportar, imprimir,
           tRepintar, tOrdenar, tMas, tExportar, editarTarifa, guardarTarifa, borrarTarifa,
           importar, leerArchivo, confirmarImportar };
})();
