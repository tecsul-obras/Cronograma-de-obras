// ══════════════════════════════════════════════════════════════════
// ASISTENTE IA — Tecsul S.A.E.
//
// Chat para administradores centrales: se le pregunta en castellano y
// contesta con los datos de la app. La pregunta va a la Edge Function
// "asistente" de Supabase, que habla con Gemini (la clave de Gemini
// vive allá, nunca en el teléfono) y corre las consultas en modo solo
// lectura. Es un botón flotante abajo a la derecha, en las dos páginas.
// ══════════════════════════════════════════════════════════════════
window.Asistente = (() => {
  const GUARDADO = 'ia_chat';
  const SUGERENCIAS = [
    '¿Qué equipos trabajaron más horas este mes?',
    '¿Qué máquinas no cargaron parte en los últimos 3 días?',
    'Consumo de gasoil por equipo el mes pasado comparado con su referencia',
    'Órdenes de trabajo abiertas hace más de 30 días: ¿qué tienen en común?',
    'Horas hombre por obra en septiembre',
    '¿Cuánto se liquidó de alquileres por arrendatario en los últimos 3 meses?',
  ];
  let mensajes = [];   // { rol: 'user' | 'model', texto, consultas?, error? }
  let ocupado = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function cargar() {
    try { mensajes = JSON.parse(localStorage.getItem(GUARDADO) || '[]'); } catch (e) { mensajes = []; }
  }
  function guardar() {
    try { localStorage.setItem(GUARDADO, JSON.stringify(mensajes.slice(-40))); } catch (e) { /* lleno: no importa */ }
  }

  // Markdown mínimo: títulos, negrita, cursiva, código, listas y tablas
  function md(texto) {
    const lineas = esc(texto).split('\n');
    let html = '', i = 0;
    const enLinea = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    while (i < lineas.length) {
      const l = lineas[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1])) {
        const celdas = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map(c => enLinea(c.trim()));
        const cab = celdas(l);
        i += 2;
        const filas = [];
        while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]));
        html += `<div class="ia-tabla"><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
          filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l)) {
        html += '<ul>';
        while (i < lineas.length && /^\s*[-*•]\s+/.test(lineas[i])) html += `<li>${enLinea(lineas[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`;
        html += '</ul>';
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        html += '<ol>';
        while (i < lineas.length && /^\s*\d+[.)]\s+/.test(lineas[i])) html += `<li>${enLinea(lineas[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`;
        html += '</ol>';
        continue;
      }
      const t = l.match(/^(#{1,4})\s+(.*)$/);
      if (t) { html += `<h4>${enLinea(t[2])}</h4>`; i++; continue; }
      html += l.trim() ? `<p>${enLinea(l)}</p>` : '';
      i++;
    }
    return html;
  }

  // Botón flotante (abajo a la derecha) y ventana del chat. Se crean una
  // sola vez, en cualquiera de las dos páginas, solo para admin_central.
  function crear() {
    if ($('ia-fab')) return;
    estilos();
    const fab = document.createElement('button');
    fab.id = 'ia-fab';
    fab.title = 'Asistente IA';
    fab.setAttribute('aria-label', 'Abrir el asistente IA');
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">'
      + '<path d="M10 2.5l1.7 4.6 4.6 1.7-4.6 1.7L10 15.1 8.3 10.5 3.7 8.8l4.6-1.7z"/>'
      + '<path d="M17.5 12.5l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55-2.55-.95 2.55-.95z"/>'
      + '<path d="M6 15.5l.7 1.8 1.8.7-1.8.7L6 20.5l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
    fab.onclick = () => alternar();
    document.body.appendChild(fab);

    const v = document.createElement('div');
    v.id = 'ia-ventana';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Asistente IA');
    v.innerHTML = `
      <div class="ia-cab">
        <div class="ia-titulo"><b>✨ Asistente IA</b><span>Partes, flota, taller, combustible, mantenimiento y alquileres</span></div>
        <button class="ia-icono" title="Nueva conversación" onclick="Asistente.nueva()">⟲</button>
        <button class="ia-icono" title="Cerrar" onclick="Asistente.cerrar()">✕</button>
      </div>
      <div id="ia-mensajes" class="ia-mensajes"></div>
      <div class="ia-entrada">
        <textarea id="ia-texto" rows="2" placeholder="Preguntá en castellano…"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Asistente.enviar()}"></textarea>
        <button class="ia-enviar" id="ia-enviar" title="Enviar" onclick="Asistente.enviar()">➤</button>
      </div>
      <p class="ia-pie">Usa Gemini de Google: revisá los números importantes, la IA se puede equivocar.</p>`;
    document.body.appendChild(v);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && abierta()) cerrar(); });
    cargar();
  }

  const abierta = () => !!$('ia-ventana') && $('ia-ventana').classList.contains('abierta');
  function abrir() {
    crear();
    $('ia-ventana').classList.add('abierta');
    document.body.classList.add('ia-abierta');
    pintarMensajes();
    setTimeout(() => $('ia-texto') && $('ia-texto').focus(), 50);
  }
  function cerrar() {
    if (!$('ia-ventana')) return;
    $('ia-ventana').classList.remove('abierta');
    document.body.classList.remove('ia-abierta');
  }
  const alternar = () => (abierta() ? cerrar() : abrir());

  // Lo llama menu.js cada vez que se pinta el menú, con el rol de la sesión
  function activar(rol) {
    if (rol === 'admin_central') { crear(); return; }
    cerrar();
    if ($('ia-fab')) $('ia-fab').remove();
    if ($('ia-ventana')) $('ia-ventana').remove();
  }

  function pintarMensajes() {
    const c = $('ia-mensajes');
    if (!c) return;
    if (!mensajes.length) {
      c.innerHTML = `<div class="ia-vacio"><div style="font-size:30px">💬</div>
        <p>Probá con alguna de estas:</p>
        <div class="ia-sugerencias">${SUGERENCIAS.map(q => `<button onclick="Asistente.preguntar(this.textContent)">${esc(q)}</button>`).join('')}</div></div>`;
      return;
    }
    c.innerHTML = mensajes.map((m, i) => m.rol === 'user'
      ? `<div class="ia-msg yo">${esc(m.texto).replace(/\n/g, '<br>')}</div>`
      : `<div class="ia-msg ella ${m.error ? 'error' : ''}">${m.error ? esc(m.error) : md(m.texto)}
          ${(m.consultas || []).length ? `<details class="ia-sql"><summary>Cómo lo calculó (${m.consultas.length} consulta${m.consultas.length > 1 ? 's' : ''})</summary>
            ${m.consultas.map(q => `<div class="cambio">${esc(q.motivo || '')}${q.error ? ' · <span style="color:var(--rojo)">error, corregida</span>' : ` · ${q.filas ?? 0} filas`}</div>
            <pre>${esc(q.sql)}</pre>`).join('')}</details>` : ''}
          ${m.modelo ? `<div class="cambio" style="margin-top:6px;font-size:11px;opacity:.7">Respondió ${esc(m.modelo)}</div>` : ''}
          ${!m.error ? `<button class="ia-copiar" onclick="Asistente.copiar(${i})">Copiar</button>` : ''}</div>`).join('')
      + (ocupado ? '<div class="ia-msg ella pensando"><span></span><span></span><span></span> Consultando los datos…</div>' : '');
    c.scrollTop = c.scrollHeight;
  }

  function preguntar(texto) { $('ia-texto').value = texto; enviar(); }

  async function enviar() {
    const t = ($('ia-texto').value || '').trim();
    if (!t || ocupado) return;
    if (!navigator.onLine) return toast('El asistente necesita señal', 'warning');
    $('ia-texto').value = '';
    mensajes.push({ rol: 'user', texto: t });
    ocupado = true;
    $('ia-enviar').disabled = true;
    guardar(); pintarMensajes();
    try {
      // Solo el texto de la conversación (sin las consultas) y lo último
      const historia = mensajes.filter(m => !m.error).slice(-12).map(m => ({ rol: m.rol, texto: m.texto }));
      const { data, error } = await sb.functions.invoke('asistente-equipos', { body: { mensajes: historia } });
      if (error) {
        let msg = error.message;
        try { const cuerpo = await error.context.json(); if (cuerpo && cuerpo.error) msg = cuerpo.error; } catch (e) { /* nada */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      mensajes.push({ rol: 'model', texto: data.respuesta, consultas: data.consultas || [], modelo: data.modelo });
    } catch (e) {
      mensajes.push({ rol: 'model', error: 'No se pudo responder: ' + (e.message || e) });
    } finally {
      ocupado = false;
      if ($('ia-enviar')) $('ia-enviar').disabled = false;
      guardar(); pintarMensajes();
    }
  }

  function nueva() {
    if (mensajes.length && !confirm('¿Empezar una conversación nueva? La actual se borra de este equipo.')) return;
    mensajes = []; guardar(); pintarMensajes();
    if ($('ia-texto')) $('ia-texto').focus();
  }

  async function copiar(i) {
    try { await navigator.clipboard.writeText(mensajes[i].texto); toast('Copiado', 'success'); }
    catch (e) { toast('No se pudo copiar', 'warning'); }
  }

  function estilos() {
    if ($('ia-estilos')) return;
    const st = document.createElement('style');
    st.id = 'ia-estilos';
    st.textContent = `
      #ia-fab { position: fixed; right: 20px; bottom: 20px; z-index: 140; width: 56px; height: 56px; border-radius: 50%;
        border: 0; cursor: pointer; color: #ffd76a; background: linear-gradient(135deg, #2c4a8a, #1a2744);
        box-shadow: 0 6px 18px rgba(26,39,68,.35); display: flex; align-items: center; justify-content: center;
        transition: transform .15s ease, box-shadow .15s ease; }
      #ia-fab:hover { transform: scale(1.06); box-shadow: 0 8px 22px rgba(26,39,68,.45); }
      #ia-fab:focus-visible { outline: 3px solid #ffd76a; outline-offset: 3px; }
      body.ia-abierta #ia-fab { transform: scale(.9); opacity: .85; }
      #ia-ventana { position: fixed; right: 20px; bottom: 88px; z-index: 145; width: 440px; height: min(640px, calc(100vh - 110px));
        background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(26,39,68,.35); display: flex; flex-direction: column;
        overflow: hidden; opacity: 0; transform: translateY(14px) scale(.98); pointer-events: none; visibility: hidden;
        transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s; }
      #ia-ventana.abierta { opacity: 1; transform: none; pointer-events: auto; visibility: visible; transition-delay: 0s; }
      #ia-ventana .ia-cab { display: flex; align-items: center; gap: 4px; padding: 11px 10px 11px 14px;
        background: linear-gradient(135deg, #2c4a8a, #1a2744); color: #fff; }
      #ia-ventana .ia-titulo { flex: 1; min-width: 0; }
      #ia-ventana .ia-titulo b { display: block; font-size: 15px; }
      #ia-ventana .ia-titulo span { display: block; font-size: 11.5px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ia-icono { border: 0; background: transparent; color: #fff; width: 34px; height: 34px; border-radius: 8px; font-size: 17px; cursor: pointer; }
      .ia-icono:hover { background: rgba(255,255,255,.14); }
      .ia-mensajes { flex: 1; overflow-y: auto; background: #f7f8fb; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .ia-msg { max-width: 88%; padding: 9px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.5; position: relative; }
      .ia-msg.yo { align-self: flex-end; background: var(--azul-medio, #2c4a8a); color: #fff; border-bottom-right-radius: 3px; }
      .ia-msg.ella { align-self: flex-start; background: #fff; border: 1px solid #e5e9f0; border-bottom-left-radius: 3px; max-width: 96%; padding-right: 46px; }
      .ia-msg.error { background: #fdeceb; border-color: #f5c6c2; color: var(--rojo, #c0392b); }
      .ia-msg p { margin: 0 0 7px; } .ia-msg p:last-of-type { margin-bottom: 0; }
      .ia-msg h4 { margin: 8px 0 5px; font-size: 14px; } .ia-msg ul, .ia-msg ol { margin: 4px 0 8px; padding-left: 20px; }
      .ia-msg code { background: #e6eaf2; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
      .ia-tabla { overflow-x: auto; margin: 6px 0 8px; }
      .ia-tabla table { border-collapse: collapse; font-size: 12px; background: #fff; }
      .ia-tabla th { background: var(--azul-oscuro, #1a2744); color: #fff; padding: 5px 8px; text-align: left; white-space: nowrap; }
      .ia-tabla td { padding: 4px 8px; border-bottom: 1px solid #e5e9f0; }
      .ia-sql { margin-top: 8px; font-size: 12px; } .ia-sql summary { cursor: pointer; color: var(--azul-medio, #2c4a8a); font-weight: 600; }
      .ia-sql pre { background: #1a2744; color: #e6eaf2; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; font-size: 11px; margin: 4px 0 8px; }
      .ia-copiar { position: absolute; top: 6px; right: 6px; border: 0; background: transparent; color: var(--gris-texto, #4a5568); font-size: 11px; opacity: .6; cursor: pointer; }
      .ia-copiar:hover { opacity: 1; }
      .ia-entrada { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e9f0; background: #fff; }
      .ia-entrada textarea { flex: 1; padding: 9px 11px; border: 1.5px solid var(--gris-borde, #d5dbe5); border-radius: 10px; resize: none;
        font: inherit; font-size: 14px; outline: none; }
      .ia-entrada textarea:focus { border-color: var(--azul-medio, #2c4a8a); }
      .ia-enviar { width: 44px; border: 0; border-radius: 10px; background: var(--azul-medio, #2c4a8a); color: #fff; font-size: 17px; cursor: pointer; }
      .ia-enviar:disabled { opacity: .5; cursor: default; }
      .ia-pie { margin: 0; padding: 0 12px 9px; font-size: 11px; color: var(--gris-texto, #4a5568); background: #fff; }
      .ia-vacio { margin: auto; text-align: center; color: var(--gris-texto, #4a5568); }
      .ia-vacio p { font-size: 13px; }
      .ia-sugerencias { display: flex; flex-direction: column; gap: 7px; }
      .ia-sugerencias button { border: 1.5px solid var(--gris-borde, #d5dbe5); background: #fff; border-radius: 10px; padding: 8px 11px;
        font-size: 12.5px; color: var(--azul-oscuro, #1a2744); text-align: left; cursor: pointer; }
      .ia-sugerencias button:hover { border-color: var(--azul-medio, #2c4a8a); }
      .pensando { color: var(--gris-texto, #4a5568); }
      .pensando span { display: inline-block; width: 7px; height: 7px; margin-right: 3px; border-radius: 50%; background: var(--azul-medio, #2c4a8a);
        animation: iaPunto 1s infinite ease-in-out; }
      .pensando span:nth-child(2) { animation-delay: .15s; } .pensando span:nth-child(3) { animation-delay: .3s; }
      @keyframes iaPunto { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }
      @media (max-width: 599px) {
        #ia-ventana { right: 0; bottom: 0; width: 100%; height: 100%; border-radius: 0; }
        body.ia-abierta #ia-fab { display: none; }
        #ia-fab { right: 16px; bottom: 16px; width: 52px; height: 52px; }
      }
      @media (prefers-reduced-motion: reduce) { #ia-ventana, #ia-fab { transition: none; } }`;
    document.head.appendChild(st);
  }

  // Si el menú ya se pintó antes de que cargara este archivo
  if (window.Menu && Menu.rol) activar(Menu.rol());

  return { activar, abrir, cerrar, enviar, preguntar, nueva, copiar };
})();
