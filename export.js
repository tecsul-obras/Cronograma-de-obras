/* =========================================================================
 * export.js — exportar a Excel y PDF
 *   Excel: sin librerías. Se genera un XML de SpreadsheetML (lo abre Excel
 *          nativo) con una hoja por vista y los números como números reales.
 *   PDF:   se usa la impresión del navegador con CSS de impresión (A3
 *          apaisado), que produce un PDF vectorial y seleccionable.
 * ========================================================================= */
'use strict';

/* ---------------- utilidades comunes ---------------- */
function xmlEsc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
// parte un texto en hasta maxLines líneas cortando en espacios; si aún desborda,
// pone … al final de la última línea. Sirve para que el nombre del ítem se lea
// completo (en 2 renglones) en el PDF en vez de cortarse.
function wrapDesc(str, maxCh, maxLines){
  const words=String(str==null?'':str).trim().split(/\s+/).filter(Boolean);
  if(!words.length) return [''];
  const lines=[''];
  for(const wd of words){
    const li=lines.length-1;
    if(!lines[li]) lines[li]=wd;
    else if((lines[li]+' '+wd).length<=maxCh) lines[li]+=' '+wd;
    else if(lines.length<maxLines) lines.push(wd);
    else lines[li]+=' '+wd;                 // desborde: se acumula y luego se corta
  }
  return lines.map(l=> l.length>maxCh ? l.slice(0,maxCh-1)+'…' : l);
}
function cellXml(v, tipo){
  if(v===null || v===undefined || v==='') return '<Cell/>';
  if(tipo==='n'){
    const n=Number(v);
    return isNaN(n)? `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`
                   : `<Cell><Data ss:Type="Number">${n}</Data></Cell>`;
  }
  if(tipo==='m'){ // moneda
    const n=Number(v)||0;
    return `<Cell ss:StyleID="sMoney"><Data ss:Type="Number">${n}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}
/* hoja: {nombre, cols:[ancho], head:[...], rows:[[{v,t}]] } */
function sheetXml(h){
  const cols=(h.cols||[]).map(w=>`<Column ss:Width="${w}"/>`).join('');
  const head=h.head? `<Row ss:StyleID="sHead">${h.head.map(t=>`<Cell ss:StyleID="sHead"><Data ss:Type="String">${xmlEsc(t)}</Data></Cell>`).join('')}</Row>`:'';
  const rows=(h.rows||[]).map(r=>
    `<Row>${r.map(c=> (c && typeof c==='object')? cellXml(c.v,c.t) : cellXml(c,'s')).join('')}</Row>`
  ).join('');
  return `<Worksheet ss:Name="${xmlEsc(h.nombre)}"><Table>${cols}${head}${rows}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane>
    </WorksheetOptions></Worksheet>`;
}
function descargarXls(hojas, nombre){
  const xml=`<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="10"/></Style>
  <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#1B3350" ss:Pattern="Solid"/>
    <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="sMoney"><NumberFormat ss:Format="#,##0"/></Style>
 </Styles>
 ${hojas.map(sheetXml).join('')}
</Workbook>`;
  const blob=new Blob(['\ufeff'+xml],{type:'application/vnd.ms-excel;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=nombre;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500);
}
const hoyStr=()=>dstr(new Date());
const obraNombre=()=>{ const s=$('#obraSel'); return (s && s.selectedOptions[0])? s.selectedOptions[0].text : 'Obra'; };

/* ================= EXCEL ================= */
/* Hoja 1: Cronograma — ítems × meses (el formato que pide el MOPC) */
function hojaCronograma(){
  const P=MONTHS.slice();
  const head=['ID','Nivel','Descripción','Cód. CC','UM','Cant. contrato','Cant. ajustada','Precio unit.','Precio total',
              'Cant. planeada','Cant. ejecutada','Cant. pendiente','% Avance real','% Planeado','% Brecha',
              'Categoría','Estado','Inicio','Fin', ...P.map(m=>monthLabel(m)), 'Σ Cronograma','Dif. vs contrato'];
  const rows=ITEMS.map(i=>{
    const suma=sumaCronograma(i), dif=difContrato(i);
    const pr=(typeof PROD!=='undefined'&&PROD[i.id])?PROD[i.id]:null;
    const cejec=pr&&pr.total?pr.total:0;
    const cpend=suma-cejec;                                  // planeada − ejecutada
    const av=i.avance_real_prod;
    const esp=i.avE!=null?i.avE:(typeof itemAvancePlaneado==='function'?itemAvancePlaneado(i):null);
    const brecha=(av!=null&&esp!=null)?av-esp:'';
    return [
      {v:i.id,t:'s'}, {v:i.nivel||1,t:'n'}, {v:i.desc,t:'s'}, {v:i.codigo_cc,t:'s'}, {v:i.um,t:'s'},
      {v:i.cant,t:'n'}, {v:(i.cant_ajustada!=null?i.cant_ajustada:''),t:'n'}, {v:i.pu,t:'m'}, {v:i.ptot,t:'m'},
      {v:suma,t:'n'}, {v:cejec||'',t:'n'}, {v:cpend,t:'n'},
      {v:av!=null?av:'',t:'n'}, {v:esp!=null?+esp.toFixed(1):'',t:'n'}, {v:brecha!==''?+brecha.toFixed(1):'',t:'n'},
      {v:i.cat,t:'s'}, {v:i.estado,t:'s'}, {v:i.ini,t:'s'}, {v:i.fin,t:'s'},
      ...P.map(m=>({v:(i.dist_mensual[m]||0)||'', t:'n'})),
      {v:suma,t:'n'}, {v:dif,t:'n'}
    ];
  });
  // fila de totales en Gs (incluye el MONTO PLANEADO total)
  const montoPlan=ITEMS.reduce((s,i)=>s+sumaCronograma(i)*i.pu,0);
  const tot=['','','TOTAL (Gs)','','','','','',
    {v:ITEMS.reduce((s,i)=>s+i.ptot,0),t:'m'},
    {v:montoPlan,t:'m'},'','','','','','','','','',
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0), t:'m'})),
    {v:montoPlan,t:'m'},''];
  rows.push([]); rows.push(tot);
  return {nombre:'Cronograma', head, rows,
          cols:[40,40,240,70,45,80,80,80,95,85,85,85,70,70,65,110,75,70,70, ...P.map(()=>70), 85,85]};
}
/* Hoja 2: Cantidades por mes — tabla cruda para el formato del contratante */
function hojaCantidades(){
  const P=MONTHS.slice();
  const head=['ID ITEM','DESC. ITEM DE OBRA','U.M.', ...P.map(m=>m)];
  const rows=ITEMS.map(i=>[
    {v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.um,t:'s'},
    ...P.map(m=>({v:(i.dist_mensual[m]||0)||'', t:'n'}))
  ]);
  return {nombre:'Cantidades por mes', head, rows, cols:[50,260,45,...P.map(()=>62)]};
}
/* Hoja 3: Montos por mes */
function hojaMontos(){
  const P=MONTHS.slice();
  const head=['ID ITEM','DESC. ITEM DE OBRA','Precio unit.', ...P.map(m=>m), 'Total'];
  const rows=ITEMS.map(i=>[
    {v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.pu,t:'m'},
    ...P.map(m=>({v:((i.dist_mensual[m]||0)*i.pu)||'', t:'m'})),
    {v:i.ptot,t:'m'}
  ]);
  rows.push([]);
  rows.push([{v:'',t:'s'},{v:'TOTAL',t:'s'},{v:'',t:'s'},
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0),t:'m'})),
    {v:ITEMS.reduce((s,i)=>s+i.ptot,0),t:'m'}]);
  return {nombre:'Montos por mes', head, rows, cols:[50,260,80,...P.map(()=>85),95]};
}
/* Hoja 4: Plan semanal */
function hojaSemanal(){
  const head=['Semana','Desde','Hasta','ID ítem','Actividad','Frente','UM',
              'Prevista','Ejecutada','% Cumpl.','Causa','Mes(es)','Manual'];
  const rows=[];
  ALLWEEKS.forEach(wk=>{
    const [mon,sun]=weekMondaySunday(wk);
    WEEKLY.filter(w=>w.week===wk)
      .sort((a,b)=>(parseInt(a.item_id)||0)-(parseInt(b.item_id)||0))
      .forEach(w=>{
        const it=byId[w.item_id]; const prev=w.cant_prevista||0, ej=w.cant_ejecutada||0;
        const split=w.mesSplit? Object.entries(w.mesSplit).sort()
          .map(([m,v])=>`${m}: ${(+v).toFixed(2)}`).join(' | ') : (w.month||'');
        rows.push([
          {v:wk,t:'s'},{v:dstr(mon),t:'s'},{v:dstr(sun),t:'s'},
          {v:w.item_id,t:'s'},{v:w.actividad||(it?it.desc:''),t:'s'},{v:w.frente||'',t:'s'},
          {v:w.um||(it?it.um:''),t:'s'},
          {v:prev,t:'n'},{v:ej||'',t:'n'},
          {v:prev? +(ej/prev*100).toFixed(1):'', t:'n'},
          {v:w.causa||'',t:'s'},{v:split,t:'s'},{v:w._man?'SÍ':'',t:'s'}
        ]);
      });
  });
  return {nombre:'Plan semanal', head, rows,
          cols:[70,70,70,50,230,90,45,75,75,65,110,150,50]};
}
/* Hoja 5: Avance por ítem */
function hojaAvance(){
  const head=['ID','Descripción','UM','Cant. contrato','Precio total',
              '% Avance real','% Esperado','Brecha','Producido (Gs)'];
  const rows=ITEMS.map(i=>{
    const av=i.avance_real_prod, br=(av!=null&&i.avE!=null)? av-i.avE : null;
    return [
      {v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.um,t:'s'},
      {v:i.cant,t:'n'},{v:i.ptot,t:'m'},
      {v:av!=null?+av.toFixed(2):'',t:'n'},
      {v:i.avE!=null?+i.avE.toFixed(2):'',t:'n'},
      {v:br!=null?+br.toFixed(2):'',t:'n'},
      {v:av!=null? i.ptot*av/100 : '', t:'m'}
    ];
  });
  return {nombre:'Avance', head, rows, cols:[40,260,45,85,95,80,80,70,110]};
}
/* El botón del header abre el diálogo de opciones. */
function exportarExcel(){ abrirExpModal('xls'); }

/* Excel a partir de las secciones tildadas en el diálogo. */
function exportarExcelSel(){
  try{
    const o=expOpts();
    const hojas=[];
    if(o.gantt)   hojas.push(hojaCronograma());
    if(o.cant)    hojas.push(hojaCantidades());
    if(o.montos)  hojas.push(hojaMontos());
    if(o.base){ const bl=blSeleccionada(o.baseId); if(bl) hojas.push(hojaBaseline(bl)); }
    if(o.prod)    hojas.push(hojaProduccion());
    if(o.cert)    hojas.push(hojaCertificacion());
    if(o.semanal) hojas.push(hojaSemanal());
    if(o.avance)  hojas.push(hojaAvance());
    if(!hojas.length){ toast('Elegí al menos una sección para exportar.'); return; }
    descargarXls(hojas, `Obra_${obraNombre().replace(/[^\w]+/g,'_')}_${hoyStr()}.xls`);
    toast('Excel generado — '+hojas.length+' hoja(s)');
    cerrarExpModal();
  }catch(err){ toast('Error al exportar: '+err.message); }
}

/* ================= PDF (vía impresión del navegador) ================= */
/* El botón del header abre el diálogo de opciones. */
function exportarPDF(){ abrirExpModal('pdf'); }

function secPDF(titulo, html){ return `<div class="sec">${xmlEsc(titulo)}</div>${html}`; }
function tituloExport(o){
  const n=[]; if(o.gantt)n.push('Gantt'+(o.lluvia?' (lluvia)':''));
  if(o.cant)n.push('Cantidades'+(o.cantPer==='sem'?' por semana':'')); if(o.montos)n.push('Montos');
  if(o.base)n.push('Línea base'); if(o.prod)n.push('Producción'); if(o.cert)n.push('Certificación');
  if(o.semanal)n.push('Semanal'); if(o.avance)n.push('Avance');
  return n.join(' · ') || 'Exportación';
}

/* PDF a partir de las secciones tildadas en el diálogo. */
function exportarPDFSel(){
  const o=expOpts();
  // caso especial: Gantt en una sola hoja (plotter) → se exporta solo el Gantt
  const una = document.getElementById('exp_ganttUna');
  const gOpts = { lluvia:o.lluvia };
  if(o.gantt && una && una.checked){
    abrirPDF('Cronograma (Gantt)'+(o.lluvia?' · ajustado por lluvia':''), pdfGantt(true, gOpts), true);
    cerrarExpModal(); return;
  }
  const partes=[];
  if(o.gantt)   partes.push(secPDF('Cronograma (Gantt)'+(o.lluvia?' · ajustado por lluvia':''), pdfGantt(false, gOpts)));
  if(o.cant)    partes.push(secPDF(o.cantPer==='sem'? 'Cantidades por semana (plan semanal)' : 'Cantidades por mes (vigente)',
                                   pdfCantidades(o.cantPer)));
  if(o.montos)  partes.push(secPDF('Montos por mes', pdfMontos()));
  if(o.base){ const bl=blSeleccionada(o.baseId); if(bl) partes.push(secPDF('Cantidades de línea base · '+xmlEsc(bl.name||''), pdfBaseline(bl))); }
  if(o.prod)    partes.push(secPDF('Producción real (por mes)', pdfProduccion()));
  if(o.cert)    partes.push(secPDF('Certificación (por mes)', pdfCertificacion()));
  if(o.semanal){
    const ws=o.semanas||[];
    partes.push(secPDF('Plan semanal'+(ws.length>1?` · ${ws.length} semanas`:''), pdfSemanal(ws)));
  }
  if(o.avance)  partes.push(secPDF('Avance / Informe', pdfAvance()));
  if(!partes.length){ toast('Elegí al menos una sección para exportar.'); return; }
  // cada sección (salvo la primera) arranca en página nueva
  const contenido = partes.map((h,idx)=> idx? `<div class="detalle-page">${h}</div>` : h).join('');
  abrirPDF(tituloExport(o), contenido, false);
  cerrarExpModal();
}

/* Arma la ventana de impresión con el encabezado + KPIs + contenido. */
function abrirPDF(titulo, contenido, unaHoja){
  const w=window.open('','_blank');
  if(!w){ toast('El navegador bloqueó la ventana. Permití las ventanas emergentes.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <title>${xmlEsc(obraNombre())} · ${xmlEsc(titulo)}</title>
  <style>
    @page{ size:A3 landscape; margin:8mm; }
    ${unaHoja?`@page{ size:420mm ${PDF_MM_H}mm; margin:6mm; }`:''}
    *{box-sizing:border-box;
      -webkit-print-color-adjust:exact !important;   /* imprime los fondos */
      print-color-adjust:exact !important;
      color-adjust:exact !important}
    body{font-family:'Segoe UI',system-ui,sans-serif;color:#111;margin:0;font-size:10px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-end;
      border-bottom:2.5px solid #0d1b2a;padding-bottom:6px;margin-bottom:9px}
    .hdr h1{margin:0;font-size:17px;color:#0d1b2a}
    .hdr .sub{font-size:11px;color:#555;margin-top:2px}
    .hdr .meta{text-align:right;font-size:9.5px;color:#666;line-height:1.5}
    /* --- Gantt SVG --- */
    .gantt-wrap{border:1px solid #c9c3b2;border-radius:3px;overflow:hidden;
      background:#ffffff;page-break-inside:avoid;margin-bottom:6px}
    .gantt-wrap + .gantt-wrap{page-break-before:always}   /* un bloque por página */
    .gantt-wrap svg{display:block}
    .leg{display:flex;gap:14px;align-items:center;font-size:8px;color:#555;margin-bottom:6px}
    .leg i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
    .leg svg{vertical-align:middle;margin-right:3px}
    .aviso{font-size:9px;color:#b8860b;margin:6px 0;padding:4px 8px;
      background:#fff8e6;border-left:3px solid #f2c200;border-radius:2px}
    .sec{font-size:12px;color:#0d1b2a;margin:12px 0 6px;padding-bottom:3px;
      border-bottom:1.5px solid #d6d0c0;page-break-after:avoid}
    /* --- tablas --- */
    table{width:100%;border-collapse:collapse;font-size:8.6px;table-layout:auto}
    th{background:#1b3350;color:#fff;padding:5px 4px;text-align:left;font-weight:600;
       border:1px solid #2a4668;font-size:7.6px}
    td{padding:3.2px 4px;border:1px solid #ddd7c7;vertical-align:middle}
    tr:nth-child(even) td{background:#faf8f2}
    td.has{border-color:#cfd8d8}          /* las celdas con color mantienen su fondo */
    tr:nth-child(even) td.has{background:inherit}
    .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sum{font-weight:700;background:#f5f2e6 !important}
    .tot td{background:#f2c200 !important;font-weight:700;border-top:2px solid #0d1b2a}
    .ok{color:#1f6b38;font-weight:700}.bad{color:#c0392b;font-weight:700}
    /* la grilla de meses puede ser muy ancha: letra más chica y sin recorte */
    table.grid{font-size:7.2px}
    table.grid th{font-size:6.8px;padding:4px 2px}
    table.grid td{padding:2.6px 3px}
    .kpis{display:flex;gap:7px;margin-bottom:9px}
    .kpi{flex:1;border:1px solid #d6d0c0;border-radius:5px;padding:5px 8px;background:#faf8f2}
    .kpi .l{font-size:7px;text-transform:uppercase;letter-spacing:.6px;color:#777;font-weight:700}
    .kpi .v{font-size:12.5px;font-weight:700;color:#0d1b2a;margin-top:1px;font-variant-numeric:tabular-nums}
    .ft{margin-top:8px;font-size:8px;color:#888;text-align:right}
    @media print{
      .noprint{display:none}
      tr{page-break-inside:avoid}
      thead{display:table-header-group}
      .gantt-wrap{page-break-inside:avoid}
      .detalle-page{page-break-before:always}   /* la tabla de detalle va en hoja aparte */
      ${unaHoja?`.gantt-wrap + .gantt-wrap{page-break-before:avoid !important}
      .gantt-wrap{page-break-inside:auto !important}
      .detalle-page{page-break-before:always !important}`:''}
    }
  </style></head><body>
  <div class="hdr">
    <div><h1>${xmlEsc(obraNombre())}</h1><div class="sub">${xmlEsc(titulo)}</div></div>
    <div class="meta">Emitido: ${new Date().toLocaleString('es-PY')}<br>
      ${ITEMS.length} ítems · Contrato ${fmtG(contratoTotal())}</div>
  </div>
  ${kpisPdf()}
  ${contenido}
  <div class="ft">Cronograma de Obra · Plan de Trabajos</div>
  <script>window.onload=()=>{setTimeout(()=>window.print(),350)}<\/script>
  </body></html>`);
  w.document.close();
  toast('Se abrió la vista de impresión — elegí "Guardar como PDF"');
}
function kpisPdf(){
  const k=[...document.querySelectorAll('#kpiStrip .kpi')].map(e=>({
    l:e.querySelector('.lab')?.textContent||'', v:e.querySelector('.val')?.textContent||''
  }));
  return `<div class="kpis">${k.map(x=>`<div class="kpi"><div class="l">${xmlEsc(x.l)}</div><div class="v">${xmlEsc(x.v)}</div></div>`).join('')}</div>`;
}
function pdfGrilla(){
  const P=MONTHS.slice();
  const esPct=ganttMode==='pct', esMon=ganttMode==='money';
  // máximo para escalar la intensidad del color (igual que en pantalla)
  let maxV=1;
  ITEMS.forEach(i=>P.forEach(m=>{
    const q=i.dist_mensual[m]||0; if(!q) return;
    const v=esMon? q*i.pu : (esPct? (i.cant? q/i.cant*100:0) : q);
    if(v>maxV) maxV=v;
  }));
  const celda=(i,m)=>{
    const q=i.dist_mensual[m]||0;
    if(!q) return '<td class="r"></td>';
    const v=esMon? q*i.pu : (esPct? (i.cant? q/i.cant*100:0) : q);
    const t=Math.min(1, v/maxV);
    const alpha=(0.10+t*0.42).toFixed(3);           // mismo degradado que la app
    const txt = esMon? Math.round(v).toLocaleString('es-PY')
              : esPct? v.toFixed(1)+'%'
              : fmtQty(q);
    return `<td class="r has" style="background:rgba(46,197,197,${alpha})">${txt}</td>`;
  };
  const totales=P.map(m=>ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0));
  return `<table class="grid">
   <thead><tr><th>ID</th><th>Ítem de obra</th><th>UM</th><th class="r">Cant. contrato</th>
     ${P.map(m=>`<th class="r">${monthLabel(m)}</th>`).join('')}
     <th class="r">Σ Cronog.</th><th class="r">Dif.</th></tr></thead>
   <tbody>${ITEMS.map(i=>{
      const s=sumaCronograma(i), d=difContrato(i), ok=Math.abs(d)<0.005;
      return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.um)}</td>
        <td class="r">${fmtN(i.cant)}</td>
        ${P.map(m=>celda(i,m)).join('')}
        <td class="r sum">${esPct? (i.cant?(s/i.cant*100).toFixed(1)+'%':'—') : fmtQty(s)}</td>
        <td class="r ${ok?'ok':'bad'}">${ok?'✓':(d>0?'+':'')+fmtN(d,2)}</td></tr>`;
    }).join('')}
   <tr class="tot"><td colspan="4">TOTAL · Monto por mes (Gs)</td>
     ${totales.map(t=>`<td class="r">${t?Math.round(t).toLocaleString('es-PY'):''}</td>`).join('')}
     <td class="r">${Math.round(contratoTotal()).toLocaleString('es-PY')}</td><td></td></tr>
   </tbody></table>`;
}

let PDF_MM_H=297;   // alto real necesario para el modo "una sola hoja" (lo calcula pdfGantt)
/* ¿ítem dado de baja? No se dibuja: ensucia el diagrama con barras grises. */
function esEliminadoExp(i){ return String(i&&i.estado||'').toLowerCase().includes('elimin'); }

/* Línea base CONTRACTUAL (la más reciente). Es la que define el plazo firmado y
   la que se corre por lluvia — NO el plan operativo, que ya absorbió atrasos y
   duplicaría el corrimiento. */
function baseContractualExp(){
  if(typeof BASELINES==='undefined' || !BASELINES || !BASELINES.length) return null;
  if(typeof baselinesDe==='function'){
    const c=baselinesDe('contractual');
    if(c.length) return c[c.length-1];
  }
  if(typeof activeBaseline!=='undefined' && activeBaseline){
    const b=BASELINES.find(x=>x.id===activeBaseline); if(b) return b;
  }
  return BASELINES[BASELINES.length-1];
}

function pdfGantt(unaHoja, opts){
  opts = opts || {};
  const conLluvia = !!opts.lluvia;
  // Lista de filas RESPETANDO la jerarquía: los grupos entran con sus fechas
  // resumidas (mín/máx de sus hojas) y los ítems-hoja con las propias.
  // Los ítems ELIMINADOS quedan fuera del diagrama (siguen en la tabla).
  const filas=[];
  ITEMS.forEach((it,idx)=>{
    if(esEliminadoExp(it)) return;
    if(esGrupo(idx)){
      const rg=resumenGrupo(idx);
      if(rg.ini&&rg.fin) filas.push({i:it, esG:true, rg:rg});
    } else if(it.ini&&it.fin){
      filas.push({i:it, esG:false, rg:null});
    }
  });
  if(!filas.length) return '<p style="padding:20px;color:#888">Ningún ítem tiene fechas cargadas.</p>';

  // línea base a mostrar en el PDF = la misma seleccionada en pantalla (si hay una).
  const blPdf = (typeof activeBaseline!=='undefined' && activeBaseline && typeof BASELINES!=='undefined' && BASELINES)
              ? BASELINES.find(b=>b.id===activeBaseline) : null;

  /* --- anclas de plazo -------------------------------------------------
     · fin de contrato = fin de la LÍNEA BASE CONTRACTUAL (el plazo firmado).
       OJO: no se usa OBRA.fecha_fin ni el último mes del plan, porque esos se
       mueven con la reprogramación y corren la marca.
     · fin ajustado por lluvia = ese fin + los días de clima reconocidos. */
  const blCtr = baseContractualExp();
  const finCtr = (blCtr && typeof finBaseline==='function' && finBaseline(blCtr))
              || (blPdf && typeof finBaseline==='function' && finBaseline(blPdf))
              || (typeof finContrato==='function' ? finContrato() : null);
  const Dll = (conLluvia && typeof diasGanadosRetro==='function') ? diasGanadosRetro() : 0;
  const finLl = (conLluvia && finCtr && Dll>0) ? addDays(finCtr, Dll) : null;
  /* corre una fecha por la lluvia acumulada hasta ella (mismo motor que la app) */
  const corr = d => (conLluvia && typeof correrFecha==='function') ? correrFecha(d) : null;

  /* Fechas de la LÍNEA BASE de una fila (para el ítem, o mín/máx de las hojas
     si es un grupo). El corrimiento por lluvia se aplica sobre estas, no sobre
     las del plan. Devuelve null si el ítem no existe en la línea base
     (p. ej. adicionales por convenio posteriores). */
  const blLlItems = (conLluvia && blCtr) ? blCtr.items : null;
  const fechasBaseDe = f => {
    if(!blLlItems) return null;
    if(!f.esG){
      const sb=blLlItems[f.i.id];
      return (sb && sb.ini && sb.fin) ? {ini:sb.ini, fin:sb.fin} : null;
    }
    const idx=ITEMS.indexOf(f.i);
    const hijos=(typeof hijosDe==='function')? hijosDe(idx) : [];
    let a=null,b=null;
    hijos.forEach(h=>{
      const sb=blLlItems[h.id]; if(!sb||!sb.ini||!sb.fin) return;
      const x=parseD(sb.ini), y=parseD(sb.fin);
      if(x&&(!a||x<a))a=x; if(y&&(!b||y>b))b=y;
    });
    return (a&&b)? {ini:dstr(a), fin:dstr(b)} : null;
  };

  // dominio temporal real (día a día, igual que la pantalla)
  let min=null,max=null;
  filas.forEach(f=>{
    const a=parseD(f.esG?f.rg.ini:f.i.ini), b=parseD(f.esG?f.rg.fin:f.i.fin);
    if(a&&(!min||a<min))min=a; if(b&&(!max||b>max))max=b;});
  // el eje tiene que llegar hasta donde lleguen las barras corridas y las anclas
  if(conLluvia){
    filas.forEach(f=>{
      const fb=fechasBaseDe(f); if(!fb) return;
      const a=corr(fb.ini), b=corr(fb.fin);
      if(a&&(!min||a<min))min=a;
      if(b&&(!max||b>max))max=b;
    });
  }
  if(finCtr && (!max||finCtr>max)) max=finCtr;
  if(finLl  && (!max||finLl >max)) max=finLl;
  const x0=new Date(min.getFullYear(),min.getMonth(),1);
  const x1=new Date(max.getFullYear(),max.getMonth()+1,1);
  const dias=Math.max(1,daysBetween(x0,x1));

  /* El SVG tiene que ENTRAR en la página. A3 apaisado = 297mm de alto; entre
     encabezado, KPIs y márgenes quedan ~185mm útiles. Con muchos ítems se
     comprime el alto de fila y, si aun así no entra, se parte en bloques
     (cada bloque = una página, repitiendo el eje de meses). */
  // Zona izquierda: ÍTEM DE OBRA + columnas Inicio · Fin · Días.
  // LEFT es el borde donde arranca el timeline. Reservamos columnas a su izquierda.
  const C_DUR=40, C_FIN=56, C_INI=56;          // anchos de las 3 columnas de fecha
  const LEFT=468, W=1120, TW=W-LEFT, HH=34;
  const X_DUR=LEFT-C_DUR, X_FIN=X_DUR-C_FIN, X_INI=X_FIN-C_INI;   // x de cada columna
  const DESC_W=X_INI;                          // la descripción ocupa hasta donde arrancan las fechas
  const MM_W=410, MM_H_MAX=185;
  const U=W/MM_W;                       // unidades de viewBox por mm
  const HMAX=MM_H_MAX*U;
  const RH=26;                          // alto de fila (2 líneas de descripción)
  // en modo "una hoja" NO se parte: todos los ítems van en un único SVG.
  const PORBLOQUE = unaHoja ? filas.length : Math.max(5, Math.floor((HMAX-HH-8)/RH));

  const px=d=>LEFT+daysBetween(x0,(typeof d==='string'?parseD(d):d))/dias*TW;
  const MN=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const meses=[]; { let c=new Date(x0);
    while(c<x1){ const n=new Date(c.getFullYear(),c.getMonth()+1,1);
      meses.push([new Date(c),new Date(n)]); c=n; } }
  const hoy=new Date();
  const hoyX=(hoy>=x0&&hoy<=x1)? px(hoy):null;

  let mmSum=0;
  const bloques=[];
  for(let b0=0; b0<filas.length; b0+=PORBLOQUE){
    const grupo=filas.slice(b0, b0+PORBLOQUE);
    const H=HH+grupo.length*RH+6;
    const MM_H=+(H/U).toFixed(1);
    mmSum+=MM_H;
    const cy=k=>HH+k*RH+RH/2;                     // k = índice DENTRO del bloque

    let s=`<svg viewBox="0 0 ${W} ${H}" width="${MM_W}mm" height="${MM_H}mm"
      preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg"
      style="font-family:'Segoe UI',sans-serif;display:block">
      <defs><marker id="ar${b0}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
        <path d="M0,0 L5,3 L0,6 Z" fill="#5b8fd6"/></marker></defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

    // encabezado de meses
    s+=`<rect x="0" y="0" width="${W}" height="${HH}" fill="#eceadf"/>`;
    meses.forEach(([a,b])=>{
      const xa=px(a), xb=px(b);
      s+=`<line x1="${xa}" y1="0" x2="${xa}" y2="${H}" stroke="#ded8c8" stroke-width="0.5"/>`;
      if(xb-xa>15){
        s+=`<text x="${(xa+xb)/2}" y="15" text-anchor="middle" font-size="9" font-weight="700" fill="#4a4436">${MN[a.getMonth()]}</text>
            <text x="${(xa+xb)/2}" y="26" text-anchor="middle" font-size="7" fill="#8a8578">${a.getFullYear()}</text>`;
      }
    });
    s+=`<line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${H}" stroke="#c9a227" stroke-width="1.5"/>
        <line x1="0" y1="${HH}" x2="${W}" y2="${HH}" stroke="#8a8578" stroke-width="1"/>
        <text x="6" y="22" font-size="9" font-weight="700" fill="#4a4436">ÍTEM DE OBRA</text>
        <text x="${X_INI+C_INI/2}" y="22" text-anchor="middle" font-size="7.5" font-weight="700" fill="#4a4436">INICIO</text>
        <text x="${X_FIN+C_FIN/2}" y="22" text-anchor="middle" font-size="7.5" font-weight="700" fill="#4a4436">FIN</text>
        <text x="${X_DUR+C_DUR/2}" y="22" text-anchor="middle" font-size="7.5" font-weight="700" fill="#4a4436">DÍAS</text>
        <line x1="${X_INI}" y1="0" x2="${X_INI}" y2="${H}" stroke="#ded8c8" stroke-width="0.6"/>
        <line x1="${X_FIN}" y1="0" x2="${X_FIN}" y2="${H}" stroke="#ded8c8" stroke-width="0.6"/>
        <line x1="${X_DUR}" y1="0" x2="${X_DUR}" y2="${H}" stroke="#ded8c8" stroke-width="0.6"/>`;
    if(hoyX!=null) s+=`<line x1="${hoyX}" y1="${HH}" x2="${hoyX}" y2="${H}" stroke="#d64545" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="${hoyX}" y="${HH-3}" text-anchor="middle" font-size="6.5" font-weight="700" fill="#d64545">HOY</text>`;

    /* --- anclas verticales de plazo --- */
    // rótulo horizontal en la banda de meses (como HOY), con fondo para que se lea
    const marca=(d,color,txt)=>{
      if(!d) return '';
      const x=px(d);
      if(x<LEFT || x>W) return '';
      const wTxt=txt.length*3.5+6, xr=Math.min(Math.max(x-wTxt/2, LEFT+1), W-wTxt-1);
      return `<line x1="${x}" y1="${HH}" x2="${x}" y2="${H}" stroke="${color}" stroke-width="1.1" stroke-dasharray="5 3"/>`
           + `<rect x="${xr}" y="${HH-11}" width="${wTxt}" height="10" rx="2" fill="${color}"/>`
           + `<text x="${xr+wTxt/2}" y="${HH-3.5}" text-anchor="middle" font-size="6" font-weight="700" fill="#fff">${xmlEsc(txt)}</text>`;
    };
    // fin de contrato: se muestra cuando hay línea base o vista con lluvia
    if(finCtr && (blPdf || conLluvia)) s+=marca(finCtr,'#6b6862','FIN CONTRATO '+fmtDM(dstr(finCtr)));
    if(finLl)                          s+=marca(finLl ,'#00808f','FIN + LLUVIA '+fmtDM(dstr(finLl)));

    // dependencias (solo si predecesor y sucesor están en el MISMO bloque)
    grupo.forEach((f,k)=>{
      if(f.esG) return;                       // los grupos no llevan dependencias
      const i=f.i;
      (i.deps||[]).forEach(d=>{
        const gk=grupo.findIndex(x=>x.i.id===d.id);
        const p=byId[d.id];
        if(gk<0||!p||!p.ini||!p.fin) return;
        const sx=(d.type==='SS'||d.type==='SF')? px(p.ini):px(p.fin);
        const ex=(d.type==='FF'||d.type==='SF')? px(i.fin):px(i.ini);
        const sy=cy(gk), ey=cy(k), stub=5;
        const dp=(ex>=sx+stub)? `M${sx},${sy} H${sx+stub} V${ey} H${ex-1}`
          : `M${sx},${sy} H${sx+stub} V${(sy+ey)/2} H${ex-stub} V${ey} H${ex-1}`;
        s+=`<path d="${dp}" fill="none" stroke="#5b8fd6" stroke-width="0.8" opacity="0.7" marker-end="url(#ar${b0})"/>`;
      });
    });

    // filas + barras — fondo blanco con cuadrícula (sin renglones alternados)
    grupo.forEach((f,k)=>{
      const i=f.i, y=HH+k*RH;
      const ini=f.esG?f.rg.ini:i.ini, fin=f.esG?f.rg.fin:i.fin;
      // línea horizontal de separación entre ítems (cuadrícula)
      s+=`<line x1="0" y1="${y+RH}" x2="${W}" y2="${y+RH}" stroke="#d8d2c4" stroke-width="0.5"/>`;
      // descripción con INDENTACIÓN por nivel; los grupos van en negrita.
      // Se ajusta a 2 líneas para que el nombre se lea COMPLETO (no se corta).
      const ind=26+((i.nivel||1)-1)*11;
      const maxCh=Math.max(12,Math.floor((DESC_W-ind)/4.2));
      const dRaw=(i.desc||'');
      const dLines=wrapDesc(dRaw, maxCh, 2);
      const dCol=f.esG?'#1c2836':'#111', dW=f.esG?' font-weight="700"':'';
      s+=`<text x="6" y="${y+RH/2+2.8}" font-size="7.5" fill="#8a8578">${xmlEsc(i.id)}</text>`;
      if(dLines.length>1){
        s+=`<text x="${ind}" y="${y+RH/2-2.6}" font-size="7.8" fill="${dCol}"${dW}>${xmlEsc(dLines[0])}</text>
            <text x="${ind}" y="${y+RH/2+7}" font-size="7.8" fill="${dCol}"${dW}>${xmlEsc(dLines[1])}</text>`;
      } else {
        s+=`<text x="${ind}" y="${y+RH/2+2.8}" font-size="8.1" fill="${dCol}"${dW}>${xmlEsc(dLines[0]||'')}</text>`;
      }
      // columnas de fecha (Inicio · Fin · Días)
      const dur=(ini&&fin)? daysBetween(parseD(ini),parseD(fin))+1 : '';
      s+=`<text x="${X_INI+C_INI/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="6.8" fill="#555">${ini||'—'}</text>
          <text x="${X_FIN+C_FIN/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="6.8" fill="#555">${fin||'—'}</text>
          <text x="${X_DUR+C_DUR/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="7" fill="#333" font-weight="600">${dur}</text>`;
      const xa=px(ini), xb=px(fin), w=Math.max(2,xb-xa);
      const esHito=(i.tipo==='hito');

      // LÍNEA BASE (fantasma): barra fina violeta ARRIBA de la barra del plan, para
      // comparar el plan actual contra la baseline seleccionada.
      if(blPdf && !f.esG && !esHito && blPdf.items[i.id] && blPdf.items[i.id].ini && blPdf.items[i.id].fin){
        const bxa=px(blPdf.items[i.id].ini), bxb=px(blPdf.items[i.id].fin), bw=Math.max(2,bxb-bxa);
        s+=`<rect x="${bxa}" y="${y+2}" width="${bw}" height="2.8" rx="1.2" fill="#9b72c9"/>`;
      }

      // ---- barra CORRIDA POR LLUVIA: la LÍNEA BASE desplazada (referencia) ----
      if(conLluvia){
        const fb=fechasBaseDe(f);
        const la=fb?corr(fb.ini):null, lb=fb?corr(fb.fin):null;
        if(la&&lb){
          const lxa=px(la), lxb=px(lb);
          if(esHito){
            const lhy=y+RH/2, lr=3.6;
            s+=`<path d="M${lxa},${lhy-lr} L${lxa+lr},${lhy} L${lxa},${lhy+lr} L${lxa-lr},${lhy} Z"
                 fill="none" stroke="#00a3b5" stroke-width="1"/>`;
          } else {
            s+=`<rect x="${lxa}" y="${y+RH-4.6}" width="${Math.max(2,lxb-lxa)}" height="3" rx="1.4" fill="#00a3b5" opacity="0.9"/>`;
          }
        }
      }

      if(esHito){
        // HITO: rombo en su fecha (verde si finalizado al 100%, ámbar si no)
        // con la DESCRIPCIÓN y la FECHA al lado, para que se lea qué hito es.
        const hx=px(ini), hy=y+RH/2, r=5, done=(i.avance_manual||0)>=100;
        const col=done?'#3f9d5a':'#c9820b';
        s+=`<path d="M${hx},${hy-r} L${hx+r},${hy} L${hx},${hy+r} L${hx-r},${hy} Z" fill="${col}" stroke="${done?'#256b3a':'#9a6407'}" stroke-width="0.7"/>`;
        // rótulo: hacia la derecha salvo que no quepa (entonces a la izquierda)
        const lbl=`${dRaw} · ${fmtDM(ini)}`;
        const aDer=(W-16-(hx+r+3))>=(hx-r-3-LEFT);
        const libre=aDer? (W-16-(hx+r+3)) : (hx-r-3-LEFT);
        const maxL=Math.floor(libre/3.7);
        if(maxL>=6){
          const txt=lbl.length>maxL? lbl.slice(0,maxL-1)+'…':lbl;
          s+= aDer
            ? `<text x="${hx+r+3}" y="${hy+2.4}" font-size="6.6" font-weight="600" fill="#8a6000">${xmlEsc(txt)}</text>`
            : `<text x="${hx-r-3}" y="${hy+2.4}" text-anchor="end" font-size="6.6" font-weight="600" fill="#8a6000">${xmlEsc(txt)}</text>`;
        }
      } else {
      // fechas d/m en los extremos de TODAS las barras (grupos incluidos).
      // Si no hay lugar afuera, se dibujan arriba de la barra en vez de omitirse.
      const dmI=fmtDM(ini), dmF=fmtDM(fin);
      if(dmI){
        s+= (xa-LEFT>=24)
          ? `<text x="${xa-3}" y="${y+RH/2+2.5}" text-anchor="end" font-size="6.3" fill="#7d7663">${dmI}</text>`
          : `<text x="${xa+1}" y="${y+5.4}" font-size="5.9" fill="#7d7663">${dmI}</text>`;
      }
      if(dmF){
        s+= (xb+3<=W-16)
          ? `<text x="${xb+3}" y="${y+RH/2+2.5}" font-size="6.3" fill="#7d7663">${dmF}</text>`
          : `<text x="${xb-1}" y="${y+5.4}" text-anchor="end" font-size="5.9" fill="#7d7663">${dmF}</text>`;
      }
      if(f.esG){
        // barra RESUMEN del grupo: fina, oscura, con topes en los extremos
        const gh2=6, gy=y+(RH-gh2)/2;
        s+=`<rect x="${xa}" y="${gy}" width="${w}" height="${gh2}" fill="#3a4658"/>
            <rect x="${xa}" y="${gy-2}" width="2.6" height="${gh2+6}" fill="#3a4658"/>
            <rect x="${xb-2.6}" y="${gy-2}" width="2.6" height="${gh2+6}" fill="#3a4658"/>`;
      } else {
        const bh=RH-10, by=y+(RH-bh)/2;
        s+=`<rect x="${xa}" y="${by}" width="${w}" height="${bh}" rx="3" fill="#4a7fbd"/>`;
        const av=i.avance_real_prod||0;
        if(av>0) s+=`<rect x="${xa}" y="${by}" width="${w*Math.min(100,av)/100}" height="${bh}" rx="3" fill="#3f9d5a"/>`;
        // % de avance dentro de la barra, a la derecha (si entra)
        const conPct = av>0 && w>=42;
        if(conPct) s+=`<text x="${xa+w-4}" y="${y+RH/2+2.6}" text-anchor="end" font-size="6.6" font-weight="700" fill="#fff">${Math.round(av)}%</text>`;
        // nombre del ítem SOBRE la barra, en blanco, recortado al ancho libre
        const libre=w-8-(conPct?26:0);
        const bMax=Math.floor(libre/4.1);
        if(bMax>=4){
          const bTxt=dRaw.length>bMax? dRaw.slice(0,bMax-1)+'…':dRaw;
          s+=`<text x="${xa+4}" y="${y+RH/2+2.6}" font-size="7" fill="#fff">${xmlEsc(bTxt)}</text>`;
        }
      }
      }
    });
    s+=`</svg>`;
    bloques.push(`<div class="gantt-wrap">${s}</div>`);
  }

  const sinFechas=ITEMS.filter((it,ix)=>!esGrupo(ix)&&!esEliminadoExp(it)&&!(it.ini&&it.fin)).length;
  const nElim=ITEMS.filter(esEliminadoExp).length;
  // alto real en mm para el modo "una sola hoja": solo el Gantt (encabezado +
  // KPIs + leyenda + SVG + aviso). La tabla de detalle va en su PROPIA página.
  PDF_MM_H=Math.max(210, Math.ceil(46+10+mmSum+14));
  const avisos=[];
  if(sinFechas) avisos.push(`${sinFechas} ítem(s) sin fechas cargadas no aparecen en el diagrama (figuran en la tabla de detalle).`);
  if(nElim)     avisos.push(`${nElim} ítem(s) eliminados quedan fuera del diagrama.`);
  if(conLluvia && !blCtr) avisos.push('No hay línea base contractual: el ajuste por lluvia no se pudo dibujar.');
  else if(conLluvia){
    const sinBase=filas.filter(f=>!f.esG && !fechasBaseDe(f)).length;
    if(sinBase) avisos.push(`${sinBase} ítem(s) no figuran en la línea base (adicionales) y no llevan barra de lluvia.`);
  }
  const aviso=avisos.length? `<p class="aviso">⚠ ${avisos.join(' ')}</p>`:'';
  const leyenda=`<div class="leg">
    <span><i style="background:#4a7fbd"></i>Planificado</span>
    <span><i style="background:#3f9d5a"></i>Avance real</span>
    <span><i style="background:#9b72c9"></i>Línea base</span>
    <span><svg width="12" height="10" style="vertical-align:middle"><path d="M6,1 L11,5 L6,9 L1,5 Z" fill="#c9820b"/></svg> Hito</span>
    ${conLluvia?`<span><i style="background:#00a3b5;height:3px"></i>Línea base corrida por lluvia (+${Dll} días)</span>`:''}
    ${(finCtr&&(blPdf||conLluvia))?`<span><i style="background:#6b6862;width:2px"></i>Fin contrato</span>`:''}
    ${finLl?`<span><i style="background:#00808f;width:2px"></i>Fin + lluvia</span>`:''}
    <span><i style="background:#d64545;width:2px"></i>Hoy</span>
    <span><svg width="18" height="8"><path d="M0,4 H12" stroke="#5b8fd6" stroke-width="1"/><path d="M12,1 L16,4 L12,7 Z" fill="#5b8fd6"/></svg> Dependencia</span>
  </div>`;

  const tabla=`<div class="detalle-page"><h2 class="sec">Detalle de ítems</h2>
    <table><thead><tr><th>ID</th><th>Ítem de obra</th><th>Cat.</th><th>Estado</th>
      <th>Inicio</th><th>Fin</th><th class="r">Días</th><th>Dependencias</th>
      <th class="r">Cant. contrato</th><th class="r">Precio total (Gs)</th></tr></thead>
    <tbody>${ITEMS.map(i=>{
      const dur=(i.ini&&i.fin)? daysBetween(parseD(i.ini),parseD(i.fin))+1:'';
      const deps=(i.deps||[]).map(d=>`${d.id}${d.type!=='FS'?' ('+d.type+')':''}`).join(', ');
      return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.cat)}</td>
        <td>${xmlEsc(i.estado)}</td><td>${i.ini||'—'}</td><td>${i.fin||'—'}</td>
        <td class="r">${dur}</td><td>${deps}</td>
        <td class="r">${fmtN(i.cant)}</td>
        <td class="r">${Math.round(i.ptot).toLocaleString('es-PY')}</td></tr>`;
    }).join('')}</tbody></table></div>`;

  return leyenda + bloques.join('') + aviso + tabla;
}

/* semanas elegidas en el diálogo; si no hay ninguna, la que está en pantalla */
function semanasExport(){
  const cont=document.getElementById('expWkList');
  if(cont){
    const sel=[...cont.querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value);
    if(sel.length) return sel;
  }
  return [ALLWEEKS[weeklyIdx]].filter(Boolean);
}

/* Plan semanal: una hoja por cada semana elegida. */
function pdfSemanal(weeks){
  const ws=(weeks&&weeks.length)? weeks : semanasExport();
  if(!ws.length) return '<p style="padding:20px;color:#888">No hay semanas para exportar.</p>';
  return ws.map((wk,ix)=>
    `<div${ix?' class="detalle-page"':''}>${pdfSemanalUna(wk)}</div>`).join('');
}

function pdfSemanalUna(wk){
  const rows=WEEKLY.filter(w=>w.week===wk).sort((a,b)=>(parseInt(a.item_id)||0)-(parseInt(b.item_id)||0));
  const [mon,sun]=wk? weekMondaySunday(wk):[null,null];
  const mKey=wk?weekMonthKey(wk):null;
  let tp=0,te=0;
  const body=rows.map(w=>{
    const it=byId[w.item_id]; const prev=w.cant_prevista||0, ej=w.cant_ejecutada||0;
    tp+=prev; te+=ej;
    const cp=prev? ej/prev*100:0;
    const planM=it?(it.dist_mensual||{})[mKey]||0:0;
    const usado=plannedInMonth(w.item_id,mKey);
    const saldo=+(planM-usado).toFixed(2);
    const cuadra=Math.abs(saldo)<=0.005;
    const split=(w.mesSplit&&Object.keys(w.mesSplit).length>1)
      ? Object.entries(w.mesSplit).sort().map(([m,v])=>`${monthLabel(m)}: ${fmtN(v,1)}`).join(' · ') : '';
    return `<tr><td>${w.item_id}</td><td>${xmlEsc(w.actividad||'')}${split?`<br><span style="font-size:7px;color:#777">${split}</span>`:''}</td>
      <td>${xmlEsc(w.frente||'')}</td><td>${xmlEsc(w.um||'')}</td>
      <td class="r">${fmtN(prev)}</td><td class="r">${ej?fmtN(ej):'—'}</td>
      <td class="r">${prev?cp.toFixed(1)+'%':'—'}</td><td>${xmlEsc(w.causa||'')}</td>
      <td class="r ${cuadra?'ok':'bad'}">${!planM?'—':cuadra?'✓':(saldo>0?'+':'')+fmtN(saldo,0)}</td></tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;font-size:12px;font-weight:700">
      Semana ${wk||''} · ${mon?dstr(mon):''} a ${sun?dstr(sun):''}
      <span style="font-weight:400;color:#666;margin-left:10px">${rows.length} actividades</span></div>
    ${rows.length? `<table><thead><tr><th>Ítem</th><th>Actividad</th><th>Frente</th><th>UM</th>
      <th class="r">Previsto</th><th class="r">Ejecutado</th><th class="r">% Cumpl.</th>
      <th>Causa</th><th class="r">Saldo mes</th></tr></thead>
    <tbody>${body}
      <tr class="tot"><td colspan="4">TOTAL</td><td class="r">${fmtN(tp)}</td>
      <td class="r">${fmtN(te)}</td><td class="r">${tp?(te/tp*100).toFixed(1)+'%':'—'}</td>
      <td colspan="2"></td></tr></tbody></table>`
      : '<p style="color:#888;font-size:10px">Sin actividades cargadas en esta semana.</p>'}`;
}
function pdfAvance(){
  return `<table><thead><tr><th>ID</th><th>Descripción</th><th>UM</th>
    <th class="r">Cant. contrato</th><th class="r">Precio total (Gs)</th>
    <th class="r">% Avance real</th><th class="r">% Esperado</th><th class="r">Brecha</th></tr></thead>
    <tbody>${ITEMS.map(i=>{
      const av=i.avance_real_prod, br=(av!=null&&i.avE!=null)?av-i.avE:null;
      return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.um)}</td>
        <td class="r">${fmtN(i.cant)}</td><td class="r">${Math.round(i.ptot).toLocaleString('es-PY')}</td>
        <td class="r">${av!=null?av.toFixed(1)+'%':'—'}</td>
        <td class="r">${i.avE!=null?i.avE.toFixed(1)+'%':'—'}</td>
        <td class="r ${br==null?'':(br>=0?'ok':'bad')}">${br==null?'—':(br>=0?'+':'')+br.toFixed(1)+'%'}</td></tr>`;
    }).join('')}
    <tr class="tot"><td colspan="4">TOTAL</td>
      <td class="r">${Math.round(contratoTotal()).toLocaleString('es-PY')}</td>
      <td colspan="3"></td></tr></tbody></table>`;
}

/* =========================================================================
 * AMPLIACIÓN DE EXPORTACIÓN — líneas base, producción real y certificación,
 * más el diálogo de opciones (elegir secciones + formato). Todo frontend.
 * ========================================================================= */

/* ---------- hojas de Excel nuevas ---------- */
/* Cantidades de una línea base (snapshot): ítem × mes congelado. */
function hojaBaseline(bl){
  const P=MONTHS.slice();
  const head=['ID ITEM','DESC. ITEM DE OBRA','U.M.','Cant. base', ...P.map(m=>m), 'Σ base'];
  const rows=ITEMS.map(i=>{
    const b=(bl.items&&bl.items[i.id])||{};
    const dist=b.dist||{};
    const suma=P.reduce((s,m)=>s+(dist[m]||0),0);
    return [{v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.um,t:'s'},
      {v:(b.cant!=null?b.cant:i.cant),t:'n'},
      ...P.map(m=>({v:(dist[m]||0)||'', t:'n'})),
      {v:suma||'',t:'n'}];
  });
  const nombre=('LB '+(bl.name||'')).replace(/[\\\/\?\*\[\]:]/g,' ').slice(0,28);
  return {nombre, head, rows, cols:[50,240,45,80,...P.map(()=>62),80]};
}
/* Producción real ejecutada: ítem × mes (desde el formulario de liberación). */
function hojaProduccion(){
  const P=MONTHS.slice();
  const PM={}; ITEMS.forEach(i=>{ PM[i.id]=prodPorMes(i.id); });
  const head=['ID ITEM','DESC. ITEM DE OBRA','U.M.','P. Unit.', ...P.map(m=>m), 'Σ ejecutado','Monto ejec. (Gs)'];
  const rows=ITEMS.map(i=>{
    const pm=PM[i.id]||{};
    const tot=(PROD[i.id]&&PROD[i.id].total)||P.reduce((s,m)=>s+(pm[m]||0),0);
    return [{v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.um,t:'s'},{v:i.pu,t:'m'},
      ...P.map(m=>({v:(pm[m]||0)||'', t:'n'})),
      {v:tot||'',t:'n'},{v:(tot*i.pu)||'', t:'m'}];
  });
  rows.push([]);
  rows.push([{v:'',t:'s'},{v:'TOTAL monto (Gs)',t:'s'},{v:'',t:'s'},{v:'',t:'s'},
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>s+((PM[i.id][m]||0)*(i.pu||0)),0),t:'m'})),
    {v:'',t:'s'},
    {v:ITEMS.reduce((s,i)=>s+(((PROD[i.id]&&PROD[i.id].total)||0)*(i.pu||0)),0),t:'m'}]);
  return {nombre:'Producción real', head, rows, cols:[50,240,45,75,...P.map(()=>62),85,110]};
}
/* Certificación: ítem × mes certificado. */
function hojaCertificacion(){
  const P=MONTHS.slice();
  const head=['ID ITEM','DESC. ITEM DE OBRA','U.M.','P. Unit.', ...P.map(m=>m), 'Σ certificado','Monto cert. (Gs)'];
  const rows=ITEMS.map(i=>{
    const bm=(CERT[i.id]&&CERT[i.id].by_month)||{};
    const tot=(CERT[i.id]&&CERT[i.id].total)||P.reduce((s,m)=>s+(bm[m]||0),0);
    return [{v:i.id,t:'s'},{v:i.desc,t:'s'},{v:i.um,t:'s'},{v:i.pu,t:'m'},
      ...P.map(m=>({v:(bm[m]||0)||'', t:'n'})),
      {v:tot||'',t:'n'},{v:(tot*i.pu)||'', t:'m'}];
  });
  rows.push([]);
  rows.push([{v:'',t:'s'},{v:'TOTAL monto (Gs)',t:'s'},{v:'',t:'s'},{v:'',t:'s'},
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>{const bm=(CERT[i.id]&&CERT[i.id].by_month)||{};return s+((bm[m]||0)*(i.pu||0));},0),t:'m'})),
    {v:'',t:'s'},
    {v:ITEMS.reduce((s,i)=>s+(((CERT[i.id]&&CERT[i.id].total)||0)*(i.pu||0)),0),t:'m'}]);
  return {nombre:'Certificación', head, rows, cols:[50,240,45,75,...P.map(()=>62),85,110]};
}

/* ---------- secciones PDF nuevas ---------- */
/* tabla genérica ítem × períodos (mes o semana), con total de monto por período */
function pdfPeriodosTabla(P, rotulo, getVal, notaTot){
  if(!P.length) return '<p style="padding:16px;color:#888">No hay períodos con datos.</p>';
  const totP=P.map(p=>ITEMS.reduce((s,i)=>s+(getVal(i,p)||0)*(i.pu||0),0));
  const filas=ITEMS.map(i=>{
    let suma=0;
    const cel=P.map(p=>{ const q=getVal(i,p)||0; suma+=q; return `<td class="r">${q?fmtQty(q):''}</td>`; }).join('');
    return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.um)}</td>${cel}<td class="r sum">${suma?fmtQty(suma):'—'}</td></tr>`;
  }).join('');
  return `<table class="grid"><thead><tr><th>ID</th><th>Ítem de obra</th><th>UM</th>
    ${P.map(p=>`<th class="r">${xmlEsc(rotulo(p))}</th>`).join('')}<th class="r">Σ</th></tr></thead>
    <tbody>${filas}
    <tr class="tot"><td colspan="3">TOTAL · ${xmlEsc(notaTot||'Monto por período (Gs)')}</td>
      ${totP.map(t=>`<td class="r">${t?Math.round(t).toLocaleString('es-PY'):''}</td>`).join('')}
      <td></td></tr></tbody></table>`;
}
function pdfMesesTabla(getVal){
  return pdfPeriodosTabla(MONTHS.slice(), monthLabel, getVal, 'Monto por mes (Gs)');
}

/* --- por SEMANA: las cantidades semanales viven en WEEKLY (cant_prevista) --- */
/* semanas que efectivamente tienen plan cargado (evita 50 columnas vacías) */
function semanasConPlan(){
  const con=new Set();
  WEEKLY.forEach(w=>{ if(w.week && (w.cant_prevista||0)>0) con.add(w.week); });
  return ALLWEEKS.filter(w=>con.has(w));
}
function rotuloSemana(wk){
  const n=String(wk||'').split('-W')[1]||'';
  const [mon]=weekMondaySunday(wk)||[];
  return 'S'+n+(mon?' '+fmtDM(dstr(mon)):'');
}
function pdfCantidadesSem(){
  const M={};
  WEEKLY.forEach(w=>{ const k=w.item_id+'|'+w.week; M[k]=(M[k]||0)+(w.cant_prevista||0); });
  return pdfPeriodosTabla(semanasConPlan(), rotuloSemana,
    (i,wk)=> M[i.id+'|'+wk]||0, 'Monto por semana (Gs)');
}
/* `per` = 'mes' | 'sem' */
function pdfCantidades(per){
  return per==='sem' ? pdfCantidadesSem() : pdfMesesTabla((i,m)=> i.dist_mensual[m]||0);
}
function pdfBaseline(bl){ return pdfMesesTabla((i,m)=> (bl.items[i.id]&&bl.items[i.id].dist&&bl.items[i.id].dist[m])||0); }
function pdfProduccion(){ const PM={}; ITEMS.forEach(i=>{PM[i.id]=prodPorMes(i.id);}); return pdfMesesTabla((i,m)=> (PM[i.id]&&PM[i.id][m])||0); }
function pdfCertificacion(){ return pdfMesesTabla((i,m)=> (CERT[i.id]&&CERT[i.id].by_month&&CERT[i.id].by_month[m])||0); }
function pdfMontos(){
  const P=MONTHS.slice();
  const totMes=P.map(m=>ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*(i.pu||0),0));
  const filas=ITEMS.map(i=>{
    const cel=P.map(m=>{ const v=(i.dist_mensual[m]||0)*(i.pu||0); return `<td class="r">${v?Math.round(v).toLocaleString('es-PY'):''}</td>`; }).join('');
    return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td class="r">${Math.round(i.ptot).toLocaleString('es-PY')}</td>${cel}</tr>`;
  }).join('');
  return `<table class="grid"><thead><tr><th>ID</th><th>Ítem de obra</th><th class="r">Precio total</th>
    ${P.map(m=>`<th class="r">${monthLabel(m)}</th>`).join('')}</tr></thead>
    <tbody>${filas}
    <tr class="tot"><td colspan="2">TOTAL (Gs)</td><td class="r">${Math.round(contratoTotal()).toLocaleString('es-PY')}</td>
      ${totMes.map(t=>`<td class="r">${t?Math.round(t).toLocaleString('es-PY'):''}</td>`).join('')}</tr></tbody></table>`;
}

/* ---------- diálogo de opciones de exportación ---------- */
function expOpts(){
  const g=id=>document.getElementById(id);
  const ck=id=>!!(g(id)&&g(id).checked);
  return { gantt:ck('exp_gantt'), cant:ck('exp_cant'), montos:ck('exp_montos'),
    base:ck('exp_base'), baseId:(g('exp_baseSel')&&g('exp_baseSel').value)||'',
    prod:ck('exp_prod'), cert:ck('exp_cert'), semanal:ck('exp_semanal'), avance:ck('exp_avance'),
    lluvia:ck('exp_ganttLluvia'),
    cantPer:(g('exp_cantPer')&&g('exp_cantPer').value)||'mes',
    semanas:(typeof semanasExport==='function'? semanasExport():[]) };
}
function blSeleccionada(id){
  if(!BASELINES||!BASELINES.length) return null;
  return (id && BASELINES.find(b=>b.id===id)) || BASELINES[BASELINES.length-1];
}
function expSetDisponible(id, ok){
  const cb=document.getElementById(id); if(!cb) return;
  cb.disabled=!ok; if(!ok) cb.checked=false;
  const lab=cb.closest('.exp-opt'); if(lab) lab.classList.toggle('exp-off', !ok);
}
/* ¿se puede ofrecer el ajuste por lluvia? Requiere días reconocidos + línea base */
function lluviaDisponibleExp(){
  const dias = (typeof diasGanadosRetro==='function') ? diasGanadosRetro() : 0;
  return dias>0 && !!baseContractualExp();
}

/* llena la lista de semanas del diálogo (marca por defecto la que se ve) */
function poblarSemanasExport(){
  const cont=document.getElementById('expWkList');
  if(!cont || typeof ALLWEEKS==='undefined') return;
  const conPlan=new Set();
  (typeof WEEKLY!=='undefined'? WEEKLY:[]).forEach(w=>{ if(w.week) conPlan.add(w.week); });
  const actual=ALLWEEKS[weeklyIdx];
  const previo=new Set([...cont.querySelectorAll('input:checked')].map(c=>c.value));
  cont.innerHTML=ALLWEEKS.map(wk=>{
    const [mon,sun]=weekMondaySunday(wk)||[null,null];
    const rango=mon&&sun? `${fmtDM(dstr(mon))}–${fmtDM(dstr(sun))}` : '';
    const n=String(wk).split('-W')[1]||wk;
    const marcado = previo.size ? previo.has(wk) : (wk===actual);
    return `<label class="exp-wk${conPlan.has(wk)?'':' sin'}" title="${xmlEsc(wk)}">
      <input type="checkbox" value="${xmlEsc(wk)}" ${marcado?'checked':''}>
      <span class="wk-n">S${n}</span><span class="wk-d">${rango}</span></label>`;
  }).join('');
  actualizarContadorSemanas();
}
function actualizarContadorSemanas(){
  const cont=document.getElementById('expWkList'), lbl=document.getElementById('expWkCnt');
  if(!cont||!lbl) return;
  const n=cont.querySelectorAll('input:checked').length;
  lbl.textContent = n===1? '1 semana' : n+' semanas';
}
function sincronizarPanelSemanas(){
  const cb=document.getElementById('exp_semanal'), box=document.getElementById('expWeeks');
  if(cb&&box) box.hidden=!cb.checked;
}

function aplicarDefaultsExport(){
  const ids=['exp_gantt','exp_cant','exp_montos','exp_base','exp_prod','exp_cert','exp_semanal','exp_avance'];
  const any=ids.some(id=>{const e=document.getElementById(id);return e&&e.checked;});
  if(any) return;   // respeta lo que el usuario ya haya elegido en esta sesión
  const set=(id,v)=>{const e=document.getElementById(id);if(e&&!e.disabled)e.checked=v;};
  const vista=(document.querySelector('.view.on')||{}).id||'';
  if(vista==='v-weekly') set('exp_semanal',true);
  else if(vista==='v-report') set('exp_avance',true);
  else if(vista==='v-prod') set('exp_prod',true);
  else if(vista==='v-cert') set('exp_cert',true);
  else { set('exp_gantt',true); set('exp_cant',true); }
}
function abrirExpModal(fmt){
  const back=document.getElementById('expModal'); if(!back) return;
  const sel=document.getElementById('exp_baseSel');
  const hayBL=!!(typeof BASELINES!=='undefined' && BASELINES && BASELINES.length);
  if(sel){
    sel.innerHTML = hayBL
      ? BASELINES.map(b=>`<option value="${b.id}">${xmlEsc(b.name)} (${b.date})</option>`).join('')
      : '<option value="">(sin líneas base)</option>';
    sel.disabled=!hayBL;
  }
  expSetDisponible('exp_base', hayBL);
  expSetDisponible('exp_prod', !!(typeof PROD!=='undefined' && PROD && Object.keys(PROD).length));
  expSetDisponible('exp_cert', !!(typeof CERT!=='undefined' && CERT && Object.keys(CERT).length));
  // el ajuste por lluvia necesita días de clima Y una línea base sobre la cual correr
  const hayLluvia = lluviaDisponibleExp();
  expSetDisponible('exp_ganttLluvia', hayLluvia);
  const notaLl=document.getElementById('expLluviaNota');
  if(notaLl){
    const dias = typeof diasGanadosRetro==='function' ? diasGanadosRetro() : 0;
    notaLl.textContent = !dias ? 'Sin días de clima reconocidos.'
      : !baseContractualExp() ? 'Necesita una línea base contractual.'
      : `Corre la línea base ${dias} días. Fin de contrato + lluvia marcado en el eje.`;
  }
  poblarSemanasExport();
  aplicarDefaultsExport();
  sincronizarPanelSemanas();
  const una=document.getElementById('exp_ganttUna'), gt=document.getElementById('exp_gantt');
  const ll=document.getElementById('exp_ganttLluvia');
  if(una&&gt){ una.disabled=!gt.checked; if(!gt.checked) una.checked=false; }
  if(ll&&gt){ if(!gt.checked){ ll.checked=false; ll.disabled=true; } else ll.disabled=!hayLluvia; }
  back.hidden=false;
  const btn=document.getElementById(fmt==='pdf'?'expDoPdf':'expDoXls'); if(btn) setTimeout(()=>{try{btn.focus();}catch(e){}},30);
}
function cerrarExpModal(){ const b=document.getElementById('expModal'); if(b) b.hidden=true; }

/* wiring del modal (corre al cargar export.js; el HTML del modal ya está en el DOM) */
(function initExportModal(){
  const g=id=>document.getElementById(id);
  const on=(id,fn)=>{ const e=g(id); if(e) e.onclick=fn; };
  on('expClose', cerrarExpModal);
  on('expDoXls', exportarExcelSel);
  on('expDoPdf', exportarPDFSel);
  const back=g('expModal');
  if(back) back.addEventListener('click', e=>{ if(e.target===back) cerrarExpModal(); });
  const gantt=g('exp_gantt'), una=g('exp_ganttUna'), llu=g('exp_ganttLluvia');
  if(gantt){
    const sync=()=>{
      if(una){ una.disabled=!gantt.checked; if(!gantt.checked) una.checked=false; }
      if(llu){
        llu.disabled=!gantt.checked || !lluviaDisponibleExp();
        if(llu.disabled) llu.checked=false;
      }
    };
    gantt.addEventListener('change', sync); sync();
  }
  // panel de semanas: mostrar/ocultar y botones de selección rápida
  const sem=g('exp_semanal');
  if(sem) sem.addEventListener('change', sincronizarPanelSemanas);
  const marcar=fn=>{
    const cont=g('expWkList'); if(!cont) return;
    const conPlan=new Set();
    (typeof WEEKLY!=='undefined'? WEEKLY:[]).forEach(w=>{ if(w.week) conPlan.add(w.week); });
    cont.querySelectorAll('input[type=checkbox]').forEach(c=>{ c.checked=fn(c.value, conPlan); });
    actualizarContadorSemanas();
  };
  on('expWkAll',  ()=>marcar(()=>true));
  on('expWkNone', ()=>marcar(()=>false));
  on('expWkCon',  ()=>marcar((wk,cp)=>cp.has(wk)));
  const lista=g('expWkList');
  if(lista) lista.addEventListener('change', actualizarContadorSemanas);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ const b=g('expModal'); if(b&&!b.hidden) cerrarExpModal(); } });
})();
