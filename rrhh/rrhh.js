/* =========================================================================
 * rrhh.js — RECURSOS HUMANOS · v20261029a (SQL 72)
 *
 *  Tres solapas:
 *   · Planilla de salarios: una por mes, con las mismas columnas que la
 *     planilla de Excel de RRHH (SALARIO_OPERADORES_<MES>). Se carga a mano,
 *     copiando el mes anterior o importando el Excel; se baja en el mismo
 *     formato (con fórmulas). Total horas, bruto, IPS y líquido se calculan
 *     solos (igual que el Excel y que la base). Las HH se pueden comparar y
 *     traer de los partes diarios del período (26 al 25).
 *   · Personal: legajo (último dato de cada persona) con altas y bajas.
 *   · Categorías: salario y precio de la hora mínimo / máximo.
 *
 *  Quién: lo decide la base (rrhh_acceso): 'editar' (admin, admin central,
 *  rrhh) o 'ver' (gerente). Las tablas tienen RLS: sin acceso no llega nada.
 *  Nada se guarda sin tocar «Guardar»; lo importado se ve antes de guardar.
 * ========================================================================= */
(function () {
  'use strict';

  const SUPABASE_URL = localStorage.getItem('sb_url') || 'https://sququxlqcrbsoqvmycfa.supabase.co';
  const SUPABASE_KEY = localStorage.getItem('sb_key') || 'sb_publishable_pN_FUHE3sbU98ReSQriUpg_zQeBko7R';
  const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  let sb = null;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cronograma-auth' }   // misma sesión que toda la app
    });
  } catch (e) { alert('No se pudo iniciar la conexión.'); }

  // ───────────────────────────── utilidades
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nz = (v) => (v === null || v === undefined || v === '' || isNaN(v)) ? 0 : Number(v);
  const vacio = (v) => v === null || v === undefined || v === '';
  function fNum(v, dec) {
    if (vacio(v) || isNaN(v)) return '';
    const d = dec === undefined ? (Number.isInteger(Number(v)) ? 0 : 2) : dec;
    return Number(v).toLocaleString('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  const fGs = (v) => vacio(v) ? '' : Math.round(Number(v)).toLocaleString('es-PY');
  // "3.044.000" · "224,41" · "224.41" · "1.500,5" → número
  function pNum(t) {
    let s = String(t ?? '').trim().replace(/\s|Gs\.?|₲/gi, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }
  function fFecha(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }
  function pFecha(t) {
    if (t instanceof Date && !isNaN(t)) return isoDe(t);
    const s = String(t ?? '').trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
    if (!m) return undefined;
    let a = Number(m[3]); if (a < 1000) a = 2000 + (a % 100);   // 26 · 026 → 2026
    const d = new Date(Date.UTC(a, Number(m[2]) - 1, Number(m[1])));
    return (d.getUTCMonth() === Number(m[2]) - 1) ? isoDe(d) : undefined;
  }
  function isoDe(d) { return d.toISOString().slice(0, 10); }
  function nombreMes(mes) { const [a, m] = mes.split('-'); return `${MESES[Number(m) - 1]} ${a}`; }
  function mesSiguiente(mes) { let [a, m] = mes.split('-').map(Number); m++; if (m > 12) { m = 1; a++; } return `${a}-${String(m).padStart(2, '0')}`; }
  function periodoHH(mes) {   // 26 del mes anterior al 25 del mes
    const [a, m] = mes.split('-').map(Number);
    return { desde: isoDe(new Date(Date.UTC(a, m - 2, 26))), hasta: isoDe(new Date(Date.UTC(a, m - 1, 25))) };
  }
  const sinAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function grupoDe(cat, cargo) {
    const c = sinAcento(cat) + ' ' + sinAcento(cargo);
    if (/chofer/.test(sinAcento(cat))) return 'Choferes';
    if (/operador/.test(sinAcento(cat))) return 'Operadores';
    if (/mecanico|gomero|electric|soldador/.test(c)) return 'Mecánicos';
    if (/admin/.test(sinAcento(cat))) return 'Administración';
    if (/chofer/.test(c)) return 'Choferes';
    if (/operador/.test(c)) return 'Operadores';
    return 'Otros';
  }
  // "OPERADOR/TM 03 - AM 01" → TM-03 · "CHOFER/ BUS 01" → BUS-01 · "CHOFER CV-04" → CV-04
  function equipoDeCargo(cargo) {
    const m = /\b([A-Z]{1,4})[\s-]?(\d{1,3})\b/.exec(String(cargo || '').toUpperCase().replace(/^[^/]*\//, ' '));
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
  }
  function toast(t, tipo) {
    const el = $('#toast'); el.textContent = t; el.className = tipo || ''; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, tipo === 'error' ? 7000 : 3500);
  }
  const carga = (on, txt) => { const c = $('#carga'); c.textContent = txt || 'Cargando…'; c.hidden = !on; };
  function modal(titulo, cuerpo, botones, ancho) {
    cerrarModal();
    const f = document.createElement('div');
    f.className = 'modal-fondo'; f.id = 'modal';
    f.innerHTML = `<div class="modal${ancho ? ' ancho' : ''}" role="dialog" aria-modal="true"><h3>${esc(titulo)}<button type="button" data-cerrar aria-label="Cerrar">×</button></h3>
      <div class="cuerpo">${cuerpo}</div><div class="pie">${botones || ''}<button type="button" class="btn" data-cerrar>Cerrar</button></div></div>`;
    f.addEventListener('click', (e) => { if (e.target === f || e.target.closest('[data-cerrar]')) cerrarModal(); });
    document.body.appendChild(f);
    return f;
  }
  const cerrarModal = () => { const m = $('#modal'); if (m) m.remove(); };
  function errMsg(e) { return (e && (e.message || e.error_description || e.details)) || String(e); }

  // ───────────────────────────── estado
  const S = {
    acceso: null, yo: '',
    vista: 'planilla',
    planillas: [], mes: null, cab: {}, filas: [], version: null, estado: 'borrador', nueva: false, sucio: false,
    hhPartes: null,   // Map cedula → {hh, partes, dias, equipos}
    fil: { q: '', local: '', grupo: '', solo: '' }, orden: { k: 'orden', asc: true },
    personal: [], persFil: { q: '', estado: 'activos', grupo: '', local: '' },
    categorias: [], catSucio: false
  };
  const edita = () => S.acceso === 'editar';
  const editaPlanilla = () => edita() && S.estado !== 'cerrada';

  // ───────────────────────────── arranque
  window.addEventListener('DOMContentLoaded', iniciar);
  window.addEventListener('beforeunload', (e) => { if (S.sucio || S.catSucio) { e.preventDefault(); e.returnValue = ''; } });

  async function iniciar() {
    $('#btn-salir').onclick = salir;
    $$('#menu .nav-tab').forEach(b => b.onclick = () => irA(b.dataset.v));
    botonApps();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) { location.href = '../index.html'; return; }
    const r = await sb.rpc('rrhh_acceso');
    if (r.error) {
      carga(false);
      $('#v-planilla').innerHTML = `<div class="card vacio">No se pudo abrir Recursos humanos: ${esc(errMsg(r.error))}.<br>
        ${/rrhh_acceso|function/i.test(errMsg(r.error)) ? 'Falta correr en Supabase el SQL <b>72_rrhh.sql</b>.' : ''}</div>`;
      return;
    }
    S.acceso = r.data || null;
    try { if (S.acceso) localStorage.setItem('tecsul_rrhh', S.acceso); else localStorage.removeItem('tecsul_rrhh'); } catch (e) {}
    if (!S.acceso) {
      carga(false);
      $('#v-planilla').innerHTML = `<div class="card vacio">Tu usuario no tiene acceso a Recursos humanos.<br>Lo habilita el administrador (rol «Recursos humanos» en Obras).<br><br><a class="btn" href="../index.html">Volver a la app</a></div>`;
      $('#menu').hidden = true;
      return;
    }
    // nombre para la cabecera
    let nombre = data.session.user.email || '';
    try {
      const w = await sb.rpc('app_whoami');
      if (w.data && w.data.nombre) nombre = w.data.nombre;
      else {
        const p = await sb.from('perfiles').select('nombre').eq('id', data.session.user.id).maybeSingle();
        if (p.data && p.data.nombre) nombre = p.data.nombre;
      }
    } catch (e) { /* queda el correo */ }
    S.yo = nombre;
    $('#hdr-usuario').textContent = `${nombre} · ${edita() ? 'carga y edita' : 'solo ver'}`;
    await Promise.all([cargarCategorias(), cargarListaPlanillas()]);
    const pedida = new URLSearchParams(location.search).get('mes');
    const mes = (pedida && S.planillas.some(p => p.mes === pedida)) ? pedida : (S.planillas[0] && S.planillas[0].mes);
    if (mes) await abrirPlanilla(mes); else pintarPlanilla();
    carga(false);
  }

  async function salir() {
    if ((S.sucio || S.catSucio) && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return;
    S.sucio = S.catSucio = false;
    await sb.auth.signOut();
    try { ['perfil', 'tecsul_acceso_obras', 'tecsul_rol_equipos', 'tecsul_rrhh'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.href = '../index.html';
  }

  function irA(v) {
    S.vista = v;
    $$('#menu .nav-tab').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    ['planilla', 'personal', 'categorias'].forEach(x => { $('#v-' + x).hidden = x !== v; });
    if (v === 'personal') cargarPersonal();
    if (v === 'categorias') pintarCategorias();
    if (v === 'planilla') pintarPlanilla();
  }

  // Botón «Otras apps de Tecsul» (igual que en Obras y Equipos)
  function botonApps() {
    const cab = $('.app-header');
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'apps-btn'; b.title = 'Otras apps de Tecsul';
    b.style.cssText = 'width:38px;height:38px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.28);border-radius:9px;background:rgba(255,255,255,.08);color:#fff';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/></svg>';
    cab.insertBefore(b, $('#btn-salir'));
    b.onclick = (e) => {
      e.stopPropagation();
      const ab = $('#apps-menu'); if (ab) { ab.remove(); return; }
      let obras = false, rolEq = '';
      try { obras = localStorage.getItem('tecsul_acceso_obras') === '1'; rolEq = localStorage.getItem('tecsul_rol_equipos') || ''; } catch (er) {}
      const apps = [];
      if (obras) apps.push(['📅', 'Obras', 'cronograma, producción, certificación, compras', '../index.html']);
      if (rolEq) apps.push(['🚜', 'Parte diario de equipos', 'partes, taller, combustible', '../equipos/parte_diario_v5.html']);
      if (['taller', 'admin_obra', 'admin_central', 'gerente'].includes(rolEq)) apps.push(['🛠️', 'Flota y taller', 'flota, OT, mantenimiento, alquileres', '../equipos/flota.html?p=flota']);
      apps.push(['👥', 'Recursos humanos', 'esta app', null]);
      const m = document.createElement('div');
      m.id = 'apps-menu';
      m.style.cssText = 'position:fixed;z-index:600;width:min(330px,calc(100vw - 16px));background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(26,39,68,.28);padding:8px';
      m.innerHTML = apps.map(a => `<a href="${a[3] || '#'}" style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;color:#1a2744;text-decoration:none;${a[3] ? '' : 'background:#eef2fb'}">
          <span style="font-size:24px;width:32px;text-align:center">${a[0]}</span><span><b style="display:block">${a[1]}</b><small style="color:#6b7487">${a[2]}</small></span></a>`).join('');
      document.body.appendChild(m);
      const r = b.getBoundingClientRect();
      m.style.top = (r.bottom + 8) + 'px';
      m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
    };
    document.addEventListener('click', (e) => { const m = $('#apps-menu'); if (m && !m.contains(e.target)) m.remove(); });
  }

  // ═════════════════════════════ PLANILLA ═════════════════════════════
  async function cargarListaPlanillas() {
    const r = await sb.from('rrhh_planillas').select('mes,titulo,estado,actualizado_en,actualizado_por').order('mes', { ascending: false });
    if (r.error) { toast('No se pudo leer la lista de planillas: ' + errMsg(r.error), 'error'); S.planillas = []; return; }
    S.planillas = r.data || [];
  }

  async function abrirPlanilla(mes) {
    carga(true, 'Abriendo la planilla…');
    try {
      const [c, f] = await Promise.all([
        sb.from('rrhh_planillas').select('*').eq('mes', mes).maybeSingle(),
        sb.from('rrhh_planilla_filas').select('*').eq('mes', mes).order('orden').limit(5000)
      ]);
      if (c.error) throw c.error;
      if (f.error) throw f.error;
      if (!c.data) throw new Error('No existe la planilla de ' + mes);
      S.mes = mes; S.cab = c.data; S.version = c.data.actualizado_en; S.estado = c.data.estado; S.nueva = false;
      S.filas = (f.data || []).map(x => ({ ...x }));
      S.sucio = false; S.hhPartes = null;
      try { history.replaceState(null, '', location.pathname + '?mes=' + mes); } catch (e) {}
    } catch (e) {
      toast('No se pudo abrir la planilla: ' + errMsg(e), 'error');
    } finally { carga(false); }
    pintarPlanilla();
  }

  // cálculo de un renglón (mismas fórmulas que el Excel y la base)
  function calc(f) {
    const th = nz(f.hh) * nz(f.precio_hora);
    const bruto = nz(f.salario_cobrar) + nz(f.viatico_cobrar) + nz(f.extras) + th;
    const ips = bruto * nz(f.ips_pct) / 100;
    const liq = bruto - ips - nz(f.anticipo) - nz(f.embargo) - nz(f.descuentos) - nz(f.casino);
    return { th, bruto, ips, liq };
  }
  const salarioCalc = (f) => (vacio(f.salario_base) || vacio(f.dias_trabajados)) ? null : Math.round(nz(f.salario_base) * nz(f.dias_trabajados) / 30);

  const COLS = [
    { k: 'nro', t: 'Nº', tipo: 'txt', w: 44 },
    { k: 'cedula', t: 'Nº CI', tipo: 'ci', fijo: false },
    { k: 'nombre', t: 'Apellido y nombre', tipo: 'txt', fijo: true },
    { k: 'categoria', t: 'Categ.', tipo: 'cat' },
    { k: 'fecha_ingreso', t: 'Ingreso', tipo: 'fecha' },
    { k: 'cargo', t: 'Cargo', tipo: 'txt' },
    { k: 'local', t: 'Local', tipo: 'txt' },
    { k: 'factor_sm', t: 'Factor s/SM', tipo: 'num' },
    { k: 'salario_base', t: 'Salario base', tipo: 'gs' },
    { k: 'viatico_estipulado', t: 'Viático estip.', tipo: 'gs' },
    { k: 'dias_trabajados', t: 'Días', tipo: 'num' },
    { k: 'salario_cobrar', t: 'Salario a cobrar', tipo: 'gs' },
    { k: 'viatico_cobrar', t: 'Viático a cobrar', tipo: 'gs' },
    { k: 'extras', t: 'Extras', tipo: 'gs' },
    { k: 'hh', t: 'HH cargadas', tipo: 'num' },
    { k: '_hhp', t: 'HH partes', tipo: 'calc', solo: () => !!S.hhPartes },
    { k: 'precio_hora', t: 'Precio/h', tipo: 'gs' },
    { k: '_th', t: 'Total horas', tipo: 'calc' },
    { k: '_bruto', t: 'Total bruto', tipo: 'calc' },
    { k: 'ips_pct', t: '% IPS', tipo: 'num' },
    { k: '_ips', t: 'I.P.S.', tipo: 'calc' },
    { k: 'anticipo', t: 'Anticipo', tipo: 'gs' },
    { k: 'embargo', t: 'Embargo', tipo: 'gs' },
    { k: 'descuentos', t: 'Descuentos', tipo: 'gs' },
    { k: 'casino', t: 'Casino', tipo: 'gs' },
    { k: '_liq', t: 'Sueldo líquido', tipo: 'calc' },
    { k: 'observacion', t: 'Observación', tipo: 'txt' }
  ];
  const colsVis = () => COLS.filter(c => !c.solo || c.solo());
  const SUMA = ['salario_cobrar', 'viatico_cobrar', 'extras', 'hh', '_hhp', '_th', '_bruto', '_ips', 'anticipo', 'embargo', 'descuentos', 'casino', '_liq'];

  function catDe(nombre) {
    const k = sinAcento(nombre);
    return S.categorias.find(c => sinAcento(c.nombre) === k || sinAcento(c.nombre).replace(/\s*\(.*\)$/, '') === k) || null;
  }
  function avisosFila(f) {
    const a = {};
    const c = catDe(f.categoria);
    // Salario base por debajo del salario mínimo de la planilla (el rango de la categoría solo se muestra:
    // la hoja CATEGORÍAS del Excel quedó con salarios anteriores al mínimo vigente)
    const sm = nz(S.cab && S.cab.salario_minimo);
    if (sm > 0 && !vacio(f.salario_base) && nz(f.salario_base) < sm)
      a.salario_base = `Menor al salario mínimo de la planilla (${fGs(sm)})${c ? ` · categoría ${c.nombre}: ${fGs(c.salario_min)} a ${fGs(c.salario_max)}` : ''}`;
    if (c && nz(c.hh_max) > 0 && !vacio(f.precio_hora) && nz(f.precio_hora) > 0 && (f.precio_hora < nz(c.hh_min) || f.precio_hora > nz(c.hh_max)))
      a.precio_hora = `Fuera del rango de ${c.nombre}: ${fGs(c.hh_min)} a ${fGs(c.hh_max)} por hora`;
    const sc = salarioCalc(f);
    if (sc !== null && !vacio(f.salario_cobrar) && Math.abs(nz(f.salario_cobrar) - sc) >= 1)
      a.salario_cobrar = `Distinto del cálculo (salario base × días ÷ 30 = ${fGs(sc)}): cargado a mano`;
    if (S.hhPartes) {
      const p = S.hhPartes.get(f.cedula);
      const hp = p ? p.hh : 0;
      if (Math.abs(hp - nz(f.hh)) > 0.01) a._hhp = `Partes: ${fNum(hp)} h en ${p ? p.partes : 0} partes${p && p.equipos ? ' (' + p.equipos + ')' : ''}`;
    }
    return a;
  }

  function filasVisibles() {
    const q = sinAcento(S.fil.q);
    let v = S.filas.map((f, i) => ({ f, i })).filter(({ f }) => {
      if (S.fil.local && (f.local || '') !== S.fil.local) return false;
      if (S.fil.grupo && grupoDe(f.categoria, f.cargo) !== S.fil.grupo) return false;
      if (S.fil.solo === 'obs' && !f.observacion) return false;
      if (S.fil.solo === 'avisos' && !Object.keys(avisosFila(f)).length) return false;
      if (S.fil.solo === 'difhh' && !avisosFila(f)._hhp) return false;
      if (q && ![f.nombre, f.cedula, f.cargo, f.categoria, f.local, f.equipo, f.observacion].some(x => sinAcento(x).includes(q))) return false;
      return true;
    });
    const { k, asc } = S.orden;
    if (k !== 'orden') {
      const val = ({ f }) => {
        const c = calc(f);
        if (k === '_th') return c.th; if (k === '_bruto') return c.bruto; if (k === '_ips') return c.ips; if (k === '_liq') return c.liq;
        if (k === '_hhp') { const p = S.hhPartes && S.hhPartes.get(f.cedula); return p ? p.hh : 0; }
        return f[k];
      };
      v.sort((a, b) => {
        const x = val(a), y = val(b);
        const r = (typeof x === 'number' || typeof y === 'number') ? nz(x) - nz(y) : sinAcento(x).localeCompare(sinAcento(y), 'es', { numeric: true });
        return asc ? r : -r;
      });
    }
    return v;
  }

  function pintarPlanilla() {
    const v = $('#v-planilla');
    const opts = S.planillas.map(p => `<option value="${p.mes}" ${p.mes === S.mes ? 'selected' : ''}>${nombreMes(p.mes)}${p.estado === 'cerrada' ? ' · cerrada' : ''}</option>`).join('');
    const opcNueva = S.nueva && S.mes ? `<option value="${S.mes}" selected>${nombreMes(S.mes)} · nueva (sin guardar)</option>` : '';
    const barra = `<div class="barra">
      <select class="sel" id="pl-mes" title="Mes de la planilla">${opcNueva}${opts || (opcNueva ? '' : '<option value="">— sin planillas —</option>')}</select>
      ${S.mes ? `<span class="chip ${S.estado === 'cerrada' ? 'gris' : 'ambar'}">${S.estado === 'cerrada' ? 'Cerrada' : 'Borrador'}</span>` : ''}
      ${S.sucio ? '<span class="chip rojo">Cambios sin guardar</span>' : ''}
      ${edita() ? `<button class="btn" id="pl-nueva">＋ Nueva planilla</button><button class="btn" id="pl-imp">⇪ Importar Excel</button>` : ''}
      ${S.mes ? `<button class="btn" id="pl-exp">⇩ Bajar Excel</button>
        <button class="btn" id="pl-hh">${S.hhPartes ? 'Ocultar HH de partes' : 'Comparar HH con partes'}</button>
        ${S.hhPartes && editaPlanilla() ? '<button class="btn" id="pl-hh-traer">Traer HH de partes…</button>' : ''}` : ''}
      <span class="esp"></span>
      ${S.mes && edita() && !S.nueva ? (S.estado === 'cerrada'
        ? '<button class="btn" id="pl-reabrir">Reabrir</button>'
        : '<button class="btn" id="pl-cerrar" title="Cerrada no se puede modificar">Cerrar planilla</button><button class="btn rojo" id="pl-borrar">Eliminar</button>') : ''}
      ${S.mes && editaPlanilla() ? `<button class="btn nar" id="pl-guardar" ${S.sucio ? '' : 'disabled'}>Guardar</button>` : ''}
    </div>`;
    if (!S.mes) {
      v.innerHTML = barra + `<div class="card vacio">Todavía no hay planillas cargadas.${edita() ? '<br>Usá <b>Importar Excel</b> para traer la planilla que usa RRHH (por ejemplo SALARIO_OPERADORES_SEPTIEMBRE_2026.xlsx) o <b>Nueva planilla</b> para empezar una.' : ''}</div>`;
      enlazarBarra();
      return;
    }
    const ro = editaPlanilla() ? '' : 'disabled';
    const cab = `<div class="card cab">
      <label>Título<input id="cab-titulo" value="${esc(S.cab.titulo || '')}" placeholder="PLANILLA DE SALARIO OPERADORES ${nombreMes(S.mes)}" ${ro}></label>
      <label>Salario mínimo (Gs)<input id="cab-sm" value="${fGs(S.cab.salario_minimo)}" ${ro}></label>
      <label>HH de partes desde<input type="date" id="cab-desde" value="${esc(S.cab.hh_desde || '')}" ${ro}></label>
      <label>HH de partes hasta<input type="date" id="cab-hasta" value="${esc(S.cab.hh_hasta || '')}" ${ro}></label>
      <label>Notas<input id="cab-notas" value="${esc(S.cab.notas || '')}" ${ro}></label>
    </div>`;
    const locales = [...new Set(S.filas.map(f => f.local).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const filtros = `<div class="barra">
      <input class="inp busca" id="f-q" placeholder="Buscar nombre, CI, cargo, máquina…" value="${esc(S.fil.q)}">
      <select class="sel" id="f-local"><option value="">Todos los locales</option>${locales.map(l => `<option ${l === S.fil.local ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select class="sel" id="f-grupo"><option value="">Todos los puestos</option>${['Choferes', 'Operadores', 'Mecánicos', 'Administración', 'Otros'].map(g => `<option ${g === S.fil.grupo ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <select class="sel" id="f-solo"><option value="">Todos los renglones</option>
        <option value="avisos" ${S.fil.solo === 'avisos' ? 'selected' : ''}>Solo con avisos ⚠</option>
        <option value="obs" ${S.fil.solo === 'obs' ? 'selected' : ''}>Solo con observación</option>
        ${S.hhPartes ? `<option value="difhh" ${S.fil.solo === 'difhh' ? 'selected' : ''}>HH distintas a los partes</option>` : ''}</select>
      ${editaPlanilla() ? '<button class="btn" id="pl-agregar">＋ Persona</button>' : ''}
      <span class="esp"></span><span class="nota" id="pl-cuenta"></span>
    </div>`;
    v.innerHTML = barra + cab + '<div class="kpis" id="pl-kpis"></div>' + filtros + '<div class="tw" id="pl-tw"></div>';
    enlazarBarra();
    pintarTabla();
  }

  function celda(c, f, i, av) {
    const ro = !editaPlanilla();
    const tit = av[c.k] ? ` title="${esc(av[c.k])}"` : '';
    const marca = av[c.k] ? '<span class="aviso"> ⚠</span>' : '';
    if (c.tipo === 'calc') {
      const r = calc(f);
      if (c.k === '_hhp') {
        const p = S.hhPartes && S.hhPartes.get(f.cedula); const hp = p ? p.hh : 0; const d = hp - nz(f.hh);
        return `<td class="n calc" data-c="_hhp"${tit}>${fNum(hp)}${Math.abs(d) > 0.01 ? ` <span class="${d > 0 ? 'dif-pos' : 'dif-neg'}">(${d > 0 ? '+' : ''}${fNum(d)})</span>` : ''}</td>`;
      }
      const val = c.k === '_th' ? r.th : c.k === '_bruto' ? r.bruto : c.k === '_ips' ? r.ips : r.liq;
      return `<td class="n ${c.k === '_liq' ? 'liq' : 'calc'}" data-c="${c.k}">${fGs(val)}</td>`;
    }
    const cls = c.fijo ? ' class="fijo"' : (['gs', 'num'].includes(c.tipo) ? ' class="n"' : '');
    if (ro) {
      const t = c.tipo === 'gs' ? fGs(f[c.k]) : c.tipo === 'num' ? fNum(f[c.k]) : c.tipo === 'fecha' ? fFecha(f[c.k]) : esc(f[c.k] ?? '');
      return `<td${cls}${tit}>${t}${marca}</td>`;
    }
    if (c.tipo === 'cat') {
      const lista = S.categorias.map(x => x.nombre);
      const actual = f.categoria || '';
      const opciones = (actual && !lista.some(x => sinAcento(x) === sinAcento(actual)) ? [actual] : []).concat(lista);
      return `<td><select class="c" data-i="${i}" data-k="categoria"><option value=""></option>${opciones.map(o => `<option ${sinAcento(o) === sinAcento(actual) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`;
    }
    if (c.tipo === 'fecha') return `<td><input class="c txt" style="min-width:96px;text-align:left" data-i="${i}" data-k="${c.k}" value="${fFecha(f[c.k])}" placeholder="dd/mm/aaaa"></td>`;
    const val = c.tipo === 'gs' ? fGs(f[c.k]) : c.tipo === 'num' ? fNum(f[c.k], 4) : (f[c.k] ?? '');
    const ANCHO = { nombre: 250, cargo: 200, local: 140, observacion: 230 };
    const k2 = c.tipo === 'txt' ? (c.k === 'nro' ? ' txt" style="min-width:36px;text-align:right' : ` txt" style="min-width:${ANCHO[c.k] || 120}px`) : c.tipo === 'ci' ? ' ci' : '';
    return `<td${cls}${tit}><input class="c${k2}" data-i="${i}" data-k="${c.k}" value="${esc(val)}">${marca}</td>`;
  }

  function pintarTabla() {
    const tw = $('#pl-tw'); if (!tw) return;
    const vis = filasVisibles();
    const cols = colsVis();
    const flecha = (k) => S.orden.k === k ? (S.orden.asc ? ' ▲' : ' ▼') : '';
    let h = '<table class="t"><thead><tr>' + cols.map(c => `<th data-o="${c.k}" class="${['gs', 'num', 'calc'].includes(c.tipo) ? 'n' : ''}${c.fijo ? ' fijo' : ''}">${esc(c.t)}${flecha(c.k)}</th>`).join('')
      + (editaPlanilla() ? '<th></th>' : '') + '</tr></thead><tbody>';
    h += vis.map(({ f, i }) => {
      const av = avisosFila(f);
      return `<tr data-i="${i}">` + cols.map(c => celda(c, f, i, av)).join('') + (editaPlanilla() ? `<td><button class="x" data-quitar="${i}" title="Quitar de la planilla">×</button></td>` : '') + '</tr>';
    }).join('');
    h += '</tbody><tfoot><tr>' + cols.map((c, j) => `<td class="${['gs', 'num', 'calc'].includes(c.tipo) ? 'n' : ''}${c.fijo ? ' fijo' : ''}" data-t="${c.k}">${j === 0 ? 'Total' : ''}</td>`).join('') + (editaPlanilla() ? '<td></td>' : '') + '</tr></tfoot></table>';
    if (!S.filas.length) h = `<div class="vacio">La planilla no tiene renglones.${editaPlanilla() ? ' Agregá personas con «＋ Persona».' : ''}</div>`;
    tw.innerHTML = h;
    $$('th[data-o]', tw).forEach(th => th.onclick = () => {
      const k = th.dataset.o;
      S.orden = S.orden.k === k ? (S.orden.asc ? { k, asc: false } : { k: 'orden', asc: true }) : { k, asc: true };
      pintarTabla();
    });
    totales(vis);
  }

  function totales(vis) {
    vis = vis || filasVisibles();
    const t = {}; SUMA.forEach(k => { t[k] = 0; });
    vis.forEach(({ f }) => {
      const r = calc(f);
      t.salario_cobrar += nz(f.salario_cobrar); t.viatico_cobrar += nz(f.viatico_cobrar); t.extras += nz(f.extras); t.hh += nz(f.hh);
      t._th += r.th; t._bruto += r.bruto; t._ips += r.ips; t._liq += r.liq;
      t.anticipo += nz(f.anticipo); t.embargo += nz(f.embargo); t.descuentos += nz(f.descuentos); t.casino += nz(f.casino);
      if (S.hhPartes) { const p = S.hhPartes.get(f.cedula); t._hhp += p ? p.hh : 0; }
    });
    SUMA.forEach(k => { const td = $(`#pl-tw tfoot td[data-t="${k}"]`); if (td) td.textContent = ['hh', '_hhp'].includes(k) ? fNum(t[k]) : fGs(t[k]); });
    const cu = $('#pl-cuenta'); if (cu) cu.textContent = vis.length === S.filas.length ? `${S.filas.length} personas` : `${vis.length} de ${S.filas.length} personas`;
    const filtro = vis.length !== S.filas.length;
    const k = $('#pl-kpis'); if (!k) return;
    const ap = vis.filter(({ f }) => Object.keys(avisosFila(f)).length).length;
    k.innerHTML = `
      <div class="kpi"><span>Personas</span><b>${vis.length}</b><small>${filtro ? 'según el filtro' : nombreMes(S.mes)}</small></div>
      <div class="kpi"><span>Total bruto</span><b>${fGs(t._bruto)}</b><small>Gs</small></div>
      <div class="kpi"><span>Total horas (Gs)</span><b>${fGs(t._th)}</b><small>${fNum(t.hh)} h${S.hhPartes ? ' · partes ' + fNum(t._hhp) + ' h' : ''}</small></div>
      <div class="kpi"><span>I.P.S.</span><b>${fGs(t._ips)}</b><small>Gs</small></div>
      <div class="kpi"><span>Descuentos</span><b>${fGs(t.anticipo + t.embargo + t.descuentos + t.casino)}</b><small>anticipo, embargo, desc., casino</small></div>
      <div class="kpi"><span>Sueldo líquido</span><b style="color:var(--verde)">${fGs(t._liq)}</b><small>a pagar</small></div>
      <div class="kpi"><span>Avisos</span><b style="color:${ap ? '#9a5b00' : 'inherit'}">${ap}</b><small>renglones con ⚠</small></div>`;
  }

  // refresca los cálculos de un renglón sin volver a dibujar la tabla (el foco no se pierde)
  function refrescarFila(i) {
    const tr = $(`#pl-tw tr[data-i="${i}"]`); if (!tr) return;
    const f = S.filas[i]; const r = calc(f); const av = avisosFila(f);
    const set = (k, v) => { const td = $(`td[data-c="${k}"]`, tr); if (td) td.textContent = fGs(v); };
    set('_th', r.th); set('_bruto', r.bruto); set('_ips', r.ips); set('_liq', r.liq);
    $$('input.c, select.c', tr).forEach(inp => {
      const td = inp.parentElement; const k = inp.dataset.k;
      td.title = av[k] || '';
      let m = $('.aviso', td);
      if (av[k] && !m) { m = document.createElement('span'); m.className = 'aviso'; m.textContent = ' ⚠'; td.appendChild(m); }
      if (!av[k] && m) m.remove();
    });
    tr.classList.add('mod');
    totales();
  }

  function marcarSucio() {
    if (!S.sucio) {
      S.sucio = true;
      const g = $('#pl-guardar'); if (g) g.disabled = false;
      const bar = $('#v-planilla .barra');
      if (bar && !$('.chip.rojo', bar)) { const c = document.createElement('span'); c.className = 'chip rojo'; c.textContent = 'Cambios sin guardar'; const ref = $('#pl-nueva', bar) || $('.esp', bar); bar.insertBefore(c, ref); }
    }
  }

  function enlazarBarra() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    const sel = $('#pl-mes');
    if (sel) sel.onchange = async () => {
      const m = sel.value;
      if (!m || m === S.mes) return;
      if (S.sucio && !confirm('Hay cambios sin guardar en ' + nombreMes(S.mes) + '. ¿Descartarlos?')) { sel.value = S.mes; return; }
      S.sucio = false;
      await abrirPlanilla(m);
    };
    on('#pl-nueva', nuevaPlanilla);
    on('#pl-imp', importarExcel);
    on('#pl-exp', exportarExcel);
    on('#pl-hh', compararHH);
    on('#pl-hh-traer', traerHH);
    on('#pl-guardar', guardarPlanilla);
    on('#pl-cerrar', () => cambiarEstado('cerrada'));
    on('#pl-reabrir', () => cambiarEstado('borrador'));
    on('#pl-borrar', borrarPlanilla);
    on('#pl-agregar', agregarPersona);
    // cabecera
    const cab = [['#cab-titulo', 'titulo', 'txt'], ['#cab-sm', 'salario_minimo', 'num'], ['#cab-desde', 'hh_desde', 'txt'], ['#cab-hasta', 'hh_hasta', 'txt'], ['#cab-notas', 'notas', 'txt']];
    cab.forEach(([id, k, t]) => {
      const el = $(id); if (!el) return;
      el.onchange = () => {
        let v = el.value.trim();
        if (t === 'num') { const n = pNum(v); if (Number.isNaN(n)) { toast('Número no válido', 'error'); el.value = fGs(S.cab[k]); return; } v = n; el.value = fGs(n); }
        S.cab[k] = v === '' ? null : v;
        if ((k === 'hh_desde' || k === 'hh_hasta') && S.hhPartes) compararHH(true);
        marcarSucio();
      };
    });
    // filtros
    const fq = $('#f-q'); if (fq) fq.oninput = () => { S.fil.q = fq.value; pintarTabla(); };
    [['#f-local', 'local'], ['#f-grupo', 'grupo'], ['#f-solo', 'solo']].forEach(([id, k]) => { const el = $(id); if (el) el.onchange = () => { S.fil[k] = el.value; pintarTabla(); }; });
    // celdas (delegado)
    const tw = $('#pl-tw');
    if (tw) {
      tw.addEventListener('input', (e) => {
        const inp = e.target.closest('input.c'); if (!inp) return;
        const c = COLS.find(x => x.k === inp.dataset.k);
        if (!c || !['gs', 'num'].includes(c.tipo)) return;
        const n = pNum(inp.value); if (Number.isNaN(n)) return;
        aplicarValor(Number(inp.dataset.i), c.k, n, false);
      });
      tw.addEventListener('change', (e) => {
        const inp = e.target.closest('input.c, select.c'); if (!inp) return;
        const i = Number(inp.dataset.i), k = inp.dataset.k, c = COLS.find(x => x.k === k);
        let v = inp.value.trim();
        if (['gs', 'num'].includes(c.tipo)) {
          const n = pNum(v);
          if (Number.isNaN(n)) { toast('Número no válido: ' + v, 'error'); inp.value = c.tipo === 'gs' ? fGs(S.filas[i][k]) : fNum(S.filas[i][k], 4); return; }
          v = n;
          if (k === 'dias_trabajados' && v !== null && (v < 0 || v > 31)) { toast('Los días trabajados van de 0 a 31', 'error'); inp.value = fNum(S.filas[i][k]); return; }
          if (k === 'ips_pct' && v !== null && (v < 0 || v > 100)) { toast('El % de IPS va de 0 a 100', 'error'); inp.value = fNum(S.filas[i][k]); return; }
        } else if (c.tipo === 'fecha') {
          const d = pFecha(v);
          if (d === undefined) { toast('Fecha no válida (dd/mm/aaaa): ' + v, 'error'); inp.value = fFecha(S.filas[i][k]); return; }
          v = d;
        } else if (c.tipo === 'ci') {
          v = v.replace(/\D/g, '');
          if (!v) { toast('La cédula no puede quedar vacía', 'error'); inp.value = S.filas[i][k]; return; }
          if (S.filas.some((x, j) => j !== i && x.cedula === v)) { toast('Esa cédula ya está en la planilla', 'error'); inp.value = S.filas[i][k]; return; }
        } else v = v === '' ? null : v;
        aplicarValor(i, k, v, true);
        if (['gs'].includes(c.tipo)) inp.value = fGs(S.filas[i][k]);
        else if (c.tipo === 'num') inp.value = fNum(S.filas[i][k], 4);
        else if (c.tipo === 'fecha') inp.value = fFecha(S.filas[i][k]);
        else if (c.tipo === 'ci') inp.value = S.filas[i][k];
      });
      tw.addEventListener('click', (e) => {
        const b = e.target.closest('[data-quitar]'); if (!b) return;
        const i = Number(b.dataset.quitar), f = S.filas[i];
        if (!confirm(`¿Quitar a ${f.nombre} (CI ${f.cedula}) de la planilla de ${nombreMes(S.mes)}?\n(Se borra al guardar. En el legajo sigue.)`)) return;
        S.filas.splice(i, 1);
        marcarSucio(); pintarTabla();
      });
    }
  }

  function aplicarValor(i, k, v, final) {
    const f = S.filas[i]; if (!f) return;
    const antes = f[k];
    f[k] = v;
    // días o salario base cambian → salario a cobrar = base × días ÷ 30 (si no estaba cargado a mano)
    if (k === 'salario_base' || k === 'dias_trabajados') {
      const prev = { ...f, [k]: antes };
      const scAntes = salarioCalc(prev);
      if (vacio(f.salario_cobrar) || scAntes === null || Math.abs(nz(f.salario_cobrar) - scAntes) < 1) {
        const sc = salarioCalc(f);
        if (sc !== null) {
          f.salario_cobrar = sc;
          const inp = $(`#pl-tw input.c[data-i="${i}"][data-k="salario_cobrar"]`);
          if (inp && document.activeElement !== inp) inp.value = fGs(sc);
        }
      }
    }
    if (k === 'cargo' && final) { const eq = equipoDeCargo(v); if (eq) f.equipo = eq; }
    if (antes !== v) marcarSucio();
    refrescarFila(i);
  }

  function filaNueva(p, previa) {
    const base = previa ? { ...previa } : {};
    const f = {
      nro: null, cedula: p.cedula, nombre: p.nombre, categoria: p.categoria ?? base.categoria ?? null,
      fecha_ingreso: p.fecha_ingreso ?? base.fecha_ingreso ?? null, cargo: p.cargo ?? base.cargo ?? null,
      equipo: p.equipo ?? base.equipo ?? null, local: p.local ?? base.local ?? null,
      factor_sm: p.factor_sm ?? base.factor_sm ?? null,
      salario_base: p.salario_base ?? base.salario_base ?? null,
      viatico_estipulado: p.viatico ?? p.viatico_estipulado ?? base.viatico_estipulado ?? null,
      dias_trabajados: 30, salario_cobrar: null,
      viatico_cobrar: base.viatico_cobrar ?? null, extras: null, hh: null,
      precio_hora: p.precio_hora ?? base.precio_hora ?? null,
      ips_pct: p.aporta_ips === false ? 0 : (base.ips_pct ?? 9),
      anticipo: null, embargo: null, descuentos: null, casino: null, observacion: null
    };
    f.salario_cobrar = salarioCalc(f);
    return f;
  }

  async function nuevaPlanilla() {
    if (S.sucio && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    const ult = S.planillas[0] ? S.planillas[0].mes : null;
    const hoy = new Date(); const mesHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const sug = ult ? mesSiguiente(ult) : mesHoy;
    const f = modal('Nueva planilla', `<div class="form">
        <label>Mes<input type="month" id="np-mes" value="${sug}"></label>
        <label>Empezar con<select id="np-base">
          ${S.planillas.map(p => `<option value="m:${p.mes}">Las personas de ${nombreMes(p.mes)}</option>`).join('')}
          <option value="legajo">El personal activo del legajo</option>
          <option value="vacia">Vacía</option></select></label>
        <p class="nota ancho">Se copian cédula, nombre, categoría, cargo, local, salario base, viático, precio de la hora y % de IPS; días en 30 y salario a cobrar recalculado.
          Quedan en blanco HH, extras, anticipo, embargo, descuentos, casino y observación. Quien figure como <b>baja</b> en el legajo no se copia.
          No se guarda nada hasta tocar <b>Guardar</b>.</p></div>`,
      '<button class="btn pri" id="np-ok">Crear</button>');
    $('#np-ok', f).onclick = async () => {
      const mes = $('#np-mes', f).value;
      if (!/^\d{4}-\d{2}$/.test(mes)) return toast('Elegí el mes', 'error');
      if (S.planillas.some(p => p.mes === mes)) return toast('Ya existe la planilla de ' + nombreMes(mes) + ': abrila desde la lista.', 'error');
      const b = $('#np-base', f).value;
      carga(true, 'Preparando…');
      try {
        await cargarPersonal(true);
        const bajas = new Set(S.personal.filter(p => !p.activo).map(p => p.cedula));
        let filas = [];
        if (b.startsWith('m:')) {
          const r = await sb.from('rrhh_planilla_filas').select('*').eq('mes', b.slice(2)).order('orden');
          if (r.error) throw r.error;
          filas = (r.data || []).filter(x => !bajas.has(x.cedula)).map(x => { const n = filaNueva(x, x); n.nro = x.nro; return n; });
        } else if (b === 'legajo') {
          filas = S.personal.filter(p => p.activo).map(p => filaNueva(p));
        }
        S.mes = mes; S.nueva = true; S.version = null; S.estado = 'borrador'; S.filas = filas; S.hhPartes = null;
        const per = periodoHH(mes);
        const smAnt = S.cab && S.cab.salario_minimo;
        S.cab = { mes, titulo: 'PLANILLA DE SALARIO OPERADORES ' + nombreMes(mes), salario_minimo: smAnt || null, hh_desde: per.desde, hh_hasta: per.hasta, notas: null };
        S.sucio = true;
        cerrarModal(); pintarPlanilla();
        toast(`Planilla de ${nombreMes(mes)} lista con ${filas.length} personas. Revisá y tocá Guardar.`, 'ok');
      } catch (e) { toast('No se pudo preparar: ' + errMsg(e), 'error'); }
      finally { carga(false); }
    };
  }

  async function guardarPlanilla() {
    if (!editaPlanilla()) return;
    const sinCi = S.filas.filter(f => !f.cedula);
    if (sinCi.length) return toast('Hay renglones sin cédula', 'error');
    const filas = S.filas.map(f => {
      const o = {};
      ['nro', 'cedula', 'nombre', 'categoria', 'fecha_ingreso', 'cargo', 'equipo', 'local', 'factor_sm', 'salario_base', 'viatico_estipulado',
        'dias_trabajados', 'salario_cobrar', 'viatico_cobrar', 'extras', 'hh', 'precio_hora', 'ips_pct', 'anticipo', 'embargo', 'descuentos', 'casino', 'observacion']
        .forEach(k => { o[k] = vacio(f[k]) ? null : (typeof f[k] === 'number' ? String(f[k]) : f[k]); });
      if (!o.equipo) o.equipo = equipoDeCargo(f.cargo);
      return o;
    });
    const cab = { titulo: S.cab.titulo, salario_minimo: vacio(S.cab.salario_minimo) ? null : String(S.cab.salario_minimo),
      hh_desde: S.cab.hh_desde || null, hh_hasta: S.cab.hh_hasta || null, notas: S.cab.notas, actualizar_personal: true };
    const b = $('#pl-guardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    const r = await sb.rpc('rrhh_planilla_guardar', { p_mes: S.mes, p_cab: cab, p_filas: filas, p_version: S.version });
    if (r.error) {
      if (b) { b.disabled = false; b.textContent = 'Guardar'; }
      return toast('No se guardó: ' + errMsg(r.error), 'error');
    }
    toast(`Planilla de ${nombreMes(S.mes)} guardada (${r.data.filas} personas)`, 'ok');
    S.sucio = false;
    const hh = S.hhPartes;
    await cargarListaPlanillas();
    await abrirPlanilla(S.mes);
    if (hh) { S.hhPartes = hh; pintarPlanilla(); }
  }

  async function cambiarEstado(estado) {
    if (S.sucio) return toast('Primero guardá los cambios', 'error');
    if (estado === 'cerrada' && !confirm(`¿Cerrar la planilla de ${nombreMes(S.mes)}?\nCerrada no se puede modificar (se puede reabrir).`)) return;
    const r = await sb.rpc('rrhh_planilla_estado', { p_mes: S.mes, p_estado: estado });
    if (r.error) return toast(errMsg(r.error), 'error');
    toast(estado === 'cerrada' ? 'Planilla cerrada' : 'Planilla reabierta', 'ok');
    await cargarListaPlanillas(); await abrirPlanilla(S.mes);
  }

  async function borrarPlanilla() {
    const t = prompt(`Se elimina la planilla de ${nombreMes(S.mes)} con sus ${S.filas.length} renglones.\nEl legajo del personal no se borra.\n\nPara confirmar escribí el mes (${S.mes}):`);
    if (t === null) return;
    if (t.trim() !== S.mes) return toast('No coincide: no se eliminó nada', 'error');
    const r = await sb.rpc('rrhh_planilla_borrar', { p_mes: S.mes });
    if (r.error) return toast(errMsg(r.error), 'error');
    toast('Planilla eliminada', 'ok');
    S.sucio = false; S.mes = null; S.filas = [];
    await cargarListaPlanillas();
    if (S.planillas[0]) await abrirPlanilla(S.planillas[0].mes); else pintarPlanilla();
  }

  async function agregarPersona() {
    await cargarPersonal(true);
    const ya = new Set(S.filas.map(f => f.cedula));
    const disp = S.personal.filter(p => !ya.has(p.cedula)).sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
    const f = modal('Agregar persona a la planilla', `<div class="form">
      <label class="ancho">Del legajo<select id="ap-leg"><option value="">— persona nueva —</option>${disp.map(p => `<option value="${esc(p.cedula)}">${esc(p.nombre)} · CI ${esc(p.cedula)}${p.activo ? '' : ' (baja)'}</option>`).join('')}</select></label>
      <label>Cédula<input id="ap-ci" inputmode="numeric"></label><label>Apellido y nombre<input id="ap-nom"></label>
      <p class="nota ancho">Si elegís alguien del legajo se completan sus datos. Una persona nueva queda también en el legajo al guardar.</p></div>`,
      '<button class="btn pri" id="ap-ok">Agregar</button>');
    $('#ap-leg', f).onchange = () => { const p = S.personal.find(x => x.cedula === $('#ap-leg', f).value); $('#ap-ci', f).value = p ? p.cedula : ''; $('#ap-nom', f).value = p ? p.nombre : ''; };
    $('#ap-ok', f).onclick = () => {
      const ci = $('#ap-ci', f).value.replace(/\D/g, ''); const nom = $('#ap-nom', f).value.trim().toUpperCase();
      if (!ci || !nom) return toast('Falta la cédula o el nombre', 'error');
      if (ya.has(ci)) return toast('Esa cédula ya está en la planilla', 'error');
      const p = S.personal.find(x => x.cedula === ci) || { cedula: ci, nombre: nom };
      const n = filaNueva({ ...p, nombre: nom });
      n.nro = String(S.filas.reduce((m, x) => Math.max(m, parseInt(x.nro, 10) || 0), 0) + 1);
      S.filas.push(n);
      cerrarModal(); marcarSucio(); S.fil = { q: '', local: '', grupo: '', solo: '' }; pintarPlanilla();
      const tr = $(`#pl-tw tr[data-i="${S.filas.length - 1}"]`); if (tr) tr.scrollIntoView({ block: 'center' });
    };
  }

  // ── HH de los partes diarios ──
  async function compararHH(forzar) {
    if (S.hhPartes && forzar !== true) { S.hhPartes = null; if (S.fil.solo === 'difhh') S.fil.solo = ''; pintarPlanilla(); return; }
    const per = periodoHH(S.mes);
    const desde = S.cab.hh_desde || per.desde, hasta = S.cab.hh_hasta || per.hasta;
    carga(true, 'Sumando las HH de los partes…');
    const r = await sb.rpc('rrhh_hh_partes', { p_desde: desde, p_hasta: hasta });
    carga(false);
    if (r.error) return toast('No se pudieron leer los partes: ' + errMsg(r.error), 'error');
    S.hhPartes = new Map((r.data || []).map(x => [String(x.cedula), { hh: Number(x.hh) || 0, partes: Number(x.partes) || 0, dias: Number(x.dias) || 0, equipos: x.equipos || '' }]));
    S.hhPartesTodos = r.data || [];
    pintarPlanilla();
    const dif = S.filas.filter(f => avisosFila(f)._hhp).length;
    toast(`Partes del ${fFecha(desde)} al ${fFecha(hasta)}: ${dif} personas con HH distintas`, dif ? '' : 'ok');
  }

  function traerHH() {
    if (!S.hhPartes) return;
    const dif = S.filas.map((f, i) => ({ f, i, p: S.hhPartes.get(f.cedula) })).filter(x => Math.abs((x.p ? x.p.hh : 0) - nz(x.f.hh)) > 0.01);
    const enPlanilla = new Set(S.filas.map(f => f.cedula));
    const fuera = (S.hhPartesTodos || []).filter(x => !enPlanilla.has(String(x.cedula)) && Number(x.hh) > 0);
    const f = modal('Traer HH de los partes diarios', `
      <p class="nota" style="margin-top:0">Período ${fFecha(S.cab.hh_desde || periodoHH(S.mes).desde)} al ${fFecha(S.cab.hh_hasta || periodoHH(S.mes).hasta)}. Marcá a quién se le cambian las HH de la planilla por las de los partes. No se guarda hasta tocar <b>Guardar</b>.</p>
      ${dif.length ? `<div class="tw" style="max-height:50vh"><table class="t"><thead><tr><th><input type="checkbox" id="th-todos" checked></th><th>Persona</th><th>CI</th><th class="n">HH planilla</th><th class="n">HH partes</th><th class="n">Diferencia</th><th class="n">Partes</th><th>Máquinas</th></tr></thead><tbody>
      ${dif.map(x => { const hp = x.p ? x.p.hh : 0, d = hp - nz(x.f.hh); return `<tr><td><input type="checkbox" class="th-sel" data-i="${x.i}" ${hp > 0 ? 'checked' : ''}></td><td>${esc(x.f.nombre)}</td><td>${esc(x.f.cedula)}</td><td class="n">${fNum(x.f.hh)}</td><td class="n">${fNum(hp)}</td><td class="n ${d > 0 ? 'dif-pos' : 'dif-neg'}">${d > 0 ? '+' : ''}${fNum(d)}</td><td class="n">${x.p ? x.p.partes : 0}</td><td>${esc(x.p ? x.p.equipos : '')}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="vacio">Las HH de la planilla coinciden con los partes.</div>'}
      ${fuera.length ? `<p class="nota"><b>${fuera.length}</b> cédulas con partes en el período no están en esta planilla: ${fuera.slice(0, 40).map(x => esc(x.cedula) + ' (' + fNum(x.hh) + ' h)').join(', ')}${fuera.length > 40 ? '…' : ''}</p>` : ''}
      <p class="nota">Ojo: quien no tiene partes queda sin marcar (pasaría a 0 HH). Mecánicos y administración no cargan parte diario.</p>`,
      dif.length ? '<button class="btn pri" id="th-ok">Pasar las marcadas</button>' : '', true);
    const todos = $('#th-todos', f); if (todos) todos.onchange = () => $$('.th-sel', f).forEach(c => { c.checked = todos.checked; });
    const ok = $('#th-ok', f);
    if (ok) ok.onclick = () => {
      let n = 0;
      $$('.th-sel', f).forEach(c => {
        if (!c.checked) return;
        const i = Number(c.dataset.i), p = S.hhPartes.get(S.filas[i].cedula);
        S.filas[i].hh = p ? Math.round(p.hh * 100) / 100 : 0; n++;
      });
      cerrarModal();
      if (n) { marcarSucio(); pintarPlanilla(); toast(`HH actualizadas en ${n} personas. Falta Guardar.`, 'ok'); }
    };
  }

  // ═════════════════════════════ IMPORTAR EXCEL ═════════════════════════════
  const ENC = [   // encabezado del Excel → campo
    [/^n[ºo°]\s*ci$|^c\.?i\.?$|^cedula/, 'cedula'],
    [/^n[ºo°]\.?$|^nro\.?$/, 'nro'],
    [/apellido|nombre/, 'nombre'],
    [/^categ/, 'categoria'],
    [/ingreso/, 'fecha_ingreso'],
    [/^cargo/, 'cargo'],
    [/^local|^obra/, 'local'],
    [/factor/, 'factor_sm'],
    [/salario\s*base/, 'salario_base'],
    [/viatico\s*estip/, 'viatico_estipulado'],
    [/dias/, 'dias_trabajados'],
    [/salario\s*a\s*cobrar/, 'salario_cobrar'],
    [/viatico\s*a\s*cobrar/, 'viatico_cobrar'],
    [/^extras?$|bonificacion/, 'extras'],
    [/horas\s*hombre/, 'hh'],
    [/precio/, 'precio_hora'],
    [/total\s*horas/, '_th'],
    [/total\s*bruto/, '_bruto'],
    [/^i\.?p\.?s\.?$/, '_ips'],
    [/anticipo/, 'anticipo'],
    [/embargo/, 'embargo'],
    [/descuento/, 'descuentos'],
    [/casino/, 'casino'],
    [/liquido/, '_liq'],
    [/^obs/, 'observacion']
  ];
  function valorCelda(c) {
    let v = c && c.value;
    if (v && typeof v === 'object') {
      if (v instanceof Date) return v;
      if ('result' in v && v.result !== undefined) v = v.result;
      else if (v.formula || v.sharedFormula) return { formula: String(v.formula || v.sharedFormula) };   // sin valor guardado (archivo bajado de la app y no abierto en Excel)
      else if (v.richText) v = v.richText.map(x => x.text).join('');
      else if ('text' in v) v = v.text;
      else if (v.error) v = null;
    }
    return v === undefined ? null : v;
  }
  const esFormula = (v) => !!(v && typeof v === 'object' && v.formula);
  const numX = (v) => { if (v === null || v === '' || v === undefined || esFormula(v)) return null; if (typeof v === 'number') return v; const n = pNum(v); return Number.isNaN(n) ? null : n; };

  function leerHoja(ws) {
    let filaEnc = null, mapa = null;
    for (let r = 1; r <= Math.min(ws.rowCount, 30) && !filaEnc; r++) {
      const fila = ws.getRow(r); const m = {};
      fila.eachCell({ includeEmpty: false }, (c, col) => {
        const t = sinAcento(valorCelda(c)).replace(/\s+/g, ' ');
        if (!t) return;
        for (const [re, k] of ENC) if (re.test(t) && !Object.values(m).includes(k)) { m[col] = k; break; }
      });
      if (Object.values(m).includes('cedula') && Object.values(m).includes('nombre')) { filaEnc = r; mapa = m; }
    }
    if (!filaEnc) return null;
    // título y mes ("PLANILLA DE SALARIO OPERADORES SEPTIEMBRE 2026")
    let titulo = '', mes = null, sm = null;
    for (let r = 1; r < filaEnc; r++) ws.getRow(r).eachCell((c) => {
      const v = valorCelda(c);
      if (typeof v === 'string' && /planilla/i.test(v) && !titulo) titulo = v.trim();
      if (typeof v === 'number' && sm === null && v > 1000000) sm = v;
    });
    const mm = new RegExp('(' + MESES.join('|') + ')\\s+(\\d{4})', 'i').exec(sinAcento(titulo).toUpperCase());
    if (mm) mes = `${mm[2]}-${String(MESES.indexOf(mm[1].toUpperCase()) + 1).padStart(2, '0')}`;
    const colLiq = Number(Object.keys(mapa).find(c => mapa[c] === '_liq') || 0);
    if (colLiq && !Object.values(mapa).includes('observacion')) mapa[colLiq + 1] = 'observacion';   // la columna sin título después del líquido
    const filas = [], avisos = []; let totalesExcel = null;
    for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
      const fila = ws.getRow(r); const o = {};
      Object.keys(mapa).forEach(col => { o[mapa[col]] = valorCelda(fila.getCell(Number(col))); });
      const primera = sinAcento(valorCelda(fila.getCell(1)));
      if (/^total/.test(primera)) { totalesExcel = o; break; }
      const ci = String(o.cedula ?? '').replace(/\D/g, '');
      if (!ci) { if (o.nombre) avisos.push(`Fila ${r}: «${o.nombre}» sin cédula (no se importa)`); continue; }
      const f = {
        nro: o.nro === null || o.nro === undefined ? null : String(o.nro).trim(), cedula: ci,
        nombre: String(o.nombre || '').replace(/\s+/g, ' ').trim(), categoria: o.categoria ? String(o.categoria).trim() : null,
        cargo: o.cargo ? String(o.cargo).trim() : null, local: o.local ? String(o.local).trim() : null,
        factor_sm: numX(o.factor_sm), salario_base: numX(o.salario_base), viatico_estipulado: numX(o.viatico_estipulado),
        dias_trabajados: numX(o.dias_trabajados), salario_cobrar: numX(o.salario_cobrar), viatico_cobrar: numX(o.viatico_cobrar),
        extras: numX(o.extras), hh: numX(o.hh), precio_hora: numX(o.precio_hora),
        anticipo: numX(o.anticipo), embargo: numX(o.embargo), descuentos: numX(o.descuentos), casino: numX(o.casino),
        observacion: o.observacion ? String(o.observacion).trim() : null
      };
      f.equipo = equipoDeCargo(f.cargo);
      const fi = pFecha(o.fecha_ingreso);
      if (fi === undefined) { avisos.push(`Fila ${r} (${f.nombre}): fecha de ingreso «${o.fecha_ingreso}» no se entiende; queda vacía`); f.fecha_ingreso = null; }
      else f.fecha_ingreso = fi;
      if (f.fecha_ingreso && typeof o.fecha_ingreso === 'string') avisos.push(`Fila ${r} (${f.nombre}): fecha de ingreso «${o.fecha_ingreso}» leída como ${fFecha(f.fecha_ingreso)}`);
      if (f.salario_cobrar === null && esFormula(o.salario_cobrar)) f.salario_cobrar = salarioCalc(f);
      // % IPS a partir del valor del Excel (o de la fórmula R8*9/100 si el archivo no tiene valores)
      const bruto = calc({ ...f, ips_pct: 0 }).bruto;
      const ips = numX(o._ips);
      if (esFormula(o._ips)) { const m = /\*\s*([\d.]+)\s*\/\s*100/.exec(o._ips.formula); f.ips_pct = m ? Number(m[1]) : 9; }
      else if (!ips) f.ips_pct = 0;
      else if (bruto > 0 && Math.abs(ips / bruto * 100 - 9) < 0.01) f.ips_pct = 9;
      else if (bruto > 0) { f.ips_pct = Math.round(ips / bruto * 100 * 10000) / 10000; avisos.push(`Fila ${r} (${f.nombre}): el IPS del Excel (${fGs(ips)}) no es el 9 % del bruto; se usa ${fNum(f.ips_pct, 4)} %`); }
      else f.ips_pct = 9;
      if (f.ips_pct === 0 && !esFormula(o._ips)) avisos.push(`Fila ${r} (${f.nombre}): sin IPS en el Excel → queda con 0 %`);
      if (f.factor_sm !== null && f.factor_sm > 3) avisos.push(`Fila ${r} (${f.nombre}): factor s/SM ${f.factor_sm} parece un error de tipeo`);
      const liqX = numX(o._liq);
      if (liqX !== null && Math.abs(calc(f).liq - liqX) > 1) avisos.push(`Fila ${r} (${f.nombre}): el líquido del Excel (${fGs(liqX)}) no da igual al calculado (${fGs(calc(f).liq)})`);
      filas.push(f);
    }
    // cédulas repetidas: queda el último renglón
    const vistos = new Map();
    filas.forEach((f, i) => { if (vistos.has(f.cedula)) avisos.push(`CI ${f.cedula} repetida (${filas[vistos.get(f.cedula)].nombre} / ${f.nombre}): queda el último renglón`); vistos.set(f.cedula, i); });
    const unicas = filas.filter((f, i) => vistos.get(f.cedula) === i);
    return { titulo, mes, sm, filas: unicas, avisos, totalesExcel };
  }

  function importarExcel() {
    if (S.sucio && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    const f = modal('Importar la planilla de Excel', `
      <p class="nota" style="margin-top:0">La planilla de RRHH (por ejemplo <b>SALARIO_OPERADORES_SEPTIEMBRE_2026.xlsx</b>): se busca la hoja con las columnas <i>Nº CI</i> y <i>Apellido y nombre</i>.
        Se ve todo antes de guardar.</p>
      <div class="form"><label class="ancho">Archivo<input type="file" id="im-arch" accept=".xlsx,.xlsm"></label></div>
      <div id="im-res"></div>`, '<button class="btn pri" id="im-ok" disabled>Cargar en pantalla</button>', true);
    let libro = null, hojas = [], elegida = null;
    const mostrar = () => {
      const h = elegida;
      const res = $('#im-res', f);
      if (!h) { res.innerHTML = '<div class="vacio">No se encontró ninguna hoja con las columnas Nº CI y Apellido y nombre.</div>'; $('#im-ok', f).disabled = true; return; }
      const t = h.filas.reduce((a, x) => { const c = calc(x); a.b += c.bruto; a.i += c.ips; a.l += c.liq; return a; }, { b: 0, i: 0, l: 0 });
      const tx = h.totalesExcel || {};
      const cmp = (calcV, exV) => numX(exV) === null ? fGs(calcV) : `${fGs(calcV)} ${Math.abs(calcV - numX(exV)) <= 2 ? '<span class="chip verde">= Excel</span>' : `<span class="chip rojo">Excel ${fGs(numX(exV))}</span>`}`;
      const existe = h.mes && S.planillas.find(p => p.mes === h.mes);
      // ¿El TOTALES del Excel deja afuera a la primera persona? (SUBTOTAL desde la fila 9)
      let notaTot = '';
      if (numX(tx._bruto) !== null && Math.abs(t.b - numX(tx._bruto)) > 2 && h.filas.length) {
        const p1 = calc(h.filas[0]);
        if (Math.abs(t.b - p1.bruto - numX(tx._bruto)) <= 2)
          notaTot = `<p class="nota">El total bruto e IPS de la fila TOTALES del Excel no incluyen a la primera persona (${esc(h.filas[0].nombre)}): la fórmula suma desde la fila siguiente. Los totales de la app sí la incluyen.</p>`;
      }
      res.innerHTML = `<div class="form" style="margin-top:10px">
          ${hojas.length > 1 ? `<label>Hoja<select id="im-hoja">${hojas.map((x, i) => `<option value="${i}" ${x === h ? 'selected' : ''}>${esc(x.nombre)} · ${x.filas.length} personas</option>`).join('')}</select></label>` : ''}
          <label>Mes de la planilla<input type="month" id="im-mes" value="${h.mes || ''}"></label>
          <label>Salario mínimo<input id="im-sm" value="${fGs(h.sm)}"></label>
          <label class="ancho">Título<input id="im-tit" value="${esc(h.titulo)}"></label></div>
        <div class="kpis" style="margin-top:12px">
          <div class="kpi"><span>Personas</span><b>${h.filas.length}</b></div>
          <div class="kpi"><span>Total bruto</span><b style="font-size:15px">${cmp(t.b, tx._bruto)}</b></div>
          <div class="kpi"><span>I.P.S.</span><b style="font-size:15px">${cmp(t.i, tx._ips)}</b></div>
          <div class="kpi"><span>Sueldo líquido</span><b style="font-size:15px">${cmp(t.l, tx._liq)}</b></div></div>
        ${notaTot}
        ${existe ? `<p class="chip ambar" style="display:block;white-space:normal;padding:8px 10px">Ya existe la planilla de ${nombreMes(h.mes)} (${existe.estado}). Al guardar se <b>reemplaza</b> entera por la del Excel.${existe.estado === 'cerrada' ? ' Está cerrada: primero hay que reabrirla.' : ''}</p>` : ''}
        ${h.avisos.length ? `<details ${h.avisos.length < 12 ? 'open' : ''}><summary><b>${h.avisos.length} avisos</b> para revisar</summary><ul class="lista-avisos">${h.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : '<p class="nota">Sin avisos.</p>'}`;
      $('#im-ok', f).disabled = false;
      const hs = $('#im-hoja', f); if (hs) hs.onchange = () => { elegida = hojas[Number(hs.value)]; mostrar(); };
    };
    $('#im-arch', f).onchange = async (e) => {
      const arch = e.target.files[0]; if (!arch) return;
      $('#im-res', f).innerHTML = '<div class="vacio">Leyendo…</div>';
      try {
        libro = new ExcelJS.Workbook();
        await libro.xlsx.load(await arch.arrayBuffer());
        hojas = [];
        libro.eachSheet(ws => { const h = leerHoja(ws); if (h && h.filas.length) { h.nombre = ws.name; hojas.push(h); } });
        // la del mes más nuevo primero
        hojas.sort((a, b) => String(b.mes || '').localeCompare(String(a.mes || '')));
        elegida = hojas[0] || null;
        mostrar();
      } catch (er) { $('#im-res', f).innerHTML = `<div class="vacio">No se pudo leer el archivo: ${esc(errMsg(er))}</div>`; }
    };
    $('#im-ok', f).onclick = () => {
      const h = elegida; if (!h) return;
      const mes = $('#im-mes', f).value;
      if (!/^\d{4}-\d{2}$/.test(mes)) return toast('Elegí el mes de la planilla', 'error');
      const existe = S.planillas.find(p => p.mes === mes);
      if (existe && existe.estado === 'cerrada') return toast('La planilla de ' + nombreMes(mes) + ' está cerrada: reabrila primero.', 'error');
      const sm = pNum($('#im-sm', f).value);
      S.mes = mes; S.nueva = !existe; S.version = existe ? existe.actualizado_en : null; S.estado = 'borrador';
      const per = periodoHH(mes);
      S.cab = { mes, titulo: $('#im-tit', f).value.trim() || null, salario_minimo: Number.isNaN(sm) ? null : sm, hh_desde: per.desde, hh_hasta: per.hasta, notas: null };
      S.filas = h.filas.map(x => ({ ...x }));
      S.hhPartes = null; S.sucio = true; S.fil = { q: '', local: '', grupo: '', solo: '' }; S.orden = { k: 'orden', asc: true };
      cerrarModal(); pintarPlanilla();
      toast(`Planilla de ${nombreMes(mes)} cargada en pantalla (${h.filas.length} personas). Revisá y tocá Guardar.`, 'ok');
    };
  }

  // ═════════════════════════════ BAJAR EXCEL ═════════════════════════════
  async function exportarExcel() {
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Tecsul · Recursos humanos';
      const ws = wb.addWorksheet(S.mes.slice(0, 4), { views: [{ state: 'frozen', xSplit: 3, ySplit: 7 }] });
      const enc = ['Nº', 'Nº CI', 'APELLIDO Y NOMBRE', 'CATEG.', 'FECHA DE INGRESO', 'CARGO', 'LOCAL', 'FACTOR S/ SM', 'SALARIO BASE', 'VIATICO ESTIPULADO',
        'DIAS TRABAJADOS', 'SALARIO A COBRAR', 'VIATICO A COBRAR', 'EXTRAS', 'HORAS HOMBRE CARGADAS', 'PRECIO POR HORAS', 'TOTAL HORAS ', 'TOTAL BRUTO',
        'I.P.S.', 'ANTICIPO', 'EMBARGO', 'DESCUENTOS', 'CASINO', 'SUELDO LIQUIDO', 'OBSERVACIÓN'];
      ws.mergeCells('A3:X3');
      ws.getCell('A3').value = S.cab.titulo || ('PLANILLA DE SALARIO OPERADORES ' + nombreMes(S.mes));
      ws.getCell('A3').font = { bold: true, size: 14 }; ws.getCell('A3').alignment = { horizontal: 'center' };
      if (!vacio(S.cab.salario_minimo)) { ws.getCell('H4').value = 'Salario mínimo'; ws.getCell('I4').value = Number(S.cab.salario_minimo); ws.getCell('I4').numFmt = '#,##0'; }
      const he = ws.getRow(7); he.values = enc;
      he.font = { bold: true, size: 9 }; he.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; he.height = 32;
      he.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; c.border = { bottom: { style: 'thin' } }; });
      const filas = S.filas;   // en el orden de la planilla (el de guardado)
      filas.forEach((f, j) => {
        const r = 8 + j; const row = ws.getRow(r);
        const sc = salarioCalc(f);
        const scManual = !vacio(f.salario_cobrar) && (sc === null || Math.abs(nz(f.salario_cobrar) - sc) >= 1);
        const num = (v) => vacio(v) ? null : Number(v);
        row.values = [/^\d+$/.test(String(f.nro ?? '')) ? Number(f.nro) : (f.nro || null), /^\d+$/.test(f.cedula) ? Number(f.cedula) : f.cedula, f.nombre, f.categoria, f.fecha_ingreso ? new Date(Date.UTC(+f.fecha_ingreso.slice(0, 4), +f.fecha_ingreso.slice(5, 7) - 1, +f.fecha_ingreso.slice(8, 10))) : null, f.cargo, f.local,
          num(f.factor_sm), num(f.salario_base), num(f.viatico_estipulado), num(f.dias_trabajados),
          scManual ? num(f.salario_cobrar) : { formula: `ROUND(I${r}*K${r}/30,0)` },
          num(f.viatico_cobrar), num(f.extras), num(f.hh), num(f.precio_hora),
          { formula: `+O${r}*P${r}` }, { formula: `L${r}+M${r}+N${r}+Q${r}` },
          nz(f.ips_pct) === 0 ? null : { formula: `R${r}*${nz(f.ips_pct)}/100` },
          num(f.anticipo), num(f.embargo), num(f.descuentos), num(f.casino),
          { formula: `R${r}-S${r}-T${r}-U${r}-V${r}-W${r}` }, f.observacion];
        row.getCell(5).numFmt = 'dd/mm/yyyy';
        [9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24].forEach(c => { row.getCell(c).numFmt = '#,##0'; });
        row.getCell(15).numFmt = '#,##0.##';
      });
      const rt = 8 + filas.length;
      const tot = ws.getRow(rt);
      tot.getCell(1).value = 'TOTALES';
      ['L', 'M', 'N', 'O', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'].forEach(L => { ws.getCell(`${L}${rt}`).value = { formula: `SUM(${L}8:${L}${rt - 1})` }; ws.getCell(`${L}${rt}`).numFmt = '#,##0'; });
      tot.font = { bold: true };
      [6, 6, 34, 12, 11, 24, 16, 8, 12, 11, 8, 12, 12, 11, 10, 10, 12, 13, 12, 11, 10, 11, 9, 13, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      // Categorías
      const wc = wb.addWorksheet('CATEGORÍAS');
      wc.addRow(['PUESTO', 'CATEGORÍA', 'SALARIO MÍNIMO', 'SALARIO MÁXIMO', 'HH MÍNIMO', 'HH MÁXIMO']).font = { bold: true };
      S.categorias.forEach(c => wc.addRow([c.grupo, c.nombre, c.salario_min, c.salario_max, c.hh_min, c.hh_max]));
      [16, 22, 15, 15, 11, 11].forEach((w, i) => { wc.getColumn(i + 1).width = w; });
      const buf = await wb.xlsx.writeBuffer();
      const [a, m] = S.mes.split('-');
      const nombre = `SALARIO_OPERADORES_${MESES[Number(m) - 1]}_${a}.xlsx`;
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const l = document.createElement('a'); l.href = url; l.download = nombre; document.body.appendChild(l); l.click(); l.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (S.sucio) toast('Ojo: el Excel tiene los cambios de pantalla, pero todavía no están guardados.', '');
    } catch (e) { toast('No se pudo armar el Excel: ' + errMsg(e), 'error'); }
  }

  // ═════════════════════════════ PERSONAL ═════════════════════════════
  async function cargarPersonal(silencio) {
    const r = await sb.from('rrhh_personal').select('*').order('nombre').limit(5000);
    if (r.error) { toast('No se pudo leer el legajo: ' + errMsg(r.error), 'error'); return; }
    S.personal = r.data || [];
    if (!silencio && S.vista === 'personal') pintarPersonal();
  }
  function antiguedad(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00'), h = new Date();
    let a = h.getFullYear() - d.getFullYear(), m = h.getMonth() - d.getMonth();
    if (h.getDate() < d.getDate()) m--;
    if (m < 0) { a--; m += 12; }
    return a > 0 ? `${a} a ${m} m` : `${m} m`;
  }
  function pintarPersonal() {
    const v = $('#v-personal');
    const F = S.persFil, q = sinAcento(F.q);
    const locales = [...new Set(S.personal.map(p => p.local).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const vis = S.personal.filter(p => (F.estado === 'todos' || (F.estado === 'activos') === !!p.activo)
      && (!F.local || p.local === F.local) && (!F.grupo || grupoDe(p.categoria, p.cargo) === F.grupo)
      && (!q || [p.nombre, p.cedula, p.cargo, p.categoria, p.equipo, p.local].some(x => sinAcento(x).includes(q))));
    v.innerHTML = `<div class="barra">
        <input class="inp busca" id="pe-q" placeholder="Buscar nombre, CI, cargo, máquina…" value="${esc(F.q)}">
        <select class="sel" id="pe-estado"><option value="activos" ${F.estado === 'activos' ? 'selected' : ''}>Activos</option><option value="bajas" ${F.estado === 'bajas' ? 'selected' : ''}>Bajas</option><option value="todos" ${F.estado === 'todos' ? 'selected' : ''}>Todos</option></select>
        <select class="sel" id="pe-grupo"><option value="">Todos los puestos</option>${['Choferes', 'Operadores', 'Mecánicos', 'Administración', 'Otros'].map(g => `<option ${g === F.grupo ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <select class="sel" id="pe-local"><option value="">Todos los locales</option>${locales.map(l => `<option ${l === F.local ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${edita() ? '<button class="btn" id="pe-nuevo">＋ Persona</button>' : ''}
        <span class="esp"></span><span class="nota">${vis.length} de ${S.personal.length}</span></div>
      <p class="nota" style="margin:0 0 8px">El legajo se actualiza solo con la última planilla guardada de cada persona. ${edita() ? 'Tocá una persona para corregir sus datos o darla de baja (no se copia a la planilla siguiente).' : ''}</p>
      <div class="tw"><table class="t"><thead><tr><th>CI</th><th class="fijo">Apellido y nombre</th><th>Categoría</th><th>Ingreso</th><th>Antigüedad</th><th>Cargo</th><th>Máquina</th><th>Local</th>
        <th class="n">Salario base</th><th class="n">Viático</th><th class="n">Precio/h</th><th>IPS</th><th>Última planilla</th><th>Estado</th><th>Observación</th></tr></thead><tbody>
      ${vis.map(p => `<tr data-ci="${esc(p.cedula)}" style="${edita() ? 'cursor:pointer' : ''}"><td>${esc(p.cedula)}</td><td class="fijo"><b>${esc(p.nombre)}</b></td><td>${esc(p.categoria || '')}</td>
        <td>${fFecha(p.fecha_ingreso)}</td><td>${antiguedad(p.fecha_ingreso)}</td><td>${esc(p.cargo || '')}</td><td>${esc(p.equipo || '')}</td><td>${esc(p.local || '')}</td>
        <td class="n">${fGs(p.salario_base)}</td><td class="n">${fGs(p.viatico)}</td><td class="n">${fGs(p.precio_hora)}</td><td>${p.aporta_ips ? 'Sí' : 'No'}</td>
        <td>${p.ultimo_mes ? nombreMes(p.ultimo_mes) : ''}</td><td>${p.activo ? '<span class="chip verde">Activo</span>' : `<span class="chip gris">Baja${p.fecha_baja ? ' ' + fFecha(p.fecha_baja) : ''}</span>`}</td>
        <td style="white-space:normal;min-width:160px">${esc(p.observacion || '')}</td></tr>`).join('') || '<tr><td colspan="15" class="vacio">Sin personas. Se cargan solas al guardar una planilla.</td></tr>'}
      </tbody></table></div>`;
    const fq = $('#pe-q'); fq.oninput = () => { F.q = fq.value; pintarPersonal(); const n = $('#pe-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    [['#pe-estado', 'estado'], ['#pe-grupo', 'grupo'], ['#pe-local', 'local']].forEach(([id, k]) => { $(id).onchange = () => { F[k] = $(id).value; pintarPersonal(); }; });
    if (edita()) {
      const nb = $('#pe-nuevo'); if (nb) nb.onclick = () => editarPersona(null);
      $$('#v-personal tbody tr[data-ci]').forEach(tr => tr.onclick = () => editarPersona(S.personal.find(p => p.cedula === tr.dataset.ci)));
    }
  }

  function editarPersona(p) {
    const n = !p; p = p || { activo: true, aporta_ips: true };
    const cats = S.categorias.map(c => c.nombre);
    const f = modal(n ? 'Nueva persona' : p.nombre, `<div class="form">
      <label>Cédula<input id="pe-ci" value="${esc(p.cedula || '')}" ${n ? '' : 'disabled'} inputmode="numeric"></label>
      <label>Apellido y nombre<input id="pe-nom" value="${esc(p.nombre || '')}"></label>
      <label>Categoría<select id="pe-cat"><option value=""></option>${(p.categoria && !cats.includes(p.categoria) ? [p.categoria] : []).concat(cats).map(c => `<option ${c === p.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>Fecha de ingreso<input type="date" id="pe-ing" value="${esc(p.fecha_ingreso || '')}"></label>
      <label>Cargo<input id="pe-cargo" value="${esc(p.cargo || '')}" placeholder="OPERADOR/EX 17"></label>
      <label>Máquina<input id="pe-eq" value="${esc(p.equipo || '')}" placeholder="EX-17"></label>
      <label>Local<input id="pe-local2" value="${esc(p.local || '')}"></label>
      <label>Factor s/SM<input id="pe-fac" value="${fNum(p.factor_sm, 4)}"></label>
      <label>Salario base (Gs)<input id="pe-sb" value="${fGs(p.salario_base)}"></label>
      <label>Viático estipulado (Gs)<input id="pe-via" value="${fGs(p.viatico)}"></label>
      <label>Precio por hora (Gs)<input id="pe-ph" value="${fGs(p.precio_hora)}"></label>
      <label>Aporta IPS<select id="pe-ips"><option value="1" ${p.aporta_ips ? 'selected' : ''}>Sí (9 %)</option><option value="0" ${p.aporta_ips ? '' : 'selected'}>No</option></select></label>
      <label>Estado<select id="pe-act"><option value="1" ${p.activo ? 'selected' : ''}>Activo</option><option value="0" ${p.activo ? '' : 'selected'}>Baja</option></select></label>
      <label>Fecha de baja<input type="date" id="pe-baja" value="${esc(p.fecha_baja || '')}"></label>
      <label class="ancho">Observación<textarea id="pe-obs" rows="2">${esc(p.observacion || '')}</textarea></label></div>`,
      '<button class="btn pri" id="pe-ok">Guardar</button>');
    $('#pe-act', f).onchange = () => { if ($('#pe-act', f).value === '0' && !$('#pe-baja', f).value) $('#pe-baja', f).value = isoDe(new Date()); };
    $('#pe-ok', f).onclick = async () => {
      const ci = ($('#pe-ci', f).value || '').replace(/\D/g, '');
      const nom = $('#pe-nom', f).value.trim().toUpperCase();
      if (!ci || !nom) return toast('Falta la cédula o el nombre', 'error');
      if (n && S.personal.some(x => x.cedula === ci)) return toast('Esa cédula ya está en el legajo', 'error');
      const num = (id) => { const x = pNum($(id, f).value); return Number.isNaN(x) ? undefined : x; };
      const d = {
        cedula: ci, nombre: nom, categoria: $('#pe-cat', f).value || null, fecha_ingreso: $('#pe-ing', f).value || null,
        cargo: $('#pe-cargo', f).value.trim() || null, equipo: $('#pe-eq', f).value.trim().toUpperCase() || null, local: $('#pe-local2', f).value.trim() || null,
        factor_sm: num('#pe-fac'), salario_base: num('#pe-sb'), viatico: num('#pe-via'), precio_hora: num('#pe-ph'),
        aporta_ips: $('#pe-ips', f).value === '1', activo: $('#pe-act', f).value === '1',
        fecha_baja: $('#pe-act', f).value === '1' ? null : ($('#pe-baja', f).value || null),
        observacion: $('#pe-obs', f).value.trim() || null, actualizado_en: new Date().toISOString(), actualizado_por: S.yo
      };
      if ([d.factor_sm, d.salario_base, d.viatico, d.precio_hora].includes(undefined)) return toast('Hay un número mal escrito', 'error');
      const r = n ? await sb.from('rrhh_personal').insert(d) : await sb.from('rrhh_personal').update(d).eq('cedula', ci);
      if (r.error) return toast('No se guardó: ' + errMsg(r.error), 'error');
      cerrarModal(); toast('Guardado', 'ok'); cargarPersonal();
    };
  }

  // ═════════════════════════════ CATEGORÍAS ═════════════════════════════
  async function cargarCategorias() {
    const r = await sb.from('rrhh_categorias').select('*').order('orden').order('nombre');
    if (r.error) { toast('No se pudieron leer las categorías: ' + errMsg(r.error), 'error'); return; }
    S.categorias = r.data || [];
    S.catBorradas = [];
  }
  function pintarCategorias() {
    const v = $('#v-categorias'); const ed = edita();
    const inp = (i, k, val, tipo) => ed ? `<input class="c${tipo === 'txt' ? ' txt' : ''}" data-i="${i}" data-k="${k}" value="${esc(tipo === 'txt' ? (val ?? '') : fGs(val))}">` : esc(tipo === 'txt' ? (val ?? '') : fGs(val));
    v.innerHTML = `<div class="barra">${ed ? '<button class="btn" id="ca-nueva">＋ Categoría</button>' : ''}<span class="esp"></span>
        ${ed ? `<button class="btn nar" id="ca-guardar" ${S.catSucio ? '' : 'disabled'}>Guardar categorías</button>` : ''}</div>
      <p class="nota" style="margin:0 0 8px">En la planilla se marca con ⚠ (sin bloquear) un precio de la hora fuera del rango de su categoría y un salario base menor al salario mínimo de la planilla.</p>
      <div class="tw" style="max-width:980px"><table class="t"><thead><tr><th>Puesto</th><th>Categoría</th><th class="n">Salario mínimo</th><th class="n">Salario máximo</th><th class="n">HH mínimo (Gs/h)</th><th class="n">HH máximo (Gs/h)</th><th class="n">Orden</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
      ${S.categorias.map((c, i) => `<tr><td>${inp(i, 'grupo', c.grupo, 'txt')}</td><td>${inp(i, 'nombre', c.nombre, 'txt')}</td><td class="n">${inp(i, 'salario_min', c.salario_min)}</td><td class="n">${inp(i, 'salario_max', c.salario_max)}</td>
        <td class="n">${inp(i, 'hh_min', c.hh_min)}</td><td class="n">${inp(i, 'hh_max', c.hh_max)}</td><td class="n">${inp(i, 'orden', c.orden)}</td>${ed ? `<td><button class="x" data-q="${i}" title="Quitar">×</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
    if (!ed) return;
    $('#ca-nueva').onclick = () => { S.categorias.push({ grupo: 'Operadores', nombre: '', orden: S.categorias.length + 1, _nueva: true }); S.catSucio = true; pintarCategorias(); };
    $('#ca-guardar').onclick = guardarCategorias;
    $$('#v-categorias input.c').forEach(el => el.onchange = () => {
      const c = S.categorias[Number(el.dataset.i)], k = el.dataset.k;
      if (['grupo', 'nombre'].includes(k)) c[k] = el.value.trim();
      else { const n = pNum(el.value); if (Number.isNaN(n)) { toast('Número no válido', 'error'); el.value = fGs(c[k]); return; } c[k] = n; el.value = fGs(n); }
      S.catSucio = true; $('#ca-guardar').disabled = false;
    });
    $$('#v-categorias [data-q]').forEach(b => b.onclick = () => {
      const c = S.categorias[Number(b.dataset.q)];
      if (!confirm(`¿Quitar la categoría «${c.nombre || '(sin nombre)'}»? Las planillas no cambian.`)) return;
      if (!c._nueva && c._orig !== undefined) S.catBorradas.push(c._orig);
      else if (!c._nueva) S.catBorradas.push(c.nombre);
      S.categorias.splice(Number(b.dataset.q), 1); S.catSucio = true; pintarCategorias();
    });
  }
  async function guardarCategorias() {
    const nombres = S.categorias.map(c => c.nombre.trim());
    if (nombres.some(x => !x)) return toast('Hay categorías sin nombre', 'error');
    if (new Set(nombres.map(sinAcento)).size !== nombres.length) return toast('Hay categorías repetidas', 'error');
    // renombradas = borrar la vieja + insertar la nueva
    const r0 = await sb.from('rrhh_categorias').select('nombre');
    if (r0.error) return toast(errMsg(r0.error), 'error');
    const quedan = new Set(nombres);
    const borrar = (r0.data || []).map(x => x.nombre).filter(x => !quedan.has(x));
    if (borrar.length) { const d = await sb.from('rrhh_categorias').delete().in('nombre', borrar); if (d.error) return toast('No se guardó: ' + errMsg(d.error), 'error'); }
    const filas = S.categorias.map(c => ({ nombre: c.nombre.trim(), grupo: c.grupo || 'Otros', salario_min: c.salario_min ?? null, salario_max: c.salario_max ?? null,
      hh_min: c.hh_min ?? null, hh_max: c.hh_max ?? null, orden: Math.round(nz(c.orden)), actualizado_en: new Date().toISOString(), actualizado_por: S.yo }));
    const r = await sb.from('rrhh_categorias').upsert(filas, { onConflict: 'nombre' });
    if (r.error) return toast('No se guardó: ' + errMsg(r.error), 'error');
    S.catSucio = false; toast('Categorías guardadas', 'ok');
    await cargarCategorias(); pintarCategorias();
  }
})();
