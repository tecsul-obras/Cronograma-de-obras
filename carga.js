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
  {k:'grupo',   n:'¿Es título? (sí/no)'},
];

/* ¿Esta fila del Excel es un TÍTULO y no un ítem del contrato?
   Manda la columna explícita si el usuario la mapeó. Si no, se deduce: una fila
   con descripción pero SIN cantidad Y SIN precio unitario no es algo que se
   ejecute ni se certifique — es un encabezado ("TRABAJOS PRELIMINARES").
   Se exigen las DOS condiciones a propósito: hay ítems reales con cantidad 0
   pero precio cargado (el 17 de CECON), y ésos NO son títulos. */
const VERDADERO=/^(s[ií]|si|true|verdadero|x|1|grupo|t[ií]tulo|titulo)$/i;
function esTituloFila(r, hayColumna){
  if(hayColumna) return VERDADERO.test(String(r.grupoRaw||'').trim());
  if(!r.desc) return false;
  return !r.cant && !r.pu;
}
function openPegarItems(){
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Cargar ítems desde Excel</h3>
    <p class="hint" style="margin-bottom:10px">Copiá el rango en Excel (Ctrl+C) y pegalo acá abajo (Ctrl+V).
      Después indicá qué es cada columna.</p>
    <div class="xl-bar"><button type="button" class="chipbtn" id="pgXlsBaja">⬇ Planilla Excel (con los ítems actuales)</button>
      <label class="chipbtn" style="cursor:pointer">⬆ Subir Excel<input type="file" id="pgXlsSube" accept=".xlsx" hidden></label>
      <span class="hint">o pegá abajo</span></div>
    <textarea id="pgArea" class="paste-area" placeholder="Pegá acá las filas de Excel…"></textarea>
    <label class="hint" style="display:block;margin:8px 0">
      <input type="checkbox" id="pgHeader" checked> La primera fila son encabezados</label>
    <label class="hint" style="display:block;margin:0 0 8px">
      <input type="checkbox" id="pgGrupos" checked> Marcar como <b>título</b> las filas sin cantidad ni precio
      <span style="color:#8fa2b8">— los títulos llevan la barra de agrupamiento en el Gantt.
      Destildá esto si en tu planilla esas filas son ítems de verdad.</span></label>
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
      if(/t[ií]tulo|titulo|es grupo|grupo/.test(h)) return 'grupo';
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
    clasificarTitulos(rows, map.grupo!=null, $('#pgGrupos').checked);
    const dup=rows.filter(r=>byId[r.id]).length;
    const nTit=rows.filter(r=>r.esGrupo).length;
    // se muestran primero los títulos detectados: es lo que hay que revisar
    const muestra=rows.filter(r=>r.esGrupo).concat(rows.filter(r=>!r.esGrupo)).slice(0,12);
    $('#pgPrev').innerHTML=`
      <div class="prev-note">${rows.length} ítems · ${dup} ya existen (se actualizan) · ${rows.length-dup} nuevos
        ${nTit?` · <b style="color:#f2c200">${nTit} título(s)</b> con barra de agrupamiento`:' · sin títulos'}</div>
      <div class="prev-wrap"><table class="prev-tbl">
        <thead><tr><th>ID</th><th>Descripción</th><th>UM</th><th class="r">Cantidad</th><th class="r">P. unitario</th><th class="r">Total</th></tr></thead>
        <tbody>${muestra.map(r=>`<tr class="${byId[r.id]?'dup':''}">
          <td class="mono">${r.id}</td>
          <td>${r.esGrupo?'<b style="color:#f2c200">▸ ':''}${(r.desc||'').slice(0,40)}${r.esGrupo?'</b>':''}</td>
          <td class="mono">${r.esGrupo?'':(r.um||'')}</td>
          <td class="r mono">${r.esGrupo?'—':fmtN(r.cant)}</td><td class="r mono">${r.esGrupo?'—':fmtN(r.pu,0)}</td>
          <td class="r mono">${r.esGrupo?'título':fmtGshort(r.cant*r.pu)}</td></tr>`).join('')}
        ${rows.length>12?`<tr><td colspan="6" class="hint">… y ${rows.length-12} más</td></tr>`:''}
        </tbody></table></div>`;
    $('#pgSave').disabled=!rows.length;
    $('#pgSave').onclick=()=>importItems(rows);
  };
  area.oninput=redraw;
  area.onpaste=()=>setTimeout(redraw,10);
  $('#pgXlsBaja').onclick=()=>excelItems().catch(e=>alert('No se pudo armar el Excel: '+e.message));
  $('#pgXlsSube').onchange=e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
    excelATexto(f,'tems').then(t=>{ area.value=t; $('#pgHeader').checked=true; redraw(); toast('Excel leído: revisá la vista previa e importá'); })
      .catch(err=>alert('No se pudo leer el Excel: '+err.message)); };
  $('#pgHeader').onchange=redraw;
  $('#pgGrupos').onchange=preview;
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
    grupoRaw: String(g('grupo')||'').trim(),
  };
}
/* Marca cuáles filas son títulos y a qué NIVEL va cada una. El nivel es lo que
   usa hijosDe() para saber qué cuelga de qué: un título va a nivel 1 y todo lo
   que le sigue, hasta el próximo título, a nivel 2. Sin esto no hay barra de
   agrupamiento, porque el grupo no tiene de quién sacar el rango de fechas. */
function clasificarTitulos(rows, hayColumna, detectar){
  let hayTitulo=false;
  rows.forEach(r=>{
    r.esGrupo = (hayColumna || detectar) ? esTituloFila(r, hayColumna) : false;
    if(r.esGrupo){ hayTitulo=true; r.nivel=1; }
    else r.nivel = hayTitulo ? 2 : 1;
  });
}

function importItems(rows){
  buildItemFromRow._n=0;
  let nuevos=0, act=0, titulos=0;
  const base=ITEMS.length;
  rows.forEach((r,k)=>{
    const ex=byId[r.id];
    if(ex){
      // solo se redistribuye el mes a mes si cambió algo que lo afecta (cantidad o fechas):
      // volver a subir la planilla completa no debe tocar la distribución de los demás
      const cambia=(r.cant && r.cant!==ex.cant) || (r.ini && r.ini!==ex.ini) || (r.fin && r.fin!==ex.fin);
      ex.desc=r.desc||ex.desc; ex.um=r.um||ex.um;
      if(r.cant) ex.cant=r.cant;
      if(r.pu) ex.pu=r.pu;
      if(r.codigo_cc) ex.codigo_cc=r.codigo_cc;
      if(r.cat) ex.cat=r.cat;
      if(r.ini) ex.ini=r.ini;
      if(r.fin) ex.fin=r.fin;
      // la jerarquía de un ítem que YA existe no se pisa: puede haberla
      // ajustado alguien a mano y una reimportación no tiene por qué deshacerlo.
      if(cambia && ex.ini&&ex.fin) redistributeMonths(ex,true);
      act++;
    } else {
      /* FORMA COMPLETA del ítem. Antes faltaban nivel, es_grupo, tipo y
         padre_id: sin es_grupo, tipoDe() devolvía 'item' para TODO y la barra
         resumen del grupo no se dibujaba nunca; y con nivel en undefined la
         comparación de hijosDe() (`nivel<=nivel`) daba siempre falso, así que
         un grupo se habría tragado todas las filas siguientes. */
      const esG=!!r.esGrupo;
      if(esG) titulos++;
      const it={ id:r.id, desc:r.desc, codigo_cc:r.codigo_cc, um:esG?'':r.um,
        cant:esG?0:r.cant, cant_ajustada:null, pu:esG?0:r.pu,
        get ptot(){return cantVigente(this)*this.pu;},
        incidencia:null, avE:null,
        ini: esG?null:(r.ini||null), fin: esG?null:(r.fin||null),
        estado:'Pendiente', cat:r.cat, dist_mensual:{}, deps:[],
        avance_real_prod:null, avance_manual:null,
        cant_certificada_acum:0, cert_por_mes:{},
        nivel: Math.max(1, Math.min(8, r.nivel||1)),
        es_grupo: esG,
        tipo: esG ? 'grupo' : 'item',
        // los hijos de un TÍTULO son ítems de contrato normales: la jerarquía
        // la lleva el nivel, no padre_id (padre_id es para tramos de un ítem).
        padre_id: null,
        orden: base+k, _rev:0 };
      ITEMS.push(it);
      if(it.ini&&it.fin) redistributeMonths(it,false);
      nuevos++;
    }
    if(r.cat && !CATS.includes(r.cat)) CATS.push(r.cat);
  });
  reindex(); MONTHS=computeMonths();
  touch(); closeModal(); renderGantt(); renderKPIs();
  toast(`Importados: <b>${nuevos}</b> nuevos · <b>${act}</b> actualizados` +
        (titulos?` · <b>${titulos}</b> título(s)`:''));
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
    <div class="xl-bar"><button type="button" class="chipbtn" id="pmXlsBaja">⬇ Planilla Excel (con la distribución actual)</button>
      <label class="chipbtn" style="cursor:pointer">⬆ Subir Excel<input type="file" id="pmXlsSube" accept=".xlsx" hidden></label>
      <span class="hint">o pegá abajo</span></div>
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
      let iguales=0;
      rows.forEach(r=>{
        const it=byId[r.id];
        const d={};
        Object.entries(r.dist).forEach(([mk,v])=>{ d[mk]= mode==='pct' ? (it.cant||0)*v/100 : v; });   // sin redondeo
        // si el ítem vino igual que como está (planilla bajada y re-subida), no se toca
        const act=it.dist_mensual||{}, ks=new Set(Object.keys(act).filter(k=>+act[k]).concat(Object.keys(d)));
        if([...ks].every(k=>Math.abs((+act[k]||0)-(+d[k]||0))<1e-9)){ iguales++; return; }
        it.dist_mensual=d;
        it._manualMonths={}; Object.keys(d).forEach(mk=>it._manualMonths[mk]=true);
        // el mensual MANDA: recalcula fechas, cantidad total y regenera el plan semanal
        syncDatesFromMonths(it);   // ajusta fechas; la cantidad de contrato queda intacta
      });
      MONTHS=computeMonths(); touch(); closeModal(); renderGantt(); renderKPIs();
      toast(`Distribución mensual cargada en <b>${rows.length-iguales}</b> ítems`+(iguales?` · ${iguales} sin cambios`:''));
    };
  };
  area.oninput=redraw; area.onpaste=()=>setTimeout(redraw,10);
  $('#pmXlsBaja').onclick=()=>excelMensual().catch(e=>alert('No se pudo armar el Excel: '+e.message));
  $('#pmXlsSube').onchange=e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
    excelATexto(f,'ensual').then(t=>{ area.value=t; redraw(); toast('Excel leído: revisá la vista previa e importá'); })
      .catch(err=>alert('No se pudo leer el Excel: '+err.message)); };
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

/* ============ EXCEL: bajar planilla, completarla y volver a subirla ============
   La planilla se convierte en el mismo texto que se pega (columnas con TAB), así
   que pasa por la misma vista previa, mapeo de columnas y validación de siempre. */
function cargarExcelJS(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok,mal)=>{ const s=document.createElement('script'); s.src='exceljs.min.js?v=4.4.0';
    s.onload=()=>ok(window.ExcelJS); s.onerror=()=>mal(new Error('no se pudo cargar la librería de Excel (¿sin conexión?)'));
    document.head.appendChild(s); });
}
function bajarLibro(wb,nombre){
  return wb.xlsx.writeBuffer().then(buf=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    a.download=nombre; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
  });
}
function estiloEncabezado(ws,n){
  const r=ws.getRow(1); r.font={bold:true}; r.alignment={vertical:'middle',wrapText:true}; r.height=30;
  for(let c=1;c<=n;c++) r.getCell(c).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7EBF0'}};
}
function nombreObraArchivo(){ return String(ObraAPI.getObraId()||'obra'); }
async function excelItems(){
  const ExcelJS=await cargarExcelJS();
  const wb=new ExcelJS.Workbook(), ws=wb.addWorksheet('Items',{views:[{state:'frozen',ySplit:1}]});
  const H=[['ID ítem',10],['Descripción',50],['UM',8],['Cantidad contrato',16],['Precio unitario',16],['Código CC',14],['Categoría',18],['Fecha inicio',12],['Fecha fin',12],['Es título (sí/no)',10]];
  ws.columns=H.map(([h,w])=>({header:h,width:w}));
  estiloEncabezado(ws,H.length);
  const f=d=>d?new Date(d+'T12:00:00'):null;
  ITEMS.forEach(i=>{
    const g=tipoDe(i)==='grupo';
    const row=ws.addRow([i.id, i.desc||'', g?'':(i.um||''), g?null:(i.cant||0), g?null:(i.pu||0), i.codigo_cc||'', i.cat||'', g?null:f(i.ini), g?null:f(i.fin), g?'sí':'']);
    row.getCell(4).numFmt='#,##0.######'; row.getCell(5).numFmt='#,##0.######';
    row.getCell(8).numFmt='dd/mm/yyyy'; row.getCell(9).numFmt='dd/mm/yyyy';
    if(g) row.font={bold:true};
  });
  const n=ws.addRow([]); ws.addRow(['','Agregá ítems nuevos debajo, con un ID que no exista. Los que ya existen se actualizan (las celdas vacías no borran nada).']).font={italic:true,color:{argb:'FF777777'}};
  await bajarLibro(wb,'Items_'+nombreObraArchivo()+'.xlsx');
}
async function excelMensual(){
  const ExcelJS=await cargarExcelJS();
  const meses=(MONTHS&&MONTHS.length?MONTHS:computeMonths()).slice();
  const wb=new ExcelJS.Workbook(), ws=wb.addWorksheet('Mensual',{views:[{state:'frozen',ySplit:1,xSplit:2}]});
  const H=[['ID ítem',10],['Descripción',44],['UM',7],['Cant. vigente',14],['Total distribuido',15]].concat(meses.map(m=>[m,11]));
  ws.columns=H.map(([h,w])=>({header:h,width:w}));
  estiloEncabezado(ws,H.length);
  const col=k=>{ let s='',n=k; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; };
  ITEMS.forEach(i=>{
    if(tipoDe(i)==='grupo'||!tieneCantidad(i)) return;
    const d=i.dist_mensual||{};
    const row=ws.addRow([i.id,i.desc||'',i.um||'',cantVigente(i),null].concat(meses.map(m=>d[m]?d[m]:null)));
    const r=row.number;
    row.getCell(5).value={formula:`SUM(${col(6)}${r}:${col(5+meses.length)}${r})`,result:meses.reduce((s,m)=>s+(+d[m]||0),0)};
    for(let c=4;c<=5+meses.length;c++) row.getCell(c).numFmt='#,##0.######';
    row.getCell(5).font={color:{argb:'FF2C4A8A'}};
  });
  ws.addRow([]); ws.addRow(['','Completá las cantidades por mes. Para agregar meses, agregá columnas con encabezado AAAA-MM. Las columnas UM, Cant. vigente y Total no se importan.']).font={italic:true,color:{argb:'FF777777'}};
  await bajarLibro(wb,'Distribucion_mensual_'+nombreObraArchivo()+'.xlsx');
}
/* Excel → texto con TAB (la primera hoja cuyo nombre contenga `pista`, o la primera). */
async function excelATexto(file, pista){
  const ExcelJS=await cargarExcelJS();
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
  const ws=wb.worksheets.find(w=>pista && w.name.toLowerCase().indexOf(pista)>=0) || wb.worksheets[0];
  if(!ws) throw new Error('el archivo no tiene hojas');
  const iso=d=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  const celda=(v,esEnc)=>{
    if(v==null) return '';
    if(v instanceof Date) return esEnc? iso(v).slice(0,7) : iso(v);
    if(typeof v==='object'){
      if('result' in v) return celda(v.result,esEnc);
      if(v.richText) return v.richText.map(t=>t.text).join('');
      if(v.text) return String(v.text);
      if(v.error) return '';
      return '';
    }
    if(typeof v==='number') return String(v).replace('.',',');   // la coma es el decimal de parseNum
    if(typeof v==='boolean') return v?'sí':'';
    return String(v).replace(/[\t\r\n]+/g,' ');
  };
  const out=[]; let ultimaConDatos=0;
  for(let r=1;r<=ws.rowCount;r++){
    const row=ws.getRow(r), n=Math.max(row.cellCount, ws.columnCount);
    const vals=[]; for(let c=1;c<=n;c++) vals.push(celda(row.getCell(c).value, r===1));
    while(vals.length && vals[vals.length-1]==='') vals.pop();
    out.push(vals.join('\t')); if(vals.some(x=>x!=='')) ultimaConDatos=out.length;
  }
  // la nota de ayuda del final (texto en la 2ª columna, sin ID) no es un ítem
  const lineas=out.slice(0,ultimaConDatos).filter((l,k)=>k===0 || !/^\t(Agregá ítems nuevos|Completá las cantidades)/.test(l));
  return lineas.join('\n');
}

/* ================= MODAL: DUPLICAR OBRA ================= */
function openDuplicarObra(){
  const actual=ObraAPI.getObraId();
  const nom=$('#obraSel')?.selectedOptions[0]?.textContent||actual;
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Duplicar obra</h3>
    <p class="hint" style="margin-bottom:10px">Copia <b>${nom}</b> completa: ítems, distribución mensual,
      dependencias, categorías, líneas base, plan semanal y configuración.
      Sirve como sandbox para probar ajustes sin tocar la obra original.</p>
    <div class="dfield"><label>ID de la obra nueva (no lo cambies después)</label>
      <input id="dupId" placeholder="ej. 9012500000"></div>
    <div class="dfield"><label>Nombre</label>
      <input id="dupNombre" value="${nom} (copia)"></div>
    <label class="hint" style="display:block;margin:6px 0">
      <input type="checkbox" id="dupAvance" checked> Incluir la producción ejecutada
      <span style="opacity:.7">(la copia lee el avance real de la obra original)</span></label>
    <div class="hint" id="dupMsg"></div>
    <button class="dsave" id="dupSave">Duplicar</button>
  </div>`;
  m.classList.add('open');
  $('#dupSave').onclick=async()=>{
    const id=$('#dupId').value.trim(), nombre=$('#dupNombre').value.trim();
    if(!id||!nombre){ $('#dupMsg').textContent='ID y nombre son obligatorios'; return; }
    $('#dupSave').disabled=true; $('#dupMsg').textContent='Copiando… puede tardar unos segundos.';
    try{
      const r=await ObraAPI.duplicarObra(actual,{obra_id:id,nombre:nombre,copiar_avance:$('#dupAvance').checked});
      const det=Object.entries(r.copiadas||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ');
      toast(`Obra duplicada como <b>${nombre}</b>`);
      closeModal();
      await refreshObraList(id);
      if(det) toast(det);
    }catch(err){ $('#dupMsg').textContent='Error: '+err.message; $('#dupSave').disabled=false; }
  };
}

/* ================= MODAL: ELIMINAR OBRA ================= */
function openEliminarObra(){
  const actual=ObraAPI.getObraId();
  const nom=($('#obraSel')?.selectedOptions[0]?.textContent||'').trim();
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Eliminar obra</h3>
    <p class="hint" style="margin-bottom:10px">Se van a borrar <b>todos</b> los datos de
      <b>${nom}</b>: ítems, distribución mensual, dependencias, categorías, líneas base,
      plan semanal, avance y configuración.
      <b style="color:#e05c4a">Esta acción no se puede deshacer.</b></p>
    <div class="dfield"><label>Escribí el nombre exacto de la obra para confirmar</label>
      <input id="delNombre" placeholder="${nom}" autocomplete="off"></div>
    <div class="hint" id="delMsg"></div>
    <button class="dsave" id="delSave" style="background:#e05c4a;color:#fff" disabled>Eliminar definitivamente</button>
  </div>`;
  m.classList.add('open');
  const chk=()=>{ $('#delSave').disabled = $('#delNombre').value.trim()!==nom; };
  $('#delNombre').oninput=chk;
  $('#delSave').onclick=async()=>{
    $('#delSave').disabled=true; $('#delMsg').textContent='Eliminando…';
    try{
      await ObraAPI.eliminarObra(actual,$('#delNombre').value.trim());
      toast(`Obra <b>${nom}</b> eliminada`);
      closeModal();
      await refreshObraList();      // salta a la primera obra disponible
    }catch(err){ $('#delMsg').textContent='Error: '+err.message; $('#delSave').disabled=false; }
  };
}

/* ================= selector de obras ================= */
async function refreshObraList(selectId){
  try{
    const obras=await ObraAPI.listObras();
    const sel=$('#obraSel');
    const esAdmin=(window.__role==='admin');
    sel.innerHTML=obras.map(o=>`<option value="${o.obra_id}">${o.nombre}</option>`).join('')
      + (esAdmin?`<option value="__new__">＋ Nueva obra…</option>`
                +`<option value="__dup__">⧉ Duplicar esta obra…</option>`
                +`<option value="__del__">🗑 Eliminar esta obra…</option>`:'');
    const target=selectId||ObraAPI.getObraId();
    if(obras.some(o=>String(o.obra_id)===String(target))){
      sel.value=target;
    } else if(obras.length){
      // la obra actual no está permitida para este usuario → ir a la primera suya
      sel.value=obras[0].obra_id;
      await cambiarObra(obras[0].obra_id);
      return;
    }
    if(selectId && String(selectId)!==String(ObraAPI.getObraId())) await cambiarObra(selectId);
  }catch(err){ console.warn('listObras:',err.message); }
}
async function cambiarObra(obraId){
  ObraAPI.setObraId(obraId);
  toast('Cargando obra…');
  const d=await ObraAPI.getObra(obraId);
  reloadModel(d);                 // definido en app.js
  // la vista de producción usa los ítems de la obra: forzar recarga al cambiar
  if(window.ProduccionView) window.ProduccionView.reset();
  if(window.CertificacionView) window.CertificacionView.reset();
  if(window.ComputoView) window.ComputoView.reset();
  if(window.TransporteView){ window.TransporteView.reset(); var _vt=document.getElementById('v-transporte'); if(_vt&&_vt.classList.contains('on')) window.TransporteView.abrir(); }
  if(window.UIExtra){ window.UIExtra.reset(); var _vw=document.getElementById('v-weekly'); if(_vw&&_vw.classList.contains('on')) window.UIExtra.renderPlanMovil(); }
  // el archivo de correspondencia es por obra: descartar el de la obra anterior
  if(window.ComunicacionesView) window.ComunicacionesView.reset();
  // la situación de pista (ejes, catálogo y tramos) es por obra
  if(window.PistaView) window.PistaView.reset();
  // la presencia y la revisión son de ESTA obra: volver a preguntar por la nueva
  if(typeof PRESENCIA !== 'undefined'){ PRESENCIA.otros=[]; PRESENCIA.avisadoPara=''; }
  if(typeof chequearPresencia === 'function') chequearPresencia();
  toast('Obra cargada · <b>'+ITEMS.length+'</b> ítems');
}
