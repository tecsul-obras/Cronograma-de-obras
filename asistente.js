/* =========================================================================
 * asistente.js — ASISTENTE IA en ventana flotante (solo admin) · v20261006e
 *
 * Botón redondo abajo a la derecha. Se pregunta en castellano y contesta con
 * los datos de la app: la pregunta va a la Edge Function "asistente" de
 * Supabase, que habla con Gemini (la clave vive allá, nunca en la PWA) y
 * corre consultas de SOLO LECTURA con ia_consulta (SQL 24). Misma lógica que
 * el asistente de la app de Parte Diario.
 * ========================================================================= */
(function (global) {
  'use strict';
  var GUARDADO = 'ia_chat_cronograma';
  var SUGERENCIAS = [
    '¿Cuánto se certificó por obra en los últimos 3 meses?',
    'Avance físico de cada obra: certificado acumulado sobre monto vigente',
    '¿Qué ítems de Ruta de la Banana tienen más saldo por producir?',
    'Producción de la semana pasada por obra e ítem',
    '¿Cuántas toneladas de base entraron y salieron del campamento este mes?',
    'Pedidos de compra pendientes de aprobación por obra',
    'Notas de fiscalización vencidas sin respuesta'
  ];
  var mensajes = [], ocupado = false, abierto = false;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(t) { if (global.toast) global.toast(t); }
  function cargar() { try { mensajes = JSON.parse(localStorage.getItem(GUARDADO) || '[]'); } catch (e) { mensajes = []; } }
  function guardar() { try { localStorage.setItem(GUARDADO, JSON.stringify(mensajes.slice(-40))); } catch (e) {} }

  // Markdown mínimo: títulos, negrita, cursiva, código, listas y tablas
  function md(texto) {
    var lineas = esc(texto).split('\n');
    let html = '', i = 0;
    var enLinea = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    while (i < lineas.length) {
      var l = lineas[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1])) {
        var celdas = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map(c => enLinea(c.trim()));
        var cab = celdas(l);
        i += 2;
        var filas = [];
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
      var t = l.match(/^(#{1,4})\s+(.*)$/);
      if (t) { html += `<h4>${enLinea(t[2])}</h4>`; i++; continue; }
      html += l.trim() ? `<p>${enLinea(l)}</p>` : '';
      i++;
    }
    return html;
  }


  function estilos() {
    if ($('iaCss')) return;
    var st = document.createElement('style'); st.id = 'iaCss';
    st.textContent = [
      '#iaFab{position:fixed;right:18px;bottom:18px;z-index:900;width:56px;height:56px;border-radius:50%;border:0;background:#2c4a8a;color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(15,30,60,.35);cursor:pointer;display:none}',
      'body.es-admin #iaFab{display:block}body.mobile.es-admin #iaFab{bottom:calc(70px + env(safe-area-inset-bottom))}',
      '#iaFab:hover{background:#24407a}',
      '#iaPanel{position:fixed;right:18px;bottom:84px;z-index:901;width:min(560px,calc(100vw - 24px));height:min(680px,calc(100vh - 110px));background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(15,30,60,.35);display:none;flex-direction:column;color:#1f2937;overflow:hidden}',
      '#iaPanel.on{display:flex}',
      'body.mobile #iaPanel{right:6px;left:6px;width:auto;bottom:calc(64px + env(safe-area-inset-bottom));height:calc(100vh - 140px)}',
      '.ia-cab{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#1a2744;color:#fff}',
      '.ia-cab b{flex:1;font-size:15px}.ia-cab button{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer}',
      '.ia-mensajes{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#f4f6f9}',
      '.ia-msg{max-width:90%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;position:relative}',
      '.ia-msg.yo{align-self:flex-end;background:#2c4a8a;color:#fff;border-bottom-right-radius:3px}',
      '.ia-msg.ella{align-self:flex-start;background:#fff;border:1px solid #e1e6ee;border-bottom-left-radius:3px;max-width:97%}',
      '.ia-msg.error{background:#fdecea;color:#b03a2e}',
      '.ia-msg p{margin:0 0 6px}.ia-msg p:last-of-type{margin-bottom:0}.ia-msg h4{margin:8px 0 4px;font-size:14px}',
      '.ia-msg ul,.ia-msg ol{margin:4px 0 8px;padding-left:20px}.ia-msg code{background:#e6eaf2;padding:1px 5px;border-radius:4px;font-size:12px}',
      '.ia-tabla{overflow-x:auto;margin:6px 0 8px}.ia-tabla table{border-collapse:collapse;font-size:12px}',
      '.ia-tabla th{background:#1a2744;color:#fff;padding:5px 8px;text-align:left;white-space:nowrap}.ia-tabla td{padding:4px 8px;border-bottom:1px solid #e5e9f0}',
      '.ia-sql{margin-top:6px;font-size:11.5px}.ia-sql summary{cursor:pointer;color:#2c4a8a;font-weight:600}',
      '.ia-sql pre{background:#1a2744;color:#e6eaf2;padding:7px 9px;border-radius:6px;white-space:pre-wrap;font-size:11px;margin:4px 0 6px}',
      '.ia-copiar{position:absolute;top:5px;right:7px;border:0;background:transparent;color:#7a8699;font-size:11px;cursor:pointer;opacity:.7}',
      '.ia-entrada{display:flex;gap:8px;padding:10px;border-top:1px solid #e1e6ee}',
      '.ia-entrada textarea{flex:1;padding:9px 10px;border:1px solid #c9d1dc;border-radius:10px;resize:none;font:inherit;font-size:14px}',
      '.ia-entrada button{border:0;background:#2c4a8a;color:#fff;border-radius:10px;padding:0 16px;font-weight:700;cursor:pointer}',
      '.ia-entrada button:disabled{opacity:.5}',
      '.ia-vacio{margin:auto;text-align:center;color:#4a5568}.ia-sug{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}',
      '.ia-sug button{border:1px solid #c9d1dc;background:#fff;border-radius:16px;padding:6px 11px;font-size:12.5px;color:#1a2744;cursor:pointer;text-align:left}',
      '.ia-pie{font-size:10.5px;color:#7a8699;padding:0 12px 8px}',
      '.pensando span{display:inline-block;width:6px;height:6px;margin-right:3px;border-radius:50%;background:#2c4a8a;animation:iaP 1s infinite ease-in-out}',
      '.pensando span:nth-child(2){animation-delay:.15s}.pensando span:nth-child(3){animation-delay:.3s}',
      '@keyframes iaP{0%,80%,100%{opacity:.25}40%{opacity:1}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function montar() {
    estilos();
    if ($('iaFab')) return;
    var b = document.createElement('button'); b.id = 'iaFab'; b.title = 'Asistente IA'; b.textContent = '✨';
    b.onclick = alternar;
    document.body.appendChild(b);
    var p = document.createElement('div'); p.id = 'iaPanel';
    p.innerHTML = '<div class="ia-cab"><b>✨ Asistente IA</b><button id="iaNueva">Nueva</button><button id="iaCerrar">✕</button></div>' +
      '<div class="ia-mensajes" id="iaMensajes"></div>' +
      '<div class="ia-entrada"><textarea id="iaTexto" rows="2" placeholder="Preguntá sobre obras, producción, certificación, transporte o compras…"></textarea><button id="iaEnviar">Enviar</button></div>' +
      '<div class="ia-pie">Usa Gemini de Google con consultas de solo lectura. Revisá los números importantes: la IA se puede equivocar.</div>';
    document.body.appendChild(p);
    $('iaCerrar').onclick = alternar;
    $('iaNueva').onclick = nueva;
    $('iaEnviar').onclick = enviar;
    $('iaTexto').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } };
    cargar();
  }
  function alternar() {
    montar();
    abierto = !abierto;
    $('iaPanel').classList.toggle('on', abierto);
    if (abierto) { pintarMensajes(); setTimeout(function () { var t = $('iaTexto'); if (t) t.focus(); }, 50); }
  }
  function pintarMensajes() {
    var c = $('iaMensajes'); if (!c) return;
    if (!mensajes.length) {
      c.innerHTML = '<div class="ia-vacio"><div style="font-size:28px">💬</div><p>Probá con alguna de estas:</p><div class="ia-sug">' +
        SUGERENCIAS.map(function (q) { return '<button>' + esc(q) + '</button>'; }).join('') + '</div></div>';
      Array.prototype.forEach.call(c.querySelectorAll('.ia-sug button'), function (b) { b.onclick = function () { $('iaTexto').value = b.textContent; enviar(); }; });
      return;
    }
    c.innerHTML = mensajes.map(function (m, i) {
      if (m.rol === 'user') return '<div class="ia-msg yo">' + esc(m.texto).replace(/\n/g, '<br>') + '</div>';
      return '<div class="ia-msg ella' + (m.error ? ' error' : '') + '">' + (m.error ? esc(m.error) : md(m.texto)) +
        ((m.consultas || []).length ? '<details class="ia-sql"><summary>Cómo lo calculó (' + m.consultas.length + ' consulta' + (m.consultas.length > 1 ? 's' : '') + ')</summary>' +
          m.consultas.map(function (q) { return '<div>' + esc(q.motivo || '') + (q.error ? ' · <span style="color:#c0392b">error, corregida</span>' : ' · ' + (q.filas || 0) + ' filas') + '</div><pre>' + esc(q.sql) + '</pre>'; }).join('') + '</details>' : '') +
        (m.modelo ? '<div style="margin-top:5px;font-size:10.5px;opacity:.65">Respondió ' + esc(m.modelo) + '</div>' : '') +
        (!m.error ? '<button class="ia-copiar" data-copiar="' + i + '">Copiar</button>' : '') + '</div>';
    }).join('') + (ocupado ? '<div class="ia-msg ella pensando"><span></span><span></span><span></span> Consultando los datos…</div>' : '');
    Array.prototype.forEach.call(c.querySelectorAll('[data-copiar]'), function (b) {
      b.onclick = function () { navigator.clipboard.writeText(mensajes[+b.getAttribute('data-copiar')].texto).then(function () { toast('Copiado'); }); };
    });
    c.scrollTop = c.scrollHeight;
  }
  async function enviar() {
    var t = ($('iaTexto').value || '').trim();
    if (!t || ocupado) return;
    if (!navigator.onLine) { toast('El asistente necesita conexión'); return; }
    var sb = global.ObraAPI && global.ObraAPI._sb && global.ObraAPI._sb();
    if (!sb) { toast('Sin conexión con Supabase'); return; }
    $('iaTexto').value = '';
    mensajes.push({ rol: 'user', texto: t });
    ocupado = true; $('iaEnviar').disabled = true; guardar(); pintarMensajes();
    try {
      var historia = mensajes.filter(function (m) { return !m.error; }).slice(-12).map(function (m) { return { rol: m.rol, texto: m.texto }; });
      var r = await sb.functions.invoke('asistente', { body: { mensajes: historia } });
      if (r.error) {
        var msg = r.error.message;
        try { var cuerpo = await r.error.context.json(); if (cuerpo && cuerpo.error) msg = cuerpo.error; } catch (e) {}
        if (/not found|404|Failed to send/i.test(msg)) msg += ' — ¿ya está publicada la Edge Function «asistente» en Supabase? (ver LEEME_ASISTENTE_IA.md)';
        throw new Error(msg);
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      mensajes.push({ rol: 'model', texto: r.data.respuesta, consultas: r.data.consultas || [], modelo: r.data.modelo });
    } catch (e) {
      mensajes.push({ rol: 'model', error: 'No se pudo responder: ' + (e.message || e) });
    } finally {
      ocupado = false; if ($('iaEnviar')) $('iaEnviar').disabled = false; guardar(); pintarMensajes();
    }
  }
  function nueva() {
    if (mensajes.length && !confirm('¿Empezar una conversación nueva? La actual se borra de este equipo.')) return;
    mensajes = []; guardar(); pintarMensajes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
  global.AsistenteIA = { abrir: function () { if (!abierto) alternar(); }, nueva: nueva };
})(window);
