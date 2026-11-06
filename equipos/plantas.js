/* =========================================================================
 * plantas.js — PLANTAS (asfalto, hormigón, suelo) · equipos-v91 · SQL 92
 *
 *  Cinco vistas, según el rol en cada planta (lo decide la base: plantas_acceso):
 *   · Parte de planta  (encargado y operadores de esa planta, admin central)
 *       arranque → lectura cada hora (contador del SCADA + regla de cada tanque)
 *       → paradas con causa → cierre con la producción de báscula (la oficial).
 *       Funciona sin señal: todo va a una cola en el teléfono y se envía solo.
 *   · En vivo  (todos los que ven la planta): se actualiza sola (Supabase
 *       Realtime). t/h, %CAP y L/t de cada hora con semáforo, stock de los
 *       tanques y autonomía, aviso cuando una hora sale de la fórmula o pasa
 *       mucho sin lectura.
 *   · Tablero  (todos): período, KPIs, producción diaria y %CAP, paradas por
 *       causa, días con báscula / contador / Transporte.
 *   · Báscula  (operador de báscula, encargado, operadores, admin central): un
 *       renglón por ticket (chapa, bruto, tara → neto, obra). Va llegando en vivo
 *       y suma la producción oficial del día.
 *   · Recargas  (CAP: admin de obra y admin central · fuel/gasoil: también el
 *       encargado; todos ven).
 *   · Configuración  (admin central y encargado de la planta, SQL 97): planta, tanques y aforo, fórmulas, precios, personal.
 *
 *  Aforo: la regla se carga en metros; «libre» = vacío desde arriba, «stock» =
 *  altura de líquido. Cilindro horizontal = misma fórmula que cilindro_vol.xlsx:
 *  A = r²·acos((r−h)/r) − (r−h)·√(h·(2r−h)), V = A · largo.
 *  CAP en toneladas = litros × densidad de referencia (t/m³) ÷ 1000.
 * ========================================================================= */
window.Plantas = (function () {
  'use strict';

  const SUPABASE_URL = localStorage.getItem('sb_url') || 'https://sququxlqcrbsoqvmycfa.supabase.co';
  const SUPABASE_KEY = localStorage.getItem('sb_key') || 'sb_publishable_pN_FUHE3sbU98ReSQriUpg_zQeBko7R';
  const APP_PARTES = './parte_diario_v5.html';
  const BUCKET = 'plantas';
  const CAUSAS = ['Falta de camión', 'Espera en pista', 'Falla mecánica', 'Falla eléctrica', 'Humedad de áridos',
    'Lluvia', 'Falta de material', 'CAP sin temperatura', 'Mantenimiento', 'Otro'];
  const INSUMOS = { cap: 'CAP', fuel: 'Fuel / gasoil secadero', gasoil: 'Gasoil caldera', cemento: 'Cemento', agua: 'Agua', aditivo: 'Aditivo', otro: 'Otro' };
  const FORMAS = { cilindro_h: 'Cilindro acostado', cilindro_v: 'Cilindro parado', tabla: 'Tabla de aforo' };
  const ROLES = { admin: 'Administrador', encargado: 'Encargado de planta', operador: 'Operador de planta', bascula: 'Operador de báscula', admin_obra: 'Admin de obra', ver: 'Consulta' };

  let sb = null;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cronograma-auth' }
    });
  } catch (e) { /* se avisa al iniciar */ }

  // ───────────────────────────── utilidades
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vacio = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v));
  const num = (v) => vacio(v) ? null : Number(v);
  function fN(v, d) {
    if (vacio(v) || !isFinite(v)) return '—';
    const dec = d === undefined ? 0 : d;
    return Number(v).toLocaleString('es-PY', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // "1,22" · "1.22" · "1.500" (miles) · "1.500,5" → número
  function pNum(t) {
    let s = String(t ?? '').trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }
  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // datetime-local ⇄ ISO
  function aLocalInput(iso) {
    const d = iso ? new Date(iso) : new Date();
    return `${isoLocal(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const deLocalInput = (v) => v ? new Date(v).toISOString() : null;
  const fHora = (iso) => iso ? new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fFecha = (iso) => { if (!iso) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
  const fFechaHora = (iso) => iso ? new Date(iso).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  function fDur(min) {
    if (vacio(min) || !isFinite(min)) return '—';
    const m = Math.max(0, Math.round(min));
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  }
  const leer = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno */ } };
  function errMsg(e) { return (e && (e.message || e.error_description || e.details)) || String(e); }
  const esRed = (e) => !navigator.onLine || /fetch|network|Failed|timeout|abort|Load failed/i.test(errMsg(e));
  function toast(t, tipo, ms) {
    const el = $('#toast'); el.textContent = t; el.className = tipo || ''; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, ms || (tipo === 'error' ? 7000 : 3500));
  }
  const carga = (on, txt) => { const c = $('#carga'); c.textContent = txt || 'Cargando…'; c.hidden = !on; };
  function modal(titulo, cuerpo, botones, ancho) {
    cerrarModal();
    const f = document.createElement('div');
    f.className = 'modal-fondo'; f.id = 'modal';
    f.innerHTML = `<div class="modal${ancho ? ' ancho' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}<button type="button" data-cerrar aria-label="Cerrar">×</button></h3>
      <div class="cuerpo">${cuerpo}</div><div class="pie">${botones || ''}<button type="button" class="btn" data-cerrar>Cancelar</button></div></div>`;
    f.addEventListener('click', (e) => { if (e.target === f || e.target.closest('[data-cerrar]')) cerrarModal(); });
    document.body.appendChild(f);
    const pri = f.querySelector('input,select,textarea'); if (pri) setTimeout(() => pri.focus(), 50);
    return f;
  }
  const cerrarModal = () => { const m = $('#modal'); if (m) m.remove(); };

  // ───────────────────────────── aforo
  function altoTotal(t) {
    if (t.forma === 'cilindro_h') return num(t.diametro_m);
    if (t.forma === 'cilindro_v') return num(t.altura_m);
    const tb = tablaDe(t);
    return num(t.altura_m) || (tb.length ? tb[tb.length - 1][0] : null);
  }
  function tablaDe(t) {
    const tb = Array.isArray(t.tabla) ? t.tabla : [];
    return tb.filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0]);
  }
  function aforoListo(t) {
    if (t.forma === 'cilindro_h') return num(t.diametro_m) > 0 && num(t.largo_m) > 0;
    if (t.forma === 'cilindro_v') return num(t.diametro_m) > 0 && num(t.altura_m) > 0;
    return tablaDe(t).length >= 2;
  }
  // litros a una altura de líquido h (m)
  function litrosAltura(t, h) {
    const H = altoTotal(t);
    if (vacio(h) || !H) return null;
    h = Math.min(Math.max(h, 0), H);
    if (t.forma === 'cilindro_h') {
      const r = num(t.diametro_m) / 2, L = num(t.largo_m);
      const a = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, h * (2 * r - h)));
      return a * L * 1000;
    }
    if (t.forma === 'cilindro_v') {
      const r = num(t.diametro_m) / 2;
      return Math.PI * r * r * h * 1000;
    }
    const tb = tablaDe(t);
    if (tb.length < 2) return null;
    if (h <= tb[0][0]) return tb[0][1];
    for (let i = 1; i < tb.length; i++) {
      if (h <= tb[i][0]) { const [h0, l0] = tb[i - 1], [h1, l1] = tb[i]; return l0 + (l1 - l0) * (h - h0) / ((h1 - h0) || 1); }
    }
    return tb[tb.length - 1][1];
  }
  const capacidad = (t) => aforoListo(t) ? litrosAltura(t, altoTotal(t)) : null;
  // regla tal como la escribe el operador → {m, litros, aviso}. Acepta cm si el número no entra en el tanque.
  function convertirRegla(t, txt) {
    const v = pNum(txt);
    if (v === null) return { m: null, litros: null };
    if (isNaN(v) || v < 0) return { m: null, litros: null, aviso: 'Número no válido' };
    const H = altoTotal(t);
    let m = v, aviso = '';
    if (H && v > H + 0.02 && v / 100 <= H + 0.02) { m = v / 100; aviso = `tomado como ${fN(v, 0)} cm`; }
    if (!aforoListo(t)) return { m, litros: null, aviso: 'Falta el aforo del tanque (Configuración)' };
    if (m > H + 0.02) return { m, litros: null, aviso: `Más alto que el tanque (${fN(H, 2)} m)` };
    const h = t.modo_lectura === 'libre' ? H - m : m;
    return { m, litros: litrosAltura(t, h), aviso };
  }
  const aTon = (t, litros) => (vacio(litros) ? null : litros * (num(t.densidad) || 1) / 1000);

  // ───────────────────────────── estado
  const S = {
    perfil: null, acceso: [], obras: [], nombres: {},
    planta: null, vista: null,
    cfg: {},        // planta_id → { planta, tanques, formulas, personal }
    dia: {},        // planta_id → { jornada, lecturas, paradas, recargas, jornadasHoy }
    vivoCanal: null, ultAlerta: {},
    tablero: { desde: null, hasta: null },
  };
  const acc = (p) => S.acceso.find(a => a.planta === (p || S.planta)) || null;
  const rol = (p) => (acc(p) || {}).rol || null;
  const cargaParte = (p) => ['admin', 'encargado', 'operador'].includes(rol(p));
  const corrige = (p) => ['admin', 'encargado'].includes(rol(p));
  // Configuración: admin central y el encargado de esa planta (SQL 97: planta_configura)
  const configura = (p) => rol(p) === 'admin' || !!(acc(p) || {}).configura;
  const puedePesar = (p) => ['admin', 'encargado', 'operador', 'bascula'].includes(rol(p));
  const esAdmin = () => S.acceso.some(a => a.rol === 'admin');
  function puedeRecargar(t) {
    const r = rol(t.planta_id);
    if (r === 'admin' || (acc(t.planta_id) || {}).recarga_cap) return true;
    return t.insumo !== 'cap' && r === 'encargado';
  }
  const cfg = () => S.cfg[S.planta] || { planta: {}, tanques: [], formulas: [], personal: [] };
  const conf = (k, def) => { const c = (cfg().planta || {}).config || {}; return vacio(c[k]) ? def : c[k]; };
  const unidad = () => (cfg().planta || {}).unidad === 'm3' ? 'm³' : 't';
  const esAsfalto = () => (cfg().planta || {}).tipo === 'asfalto';

  // ───────────────────────────── cola sin señal
  // Cada operación queda en el teléfono hasta que la base la acepta. Las filas
  // llevan su id (uuid) desde el teléfono: reenviar nunca duplica.
  const COLA = 'plantas_cola';
  const cola = () => leer(COLA, []);
  function encolar(op) { const c = cola(); c.push(Object.assign({ k: uuid(), en: new Date().toISOString() }, op)); guardar(COLA, c); pintarPendientes(); }
  let enviando = false;
  async function enviarCola() {
    if (enviando || !navigator.onLine || !sb) { pintarPendientes(); return; }
    enviando = true;
    let c = cola(), cambio = false;
    try {
      for (const op of c.slice()) {
        if (op.error) continue;
        let r;
        try {
          if (op.op === 'foto') {
            const blob = await (await fetch(op.data)).blob();
            r = await sb.storage.from(BUCKET).upload(op.ruta, blob, { contentType: 'image/jpeg', upsert: true });
          } else if (op.op === 'upsert') {
            r = await sb.from(op.t).upsert(op.fila, { onConflict: 'id' });
          } else if (op.op === 'update') {
            r = await sb.from(op.t).update(op.cambios).eq('id', op.id);
          } else if (op.op === 'delete') {
            r = await sb.from(op.t).delete().eq('id', op.id);
          }
        } catch (e) { r = { error: e }; }
        if (r && r.error) {
          if (esRed(r.error)) break;                       // sin señal: se reintenta después
          op.error = errMsg(r.error);                      // rechazado por la base: queda a la vista
        } else {
          c = c.filter(x => x.k !== op.k); cambio = true;
        }
        guardar(COLA, c.map(x => x.k === op.k ? op : x));
        c = cola();
      }
    } finally { enviando = false; pintarPendientes(); }
    if (cambio && S.planta) { await cargarDia(S.planta, true); pintar(); }
  }
  function pintarPendientes() {
    const el = $('#pendientes'); if (!el) return;
    const c = cola(), err = c.filter(x => x.error).length;
    el.hidden = !c.length;
    el.className = 'pend' + (err ? ' err' : '');
    el.textContent = err ? `⚠ ${err} sin aceptar · ver` : `⏳ ${c.length} sin enviar`;
    el.onclick = err ? verErroresCola : null;
  }
  function verErroresCola() {
    const c = cola().filter(x => x.error);
    modal('Cargas que la base no aceptó', `<p class="nota">Probablemente cambió un permiso o la jornada ya estaba cerrada. Podés descartarlas o volver a intentar.</p>
      <div class="tw"><table class="t"><tr><th class="l">Cuándo</th><th class="l">Qué</th><th class="l">Motivo</th></tr>
      ${c.map(x => `<tr><td class="l">${fFechaHora(x.en)}</td><td class="l">${esc(x.t || x.op)}</td><td class="l" style="white-space:normal">${esc(x.error)}</td></tr>`).join('')}</table></div>`,
      `<button class="btn" id="cola-reint">Volver a intentar</button><button class="btn rojo" id="cola-desc">Descartar</button>`);
    $('#cola-reint').onclick = () => { guardar(COLA, cola().map(x => (delete x.error, x))); cerrarModal(); enviarCola(); };
    $('#cola-desc').onclick = () => { guardar(COLA, cola().filter(x => !x.error)); cerrarModal(); pintarPendientes(); cargarDia(S.planta, true).then(pintar); };
  }
  // Aplica lo pendiente sobre lo que vino de la base (para ver lo propio sin señal)
  function conPendientes(tabla, filas, filtro) {
    let out = filas.slice();
    for (const op of cola()) {
      if (op.t !== tabla) continue;
      if (op.op === 'upsert' && filtro(op.fila)) {
        const i = out.findIndex(f => f.id === op.fila.id);
        const f = Object.assign({}, i >= 0 ? out[i] : {}, op.fila, { _pend: true });
        if (i >= 0) out[i] = f; else out.push(f);
      } else if (op.op === 'update') {
        const i = out.findIndex(f => f.id === op.id); if (i >= 0) out[i] = Object.assign({}, out[i], op.cambios, { _pend: true });
      } else if (op.op === 'delete') {
        out = out.filter(f => f.id !== op.id);
      }
    }
    return out;
  }
  // guarda: intenta enseguida; si no hay señal queda en la cola
  async function grabar(op) { encolar(op); await enviarCola(); }

  // ───────────────────────────── carga de datos
  async function cargarAcceso() {
    const r = await sb.rpc('plantas_acceso');
    if (r.error) {
      if (esRed(r.error)) return leer('tecsul_plantas_acceso', []);
      throw r.error;
    }
    guardar('tecsul_plantas_acceso', r.data || []);
    try { localStorage.setItem('tecsul_plantas', (r.data || []).length ? '1' : ''); } catch (e) {}
    return r.data || [];
  }
  async function cargarCfg(p, forzar) {
    if (S.cfg[p] && !forzar) return S.cfg[p];
    const clave = 'pl_cfg_' + p;
    try {
      const [pl, tq, fo, pe] = await Promise.all([
        sb.from('plantas').select('*').eq('id', p).maybeSingle(),
        sb.from('planta_tanques').select('*').eq('planta_id', p).order('orden').order('id'),
        sb.from('planta_formulas').select('*').eq('planta_id', p).order('nombre'),
        sb.from('planta_personal').select('*').eq('planta_id', p),
      ]);
      for (const r of [pl, tq, fo, pe]) if (r.error) throw r.error;
      S.cfg[p] = { planta: pl.data || { id: p }, tanques: tq.data || [], formulas: fo.data || [], personal: pe.data || [] };
      guardar(clave, S.cfg[p]);
    } catch (e) {
      if (!esRed(e)) throw e;
      S.cfg[p] = leer(clave, { planta: { id: p }, tanques: [], formulas: [], personal: [] });
    }
    return S.cfg[p];
  }
  async function cargarObras() {
    try {
      const r = await sb.from('obras').select('clave,codigo,nombre,activa').eq('activa', true).order('nombre');
      if (r.error) throw r.error;
      S.obras = r.data || []; guardar('pl_obras', S.obras);
    } catch (e) { S.obras = leer('pl_obras', []); }
  }
  // Jornada actual (la abierta más reciente, o la última de hoy) con sus lecturas, paradas y recargas
  async function cargarDia(p, forzar) {
    const clave = 'pl_dia_' + p;
    let d;
    try {
      const desde = new Date(Date.now() - 3 * 86400000);
      const js = await sb.from('planta_jornadas').select('*').eq('planta_id', p).gte('fecha', isoLocal(desde)).order('fecha', { ascending: false }).order('turno', { ascending: false }).limit(10);
      if (js.error) throw js.error;
      const jornadas = js.data || [];
      const j = jornadas.find(x => x.estado === 'abierta') || jornadas.find(x => x.fecha === hoyISO()) || null;
      let lecturas = [], paradas = [], recargas = [], pesadas = [], controles = [];
      const desdeRec = new Date(Date.now() - 4 * 86400000).toISOString();
      const rr = await sb.from('planta_recargas').select('*').eq('planta_id', p).gte('fecha_hora', desdeRec).order('fecha_hora');
      if (rr.error) throw rr.error;
      recargas = rr.data || [];
      const pp = await sb.from('planta_pesadas').select('*').eq('planta_id', p).gte('fecha', isoLocal(desde)).order('hora');
      if (pp.error && !/planta_pesadas|relation|does not exist/i.test(errMsg(pp.error))) throw pp.error;
      pesadas = pp.error ? [] : (pp.data || []);
      const cc = await sb.from('planta_lecturas').select('*').eq('planta_id', p).is('jornada_id', null).gte('hora', desdeRec).order('hora');
      if (cc.error) throw cc.error;
      controles = cc.data || [];
      if (j) {
        const [l, pa] = await Promise.all([
          sb.from('planta_lecturas').select('*').eq('jornada_id', j.id).order('hora'),
          sb.from('planta_paradas').select('*').eq('jornada_id', j.id).order('desde'),
        ]);
        if (l.error) throw l.error; if (pa.error) throw pa.error;
        lecturas = l.data || []; paradas = pa.data || [];
      }
      d = { jornada: j, jornadas, lecturas, paradas, recargas, pesadas, controles, en: Date.now() };
      guardar(clave, d);
    } catch (e) {
      if (!esRed(e)) throw e;
      d = leer(clave, { jornada: null, jornadas: [], lecturas: [], paradas: [], recargas: [], pesadas: [] });
      d.sinSenal = true;
    }
    // lo pendiente del teléfono
    const jPend = conPendientes('planta_jornadas', d.jornada ? [d.jornada] : [], f => f.planta_id === p);
    const abierta = jPend.find(x => x.estado === 'abierta') || jPend[0] || null;
    d.jornada = abierta && (!d.jornada || abierta.id === d.jornada.id || d.jornada.estado !== 'abierta') ? abierta : d.jornada;
    if (d.jornada) {
      const jid = d.jornada.id;
      d.lecturas = conPendientes('planta_lecturas', d.lecturas.filter(x => x.jornada_id === jid), f => f.jornada_id === jid).sort((a, b) => a.hora.localeCompare(b.hora));
      d.paradas = conPendientes('planta_paradas', d.paradas.filter(x => x.jornada_id === jid), f => f.jornada_id === jid).sort((a, b) => a.desde.localeCompare(b.desde));
    }
    d.recargas = conPendientes('planta_recargas', d.recargas, f => f.planta_id === p).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
    d.pesadas = conPendientes('planta_pesadas', d.pesadas || [], f => f.planta_id === p).sort((a, b) => a.hora.localeCompare(b.hora));
    d.controles = conPendientes('planta_lecturas', d.controles || [], f => f.planta_id === p && !f.jornada_id).filter(x => !x.jornada_id).sort((a, b) => a.hora.localeCompare(b.hora));
    S.dia[p] = d;
    return d;
  }
  async function cargarNombres(ids) {
    const faltan = ids.filter(id => id && !(id in S.nombres));
    if (!faltan.length || !navigator.onLine) return;
    try {
      const r = await sb.from('perfiles').select('id,nombre').in('id', faltan);
      (r.data || []).forEach(x => { S.nombres[x.id] = x.nombre; });
      faltan.forEach(id => { if (!(id in S.nombres)) S.nombres[id] = ''; });
    } catch (e) { /* nada */ }
  }

  // ───────────────────────────── cálculos
  function recargaLitros(rec) {
    const t = cfg().tanques.find(x => x.id === rec.tanque_id) || (S.cfg[rec.planta_id] || { tanques: [] }).tanques.find(x => x.id === rec.tanque_id);
    if (!t) return Number(rec.cantidad) || 0;
    return rec.unidad === 't' ? Number(rec.cantidad) / (num(t.densidad) || 1) * 1000 : Number(rec.cantidad);
  }
  const litrosLect = (l, t) => { const v = (l.valores || {})[String(t.id)]; return v && !vacio(v.l) ? Number(v.l) : null; };
  // Tickets de báscula de la jornada (los cargados sin jornada cuentan por fecha)
  function pesadasDe(d, j) {
    j = j || d.jornada;
    if (!j) return [];
    return (d.pesadas || []).filter(p => p.jornada_id === j.id || (!p.jornada_id && p.fecha === j.fecha));
  }
  const sumaNeto = (ps) => ps.reduce((s, p) => s + (Number(p.neto_t) || 0), 0);
  function formulaDe(j) { return j ? cfg().formulas.find(f => f.id === j.formula_id) || null : null; }
  // Tramos entre lecturas consecutivas
  function tramos(d) {
    const ls = (d.lecturas || []).slice().sort((a, b) => a.hora.localeCompare(b.hora));
    const f = formulaDe(d.jornada);
    const tol = num(f && f.tol_cap) ?? Number(conf('tol_cap', 0.2));
    const ltMax = Number(conf('lt_max', 7));
    const out = [];
    for (let i = 1; i < ls.length; i++) {
      const a = ls[i - 1], b = ls[i];
      const horas = (new Date(b.hora) - new Date(a.hora)) / 3600000;
      const prod = !vacio(b.contador_t) && !vacio(a.contador_t) ? Number(b.contador_t) - Number(a.contador_t) : null;
      const tr = { desde: a.hora, hasta: b.hora, horas, prod, lectura: b, porTanque: {}, avisos: [] };
      const psT = pesadasDe(d).filter(p => p.hora > a.hora && p.hora <= b.hora);
      tr.basT = psT.length ? sumaNeto(psT) : null; tr.basN = psT.length;
      for (const t of cfg().tanques.filter(x => x.activo !== false)) {
        const la = litrosLect(a, t), lb = litrosLect(b, t);
        if (la === null || lb === null) continue;
        const rec = (d.recargas || []).filter(r => r.tanque_id === t.id && r.fecha_hora > a.hora && r.fecha_hora <= b.hora).reduce((s, r) => s + recargaLitros(r), 0);
        const cons = la + rec - lb;
        tr.porTanque[t.id] = { litros: cons, rec };
        if (cons < -50) tr.avisos.push(`${t.nombre}: subió ${fN(-cons)} L sin recarga cargada`);
        if (t.insumo === 'cap') { tr.capL = (tr.capL || 0) + cons; tr.capT = (tr.capT || 0) + aTon(t, cons); if (!num(t.densidad)) tr.sinDens = true; }
        if (t.insumo === 'fuel') tr.fuelL = (tr.fuelL || 0) + cons;
        if (t.insumo === 'gasoil') tr.gasoilL = (tr.gasoilL || 0) + cons;
      }
      if (prod > 0) {
        tr.th = horas > 0 ? prod / horas : null;
        if (tr.capT !== undefined) tr.pctCap = tr.capT / prod * 100;
        if (tr.fuelL !== undefined) tr.lt = tr.fuelL / prod;
      }
      if (!vacio(b.scada_cap_t) && !vacio(a.scada_cap_t) && prod > 0) tr.pctCapScada = (Number(b.scada_cap_t) - Number(a.scada_cap_t)) / prod * 100;
      tr.estado = 'na';
      if (tr.pctCap !== undefined && f && !vacio(f.pct_cap)) tr.estadoCap = Math.abs(tr.pctCap - Number(f.pct_cap)) <= tol ? 'ok' : 'mal';
      if (tr.lt !== undefined) tr.estadoLt = tr.lt <= ltMax ? 'ok' : 'ojo';
      tr.estado = tr.estadoCap === 'mal' ? 'mal' : (tr.estadoLt === 'ojo' || tr.avisos.length) ? 'ojo' : (tr.estadoCap === 'ok' || tr.estadoLt === 'ok') ? 'ok' : 'na';
      out.push(tr);
    }
    return out;
  }
  function resumen(d) {
    const trs = tramos(d);
    const ls = (d.lecturas || []);
    const j = d.jornada;
    const suma = (k) => trs.reduce((s, t) => s + (t[k] || 0), 0);
    const prodCont = ls.length >= 2 ? Number(ls[ls.length - 1].contador_t || 0) - Number(ls[0].contador_t || 0) : 0;
    const prodPos = trs.filter(t => t.prod > 0);
    const capT = prodPos.reduce((s, t) => s + (t.capT || 0), 0), prodCap = prodPos.filter(t => t.capT !== undefined).reduce((s, t) => s + t.prod, 0);
    const fuelL = prodPos.reduce((s, t) => s + (t.fuelL || 0), 0), prodFuel = prodPos.filter(t => t.fuelL !== undefined).reduce((s, t) => s + t.prod, 0);
    const ahora = j && j.estado === 'cerrada' && j.fin ? new Date(j.fin) : new Date();
    const inicio = j && j.inicio ? new Date(j.inicio) : (ls[0] ? new Date(ls[0].hora) : null);
    const minJornada = inicio ? (ahora - inicio) / 60000 : 0;
    const minParada = (d.paradas || []).reduce((s, p) => s + ((p.hasta ? new Date(p.hasta) : ahora) - new Date(p.desde)) / 60000, 0);
    const horasProd = Math.max(0, (minJornada - minParada) / 60);
    const ultima = ls.length ? ls[ls.length - 1] : null;
    const ps = pesadasDe(d);
    const ultPes = ps.length ? ps[ps.length - 1] : null;
    return {
      basT: sumaNeto(ps), basN: ps.length, ultPes, minDesdeCamion: ultPes ? (Date.now() - new Date(ultPes.hora)) / 60000 : null,
      trs, prodCont, capT, pctCap: prodCap > 0 ? capT / prodCap * 100 : null, fuelL, lt: prodFuel > 0 ? fuelL / prodFuel : null,
      gasoilL: suma('gasoilL'), minJornada, minParada, horasProd, th: horasProd > 0.05 ? prodCont / horasProd : null,
      ultima, minDesdeUltima: ultima ? (Date.now() - new Date(ultima.hora)) / 60000 : null,
      paradaAbierta: (d.paradas || []).find(p => !p.hasta) || null,
    };
  }
  // Stock actual por tanque = última lectura + recargas posteriores
  // consumo entre lecturas consecutivas de un tanque (cualquier lectura, con o sin jornada)
  function consumoEntre(ls, t, recargas) {
    const con = ls.filter(l => litrosLect(l, t) !== null).sort((a, b) => a.hora.localeCompare(b.hora));
    const out = [];
    for (let i = 1; i < con.length; i++) {
      const a = con[i - 1], b = con[i];
      const rec = (recargas || []).filter(r => r.tanque_id === t.id && r.fecha_hora > a.hora && r.fecha_hora <= b.hora).reduce((s, r) => s + recargaLitros(r), 0);
      out.push({ desde: a.hora, hasta: b.hora, horas: (new Date(b.hora) - new Date(a.hora)) / 3600000, litros: litrosLect(a, t) + rec - litrosLect(b, t), rec });
    }
    return out;
  }
  function stockTanques(d) {
    const ls = (d.lecturas || []).concat(d.controles || []).sort((a, b) => a.hora.localeCompare(b.hora));
    return cfg().tanques.filter(t => t.activo !== false).map(t => {
      let base = null, hora = null;
      for (let i = ls.length - 1; i >= 0; i--) { const v = litrosLect(ls[i], t); if (v !== null) { base = v; hora = ls[i].hora; break; } }
      const rec = (d.recargas || []).filter(r => r.tanque_id === t.id && (!hora || r.fecha_hora > hora)).reduce((s, r) => s + recargaLitros(r), 0);
      const litros = base === null ? null : base + rec;
      // consumo por hora del día (tramos con producción)
      const trs = tramos(d).filter(x => x.porTanque[t.id] && x.horas > 0);
      let lh = trs.length ? trs.reduce((s, x) => s + x.porTanque[t.id].litros, 0) / trs.reduce((s, x) => s + x.horas, 0) : null;
      if (lh === null) { const ce = consumoEntre(ls, t, d.recargas).slice(-6).filter(x => x.horas > 0); if (ce.length) lh = ce.reduce((s, x) => s + x.litros, 0) / ce.reduce((s, x) => s + x.horas, 0); }
      return { t, litros, cap: capacidad(t), lh, autonomiaH: litros !== null && lh > 0 ? litros / lh : null };
    });
  }

  // ───────────────────────────── arranque
  async function iniciar() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    window.addEventListener('online', () => { $('#offline-banner').classList.remove('show'); enviarCola(); });
    window.addEventListener('offline', () => $('#offline-banner').classList.add('show'));
    if (!navigator.onLine) $('#offline-banner').classList.add('show');
    if (!sb) { carga(false); $('main').innerHTML = '<div class="vacio">No se pudo iniciar la conexión.</div>'; return; }
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { location.href = APP_PARTES; return; }
    try {
      const r = await sb.from('perfiles').select('*').eq('id', data.session.user.id).maybeSingle();
      S.perfil = r.data || null;
      if (S.perfil) guardar('perfil', S.perfil);
    } catch (e) { const g = leer('perfil', null); S.perfil = g && g.id === data.session.user.id ? g : null; }
    try { S.acceso = await cargarAcceso(); }
    catch (e) {
      carga(false);
      $('main').innerHTML = `<div class="card vacio"><b>No se pudo abrir Plantas.</b><br>${/plantas_acceso|function/i.test(errMsg(e)) ? 'Falta correr en Supabase el SQL <b>92_plantas.sql</b>.' : esc(errMsg(e))}</div>`;
      return;
    }
    if (window.Menu) { Menu.pintar('plantas', S.perfil ? S.perfil.rol : null); Menu.activar('plantas'); }
    $('#hdr-usuario').textContent = (S.perfil ? S.perfil.nombre : (data.session.user.email || '')) + (S.acceso.length ? ' · ' + (ROLES[S.acceso[0].rol] || '') : '');
    if (!S.acceso.length) {
      carga(false);
      $('main').innerHTML = '<div class="card vacio">No tenés ninguna planta asignada. Pedile al administrador que te agregue en Plantas › Configuración › Personal.</div>';
      return;
    }
    const sel = leer('pl_sel', null);
    S.planta = (sel && acc(sel)) ? sel : S.acceso[0].planta;
    await cargarObras();
    await elegirPlanta(S.planta, leer('pl_vista', null));
    carga(false);
    pintarPendientes();
    enviarCola();
    setInterval(enviarCola, 30000);
    setInterval(() => { if (['vivo', 'parte', 'bascula'].includes(S.vista)) pintarRelojes(); }, 30000);
  }

  function vistasDe(p) {
    const v = [];
    if (cargaParte(p)) v.push(['parte', 'Parte de planta']);
    if (puedePesar(p)) v.push(['bascula', 'Báscula']);
    v.push(['vivo', 'En vivo'], ['tablero', 'Tablero'], ['recargas', 'Recargas']);
    if ((acc(p) || {}).costos) v.push(['costos', 'Costos']);
    if (configura(p)) v.push(['config', 'Configuración']);
    return v;
  }
  async function elegirPlanta(p, vista) {
    S.planta = p; guardar('pl_sel', p);
    carga(true, 'Cargando ' + p + '…');
    try { await cargarCfg(p); await cargarDia(p); }
    catch (e) { toast('No se pudo cargar: ' + errMsg(e), 'error'); }
    finally { carga(false); }
    const vs = vistasDe(p).map(x => x[0]);
    S.vista = vs.includes(vista) ? vista : (vs.includes(S.vista) ? S.vista : vs[0]);
    pintarBarra();
    await irA(S.vista);
  }
  function pintarBarra() {
    $('#sel-planta').innerHTML = S.acceso.map(a => `<button type="button" data-p="${esc(a.planta)}" class="${a.planta === S.planta ? 'on' : ''}" title="${esc(a.nombre || '')}">${esc(a.planta)}</button>`).join('');
    $$('#sel-planta button').forEach(b => b.onclick = () => elegirPlanta(b.dataset.p, S.vista));
    $('#sel-vista').innerHTML = vistasDe(S.planta).map(([k, t]) => `<button type="button" data-v="${k}" class="${k === S.vista ? 'on' : ''}">${t}</button>`).join('');
    $$('#sel-vista button').forEach(b => b.onclick = () => irA(b.dataset.v));
  }
  async function irA(v) {
    S.vista = v; guardar('pl_vista', v);
    $$('#sel-vista button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    ['parte', 'bascula', 'vivo', 'tablero', 'recargas', 'costos', 'config'].forEach(k => { $('#v-' + k).hidden = k !== v; });
    if (v === 'vivo' || v === 'bascula') suscribirVivo(); else desuscribirVivo();
    await pintar();
  }
  async function pintar() {
    const v = S.vista;
    if (v === 'parte') pintarParte();
    else if (v === 'bascula') pintarBascula();
    else if (v === 'vivo') pintarVivo();
    else if (v === 'tablero') await pintarTablero();
    else if (v === 'recargas') await pintarRecargas();
    else if (v === 'costos') await pintarCostos();
    else if (v === 'config') await pintarConfig();
  }
  function pintarRelojes() { if (S.vista === 'vivo') pintarVivo(); else if (S.vista === 'parte') pintarParte(); else if (S.vista === 'bascula') pintarKpisBascula(); }

  // ═════════════════════════════ PARTE DE PLANTA
  function pintarParte() {
    const el = $('#v-parte');
    const d = S.dia[S.planta] || {};
    const j = d.jornada;
    const c = cfg();
    if (!c.tanques.length && esAsfalto()) {
      el.innerHTML = `<div class="card nota">Esta planta todavía no tiene tanques configurados. ${configura() ? 'Cargalos en Configuración.' : 'Avisale al encargado de la planta.'}</div>`;
    } else el.innerHTML = '';
    if (!j || j.estado === 'cerrada') {
      el.innerHTML += cardControles(d, true) + formArranque(d); bindArranque(); bindControles();
      if (j) el.insertAdjacentHTML('beforeend', resumenCerrada(d));
      return;
    }
    const r = resumen(d);
    const f = formulaDe(j);
    const obra = S.obras.find(o => o.clave === j.obra_clave);
    const parada = r.paradaAbierta;
    const cada = Number(conf('lectura_min', 60));
    const toca = r.minDesdeUltima !== null && r.minDesdeUltima >= cada - 5;
    el.innerHTML += `
      <div class="card">
        <div class="estado-planta">
          <span class="grande"><span class="punto ${parada ? 'parada' : 'vivo'}"></span>${parada ? 'Parada · ' + esc(parada.causa) : 'Produciendo'}</span>
          <span class="chip gris">${esc(obra ? obra.nombre : (j.obra_clave || 'sin obra'))}</span>
          ${f ? `<span class="chip">${esc(f.nombre)}${!vacio(f.pct_cap) ? ' · CAP ' + fN(f.pct_cap, 2) + ' %' : ''}</span>` : ''}
          <span class="nota">Arrancó ${fHora(j.inicio)} · ${fDur(r.minJornada)}${parada ? ' · parada hace ' + fDur((Date.now() - new Date(parada.desde)) / 60000) : ''}</span>
        </div>
        <div class="kpis" style="margin:12px 0 0">
          <div class="kpi"><span class="k">Producción (contador)</span><span class="v">${fN(r.prodCont, 1)}<small>${unidad()}</small></span><span class="s">${fN(r.horasProd, 1)} h produciendo</span></div>
          ${esAsfalto() ? `<div class="kpi ${r.pctCap !== null && f && !vacio(f.pct_cap) && Math.abs(r.pctCap - f.pct_cap) > (num(f.tol_cap) ?? conf('tol_cap', 0.2)) ? 'alerta' : ''}"><span class="k">CAP del día</span><span class="v">${fN(r.pctCap, 2)}<small>%</small></span><span class="s">${fN(r.capT, 2)} t de CAP</span></div>
          <div class="kpi"><span class="k">Fuel secadero</span><span class="v">${fN(r.lt, 1)}<small>L/${unidad()}</small></span><span class="s">${fN(r.fuelL)} L</span></div>` : ''}
          <div class="kpi ${toca ? 'ojo' : ''}"><span class="k">Última lectura</span><span class="v">${r.ultima ? fHora(r.ultima.hora) : '—'}</span><span class="s">${r.ultima ? 'hace ' + fDur(r.minDesdeUltima) : ''}${toca ? ' · toca leer' : ''}</span></div>
        </div>
      </div>
      <div class="botones col" style="margin-bottom:12px">
        <button class="btn pri ancho" type="button" id="b-lectura">+ Lectura de la hora</button>
        <div class="botones">
          ${parada ? `<button class="btn verde" type="button" id="b-reanudar" style="flex:1">▶ Reanudé la planta</button>` : `<button class="btn rojo" type="button" id="b-parar" style="flex:1">■ Paré la planta</button>`}
          <button class="btn" type="button" id="b-recarga" style="flex:1">+ Recarga</button>
          <button class="btn azul" type="button" id="b-cerrar" style="flex:1">Cerrar jornada</button>
        </div>
        ${corrige() ? `<button class="btn chico" type="button" data-borjor="${j.id}" style="color:var(--rojo);align-self:flex-start">Eliminar jornada (si fue de prueba o se cargó por error)</button>` : ''}
      </div>
      ${tablaTramos(d, true)}
      ${tablaParadas(d)}
      ${tablaRecargasDia(d)}
      ${cardControles(d, false)}`;
    $('#b-lectura').onclick = () => abrirLectura('hora');
    bindControles();
    $('#b-cerrar').onclick = () => abrirCierre();
    $('#b-recarga').onclick = () => abrirRecarga();
    if (parada) $('#b-reanudar').onclick = () => reanudar(parada); else $('#b-parar').onclick = () => abrirParada();
    bindTablas();
  }

  // ── Mediciones de tanques sin producción (la caldera calienta también los días sin planta)
  function cardControles(d, conBoton) {
    const cs = (d.controles || []).filter(c => new Date(c.hora) > Date.now() - 3 * 86400000);
    const ts = cfg().tanques.filter(t => t.activo !== false);
    if (!ts.length) return '';
    const todas = (d.lecturas || []).concat(cs).sort((a, b) => a.hora.localeCompare(b.hora));
    const filas = cs.slice().reverse().map(c => {
      return `<tr class="${c._pend ? 'pend' : ''}"><td class="l">${fFechaHora(c.hora)}${c._pend ? ' ⏳' : ''}</td>
        ${ts.map(t => { const v = (c.valores || {})[String(t.id)]; if (!v) return '<td>—</td>';
          const ce = consumoEntre(todas, t, d.recargas).find(x => x.hasta === c.hora);
          return `<td>${fN(v.r, 2)} · ${fN(v.l)} L${ce ? `<br><span class="nota">${ce.litros >= 0 ? '−' : '+'}${fN(Math.abs(ce.litros))} L en ${fDur(ce.horas * 60)}</span>` : ''}</td>`; }).join('')}
        <td class="l">${esc(c.observaciones || '')}</td>
        <td>${c.creado_por === (S.perfil || {}).id || corrige() || c._pend ? `<button class="x" data-borctl="${c.id}" title="Eliminar" aria-label="Eliminar medición">✕</button>` : ''}</td></tr>`;
    }).join('');
    return `<div class="card"><h3>Medición de tanques sin producción <small>días sin planta: caldera, CAP, fuel</small></h3>
      ${conBoton && cargaParte() ? '<div class="botones" style="margin-bottom:10px"><button class="btn azul ancho" type="button" id="b-control">Medir tanques sin arrancar la planta</button></div>' : ''}
      ${filas ? `<div class="tw"><table class="t"><tr><th class="l">Cuándo</th>${ts.map(t => `<th>${esc(t.nombre)}</th>`).join('')}<th class="l">Obs.</th><th></th></tr>${filas}</table></div>` : '<p class="nota">Sin mediciones en los últimos 3 días. Con la planta parada, medí al menos la caldera al empezar y al terminar el día.</p>'}</div>`;
  }
  function bindControles() {
    const b = $('#b-control'); if (b) b.onclick = abrirControl;
    $$('[data-borctl]').forEach(x => x.onclick = async () => {
      if (!x.dataset.conf) { x.dataset.conf = '1'; x.textContent = '¿Eliminar?'; return; }
      await grabar({ op: 'delete', t: 'planta_lecturas', id: x.dataset.borctl }); await cargarDia(S.planta, true); pintar();
    });
  }
  function abrirControl() {
    modal('Medir tanques sin producción', `<p class="nota">Para los días que no arranca la planta (la caldera igual calienta el CAP). Cargá los tanques que midas; los demás pueden quedar vacíos.</p>
      <div class="campos"><label>Hora<input type="datetime-local" id="m-hora" value="${aLocalInput()}"></label></div>
      ${camposReglas('m', null)}
      <label class="campo">Observación<input type="text" id="m-obs" placeholder="Ej.: caldera prendida de 6 a 18 h" style="border:1px solid #c9d1dc;border-radius:8px;padding:9px"></label>`,
      `<button class="btn pri" type="button" id="m-ok">Guardar medición</button>`);
    bindReglas('m');
    $('#m-ok').onclick = async () => {
      const { valores, error } = leerReglas('m');
      if (error) return toast(error, 'error');
      if (!Object.keys(valores).length) return toast('Cargá al menos un tanque', 'error');
      const fila = { id: uuid(), jornada_id: null, planta_id: S.planta, hora: deLocalInput($('#m-hora').value) || new Date().toISOString(), tipo: 'control', contador_t: null, valores, observaciones: $('#m-obs').value.trim() || null };
      cerrarModal();
      await grabar({ op: 'upsert', t: 'planta_lecturas', fila });
      await cargarDia(S.planta, true); pintar();
      toast(navigator.onLine ? 'Medición guardada' : 'Medición guardada en el teléfono', 'ok');
    };
  }

  function selObras(sel) {
    return `<option value="">— elegir —</option>` + S.obras.map(o => `<option value="${esc(o.clave)}" ${o.clave === sel ? 'selected' : ''}>${esc(o.nombre)}${o.codigo ? ' · ' + esc(o.codigo) : ''}</option>`).join('');
  }
  function selFormulas(sel) {
    return `<option value="">— sin fórmula —</option>` + cfg().formulas.filter(f => f.activo !== false || f.id === sel).map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.nombre)}${!vacio(f.pct_cap) ? ' · CAP ' + fN(f.pct_cap, 2) + ' %' : ''}</option>`).join('');
  }
  function camposReglas(prefijo, valores) {
    const ts = cfg().tanques.filter(t => t.activo !== false);
    if (!ts.length) return '';
    return `<div class="reglas">${ts.map(t => {
      const v = valores && valores[String(t.id)] ? valores[String(t.id)].r : '';
      return `<div class="regla"><div><div class="n">${esc(t.nombre)}</div><div class="h">Regla ${t.modo_lectura === 'libre' ? '<b>libre</b> (vacío desde arriba)' : '<b>stock</b> (altura de líquido)'} · en metros</div></div>
        <input type="text" inputmode="decimal" id="${prefijo}-t${t.id}" data-tq="${t.id}" value="${vacio(v) ? '' : String(v).replace('.', ',')}" placeholder="0,00" aria-label="Regla ${esc(t.nombre)} en metros">
        <div class="conv" id="${prefijo}-c${t.id}"></div></div>`;
    }).join('')}</div>`;
  }
  function bindReglas(prefijo, alCambiar) {
    $$(`[id^="${prefijo}-t"][data-tq]`).forEach(inp => {
      const t = cfg().tanques.find(x => String(x.id) === inp.dataset.tq);
      const upd = () => {
        const r = convertirRegla(t, inp.value), out = $(`#${prefijo}-c${t.id}`);
        if (r.litros !== null && r.litros !== undefined) {
          out.className = 'conv';
          out.textContent = `${fN(r.litros)} L${t.insumo === 'cap' ? ' ≈ ' + fN(aTon(t, r.litros), 2) + ' t' + (num(t.densidad) ? '' : ' (sin densidad)') : ''}${r.aviso ? ' · ' + r.aviso : ''}`;
        } else { out.className = 'conv' + (r.aviso ? ' mal' : ''); out.textContent = r.aviso || ''; }
        if (alCambiar) alCambiar();
      };
      inp.addEventListener('input', upd); upd();
    });
  }
  function leerReglas(prefijo) {
    const valores = {}; let error = null;
    $$(`[id^="${prefijo}-t"][data-tq]`).forEach(inp => {
      const t = cfg().tanques.find(x => String(x.id) === inp.dataset.tq);
      const r = convertirRegla(t, inp.value);
      if (inp.value.trim() && r.m === null) error = `Regla de ${t.nombre}: número no válido`;
      if (r.m !== null) valores[String(t.id)] = { r: Math.round(r.m * 1000) / 1000, l: r.litros === null ? null : Math.round(r.litros * 10) / 10 };
    });
    return { valores, error };
  }

  function formArranque(d) {
    const ult = (d.jornadas || [])[0];
    return `<div class="card"><h3>Arrancar la jornada <small>${esc(S.planta)} · ${fFecha(hoyISO())}</small></h3>
      <div class="campos">
        <label>Fecha<input type="date" id="a-fecha" value="${hoyISO()}"></label>
        <label>Turno<select id="a-turno"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        <label class="ancho">Obra destino<select id="a-obra">${selObras(ult ? ult.obra_clave : '')}</select></label>
        ${cfg().formulas.length ? `<label class="ancho">Fórmula cargada en el SCADA<select id="a-formula">${selFormulas(ult ? ult.formula_id : null)}</select></label>` : ''}
        <label>Hora de arranque<input type="datetime-local" id="a-hora" value="${aLocalInput()}"></label>
        <label>Contador SCADA (${unidad()})<input type="text" inputmode="decimal" id="a-cont" value="0" aria-describedby="a-cont-h"><span class="nota" id="a-cont-h">«Producción planta» al arrancar (0 si hiciste RESET)</span></label>
      </div>
      <h3 style="margin-top:14px">Lectura inicial de los tanques</h3>
      ${camposReglas('a', null) || '<p class="nota">Sin tanques configurados.</p>'}
      <div style="margin-top:12px"><button class="btn pri ancho" type="button" id="a-ok">Arrancar planta</button></div></div>`;
  }
  function bindArranque() {
    if (!$('#a-ok')) return;
    bindReglas('a');
    $('#a-ok').onclick = async () => {
      const obra = $('#a-obra').value;
      if (!obra) return toast('Elegí la obra destino', 'error');
      const hora = deLocalInput($('#a-hora').value) || new Date().toISOString();
      const cont = pNum($('#a-cont').value);
      if (cont === null || isNaN(cont)) return toast('Cargá el contador del SCADA', 'error');
      const { valores, error } = leerReglas('a');
      if (error) return toast(error, 'error');
      const fecha = $('#a-fecha').value || hoyISO(), turno = Number($('#a-turno').value || 1);
      const ya = (S.dia[S.planta].jornadas || []).find(x => x.fecha === fecha && x.turno === turno);
      if (ya) return toast(`Ya hay una jornada ${fFecha(fecha)} turno ${turno}. Elegí otro turno.`, 'error');
      const jid = uuid();
      const fila = { id: jid, planta_id: S.planta, fecha, turno, obra_clave: obra, formula_id: $('#a-formula') && $('#a-formula').value ? Number($('#a-formula').value) : null, estado: 'abierta', inicio: hora };
      encolar({ op: 'upsert', t: 'planta_jornadas', fila });
      encolar({ op: 'upsert', t: 'planta_lecturas', fila: { id: uuid(), jornada_id: jid, planta_id: S.planta, hora, tipo: 'inicio', contador_t: cont, valores } });
      S.dia[S.planta].jornada = Object.assign({ _pend: true }, fila);
      await enviarCola();
      await cargarDia(S.planta, true);
      toast('Planta arrancada', 'ok');
      pintar();
    };
  }
  function resumenCerrada(d) {
    const j = d.jornada, r = resumen(d);
    return `<div class="card"><h3>Última jornada · ${fFecha(j.fecha)} turno ${j.turno} <small>cerrada ${fHora(j.fin)}</small></h3>
      <div class="kpis"><div class="kpi"><span class="k">Báscula</span><span class="v">${fN(j.bascula_t, 1)}<small>${unidad()}</small></span><span class="s">${fN(j.bascula_viajes)} viajes</span></div>
      <div class="kpi"><span class="k">Contador SCADA</span><span class="v">${fN(r.prodCont, 1)}<small>${unidad()}</small></span></div>
      ${esAsfalto() ? `<div class="kpi"><span class="k">CAP</span><span class="v">${fN(r.pctCap, 2)}<small>%</small></span></div><div class="kpi"><span class="k">Fuel</span><span class="v">${fN(r.lt, 1)}<small>L/${unidad()}</small></span></div>` : ''}</div>
      ${corrige() ? `<div class="botones"><button class="btn chico" type="button" id="b-reabrir">Reabrir para corregir</button><button class="btn chico" type="button" data-borjor="${j.id}" style="color:var(--rojo)">Eliminar jornada</button></div>` : ''}</div>${tablaTramos(d, true)}${tablaParadas(d)}`;
  }

  function abrirLectura(tipo, editar) {
    const d = S.dia[S.planta], j = d.jornada;
    const prev = editar || null;
    const f = modal(prev ? 'Corregir lectura' : (tipo === 'cierre' ? 'Lectura de cierre' : 'Lectura de la hora'), `
      <div class="campos">
        <label>Hora<input type="datetime-local" id="l-hora" value="${aLocalInput(prev ? prev.hora : null)}"></label>
        <label>Contador SCADA (${unidad()})<input type="text" inputmode="decimal" id="l-cont" value="${prev && !vacio(prev.contador_t) ? String(prev.contador_t).replace('.', ',') : ''}" placeholder="Producción planta"></label>
        ${esAsfalto() ? `<label>CAP del SCADA (t, opcional)<input type="text" inputmode="decimal" id="l-scap" value="${prev && !vacio(prev.scada_cap_t) ? String(prev.scada_cap_t).replace('.', ',') : ''}"></label>` : ''}
      </div>
      ${camposReglas('l', prev ? prev.valores : null)}
      <div id="l-tramo"></div>
      <label class="campo">Observación<input type="text" id="l-obs" value="${esc(prev ? prev.observaciones || '' : '')}" style="border:1px solid #c9d1dc;border-radius:8px;padding:9px"></label>`,
      `<button class="btn pri" type="button" id="l-ok">${prev ? 'Guardar' : 'Enviar lectura'}</button>`);
    const vista = () => {
      const tmp = armarLectura(prev ? prev.id : '_tmp', tipo);
      if (!tmp) { $('#l-tramo').innerHTML = ''; return; }
      const otras = d.lecturas.filter(x => x.id !== tmp.id).concat([tmp]).sort((a, b) => a.hora.localeCompare(b.hora));
      const tr = tramos(Object.assign({}, d, { lecturas: otras })).find(x => x.lectura.id === tmp.id);
      $('#l-tramo').innerHTML = tr ? cajaTramo(tr) : '<p class="nota">Es la primera lectura de la jornada.</p>';
    };
    bindReglas('l', vista);
    ['#l-hora', '#l-cont', '#l-scap'].forEach(s => { const x = $(s); if (x) x.addEventListener('input', vista); });
    vista();
    $('#l-ok').onclick = async () => {
      const fila = armarLectura(prev ? prev.id : uuid(), prev ? prev.tipo : tipo);
      if (!fila) return;
      if (vacio(fila.contador_t)) return toast('Cargá el contador del SCADA', 'error');
      const anterior = d.lecturas.filter(x => x.id !== fila.id && x.hora < fila.hora).pop();
      if (anterior && !vacio(anterior.contador_t) && Number(fila.contador_t) < Number(anterior.contador_t)) {
        if (!$('#l-ok').dataset.conf) { $('#l-ok').dataset.conf = '1'; $('#l-ok').textContent = 'El contador bajó (¿RESET?) · Enviar igual'; return; }
      }
      if (prev) fila.editado_en = new Date().toISOString();
      cerrarModal();
      await grabar({ op: 'upsert', t: 'planta_lecturas', fila });
      await cargarDia(S.planta, true);
      pintar();
      const tr = tramos(S.dia[S.planta]).find(x => x.lectura.id === fila.id);
      if (tr && tr.estado === 'mal') toast(`Atención: CAP ${fN(tr.pctCap, 2)} % fuera de la fórmula`, 'error', 9000);
      else toast(navigator.onLine ? 'Lectura enviada' : 'Lectura guardada en el teléfono', 'ok');
    };
    function armarLectura(id, tp) {
      const hora = deLocalInput($('#l-hora').value);
      if (!hora) return null;
      const cont = pNum($('#l-cont').value), scap = $('#l-scap') ? pNum($('#l-scap').value) : null;
      if (isNaN(cont) || isNaN(scap)) return null;
      const { valores, error } = leerReglas('l');
      if (error) return null;
      return { id, jornada_id: j.id, planta_id: S.planta, hora, tipo: tp, contador_t: cont, scada_cap_t: scap, valores, observaciones: $('#l-obs') ? $('#l-obs').value.trim() || null : null };
    }
    return f;
  }
  function cajaTramo(tr) {
    const f = formulaDe(S.dia[S.planta].jornada);
    return `<div class="tramo ${tr.estado === 'na' ? '' : tr.estado}">
      <div><span>Tramo</span><b>${fHora(tr.desde)}–${fHora(tr.hasta)}</b></div>
      <div><span>Producción</span><b>${fN(tr.prod, 1)} ${unidad()}</b></div>
      <div><span>Rendimiento</span><b>${fN(tr.th, 0)} ${unidad()}/h</b></div>
      ${tr.pctCap !== undefined ? `<div><span>CAP medido${f && !vacio(f.pct_cap) ? ' (fórmula ' + fN(f.pct_cap, 2) + ')' : ''}</span><b>${fN(tr.pctCap, 2)} %</b></div>` : ''}
      ${tr.pctCapScada !== undefined ? `<div><span>CAP SCADA</span><b>${fN(tr.pctCapScada, 2)} %</b></div>` : ''}
      ${tr.lt !== undefined ? `<div><span>Fuel</span><b>${fN(tr.lt, 1)} L/${unidad()}</b></div>` : ''}
      ${tr.gasoilL !== undefined ? `<div><span>Gasoil caldera</span><b>${fN(tr.gasoilL)} L</b></div>` : ''}
      ${tr.avisos.length ? `<div style="grid-column:1/-1"><span>Revisar</span><b style="font-size:13px">${tr.avisos.map(esc).join(' · ')}</b></div>` : ''}
      ${tr.sinDens ? `<div style="grid-column:1/-1"><span>Ojo</span><b style="font-size:13px">El tanque de CAP no tiene densidad cargada: se usa 1,00</b></div>` : ''}
    </div>`;
  }
  function tablaTramos(d, conBotones) {
    const ls = d.lecturas || [];
    if (!ls.length) return '';
    const trs = tramos(d), porId = {}; trs.forEach(t => { porId[t.lectura.id] = t; });
    const f = formulaDe(d.jornada);
    const ts = cfg().tanques.filter(t => t.activo !== false);
    const puede = conBotones && d.jornada && (d.jornada.estado === 'abierta' || corrige());
    return `<div class="card"><h3>Lecturas <small>${ls.length} · semáforo contra ${f ? esc(f.nombre) + (!vacio(f.pct_cap) ? ' (' + fN(f.pct_cap, 2) + ' % ± ' + fN(num(f.tol_cap) ?? conf('tol_cap', 0.2), 1) + ')' : '') : 'la planta'}</small></h3>
      <div class="tw"><table class="t"><thead><tr><th class="l">Hora</th><th>Contador</th><th>${unidad()} tramo</th><th>Báscula ${unidad()}</th><th>${unidad()}/h</th>
      ${ts.map(t => `<th>${esc(t.nombre)}<br>regla · L</th>`).join('')}
      ${esAsfalto() ? '<th>%CAP</th><th>L/' + unidad() + '</th>' : ''}<th class="l">Revisar</th>${puede ? '<th></th>' : ''}</tr></thead><tbody>
      ${ls.slice().reverse().map(l => {
        const tr = porId[l.id];
        const cls = l._pend ? 'pend' : tr && tr.estado === 'mal' ? 'mal' : tr && tr.estado === 'ojo' ? 'ojo' : '';
        const capChip = tr && tr.pctCap !== undefined ? `<span class="chip ${tr.estadoCap || 'gris'}">${fN(tr.pctCap, 2)}</span>` : '';
        return `<tr class="${cls}"><td class="l">${fHora(l.hora)}${l.tipo !== 'hora' ? ' <span class="chip gris">' + l.tipo + '</span>' : ''}${l._pend ? ' ⏳' : ''}</td>
          <td>${fN(l.contador_t, 1)}</td><td>${tr ? fN(tr.prod, 1) : ''}</td><td>${tr && tr.basT !== null ? fN(tr.basT, 1) + ' <span class="nota">(' + tr.basN + ')</span>' : ''}</td><td>${tr ? fN(tr.th, 0) : ''}</td>
          ${ts.map(t => { const v = (l.valores || {})[String(t.id)]; return `<td>${v ? fN(v.r, 2) + ' · ' + fN(v.l) : '—'}</td>`; }).join('')}
          ${esAsfalto() ? `<td>${capChip}</td><td>${tr && tr.lt !== undefined ? `<span class="chip ${tr.estadoLt || 'gris'}">${fN(tr.lt, 1)}</span>` : ''}</td>` : ''}
          <td class="l" style="white-space:normal;min-width:140px">${tr ? tr.avisos.map(esc).join('<br>') : ''}${l.observaciones ? '<br><i>' + esc(l.observaciones) + '</i>' : ''}</td>
          ${puede ? `<td><button class="x" data-edlec="${l.id}" title="Corregir" aria-label="Corregir lectura">✎</button><button class="x" data-borlec="${l.id}" title="Eliminar" aria-label="Eliminar lectura">✕</button></td>` : ''}</tr>`;
      }).join('')}</tbody></table></div></div>`;
  }
  function tablaParadas(d) {
    const ps = d.paradas || [];
    if (!ps.length) return '';
    const puede = d.jornada && (d.jornada.estado === 'abierta' || corrige());
    const porCausa = {};
    ps.forEach(p => { const m = ((p.hasta ? new Date(p.hasta) : new Date()) - new Date(p.desde)) / 60000; porCausa[p.causa] = (porCausa[p.causa] || 0) + m; });
    return `<div class="card"><h3>Paradas <small>${Object.entries(porCausa).sort((a, b) => b[1] - a[1]).map(([c, m]) => esc(c) + ' ' + fDur(m)).join(' · ')}</small></h3>
      <div class="tw"><table class="t"><tr><th class="l">Desde</th><th class="l">Hasta</th><th>Duración</th><th class="l">Causa</th><th class="l">Detalle</th>${puede ? '<th></th>' : ''}</tr>
      ${ps.map(p => `<tr class="${p._pend ? 'pend' : ''}"><td class="l">${fHora(p.desde)}</td><td class="l">${p.hasta ? fHora(p.hasta) : '<span class="chip mal">sigue parada</span>'}</td>
        <td>${fDur(((p.hasta ? new Date(p.hasta) : new Date()) - new Date(p.desde)) / 60000)}</td><td class="l">${esc(p.causa)}</td><td class="l">${esc(p.detalle || '')}</td>
        ${puede ? `<td><button class="x" data-edpar="${p.id}" title="Corregir" aria-label="Corregir parada">✎</button><button class="x" data-borpar="${p.id}" title="Eliminar" aria-label="Eliminar parada">✕</button></td>` : ''}</tr>`).join('')}</table></div></div>`;
  }
  function tablaRecargasDia(d) {
    const j = d.jornada; if (!j) return '';
    const rs = (d.recargas || []).filter(r => r.fecha_hora >= (j.inicio || '')); if (!rs.length) return '';
    return `<div class="card"><h3>Recargas de la jornada</h3><div class="tw"><table class="t"><tr><th class="l">Hora</th><th class="l">Tanque</th><th>Cantidad</th><th class="l">Remito</th></tr>
      ${rs.map(r => { const t = cfg().tanques.find(x => x.id === r.tanque_id) || {}; return `<tr class="${r._pend ? 'pend' : ''}"><td class="l">${fHora(r.fecha_hora)}</td><td class="l">${esc(t.nombre || '')}</td><td>${fN(r.cantidad, r.unidad === 't' ? 2 : 0)} ${r.unidad}</td><td class="l">${esc(r.remito || '')}</td></tr>`; }).join('')}</table></div></div>`;
  }
  function bindTablas() {
    const d = S.dia[S.planta];
    $$('[data-edlec]').forEach(b => b.onclick = () => abrirLectura(null, d.lecturas.find(x => x.id === b.dataset.edlec)));
    $$('[data-borlec]').forEach(b => b.onclick = async () => {
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Eliminar?'; return; }
      await grabar({ op: 'delete', t: 'planta_lecturas', id: b.dataset.borlec }); await cargarDia(S.planta, true); pintar();
    });
    $$('[data-edpar]').forEach(b => b.onclick = () => abrirParada(d.paradas.find(x => x.id === b.dataset.edpar)));
    $$('[data-borpar]').forEach(b => b.onclick = async () => {
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Eliminar?'; return; }
      await grabar({ op: 'delete', t: 'planta_paradas', id: b.dataset.borpar }); await cargarDia(S.planta, true); pintar();
    });
    bindBorrarJornada();
    const re = $('#b-reabrir');
    if (re) re.onclick = async () => {
      if (!re.dataset.conf) { re.dataset.conf = '1'; re.textContent = '¿Reabrir la jornada?'; return; }
      await grabar({ op: 'update', t: 'planta_jornadas', id: d.jornada.id, cambios: { estado: 'abierta', editado_en: new Date().toISOString() } });
      await cargarDia(S.planta, true); pintar();
    };
  }

  // Eliminar una jornada (encargado / admin): se borran sus lecturas y paradas; los tickets de báscula quedan sueltos con su fecha
  function bindBorrarJornada(alTerminar) {
    $$('[data-borjor]').forEach(b => b.onclick = async () => {
      const id = b.dataset.borjor, d = S.dia[S.planta] || {};
      if (!b.dataset.conf) {
        b.dataset.conf = '1';
        const nl = (d.jornada && d.jornada.id === id) ? (d.lecturas || []).length : null;
        b.textContent = nl !== null ? `¿Eliminar la jornada con sus ${nl} lectura(s)? Tocá de nuevo` : '¿Eliminar la jornada y sus lecturas? Tocá de nuevo';
        return;
      }
      b.disabled = true;
      if (!navigator.onLine) { toast('Para eliminar una jornada hace falta señal', 'error'); b.disabled = false; return; }
      const r = await sb.from('planta_jornadas').delete().eq('id', id);
      if (r.error) { toast('No se pudo eliminar: ' + errMsg(r.error), 'error'); b.disabled = false; return; }
      guardar(COLA, cola().filter(x => !((x.fila && (x.fila.id === id || x.fila.jornada_id === id)) || x.id === id)));
      await cargarDia(S.planta, true);
      toast('Jornada eliminada', 'ok');
      if (alTerminar) alTerminar(); else pintar();
    });
  }

  function abrirParada(editar) {
    const d = S.dia[S.planta];
    const causas = (conf('causas', null) || CAUSAS);
    let causa = editar ? editar.causa : '';
    modal(editar ? 'Corregir parada' : 'Paré la planta', `
      <div class="causas" id="p-causas">${causas.map(c => `<button type="button" data-c="${esc(c)}" class="${c === causa ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="campos">
        <label>Desde<input type="datetime-local" id="p-desde" value="${aLocalInput(editar ? editar.desde : null)}"></label>
        ${editar ? `<label>Hasta (vacío = sigue parada)<input type="datetime-local" id="p-hasta" value="${editar.hasta ? aLocalInput(editar.hasta) : ''}"></label>` : ''}
        <label class="ancho">Detalle<input type="text" id="p-det" value="${esc(editar ? editar.detalle || '' : '')}" placeholder="Ej.: no llegó el camión, falla variador silo 4"></label>
      </div>`, `<button class="btn rojo" type="button" id="p-ok">${editar ? 'Guardar' : 'Registrar parada'}</button>`);
    $$('#p-causas button').forEach(b => b.onclick = () => { causa = b.dataset.c; $$('#p-causas button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#p-ok').onclick = async () => {
      if (!causa) return toast('Elegí la causa', 'error');
      const desde = deLocalInput($('#p-desde').value) || new Date().toISOString();
      const hasta = editar && $('#p-hasta') ? deLocalInput($('#p-hasta').value) : null;
      if (hasta && hasta < desde) return toast('«Hasta» es antes de «Desde»', 'error');
      const fila = { id: editar ? editar.id : uuid(), jornada_id: d.jornada.id, planta_id: S.planta, desde, hasta, causa, detalle: $('#p-det').value.trim() || null };
      cerrarModal();
      await grabar({ op: 'upsert', t: 'planta_paradas', fila });
      await cargarDia(S.planta, true); pintar();
    };
  }
  async function reanudar(p) {
    await grabar({ op: 'update', t: 'planta_paradas', id: p.id, cambios: { hasta: new Date().toISOString() } });
    await cargarDia(S.planta, true); pintar(); toast('Planta en marcha', 'ok');
  }

  function abrirCierre() {
    const d = S.dia[S.planta], j = d.jornada;
    const psJ = pesadasDe(d, j);
    const fotos = [];
    modal('Cerrar la jornada', `
      <p class="nota">La producción oficial es la de <b>báscula</b>. Con la foto de la pantalla del SCADA queda el respaldo.</p>
      <div class="campos">
        <label>Hora de cierre<input type="datetime-local" id="c-hora" value="${aLocalInput()}"></label>
        <label>Báscula · total (${unidad()})<input type="text" inputmode="decimal" id="c-bas" value="${psJ.length ? String(Math.round(sumaNeto(psJ) * 100) / 100).replace('.', ',') : ''}">${psJ.length ? `<span class="nota">suma de los ${psJ.length} tickets cargados</span>` : ''}</label>
        <label>Báscula · viajes<input type="number" inputmode="numeric" id="c-via" min="0" value="${psJ.length || ''}"></label>
        <label>Contador SCADA al cierre (${unidad()})<input type="text" inputmode="decimal" id="c-cont"></label>
        ${esAsfalto() ? `<label>CAP total SCADA (t)<input type="text" inputmode="decimal" id="c-scap"></label><label>Filler total SCADA (t)<input type="text" inputmode="decimal" id="c-fil"></label>` : ''}
      </div>
      <h3 style="margin:4px 0 0;font-size:14px">Reglas al cierre</h3>
      ${camposReglas('c', null)}
      <label class="campo">Foto de la pantalla del SCADA / ticket de báscula<input type="file" accept="image/*" capture="environment" id="c-foto" multiple></label>
      <div class="fotos-prev" id="c-prev"></div>
      <label class="campo">Observaciones<textarea id="c-obs" rows="2" style="border:1px solid #c9d1dc;border-radius:8px;padding:9px">${esc(j.observaciones || '')}</textarea></label>`,
      `<button class="btn azul" type="button" id="c-ok">Cerrar jornada</button>`);
    bindReglas('c');
    $('#c-foto').onchange = async (e) => {
      for (const file of Array.from(e.target.files || [])) {
        try { const data = await achicar(file); fotos.push(data); $('#c-prev').insertAdjacentHTML('beforeend', `<img src="${data}" alt="Foto adjunta">`); }
        catch (er) { toast('No se pudo leer la foto', 'error'); }
      }
    };
    $('#c-ok').onclick = async () => {
      const hora = deLocalInput($('#c-hora').value) || new Date().toISOString();
      const bas = pNum($('#c-bas').value), cont = pNum($('#c-cont').value);
      if (bas === null || isNaN(bas)) return toast('Cargá el total de báscula', 'error');
      if (cont === null || isNaN(cont)) return toast('Cargá el contador del SCADA', 'error');
      const { valores, error } = leerReglas('c');
      if (error) return toast(error, 'error');
      const rutas = fotos.map(() => `${S.planta}/${j.fecha}/${j.id}-${uuid().slice(0, 8)}.jpg`);
      fotos.forEach((data, i) => encolar({ op: 'foto', ruta: rutas[i], data }));
      encolar({ op: 'upsert', t: 'planta_lecturas', fila: { id: uuid(), jornada_id: j.id, planta_id: S.planta, hora, tipo: 'cierre', contador_t: cont, scada_cap_t: $('#c-scap') ? pNum($('#c-scap').value) : null, valores } });
      const abierta = (d.paradas || []).find(p => !p.hasta);
      if (abierta) encolar({ op: 'update', t: 'planta_paradas', id: abierta.id, cambios: { hasta: hora } });
      encolar({ op: 'update', t: 'planta_jornadas', id: j.id, cambios: {
        estado: 'cerrada', fin: hora, bascula_t: bas, bascula_viajes: num($('#c-via').value), scada_t: cont,
        scada_cap_t: $('#c-scap') ? pNum($('#c-scap').value) : null, scada_filler_t: $('#c-fil') ? pNum($('#c-fil').value) : null,
        fotos: (j.fotos || []).concat(rutas), observaciones: $('#c-obs').value.trim() || null, cerrado_en: new Date().toISOString() } });
      cerrarModal();
      await enviarCola();
      await cargarDia(S.planta, true); pintar();
      toast(navigator.onLine ? 'Jornada cerrada' : 'Cierre guardado en el teléfono', 'ok');
    };
  }
  async function achicar(file) {
    const bmp = await (window.createImageBitmap ? createImageBitmap(file) : new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file); }));
    const max = 1600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  // ═════════════════════════════ BÁSCULA (un renglón por ticket)
  const normChapa = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function chapasConocidas() {
    const g = new Set(leer('pl_chapas_' + S.planta, []));
    ((S.dia[S.planta] || {}).pesadas || []).forEach(p => { if (p.chapa) g.add(p.chapa); });
    return Array.from(g).sort();
  }
  function recordarChapa(c) { if (!c) return; const g = new Set(leer('pl_chapas_' + S.planta, [])); g.add(c); guardar('pl_chapas_' + S.planta, Array.from(g).slice(-300)); }
  async function ultimaTara(chapa) {
    const loc = ((S.dia[S.planta] || {}).pesadas || []).filter(p => p.chapa === chapa && !vacio(p.tara_kg)).pop();
    if (loc) return { kg: Number(loc.tara_kg), hora: loc.hora };
    const g = leer('pl_taras_' + S.planta, {});
    if (navigator.onLine) {
      try {
        const r = await sb.from('planta_pesadas').select('tara_kg,hora').eq('planta_id', S.planta).eq('chapa', chapa).order('hora', { ascending: false }).limit(5);
        const x = (r.data || []).find(y => !vacio(y.tara_kg));
        if (x) return { kg: Number(x.tara_kg), hora: x.hora };
      } catch (e) { /* sin señal */ }
    }
    return g[chapa] || null;
  }
  function jornadaParaPesar() {
    const d = S.dia[S.planta] || {};
    if (d.jornada && d.jornada.estado === 'abierta') return d.jornada;
    return (d.jornadas || []).find(x => x.fecha === hoyISO()) || null;
  }
  function pintarBascula() {
    const el = $('#v-bascula');
    const j = jornadaParaPesar();
    const ult = ((S.dia[S.planta] || {}).pesadas || []).slice(-1)[0];
    const obraDef = j ? j.obra_clave : (ult ? ult.obra_clave : '');
    S.pesEdit = null;
    el.innerHTML = `<div class="kpis" id="bs-kpis"></div>
      <div class="card"><h3 id="bs-tit">Nuevo ticket <small>${j ? 'jornada ' + fFecha(j.fecha) + (j.estado === 'abierta' ? ' · planta en marcha' : ' · cerrada') : 'la planta todavía no arrancó hoy'}</small></h3>
        <div class="campos">
          <label>Hora<input type="datetime-local" id="bs-hora" value="${aLocalInput()}"></label>
          <label>N° de ticket<input type="text" id="bs-ticket" inputmode="numeric" autocomplete="off"></label>
          <label>Chapa del camión<input type="text" id="bs-chapa" list="bs-chapas" autocomplete="off" style="text-transform:uppercase" placeholder="Ej.: AAKZ123"></label>
          <datalist id="bs-chapas">${chapasConocidas().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          <label>Obra destino<select id="bs-obra">${selObras(obraDef)}</select></label>
        </div>
        <div class="seg" id="bs-modo" style="margin:12px 0 8px"><button type="button" data-m="bt" class="on">Bruto y tara</button><button type="button" data-m="neto">Neto directo</button></div>
        <div class="campos" id="bs-bt">
          <label>Bruto (kg)<input type="text" inputmode="numeric" id="bs-bruto" autocomplete="off"></label>
          <label>Tara (kg)<input type="text" inputmode="numeric" id="bs-tara" autocomplete="off"><span class="nota" id="bs-tara-h"></span></label>
        </div>
        <div class="campos" id="bs-nt" hidden><label>Neto (${unidad()})<input type="text" inputmode="decimal" id="bs-neto" autocomplete="off"></label></div>
        <div class="tramo" style="margin-top:10px"><div><span>Neto</span><b id="bs-res" style="font-size:24px">—</b></div><div><span>Hoy con este</span><b id="bs-tot">—</b></div></div>
        <label class="campo" style="margin-top:10px">Foto del ticket (opcional)<input type="file" accept="image/*" capture="environment" id="bs-foto"></label>
        <div class="fotos-prev" id="bs-prev"></div>
        <label class="campo" style="margin-top:6px">Observación<input type="text" id="bs-obs" style="border:1px solid #c9d1dc;border-radius:8px;padding:9px"></label>
        <div class="botones" style="margin-top:12px"><button class="btn pri ancho" type="button" id="bs-ok">Enviar ticket</button><button class="btn" type="button" id="bs-cancel" hidden>Cancelar corrección</button></div>
      </div>
      <div id="bs-lista"></div>`;
    let modo = 'bt', foto = null;
    const neto = () => {
      if (modo === 'neto') { const n = pNum($('#bs-neto').value); return n > 0 ? n : null; }
      const b = pNum($('#bs-bruto').value), t = pNum($('#bs-tara').value);
      return b > 0 && t >= 0 && b > t ? (b - t) / 1000 : null;
    };
    const upd = () => {
      const n = neto();
      $('#bs-res').textContent = n ? fN(n, 2) + ' ' + unidad() : '—';
      $('#bs-res').style.color = n && n > 45 ? 'var(--rojo)' : '';
      const hoy = sumaNeto(((S.dia[S.planta] || {}).pesadas || []).filter(p => p.fecha === hoyISO() && p.id !== (S.pesEdit || {}).id));
      $('#bs-tot').textContent = fN(hoy + (n || 0), 1) + ' ' + unidad();
    };
    $$('#bs-modo button').forEach(b => b.onclick = () => { modo = b.dataset.m; $$('#bs-modo button').forEach(x => x.classList.toggle('on', x === b)); $('#bs-bt').hidden = modo !== 'bt'; $('#bs-nt').hidden = modo !== 'neto'; upd(); });
    ['#bs-bruto', '#bs-tara', '#bs-neto'].forEach(sel => $(sel).addEventListener('input', upd));
    $('#bs-chapa').addEventListener('change', async () => {
      const c = normChapa($('#bs-chapa').value); $('#bs-chapa').value = c;
      if (!c || $('#bs-tara').value.trim()) return;
      const t = await ultimaTara(c);
      if (t) { $('#bs-tara').value = String(t.kg); $('#bs-tara-h').textContent = `última tara de ${c}: ${fN(t.kg)} kg (${fFechaHora(t.hora)})`; upd(); }
      else $('#bs-tara-h').textContent = 'primera vez de esta chapa: cargá la tara';
    });
    $('#bs-foto').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; foto = await achicar(f); $('#bs-prev').innerHTML = `<img src="${foto}" alt="Ticket">`; };
    $('#bs-cancel').onclick = () => pintarBascula();
    $('#bs-ok').onclick = async () => {
      const n = neto();
      if (!n) return toast(modo === 'bt' ? 'Cargá bruto y tara (el bruto tiene que ser mayor)' : 'Cargá el neto', 'error');
      if (n >= 80) return toast('El neto no puede pasar de 80 t: revisá si cargaste kg en vez de toneladas', 'error');
      const chapa = normChapa($('#bs-chapa').value);
      if (!chapa) return toast('Cargá la chapa del camión', 'error');
      const ticket = $('#bs-ticket').value.trim();
      const hora = deLocalInput($('#bs-hora').value) || new Date().toISOString();
      const edit = S.pesEdit;
      const d = S.dia[S.planta];
      const rep = ticket && (d.pesadas || []).find(p => p.ticket === ticket && p.id !== (edit || {}).id && p.fecha >= isoLocal(new Date(Date.now() - 3 * 86400000)));
      if ((rep || n > 45) && !$('#bs-ok').dataset.conf) {
        $('#bs-ok').dataset.conf = '1';
        $('#bs-ok').textContent = rep ? `El ticket ${ticket} ya está cargado · Enviar igual` : `${fN(n, 2)} t es mucho para un camión · Enviar igual`;
        return;
      }
      const jj = jornadaParaPesar();
      const id = edit ? edit.id : uuid();
      const rutas = foto ? [`${S.planta}/bascula/${id}.jpg`] : [];
      if (foto) encolar({ op: 'foto', ruta: rutas[0], data: foto });
      const tara = modo === 'bt' ? pNum($('#bs-tara').value) : null;
      const fila = { id, planta_id: S.planta, jornada_id: edit ? edit.jornada_id : (jj ? jj.id : null), fecha: isoLocal(new Date(hora)), hora, ticket: ticket || null, chapa,
        bruto_kg: modo === 'bt' ? pNum($('#bs-bruto').value) : null, tara_kg: tara, neto_t: Math.round(n * 1000) / 1000,
        obra_clave: $('#bs-obra').value || null, observaciones: $('#bs-obs').value.trim() || null };
      if (rutas.length) fila.fotos = ((edit || {}).fotos || []).concat(rutas);
      if (edit) fila.editado_en = new Date().toISOString();
      recordarChapa(chapa);
      if (tara) { const g = leer('pl_taras_' + S.planta, {}); g[chapa] = { kg: tara, hora }; guardar('pl_taras_' + S.planta, g); }
      await grabar({ op: 'upsert', t: 'planta_pesadas', fila });
      await cargarDia(S.planta, true);
      toast(navigator.onLine ? `Ticket enviado · ${fN(n, 2)} t` : 'Ticket guardado en el teléfono', 'ok');
      pintarBascula();
      setTimeout(() => { const c = $('#bs-ticket'); if (c) { const num = Number(ticket); if (ticket && isFinite(num)) c.value = String(num + 1).padStart(ticket.length, '0'); c.focus(); } }, 50);
    };
    pintarKpisBascula(); pintarListaBascula(); upd();
  }
  function pintarKpisBascula() {
    const el = $('#bs-kpis'); if (!el) return;
    const ps = ((S.dia[S.planta] || {}).pesadas || []).filter(p => p.fecha === hoyISO());
    const hora = ps.filter(p => new Date(p.hora) > Date.now() - 3600000);
    const ult = ps[ps.length - 1];
    el.innerHTML = `<div class="kpi"><span class="k">Hoy</span><span class="v">${fN(sumaNeto(ps), 1)}<small>${unidad()}</small></span><span class="s">${ps.length} camión(es)</span></div>
      <div class="kpi"><span class="k">Última hora</span><span class="v">${fN(sumaNeto(hora), 1)}<small>${unidad()}</small></span><span class="s">${hora.length} camión(es)</span></div>
      <div class="kpi"><span class="k">Promedio por camión</span><span class="v">${fN(ps.length ? sumaNeto(ps) / ps.length : null, 2)}<small>${unidad()}</small></span></div>
      <div class="kpi"><span class="k">Último camión</span><span class="v">${ult ? fHora(ult.hora) : '—'}</span><span class="s">${ult ? esc(ult.chapa || '') + ' · hace ' + fDur((Date.now() - new Date(ult.hora)) / 60000) : ''}</span></div>`;
  }
  function pintarListaBascula() {
    const el = $('#bs-lista'); if (!el) return;
    pintarKpisBascula();
    const ps = ((S.dia[S.planta] || {}).pesadas || []).filter(p => p.fecha >= isoLocal(new Date(Date.now() - 86400000))).slice().reverse();
    el.innerHTML = tablaPesadas(ps, 'Tickets de hoy y ayer', true);
    $$('[data-edpes]').forEach(b => b.onclick = () => editarPesada(ps.find(x => x.id === b.dataset.edpes)));
    $$('[data-borpes]').forEach(b => b.onclick = async () => {
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Eliminar?'; return; }
      await grabar({ op: 'delete', t: 'planta_pesadas', id: b.dataset.borpes }); await cargarDia(S.planta, true); pintarListaBascula();
    });
    $$('[data-foto]', el).forEach(b => b.onclick = () => verFoto(b.dataset.foto));
  }
  function tablaPesadas(ps, titulo, conBotones) {
    if (!ps.length) return conBotones ? '<div class="card vacio">Todavía no hay tickets.</div>' : '';
    const mio = (p) => rol() === 'admin' || rol() === 'encargado' || (p.creado_por === (S.perfil || {}).id && (Date.now() - new Date(p.creado_en || p.hora)) < 48 * 3600000) || p._pend;
    return `<div class="card"><h3>${esc(titulo)} <small>${ps.length} · ${fN(sumaNeto(ps), 1)} ${unidad()}</small></h3><div class="tw"><table class="t"><thead><tr>
      <th class="l">Hora</th><th class="l">Ticket</th><th class="l">Chapa</th><th>Bruto kg</th><th>Tara kg</th><th>Neto ${unidad()}</th><th class="l">Obra</th>${conBotones ? '<th class="l">Foto</th><th></th>' : ''}</tr></thead><tbody>
      ${ps.map(p => { const o = S.obras.find(x => x.clave === p.obra_clave);
        return `<tr class="${p._pend ? 'pend' : Number(p.neto_t) > 45 ? 'ojo' : ''}"><td class="l">${p.fecha !== hoyISO() ? fFecha(p.fecha).slice(0, 5) + ' ' : ''}${fHora(p.hora)}${p._pend ? ' ⏳' : ''}</td><td class="l">${esc(p.ticket || '')}</td><td class="l">${esc(p.chapa || '')}</td>
        <td>${fN(p.bruto_kg)}</td><td>${fN(p.tara_kg)}</td><td><b>${fN(p.neto_t, 2)}</b></td><td class="l">${esc(o ? o.nombre : (p.obra_clave || ''))}</td>
        ${conBotones ? `<td class="l">${(p.fotos || []).map(f => `<button class="btn chico" type="button" data-foto="${esc(f)}">Ver</button>`).join(' ')}</td>
        <td>${mio(p) ? `<button class="x" data-edpes="${p.id}" title="Corregir" aria-label="Corregir ticket">✎</button><button class="x" data-borpes="${p.id}" title="Eliminar" aria-label="Eliminar ticket">✕</button>` : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div></div>`;
  }
  function editarPesada(p) {
    if (!p) return;
    S.pesEdit = p;
    $('#bs-tit').firstChild.textContent = 'Corregir ticket ';
    $('#bs-hora').value = aLocalInput(p.hora); $('#bs-ticket').value = p.ticket || ''; $('#bs-chapa').value = p.chapa || '';
    $('#bs-obra').value = p.obra_clave || '';
    if (vacio(p.bruto_kg)) { $('#bs-modo [data-m="neto"]').click(); $('#bs-neto').value = String(p.neto_t).replace('.', ','); }
    else { $('#bs-modo [data-m="bt"]').click(); $('#bs-bruto').value = String(p.bruto_kg); $('#bs-tara').value = vacio(p.tara_kg) ? '' : String(p.tara_kg); }
    $('#bs-obs').value = p.observaciones || '';
    $('#bs-ok').textContent = 'Guardar corrección'; $('#bs-cancel').hidden = false;
    $('#bs-bruto').dispatchEvent(new Event('input'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ═════════════════════════════ RECARGAS
  function abrirRecarga(editar) {
    const ts = cfg().tanques.filter(t => t.activo !== false && puedeRecargar(t));
    if (!ts.length) return toast(rol() === 'encargado' ? 'El CAP lo carga el admin de obra. No hay otros tanques para recargar.' : 'No podés cargar recargas en esta planta', 'error');
    const fotos = [];
    modal('Recarga de tanque', `<div class="campos">
      <label class="ancho">Tanque<select id="r-tq">${ts.map(t => `<option value="${t.id}" data-ins="${t.insumo}">${esc(t.nombre)}</option>`).join('')}</select></label>
      <label>Fecha y hora<input type="datetime-local" id="r-hora" value="${aLocalInput()}"></label>
      <label>Cantidad<input type="text" inputmode="decimal" id="r-cant"></label>
      <label>Unidad<select id="r-un"><option value="L">litros</option><option value="t">toneladas</option></select></label>
      <label>Remito / factura<input type="text" id="r-rem"></label>
      <label class="ancho">Proveedor<input type="text" id="r-prov"></label>
      <label class="ancho">Observación<input type="text" id="r-obs"></label></div>
      <div class="nota" id="r-eq"></div>
      <label class="campo">Foto del remito<input type="file" accept="image/*" capture="environment" id="r-foto"></label><div class="fotos-prev" id="r-prev"></div>`,
      `<button class="btn pri" type="button" id="r-ok">Guardar recarga</button>`);
    const ajusta = () => {
      const t = ts.find(x => String(x.id) === $('#r-tq').value);
      if (t && t.insumo === 'cap' && !ajusta.tocado) $('#r-un').value = 't';
      const c = pNum($('#r-cant').value);
      $('#r-eq').textContent = t && c > 0 && $('#r-un').value === 't' ? `≈ ${fN(c / (num(t.densidad) || 1) * 1000)} L${num(t.densidad) ? '' : ' (sin densidad cargada: se usa 1,00)'}` : '';
    };
    $('#r-tq').onchange = () => { ajusta.tocado = false; ajusta(); }; $('#r-cant').oninput = ajusta; $('#r-un').onchange = () => { ajusta.tocado = true; ajusta(); }; ajusta();
    $('#r-foto').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const data = await achicar(f); fotos.splice(0, 1, data); $('#r-prev').innerHTML = `<img src="${data}" alt="Remito">`; };
    $('#r-ok').onclick = async () => {
      const cant = pNum($('#r-cant').value);
      if (!(cant > 0)) return toast('Cargá la cantidad', 'error');
      const tq = Number($('#r-tq').value), id = uuid();
      const rutas = fotos.map(() => `${S.planta}/recargas/${id}.jpg`);
      fotos.forEach((data, i) => encolar({ op: 'foto', ruta: rutas[i], data }));
      const fila = { id, planta_id: S.planta, tanque_id: tq, fecha_hora: deLocalInput($('#r-hora').value) || new Date().toISOString(), cantidad: cant, unidad: $('#r-un').value,
        remito: $('#r-rem').value.trim() || null, proveedor: $('#r-prov').value.trim() || null, observaciones: $('#r-obs').value.trim() || null, fotos: rutas };
      cerrarModal();
      await grabar({ op: 'upsert', t: 'planta_recargas', fila });
      await cargarDia(S.planta, true); pintar(); toast('Recarga guardada', 'ok');
    };
  }
  async function pintarRecargas() {
    const el = $('#v-recargas');
    el.innerHTML = '<div class="vacio">Cargando…</div>';
    let filas = [];
    try {
      const r = await sb.from('planta_recargas').select('*').eq('planta_id', S.planta).gte('fecha_hora', new Date(Date.now() - 90 * 86400000).toISOString()).order('fecha_hora', { ascending: false }).limit(500);
      if (r.error) throw r.error;
      filas = conPendientes('planta_recargas', r.data || [], f => f.planta_id === S.planta).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
    } catch (e) { filas = (S.dia[S.planta] || {}).recargas || []; }
    await cargarNombres(filas.map(f => f.creado_por));
    const ts = cfg().tanques;
    const puede = ts.some(t => puedeRecargar(t));
    el.innerHTML = `<div class="barra"><b>Recargas de ${esc(S.planta)} · últimos 90 días</b><span class="esp"></span>${puede ? '<button class="btn pri" type="button" id="rr-nueva">+ Recarga</button>' : ''}</div>
      ${filas.length ? `<div class="tw"><table class="t"><tr><th class="l">Fecha</th><th class="l">Tanque</th><th>Cantidad</th><th>Litros</th><th class="l">Remito</th><th class="l">Proveedor</th><th class="l">Cargó</th><th class="l">Foto</th><th></th></tr>
      ${filas.map(r => { const t = ts.find(x => x.id === r.tanque_id) || {}; const mio = r.creado_por === (S.perfil || {}).id || rol() === 'admin';
        return `<tr class="${r._pend ? 'pend' : ''}"><td class="l">${fFechaHora(r.fecha_hora)}</td><td class="l">${esc(t.nombre || '')}</td><td>${fN(r.cantidad, r.unidad === 't' ? 2 : 0)} ${r.unidad}</td><td>${fN(recargaLitros(r))}</td>
          <td class="l">${esc(r.remito || '')}</td><td class="l">${esc(r.proveedor || '')}</td><td class="l">${esc(S.nombres[r.creado_por] || '')}</td>
          <td class="l">${(r.fotos || []).map((f, i) => `<button class="btn chico" type="button" data-foto="${esc(f)}">Ver${r.fotos.length > 1 ? ' ' + (i + 1) : ''}</button>`).join(' ')}</td>
          <td>${mio && puedeRecargar(t) ? `<button class="x" data-borrec="${r.id}" title="Eliminar" aria-label="Eliminar recarga">✕</button>` : ''}</td></tr>`; }).join('')}</table></div>` : '<div class="card vacio">Sin recargas en el período.</div>'}`;
    if ($('#rr-nueva')) $('#rr-nueva').onclick = () => abrirRecarga();
    $$('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
    $$('[data-borrec]').forEach(b => b.onclick = async () => {
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Eliminar?'; return; }
      await grabar({ op: 'delete', t: 'planta_recargas', id: b.dataset.borrec }); await cargarDia(S.planta, true); pintarRecargas();
    });
  }
  async function verFoto(ruta) {
    const pend = cola().find(x => x.op === 'foto' && x.ruta === ruta);
    let url = pend ? pend.data : null;
    if (!url) { const r = await sb.storage.from(BUCKET).createSignedUrl(ruta, 600); if (r.error) return toast('No se pudo abrir la foto: ' + errMsg(r.error), 'error'); url = r.data.signedUrl; }
    modal('Foto', `<img src="${url}" alt="Foto" style="width:100%;border-radius:8px">`, `<a class="btn" href="${url}" target="_blank" rel="noopener">Abrir aparte</a>`, true);
  }

  // ═════════════════════════════ EN VIVO
  function suscribirVivo() {
    if (!sb || !sb.channel) return;
    desuscribirVivo();
    const p = S.planta;
    let t = null;
    const recargar = () => { clearTimeout(t); t = setTimeout(async () => {
      await cargarDia(p, true);
      if (S.planta !== p) return;
      if (S.vista === 'vivo') { pintarVivo(); revisarAlertas(); }
      else if (S.vista === 'bascula') pintarListaBascula();
    }, 600); };
    try {
      S.vivoCanal = sb.channel('planta-' + p);
      ['planta_lecturas', 'planta_paradas', 'planta_jornadas', 'planta_recargas', 'planta_pesadas'].forEach(tabla =>
        S.vivoCanal.on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter: `planta_id=eq.${p}` }, recargar));
      S.vivoCanal.subscribe((st) => { S.vivoEstado = st; if (S.vista === 'vivo') { const e = $('#vivo-conexion'); if (e) e.innerHTML = chipConexion(); } });
    } catch (e) { S.vivoCanal = null; }
    cargarDia(p, true).then(() => { if (S.vista === 'vivo') { pintarVivo(); revisarAlertas(true); } });   // la báscula ya se pintó con lo cargado
  }
  function desuscribirVivo() {
    if (S.vivoCanal && sb && sb.removeChannel) { try { sb.removeChannel(S.vivoCanal); } catch (e) {} }
    S.vivoCanal = null; S.vivoEstado = null;
  }
  const chipConexion = () => S.vivoEstado === 'SUBSCRIBED' ? '<span class="chip ok">● en vivo</span>' : navigator.onLine ? '<span class="chip ojo">conectando…</span>' : '<span class="chip mal">sin señal</span>';
  function revisarAlertas(silencio) {
    const d = S.dia[S.planta]; if (!d || !d.jornada || d.jornada.estado !== 'abierta') return;
    const trs = tramos(d), ult = trs[trs.length - 1];
    if (!ult || ult.estado !== 'mal') return;
    const clave = S.planta + ult.lectura.id;
    if (S.ultAlerta[clave]) return;
    S.ultAlerta[clave] = true;
    if (silencio) return;
    const f = formulaDe(d.jornada);
    const txt = `${S.planta} · ${fHora(ult.hasta)}: CAP ${fN(ult.pctCap, 2)} %${f && !vacio(f.pct_cap) ? ' (fórmula ' + fN(f.pct_cap, 2) + ' %)' : ''}`;
    const av = $('#aviso-vivo');
    av.innerHTML = `<button type="button" aria-label="Cerrar aviso">×</button><b>Fuera de fórmula</b><br>${esc(txt)}`;
    av.hidden = false; av.querySelector('button').onclick = () => { av.hidden = true; };
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); o.frequency.value = 880; o.connect(ac.destination); o.start(); setTimeout(() => { o.stop(); ac.close(); }, 350); } catch (e) {}
    try { if (window.Notification && Notification.permission === 'granted') new Notification('Planta ' + S.planta + ' fuera de fórmula', { body: txt, icon: './icon-192.png', tag: clave }); } catch (e) {}
  }
  function pintarVivo() {
    const el = $('#v-vivo');
    const d = S.dia[S.planta] || {};
    const j = d.jornada;
    const avisoBtn = window.Notification && Notification.permission === 'default' ? '<button class="btn chico" type="button" id="vv-notif">Activar avisos en este equipo</button>' : '';
    const cab = `<div class="barra"><b>${esc((cfg().planta || {}).nombre || S.planta)}</b><span id="vivo-conexion">${chipConexion()}</span>${d.sinSenal ? '<span class="chip mal">mostrando lo guardado</span>' : ''}<span class="esp"></span>${avisoBtn}</div>`;
    if (!j) { el.innerHTML = cab + '<div class="card vacio">Hoy todavía no arrancó la planta.</div>' + cardTanques(d) + cardControles(d, false); bindVivo(); bindControles(); return; }
    const r = resumen(d);
    const f = formulaDe(j);
    const obra = S.obras.find(o => o.clave === j.obra_clave);
    const alerta = Number(conf('alerta_sin_lectura_min', 90));
    const sinLectura = j.estado === 'abierta' && !r.paradaAbierta && r.minDesdeUltima !== null && r.minDesdeUltima > alerta;
    const ultTr = r.trs[r.trs.length - 1];
    const tol = num(f && f.tol_cap) ?? conf('tol_cap', 0.2);
    const stock = stockTanques(d);
    el.innerHTML = cab + `
      <div class="card"><div class="estado-planta">
        <span class="grande"><span class="punto ${j.estado === 'cerrada' ? 'cerrada' : r.paradaAbierta ? 'parada' : 'vivo'}"></span>${j.estado === 'cerrada' ? 'Jornada cerrada ' + fHora(j.fin) : r.paradaAbierta ? 'Parada · ' + esc(r.paradaAbierta.causa) + ' (hace ' + fDur((Date.now() - new Date(r.paradaAbierta.desde)) / 60000) + ')' : 'Produciendo'}</span>
        <span class="chip gris">${esc(obra ? obra.nombre : j.obra_clave || '')}</span>${f ? `<span class="chip">${esc(f.nombre)}${!vacio(f.pct_cap) ? ' · ' + fN(f.pct_cap, 2) + ' % ± ' + fN(tol, 1) : ''}</span>` : ''}
        <span class="nota">${fFecha(j.fecha)} · arrancó ${fHora(j.inicio)} · ${fDur(r.minJornada)}</span></div></div>
      ${sinLectura ? `<div class="card" style="border-color:var(--amarillo-alerta);background:var(--ambar-suave)"><b>Hace ${fDur(r.minDesdeUltima)} que no llega una lectura.</b> <span class="nota">Puede ser falta de señal en la planta: lo que carguen sin señal llega cuando el celular se conecte.</span></div>` : ''}
      <div class="kpis">
        <div class="kpi"><span class="k">Báscula (despachado)</span><span class="v">${fN(j.estado === 'cerrada' && !vacio(j.bascula_t) ? j.bascula_t : r.basT, 1)}<small>${unidad()}</small></span><span class="s">${r.basN} camión(es)${r.ultPes ? ' · último hace ' + fDur(r.minDesdeCamion) : ''}</span></div>
        <div class="kpi"><span class="k">Contador SCADA</span><span class="v">${fN(r.prodCont, 1)}<small>${unidad()}</small></span><span class="s">${r.basT > 0 && r.prodCont > 0 ? 'dif. con báscula ' + fN((r.prodCont - r.basT) / r.basT * 100, 1) + ' %' : 'producción planta'}</span></div>
        <div class="kpi"><span class="k">Rendimiento última hora</span><span class="v">${fN(ultTr ? ultTr.th : null, 0)}<small>${unidad()}/h</small></span><span class="s">del día ${fN(r.th, 0)} · nominal ${fN((cfg().planta || {}).caudal_nominal)}</span></div>
        ${esAsfalto() ? `<div class="kpi ${ultTr && ultTr.estadoCap === 'mal' ? 'alerta' : ''}"><span class="k">CAP última hora</span><span class="v">${fN(ultTr ? ultTr.pctCap : null, 2)}<small>%</small></span><span class="s">del día ${fN(r.pctCap, 2)} %</span></div>
        <div class="kpi ${ultTr && ultTr.estadoLt === 'ojo' ? 'ojo' : ''}"><span class="k">Fuel última hora</span><span class="v">${fN(ultTr ? ultTr.lt : null, 1)}<small>L/${unidad()}</small></span><span class="s">del día ${fN(r.lt, 1)} · máx. ${fN(conf('lt_max', 7), 1)}</span></div>` : ''}
        <div class="kpi"><span class="k">Paradas</span><span class="v">${fDur(r.minParada)}</span><span class="s">${(d.paradas || []).length} parada(s)</span></div>
        <div class="kpi ${sinLectura ? 'ojo' : ''}"><span class="k">Última lectura</span><span class="v">${r.ultima ? fHora(r.ultima.hora) : '—'}</span><span class="s">${r.ultima ? 'hace ' + fDur(r.minDesdeUltima) : ''}</span></div>
      </div>
      <div class="dos">
        <div class="card"><h3>Hora a hora <small>barras: ${unidad()}/h · línea: %CAP · franja: fórmula</small></h3>${graficoHoras(r.trs, f, tol)}
          <div class="leyenda"><span><i style="background:var(--azul-medio)"></i>${unidad()}/h</span>${esAsfalto() ? '<span><i style="background:var(--naranja)"></i>%CAP medido</span><span><i style="background:var(--verde-suave);border:1px solid var(--verde)"></i>fórmula</span>' : ''}<span><i style="background:#f3c5bf"></i>parada</span></div></div>
        ${cardTanques(d, stock)}
      </div>
      ${tablaTramos(d, false)}${tablaPesadas(pesadasDe(d).slice().reverse().slice(0, 12), 'Últimos camiones', false)}${tablaParadas(d)}${cardControles(d, false)}`;
    bindVivo(); bindControles();
  }
  function cardTanques(d, stock) {
    stock = stock || stockTanques(d);
    return `<div class="card"><h3>Tanques <small>stock ahora y cuánto alcanza</small></h3><div class="tanques">${stock.map(s => {
          const pct = s.cap && s.litros !== null ? Math.max(0, Math.min(100, s.litros / s.cap * 100)) : null;
          const bajo = s.autonomiaH !== null && s.autonomiaH < 4;
          return `<div class="tq ${bajo ? 'bajo' : ''}"><b>${esc(s.t.nombre)}</b><span class="v" style="font-size:20px;font-weight:800">${fN(s.litros)} L${s.t.insumo === 'cap' && s.litros !== null ? ' · ' + fN(aTon(s.t, s.litros), 1) + ' t' : ''}</span>
            <div class="barra-tq"><i style="width:${pct ?? 0}%"></i></div><span class="nota">${pct !== null ? fN(pct) + ' % de ' + fN(s.cap) + ' L' : 'sin aforo'}${s.lh ? ' · ' + fN(s.lh) + ' L/h' : ''}${s.autonomiaH !== null ? ' · alcanza ' + fN(s.autonomiaH, 1) + ' h' : ''}</span></div>`;
        }).join('') || '<p class="nota">Sin tanques configurados.</p>'}</div></div>`;
  }
  function bindVivo() {
    const b = $('#vv-notif');
    if (b) b.onclick = async () => { try { await Notification.requestPermission(); } catch (e) {} pintarVivo(); };
  }
  function graficoHoras(trs, f, tol) {
    const W = 640, H = 240, L = 44, R = 44, T = 14, B = 30;
    if (!trs.length) return '<p class="nota">Con dos lecturas aparece el primer tramo.</p>';
    const iw = W - L - R, ih = H - T - B, n = trs.length, bw = iw / n;
    const maxTh = Math.max(10, ...trs.map(t => t.th || 0)) * 1.15;
    const nice = Math.ceil(maxTh / 20) * 20;
    const y = v => T + ih - v / nice * ih;
    const capVals = trs.map(t => t.pctCap).filter(v => v !== undefined && isFinite(v));
    const base = f && !vacio(f.pct_cap) ? Number(f.pct_cap) : (capVals.length ? capVals.reduce((a, b) => a + b, 0) / capVals.length : 4.5);
    const cMin = Math.max(0, Math.floor(Math.min(base - 1.5, ...capVals) * 2) / 2), cMax = Math.ceil(Math.max(base + 1.5, ...capVals) * 2) / 2;
    const yc = v => T + ih - (Math.min(Math.max(v, cMin), cMax) - cMin) / ((cMax - cMin) || 1) * ih;
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = nice * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e9f0"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="#6b7487">${fN(v)}</text>`; }
    if (esAsfalto()) {
      for (let i = 0; i <= 4; i++) { const v = cMin + (cMax - cMin) * i / 4; g += `<text x="${W - R + 6}" y="${yc(v) + 4}" font-size="10.5" fill="#6b7487">${fN(v, 1)}%</text>`; }
      if (f && !vacio(f.pct_cap)) g += `<rect x="${L}" y="${yc(base + tol)}" width="${iw}" height="${Math.max(1, yc(base - tol) - yc(base + tol))}" fill="#e6f4ea" stroke="#2d8a4e" stroke-opacity=".35"/>`;
    }
    trs.forEach((t, i) => {
      const x = L + i * bw;
      if (!(t.prod > 0)) { g += `<rect x="${x + bw * .1}" y="${T}" width="${bw * .8}" height="${ih}" fill="#f3c5bf" opacity=".45"><title>${fHora(t.desde)}–${fHora(t.hasta)} sin producción</title></rect>`; return; }
      g += `<rect x="${x + bw * .18}" y="${y(t.th || 0)}" width="${bw * .64}" height="${T + ih - y(t.th || 0)}" rx="2" fill="#2c4a8a"><title>${fHora(t.desde)}–${fHora(t.hasta)}: ${fN(t.th, 0)} ${unidad()}/h</title></rect>`;
    });
    if (esAsfalto()) {
      const pts = trs.map((t, i) => t.pctCap !== undefined && isFinite(t.pctCap) ? [L + i * bw + bw / 2, yc(t.pctCap), t] : null).filter(Boolean);
      if (pts.length > 1) g += `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="#e8640a" stroke-width="2"/>`;
      pts.forEach(p => { const mal = p[2].estadoCap === 'mal'; g += `<circle cx="${p[0]}" cy="${p[1]}" r="${mal ? 5 : 3.5}" fill="${mal ? '#c0392b' : '#e8640a'}" stroke="#fff"><title>${fHora(p[2].hasta)}: ${fN(p[2].pctCap, 2)} %</title></circle>`; });
    }
    const paso = Math.ceil(n / 10);
    trs.forEach((t, i) => { if (i % paso === 0 || i === n - 1) g += `<text x="${L + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="#4a5568">${fHora(t.hasta)}</text>`; });
    return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Producción por hora y porcentaje de CAP">${g}</svg>`;
  }

  // ═════════════════════════════ TABLERO
  async function pintarTablero() {
    const el = $('#v-tablero');
    if (!S.tablero.desde) { const h = new Date(); S.tablero.hasta = isoLocal(h); S.tablero.desde = isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)); }
    el.innerHTML = `<div class="barra"><label class="nota">Desde <input type="date" id="tb-desde" value="${S.tablero.desde}"></label>
      <label class="nota">Hasta <input type="date" id="tb-hasta" value="${S.tablero.hasta}"></label>
      <div class="seg" id="tb-rapido"><button type="button" data-r="7">7 días</button><button type="button" data-r="mes">Este mes</button><button type="button" data-r="ant">Mes anterior</button><button type="button" data-r="90">90 días</button></div></div>
      <div id="tb-cuerpo"><div class="vacio">Cargando…</div></div>`;
    $('#tb-desde').onchange = () => { S.tablero.desde = $('#tb-desde').value; pintarTablero(); };
    $('#tb-hasta').onchange = () => { S.tablero.hasta = $('#tb-hasta').value; pintarTablero(); };
    $$('#tb-rapido button').forEach(b => b.onclick = () => {
      const h = new Date(); let de = null, ha = h;
      if (b.dataset.r === '7') de = new Date(Date.now() - 6 * 86400000);
      else if (b.dataset.r === '90') de = new Date(Date.now() - 89 * 86400000);
      else if (b.dataset.r === 'mes') de = new Date(h.getFullYear(), h.getMonth(), 1);
      else { de = new Date(h.getFullYear(), h.getMonth() - 1, 1); ha = new Date(h.getFullYear(), h.getMonth(), 0); }
      S.tablero.desde = isoLocal(de); S.tablero.hasta = isoLocal(ha); pintarTablero();
    });
    let js = [], pas = [], tr = [];
    try {
      const [a, b, c] = await Promise.all([
        sb.from('v_powerbi_plantas_jornadas').select('*').eq('planta_id', S.planta).gte('fecha', S.tablero.desde).lte('fecha', S.tablero.hasta).order('fecha'),
        sb.from('planta_paradas').select('causa,desde,hasta,jornada_id').eq('planta_id', S.planta).gte('desde', new Date(S.tablero.desde + 'T00:00:00').toISOString()).lte('desde', new Date(S.tablero.hasta + 'T23:59:59').toISOString()),
        sb.rpc('planta_transporte', { p_planta: S.planta, p_desde: S.tablero.desde, p_hasta: S.tablero.hasta }),
      ]);
      if (a.error) throw a.error; if (b.error) throw b.error;
      js = a.data || []; pas = b.data || []; tr = c.error ? [] : (c.data || []);
    } catch (e) {
      $('#tb-cuerpo').innerHTML = `<div class="card vacio">${esRed(e) ? 'El tablero necesita señal.' : 'No se pudo cargar: ' + esc(errMsg(e))}</div>`; return;
    }
    if (!js.length) { $('#tb-cuerpo').innerHTML = '<div class="card vacio">Sin jornadas en el período.</div>'; return; }
    const prodDe = (j) => !vacio(j.bascula_t) ? Number(j.bascula_t) : Number(j.pesadas_t) > 0 ? Number(j.pesadas_t) : (!vacio(j.contador_t) ? Number(j.contador_t) : 0);
    const tot = js.reduce((s, j) => s + prodDe(j), 0);
    const horasProd = js.reduce((s, j) => s + Math.max(0, (Number(j.horas_jornada) || 0) - (Number(j.horas_parada) || 0)), 0);
    const conCap = js.filter(j => !vacio(j.cap_t) && Number(j.contador_t) > 0);
    const capPct = conCap.length ? conCap.reduce((s, j) => s + Number(j.cap_t), 0) / conCap.reduce((s, j) => s + Number(j.contador_t), 0) * 100 : null;
    const conFuel = js.filter(j => !vacio(j.fuel_l) && Number(j.contador_t) > 0);
    const lt = conFuel.length ? conFuel.reduce((s, j) => s + Number(j.fuel_l), 0) / conFuel.reduce((s, j) => s + Number(j.contador_t), 0) : null;
    const gasoil = js.reduce((s, j) => s + (Number(j.gasoil_l) || 0), 0);
    const horasPar = js.reduce((s, j) => s + (Number(j.horas_parada) || 0), 0);
    const trPorDia = {}; tr.forEach(x => { const k = x.fecha + '|' + x.obra_codigo; trPorDia[k] = (trPorDia[k] || 0) + Number(x.toneladas || 0); });
    const codigoObra = (clave) => { const o = S.obras.find(x => x.clave === clave); return o ? o.codigo : (clave || '').split('_')[0]; };
    const trTot = js.reduce((s, j) => s + (trPorDia[j.fecha + '|' + codigoObra(j.obra_clave)] || 0), 0);
    const porCausa = {};
    pas.forEach(p => { if (!p.hasta) return; porCausa[p.causa] = (porCausa[p.causa] || 0) + (new Date(p.hasta) - new Date(p.desde)) / 3600000; });
    const f0 = cfg().formulas.find(f => f.activo !== false && !vacio(f.pct_cap));
    $('#tb-cuerpo').innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="k">Producción (báscula)</span><span class="v">${fN(tot)}<small>${unidad()}</small></span><span class="s">${js.length} jornada(s)</span></div>
        <div class="kpi"><span class="k">Rendimiento</span><span class="v">${fN(horasProd > 0 ? tot / horasProd : null)}<small>${unidad()}/h</small></span><span class="s">${fN(horasProd, 1)} h produciendo · nominal ${fN((cfg().planta || {}).caudal_nominal)}</span></div>
        ${esAsfalto() ? `<div class="kpi"><span class="k">CAP medido</span><span class="v">${fN(capPct, 2)}<small>%</small></span><span class="s">${f0 ? 'fórmula ' + fN(f0.pct_cap, 2) + ' %' : 'por regla de tanque'}</span></div>
        <div class="kpi"><span class="k">Fuel secadero</span><span class="v">${fN(lt, 1)}<small>L/${unidad()}</small></span><span class="s">máx. ${fN(conf('lt_max', 7), 1)}</span></div>
        <div class="kpi"><span class="k">Gasoil caldera</span><span class="v">${fN(gasoil)}<small>L</small></span><span class="s">${fN(gasoil / js.length)} L por jornada</span></div>` : ''}
        <div class="kpi"><span class="k">Paradas</span><span class="v">${fN(horasPar, 1)}<small>h</small></span><span class="s">${horasPar + horasProd > 0 ? fN(horasPar / (horasPar + horasProd) * 100) + ' % de la jornada' : ''}</span></div>
        <div class="kpi"><span class="k">Transporte (pista)</span><span class="v">${fN(trTot)}<small>t</small></span><span class="s">${tot > 0 && trTot > 0 ? 'diferencia ' + fN((tot - trTot) / tot * 100, 1) + ' %' : 'cargas en pista'}</span></div>
      </div>
      <div class="dos">
        <div class="card"><h3>Producción diaria <small>barras: báscula · línea: %CAP</small></h3>${graficoDias(js, prodDe, f0)}</div>
        <div class="card"><h3>¿Por qué se paró? <small>horas por causa</small></h3>${graficoCausas(porCausa)}</div>
      </div>
      <div class="card"><h3>Jornadas <small>báscula es la producción oficial</small></h3><div class="tw"><table class="t"><thead><tr>
        <th class="l">Fecha</th><th class="l">Obra</th><th>Báscula</th><th>Viajes</th><th>Contador</th><th>Dif. %</th><th>Transporte</th><th>Horas</th><th>Parada h</th><th>${unidad()}/h</th>
        ${esAsfalto() ? '<th>CAP t</th><th>%CAP</th><th>Fuel L</th><th>L/' + unidad() + '</th><th>Gasoil L</th>' : ''}<th class="l">Estado</th>${corrige() ? '<th></th>' : ''}</tr></thead><tbody>
        ${js.slice().reverse().map(j => {
          const hp = Math.max(0, (Number(j.horas_jornada) || 0) - (Number(j.horas_parada) || 0));
          const dif = !vacio(j.bascula_t) && Number(j.contador_t) > 0 ? (Number(j.contador_t) - Number(j.bascula_t)) / Number(j.bascula_t) * 100 : null;
          const pc = !vacio(j.cap_t) && Number(j.contador_t) > 0 ? Number(j.cap_t) / Number(j.contador_t) * 100 : null;
          const ltd = !vacio(j.fuel_l) && Number(j.contador_t) > 0 ? Number(j.fuel_l) / Number(j.contador_t) : null;
          const pf = vacio(j.pct_cap_formula) ? null : Number(j.pct_cap_formula);
          const malCap = pc !== null && pf !== null && Math.abs(pc - pf) > Number(conf('tol_cap', 0.2));
          const trd = trPorDia[j.fecha + '|' + codigoObra(j.obra_clave)];
          return `<tr class="${malCap ? 'mal' : (dif !== null && Math.abs(dif) > 3) ? 'ojo' : ''}"><td class="l">${fFecha(j.fecha)}${j.turno > 1 ? ' T' + j.turno : ''}</td><td class="l">${esc(j.obra || '')}</td>
            <td>${fN(vacio(j.bascula_t) ? j.pesadas_t : j.bascula_t, 1)}</td><td>${fN(vacio(j.bascula_viajes) ? j.pesadas_viajes : j.bascula_viajes)}</td><td>${fN(j.contador_t, 1)}</td><td>${dif === null ? '' : fN(dif, 1)}</td><td>${trd ? fN(trd, 1) : ''}</td>
            <td>${fN(j.horas_jornada, 1)}</td><td>${fN(j.horas_parada, 1)}</td><td>${fN(hp > 0 ? prodDe(j) / hp : null)}</td>
            ${esAsfalto() ? `<td>${fN(j.cap_t, 2)}</td><td>${pc === null ? '' : `<span class="chip ${pf === null ? 'gris' : malCap ? 'mal' : 'ok'}">${fN(pc, 2)}</span>`}</td><td>${fN(j.fuel_l)}</td><td>${fN(ltd, 1)}</td><td>${fN(j.gasoil_l)}</td>` : ''}
            <td class="l">${j.estado === 'abierta' ? '<span class="chip ojo">abierta</span>' : '<span class="chip gris">cerrada</span>'}</td>
            ${corrige() ? `<td><button class="x" data-borjor="${j.jornada_id}" title="Eliminar jornada" aria-label="Eliminar jornada">✕</button></td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>
        <p class="nota">${corrige() ? '✕ elimina la jornada con sus lecturas y paradas (para jornadas de prueba o cargadas por error). ' : ''}Dif. % = contador del SCADA contra báscula. Transporte = toneladas cargadas en pista para esa obra ese día (control cruzado). %CAP y L/${unidad()} salen de las reglas de los tanques entre la primera y la última lectura de la jornada.</p></div>`;  bindBorrarJornada(() => pintarTablero());
  }
  function graficoDias(js, prodDe, f0) {
    const W = 640, H = 240, L = 48, R = 44, T = 14, B = 30;
    const n = js.length, iw = W - L - R, ih = H - T - B, bw = iw / n;
    const max = Math.max(10, ...js.map(prodDe)) * 1.1, nice = Math.ceil(max / 100) * 100;
    const y = v => T + ih - v / nice * ih;
    const caps = js.map(j => !vacio(j.cap_t) && Number(j.contador_t) > 0 ? Number(j.cap_t) / Number(j.contador_t) * 100 : null);
    const vals = caps.filter(v => v !== null);
    const base = f0 ? Number(f0.pct_cap) : (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 4.5);
    const cMin = Math.max(0, Math.floor(Math.min(base - 1.5, ...vals) * 2) / 2), cMax = Math.ceil(Math.max(base + 1.5, ...vals) * 2) / 2;
    const yc = v => T + ih - (Math.min(Math.max(v, cMin), cMax) - cMin) / ((cMax - cMin) || 1) * ih;
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = nice * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e9f0"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="#6b7487">${fN(v)}</text>`; }
    js.forEach((j, i) => { const v = prodDe(j); g += `<rect x="${L + i * bw + bw * .15}" y="${y(v)}" width="${bw * .7}" height="${T + ih - y(v)}" rx="2" fill="${vacio(j.bascula_t) ? '#9aa8c4' : '#2c4a8a'}"><title>${fFecha(j.fecha)}: ${fN(v, 1)} ${unidad()}${vacio(j.bascula_t) ? ' (contador, sin báscula)' : ''}</title></rect>`; });
    if (esAsfalto() && vals.length) {
      for (let i = 0; i <= 4; i++) { const v = cMin + (cMax - cMin) * i / 4; g += `<text x="${W - R + 6}" y="${yc(v) + 4}" font-size="10.5" fill="#6b7487">${fN(v, 1)}%</text>`; }
      const pts = caps.map((v, i) => v === null ? null : [L + i * bw + bw / 2, yc(v), v, js[i]]).filter(Boolean);
      if (pts.length > 1) g += `<polyline points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}" fill="none" stroke="#e8640a" stroke-width="2"/>`;
      pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#e8640a" stroke="#fff"><title>${fFecha(p[3].fecha)}: ${fN(p[2], 2)} %</title></circle>`);
    }
    const paso = Math.ceil(n / 10);
    js.forEach((j, i) => { if (i % paso === 0 || i === n - 1) g += `<text x="${L + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="#4a5568">${fFecha(j.fecha).slice(0, 5)}</text>`; });
    return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Producción diaria">${g}</svg>`;
  }
  function graficoCausas(porCausa) {
    const d = Object.entries(porCausa).sort((a, b) => b[1] - a[1]);
    if (!d.length) return '<p class="nota">Sin paradas cerradas en el período.</p>';
    const W = 420, L = 140, R = 90, fila = 28, H = d.length * fila + 6, max = d[0][1], tot = d.reduce((s, x) => s + x[1], 0);
    return `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas de parada por causa">${d.map(([c, h], i) => {
      const w = (W - L - R) * h / max, yy = i * fila + 3;
      return `<text x="${L - 8}" y="${yy + 16}" text-anchor="end" font-size="12" fill="#1a2744">${esc(c.length > 20 ? c.slice(0, 19) + '…' : c)}</text><rect x="${L}" y="${yy + 4}" width="${Math.max(2, w)}" height="17" rx="3" fill="${i === 0 ? '#c0392b' : '#8e9cbb'}"/><text x="${L + w + 6}" y="${yy + 16}" font-size="12" font-weight="600" fill="#4a5568">${fN(h, 1)} h · ${fN(h / tot * 100)}%</text>`;
    }).join('')}</svg>`;
  }

  // ═════════════════════════════ COSTOS (fase 2)
  // Costo por tonelada del período =
  //   materiales: CAP medido (reglas) × precio + áridos/filler según la dosificación de la fórmula × precio × (1 + desperdicio)
  //   energía: fuel del secadero y gasoil de la caldera (todas las mediciones, también días sin producción) × precio
  //   equipos: horas del parte diario de las máquinas de la planta (en la obra de la planta) × tarifa del maestro
  //   planta: amortización = tarifa de la planta × toneladas (sin tarifa propia: la del maestro de tarifas)
  //   fijos: costo fijo mensual × días del período / 30
  const ISO = (fecha, fin) => new Date(fecha + (fin ? 'T23:59:59' : 'T00:00:00')).toISOString();
  function precioVigente(precios, filtro, hasta) {
    return precios.filter(filtro).filter(p => !p.desde || p.desde <= hasta).sort((a, b) => (b.desde || '').localeCompare(a.desde || ''))[0] || null;
  }
  async function pintarCostos() {
    const el = $('#v-costos');
    if (!S.costos) { const h = new Date(); S.costos = { hasta: isoLocal(h), desde: isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)) }; }
    const P = S.costos;
    el.innerHTML = `<div class="barra"><label class="nota">Desde <input type="date" id="cs-desde" value="${P.desde}"></label>
      <label class="nota">Hasta <input type="date" id="cs-hasta" value="${P.hasta}"></label>
      <div class="seg" id="cs-rapido"><button type="button" data-r="mes">Este mes</button><button type="button" data-r="ant">Mes anterior</button><button type="button" data-r="90">90 días</button></div></div>
      <div id="cs-cuerpo"><div class="vacio">Calculando…</div></div>`;
    $('#cs-desde').onchange = () => { P.desde = $('#cs-desde').value; pintarCostos(); };
    $('#cs-hasta').onchange = () => { P.hasta = $('#cs-hasta').value; pintarCostos(); };
    $$('#cs-rapido button').forEach(b => b.onclick = () => {
      const h = new Date(); let de, ha = h;
      if (b.dataset.r === '90') de = new Date(Date.now() - 89 * 86400000);
      else if (b.dataset.r === 'mes') de = new Date(h.getFullYear(), h.getMonth(), 1);
      else { de = new Date(h.getFullYear(), h.getMonth() - 1, 1); ha = new Date(h.getFullYear(), h.getMonth(), 0); }
      P.desde = isoLocal(de); P.hasta = isoLocal(ha); pintarCostos();
    });
    let js, ls, rs, precios, eqs, tarMaestro;
    try {
      const margen = new Date(new Date(P.desde + 'T00:00:00').getTime() - 4 * 86400000).toISOString();
      const [a, b, c, d, e, g] = await Promise.all([
        sb.from('v_powerbi_plantas_jornadas').select('*').eq('planta_id', S.planta).gte('fecha', P.desde).lte('fecha', P.hasta).order('fecha'),
        sb.from('planta_lecturas').select('id,hora,valores,jornada_id,tipo').eq('planta_id', S.planta).gte('hora', margen).lte('hora', ISO(P.hasta, true)).order('hora').limit(10000),
        sb.from('planta_recargas').select('*').eq('planta_id', S.planta).gte('fecha_hora', margen).lte('fecha_hora', ISO(P.hasta, true)),
        sb.from('planta_precios').select('*').eq('planta_id', S.planta),
        sb.rpc('planta_costo_equipos', { p_planta: S.planta, p_desde: P.desde, p_hasta: P.hasta }),
        sb.rpc('planta_tarifa_maestro', { p_planta: S.planta }),
      ]);
      for (const r of [a, b, c, d]) if (r.error) throw r.error;
      js = a.data || []; ls = b.data || []; rs = c.data || []; precios = d.data || []; eqs = e.error ? [] : (e.data || []); tarMaestro = g.error ? null : g.data;
      if (e.error && /planta_costo_equipos|function/i.test(errMsg(e.error))) throw new Error('Falta correr en Supabase el SQL 93_plantas_costos.sql');
    } catch (er) { $('#cs-cuerpo').innerHTML = `<div class="card vacio">${esRed(er) ? 'Los costos necesitan señal.' : esc(errMsg(er))}</div>`; return; }
    const c = calcularCostos({ js, ls, rs, precios, eqs, tarMaestro, desde: P.desde, hasta: P.hasta });
    $('#cs-cuerpo').innerHTML = vistaCostos(c);
  }
  function calcularCostos({ js, ls, rs, precios, eqs, tarMaestro, desde, hasta }) {
    const pl = cfg().planta || {}, k = pl.config || {};
    const tc = Number(k.tc) || null, desp = vacio(k.desp_aridos) ? 5 : Number(k.desp_aridos);
    const u = unidad();
    const avisos = [];
    const gs = (p) => !p ? null : p.moneda === 'USD' ? (tc ? Number(p.precio) * tc : null) : Number(p.precio);
    const prodDe = (j) => !vacio(j.bascula_t) ? Number(j.bascula_t) : Number(j.pesadas_t) > 0 ? Number(j.pesadas_t) : (!vacio(j.contador_t) ? Number(j.contador_t) : 0);
    const prod = js.reduce((s, j) => s + prodDe(j), 0);
    const lineas = [];
    const linea = (grupo, concepto, cant, um, precioGs, nota) => lineas.push({ grupo, concepto, cant, um, precio: precioGs, total: precioGs === null || cant === null ? null : cant * precioGs, nota });
    // consumo de tanques en el período (todas las lecturas, con y sin jornada)
    const dIni = ISO(desde), dFin = ISO(hasta, true);
    const porInsumo = {};
    for (const t of cfg().tanques.filter(x => x.activo !== false)) {
      const ce0 = consumoEntre(ls, t, rs).filter(x => x.hasta >= dIni && x.hasta <= dFin);
      if (!ce0.length) continue;
      // si el tanque sube sin recarga cargada, ese tramo no se puede medir: queda afuera y se avisa
      const subas = ce0.filter(x => x.litros < -50);
      if (subas.length) avisos.push(`${t.nombre}: ${subas.length} vez/veces subió sin recarga cargada (${fN(-subas.reduce((s2, x) => s2 + x.litros, 0))} L). Cargá esas recargas en «Recargas»: mientras tanto esos tramos no cuentan y el consumo sale de menos.`);
      const ce = ce0.filter(x => x.litros >= -50);
      const litros = ce.reduce((s, x) => s + x.litros, 0);
      const it = porInsumo[t.insumo] || (porInsumo[t.insumo] = { litros: 0, t: 0, tanques: [] });
      it.litros += litros; it.t += litros * (num(t.densidad) || 1) / 1000; it.tanques.push(t.nombre);
      if (t.insumo === 'cap' && !num(t.densidad)) avisos.push(`${t.nombre}: sin densidad cargada, se usa 1,00 t/m³`);
    }
    // materiales: CAP
    if (porInsumo.cap) {
      const p = precioVigente(precios, x => x.insumo === 'cap', hasta);
      if (!p) avisos.push('Falta el precio del CAP (Configuración › Precios)');
      else if (p.moneda === 'USD' && !tc) avisos.push('El precio del CAP está en USD: falta el tipo de cambio');
      linea('Materiales', 'CAP (medido en tanque)', porInsumo.cap.t, 't', gs(p), prod > 0 ? fN(porInsumo.cap.t / prod * 100, 2) + ' % de la mezcla' : '');
    }
    // materiales: dosificación de la fórmula
    const formulas = cfg().formulas;
    const comp = {};
    let sinFormula = 0;
    js.forEach(j => {
      let f = formulas.find(x => x.nombre === j.formula) || null;
      if (!f || !(f.componentes || []).length) { sinFormula += prodDe(j) > 0 ? 1 : 0; f = formulas.find(x => x.activo !== false && (x.componentes || []).length) || null; }
      if (!f) return;
      (f.componentes || []).forEach(cp => {
        const key = (cp.nombre || '') + '|' + (cp.precio_id || '');
        const o = comp[key] || (comp[key] = { nombre: cp.nombre, precio_id: cp.precio_id, t: 0 });
        o.t += prodDe(j) * (Number(cp.pct) || 0) / 100 * (1 + desp / 100);
      });
    });
    if (sinFormula) avisos.push(`${sinFormula} jornada(s) sin fórmula con dosificación: se usó la primera fórmula activa`);
    if (!Object.keys(comp).length && prod > 0) avisos.push('Las fórmulas no tienen dosificación de áridos (Configuración › Fórmulas › Dosificación)');
    Object.values(comp).forEach(o => {
      const p = precios.find(x => String(x.id) === String(o.precio_id));
      if (!p) avisos.push(`${o.nombre}: sin precio asignado en la dosificación`);
      linea('Materiales', o.nombre + (desp ? ` (+${fN(desp, 0)} % desperdicio)` : ''), o.t, p ? p.unidad : 't', gs(p));
    });
    // energía
    [['fuel', 'Fuel / gasoil del secadero'], ['gasoil', 'Gasoil de la caldera']].forEach(([ins, nom]) => {
      if (!porInsumo[ins]) return;
      const p = precioVigente(precios, x => x.insumo === ins, hasta) || (ins === 'gasoil' ? precioVigente(precios, x => x.insumo === 'fuel', hasta) : null);
      if (!p) avisos.push(`Falta el precio de: ${nom}`);
      linea('Energía', nom, porInsumo[ins].litros, 'L', gs(p), prod > 0 ? fN(porInsumo[ins].litros / prod, 2) + ' L/' + u : '');
    });
    // equipos
    eqs.forEach(e => {
      if (Number(e.sin_tarifa) > 0) avisos.push(`${e.equipo_id}: ${e.sin_tarifa} parte(s) sin tarifa en el maestro`);
      if (Number(e.horas_fuera) > 0) avisos.push(`${e.equipo_id}: ${fN(e.horas_fuera, 1)} h en otras obras no se cargan a la planta`);
      if (!(Number(e.horas) > 0)) return;
      lineas.push({ grupo: 'Equipos', concepto: `${e.equipo_id} ${e.descripcion || ''}`.trim(), cant: Number(e.horas), um: 'HM', precio: Number(e.costo) / Number(e.horas), total: Number(e.costo),
        nota: `${e.partes} parte(s) · ${e.origen === 'fija' ? 'máquina fija de la planta' : 'parte en ' + (e.items || 'el centro de costo de la carpeta')}` });
    });
    if (!eqs.some(e => Number(e.horas) > 0)) avisos.push('Ninguna máquina cargó partes en el centro de costo de la carpeta / concreto asfáltico de la obra de la planta en el período');
    // planta: amortización
    let tar = num(pl.tarifa_planta), origen = 'de la planta';
    if (tar !== null && pl.tarifa_moneda === 'USD') { if (tc) tar = tar * tc; else { avisos.push('La tarifa de la planta está en USD: falta el tipo de cambio'); tar = null; } }
    if (tar === null && num(tarMaestro) !== null) { tar = Number(tarMaestro); origen = 'del maestro de tarifas'; }
    if (tar === null) avisos.push('Falta la tarifa de amortización de la planta');
    linea('Planta', `Amortización ${S.planta} (tarifa ${origen})`, prod, u, tar);
    // fijos
    const dias = Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1;
    if (num(pl.costo_fijo_mes)) linea('Planta', `Costo fijo mensual (personal y otros) × ${dias} días / 30`, dias / 30, 'mes', Number(pl.costo_fijo_mes));
    const total = lineas.reduce((s2, l) => s2 + (l.total || 0), 0);
    const grupos = {};
    lineas.forEach(l => { grupos[l.grupo] = (grupos[l.grupo] || 0) + (l.total || 0); });
    // por obra destino (para imputar)
    const porObra = {};
    js.forEach(j => { const o = j.obra || j.obra_clave || 'sin obra'; porObra[o] = (porObra[o] || 0) + prodDe(j); });
    return { prod, total, porT: prod > 0 ? total / prod : null, lineas, grupos, porObra, avisos, apu: num(k.apu_ref), dias, jornadas: js.length, u };
  }
  function vistaCostos(c) {
    const col = { Materiales: '#2c4a8a', Energía: '#e8640a', Equipos: '#8e9cbb', Planta: '#c3cbdb' };
    const pt = (v) => c.prod > 0 && v !== null ? v / c.prod : null;
    const barra = c.total > 0 ? `<div style="display:flex;height:26px;border-radius:7px;overflow:hidden;margin:6px 0">${Object.entries(c.grupos).filter(([, v]) => v > 0).map(([g, v]) =>
      `<div title="${esc(g)}: ${fN(v)} Gs" style="width:${v / c.total * 100}%;background:${col[g] || '#ccc'}"></div>`).join('')}</div>
      <div class="leyenda">${Object.entries(c.grupos).map(([g, v]) => `<span><i style="background:${col[g] || '#ccc'}"></i>${esc(g)} · ${fN(pt(v))} Gs/${c.u} · ${c.total ? fN(v / c.total * 100) : 0} %</span>`).join('')}</div>` : '';
    const vsApu = c.apu && c.porT ? (c.porT - c.apu) / c.apu * 100 : null;
    const orden = ['Materiales', 'Energía', 'Equipos', 'Planta'];
    const filas = orden.map(g => {
      const ls = c.lineas.filter(l => l.grupo === g); if (!ls.length) return '';
      return ls.map(l => `<tr><td class="l">${esc(g)}</td><td class="l">${esc(l.concepto)}${l.nota ? ` <span class="nota">· ${esc(l.nota)}</span>` : ''}</td><td>${fN(l.cant, l.um === 'HM' || l.um === 'mes' ? 2 : 1)}</td><td class="l">${esc(l.um)}</td>
        <td>${l.precio === null ? '<span class="chip mal">sin precio</span>' : fN(l.precio)}</td><td>${l.total === null ? '' : fN(l.total)}</td><td><b>${fN(pt(l.total))}</b></td><td>${c.total && l.total ? fN(l.total / c.total * 100, 1) : ''}</td></tr>`).join('')
        + `<tr style="background:#f5f7fa"><td class="l"><b>${esc(g)}</b></td><td class="l"></td><td></td><td></td><td></td><td><b>${fN(c.grupos[g])}</b></td><td><b>${fN(pt(c.grupos[g]))}</b></td><td><b>${c.total ? fN(c.grupos[g] / c.total * 100, 1) : ''}</b></td></tr>`;
    }).join('');
    return `<div class="kpis">
        <div class="kpi"><span class="k">Producción (báscula)</span><span class="v">${fN(c.prod)}<small>${c.u}</small></span><span class="s">${c.jornadas} jornada(s) · ${c.dias} días</span></div>
        <div class="kpi"><span class="k">Costo total</span><span class="v">${fN(c.total / 1e6, 1)}<small>M Gs</small></span></div>
        <div class="kpi ${vsApu !== null && vsApu > 0 ? 'alerta' : ''}"><span class="k">Costo por ${c.u}</span><span class="v">${fN(c.porT)}<small>Gs</small></span><span class="s">${c.apu ? 'referencia ' + fN(c.apu) + ' · ' + (vsApu > 0 ? '+' : '') + fN(vsApu, 1) + ' %' : 'sin referencia (APU) cargada'}</span></div>
        ${orden.filter(g => c.grupos[g]).map(g => `<div class="kpi"><span class="k">${esc(g)}</span><span class="v">${fN(pt(c.grupos[g]))}<small>Gs/${c.u}</small></span></div>`).join('')}
      </div>
      ${c.avisos.length ? `<div class="card" style="border-color:var(--amarillo-alerta);background:var(--ambar-suave)"><b>Para que el costo sea completo</b><ul style="margin:6px 0 0;padding-left:18px">${c.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      <div class="card"><h3>¿De qué está hecho el costo? <small>Gs por ${c.u}</small></h3>${barra}</div>
      <div class="card"><h3>Detalle <small>cantidades del período × precio</small></h3><div class="tw"><table class="t"><thead><tr><th class="l">Grupo</th><th class="l">Concepto</th><th>Cantidad</th><th class="l">UM</th><th>Precio Gs</th><th>Total Gs</th><th>Gs/${c.u}</th><th>%</th></tr></thead>
        <tbody>${filas}</tbody><tfoot><tr><td class="l"><b>Total</b></td><td></td><td></td><td></td><td></td><td><b>${fN(c.total)}</b></td><td><b>${fN(c.porT)}</b></td><td>100</td></tr></tfoot></table></div>
        <p class="nota">CAP, fuel y gasoil: consumo medido con las reglas de los tanques (también los días sin producción) más recargas. Áridos y filler: producción × dosificación de la fórmula. Equipos: horas del parte diario de las palas y grupos en el centro de costo de la carpeta de la obra de la planta (y las máquinas fijas) × tarifa del maestro, que ya incluye combustible y operador. Los precios en USD se pasan con el tipo de cambio de Configuración. Es el costo de producción en planta (sin flete ni colocación).</p></div>
      <div class="card"><h3>Por obra destino <small>para imputar el costo</small></h3><div class="tw"><table class="t"><tr><th class="l">Obra</th><th>${c.u}</th><th>%</th><th>Costo Gs</th></tr>
        ${Object.entries(c.porObra).sort((a, b) => b[1] - a[1]).map(([o, t]) => `<tr><td class="l">${esc(o)}</td><td>${fN(t, 1)}</td><td>${c.prod ? fN(t / c.prod * 100, 1) : ''}</td><td>${c.porT ? fN(t * c.porT) : ''}</td></tr>`).join('')}</table></div></div>`;
  }

  // ═════════════════════════════ CONFIGURACIÓN (admin central)
  async function pintarConfig() {
    const el = $('#v-config');
    try { await cargarCfg(S.planta, true); } catch (e) { el.innerHTML = `<div class="card vacio">${esc(errMsg(e))}</div>`; return; }
    const c = cfg(), p = c.planta, k = p.config || {};
    let operadores = [];
    try { const r = await sb.from('operadores').select('cedula,nombre,especialidad,activo').order('nombre'); operadores = r.data || []; } catch (e) {}
    const nomOp = (ced) => (operadores.find(o => o.cedula === ced) || {}).nombre || ced;
    let precios = [], eqsPl = [], equiposTodos = [], tarMaestro = null;
    try {
      const [a, b, e, t] = await Promise.all([
        sb.from('planta_precios').select('*').eq('planta_id', p.id).order('insumo').order('desde', { ascending: false }),
        sb.from('planta_equipos').select('*').eq('planta_id', p.id),
        sb.from('equipos').select('id,descripcion,activo').eq('activo', true).order('id'),
        sb.rpc('planta_tarifa_maestro', { p_planta: p.id }),
      ]);
      precios = a.data || []; eqsPl = b.data || []; equiposTodos = e.data || []; tarMaestro = t.error ? null : t.data;
      S.cfgSql93 = !a.error;
    } catch (e) { S.cfgSql93 = false; }
    S.cfgPrecios = precios;
    let usuarios = [];
    try { const ru = await sb.rpc('planta_usuarios', { p_planta: p.id }); usuarios = ru.error ? [] : (ru.data || []); } catch (e) {}
    const usuarioDe = (x) => usuarios.find(u => u.id === x.usuario_id) || usuarios.find(u => u.cedula === x.cedula) || null;
    const selUsuario = (x) => {
      const u = usuarioDe(x), porCed = usuarios.find(v => v.cedula === x.cedula);
      return `<select data-perusr="${esc(x.cedula)}" style="max-width:230px"><option value="">${porCed ? '(por cédula) ' + esc(porCed.nombre) : '— sin usuario —'}</option>${usuarios.map(v => `<option value="${v.id}" ${x.usuario_id === v.id ? 'selected' : ''}>${esc(v.nombre || '')} · ${esc(v.correo || v.cedula || '')}</option>`).join('')}</select>${u ? '' : ' <span class="chip mal">no puede entrar</span>'}`;
    };
    el.innerHTML = `
      <div class="card"><h3>Planta ${esc(p.id)} <small>${esc(p.tipo || '')}</small></h3><div class="campos">
        <label>Nombre<input id="cf-nombre" value="${esc(p.nombre || '')}"></label>
        <label>Caudal nominal (${unidad()}/h)<input id="cf-caudal" inputmode="decimal" value="${vacio(p.caudal_nominal) ? '' : String(p.caudal_nominal).replace('.', ',')}"></label>
        <label>Tarifa de la planta (amortización) por ${unidad()}<input id="cf-tarifa" inputmode="decimal" value="${vacio(p.tarifa_planta) ? '' : String(p.tarifa_planta).replace('.', ',')}" placeholder="${tarMaestro ? 'vacío = maestro ' + fN(tarMaestro) + ' Gs' : ''}"></label>
        <label>Moneda de la tarifa<select id="cf-mon"><option ${p.tarifa_moneda === 'USD' ? 'selected' : ''}>USD</option><option ${p.tarifa_moneda === 'Gs' ? 'selected' : ''}>Gs</option></select></label>
        <label>Tipo de cambio (Gs por USD)<input id="cf-tc" inputmode="decimal" value="${vacio(k.tc) ? '' : String(k.tc).replace('.', ',')}" placeholder="ej. 7.350"></label>
        <label>Costo fijo mensual Gs (personal de planta, otros)<input id="cf-fijo" inputmode="decimal" value="${vacio(p.costo_fijo_mes) ? '' : String(p.costo_fijo_mes)}"></label>
        <label>Desperdicio de áridos (%)<input id="cf-desp" inputmode="decimal" value="${String(k.desp_aridos ?? 5).replace('.', ',')}"></label>
        <label>Costo de referencia APU (Gs/${unidad()})<input id="cf-apu" inputmode="decimal" value="${vacio(k.apu_ref) ? '' : String(k.apu_ref)}"></label>
        <label>Máquinas que cuentan (familias)<input id="cf-fam" value="${esc((k.familias_equipos || ['PC', 'RP', 'GG']).join(', '))}"></label>
        <label class="ancho">Centro de costo de la planta: el ítem del parte contiene (separado por coma)<input id="cf-ccp" value="${esc((k.cc_palabras || ['carpeta', 'concreto asf', 'cª aª', 'mezcla asf']).join(', '))}"></label>
        ${p.tipo === 'asfalto' ? `<label>Tolerancia de CAP (± puntos %)<input id="cf-tol" inputmode="decimal" value="${String(k.tol_cap ?? 0.2).replace('.', ',')}"></label>
        <label>Fuel máximo (L/t)<input id="cf-lt" inputmode="decimal" value="${String(k.lt_max ?? 7).replace('.', ',')}"></label>` : ''}
        <label>Lectura cada (min)<input id="cf-cada" inputmode="numeric" value="${k.lectura_min ?? 60}"></label>
        <label>Avisar si no llega lectura en (min)<input id="cf-alerta" inputmode="numeric" value="${k.alerta_sin_lectura_min ?? 90}"></label>
        <label class="ancho">Causas de parada (separadas por coma)<input id="cf-causas" value="${esc((k.causas || CAUSAS).join(', '))}"></label>
      </div><div style="margin-top:10px"><button class="btn azul" type="button" id="cf-gplanta">Guardar planta</button></div></div>

      <div class="card"><h3>Tanques y aforo <small>la regla se carga en metros</small></h3><div class="tw"><table class="t" id="cf-tq"><thead><tr>
        <th class="l">Nombre</th><th class="l">Insumo</th><th class="l">Regla</th><th class="l">Forma</th><th>Ø (m)</th><th>Largo (m)</th><th>Altura (m)</th><th>Densidad (t/m³)</th><th>Capacidad</th><th>Activo</th><th></th></tr></thead><tbody>
        ${c.tanques.map(t => filaTanque(t)).join('')}</tbody></table></div>
        <div class="botones" style="margin-top:10px"><button class="btn" type="button" id="cf-tqmas">+ Tanque</button><button class="btn azul" type="button" id="cf-gtq">Guardar tanques</button></div>
        <p class="nota">Cilindro acostado: Ø y largo (misma fórmula que la planilla cilindro_vol). Cilindro parado: Ø y altura. Tabla: pegá las columnas altura | litros del Excel con «Tabla». Densidad: la de referencia para pasar el CAP a toneladas.</p></div>

      ${S.cfgSql93 ? `<div class="card"><h3>Precios de insumos <small>para el costo por ${unidad()} · vale el último vigente a la fecha</small></h3><div class="tw"><table class="t" id="cf-pr"><thead><tr>
        <th class="l">Insumo</th><th class="l">Nombre</th><th class="l">UM</th><th>Precio</th><th class="l">Moneda</th><th class="l">Desde</th><th class="l">Recurso (maestro)</th><th></th></tr></thead><tbody>
        ${precios.map(x => filaPrecio(x)).join('')}</tbody></table></div>
        <div class="botones" style="margin-top:10px"><button class="btn" type="button" id="cf-prmas">+ Precio</button><button class="btn azul" type="button" id="cf-gpr">Guardar precios</button></div>
        <p class="nota">Para cambiar un precio sin perder el anterior, agregá otro renglón con la fecha nueva. CAP en t, fuel y gasoil en L, áridos en t. «Maestro»: trae el precio sin IVA del recurso en una obra.</p></div>

      <div class="card"><h3>Máquinas fijas de la planta <small>además de las que cargan su parte en el centro de costo de la carpeta</small></h3>
        <div class="tw"><table class="t"><tr><th class="l">Equipo</th><th class="l">Descripción</th><th></th></tr>
        ${eqsPl.map(x => `<tr><td class="l">${esc(x.equipo_id)}</td><td class="l">${esc((equiposTodos.find(e => e.id === x.equipo_id) || {}).descripcion || '')}</td><td><button class="x" data-eqbor="${esc(x.equipo_id)}" title="Quitar" aria-label="Quitar">✕</button></td></tr>`).join('') || '<tr><td class="l" colspan="3">Ninguno todavía.</td></tr>'}</table></div>
        <div class="campos" style="margin-top:10px"><label class="ancho">Agregar equipo<input list="cf-eqs" id="cf-eqn" placeholder="Ej.: PC-04, GG-02"></label>
        <datalist id="cf-eqs">${equiposTodos.map(e => `<option value="${esc(e.id)}">${esc(e.descripcion || '')}</option>`).join('')}</datalist></div>
        <div class="botones" style="margin-top:10px"><button class="btn azul" type="button" id="cf-eqagr">Agregar</button></div>
        <p class="nota">El costo de equipos toma solo: las palas (PC, RP) y grupos (GG) que cargan su parte en el centro de costo de la carpeta / concreto asfáltico de la obra de la planta, más las máquinas fijas de esta lista. Horas del parte × tarifa del maestro (ya incluye combustible y operador). Camiones, terminadora y compactadores de pista no cuentan.</p></div>` : '<div class="card nota">Para los costos falta correr el SQL <b>93_plantas_costos.sql</b>.</div>'}

      <div class="card"><h3>Fórmulas <small>la que elige el operador al arrancar · Dosificación: áridos y filler para el costo</small></h3><div class="tw"><table class="t" id="cf-fo"><thead><tr><th class="l">Nombre</th><th>% CAP</th><th>Tolerancia ±</th><th class="l">Notas</th><th>Activa</th><th></th></tr></thead><tbody>
        ${c.formulas.map(f => filaFormula(f)).join('')}</tbody></table></div>
        <div class="botones" style="margin-top:10px"><button class="btn" type="button" id="cf-fomas">+ Fórmula</button><button class="btn azul" type="button" id="cf-gfo">Guardar fórmulas</button></div></div>

      <div class="card"><h3>Personal de la planta <small>el encargado corrige y cierra; los operadores cargan el parte; báscula carga los tickets</small></h3>
        <div class="tw"><table class="t"><tr><th class="l">Persona</th><th class="l">Cédula</th><th class="l">Usuario de la app</th><th class="l">Rol</th><th>Activo</th><th></th></tr>
        ${c.personal.map(x => `<tr><td class="l">${esc(nomOp(x.cedula))}</td><td class="l">${esc(x.cedula)}</td><td class="l">${usuarios.length ? selUsuario(x) : ''}</td>
          <td class="l"><select data-perrol="${esc(x.cedula)}"><option value="encargado" ${x.rol === 'encargado' ? 'selected' : ''}>Encargado</option><option value="operador" ${x.rol === 'operador' ? 'selected' : ''}>Operador</option><option value="bascula" ${x.rol === 'bascula' ? 'selected' : ''}>Báscula</option></select></td>
          <td><input type="checkbox" data-peract="${esc(x.cedula)}" ${x.activo !== false ? 'checked' : ''} aria-label="Activo"></td>
          <td><button class="x" data-perbor="${esc(x.cedula)}" title="Quitar" aria-label="Quitar">✕</button></td></tr>`).join('') || '<tr><td class="l" colspan="6">Nadie asignado todavía.</td></tr>'}</table></div>
        <div class="campos" style="margin-top:10px"><label class="ancho">Agregar persona (del personal de Flota)<input list="cf-ops" id="cf-pnueva" placeholder="Buscar por nombre o cédula"></label>
          <datalist id="cf-ops">${operadores.filter(o => o.activo !== false).map(o => `<option value="${esc(o.cedula)} · ${esc(o.nombre)}">${esc(o.especialidad || '')}</option>`).join('')}</datalist>
          <label>Rol<select id="cf-prol"><option value="operador">Operador</option><option value="encargado">Encargado</option><option value="bascula">Báscula</option></select></label></div>
        <div class="botones" style="margin-top:10px"><button class="btn azul" type="button" id="cf-pagr">Agregar</button></div>
        <p class="nota">La persona entra con su usuario de siempre. Si entra con correo (ej. diegoflores@tecsul.com.py), elegí su usuario en «Usuario de la app»; si entra con cédula se vincula sola. El encargado ve y configura todo de la planta (costos incluidos); los operadores cargan el parte; báscula carga los tickets.</p></div>`;
    bindConfig();
  }
  function filaTanque(t) {
    const v = (x) => vacio(x) ? '' : String(x).replace('.', ',');
    const cap = capacidad(t);
    return `<tr data-tq="${t.id || ''}" data-nuevo="${t.id ? '' : '1'}">
      <td class="l"><input data-k="nombre" value="${esc(t.nombre || '')}" style="max-width:160px"></td>
      <td class="l"><select data-k="insumo">${Object.entries(INSUMOS).map(([k, n]) => `<option value="${k}" ${t.insumo === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td class="l"><select data-k="modo_lectura"><option value="libre" ${t.modo_lectura === 'libre' ? 'selected' : ''}>libre</option><option value="stock" ${t.modo_lectura !== 'libre' ? 'selected' : ''}>stock</option></select></td>
      <td class="l"><select data-k="forma">${Object.entries(FORMAS).map(([k, n]) => `<option value="${k}" ${t.forma === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><input class="n" data-k="diametro_m" inputmode="decimal" value="${v(t.diametro_m)}"></td>
      <td><input class="n" data-k="largo_m" inputmode="decimal" value="${v(t.largo_m)}"></td>
      <td><input class="n" data-k="altura_m" inputmode="decimal" value="${v(t.altura_m)}"></td>
      <td><input class="n" data-k="densidad" inputmode="decimal" value="${v(t.densidad)}"></td>
      <td data-cap>${cap ? fN(cap) + ' L' : '<span class="chip ojo">falta</span>'}</td>
      <td><input type="checkbox" data-k="activo" ${t.activo !== false ? 'checked' : ''} aria-label="Activo"></td>
      <td><button class="btn chico" type="button" data-tabla>Tabla${tablaDe(t).length ? ' (' + tablaDe(t).length + ')' : ''}</button> <button class="btn chico" type="button" data-probar>Probar</button></td></tr>`;
  }
  function filaFormula(f) {
    return `<tr data-fo="${f.id || ''}"><td class="l"><input data-k="nombre" value="${esc(f.nombre || '')}" style="max-width:200px"></td>
      <td><input class="n" data-k="pct_cap" inputmode="decimal" value="${vacio(f.pct_cap) ? '' : String(f.pct_cap).replace('.', ',')}"></td>
      <td><input class="n" data-k="tol_cap" inputmode="decimal" value="${vacio(f.tol_cap) ? '' : String(f.tol_cap).replace('.', ',')}" placeholder="planta"></td>
      <td class="l"><input data-k="notas" value="${esc(f.notas || '')}" style="max-width:260px"></td>
      <td><input type="checkbox" data-k="activo" ${f.activo !== false ? 'checked' : ''} aria-label="Activa"></td>
      <td>${S.cfgSql93 && f.id ? `<button class="btn chico" type="button" data-dosif="${f.id}">Dosificación${(f.componentes || []).length ? ' (' + f.componentes.length + ')' : ''}</button>` : ''}</td></tr>`;
  }
  const INS_PRECIO = { cap: 'CAP', arido: 'Árido', filler: 'Filler / cal', fuel: 'Fuel / gasoil secadero', gasoil: 'Gasoil caldera', cemento: 'Cemento', aditivo: 'Aditivo', agua: 'Agua', otro: 'Otro' };
  function filaPrecio(x) {
    return `<tr data-pr="${x.id || ''}"><td class="l"><select data-k="insumo">${Object.entries(INS_PRECIO).map(([k2, n2]) => `<option value="${k2}" ${x.insumo === k2 ? 'selected' : ''}>${n2}</option>`).join('')}</select></td>
      <td class="l"><input data-k="nombre" value="${esc(x.nombre || '')}" style="max-width:170px" placeholder="Ej.: Triturada 6ª"></td>
      <td class="l"><select data-k="unidad">${['t', 'L', 'm3', 'kg'].map(m => `<option ${x.unidad === m ? 'selected' : ''}>${m}</option>`).join('')}</select></td>
      <td><input class="n" data-k="precio" inputmode="decimal" value="${vacio(x.precio) ? '' : String(x.precio).replace('.', ',')}" style="width:110px"></td>
      <td class="l"><select data-k="moneda"><option ${x.moneda !== 'USD' ? 'selected' : ''}>Gs</option><option ${x.moneda === 'USD' ? 'selected' : ''}>USD</option></select></td>
      <td class="l"><input type="date" data-k="desde" value="${x.desde || hoyISO()}"></td>
      <td class="l"><input data-k="recurso_id" value="${esc(x.recurso_id || '')}" style="max-width:110px" placeholder="opcional"></td>
      <td><button class="btn chico" type="button" data-prmae>Maestro</button> ${x.id ? `<button class="x" data-prbor="${x.id}" title="Eliminar" aria-label="Eliminar precio">✕</button>` : ''}</td></tr>`;
  }
  function editarDosificacion(f) {
    const precios = (S.cfgPrecios || []).filter(p => ['arido', 'filler', 'cemento', 'aditivo', 'otro'].includes(p.insumo));
    const filas = (f.componentes || []).slice();
    const fila = (cp) => `<tr><td class="l"><input data-c="nombre" value="${esc(cp.nombre || '')}" placeholder="Triturada 6ª" style="max-width:170px"></td>
      <td><input class="n" data-c="pct" inputmode="decimal" value="${vacio(cp.pct) ? '' : String(cp.pct).replace('.', ',')}" style="width:80px"></td>
      <td class="l"><select data-c="precio_id"><option value="">— precio —</option>${precios.map(p => `<option value="${p.id}" ${String(p.id) === String(cp.precio_id) ? 'selected' : ''}>${esc(p.nombre)} · ${fN(p.precio)} ${p.moneda}/${p.unidad}</option>`).join('')}</select></td>
      <td><button class="x" type="button" data-cbor title="Quitar" aria-label="Quitar">✕</button></td></tr>`;
    modal('Dosificación · ' + f.nombre, `<p class="nota">% de cada material sobre el peso total de la mezcla (como la planilla Consumo PA01: 6ª 40,15 % · 5ª 16,66 % · 4ª 30,59 % · arena 7,21 % · cal 0,99 %). El CAP no va acá: se toma el medido en el tanque.</p>
      <div class="tw"><table class="t" id="ds-t"><thead><tr><th class="l">Material</th><th>% mezcla</th><th class="l">Precio</th><th></th></tr></thead><tbody id="ds-b">${filas.map(fila).join('')}</tbody></table></div>
      <div class="botones"><button class="btn" type="button" id="ds-mas">+ Material</button></div><p class="nota" id="ds-suma"></p>`,
      `<button class="btn azul" type="button" id="ds-ok">Guardar dosificación</button>`, true);
    const suma = () => { const t = $$('#ds-t [data-c="pct"]').reduce((s2, i) => s2 + (pNum(i.value) || 0), 0); $('#ds-suma').textContent = `Suma de materiales: ${fN(t, 2)} %${!vacio(f.pct_cap) ? ' + CAP ' + fN(f.pct_cap, 2) + ' % = ' + fN(t + Number(f.pct_cap), 2) + ' %' : ''}`; };
    const bindF = () => { $$('#ds-t [data-cbor]').forEach(b => b.onclick = () => { b.closest('tr').remove(); suma(); }); $$('#ds-t input').forEach(i => i.oninput = suma); };
    $('#ds-mas').onclick = () => { $('#ds-b').insertAdjacentHTML('beforeend', fila({})); bindF(); };
    bindF(); suma();
    $('#ds-ok').onclick = async () => {
      const comps = $$('#ds-b tr').map(tr => ({ nombre: tr.querySelector('[data-c="nombre"]').value.trim(), pct: pNum(tr.querySelector('[data-c="pct"]').value), precio_id: tr.querySelector('[data-c="precio_id"]').value ? Number(tr.querySelector('[data-c="precio_id"]').value) : null })).filter(x => x.nombre && x.pct > 0);
      const r = await sb.from('planta_formulas').update({ componentes: comps, actualizado_en: new Date().toISOString() }).eq('id', f.id);
      if (r.error) return toast(errMsg(r.error), 'error');
      cerrarModal(); toast('Dosificación guardada', 'ok'); pintarConfig();
    };
  }
  function leerFila(tr) {
    const o = {};
    $$('[data-k]', tr).forEach(i => {
      const k = i.dataset.k;
      if (i.type === 'checkbox') o[k] = i.checked;
      else if (i.classList.contains('n')) { const n = pNum(i.value); o[k] = n === null || isNaN(n) ? null : n; }
      else o[k] = i.value.trim();
    });
    return o;
  }
  function bindConfig() {
    const p = cfg().planta;
    const tablas = {}; cfg().tanques.forEach(t => { tablas[t.id] = t.tabla || null; });
    $('#cf-gplanta').onclick = async () => {
      const k = Object.assign({}, p.config || {});
      const n = (s) => { const v = pNum($(s) ? $(s).value : ''); return v === null || isNaN(v) ? null : v; };
      if ($('#cf-tol')) k.tol_cap = n('#cf-tol') ?? 0.2;
      k.tc = n('#cf-tc'); k.desp_aridos = n('#cf-desp') ?? 5; k.apu_ref = n('#cf-apu');
      if ($('#cf-fam')) { const fa = $('#cf-fam').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean); if (fa.length) k.familias_equipos = fa; }
      if ($('#cf-ccp')) { const cp = $('#cf-ccp').value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean); if (cp.length) k.cc_palabras = cp; }
      if ($('#cf-lt')) k.lt_max = n('#cf-lt') ?? 7;
      k.lectura_min = n('#cf-cada') ?? 60; k.alerta_sin_lectura_min = n('#cf-alerta') ?? 90;
      const cs = $('#cf-causas').value.split(',').map(s => s.trim()).filter(Boolean); k.causas = cs.length ? cs : CAUSAS;
      const r = await sb.from('plantas').update({ nombre: $('#cf-nombre').value.trim() || null, caudal_nominal: n('#cf-caudal'), tarifa_planta: n('#cf-tarifa'), tarifa_moneda: $('#cf-mon').value, costo_fijo_mes: n('#cf-fijo'), config: k, actualizado_en: new Date().toISOString() }).eq('id', p.id);
      if (r.error) return toast(errMsg(r.error), 'error');
      toast('Planta guardada', 'ok'); pintarConfig();
    };
    const recalc = (tr) => {
      const o = leerFila(tr); o.tabla = tablas[tr.dataset.tq] || null;
      const cap = capacidad(o); tr.querySelector('[data-cap]').innerHTML = cap ? fN(cap) + ' L' : '<span class="chip ojo">falta</span>';
    };
    const bindFilaTq = (tr) => {
      $$('input,select', tr).forEach(i => i.addEventListener('input', () => recalc(tr)));
      tr.querySelector('[data-tabla]').onclick = () => editarTabla(tr, tablas, recalc);
      tr.querySelector('[data-probar]').onclick = () => { const o = leerFila(tr); o.tabla = tablas[tr.dataset.tq] || null; probarAforo(o); };
    };
    $$('#cf-tq tbody tr').forEach(bindFilaTq);
    $('#cf-tqmas').onclick = () => {
      const tmp = 'n' + Date.now();
      $('#cf-tq tbody').insertAdjacentHTML('beforeend', filaTanque({ nombre: '', insumo: 'otro', modo_lectura: 'stock', forma: 'cilindro_h', activo: true }).replace('data-tq=""', `data-tq="${tmp}"`));
      bindFilaTq($('#cf-tq tbody tr:last-child'));
    };
    $('#cf-gtq').onclick = async () => {
      const filas = $$('#cf-tq tbody tr').map((tr, i) => {
        const o = leerFila(tr); o.planta_id = p.id; o.orden = i + 1; o.tabla = tablas[tr.dataset.tq] || null; o.actualizado_en = new Date().toISOString();
        if (!tr.dataset.nuevo) o.id = Number(tr.dataset.tq);
        return o;
      }).filter(o => o.nombre);
      for (const o of filas) {
        const r = o.id ? await sb.from('planta_tanques').update(o).eq('id', o.id) : await sb.from('planta_tanques').insert(o);
        if (r.error) return toast(o.nombre + ': ' + errMsg(r.error), 'error');
      }
      toast('Tanques guardados', 'ok'); pintarConfig();
    };
    $('#cf-fomas').onclick = () => { $('#cf-fo tbody').insertAdjacentHTML('beforeend', filaFormula({ activo: true })); };
    $('#cf-gfo').onclick = async () => {
      for (const tr of $$('#cf-fo tbody tr')) {
        const o = leerFila(tr); if (!o.nombre) continue;
        o.planta_id = p.id; o.actualizado_en = new Date().toISOString();
        const r = tr.dataset.fo ? await sb.from('planta_formulas').update(o).eq('id', Number(tr.dataset.fo)) : await sb.from('planta_formulas').insert(o);
        if (r.error) return toast(o.nombre + ': ' + errMsg(r.error), 'error');
      }
      toast('Fórmulas guardadas', 'ok'); pintarConfig();
    };
    $$('[data-dosif]').forEach(b => b.onclick = () => editarDosificacion(cfg().formulas.find(f => String(f.id) === b.dataset.dosif)));
    if ($('#cf-prmas')) {
      const bindPr = (tr) => { const m = tr.querySelector('[data-prmae]'); if (m) m.onclick = () => traerMaestro(tr); };
      $$('#cf-pr tbody tr').forEach(bindPr);
      $('#cf-prmas').onclick = () => { $('#cf-pr tbody').insertAdjacentHTML('beforeend', filaPrecio({ insumo: 'arido', unidad: 't', moneda: 'Gs' })); bindPr($('#cf-pr tbody tr:last-child')); };
      $('#cf-gpr').onclick = async () => {
        for (const tr of $$('#cf-pr tbody tr')) {
          const o = leerFila(tr); if (!o.nombre || o.precio === null) continue;
          o.planta_id = p.id; o.recurso_id = o.recurso_id || null; o.desde = o.desde || hoyISO(); o.actualizado_en = new Date().toISOString();
          const r = tr.dataset.pr ? await sb.from('planta_precios').update(o).eq('id', Number(tr.dataset.pr)) : await sb.from('planta_precios').insert(o);
          if (r.error) return toast(o.nombre + ': ' + errMsg(r.error), 'error');
        }
        toast('Precios guardados', 'ok'); pintarConfig();
      };
      $$('[data-prbor]').forEach(b => b.onclick = async () => {
        if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Eliminar?'; return; }
        const r = await sb.from('planta_precios').delete().eq('id', Number(b.dataset.prbor)); if (r.error) return toast(errMsg(r.error), 'error'); pintarConfig();
      });
      $('#cf-eqagr').onclick = async () => {
        const id = $('#cf-eqn').value.trim().toUpperCase(); if (!id) return toast('Escribí el código del equipo', 'error');
        const r = await sb.from('planta_equipos').upsert({ planta_id: p.id, equipo_id: id }, { onConflict: 'planta_id,equipo_id' });
        if (r.error) return toast(/foreign key/i.test(errMsg(r.error)) ? 'Ese equipo no existe en Flota' : errMsg(r.error), 'error');
        toast('Agregado', 'ok'); pintarConfig();
      };
      $$('[data-eqbor]').forEach(b => b.onclick = async () => {
        if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Quitar?'; return; }
        const r = await sb.from('planta_equipos').delete().eq('planta_id', p.id).eq('equipo_id', b.dataset.eqbor); if (r.error) return toast(errMsg(r.error), 'error'); pintarConfig();
      });
    }
    $$('[data-perusr]').forEach(s => s.onchange = async () => { const r = await sb.from('planta_personal').update({ usuario_id: s.value || null }).eq('planta_id', p.id).eq('cedula', s.dataset.perusr); if (r.error) toast(errMsg(r.error), 'error'); else { toast('Usuario vinculado', 'ok'); pintarConfig(); } });
    $$('[data-perrol]').forEach(s => s.onchange = async () => { const r = await sb.from('planta_personal').update({ rol: s.value }).eq('planta_id', p.id).eq('cedula', s.dataset.perrol); if (r.error) toast(errMsg(r.error), 'error'); else toast('Guardado', 'ok'); });
    $$('[data-peract]').forEach(s => s.onchange = async () => { const r = await sb.from('planta_personal').update({ activo: s.checked }).eq('planta_id', p.id).eq('cedula', s.dataset.peract); if (r.error) toast(errMsg(r.error), 'error'); else toast('Guardado', 'ok'); });
    $$('[data-perbor]').forEach(b => b.onclick = async () => {
      if (!b.dataset.conf) { b.dataset.conf = '1'; b.textContent = '¿Quitar?'; return; }
      const r = await sb.from('planta_personal').delete().eq('planta_id', p.id).eq('cedula', b.dataset.perbor); if (r.error) return toast(errMsg(r.error), 'error'); pintarConfig();
    });
    $('#cf-pagr').onclick = async () => {
      const ced = ($('#cf-pnueva').value.split('·')[0] || '').trim();
      if (!ced) return toast('Elegí la persona de la lista', 'error');
      const r = await sb.from('planta_personal').upsert({ planta_id: p.id, cedula: ced, rol: $('#cf-prol').value, activo: true }, { onConflict: 'planta_id,cedula' });
      if (r.error) return toast(/foreign key|operadores/i.test(errMsg(r.error)) ? 'Esa cédula no está en el personal de Flota' : errMsg(r.error), 'error');
      toast('Agregado', 'ok'); pintarConfig();
    };
  }
  function traerMaestro(tr) {
    const rec = tr.querySelector('[data-k="recurso_id"]').value.trim();
    if (!rec) return toast('Cargá el código del recurso del maestro (ej. el del CAP en la plantilla de costos)', 'error');
    modal('Traer precio del maestro', `<div class="campos"><label class="ancho">Obra (precio sin IVA de esa obra)<select id="tm-obra">${S.obras.map(o => `<option value="${esc(o.codigo)}">${esc(o.nombre)} · ${esc(o.codigo)}</option>`).join('')}</select></label></div><p id="tm-res" class="nota"></p>`,
      `<button class="btn azul" type="button" id="tm-ok">Traer</button>`);
    $('#tm-ok').onclick = async () => {
      const r = await sb.rpc('planta_precio_maestro', { p_planta: S.planta, p_recurso: rec, p_obra_codigo: $('#tm-obra').value });
      if (r.error) return toast(errMsg(r.error), 'error');
      if (vacio(r.data)) { $('#tm-res').textContent = 'Ese recurso no tiene precio en esa obra.'; return; }
      tr.querySelector('[data-k="precio"]').value = String(r.data).replace('.', ',');
      tr.querySelector('[data-k="moneda"]').value = 'Gs';
      cerrarModal(); toast('Precio traído: tocá «Guardar precios»', 'ok');
    };
  }
  // Pegar tabla de aforo: cada renglón con pares altura | litros (acepta las 4 parejas de la Hoja2 del Excel)
  function parsearTabla(txt) {
    const pares = [];
    String(txt || '').split(/\r?\n/).forEach(lin => {
      const cel = lin.split(/\t|;/).map(s => s.trim());
      for (let i = 0; i + 1 < cel.length; i += 2) {
        const h = pNum(cel[i]), l = pNum(cel[i + 1]);
        if (h !== null && l !== null && !isNaN(h) && !isNaN(l)) pares.push([h, l]);
      }
    });
    const m = new Map(); pares.forEach(([h, l]) => m.set(Math.round(h * 10000) / 10000, l));
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }
  function editarTabla(tr, tablas, recalc) {
    const id = tr.dataset.tq, act = tablas[id] || [];
    modal('Tabla de aforo · ' + (tr.querySelector('[data-k="nombre"]').value || 'tanque'), `
      <p class="nota">Copiá del Excel las columnas <b>altura (m) | litros</b> y pegalas acá (pueden ser varias parejas por renglón, como la Hoja2 de cilindro_vol). La forma del tanque debe quedar en «Tabla de aforo».</p>
      <textarea id="ta-txt" rows="10" style="width:100%;border:1px solid #c9d1dc;border-radius:8px;padding:8px;font-family:monospace">${act.map(p => String(p[0]).replace('.', ',') + '\t' + String(p[1]).replace('.', ',')).join('\n')}</textarea>
      <p class="nota" id="ta-res"></p>`, `<button class="btn" type="button" id="ta-borrar">Quitar tabla</button><button class="btn azul" type="button" id="ta-ok">Usar esta tabla</button>`);
    const res = () => { const t = parsearTabla($('#ta-txt').value); $('#ta-res').textContent = t.length ? `${t.length} puntos · de ${fN(t[0][0], 2)} m (${fN(t[0][1])} L) a ${fN(t[t.length - 1][0], 2)} m (${fN(t[t.length - 1][1])} L)` : 'Sin datos reconocidos.'; };
    $('#ta-txt').addEventListener('input', res); res();
    $('#ta-ok').onclick = () => { const t = parsearTabla($('#ta-txt').value); if (t.length < 2) return toast('Faltan datos', 'error'); tablas[id] = t; tr.querySelector('[data-k="forma"]').value = 'tabla'; tr.querySelector('[data-tabla]').textContent = `Tabla (${t.length})`; cerrarModal(); recalc(tr); toast('Tabla lista: tocá «Guardar tanques»', 'ok'); };
    $('#ta-borrar').onclick = () => { tablas[id] = null; tr.querySelector('[data-tabla]').textContent = 'Tabla'; cerrarModal(); recalc(tr); };
  }
  function probarAforo(t) {
    modal('Probar aforo · ' + (t.nombre || ''), `<div class="campos"><label>Regla (m)<input id="pa-r" inputmode="decimal" value="1,00"></label></div><p id="pa-out" style="font-size:18px;font-weight:700"></p>
      <p class="nota">Lectura ${t.modo_lectura === 'libre' ? 'libre: se mide el vacío desde arriba' : 'stock: se mide la altura de líquido'} · capacidad ${fN(capacidad(t))} L.</p>`, '');
    const upd = () => { const r = convertirRegla(t, $('#pa-r').value); $('#pa-out').textContent = r.litros !== null && r.litros !== undefined ? `${fN(r.litros)} L${t.insumo === 'cap' ? ' · ' + fN(aTon(t, r.litros), 2) + ' t' : ''}${r.aviso ? ' (' + r.aviso + ')' : ''}` : (r.aviso || ''); };
    $('#pa-r').addEventListener('input', upd); upd();
  }

  async function salir() {
    desuscribirVivo();
    if (cola().length && !confirmarSalida()) return;
    try { await sb.auth.signOut(); } catch (e) {}
    try { ['perfil', 'tecsul_acceso_obras', 'ausencias_permiso', 'tecsul_plantas', 'tecsul_plantas_acceso'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.href = APP_PARTES;
  }
  function confirmarSalida() {
    if (salir._ok) return true;
    salir._ok = true;
    toast(`Hay ${cola().length} carga(s) sin enviar. Si salís ahora quedan en el teléfono y se envían cuando vuelvas a entrar. Tocá «Salir» otra vez para salir igual.`, 'error', 8000);
    return false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  // para pruebas
  return { salir, _t: { litrosAltura, convertirRegla, tramos, resumen, parsearTabla, pNum, capacidad, S } };
})();
// menu.js llama a mostrarPantalla() en las solapas de esta misma página
window.mostrarPantalla = function () { /* Plantas es una sola solapa */ };
