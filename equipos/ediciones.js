// ══════════════════════════════════════════════════════════════════
// HISTORIAL DE EDICIONES — Historial de partes › «Historial de ediciones»
// Tecsul S.A.E. · v20261113c (equipos-v118, SQL 115)
//
// Todo cambio a un parte diario queda en log_ediciones (disparador de la
// base): quién, cuándo, y el parte entero antes y después. Esta solapa lo
// muestra por campo: «Obra: Abasto → CECON», para saber quién corrigió qué.
//   · Personas (app): cambios hechos por un usuario en la app.
//   · JotForm / sistema: la sincronización de JotForm (cada hora) o un
//     script de la base; no tienen usuario.
// Lo ven admin central, gerente y admin de obra (este, solo sus obras).
// También agrega «Ediciones de este parte» al detalle del parte.
// ══════════════════════════════════════════════════════════════════
window.Ediciones = (() => {
  const ROLES = ['admin_central', 'gerente', 'admin_obra'];
  const hoy = () => (typeof hoyISO === 'function' ? hoyISO() : new Date().toISOString().slice(0, 10));
  const menosDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const st = {
    desde: menosDias(7), hasta: hoy(), quien: 'app', usuario: '', campo: '', q: '',
    sinFotos: true, datos: [], cargando: false, error: '', traido: ''
  };
  const e = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fc = (f) => (typeof fechaCorta === 'function' ? fechaCorta(f) : String(f || ''));
  const p2 = n => String(n).padStart(2, '0');
  const fh = (f) => {
    if (!f) return '';
    const d = new Date(f); if (isNaN(d)) return String(f);
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  const rol = () => ((typeof sesion !== 'undefined' && sesion) || {}).rol;
  const puedeVer = () => ROLES.includes(rol());

  const ETIQ = {
    fecha: 'Fecha', equipo_id: 'Equipo', operador_cedula: 'Operador', propietario: 'Propietario',
    obra_clave: 'Obra', inicio_turno: 'Inicio de turno', fin_turno: 'Fin de turno',
    horometro_inicial: 'Horómetro inicial', horometro_final: 'Horómetro final',
    km_inicial: 'Km inicial', km_final: 'Km final',
    horas_hombre_reportada: 'Horas hombre (reportadas)', horas_horometro_reportada: 'Horas máquina (reportadas)',
    horas_totales: 'Horas totales', horas_traslado: 'Horas traslado', horas_paro: 'Horas paro',
    tiene_falla: '¿Tuvo falla?', tipo_falla: 'Tipo de falla', descripcion_falla: 'Descripción de falla',
    fallas: 'Falla(s)', falla_impidio_trabajo: '¿La falla impidió el trabajo?',
    actividad_dia: 'Actividad del día', detalle_actividad: 'Detalle de actividad (ítems)',
    observaciones: 'Observaciones', combustible: 'Combustible', toneladas_asfalto: 'Toneladas asfalto',
    piedras_trituradas: 'Piedras trituradas', m3_hormigon: 'M3 hormigón', cantidad_viajes: 'Cantidad de viajes',
    viajes: 'Viajes', tipo_registro: 'Tipo de registro', extras: 'Otros datos',
    img_horometro: 'Foto del horómetro', img_adjunto: 'Foto adjunta', img_parte_papel: 'Foto del parte en papel',
    firma: 'Firma', usuario_id: 'Cargado por (usuario)', client_id: 'ID del parte', submission_id: 'ID JotForm',
    origen: 'Origen', creado_en: 'Cargado el'
  };
  const FOTOS = ['img_horometro', 'img_adjunto', 'img_parte_papel', 'firma'];
  const etiq = (k) => ETIQ[k] || k;

  const obraTxt = (o) => {
    if (!o) return '—';
    const [cod, ...r] = String(o).split('_');
    return r.length ? `${r.join('_')} (${cod})` : String(o);
  };
  function operador(ced) {
    if (!ced) return '—';
    const o = ((typeof cat !== 'undefined' && cat && cat.operadores) || []).find(x => String(x.v) === String(ced));
    return o ? `${String(o.t).split('_').slice(1).join('_') || o.t} (${ced})` : String(ced);
  }
  // Valor de un campo, en texto
  function valor(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'obra_clave') return obraTxt(v);
    if (k === 'operador_cedula') return operador(v);
    if (k === 'fecha') return fc(v);
    if (k === 'inicio_turno' || k === 'fin_turno' || k === 'creado_en') return fh(v);
    if (k === 'tiene_falla') return v ? 'Sí' : 'No';
    if (typeof v === 'number') return v.toLocaleString('es-PY', { maximumFractionDigits: 2 });
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).replace(/\r\n/g, '\n');
  }
  // Un cambio en HTML: «Obra: A → B». Fotos: enlaces.
  function cambioHTML(c) {
    const k = c.campo;
    if (FOTOS.includes(k)) {
      const link = (u, t) => /^https?:/i.test(String(u || '')) ? `<a href="${e(u)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${t}</a>` : (u ? e(String(u)).slice(0, 30) : '—');
      return `<div class="ed-cambio"><b>${e(etiq(k))}:</b> ${link(c.antes, 'antes')} → ${link(c.despues, 'después')}</div>`;
    }
    const a = valor(k, c.antes), d = valor(k, c.despues);
    const largo = a.length > 90 || d.length > 90;
    if (largo) {
      return `<div class="ed-cambio"><b>${e(etiq(k))}:</b>
        <div class="ed-largo"><span class="ed-antes">${e(a)}</span></div>
        <div class="ed-largo"><span class="ed-despues">${e(d)}</span></div></div>`;
    }
    return `<div class="ed-cambio"><b>${e(etiq(k))}:</b> <span class="ed-antes">${e(a)}</span> → <span class="ed-despues">${e(d)}</span></div>`;
  }
  const soloFotos = (r) => (r.cambios || []).every(c => FOTOS.includes(c.campo));

  function estilos() {
    if (document.getElementById('ed-estilos')) return;
    const s = document.createElement('style');
    s.id = 'ed-estilos';
    s.textContent = `
      .ed-cambio { margin: 2px 0; line-height: 1.35; }
      .ed-antes { color: #b42318; text-decoration: line-through; text-decoration-color: rgba(180,35,24,.45); }
      .ed-despues { color: #067647; font-weight: 600; }
      .ed-largo { white-space: pre-line; font-size: .92em; margin: 2px 0 2px 10px; }
      .ed-quien-sis { color: var(--gris-texto); font-style: italic; }
      .hist-table td.ed-cambios { min-width: 320px; max-width: 560px; white-space: normal; }
      .ed-det { border-top: 1px solid var(--gris-borde, #e5e7eb); margin-top: 10px; padding-top: 8px; }
      .ed-det-item { padding: 6px 0; border-bottom: 1px dashed var(--gris-borde, #e5e7eb); font-size: .95em; }`;
    document.head.appendChild(s);
  }

  // ── Datos ────────────────────────────────────────────────────────
  async function traer(params) {
    const { data, error } = await sb.rpc('partes_ediciones', params);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function abrir(forzar) {
    estilos();
    const clave = `${st.desde}|${st.hasta}`;
    if (!forzar && st.traido === clave && st.datos.length) { pintar(); return; }
    st.cargando = true; st.error = '';
    pintar();
    try {
      st.datos = await traer({ p_desde: st.desde || null, p_hasta: st.hasta || null, p_limite: 5000 });
      st.traido = clave;
    } catch (err) { st.error = err.message || String(err); st.datos = []; }
    st.cargando = false;
    pintar();
  }

  function filas() {
    const q = st.q.trim().toLowerCase();
    return st.datos.filter(r => {
      if (st.quien !== 'todos' && r.quien !== st.quien) return false;
      if (st.usuario && (r.usuario || '') !== st.usuario) return false;
      if (st.campo && !(r.cambios || []).some(c => c.campo === st.campo)) return false;
      if (st.sinFotos && soloFotos(r)) return false;
      if (q) {
        const txt = [r.equipo_id, r.obra_clave, r.obra_antes, r.usuario, r.client_id, r.submission_id, r.parte_id,
          ...(r.cambios || []).map(c => `${etiq(c.campo)} ${valor(c.campo, c.antes)} ${valor(c.campo, c.despues)}`)]
          .join(' ').toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }

  // ── Pantalla ─────────────────────────────────────────────────────
  function pintar(soloTabla) {
    const caja = $('ediciones-contenido');
    if (!caja) return;
    if (!soloTabla) {
      const btn = (v, t) => `<button class="btn-filtro${st.quien === v ? ' exportar' : ''}" onclick="Ediciones.set('quien','${v}')">${t}</button>`;
      const usuarios = [...new Set(st.datos.filter(r => r.usuario).map(r => r.usuario))].sort();
      const campos = [...new Set(st.datos.flatMap(r => (r.cambios || []).map(c => c.campo)))]
        .sort((a, b) => etiq(a).localeCompare(etiq(b)));
      caja.innerHTML = `<div class="filtros">
          <div class="filtro"><label>Editado desde</label><input type="date" value="${e(st.desde)}" onchange="Ediciones.set('desde',this.value)"></div>
          <div class="filtro"><label>Hasta</label><input type="date" value="${e(st.hasta)}" onchange="Ediciones.set('hasta',this.value)"></div>
          <div class="filtro"><label>Quién</label><div style="display:flex;gap:6px;flex-wrap:wrap">${btn('app', 'Personas (app)')}${btn('sistema', 'JotForm / sistema')}${btn('todos', 'Todos')}</div></div>
          <div class="filtro"><label>Usuario</label><select onchange="Ediciones.set('usuario',this.value)">
            <option value="">Todos</option>${usuarios.map(u => `<option${u === st.usuario ? ' selected' : ''}>${e(u)}</option>`).join('')}</select></div>
          <div class="filtro"><label>Campo cambiado</label><select onchange="Ediciones.set('campo',this.value)">
            <option value="">Todos</option>${campos.map(c => `<option value="${e(c)}"${c === st.campo ? ' selected' : ''}>${e(etiq(c))}</option>`).join('')}</select></div>
          <div class="filtro crece"><label>Buscar</label><input type="text" id="ed-q" value="${e(st.q)}" placeholder="Equipo, obra, usuario, ID del parte..." oninput="Ediciones.buscar(this.value)"></div>
          <div class="filtro"><label>&nbsp;</label><label style="display:flex;gap:6px;align-items:center;font-weight:normal;white-space:nowrap">
            <input type="checkbox" ${st.sinFotos ? 'checked' : ''} onchange="Ediciones.set('sinFotos',this.checked)"> Ocultar cambios solo de fotos / firma</label></div>
          <div class="filtro"><label>&nbsp;</label><div style="display:flex;gap:6px">
            <button class="btn-filtro" onclick="Ediciones.abrir(true)">Actualizar</button>
            <button class="btn-filtro exportar" onclick="Ediciones.exportar()">Exportar</button></div></div>
        </div>
        <div class="hist-info">Cada cambio a un parte diario: quién lo hizo, cuándo y qué campos cambió (<span class="ed-antes">antes</span> → <span class="ed-despues">después</span>).
          «JotForm / sistema» son las correcciones que trae la sincronización de JotForm (cada hora) o un ajuste de la base.
          Un parte de JotForm que alguien corrigió en la app ya no lo pisa JotForm: manda la app. Tocá una fila para abrir el parte.</div>
        <div id="ediciones-tabla"></div>`;
    }
    const t = $('ediciones-tabla');
    if (st.cargando) { t.innerHTML = '<div class="empty-state">Cargando...</div>'; return; }
    if (st.error) {
      t.innerHTML = `<div class="empty-state">No se pudo cargar: ${e(st.error)}<br><small>¿Se corrió el SQL 115?</small></div>`;
      return;
    }
    const l = filas();
    if (!l.length) { t.innerHTML = '<div class="empty-state">No hay ediciones con ese filtro</div>'; return; }
    const tope = 500;
    t.innerHTML = `<div class="hist-info"><b>${l.length}</b> ${l.length === 1 ? 'edición' : 'ediciones'}${l.length > tope ? ` (se muestran las ${tope} más recientes; exportá para ver todas)` : ''}
        · ${new Set(l.map(r => r.parte_id)).size} partes</div>
      <div class="hist-table-wrap"><table class="hist-table"><thead><tr>
        <th>Editado el</th><th>Quién</th><th>Parte</th><th>Obra</th><th>Qué cambió</th><th>Origen</th></tr></thead><tbody>
      ${l.slice(0, tope).map((r, i) => `<tr onclick="Ediciones.ver(${i})" style="cursor:pointer">
        <td style="white-space:nowrap">${fh(r.momento)}</td>
        <td>${r.quien === 'app' ? `<b>${e(r.usuario || '')}</b>` : '<span class="ed-quien-sis">JotForm / sistema</span>'}</td>
        <td style="white-space:nowrap"><span class="tag">${e(r.equipo_id || '')}</span> ${fc(r.parte_fecha)}${r.existe ? '' : ' <small style="color:var(--rojo)">(borrado)</small>'}</td>
        <td class="larga">${e(obraTxt(r.obra_clave))}</td>
        <td class="ed-cambios">${(r.cambios || []).map(cambioHTML).join('')}</td>
        <td>${e(r.parte_origen === 'jotform' ? 'JotForm' : r.parte_origen === 'pwa' ? 'App' : (r.parte_origen || ''))}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function set(k, v) {
    st[k] = v;
    if (k === 'desde' || k === 'hasta') return abrir(true);
    pintar();
  }
  let tq = null;
  function buscar(v) { st.q = v; clearTimeout(tq); tq = setTimeout(() => pintar(true), 200); }

  // Abrir el parte en el detalle de siempre
  async function ver(i) {
    const r = filas()[i];
    if (!r) return;
    if (!r.existe) return toast('Ese parte ya fue borrado (puede estar en la papelera)', 'warning');
    try {
      const { data, error } = await sb.from('partes').select(COLS_PARTE).eq('id', r.parte_id).limit(1);
      if (error) throw error;
      if (!data || !data.length) return toast('No se encontró el parte', 'warning');
      verDetalleParte(armarFilasHist(data)[0]);
    } catch (err) { toast('No se pudo abrir el parte: ' + (err.message || err), 'error'); }
  }

  function exportar() {
    const l = filas();
    const enc = ['Editado el', 'Quién', 'Usuario', 'Fecha del parte', 'Equipo', 'Obra (después)', 'Obra (antes)',
      'Campo', 'Antes', 'Después', 'Origen del parte', 'ID del parte', 'ID JotForm', 'Parte borrado'];
    const out = [];
    l.forEach(r => (r.cambios || []).forEach(c => out.push([
      fh(r.momento), r.quien === 'app' ? 'Persona (app)' : 'JotForm / sistema', r.usuario || '',
      r.parte_fecha || '', r.equipo_id || '', r.obra_clave || '', r.obra_antes || '',
      etiq(c.campo), valor(c.campo, c.antes), valor(c.campo, c.despues),
      r.parte_origen || '', r.client_id || r.parte_id, r.submission_id || '', r.existe ? 'no' : 'sí'])));
    exportarTabla(`ediciones_partes_${st.desde || 'inicio'}_${st.hasta || hoy()}`, enc, out);
  }

  // ── En el detalle del parte: «Ediciones de este parte» ───────────
  async function enDetalle(p) {
    const viejo = $('ed-det'); if (viejo) viejo.remove();
    if (!puedeVer() || !p || !p.id || !/^[0-9a-f-]{36}$/i.test(String(p.id))) return;
    estilos();
    const body = $('detalle-body');
    const caja = document.createElement('div');
    caja.id = 'ed-det'; caja.className = 'ed-det';
    caja.innerHTML = '<label style="font-weight:600">Ediciones de este parte</label><div class="ayuda">Buscando...</div>';
    body.appendChild(caja);
    try {
      const l = await traer({ p_parte: p.id, p_limite: 200 });
      if (!document.body.contains(caja)) return;
      const tit = `<label style="font-weight:600">Ediciones de este parte (${l.length})</label>`;
      if (!l.length) { caja.innerHTML = tit + '<div class="ayuda">Nunca se editó: está como se cargó.</div>'; return; }
      caja.innerHTML = tit + l.map(r => `<div class="ed-det-item">
          <div><b>${fh(r.momento)}</b> · ${r.quien === 'app' ? e(r.usuario || '') : '<span class="ed-quien-sis">JotForm / sistema</span>'}</div>
          ${(r.cambios || []).map(cambioHTML).join('')}</div>`).join('');
    } catch (err) {
      if (document.body.contains(caja)) caja.innerHTML = '<label style="font-weight:600">Ediciones de este parte</label>'
        + `<div class="ayuda">No se pudo cargar (${e(err.message || err)}). ¿Se corrió el SQL 115?</div>`;
    }
  }

  return { abrir, set, buscar, ver, exportar, enDetalle, puedeVer };
})();
