// ══════════════════════════════════════════════════════════════════
// CERTIFICADOS DE MAQUINARIAS (formales, numerados) — Tecsul S.A.E.
//
// Formato único basado en "Formato de Certificados.xlsx": todas las
// columnas de las tres hojas (Estándar, Horas mínimas, Volumen mínimo)
// y plantillas que solo prenden o apagan columnas. Además cada columna
// se puede incluir o excluir a mano. Lo que se ve en pantalla es lo que
// sale en Excel y en la impresión.
//
// · Se guarda en cert_maq (SQL 45), numerado por obra.
// · El "anterior" de cada línea es el acumulado del certificado previo
//   de la misma obra (se puede corregir a mano, ej. el primero).
// · Se arma con los partes del período (horas, días, m³ de hormigón,
//   toneladas), el gasoil despachado y el maestro de tarifas.
//
// Vive en flota.html y usa sus utilidades ($, esc, fmtFecha, fmtNum,
// abrirModal, cerrarModal, toast, mostrarCarga, ocultarCarga, sb,
// sesion, flota). Lee: admin_central y gerente. Edita: admin_central.
// ══════════════════════════════════════════════════════════════════
window.CertMaq = (() => {
  const EXCELJS = '../exceljs.min.js';
  const LOGO = './logo_tecsul.png';

  // ── Columnas ────────────────────────────────────────────────────
  // tipo: auto (n° de ítem) · txt · num (se carga) · calc (se calcula)
  //       · numcalc (se calcula, pero se puede pisar a mano)
  // f: formato — q (cantidad, 2 dec) · gs (guaraníes) · d (días)
  const COLS = [
    { k: 'item',            t: 'Ítem',                  tipo: 'auto', w: 5 },
    { k: 'descripcion',     t: 'Descripción',           tipo: 'txt',  w: 34 },
    { k: 'codigo',          t: 'Código',                tipo: 'txt',  w: 10 },
    { k: 'unidad',          t: 'Unidad',                tipo: 'txt',  w: 7 },
    { k: 'minimo_mes',      t: 'Mínimo establecido',    tipo: 'num',  f: 'q',  w: 11, g: 'MÍNIMO ESTABLECIDO' },
    { k: 'dias_mes',        t: 'Días considerados',     tipo: 'num',  f: 'd',  w: 9,  g: 'MÍNIMO ESTABLECIDO' },
    { k: 'dias_reparacion', t: 'Días en reparación',    tipo: 'num',  f: 'd',  w: 10 },
    { k: 'dias_tenencia',   t: 'Días de tenencia',      tipo: 'num',  f: 'd',  w: 9 },
    { k: 'pct_operativo',   t: '% días operativos',     tipo: 'calc', f: 'pct', w: 9 },
    { k: 'trabajado',       t: 'Cantidad trabajada',    tipo: 'num',  f: 'q',  w: 11 },
    { k: 'minimo',          t: 'Mínimo del período',    tipo: 'numcalc', f: 'q', w: 11 },
    { k: 'a_certificar',    t: 'A certificar',          tipo: 'numcalc', f: 'q', w: 11 },
    { k: 'precio',          t: 'Precio unitario',       tipo: 'num',  f: 'gs', w: 13 },
    { k: 'precio_total',    t: 'Precio total',          tipo: 'calc', f: 'gs', w: 14 },
    { k: 'litros',          t: 'Litros',                tipo: 'num',  f: 'q',  w: 9,  g: 'COMBUSTIBLE' },
    { k: 'precio_litro',    t: 'Gs/lt',                 tipo: 'num',  f: 'gs', w: 9,  g: 'COMBUSTIBLE' },
    { k: 'total_comb',      t: 'Total Gs',              tipo: 'calc', f: 'gs', w: 12, g: 'COMBUSTIBLE' },
    { k: 'cant_anterior',   t: 'Cantidad anterior',     tipo: 'num',  f: 'q',  w: 11, g: 'CANTIDAD CERTIFICADA' },
    { k: 'cant_actual',     t: 'Cantidad actual',       tipo: 'calc', f: 'q',  w: 11, g: 'CANTIDAD CERTIFICADA' },
    { k: 'cant_acum',       t: 'Cantidad total acumulada', tipo: 'calc', f: 'q', w: 12, g: 'CANTIDAD CERTIFICADA' },
    { k: 'monto_anterior',  t: 'Monto anterior',        tipo: 'num',  f: 'gs', w: 15, g: 'MONTO CERTIFICADO EN GS.' },
    { k: 'monto_actual',    t: 'Monto actual',          tipo: 'calc', f: 'gs', w: 15, g: 'MONTO CERTIFICADO EN GS.' },
    { k: 'monto_acum',      t: 'Monto total acumulado', tipo: 'calc', f: 'gs', w: 16, g: 'MONTO CERTIFICADO EN GS.' },
  ];
  const COL = Object.fromEntries(COLS.map(c => [c.k, c]));
  const SUMAN = ['litros', 'total_comb', 'precio_total', 'cant_anterior', 'cant_actual', 'cant_acum', 'monto_anterior', 'monto_actual', 'monto_acum'];

  const BASE = ['item', 'descripcion', 'codigo', 'unidad'];
  const CANT = ['cant_anterior', 'cant_actual', 'cant_acum', 'monto_anterior', 'monto_actual', 'monto_acum'];
  const PLANTILLAS = {
    estandar: {
      t: 'Estándar', cols: [...BASE, 'trabajado', 'precio', 'precio_total', ...CANT], op: { diario_litros: true, diario_operativo: true },
      et: { trabajado: 'Cantidad' },
    },
    horas_minimas: {
      t: 'Horas mínimas', cols: [...BASE, 'minimo_mes', 'dias_reparacion', 'pct_operativo', 'trabajado', 'minimo', 'a_certificar', 'precio', 'precio_total', ...CANT],
      op: { ajuste_operativo: true, diario_litros: true, diario_operativo: true },
      et: { minimo_mes: 'Horas mínimas / mes', dias_reparacion: 'Días inoperativo', trabajado: 'Horas trabajadas', minimo: 'Horas mínimas del período',
            a_certificar: 'Horas a certificar', precio_total: 'Precio total a certificar' },
    },
    volumen_minimo: {
      t: 'Volumen mínimo', cols: [...BASE, 'minimo_mes', 'dias_mes', 'dias_reparacion', 'dias_tenencia', 'minimo', 'trabajado', 'a_certificar',
        'precio', 'litros', 'precio_litro', 'total_comb', ...CANT], op: { calc_aux: true, desc_comb: true, ajuste_operativo: true, diario_litros: true, diario_operativo: true },
      et: { descripcion: 'Equipo', minimo_mes: 'Cant. mínima', dias_mes: 'Días', minimo: 'Volumen del mes mínimo',
            trabajado: 'Volumen del mes producido', a_certificar: 'Cantidad a certificar' },
    },
  };
  const UNIDADES = ['HM', 'HS', 'M3', 'TN', 'KM', 'DIAS', 'MES', 'UN', 'VIAJE', 'GL'];

  const C = { obras: null, contratos: null, lista: null, obra: '', cert: null, sucio: false, partes: null };

  // ── Utilidades ──────────────────────────────────────────────────
  const n = (v) => v === null || v === undefined || v === '' || isNaN(v) ? 0 : Number(v);
  const r2 = (v) => Math.round(n(v) * 100) / 100;
  const hoy = () => new Date().toISOString().slice(0, 10);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const unDe = (codigo) => /^[0-9A-Za-z]{5}/.test(codigo || '') ? String(codigo).slice(0, 5).toUpperCase() + '00000' : null;
  const puedeEditar = () => sesion && sesion.rol === 'admin_central';
  const editable = () => puedeEditar() && C.cert && C.cert.estado === 'borrador';
  const nro2 = (v) => String(v).padStart(2, '0');

  function fmt(v, f) {
    if (v === null || v === undefined || v === '') return '';
    if (f === 'gs') return fmtNum(Math.round(n(v)));
    if (f === 'd') return fmtNum(n(v), 1);
    if (f === 'pct') return fmtNum(n(v) * 100, 1) + ' %';
    return fmtNum(n(v), 2);
  }
  // Número escrito de cualquier forma: 1.250.000 · 9,2 · 250000 · 9.5
  function leer(v) {
    if (v === null || v === undefined) return null;
    let s = String(v).trim().replace(/\s/g, '').replace(/^Gs\.?/i, '');
    if (s === '') return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const x = Number(s);
    return isNaN(x) ? null : x;
  }
  const etiqueta = (k, cert) => ((PLANTILLAS[cert.plantilla] || {}).et || {})[k] || COL[k].t;
  const visibles = (cert) => COLS.filter(c => (cert.columnas || []).includes(c.k));

  // ── Cálculo de una línea ────────────────────────────────────────
  // El mínimo solo se aplica si la columna "mínimo del período" está
  // incluida en el certificado.
  function calc(it, cert) {
    const mm = n(it.minimo_mes), dm = n(it.dias_mes), dr = n(it.dias_reparacion);
    const dt = it.dias_tenencia === null || it.dias_tenencia === undefined || it.dias_tenencia === '' ? dm : n(it.dias_tenencia);
    const minAuto = r2(dm > 0 ? mm * (dt / dm) * ((dm - dr) / dm) : mm);
    const minimo = it.minimo_manual ? r2(it.minimo_valor) : minAuto;
    const pct = dm > 0 ? Math.max(0, (dm - dr) / dm) : 1;
    const aplicaMin = (cert.columnas || []).includes('minimo');
    const auto = r2(aplicaMin ? Math.max(n(it.trabajado), minimo) : n(it.trabajado));
    const acert = it.a_cert_manual ? r2(it.a_certificar) : auto;
    const total = Math.round(acert * n(it.precio));
    return {
      minimo, minAuto, pct_operativo: pct, auto, a_certificar: acert, precio_total: total,
      total_comb: Math.round(n(it.litros) * n(it.precio_litro)),
      cant_actual: acert, cant_acum: r2(n(it.cant_anterior) + acert),
      monto_actual: total, monto_acum: Math.round(n(it.monto_anterior) + total),
    };
  }
  function valor(it, k, cert, i) {
    if (k === 'item') return i + 1;
    const c = COL[k];
    if (c.tipo === 'calc' || c.tipo === 'numcalc') return calc(it, cert)[k];
    return it[k];
  }
  // Las cantidades certificadas solo se suman en horas máquina (no se mezclan HM con UN, M3, etc.);
  // los montos en Gs se suman siempre.
  const CANT_HM = ['cant_anterior', 'cant_actual', 'cant_acum'];
  const esHM = (it) => String(it.unidad || '').trim().toUpperCase() === 'HM';
  const ETQ_ACUM = 'ACUMULADOS · cantidades en HM';
  function totales(cert) {
    const t = Object.fromEntries(SUMAN.map(k => [k, 0]));
    cert.items.forEach((it, i) => SUMAN.forEach(k => { if (CANT_HM.includes(k) && !esHM(it)) return; t[k] += n(valor(it, k, cert, i)); }));
    SUMAN.forEach(k => { t[k] = COL[k].f === 'gs' ? Math.round(t[k]) : r2(t[k]); });
    const desc = descuentos(cert, t);
    const totalDesc = Math.round(desc.reduce((s, d) => s + n(d.monto), 0));
    return Object.assign(t, { cert: t.monto_actual, desc, totalDesc, cobrar: t.monto_actual - totalDesc });
  }
  // Descuentos cargados + la provisión de combustible (si está marcada)
  function descuentos(cert, t) {
    const l = (cert.descuentos || []).map(d => ({ texto: d.texto, monto: n(d.monto) }));
    if ((cert.opciones || {}).desc_comb && t.total_comb) {
      const eqs = cert.items.filter(it => n(it.litros) && n(it.precio_litro)).map(it => it.codigo).filter(Boolean);
      l.unshift({ texto: 'Provisión de combustible' + (eqs.length ? ' ' + eqs.join(', ') : ''), monto: t.total_comb, auto: true });
    }
    return l;
  }

  // ── Número en letras (guaraníes) ────────────────────────────────
  function enLetras(num) {
    num = Math.round(Math.abs(n(num)));
    if (num === 0) return 'cero';
    const U = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce',
      'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro',
      'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    // "un"/"veintiún" delante de mil y millones; "uno"/"veintiuno" al final
    const menorMil = (x, final) => {
      if (x === 100) return 'cien';
      const c = Math.floor(x / 100), r = x % 100;
      let s = CEN[c];
      const u = (k) => final && k === 1 ? 'uno' : final && k === 21 ? 'veintiuno' : U[k];
      if (r) s += (s ? ' ' : '') + (r < 30 ? u(r) : D[Math.floor(r / 10)] + (r % 10 ? ' y ' + u(r % 10) : ''));
      return s;
    };
    const partes = [];
    const milesDeMillon = Math.floor(num / 1e9), millones = Math.floor((num % 1e9) / 1e6), miles = Math.floor((num % 1e6) / 1e3), resto = num % 1e3;
    if (milesDeMillon) partes.push((milesDeMillon === 1 ? 'mil' : menorMil(milesDeMillon) + ' mil') + (millones ? '' : ' millones'));
    if (millones) partes.push(millones === 1 && !milesDeMillon ? 'un millón' : menorMil(millones) + ' millones');
    if (miles) partes.push(miles === 1 ? 'mil' : menorMil(miles) + ' mil');
    if (resto) partes.push(menorMil(resto, true));
    const s = partes.join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ════════════════════════════════════════════════════════════════
  // DATOS
  // ════════════════════════════════════════════════════════════════
  async function cargarBase() {
    if (!C.obras) {
      const { data, error } = await sb.from('obras').select('clave, codigo, nombre, ubicacion, activa').order('nombre');
      if (error) throw error;
      C.obras = data;
    }
    if (!C.contratos) {
      const { data } = await sb.from('alquiler_contratos').select('id, arrendatario, ruc, obra, obra_clave, ubicacion, estado, cliente_id').order('arrendatario');
      C.contratos = data || [];
      const { data: k } = await sb.from('clientes').select('id, nombre, ruc');
      C.clientes = k || [];
    }
  }
  const obrasSel = () => C.obrasFiltro || (C.obra ? [C.obra] : []);
  const obraDe = (clave) => (C.obras || []).find(o => o.clave === clave) || { clave, nombre: clave, codigo: '' };

  async function cargarLista() {
    let q = sb.from('cert_maq').select('id, obra_clave, numero, desde, hasta, plantilla, cliente, total_cert, total_cobrar, estado, actualizado_en')
      .order('hasta', { ascending: false }).order('numero', { ascending: false }).limit(500);
    if (obrasSel().length) q = q.in('obra_clave', obrasSel());
    const { data, error } = await q;
    if (error) throw error;
    C.lista = data;
    // Facturación del mes (la que se carga en Alquileres) para cada certificado
    C.factMes = {};
    const { data: f } = await sb.from('alquiler_facturacion').select('contrato_id, mes, estado, nro_factura, monto_facturado_gs');
    (f || []).forEach(x => { C.factMes[x.contrato_id + '|' + String(x.mes).slice(0, 7)] = x; });
  }
  // Contrato de alquiler del certificado (por centro de costo) y su facturación del mes del período
  function factDe(c) {
    const ct = (C.contratos || []).find(k => k.obra_clave === c.obra_clave && k.estado === 'En Vigencia') || (C.contratos || []).find(k => k.obra_clave === c.obra_clave);
    if (!ct) return null;
    return (C.factMes || {})[ct.id + '|' + String(c.hasta || c.desde || '').slice(0, 7)] || { estado: 'PENDIENTE' };
  }
  function chipFact(c) {
    const f = factDe(c);
    if (!f || c.estado === 'anulado') return '';
    const col = f.estado === 'FACTURADO' ? 'verde' : f.estado === 'EN VERIFICACIÓN' ? 'azul' : 'amarillo';
    return `<span class="chip ${col}">${esc(f.estado)}</span>${f.nro_factura ? `<div class="cambio">N° ${esc(f.nro_factura)}</div>` : ''}`
      + (f.monto_facturado_gs && Math.round(n(f.monto_facturado_gs)) !== Math.round(n(c.total_cobrar)) ? `<div class="cambio" style="color:var(--rojo)">facturado ${fmt(f.monto_facturado_gs, 'gs')}</div>` : '');
  }

  // Lo que dicen los partes del período para la obra, por equipo
  async function traerPartes(obraClave, desde, hasta) {
    const obra = obraDe(obraClave);
    const un = unDe(obra.codigo);
    const [rpc, partes, comb] = await Promise.all([
      sb.rpc('certificado_maquinas', { p_desde: desde, p_hasta: hasta, p_obra: obraClave }),
      todas(() => sb.from('partes').select('fecha, equipo_id, horometro_inicial, horometro_final, horas_horometro, horas_horometro_reportada, m3_hormigon, toneladas_asfalto, piedras_trituradas, tiene_falla, falla_impidio_trabajo')
        .eq('obra_clave', obraClave).gte('fecha', desde).lte('fecha', hasta).order('fecha')),
      todas(() => sb.from('combustible_movimientos').select('equipo_id, litros, fecha')
        .eq('obra_clave', obraClave).eq('actividad', 'Despacho de combustible').gte('fecha', desde).lte('fecha', hasta)).catch(() => []),
    ]);
    if (rpc.error) throw rpc.error;
    const eq = {};
    const de = (id) => eq[id] || (eq[id] = { equipo_id: id, horas: 0, dias: new Set(), m3: 0, tn: 0, litros: 0, tarifa: null, minimo_hr: 0, descripcion: '', dia: {}, inop: [] });
    const diaDe = (e, f) => e.dia[f] || (e.dia[f] = { fecha: f, ini: null, fin: null, horas: 0, m3: 0, litros: 0, falla: false, partes: 0 });
    (rpc.data || []).forEach(r => { const e = de(r.equipo_id); e.tarifa = r.tarifa_max === null ? null : n(r.tarifa_max); e.descripcion = r.descripcion || ''; });
    partes.forEach(p => {
      const e = de(p.equipo_id);
      const h = n(p.horas_horometro ?? p.horas_horometro_reportada);
      e.horas += h; e.dias.add(p.fecha); e.m3 += n(p.m3_hormigon); e.tn += n(p.toneladas_asfalto) + n(p.piedras_trituradas);
      const d = diaDe(e, p.fecha);
      if (p.horometro_inicial !== null && (d.ini === null || n(p.horometro_inicial) < n(d.ini))) d.ini = p.horometro_inicial;
      if (p.horometro_final !== null && (d.fin === null || n(p.horometro_final) > n(d.fin))) d.fin = p.horometro_final;
      d.horas = r2(d.horas + h); d.m3 = r2(d.m3 + n(p.m3_hormigon)); d.partes++;
      if (String(p.falla_impidio_trabajo || '').toUpperCase() === 'SI') d.falla = true;
    });
    comb.forEach(m => {
      if (!m.equipo_id) return;
      const e = de(m.equipo_id); e.litros += n(m.litros);
      const d = diaDe(e, m.fecha); d.litros = r2(d.litros + n(m.litros));
    });
    await diasInoperativos(eq, desde, hasta);
    // Mínimo de horas del maestro de tarifas (la tarifa vigente al cierre)
    const ids = Object.keys(eq);
    if (ids.length && un) {
      const { data } = await sb.from('tarifas_equipos').select('equipo_id, fecha_hasta, minimo_hr, id').in('equipo_id', ids).eq('unidad_negocio', un);
      const mejor = {};
      // Preferida: la vigente con "fecha hasta" más cercana; si todas vencieron, la última
      const antes = (x, a) => {
        const vx = x.fecha_hasta >= hasta, va = a.fecha_hasta >= hasta;
        if (vx !== va) return vx;
        return vx ? x.fecha_hasta < a.fecha_hasta : x.fecha_hasta > a.fecha_hasta;
      };
      (data || []).forEach(t => {
        const a = mejor[t.equipo_id];
        if (!a || antes(t, a)) mejor[t.equipo_id] = t;
      });
      Object.values(mejor).forEach(t => { eq[t.equipo_id].minimo_hr = n(t.minimo_hr); });
    }
    const flotaPorId = Object.fromEntries((typeof flota !== 'undefined' ? flota || [] : []).map(f => [f.id, f]));
    Object.values(eq).forEach(e => {
      e.dias = e.dias.size; e.horas = r2(e.horas); e.m3 = r2(e.m3); e.tn = r2(e.tn); e.litros = r2(e.litros);
      if (!e.descripcion) { const f = flotaPorId[e.equipo_id]; e.descripcion = f ? (f.tipo || f.descripcion || '') : ''; }
    });
    return eq;
  }
  // Días que el equipo NO estuvo operativo en el período:
  //  · cubiertos por una OT de taller (ingreso por avería, paro de máquina u
  //    OT tipo Taller) desde el paro / ingreso hasta el cierre;
  //  · estado "Inoperativo" en el historial de la flota ese día;
  //  · parte del día con una falla que impidió trabajar.
  async function diasInoperativos(eq, desde, hasta) {
    const ids = Object.keys(eq);
    if (!ids.length) return;
    const dias = diasDelPeriodo(desde, hasta);
    const [ots, hist] = await Promise.all([
      sb.from('ordenes_trabajo').select('equipo_id, tipo_ot, ingreso_por_averia, paro_maquina, fecha_ingreso, fecha_cierre, estado')
        .in('equipo_id', ids).neq('estado', 'Anulada').lte('fecha_ingreso', hasta + 'T23:59:59'),
      sb.from('equipo_estado_historial').select('equipo_id, momento, estado_antes, estado_despues')
        .in('equipo_id', ids).lte('momento', hasta + 'T23:59:59').order('momento'),
    ]);
    const fecha = (v) => v ? String(v).slice(0, 10) : null;
    ids.forEach(id => {
      const e = eq[id], no = new Set();
      (ots.data || []).filter(o => o.equipo_id === id && (o.ingreso_por_averia || o.paro_maquina || String(o.tipo_ot || '').toLowerCase() === 'taller'))
        .forEach(o => {
          const ini = fecha(o.paro_maquina || o.fecha_ingreso), fin = fecha(o.fecha_cierre) || '9999-12-31';
          dias.forEach(d => { if (ini && d >= ini && d <= fin) no.add(d); });
        });
      const h = (hist.data || []).filter(x => x.equipo_id === id);
      if (h.length) {
        dias.forEach(d => {
          const ult = h.filter(x => fecha(x.momento) <= d).pop();
          if (ult && ult.estado_despues === 'Inoperativo') no.add(d);
        });
      }
      Object.values(e.dia).forEach(d => { if (d.falla) no.add(d.fecha); });
      e.inop = [...no].sort();
    });
  }
  function diasDelPeriodo(desde, hasta) {
    const l = [];
    for (let d = new Date(desde + 'T12:00:00'); iso(d) <= hasta; d.setDate(d.getDate() + 1)) l.push(iso(d));
    return l;
  }

  async function todas(armar) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await armar().range(desde, desde + 999);
      if (error) throw error;
      filas.push(...data);
      if (data.length < 1000) return filas;
    }
  }

  // Cantidad trabajada según la unidad de la línea
  function trabajadoSegun(unidad, e) {
    const u = String(unidad || '').toUpperCase().replace('Í', 'I');
    if (['HM', 'HS', 'HR', 'H', 'HORAS'].includes(u)) return e.horas;
    if (['M3', 'M³'].includes(u)) return e.m3;
    if (['TN', 'T', 'TON'].includes(u)) return e.tn;
    if (['DIAS', 'DIA', 'D'].includes(u)) return e.dias;
    return null;   // MES, UN, GL…: se carga a mano
  }

  // ════════════════════════════════════════════════════════════════
  // PANTALLA: LISTA
  // ════════════════════════════════════════════════════════════════
  async function mostrar(destino) {
    C.destino = destino || 'cert-cuerpo';
    estilos();
    if (C.cert) return pintarEditor();
    const cuerpo = $(C.destino);
    cuerpo.innerHTML = '<div class="empty-state">Cargando certificados…</div>';
    try { await cargarBase(); await cargarLista(); }
    catch (e) {
      cuerpo.innerHTML = `<div class="aviso-caja rojo">${esc(e.message)}${/cert_maq/.test(e.message) ? '<br>Falta correr <b>45_certificados_maquinas.sql</b> en Supabase.' : ''}</div>`;
      return;
    }
    const obras = [...C.obras].sort((a, b) => (b.activa - a.activa) || a.nombre.localeCompare(b.nombre, 'es'));
    const l = C.lista;
    const chip = (e) => ({ borrador: '<span class="chip amarillo">Borrador</span>', emitido: '<span class="chip verde">Emitido</span>', anulado: '<span class="chip gris">Anulado</span>' })[e] || e;
    cuerpo.innerHTML = `
      <div class="filtros">
        <div class="filtro crece siempre"><label>Obra / centro de costo</label><select id="cm-obra" class="ms" onchange="CertMaq.filtrarObra(MS.valores(this))">
          <option value="" ${obrasSel().length ? '' : 'selected'}>Todas las obras</option>
          ${obras.map(o => `<option value="${esc(o.clave)}" ${obrasSel().includes(o.clave) ? 'selected' : ''}>${esc(o.nombre)}${o.activa ? '' : ' (inactiva)'} · ${esc(o.codigo || '')}</option>`).join('')}
        </select></div>
      </div>
      <div class="barra-acciones"><div class="info">${l.length} certificado${l.length === 1 ? '' : 's'}</div>
        ${puedeEditar() ? '<button class="btn-filtro primario" onclick="CertMaq.nuevo()">+ Nuevo certificado</button>' : ''}</div>
      ${!l.length ? `<div class="empty-state">Todavía no hay certificados${obrasSel().length ? ' para ' + (obrasSel().length > 1 ? 'esas obras' : 'esta obra') : ''}.${puedeEditar() ? '<br>Tocá <b>+ Nuevo certificado</b>: se arma con los partes del período y el certificado anterior.' : ''}</div>`
        : `<div class="tabla-wrap" style="max-height:none"><table class="tabla"><thead><tr>
          <th>N°</th><th>Obra</th><th>Período</th><th>Formato</th><th>Cliente</th><th class="nro">Certificado Gs</th><th class="nro">A cobrar Gs</th><th>Estado</th><th>Facturación</th></tr></thead><tbody>
          ${l.map(c => `<tr onclick="CertMaq.abrir(${c.id})" ${c.estado === 'anulado' ? 'style="opacity:.55"' : ''}>
            <td><b>${nro2(c.numero)}</b></td><td>${esc(obraDe(c.obra_clave).nombre)}</td><td>${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)}</td>
            <td>${esc((PLANTILLAS[c.plantilla] || {}).t || c.plantilla)}</td><td class="larga">${esc(c.cliente || '')}</td>
            <td class="nro">${fmt(c.total_cert, 'gs')}</td><td class="nro"><b>${fmt(c.total_cobrar, 'gs')}</b></td><td>${chip(c.estado)}</td><td>${chipFact(c)}</td></tr>`).join('')}
          </tbody></table></div>`}`;
  }
  // v20261027a: varias obras a la vez. C.obra queda con la obra cuando hay una
  // sola elegida (la usa "+ Nuevo certificado" como obra propuesta).
  function filtrarObra(v) {
    C.obrasFiltro = Array.isArray(v) ? v : (v ? [v] : []);
    C.obra = C.obrasFiltro.length === 1 ? C.obrasFiltro[0] : '';
    mostrar(C.destino);
  }

  // ── Nuevo ───────────────────────────────────────────────────────
  // obraPre / mesPre (AAAA-MM): vienen desde Alquileres → "Armar certificado"
  async function nuevo(obraPre, mesPre) {
    try { await cargarBase(); } catch (e) { return toast(e.message, 'error'); }
    if (obraPre) { C.obra = obraPre; C.obrasFiltro = [obraPre]; }
    const d = mesPre ? new Date(+mesPre.slice(0, 4), +mesPre.slice(5, 7) - 1, 1) : new Date();
    if (!mesPre) { d.setDate(1); d.setMonth(d.getMonth() - 1); }
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const obras = [...C.obras].filter(o => o.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    abrirModal('Nuevo certificado de maquinarias', `
      <div class="form-grid">
        <div class="field ancho"><label for="cn-obra">Obra / centro de costo</label><select id="cn-obra">
          ${obras.map(o => `<option value="${esc(o.clave)}" ${o.clave === C.obra ? 'selected' : ''}>${esc(o.nombre)} · ${esc(o.codigo || '')}</option>`).join('')}</select></div>
        <div class="field"><label for="cn-desde">Desde</label><input type="date" id="cn-desde" value="${iso(d)}"></div>
        <div class="field"><label for="cn-hasta">Hasta</label><input type="date" id="cn-hasta" value="${iso(fin)}"></div>
        <div class="field ancho"><label for="cn-pl">Formato</label><select id="cn-pl">
          <option value="">Igual al certificado anterior (o Estándar si es el primero)</option>
          ${Object.entries(PLANTILLAS).map(([k, p]) => `<option value="${k}">${p.t}</option>`).join('')}</select></div>
      </div>
      <p class="cambio">Se copian del certificado anterior de la obra: cliente, líneas, precios, mínimos y columnas; su acumulado pasa a ser el "anterior".
        Las cantidades salen de los partes del período (horas de horómetro, días, m³ de hormigón, toneladas) y el gasoil despachado.</p>
      <div class="acciones"><button class="btn btn-primario" onclick="CertMaq.armar()">Armar certificado</button></div>`);
  }

  async function armar() {
    const obraClave = $('cn-obra').value, desde = $('cn-desde').value, hasta = $('cn-hasta').value, pl = $('cn-pl').value;
    if (!obraClave || !desde || !hasta) return toast('Elegí obra y período', 'warning');
    if (desde > hasta) return toast('"Desde" es posterior a "hasta"', 'warning');
    mostrarCarga('Armando el certificado…');
    try {
      const { data: prevs, error } = await sb.from('cert_maq').select('*').eq('obra_clave', obraClave).order('numero', { ascending: false }).limit(20);
      if (error) throw error;
      const numero = prevs.length ? Math.max(...prevs.map(p => p.numero)) + 1 : 1;
      const prev = prevs.find(p => p.estado !== 'anulado') || null;
      const eq = await traerPartes(obraClave, desde, hasta);
      C.partes = { obra: obraClave, desde, hasta, eq };
      const obra = obraDe(obraClave);
      const plantilla = pl || (prev && prev.plantilla) || 'estandar';
      const cert = {
        id: null, obra_clave: obraClave, numero, desde, hasta, plantilla,
        columnas: !pl && prev ? prev.columnas : PLANTILLAS[plantilla].cols.slice(),
        opciones: !pl && prev ? (prev.opciones || {}) : Object.assign({}, PLANTILLAS[plantilla].op),
        titulo: (prev && prev.titulo) || 'CERTIFICADO DE MAQUINARIAS',
        obra_titulo: prev ? prev.obra_titulo : obra.nombre, rubro: prev ? prev.rubro : '', ubicacion: prev ? prev.ubicacion : (obra.ubicacion || ''),
        cliente: prev ? prev.cliente : '', ruc: prev ? prev.ruc : '',
        descuentos: [], anexo_diario: prev ? prev.anexo_diario : true, notas: '',
        firmas: (prev && prev.firmas) || ['HECHO POR', 'AUTORIZACIÓN - TALLER CENTRAL', 'V° B° CLIENTE'],
        estado: 'borrador', items: [],
      };
      // Contrato de alquiler de esta obra (Alquileres): cliente y condiciones
      const ct = C.contratos.find(c => c.obra_clave === obraClave && c.estado === 'En Vigencia') || C.contratos.find(c => c.obra_clave === obraClave);
      let cond = [];
      if (ct) {
        const k = (C.clientes || []).find(x => x.id === ct.cliente_id);
        if (!prev || !cert.cliente) { cert.cliente = k ? k.nombre : ct.arrendatario; cert.ruc = (k ? k.ruc : ct.ruc) || ''; }
        const { data } = await sb.from('alquiler_equipos').select('equipo_id, precio_hora_gs, horas_minimas_mes').eq('contrato_id', ct.id);
        cond = data || [];
      }
      C.condiciones = Object.fromEntries(cond.filter(x => x.equipo_id).map(x => [x.equipo_id, x]));
      fijarPeriodo(cert);
      // Líneas del anterior, en su orden; su acumulado es el nuevo anterior
      const usados = new Set();
      (prev ? prev.items : []).forEach(p => {
        const it = {
          descripcion: p.descripcion, codigo: p.codigo, unidad: p.unidad, equipo_id: p.equipo_id || null, origen: p.origen || 'manual',
          minimo_mes: p.minimo_mes ?? null, dias_mes: null, dias_reparacion: 0, dias_tenencia: null, inop: [],
          trabajado: 0, a_certificar: null, a_cert_manual: false, precio: p.precio ?? 0, litros: 0, precio_litro: p.precio_litro ?? null,
          cant_anterior: r2(n(p.cant_acum ?? (n(p.cant_anterior) + n(p.a_certificar)))),
          monto_anterior: Math.round(n(p.monto_acum ?? (n(p.monto_anterior) + n(p.monto_actual)))),
        };
        const e = it.equipo_id && eq[it.equipo_id] || (it.codigo && eq[it.codigo]);
        if (e) { usados.add(e.equipo_id); llenarDesdePartes(it, e); }
        cert.items.push(it);
      });
      // Equipos con partes que no estaban en el anterior
      Object.values(eq).filter(e => !usados.has(e.equipo_id)).sort((a, b) => a.equipo_id.localeCompare(b.equipo_id, 'es', { numeric: true }))
        .forEach(e => cert.items.push(lineaNueva(e)));
      if (prev && prev.estado === 'borrador') toast(`Ojo: el certificado anterior (N° ${nro2(prev.numero)}) todavía es borrador`, 'warning');
      C.cert = cert;
      C.sucio = true;
      ocultarCarga();
      cerrarModal();
      pintarEditor();
    } catch (e) {
      ocultarCarga();
      toast('No se pudo armar: ' + (e.message || e), 'error');
    }
  }
  function lineaNueva(e) {
    const unidad = e.horas === 0 && e.m3 > 0 ? 'M3' : 'HM';
    const cc = (C.condiciones || {})[e.equipo_id];   // condiciones del contrato de alquiler
    if (cc) { if (n(cc.precio_hora_gs)) e.tarifa = n(cc.precio_hora_gs); if (n(cc.horas_minimas_mes)) e.minimo_hr = n(cc.horas_minimas_mes); }
    const it = {
      descripcion: String(e.descripcion || '').toUpperCase(), codigo: e.equipo_id, unidad, equipo_id: e.equipo_id, origen: 'partes',
      minimo_mes: e.minimo_hr || null, dias_mes: null, dias_reparacion: 0, dias_tenencia: null, trabajado: 0,
      a_certificar: null, a_cert_manual: false, precio: e.tarifa ?? 0, litros: 0, precio_litro: null, cant_anterior: 0, monto_anterior: 0,
    };
    llenarDesdePartes(it, e);
    return it;
  }
  // Período del certificado que se está armando (días y si se descuentan los inoperativos)
  let PER = { dias: 0, ajuste: true };
  const fijarPeriodo = (cert) => { PER = { dias: diasDelPeriodo(cert.desde, cert.hasta).length, ajuste: (cert.opciones || {}).ajuste_operativo !== false }; };
  function llenarDesdePartes(it, e) {
    if (PER.dias) {
      it.dias_mes = PER.dias;
      if (it.dias_tenencia === null || it.dias_tenencia === undefined || it.dias_tenencia === '' || it.dias_tenencia > PER.dias) it.dias_tenencia = PER.dias;
      if (!it.dr_manual) { it.inop = e.inop || []; it.dias_reparacion = PER.ajuste ? it.inop.length : 0; }
    }
    const t = trabajadoSegun(it.unidad, e);
    if (t !== null) it.trabajado = t;
    it.litros = e.litros || 0;
    if (!n(it.precio) && e.tarifa) it.precio = e.tarifa;
    if (it.minimo_mes === null && e.minimo_hr) it.minimo_mes = e.minimo_hr;
  }

  // ── Abrir uno guardado ──────────────────────────────────────────
  async function abrir(id) {
    mostrarCarga('Abriendo…');
    const { data, error } = await sb.from('cert_maq').select('*').eq('id', id).single();
    ocultarCarga();
    if (error) return toast(error.message, 'error');
    C.cert = data;
    C.cert.opciones = C.cert.opciones || {};
    C.partes = null;
    C.sucio = false;
    pintarEditor();
    window.scrollTo(0, 0);
  }
  function volver() {
    if (C.sucio && editable() && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return;
    C.cert = null; C.sucio = false;
    mostrar(C.destino);
  }

  // ════════════════════════════════════════════════════════════════
  // PANTALLA: EDITOR
  // ════════════════════════════════════════════════════════════════
  function pintarEditor() {
    const c = C.cert, ed = editable(), obra = obraDe(c.obra_clave);
    const chip = { borrador: '<span class="chip amarillo">Borrador</span>', emitido: '<span class="chip verde">Emitido</span>', anulado: '<span class="chip gris">Anulado</span>' }[c.estado];
    const tx = (k, label, extra = '') => `<div class="field ${extra}"><label>${label}</label>${ed
      ? `<input type="text" value="${esc(c[k] || '')}" ${k === 'cliente' ? 'list="cm-clientes"' : ''} onchange="CertMaq.cab('${k}', this.value)">`
      : `<div class="cm-ro">${esc(c[k] || '—')}</div>`}</div>`;
    $(C.destino).innerHTML = `
      <div class="barra-acciones cm-barra">
        <button class="btn-filtro" onclick="CertMaq.volver()">← Certificados</button>
        <div class="info"><b>Certificado N° ${nro2(c.numero)}</b> · ${esc(obra.nombre)} · ${chip}${C.sucio && ed ? ' <span class="chip rojo" id="cm-sucio">sin guardar</span>' : ''}</div>
        ${ed ? `<button class="btn-filtro" onclick="CertMaq.recalcular()" title="Vuelve a leer horas, días, m³ y gasoil de los partes">↻ Partes</button>
                <button class="btn-filtro primario" onclick="CertMaq.guardar()">Guardar</button>
                <button class="btn-filtro verde" onclick="CertMaq.emitir()">Emitir</button>` : ''}
        ${puedeEditar() && c.estado === 'emitido' ? '<button class="btn-filtro" onclick="CertMaq.reabrir()">Reabrir</button>' : ''}
        <button class="btn-filtro" onclick="CertMaq.excel()">Descargar Excel</button>
        <button class="btn-filtro" onclick="CertMaq.imprimir()">Imprimir</button>
        ${puedeEditar() && c.id ? `<button class="btn-filtro" style="color:var(--rojo)" onclick="CertMaq.${c.estado === 'borrador' ? 'borrar' : 'anular'}()">${c.estado === 'borrador' ? 'Borrar' : c.estado === 'emitido' ? 'Anular' : ''}</button>` : ''}
      </div>
      ${c.estado === 'emitido' && puedeEditar() ? '<div class="aviso-caja">Emitido: no se puede cambiar. Para corregirlo, <b>Reabrir</b>.</div>' : ''}

      <details class="cm-caja" ${c.id ? '' : 'open'}><summary>Encabezado</summary>
        <div class="form-grid cm-cab">
          <div class="field"><label>N°</label>${ed ? `<input type="number" min="1" value="${c.numero}" onchange="CertMaq.cab('numero', +this.value)">` : `<div class="cm-ro">${c.numero}</div>`}</div>
          <div class="field"><label>Desde</label>${ed ? `<input type="date" value="${c.desde}" onchange="CertMaq.cab('desde', this.value)">` : `<div class="cm-ro">${fmtFecha(c.desde)}</div>`}</div>
          <div class="field"><label>Hasta</label>${ed ? `<input type="date" value="${c.hasta}" onchange="CertMaq.cab('hasta', this.value)">` : `<div class="cm-ro">${fmtFecha(c.hasta)}</div>`}</div>
          ${tx('cliente', 'Cliente', 'ancho')}${tx('ruc', 'RUC')}
          ${tx('obra_titulo', 'Obra (como sale en el certificado)', 'ancho')}${tx('rubro', 'Rubro')}${tx('ubicacion', 'Ubicación')}
          ${tx('titulo', 'Título')}
        </div>
        <datalist id="cm-clientes">${[...new Map((C.contratos || []).map(x => [x.arrendatario, x])).values()].map(x => `<option value="${esc(x.arrendatario)}">${esc(x.ruc || '')}</option>`).join('')}</datalist>
      </details>

      <details class="cm-caja" open><summary>Formato y columnas</summary>
        <div class="cm-pl">${Object.entries(PLANTILLAS).map(([k, p]) => `<button class="btn-filtro ${c.plantilla === k ? 'primario' : ''}" ${ed ? `onclick="CertMaq.plantilla('${k}')"` : 'disabled'}>${p.t}</button>`).join('')}
          <span class="cambio">La plantilla prende las columnas de su hoja; después podés incluir o excluir cualquiera.</span></div>
        <div class="cm-cols">${COLS.filter(x => x.k !== 'item').map(x => `<label class="${(c.columnas || []).includes(x.k) ? 'on' : ''}">
          <input type="checkbox" ${(c.columnas || []).includes(x.k) ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.columna('${x.k}', this.checked)">
          ${esc(etiqueta(x.k, c))}${x.g ? ` <small>${esc(x.g.toLowerCase())}</small>` : ''}</label>`).join('')}</div>
        <div class="cm-cols cm-op">
          <label><input type="checkbox" ${(c.columnas || []).includes('item') ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.columna('item', this.checked)"> N° de ítem</label>
          <label><input type="checkbox" ${c.opciones.ajuste_operativo !== false ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.opcion('ajuste_operativo', this.checked)"> Descontar días inoperativos del mínimo</label>
          <label><input type="checkbox" ${c.opciones.desc_comb ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.opcion('desc_comb', this.checked)"> Descontar el combustible provisto</label>
          <label><input type="checkbox" ${c.opciones.calc_aux ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.opcion('calc_aux', this.checked)"> Cálculo auxiliar del mínimo</label>
          <label><input type="checkbox" ${c.anexo_diario ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.cab('anexo_diario', this.checked)"> Anexo: informe diario por equipo</label>
          <label><input type="checkbox" ${c.opciones.diario_litros !== false ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.opcion('diario_litros', this.checked)"> Informe diario: litros de combustible</label>
          <label><input type="checkbox" ${c.opciones.diario_operativo !== false ? 'checked' : ''} ${ed ? '' : 'disabled'} onchange="CertMaq.opcion('diario_operativo', this.checked)"> Informe diario: operativo ✔ / ❌</label>
        </div>
        ${(c.columnas || []).includes('minimo') ? '' : '<div class="cambio">Sin la columna "mínimo del período" no se aplica ningún mínimo: se certifica lo trabajado.</div>'}
      </details>

      <div id="cm-tabla"></div>
      <div id="cm-pie"></div>`;
    pintarTabla();
    pintarPie();
  }

  function pintarTabla() {
    const c = C.cert, ed = editable(), cols = visibles(c);
    const grupos = [];
    cols.forEach(x => { const u = grupos[grupos.length - 1]; if (x.g && u && u.g === x.g) u.n++; else grupos.push({ g: x.g || null, n: 1, k: x.k }); });
    const hayGrupos = grupos.some(g => g.g);
    const celda = (it, x, i) => {
      const v = valor(it, x.k, c, i);
      const cls = x.f ? 'nro' : '';
      if (!ed || x.tipo === 'auto' || x.tipo === 'calc') return `<td class="${cls} ${x.tipo === 'calc' ? 'cm-calc' : ''}" id="cm-${i}-${x.k}">${x.f ? fmt(v, x.f) : esc(v ?? '')}</td>`;
      if (x.k === 'unidad') return `<td><input class="cm-in cm-u" list="cm-unidades" value="${esc(v || '')}" onchange="CertMaq.dato(${i}, 'unidad', this.value)"></td>`;
      if (x.tipo === 'txt') return `<td><input class="cm-in ${x.k === 'descripcion' ? 'cm-d' : 'cm-c'}" value="${esc(v || '')}" onchange="CertMaq.dato(${i}, '${x.k}', this.value)"></td>`;
      const manual = (x.k === 'a_certificar' && it.a_cert_manual) || (x.k === 'minimo' && it.minimo_manual) || (x.k === 'dias_reparacion' && it.dr_manual);
      return `<td class="nro ${manual ? 'cm-manual' : ''}"><input class="cm-in cm-n" inputmode="decimal" id="cm-${i}-${x.k}" value="${fmt(v, x.f)}"
        onfocus="this.select()" onchange="CertMaq.dato(${i}, '${x.k}', this.value)">${manual ? `<button class="cm-x" title="Volver al cálculo" onclick="CertMaq.dato(${i}, '${x.k}_auto')">↺</button>` : ''}</td>`;
    };
    $('cm-tabla').innerHTML = `<div class="tabla-wrap" style="max-height:none"><table class="tabla cm-t"><thead>
        ${hayGrupos ? `<tr>${grupos.map(g => g.g ? `<th colspan="${g.n}" class="cm-g">${esc(g.g)}</th>` : `<th rowspan="2">${esc(etiqueta(g.k, c))}</th>`).join('')}${ed ? '<th rowspan="2"></th>' : ''}</tr>
          <tr>${cols.filter(x => x.g).map(x => `<th class="${x.f ? 'nro' : ''}">${esc(etiqueta(x.k, c))}</th>`).join('')}</tr>`
        : `<tr>${cols.map(x => `<th class="${x.f ? 'nro' : ''}">${esc(etiqueta(x.k, c))}</th>`).join('')}${ed ? '<th></th>' : ''}</tr>`}
      </thead><tbody>
      ${c.items.map((it, i) => `<tr class="cm-fila">${cols.map(x => celda(it, x, i)).join('')}
        ${ed ? `<td class="cm-acc">${it.equipo_id ? `<button title="Días operativos / inoperativos" onclick="CertMaq.calendario(${i})">📅</button>` : ''}<button title="Subir" onclick="CertMaq.mover(${i}, -1)">↑</button><button title="Bajar" onclick="CertMaq.mover(${i}, 1)">↓</button><button title="Quitar" onclick="CertMaq.quitar(${i})">✕</button></td>` : ''}</tr>`).join('')}
      ${!c.items.length ? `<tr><td colspan="${cols.length + 1}" class="empty-state">Sin líneas. No hay partes en el período${ed ? ': agregá líneas a mano' : ''}.</td></tr>` : ''}
      </tbody><tfoot><tr>${pieAcumulados(cols)}${ed ? '<td></td>' : ''}</tr></tfoot></table></div>
      <datalist id="cm-unidades">${UNIDADES.map(u => `<option value="${u}">`).join('')}</datalist>
      ${ed ? `<div style="margin:8px 2px"><button class="btn-filtro" onclick="CertMaq.agregar()">+ Línea manual</button>
        <button class="btn-filtro" onclick="CertMaq.agregarEquipo()">+ Equipo con partes</button></div>` : ''}`;
  }
  function pieAcumulados(cols) {
    const t = totales(C.cert);
    const primera = cols.findIndex(x => SUMAN.includes(x.k));
    if (primera < 0) return `<td colspan="${cols.length}"></td>`;
    return (primera ? `<td colspan="${primera}" class="nro">${ETQ_ACUM}</td>` : '') +
      cols.slice(primera).map(x => `<td class="nro" id="cm-t-${x.k}">${SUMAN.includes(x.k) ? fmt(t[x.k], x.f) : ''}</td>`).join('');
  }

  function pintarPie() {
    const c = C.cert, ed = editable(), t = totales(c);
    $('cm-pie').innerHTML = `<div class="cm-totales">
      <table>
        <tr class="cm-tt"><td>CERTIFICACIÓN TOTAL EN GS. IVA INCLUIDO</td><td class="nro">${fmt(t.cert, 'gs')}</td>${ed ? '<td></td>' : ''}</tr>
        <tr><td colspan="${ed ? 3 : 2}" class="cm-sub">DESCUENTOS</td></tr>
        ${t.desc.map((d, j) => d.auto ? `<tr><td>.- ${esc(d.texto)}</td><td class="nro">${fmt(d.monto, 'gs')}</td>${ed ? '<td class="cambio">auto</td>' : ''}</tr>`
          : ed ? `<tr><td><input class="cm-in" style="width:100%" value="${esc(d.texto || '')}" placeholder="Concepto" onchange="CertMaq.desc(${j - (t.desc[0] && t.desc[0].auto ? 1 : 0)}, 'texto', this.value)"></td>
                 <td class="nro"><input class="cm-in cm-n" inputmode="decimal" value="${fmt(d.monto, 'gs')}" onchange="CertMaq.desc(${j - (t.desc[0] && t.desc[0].auto ? 1 : 0)}, 'monto', this.value)"></td>
                 <td><button class="cm-x" onclick="CertMaq.desc(${j - (t.desc[0] && t.desc[0].auto ? 1 : 0)}, 'quitar')">✕</button></td></tr>`
          : `<tr><td>.- ${esc(d.texto || '')}</td><td class="nro">${fmt(d.monto, 'gs')}</td></tr>`).join('')}
        ${ed ? `<tr><td colspan="3"><button class="btn-filtro" onclick="CertMaq.desc(-1, 'agregar')">+ Descuento</button>
          <span class="cambio">Monto positivo resta; negativo suma (ej. saldo a favor).</span></td></tr>` : ''}
        <tr class="cm-tt"><td>TOTAL A COBRAR</td><td class="nro">${fmt(t.cobrar, 'gs')}</td>${ed ? '<td></td>' : ''}</tr>
      </table>
      <div class="cm-letras">SON GUARANÍES: ${esc(enLetras(t.cobrar))}${t.cobrar < 0 ? ' (negativo)' : ''}.-</div>
      ${ed ? `<div class="field" style="margin-top:10px"><label>Notas (salen al pie)</label><textarea rows="2" onchange="CertMaq.cab('notas', this.value)">${esc(c.notas || '')}</textarea></div>`
        : c.notas ? `<p>${esc(c.notas)}</p>` : ''}
    </div>`;
  }

  // ── Cambios ─────────────────────────────────────────────────────
  function marcar() {
    C.sucio = true;
    const info = document.querySelector('.cm-barra .info');
    if (info && !$('cm-sucio')) info.insertAdjacentHTML('beforeend', ' <span class="chip rojo" id="cm-sucio">sin guardar</span>');
  }
  function cab(k, v) {
    C.cert[k] = v;
    if (k === 'cliente') {
      const ct = (C.contratos || []).find(x => x.arrendatario === v);
      if (ct && ct.ruc && !C.cert.ruc) { C.cert.ruc = ct.ruc; pintarEditor(); }
    }
    marcar();
    if (k === 'desde' || k === 'hasta') toast('Cambió el período: tocá "↻ Partes" para releer las cantidades', 'warning');
  }
  function plantilla(k) {
    C.cert.plantilla = k;
    C.cert.columnas = PLANTILLAS[k].cols.slice();
    C.cert.opciones = Object.assign({}, C.cert.opciones, { calc_aux: !!PLANTILLAS[k].op.calc_aux, desc_comb: !!PLANTILLAS[k].op.desc_comb });
    marcar(); pintarEditor();
  }
  function columna(k, si) {
    const set = new Set(C.cert.columnas || []);
    if (si) set.add(k); else set.delete(k);
    C.cert.columnas = COLS.map(x => x.k).filter(x => set.has(x));   // siempre en el orden del formato
    marcar(); pintarEditor();
  }
  function opcion(k, si) {
    C.cert.opciones = Object.assign({}, C.cert.opciones, { [k]: si });
    if (k === 'ajuste_operativo') C.cert.items.forEach(it => { if (!it.dr_manual) it.dias_reparacion = si ? (it.inop || []).length : 0; });
    marcar(); pintarTabla(); pintarPie();
  }

  // ── Calendario de días operativos de una línea (se corrige a mano) ──
  function calendario(i) {
    const c = C.cert, it = c.items[i], dias = diasDelPeriodo(c.desde, c.hasta), no = new Set(it.inop || []);
    const ed = editable();
    const dsem = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
    const pad = new Date(dias[0] + 'T12:00:00').getDay();
    abrirModal(`${it.codigo || it.descripcion} · días operativos`, `
      <p class="cambio" style="margin-top:0">❌ = no estuvo operativo (OT de taller abierta, estado Inoperativo en la flota o parte con falla que impidió trabajar).
        ${ed ? 'Tocá un día para cambiarlo.' : ''}</p>
      <div class="cm-cal">${dsem.map(d => `<b>${d}</b>`).join('')}${'<span></span>'.repeat(pad)}
        ${dias.map(d => `<button type="button" class="${no.has(d) ? 'no' : 'si'}" ${ed ? `onclick="CertMaq.tocarDia(${i}, '${d}')"` : 'disabled'}>
          ${+d.slice(8)}<small>${no.has(d) ? '❌' : '✔'}</small></button>`).join('')}</div>
      <p><b>${dias.length - no.size}</b> de ${dias.length} días operativos (${fmt((dias.length - no.size) / dias.length, 'pct')})
        · ${no.size} inoperativo${no.size === 1 ? '' : 's'}${it.dr_manual ? ' · <span class="chip amarillo">corregido a mano</span>' : ''}</p>
      ${ed && it.dr_manual ? `<div class="acciones"><button class="btn-mini btn-neutro" onclick="CertMaq.dato(${i}, 'dias_reparacion_auto'); CertMaq.calendario(${i})">Volver a lo de los partes</button></div>` : ''}`);
  }
  function tocarDia(i, d) {
    const it = C.cert.items[i], no = new Set(it.inop || []);
    no.has(d) ? no.delete(d) : no.add(d);
    it.inop = [...no].sort(); it.dr_manual = true;
    it.dias_reparacion = (C.cert.opciones || {}).ajuste_operativo !== false ? it.inop.length : 0;
    if (!n(it.dias_mes)) { it.dias_mes = diasDelPeriodo(C.cert.desde, C.cert.hasta).length; it.dias_tenencia = it.dias_tenencia || it.dias_mes; }
    marcar(); pintarTabla(); pintarPie(); calendario(i);
  }

  function dato(i, k, v) {
    const it = C.cert.items[i];
    if (!it) return;
    if (k === 'a_certificar_auto') { it.a_cert_manual = false; it.a_certificar = null; marcar(); pintarTabla(); pintarPie(); return; }
    if (k === 'minimo_auto') { it.minimo_manual = false; it.minimo_valor = null; marcar(); pintarTabla(); pintarPie(); return; }
    if (k === 'dias_reparacion_auto') { it.dr_manual = false; it.dias_reparacion = (it.inop || []).length; marcar(); pintarTabla(); pintarPie(); return; }
    const c = COL[k];
    if (c.tipo === 'txt') {
      it[k] = String(v || '').trim();
      if (k === 'unidad') it.unidad = it.unidad.toUpperCase();
    } else {
      const x = leer(v);
      if (x === null && String(v).trim() !== '') { toast('Número no válido', 'warning'); pintarTabla(); return; }
      if (k === 'a_certificar') {
        const auto = calc(Object.assign({}, it, { a_cert_manual: false }), C.cert).a_certificar;
        it.a_cert_manual = x !== null && x !== auto;
        it.a_certificar = it.a_cert_manual ? x : null;
      } else if (k === 'minimo') {
        const auto = calc(Object.assign({}, it, { minimo_manual: false }), C.cert).minimo;
        it.minimo_manual = x !== null && x !== auto;
        it.minimo_valor = it.minimo_manual ? x : null;
      } else {
        it[k] = x;
        if (k === 'dias_reparacion') it.dr_manual = true;
      }
    }
    // Si cambia la unidad de una línea con partes, cambia de dónde sale la cantidad
    if (k === 'unidad' && C.partes && it.equipo_id && C.partes.eq[it.equipo_id]) {
      const t = trabajadoSegun(it.unidad, C.partes.eq[it.equipo_id]);
      if (t !== null) it.trabajado = t;
    }
    marcar();
    actualizar(i);
  }
  // Repinta solo los valores calculados (no pierde el foco de la siguiente celda)
  function actualizar(i) {
    const c = C.cert, it = c.items[i];
    visibles(c).forEach(x => {
      const el = $(`cm-${i}-${x.k}`);
      if (!el) return;
      const v = valor(it, x.k, c, i);
      if (el.tagName === 'INPUT') { if (document.activeElement !== el) el.value = fmt(v, x.f); }
      else el.textContent = x.f ? fmt(v, x.f) : (v ?? '');
    });
    const t = totales(c);
    SUMAN.forEach(k => { const el = $('cm-t-' + k); if (el) el.textContent = fmt(t[k], COL[k].f); });
    const ae = document.activeElement && document.activeElement.closest('#cm-pie') ? null : true;
    if (ae) pintarPie();
    const td = $(`cm-${i}-a_certificar`);
    if (td && td.tagName === 'INPUT' && it.a_cert_manual !== td.parentElement.classList.contains('cm-manual')) pintarTabla();
    const tm = $(`cm-${i}-minimo`);
    if (tm && tm.tagName === 'INPUT' && !!it.minimo_manual !== tm.parentElement.classList.contains('cm-manual')) pintarTabla();
    const tr = $(`cm-${i}-dias_reparacion`);
    if (tr && tr.tagName === 'INPUT' && !!it.dr_manual !== tr.parentElement.classList.contains('cm-manual')) pintarTabla();
  }
  function desc(j, k, v) {
    const l = C.cert.descuentos = C.cert.descuentos || [];
    if (k === 'agregar') l.push({ texto: '', monto: 0 });
    else if (k === 'quitar') l.splice(j, 1);
    else if (k === 'monto') { const x = leer(v); l[j].monto = x === null ? 0 : x; }
    else l[j][k] = v;
    marcar(); pintarPie();
  }
  function agregar() {
    C.cert.items.push({ descripcion: '', codigo: '', unidad: 'UN', origen: 'manual', trabajado: 0, precio: 0, cant_anterior: 0, monto_anterior: 0,
      minimo_mes: null, dias_mes: null, dias_reparacion: 0, dias_tenencia: null, litros: 0, precio_litro: null, a_cert_manual: false });
    marcar(); pintarTabla(); pintarPie();
    const ult = document.querySelectorAll('.cm-t .cm-d'); if (ult.length) ult[ult.length - 1].focus();
  }
  async function agregarEquipo() {
    const c = C.cert;
    if (!C.partes || C.partes.desde !== c.desde || C.partes.hasta !== c.hasta) {
      mostrarCarga('Leyendo partes…');
      try { C.partes = { obra: c.obra_clave, desde: c.desde, hasta: c.hasta, eq: await traerPartes(c.obra_clave, c.desde, c.hasta) }; }
      catch (e) { ocultarCarga(); return toast(e.message, 'error'); }
      ocultarCarga();
    }
    const ya = new Set(c.items.map(it => it.equipo_id || it.codigo));
    const l = Object.values(C.partes.eq).filter(e => !ya.has(e.equipo_id));
    if (!l.length) return toast('Todos los equipos con partes del período ya están en el certificado', 'success');
    abrirModal('Agregar equipo con partes', `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th class="nro">Horas</th><th class="nro">Días</th><th class="nro">m³</th></tr></thead><tbody>
      ${l.map(e => `<tr onclick="CertMaq.sumarEquipo('${esc(e.equipo_id)}')"><td><b>${esc(e.equipo_id)}</b></td><td>${esc(e.descripcion)}</td>
        <td class="nro">${fmt(e.horas, 'q')}</td><td class="nro">${e.dias}</td><td class="nro">${e.m3 ? fmt(e.m3, 'q') : ''}</td></tr>`).join('')}</tbody></table></div>`);
  }
  function sumarEquipo(id) { fijarPeriodo(C.cert); C.cert.items.push(lineaNueva(C.partes.eq[id])); cerrarModal(); marcar(); pintarTabla(); pintarPie(); }
  function mover(i, d) {
    const l = C.cert.items, j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    marcar(); pintarTabla();
  }
  function quitar(i) {
    const it = C.cert.items[i];
    if ((n(it.cant_anterior) || n(it.monto_anterior)) && !confirm(`"${it.descripcion || it.codigo}" tiene acumulado anterior. Si la quitás, el próximo certificado no lo arrastra. ¿Quitar?`)) return;
    C.cert.items.splice(i, 1);
    marcar(); pintarTabla(); pintarPie();
  }

  async function recalcular() {
    const c = C.cert;
    mostrarCarga('Leyendo partes del período…');
    try {
      const eq = await traerPartes(c.obra_clave, c.desde, c.hasta);
      C.partes = { obra: c.obra_clave, desde: c.desde, hasta: c.hasta, eq };
      fijarPeriodo(c);
      let act = 0;
      c.items.forEach(it => {
        const e = (it.equipo_id && eq[it.equipo_id]) || (it.codigo && eq[it.codigo]);
        if (e) { it.equipo_id = e.equipo_id; llenarDesdePartes(it, e); act++; }
        else if (it.equipo_id || it.origen === 'partes') { it.trabajado = 0; it.litros = 0; }
      });
      ocultarCarga();
      const nuevos = Object.keys(eq).filter(id => !c.items.some(it => it.equipo_id === id)).length;
      toast(`${act} línea${act === 1 ? '' : 's'} actualizada${act === 1 ? '' : 's'}${nuevos ? ` · ${nuevos} equipo${nuevos === 1 ? '' : 's'} con partes sin línea (+ Equipo con partes)` : ''}`, 'success');
      marcar(); pintarTabla(); pintarPie();
    } catch (e) { ocultarCarga(); toast(e.message, 'error'); }
  }

  // ── Guardar / estados ───────────────────────────────────────────
  function fila() {
    const c = C.cert, t = totales(c);
    const items = c.items.map((it, i) => {
      const k = calc(it, c);
      return Object.assign({}, it, { orden: i + 1, minimo: k.minimo, a_certificar: k.a_certificar, precio_total: k.precio_total,
        total_comb: k.total_comb, cant_acum: k.cant_acum, monto_actual: k.monto_actual, monto_acum: k.monto_acum });
    });
    return {
      obra_clave: c.obra_clave, numero: c.numero, desde: c.desde, hasta: c.hasta, plantilla: c.plantilla, columnas: c.columnas,
      opciones: c.opciones || {}, titulo: c.titulo, obra_titulo: c.obra_titulo, rubro: c.rubro, ubicacion: c.ubicacion,
      cliente: c.cliente, ruc: c.ruc, items, descuentos: (c.descuentos || []).filter(d => d.texto || n(d.monto)),
      anexo_diario: !!c.anexo_diario, notas: c.notas, firmas: c.firmas,
      total_cert: t.cert, total_desc: t.totalDesc, total_cobrar: t.cobrar,
    };
  }
  async function guardar(silencioso) {
    const c = C.cert;
    if (!c.numero || c.numero < 1) { toast('Poné el número del certificado', 'warning'); return false; }
    if (c.desde > c.hasta) { toast('"Desde" es posterior a "hasta"', 'warning'); return false; }
    const f = fila();
    const q = c.id ? sb.from('cert_maq').update(f).eq('id', c.id).select('*').single() : sb.from('cert_maq').insert(f).select('*').single();
    const { data, error } = await q;
    if (error) {
      toast(/cert_maq_numero_unico|duplicate/.test(error.message) ? `Ya existe el certificado N° ${c.numero} para esta obra` : 'No se pudo guardar: ' + error.message, 'error');
      return false;
    }
    C.cert = Object.assign(data, { opciones: data.opciones || {} });
    C.sucio = false;
    C.lista = null;
    if (!silencioso) { toast('Certificado guardado', 'success'); pintarEditor(); }
    return true;
  }
  async function emitir() {
    const t = totales(C.cert);
    if (!C.cert.items.length) return toast('El certificado no tiene líneas', 'warning');
    if (!confirm(`¿Emitir el certificado N° ${nro2(C.cert.numero)} por Gs ${fmt(t.cobrar, 'gs')}? Después no se puede cambiar (salvo reabrirlo).`)) return;
    if (!(await guardar(true))) return;
    const { data, error } = await sb.from('cert_maq').update({ estado: 'emitido' }).eq('id', C.cert.id).select('*').single();
    if (error) return toast(error.message, 'error');
    C.cert = Object.assign(data, { opciones: data.opciones || {} });
    toast('Certificado emitido', 'success');
    pintarEditor();
  }
  async function cambiarEstado(estado, pregunta, ok) {
    if (!confirm(pregunta)) return;
    const { data, error } = await sb.from('cert_maq').update({ estado }).eq('id', C.cert.id).select('*').single();
    if (error) return toast(error.message, 'error');
    C.cert = Object.assign(data, { opciones: data.opciones || {} });
    toast(ok, 'success');
    pintarEditor();
  }
  const reabrir = () => cambiarEstado('borrador', `¿Reabrir el certificado N° ${nro2(C.cert.numero)}? Vuelve a borrador y se puede editar. Ojo si el siguiente ya tomó su acumulado.`, 'Reabierto');
  const anular = () => cambiarEstado('anulado', `¿Anular el certificado N° ${nro2(C.cert.numero)}? Queda en la lista, pero no cuenta como anterior.`, 'Anulado');
  async function borrar() {
    if (!confirm(`¿Borrar el borrador N° ${nro2(C.cert.numero)}?`)) return;
    const { error } = await sb.from('cert_maq').delete().eq('id', C.cert.id);
    if (error) return toast(error.message, 'error');
    toast('Borrado', 'success');
    C.cert = null; C.sucio = false;
    mostrar(C.destino);
  }

  // ════════════════════════════════════════════════════════════════
  // INFORME DIARIO (anexo)
  // ════════════════════════════════════════════════════════════════
  async function diario() {
    const c = C.cert;
    if (!c.anexo_diario) return [];
    if (!C.partes || C.partes.desde !== c.desde || C.partes.hasta !== c.hasta || C.partes.obra !== c.obra_clave) {
      C.partes = { obra: c.obra_clave, desde: c.desde, hasta: c.hasta, eq: await traerPartes(c.obra_clave, c.desde, c.hasta) };
    }
    const dias = diasDelPeriodo(c.desde, c.hasta);
    const op = c.opciones || {};
    return c.items.map(it => {
      const e = (it.equipo_id && C.partes.eq[it.equipo_id]) || (it.codigo && C.partes.eq[it.codigo]);
      if (!e) return null;
      // Los días inoperativos de la línea (pueden estar corregidos a mano); si no, los de los partes
      const no = new Set(Array.isArray(it.inop) && (it.inop.length || it.dr_manual) ? it.inop : (e.inop || []));
      const filas = dias.map(d => Object.assign({ fecha: d, ini: null, fin: null, horas: 0, m3: 0, litros: 0, partes: 0 }, e.dia[d] || {}, { op: !no.has(d) }));
      return { codigo: e.equipo_id, descripcion: it.descripcion, filas, m3: e.m3 > 0,
        litros: op.diario_litros !== false, operativo: op.diario_operativo !== false,
        tot: { horas: r2(filas.reduce((s, f) => s + n(f.horas), 0)), m3: r2(filas.reduce((s, f) => s + n(f.m3), 0)),
               litros: r2(filas.reduce((s, f) => s + n(f.litros), 0)), op: filas.filter(f => f.op).length, dias: filas.length } };
    }).filter(Boolean);
  }
  // Líneas del cálculo auxiliar (volumen / horas mínimas)
  function calcAux(c) {
    if (!(c.opciones || {}).calc_aux) return [];
    return c.items.filter(it => n(it.minimo_mes) > 0).map(it => {
      const dm = n(it.dias_mes), dr = n(it.dias_reparacion), dt = it.dias_tenencia === null || it.dias_tenencia === undefined || it.dias_tenencia === '' ? dm : n(it.dias_tenencia);
      const k = calc(it, c);
      return { codigo: it.codigo || it.descripcion, unidad: it.unidad, mm: n(it.minimo_mes), dm, dr, dt, minimo: k.minimo,
        texto: dm > 0 ? `${fmt(it.minimo_mes, 'q')} × (${fmt(dt, 'd')}/${fmt(dm, 'd')}) × ((${fmt(dm, 'd')} − ${fmt(dr, 'd')})/${fmt(dm, 'd')}) = ${fmt(k.minimo, 'q')}`
          : `${fmt(it.minimo_mes, 'q')} (sin prorrateo por días)` };
    });
  }

  // ════════════════════════════════════════════════════════════════
  // IMPRIMIR (A4 apaisado)
  // ════════════════════════════════════════════════════════════════
  async function imprimir() {
    const c = C.cert, cols = visibles(c), t = totales(c), obra = obraDe(c.obra_clave);
    const w = window.open('', '_blank');
    if (!w) return toast('El navegador bloqueó la ventana de impresión', 'warning');
    w.document.write('<p style="font-family:Arial">Armando el certificado…</p>');
    let anexo = [];
    try { anexo = await diario(); } catch (e) { toast('No se pudo leer el informe diario: ' + e.message, 'warning'); }
    const grupos = [];
    cols.forEach(x => { const u = grupos[grupos.length - 1]; if (x.g && u && u.g === x.g) u.n++; else grupos.push({ g: x.g || null, n: 1, k: x.k }); });
    const hayGrupos = grupos.some(g => g.g);
    const primera = cols.findIndex(x => SUMAN.includes(x.k));
    const aux = calcAux(c);
    const logo = new URL(LOGO, location.href).href;
    const firmas = (c.firmas || []).map(f => `<div class="firma"><div class="linea"></div>${esc(f)}</div>`).join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Certificado N° ${nro2(c.numero)} · ${esc(obra.nombre)}</title>
      <style>
        @page { size: A4 landscape; margin: 9mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; }
        .marco { border: 1.2px solid #000; padding: 6px 8px 10px; }
        .cab { display: grid; grid-template-columns: 170px 1fr 170px; align-items: center; }
        .cab img { width: 140px; }
        .cab h1 { text-align: center; font-size: 14px; text-decoration: underline; margin: 0; }
        .datos { margin: 8px 0 4px; display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 3px 10px; font-size: 9.5px; }
        .datos .ancho { grid-column: 1 / -1; }
        .caja { border: 1px solid #000; padding: 2px 5px; font-weight: 700; }
        .gris { background: #d9d9d9; }
        table.t { border-collapse: collapse; width: 100%; margin-top: 6px; }
        .t th, .t td { border: 0.6px solid #000; padding: 2px 3px; }
        .t th { background: #d9d9d9; font-size: 8px; text-align: center; vertical-align: middle; }
        .t td.n { text-align: right; white-space: nowrap; }
        .t td.c { text-align: center; }
        .t tfoot td { font-weight: 700; background: #f0f0f0; }
        .tot { width: 52%; margin: 8px 0 0 auto; border-collapse: collapse; }
        .tot td { border: 0.8px solid #000; padding: 3px 6px; font-size: 10px; }
        .tot .g td { background: #d9d9d9; font-weight: 700; text-align: center; font-size: 11px; }
        .tot .g td.n { text-align: right; }
        .tot td.n { text-align: right; white-space: nowrap; width: 32%; }
        .letras { text-align: right; margin-top: 4px; font-weight: 700; font-size: 9.5px; }
        .notas { margin-top: 6px; }
        .firmas { display: grid; grid-template-columns: repeat(${Math.max(1, (c.firmas || []).length)}, 1fr); gap: 40px; margin-top: 46px; text-align: center; font-weight: 700; }
        .firma .linea { border-top: 1px solid #000; margin: 0 20px 3px; }
        .aux { margin-top: 14px; width: 60%; border-collapse: collapse; }
        .aux td, .aux th { border: 0.6px solid #000; padding: 2px 5px; }
        .aux th { background: #d9d9d9; }
        .leyenda { margin-top: 4px; font-size: 8.5px; color: #333; }
        .anexo { page-break-before: always; }
        .anexo h2 { font-size: 12px; text-align: center; margin: 4px 0 8px; }
        .anexo .grilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-items: start; }
        .anexo tr.inop td { background: #fdecec; }
        .anexo tr.tot td { background: #eef0f4; }
        .anexo td.c { text-align: center; }
        .anexo .ok { color: #1d7a3a; font-weight: 700; }
        .anexo table { border-collapse: collapse; width: 100%; break-inside: avoid; }
        .anexo th, .anexo td { border: 0.6px solid #000; padding: 1.5px 4px; font-size: 8.5px; }
        .anexo th { background: #d9d9d9; }
        .anexo td.n { text-align: right; }
        .anexo caption { font-weight: 700; text-align: left; padding-bottom: 2px; font-size: 9px; }
      </style></head><body>
      <div class="marco">
        <div class="cab"><img src="${logo}" alt="Tecsul"><h1>${esc(c.titulo || 'CERTIFICADO DE MAQUINARIAS')}</h1><div></div></div>
        <div class="datos">
          ${c.obra_titulo ? `<div class="ancho"><b>OBRA:</b> ${esc(c.obra_titulo)}</div>` : ''}
          ${c.rubro ? `<div class="ancho"><b>RUBRO:</b> ${esc(c.rubro)}</div>` : ''}
          ${c.ubicacion ? `<div class="ancho"><b>UBICACIÓN:</b> ${esc(c.ubicacion)}</div>` : ''}
          <div class="caja">CERTIFICADO N° ${nro2(c.numero)}</div>
          <div><b>Período</b> ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)}</div>
          <div class="caja gris">CLIENTE: ${esc(c.cliente || '')}${c.ruc ? ' - RUC: ' + esc(c.ruc) : ''}</div>
        </div>
        <table class="t"><thead>
          ${hayGrupos ? `<tr>${grupos.map(g => g.g ? `<th colspan="${g.n}">${esc(g.g)}</th>` : `<th rowspan="2">${esc(etiqueta(g.k, c))}</th>`).join('')}</tr>
            <tr>${cols.filter(x => x.g).map(x => `<th>${esc(etiqueta(x.k, c))}</th>`).join('')}</tr>`
            : `<tr>${cols.map(x => `<th>${esc(etiqueta(x.k, c))}</th>`).join('')}</tr>`}
        </thead><tbody>
          ${c.items.map((it, i) => `<tr>${cols.map(x => { const v = valor(it, x.k, c, i);
              return x.f ? `<td class="n">${fmt(v, x.f) || '-'}</td>` : `<td class="${['item', 'codigo', 'unidad'].includes(x.k) ? 'c' : ''}">${esc(v ?? '')}</td>`; }).join('')}</tr>`).join('')}
        </tbody>
        ${primera >= 0 ? `<tfoot><tr>${primera ? `<td colspan="${primera}" style="text-align:right">${ETQ_ACUM}</td>` : ''}${cols.slice(primera).map(x => `<td class="n">${SUMAN.includes(x.k) ? fmt(t[x.k], x.f) : ''}</td>`).join('')}</tr></tfoot>` : ''}
        </table>
        <table class="tot">
          <tr class="g"><td>CERTIFICACIÓN TOTAL EN GS. IVA INCLUIDO</td><td class="n">${fmt(t.cert, 'gs')}</td></tr>
          <tr class="g"><td>DESCUENTOS</td><td class="n">${t.desc.length ? '' : '-'}</td></tr>
          ${t.desc.map(d => `<tr><td>.- ${esc(d.texto || '')}</td><td class="n">Gs. ${fmt(d.monto, 'gs')}</td></tr>`).join('')}
          <tr class="g"><td>TOTAL A COBRAR</td><td class="n">${fmt(t.cobrar, 'gs')}</td></tr>
        </table>
        <div class="letras">SON GUARANÍES: ${esc(enLetras(t.cobrar))}${t.cobrar < 0 ? ' (negativo)' : ''}.-</div>
        ${c.notas ? `<div class="notas">${esc(c.notas)}</div>` : ''}
        <div class="firmas">${firmas}</div>
        ${aux.length ? `<table class="aux"><tr><th colspan="2">CÁLCULO AUXILIAR — mínimo correspondiente al período</th></tr>
          ${aux.map(a => `<tr><td><b>${esc(a.codigo)}</b></td><td>V = Mín × (DT/DM) × ((DM − DR)/DM) = ${esc(a.texto)} ${esc((a.unidad || '').toLowerCase())}</td></tr>`).join('')}</table>
          <div class="leyenda">Mín: mínimo establecido por mes · DT: días de tenencia del equipo · DM: días considerados del mes · DR: días en reparación del equipo</div>` : ''}
      </div>
      ${anexo.length ? `<div class="anexo"><h2>INFORME DIARIO DE EQUIPOS · ${esc(c.obra_titulo || obra.nombre)} · ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)}</h2><div class="grilla">
        ${anexo.map(a => `<table><caption>${esc(a.codigo)} · ${esc(a.descripcion || '')}</caption>
          <tr><th rowspan="2">Fecha</th><th colspan="2">Horómetro</th><th rowspan="2">Horas trabajadas</th>${a.m3 ? '<th rowspan="2">m³</th>' : ''}${a.litros ? '<th rowspan="2">Litros</th>' : ''}${a.operativo ? '<th rowspan="2">Operativo</th>' : ''}</tr><tr><th>Inicial</th><th>Final</th></tr>
          ${a.filas.map(f => `<tr class="${f.op ? '' : 'inop'}"><td>${fmtFecha(f.fecha)}</td><td class="n">${fmt(f.ini, 'q')}</td><td class="n">${fmt(f.fin, 'q')}</td>
            <td class="n">${f.partes ? fmt(f.horas, 'q') : ''}</td>${a.m3 ? `<td class="n">${f.m3 ? fmt(f.m3, 'q') : ''}</td>` : ''}${a.litros ? `<td class="n">${f.litros ? fmt(f.litros, 'q') : ''}</td>` : ''}
            ${a.operativo ? `<td class="c">${f.op ? '<span class="ok">✔</span>' : '❌'}</td>` : ''}</tr>`).join('')}
          <tr class="tot"><td colspan="3"><b>TOTAL</b></td><td class="n"><b>${fmt(a.tot.horas, 'q')}</b></td>${a.m3 ? `<td class="n"><b>${fmt(a.tot.m3, 'q')}</b></td>` : ''}${a.litros ? `<td class="n"><b>${fmt(a.tot.litros, 'q')}</b></td>` : ''}
            ${a.operativo ? `<td class="c"><b>${a.tot.op}/${a.tot.dias}</b></td>` : ''}</tr>
          ${a.operativo ? `<tr class="tot"><td colspan="${4 + (a.m3 ? 1 : 0) + (a.litros ? 1 : 0)}">Días operativos: ${a.tot.op} de ${a.tot.dias} · inoperativos: ${a.tot.dias - a.tot.op}</td><td class="c"><b>${fmt(a.tot.op / a.tot.dias, 'pct')}</b></td></tr>` : ''}</table>`).join('')}
      </div></div>` : ''}
      <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ════════════════════════════════════════════════════════════════
  // EXCEL (ExcelJS: logo, bordes, celdas combinadas y fórmulas)
  // ════════════════════════════════════════════════════════════════
  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = EXCELJS; s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el generador de Excel (¿hay señal?)'));
      document.head.appendChild(s);
    });
  }
  async function logoBase64() {
    try {
      const b = await (await fetch(LOGO)).blob();
      return await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(b); });
    } catch (e) { return null; }
  }

  async function excel() {
    const c = C.cert;
    mostrarCarga('Armando el Excel…');
    try {
      await cargarExcelJS();
      let anexo = [];
      try { anexo = await diario(); } catch (e) { /* sin anexo */ }
      const buf = await armarLibro(window.ExcelJS, c, await logoBase64(), anexo);
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      const nom = (c.obra_titulo || obraDe(c.obra_clave).nombre).replace(/[^\wÁÉÍÓÚÑáéíóúñ -]/g, '').trim().replace(/\s+/g, '_').slice(0, 40);
      a.href = URL.createObjectURL(blob);
      a.download = `Certificado_maquinas_N${nro2(c.numero)}_${nom}_${c.hasta}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ocultarCarga();
    } catch (e) { ocultarCarga(); toast('No se pudo armar el Excel: ' + (e.message || e), 'error'); }
  }

  // Separado de la pantalla para poder probarlo fuera del navegador
  async function armarLibro(ExcelJS, c, logo, anexo) {
    const cols = visibles(c), t = totales(c), obra = obraDe(c.obra_clave);
    const NF = { q: '#,##0.0#;-#,##0.0#;"-"', gs: '#,##0;-#,##0;"-"', d: '#,##0.#;-#,##0.#;"-"', pct: '0.0%' };
    const fino = { style: 'thin', color: { argb: 'FF000000' } };
    const borde = { top: fino, left: fino, bottom: fino, right: fino };
    const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tecsul S.A.E.';
    const ws = wb.addWorksheet(`Cert N° ${nro2(c.numero)}`, {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }, horizontalCentered: true },
    });
    const N = Math.max(cols.length, 6);
    ws.columns = Array.from({ length: N }, (_, j) => ({ width: cols[j] ? cols[j].w : 12 }));
    const L = (j) => { let s = '', x = j + 1; while (x) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
    const celda = (r, j) => ws.getCell(`${L(j)}${r}`);
    const unir = (r1, j1, r2, j2) => { if (r1 !== r2 || j1 !== j2) ws.mergeCells(r1, j1 + 1, r2, j2 + 1); return celda(r1, j1); };
    const tercio = Math.floor(N / 3);

    // Cabecera
    if (logo) {
      const id = wb.addImage({ base64: logo, extension: 'png' });
      ws.addImage(id, { tl: { col: 0.15, row: 0.3 }, ext: { width: 150, height: 57 } });
    }
    const tit = unir(2, Math.min(2, N - 1), 3, N - 1);
    tit.value = c.titulo || 'CERTIFICADO DE MAQUINARIAS';
    tit.font = { bold: true, size: 14, underline: true }; tit.alignment = { horizontal: 'center', vertical: 'middle' };
    let r = 6;
    [['OBRA', c.obra_titulo], ['RUBRO', c.rubro], ['UBICACIÓN', c.ubicacion]].forEach(([k, v]) => {
      if (!v) return;
      const x = unir(r, 0, r, N - 1); x.value = `${k}: ${v}`; x.font = { bold: true, size: 10 }; r++;
    });
    r++;
    let x = unir(r, 0, r, tercio - 1); x.value = `CERTIFICADO N° ${nro2(c.numero)}`; x.font = { bold: true }; x.border = borde;
    x = unir(r, tercio, r, 2 * tercio - 1); x.value = `Período: ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)}`; x.font = { bold: true }; x.alignment = { horizontal: 'center' };
    x = unir(r, 2 * tercio, r, N - 1); x.value = `CLIENTE: ${c.cliente || ''}${c.ruc ? ' - RUC: ' + c.ruc : ''}`; x.font = { bold: true }; x.fill = gris; x.border = borde;
    r += 2;

    // Encabezados de la tabla
    const grupos = [];
    cols.forEach((col, j) => { const u = grupos[grupos.length - 1]; if (col.g && u && u.g === col.g) u.hasta = j; else grupos.push({ g: col.g || null, desde: j, hasta: j }); });
    const hayGrupos = grupos.some(g => g.g);
    const estiloCab = (cel) => { cel.font = { bold: true, size: 8 }; cel.fill = gris; cel.border = borde; cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; };
    if (hayGrupos) {
      grupos.forEach(g => {
        const cel = g.g ? unir(r, g.desde, r, g.hasta) : unir(r, g.desde, r + 1, g.desde);
        cel.value = g.g || etiqueta(cols[g.desde].k, c);
        for (let j = g.desde; j <= g.hasta; j++) { estiloCab(celda(r, j)); estiloCab(celda(r + 1, j)); }
      });
      cols.forEach((col, j) => { if (col.g) { const cel = celda(r + 1, j); cel.value = etiqueta(col.k, c); estiloCab(cel); } });
      ws.getRow(r).height = 16; ws.getRow(r + 1).height = 34;
      r += 2;
    } else {
      cols.forEach((col, j) => { const cel = celda(r, j); cel.value = etiqueta(col.k, c); estiloCab(cel); });
      ws.getRow(r).height = 34;
      r++;
    }

    // Líneas con fórmulas (si las columnas que usa están en la hoja)
    const pos = Object.fromEntries(cols.map((col, j) => [col.k, j]));
    const ref = (k, fila) => pos[k] === undefined ? null : `${L(pos[k])}${fila}`;
    const ini = r;
    c.items.forEach((it, i) => {
      const k = calc(it, c);
      const R = (key) => ref(key, r);
      const v = (key) => R(key) || String(n(key === 'dias_tenencia' && (it.dias_tenencia === null || it.dias_tenencia === undefined || it.dias_tenencia === '') ? it.dias_mes : it[key]));
      const f = {
        pct_operativo: () => `IF(${v('dias_mes')}>0,(${v('dias_mes')}-${v('dias_reparacion')})/${v('dias_mes')},1)`,
        minimo: () => it.minimo_manual ? null : `IF(${v('dias_mes')}>0,${v('minimo_mes')}*(${v('dias_tenencia')}/${v('dias_mes')})*((${v('dias_mes')}-${v('dias_reparacion')})/${v('dias_mes')}),${v('minimo_mes')})`,
        a_certificar: () => it.a_cert_manual ? null : (c.columnas.includes('minimo') ? `MAX(${v('trabajado')},${R('minimo')})` : `${v('trabajado')}`),
        precio_total: () => `ROUND(${R('a_certificar') || R('cant_actual') || k.a_certificar}*${v('precio')},0)`,
        total_comb: () => `ROUND(${v('litros')}*${v('precio_litro')},0)`,
        cant_actual: () => R('a_certificar') || (it.a_cert_manual ? null : (c.columnas.includes('minimo') ? `MAX(${v('trabajado')},${R('minimo')})` : v('trabajado'))),
        cant_acum: () => `${v('cant_anterior')}+${R('cant_actual') || R('a_certificar') || k.a_certificar}`,
        monto_actual: () => R('precio_total') || `ROUND(${R('a_certificar') || R('cant_actual') || k.a_certificar}*${v('precio')},0)`,
        monto_acum: () => `${v('monto_anterior')}+${R('monto_actual') || R('precio_total') || k.monto_actual}`,
      };
      cols.forEach((col, j) => {
        const cel = celda(r, j);
        const val = valor(it, col.k, c, i);
        const fo = f[col.k] && f[col.k]();
        if (fo && col.tipo !== 'num' && col.tipo !== 'txt') cel.value = { formula: fo, result: val };
        else cel.value = col.f ? (val === null || val === undefined || val === '' ? null : n(val)) : (val ?? '');
        cel.border = borde;
        cel.font = { size: 9 };
        if (col.f) { cel.numFmt = NF[col.f]; cel.alignment = { horizontal: 'right' }; }
        else cel.alignment = { horizontal: ['item', 'codigo', 'unidad'].includes(col.k) ? 'center' : 'left', wrapText: col.k === 'descripcion' };
      });
      r++;
    });
    const fin = r - 1;
    // Acumulados
    const primera = cols.findIndex(col => SUMAN.includes(col.k));
    if (primera >= 0) {
      if (primera) { const cel = unir(r, 0, r, primera - 1); cel.value = ETQ_ACUM; cel.alignment = { horizontal: 'right' }; cel.font = { bold: true }; }
      const jU = cols.findIndex(col => col.k === 'unidad');
      cols.forEach((col, j) => {
        if (j < primera) return;
        const cel = celda(r, j);
        if (SUMAN.includes(col.k) && fin >= ini) cel.value = CANT_HM.includes(col.k)
          ? (jU >= 0 ? { formula: `SUMIF(${L(jU)}${ini}:${L(jU)}${fin},"HM",${L(j)}${ini}:${L(j)}${fin})`, result: t[col.k] } : t[col.k])
          : { formula: `SUM(${L(j)}${ini}:${L(j)}${fin})`, result: t[col.k] };
        cel.font = { bold: true, size: 9 }; cel.numFmt = NF[col.f] || NF.q; cel.border = borde; cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      });
    }
    const filaAcum = r;
    r += 2;

    // Totales (bloque a la derecha)
    const jv = N - 1, jt0 = Math.max(0, N - 1 - Math.max(3, Math.ceil(N / 3)));
    const fila2 = (texto, valorCel, gr) => {
      const a = unir(r, jt0, r, jv - 1); a.value = texto; a.border = borde; a.font = { bold: !!gr, size: gr ? 11 : 9 };
      a.alignment = { horizontal: gr ? 'center' : 'left' }; if (gr) a.fill = gris;
      for (let j = jt0; j < jv; j++) celda(r, j).border = borde;
      const b = celda(r, jv); b.value = valorCel; b.numFmt = NF.gs; b.border = borde; b.font = { bold: !!gr, size: gr ? 11 : 9 }; if (gr) b.fill = gris;
      r++; return r - 1;
    };
    const jm = pos.monto_actual !== undefined ? pos.monto_actual : pos.precio_total;
    const filaCert = fila2('CERTIFICACIÓN TOTAL EN GS. IVA INCLUIDO', jm !== undefined && fin >= ini ? { formula: `SUM(${L(jm)}${ini}:${L(jm)}${fin})`, result: t.cert } : t.cert, true);
    fila2('DESCUENTOS', null, true);
    const d0 = r;
    t.desc.forEach(d => fila2('.- ' + (d.texto || ''), d.auto && pos.total_comb !== undefined && primera >= 0 ? { formula: `${L(pos.total_comb)}${filaAcum}`, result: d.monto } : n(d.monto), false));
    const d1 = r - 1;
    fila2('TOTAL A COBRAR', { formula: t.desc.length ? `${L(jv)}${filaCert}-SUM(${L(jv)}${d0}:${L(jv)}${d1})` : `${L(jv)}${filaCert}`, result: t.cobrar }, true);
    r++;
    x = unir(r, 0, r, N - 1); x.value = `SON GUARANÍES: ${enLetras(t.cobrar)}${t.cobrar < 0 ? ' (negativo)' : ''}.-`; x.font = { bold: true }; x.alignment = { horizontal: 'right' };
    r++;
    if (c.notas) { x = unir(r, 0, r, N - 1); x.value = c.notas; x.alignment = { wrapText: true }; r++; }
    // Firmas
    r += 4;
    const fs = c.firmas || [];
    const ancho = Math.floor(N / Math.max(1, fs.length));
    fs.forEach((fi, q) => {
      const j1 = q * ancho, j2 = q === fs.length - 1 ? N - 1 : (q + 1) * ancho - 1;
      const cel = unir(r, j1, r, j2); cel.value = fi; cel.font = { bold: true }; cel.alignment = { horizontal: 'center' };
      cel.border = { top: fino };
      for (let j = j1; j <= j2; j++) celda(r, j).border = { top: fino };
    });
    r += 2;
    // Cálculo auxiliar
    const aux = calcAux(c);
    if (aux.length) {
      r++;
      x = unir(r, 0, r, Math.min(N - 1, 7)); x.value = 'CÁLCULO AUXILIAR — mínimo correspondiente al período'; x.font = { bold: true }; x.fill = gris; x.border = borde; r++;
      aux.forEach(a => {
        const a1 = celda(r, 0); a1.value = a.codigo; a1.font = { bold: true }; a1.border = borde;
        const a2 = unir(r, 1, r, Math.min(N - 1, 7)); a2.value = `V = Mín × (DT/DM) × ((DM − DR)/DM) = ${a.texto} ${(a.unidad || '').toLowerCase()}`; a2.border = borde; r++;
      });
      x = unir(r, 0, r, N - 1); x.value = 'Mín: mínimo establecido por mes · DT: días de tenencia · DM: días considerados del mes · DR: días en reparación'; x.font = { size: 8, italic: true };
      r++;
    }
    ws.pageSetup.printArea = `A1:${L(N - 1)}${r}`;

    // Anexo: informe diario
    if (anexo && anexo.length) {
      const wa = wb.addWorksheet('Informe diario', { views: [{ showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      wa.columns = [{ width: 12 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 10 }];
      let q = 1;
      let cel = wa.getCell(`A${q}`); wa.mergeCells(q, 1, q, 5);
      cel.value = `INFORME DIARIO DE EQUIPOS · ${c.obra_titulo || obra.nombre}`; cel.font = { bold: true, size: 12 }; q++;
      wa.getCell(`A${q}`).value = `Período ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)} · Certificado N° ${nro2(c.numero)}`; q += 2;
      anexo.forEach(a => {
        wa.mergeCells(q, 1, q, 5); cel = wa.getCell(`A${q}`); cel.value = `${a.codigo} · ${a.descripcion || ''}`; cel.font = { bold: true }; q++;
        const extra = [...(a.m3 ? ['m3'] : []), ...(a.litros ? ['litros'] : [])];
        const cab = ['Fecha', 'Horómetro inicial', 'Horómetro final', 'Horas trabajadas', ...extra.map(x => x === 'm3' ? 'm³' : 'Litros'), ...(a.operativo ? ['Operativo'] : [])];
        cab.forEach((h, j) => { const z = wa.getCell(q, j + 1); z.value = h; estiloCab(z); });
        wa.getRow(q).height = 28; q++;
        const i0 = q, rojo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } };
        a.filas.forEach(fl => {
          const [yy, mm, dd] = fl.fecha.split('-').map(Number);
          const vals = [new Date(Date.UTC(yy, mm - 1, dd)), fl.ini === null ? null : n(fl.ini), fl.fin === null ? null : n(fl.fin), fl.partes ? n(fl.horas) : null,
            ...extra.map(x => n(fl[x]) || null), ...(a.operativo ? [fl.op ? '✔' : '❌'] : [])];
          vals.forEach((vv, j) => { const z = wa.getCell(q, j + 1); z.value = vv; z.border = borde; z.numFmt = j === 0 ? 'dd/mm/yyyy' : '#,##0.0';
            if (a.operativo && j === vals.length - 1) z.alignment = { horizontal: 'center' };
            if (!fl.op) z.fill = rojo; });
          q++;
        });
        const L = (j) => String.fromCharCode(65 + j);
        wa.mergeCells(q, 1, q, 3); cel = wa.getCell(`A${q}`); cel.value = 'TOTAL'; cel.font = { bold: true }; cel.border = borde;
        [3, ...extra.map((_, k) => 4 + k)].forEach(j => {
          const key = j === 3 ? 'horas' : extra[j - 4];
          cel = wa.getCell(q, j + 1); cel.value = { formula: `SUM(${L(j)}${i0}:${L(j)}${q - 1})`, result: a.tot[key] };
          cel.font = { bold: true }; cel.border = borde; cel.numFmt = '#,##0.0';
        });
        if (a.operativo) {
          const jo = 4 + extra.length;
          cel = wa.getCell(q, jo + 1); cel.value = { formula: `COUNTIF(${L(jo)}${i0}:${L(jo)}${q - 1},"✔")&"/"&ROWS(${L(jo)}${i0}:${L(jo)}${q - 1})`, result: `${a.tot.op}/${a.tot.dias}` };
          cel.font = { bold: true }; cel.border = borde; cel.alignment = { horizontal: 'center' };
          q++;
          wa.mergeCells(q, 1, q, jo); cel = wa.getCell(`A${q}`); cel.value = `Días operativos: ${a.tot.op} de ${a.tot.dias} · inoperativos: ${a.tot.dias - a.tot.op}`; cel.border = borde;
          cel = wa.getCell(q, jo + 1); cel.value = { formula: `COUNTIF(${L(jo)}${i0}:${L(jo)}${q - 2},"✔")/ROWS(${L(jo)}${i0}:${L(jo)}${q - 2})`, result: a.tot.op / a.tot.dias };
          cel.numFmt = '0.0%'; cel.font = { bold: true }; cel.border = borde; cel.alignment = { horizontal: 'center' };
        }
        q += 3;
      });
    }
    return wb.xlsx.writeBuffer();
  }

  // ════════════════════════════════════════════════════════════════
  function estilos() {
    if ($('cm-estilos')) return;
    const st = document.createElement('style');
    st.id = 'cm-estilos';
    st.textContent = `
      .cm-barra { flex-wrap: wrap; gap: 6px; }
      .cm-caja { background: #fff; border-radius: 10px; box-shadow: var(--sombra); padding: 10px 14px; margin: 10px 0; }
      .cm-caja summary { font-weight: 700; cursor: pointer; color: var(--azul-oscuro); }
      .cm-cab { margin-top: 10px; display: grid !important; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px 12px; }
      .cm-cab .ancho { grid-column: span 2; }
      .cm-ro { padding: 8px 0; font-weight: 600; }
      .cm-pl { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 10px 0 8px; }
      .cm-cols { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
      .cm-cols label { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; border: 1px solid #dde3ec; border-radius: 16px;
        padding: 4px 10px; cursor: pointer; background: #f7f9fc; text-transform: none; letter-spacing: 0; color: var(--gris-texto); }
      .cm-cols label.on { background: #e0e7ff; border-color: var(--azul-medio); color: var(--azul-oscuro); }
      .cm-cols label small { color: #889; font-size: 10.5px; }
      .cm-op label { background: #fff; }
      .cm-t th { white-space: normal; text-align: center; vertical-align: middle; font-size: 11.5px; line-height: 1.2; padding: 6px 7px; }
      .cm-t th.cm-g { background: var(--azul-medio); }
      .cm-t td { padding: 3px 5px; }
      .cm-t td.nro { text-align: right; white-space: nowrap; }
      .cm-t td.cm-calc { color: var(--azul-medio); font-weight: 600; }
      .cm-t tfoot td { font-weight: 700; background: #f3f5f9; border-top: 2px solid var(--azul-oscuro); padding: 7px 6px; }
      .cm-t tfoot td.nro { text-align: right; }
      .cm-t tr.cm-fila { cursor: default; }
      .cm-in { border: 1px solid #dde3ec; border-radius: 5px; padding: 4px 5px; font: inherit; font-size: 12.5px; background: #fffef5; }
      .cm-in:focus { outline: 2px solid var(--azul-medio); background: #fff; }
      .cm-n { width: 92px; text-align: right; }
      .cm-d { width: 200px; }
      .cm-c { width: 76px; }
      .cm-u { width: 58px; text-transform: uppercase; }
      .cm-manual .cm-n { background: #fff1d6; border-color: #e8a33d; }
      .cm-x { border: none; background: none; cursor: pointer; color: var(--azul-medio); font-size: 13px; padding: 0 3px; }
      .cm-acc { white-space: nowrap; }
      .cm-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin: 8px 0; text-align: center; }
      .cm-cal b { font-size: 11px; color: var(--gris-texto); }
      .cm-cal button { border: 1.5px solid #cfe8d6; background: #effaf2; border-radius: 7px; padding: 5px 0; font-weight: 700; cursor: pointer; color: var(--azul-oscuro); }
      .cm-cal button small { display: block; font-size: 11px; color: #1d7a3a; }
      .cm-cal button.no { border-color: #f1b8b1; background: #fdecec; }
      .cm-cal button.no small { color: var(--rojo); }
      .cm-acc button { border: none; background: #eef1f6; border-radius: 4px; margin-left: 2px; cursor: pointer; padding: 2px 6px; }
      .cm-totales { max-width: 640px; margin: 14px 0 30px auto; }
      .cm-totales table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: var(--sombra); }
      .cm-totales td { padding: 6px 10px; border-bottom: 1px solid #eef1f5; }
      .cm-totales td.nro { text-align: right; white-space: nowrap; }
      .cm-totales .cm-tt td { background: var(--azul-oscuro); color: #fff; font-weight: 700; font-size: 14px; }
      .cm-totales .cm-sub { font-weight: 700; background: #f3f5f9; font-size: 12px; }
      .cm-letras { text-align: right; font-weight: 700; margin-top: 8px; font-size: 12.5px; }
      @media (max-width: 700px) { .cm-d { width: 160px; } .cm-n { width: 78px; } }`;
    document.head.appendChild(st);
  }

  return { mostrar, filtrarObra, nuevo, armar, abrir, volver, cab, plantilla, columna, opcion, dato, desc, agregar, agregarEquipo,
           sumarEquipo, mover, quitar, calendario, tocarDia, recalcular, guardar, emitir, reabrir, anular, borrar, imprimir, excel,
           _prueba: { calc, totales, enLetras, leer, armarLibro, PLANTILLAS, COLS, C } };
})();
