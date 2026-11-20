window.Asistente=(()=>{const z='<img src="./ia_tractor.png" alt="" width="76" height="58" draggable="false"><svg class="ia-chispa" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#ffc83d" stroke="#fff" stroke-width="1.2" d="M10 2.5l1.7 4.6 4.6 1.7-4.6 1.7L10 15.1 8.3 10.5 3.7 8.8l4.6-1.7z"/><path fill="#ffc83d" stroke="#fff" stroke-width="1" d="M18 13l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/></svg>',x="ia_chat",A=["¿Qué equipos trabajaron más horas este mes?","¿Qué máquinas no cargaron parte en los últimos 3 días?","Consumo de gasoil por equipo el mes pasado comparado con su referencia","Órdenes de trabajo abiertas hace más de 30 días: ¿qué tienen en común?","Horas hombre por obra en septiembre","¿Cuánto se liquidó de alquileres por arrendatario en los últimos 3 meses?"];let s=[],d=!1;const t=e=>document.getElementById(e),l=e=>String(e??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]);function j(){try{s=JSON.parse(localStorage.getItem(x)||"[]")}catch{s=[]}}function u(){try{localStorage.setItem(x,JSON.stringify(s.slice(-40)))}catch{}}function C(e){const a=l(e).split(`
`);let o="",i=0;const n=r=>r.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<i>$2</i>");for(;i<a.length;){const r=a[i];if(/^\s*\|.*\|\s*$/.test(r)&&i+1<a.length&&/^\s*\|[\s:|-]+\|\s*$/.test(a[i+1])){const k=c=>c.trim().replace(/^\||\|$/g,"").split("|").map(b=>n(b.trim())),T=k(r);i+=2;const $=[];for(;i<a.length&&/^\s*\|.*\|\s*$/.test(a[i]);)$.push(k(a[i++]));o+=`<div class="ia-tabla"><table><thead><tr>${T.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>${$.map(c=>`<tr>${c.map(b=>`<td>${b}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;continue}if(/^\s*[-*•]\s+/.test(r)){for(o+="<ul>";i<a.length&&/^\s*[-*•]\s+/.test(a[i]);)o+=`<li>${n(a[i++].replace(/^\s*[-*•]\s+/,""))}</li>`;o+="</ul>";continue}if(/^\s*\d+[.)]\s+/.test(r)){for(o+="<ol>";i<a.length&&/^\s*\d+[.)]\s+/.test(a[i]);)o+=`<li>${n(a[i++].replace(/^\s*\d+[.)]\s+/,""))}</li>`;o+="</ol>";continue}const w=r.match(/^(#{1,4})\s+(.*)$/);if(w){o+=`<h4>${n(w[2])}</h4>`,i++;continue}o+=r.trim()?`<p>${n(r)}</p>`:"",i++}return o}function g(){if(t("ia-fab"))return;I();const e=document.createElement("button");e.id="ia-fab",e.title="Asistente IA",e.setAttribute("aria-label","Abrir el asistente IA"),e.innerHTML=z,e.onclick=()=>E(),document.body.appendChild(e);const a=document.createElement("div");a.id="ia-ventana",a.setAttribute("role","dialog"),a.setAttribute("aria-label","Asistente IA"),a.innerHTML=`
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
      <p class="ia-pie">Usa Gemini de Google: revisá los números importantes, la IA se puede equivocar.</p>`,document.body.appendChild(a),document.addEventListener("keydown",o=>{o.key==="Escape"&&v()&&p()}),j()}const v=()=>!!t("ia-ventana")&&t("ia-ventana").classList.contains("abierta");function m(){g(),t("ia-ventana").classList.add("abierta"),document.body.classList.add("ia-abierta"),f(),setTimeout(()=>t("ia-texto")&&t("ia-texto").focus(),50)}function p(){t("ia-ventana")&&(t("ia-ventana").classList.remove("abierta"),document.body.classList.remove("ia-abierta"))}const E=()=>v()?p():m();function h(e){if(e==="admin_central"){g();return}p(),t("ia-fab")&&t("ia-fab").remove(),t("ia-ventana")&&t("ia-ventana").remove()}function f(){const e=t("ia-mensajes");if(e){if(!s.length){e.innerHTML=`<div class="ia-vacio"><div style="font-size:calc(30px*var(--fs,1))">💬</div>
        <p>Probá con alguna de estas:</p>
        <div class="ia-sugerencias">${A.map(a=>`<button onclick="Asistente.preguntar(this.textContent)">${l(a)}</button>`).join("")}</div></div>`;return}e.innerHTML=s.map((a,o)=>a.rol==="user"?`<div class="ia-msg yo">${l(a.texto).replace(/\n/g,"<br>")}</div>`:`<div class="ia-msg ella ${a.error?"error":""}">${a.error?l(a.error):C(a.texto)}
          ${(a.consultas||[]).length?`<details class="ia-sql"><summary>Cómo lo calculó (${a.consultas.length} consulta${a.consultas.length>1?"s":""})</summary>
            ${a.consultas.map(i=>`<div class="cambio">${l(i.motivo||"")}${i.error?' · <span style="color:var(--rojo)">error, corregida</span>':` · ${i.filas??0} filas`}</div>
            <pre>${l(i.sql)}</pre>`).join("")}</details>`:""}
          ${a.modelo?`<div class="cambio" style="margin-top:6px;font-size:calc(11px*var(--fs,1));opacity:.7">Respondió ${l(a.modelo)}</div>`:""}
          ${a.error?"":`<button class="ia-copiar" onclick="Asistente.copiar(${o})">Copiar</button>`}</div>`).join("")+(d?'<div class="ia-msg ella pensando"><span></span><span></span><span></span> Consultando los datos…</div>':""),e.scrollTop=e.scrollHeight}}function L(e){t("ia-texto").value=e,y()}async function y(){const e=(t("ia-texto").value||"").trim();if(!(!e||d)){if(!navigator.onLine)return toast("El asistente necesita señal","warning");t("ia-texto").value="",s.push({rol:"user",texto:e}),d=!0,t("ia-enviar").disabled=!0,u(),f();try{const a=s.filter(n=>!n.error).slice(-12).map(n=>({rol:n.rol,texto:n.texto})),{data:o,error:i}=await sb.functions.invoke("asistente-equipos",{body:{mensajes:a}});if(i){let n=i.message;try{const r=await i.context.json();r&&r.error&&(n=r.error)}catch{}throw new Error(n)}if(o&&o.error)throw new Error(o.error);s.push({rol:"model",texto:o.respuesta,consultas:o.consultas||[],modelo:o.modelo})}catch(a){s.push({rol:"model",error:"No se pudo responder: "+(a.message||a)})}finally{d=!1,t("ia-enviar")&&(t("ia-enviar").disabled=!1),u(),f()}}}function q(){s.length&&!confirm("¿Empezar una conversación nueva? La actual se borra de este equipo.")||(s=[],u(),f(),t("ia-texto")&&t("ia-texto").focus())}async function M(e){try{await navigator.clipboard.writeText(s[e].texto),toast("Copiado","success")}catch{toast("No se pudo copiar","warning")}}function I(){if(t("ia-estilos"))return;const e=document.createElement("style");e.id="ia-estilos",e.textContent=`
      #ia-fab { position: fixed; right: 14px; bottom: 14px; z-index: 140; width: 80px; height: 62px; padding: 0;
        border: 0; cursor: pointer; background: transparent; display: flex; align-items: center; justify-content: center;
        filter: drop-shadow(0 0 1.5px #fff) drop-shadow(0 4px 6px rgba(26,39,68,.35)); transition: transform .15s ease; }
      #ia-fab:hover { transform: scale(1.08) rotate(-3deg); }
      #ia-fab:active { transform: scale(.96); }
      #ia-fab img { width: 76px; height: auto; display: block; pointer-events: none; }
      #ia-fab .ia-chispa { position: absolute; top: -6px; left: 2px; }
      #ia-fab:focus-visible { outline: 3px solid #ffd76a; outline-offset: 3px; border-radius: 10px; }
      body.ia-abierta #ia-fab { transform: scale(.9); opacity: .85; }
      #ia-ventana { position: fixed; right: 20px; bottom: 88px; z-index: 145; width: 440px; height: min(640px, calc(100vh - 110px));
        background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(26,39,68,.35); display: flex; flex-direction: column;
        overflow: hidden; opacity: 0; transform: translateY(14px) scale(.98); pointer-events: none; visibility: hidden;
        transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s; }
      #ia-ventana.abierta { opacity: 1; transform: none; pointer-events: auto; visibility: visible; transition-delay: 0s; }
      #ia-ventana .ia-cab { display: flex; align-items: center; gap: 4px; padding: 11px 10px 11px 14px;
        background: linear-gradient(135deg, #2c4a8a, #1a2744); color: #fff; }
      #ia-ventana .ia-titulo { flex: 1; min-width: 0; }
      #ia-ventana .ia-titulo b { display: block; font-size: calc(15px*var(--fs,1)); }
      #ia-ventana .ia-titulo span { display: block; font-size: calc(11.5px*var(--fs,1)); opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ia-icono { border: 0; background: transparent; color: #fff; width: 34px; height: 34px; border-radius: 8px; font-size: calc(17px*var(--fs,1)); cursor: pointer; }
      .ia-icono:hover { background: rgba(255,255,255,.14); }
      .ia-mensajes { flex: 1; overflow-y: auto; background: #f7f8fb; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .ia-msg { max-width: 88%; padding: 9px 12px; border-radius: 12px; font-size: calc(13.5px*var(--fs,1)); line-height: 1.5; position: relative; }
      .ia-msg.yo { align-self: flex-end; background: var(--azul-medio, #2c4a8a); color: #fff; border-bottom-right-radius: 3px; }
      .ia-msg.ella { align-self: flex-start; background: #fff; border: 1px solid #e5e9f0; border-bottom-left-radius: 3px; max-width: 96%; padding-right: 46px; }
      .ia-msg.error { background: #fdeceb; border-color: #f5c6c2; color: var(--rojo, #c0392b); }
      .ia-msg p { margin: 0 0 7px; } .ia-msg p:last-of-type { margin-bottom: 0; }
      .ia-msg h4 { margin: 8px 0 5px; font-size: calc(14px*var(--fs,1)); } .ia-msg ul, .ia-msg ol { margin: 4px 0 8px; padding-left: 20px; }
      .ia-msg code { background: #e6eaf2; padding: 1px 5px; border-radius: 4px; font-size: calc(12px*var(--fs,1)); }
      .ia-tabla { overflow-x: auto; margin: 6px 0 8px; }
      .ia-tabla table { border-collapse: collapse; font-size: calc(12px*var(--fs,1)); background: #fff; }
      .ia-tabla th { background: var(--azul-oscuro, #1a2744); color: #fff; padding: 5px 8px; text-align: left; white-space: nowrap; }
      .ia-tabla td { padding: 4px 8px; border-bottom: 1px solid #e5e9f0; }
      .ia-sql { margin-top: 8px; font-size: calc(12px*var(--fs,1)); } .ia-sql summary { cursor: pointer; color: var(--azul-medio, #2c4a8a); font-weight: 600; }
      .ia-sql pre { background: #1a2744; color: #e6eaf2; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; font-size: calc(11px*var(--fs,1)); margin: 4px 0 8px; }
      .ia-copiar { position: absolute; top: 6px; right: 6px; border: 0; background: transparent; color: var(--gris-texto, #4a5568); font-size: calc(11px*var(--fs,1)); opacity: .6; cursor: pointer; }
      .ia-copiar:hover { opacity: 1; }
      .ia-entrada { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e9f0; background: #fff; }
      .ia-entrada textarea { flex: 1; padding: 9px 11px; border: 1.5px solid var(--gris-borde, #d5dbe5); border-radius: 10px; resize: none;
        font: inherit; font-size: calc(14px*var(--fs,1)); outline: none; }
      .ia-entrada textarea:focus { border-color: var(--azul-medio, #2c4a8a); }
      .ia-enviar { width: 44px; border: 0; border-radius: 10px; background: var(--azul-medio, #2c4a8a); color: #fff; font-size: calc(17px*var(--fs,1)); cursor: pointer; }
      .ia-enviar:disabled { opacity: .5; cursor: default; }
      .ia-pie { margin: 0; padding: 0 12px 9px; font-size: calc(11px*var(--fs,1)); color: var(--gris-texto, #4a5568); background: #fff; }
      .ia-vacio { margin: auto; text-align: center; color: var(--gris-texto, #4a5568); }
      .ia-vacio p { font-size: calc(13px*var(--fs,1)); }
      .ia-sugerencias { display: flex; flex-direction: column; gap: 7px; }
      .ia-sugerencias button { border: 1.5px solid var(--gris-borde, #d5dbe5); background: #fff; border-radius: 10px; padding: 8px 11px;
        font-size: calc(12.5px*var(--fs,1)); color: var(--azul-oscuro, #1a2744); text-align: left; cursor: pointer; }
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
      @media (prefers-reduced-motion: reduce) { #ia-ventana, #ia-fab { transition: none; } }`,document.head.appendChild(e)}return window.Menu&&Menu.rol&&h(Menu.rol()),{activar:h,abrir:m,cerrar:p,enviar:y,preguntar:L,nueva:q,copiar:M}})();
