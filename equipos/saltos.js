// ══════════════════════════════════════════════════════════════════
// SALTOS DE HORÓMETRO — Historial de partes › Saltos de horómetro
// Tecsul S.A.E. · v20261102f (SQL 77)
//
// La base marca dos casos (tabla horometro_saltos):
//   · salto    → el horómetro inicial del parte es MAYOR al final del parte
//                anterior: hubo horas fuera de los partes (taller, traslado,
//                alguien la usó sin parte, cambio de horómetro).
//   · revisión → el horómetro «cierra», pero la máquina estuvo parada muchos
//                días (regla dias_parado_revisar) o el taller registró una
//                lectura mayor en el medio: puede que el operador haya puesto
//                el valor viejo y absorbido horas de taller en su día (caso
//                MN-04 del 26/10/2026).
//
// Lo ven admin central, encargado de taller, gerente y administrador de
// obra. Resuelven solo admin central y taller (salto_resolver, es_taller()).
// Uso en taller / Traslado / Parte faltante crean un PARTE PUENTE con 0 HH
// y las horas del salto, así la cadena del horómetro queda completa.
// ══════════════════════════════════════════════════════════════════
window.Saltos = (() => {
  const st = { estado: 'pendiente', datos: [], cargando: false, error: '', q: '' };
  const e = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fc = (f) => (typeof fechaCorta === 'function' ? fechaCorta(f) : String(f || ''));
  const obraCorta = (o) => String(o || '').replace(/^[0-9A-Z]+_/, '');
  const n1 = (v) => (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: 1 });
  const puedeResolver = () => ['admin_central', 'taller'].includes(((typeof sesion !== 'undefined' && sesion) || {}).rol);

  async function traer(estado) {
    const { data, error } = await sb.rpc('horometro_saltos_lista', { p_estado: estado });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  // Número de pendientes en la solapa
  async function contar() {
    const el = $('hs-saltos-n');
    if (!el) return;
    try {
      const l = await traer('pendiente');
      el.textContent = l.length ? `(${l.length})` : '';
      el.style.color = l.length ? 'var(--rojo)' : '';
    } catch (err) {
      // sin el SQL 77 la función no existe: se esconde la solapa
      const b = $('hs-saltos'); if (b) b.style.display = 'none';
    }
  }

  async function abrir() {
    st.cargando = true; st.error = '';
    pintar();
    try { st.datos = await traer(st.estado); }
    catch (err) { st.error = err.message || String(err); st.datos = []; }
    st.cargando = false;
    pintar();
    contar();
  }

  function filtro(v) { st.estado = v; abrir(); }
  function buscar(v) { st.q = v; pintar(true); }

  function filas() {
    const q = st.q.trim().toLowerCase();
    return st.datos.filter(s => !q || [s.equipo_id, s.equipo_desc, s.operador, s.obra_clave, s.causa_declarada, s.resolucion]
      .some(x => String(x || '').toLowerCase().includes(q)));
  }

  function etiquetaTipo(s) {
    return s.tipo === 'salto'
      ? `<span class="tag" style="background:#fde2e1;color:#b42318">Salto ${n1(s.horas)} h</span>`
      : `<span class="tag" style="background:#fff3d6;color:#92400e">Revisar · ${s.dias} días</span>`;
  }

  function pintar(soloTabla) {
    const caja = $('saltos-contenido');
    if (!caja) return;
    const btn = (v, t) => `<button class="btn-filtro${st.estado === v ? ' exportar' : ''}" onclick="Saltos.filtro('${v}')">${t}</button>`;
    const cab = `<div class="filtros">
        <div class="filtro"><label>Estado</label><div style="display:flex;gap:6px">${btn('pendiente', 'Pendientes')}${btn('resuelto', 'Resueltos')}${btn('todos', 'Todos')}</div></div>
        <div class="filtro crece"><label>Buscar</label><input type="text" id="saltos-q" value="${e(st.q)}" placeholder="Equipo, operador, obra..." oninput="Saltos.buscar(this.value)"></div>
        <div class="filtro"><label>&nbsp;</label><button class="btn-filtro" onclick="Saltos.abrir()">Actualizar</button></div>
      </div>
      <div class="hist-info">Partes donde el horómetro subió fuera de los partes (<b>salto</b>) o que llegan después de muchos días
        sin partes o con lecturas de taller mayores (<b>revisar</b>). Al resolver «Uso en taller», «Traslado» o «Parte faltante»
        se crea un parte puente (0 HH) con esas horas, para que no queden cargadas a la obra del día.</div>
      <div id="saltos-tabla"></div>`;
    if (!soloTabla) caja.innerHTML = cab;
    const t = $('saltos-tabla');
    if (st.cargando) { t.innerHTML = '<div class="empty-state">Cargando...</div>'; return; }
    if (st.error) { t.innerHTML = `<div class="empty-state">No se pudo cargar: ${e(st.error)}<br><small>¿Se corrió el SQL 77?</small></div>`; return; }
    const l = filas();
    if (!l.length) { t.innerHTML = `<div class="empty-state">${st.estado === 'pendiente' ? 'No hay saltos pendientes 👍' : 'Sin registros'}</div>`; return; }
    t.innerHTML = `<div class="hist-table-wrap"><table class="hist-table"><thead><tr>
        <th>Equipo</th><th>Tipo</th><th>Parte anterior</th><th>Parte</th><th>Actividad / obra</th><th>Operador</th>
        <th>Taller</th><th>Declaró</th><th>Estado</th></tr></thead><tbody>
      ${l.map((s, i) => `<tr onclick="Saltos.ver(${i})">
        <td><span class="tag">${e(s.equipo_id)}</span></td>
        <td>${etiquetaTipo(s)}</td>
        <td>${fc(s.fecha_desde)} · ${n1(s.lectura_desde)} h</td>
        <td>${fc(s.fecha_hasta)} · ${n1(s.lectura_hasta)} → ${n1(s.parte_final)} h</td>
        <td class="larga">${e(s.actividad_dia || '')} · ${e(obraCorta(s.obra_clave))}</td>
        <td>${e(s.operador || '')}</td>
        <td class="larga">${s.ot_numero ? `OT ${e(s.ot_numero)} (${e(s.ot_estado)})` : ''}${s.evidencia_lectura ? ' · lectura ' + n1(s.evidencia_lectura) + ' h' : ''}</td>
        <td class="larga">${e(s.causa_declarada || '')}</td>
        <td>${s.estado === 'resuelto' ? '✔ ' + e(s.resolucion || '') : '<b style="color:var(--rojo)">Pendiente</b>'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // ── Detalle y resolución ─────────────────────────────────────────
  let actual = null;
  function modal() {
    let m = $('modal-salto');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal'; m.id = 'modal-salto';
      m.onclick = (ev) => { if (ev.target === m) cerrar(); };
      m.innerHTML = `<div class="modal-card"><div class="modal-head" style="display:flex;justify-content:space-between;align-items:center">
        <b id="salto-titulo"></b><button class="btn-mini btn-neutro" onclick="Saltos.cerrar()">Cerrar</button></div>
        <div class="modal-body" id="salto-body"></div></div>`;
      document.body.appendChild(m);
    }
    return m;
  }
  function cerrar() { const m = $('modal-salto'); if (m) m.classList.remove('show'); }

  function ver(i) {
    const s = filas()[i];
    if (!s) return;
    actual = s;
    const m = modal();
    $('salto-titulo').textContent = `${s.equipo_id} · ${fc(s.fecha_hasta)} · ${s.tipo === 'salto' ? 'salto de ' + n1(s.horas) + ' h' : 'revisar'}`;
    const campo = (l, v) => v === null || v === undefined || v === '' ? '' : `<div class="field"><label>${l}</label><div style="white-space:pre-line">${v}</div></div>`;
    let h = '';
    h += s.tipo === 'salto'
      ? `<div class="salto-box show">El parte del <b>${fc(s.fecha_hasta)}</b> arranca en <b>${n1(s.lectura_hasta)} h</b>, pero el parte anterior
          (${fc(s.fecha_desde)}) terminó en <b>${n1(s.lectura_desde)} h</b>: hay <b>${n1(s.horas)} h</b> fuera de los partes.</div>`
      : `<div class="salto-box show">El horómetro cierra (${n1(s.lectura_desde)} h), pero entre el parte anterior y este pasaron
          <b>${s.dias} ${s.dias === 1 ? 'día' : 'días'}</b>${s.evidencia ? ` y <b>${e(s.evidencia.charAt(0).toLowerCase() + s.evidencia.slice(1))}</b>` : ''}. Revisá la foto del tablero y la del parte en papel: si arrancó con otro
          horómetro, el operador absorbió horas de taller en su día.</div>`;
    h += campo('Equipo', e(`${s.equipo_id} ${s.equipo_desc ? '· ' + s.equipo_desc : ''}`));
    h += campo('Parte anterior', `${fc(s.fecha_desde)} · termina en ${n1(s.lectura_desde)} h · ${e(s.actividad_anterior || '')} · ${e(obraCorta(s.obra_anterior))}`);
    h += campo('Este parte', `${fc(s.fecha_hasta)} · ${n1(s.lectura_hasta)} → ${n1(s.parte_final)} h (${n1(s.parte_horas)} h) · ${e(s.actividad_dia || '')} · ${e(obraCorta(s.obra_clave))} · ${e(s.operador || '')}`);
    h += campo('OT de taller', s.ot_numero ? `OT ${e(s.ot_numero)} · ${e(s.ot_estado)}${s.ot_estado !== 'Cerrada' ? ' — <b>sigue abierta: que taller la cierre con la Inspección Final</b>' : ''}` : '');
    h += campo('Lectura de taller', e(s.evidencia || ''));
    h += campo('El operador declaró', e(s.causa_declarada || ''));
    h += campo('Observaciones del parte', e(s.observaciones || ''));
    h += `<div class="field"><label>Fotos del parte</label><div class="fotos" id="salto-fotos"></div></div>`;

    if (s.estado === 'resuelto') {
      h += campo('Resolución', `${e(s.resolucion)}${s.lectura_real ? ' · horómetro real ' + n1(s.lectura_real) + ' h' : ''}${s.puente_fecha ? ` · parte puente del ${fc(s.puente_fecha)} en ${e(obraCorta(s.puente_obra))}` : ''}${s.nota ? '\n' + e(s.nota) : ''}`);
    } else if (puedeResolver()) {
      h += `<div class="field"><label>¿Qué pasó?</label>`;
      if (s.tipo === 'revision') {
        h += `<div class="ayuda" style="margin-bottom:6px">Si arrancó con otro horómetro, escribilo (sale de la foto del tablero o del parte en papel).
          Se corrige el inicial del parte y las horas de diferencia van a un parte puente.</div>
          <input type="number" inputmode="decimal" step="0.01" id="salto-real" placeholder="Horómetro real al arrancar (h)"
            style="margin-bottom:8px">`;
      }
      const b = (acc, t, cls) => `<button type="button" class="btn-mini ${cls || 'btn-neutro'}" style="padding:9px 12px;white-space:normal;text-align:left" onclick="Saltos.resolver('${acc}')">${t}</button>`;
      h += `<div style="display:flex;flex-wrap:wrap;gap:7px">
        ${b('uso_taller', '🔧 Uso en taller (parte puente en Taller Central)', 'btn-verde')}
        ${b('traslado', '🚚 Traslado (puente en la obra del parte)')}
        ${b('parte_faltante', '📄 Parte faltante (puente en la obra del parte)')}
        ${s.tipo === 'salto' ? b('cambio_horometro', 'Cambio de horómetro') + b('error_carga', 'Error de carga (corregí el parte)') : b('sin_salto', '✔ Está bien, sin salto')}
      </div>
      <textarea id="salto-nota" placeholder="Nota (opcional)" style="margin-top:8px"></textarea></div>`;
    } else {
      h += `<div class="hist-info">Lo resuelve el administrador central o el encargado de taller.</div>`;
    }
    $('salto-body').innerHTML = h;
    m.classList.add('show');
    fotos(s);
  }

  async function fotos(s) {
    const caja = $('salto-fotos');
    if (!caja) return;
    const items = [['img_horometro', 'Horómetro'], ['img_parte_papel', 'Parte en papel']].filter(([k]) => s[k]);
    if (!items.length) { caja.innerHTML = '<div class="hist-info">Sin fotos.</div>'; return; }
    caja.innerHTML = items.map(([k, t]) => `<div class="foto-caja" id="sf-${k}"><div class="foto-vacia">Cargando...</div><div class="pie">${t}</div></div>`).join('');
    for (const [k] of items) {
      const cont = $('sf-' + k); if (!cont) continue;
      const v = String(s[k]);
      if (v.includes('drive.google.com')) { cont.querySelector('.foto-vacia').innerHTML = `<a href="${e(v)}" target="_blank" rel="noopener">Abrir en Drive</a>`; continue; }
      const url = typeof urlDeImagen === 'function' ? await urlDeImagen(v) : null;
      cont.querySelector('.foto-vacia').outerHTML = url
        ? `<a href="${e(url)}" target="_blank" rel="noopener"><img src="${e(url)}" style="width:100%;height:110px;object-fit:cover"></a>`
        : '<div class="foto-vacia">No se pudo cargar</div>';
    }
  }

  async function resolver(accion) {
    const s = actual;
    if (!s) return;
    const realEl = $('salto-real');
    const real = realEl && realEl.value !== '' ? Number(realEl.value) : null;
    const nota = ($('salto-nota') || {}).value || null;
    if (s.tipo === 'revision' && ['uso_taller', 'traslado', 'parte_faltante'].includes(accion) && (real === null || isNaN(real))) {
      toast('Escribí el horómetro real con el que arrancó la máquina', 'warning'); return;
    }
    const horas = s.tipo === 'salto' ? Number(s.horas) : (real !== null ? +(real - Number(s.lectura_desde)).toFixed(2) : 0);
    const txt = {
      uso_taller: `Se crea un parte puente de ${horas} h (0 HH) en Taller Central`,
      traslado: `Se crea un parte puente de ${horas} h (0 HH) como traslado`,
      parte_faltante: `Se crea un parte puente de ${horas} h (0 HH) por el parte que falta`,
      cambio_horometro: 'Se marca como cambio de horómetro (sin parte puente)',
      error_carga: 'Se marca como error de carga: corregí después el parte desde Partes cargados › Editar',
      sin_salto: 'Se marca el parte como correcto'
    }[accion];
    const extra = s.tipo === 'revision' && real !== null && accion !== 'sin_salto'
      ? `\nY el horómetro inicial del parte del ${fc(s.fecha_hasta)} pasa de ${n1(s.lectura_hasta)} a ${n1(real)} h.` : '';
    if (!confirm(`${txt}.${extra}\n\n¿Confirmás?`)) return;
    mostrarCarga('Guardando...');
    try {
      const { data, error } = await sb.rpc('salto_resolver',
        { p_id: s.id, p_accion: accion, p_lectura_real: real, p_obra: null, p_nota: nota });
      if (error) throw error;
      ocultarCarga();
      toast(data && data.puente_id ? `Listo: parte puente de ${n1(data.horas)} h creado` : 'Listo', 'success');
      cerrar();
      abrir();
      if (typeof cargarHistorial === 'function') cargarHistorial(true);
    } catch (err) {
      ocultarCarga();
      toast(err.message || String(err), 'error');
    }
  }

  return { contar, abrir, filtro, buscar, ver, cerrar, resolver };
})();
