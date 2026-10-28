// ══════════════════════════════════════════════════════════════════
// ALQUILERES — dentro de "Certificado de máquinas" — Tecsul S.A.E.
//
// Listado de contratos de alquiler (tipo Flota): cliente con RUC, centro
// de costo 305AM… (la obra que eligen en el parte diario), condiciones por
// equipo (precio por hora, horas mínimas por mes, qué incluye), la
// liquidación del mes y las facturas anexadas (SQL 48).
//
// Si hay certificado de máquinas EMITIDO para el mes (cert_maq, mismo centro
// de costo, período que termina en el mes), el monto del mes es el del
// certificado (incluye viáticos y otras líneas); la liquidación por horas
// queda como referencia. Cada factura puede tener varios archivos con su
// tipo: factura, certificado firmado, remisión, otro (SQL 56: archivos jsonb).
//
// v20261028c: facturación en un solo paso. En la ficha, «Facturación del mes»
// muestra el monto a facturar (certificado emitido o liquidación); se carga
// N° de factura, fecha, monto (sugerido) y se anexan la factura y el
// certificado firmado. Al guardar queda FACTURADO en la tabla principal
// (alquiler_facturacion se completa sola con la suma de las facturas del mes).
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
  const TIPOS_ARCH = ['Factura', 'Certificado firmado', 'Remisión', 'Otro'];
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
    const [obras, contratos, equipos, clientes, liq, fact, facturas, certs, factTodos] = await Promise.all([
      sb.from('obras').select('clave, codigo, nombre, ubicacion, activa').order('nombre'),
      sb.from('alquiler_contratos').select('*').order('arrendatario'),
      sb.from('alquiler_equipos').select('*').order('id'),
      sb.from('clientes').select('*').order('nombre'),
      sb.from('v_alquiler_liquidacion').select('*').eq('mes', ini),
      sb.from('alquiler_facturacion').select('*').eq('mes', ini),
      sb.from('alquiler_facturas').select('*').order('fecha', { ascending: false }),
      // certificados de máquinas emitidos cuyo período termina en el mes
      sb.from('cert_maq').select('id, obra_clave, numero, desde, hasta, total_cert, total_cobrar, estado')
        .eq('estado', 'emitido').gte('hasta', ini).lte('hasta', fin),
      // facturación de todos los meses hasta el elegido (para el acumulado)
      sb.from('alquiler_facturacion').select('contrato_id, mes, monto_facturado_gs').lte('mes', ini),
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
      liq: liq.data, fact: Object.fromEntries(fact.data.map(f => [f.contrato_id, f])), facturas: facturas.data, partes,
      certs: certs.error ? [] : (certs.data || []), factTodos: factTodos.error ? [] : (factTodos.data || []) };
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
      const certs = c.obra_clave ? d.certs.filter(x => x.obra_clave === c.obra_clave) : [];
      const montoLiq = liq.reduce((s, r) => s + n(r.monto_gs), 0);
      const montoCert = certs.reduce((s, x) => s + n(x.total_cobrar), 0);
      // facturado: el monto facturado del mes; si no se cargó, la suma de las facturas anexadas de ese mes
      const facturadoMes = (mes) => {
        const fm = d.factTodos.find(x => x.contrato_id === c.id && String(x.mes).slice(0, 7) === mes);
        if (fm && fm.monto_facturado_gs !== null && fm.monto_facturado_gs !== undefined && fm.monto_facturado_gs !== '') return n(fm.monto_facturado_gs);
        return d.facturas.filter(x => x.contrato_id === c.id && String(x.mes || '').slice(0, 7) === mes).reduce((s, x) => s + n(x.monto_gs), 0);
      };
      const mesesFact = new Set(d.factTodos.filter(x => x.contrato_id === c.id).map(x => String(x.mes).slice(0, 7))
        .concat(d.facturas.filter(x => x.contrato_id === c.id && x.mes).map(x => String(x.mes).slice(0, 7))).filter(m => m <= A.mes));
      const facturado = facturadoMes(A.mes);
      const facturadoAcum = [...mesesFact].reduce((s, m) => s + facturadoMes(m), 0);
      return { tipo: 'contrato', id: c.id, c, eqs, liq, sinCond, obra: obraDe(c.obra_clave),
        cliente: k ? k.nombre : c.arrendatario, ruc: k ? k.ruc : c.ruc, certs, montoLiq, montoCert, facturado, facturadoAcum,
        horas: liq.reduce((s, r) => s + n(r.horas_trabajadas), 0), monto: certs.length ? montoCert : montoLiq,
        fact: d.fact[c.id], nFacturas: d.facturas.filter(f => f.contrato_id === c.id).length, estado: c.estado,
        sinCertFirmado: d.facturas.some(f => f.contrato_id === c.id && String(f.mes || '').slice(0, 7) === A.mes)
          && !d.facturas.some(f => f.contrato_id === c.id && String(f.mes || '').slice(0, 7) === A.mes && archivosDe(f).some(a => a.tipo === 'Certificado firmado')) };
    });
    d.obras.filter(o => es305(o) && o.activa && !conContrato.has(o.clave)).forEach(o => {
      const pm = partesDe(o.clave);
      l.push({ tipo: 'obra', id: 'o:' + o.clave, obra: o, c: null, eqs: [], liq: [], sinCond: Object.keys(pm), cliente: '', ruc: '',
        horas: Object.values(pm).reduce((s, e) => s + e.horas, 0), monto: 0, montoLiq: 0, montoCert: 0, facturado: 0, facturadoAcum: 0, certs: [], fact: null, nFacturas: 0, estado: 'Sin contrato' });
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
        <div class="filtro siempre"><label>Estado</label><select class="ms" onchange="Alquileres.filtro('estado', MS.valores(this))">
          ${[['En Vigencia', 'En vigencia'], ['Culminado', 'Culminados'], ['', 'Todos']].map(([v, t]) => `<option value="${v}" ${(v ? estados().includes(v) : !estados().length) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
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
      if (r.tipo === 'contrato' && estados().length && !estados().includes(r.estado)) return false;
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
    const aFacturar = (r) => r.liq.length || r.certs.length;
    const factur = contratos.filter(r => aFacturar(r) && (r.fact?.estado === 'FACTURADO'));
    const porFact = contratos.filter(r => aFacturar(r) && r.fact?.estado !== 'FACTURADO');
    const sinC = l.filter(r => r.tipo === 'obra').length;
    $('al-tarjetas').innerHTML = `<div class="tarjetas">
      <div class="tarjeta"><span class="n">${fmtNum(total / 1e6, 1)} M</span><span class="t">Gs a liquidar · ${mesLargo(A.mes)}</span></div>
      <div class="tarjeta"><span class="n">${contratos.length}</span><span class="t">Contratos</span></div>
      <div class="tarjeta bien"><span class="n">${factur.length}</span><span class="t">Facturados · ${fmtNum(contratos.reduce((s, r) => s + r.facturado, 0) / 1e6, 1)} M Gs</span></div>
      <div class="tarjeta medio"><span class="n">${porFact.length}</span><span class="t">Por facturar</span></div>
      ${sinC ? `<div class="tarjeta malo"><span class="n">${sinC}</span><span class="t">305AM sin contrato</span></div>` : ''}</div>`;
    $('al-info').textContent = `${l.length} fila${l.length === 1 ? '' : 's'} · tocá una para ver o editar`;
    const th = (k, t, cls = '') => `<th class="${o.col === k ? 'activo' : ''} ${cls}" onclick="Alquileres.ordenar('${k}')">${t}${o.col === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
    const chipFact = (r) => !r.liq.length && !r.certs.length ? '' : `<span class="chip ${r.fact?.estado === 'FACTURADO' ? 'verde' : r.fact?.estado === 'EN VERIFICACIÓN' ? 'azul' : 'amarillo'}">${esc(r.fact?.estado || 'PENDIENTE')}</span>`;
    $('al-lista').innerHTML = !l.length ? '<div class="empty-state">Nada coincide con los filtros.</div>' : `<div class="tabla-wrap"><table class="tabla al-t"><thead><tr>
        ${th('cliente', 'Cliente')}${th('obra', 'Centro de costo (obra del parte)')}<th>Equipos y condiciones</th>
        ${th('horas', 'Horas del mes', 'nro')}${th('monto', 'Monto del mes', 'nro')}${th('facturado', 'Monto facturado', 'nro')}${th('facturadoAcum', 'Facturado acumulado', 'nro')}<th>Facturación</th><th class="nro">Facturas</th>${th('estado', 'Estado')}</tr></thead><tbody>
      ${l.map((r, i) => `<tr onclick="Alquileres.abrir(${i})" class="${r.tipo === 'obra' ? 'al-sin' : ''}">
        <td><b>${esc(r.cliente || '—')}</b>${r.ruc ? `<div class="cambio">RUC ${esc(r.ruc)}</div>` : ''}</td>
        <td class="larga">${r.obra ? `${esc(r.obra.nombre)}<div class="cambio">${esc(r.obra.codigo)}</div>` : `<span class="chip amarillo">sin vincular</span> ${esc(r.c?.obra || '')}`}</td>
        <td>${r.eqs.map(e => `<span class="chip azul">${esc(e.equipo_id || e.equipo_texto)}${e.precio_hora_gs ? ' · ' + fmtNum(n(e.precio_hora_gs) / 1000) + ' mil/h' : ''}${n(e.horas_minimas_mes) ? ' · mín ' + fmtNum(e.horas_minimas_mes) + ' h' : ''}</span>`).join(' ')}
          ${r.sinCond.length ? `<span class="chip rojo" title="Tienen partes en esta obra pero no condiciones en el contrato">${r.sinCond.length} sin condiciones: ${esc(r.sinCond.slice(0, 4).join(', '))}${r.sinCond.length > 4 ? '…' : ''}</span>` : ''}</td>
        <td class="nro">${r.horas ? fmtNum(r.horas, 1) : ''}</td><td class="nro"><b>${r.monto ? gs(r.monto) : ''}</b>
          ${r.certs.length ? `<div class="cambio">certificado ${r.certs.map(x => 'N° ' + String(x.numero).padStart(2, '0')).join(', ')}</div>` : ''}
          ${r.certs.length && r.liq.length && Math.round(r.montoLiq) !== Math.round(r.montoCert) ? `<div class="cambio">por horas ${gs(r.montoLiq)}</div>` : ''}</td>
        <td class="nro">${r.facturado ? gs(r.facturado) : ''}${r.facturado && r.monto && Math.round(r.facturado) !== Math.round(r.monto) ? `<div class="cambio" style="color:var(--rojo)">${r.facturado > r.monto ? '+' : '−'}${gs(Math.abs(r.facturado - r.monto))} vs mes</div>` : ''}</td>
        <td class="nro">${r.facturadoAcum ? gs(r.facturadoAcum) : ''}</td>
        <td>${chipFact(r)}${r.fact?.nro_factura ? ` <span class="cambio">N° ${esc(r.fact.nro_factura)}</span>` : ''}${r.sinCertFirmado ? ' <span class="chip amarillo" title="La factura del mes no tiene el certificado firmado anexado">falta cert. firmado</span>' : ''}</td>
        <td class="nro">${r.nFacturas ? '📎 ' + r.nFacturas : ''}</td>
        <td><span class="chip ${r.estado === 'En Vigencia' ? 'verde' : r.estado === 'Sin contrato' ? 'rojo' : 'gris'}">${esc(r.estado)}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  // v20261027a: el estado admite varios (array); antes era un texto
  const estados = () => Array.isArray(A.estado) ? A.estado : (A.estado ? [A.estado] : []);
  let espera;
  function filtro(k, v) {
    A[k] = v;
    if (k === 'q') { clearTimeout(espera); espera = setTimeout(pintarLista, 200); return; }
    pintarLista();
  }
  function ordenar(col) { A.orden = { col, asc: A.orden.col === col ? !A.orden.asc : !['horas', 'monto', 'facturado', 'facturadoAcum'].includes(col) }; pintarLista(); }
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
    const certs = c.id && c.obra_clave ? d.certs.filter(x => x.obra_clave === c.obra_clave) : [];
    const totalCert = certs.reduce((s, x) => s + n(x.total_cobrar), 0);
    const montoMes = certs.length ? totalCert : totalLiq;   // lo que se factura del mes
    const delMes = facturas.filter(x => String(x.mes || '').slice(0, 7) === A.mes);
    const otrasF = facturas.filter(x => String(x.mes || '').slice(0, 7) !== A.mes);
    abrirModal(c.id ? `Alquiler · ${k.nombre || c.arrendatario}` : 'Nuevo contrato de alquiler', `
      ${c.id ? bloqueFacturacion({ c, certs, totalCert, liq, totalLiq, montoMes, delMes, fact, ed }) : ''}
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
          <tfoot><tr><td colspan="7">Total por horas (IVA incluido)</td><td class="nro">${gs(totalLiq)}</td></tr></tfoot></table></div>`}
        ${certs.length ? `<div class="al-cert">
            ${certs.map(x => `<div>📄 <b>Certificado N° ${String(x.numero).padStart(2, '0')}</b> emitido · ${fmtFecha(x.desde)} al ${fmtFecha(x.hasta)} · a cobrar <b>Gs ${gs(x.total_cobrar)}</b>
              <button class="btn-mini btn-neutro" onclick="Alquileres.verCertificado(${x.id})">Ver certificado</button></div>`).join('')}
            <div class="cambio">El monto del mes es el del certificado${certs.length > 1 ? ' (suma de los certificados)' : ''}: <b>Gs ${gs(totalCert)}</b>${liq.length && Math.round(totalCert) !== Math.round(totalLiq) ? ` — difiere de la liquidación por horas (Gs ${gs(totalLiq)}) por viáticos u otras líneas del certificado.` : '.'}</div></div>`
          : (liq.length && c.obra_clave ? '<div class="cambio" style="margin-top:6px">Todavía no hay certificado emitido para este mes: el monto es el de la liquidación por horas.</div>' : '')}
      </div>

      <div class="al-sec"><h4>Facturas de otros meses</h4>
        ${!otrasF.length ? '<div class="cambio">No hay facturas de otros meses.</div>' : `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          <th>Mes</th><th>N° factura</th><th>Fecha</th><th class="nro">Monto Gs</th><th>Archivos</th><th></th></tr></thead><tbody>
          ${otrasF.map(x => `<tr style="cursor:default"><td>${x.mes ? mesLargo(x.mes.slice(0, 7)) : ''}</td><td>${esc(x.nro_factura || '')}</td><td>${fmtFecha(x.fecha)}</td>
            <td class="nro">${x.monto_gs ? gs(x.monto_gs) : ''}</td>
            <td class="al-archs">${archivosDe(x).map((a, j) => `<div><a href="#" onclick="Alquileres.verArchivo(${x.id}, ${j});return false">📎 ${esc(a.nombre || 'ver')}</a>
                <span class="chip gris">${esc(a.tipo || 'Factura')}</span>${ed ? ` <button class="al-x" title="Quitar este archivo" onclick="Alquileres.quitarArchivo(${x.id}, ${j})">✕</button>` : ''}</div>`).join('')}
              ${ed ? `<div class="al-mas-arch" id="al-ma-${x.id}"><button class="btn-mini btn-neutro" onclick="Alquileres.formArchivo(${x.id})">+ Archivo</button></div>` : ''}</td>
            <td>${ed ? `<button class="btn-mini btn-rojo" onclick="Alquileres.borrarFactura(${x.id})">Borrar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}

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

  // ── Facturación del mes: un solo paso (v20261028c) ──
  const tieneTipo = (x, t) => archivosDe(x).some(a => (a.tipo || 'Factura') === t);
  function bloqueFacturacion({ c, certs, totalCert, liq, totalLiq, montoMes, delMes, fact, ed }) {
    const yaFact = delMes.reduce((s, x) => s + n(x.monto_gs), 0);
    const falta = Math.round(montoMes - yaFact);
    const editando = A.editFact ? delMes.find(x => x.id === A.editFact) : null;
    const origen = certs.length
      ? `Certificado ${certs.map(x => 'N° ' + String(x.numero).padStart(2, '0')).join(', ')} emitido`
      : liq.length ? 'Liquidación por horas (todavía no hay certificado emitido)' : '';
    const estado = delMes.length ? (falta > 0 ? 'PARCIAL' : 'FACTURADO') : (fact.estado && fact.estado !== 'FACTURADO' ? fact.estado : 'PENDIENTE');
    const color = estado === 'FACTURADO' ? 'verde' : estado === 'PARCIAL' ? 'azul' : 'amarillo';
    const lista = delMes.map(x => `<div class="al-fm-f">
        <div><b>Factura N° ${esc(x.nro_factura || '—')}</b> · ${fmtFecha(x.fecha) || 'sin fecha'} · <b>Gs ${gs(x.monto_gs)}</b>
          ${tieneTipo(x, 'Certificado firmado') ? '' : ' <span class="chip amarillo">falta certificado firmado</span>'}</div>
        <div class="al-archs">${archivosDe(x).map((a, j) => `<div><a href="#" onclick="Alquileres.verArchivo(${x.id}, ${j});return false">📎 ${esc(a.nombre || 'ver')}</a>
          <span class="chip gris">${esc(a.tipo || 'Factura')}</span>${ed ? ` <button class="al-x" title="Quitar este archivo" onclick="Alquileres.quitarArchivo(${x.id}, ${j})">✕</button>` : ''}</div>`).join('')}</div>
        ${ed ? `<div class="al-mas-arch" id="al-ma-${x.id}"><button class="btn-mini btn-neutro" onclick="Alquileres.formArchivo(${x.id})">+ Archivo</button>
          <button class="btn-mini btn-neutro" onclick="Alquileres.editarFactura(${x.id})">Editar</button>
          <button class="btn-mini btn-rojo" onclick="Alquileres.borrarFactura(${x.id})">Borrar</button></div>` : ''}</div>`).join('');
    const mostrarForm = ed && (editando || !delMes.length || A.otraFact);
    const sug = editando ? n(editando.monto_gs) : Math.max(falta, 0);
    const form = !mostrarForm ? (ed && falta > 0 ? `<button class="al-mas" onclick="Alquileres.otraFactura()">+ Otra factura de este mes (faltan Gs ${gs(falta)})</button>` : '') : `
      <div class="al-fm-form"><div class="al-fm-tit">${editando ? `Editar la factura N° ${esc(editando.nro_factura || '')}` : delMes.length ? 'Otra factura de este mes' : 'Cargar la factura'}</div>
      <div class="form-grid">
        <div class="field"><label for="af-nro">N° de factura</label><input type="text" id="af-nro" value="${esc(editando ? editando.nro_factura || '' : '')}" placeholder="001-001-0000000"></div>
        <div class="field"><label for="af-fecha">Fecha de la factura</label><input type="date" id="af-fecha" value="${editando ? editando.fecha || '' : new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label for="af-monto">Monto facturado (Gs)</label><input type="number" id="af-monto" value="${sug ? Math.round(sug) : ''}"></div>
        <div class="field ancho"><label for="af-arch">Factura (PDF o foto)${editando && tieneTipo(editando, 'Factura') ? ' — ya tiene, opcional' : ''}</label><input type="file" id="af-arch" accept="application/pdf,image/*" multiple></div>
        <div class="field ancho"><label for="af-cert">Certificado firmado (PDF o foto)${editando && tieneTipo(editando, 'Certificado firmado') ? ' — ya tiene, opcional' : ''}</label><input type="file" id="af-cert" accept="application/pdf,image/*" multiple></div>
      </div>
      <div class="acciones">${editando || delMes.length ? '<button class="btn-mini btn-neutro" onclick="Alquileres.cancelarFactura()">Cancelar</button>' : ''}
        <button class="btn-mini" style="background:var(--verde);color:#fff" onclick="Alquileres.guardarFactura()">${editando ? 'Guardar cambios' : 'Guardar y marcar facturado'}</button></div></div>`;
    return `<div class="al-sec al-fm"><div class="al-fm-cab"><h4>Facturación · ${mesLargo(A.mes)}</h4><span class="chip ${color}">${estado}</span></div>
      <div class="al-fm-monto"><div><span class="cambio">A facturar</span><b>${montoMes ? 'Gs ' + gs(montoMes) : '—'}</b><span class="cambio">${esc(origen)}</span></div>
        ${delMes.length ? `<div><span class="cambio">Facturado</span><b>Gs ${gs(yaFact)}</b>${falta && montoMes ? `<span class="cambio" style="color:${falta > 0 ? 'var(--rojo)' : 'inherit'}">${falta > 0 ? 'faltan' : 'de más'} Gs ${gs(Math.abs(falta))}</span>` : '<span class="cambio">completo</span>'}</div>` : ''}
        <div class="al-fm-bot">${certs.length ? certs.map(x => `<button class="btn-mini btn-neutro" onclick="Alquileres.verCertificado(${x.id})">Ver certificado N° ${String(x.numero).padStart(2, '0')}</button>`).join(' ')
          : (c.obra_clave && ed ? '<button class="btn-mini btn-neutro" onclick="Alquileres.armarCertificado()">1. Armar certificado</button>' : '')}
          <button class="btn-mini btn-neutro" onclick="Alquileres.compartirLiq()">Compartir liquidación</button></div></div>
      ${!certs.length && liq.length && c.obra_clave ? '<div class="cambio" style="margin:4px 0 6px">Primero armá y emití el certificado del mes; el monto a facturar pasa a ser el del certificado.</div>' : ''}
      ${lista}${form}</div>`;
  }
  function editarFactura(id) { A.editFact = id; A.otraFact = false; reabrir(A.ficha.c.id); }
  function otraFactura() { A.otraFact = true; A.editFact = null; reabrir(A.ficha.c.id); }
  function cancelarFactura() { A.otraFact = false; A.editFact = null; reabrir(A.ficha.c.id); }
  // Deja alquiler_facturacion del mes igual a la suma de las facturas anexadas
  async function sincronizarMes(contratoId, mes) {
    const { data, error } = await sb.from('alquiler_facturas').select('nro_factura, monto_gs').eq('contrato_id', contratoId).eq('mes', mes + '-01');
    if (error) throw error;
    const l = data || [];
    const fila = l.length
      ? { estado: 'FACTURADO', nro_factura: l.map(x => x.nro_factura).filter(Boolean).join(' / ') || null, monto_facturado_gs: l.reduce((s, x) => s + n(x.monto_gs), 0) }
      : { estado: 'PENDIENTE', nro_factura: null, monto_facturado_gs: null };
    const r = await sb.from('alquiler_facturacion').upsert(Object.assign({ contrato_id: contratoId, mes: mes + '-01', actualizado_en: new Date().toISOString() }, fila),
      { onConflict: 'contrato_id,mes' });
    if (r.error) throw r.error;
  }
  async function guardarFactura() {
    const c = A.ficha.c, mes = A.mes;
    const editando = A.editFact ? A.datos.facturas.find(x => x.id === A.editFact) : null;
    const nro = $('af-nro').value.trim(), fecha = $('af-fecha').value, monto = $('af-monto').value;
    const fact = [...($('af-arch').files || [])], cert = [...($('af-cert').files || [])];
    if (!nro) return toast('Poné el número de factura', 'warning');
    if (!fecha) return toast('Poné la fecha de la factura', 'warning');
    if (!monto || Number(monto) <= 0) return toast('Poné el monto facturado', 'warning');
    if (!fact.length && !(editando && tieneTipo(editando, 'Factura'))) return toast('Anexá la factura (PDF o foto)', 'warning');
    mostrarCarga('Guardando la factura…');
    let nuevos = [];
    try {
      nuevos = (await subir(c.id, mes, nro, fact, 'Factura')).concat(await subir(c.id, mes, nro, cert, 'Certificado firmado'));
      const archivos = (editando ? archivosDe(editando) : []).concat(nuevos);
      const fila = { contrato_id: c.id, mes: mes + '-01', nro_factura: nro, fecha, monto_gs: Number(monto), archivos,
        archivo: archivos[0] ? archivos[0].ruta : null, archivo_nombre: archivos[0] ? archivos[0].nombre : null };
      const r = editando ? await sb.from('alquiler_facturas').update(fila).eq('id', editando.id) : await sb.from('alquiler_facturas').insert(fila);
      if (r.error) throw FALTA_56(r.error);
      await sincronizarMes(c.id, mes);
      ocultarCarga();
      toast(cert.length || (editando && tieneTipo(editando, 'Certificado firmado')) ? 'Factura guardada: el mes queda facturado'
        : 'Factura guardada (falta anexar el certificado firmado)', cert.length ? 'success' : 'warning');
      A.editFact = null; A.otraFact = false;
      await cargar(); pintarLista(); reabrir(c.id);
    } catch (e) {
      if (nuevos.length) await sb.storage.from(BUCKET).remove(nuevos.map(a => a.ruta));
      ocultarCarga(); toast('No se pudo guardar: ' + e.message, 'error');
    }
  }

  function reabrir(id) {
    const r = filas().find(x => x.tipo === 'contrato' && x.id === id);
    if (!r) return cerrarModal();
    A.visibles = [r, ...A.visibles.filter(x => x.id !== id)];
    abrir(0);
  }

  // archivos de una factura: lista nueva (SQL 56) o el archivo único de antes
  function archivosDe(x) {
    if (Array.isArray(x.archivos) && x.archivos.length) return x.archivos;
    return x.archivo ? [{ ruta: x.archivo, nombre: x.archivo_nombre, tipo: 'Factura' }] : [];
  }
  const FALTA_56 = (e) => /archivos/.test(e.message || '') ? new Error('Falta correr 56_alquiler_facturas_archivos.sql en Supabase para anexar varios archivos.') : e;
  async function subir(contratoId, mes, nro, files, tipo) {
    const out = [];
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
      const ruta = `${contratoId}/${(mes || 'sin-mes')}_${(nro || 'factura').replace(/[^\w-]/g, '_')}_${tipo.replace(/[^\w]/g, '').toLowerCase()}_${Date.now()}_${out.length}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(ruta, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) throw error;
      out.push({ ruta, nombre: file.name, tipo, subido_en: new Date().toISOString() });
    }
    return out;
  }

  // sumar archivos a una factura ya anexada
  function formArchivo(id) {
    const box = $('al-ma-' + id);
    if (!box) return;
    box.innerHTML = `<div class="al-otros"><select id="al-mt-${id}">${TIPOS_ARCH.map(t => `<option ${t === 'Certificado firmado' ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="file" id="al-mf-${id}" accept="application/pdf,image/*" multiple>
      <button class="btn-mini" style="background:var(--azul-medio);color:#fff" onclick="Alquileres.sumarArchivos(${id})">Subir</button></div>`;
  }
  async function sumarArchivos(id) {
    const x = A.datos.facturas.find(f => f.id === id);
    const files = [...($('al-mf-' + id).files || [])];
    if (!x || !files.length) return toast('Elegí uno o más archivos', 'warning');
    mostrarCarga('Subiendo archivos…');
    try {
      const nuevos = await subir(x.contrato_id, x.mes ? x.mes.slice(0, 7) : '', x.nro_factura, files, $('al-mt-' + id).value || 'Otro');
      const { error } = await sb.from('alquiler_facturas').update({ archivos: archivosDe(x).concat(nuevos) }).eq('id', id);
      if (error) { await sb.storage.from(BUCKET).remove(nuevos.map(a => a.ruta)); throw FALTA_56(error); }
      ocultarCarga(); toast('Archivos agregados', 'success');
      await cargar(); pintarLista(); reabrir(x.contrato_id);
    } catch (e) { ocultarCarga(); toast('No se pudo subir: ' + e.message, 'error'); }
  }
  async function quitarArchivo(id, j) {
    const x = A.datos.facturas.find(f => f.id === id);
    const l = x ? archivosDe(x) : [];
    const a = l[j];
    if (!a || !confirm(`¿Quitar el archivo «${a.nombre || ''}»?`)) return;
    const resto = l.filter((_, k) => k !== j);
    const { error } = await sb.from('alquiler_facturas').update({ archivos: resto,
      archivo: resto[0] ? resto[0].ruta : null, archivo_nombre: resto[0] ? resto[0].nombre : null }).eq('id', id);
    if (error) return toast(FALTA_56(error).message, 'error');
    await sb.storage.from(BUCKET).remove([a.ruta]);
    toast('Archivo quitado', 'success');
    await cargar(); pintarLista(); reabrir(x.contrato_id);
  }
  async function verArchivo(id, j) {
    const x = A.datos.facturas.find(f => f.id === id);
    const a = x ? archivosDe(x)[j || 0] : null;
    if (!a || !a.ruta) return;
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.ruta, 600);
    if (error) { if (w) w.close(); return toast('No se pudo abrir: ' + error.message, 'error'); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  }
  async function borrarFactura(id) {
    const x = A.datos.facturas.find(f => f.id === id);
    if (!x || !confirm(`¿Borrar la factura ${x.nro_factura || ''} y sus archivos?`)) return;
    const rutas = archivosDe(x).map(a => a.ruta).filter(Boolean);
    if (rutas.length) await sb.storage.from(BUCKET).remove(rutas);
    const { error } = await sb.from('alquiler_facturas').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    if (x.mes) { try { await sincronizarMes(x.contrato_id, x.mes.slice(0, 7)); } catch (e) { toast(e.message, 'error'); } }
    A.editFact = null;
    toast('Factura borrada', 'success');
    await cargar(); pintarLista(); reabrir(x.contrato_id);
  }
  function verCertificado(id) {
    cerrarModal();
    Certificado.vista('certs');
    // esperar a que se dibuje la lista de certificados (si no, la lista tapa al certificado)
    let t = 0;
    const esperar = () => { if (document.getElementById('cm-obra') || t++ > 50) { if (window.CertMaq) CertMaq.abrir(id); } else setTimeout(esperar, 100); };
    setTimeout(esperar, 100);
  }

  function compartirLiq() {
    const c = A.ficha.c, k = A.ficha.cliente;
    const l = A.datos.liq.filter(x => x.contrato_id === c.id);
    const sub = l.reduce((s, x) => s + n(x.monto_gs), 0);
    compartir(`*Liquidación ${mesLargo(A.mes)} – ${k.nombre || c.arrendatario}*${k.ruc ? ' (RUC ' + k.ruc + ')' : ''}\n${(obraDe(c.obra_clave) || {}).nombre || c.obra || ''}\n`
      + l.map(x => `• ${x.equipo_id || x.equipo_texto}: ${fmtNum(x.horas_facturables, 1)} h${n(x.horas_trabajadas) < n(x.horas_minimas) ? ' (mínimo)' : ''} × Gs ${gs(x.precio_hora_gs)} = Gs ${gs(x.monto_gs)}`).join('\n')
      + `\n*Total por horas: Gs ${gs(sub)}* (IVA incluido)`
      + (() => { const cs = c.obra_clave ? A.datos.certs.filter(x => x.obra_clave === c.obra_clave) : []; const tc = cs.reduce((s, x) => s + n(x.total_cobrar), 0);
          return cs.length ? `\n*Certificado ${cs.map(x => 'N° ' + String(x.numero).padStart(2, '0')).join(', ')}: Gs ${gs(tc)}* (a cobrar, IVA incluido)` : ''; })());
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
      ['Cliente', 'RUC', 'Centro de costo', 'Código', 'Estado', 'Equipo', 'Precio/h Gs', 'Horas mínimas/mes', 'Días', 'Partes', 'Horas', 'Mínimo', 'A cobrar', 'Monto Gs', 'Monto certificado Gs', 'Facturación', 'N° factura', 'Monto facturado Gs', 'Facturado acumulado Gs']];
    l.forEach(r => {
      const base = [r.cliente, r.ruc || '', r.obra?.nombre || r.c?.obra || '', r.obra?.codigo || '', r.estado];
      if (!r.eqs.length) { aoa.push([...base, r.sinCond.join(', ')]); return; }
      r.eqs.forEach(e => {
        const x = r.liq.find(y => y.alquiler_equipo_id === e.id) || {};
        aoa.push([...base, e.equipo_id || e.equipo_texto, n(e.precio_hora_gs) || '', n(e.horas_minimas_mes) || '', x.dias_alquilado ?? '', x.partes ?? '',
          x.horas_trabajadas ?? '', x.horas_minimas ?? '', x.horas_facturables ?? '', x.monto_gs ?? '', r.certs.length ? r.montoCert : '',
          r.fact?.estado || (r.liq.length || r.certs.length ? 'PENDIENTE' : ''), r.fact?.nro_factura || '', r.facturado || '', r.facturadoAcum || '']);
      });
    });
    if (!window.XLSX) {
      await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
        .catch(() => toast('No se pudo cargar el generador de Excel', 'error'));
      if (!window.XLSX) return;
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [34, 12, 44, 12, 12, 10, 12, 12, 6, 7, 9, 9, 9, 14, 16, 14, 16, 16, 18].map(wch => ({ wch }));
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
      .al-sec h4 { margin: 0 0 8px; color: var(--azul-oscuro); font-size: calc(14.5px*var(--fs,1)); }
      .al-cond input[type=number] { width: 120px; text-align: right; }
      .al-cond input[type=date] { width: 140px; }
      .al-cond select, .al-cond input { padding: 6px; border: 1.5px solid var(--gris-borde); border-radius: 6px; font: inherit; font-size: calc(13px*var(--fs,1)); }
      .al-cond td { padding: 4px 6px; }
      .al-cond td.nro, .al-cond th.nro { text-align: right; }
      #modal .tabla tfoot td { font-weight: 700; background: #f3f5f9; }
      #modal .tabla td.nro, #modal .tabla th.nro { text-align: right; }
      .al-cert { margin-top: 8px; padding: 8px 10px; background: #eef7f1; border: 1px solid #cfe8d8; border-radius: 8px; font-size: calc(13px*var(--fs,1)); }
      .al-cert > div { margin: 2px 0; }
      .al-archs > div { margin: 2px 0; white-space: nowrap; }
      .al-archs .chip { font-size: calc(10.5px*var(--fs,1)); }
      .al-x { border: 0; background: none; color: var(--rojo); cursor: pointer; font-weight: 700; }
      .al-otros { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .al-otros select { padding: 6px; border: 1.5px solid var(--gris-borde); border-radius: 6px; font: inherit; font-size: calc(13px*var(--fs,1)); }
      .al-mas-arch { margin-top: 4px; }
      .al-fm { background: #f6f9fd; border: 1px solid #dbe4f0; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
      .al-fm-cab { display: flex; align-items: center; gap: 10px; }
      .al-fm-cab h4 { margin: 0; }
      .al-fm-monto { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; margin: 10px 0; }
      .al-fm-monto > div { display: flex; flex-direction: column; }
      .al-fm-monto b { font-size: calc(20px*var(--fs,1)); color: var(--azul-oscuro); }
      .al-fm-bot { flex-direction: row !important; gap: 6px; margin-left: auto; flex-wrap: wrap; }
      .al-fm-f { background: #fff; border: 1px solid #e3e8ef; border-radius: 8px; padding: 8px 10px; margin: 6px 0; }
      .al-fm-form { background: #fff; border: 1px solid #e3e8ef; border-radius: 8px; padding: 10px; margin-top: 8px; }
      .al-fm-tit { font-weight: 700; margin-bottom: 6px; color: var(--azul-oscuro); }`;
    document.head.appendChild(st);
  }

  return { mostrar, filtro, ordenar, cambiarMes, abrir: (i) => { A.editFact = null; A.otraFact = false; abrir(i); }, dato, sumarEquipo, sumarSinCondiciones, quitarEquipo, elegirCliente,
           guardar, guardarFactura, editarFactura, otraFactura, cancelarFactura, formArchivo, sumarArchivos, quitarArchivo, verArchivo, borrarFactura, verCertificado,
           compartirLiq, armarCertificado, exportar };
})();
