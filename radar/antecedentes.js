'use strict';
/* =========================================================================
 * antecedentes.js — Licitaciones › Antecedentes de obra · v20261020a
 *
 * Catálogo de contratos, actas de recepción, convenios modificatorios,
 * formularios y documentos del personal que se presentan en las ofertas.
 *   · El índice está en Supabase (tabla radar_antecedentes, SQL 51), con los
 *     mismos permisos del Radar: ver = radar_access(false), editar = (true).
 *   · Los PDF están en Google Drive; se abren con el visor de la app
 *     (../visor.js) o en Drive. El permiso de cada PDF lo da Drive.
 *   · La búsqueda mira los datos del documento y, desde 3 letras, también el
 *     texto OCR de los escaneos (columna texto_norm, sin tildes).
 * Usa los ayudantes de app.js: $, safe, normalize, toast, modal, getClient,
 * dbResult, radarUser, tab.
 * ========================================================================= */
(function () {
  const COLS = 'id,obra_codigo,obra,contratante,contrato,referencia,tipo,detalle,fecha,paginas,monto,moneda,drive_id,carpeta,origen,actualizado,actualizado_por';
  const TIPOS = ['Contrato', 'Convenio Modificatorio', 'Acta de Recepción Provisoria', 'Acta de Recepción Definitiva',
    'Certificado de obra', 'Formulario', 'Currículum', 'Título', 'Constancia de trabajo', 'Cédula de identidad', 'Registro profesional', 'Otro'];
  let docs = [], loaded = false, loading = false, message = '', hits = null, buscando = false, timer = null;
  const filtro = { q: '', tipo: '', contratante: '', abiertas: new Set() };
  try { const f = JSON.parse(localStorage.getItem('tecsul:radar:antecedentes:filtro') || 'null'); if (f) { filtro.tipo = f.tipo || ''; filtro.contratante = f.contratante || ''; } } catch (e) {}
  const guardarFiltro = () => { try { localStorage.setItem('tecsul:radar:antecedentes:filtro', JSON.stringify({ tipo: filtro.tipo, contratante: filtro.contratante })); } catch (e) {} };

  const puedeEditar = () => !!(radarUser && radarUser.canWrite);
  const driveVer = id => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
  const drivePrev = id => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview';
  const grupoOrden = c => /^(LIC|PER)$/.test(c) ? 'Z' + c : c;
  function driveId(v) {
    v = String(v || '').trim();
    const m = v.match(/\/d\/([\w-]{20,})/) || v.match(/[?&]id=([\w-]{20,})/);
    return m ? m[1] : (/^[\w-]{20,}$/.test(v) ? v : '');
  }

  /* ------------------------------------------------------------- datos */
  async function load(force) {
    if (loading || (loaded && !force)) { render(); return; }
    loading = true; message = 'Cargando antecedentes…'; render();
    try {
      const sb = getClient(); let rows = [];
      for (let from = 0; ; from += 500) {
        const part = dbResult(await sb.from('radar_antecedentes').select(COLS).order('obra_codigo').order('id').range(from, from + 499));
        rows = rows.concat(part || []); if (!part || part.length < 500) break;
      }
      docs = rows; loaded = true; message = '';
      if (filtro.q) await buscarTexto();
    } catch (e) {
      message = /radar_antecedentes|does not exist|schema cache/i.test(e.message)
        ? 'Falta crear la tabla de antecedentes en la base (SQL 51). Avisale al administrador.'
        : 'No se pudo cargar: ' + e.message;
    }
    loading = false; render();
  }

  // Búsqueda en el texto OCR: cada palabra de 3+ letras tiene que aparecer.
  async function buscarTexto() {
    const terms = normalize(filtro.q).split(/\s+/).filter(t => t.length >= 3);
    if (!terms.length) { hits = null; return; }
    buscando = true; render();
    try {
      let qy = getClient().from('radar_antecedentes').select('id,texto');
      for (const t of terms) qy = qy.ilike('texto_norm', '%' + t.replace(/[\\%_]/g, c => '\\' + c) + '%');
      const r = dbResult(await qy.limit(500));
      hits = new Map((r || []).map(x => [x.id, fragmento(x.texto, terms[0])]));
    } catch (e) { hits = null; toast('No se pudo buscar en el texto: ' + e.message); }
    buscando = false;
  }
  function fragmento(texto, term) {
    const t = String(texto || ''); const p = normalize(t).indexOf(term);
    if (p < 0) return '';
    const a = Math.max(0, p - 70), b = Math.min(t.length, p + term.length + 110);
    return (a ? '…' : '') + t.slice(a, b).replace(/\s+/g, ' ').trim() + (b < t.length ? '…' : '');
  }

  function filas() {
    const terms = normalize(filtro.q).split(/\s+/).filter(Boolean);
    return docs.filter(d => {
      if (filtro.tipo && d.tipo !== filtro.tipo) return false;
      if (filtro.contratante && d.contratante !== filtro.contratante) return false;
      if (!terms.length) return true;
      const meta = normalize([d.obra_codigo, d.obra, d.contratante, d.contrato, d.referencia, d.tipo, d.detalle, d.fecha].join(' '));
      return terms.every(t => meta.includes(t)) || (hits && hits.has(d.id));
    });
  }

  /* ------------------------------------------------------------- vista */
  function render() {
    const panel = $('antecedentesPanel'); if (!panel) return;
    const nav = $('navAntecedentes'); if (nav) nav.textContent = loaded ? docs.length : '—';
    if (tab !== 'antecedentes') return;
    const r = filas(), obras = new Set(docs.filter(d => !/^(LIC|PER)$/.test(d.obra_codigo)).map(d => d.obra_codigo)).size;
    const tipos = [...new Set(docs.map(d => d.tipo))].sort(), conts = [...new Set(docs.map(d => d.contratante).filter(Boolean))].sort();
    const g = new Map(); r.forEach(d => { if (!g.has(d.obra_codigo)) g.set(d.obra_codigo, []); g.get(d.obra_codigo).push(d); });
    const abrirTodo = !!(filtro.q || filtro.tipo || filtro.contratante);
    const act = document.activeElement && document.activeElement.id, selS = act === 'antQ' ? document.activeElement.selectionStart : null;

    panel.innerHTML =
      '<div class="panel-top"><div><h2>Documentos por obra</h2><p>Buscá por obra, N° de contrato o cualquier palabra del documento. Los PDF se abren con tu cuenta de Drive.</p></div>' +
      '<span class="part-actions">' + (puedeEditar() ? '<button class="primary" id="antNuevo">＋ Agregar documento</button>' : '') +
      '<button class="outline" id="antRecargar" ' + (loading ? 'disabled' : '') + '>↻ Recargar</button></span></div>' +
      (message ? '<p class="notice">' + safe(message) + '</p>' : '') +
      '<div class="ant-resumen"><span><b>' + docs.length + '</b> documentos</span><span><b>' + obras + '</b> obras</span><span><b>' + docs.reduce((a, d) => a + (d.paginas || 0), 0) + '</b> páginas</span></div>' +
      '<div class="ant-filtros"><label class="ant-q"><span>⌕</span><input id="antQ" type="search" autocomplete="off" placeholder="Buscar obra, contrato, contratante o texto del documento…" value="' + safe(filtro.q) + '"></label>' +
      '<label>Tipo<select id="antTipo"><option value="">Todos</option>' + tipos.map(t => '<option ' + (t === filtro.tipo ? 'selected' : '') + '>' + safe(t) + '</option>').join('') + '</select></label>' +
      '<label>Contratante<select id="antCont"><option value="">Todos</option>' + conts.map(t => '<option ' + (t === filtro.contratante ? 'selected' : '') + '>' + safe(t) + '</option>').join('') + '</select></label></div>' +
      '<p class="ant-cuenta">' + (buscando ? 'Buscando en el texto de los documentos…' : (r.length === docs.length ? '' : r.length + ' de ' + docs.length + ' documentos' + (hits && hits.size ? ' · ' + hits.size + ' con coincidencias en el texto' : ''))) + '</p>' +
      (loaded && !r.length ? '<div class="empty"><h3>' + (docs.length ? 'No hay documentos con esa búsqueda' : 'Todavía no hay antecedentes cargados') + '</h3><p>' + (docs.length ? 'Probá con otra palabra, un número de contrato (ej. 354/2019) o quitá los filtros.' : 'Cargá la lista inicial (SQL 51b) o agregá un documento con su enlace de Drive.') + '</p></div>' : '') +
      '<div class="ant-lista">' + [...g].sort((a, b) => grupoOrden(a[0]).localeCompare(grupoOrden(b[0]))).map(([code, ds]) => {
        const f = ds[0], meta = [f.contratante, f.contrato && 'Contrato ' + f.contrato, f.referencia].filter(Boolean).join(' · ');
        const open = abrirTodo || filtro.abiertas.has(code);
        return '<details class="ant-obra k-' + safe(code) + '" data-obra="' + safe(code) + '"' + (open ? ' open' : '') + '><summary><span class="ant-code">' + safe(code) + '</span><span class="ant-nom">' + safe(f.obra) + '</span><span class="ant-n">' + ds.length + '</span><span class="ant-meta">' + safe(meta) + '</span></summary><ul>' +
          ds.map(d => '<li class="ant-doc"><div class="ant-txt"><span class="ant-tipo">' + safe(d.tipo) + '</span><span class="ant-det">' + safe(d.detalle) + '</span>' +
            (hits && hits.get(d.id) ? '<span class="ant-frag">' + safe(hits.get(d.id)) + '</span>' : '') +
            '<span class="ant-fp">' + safe(d.fecha || 's/f') + (d.paginas ? ' · ' + d.paginas + ' pág.' : '') + '</span></div><div class="ant-acc">' +
            (d.drive_id ? '<button class="primary ant-ver" data-ant-ver="' + safe(d.id) + '">Ver</button><a class="outline" href="' + driveVer(d.drive_id) + '" target="_blank" rel="noopener">Drive ↗</a>' : '<span class="ant-sin">Sin PDF</span>') +
            (puedeEditar() ? '<button class="outline" data-ant-edit="' + safe(d.id) + '" aria-label="Editar">✎</button>' : '') + '</div></li>').join('') +
          '</ul></details>';
      }).join('') + '</div>';

    if (act === 'antQ') { const i = $('antQ'); i.focus(); if (selS != null) i.setSelectionRange(selS, selS); }
  }

  function ver(id) {
    const d = docs.find(x => x.id === id); if (!d || !d.drive_id) return;
    const grupo = filas().filter(x => x.obra_codigo === d.obra_codigo && x.drive_id);
    const lista = grupo.map(x => ({ url: drivePrev(x.drive_id), nombre: x.tipo + ' · ' + x.detalle, mime: 'application/pdf' }));
    const V = window.Visor || (window.parent && window.parent.Visor);
    if (V && V.abrir) V.abrir(lista, Math.max(0, grupo.indexOf(d)));
    else window.open(driveVer(d.drive_id), '_blank', 'noopener');
  }

  /* ------------------------------------------------------ alta / edición */
  function editar(id) {
    const d = id ? docs.find(x => x.id === id) : null, nuevo = !d;
    const obras = [...new Map(docs.map(x => [x.obra_codigo, x])).values()];
    const v = d || { obra_codigo: '', obra: '', contratante: '', contrato: '', referencia: '', tipo: 'Contrato', detalle: '', fecha: '', paginas: '', drive_id: '', carpeta: '', origen: '' };
    const campo = (idc, lab, val, extra) => '<label>' + lab + '<input id="' + idc + '" value="' + safe(val ?? '') + '" ' + (extra || '') + '></label>';
    modal('<h2>' + (nuevo ? 'Agregar documento' : 'Editar documento') + '</h2><p>Subí el PDF a la carpeta de la obra en Drive y pegá acá su enlace. Para una obra nueva usá un código nuevo (OB12, OB13…).</p>' +
      '<form id="antForm" class="participation-form ant-form">' +
      '<label>Obra<input id="aCod" list="antObras" required maxlength="12" value="' + safe(v.obra_codigo) + '" placeholder="OB12"></label>' +
      '<datalist id="antObras">' + obras.map(o => '<option value="' + safe(o.obra_codigo) + '">' + safe(o.obra) + '</option>').join('') + '</datalist>' +
      campo('aObra', 'Nombre de la obra', v.obra, 'required maxlength="300"') +
      campo('aCont', 'Contratante', v.contratante, 'maxlength="200"') + campo('aNum', 'N° de contrato', v.contrato, 'maxlength="100"') +
      campo('aRef', 'Llamado / ID / financiamiento', v.referencia, 'maxlength="200"') +
      '<label>Tipo de documento<select id="aTipo">' + [...new Set(TIPOS.concat(docs.map(x => x.tipo)))].map(t => '<option ' + (t === v.tipo ? 'selected' : '') + '>' + safe(t) + '</option>').join('') + '</select></label>' +
      campo('aDet', 'Detalle', v.detalle, 'maxlength="300" placeholder="Convenio Modificatorio N° 02 al Contrato 719/2019"') +
      campo('aFecha', 'Fecha del documento', v.fecha, 'maxlength="20" placeholder="dd/mm/aaaa"') +
      campo('aPag', 'Páginas', v.paginas, 'type="number" min="1" step="1"') +
      campo('aDrive', 'Enlace del PDF en Drive', v.drive_id ? driveVer(v.drive_id) : '', 'placeholder="https://drive.google.com/file/d/…"') +
      '<p id="aError" class="form-error" role="alert"></p>' +
      '<div class="ant-form-acc"><button class="primary" id="aGuardar" type="submit">Guardar</button>' + (nuevo ? '' : '<button class="outline ant-borrar" id="aBorrar" type="button">Borrar del catálogo</button>') + '</div></form>' +
      (nuevo ? '' : '<p class="tiny">Última modificación: ' + safe(new Date(d.actualizado).toLocaleString('es-PY')) + (d.actualizado_por ? ' · ' + safe(d.actualizado_por) : '') + '. Borrar quita el documento de la lista; el PDF queda en Drive.</p>'));
    $('aCod').addEventListener('change', () => { const o = obras.find(x => x.obra_codigo === $('aCod').value.trim().toUpperCase()); if (o && !$('aObra').value) { $('aObra').value = o.obra; $('aCont').value = o.contratante; $('aNum').value = o.contrato; $('aRef').value = o.referencia; } });
    $('antForm').onsubmit = async e => {
      e.preventDefault(); const btn = $('aGuardar'); $('aError').textContent = '';
      const link = $('aDrive').value.trim(), did = driveId(link);
      if (link && !did) { $('aError').textContent = 'El enlace de Drive no se reconoce. Copiá el enlace del archivo (Compartir › Copiar vínculo).'; return; }
      const p = { id: d ? d.id : '', obra_codigo: $('aCod').value.trim().toUpperCase(), obra: $('aObra').value, contratante: $('aCont').value, contrato: $('aNum').value,
        referencia: $('aRef').value, tipo: $('aTipo').value, detalle: $('aDet').value, fecha: $('aFecha').value, paginas: $('aPag').value, drive_id: did,
        carpeta: d ? d.carpeta : '', origen: d ? d.origen : 'Cargado desde la app' };
      btn.disabled = true;
      try { dbResult(await getClient().rpc('radar_antecedente_guardar', { p })); $('infoDialog').close(); toast('Documento guardado.'); await load(true); }
      catch (err) { $('aError').textContent = err.message; btn.disabled = false; }
    };
    if (!nuevo) {
      let confirmar = false;
      $('aBorrar').onclick = async () => {
        if (!confirmar) { confirmar = true; $('aBorrar').textContent = 'Tocá de nuevo para confirmar'; return; }
        try { dbResult(await getClient().rpc('radar_antecedente_borrar', { p_id: d.id })); $('infoDialog').close(); toast('Documento quitado del catálogo.'); await load(true); }
        catch (err) { $('aError').textContent = err.message; }
      };
    }
  }

  /* ------------------------------------------------------------ eventos */
  document.addEventListener('click', e => {
    const b = e.target.closest('#antNuevo,#antRecargar,[data-ant-ver],[data-ant-edit]'); if (!b) return;
    if (b.id === 'antNuevo') editar(null);
    else if (b.id === 'antRecargar') load(true);
    else if (b.dataset.antVer) ver(b.dataset.antVer);
    else if (b.dataset.antEdit) editar(b.dataset.antEdit);
  });
  document.addEventListener('toggle', e => {
    const d = e.target; if (!d.matches || !d.matches('details.ant-obra')) return;
    if (d.open) filtro.abiertas.add(d.dataset.obra); else filtro.abiertas.delete(d.dataset.obra);
  }, true);
  document.addEventListener('input', e => {
    if (e.target.id !== 'antQ') return;
    filtro.q = e.target.value; hits = null; render();
    clearTimeout(timer); timer = setTimeout(async () => { await buscarTexto(); render(); }, 400);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'antTipo') { filtro.tipo = e.target.value; guardarFiltro(); render(); }
    if (e.target.id === 'antCont') { filtro.contratante = e.target.value; guardarFiltro(); render(); }
  });

  window.RadarAntecedentes = { load, render, ver, editar };
})();
