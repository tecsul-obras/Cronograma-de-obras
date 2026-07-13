/* =========================================================================
 * carga.js — módulo de CREACIÓN de datos
 *   · Crear obras nuevas desde la PWA
 *   · Cargar ítems pegando listas de Excel (Ctrl+V)
 *   · Cargar la distribución mensual pegando una matriz ítems × meses
 * Se integra con app.js (usa ITEMS, CATS, MONTHS, byId, reindex, touch, toast…)
 * ========================================================================= */
'use strict';

/* (los parsers parsePasted/parseNum/parseFecha viven en app.js) */

/* ================= MODAL: NUEVA OBRA ================= */
function openNuevaObra(){
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Nueva obra</h3>
    <div class="dfield"><label>ID de obra (se usa en Power BI — no lo cambies después)</label>
      <input id="noId" placeholder="ej. 1012600000"></div>
    <div class="dfield"><label>Nombre</label><input id="noNombre" placeholder="ej. Ruta 2 — Tramo Sur"></div>
    <div class="dgrid2">
      <div class="dfield"><label>Llamado</label><input id="noLlamado" placeholder="LLAMADO MOPC N° …"></div>
      <div class="dfield"><label>Lote</label><input id="noLote" placeholder="1"></div>
    </div>
    <div class="dgrid2">
      <div class="dfield"><label>Fecha inicio</label><input type="date" id="noIni"></div>
      <div class="dfield"><label>Fecha fin</label><input type="date" id="noFin"></div>
    </div>
    <div class="hint" id="noMsg"></div>
    <button class="dsave" id="noSave">Crear obra</button>
  </div>`;
  m.classList.add('open');
  $('#noSave').onclick=async()=>{
    const id=$('#noId').value.trim(), nombre=$('#noNombre').value.trim();
    if(!id||!nombre){ $('#noMsg').textContent='ID y nombre son obligatorios'; return; }
    $('#noSave').disabled=true; $('#noMsg').textContent='Creando…';
    try{
      await ObraAPI.crearObra({ obra_id:id, nombre:nombre,
        llamado:$('#noLlamado').value.trim(), lote:$('#noLote').value.trim(),
        moneda:'PYG', fecha_inicio:$('#noIni').value, fecha_fin:$('#noFin').value, activo:true });
      toast('Obra <b>'+nombre+'</b> creada');
      closeModal();
      await refreshObraList(id);      // recarga el selector y salta a la obra nueva
    }catch(err){ $('#noMsg').textContent='Error: '+err.message; $('#noSave').disabled=false; }
  };
}

/* ================= MODAL: PEGAR ÍTEMS DESDE EXCEL ================= */
const COLS_ITEM=[
  {k:'',        n:'— ignorar —'},
  {k:'item_id', n:'ID ítem'},
  {k:'desc',    n:'Descripción'},
  {k:'um',      n:'Unidad (UM)'},
  {k:'cant',    n:'Cantidad contrato'},
  {k:'pu',      n:'Precio unitario'},
  {k:'codigo_cc',n:'Código CC'},
  {k:'cat',     n:'Categoría'},
  {k:'ini',     n:'Fecha inicio'},
  {k:'fin',     n:'Fecha fin'},
];
function openPegarItems(){
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Cargar ítems desde Excel</h3>
    <p class="hint" style="margin-bottom:10px">Copiá el rango en Excel (Ctrl+C) y pegalo acá abajo (Ctrl+V).
      Después indicá qué es cada columna.</p>
    <textarea id="pgArea" class="paste-area" placeholder="Pegá acá las filas de Excel…"></textarea>
    <label class="hint" style="display:block;margin:8px 0">
      <input type="checkbox" id="pgHeader" checked> La primera fila son encabezados</label>
    <div id="pgMap"></div>
    <div id="pgPrev"></div>
    <div class="hint" id="pgMsg"></div>
    <div class="dactions">
      <button class="dsave" id="pgSave" disabled>Importar ítems</button>
    </div>
  </div>`;
  m.classList.add('open');
  const area=$('#pgArea');
  area.focus();
  let grid=[];
  const redraw=()=>{
    grid=parsePasted(area.value);
    if(!grid.length){ $('#pgMap').innerHTML=''; $('#pgPrev').innerHTML=''; $('#pgSave').disabled=true; return; }
    const hasHdr=$('#pgHeader').checked;
    const head=grid[0];
    const ncol=Math.max(...grid.map(r=>r.length));
    // autodetectar mapeo por nombre de encabezado
    const guess=c=>{
      const h=(hasHdr?(head[c]||''):'').toLowerCase();
      if(/(^|\b)(id|item|ítem|nro|n°|codigo item)/.test(h) && !/cc/.test(h)) return 'item_id';
      if(/desc|item de obra|denomin/.test(h)) return 'desc';
      if(/u\.?m|unidad|medida/.test(h)) return 'um';
      if(/cant/.test(h)) return 'cant';
      if(/precio.*unit|p\.?u\.?|unitario/.test(h)) return 'pu';
      if(/cc|centro/.test(h)) return 'codigo_cc';
      if(/categor|rubro/.test(h)) return 'cat';
      if(/inicio|desde/.test(h)) return 'ini';
      if(/fin|hasta/.test(h)) return 'fin';
      // por posición si no hay encabezado
      if(!hasHdr){ return ['item_id','desc','um','cant','pu'][c] || ''; }
      return '';
    };
    $('#pgMap').innerHTML='<div class="map-grid">'+Array.from({length:ncol},(_,c)=>{
      const g=guess(c);
      return `<div class="map-col">
        <div class="map-h">${hasHdr?(head[c]||'col '+(c+1)):'col '+(c+1)}</div>
        <select class="map-sel" data-c="${c}">${COLS_ITEM.map(o=>`<option value="${o.k}" ${o.k===g?'selected':''}>${o.n}</option>`).join('')}</select>
      </div>`;}).join('')+'</div>';
    $$('.map-sel').forEach(s=>s.onchange=preview);
    preview();
  };
  const preview=()=>{
    const hasHdr=$('#pgHeader').checked;
    const map={}; $$('.map-sel').forEach(s=>{ if(s.value) map[s.value]=+s.dataset.c; });
    const body=grid.slice(hasHdr?1:0).filter(r=>r.some(c=>c!==''));
    if(map.desc==null && map.item_id==null){
      $('#pgPrev').innerHTML='<div class="hint">Asigná al menos "ID ítem" o "Descripción".</div>';
      $('#pgSave').disabled=true; return;
    }
    const rows=body.map(r=>buildItemFromRow(r,map));
    const dup=rows.filter(r=>byId[r.id]).length;
    $('#pgPrev').innerHTML=`
      <div class="prev-note">${rows.length} ítems · ${dup} ya existen (se actualizan) · ${rows.length-dup} nuevos</div>
      <div class="prev-wrap"><table class="prev-tbl">
        <thead><tr><th>ID</th><th>Descripción</th><th>UM</th><th class="r">Cantidad</th><th class="r">P. unitario</th><th class="r">Total</th></tr></thead>
        <tbody>${rows.slice(0,12).map(r=>`<tr class="${byId[r.id]?'dup':''}">
          <td class="mono">${r.id}</td><td>${(r.desc||'').slice(0,40)}</td><td class="mono">${r.um||''}</td>
          <td class="r mono">${fmtN(r.cant)}</td><td class="r mono">${fmtN(r.pu,0)}</td>
          <td class="r mono">${fmtGshort(r.cant*r.pu)}</td></tr>`).join('')}
        ${rows.length>12?`<tr><td colspan="6" class="hint">… y ${rows.length-12} más</td></tr>`:''}
        </tbody></table></div>`;
    $('#pgSave').disabled=!rows.length;
    $('#pgSave').onclick=()=>importItems(rows);
  };
  area.oninput=redraw;
  area.onpaste=()=>setTimeout(redraw,10);
  $('#pgHeader').onchange=redraw;
}
function buildItemFromRow(r,map){
  const g=k=>map[k]!=null? (r[map[k]]||'') : '';
  let id=String(g('item_id')||'').trim();
  if(!id){ const mx=Math.max(0,...ITEMS.map(i=>parseInt(i.id)||0)); id=String(mx+1+(buildItemFromRow._n=(buildItemFromRow._n||0)+1)); }
  id=id.replace(/\.0$/,'');
  return {
    id: id,
    desc: String(g('desc')||'').trim(),
    um: String(g('um')||'').trim(),
    cant: parseNum(g('cant')),
    pu: parseNum(g('pu')),
    codigo_cc: String(g('codigo_cc')||'').trim(),
    cat: String(g('cat')||'').trim() || (CATS[0]||'Sin categoría'),
    ini: parseFecha(g('ini')),
    fin: parseFecha(g('fin')),
  };
}
function importItems(rows){
  buildItemFromRow._n=0;
  let nuevos=0, act=0;
  rows.forEach(r=>{
    const ex=byId[r.id];
    if(ex){
      ex.desc=r.desc||ex.desc; ex.um=r.um||ex.um;
      if(r.cant) ex.cant=r.cant;
      if(r.pu) ex.pu=r.pu;
      if(r.codigo_cc) ex.codigo_cc=r.codigo_cc;
      if(r.cat) ex.cat=r.cat;
      if(r.ini) ex.ini=r.ini;
      if(r.fin) ex.fin=r.fin;
      if(ex.ini&&ex.fin) redistributeMonths(ex,true);
      act++;
    } else {
      const it={ id:r.id, desc:r.desc, codigo_cc:r.codigo_cc, um:r.um,
        cant:r.cant, pu:r.pu, get ptot(){return this.cant*this.pu;},
        incidencia:null, avE:null, ini:r.ini||null, fin:r.fin||null,
        estado:'Pendiente', cat:r.cat, dist_mensual:{}, deps:[], avance_real_prod:null };
      ITEMS.push(it);
      if(it.ini&&it.fin) redistributeMonths(it,false);
      nuevos++;
    }
    if(r.cat && !CATS.includes(r.cat)) CATS.push(r.cat);
  });
  reindex(); MONTHS=computeMonths();
  touch(); closeModal(); renderGantt(); renderKPIs();
  toast(`Importados: <b>${nuevos}</b> nuevos · <b>${act}</b> actualizados`);
}

/* ============ MODAL: PEGAR DISTRIBUCIÓN MENSUAL (matriz) ============ */
function openPegarMensual(){
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Cargar distribución mensual desde Excel</h3>
    <p class="hint" style="margin-bottom:10px">Pegá una matriz: primera columna el <b>ID del ítem</b>,
      y una columna por mes con el encabezado del mes (ej. <span class="mono">2025-06</span>,
      <span class="mono">jun-25</span> o <span class="mono">1/6/2025</span>). Las celdas son las cantidades.</p>
    <textarea id="pmArea" class="paste-area" placeholder="item_id&#9;2025-06&#9;2025-07&#9;…"></textarea>
    <div class="seg" id="pmMode" style="margin:8px 0">
      <button data-m="cant" class="on">Son cantidades</button>
      <button data-m="pct">Son porcentajes</button>
    </div>
    <div id="pmPrev"></div>
    <div class="hint" id="pmMsg"></div>
    <div class="dactions"><button class="dsave" id="pmSave" disabled>Importar distribución</button></div>
  </div>`;
  m.classList.add('open');
  let mode='cant';
  $('#pmMode').onclick=e=>{const b=e.target.closest('button');if(!b)return;
    $$('#pmMode button').forEach(x=>x.classList.remove('on'));b.classList.add('on');mode=b.dataset.m;redraw();};
  const area=$('#pmArea'); area.focus();
  const redraw=()=>{
    const grid=parsePasted(area.value);
    if(grid.length<2){ $('#pmPrev').innerHTML=''; $('#pmSave').disabled=true; return; }
    const head=grid[0];
    const monthCols=[];
    for(let c=1;c<head.length;c++){ const mk=normMonth(head[c]); if(mk) monthCols.push([c,mk]); }
    if(!monthCols.length){ $('#pmPrev').innerHTML='<div class="hint">No reconocí ninguna columna de mes en el encabezado.</div>'; $('#pmSave').disabled=true; return; }
    const rows=[];
    grid.slice(1).forEach(r=>{
      const id=String(r[0]||'').trim().replace(/\.0$/,''); if(!id||!byId[id]) return;
      const d={}; monthCols.forEach(([c,mk])=>{ const v=parseNum(r[c]); if(v) d[mk]=v; });
      if(Object.keys(d).length) rows.push({id,dist:d});
    });
    const unknown=grid.slice(1).filter(r=>{const id=String(r[0]||'').trim().replace(/\.0$/,'');return id&&!byId[id];}).length;
    $('#pmPrev').innerHTML=`<div class="prev-note">${rows.length} ítems reconocidos · ${monthCols.length} meses${unknown?` · ${unknown} IDs no existen (se ignoran)`:''}</div>
      <div class="prev-wrap"><table class="prev-tbl"><thead><tr><th>ID</th><th>Descripción</th>
        ${monthCols.slice(0,8).map(([,mk])=>`<th class="r">${mk}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0,10).map(r=>`<tr><td class="mono">${r.id}</td><td>${(byId[r.id].desc||'').slice(0,26)}</td>
        ${monthCols.slice(0,8).map(([,mk])=>`<td class="r mono">${r.dist[mk]!=null?fmtN(r.dist[mk],1):'—'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>`;
    $('#pmSave').disabled=!rows.length;
    $('#pmSave').onclick=()=>{
      rows.forEach(r=>{
        const it=byId[r.id];
        const d={};
        Object.entries(r.dist).forEach(([mk,v])=>{ d[mk]= mode==='pct' ? +( (it.cant||0)*v/100 ).toFixed(3) : v; });
        it.dist_mensual=d;
        it._manualMonths={}; Object.keys(d).forEach(mk=>it._manualMonths[mk]=true);
        // el mensual MANDA: recalcula fechas, cantidad total y regenera el plan semanal
        syncDatesFromMonths(it,{setCant:true});
      });
      MONTHS=computeMonths(); touch(); closeModal(); renderGantt(); renderKPIs();
      toast(`Distribución mensual cargada en <b>${rows.length}</b> ítems`);
    };
  };
  area.oninput=redraw; area.onpaste=()=>setTimeout(redraw,10);
}
/* normaliza encabezados de mes: 2025-06 | jun-25 | 1/6/2025 | junio 2025 */
function normMonth(s){
  if(!s) return null;
  const t=String(s).trim().toLowerCase();
  let m=t.match(/^(\d{4})[-\/](\d{1,2})/); if(m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
  m=t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if(m){ let y=+m[3]; if(y<100)y+=2000; return `${y}-${String(+m[2]).padStart(2,'0')}`; }
  const MES={ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,set:9,oct:10,nov:11,dic:12};
  m=t.match(/^([a-záéíóú]{3,10})[\s\-\/]*(\d{2,4})$/);
  if(m){ const mm=MES[m[1].slice(0,3)]; let y=+m[2]; if(y<100)y+=2000;
    if(mm) return `${y}-${String(mm).padStart(2,'0')}`; }
  return null;
}

/* ================= selector de obras ================= */
async function refreshObraList(selectId){
  try{
    const obras=await ObraAPI.listObras();
    const sel=$('#obraSel');
    sel.innerHTML=obras.map(o=>`<option value="${o.obra_id}">${o.nombre}</option>`).join('')
      + `<option value="__new__">＋ Nueva obra…</option>`;
    const target=selectId||ObraAPI.getObraId();
    if(obras.some(o=>String(o.obra_id)===String(target))) sel.value=target;
    if(selectId && String(selectId)!==String(ObraAPI.getObraId())) await cambiarObra(selectId);
  }catch(err){ console.warn('listObras:',err.message); }
}
async function cambiarObra(obraId){
  ObraAPI.setObraId(obraId);
  toast('Cargando obra…');
  const d=await ObraAPI.getObra(obraId);
  reloadModel(d);                 // definido en app.js
  toast('Obra cargada · <b>'+ITEMS.length+'</b> ítems');
}
