// ══════════════════════════════════════════════════════════════════
// FORMULARIOS DE CAMPO — Taller y Combustible
// Tecsul S.A.E.
//
// Reemplazan los formularios de JotForm "Reportes - Taller" y "Control
// Combustible", con la misma estructura. Viven dentro de la app del
// parte diario: cada persona ve las solapas que le tocan según su
// especialidad (mis_formularios() en la base).
//
// Igual que el parte: todo se guarda primero en el teléfono y se envía
// cuando hay señal. Reenviar no duplica (client_id).
// ══════════════════════════════════════════════════════════════════
window.FX = (() => {

  // ── Valores reales de los formularios de JotForm ────────────────
  const CONDICIONES = [
    { v: 'Registro de Trabajos - OT',            t: 'Registro de trabajos', d: 'Lo que se hizo hoy en una OT' },
    { v: 'Diagnóstico Inicial - Generación OT',  t: 'Diagnóstico inicial',  d: 'La máquina entra a taller: abre una OT' },
    { v: 'Reporte de Fallas',                    t: 'Reporte de falla',     d: 'Avisar una falla para que taller la vea' },
    { v: 'Cierre de OT - Taller',                t: 'Cierre de OT',         d: 'La máquina sale de taller' }
  ];
  const ESTADOS_MAQUINA = ['Pendiente diagnóstico', 'En Reparación', 'Espera de Repuestos',
    'Esperando pruebas en Campo', 'Urgencia en otros equipos', 'Servicios Generales',
    'Reparado- Fallas menores', 'Reparado'];
  const ESTADOS_SALIDA = ['Reparado', 'Reparado- Fallas menores', 'Esperando pruebas en Campo'];
  const ESTADOS_REPARACION = ['Diagnóstico en curso', 'Reparación en curso', 'Esperando repuesto',
    'Revisión de pruebas', 'Reparado'];
  const TIPOS_MTTO = ['250', '500', '750', '1.000', '5.000', '10.000'];
  const TRABAJOS_GENERALES = ['SERVICIOS GENERALES', 'TRABAJOS INTERNOS TALLER', 'OTROS'];
  const CHK_ENTRADA = ['Comprobación Eléctrica', 'Comprobación neumáticos', 'Revisión Frenos',
    'Revisión Parabrisas y Ventanas', 'Revisión Fluidos', 'Revisión Adicionales'];
  const CHK_SALIDA_SISTEMA = { 'ELÉCTRICO': 'Salida - Eléctrico', 'MOTOR': 'Salida - Motor',
    'GOMERÍA': 'Salida - Gomería', 'MECÁNICO': 'Salida - Mecánico', 'HIDRÁULICO': 'Salida - Hidráulico' };

  const ACTIVIDADES = [
    { v: 'Despacho de combustible', t: 'Despacho' },
    { v: 'Ingreso de combustible',  t: 'Ingreso' },
    { v: 'Medición de tanque',      t: 'Medición' },
    { v: 'Prueba de desviación',    t: 'Prueba' }
  ];

  const COLA = 'pendientes_otros';
  const MAX_FOTOS = 6;

  let formularios = ['parte'];
  let C = {};            // catálogos propios (equipos, tanques, OT, trabajos, checklists, fallas)
  let t = null;          // formulario de taller en curso
  let c = null;          // formulario de combustible en curso
  let archivos = {};     // fotos elegidas (File), por formulario y campo
  let recientes = { taller: null, combustible: null };
  let enviando = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const ahoraHora = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ahoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  // ════════════════════════════════════════════════════════════════
  // ARRANQUE
  // ════════════════════════════════════════════════════════════════
  async function iniciar() {
    inyectarEstilos();
    const guardado = localStorage.getItem('fx_formularios');
    if (guardado) formularios = JSON.parse(guardado);
    if (navigator.onLine) {
      try {
        const { data, error } = await sb.rpc('mis_formularios');
        if (error) throw error;
        if (Array.isArray(data) && data.length) {
          formularios = data;
          localStorage.setItem('fx_formularios', JSON.stringify(data));
        }
      } catch (e) { console.warn('mis_formularios:', e); }
    }
    if (formularios.includes('taller') || formularios.includes('combustible')) await cargarCatalogos();
    sincronizar();
    return formularios;   // con esto se arma el menú
  }

  async function cargarCatalogos() {
    const cache = localStorage.getItem('fx_cat');
    if (cache) C = JSON.parse(cache);
    if (!navigator.onLine) return;
    try {
      const pedidos = [
        sb.from('equipos').select('id,descripcion,categoria,usa_horometro,usa_km,propiedad,operador_habitual,capacidad')
          .eq('activo', true).order('id')
      ];
      const conTaller = formularios.includes('taller');
      if (conTaller) {
        pedidos.push(
          sb.from('v_ot').select('numero,estado,nombre,equipo_id,equipo,trabajo_general,ubicacion,abierta_el')
            .in('estado', ['Solicitada', 'Abierta']).order('numero', { ascending: false }).limit(500),
          sb.from('ot_catalogo_trabajos').select('sistema,componente').eq('activo', true).order('orden'),
          sb.from('ot_checklist_plantillas').select('checklist,item,opciones').eq('activo', true).order('orden'),
          sb.from('v_ot_fallas').select('falla,sistema,usos').order('usos', { ascending: false }).order('falla'));
      }
      const r = await Promise.all(pedidos);
      const fallo = r.find(x => x.error);
      if (fallo) throw fallo.error;
      C.equipos = r[0].data || [];
      if (conTaller) {
        C.ots = r[1].data || [];
        C.trabajos = r[2].data || [];
        C.checklists = r[3].data || [];
        C.fallas = (r[4].data || []).map(f => f.falla);
      }
      C.cuando = new Date().toISOString();
      localStorage.setItem('fx_cat', JSON.stringify(C));
    } catch (e) {
      console.warn('No se pudieron refrescar los catálogos de taller/combustible:', e);
    }
  }

  function mostrar(n) {
    if (n === 'taller') { if (!t) t = tallerNuevo(); dibujarTaller(); cargarRecientes('taller'); }
    if (n === 'combustible') { if (!c) c = combNuevo(); dibujarComb(); cargarRecientes('combustible'); }
  }

  // ── Ayudas de catálogo ──────────────────────────────────────────
  const equipo = (id) => (C.equipos || []).find(e => e.id === id);
  const textoEquipo = (id) => { const e = equipo(id); return e ? `${e.id} · ${e.descripcion || ''}` : (id || ''); };
  const tanques = () => (C.equipos || []).filter(e => e.categoria === 'tanque');
  const nombreOperador = (ced) => {
    const o = (cat.operadores || []).find(x => x.v === ced);
    return o ? o.t.replace(/^[^_]*_/, '') : ced;
  };
  const otPorNumero = (n) => (C.ots || []).find(o => String(o.numero) === String(n));
  const otAbiertaDe = (eq) => (C.ots || []).find(o => o.equipo_id === eq);
  const sistemas = () => [...new Set((C.trabajos || []).map(x => x.sistema))];
  const componentes = (s) => (C.trabajos || []).filter(x => x.sistema === s).map(x => x.componente);
  const plantilla = (nombre) => (C.checklists || []).filter(x => x.checklist === nombre);
  const obraDe = (clave) => (cat.obras || []).some(o => o.v === clave) ? clave : null;
  const yoEnCatalogo = () => (cat.operadores || []).some(o => o.v === sesion.cedula) ? sesion.cedula : null;

  // ════════════════════════════════════════════════════════════════
  // SELECTOR CON BUSCADOR (simple o múltiple)
  // ════════════════════════════════════════════════════════════════
  let picker = null;
  function elegir({ titulo, opciones, multiple = false, actual = [], libre = false, alElegir }) {
    picker = { opciones, multiple, sel: new Set(multiple ? actual : []), alElegir, libre };
    let m = $('fx-modal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal'; m.id = 'fx-modal';
      m.onclick = (e) => { if (e.target === m) cerrarPicker(); };
      m.innerHTML = `<div class="modal-card">
        <div class="modal-head">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b id="fx-modal-titulo"></b>
            <button class="btn-mini btn-neutro" onclick="FX.cerrarPicker()">Cerrar</button></div>
          <input id="fx-modal-filtro" placeholder="Buscar..." oninput="FX.filtrarPicker()" autocomplete="off"></div>
        <div class="modal-list" id="fx-modal-lista"></div>
        <div id="fx-modal-pie" style="padding:10px 14px;border-top:1px solid var(--gris-borde);display:none">
          <button class="btn-submit" style="width:100%" onclick="FX.confirmarPicker()">Listo</button></div>
      </div>`;
      document.body.appendChild(m);
    }
    $('fx-modal-titulo').textContent = titulo;
    $('fx-modal-filtro').value = '';
    $('fx-modal-pie').style.display = multiple ? '' : 'none';
    filtrarPicker();
    m.classList.add('show');
    setTimeout(() => $('fx-modal-filtro').focus(), 80);
  }
  function filtrarPicker() {
    const q = $('fx-modal-filtro').value.trim().toLowerCase();
    const ops = picker.opciones.filter(o => !q || (o.t + ' ' + (o.d || '')).toLowerCase().includes(q)).slice(0, 300);
    let html = ops.map(o => {
      const on = picker.sel.has(o.v);
      return `<button data-v="${esc(o.v)}" onclick="FX.tocarOpcion(this.dataset.v)" style="${on ? 'background:#e3f4e9;font-weight:700' : ''}">
        ${picker.multiple ? (on ? '☑ ' : '☐ ') : ''}${esc(o.t)}
        ${o.d ? `<div style="font-size:12px;color:var(--gris-texto);font-weight:400">${esc(o.d)}</div>` : ''}</button>`;
    }).join('');
    if (picker.libre && q) {
      html += `<button data-v="${esc($('fx-modal-filtro').value.trim())}" onclick="FX.tocarOpcion(this.dataset.v)"
        style="color:var(--azul-medio)">➕ Usar “${esc($('fx-modal-filtro').value.trim())}”</button>`;
    }
    $('fx-modal-lista').innerHTML = html || '<div class="empty-state">Sin resultados</div>';
  }
  function tocarOpcion(v) {
    if (!picker.multiple) { const f = picker.alElegir; cerrarPicker(); f(v); return; }
    picker.sel.has(v) ? picker.sel.delete(v) : picker.sel.add(v);
    filtrarPicker();
  }
  function confirmarPicker() { const f = picker.alElegir, s = [...picker.sel]; cerrarPicker(); f(s); }
  function cerrarPicker() { const m = $('fx-modal'); if (m) m.classList.remove('show'); }

  // ── Piezas de formulario ────────────────────────────────────────
  const campo = (label, html, req, ayuda) => `<div class="field"><label>${label}${req ? ' <span class="req">*</span>' : ''}</label>${html}${ayuda ? `<div class="ayuda">${ayuda}</div>` : ''}</div>`;
  const boton = (texto, onclick, vacio) => `<button type="button" class="search-select${vacio ? ' vacio' : ''}" onclick="${onclick}">${esc(texto)}</button>`;
  const segmento = (ops, actual, onclick) => `<div class="fx-seg">${ops.map(o => {
    const v = typeof o === 'string' ? o : o.v, tx = typeof o === 'string' ? o : o.t;
    return `<button type="button" class="${String(actual) === String(v) ? 'on' : ''}" data-v="${esc(v)}" onclick="${onclick}">${esc(tx)}</button>`;
  }).join('')}</div>`;
  const entrada = (obj, k, tipo = 'text', extra = '') =>
    `<input type="${tipo}" value="${esc(obj[k] ?? '')}" ${tipo === 'number' ? 'inputmode="decimal" step="any"' : ''} ${extra}
       oninput="FX.poner('${obj === t ? 't' : 'c'}','${k}',this.value)">`;
  const area = (obj, k, ph) => `<textarea placeholder="${esc(ph || '')}" oninput="FX.poner('${obj === t ? 't' : 'c'}','${k}',this.value)">${esc(obj[k] ?? '')}</textarea>`;
  const lista = (ops, actual, k, form) => `<select onchange="FX.poner('${form}','${k}',this.value)"><option value="">Seleccionar...</option>${ops.map(o => `<option ${o === actual ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const tarjeta = (titulo, cuerpo, id) => `<div class="card"${id ? ` id="${id}"` : ''}><div class="card-header">${titulo}</div><div class="card-body">${cuerpo}</div></div>`;

  function campoFotos(form, k, titulo) {
    const l = (archivos[form + '.' + k] || []);
    return campo(titulo, `<div class="fx-fotos">${l.map((f, i) =>
      `<span class="fx-foto"><img src="${URL.createObjectURL(f)}"><button type="button" onclick="FX.quitarFoto('${form}','${k}',${i})">✕</button></span>`).join('')}
      ${l.length < MAX_FOTOS ? `<label class="fx-foto-mas" title="Sacar foto">📷<small>Cámara</small><input type="file" accept="image/*" capture="environment" style="display:none"
        onchange="FX.sumarFotos('${form}','${k}',this.files)"></label>
      <label class="fx-foto-mas" title="Elegir de la galería">🖼️<small>Galería</small><input type="file" accept="image/*" multiple style="display:none"
        onchange="FX.sumarFotos('${form}','${k}',this.files)"></label>` : ''}</div>`);
  }
  function sumarFotos(form, k, files) {
    const clave = form + '.' + k;
    archivos[clave] = (archivos[clave] || []).concat([...files]).slice(0, MAX_FOTOS);
    form === 't' ? dibujarTaller() : dibujarComb();
  }
  function quitarFoto(form, k, i) {
    archivos[form + '.' + k].splice(i, 1);
    form === 't' ? dibujarTaller() : dibujarComb();
  }

  // Cambiar un valor. Lo que es texto no redibuja (si no, se pierde el
  // foco al tipear); lo que cambia la forma del formulario, sí.
  function poner(form, k, v, redibujar) {
    const o = form === 't' ? t : c;
    o[k] = v;
    if (form === 'c' && ['cuenta_litros_inicial', 'cuenta_litros_final'].includes(k)) pintarLitros();
    if (redibujar) form === 't' ? dibujarTaller() : dibujarComb();
  }

  // ════════════════════════════════════════════════════════════════
  // TALLER
  // ════════════════════════════════════════════════════════════════
  function tallerNuevo(base) {
    return {
      client_id: nuevoId(),
      condicion: base?.condicion || 'Registro de Trabajos - OT',
      fecha: hoyISO(),
      tecnico_cedula: base?.tecnico_cedula ?? yoEnCatalogo(),
      obra_clave: base?.obra_clave || null,
      ubicacion_texto: base?.ubicacion_texto || '',
      tiene_ot: true, ot_numero: null,
      equipo_id: null, trabajo_general: null, nombre: '', tipo_ot: 'Taller', lider_cedula: null,
      fallas: [], sintomas: '', ingreso_por_averia: '', paro_maquina: '', fecha_ingreso: ahoraLocal(),
      fecha_estimada_cierre: '', estado_maquina_ingreso: '',
      tipo_medicion: 'Horómetro', lectura: '',
      sistemas: [], items: {},            // items["SISTEMA|COMPONENTE"] = {horas, estado}
      tipo_mantenimiento: '', horas_mantenimiento: '', horas_supervision_tercerizada: '',
      realizo_traslado: '', horas_traslado: '',
      boletas: [], estado_maquina: '', finaliza: '',
      checklist: {},                      // checklist["NOMBRE|ITEM"] = resultado
      chk_entrada: false, chk_es: false,
      detalle: '', observaciones: ''
    };
  }

  const cond = () => t.condicion;
  const abreOT = () => cond() === 'Diagnóstico Inicial - Generación OT' || cond() === 'Reporte de Fallas'
    || (cond() === 'Registro de Trabajos - OT' && !t.tiene_ot);
  const equipoDelForm = () => abreOT() ? t.equipo_id : (otPorNumero(t.ot_numero) || {}).equipo_id;

  function dibujarTaller() {
    const pantalla = $('screen-taller');
    if (!pantalla) return;
    const sc = window.scrollY;
    let h = `<div id="fx-taller-pend"></div>`;

    // ── Tipo de carga ──
    h += tarjeta('🛠️ Reporte de taller', `
      <div class="fx-cond">${CONDICIONES.map(o => `<button type="button" class="${t.condicion === o.v ? 'on' : ''}"
        onclick="FX.cambiarCondicion('${o.v}')"><b>${o.t}</b><span>${o.d}</span></button>`).join('')}</div>
      <div class="field-row">
        ${campo('Fecha', entrada(t, 'fecha', 'date'), true)}
      </div>
      ${campo('Personal', boton(t.tecnico_cedula ? nombreOperador(t.tecnico_cedula) : 'Seleccionar...', 'FX.elegirTecnico()', !t.tecnico_cedula), true)}
      ${campo('Ubicación', boton(t.obra_clave || t.ubicacion_texto || 'Seleccionar...', 'FX.elegirUbicacion()', !(t.obra_clave || t.ubicacion_texto)),
          false, 'Obra o lugar donde se hizo el trabajo')}
    `);

    // ── La OT ──
    h += tarjeta('📋 Orden de trabajo', bloqueOT());

    // ── Medición ──
    if (cond() !== 'Reporte de Fallas' || t.equipo_id) {
      h += tarjeta('⏱️ Medición', `
        ${segmento(['Horómetro', 'Odómetro'], t.tipo_medicion, "FX.poner('t','tipo_medicion',this.dataset.v,true)")}
        ${campo(t.tipo_medicion === 'Odómetro' ? 'Kilometraje' : 'Lectura del horómetro', entrada(t, 'lectura', 'number'))}
        ${cond() === 'Registro de Trabajos - OT' ? campoFotos('t', 'foto_lectura', 'Foto de la lectura') : ''}`);
    }

    if (cond() === 'Diagnóstico Inicial - Generación OT') h += bloqueChecklists('Revisión de entrada', CHK_ENTRADA, 'chk_entrada');
    if (cond() === 'Registro de Trabajos - OT') h += bloqueTrabajo();
    if (cond() === 'Cierre de OT - Taller') h += bloqueCierre();

    // ── Cierre del formulario ──
    const titDetalle = { 'Registro de Trabajos - OT': 'Detalle del trabajo realizado',
      'Diagnóstico Inicial - Generación OT': 'Diagnóstico', 'Reporte de Fallas': 'Descripción de la falla',
      'Cierre de OT - Taller': 'Detalle del cierre' }[cond()];
    h += tarjeta('📝 Detalle', `
      ${cond() !== 'Reporte de Fallas' && cond() !== 'Diagnóstico Inicial - Generación OT' ? campo(titDetalle, area(t, 'detalle')) : ''}
      ${campoFotos('t', 'fotos', cond() === 'Cierre de OT - Taller' ? 'Fotos de salida' : 'Fotos')}
      ${campo('Observaciones', area(t, 'observaciones'))}`);

    h += `<div class="form-nav"><button class="btn-submit" onclick="FX.enviarTaller()">Enviar reporte</button></div>`;
    h += `<div id="fx-taller-recientes"></div>`;
    pantalla.innerHTML = h;
    pintarPendientesDe('taller');
    pintarRecientes('taller');
    window.scrollTo(0, sc);
  }

  function bloqueOT() {
    let h = '';
    if (cond() === 'Registro de Trabajos - OT') {
      h += campo('¿Ya tenés número de OT?', segmento([{ v: 'si', t: 'Sí' }, { v: 'no', t: 'No, abrir una nueva' }],
        t.tiene_ot ? 'si' : 'no', "FX.poner('t','tiene_ot',this.dataset.v==='si',true)"));
    }
    if (!abreOT()) {
      const ot = otPorNumero(t.ot_numero);
      h += campo('OT', boton(t.ot_numero ? (ot ? `OT ${ot.numero} · ${ot.equipo_id || ot.trabajo_general || ''} · ${ot.nombre}` : `OT ${t.ot_numero}`)
        : 'Elegir la OT...', 'FX.elegirOT()', !t.ot_numero), true,
        ot ? `${ot.estado} desde el ${fechaCorta(ot.abierta_el)}${ot.ubicacion ? ' · ' + esc(ot.ubicacion) : ''}`
           : (t.ot_numero ? 'No está en la lista de OT abiertas de este teléfono: se verifica al enviar.' : ''));
      return h;
    }
    // Abre una OT nueva
    const general = cond() === 'Registro de Trabajos - OT';
    h += campo('Máquina', boton(t.equipo_id ? textoEquipo(t.equipo_id) : (t.trabajo_general || 'Seleccionar...'),
      'FX.elegirEquipo()', !(t.equipo_id || t.trabajo_general)), true,
      general ? 'Para trabajos sin máquina elegí SERVICIOS GENERALES, TRABAJOS INTERNOS TALLER u OTROS' : '');
    const abierta = t.equipo_id && otAbiertaDe(t.equipo_id);
    if (abierta && cond() !== 'Reporte de Fallas') {
      h += `<div class="aviso-caja">Esta máquina ya tiene la <b>OT ${abierta.numero}</b> (${esc(abierta.nombre)}) ${abierta.estado.toLowerCase()}.
        <button class="btn-mini btn-neutro" onclick="FX.usarOT(${abierta.numero})">Cargar en esa OT</button></div>`;
    }
    if (abierta && cond() === 'Reporte de Fallas') {
      h += `<div class="aviso-caja">Esta máquina ya tiene la OT ${abierta.numero} abierta: la falla se suma a esa OT.</div>`;
    }
    if (cond() !== 'Reporte de Fallas') h += campo('Nombre de la OT', entrada(t, 'nombre', 'text', 'placeholder="Ej.: Cambio de turbo"'), true);
    h += campo('Fallas', `${t.fallas.map(f => `<span class="chip amarillo" style="margin:0 4px 4px 0">${esc(f)}</span>`).join('')}
      ${boton(t.fallas.length ? 'Cambiar fallas...' : 'Elegir fallas...', 'FX.elegirFallas()', !t.fallas.length)}`,
      cond() !== 'Registro de Trabajos - OT');
    if (cond() !== 'Registro de Trabajos - OT') h += campo('Síntomas', area(t, 'sintomas', 'Qué se nota: ruido, humo, pérdida...'));
    if (cond() === 'Diagnóstico Inicial - Generación OT') {
      h += campo('Tipo de OT', segmento(['Taller', 'Pista'], t.tipo_ot, "FX.poner('t','tipo_ot',this.dataset.v,true)"));
      h += campo('Líder de la OT', boton(t.lider_cedula ? nombreOperador(t.lider_cedula) : 'Seleccionar...', 'FX.elegirLider()', !t.lider_cedula));
      h += campo('¿Ingresó por avería?', segmento([{ v: 'si', t: 'Sí' }, { v: 'no', t: 'No' }], t.ingreso_por_averia, "FX.poner('t','ingreso_por_averia',this.dataset.v,true)"));
      h += `<div class="field-row">${campo('Paro de la máquina', entrada(t, 'paro_maquina', 'datetime-local'))}
        ${campo('Ingreso a taller', entrada(t, 'fecha_ingreso', 'datetime-local'))}</div>`;
      h += campo('Fecha estimada de cierre', entrada(t, 'fecha_estimada_cierre', 'date'));
      h += campo('Estado de la máquina', lista(ESTADOS_MAQUINA, t.estado_maquina_ingreso, 'estado_maquina_ingreso', 't'), true);
    }
    return h;
  }

  function bloqueTrabajo() {
    let h = campo('Trabajo ejecutado', `<div class="fx-chips">${sistemas().map(s =>
      `<button type="button" class="${t.sistemas.includes(s) ? 'on' : ''}" data-v="${esc(s)}" onclick="FX.tocarSistema(this.dataset.v)">${esc(s)}</button>`).join('')}</div>`,
      false, 'Tocá los sistemas que trabajaste y cargá las horas de cada componente');
    for (const s of t.sistemas) {
      const conEstado = s !== 'SERVICIOS GENERALES';
      h += `<div class="rep-item"><div class="rep-title" style="margin-bottom:8px">Reporte diario · ${esc(s)}</div>
        <div class="fx-matriz">${componentes(s).map(comp => {
          const k = s + '|' + comp, it = t.items[k] || {};
          return `<div class="fx-fila${conEstado ? ' con-estado' : ''}"><span>${esc(comp)}</span>
            <input type="number" inputmode="decimal" step="0.5" min="0" placeholder="h" value="${esc(it.horas ?? '')}"
              data-k="${esc(k)}" oninput="FX.ponerItem(this.dataset.k,'horas',this.value)">
            ${conEstado ? `<select data-k="${esc(k)}" onchange="FX.ponerItem(this.dataset.k,'estado',this.value)">
              <option value="">Estado...</option>${ESTADOS_REPARACION.map(e => `<option ${it.estado === e ? 'selected' : ''}>${e}</option>`).join('')}</select>` : ''}
          </div>`;
        }).join('')}</div></div>`;
    }
    let mtto = campo('Tipo de mantenimiento', lista(TIPOS_MTTO, t.tipo_mantenimiento, 'tipo_mantenimiento', 't').replace('FX.poner(', 'FX.ponerRedibujar('),
      false, 'Solo si fue un mantenimiento preventivo (horas)');
    if (t.tipo_mantenimiento) {
      mtto += campo('Horas de mantenimiento', entrada(t, 'horas_mantenimiento', 'number'));
      const aceites = ['250', '500', '750'].includes(t.tipo_mantenimiento)
        ? 'Mantenimiento aceites 250-500-750' : 'Mantenimiento preventivo 1000-2000';
      mtto += ['Revisión de filtros', aceites, 'Checklist mantenimiento preventivo'].map(dibujarChecklist).join('');
    }
    h += mtto;
    h += `<div class="field-row">${campo('Horas supervisión tercerizada', entrada(t, 'horas_supervision_tercerizada', 'number'))}</div>`;
    h += campo('¿Realizó traslado?', segmento([{ v: 'si', t: 'Sí' }, { v: 'no', t: 'No' }], t.realizo_traslado, "FX.poner('t','realizo_traslado',this.dataset.v,true)"));
    if (t.realizo_traslado === 'si') h += campo('Horas de traslado', entrada(t, 'horas_traslado', 'number'));

    // Boletas de salida (repuestos)
    let bol = t.boletas.map((b, i) => `<div class="rep-item"><div class="rep-head"><span class="rep-title">Boleta ${i + 1}</span>
        <button class="remove-btn" onclick="FX.quitarBoleta(${i})">✕</button></div>
        <div class="field-row">${campo('Número', `<input type="text" value="${esc(b.numero)}" oninput="FX.ponerBoleta(${i},'numero',this.value)">`)}
        ${campo('Fecha de salida', `<input type="date" value="${esc(b.fecha)}" oninput="FX.ponerBoleta(${i},'fecha',this.value)">`)}</div></div>`).join('');
    bol += `<button class="add-btn" onclick="FX.sumarBoleta()">+ Agregar boleta de salida</button>`;
    h += campo('Boletas de salida de repuestos', bol);
    if (t.boletas.length) h += campoFotos('t', 'fotos_boletas', 'Fotos de las boletas');

    h += campo('Estado de la máquina', lista(ESTADOS_MAQUINA, t.estado_maquina, 'estado_maquina', 't'), !!equipoDelForm());
    h += campo('¿Trabajo finalizado?', segmento([{ v: 'si', t: 'Sí, cierra la OT' }, { v: 'no', t: 'No, sigue' }], t.finaliza,
      "FX.poner('t','finaliza',this.dataset.v,true)"), true);
    return tarjeta('🔧 Trabajo realizado', h);
  }

  function bloqueCierre() {
    let h = campo('Sistemas intervenidos', `<div class="fx-chips">${sistemas().map(s =>
      `<button type="button" class="${t.sistemas.includes(s) ? 'on' : ''}" data-v="${esc(s)}" onclick="FX.tocarSistema(this.dataset.v)">${esc(s)}</button>`).join('')}</div>`, true);
    h += campo('Estado de la máquina a la salida', lista(ESTADOS_SALIDA, t.estado_maquina, 'estado_maquina', 't'), true);
    const lst = ['Salida - Generales', ...t.sistemas.map(s => CHK_SALIDA_SISTEMA[s]).filter(Boolean)];
    h += lst.map(dibujarChecklist).join('');
    h += campo('', `<label class="fx-check"><input type="checkbox" ${t.chk_es ? 'checked' : ''}
      onchange="FX.poner('t','chk_es',this.checked,true)"> Agregar la revisión de entrada/salida completa</label>`);
    if (t.chk_es) h += dibujarChecklist('Salida - Revisión de Entrada/Salida');
    return tarjeta('✅ Cierre de la OT', h);
  }

  function bloqueChecklists(titulo, nombres, bandera) {
    let h = `<label class="fx-check"><input type="checkbox" ${t[bandera] ? 'checked' : ''}
      onchange="FX.poner('t','${bandera}',this.checked,true)"> Completar la revisión (opcional)</label>`;
    if (t[bandera]) h += nombres.map(dibujarChecklist).join('');
    return tarjeta('🔍 ' + titulo, h);
  }

  function dibujarChecklist(nombre) {
    const items = plantilla(nombre);
    if (!items.length) return '';
    const ops = items[0].opciones || [];
    return `<div class="rep-item"><div class="rep-head"><span class="rep-title">${esc(nombre)}</span>
      <span class="fx-todo">Todo: ${ops.map(o => `<button type="button" data-c="${esc(nombre)}" data-v="${esc(o)}"
        onclick="FX.checklistTodo(this.dataset.c,this.dataset.v)">${esc(o)}</button>`).join('')}</span></div>
      ${items.map(it => {
        const k = nombre + '|' + it.item, v = t.checklist[k];
        return `<div class="fx-chk"><div>${esc(it.item)}</div><div class="fx-seg chico">${(it.opciones || ops).map(o =>
          `<button type="button" class="${v === o ? 'on' : ''}" data-k="${esc(k)}" data-v="${esc(o)}"
            onclick="FX.ponerChecklist(this.dataset.k,this.dataset.v)">${esc(o)}</button>`).join('')}</div></div>`;
      }).join('')}</div>`;
  }

  // ── Acciones del formulario de taller ──
  function cambiarCondicion(v) {
    const base = { condicion: v, tecnico_cedula: t.tecnico_cedula, obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto };
    const otPrevia = t.ot_numero;
    t = tallerNuevo(base);
    if (v === 'Cierre de OT - Taller') t.ot_numero = otPrevia;
    archivos = Object.fromEntries(Object.entries(archivos).filter(([k]) => !k.startsWith('t.')));
    dibujarTaller();
  }
  function elegirTecnico() {
    elegir({ titulo: 'Personal', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
      alElegir: v => poner('t', 'tecnico_cedula', v, true) });
  }
  function elegirLider() {
    elegir({ titulo: 'Líder de la OT', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
      alElegir: v => poner('t', 'lider_cedula', v, true) });
  }
  function elegirUbicacion() {
    elegir({ titulo: 'Ubicación', libre: true,
      opciones: [{ v: 'TALLER CENTRAL', t: 'TALLER CENTRAL' }, ...(cat.obras || []).map(o => ({ v: o.v, t: o.t }))],
      alElegir: v => {
        if (obraDe(v)) { t.obra_clave = v; t.ubicacion_texto = ''; } else { t.obra_clave = null; t.ubicacion_texto = v; }
        dibujarTaller();
      } });
  }
  function elegirOT() {
    const ops = (C.ots || []).map(o => ({ v: String(o.numero),
      t: `OT ${o.numero} · ${o.equipo_id || o.trabajo_general || ''}`,
      d: `${o.nombre} · ${o.estado}${o.ubicacion ? ' · ' + o.ubicacion : ''}` }));
    elegir({ titulo: 'OT abiertas', opciones: ops, libre: true,
      alElegir: v => {
        const n = String(v).replace(/\D/g, '');
        if (!n) return toast('Escribí el número de OT', 'warning');
        t.ot_numero = n;
        const ot = otPorNumero(n);
        const e = ot && equipo(ot.equipo_id);
        if (e) t.tipo_medicion = e.usa_km && !e.usa_horometro ? 'Odómetro' : 'Horómetro';
        dibujarTaller();
      } });
  }
  function usarOT(n) { t.tiene_ot = true; t.ot_numero = String(n); t.equipo_id = null; dibujarTaller(); }
  function elegirEquipo() {
    const ops = (C.equipos || []).filter(e => e.categoria !== 'tanque' || cond() !== 'Diagnóstico Inicial - Generación OT')
      .map(e => ({ v: e.id, t: `${e.id} · ${e.descripcion || ''}`, d: e.propiedad === 'Tercero' ? 'De tercero' : '' }));
    const gen = cond() === 'Registro de Trabajos - OT' ? TRABAJOS_GENERALES.map(g => ({ v: '§' + g, t: g, d: 'Trabajo sin máquina' })) : [];
    elegir({ titulo: 'Máquina', opciones: [...gen, ...ops],
      alElegir: v => {
        if (v.startsWith('§')) { t.trabajo_general = v.slice(1); t.equipo_id = null; }
        else {
          t.equipo_id = v; t.trabajo_general = null;
          const e = equipo(v);
          if (e) t.tipo_medicion = e.usa_km && !e.usa_horometro ? 'Odómetro' : 'Horómetro';
        }
        dibujarTaller();
      } });
  }
  function elegirFallas() {
    elegir({ titulo: 'Fallas', multiple: true, libre: true, actual: t.fallas,
      opciones: (C.fallas || []).map(f => ({ v: f, t: f })),
      alElegir: l => { t.fallas = l; dibujarTaller(); } });
  }
  function tocarSistema(s) {
    t.sistemas = t.sistemas.includes(s) ? t.sistemas.filter(x => x !== s) : [...t.sistemas, s];
    dibujarTaller();
  }
  function ponerItem(k, campoItem, v) { (t.items[k] = t.items[k] || {})[campoItem] = v; }
  function ponerChecklist(k, v) {
    t.checklist[k] = t.checklist[k] === v ? undefined : v;
    dibujarTaller();
  }
  function checklistTodo(nombre, v) {
    plantilla(nombre).forEach(it => { t.checklist[nombre + '|' + it.item] = v; });
    dibujarTaller();
  }
  function ponerRedibujar(form, k, v) { poner(form, k, v, true); }
  function sumarBoleta() { t.boletas.push({ numero: '', fecha: t.fecha }); dibujarTaller(); }
  function quitarBoleta(i) { t.boletas.splice(i, 1); dibujarTaller(); }
  function ponerBoleta(i, k, v) { t.boletas[i][k] = v; }

  // ── Validar y armar el envío ──
  function validarTaller() {
    const faltan = [];
    if (!t.fecha) faltan.push('la fecha');
    if (!t.tecnico_cedula) faltan.push('el personal');
    if (abreOT()) {
      if (!t.equipo_id && !t.trabajo_general) faltan.push('la máquina');
      if (cond() !== 'Reporte de Fallas' && !t.nombre.trim()) faltan.push('el nombre de la OT');
      if (cond() !== 'Registro de Trabajos - OT' && !t.fallas.length) faltan.push('al menos una falla');
      if (cond() === 'Diagnóstico Inicial - Generación OT' && !t.estado_maquina_ingreso) faltan.push('el estado de la máquina');
    } else if (!t.ot_numero) faltan.push('la OT');
    if (cond() === 'Registro de Trabajos - OT') {
      const horas = Object.values(t.items).some(i => num(i.horas) > 0 || i.estado);
      if (!horas && !num(t.horas_mantenimiento) && !t.detalle.trim()) faltan.push('las horas o el detalle del trabajo');
      if (equipoDelForm() && !t.estado_maquina) faltan.push('el estado de la máquina');
      if (!t.finaliza) faltan.push('si el trabajo quedó finalizado');
    }
    if (cond() === 'Cierre de OT - Taller') {
      if (!t.sistemas.length) faltan.push('los sistemas intervenidos');
      if (!t.estado_maquina) faltan.push('el estado de salida');
    }
    const neg = [t.lectura, t.horas_mantenimiento, t.horas_traslado, t.horas_supervision_tercerizada,
      ...Object.values(t.items).map(i => i.horas)].some(v => num(v) !== null && num(v) < 0);
    if (neg) faltan.push('números sin signo negativo');
    const muchas = Object.values(t.items).reduce((a, i) => a + (num(i.horas) || 0), 0);
    if (muchas > 24) return 'Las horas del día suman ' + muchas + ' h: revisalas (máximo 24).';
    return faltan.length ? 'Falta completar: ' + faltan.join(', ') + '.' : null;
  }

  function armarTaller() {
    const items = Object.entries(t.items)
      .filter(([k]) => t.sistemas.includes(k.split('|')[0]))
      .map(([k, i]) => ({ sistema: k.split('|')[0], componente: k.split('|').slice(1).join('|'),
        horas: num(i.horas), estado_reparacion: i.estado || null }))
      .filter(i => (i.horas || 0) > 0 || i.estado_reparacion);
    // Solo los checklists que se ven en pantalla
    const visibles = new Set();
    if (cond() === 'Diagnóstico Inicial - Generación OT' && t.chk_entrada) CHK_ENTRADA.forEach(x => visibles.add(x));
    if (cond() === 'Registro de Trabajos - OT' && t.tipo_mantenimiento) {
      visibles.add('Revisión de filtros'); visibles.add('Checklist mantenimiento preventivo');
      visibles.add(['250', '500', '750'].includes(t.tipo_mantenimiento) ? 'Mantenimiento aceites 250-500-750' : 'Mantenimiento preventivo 1000-2000');
    }
    if (cond() === 'Cierre de OT - Taller') {
      visibles.add('Salida - Generales');
      t.sistemas.forEach(s => CHK_SALIDA_SISTEMA[s] && visibles.add(CHK_SALIDA_SISTEMA[s]));
      if (t.chk_es) visibles.add('Salida - Revisión de Entrada/Salida');
    }
    const checklist = Object.entries(t.checklist).filter(([k, v]) => v && visibles.has(k.split('|')[0]))
      .map(([k, v]) => ({ checklist: k.split('|')[0], item: k.split('|').slice(1).join('|'), resultado: v }));

    const reg = cond() === 'Registro de Trabajos - OT', cie = cond() === 'Cierre de OT - Taller';
    const d = {
      client_id: t.client_id, condicion: cond(), fecha: t.fecha,
      tecnico_cedula: t.tecnico_cedula, obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto || null,
      trabajo_ejecutado: (reg || cie) ? t.sistemas : [],
      fallas: t.fallas,
      tipo_medicion: num(t.lectura) !== null ? t.tipo_medicion : null, lectura: num(t.lectura),
      tipo_mantenimiento: reg ? (t.tipo_mantenimiento || null) : null,
      horas_mantenimiento: reg && t.tipo_mantenimiento ? num(t.horas_mantenimiento) : null,
      horas_supervision_tercerizada: reg ? num(t.horas_supervision_tercerizada) : null,
      realizo_traslado: reg && t.realizo_traslado ? t.realizo_traslado === 'si' : null,
      horas_traslado: reg && t.realizo_traslado === 'si' ? num(t.horas_traslado) : null,
      estado_maquina: (reg || cie) ? (t.estado_maquina || null)
        : (cond() === 'Diagnóstico Inicial - Generación OT' ? t.estado_maquina_ingreso : null),
      finaliza_ot: cie || (reg && t.finaliza === 'si'),
      boletas_salida: reg ? t.boletas.filter(b => b.numero || b.fecha) : [],
      detalle: (cond() === 'Reporte de Fallas' || cond() === 'Diagnóstico Inicial - Generación OT') ? (t.sintomas || null) : (t.detalle || null),
      observaciones: t.observaciones || null,
      items: reg ? items : [], checklist
    };
    if (abreOT()) {
      d.ot_nueva = {
        nombre: cond() === 'Reporte de Fallas' ? 'Reporte de falla: ' + (t.fallas[0] || 'sin detalle') : t.nombre.trim(),
        equipo_id: t.equipo_id, trabajo_general: t.trabajo_general,
        tipo_ot: cond() === 'Diagnóstico Inicial - Generación OT' ? t.tipo_ot : null,
        lider_cedula: t.lider_cedula, fallas: t.fallas, sintomas: t.sintomas || null,
        ingreso_por_averia: t.ingreso_por_averia ? t.ingreso_por_averia === 'si' : null,
        paro_maquina: t.paro_maquina ? new Date(t.paro_maquina).toISOString() : null,
        fecha_ingreso: cond() === 'Diagnóstico Inicial - Generación OT' && t.fecha_ingreso ? new Date(t.fecha_ingreso).toISOString() : null,
        fecha_estimada_cierre: t.fecha_estimada_cierre || null,
        estado_maquina_ingreso: cond() === 'Diagnóstico Inicial - Generación OT' ? t.estado_maquina_ingreso : null
      };
    } else {
      d.ot_numero = Number(t.ot_numero);
    }
    return d;
  }

  async function enviarTaller() {
    if (enviando) return;
    const err = validarTaller();
    if (err) return toast(err, 'warning');
    const d = armarTaller();
    const ot = d.ot_numero ? `OT ${d.ot_numero}` : ('OT nueva · ' + (t.equipo_id || t.trabajo_general));
    const resumen = `${CONDICIONES.find(x => x.v === d.condicion).t} · ${ot}`;
    enviando = true;
    try {
      await encolar('taller', d, resumen, { foto_lectura: 'foto_lectura', fotos: 'fotos', fotos_boletas: 'fotos_boletas' }, 't');
      toast('Reporte guardado. Se envía ahora o apenas haya señal.', 'success');
      t = tallerNuevo({ condicion: 'Registro de Trabajos - OT', tecnico_cedula: t.tecnico_cedula,
        obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto });
      dibujarTaller();
      window.scrollTo(0, 0);
      await sincronizar();
    } finally { enviando = false; }
  }

  // ════════════════════════════════════════════════════════════════
  // COMBUSTIBLE
  // ════════════════════════════════════════════════════════════════
  function combNuevo(base) {
    return {
      client_id: nuevoId(),
      actividad: base?.actividad || 'Despacho de combustible',
      fecha: hoyISO(), hora: ahoraHora(),
      obra_clave: base?.obra_clave || (sesion.obras && sesion.obras[0]) || null,
      despachador_cedula: base?.despachador_cedula ?? yoEnCatalogo(),
      tanque: base?.tanque || null,
      propietario: 'Tecsul',
      equipo_id: null, operador_cedula: null, receptor_texto: '', operador_texto: '',
      tipo_medicion: 'Horómetro', lectura: '',
      cuenta_litros_inicial: '', cuenta_litros_final: '', litros: '',
      proveedor: '', litros_ingresados: '', stock_medido: '',
      prueba_desviacion_1: '', prueba_desviacion_2: '', prueba_desviacion_3: '',
      nro_boleta: '', observaciones: ''
    };
  }
  const desp = () => c.actividad === 'Despacho de combustible';

  function dibujarComb() {
    const pantalla = $('screen-combustible');
    if (!pantalla) return;
    const sc = window.scrollY;
    const tq = equipo(c.tanque);
    let h = `<div id="fx-combustible-pend"></div>`;
    h += tarjeta('⛽ Carga de combustible', `
      ${campo('Actividad realizada', segmento(ACTIVIDADES, c.actividad, 'FX.cambiarActividad(this.dataset.v)'), true)}
      <div class="field-row">${campo('Fecha', entrada(c, 'fecha', 'date'), true)}${campo('Hora', entrada(c, 'hora', 'time'))}</div>
      ${campo('Obra', boton(c.obra_clave || 'Seleccionar...', 'FX.elegirObraComb()', !c.obra_clave))}
      ${campo('Despachador', boton(c.despachador_cedula ? nombreOperador(c.despachador_cedula) : 'Seleccionar...', 'FX.elegirDespachador()', !c.despachador_cedula), true)}
    `);

    const tituloTanque = { 'Despacho de combustible': 'Tanque de salida', 'Ingreso de combustible': 'Tanque fijo que recibe',
      'Medición de tanque': 'Tanque medido', 'Prueba de desviación': 'Tanque / surtidor' }[c.actividad];
    let cuerpo = campo(tituloTanque, boton(tq ? textoEquipo(tq.id) : 'Seleccionar...', 'FX.elegirTanque()', !tq), true,
      tq && tq.capacidad ? `Capacidad: ${Number(tq.capacidad).toLocaleString('es-PY')} L` : '');

    if (desp()) {
      cuerpo += campo('El que recibe es', segmento([{ v: 'Tecsul', t: 'Equipo Tecsul' }, { v: 'Tercero/alquilado', t: 'Tercero / alquilado' }],
        c.propietario, "FX.poner('c','propietario',this.dataset.v,true)"), true);
      if (c.propietario === 'Tecsul') {
        cuerpo += campo('Equipo que recibe', boton(c.equipo_id ? textoEquipo(c.equipo_id) : 'Seleccionar...', 'FX.elegirReceptor()', !c.equipo_id), true,
          equipo(c.equipo_id)?.categoria === 'tanque' ? 'Es un tanque: queda como traspaso entre tanques' : '');
        cuerpo += campo('Operador', boton(c.operador_cedula ? nombreOperador(c.operador_cedula) : 'Seleccionar...', 'FX.elegirOperadorComb()', !c.operador_cedula));
      } else {
        cuerpo += campo('Chapa / descripción del equipo', entrada(c, 'receptor_texto', 'text', 'placeholder="Ej.: XBCD 123 camión volquete"'), true);
        cuerpo += campo('Operador / chofer', entrada(c, 'operador_texto'));
      }
      cuerpo += segmento(['Horómetro', 'Odómetro'], c.tipo_medicion, "FX.poner('c','tipo_medicion',this.dataset.v,true)");
      cuerpo += campo(c.tipo_medicion === 'Odómetro' ? 'Kilometraje' : 'Horómetro', entrada(c, 'lectura', 'number'));
      cuerpo += `<div class="field-row">${campo('Cuenta litros inicial', entrada(c, 'cuenta_litros_inicial', 'number'), false, c._ultimo || '')}
        ${campo('Cuenta litros final', entrada(c, 'cuenta_litros_final', 'number'))}</div>
        <div class="field-alert" id="fx-litros-alerta"></div>`;
      cuerpo += campo('Litros despachados', entrada(c, 'litros', 'number', 'id="fx-litros"'), true, 'Se calcula solo con el cuenta litros; si no hay, cargalo a mano');
      cuerpo += campo('Nº de boleta / remisión', entrada(c, 'nro_boleta'));
      cuerpo += campoFotos('c', 'foto_cuenta_inicial', 'Foto cuenta litros inicial');
      cuerpo += campoFotos('c', 'foto_cuenta_final', 'Foto cuenta litros final');
      cuerpo += campoFotos('c', 'foto_boleta', 'Foto de la boleta');
    }
    if (c.actividad === 'Ingreso de combustible') {
      cuerpo += campo('Proveedor', entrada(c, 'proveedor'), true);
      cuerpo += campo('Litros ingresados', entrada(c, 'litros_ingresados', 'number'), true);
      cuerpo += campo('Nº de boleta / remisión', entrada(c, 'nro_boleta'));
      cuerpo += campoFotos('c', 'foto_boleta', 'Foto de la boleta');
    }
    if (c.actividad === 'Medición de tanque') {
      cuerpo += campo('Cantidad de combustible en el tanque (litros)', entrada(c, 'stock_medido', 'number'), true);
    }
    if (c.actividad === 'Prueba de desviación') {
      cuerpo += `<div class="field-row">${campo('1ra prueba', entrada(c, 'prueba_desviacion_1', 'number'), true)}
        ${campo('2da prueba', entrada(c, 'prueba_desviacion_2', 'number'))}${campo('3ra prueba', entrada(c, 'prueba_desviacion_3', 'number'))}</div>`;
    }
    cuerpo += campo('Observaciones', area(c, 'observaciones'));
    h += tarjeta(ACTIVIDADES.find(a => a.v === c.actividad).t, cuerpo);
    h += `<div class="form-nav"><button class="btn-submit" onclick="FX.enviarComb()">Enviar</button></div>`;
    h += `<div id="fx-combustible-recientes"></div>`;
    pantalla.innerHTML = h;
    pintarLitros();
    pintarPendientesDe('combustible');
    pintarRecientes('combustible');
    window.scrollTo(0, sc);
  }

  function pintarLitros() {
    if (!desp()) return;
    const i = num(c.cuenta_litros_inicial), f = num(c.cuenta_litros_final);
    const al = $('fx-litros-alerta');
    if (i !== null && f !== null) {
      if (f < i) {
        if (al) { al.textContent = 'El cuenta litros final es menor que el inicial.'; al.classList.add('show'); }
        return;
      }
      c.litros = String(Math.round((f - i) * 10) / 10);
      const el = $('fx-litros'); if (el) el.value = c.litros;
    }
    if (al) al.classList.remove('show');
  }

  function cambiarActividad(v) {
    c = combNuevo({ actividad: v, obra_clave: c.obra_clave, despachador_cedula: c.despachador_cedula, tanque: c.tanque });
    archivos = Object.fromEntries(Object.entries(archivos).filter(([k]) => !k.startsWith('c.')));
    dibujarComb();
    if (desp() && c.tanque) precargarCuentaLitros();
  }
  function elegirObraComb() {
    let obras = cat.obras || [];
    if (sesion.rol === 'admin_obra' && sesion.obras && sesion.obras.length) obras = obras.filter(o => sesion.obras.includes(o.v));
    elegir({ titulo: 'Obra', opciones: obras.map(o => ({ v: o.v, t: o.t })), alElegir: v => poner('c', 'obra_clave', v, true) });
  }
  function elegirDespachador() {
    elegir({ titulo: 'Despachador', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
      alElegir: v => poner('c', 'despachador_cedula', v, true) });
  }
  function elegirTanque() {
    elegir({ titulo: 'Tanque', opciones: tanques().map(e => ({ v: e.id, t: `${e.id} · ${e.descripcion || ''}`,
      d: e.capacidad ? Number(e.capacidad).toLocaleString('es-PY') + ' L' : '' })),
      alElegir: v => { c.tanque = v; dibujarComb(); if (desp()) precargarCuentaLitros(); } });
  }
  function elegirReceptor() {
    elegir({ titulo: 'Equipo que recibe', opciones: (C.equipos || []).filter(e => e.id !== c.tanque)
      .map(e => ({ v: e.id, t: `${e.id} · ${e.descripcion || ''}`, d: e.categoria === 'tanque' ? 'Tanque (traspaso)' : (e.propiedad === 'Tercero' ? 'De tercero' : '') })),
      alElegir: v => {
        c.equipo_id = v;
        const e = equipo(v);
        if (e) {
          c.tipo_medicion = e.usa_km && !e.usa_horometro ? 'Odómetro' : 'Horómetro';
          if (!c.operador_cedula && e.operador_habitual) c.operador_cedula = e.operador_habitual;
        }
        dibujarComb();
      } });
  }
  function elegirOperadorComb() {
    elegir({ titulo: 'Operador', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
      alElegir: v => poner('c', 'operador_cedula', v, true) });
  }

  // El cuenta litros inicial es el final del despacho anterior del
  // mismo tanque: primero lo que se cargó en este teléfono (puede no
  // haber subido todavía), si no, lo que dice la base.
  async function precargarCuentaLitros() {
    const tq = c.tanque;
    const local = JSON.parse(localStorage.getItem('fx_cuentalitros') || '{}')[tq];
    let mejor = local ? { v: local.v, cuando: local.cuando, txt: 'de tu último despacho' } : null;
    if (navigator.onLine) {
      try {
        const { data } = await sb.rpc('ultimo_cuentalitros', { p_tanque: tq });
        const r = data && data[0];
        if (r && r.cuenta_litros !== null) {
          const cuando = r.fecha + 'T' + (r.hora || '00:00');
          if (!mejor || cuando > mejor.cuando) mejor = { v: r.cuenta_litros, cuando, txt: `del ${fechaCorta(r.fecha)}${r.equipo ? ' (' + r.equipo + ')' : ''}` };
        }
      } catch (e) { /* sin señal o sin datos */ }
    }
    if (c.tanque !== tq || !mejor || c.cuenta_litros_inicial) return;
    c.cuenta_litros_inicial = String(mejor.v);
    c._ultimo = `Precargado: final ${mejor.txt}. Corregilo si no coincide.`;
    dibujarComb();
  }

  function validarComb() {
    const f = [];
    if (!c.fecha) f.push('la fecha');
    if (!c.despachador_cedula) f.push('el despachador');
    if (!c.tanque) f.push('el tanque');
    if (desp()) {
      if (c.propietario === 'Tecsul' && !c.equipo_id) f.push('el equipo que recibe');
      if (c.propietario !== 'Tecsul' && !c.receptor_texto.trim()) f.push('la chapa del equipo que recibe');
      if (!(num(c.litros) > 0)) f.push('los litros despachados');
      if (num(c.cuenta_litros_inicial) !== null && num(c.cuenta_litros_final) !== null
          && num(c.cuenta_litros_final) < num(c.cuenta_litros_inicial)) return 'El cuenta litros final no puede ser menor que el inicial.';
    }
    if (c.actividad === 'Ingreso de combustible') {
      if (!c.proveedor.trim()) f.push('el proveedor');
      if (!(num(c.litros_ingresados) > 0)) f.push('los litros ingresados');
    }
    if (c.actividad === 'Medición de tanque' && num(c.stock_medido) === null) f.push('la cantidad medida');
    if (c.actividad === 'Prueba de desviación' && num(c.prueba_desviacion_1) === null) f.push('la 1ra prueba');
    return f.length ? 'Falta completar: ' + f.join(', ') + '.' : null;
  }

  function armarComb() {
    const tecsul = c.propietario === 'Tecsul';
    const fila = {
      client_id: c.client_id, actividad: c.actividad, fecha: c.fecha, hora: c.hora || null,
      despachador_cedula: c.despachador_cedula, obra_clave: c.obra_clave,
      observaciones: c.observaciones || null, usuario_id: sesion.id
    };
    if (desp()) Object.assign(fila, {
      tanque_salida_id: c.tanque, propietario: c.propietario,
      equipo_id: tecsul ? c.equipo_id : null, operador_cedula: tecsul ? c.operador_cedula : null,
      receptor_texto: tecsul ? null : c.receptor_texto.trim(), operador_texto: tecsul ? null : (c.operador_texto || null),
      tipo_medicion: num(c.lectura) !== null ? c.tipo_medicion : null,
      horometro: c.tipo_medicion === 'Horómetro' ? num(c.lectura) : null,
      odometro: c.tipo_medicion === 'Odómetro' ? num(c.lectura) : null,
      cuenta_litros_inicial: num(c.cuenta_litros_inicial), cuenta_litros_final: num(c.cuenta_litros_final),
      litros: num(c.litros), nro_boleta: c.nro_boleta || null
    });
    if (c.actividad === 'Ingreso de combustible') Object.assign(fila, {
      tanque_fijo_id: c.tanque, proveedor: c.proveedor.trim(), litros_ingresados: num(c.litros_ingresados),
      nro_boleta: c.nro_boleta || null });
    if (c.actividad === 'Medición de tanque') Object.assign(fila, { tanque_fijo_id: c.tanque, stock_medido: num(c.stock_medido) });
    if (c.actividad === 'Prueba de desviación') Object.assign(fila, { tanque_fijo_id: c.tanque,
      prueba_desviacion_1: num(c.prueba_desviacion_1), prueba_desviacion_2: num(c.prueba_desviacion_2),
      prueba_desviacion_3: num(c.prueba_desviacion_3) });
    return fila;
  }

  async function enviarComb() {
    if (enviando) return;
    const err = validarComb();
    if (err) return toast(err, 'warning');
    const fila = armarComb();
    const resumen = desp()
      ? `${fila.litros} L · ${fila.tanque_salida_id} → ${fila.equipo_id || fila.receptor_texto}`
      : `${ACTIVIDADES.find(a => a.v === c.actividad).t} · ${c.tanque}`;
    enviando = true;
    try {
      await encolar('combustible', fila, resumen,
        { foto_boleta: 'foto_boleta', foto_cuenta_inicial: 'foto_cuenta_inicial', foto_cuenta_final: 'foto_cuenta_final' }, 'c');
      if (desp() && fila.cuenta_litros_final !== null) {
        const m = JSON.parse(localStorage.getItem('fx_cuentalitros') || '{}');
        m[c.tanque] = { v: fila.cuenta_litros_final, cuando: fila.fecha + 'T' + (fila.hora || '00:00') };
        localStorage.setItem('fx_cuentalitros', JSON.stringify(m));
      }
      toast('Guardado. Se envía ahora o apenas haya señal.', 'success');
      const finalAnterior = fila.cuenta_litros_final;
      c = combNuevo({ actividad: c.actividad, obra_clave: c.obra_clave, despachador_cedula: c.despachador_cedula, tanque: c.tanque });
      if (desp() && finalAnterior !== null) {
        c.cuenta_litros_inicial = String(finalAnterior);
        c._ultimo = 'Precargado: final del despacho que acabás de cargar.';
      }
      dibujarComb();
      window.scrollTo(0, 0);
      await sincronizar();
    } finally { enviando = false; }
  }

  // ════════════════════════════════════════════════════════════════
  // COLA LOCAL Y ENVÍO
  // ════════════════════════════════════════════════════════════════
  const cola = () => JSON.parse(localStorage.getItem(COLA) || '[]');
  const guardar = (l) => localStorage.setItem(COLA, JSON.stringify(l));

  async function encolar(tipo, datos, resumen, camposFoto, form) {
    const fotos = {};
    for (const k of Object.keys(camposFoto)) {
      const l = archivos[form + '.' + k] || [];
      if (!l.length) continue;
      try { fotos[k] = await Promise.all(l.map(f => aBase64(f))); }
      catch (e) { toast('Una foto no se pudo procesar; se guarda sin ella.', 'warning'); }
      delete archivos[form + '.' + k];
    }
    const l = cola();
    l.push({ tipo, id: datos.client_id, resumen, fecha: datos.fecha, datos, fotos, creado: new Date().toISOString() });
    try { guardar(l); }
    catch (e) {
      // Sin lugar en el teléfono: se guarda sin fotos antes que perderlo.
      l[l.length - 1].fotos = {};
      guardar(l);
      toast('El teléfono no tiene lugar para las fotos: se guardó sin ellas.', 'warning');
    }
  }

  let sincronizandoOtros = false;
  async function sincronizar() {
    if (sincronizandoOtros || !navigator.onLine || !sesion) return;
    const l = cola();
    if (!l.length) { pintarPendientesDe('taller'); pintarPendientesDe('combustible'); return; }
    sincronizandoOtros = true;
    let ok = 0, mal = 0;
    try {
      for (const p of l) {
        try {
          const bucket = p.tipo === 'taller' ? 'taller' : 'combustible';
          const d = JSON.parse(JSON.stringify(p.datos));
          for (const [k, lista] of Object.entries(p.fotos || {})) {
            const rutas = [];
            for (let i = 0; i < lista.length; i++) {
              const r = await subir(bucket, lista[i], `${p.id}/${k}${lista.length > 1 ? '_' + (i + 1) : ''}`);
              if (!r) throw new Error('No se pudo subir una foto (señal débil). Se reintenta solo.');
              rutas.push(r);
            }
            const unica = p.tipo === 'combustible' || k === 'foto_lectura';
            d[k] = unica ? rutas[0] : rutas;
          }
          if (p.tipo === 'taller') {
            if (d.ot_nueva && d.condicion === 'Diagnóstico Inicial - Generación OT') d.ot_nueva.imagenes = d.fotos || [];
            const { data, error } = await sb.rpc('ot_registrar', { p: d });
            if (error) throw error;
            p.numero = data && data.numero;
          } else {
            const { error } = await sb.from('combustible_movimientos')
              .upsert(d, { onConflict: 'client_id', ignoreDuplicates: true });
            if (error) throw error;
          }
          quitar(p.id);
          ok++;
          if (p.tipo === 'taller' && p.numero && p.datos.ot_nueva) toast(`Enviado: OT ${p.numero}`, 'success');
        } catch (e) {
          console.warn('No se pudo enviar', p.tipo, e);
          marcar(p.id, e.message || String(e));
          mal++;
        }
      }
    } finally { sincronizandoOtros = false; }
    if (ok) {
      recientes = { taller: null, combustible: null };
      if (formularios.includes('taller')) refrescarOTs();
      if ($('screen-taller')?.classList.contains('active')) cargarRecientes('taller');
      if ($('screen-combustible')?.classList.contains('active')) cargarRecientes('combustible');
      if (ok > 1 || !l.some(p => p.datos.ot_nueva)) toast(`${ok} reporte(s) enviado(s)`, 'success');
    }
    if (mal) toast(`${mal} reporte(s) no se pudieron enviar`, 'warning');
    pintarPendientesDe('taller'); pintarPendientesDe('combustible');
  }

  async function refrescarOTs() {
    try {
      const { data, error } = await sb.from('v_ot')
        .select('numero,estado,nombre,equipo_id,equipo,trabajo_general,ubicacion,abierta_el')
        .in('estado', ['Solicitada', 'Abierta']).order('numero', { ascending: false }).limit(500);
      if (error) throw error;
      C.ots = data || [];
      localStorage.setItem('fx_cat', JSON.stringify(C));
    } catch (e) { /* queda la lista anterior */ }
  }

  async function subir(bucket, b64, nombre) {
    try {
      const blob = await (await fetch(b64)).blob();
      const ruta = `${nombre}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
      const { error } = await sb.storage.from(bucket).upload(ruta, blob, { contentType: blob.type, upsert: true });
      if (error) throw error;
      return ruta;
    } catch (e) { console.warn('Foto:', e); return null; }
  }

  function quitar(id) { guardar(cola().filter(p => p.id !== id)); }
  function marcar(id, msg) { const l = cola(); const p = l.find(x => x.id === id); if (p) { p.error = msg; guardar(l); } }
  function descartar(id) {
    const p = cola().find(x => x.id === id);
    if (!p || !confirm(`¿Descartar "${p.resumen}"?\n\n${limpiarError(p.error || '')}\n\nSe borra de este teléfono y no se envía.`)) return;
    quitar(id);
    pintarPendientesDe(p.tipo);
  }
  const limpiarError = (m) => String(m || '').replace(/^(OT_NO_EXISTE|OT_CERRADA):\s*/, '');

  function pintarPendientesDe(tipo) {
    const box = $(`fx-${tipo}-pend`);
    if (!box) return;
    const l = cola().filter(p => p.tipo === tipo);
    if (!l.length) { box.innerHTML = ''; return; }
    box.innerHTML = tarjeta(`⏳ ${l.length} sin enviar`, l.map(p => `
      <div class="history-item-header" style="margin-bottom:8px">
        <div><b>${esc(p.resumen)}</b><div class="meta">${fechaCorta(p.fecha)}${p.error ? ' · ' + esc(limpiarError(p.error)) : ''}</div></div>
        <span style="display:flex;gap:6px;align-items:center">
          ${p.error ? `<button class="btn-mini btn-off" onclick="FX.descartar('${p.id}')">Descartar</button>` : ''}
          <span class="badge ${p.error ? 'badge-error' : 'badge-pendiente'}">${p.error ? 'Error' : 'Pendiente'}</span></span>
      </div>`).join('') + `<button class="btn-mini btn-neutro" onclick="FX.sincronizar()">Reintentar ahora</button>`);
  }

  // ── Lo último que cargó esta persona ──
  async function cargarRecientes(tipo) {
    if (!navigator.onLine || recientes[tipo]) return pintarRecientes(tipo);
    try {
      if (tipo === 'taller') {
        const { data, error } = await sb.from('ot_registros')
          .select('id,condicion,fecha,estado_maquina,finaliza_ot,creado_en,ordenes_trabajo(numero,nombre,equipo_id,trabajo_general,estado)')
          .eq('usuario_id', sesion.id).order('creado_en', { ascending: false }).limit(15);
        if (error) throw error;
        recientes.taller = data || [];
      } else {
        const { data, error } = await sb.from('combustible_movimientos')
          .select('id,actividad,fecha,hora,litros,litros_ingresados,stock_medido,tanque_salida_id,tanque_fijo_id,equipo_id,receptor_texto')
          .eq('usuario_id', sesion.id).order('creado_en', { ascending: false }).limit(15);
        if (error) throw error;
        recientes.combustible = data || [];
      }
    } catch (e) { console.warn('recientes:', e); }
    pintarRecientes(tipo);
  }

  function pintarRecientes(tipo) {
    const box = $(`fx-${tipo}-recientes`);
    const l = recientes[tipo];
    if (!box || !l || !l.length) { if (box) box.innerHTML = ''; return; }
    const filas = tipo === 'taller'
      ? l.map(r => { const o = r.ordenes_trabajo || {};
          return `<div class="history-item" style="cursor:default"><div class="history-item-header">
            <div><h3>OT ${o.numero || ''} · ${esc(o.equipo_id || o.trabajo_general || '')}</h3>
            <div class="meta">${fechaCorta(r.fecha)} · ${esc((CONDICIONES.find(x => x.v === r.condicion) || {}).t || r.condicion)}
              ${r.estado_maquina ? ' · ' + esc(r.estado_maquina) : ''}<br>${esc(o.nombre || '')}</div></div>
            <span class="badge ${o.estado === 'Cerrada' ? 'badge-enviado' : 'badge-pendiente'}">${esc(o.estado || '')}</span></div></div>`; })
      : l.map(r => `<div class="history-item" style="cursor:default"><div class="history-item-header">
            <div><h3>${esc((ACTIVIDADES.find(a => a.v === r.actividad) || {}).t || r.actividad)} ·
              ${r.litros ?? r.litros_ingresados ?? r.stock_medido ?? ''} L</h3>
            <div class="meta">${fechaCorta(r.fecha)} ${r.hora ? String(r.hora).slice(0, 5) : ''} ·
              ${esc(r.tanque_salida_id || r.tanque_fijo_id || '')}${r.equipo_id || r.receptor_texto ? ' → ' + esc(r.equipo_id || r.receptor_texto) : ''}</div></div>
            <span class="badge badge-enviado">Enviado</span></div></div>`);
    box.innerHTML = `<h3 style="font-size:14px;margin:22px 0 8px">Lo último que cargaste</h3>` + filas.join('');
  }

  // ════════════════════════════════════════════════════════════════
  // ESTILOS
  // ════════════════════════════════════════════════════════════════
  function inyectarEstilos() {
    if ($('fx-estilos')) return;
    const s = document.createElement('style');
    s.id = 'fx-estilos';
    s.textContent = `
      #screen-taller, #screen-combustible { max-width: 700px; }
      .fx-seg { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
      .fx-seg button { flex: 1 1 auto; padding: 10px 12px; border: 1.5px solid var(--gris-borde); background: var(--blanco);
        border-radius: 8px; font-size: 14px; font-weight: 600; color: var(--gris-texto); cursor: pointer; }
      .fx-seg button.on { background: var(--azul-medio); color: #fff; border-color: var(--azul-medio); }
      .fx-seg.chico { margin: 4px 0 0; }
      .fx-seg.chico { flex-wrap: nowrap; }
      .fx-seg.chico button { flex: 1 1 0; min-width: 0; padding: 6px 4px; font-size: 11.5px; line-height: 1.2; }
      .fx-seg.chico button.on { background: var(--verde); border-color: var(--verde); }
      .fx-cond { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .fx-cond button { text-align: left; padding: 10px 11px; border: 1.5px solid var(--gris-borde); background: var(--blanco);
        border-radius: 9px; cursor: pointer; color: var(--azul-oscuro); }
      .fx-cond button b { display: block; font-size: 14px; }
      .fx-cond button span { display: block; font-size: 11.5px; color: var(--gris-texto); margin-top: 2px; }
      .fx-cond button.on { border-color: var(--naranja); background: #fff5ec; box-shadow: 0 0 0 1px var(--naranja) inset; }
      .fx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .fx-chips button { padding: 8px 12px; border-radius: 20px; border: 1.5px solid var(--gris-borde); background: var(--blanco);
        font-size: 13px; font-weight: 600; color: var(--gris-texto); cursor: pointer; }
      .fx-chips button.on { background: var(--naranja); color: #fff; border-color: var(--naranja); }
      .fx-fila { display: grid; grid-template-columns: 1fr 64px; gap: 6px; align-items: center; padding: 5px 0;
        border-bottom: 1px solid #eef1f5; font-size: 13px; }
      .fx-fila.con-estado { grid-template-columns: 1fr 64px 1fr; }
      .fx-fila input, .fx-fila select { width: 100%; padding: 8px; border: 1.5px solid var(--gris-borde); border-radius: 7px; font-size: 14px; background: #fff; }
      @media (max-width: 480px) {
        .fx-fila.con-estado { grid-template-columns: 1fr 64px; }
        .fx-fila.con-estado select { grid-column: 1 / -1; }
      }
      .fx-chk { padding: 7px 0; border-bottom: 1px solid #eef1f5; font-size: 13px; }
      .fx-todo { font-size: 11px; color: var(--gris-texto); display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
      .fx-todo button { border: 0; background: #e0e7ff; color: var(--azul-medio); border-radius: 6px; padding: 3px 7px; font-size: 11px; cursor: pointer; }
      .fx-check { display: flex; gap: 8px; align-items: center; font-size: 14px; cursor: pointer; }
      .fx-check input { width: 20px; height: 20px; }
      .fx-fotos { display: flex; gap: 8px; flex-wrap: wrap; }
      .fx-foto { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--gris-borde); }
      .fx-foto img { width: 100%; height: 100%; object-fit: cover; }
      .fx-foto button { position: absolute; top: 3px; right: 3px; background: rgba(0,0,0,.6); color: #fff; border: 0;
        border-radius: 50%; width: 24px; height: 24px; cursor: pointer; }
      .fx-foto-mas { width: 84px; height: 84px; border: 1.5px dashed var(--azul-medio); border-radius: 8px; display: flex;
        flex-direction: column; align-items: center; justify-content: center; font-size: 26px; cursor: pointer; background: #eef2f9; }
      .fx-foto-mas small { font-size: 11px; color: var(--azul-medio); font-weight: 600; margin-top: 2px; }
      #fx-modal .modal-card { max-width: 700px; margin: 0 auto; }
    `;
    document.head.appendChild(s);
  }

  return {
    iniciar, mostrar, sincronizar, pendientes: cola,
    cerrarPicker, filtrarPicker, tocarOpcion, confirmarPicker,
    poner, ponerRedibujar, sumarFotos, quitarFoto,
    cambiarCondicion, elegirTecnico, elegirLider, elegirUbicacion, elegirOT, usarOT, elegirEquipo, elegirFallas,
    tocarSistema, ponerItem, ponerChecklist, checklistTodo, sumarBoleta, quitarBoleta, ponerBoleta, enviarTaller,
    cambiarActividad, elegirObraComb, elegirDespachador, elegirTanque, elegirReceptor, elegirOperadorComb, enviarComb,
    descartar
  };
})();
