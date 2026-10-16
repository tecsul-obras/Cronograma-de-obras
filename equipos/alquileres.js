// ══════════════════════════════════════════════════════════════════
// ALQUILERES — dentro de "Certificado de máquinas" — Tecsul S.A.E.
//
// Listado de contratos de alquiler (tipo Flota): cliente con RUC, centro
// de costo 305AM… (la obra que eligen en el parte diario), condiciones por
// equipo (precio por hora, horas mínimas por mes, qué incluye), la
// liquidación del mes y las facturas anexadas (SQL 48).
//
// Todo centro de costo que empieza con 305AM es un alquiler: si no tiene
// contrato, aparece igual para crearlo.
//
// Vive en flota.html y usa sus utilidades ($, esc, fmtFecha, fmtNum,
// abrirModal, cerrarModal, toast, mostrarCarga, ocultarCarga, compartir,
// sb, sesion, flota). Edita admin_central; gerente solo ve.
// ══════════════════════════════════════════════════════════════════
window.Alquileres = (() => {
  const BUCKET = 'alquileres';
  const TIPOS = ['Alquiler a terceros', 'Alquiler a consorcios', 'Obras propias', 'Vehículos livianos', 'Contenedores y tanques'];
  const ESTADOS_FACT = ['PENDIENTE', 'EN VERIFICACIÓN', 'FACTURADO'];
  const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
  const A = { mes: mesAnterior(), estado: 'En Vigencia', q: '', sinContrato: true, datos: null, destino: 'cert-cuerpo', orden: { col: 'monto', asc: false } };
  const n = (v) => v === null || v === undefined || v === '' || isNaN(v) ? 0 : Number(v);
  const gs = (v) => fmtNum(Math.round(n(v)));
  const edita = () => sesion && sesion.rol === 'admin_central';
  const es305 = (o) => /^305AM/i.test(o.codigo || '');
  const sinAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const obraDe = (clave) => (A.datos?.obras || []).find(o => o.clave === clave);
  const clienteDe = (id) => (A.datos?.clientes || []).find(k => k.id === id);
  const mesLargo = (m) => { const [y, mm] = m.split('-'); return ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][+mm - 1] + ' ' + y; };

  async function todas(armar) {
    const filas = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await armar().range(d, d + 999);
      if (error) throw error;
      filas.push(...data);
      if (data.length < 1000) return filas;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // DATOS
  // ════════════════════════════════════════════════════════════════
  async function cargar() {
    const ini = A.mes + '-01';
    const fin = new Date(+A.mes.slice(0, 4), +A.mes.slice(5, 7), 0).toISOString().slice(0, 10);
    const [obras, contratos, equipos, clientes, liq, fact, facturas] = await Promise.all([
      sb.from('obras').select('clave, codigo, nombre, ubicacion, activa').order('nombre'),
      sb.from('alquiler_contratos').select('*').order('arrendatario'),
      sb.from('alquiler_equipos').select('*').order('id'),
      sb.from('clientes').select('*').order('nombre'),
      sb.from('v_alquiler_liquidacion').select('*').eq('mes', ini),
      sb.from('alquiler_facturacion').select('*').eq('mes', ini),
      sb.from('alquiler_facturas').select('*').order('fecha', { ascending: false }),
    ]);
    const err = [obras, contratos, equipos, clientes, liq, fact, facturas].find(x => x.error);
    if (err) throw err.error;
    // Equipos con partes en las obras de alquiler en el mes (para avisar los que no tienen condiciones)
    const claves = obras.data.filter(es305).map(o => o.clave)
      .concat(contratos.data.map(c => c.obra_clave).filter(Boolean));
    let partes = [];
    if (claves.length) {
      partes = await todas(() => sb.from('partes').select('obra_clave, equipo_id, fecha, horas_horometro, horas_horometro_reportada')
        .in('obra_clave', [...new Set(claves)]).gte('fecha', ini).lte('fecha', fin));
    }
    A.datos = { obras: obras.data, contratos: contratos.data, equipos: equipos.data, clientes: clientes.data,
      liq: liq.data, fact: Object.fromEntries(fact.data.map(f => [f.contrato_id, f])), facturas: facturas.data, partes };
  }

  // Una fila por contrato + una por cada centro de costo 305AM sin contrato
  function filas() {
    const d = A.datos;
    const conContrato = new Set(d.contratos.map(c => c.obra_clave).filter(Boolean));
    const partesDe = (clave) => {
      const m = {};
      d.partes.filter(p => p.obra_clave === clave).forEach(p => {
        const e = m[p.equipo_id] || (m[p.equipo_id] = { horas: 0, partes: 0 });
        e.horas += n(p.horas_horometro ?? p.horas_horometro_reportada); e.partes++;
      });
      return m;
    };
    const l = d.contratos.map(c => {
      const eqs = d.equipos.filter(e => e.contrato_id === c.id);
      const liq = d.liq.filter(r => r.contrato_id === c.id);
      const pm = c.obra_clave ? partesDe(c.obra_clave) : {};
      const sinCond = Object.keys(pm).filter(id => !eqs.some(e => e.equipo_id === id));
      const k = clienteDe(c.cliente_id);
      return { tipo: 'contrato', id: c.id, c, eqs, liq, sinCond, obra: obraDe(c.obra_clave),
        cliente: k ? k.nombre : c.arrendatario, ruc: k ? k.ruc : c.ruc,
        horas: liq.reduce((s, r) => s + n(r.horas_trabajadas), 0), monto: liq.reduce((s, r) => s + n(r.monto_gs), 0),
        fact: d.fact[c.id], nFacturas: d.facturas.filter(f => f.contrato_id === c.id).length, estado: c.estado };
    });
    d.obras.filter(o => es305(o) && o.activa && !conContrato.has(o.clave)).forEach(o => {
      const pm = partesDe(o.clave);
      l.push({ tipo: 'obra', id: 'o:' + o.clave, obra: o, c: null, eqs: [], liq: [], sinCond: Object.keys(pm), cliente: '', ruc: '',
        horas: Object.values(pm).reduce((s, e) => s + e.horas, 0), monto: 0, fact: null, nFacturas: 0, estado: 'Sin contrato' });
    });
    return l;
  }

  // ════════════════════════════════════════════════════════════════
  // LISTADO
  // ════════════════════════════════════════════════════════════════
  async function mostrar(destino) {
    A.destino = destino || 'cert-cuerpo';
    estilos();
    const cuerpo = $(A.destino);
    if (!A.datos) cuerpo.innerHTML = '<div class="empty-state">Cargando alquileres…</div>';
    try { await cargar(); }
    catch (e) {
      cuerpo.innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}${/clientes|alquiler_facturas|obra_clave/.test(e.message) ? '<br>Falta correr <b>48_alquileres_clientes_facturas.sql</b> en Supabase.' : ''}</div>`;
      return;
    }
    pintar();
  }

  function pintar() {
    const cuerpo = $(A.destino);
    if (!cuerpo) return;
    cuerpo.innerHTML = `
      <div class="filtros">
        <div class="filtro siempre"><label>Mes</label><input type="month" value="${A.mes}" onchange="Alquileres.cambiarMes(this.value)"></div>
        <div class="filtro crece siempre"><label>Buscar</label><input type="text" id="al-q" value="${esc(A.q)}" placeholder="Cliente, RUC, obra, equipo…" oninput="Alquileres.filtro('q', this.value)"></div>
        <div class="filtro siempre"><label>Estado</label><select onchange="Alquileres.filtro('estado', this.value)">
          ${[['En Vigencia', 'En vigencia'], ['Culminado', 'Culminados'], ['', 'Todos']].map(([v, t]) => `<option value="${v}" ${A.estado === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="filtro siempre"><label>&nbsp;</label><label class="check-linea"><input type="checkbox" ${A.sinContrato ? 'checked' : ''}
          onchange="Alquileres.filtro('sinContrato', this.checked)"> Centros 305AM sin contrato</label></div>
      </div>
      <div id="al-tarjetas"></div>
      <div class="barra-acciones"><div class="info" id="al-info"></div>
        <button class="btn-filtro" onclick="Alquileres.exportar()">Descargar Excel</button>
        ${edita() ? '<button class="btn-filtro primario" onclick="Alquileres.abrir(null)">+ Nuevo contrato</button>' : ''}</div>
      <div id="al-lista"></div>`;
    pintarLista();
  }

  function visibles() {
    const q = sinAcento(A.q).trim();
    return filas().filter(r => {
      if (r.tipo === 'obra' && !A.sinContrato) return false;
      if (r.tipo === 'contrato' && A.estado && r.estado !== A.estado) return false;
      if (q) {
        const pajar = sinAcento([r.cliente, r.ruc, r.obra?.nombre, r.obra?.codigo, r.c?.obra, r.c?.ubicacion,
          ...r.eqs.map(e => e.equipo_id || e.equipo_texto), ...r.sinCond].join(' '));
        if (!q.split(/\s+/).every(p => pajar.includes(p))) return false;
      }
      return true;
    });
  }

  function pintarLista() {
    const l = visibles();
    const o = A.orden;
    const val = (r) => o.col === 'cliente' ? r.cliente : o.col === 'obra' ? (r.obra?.nombre || r.c?.obra || '') : r[o.col];
    l.sort((a, b) => {
      const x = val(a), y = val(b);
      const r = typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), 'es', { numeric: true });
      return o.asc ? r : -r;
    });
    A.visibles = l;
    const contratos = l.filter(r => r.tipo === 'contrato');
    const total = contratos.reduce((s, r) => s + r.monto, 0);
    const factur = contratos.filter(r => r.liq.length && (r.fact?.estado === 'FACTURADO'));
    const porFact = contratos.filter(r => r.liq.length && r.fact?.estado !== 'FACTURADO');
    const sinC = l.filter(r => r.tipo === 'obra').length;
    $('al-tarjetas').innerHTML = `<div class="tarjetas">
      <div class="tarjeta"><span class="n">${fmtNum(total / 1e6, 1)} M</span><span class="t">Gs a liquidar · ${mesLargo(A.mes)}</span></div>
      <div class="tarjeta"><span class="n">${contratos.length}</span><span class="t">Contratos</span></div>
      <div class="tarjeta bien"><span class="n">${factur.length}</span><span class="t">Facturados</span></div>
      <div class="tarjeta medio"><span class="n">${porFact.length}</span><span class="t">Por facturar</span></div>
      ${sinC ? `<div class="tarjeta malo"><span class="n">${sinC}</span><span class="t">305AM sin contrato</span></div>` : ''}</div>`;
    $('al-info').textContent = `${l.length} fila${l.length === 1 ? '' : 's'} · tocá una para ver o editar`;
    const th = (k, t, cls = '') => `<th class="${o.col === k ? 'activo' : ''} ${cls}" onclick="Alquileres.ordenar('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
    const chipFact = (r) => !r.liq.length ? '' : `<span class="chip ${r.fact?.estado === 'FACTURADO' ? 'verde' : r.fact?.estado === 'EN VERIFICACIÓN' ? 'azul' : 'amarillo'}">${esc(r.fact?.estado || 'PENDIENTE')}</span>`;
    $('al-lista').innerHTML = !l.length ? '<div class="empty-state">Nada coincide con los filtros.</div>' : `<div class="tabla-wrap"><table class="tabla al-t"><thead><tr>
        ${th('cliente', 'Cliente')}${th('obra', 'Centro de costo (obra del parte)')}<th>Equipos y condiciones</th>
        ${th('horas', 'Horas del mes', 'nro')}${th('monto', 'Monto del mes', 'nro')}<th>Facturación</th><th class="nro">Facturas</th>${th('estado', 'Estado')}</tr></thead><tbody>
      ${l.map((r, i) => `<tr onclick="Alquileres.abrir(${i})" class="${r.tipo === 'obra' ? 'al-sin' : ''}">
        <td><b>${esc(r.cliente || '—')}</b>${r.ruc ? `<div class="cambio">RUC ${esc(r.ruc)}</div>` : ''}</td>
        <td class="larga">${r.obra ? `${esc(r.obra.nombre)}<div class="cambio">${esc(r.obra.codigo)}</div>` : `<span class="chip amarillo">sin vincular</span> ${esc(r.c?.obra || '')}`}</td>
        <td>${r.eqs.map(e => `<span class="chip azul">${esc(e.equipo_id || e.equipo_texto)}${e.precio_hora_gs ? ' · ' + fmtNum(n(e.precio_hora_gs) / 1000) + ' mil/h' : ''}${n(e.horas_minimas_mes) ? ' · mín ' + fmtNum(e.horas_minimas_mes) + ' h' : ''}</span>`).join(' ')}
          ${r.sinCond.length ? `<span class="chip rojo" title="Tienen partes en esta obra pero no condiciones en el contrato">${r.sinCond.length} sin condiciones: ${esc(r.sinCond.slice(0, 4).join(', '))}${r.sinCond.length > 4 ? '…' : ''}</span>` : ''}</td>
        <td class="nro">${r.horas ? fmtNum(r.horas, 1) : ''}</td><td class="nro"><b>${r.monto ? gs(r.monto) : ''}</b></td>
        <td>${chipFact(r)}${r.fact?.nro_factura ? ` <span class="cambio">N° ${esc(r.fact.nro_factura)}</span>` : ''}</td>
        <td class="nro">${r.nFacturas ? '📎 ' + r.nFacturas : ''}</td>
        <td><span class="chip ${r.estado === 'En Vigencia' ? 'verde' : r.estado === 'Sin contrato' ? 'rojo' : 'gris'}">${esc(r.estado)}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  let espera;
  function filtro(k, v) {
    A[k] = v;
    if (k === 'q') { clearTimeout(espera); espera = setTimeout(pintarLista, 200); return; }
    pintarLista();
  }
  function ordenar(col) { A.orden = { col, asc: A.orden.col === col ? !A.orden.asc : !['horas', 'monto'].includes(col) }; pintarLista(); }
  async function cambiarMes(m) { A.mes = m || mesAnterior(); await mostrar(A.destino); }

  // ════════════════════════════════════════════════════════════════
  // FICHA DEL CONTRATO
  // ════════════════════════════════════════════════════════════════
  function abrir(i) {
    const r = i === null ? null : A.visibles[i];
    const d = A.datos;
    const c = r && r.c ? Object.assign({}, r.c) : { estado: 'En Vigencia', tipo: 'Alquiler a terceros', obra_clave: r && r.obra ? r.obra.clave : null };
    A.ficha = { c, eqs: (r ? r.eqs : []).map(e => Object.assign({}, e)), sinCond: r ? r.sinCond : [], r,
      cliente: Object.assign({}, clienteDe(c.cliente_id) || { nombre: c.arrendatario || '', ruc: c.ruc || '', contacto: c.contacto || '', telefono: c.telefono || '', email: c.email || '' }) };
    if (!c.id && r && r.sinCond.length) A.ficha.eqs = r.sinCond.map(id => ({ equipo_id: id, incluye_operador: true, incluye_combustible: false }));
    pintarFicha();
  }

  function pintarFicha() {
    const f = A.ficha, c = f.c, k = f.cliente, ed = edita(), dis = ed ? '' : 'disabled';
    const d = A.datos;
    const obras = [...d.obras].sort((a, b) => (es305(b) - es305(a)) || (b.activa - a.activa) || a.nombre.localeCompare(b.nombre, 'es'));
    const fila = (id, label, html, cls = '') => `<div class="field ${cls}"><label for="${id}">${label}</label>${html}</div>`;
    const inp = (id, v, tipo = 'text', extra = '') => `<input type="${tipo}" id="${id}" value="${esc(v ?? '')}" ${dis} ${extra}>`;
    const liq = c.id ? d.liq.filter(x => x.contrato_id === c.id) : [];
    const fact = c.id ? d.fact[c.id] || {} : {};
    const facturas = c.id ? d.facturas.filter(x => x.contrato_id === c.id) : [];
    const totalLiq = liq.reduce((s, x) => s + n(x.monto_gs), 0);
    abrirModal(c.id ? `Alquiler · ${k.nombre || c.arrendatario}` : 'Nuevo contrato de alquiler', `
      <div class="al-sec"><h4>Cliente</h4><div class="form-grid">
        ${fila('al-cli', 'Cliente', `<input type="text" id="al-cli" list="al-clientes" value="${esc(k.nombre || '')}" ${dis} onchange="Alquileres.elegirCliente(this.value)">
          <datalist id="al-clientes">${d.clientes.map(x => `<option value="${esc(x.nombre)}">${esc(x.ruc || '')}</option>`).join('')}</datalist>`, 'ancho')}
        ${fila('al-ruc', 'RUC', inp('al-ruc', k.ruc))}
        ${fila('al-cont', 'Contacto', inp('al-cont', k.contacto))}
        ${fila('al-tel', 'Teléfono', inp('al-tel', k.telefono))}
        ${fila('al-mail', 'Correo', inp('al-mail', k.email, 'email'))}
        ${fila('al-dir', 'Dirección', inp('al-dir', k.direccion), 'ancho')}
      </div>${k.id ? '<div class="cambio">Los datos del cliente se comparten con sus otros contratos y los certificados.</div>' : '<div class="cambio">Cliente nuevo: se crea al guardar.</div>'}</div>

      <div class="al-sec"><h4>Contrato</h4><div class="form-grid">
        ${fila('al-obra', 'Centro de costo (la obra que eligen en el parte diario)', `<select id="al-obra" ${dis}><option value="">— Sin vincular —</option>
          ${obras.map(o => `<option value="${esc(o.clave)}" ${o.clave === c.obra_clave ? 'selected' : ''}>${esc(o.codigo)} · ${esc(o.nombre)}${o.activa ? '' : ' (inactiva)'}</option>`).join('')}</select>`, 'ancho')}
        ${fila('al-otx', 'Obra (texto)', inp('al-otx', c.obra))}
        ${fila('al-ubic', 'Ubicación', inp('al-ubic', c.ubicacion))}
        ${fila('al-tipo', 'Tipo', `<select id="al-tipo" ${dis}>${TIPOS.map(t => `<option ${t === c.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
        ${fila('al-est', 'Estado', `<select id="al-est" ${dis}>${['En Vigencia', 'Culminado'].map(t => `<option ${t === c.estado ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
        ${fila('al-ini', 'Inicio', inp('al-ini', c.fecha_inicio, 'date'))}
        ${fila('al-fin', 'Fin', inp('al-fin', c.fecha_fin, 'date'))}
        ${fila('al-notas', 'Notas / condiciones generales', `<textarea id="al-notas" rows="2" ${dis}>${esc(c.notas || '')}</textarea>`, 'ancho')}
      </div>${!c.fecha_inicio ? '<div class="aviso-caja">Sin fecha de inicio no se puede liquidar: cargá desde cuándo corre el alquiler.</div>' : ''}</div>

      <div class="al-sec"><h4>Condiciones por equipo</h4>
        <div class="cambio" style="margin-bottom:6px">Horas = horómetro de los partes del equipo en este centro de costo. Si no llega a las horas mínimas (prorrateadas por los días alquilados), se cobra el mínimo.</div>
        <div id="al-eqs"></div>
        ${ed ? `<button class="al-mas" onclick="Alquileres.sumarEquipo()">+ Agregar equipo</button>` : ''}
        ${f.sinCond.filter(id => !f.eqs.some(e => e.equipo_id === id)).length && ed ? `<div class="aviso-caja">Con partes en la obra y sin condiciones: ${esc(f.sinCond.filter(id => !f.eqs.some(e => e.equipo_id === id)).join(', '))}
          <button class="btn-mini btn-neutro" onclick="Alquileres.sumarSinCondiciones()">Agregarlos</button></div>` : ''}
      </div>
      ${ed ? `<div class="acciones"><button class="btn btn-primario" onclick="Alquileres.guardar()">Guardar contrato</button></div>` : ''}

      ${c.id ? `<div class="al-sec"><h4>Liquidación · ${mesLargo(A.mes)}</h4>
        ${!liq.length ? '<div class="empty-state" style="padding:10px">Sin liquidación para este mes (revisá fechas y condiciones).</div>' : `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          <th>Equipo</th><th class="nro">Días</th><th class="nro">Partes</th><th class="nro">Horas</th><th class="nro">Mínimo</th><th class="nro">A cobrar</th><th class="nro">Precio/h</th><th class="nro">Monto</th></tr></thead><tbody>
          ${liq.map(x => `<tr style="cursor:default"><td><b>${esc(x.equipo_id || x.equipo_texto)}</b></td><td class="nro">${x.dias_alquilado}</td><td class="nro">${x.partes}</td>
            <td class="nro">${fmtNum(x.horas_trabajadas, 1)}</td><td class="nro">${fmtNum(x.horas_minimas, 1)}</td>
            <td class="nro">${n(x.horas_trabajadas) < n(x.horas_minimas) ? `<span class="chip amarillo">${fmtNum(x.horas_facturables, 1)} (mín.)</span>` : fmtNum(x.horas_facturables, 1)}</td>
            <td class="nro">${gs(x.precio_hora_gs)}</td><td class="nro"><b>${gs(x.monto_gs)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="7">Total (IVA incluido)</td><td class="nro">${gs(totalLiq)}</td></tr></tfoot></table></div>`}
        <div class="form-grid" style="margin-top:10px">
          ${fila('al-fe', 'Facturación del mes', `<select id="al-fe" ${dis}>${ESTADOS_FACT.map(e => `<option ${e === (fact.estado || 'PENDIENTE') ? 'selected' : ''}>${e}</option>`).join('')}</select>`)}
          ${fila('al-fn', 'N° de factura', inp('al-fn', fact.nro_factura))}
          ${fila('al-fm', 'Monto facturado (Gs)', inp('al-fm', fact.monto_facturado_gs, 'number'))}
        </div>
        <div class="acciones">
          <button class="btn-mini btn-neutro" onclick="Alquileres.compartirLiq()">Compartir liquidación</button>
          ${c.obra_clave ? `<button class="btn-mini btn-neutro" onclick="Alquileres.armarCertificado()">Armar certificado</button>` : ''}
          ${ed ? '<button class="btn-mini" style="background:var(--verde);color:#fff" onclick="Alquileres.guardarFact()">Guardar facturación</button>' : ''}</div></div>

      <div class="al-sec"><h4>Facturas anexadas</h4>
        ${!facturas.length ? '<div class="cambio">Todavía no hay facturas anexadas.</div>' : `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          <th>Mes</th><th>N° factura</th><th>Fecha</th><th class="nro">Monto Gs</th><th>Archivo</th><th></th></tr></thead><tbody>
          ${facturas.map(x => `<tr style="cursor:default"><td>${x.mes ? mesLargo(x.mes.slice(0, 7)) : ''}</td><td>${esc(x.nro_factura || '')}</td><td>${fmtFecha(x.fecha)}</td>
            <td class="nro">${x.monto_gs ? gs(x.monto_gs) : ''}</td>
            <td>${x.archivo ? `<a href="#" onclick="Alquileres.verArchivo(${x.id});return false">📎 ${esc(x.archivo_nombre || 'ver')}</a>` : ''}</td>
            <td>${ed ? `<button class="btn-mini btn-rojo" onclick="Alquileres.borrarFactura(${x.id})">Borrar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}
        ${ed ? `<div class="form-grid al-nueva-f" style="margin-top:10px">
          ${fila('af-mes', 'Mes que factura', `<input type="month" id="af-mes" value="${A.mes}">`)}
          ${fila('af-nro', 'N° de factura', `<input type="text" id="af-nro" value="${esc(fact.nro_factura || '')}">`)}
          ${fila('af-fecha', 'Fecha', `<input type="date" id="af-fecha">`)}
          ${fila('af-monto', 'Monto (Gs)', `<input type="number" id="af-monto" value="${totalLiq ? Math.round(totalLiq) : ''}">`)}
          ${fila('af-arch', 'Archivo (PDF o foto)', `<input type="file" id="af-arch" accept="application/pdf,image/*">`, 'ancho')}
        </div><div class="acciones"><button class="btn-mini" style="background:var(--azul-medio);color:#fff" onclick="Alquileres.anexarFactura()">Anexar factura</button></div>` : ''}
      </div>` : ''}`);
    $('modal').querySelector('.modal-card').classList.add('ancho');
    pintarEquipos();
  }

  function pintarEquipos() {
    const f = A.ficha, ed = edita(), dis = ed ? '' : 'disabled';
    const ids = (typeof flota !== 'undefined' ? flota || [] : []).filter(x => x.activo).map(x => x.id).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const vivos = f.eqs.filter(e => !e._borrar);
    $('al-eqs').innerHTML = !vivos.length ? '<div class="empty-state" style="padding:10px">Sin equipos en el contrato.</div>' : `<div class="tabla-wrap" style="max-height:none"><table class="tabla al-cond"><thead><tr>
        <th>Equipo</th><th class="nro">Precio por hora (Gs, IVA incl.)</th><th class="nro">Horas mínimas / mes</th><th>Desde</th><th>Hasta</th><th>Operador</th><th>Combustible</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
      ${f.eqs.map((e, i) => e._borrar ? '' : `<tr style="cursor:default">
        <td><select ${dis} onchange="Alquileres.dato(${i},'equipo_id',this.value)"><option value="">${esc(e.equipo_texto || '—')}</option>
          ${ids.map(x => `<option ${x === e.equipo_id ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
        <td class="nro"><input type="number" min="0" step="1" value="${esc(e.precio_hora_gs ?? '')}" ${dis} onchange="Alquileres.dato(${i},'precio_hora_gs',this.value)"></td>
        <td class="nro"><input type="number" min="0" step="any" value="${esc(e.horas_minimas_mes ?? '')}" ${dis} onchange="Alquileres.dato(${i},'horas_minimas_mes',this.value)"></td>
        <td><input type="date" value="${esc(e.desde || '')}" ${dis} onchange="Alquileres.dato(${i},'desde',this.value)"></td>
        <td><input type="date" value="${esc(e.hasta || '')}" ${dis} onchange="Alquileres.dato(${i},'hasta',this.value)"></td>
        <td><input type="checkbox" ${e.incluye_operador ? 'checked' : ''} ${dis} onchange="Alquileres.dato(${i},'incluye_operador',this.checked)"></td>
        <td><input type="checkbox" ${e.incluye_combustible ? 'checked' : ''} ${dis} onchange="Alquileres.dato(${i},'incluye_combustible',this.checked)"></td>
        ${ed ? `<td><button class="btn-mini btn-rojo" onclick="Alquileres.quitarEquipo(${i})">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  function dato(i, k, v) { A.ficha.eqs[i][k] = v === '' ? null : v; }
  function sumarEquipo() { A.ficha.eqs.push({ incluye_operador: true, incluye_combustible: false }); pintarEquipos(); }
  function sumarSinCondiciones() {
    A.ficha.sinCond.filter(id => !A.ficha.eqs.some(e => e.equipo_id === id))
      .forEach(id => A.ficha.eqs.push({ equipo_id: id, incluye_operador: true, incluye_combustible: false }));
    pintarFicha();
  }
  function quitarEquipo(i) { A.ficha.eqs[i]._borrar = true; pintarEquipos(); }
  function elegirCliente(nombre) {
    const k = A.datos.clientes.find(x => x.nombre.toUpperCase() === String(nombre).trim().toUpperCase());
    A.ficha.cliente = k ? Object.assign({}, k) : { nombre: String(nombre).trim() };
    ['ruc', 'contacto', 'telefono', 'email', 'direccion'].forEach(c => {
      const el = $({ ruc: 'al-ruc', contacto: 'al-cont', telefono: 'al-tel', email: 'al-mail', direccion: 'al-dir' }[c]);
      if (el) el.value = A.ficha.cliente[c] || (k ? '' : el.value);
    });
  }

  async function guardar() {
    const f = A.ficha, v = (id) => { const el = $(id); return el ? (el.value || '').trim() : ''; };
    const nombre = v('al-cli');
    if (!nombre) return toast('Falta el cliente', 'warning');
    if (f.eqs.some(e => !e._borrar && !e.equipo_id && !e.equipo_texto)) return toast('Elegí el equipo en cada fila (o quitala)', 'warning');
    const cli = { nombre, ruc: v('al-ruc') || null, contacto: v('al-cont') || null, telefono: v('al-tel') || null,
      email: v('al-mail') || null, direccion: v('al-dir') || null, actualizado_en: new Date().toISOString() };
    mostrarCarga('Guardando…');
    try {
      // Cliente: el elegido, o uno nuevo (si ya existe ese RUC, se usa ese)
      let kid = f.cliente.id && f.cliente.nombre.toUpperCase() === nombre.toUpperCase() ? f.cliente.id : null;
      if (!kid && cli.ruc) kid = (A.datos.clientes.find(x => x.ruc === cli.ruc) || {}).id || null;
      if (kid) { const r = await sb.from('clientes').update(cli).eq('id', kid); if (r.error) throw r.error; }
      else { const r = await sb.from('clientes').insert(cli).select('id').single(); if (r.error) throw r.error; kid = r.data.id; }
      const d = { cliente_id: kid, arrendatario: nombre, ruc: cli.ruc, contacto: cli.contacto, telefono: cli.telefono, email: cli.email,
        obra_clave: v('al-obra') || null, obra: v('al-otx') || null, ubicacion: v('al-ubic') || null, tipo: v('al-tipo') || 'Alquiler a terceros',
        estado: v('al-est') || 'En Vigencia', fecha_inicio: v('al-ini') || null, fecha_fin: v('al-fin') || null, notas: v('al-notas') || null };
      if (!d.obra && d.obra_clave) d.obra = (obraDe(d.obra_clave) || {}).nombre || null;
      let id = f.c.id;
      if (id) { const r = await sb.from('alquiler_contratos').update(d).eq('id', id); if (r.error) throw r.error; }
      else { const r = await sb.from('alquiler_contratos').insert(d).select('id').single(); if (r.error) throw r.error; id = r.data.id; }
      for (const e of f.eqs) {
        const fila = { contrato_id: id, equipo_id: e.equipo_id || null, equipo_texto: e.equipo_id ? null : (e.equipo_texto || null),
          precio_hora_gs: e.precio_hora_gs === '' ? null : e.precio_hora_gs, horas_minimas_mes: e.horas_minimas_mes === '' ? null : e.horas_minimas_mes,
          desde: e.desde || null, hasta: e.hasta || null, incluye_operador: !!e.incluye_operador, incluye_combustible: !!e.incluye_combustible };
        let r = null;
        if (e._borrar && e.id) r = await sb.from('alquiler_equipos').delete().eq('id', e.id);
        else if (e._borrar) continue;
        else if (e.id) r = await sb.from('alquiler_equipos').update(fila).eq('id', e.id);
        else r = await sb.from('alquiler_equipos').insert(fila);
        if (r && r.error) throw r.error;
      }
      ocultarCarga();
      toast('Contrato guardado', 'success');
      await cargar();
      const nuevo = filas().find(x => x.tipo === 'contrato' && x.id === id);
      pintar();
      if (nuevo) { A.visibles = [nuevo, ...A.visibles.filter(x => x !== nuevo)]; abrir(0); pintarLista(); }
    } catch (e) { ocultarCarga(); toast('No se pudo guardar: ' + e.message, 'error'); }
  }

  async function guardarFact() {
    const c = A.ficha.c;
    const { error } = await sb.from('alquiler_facturacion').upsert({ contrato_id: c.id, mes: A.mes + '-01',
      estado: $('al-fe').value || 'PENDIENTE', nro_factura: $('al-fn').value.trim() || null,
      monto_facturado_gs: $('al-fm').value || null, actualizado_en: new Date().toISOString() }, { onConflict: 'contrato_id,mes' });
    if (error) return toast('No se pudo guardar: ' + error.message, 'error');
    toast('Facturación guardada', 'success');
    await cargar(); pintarLista(); reabrir(c.id);
  }
  function reabrir(id) {
    const r = filas().find(x => x.tipo === 'contrato' && x.id === id);
    if (!r) return cerrarModal();
    A.visibles = [r, ...A.visibles.filter(x => x.id !== id)];
    abrir(0);
  }

  async function anexarFactura() {
    const c = A.ficha.c, file = $('af-arch').files[0];
    const nro = $('af-nro').value.trim(), mes = $('af-mes').value;
    if (!nro && !file) return toast('Poné el número de factura o elegí el archivo', 'warning');
    mostrarCarga('Subiendo factura…');
    try {
      let ruta = null;
      if (file) {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
        ruta = `${c.id}/${(mes || 'sin-mes')}_${(nro || 'factura').replace(/[^\w-]/g, '_')}_${Date.now()}.${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(ruta, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw error;
      }
      const { error } = await sb.from('alquiler_facturas').insert({ contrato_id: c.id, mes: mes ? mes + '-01' : null, nro_factura: nro || null,
        fecha: $('af-fecha').value || null, monto_gs: $('af-monto').value || null, archivo: ruta, archivo_nombre: file ? file.name : null });
      if (error) throw error;
      // Si es del mes de la liquidación, queda también como facturado
      if (mes === A.mes && nro) {
        await sb.from('alquiler_facturacion').upsert({ contrato_id: c.id, mes: mes + '-01', estado: 'FACTURADO', nro_factura: nro,
          monto_facturado_gs: $('af-monto').value || null, actualizado_en: new Date().toISOString() }, { onConflict: 'contrato_id,mes' });
      }
      ocultarCarga();
      toast('Factura anexada', 'success');
      await cargar(); pintarLista(); reabrir(c.id);
    } catch (e) { ocultarCarga(); toast('No se pudo anexar: ' + e.message, 'error'); }
  }
  async function verArchivo(id) {
    const x = A.datos.facturas.find(f => f.id === id);
    if (!x || !x.archivo) return;
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(x.archivo, 600);
    if (error) { if (w) w.close(); return toast('No se pudo abrir: ' + error.message, 'error'); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  }
  async function borrarFactura(id) {
    const x = A.datos.facturas.find(f => f.id === id);
    if (!x || !confirm(`¿Borrar la factura ${x.nro_factura || ''}?`)) return;
    if (x.archivo) await sb.storage.from(BUCKET).remove([x.archivo]);
    const { error } = await sb.from('alquiler_facturas').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    toast('Factura borrada', 'success');
    await cargar(); pintarLista(); reabrir(x.contrato_id);
  }

  function compartirLiq() {
    const c = A.ficha.c, k = A.ficha.cliente;
    const l = A.datos.liq.filter(x => x.contrato_id === c.id);
    const sub = l.reduce((s, x) => s + n(x.monto_gs), 0);
    compartir(`*Liquidación ${mesLargo(A.mes)} – ${k.nombre || c.arrendatario}*${k.ruc ? ' (RUC ' + k.ruc + ')' : ''}\n${(obraDe(c.obra_clave) || {}).nombre || c.obra || ''}\n`
      + l.map(x => `• ${x.equipo_id || x.equipo_texto}: ${fmtNum(x.horas_facturables, 1)} h${n(x.horas_trabajadas) < n(x.horas_minimas) ? ' (mínimo)' : ''} × Gs ${gs(x.precio_hora_gs)} = Gs ${gs(x.monto_gs)}`).join('\n')
      + `\n*Total: Gs ${gs(sub)}* (IVA incluido)`);
  }
  function armarCertificado() {
    const c = A.ficha.c;
    cerrarModal();
    Certificado.vista('certs');
    setTimeout(() => window.CertMaq && CertMaq.nuevo(c.obra_clave, A.mes), 300);
  }

  async function exportar() {
    const l = A.visibles || [];
    const aoa = [['Alquileres de maquinarias — Tecsul S.A.E.'], [`${mesLargo(A.mes)} · generado ${fmtFecha(new Date().toISOString().slice(0, 10))}`], [],
      ['Cliente', 'RUC', 'Centro de costo', 'Código', 'Estado', 'Equipo', 'Precio/h Gs', 'Horas mínimas/mes', 'Días', 'Partes', 'Horas', 'Mínimo', 'A cobrar', 'Monto Gs', 'Facturación', 'N° factura']];
    l.forEach(r => {
      const base = [r.cliente, r.ruc || '', r.obra?.nombre || r.c?.obra || '', r.obra?.codigo || '', r.estado];
      if (!r.eqs.length) { aoa.push([...base, r.sinCond.join(', ')]); return; }
      r.eqs.forEach(e => {
        const x = r.liq.find(y => y.alquiler_equipo_id === e.id) || {};
        aoa.push([...base, e.equipo_id || e.equipo_texto, n(e.precio_hora_gs) || '', n(e.horas_minimas_mes) || '', x.dias_alquilado ?? '', x.partes ?? '',
          x.horas_trabajadas ?? '', x.horas_minimas ?? '', x.horas_facturables ?? '', x.monto_gs ?? '', r.fact?.estado || (r.liq.length ? 'PENDIENTE' : ''), r.fact?.nro_factura || '']);
      });
    });
    if (!window.XLSX) {
      await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
        .catch(() => toast('No se pudo cargar el generador de Excel', 'error'));
      if (!window.XLSX) return;
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [34, 12, 44, 12, 12, 10, 12, 12, 6, 7, 9, 9, 9, 14, 14, 12].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Alquileres');
    XLSX.writeFile(wb, `alquileres_${A.mes}.xlsx`);
  }

  function estilos() {
    if ($('al-estilos')) return;
    const st = document.createElement('style');
    st.id = 'al-estilos';
    st.textContent = `
      .al-t { white-space: normal; }
      .al-t td { vertical-align: top; }
      .al-t td.nro, .al-t th.nro { text-align: right; white-space: nowrap; }
      .al-t .chip { margin: 1px 2px 1px 0; display: inline-block; }
      .al-t tr.al-sin td { background: #fffaf2 !important; }
      .al-sec { border-top: 1px solid #eef1f5; padding-top: 10px; margin-top: 12px; }
      .al-sec:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
      .al-mas { width: 100%; padding: 9px; border: 1.5px dashed var(--azul-medio); background: #eef2f9; color: var(--azul-medio); border-radius: 8px; font-weight: 700; margin: 8px 0; cursor: pointer; }
      .al-sec h4 { margin: 0 0 8px; color: var(--azul-oscuro); font-size: 14.5px; }
      .al-cond input[type=number] { width: 120px; text-align: right; }
      .al-cond input[type=date] { width: 140px; }
      .al-cond select, .al-cond input { padding: 6px; border: 1.5px solid var(--gris-borde); border-radius: 6px; font: inherit; font-size: 13px; }
      .al-cond td { padding: 4px 6px; }
      .al-cond td.nro, .al-cond th.nro { text-align: right; }
      #modal .tabla tfoot td { font-weight: 700; background: #f3f5f9; }
      #modal .tabla td.nro, #modal .tabla th.nro { text-align: right; }`;
    document.head.appendChild(st);
  }

  return { mostrar, filtro, ordenar, cambiarMes, abrir, dato, sumarEquipo, sumarSinCondiciones, quitarEquipo, elegirCliente,
           guardar, guardarFact, anexarFactura, verArchivo, borrarFactura, compartirLiq, armarCertificado, exportar };
})();
