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

  // ── Valores reales del formulario de JotForm "Reportes - Taller" ─
  // (v20261016g: mismas condiciones, campos y obligatorios que JotForm)
  const CONDICIONES = [
    { v: 'Reporte de Fallas',                    t: 'Reporte de Fallas',                   d: 'Avisar una falla para que taller la vea' },
    { v: 'Diagnóstico Inicial - Generación OT',  t: 'Diagnóstico Inicial - Generación OT', d: 'La máquina entra a taller: abre una OT' },
    { v: 'Registro de Trabajos - OT',            t: 'Registro de Trabajos - OT',           d: 'Lo que se hizo hoy en una OT' },
    { v: 'Cierre de OT - Taller',                t: 'Inspección Final - Taller',           d: 'La máquina sale de taller: cierra la OT' }
  ];
  const ESTADOS_INGRESO = ['Diagnóstico', 'Espera de Repuestos', 'Pruebas de funcionamiento', 'Reparación',
    'Servicio Tercerizado', 'Servicios Generales', 'Urgencia en otros equipos', 'Otros'];
  const ESTADOS_MAQUINA = ['En Reparación', 'Esperando pruebas en Campo', 'Esperando repuestos', 'Reparado',
    'Reparado- Fallas menores', 'Pendiente diagnóstico', 'Servicio Tercerizado', 'Servicios Generales',
    'Urgencia en otros equipos', 'Otros'];
  const ESTADOS_SALIDA = ['Funcional', 'Funcional - Fallando', 'Funcional - Pruebas en Campo', 'Otros'];
  const ESTADOS_REPARACION = ['Diagnóstico en curso', 'Esperando repuesto', 'Reparación en curso',
    'Revisión de pruebas', 'Reparado'];
  const TIPOS_MTTO = ['250', '500', '750', '1.000', '1.250', '1.500', '1.750', '2.000', '5.000', '10.000'];   // v20261027: ciclo 250 → 2.000 h (SQL 63)
  const HORAS = Array.from({ length: 24 }, (_, i) => String((i + 1) / 2));
  const TRABAJOS_GENERALES = ['SERVICIOS GENERALES', 'TRABAJOS INTERNOS TALLER', 'OTROS'];
  const MED_FALLAS = ['Horómetro', 'Kilometraje (Odómetro)', 'Servicios Generales- Trabajos en taller'];
  const MED_REGISTRO = ['Horómetro (Horas máquina)', 'Kilometraje (Odómetro - Solo livianos)', 'Servicios Generales - Trabajos en taller'];
  const MED_CIERRE = ['Horómetro (Horas máquina)', 'Kilometraje (Odómetro - Solo livianos)'];
  // Trabajo ejecutado, en el orden de JotForm. MTTO, SUPERVISIÓN y OTROS no
  // tienen componentes en el catálogo: abren sus propios campos.
  const TRABAJO_EJECUTADO = ['DESGASTABLES', 'ELÉCTRICO', 'GOMERÍA', 'HIDRÁULICO', 'MECÁNICO', 'MOTOR',
    'MTTO. ACEITES', 'SERVICIOS GENERALES', 'SUPERVISIÓN', 'OTROS'];
  const SIN_GRILLA = ['MTTO. ACEITES', 'SUPERVISIÓN', 'OTROS'];
  // Revisión de entrada (Diagnóstico, OT de taller). Las marcadas piden todas las filas.
  const CHK_ENTRADA = [['Comprobación Eléctrica', false], ['Comprobación neumáticos', true], ['Revisión Frenos', true],
    ['Revisión Parabrisas y Ventanas', true], ['Revisión Fluidos', false], ['Revisión Adicionales', false]];
  const SISTEMAS_SALIDA = ['ELÉCTRICO', 'GOMERÍA', 'HIDRÁULICO', 'MECÁNICO', 'MOTOR'];
  const CHK_SALIDA_SISTEMA = { 'ELÉCTRICO': 'Salida - Eléctrico', 'MOTOR': 'Salida - Motor',
    'GOMERÍA': 'Salida - Gomería', 'MECÁNICO': 'Salida - Mecánico', 'HIDRÁULICO': 'Salida - Hidráulico' };
  const CHK_PREVENTIVO = 'Checklist mantenimiento preventivo';
  const chkMantenimiento = (tipo) => ['250', '500', '750', '1.250', '1.500', '1.750'].includes(tipo) ? ['Mantenimiento aceites 250-500-750', 'Revisión de filtros']
    : ['1.000', '2.000'].includes(tipo) ? ['Mantenimiento preventivo 1000-2000', 'Revisión de filtros'] : [];

  const ACTIVIDADES = [
    { v: 'Despacho de combustible', t: 'Despacho' },
    { v: 'Ingreso de combustible',  t: 'Ingreso' },
    { v: 'Medición de tanque',      t: 'Medición' },
    { v: 'Prueba de desviación',    t: 'Prueba' }
  ];

  const COLA = 'pendientes_otros';
  const HORAS_TARDE = 48;   // horas que una OT cerrada sigue aceptando registros de trabajo (SQL 65)
  const MAX_FOTOS = 6;

  let formularios = ['parte'];
  let C = {};            // catálogos propios (equipos, tanques, OT, trabajos, checklists, fallas)
  let t = null;          // formulario de taller en curso
  let c = null;          // formulario de combustible en curso
  let archivos = {};     // fotos elegidas (File), por formulario y campo
  let recientes = { taller: null, combustible: null };
  let enviando = false;
  // v20261019a: configuración de cada campo (etiqueta, ayuda, obligatorio, si se
  // muestra, opciones) y campos nuevos, editable por el administrador central
  // desde el mismo formulario (editor_form.js). Sale de form_definicion_fx().
  let CFG = {};          // { taller: [secciones], combustible: [secciones] }
  let CFGI = {};         // índice: { taller: { clave: campo } }
  // Campos que se dibujaron la última vez (lo que se valida): clave → { lab, req, get }
  const VISTOS = { taller: new Map(), combustible: new Map() };

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
    if (formularios.includes('taller') || formularios.includes('combustible')) {
      await Promise.all([cargarCatalogos(), cargarConfig()]);
    }
    registrarEditor();
    sincronizar();
    return formularios;   // con esto se arma el menú
  }

  // Configuración de los campos: primero la guardada (sin señal la app abre igual)
  async function cargarConfig() {
    try { CFG = JSON.parse(localStorage.getItem('fx_def') || '{}') || {}; } catch (e) { CFG = {}; }
    indexarConfig();
    if (!navigator.onLine) return;
    try {
      const { data, error } = await sb.rpc('form_definicion_fx');
      if (error) throw error;
      if (data && typeof data === 'object') {
        CFG = data;
        localStorage.setItem('fx_def', JSON.stringify(data));
        indexarConfig();
      }
    } catch (e) { console.warn('form_definicion_fx:', e); }
  }
  function indexarConfig() {
    CFGI = {};
    ['taller', 'combustible'].forEach(f => {
      CFGI[f] = {};
      (CFG[f] || []).forEach(sec => (sec.campos || []).forEach(x => { CFGI[f][x.clave] = Object.assign({ _sec: sec.clave }, x); }));
    });
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
          pedirOTs(),
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

  // v20261027f (SQL 65): las OT abiertas y las cerradas en las últimas 48 h
  // (para que los demás mecánicos carguen sus horas), con el tipo de OT.
  // Sin el SQL 65 se piden como antes.
  async function pedirOTs() {
    const desde = new Date(Date.now() - HORAS_TARDE * 3600e3).toISOString();
    const r = await sb.from('v_ot')
      .select('numero,estado,nombre,equipo_id,equipo,trabajo_general,ubicacion,abierta_el,fecha_cierre,tipo_ot,tipo_ot_efectivo')
      .or(`estado.in.(Solicitada,Abierta),and(estado.eq.Cerrada,fecha_cierre.gte."${desde}")`)
      .order('numero', { ascending: false }).limit(600);
    if (!r.error) return r;
    return sb.from('v_ot').select('numero,estado,nombre,equipo_id,equipo,trabajo_general,ubicacion,abierta_el,tipo_ot')
      .in('estado', ['Solicitada', 'Abierta']).order('numero', { ascending: false }).limit(500);
  }

  // v20261027f: "Cerrar OT" desde la bandeja de Órdenes de trabajo (flota.html)
  // abre este formulario con ?cierre=N: Inspección Final con la OT elegida.
  // Se lee al cargar (después el menú reescribe la dirección).
  let cierrePedido = new URLSearchParams(location.search).get('cierre');

  function mostrar(n) {
    if (n === 'taller' && cierrePedido) {
      const num = String(cierrePedido).replace(/\D/g, '');
      cierrePedido = null;
      if (num) {
        t = tallerNuevo({ condicion: 'Cierre de OT - Taller', tecnico_cedula: t ? t.tecnico_cedula : undefined,
          obra_clave: t ? t.obra_clave : null, ubicacion_texto: t ? t.ubicacion_texto : '' });
        elegirOTNumero(num);
        toast(`Completá la Inspección Final - Taller para cerrar la OT ${num}`, 'info');
      }
    }
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
  const otActiva = (o) => o && ['Solicitada', 'Abierta'].includes(o.estado);
  // Cerrada hace menos de 48 h: todavía se pueden cargar horas (SQL 65)
  const otCerradaReciente = (o) => !!o && o.estado === 'Cerrada' && !!o.fecha_cierre
    && Date.now() - new Date(o.fecha_cierre).getTime() < HORAS_TARDE * 3600e3;
  const otAbiertaDe = (eq) => (C.ots || []).find(o => o.equipo_id === eq && otActiva(o));
  // Taller / Pista: el cargado o, si no hay, el estimado por la ubicación
  const tipoDeOT = (o) => !o ? '' : (o.tipo_ot_efectivo || o.tipo_ot
    || (/taller central/i.test(o.ubicacion || '') ? 'Taller' : 'Pista'));
  // Estados de la máquina con los que se puede cerrar una OT de pista
  const permiteCierre = (e) => /^\s*reparado/i.test(e || '') || /tercerizad/i.test(e || '');
  const hastaCuando = (o) => { const d = new Date(new Date(o.fecha_cierre).getTime() + HORAS_TARDE * 3600e3);
    return d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
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
        ${o.d ? `<div style="font-size:calc(12px*var(--fs,1));color:var(--gris-texto);font-weight:400">${esc(o.d)}</div>` : ''}</button>`;
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

  // ── Campos configurables (v20261019a) ───────────────────────────
  const editandoF = (form) => !!(window.EditorForm && EditorForm.activo(form));
  const cfg = (form, k) => (CFGI[form] || {})[k] || null;
  // Opciones de una lista: las de la configuración o, si no hay, las de siempre
  const opc = (form, k, porDefecto) => { const x = cfg(form, k); return x && Array.isArray(x.opciones) && x.opciones.length ? x.opciones : porDefecto; };
  const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  // Un campo del sistema con su configuración: si está oculto no se dibuja (ni se
  // valida); la etiqueta, la ayuda y si es obligatorio salen de la base.
  function cx(form, k, label, html, req, ayuda) {
    const x = cfg(form, k);
    if (x && x.activo === false) {
      return editandoF(form) ? `<div class="ef-campo-oculto">Oculto: ${esc(x.etiqueta)}${EditorForm.lapiz(form, k)}</div>` : '';
    }
    const lab = x && x.etiqueta && !(k === 'des_lectura' && x.etiqueta === 'Horómetro / Kilometraje') ? esc(x.etiqueta) : label;
    const rq = x ? !!x.requerido : !!req;
    VISTOS[form].set(k, { lab: lab.replace(/<[^>]*>/g, ''), req: rq, get: (GET[form] || {})[k] });
    const ay = [x && x.ayuda ? esc(x.ayuda) : '', ayuda || ''].filter(Boolean).join(' · ');
    return campo(lab + (window.EditorForm ? EditorForm.lapiz(form, k) : ''), html, rq, ay);
  }
  // Campos nuevos (los agrega el administrador): al final de su sección
  function extrasHtml(form, sec) {
    const o = form === 'taller' ? t : c, letra = form === 'taller' ? 't' : 'c';
    o.extras = o.extras || {};
    let h = '';
    for (const x of (CFG[form] || []).filter(s => s.clave === sec).flatMap(s => s.campos || []).filter(x => !x.es_sistema)) {
      if (!x.activo) { if (editandoF(form)) h += `<div class="ef-campo-oculto">Oculto: ${esc(x.etiqueta)}${EditorForm.lapiz(form, x.clave)}</div>`; continue; }
      const v = o.extras[x.clave], k = x.clave;
      const on = (val, red) => `FX.ponerExtra('${letra}','${k}',${val}${red ? ',true' : ''})`;
      let ctl;
      if (x.tipo === 'textarea') ctl = `<textarea oninput="${on('this.value')}">${esc(v ?? '')}</textarea>`;
      else if (x.tipo === 'numero') ctl = `<input type="number" inputmode="decimal" step="any" value="${esc(v ?? '')}" oninput="${on('this.value')}">`;
      else if (x.tipo === 'fecha') ctl = `<input type="date" value="${esc(v ?? '')}" oninput="${on('this.value')}">`;
      else if (x.tipo === 'si_no') ctl = segmento([{ v: 'si', t: 'Sí' }, { v: 'no', t: 'No' }], v || '', on('this.dataset.v', true));
      else if (x.tipo === 'select') ctl = `<select onchange="${on('this.value')}"><option value="">Seleccionar...</option>${(x.opciones || []).map(op => `<option ${op === v ? 'selected' : ''}>${esc(op)}</option>`).join('')}</select>`;
      else if (x.tipo === 'casillas') ctl = `<div class="fx-chips">${(x.opciones || []).map(op => `<button type="button" class="${(v || []).includes(op) ? 'on' : ''}" data-v="${esc(op)}" onclick="FX.tocarExtra('${letra}','${k}',this.dataset.v)">${esc(op)}</button>`).join('')}</div>`;
      else if (x.tipo === 'foto') ctl = htmlFotos(letra, 'x_' + k);
      else ctl = `<input type="text" value="${esc(v ?? '')}" oninput="${on('this.value')}">`;
      const get = x.tipo === 'foto' ? () => (archivos[letra + '.x_' + k] || []).length || null : () => o.extras[k];
      VISTOS[form].set(k, { lab: x.etiqueta, req: !!x.requerido, get, extra: x.tipo });
      h += campo(esc(x.etiqueta) + (window.EditorForm ? EditorForm.lapiz(form, k) : ''), ctl, !!x.requerido, x.ayuda ? esc(x.ayuda) : '');
    }
    if (editandoF(form)) h += EditorForm.pie(form, sec);
    return h;
  }
  function ponerExtra(form, k, v, redibujar) {
    const o = form === 't' ? t : c;
    (o.extras = o.extras || {})[k] = v;
    if (redibujar) form === 't' ? dibujarTaller() : dibujarComb();
  }
  function tocarExtra(form, k, v) {
    const o = form === 't' ? t : c;
    o.extras = o.extras || {};
    const l = o.extras[k] || [];
    o.extras[k] = l.includes(v) ? l.filter(x => x !== v) : [...l, v];
    form === 't' ? dibujarTaller() : dibujarComb();
  }
  // Lo que se guarda de los campos nuevos (las fotos van aparte, se suben primero)
  function valoresExtras(form) {
    const o = form === 'taller' ? t : c, out = {};
    VISTOS[form].forEach((d, k) => {
      if (!d.extra || d.extra === 'foto') return;
      const v = (o.extras || {})[k];
      if (!vacio(v)) out[k] = d.extra === 'numero' ? num(v) : v;
    });
    return out;
  }
  function fotosExtras(form) {
    const m = {};
    VISTOS[form].forEach((d, k) => { if (d.extra === 'foto') m['x_' + k] = 'x_' + k; });
    return m;
  }
  // Validación genérica: los campos a la vista que son obligatorios
  function faltantes(form) {
    const f = [];
    VISTOS[form].forEach(d => { if (d.req && d.get && vacio(d.get())) f.push(d.lab); });
    return f;
  }

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

  function htmlFotos(form, k) {
    const l = (archivos[form + '.' + k] || []);
    return `<div class="fx-fotos">${l.map((f, i) =>
      `<span class="fx-foto"><img src="${URL.createObjectURL(f)}"><button type="button" onclick="FX.quitarFoto('${form}','${k}',${i})">✕</button></span>`).join('')}
      ${l.length < MAX_FOTOS ? `<label class="fx-foto-mas" title="Sacar foto">📷<small>Cámara</small><input type="file" accept="image/*" capture="environment" style="display:none"
        onchange="FX.sumarFotos('${form}','${k}',this.files)"></label>
      <label class="fx-foto-mas" title="Elegir de la galería">🖼️<small>Galería</small><input type="file" accept="image/*" multiple style="display:none"
        onchange="FX.sumarFotos('${form}','${k}',this.files)"></label>` : ''}</div>`;
  }
  // v20261027a: cada foto se achica apenas se elige (achicarFoto, en
  // parte_diario_v5.html). Antes se leía al enviar y, si el teléfono ya no
  // dejaba abrir el original, el reporte salía SIN la foto y sin avisar.
  async function sumarFotos(form, k, files) {
    const clave = form + '.' + k, lista = [...(files || [])];
    if (!lista.length) return;
    toast('Procesando foto…', 'info');
    const ok = [];
    let mal = null;
    for (const f of lista) {
      try { ok.push(window.achicarFoto ? await achicarFoto(f) : f); }
      catch (e) { console.warn('Foto:', e); mal = e; }
    }
    if (mal) toast(window.motivoFoto ? motivoFoto(mal) : 'No se pudo abrir la foto. Sacala de nuevo.', 'error');
    if (!ok.length) return;
    archivos[clave] = (archivos[clave] || []).concat(ok).slice(0, MAX_FOTOS);
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
  // Formulario igual a JotForm "Reportes - Taller": las mismas cuatro
  // condiciones de carga, con los mismos campos, condiciones y obligatorios.
  function tallerNuevo(base) {
    return {
      client_id: nuevoId(),
      condicion: base?.condicion || 'Registro de Trabajos - OT',
      fecha: hoyISO(),
      tecnico_cedula: base?.tecnico_cedula ?? yoEnCatalogo(),
      obra_clave: base?.obra_clave || null,
      ubicacion_texto: base?.ubicacion_texto || '',
      // Reporte de fallas
      tipo_reporte: 'General de Fallas',
      // OT
      tiene_ot: '', ot_numero: null,
      equipo_id: null, equipos: [], lecturas: {}, trabajo_general: null, nombre: '', tipo_ot: '', lider_cedula: null,
      fallas: [], fallas_sis: [], sintomas: '', ingreso_por_averia: '', paro_maquina: '',
      fecha_estimada_cierre: '', estado_maquina_ingreso: '',
      tipo_medicion: '', lectura: '', lectura_auto: false, ref_lectura: null,
      // Trabajo
      sistemas: [], items: {}, otros: [],     // items["SISTEMA|COMPONENTE"] = {horas, estado}
      tipo_mantenimiento: '', horas_mantenimiento: '', horas_supervision_tercerizada: '',
      realizo_traslado: '', horas_traslado: '',
      boletas: [], estado_maquina: '', finaliza: '',
      checklist: {},                          // checklist["NOMBRE|ITEM"] = resultado
      detalle: '', observaciones: '', firma: null,
      extras: {}
    };
  }

  const cond = () => t.condicion;
  const esFallas = () => cond() === 'Reporte de Fallas';
  const esDiag = () => cond() === 'Diagnóstico Inicial - Generación OT';
  const esReg = () => cond() === 'Registro de Trabajos - OT';
  const esCierre = () => cond() === 'Cierre de OT - Taller';
  const esPista = () => esDiag() && t.tipo_ot === 'Pista';
  const abreOT = () => esFallas() || esDiag() || (esReg() && t.tiene_ot === 'no');
  const conLectura = () => !!t.tipo_medicion && !/servicios/i.test(t.tipo_medicion);
  const tiene = (s) => t.sistemas.includes(s);
  const conMtto = () => esReg() && tiene('MTTO. ACEITES');
  const equipoDelForm = () => abreOT() ? t.equipo_id : (otPorNumero(t.ot_numero) || {}).equipo_id;
  // Registro de Trabajos (v20261027f): ¿sobre qué OT / máquina?
  const regOT = () => esReg() && t.tiene_ot === 'si' ? otPorNumero(t.ot_numero) : null;
  const regEnOTCerrada = () => otCerradaReciente(regOT());
  // Con máquina: una OT nueva con equipo, o una OT existente con equipo (si
  // la OT no está en el teléfono se supone que sí: lo decide la base).
  const regConMaquina = () => t.tiene_ot === 'si' ? (regOT() ? !!regOT().equipo_id : true) : !!t.equipo_id;
  const regTipoOT = () => t.tiene_ot === 'si' ? tipoDeOT(regOT()) : t.tipo_ot;
  const opcionesMedicion = () => esReg() ? MED_REGISTRO : esCierre() ? MED_CIERRE : MED_FALLAS;
  const trabajoEjecutado = () => [...TRABAJO_EJECUTADO, ...sistemas().filter(s => !TRABAJO_EJECUTADO.includes(s))];
  const selHoras = (k, actual, onchange) => `<select onchange="${onchange}"><option value="">Horas...</option>${HORAS.map(h =>
    `<option value="${h}" ${String(actual) === h ? 'selected' : ''}>${h.replace('.', ',')}</option>`).join('')}</select>`;
  // v20261026b: la base solo acepta 'Horómetro' / 'Odómetro' (otr_medicion_valida);
  // las opciones del formulario traen texto largo como en JotForm.
  const medicionBase = (m) => !m ? null : /^hor/i.test(m) ? 'Horómetro' : /od[oó]metro|^kilometr/i.test(m) ? 'Odómetro' : null;
  // Medición según el equipo: odómetro si solo usa km
  function medicionDe(id) {
    const e = equipo(id), ops = opcionesMedicion();
    return e && e.usa_km && !e.usa_horometro ? ops[1] : ops[0];
  }

  // Valor de cada campo de taller (para la validación genérica de obligatorios)
  const nFotos = (k) => (archivos['t.' + k] || []).length || null;
  const lecturaOk = () => (esPista() && t.equipos.length > 1 ? t.equipos.every(id => num(t.lecturas[id]) !== null) : num(t.lectura) !== null) ? 'ok' : null;
  const GET_T = {
    ini_condicion: () => t.condicion, ini_fecha: () => t.fecha, ini_tecnico: () => t.tecnico_cedula,
    ini_ubicacion: () => t.obra_clave || t.ubicacion_texto,
    fal_tipo_reporte: () => t.tipo_reporte, fal_maquina: () => t.equipo_id, fal_fallas: () => t.fallas,
    fal_sintomas: () => t.sintomas, fal_fotos: () => nFotos('fotos'),
    dia_nombre: () => t.nombre, dia_tipo_ot: () => t.tipo_ot, dia_lider: () => t.lider_cedula,
    dia_maquinas: () => t.equipos, dia_fallas: () => t.fallas, dia_maquina: () => t.equipo_id,
    dia_estado: () => t.estado_maquina_ingreso, dia_fecha_cierre: () => t.fecha_estimada_cierre,
    dia_averia: () => t.ingreso_por_averia, dia_paro: () => t.paro_maquina, dia_fotos: () => nFotos('fotos'),
    dia_sintomas: () => t.sintomas,
    reg_tiene_ot: () => t.tiene_ot, reg_ot: () => t.ot_numero, reg_nombre: () => t.nombre, reg_tipo_ot: () => t.tipo_ot,
    reg_maquina: () => t.equipo_id || t.trabajo_general, reg_fallas: () => t.fallas, reg_trabajo: () => t.sistemas,
    reg_foto_lectura: () => nFotos('foto_lectura'), reg_tipo_mtto: () => t.tipo_mantenimiento,
    reg_horas_mtto: () => t.horas_mantenimiento, reg_horas_supervision: () => t.horas_supervision_tercerizada,
    reg_estado: () => t.estado_maquina, reg_finaliza: () => t.finaliza,
    reg_boletas: () => t.boletas.filter(b => b.numero || b.fecha), reg_fotos_boletas: () => nFotos('fotos_boletas'),
    reg_detalle: () => t.detalle, reg_traslado: () => t.realizo_traslado, reg_horas_traslado: () => t.horas_traslado,
    cie_ot: () => t.ot_numero, cie_sistemas: () => t.sistemas, cie_estado: () => t.estado_maquina,
    cie_fotos: () => nFotos('fotos'), cie_detalle: () => t.detalle,
    fin_observaciones: () => t.observaciones, fin_firma: () => t.firma
  };
  ['fal', 'dia', 'reg', 'cie'].forEach(p => { GET_T[p + '_tipo_medicion'] = () => t.tipo_medicion; GET_T[p + '_lectura'] = lecturaOk; });
  // prefijo de los campos de la página de la condición elegida
  const pagina = () => esFallas() ? 'fal' : esDiag() ? 'dia' : esReg() ? 'reg' : 'cie';
  const T = (k, label, html, req, ayuda) => cx('taller', k, label, html, req, ayuda);

  // Arma el HTML (y la lista de campos a la vista) sin tocar la pantalla:
  // también lo usa la validación.
  function construirTaller() {
    VISTOS.taller = new Map();
    let h = `<div id="fx-taller-pend"></div>${avisoOTGeneradas()}`;
    h = (window.EditorForm ? EditorForm.barra('taller') : '') + h;

    // ── Página 1: condición de carga, fecha, personal, ubicación ──
    h += tarjeta('🛠️ Reportes - Taller', `
      ${T('ini_condicion', 'Condición de Carga', `<div class="fx-cond">${CONDICIONES.map(o => `<button type="button" class="${t.condicion === o.v ? 'on' : ''}"
        onclick="FX.cambiarCondicion('${o.v}')"><b>${o.t}</b><span>${o.d}</span></button>`).join('')}</div>`, true)}
      <div class="field-row">${T('ini_fecha', 'Fecha de Reporte', entrada(t, 'fecha', 'date'), true)}</div>
      ${T('ini_tecnico', 'Personal Taller', boton(t.tecnico_cedula ? nombreOperador(t.tecnico_cedula) : 'Seleccionar...', 'FX.elegirTecnico()', !t.tecnico_cedula), true)}
      ${T('ini_ubicacion', 'Ubicación', boton(t.obra_clave || t.ubicacion_texto || 'Seleccionar...', 'FX.elegirUbicacion()', !(t.obra_clave || t.ubicacion_texto)), true)}
    ` + extrasHtml('taller', 't_inicio'));

    if (esFallas()) h += paginaFallas();
    if (esDiag()) h += paginaDiagnostico();
    if (esReg()) h += paginaRegistro();
    if (esCierre()) h += paginaCierre();

    // ── Página final: observaciones y firma (todas las condiciones) ──
    h += tarjeta('✍️ ¡Casi terminamos!', `
      ${T('fin_observaciones', 'Observaciones Generales', area(t, 'observaciones'))}
      ${T('fin_firma', 'Firma de responsable', `<div class="fx-firma"><canvas id="fx-firma"></canvas>
        <button type="button" class="btn-mini btn-neutro" onclick="FX.borrarFirma()">Borrar firma</button></div>`, true)}` + extrasHtml('taller', 't_final'));

    h += editandoF('taller') ? '' : `<div class="form-nav"><button class="btn-submit" onclick="FX.enviarTaller()">Enviar</button></div>`;
    h += `<div id="fx-taller-recientes"></div>`;
    return h;
  }

  function dibujarTaller() {
    const pantalla = $('screen-taller');
    if (!pantalla) return;
    const sc = window.scrollY;
    pantalla.innerHTML = construirTaller();
    iniciarFirma();
    pintarPendientesDe('taller');
    pintarRecientes('taller');
    window.scrollTo(0, sc);
  }

  // Medición (tipo + lectura). En una OT de pista con varias máquinas se
  // pide la lectura de cada una.
  function bloqueMedicion() {
    const p = pagina();
    let h = T(p + '_tipo_medicion', 'Tipo de Medición', segmento(opcionesMedicion(), t.tipo_medicion, "FX.cambiarMedicion(this.dataset.v)"), true);
    if (!conLectura()) return h;
    const titulo = 'Horómetro/Kilometraje (Odómetro)';
    if (esPista() && t.equipos.length > 1) {
      h += T(p + '_lectura', titulo, t.equipos.map(id => `<div class="fx-fila"><span>${esc(id)}</span>
        <input type="number" inputmode="decimal" step="any" min="0" value="${esc(t.lecturas[id] ?? '')}" data-id="${esc(id)}"
          oninput="FX.ponerLectura(this.dataset.id,this.value)"></div>`).join(''), true);
    } else h += T(p + '_lectura', titulo, `<input type="number" inputmode="decimal" step="any" min="0" value="${esc(t.lectura ?? '')}"
        oninput="FX.ponerLecturaUnica(this.value)">`, true, refLecturaTexto(equipoDelForm()));
    return h;
  }

  // ── Último horómetro / km del parte diario (v20261027f) ──
  // Al elegir la máquina (o la OT) se trae la última lectura cargada en el
  // parte diario y se pone en el campo, si el mecánico no escribió otra.
  const refLec = {};   // equipo → { horometro, km, fecha, operador }
  const esOdometro = () => /od[oó]metro|kilometr/i.test(t.tipo_medicion || '');
  const valorRef = (id) => { const r = refLec[id]; return !r ? null : esOdometro() ? r.km : r.horometro; };
  function refLecturaTexto(id) {
    const r = id && refLec[id], v = id && valorRef(id);
    if (!r || v === null || v === undefined) return '';
    return `Último del parte diario: ${Number(v).toLocaleString('es-PY')} ${esOdometro() ? 'km' : 'h'} (${fechaCorta(r.fecha)}${r.operador ? ', ' + esc(r.operador) : ''})`;
  }
  // Pone la lectura de referencia en los campos vacíos (o los que puso la app)
  function aplicarRef() {
    if (!t || !conLectura()) return;
    if (esPista() && t.equipos.length > 1) {
      t.equipos.forEach(id => {
        const v = valorRef(id);
        if (v !== null && v !== undefined && (t.lecturas[id] === undefined || t.lecturas[id] === '' || (t.lecturas_auto || {})[id])) {
          t.lecturas[id] = String(v); (t.lecturas_auto = t.lecturas_auto || {})[id] = true;
        }
      });
      return;
    }
    const v = valorRef(equipoDelForm());
    if (v !== null && v !== undefined && (t.lectura === '' || t.lectura === null || t.lectura_auto)) { t.lectura = String(v); t.lectura_auto = true; }
    else if ((v === null || v === undefined) && t.lectura_auto) { t.lectura = ''; t.lectura_auto = false; }
  }
  async function traerHorometro(ids) {
    const l = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).filter(id => !refLec[id]);
    if (l.length && navigator.onLine) {
      await Promise.all(l.map(async id => {
        try {
          const { data, error } = await sb.rpc('ultimo_horometro', { p_equipo: id, p_fecha: null });
          if (error) throw error;
          const r = Array.isArray(data) ? data[0] : data;
          if (r) refLec[id] = r;
        } catch (e) { console.warn('ultimo_horometro', id, e); }
      }));
    }
    aplicarRef();
    if ($('screen-taller')?.classList.contains('active')) dibujarTaller();
  }
  function ponerLecturaUnica(v) { t.lectura = v; t.lectura_auto = false; }

  // ── Página 2: Reporte de Fallas ──
  function paginaFallas() {
    let h = T('fal_tipo_reporte', 'Tipo de Reporte', segmento(['General de Fallas', 'CheckList de Mantenimiento'], t.tipo_reporte,
      "FX.poner('t','tipo_reporte',this.dataset.v,true)"));
    h += T('fal_maquina', 'Máquina', boton(t.equipo_id ? textoEquipo(t.equipo_id) : 'Seleccionar...', 'FX.elegirEquipo()', !t.equipo_id), true);
    // v20261027a (SQL 60): un reporte de falla nunca abre una OT. Queda
    // Solicitada (pendiente de que taller la tome). Solo se suma a otra OT
    // de la máquina si esa también está Solicitada.
    const sol = t.equipo_id && (C.ots || []).find(o => o.equipo_id === t.equipo_id && o.estado === 'Solicitada');
    const abi = !sol && t.equipo_id && (C.ots || []).find(o => o.equipo_id === t.equipo_id && o.estado === 'Abierta');
    if (sol) h += `<div class="aviso-caja">Esta máquina ya tiene la OT ${sol.numero} solicitada (pendiente de taller): la falla se suma a esa OT.</div>`;
    else if (abi) h += `<div class="aviso-caja">Esta máquina tiene la OT ${abi.numero} abierta en taller. Este reporte queda como una OT <b>Solicitada</b> aparte: taller decide si la toma o la suma.</div>`;
    else if (t.equipo_id) h += `<div class="ayuda">El reporte queda como OT <b>Solicitada</b>: taller la abre cuando la toma.</div>`;
    if (t.tipo_reporte === 'CheckList de Mantenimiento') h += dibujarChecklist(CHK_PREVENTIVO);
    h += campoFallas('fal_fallas');
    h += bloqueMedicion();
    h += T('fal_sintomas', 'Síntomas de la máquina', area(t, 'sintomas', 'Qué se nota: ruido, humo, pérdida...'), true);
    h += T('fal_fotos', 'Imágenes de la falla', htmlFotos('t', 'fotos'), true);
    return tarjeta('⚠️ Reporte de Fallas', h + extrasHtml('taller', 't_fallas'));
  }

  // v20261022b: dos desplegables dependientes, como en el parte diario:
  // primero el/los sistema(s), después la(s) falla(s) de esos sistemas.
  // Las dos listas son de selección múltiple. Se sigue guardando igual
  // ("SISTEMA - COMPONENTE"), así OT, historial y Power BI no cambian.
  const sistemaDeFalla = (f) => String(f).split(' - ')[0].trim();
  const componenteDeFalla = (f) => { const i = String(f).indexOf(' - '); return i < 0 ? String(f) : String(f).slice(i + 3); };
  function sistemasCatalogo() {
    return [...new Set((C.fallas || []).map(sistemaDeFalla).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  }
  // Sistemas elegidos: los marcados + los de las fallas ya elegidas
  function sistemasElegidos() {
    const l = [...(t.fallas_sis || [])];
    t.fallas.forEach(f => { const x = sistemaDeFalla(f); if (f.includes(' - ') && !l.includes(x)) l.push(x); });
    return l;
  }
  function campoFallas(k) {
    const sis = sistemasElegidos();
    const sub = (txt) => `<div style="font-size:calc(11.5px*var(--fs,1));font-weight:700;color:var(--gris-texto);margin:2px 0 4px">${txt}</div>`;
    const chips = (l, color, fn) => l.map(x => `<span class="chip ${color}" style="margin:0 4px 4px 0">${esc(fn ? fn(x) : x)}</span>`).join('');
    const h = sub('Sistema(s)') + chips(sis, 'azul')
      + boton(sis.length ? 'Cambiar sistemas...' : 'Elegir sistema(s)...', 'FX.elegirSistemasFalla()', !sis.length)
      + `<div style="margin-top:10px">${sub('Falla(s) / componente(s)')}</div>`
      + chips(t.fallas, 'amarillo', f => (sis.length > 1 || !f.includes(' - ')) ? f : componenteDeFalla(f))
      + (sis.length
          ? boton(t.fallas.length ? 'Cambiar fallas...' : 'Elegir fallas...', 'FX.elegirFallas()', !t.fallas.length)
          : '<div class="ayuda" style="margin:0">Primero elegí el sistema.</div>');
    return T(k, 'Falla(s)', h, true, 'Se listan solo las fallas de los sistemas elegidos. Si no está, escribila en el buscador.');
  }

  // ── Página 3: Diagnóstico Inicial - Generación OT ──
  function paginaDiagnostico() {
    let h = T('dia_nombre', 'Nombre de la OT', entrada(t, 'nombre', 'text', 'placeholder="Ej.: Cambio de turbo"'), true);
    h += T('dia_tipo_ot', 'Tipo de OT', segmento(['Pista', 'Taller'], t.tipo_ot, "FX.cambiarTipoOT(this.dataset.v)"), true);
    h += T('dia_lider', 'Líder de trabajo', boton(t.lider_cedula ? nombreOperador(t.lider_cedula) : 'Seleccionar...', 'FX.elegirLider()', !t.lider_cedula), true);
    if (!t.tipo_ot) return tarjeta('📋 Generación OT', h + extrasHtml('taller', 't_diag'));
    if (esPista()) {
      h += T('dia_maquinas', 'Máquina(s)', `${t.equipos.map(id => `<span class="chip azul" style="margin:0 4px 4px 0">${esc(textoEquipo(id))}</span>`).join('')}
        ${boton(t.equipos.length ? 'Cambiar máquinas...' : 'Elegir máquinas...', 'FX.elegirEquipos()', !t.equipos.length)}`, true,
        t.equipos.length > 1 ? `Se abre una OT por cada máquina (${t.equipos.length} OT).` : '');
      h += campoFallas('dia_fallas');
    } else {
      h += T('dia_maquina', 'Máquina', boton(t.equipo_id ? textoEquipo(t.equipo_id) : 'Seleccionar...', 'FX.elegirEquipo()', !t.equipo_id), true);
      const abierta = t.equipo_id && otAbiertaDe(t.equipo_id);
      if (abierta) h += `<div class="aviso-caja">Esta máquina ya tiene la <b>OT ${abierta.numero}</b> (${esc(abierta.nombre)}) ${abierta.estado.toLowerCase()}.</div>`;
    }
    h += bloqueMedicion();
    if (!esPista()) h += CHK_ENTRADA.map(([n, todas]) => dibujarChecklist(n, todas)).join('');
    h += T('dia_estado', 'Estado General de la Máquina', lista(opc('taller', 'dia_estado', ESTADOS_INGRESO), t.estado_maquina_ingreso, 'estado_maquina_ingreso', 't'), true);
    h += T('dia_fecha_cierre', 'Fecha estimada de cierre', entrada(t, 'fecha_estimada_cierre', 'date'), true);
    if (!esPista()) {
      h += T('dia_averia', 'Ingreso a taller por avería', segmento(['SI', 'NO'], t.ingreso_por_averia, "FX.poner('t','ingreso_por_averia',this.dataset.v,true)"), true);
      if (t.ingreso_por_averia === 'SI') h += T('dia_paro', 'Paro de máquina', entrada(t, 'paro_maquina', 'datetime-local'));
    }
    h += T('dia_fotos', 'Imágenes de la falla', htmlFotos('t', 'fotos'));
    h += T('dia_sintomas', 'Síntomas de la máquina/ Trabajo a ejecutar', area(t, 'sintomas'), true);
    return tarjeta('📋 Generación OT', h + extrasHtml('taller', 't_diag'));
  }

  // ── Página 4: Registro de Trabajos - OT (Gestión de OT - Obra) ──
  function paginaRegistro() {
    let h = T('reg_tiene_ot', '¿Ya tienes OT?', segmento(['SI', 'NO'], t.tiene_ot.toUpperCase(), "FX.ponerTieneOT(this.dataset.v)"), true);
    if (!t.tiene_ot) return tarjeta('🔧 Gestión de OT - Obra', h + extrasHtml('taller', 't_registro'));
    if (t.tiene_ot === 'si') {
      const ot = otPorNumero(t.ot_numero);
      h += T('reg_ot', 'OT', boton(t.ot_numero ? (ot ? `OT ${ot.numero} · ${ot.equipo_id || ot.trabajo_general || ''} · ${ot.nombre}` : `OT ${t.ot_numero}`)
        : 'Elegir la OT...', 'FX.elegirOT()', !t.ot_numero), true,
        ot ? `${otCerradaReciente(ot) ? 'Cerrada el ' + fechaCorta(ot.fecha_cierre) : ot.estado + ' desde el ' + fechaCorta(ot.abierta_el)}${ot.ubicacion ? ' · ' + esc(ot.ubicacion) : ''} · OT de ${tipoDeOT(ot).toLowerCase()}`
           : (t.ot_numero ? 'No está en la lista de OT abiertas de este teléfono: se verifica al enviar.' : ''));
      if (otCerradaReciente(ot)) h += `<div class="aviso-caja">Esta OT ya se cerró. Podés cargar tus horas hasta el <b>${hastaCuando(ot)}</b>:
        el registro no cambia el estado de la OT ni de la máquina.</div>`;
    } else {
      h += T('reg_nombre', 'Nombre del Trabajo', entrada(t, 'nombre', 'text', 'placeholder="Ej.: Cambio de turbo"'), true);
      h += T('reg_maquina', 'Máquina', boton(t.equipo_id ? textoEquipo(t.equipo_id) : (t.trabajo_general || 'Seleccionar...'),
        'FX.elegirEquipo()', !(t.equipo_id || t.trabajo_general)), true, 'Para trabajos sin máquina elegí SERVICIOS GENERALES, TRABAJOS INTERNOS TALLER u OTROS');
      const abierta = t.equipo_id && otAbiertaDe(t.equipo_id);
      if (abierta) h += `<div class="aviso-caja">Esta máquina ya tiene la <b>OT ${abierta.numero}</b> (${esc(abierta.nombre)}) ${abierta.estado.toLowerCase()}.
        <button class="btn-mini btn-neutro" onclick="FX.usarOT(${abierta.numero})">Cargar en esa OT</button></div>`;
      if (t.equipo_id) h += T('reg_tipo_ot', 'Tipo de OT', segmento(['Pista', 'Taller'], t.tipo_ot, "FX.poner('t','tipo_ot',this.dataset.v,true)"), true);
      h += campoFallas('reg_fallas');
    }
    h += T('reg_trabajo', 'Trabajo Ejecutado', `<div class="fx-chips">${trabajoEjecutado().map(s =>
      `<button type="button" class="${tiene(s) ? 'on' : ''}" data-v="${esc(s)}" onclick="FX.tocarSistema(this.dataset.v)">${esc(s)}</button>`).join('')}</div>`, true);
    h += bloqueMedicion();

    // MTTO: foto del horómetro, tipo y horas de mantenimiento, grillas según el tipo
    if (conMtto()) {
      h += T('reg_foto_lectura', 'Imagen del Horómetro o Kilometraje (Odómetro)', htmlFotos('t', 'foto_lectura'), true);
      h += T('reg_tipo_mtto', 'Tipo mantenimiento:', segmento(TIPOS_MTTO, t.tipo_mantenimiento, "FX.poner('t','tipo_mantenimiento',this.dataset.v,true)"), true);
      h += T('reg_horas_mtto', 'Cantidad de horas de mantenimiento', selHoras('horas_mantenimiento', t.horas_mantenimiento, "FX.poner('t','horas_mantenimiento',this.value)"), true);
      h += chkMantenimiento(t.tipo_mantenimiento).map(n => dibujarChecklist(n)).join('');
    }
    if (tiene('SUPERVISIÓN')) {
      h += T('reg_horas_supervision', 'Cantidad de horas de supervisión tercerizada', selHoras('horas_supervision_tercerizada', t.horas_supervision_tercerizada,
        "FX.poner('t','horas_supervision_tercerizada',this.value)"), true);
    }
    // Reporte diario de cada sistema
    const estadosRep = opc('taller', 'reg_estado_reparacion', ESTADOS_REPARACION);
    const lapizRep = window.EditorForm ? EditorForm.lapiz('taller', 'reg_estado_reparacion') : '';
    for (const s of t.sistemas.filter(x => !SIN_GRILLA.includes(x))) {
      const conEstado = s !== 'SERVICIOS GENERALES';
      h += `<div class="rep-item"><div class="rep-title" style="margin-bottom:8px">Reporte Diario - ${esc(s)}${conEstado ? lapizRep : ''}</div>
        <div class="fx-matriz">${componentes(s).map(comp => {
          const k = s + '|' + comp, it = t.items[k] || {};
          return `<div class="fx-fila${conEstado ? ' con-estado' : ''}"><span>${esc(comp)}</span>
            <select data-k="${esc(k)}" onchange="FX.ponerItem(this.dataset.k,'horas',this.value)"><option value="">h</option>${HORAS.map(x =>
              `<option value="${x}" ${String(it.horas ?? '') === x ? 'selected' : ''}>${x.replace('.', ',')}</option>`).join('')}</select>
            ${conEstado ? `<select data-k="${esc(k)}" onchange="FX.ponerItem(this.dataset.k,'estado',this.value)">
              <option value="">Estado de Reparación...</option>${estadosRep.map(e => `<option ${it.estado === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>` : ''}
          </div>`;
        }).join('')}</div></div>`;
    }
    if (tiene('OTROS')) {
      h += `<div class="rep-item"><div class="rep-title" style="margin-bottom:8px">Reporte Diario - Otros${lapizRep}</div>
        ${t.otros.map((o, i) => `<div class="fx-fila con-estado fx-otro">
          <input type="text" placeholder="Trabajo" value="${esc(o.desc)}" oninput="FX.ponerOtro(${i},'desc',this.value)">
          <select onchange="FX.ponerOtro(${i},'horas',this.value)"><option value="">h</option>${HORAS.map(x =>
            `<option value="${x}" ${String(o.horas ?? '') === x ? 'selected' : ''}>${x.replace('.', ',')}</option>`).join('')}</select>
          <select onchange="FX.ponerOtro(${i},'estado',this.value)"><option value="">Estado de Reparación...</option>${estadosRep.map(e =>
            `<option ${o.estado === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
          <button class="remove-btn" onclick="FX.quitarOtro(${i})">✕</button></div>`).join('')}
        <button class="add-btn" onclick="FX.sumarOtro()">+ Agregar trabajo</button></div>`;
    }
    // Con trabajo ejecutado: estado, finalizado, boletas y detalle.
    // v20261027f (SQL 65): en una OT cerrada hace menos de 48 h solo se
    // cargan las horas (sin estado ni cierre). Para cerrar una OT de pista la
    // máquina tiene que quedar Reparado / Reparado - Fallas menores /
    // Servicio Tercerizado; una OT de taller se cierra con la Inspección Final.
    const tarde = regEnOTCerrada();
    if (t.sistemas.length && !tarde) {
      const conMaq = regConMaquina(), deTaller = conMaq && regTipoOT() === 'Taller';
      if (!tiene('SERVICIOS GENERALES') || (conMaq && t.finaliza === 'si'))
        h += T('reg_estado', 'Estado General de la Máquina', `<select onchange="FX.poner('t','estado_maquina',this.value,true)"><option value="">Seleccionar...</option>${
          opc('taller', 'reg_estado', ESTADOS_MAQUINA).map(o => `<option ${o === t.estado_maquina ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`, true);
      h += T('reg_finaliza', 'Trabajo Finalizado (Cierre de OT)', segmento([{ v: 'si', t: 'SI' }, { v: 'no', t: 'NO' }], t.finaliza,
        "FX.poner('t','finaliza',this.dataset.v,true)"), true,
        !conMaq ? '' : deTaller
          ? (t.tiene_ot === 'si' ? 'OT de taller: con SI, al enviar se abre la Inspección Final - Taller para cerrarla.'
                                 : 'OT de taller: se cierra con la Inspección Final - Taller (con el número de OT que te da el sistema).')
          : 'Solo se cierra si la máquina queda Reparado, Reparado - Fallas menores o Servicio Tercerizado.');
      if (conMaq && !deTaller && t.finaliza === 'si' && t.estado_maquina && !permiteCierre(t.estado_maquina))
        h += `<div class="aviso-caja" style="background:#fdecec;border-color:#f3b4b4;color:#9b1c1c">Con la máquina en «${esc(t.estado_maquina)}» la OT no se puede cerrar: elegí Reparado,
          Reparado - Fallas menores o Servicio Tercerizado, o marcá NO.</div>`;
    }
    if (t.sistemas.length) {
      let bol = t.boletas.map((b, i) => `<div class="rep-item"><div class="rep-head"><span class="rep-title">Boleta ${i + 1}</span>
          <button class="remove-btn" onclick="FX.quitarBoleta(${i})">✕</button></div>
          <div class="field-row">${campo('Número', `<input type="text" value="${esc(b.numero)}" oninput="FX.ponerBoleta(${i},'numero',this.value)">`)}
          ${campo('Fecha de salida', `<input type="date" value="${esc(b.fecha)}" oninput="FX.ponerBoleta(${i},'fecha',this.value)">`)}</div></div>`).join('');
      bol += `<button class="add-btn" onclick="FX.sumarBoleta()">+ Agregar boleta de salida</button>`;
      h += T('reg_boletas', 'Boletas de salida', bol);
      h += T('reg_fotos_boletas', 'Fotos las boletas de salida', htmlFotos('t', 'fotos_boletas'));
      h += T('reg_detalle', 'Detalle del trabajo', area(t, 'detalle'), true);
    }
    h += T('reg_traslado', '¿Realizaste Traslado para este trabajo?', segmento([{ v: 'si', t: 'SI' }, { v: 'no', t: 'NO' }], t.realizo_traslado,
      "FX.poner('t','realizo_traslado',this.dataset.v,true)"), true);
    if (t.realizo_traslado === 'si') h += T('reg_horas_traslado', 'Cantidad de horas de traslado', selHoras('horas_traslado', t.horas_traslado, "FX.poner('t','horas_traslado',this.value)"), true);
    return tarjeta('🔧 Gestión de OT - Obra', h + extrasHtml('taller', 't_registro'));
  }

  // ── Página 5: Inspección Final - Taller (cierre de OT) ──
  function paginaCierre() {
    const ot = otPorNumero(t.ot_numero);
    let h = T('cie_ot', 'OT', boton(t.ot_numero ? (ot ? `OT ${ot.numero} · ${ot.equipo_id || ot.trabajo_general || ''} · ${ot.nombre}` : `OT ${t.ot_numero}`)
      : 'Elegir la OT...', 'FX.elegirOT()', !t.ot_numero), true);
    h += bloqueMedicion();
    h += T('cie_sistemas', 'Sistemas Intervenidos', `<div class="fx-chips">${SISTEMAS_SALIDA.map(s =>
      `<button type="button" class="${tiene(s) ? 'on' : ''}" data-v="${esc(s)}" onclick="FX.tocarSistema(this.dataset.v)">${esc(s)}</button>`).join('')}</div>`, true);
    h += ['Salida - Revisión de Entrada/Salida', 'Salida - Generales', ...SISTEMAS_SALIDA.filter(tiene).map(s => CHK_SALIDA_SISTEMA[s])]
      .map(n => dibujarChecklist(n)).join('');
    h += T('cie_estado', 'Salida - Estado General de la Máquina', lista(opc('taller', 'cie_estado', ESTADOS_SALIDA), t.estado_maquina, 'estado_maquina', 't'), true);
    h += T('cie_fotos', 'Salida - Fotos de la reparación', htmlFotos('t', 'fotos'), true);
    h += T('cie_detalle', 'Detalle del trabajo y estado de la máquina', area(t, 'detalle'), true);
    return tarjeta('✅ Inspección Final - Taller', h + extrasHtml('taller', 't_cierre'));
  }

  function dibujarChecklist(nombre, todasObligatorias) {
    const items = plantilla(nombre);
    if (!items.length) return '';
    const ops = items[0].opciones || [];
    const falta = todasObligatorias && items.some(it => !t.checklist[nombre + '|' + it.item]);
    const editarChk = editandoF('taller') ? ` <button type="button" class="ef-lapiz" title="Editar los ítems de este checklist" data-c="${esc(nombre)}"
      onclick="EditorForm.catalogo('ot_checklist_plantillas',this.dataset.c)">✏️</button>` : '';
    return `<div class="rep-item${falta ? ' fx-falta' : ''}"><div class="rep-head"><span class="rep-title">${esc(nombre)}${todasObligatorias ? ' <span class="req">*</span>' : ''}${editarChk}</span>
      <span class="fx-todo">Todo: ${ops.map(o => `<button type="button" data-c="${esc(nombre)}" data-v="${esc(o)}"
        onclick="FX.checklistTodo(this.dataset.c,this.dataset.v)">${esc(o)}</button>`).join('')}</span></div>
      ${items.map(it => {
        const k = nombre + '|' + it.item, v = t.checklist[k];
        return `<div class="fx-chk"><div>${esc(it.item)}</div><div class="fx-seg chico">${(it.opciones || ops).map(o =>
          `<button type="button" class="${v === o ? 'on' : ''}" data-k="${esc(k)}" data-v="${esc(o)}"
            onclick="FX.ponerChecklist(this.dataset.k,this.dataset.v)">${esc(o)}</button>`).join('')}</div></div>`;
      }).join('')}</div>`;
  }

  // ── Firma (se guarda como imagen al terminar cada trazo) ──
  function iniciarFirma() {
    const cv = $('fx-firma');
    if (!cv) return;
    const ancho = cv.offsetWidth || 320;
    cv.width = ancho; cv.height = 150;
    const ctx = cv.getContext('2d');
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a2744';
    if (t.firma) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, cv.width, cv.height); img.src = t.firma; }
    let dibujando = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
    const arranca = (e) => { e.preventDefault(); dibujando = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const mueve = (e) => { if (!dibujando) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const suelta = () => { if (!dibujando) return; dibujando = false; t.firma = cv.toDataURL('image/png'); };
    cv.addEventListener('mousedown', arranca); cv.addEventListener('mousemove', mueve); window.addEventListener('mouseup', suelta);
    cv.addEventListener('touchstart', arranca, { passive: false }); cv.addEventListener('touchmove', mueve, { passive: false }); cv.addEventListener('touchend', suelta);
  }
  function borrarFirma() { t.firma = null; const cv = $('fx-firma'); if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }

  // ── OT generadas (el mensaje "¡Orden de Trabajo generada con éxito!") ──
  let otGeneradas = [];
  function avisoOTGeneradas() {
    if (!otGeneradas.length) return '';
    return `<div class="card fx-ot-ok"><div class="card-body">
      <b>¡Orden de Trabajo generada con éxito!</b> Su Orden de Trabajo ha sido registrada con el número:
      ${otGeneradas.map(o => `<div class="fx-ot-num">OT Generada: ${o.numero}</div><div><b>Trabajo:</b> ${esc(o.nombre || '')} · <b>Equipo:</b> ${esc(o.equipo || '')}</div>`).join('')}
      <p style="margin:8px 0 0">Por favor, guarde este número y téngalo presente. Es fundamental para el seguimiento, control y coordinación del trabajo.</p>
      <button class="btn-mini btn-neutro" style="margin-top:8px" onclick="FX.cerrarAvisoOT()">Entendido</button></div></div>`;
  }
  function cerrarAvisoOT() { otGeneradas = []; dibujarTaller(); }

  // ── Acciones del formulario de taller ──
  function cambiarCondicion(v) {
    const base = { condicion: v, tecnico_cedula: t.tecnico_cedula, obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto };
    const otPrevia = t.ot_numero, firma = t.firma;
    t = tallerNuevo(base);
    t.firma = firma;
    archivos = Object.fromEntries(Object.entries(archivos).filter(([k]) => !k.startsWith('t.')));
    if (v === 'Cierre de OT - Taller' && otPrevia) return elegirOTNumero(otPrevia);
    dibujarTaller();
  }
  function cambiarTipoOT(v) {
    t.tipo_ot = v;
    if (v === 'Pista' && t.equipo_id && !t.equipos.length) t.equipos = [t.equipo_id];
    if (v === 'Taller' && !t.equipo_id && t.equipos.length) t.equipo_id = t.equipos[0];
    dibujarTaller();
  }
  function cambiarMedicion(v) { t.tipo_medicion = v; aplicarRef(); dibujarTaller(); }
  function ponerTieneOT(v) { t.tiene_ot = v.toLowerCase(); dibujarTaller(); }
  function ponerLectura(id, v) { t.lecturas[id] = v; if (t.lecturas_auto) delete t.lecturas_auto[id]; }
  function elegirTecnico() {
    elegir({ titulo: 'Personal Taller', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
      alElegir: v => poner('t', 'tecnico_cedula', v, true) });
  }
  function elegirLider() {
    elegir({ titulo: 'Líder de trabajo', opciones: (cat.operadores || []).map(o => ({ v: o.v, t: o.t.replace('_', ' · ') })),
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
  // En el Registro de Trabajos también salen las OT cerradas hace menos de
  // 48 h (para cargar horas); en la Inspección Final, solo las abiertas.
  function elegirOT() {
    const l = (C.ots || []).filter(o => otActiva(o) || (esReg() && otCerradaReciente(o)));
    const ops = l.map(o => ({ v: String(o.numero),
      t: `OT ${o.numero} · ${o.equipo_id || o.trabajo_general || ''}`,
      d: `${o.nombre} · ${otCerradaReciente(o) ? 'Cerrada (cargar horas hasta el ' + hastaCuando(o) + ')' : o.estado} · ${tipoDeOT(o)}${o.ubicacion ? ' · ' + o.ubicacion : ''}` }));
    elegir({ titulo: esReg() ? 'OT abiertas y cerradas en las últimas 48 h' : 'OT abiertas', opciones: ops, libre: true,
      alElegir: v => {
        const n = String(v).replace(/\D/g, '');
        if (!n) return toast('Escribí el número de OT', 'warning');
        elegirOTNumero(n);
      } });
  }
  function elegirOTNumero(n) {
    t.ot_numero = String(n);
    const ot = otPorNumero(n);
    if (esCierre() && ot && !otActiva(ot)) toast(`La OT ${n} ya está cerrada`, 'warning');
    if (ot && ot.equipo_id && !t.tipo_medicion) t.tipo_medicion = medicionDe(ot.equipo_id);
    if (otCerradaReciente(ot)) { t.finaliza = ''; t.estado_maquina = ''; }
    dibujarTaller();
    if (ot && ot.equipo_id) traerHorometro(ot.equipo_id);
  }
  function usarOT(n) { t.tiene_ot = 'si'; t.equipo_id = null; elegirOTNumero(n); }
  const opcionesEquipo = () => (C.equipos || []).filter(e => e.categoria !== 'tanque' || !esDiag())
    .map(e => ({ v: e.id, t: `${e.id} · ${e.descripcion || ''}`, d: e.propiedad === 'Tercero' ? 'De tercero' : '' }));
  function elegirEquipo() {
    const gen = esReg() ? TRABAJOS_GENERALES.map(g => ({ v: '§' + g, t: g, d: 'Trabajo sin máquina' })) : [];
    elegir({ titulo: 'Máquina', opciones: [...gen, ...opcionesEquipo()],
      alElegir: v => {
        if (v.startsWith('§')) { t.trabajo_general = v.slice(1); t.equipo_id = null; t.tipo_medicion = MED_REGISTRO[2]; }
        else { t.equipo_id = v; t.trabajo_general = null; t.tipo_medicion = medicionDe(v); }
        dibujarTaller();
        if (t.equipo_id) traerHorometro(t.equipo_id);
      } });
  }
  function elegirEquipos() {
    elegir({ titulo: 'Máquina(s)', multiple: true, actual: t.equipos, opciones: opcionesEquipo(),
      alElegir: l => { t.equipos = l; if (l.length && !t.tipo_medicion) t.tipo_medicion = medicionDe(l[0]); dibujarTaller(); traerHorometro(l); } });
  }
  function elegirSistemasFalla() {
    elegir({ titulo: 'Sistema(s) afectado(s)', multiple: true, actual: sistemasElegidos(),
      opciones: sistemasCatalogo().map(x => ({ v: x, t: x })),
      alElegir: l => {
        t.fallas_sis = l;
        // Las fallas de un sistema que se desmarcó se quitan
        t.fallas = t.fallas.filter(f => !f.includes(' - ') || l.includes(sistemaDeFalla(f)));
        dibujarTaller();
      } });
  }
  function elegirFallas() {
    const sis = sistemasElegidos();
    if (!sis.length) return elegirSistemasFalla();
    const varios = sis.length > 1;
    const ops = (C.fallas || []).filter(f => sis.includes(sistemaDeFalla(f)))
      .map(f => ({ v: f, t: varios ? f : componenteDeFalla(f) }));
    // Las ya elegidas que no están en el catálogo (escritas a mano) también se ven
    t.fallas.forEach(f => { if (!ops.some(o => o.v === f)) ops.unshift({ v: f, t: f }); });
    elegir({ titulo: 'Falla(s) — ' + sis.join(', '), multiple: true, libre: true, actual: t.fallas,
      opciones: ops,
      alElegir: l => {
        // Una falla nueva escrita a mano se guarda con su sistema adelante
        // (si hay uno solo elegido), como las del catálogo
        t.fallas = l.map(f => (!f.includes(' - ') && sis.length === 1) ? sis[0] + ' - ' + f.toUpperCase() : f);
        t.fallas_sis = sistemasElegidos();
        dibujarTaller();
      } });
  }
  function tocarSistema(s) {
    t.sistemas = tiene(s) ? t.sistemas.filter(x => x !== s) : [...t.sistemas, s];
    if (s === 'OTROS' && tiene('OTROS') && !t.otros.length) t.otros.push({ desc: '', horas: '', estado: '' });
    dibujarTaller();
  }
  function ponerItem(k, campoItem, v) { (t.items[k] = t.items[k] || {})[campoItem] = v; }
  function ponerOtro(i, k, v) { t.otros[i][k] = v; }
  function sumarOtro() { t.otros.push({ desc: '', horas: '', estado: '' }); dibujarTaller(); }
  function quitarOtro(i) { t.otros.splice(i, 1); dibujarTaller(); }
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

  // Checklists que se ven en pantalla (solo esos se guardan)
  function checklistsVisibles() {
    if (esFallas()) return t.tipo_reporte === 'CheckList de Mantenimiento' ? [CHK_PREVENTIVO] : [];
    if (esDiag()) return esPista() ? [] : CHK_ENTRADA.map(([n]) => n);
    if (esReg()) return conMtto() ? chkMantenimiento(t.tipo_mantenimiento) : [];
    if (esCierre()) return ['Salida - Revisión de Entrada/Salida', 'Salida - Generales', ...SISTEMAS_SALIDA.filter(tiene).map(s => CHK_SALIDA_SISTEMA[s])];
    return [];
  }

  // ── Validar ──
  // v20261019a: obligatorios = los campos a la vista marcados como obligatorios
  // (los mismos que JotForm, editables desde el formulario). Quedan aparte las
  // reglas que no son "campo vacío": checklists completos, signos y horas del día.
  function validarTaller() {
    construirTaller();   // actualiza la lista de campos a la vista
    const f = faltantes('taller');
    if (esDiag() && !esPista() && t.tipo_ot) {
      const inc = CHK_ENTRADA.filter(([n, todas]) => todas && plantilla(n).some(it => !t.checklist[n + '|' + it.item])).map(([n]) => n);
      if (inc.length) f.push('todas las filas de ' + inc.join(', '));
    }
    const neg = [t.lectura, ...Object.values(t.lecturas)].some(v => num(v) !== null && num(v) < 0);
    if (neg) f.push('números sin signo negativo');
    const horasDia = [...Object.entries(t.items).filter(([k]) => tiene(k.split('|')[0])).map(([, i]) => num(i.horas) || 0),
      ...(tiene('OTROS') ? t.otros.map(o => num(o.horas) || 0) : [])].reduce((a, b) => a + b, 0);
    if (horasDia > 24) return 'Las horas del día suman ' + horasDia + ' h: revisalas (máximo 24).';
    // v20261027f (SQL 65): reglas de cierre de OT
    if (esReg() && !regEnOTCerrada() && t.finaliza === 'si' && regConMaquina() && regTipoOT() !== 'Taller'
        && !permiteCierre(t.estado_maquina) && !f.length)
      return 'Para cerrar la OT la máquina tiene que quedar Reparado, Reparado - Fallas menores o Servicio Tercerizado. Si no, marcá Trabajo Finalizado = NO.';
    if (esCierre()) {
      const ot = otPorNumero(t.ot_numero);
      if (ot && !otActiva(ot)) return `La OT ${ot.numero} ya está cerrada.`;
    }
    return f.length ? 'Falta completar: ' + f.join(', ') + '.' : null;
  }

  // ── Armar el envío (uno por OT: en pista, uno por máquina) ──
  function armarTaller() {
    const reg = esReg(), cie = esCierre();
    const items = Object.entries(t.items)
      .filter(([k]) => tiene(k.split('|')[0]) && !SIN_GRILLA.includes(k.split('|')[0]))
      .map(([k, i]) => ({ sistema: k.split('|')[0], componente: k.split('|').slice(1).join('|'),
        horas: num(i.horas), estado_reparacion: i.estado || null }))
      .filter(i => (i.horas || 0) > 0 || i.estado_reparacion);
    if (reg && tiene('OTROS')) {
      t.otros.filter(o => o.desc.trim() && (num(o.horas) > 0 || o.estado)).forEach(o =>
        items.push({ sistema: 'OTROS', componente: o.desc.trim().toUpperCase(), horas: num(o.horas), estado_reparacion: o.estado || null }));
    }
    const vis = new Set(checklistsVisibles());
    const checklist = Object.entries(t.checklist).filter(([k, v]) => v && vis.has(k.split('|')[0]))
      .map(([k, v]) => ({ checklist: k.split('|')[0], item: k.split('|').slice(1).join('|'), resultado: v }));
    const base = {
      condicion: cond(), fecha: t.fecha,
      tecnico_cedula: t.tecnico_cedula, obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto || null,
      trabajo_ejecutado: (reg || cie) ? t.sistemas : [],
      fallas: t.fallas,
      tipo_medicion: medicionBase(t.tipo_medicion), lectura: conLectura() ? num(t.lectura) : null,
      tipo_mantenimiento: conMtto() ? (t.tipo_mantenimiento || null) : null,
      horas_mantenimiento: conMtto() ? num(t.horas_mantenimiento) : null,
      horas_supervision_tercerizada: reg && tiene('SUPERVISIÓN') ? num(t.horas_supervision_tercerizada) : null,
      realizo_traslado: reg && t.realizo_traslado ? t.realizo_traslado === 'si' : null,
      horas_traslado: reg && t.realizo_traslado === 'si' ? num(t.horas_traslado) : null,
      estado_maquina: cie ? t.estado_maquina : reg ? (regEnOTCerrada() || (tiene('SERVICIOS GENERALES') && !(regConMaquina() && t.finaliza === 'si')) ? null : (t.estado_maquina || null))
        : (esDiag() ? t.estado_maquina_ingreso : null),
      // OT de taller: el registro no la cierra (va la Inspección Final, SQL 65)
      finaliza_ot: cie || (reg && t.finaliza === 'si' && !regEnOTCerrada() && !(regConMaquina() && regTipoOT() === 'Taller')),
      boletas_salida: reg ? t.boletas.filter(b => b.numero || b.fecha) : [],
      detalle: (esFallas() || esDiag()) ? (t.sintomas || null) : (t.detalle || null),
      observaciones: [esFallas() && t.tipo_reporte !== 'General de Fallas' ? 'Tipo de reporte: ' + t.tipo_reporte : '', t.observaciones]
        .filter(Boolean).join(' · ') || null,
      items: reg ? items : [], checklist,
      extras: valoresExtras('taller')
    };
    const otNueva = (equipoId, lectura) => ({
      nombre: esFallas() ? 'Reporte de falla: ' + (t.fallas[0] || 'sin detalle') : t.nombre.trim(),
      equipo_id: equipoId, trabajo_general: equipoId ? null : t.trabajo_general,
      tipo_ot: esDiag() ? t.tipo_ot : (esReg() && equipoId && t.tipo_ot) ? t.tipo_ot : null,
      lider_cedula: t.lider_cedula, fallas: t.fallas, sintomas: t.sintomas || null,
      tipo_medicion: medicionBase(t.tipo_medicion), lectura_ingreso: lectura,
      ingreso_por_averia: esDiag() && !esPista() && t.ingreso_por_averia ? t.ingreso_por_averia === 'SI' : null,
      paro_maquina: esDiag() && t.ingreso_por_averia === 'SI' && t.paro_maquina ? new Date(t.paro_maquina).toISOString() : null,
      fecha_ingreso: esDiag() ? new Date().toISOString() : null,
      fecha_estimada_cierre: t.fecha_estimada_cierre || null,
      estado_maquina_ingreso: esDiag() ? t.estado_maquina_ingreso : null
    });
    if (!abreOT()) return [Object.assign({ client_id: t.client_id, ot_numero: Number(t.ot_numero) }, base)];
    if (esPista()) {
      return t.equipos.map((id, i) => {
        const lec = !conLectura() ? null : t.equipos.length > 1 ? num(t.lecturas[id]) : num(t.lectura);
        return Object.assign({}, base, { client_id: i ? t.client_id + '-' + (i + 1) : t.client_id, lectura: lec, ot_nueva: otNueva(id, lec) });
      });
    }
    return [Object.assign({ client_id: t.client_id, ot_nueva: otNueva(t.equipo_id, base.lectura) }, base)];
  }

  async function enviarTaller() {
    if (enviando) return;
    if (editandoF('taller')) return toast('Terminá la edición del formulario para enviar', 'warning');
    const err = validarTaller();
    if (err) return toast(err, 'warning');
    const envios = armarTaller();
    const nombre = CONDICIONES.find(x => x.v === cond()).t;
    enviando = true;
    try {
      const firma = t.firma;
      await encolar('taller', envios.map(d => ({ datos: d,
        resumen: `${nombre} · ${d.ot_numero ? 'OT ' + d.ot_numero : 'OT nueva · ' + (d.ot_nueva.equipo_id || d.ot_nueva.trabajo_general)}` })),
        Object.assign({ foto_lectura: 'foto_lectura', fotos: 'fotos', fotos_boletas: 'fotos_boletas' }, fotosExtras('taller')), 't', { firma: [firma] });
      toast(envios.length > 1 ? `${envios.length} reportes guardados (una OT por máquina). Se envían ahora o apenas haya señal.`
        : 'Reporte guardado. Se envía ahora o apenas haya señal.', 'success');
      const aCierre = esReg() && t.tiene_ot === 'si' && t.finaliza === 'si' && !regEnOTCerrada()
        && regConMaquina() && regTipoOT() === 'Taller' ? t.ot_numero : null;
      t = tallerNuevo({ condicion: aCierre ? 'Cierre de OT - Taller' : 'Registro de Trabajos - OT', tecnico_cedula: t.tecnico_cedula,
        obra_clave: t.obra_clave, ubicacion_texto: t.ubicacion_texto });
      if (aCierre) {
        elegirOTNumero(aCierre);
        toast(`OT ${aCierre} de taller: completá ahora la Inspección Final - Taller para cerrarla.`, 'info');
      } else dibujarTaller();
      window.scrollTo(0, 0);
      await sincronizar();
    } catch (e) { console.warn(e); toast(e.message || String(e), 'error'); } finally { enviando = false; }
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
      nro_boleta: '', observaciones: '',
      extras: {}
    };
  }
  const desp = () => c.actividad === 'Despacho de combustible';

  // Valor de cada campo de combustible (para la validación genérica de obligatorios)
  const nFotosC = (k) => (archivos['c.' + k] || []).length || null;
  const positivo = (v) => num(v) > 0 ? v : null;
  const cargado = (v) => num(v) !== null ? v : null;
  const GET_C = {
    com_actividad: () => c.actividad, com_fecha: () => c.fecha, com_hora: () => c.hora, com_obra: () => c.obra_clave,
    com_despachador: () => c.despachador_cedula, com_observaciones: () => c.observaciones,
    des_tanque: () => c.tanque, ing_tanque: () => c.tanque, med_tanque: () => c.tanque, pru_tanque: () => c.tanque,
    des_propietario: () => c.propietario, des_equipo: () => c.equipo_id, des_operador: () => c.operador_cedula,
    des_receptor: () => c.receptor_texto, des_operador_texto: () => c.operador_texto, des_lectura: () => c.lectura,
    des_cl_inicial: () => cargado(c.cuenta_litros_inicial), des_cl_final: () => cargado(c.cuenta_litros_final),
    des_litros: () => positivo(c.litros), des_boleta: () => c.nro_boleta, ing_boleta: () => c.nro_boleta,
    des_foto_cl_ini: () => nFotosC('foto_cuenta_inicial'), des_foto_cl_fin: () => nFotosC('foto_cuenta_final'),
    des_foto_boleta: () => nFotosC('foto_boleta'), ing_foto_boleta: () => nFotosC('foto_boleta'),
    ing_proveedor: () => c.proveedor, ing_litros: () => positivo(c.litros_ingresados),
    med_stock: () => cargado(c.stock_medido),
    pru_1: () => cargado(c.prueba_desviacion_1), pru_2: () => cargado(c.prueba_desviacion_2), pru_3: () => cargado(c.prueba_desviacion_3)
  };
  const GET = { taller: GET_T, combustible: GET_C };

  // ── Edición del formulario (editor_form.js) ──
  // Catálogo que alimenta cada campo (equipos y tanques se editan en Flota)
  const OPERADORES = [{ tabla: 'operadores', t: 'Personal' }], OBRAS = [{ tabla: 'obras', t: 'Obras' }];
  const FLOTA = [{ tabla: 'flota', t: 'Equipos y tanques' }], TRABAJOS = [{ tabla: 'ot_catalogo_trabajos', t: 'Trabajos por sistema (de acá salen las fallas)' }];
  const CAT_FX = {
    ini_tecnico: OPERADORES, dia_lider: OPERADORES, ini_ubicacion: OBRAS,
    fal_maquina: FLOTA, dia_maquina: FLOTA, dia_maquinas: FLOTA, reg_maquina: FLOTA,
    fal_fallas: TRABAJOS, dia_fallas: TRABAJOS, reg_fallas: TRABAJOS, reg_trabajo: TRABAJOS, cie_sistemas: TRABAJOS,
    com_obra: OBRAS, com_despachador: OPERADORES, des_operador: OPERADORES,
    des_tanque: FLOTA, ing_tanque: FLOTA, med_tanque: FLOTA, pru_tanque: FLOTA, des_equipo: FLOTA
  };
  const NOTA_ESTADO = 'Para que Flota tome el estado de la máquina, el nombre tiene que decir, como los actuales, «Reparado», «Reparación», «Esperando», «Espera de…», «Pruebas…» o «Funcional…». Si no, la OT lo guarda igual pero Flota no cambia.';
  async function recargarConfig() {
    await cargarConfig();
    if (t && $('screen-taller')) dibujarTaller();
    if (c && $('screen-combustible')) dibujarComb();
  }
  function registrarEditor() {
    if (!window.EditorForm) return;
    ['taller', 'combustible'].forEach(form => EditorForm.registrar(form, {
      redibujar: () => form === 'taller' ? (t && dibujarTaller()) : (c && dibujarComb()),
      recargar: recargarConfig,
      catalogosCambiaron: async () => { await cargarCatalogos(); if (t) dibujarTaller(); if (c) dibujarComb(); },
      catalogos: (k) => CAT_FX[k] || [],
      reglas: () => [],
      protegidas: () => [],
      notaOpciones: (k) => ['dia_estado', 'reg_estado', 'cie_estado'].includes(k) ? NOTA_ESTADO : ''
    }));
  }

  const SEC_ACTIVIDAD = { 'Despacho de combustible': 'c_despacho', 'Ingreso de combustible': 'c_ingreso',
    'Medición de tanque': 'c_medicion', 'Prueba de desviación': 'c_prueba' };
  const K = (k, label, html, req, ayuda) => cx('combustible', k, label, html, req, ayuda);

  function construirComb() {
    VISTOS.combustible = new Map();
    const tq = equipo(c.tanque);
    let h = (window.EditorForm ? EditorForm.barra('combustible') : '') + `<div id="fx-combustible-pend"></div>`;
    h += tarjeta('⛽ Carga de combustible', `
      ${K('com_actividad', 'Actividad realizada', segmento(ACTIVIDADES, c.actividad, 'FX.cambiarActividad(this.dataset.v)'), true)}
      <div class="field-row">${K('com_fecha', 'Fecha', entrada(c, 'fecha', 'date'), true)}${K('com_hora', 'Hora', entrada(c, 'hora', 'time'))}</div>
      ${K('com_obra', 'Obra', boton(c.obra_clave || 'Seleccionar...', 'FX.elegirObraComb()', !c.obra_clave))}
      ${K('com_despachador', 'Despachador', boton(c.despachador_cedula ? nombreOperador(c.despachador_cedula) : 'Seleccionar...', 'FX.elegirDespachador()', !c.despachador_cedula), true)}
    ` + extrasHtml('combustible', 'c_inicio'));

    const pre = { 'Despacho de combustible': 'des', 'Ingreso de combustible': 'ing', 'Medición de tanque': 'med', 'Prueba de desviación': 'pru' }[c.actividad];
    const tituloTanque = { 'Despacho de combustible': 'Tanque de salida', 'Ingreso de combustible': 'Tanque fijo que recibe',
      'Medición de tanque': 'Tanque medido', 'Prueba de desviación': 'Tanque / surtidor' }[c.actividad];
    let cuerpo = K(pre + '_tanque', tituloTanque, boton(tq ? textoEquipo(tq.id) : 'Seleccionar...', 'FX.elegirTanque()', !tq), true,
      tq && tq.capacidad ? `Capacidad: ${Number(tq.capacidad).toLocaleString('es-PY')} L` : '');

    if (desp()) {
      cuerpo += K('des_propietario', 'El que recibe es', segmento([{ v: 'Tecsul', t: 'Equipo Tecsul' }, { v: 'Tercero/alquilado', t: 'Tercero / alquilado' }],
        c.propietario, "FX.poner('c','propietario',this.dataset.v,true)"), true);
      if (c.propietario === 'Tecsul') {
        cuerpo += K('des_equipo', 'Equipo que recibe', boton(c.equipo_id ? textoEquipo(c.equipo_id) : 'Seleccionar...', 'FX.elegirReceptor()', !c.equipo_id), true,
          equipo(c.equipo_id)?.categoria === 'tanque' ? 'Es un tanque: queda como traspaso entre tanques' : '');
        cuerpo += K('des_operador', 'Operador', boton(c.operador_cedula ? nombreOperador(c.operador_cedula) : 'Seleccionar...', 'FX.elegirOperadorComb()', !c.operador_cedula));
      } else {
        cuerpo += K('des_receptor', 'Chapa / descripción del equipo', entrada(c, 'receptor_texto', 'text', 'placeholder="Ej.: XBCD 123 camión volquete"'), true);
        cuerpo += K('des_operador_texto', 'Operador / chofer', entrada(c, 'operador_texto'));
      }
      cuerpo += K('des_lectura', c.tipo_medicion === 'Odómetro' ? 'Kilometraje' : 'Horómetro',
        segmento(['Horómetro', 'Odómetro'], c.tipo_medicion, "FX.poner('c','tipo_medicion',this.dataset.v,true)") + entrada(c, 'lectura', 'number'));
      cuerpo += `<div class="field-row">${K('des_cl_inicial', 'Cuenta litros inicial', entrada(c, 'cuenta_litros_inicial', 'number'), false, c._ultimo || '')}
        ${K('des_cl_final', 'Cuenta litros final', entrada(c, 'cuenta_litros_final', 'number'))}</div>
        <div class="field-alert" id="fx-litros-alerta"></div>`;
      cuerpo += K('des_litros', 'Litros despachados', entrada(c, 'litros', 'number', 'id="fx-litros"'), true, 'Se calcula solo con el cuenta litros; si no hay, cargalo a mano');
      cuerpo += K('des_boleta', 'Nº de boleta / remisión', entrada(c, 'nro_boleta'));
      cuerpo += K('des_foto_cl_ini', 'Foto cuenta litros inicial', htmlFotos('c', 'foto_cuenta_inicial'));
      cuerpo += K('des_foto_cl_fin', 'Foto cuenta litros final', htmlFotos('c', 'foto_cuenta_final'));
      cuerpo += K('des_foto_boleta', 'Foto de la boleta', htmlFotos('c', 'foto_boleta'));
    }
    if (c.actividad === 'Ingreso de combustible') {
      cuerpo += K('ing_proveedor', 'Proveedor', entrada(c, 'proveedor'), true);
      cuerpo += K('ing_litros', 'Litros ingresados', entrada(c, 'litros_ingresados', 'number'), true);
      cuerpo += K('ing_boleta', 'Nº de boleta / remisión', entrada(c, 'nro_boleta'));
      cuerpo += K('ing_foto_boleta', 'Foto de la boleta', htmlFotos('c', 'foto_boleta'));
    }
    if (c.actividad === 'Medición de tanque') {
      cuerpo += K('med_stock', 'Cantidad de combustible en el tanque (litros)', entrada(c, 'stock_medido', 'number'), true);
    }
    if (c.actividad === 'Prueba de desviación') {
      cuerpo += `<div class="field-row">${K('pru_1', '1ra prueba', entrada(c, 'prueba_desviacion_1', 'number'), true)}
        ${K('pru_2', '2da prueba', entrada(c, 'prueba_desviacion_2', 'number'))}${K('pru_3', '3ra prueba', entrada(c, 'prueba_desviacion_3', 'number'))}</div>`;
    }
    cuerpo += extrasHtml('combustible', SEC_ACTIVIDAD[c.actividad]);
    cuerpo += K('com_observaciones', 'Observaciones', area(c, 'observaciones'));
    h += tarjeta(ACTIVIDADES.find(a => a.v === c.actividad).t, cuerpo);
    h += editandoF('combustible') ? '' : `<div class="form-nav"><button class="btn-submit" onclick="FX.enviarComb()">Enviar</button></div>`;
    h += `<div id="fx-combustible-recientes"></div>`;
    return h;
  }

  function dibujarComb() {
    const pantalla = $('screen-combustible');
    if (!pantalla) return;
    const sc = window.scrollY;
    pantalla.innerHTML = construirComb();
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

  // v20261019a: obligatorios = los campos a la vista marcados como obligatorios;
  // aparte, la coherencia del cuenta litros
  function validarComb() {
    construirComb();
    const f = faltantes('combustible');
    if (desp() && num(c.cuenta_litros_inicial) !== null && num(c.cuenta_litros_final) !== null
        && num(c.cuenta_litros_final) < num(c.cuenta_litros_inicial)) return 'El cuenta litros final no puede ser menor que el inicial.';
    return f.length ? 'Falta completar: ' + f.join(', ') + '.' : null;
  }

  function armarComb() {
    const tecsul = c.propietario === 'Tecsul';
    const fila = {
      client_id: c.client_id, actividad: c.actividad, fecha: c.fecha, hora: c.hora || null,
      despachador_cedula: c.despachador_cedula, obra_clave: c.obra_clave,
      observaciones: c.observaciones || null, usuario_id: sesion.id
    };
    const ex = valoresExtras('combustible');
    if (Object.keys(ex).length) fila.extras = ex;
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
    if (editandoF('combustible')) return toast('Terminá la edición del formulario para enviar', 'warning');
    const err = validarComb();
    if (err) return toast(err, 'warning');
    const fila = armarComb();
    const resumen = desp()
      ? `${fila.litros} L · ${fila.tanque_salida_id} → ${fila.equipo_id || fila.receptor_texto}`
      : `${ACTIVIDADES.find(a => a.v === c.actividad).t} · ${c.tanque}`;
    enviando = true;
    try {
      await encolar('combustible', [{ datos: fila, resumen }],
        Object.assign({ foto_boleta: 'foto_boleta', foto_cuenta_inicial: 'foto_cuenta_inicial', foto_cuenta_final: 'foto_cuenta_final' }, fotosExtras('combustible')), 'c');
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
    } catch (e) { console.warn(e); toast(e.message || String(e), 'error'); } finally { enviando = false; }
  }

  // ════════════════════════════════════════════════════════════════
  // COLA LOCAL Y ENVÍO
  // ════════════════════════════════════════════════════════════════
  const cola = () => JSON.parse(localStorage.getItem(COLA) || '[]');
  const guardar = (l) => localStorage.setItem(COLA, JSON.stringify(l));

  // envios: [{ datos, resumen }] — comparten las fotos (y la firma, en extras)
  async function encolar(tipo, envios, camposFoto, form, extras) {
    const fotos = {};
    for (const k of Object.keys(camposFoto)) {
      const l = archivos[form + '.' + k] || [];
      if (!l.length) continue;
      try { fotos[k] = await Promise.all(l.map(f => aBase64(f))); }
      catch (e) {
        // v20261027a: ya no se manda sin la foto en silencio
        console.warn('Foto:', e);
        throw new Error(window.motivoFoto ? motivoFoto(e) : 'Una foto no se pudo abrir. Sacala de nuevo.');
      }
    }
    // Se borran recién cuando TODAS se pudieron leer (si una falla, el formulario queda intacto)
    Object.keys(camposFoto).forEach(k => delete archivos[form + '.' + k]);
    Object.entries(extras || {}).forEach(([k, v]) => { if (v && v.filter(Boolean).length) fotos[k] = v.filter(Boolean); });
    const l = cola();
    envios.forEach(({ datos, resumen }) =>
      l.push({ tipo, id: datos.client_id, resumen, fecha: datos.fecha, datos, fotos, creado: new Date().toISOString() }));
    try { guardar(l); }
    catch (e) {
      // Sin lugar en el teléfono: se guarda sin fotos antes que perderlo.
      l.slice(-envios.length).forEach(x => { x.fotos = x.fotos.firma ? { firma: x.fotos.firma } : {}; });
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
              rutas.push(await subir(bucket, lista[i], `${p.id}/${k}${lista.length > 1 ? '_' + (i + 1) : ''}`));
            }
            if (k.startsWith('x_')) { d.extras = Object.assign({}, d.extras, { [k.slice(2)]: rutas }); continue; }   // campo nuevo
            const unica = p.tipo === 'combustible' || k === 'foto_lectura' || k === 'firma';
            d[k] = unica ? rutas[0] : rutas;
          }
          if (p.tipo === 'taller') {
            if (d.ot_nueva && ['Diagnóstico Inicial - Generación OT', 'Reporte de Fallas'].includes(d.condicion)) d.ot_nueva.imagenes = d.fotos || [];
            const { data, error } = await sb.rpc('ot_registrar', { p: d });
            if (error) throw error;
            p.numero = data && data.numero;
            if (data && data.aviso) setTimeout(() => toast(data.aviso, 'warning'), 400);
          } else {
            const { error } = await sb.from('combustible_movimientos')
              .upsert(d, { onConflict: 'client_id', ignoreDuplicates: true });
            if (error) throw error;
          }
          quitar(p.id);
          ok++;
          if (p.tipo === 'taller' && p.numero && p.datos.ot_nueva) {
            toast(p.datos.condicion === 'Reporte de Fallas'
              ? `Falla reportada: OT ${p.numero} Solicitada (pendiente de que taller la tome)` : `Enviado: OT ${p.numero}`, 'success');
            if (p.datos.condicion !== 'Reporte de Fallas') {
              otGeneradas.push({ numero: p.numero, nombre: p.datos.ot_nueva.nombre, equipo: p.datos.ot_nueva.equipo_id || p.datos.ot_nueva.trabajo_general });
              if ($('screen-taller')?.classList.contains('active') && t) dibujarTaller();
            }
          }
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
      const { data, error } = await pedirOTs();
      if (error) throw error;
      C.ots = data || [];
      localStorage.setItem('fx_cat', JSON.stringify(C));
    } catch (e) { /* queda la lista anterior */ }
  }

  // v20261026b: devuelve la ruta o lanza un error con el motivo real.
  // Solo los cortes de red dicen "señal débil"; lo demás (permisos, tamaño,
  // formato) se muestra tal cual para poder diagnosticarlo.
  async function subir(bucket, b64, nombre) {
    const blob = await (await fetch(b64)).blob();
    const ruta = `${nombre}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
    let error;
    try { ({ error } = await sb.storage.from(bucket).upload(ruta, blob, { contentType: blob.type, upsert: true })); }
    catch (e) { error = e; }
    if (!error) return ruta;
    console.warn('Foto:', error);
    const msg = String(error.message || error);
    if (/already exists|duplicate/i.test(msg)) return ruta;   // subida en un intento anterior
    if (!navigator.onLine || /fetch|network|load failed|timeout|abort/i.test(msg))
      throw new Error('No se pudo subir una foto (señal débil). Se reintenta solo.');
    throw new Error('No se pudo subir una foto: ' + msg);
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
          .select('id,actividad,fecha,hora,litros,litros_ingresados,stock_medido,tanque_salida_id,tanque_fijo_id,equipo_id,receptor_texto,creado_en')
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
    // v20261023a: lo propio de las últimas 24 h se puede eliminar desde acá
    const borrable = (r) => Date.now() - new Date(r.creado_en).getTime() < 24 * 3600 * 1000;
    const btnEliminar = (r) => borrable(r)
      ? `<button type="button" class="btn-mini btn-off" style="margin-top:6px" onclick="FX.eliminarReciente('${tipo}','${r.id}')">Eliminar</button>` : '';
    const filas = tipo === 'taller'
      ? l.map(r => { const o = r.ordenes_trabajo || {};
          return `<div class="history-item" style="cursor:default"><div class="history-item-header">
            <div><h3>OT ${o.numero || ''} · ${esc(o.equipo_id || o.trabajo_general || '')}</h3>
            <div class="meta">${fechaCorta(r.fecha)} · ${esc((CONDICIONES.find(x => x.v === r.condicion) || {}).t || r.condicion)}
              ${r.estado_maquina ? ' · ' + esc(r.estado_maquina) : ''}<br>${esc(o.nombre || '')}</div>${btnEliminar(r)}</div>
            <span class="badge ${o.estado === 'Cerrada' ? 'badge-enviado' : 'badge-pendiente'}">${esc(o.estado || '')}</span></div></div>`; })
      : l.map(r => `<div class="history-item" style="cursor:default"><div class="history-item-header">
            <div><h3>${esc((ACTIVIDADES.find(a => a.v === r.actividad) || {}).t || r.actividad)} ·
              ${r.litros ?? r.litros_ingresados ?? r.stock_medido ?? ''} L</h3>
            <div class="meta">${fechaCorta(r.fecha)} ${r.hora ? String(r.hora).slice(0, 5) : ''} ·
              ${esc(r.tanque_salida_id || r.tanque_fijo_id || '')}${r.equipo_id || r.receptor_texto ? ' → ' + esc(r.equipo_id || r.receptor_texto) : ''}</div>${btnEliminar(r)}</div>
            <span class="badge badge-enviado">Enviado</span></div></div>`);
    box.innerHTML = `<h3 style="font-size:calc(14px*var(--fs,1));margin:22px 0 8px">Lo último que cargaste</h3>
      <p class="ayuda" style="margin:-4px 0 8px">Si algo quedó mal, eliminalo (hasta 24 h después) y cargalo de nuevo.</p>` + filas.join('');
  }

  async function eliminarReciente(tipo, id) {
    const motivo = prompt('¿Por qué lo eliminás? (ej.: cargado dos veces, litros mal)');
    if (motivo === null) return;
    if (!motivo.trim()) return toast('Escribí el motivo', 'warning');
    const { error } = await sb.rpc('eliminar_registro', {
      p_tabla: tipo === 'taller' ? 'ot_registros' : 'combustible_movimientos', p_id: id, p_motivo: motivo.trim() });
    if (error) return toast('No se pudo eliminar: ' + error.message, 'error');
    toast('Eliminado. Administración lo puede recuperar durante 7 días.', 'success');
    recientes[tipo] = null;
    cargarRecientes(tipo);
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
        border-radius: 8px; font-size: calc(14px*var(--fs,1)); font-weight: 600; color: var(--gris-texto); cursor: pointer; }
      .fx-seg button.on { background: var(--azul-medio); color: #fff; border-color: var(--azul-medio); }
      .fx-seg.chico { margin: 4px 0 0; }
      .fx-seg.chico { flex-wrap: nowrap; }
      .fx-seg.chico button { flex: 1 1 0; min-width: 0; padding: 6px 4px; font-size: calc(11.5px*var(--fs,1)); line-height: 1.2; }
      .fx-seg.chico button.on { background: var(--verde); border-color: var(--verde); }
      .fx-cond { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .fx-cond button { text-align: left; padding: 10px 11px; border: 1.5px solid var(--gris-borde); background: var(--blanco);
        border-radius: 9px; cursor: pointer; color: var(--azul-oscuro); }
      .fx-cond button b { display: block; font-size: calc(14px*var(--fs,1)); }
      .fx-cond button span { display: block; font-size: calc(11.5px*var(--fs,1)); color: var(--gris-texto); margin-top: 2px; }
      .fx-cond button.on { border-color: var(--naranja); background: #fff5ec; box-shadow: 0 0 0 1px var(--naranja) inset; }
      .fx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .fx-chips button { padding: 8px 12px; border-radius: 20px; border: 1.5px solid var(--gris-borde); background: var(--blanco);
        font-size: calc(13px*var(--fs,1)); font-weight: 600; color: var(--gris-texto); cursor: pointer; }
      .fx-chips button.on { background: var(--naranja); color: #fff; border-color: var(--naranja); }
      .fx-fila { display: grid; grid-template-columns: 1fr 64px; gap: 6px; align-items: center; padding: 5px 0;
        border-bottom: 1px solid #eef1f5; font-size: calc(13px*var(--fs,1)); }
      .fx-fila.con-estado { grid-template-columns: 1fr 64px 1fr; }
      .fx-fila input, .fx-fila select { width: 100%; padding: 8px; border: 1.5px solid var(--gris-borde); border-radius: 7px; font-size: calc(14px*var(--fs,1)); background: #fff; }
      @media (max-width: 480px) {
        .fx-fila.con-estado { grid-template-columns: 1fr 64px; }
        .fx-fila.con-estado select { grid-column: 1 / -1; }
      }
      .fx-chk { padding: 7px 0; border-bottom: 1px solid #eef1f5; font-size: calc(13px*var(--fs,1)); }
      .fx-todo { font-size: calc(11px*var(--fs,1)); color: var(--gris-texto); display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
      .fx-todo button { border: 0; background: #e0e7ff; color: var(--azul-medio); border-radius: 6px; padding: 3px 7px; font-size: calc(11px*var(--fs,1)); cursor: pointer; }
      .fx-check { display: flex; gap: 8px; align-items: center; font-size: calc(14px*var(--fs,1)); cursor: pointer; }
      .fx-check input { width: 20px; height: 20px; }
      .fx-fotos { display: flex; gap: 8px; flex-wrap: wrap; }
      .fx-foto { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--gris-borde); }
      .fx-foto img { width: 100%; height: 100%; object-fit: cover; }
      .fx-foto button { position: absolute; top: 3px; right: 3px; background: rgba(0,0,0,.6); color: #fff; border: 0;
        border-radius: 50%; width: 24px; height: 24px; cursor: pointer; }
      .fx-foto-mas { width: 84px; height: 84px; border: 1.5px dashed var(--azul-medio); border-radius: 8px; display: flex;
        flex-direction: column; align-items: center; justify-content: center; font-size: calc(26px*var(--fs,1)); cursor: pointer; background: #eef2f9; }
      .fx-foto-mas small { font-size: calc(11px*var(--fs,1)); color: var(--azul-medio); font-weight: 600; margin-top: 2px; }
      #fx-modal .modal-card { max-width: 700px; margin: 0 auto; }
      .fx-cond { grid-template-columns: 1fr 1fr; }
      .fx-firma canvas { width: 100%; height: 150px; border: 1.5px dashed var(--gris-borde); border-radius: 8px; background: #fff; touch-action: none; display: block; margin-bottom: 6px; }
      .fx-falta { border-color: #f1b8b1 !important; }
      .fx-fila select { min-width: 0; }
      .fx-otro { grid-template-columns: 1fr 64px 1fr 32px !important; }
      .fx-ot-ok { border-left: 5px solid var(--verde); }
      .fx-ot-ok .fx-ot-num { font-size: calc(26px*var(--fs,1)); font-weight: 800; color: var(--azul-oscuro); margin: 6px 0 2px; }
    `;
    document.head.appendChild(s);
  }

  return {
    iniciar, mostrar, sincronizar, pendientes: cola,
    cerrarPicker, filtrarPicker, tocarOpcion, confirmarPicker,
    poner, ponerRedibujar, sumarFotos, quitarFoto,
    eliminarReciente, cambiarCondicion, elegirTecnico, elegirLider, elegirUbicacion, elegirOT, usarOT, elegirEquipo, elegirFallas, elegirSistemasFalla,
    tocarSistema, ponerItem, ponerChecklist, checklistTodo, sumarBoleta, quitarBoleta, ponerBoleta, enviarTaller,
    cambiarTipoOT, ponerTieneOT, ponerLectura, ponerLecturaUnica, cambiarMedicion, elegirEquipos, ponerOtro, sumarOtro, quitarOtro, borrarFirma, cerrarAvisoOT,
    cambiarActividad, elegirObraComb, elegirDespachador, elegirTanque, elegirReceptor, elegirOperadorComb, enviarComb,
    descartar, ponerExtra, tocarExtra, recargarConfig
  };
})();
