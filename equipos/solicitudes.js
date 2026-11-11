// ══════════════════════════════════════════════════════════════════
// PARTES CERTIFICADOS — bloqueo y solicitudes de edición / eliminación
// Tecsul S.A.E. · v20261111d (equipos-v102, SQL 106)
//
// Un parte diario que cae en un certificado de máquinas EMITIDO (misma obra
// y fecha dentro del período) no lo edita ni lo borra nadie. Desde el
// detalle del parte se pide «Solicitar edición» o «Solicitar eliminación»
// con el motivo; lo aprueba un aprobador central (José, Peter o Margaret,
// tabla partes_aprobadores). Aprobada: vale 72 h y para un solo cambio, y
// la puede usar quien la pidió o un aprobador.
//
// El control de verdad está en la base (disparador trg_a_parte_bloqueo_cert):
// acá solo se muestran los botones que corresponden y la lista.
// Historial de partes › «Solicitudes de edición».
// ══════════════════════════════════════════════════════════════════
window.SolEd = (() => {
  const st = {
    activo: false,          // false si no se corrió el SQL 106
    periodos: [],           // [{obra_clave, desde, hasta, numero, serie}]
    abiertas: [],           // solicitudes pendientes / aprobadas vigentes que veo
    aprobador: false,
    filtro: 'abiertas', lista: [], cargando: false, error: '', q: ''
  };
  const e = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fc = (f) => (typeof fechaCorta === 'function' ? fechaCorta(f) : String(f || ''));
  const fh = (f) => {
    if (!f) return '';
    const d = new Date(f); if (isNaN(d)) return String(f);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const rol = () => ((typeof sesion !== 'undefined' && sesion) || {}).rol;
  const obraCorta = (o) => String(o || '').replace(/^[0-9A-Z]+_/, '');
  const VIGENCIA_H = 72;

  // ── Datos ────────────────────────────────────────────────────────
  async function iniciar() {
    try {
      const [p, a, s] = await Promise.all([
        sb.rpc('partes_periodos_certificados'),
        sb.rpc('es_aprobador_partes'),
        sb.rpc('partes_solicitudes_lista', { p_estado: 'abiertas' })
      ]);
      if (p.error) throw p.error;
      st.periodos = p.data || [];
      st.aprobador = !a.error && a.data === true;
      st.abiertas = (!s.error && s.data) || [];
      st.activo = true;
    } catch (err) {
      st.activo = false;   // sin el SQL 106: la app sigue como antes
      const b = $('hs-solicitudes'); if (b) b.style.display = 'none';
      return;
    }
    const b = $('hs-solicitudes'); if (b) b.style.display = '';
    contar();
    // Si la tabla ya estaba pintada, que aparezcan los candados
    if (typeof histDatos !== 'undefined' && histDatos.length && typeof filtrarHistorial === 'function') filtrarHistorial();
  }

  async function refrescarAbiertas() {
    if (!st.activo) return;
    const { data, error } = await sb.rpc('partes_solicitudes_lista', { p_estado: 'abiertas' });
    if (!error) st.abiertas = data || [];
    contar();
  }

  // Certificado emitido que bloquea este parte (o null)
  function certDe(p) {
    if (!st.activo || !p || !p.fecha) return null;
    const f = String(p.fecha).slice(0, 10);
    return st.periodos.find(c => c.obra_clave === p.obra_clave && f >= c.desde && f <= c.hasta) || null;
  }
  const textoCert = (c) => `${c.serie ? c.serie + ' ' : ''}N° ${c.numero} (${fc(c.desde)} – ${fc(c.hasta)})`;

  function vigente(s) {
    return s.estado === 'aprobada' && !s.vencida
      && (Date.now() - new Date(s.resuelto_en).getTime()) < VIGENCIA_H * 3600000;
  }
  function abiertaDe(p, tipo) { return st.abiertas.find(s => s.parte_id === p.id && s.tipo === tipo) || null; }
  // ¿Puedo usar ahora una aprobación de este tipo? (la pedí yo, o soy aprobador)
  function puedoUsar(p, tipo) {
    const s = abiertaDe(p, tipo);
    return !!(s && vigente(s) && (s.es_mia || st.aprobador));
  }

  // Marca para la columna Fecha del historial
  function marca(p) { return certDe(p) ? ' <span title="En un certificado de máquinas emitido: no se edita sin aprobación">🔒</span>' : ''; }

  // ── Detalle del parte ────────────────────────────────────────────
  // Lo llama verDetalle() después de pintar. Decide los botones Editar / Borrar.
  function ajustarDetalle(p, puedeEditarNormal, puedeBorrarNormal) {
    const bE = $('btn-editar-parte'), bB = $('btn-borrar-parte');
    const c = certDe(p);
    const viejo = $('sol-caja'); if (viejo) viejo.remove();
    if (!c) return;   // sin certificado: como siempre

    const okE = puedoUsar(p, 'editar'), okB = puedoUsar(p, 'eliminar');
    bE.style.display = okE ? '' : 'none';
    bB.style.display = okB ? '' : 'none';

    const sE = abiertaDe(p, 'editar'), sB = abiertaDe(p, 'eliminar');
    const estado = (s, t) => {
      if (!s) return '';
      if (s.estado === 'pendiente') return `<div>⏳ Solicitud de ${t} <b>pendiente</b> (${e(s.solicitado_nombre || '')}, ${fh(s.solicitado_en)}).
        ${s.es_mia ? `<button type="button" class="btn-mini btn-neutro" onclick="SolEd.cancelar(${s.id})">Cancelar</button>` : ''}</div>`;
      if (vigente(s)) return `<div>✅ Solicitud de ${t} <b>aprobada</b> por ${e(s.resuelto_nombre || '')} — vale para un solo cambio hasta el
        ${fh(new Date(new Date(s.resuelto_en).getTime() + VIGENCIA_H * 3600000))}${(s.es_mia || st.aprobador) ? '' : ' (la usa quien la pidió)'}.</div>`;
      return '';
    };
    // Pedir: edición cualquiera que vea el parte; eliminación quien normalmente borra o administra la obra
    const puedePedirB = ['admin_central', 'admin_obra'].includes(rol()) || puedeBorrarNormal;
    const botones = [];
    if (!sE) botones.push(`<button type="button" class="btn-mini btn-neutro" onclick="SolEd.pedir('editar')">✏️ Solicitar edición</button>`);
    if (!sB && puedePedirB) botones.push(`<button type="button" class="btn-mini btn-off" onclick="SolEd.pedir('eliminar')">🗑 Solicitar eliminación</button>`);

    const caja = document.createElement('div');
    caja.id = 'sol-caja';
    caja.className = 'salto-box show';
    caja.style.marginBottom = '12px';
    caja.innerHTML = `🔒 <b>Parte certificado</b>: está en el certificado de máquinas emitido <b>${e(textoCert(c))}</b>.
      No se puede editar ni eliminar sin la aprobación de José, Peter o Margaret.
      ${estado(sE, 'edición')}${estado(sB, 'eliminación')}
      ${botones.length ? `<div class="salto-ops" style="margin-top:8px">${botones.join('')}</div>` : ''}
      ${okE ? '<div class="ayuda" style="margin-top:6px">Si la corrección cambia horas o días, el certificado emitido no cambia solo: hay que reabrirlo y volver a emitirlo.</div>' : ''}`;
    const body = $('detalle-body');
    body.insertBefore(caja, body.firstChild);
  }

  // ── Pedir ────────────────────────────────────────────────────────
  async function pedir(tipo) {
    const p = typeof parteEnDetalle !== 'undefined' ? parteEnDetalle : null;
    if (!p) return;
    if (!enLinea) return toast('Necesitás señal para enviar la solicitud', 'warning');
    const t = tipo === 'editar' ? 'edición' : 'eliminación';
    const motivo = prompt(`Solicitud de ${t} del parte ${p.equipo_id} · ${fc(p.fecha)}\n\n`
      + (tipo === 'editar' ? 'Qué hay que corregir y por qué (ej.: horómetro final era 4.152,3; foto del tablero):'
                           : 'Por qué hay que eliminarlo (ej.: parte duplicado del mismo turno):'));
    if (motivo === null) return;
    if (motivo.trim().length < 5) return toast('Escribí el motivo (qué y por qué)', 'warning');
    mostrarCarga('Enviando solicitud...');
    try {
      const { error } = await sb.rpc('parte_solicitar', { p_parte: p.id, p_tipo: tipo, p_motivo: motivo.trim() });
      if (error) throw error;
      await refrescarAbiertas();
      ocultarCarga();
      toast(`Solicitud de ${t} enviada. La aprueba José, Peter o Margaret.`, 'success');
      if (typeof verDetalleParte === 'function') verDetalleParte(p);
    } catch (err) {
      ocultarCarga();
      toast(err.message || String(err), 'error');
    }
  }

  async function cancelar(id) {
    if (!confirm('¿Cancelar la solicitud?')) return;
    mostrarCarga('Cancelando...');
    try {
      const { error } = await sb.rpc('parte_solicitud_cancelar', { p_id: id });
      if (error) throw error;
      await refrescarAbiertas();
      ocultarCarga();
      toast('Solicitud cancelada', 'success');
      const p = typeof parteEnDetalle !== 'undefined' ? parteEnDetalle : null;
      if (p && $('modal-detalle').classList.contains('show') && typeof verDetalleParte === 'function') verDetalleParte(p);
      if ($('hist-vista-solicitudes') && $('hist-vista-solicitudes').style.display !== 'none') abrir();
    } catch (err) { ocultarCarga(); toast(err.message || String(err), 'error'); }
  }

  // Después de guardar o borrar con una aprobación: queda usada
  function usada() { refrescarAbiertas(); }

  // ── Solapa «Solicitudes de edición» ──────────────────────────────
  function contar() {
    const el = $('hs-solicitudes-n');
    if (!el) return;
    const n = st.abiertas.filter(s => s.estado === 'pendiente').length;
    el.textContent = n ? `(${n})` : '';
    el.style.color = n && st.aprobador ? 'var(--rojo)' : '';
  }

  async function abrir() {
    st.cargando = true; st.error = '';
    pintar();
    try {
      const { data, error } = await sb.rpc('partes_solicitudes_lista', { p_estado: st.filtro });
      if (error) throw error;
      st.lista = data || [];
    } catch (err) { st.error = err.message || String(err); st.lista = []; }
    st.cargando = false;
    pintar();
    refrescarAbiertas();
  }
  function filtro(v) { st.filtro = v; abrir(); }
  function buscar(v) { st.q = v; pintar(true); }

  function filas() {
    const q = st.q.trim().toLowerCase();
    return st.lista.filter(s => !q || [s.parte_resumen, s.motivo, s.solicitado_nombre, s.resuelto_nombre, s.nota_resolucion]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }

  function etiquetaEstado(s) {
    if (s.estado === 'pendiente') return '<b style="color:var(--rojo)">Pendiente</b>';
    if (s.estado === 'aprobada') return s.vencida ? 'Aprobada · <i>vencida</i>' : '<b style="color:var(--verde)">Aprobada</b> (sin usar)';
    return { rechazada: 'Rechazada', cancelada: 'Cancelada', usada: '✔ Usada' }[s.estado] || e(s.estado);
  }

  function pintar(soloTabla) {
    const caja = $('solicitudes-contenido');
    if (!caja) return;
    const btn = (v, t) => `<button class="btn-filtro${st.filtro === v ? ' exportar' : ''}" onclick="SolEd.filtro('${v}')">${t}</button>`;
    if (!soloTabla) caja.innerHTML = `<div class="filtros">
        <div class="filtro"><label>Estado</label><div style="display:flex;gap:6px;flex-wrap:wrap">${btn('abiertas', 'Abiertas')}${btn('usada', 'Usadas')}${btn('rechazada', 'Rechazadas')}${btn('todas', 'Todas')}</div></div>
        <div class="filtro crece"><label>Buscar</label><input type="text" value="${e(st.q)}" placeholder="Equipo, fecha, obra, quién pidió..." oninput="SolEd.buscar(this.value)"></div>
        <div class="filtro"><label>&nbsp;</label><button class="btn-filtro" onclick="SolEd.abrir()">Actualizar</button></div>
      </div>
      <div class="hist-info">Los partes que están en un certificado de máquinas <b>emitido</b> no se editan ni se eliminan.
        Se pide desde el detalle del parte (🔒) y lo aprueba <b>José, Peter o Margaret</b>. La aprobación vale ${VIGENCIA_H} h y para un solo cambio.
        ${st.aprobador ? '' : '<br>Acá ves tus solicitudes.'}</div>
      <div id="solicitudes-tabla"></div>`;
    const t = $('solicitudes-tabla');
    if (st.cargando) { t.innerHTML = '<div class="empty-state">Cargando...</div>'; return; }
    if (st.error) { t.innerHTML = `<div class="empty-state">No se pudo cargar: ${e(st.error)}<br><small>¿Se corrió el SQL 106?</small></div>`; return; }
    const l = filas();
    if (!l.length) { t.innerHTML = `<div class="empty-state">${st.filtro === 'abiertas' ? 'No hay solicitudes abiertas 👍' : 'Sin registros'}</div>`; return; }
    t.innerHTML = `<div class="hist-table-wrap"><table class="hist-table"><thead><tr>
        <th>Pedida</th><th>Tipo</th><th>Parte</th><th>Certificado</th><th>Motivo</th><th>Pidió</th><th>Estado</th><th>Resolvió</th></tr></thead><tbody>
      ${l.map((s, i) => `<tr onclick="SolEd.ver(${i})">
        <td>${fh(s.solicitado_en)}</td>
        <td>${s.tipo === 'editar' ? '✏️ Edición' : '<span style="color:var(--rojo)">🗑 Eliminación</span>'}</td>
        <td class="larga">${e(s.parte_resumen || '')}${s.parte_id ? '' : ' <i>(borrado)</i>'}</td>
        <td>${s.cert ? e(s.cert.texto || '') : ''}${s.parte_id && s.cert_sigue_emitido === false && s.estado === 'pendiente' ? '<br><small>ya no está emitido</small>' : ''}</td>
        <td class="larga" title="${e(s.motivo)}">${e(s.motivo)}</td>
        <td>${e(s.solicitado_nombre || '')}</td>
        <td>${etiquetaEstado(s)}</td>
        <td>${s.resuelto_nombre ? e(s.resuelto_nombre) + ' · ' + fh(s.resuelto_en) : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // ── Detalle de una solicitud (aprobar / rechazar) ────────────────
  let actual = null;
  function modal() {
    let m = $('modal-solicitud');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal'; m.id = 'modal-solicitud';
      m.onclick = (ev) => { if (ev.target === m) cerrar(); };
      m.innerHTML = `<div class="modal-card"><div class="modal-head" style="display:flex;justify-content:space-between;align-items:center">
        <b id="sol-titulo"></b><button class="btn-mini btn-neutro" onclick="SolEd.cerrar()">Cerrar</button></div>
        <div class="modal-body" id="sol-body"></div></div>`;
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrar() { const m = $('modal-solicitud'); if (m) m.classList.remove('show'); }

  function ver(i) {
    const s = filas()[i];
    if (!s) return;
    actual = s;
    const m = modal();
    const p = s.parte_datos || {};
    $('sol-titulo').textContent = `${s.tipo === 'editar' ? 'Edición' : 'Eliminación'} · ${s.parte_resumen || ''}`;
    const campo = (l, v) => v === null || v === undefined || v === '' ? '' : `<div class="field"><label>${l}</label><div style="white-space:pre-line">${v}</div></div>`;
    let h = '';
    h += campo('Pidió', `${e(s.solicitado_nombre || '')} · ${fh(s.solicitado_en)}`);
    h += campo('Motivo', e(s.motivo));
    h += campo('Certificado', s.cert ? e(s.cert.texto || '') + (s.parte_id && s.cert_sigue_emitido === false ? ' — <b>ya no está emitido</b> (se puede editar sin solicitud)' : '') : '');
    h += campo('Parte', e([p.equipo_id, fc(p.fecha), obraCorta(p.obra_clave)].filter(Boolean).join(' · ')) + (s.parte_id ? '' : ' <i>(ya borrado)</i>'));
    h += campo('Horómetro', p.horometro_inicial != null || p.horometro_final != null
      ? `${p.horometro_inicial ?? '—'} → ${p.horometro_final ?? '—'} (${p.horas_horometro ?? '—'} h)` : '');
    h += campo('Actividad', e(p.actividad_dia || ''));
    h += campo('Detalle', e(p.detalle_actividad || ''));
    h += campo('Observaciones', e(p.observaciones || ''));
    h += campo('Estado', etiquetaEstado(s) + (s.resuelto_nombre ? ` · ${e(s.resuelto_nombre)} ${fh(s.resuelto_en)}` : '')
      + (s.nota_resolucion ? '\n' + e(s.nota_resolucion) : '') + (s.usada_en ? `\nUsada el ${fh(s.usada_en)}` : ''));

    if (s.estado === 'pendiente' && st.aprobador) {
      h += `<div class="field"><label>Nota (obligatoria para rechazar)</label><textarea id="sol-nota" placeholder="Opcional al aprobar"></textarea></div>
        <div class="ayuda" style="margin-bottom:8px">Al aprobar, ${s.es_mia ? 'vos' : e(s.solicitado_nombre || 'quien la pidió')} (o un aprobador) puede${s.tipo === 'editar' ? ' editar el parte una vez' : ' eliminar el parte (va a la papelera 7 días)'} durante ${VIGENCIA_H} h.
          El certificado emitido no cambia solo: si cambian horas o días, hay que reabrirlo y volver a emitirlo.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-mini btn-verde" style="padding:9px 14px" onclick="SolEd.resolver(true)">✔ Aprobar</button>
          <button type="button" class="btn-mini btn-off" style="padding:9px 14px" onclick="SolEd.resolver(false)">✖ Rechazar</button>
        </div>`;
    } else if ((s.estado === 'pendiente' || (s.estado === 'aprobada' && !s.vencida)) && (s.es_mia || st.aprobador)) {
      h += `<button type="button" class="btn-mini btn-neutro" onclick="SolEd.cancelar(${s.id})">Cancelar la solicitud</button>`;
    }
    if (s.estado === 'aprobada' && vigente(s) && (s.es_mia || st.aprobador) && s.parte_id) {
      h += `<div class="hist-info" style="margin-top:10px">Para usarla: Partes cargados › buscá el parte (podés pegar su ID: ${e(p.client_id || s.parte_id)}) ›
        ${s.tipo === 'editar' ? 'Editar' : 'Borrar'}.</div>`;
    }
    $('sol-body').innerHTML = h;
    m.classList.add('show');
  }

  async function resolver(aprobar) {
    const s = actual;
    if (!s) return;
    const nota = (($('sol-nota') || {}).value || '').trim();
    if (!aprobar && !nota) return toast('Escribí por qué se rechaza', 'warning');
    const t = s.tipo === 'editar' ? 'edición' : 'eliminación';
    if (!confirm(`${aprobar ? 'Aprobar' : 'Rechazar'} la ${t} del parte ${s.parte_resumen}?`)) return;
    mostrarCarga('Guardando...');
    try {
      const { error } = await sb.rpc('parte_solicitud_resolver', { p_id: s.id, p_aprobar: aprobar, p_nota: nota || null });
      if (error) throw error;
      ocultarCarga();
      toast(aprobar ? 'Solicitud aprobada' : 'Solicitud rechazada', 'success');
      cerrar();
      abrir();
    } catch (err) { ocultarCarga(); toast(err.message || String(err), 'error'); }
  }

  return { iniciar, certDe, marca, ajustarDetalle, puedoUsar, pedir, cancelar, usada,
           contar, abrir, filtro, buscar, ver, cerrar, resolver,
           get activo() { return st.activo; } };
})();
