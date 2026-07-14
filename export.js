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
  const head=['ID','Descripción','Cód. CC','UM','Cant. contrato','Precio unit.','Precio total',
              'Categoría','Estado','Inicio','Fin', ...P.map(m=>monthLabel(m)), 'Σ Cronograma','Dif. vs contrato'];
  const rows=ITEMS.map(i=>{
    const suma=sumaCronograma(i), dif=difContrato(i);
    return [
      {v:i.id,t:'s'}, {v:i.desc,t:'s'}, {v:i.codigo_cc,t:'s'}, {v:i.um,t:'s'},
      {v:i.cant,t:'n'}, {v:i.pu,t:'m'}, {v:i.ptot,t:'m'},
      {v:i.cat,t:'s'}, {v:i.estado,t:'s'}, {v:i.ini,t:'s'}, {v:i.fin,t:'s'},
      ...P.map(m=>({v:(i.dist_mensual[m]||0)||'', t:'n'})),
      {v:suma,t:'n'}, {v:dif,t:'n'}
    ];
  });
  // fila de totales en Gs
  const tot=['','TOTAL (Gs)','','','','','','','','','',
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0), t:'m'})),
    {v:ITEMS.reduce((s,i)=>s+i.ptot,0),t:'m'},''];
  rows.push([]); rows.push(tot);
  return {nombre:'Cronograma', head, rows,
          cols:[40,240,70,45,80,80,95,110,75,70,70, ...P.map(()=>70), 85,85]};
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
function exportarExcel(){
  try{
    descargarXls(
      [hojaCronograma(), hojaCantidades(), hojaMontos(), hojaSemanal(), hojaAvance()],
      `Obra_${obraNombre().replace(/[^\w]+/g,'_')}_${hoyStr()}.xls`
    );
    toast('Excel generado — 5 hojas: cronograma, cantidades, montos, semanal y avance');
  }catch(err){ toast('Error al exportar: '+err.message); }
}

/* ================= PDF (vía impresión del navegador) ================= */
function exportarPDF(){
  const vista = document.querySelector('.view.on')?.id || '';
  let titulo='Cronograma', contenido='';
  if(vista==='v-weekly'){ titulo='Plan semanal'; contenido=pdfSemanal(); }
  else if(vista==='v-report'){ titulo='Avance e informes'; contenido=pdfAvance(); }
  else { titulo = ganttMode==='time'? 'Cronograma (Gantt)' : `Cronograma · ${({qty:'Cantidades',pct:'Porcentajes',money:'Montos'})[ganttMode]}`;
         contenido = ganttMode==='time'? pdfGantt() : pdfGrilla(); }

  const w=window.open('','_blank');
  if(!w){ toast('El navegador bloqueó la ventana. Permití las ventanas emergentes.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <title>${xmlEsc(obraNombre())} · ${xmlEsc(titulo)}</title>
  <style>
    @page{ size:A3 landscape; margin:10mm; }
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',system-ui,sans-serif;color:#111;margin:0;font-size:10px}
    .hdr{display:flex;justify-content:space-between;align-items:flex-end;
      border-bottom:2.5px solid #0d1b2a;padding-bottom:6px;margin-bottom:10px}
    .hdr h1{margin:0;font-size:17px;color:#0d1b2a}
    .hdr .sub{font-size:11px;color:#555;margin-top:2px}
    .hdr .meta{text-align:right;font-size:9.5px;color:#666;line-height:1.5}
    table{width:100%;border-collapse:collapse;font-size:8.6px}
    th{background:#1b3350;color:#fff;padding:5px 4px;text-align:left;font-weight:600;
       border:1px solid #2a4668}
    td{padding:3.5px 4px;border:1px solid #d6d0c0}
    tr:nth-child(even) td{background:#faf8f2}
    .r{text-align:right;font-variant-numeric:tabular-nums}
    .tot td{background:#f2c200!important;font-weight:700;border-top:2px solid #0d1b2a}
    .ok{color:#1f6b38;font-weight:700}.bad{color:#c0392b;font-weight:700}
    .bar{height:9px;background:#5b8fd6;border-radius:2px;display:inline-block;vertical-align:middle}
    .kpis{display:flex;gap:8px;margin-bottom:10px}
    .kpi{flex:1;border:1px solid #d6d0c0;border-radius:5px;padding:6px 9px;background:#faf8f2}
    .kpi .l{font-size:7.5px;text-transform:uppercase;letter-spacing:.6px;color:#777;font-weight:700}
    .kpi .v{font-size:13px;font-weight:700;color:#0d1b2a;margin-top:1px;font-variant-numeric:tabular-nums}
    .ft{margin-top:8px;font-size:8px;color:#888;text-align:right}
    @media print{ .noprint{display:none} tr{page-break-inside:avoid} thead{display:table-header-group} }
  </style></head><body>
  <div class="hdr">
    <div><h1>${xmlEsc(obraNombre())}</h1><div class="sub">${xmlEsc(titulo)}</div></div>
    <div class="meta">Emitido: ${new Date().toLocaleString('es-PY')}<br>
      ${ITEMS.length} ítems · Contrato ${fmtG(contratoTotal())}</div>
  </div>
  ${kpisPdf()}
  ${contenido}
  <div class="ft">Obra · Plan Unificado</div>
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
  const val=(i,m)=>{const q=i.dist_mensual[m]||0; if(!q) return '';
    if(esMon) return Math.round(q*i.pu).toLocaleString('es-PY');
    if(esPct) return (i.cant? q/i.cant*100:0).toFixed(1)+'%';
    return fmtQty(q);};
  const totales=P.map(m=>ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0));
  return `<table>
   <thead><tr><th>ID</th><th>Ítem de obra</th><th>UM</th><th class="r">Cant. contrato</th>
     ${P.map(m=>`<th class="r">${monthLabel(m)}</th>`).join('')}
     <th class="r">Σ Cronog.</th><th class="r">Dif.</th></tr></thead>
   <tbody>${ITEMS.map(i=>{
      const s=sumaCronograma(i), d=difContrato(i), ok=Math.abs(d)<0.005;
      return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.um)}</td>
        <td class="r">${fmtN(i.cant)}</td>
        ${P.map(m=>`<td class="r">${val(i,m)}</td>`).join('')}
        <td class="r">${esPct? (i.cant?(s/i.cant*100).toFixed(1)+'%':'—') : fmtQty(s)}</td>
        <td class="r ${ok?'ok':'bad'}">${ok?'✓':(d>0?'+':'')+fmtN(d,2)}</td></tr>`;
    }).join('')}
   <tr class="tot"><td colspan="4">TOTAL · Monto por mes (Gs)</td>
     ${totales.map(t=>`<td class="r">${t?Math.round(t).toLocaleString('es-PY'):''}</td>`).join('')}
     <td class="r">${fmtG(contratoTotal()).replace('₲ ','')}</td><td></td></tr>
   </tbody></table>`;
}
function pdfGantt(){
  const min=MONTHS[0], max=MONTHS[MONTHS.length-1];
  const total=MONTHS.length||1;
  const idx=m=>MONTHS.indexOf(m);
  return `<table>
    <thead><tr><th>ID</th><th>Ítem de obra</th><th>Cat.</th><th>Estado</th>
      <th>Inicio</th><th>Fin</th><th>Dependencias</th>
      <th style="width:45%">Línea de tiempo (${monthLabel(min)} → ${monthLabel(max)})</th></tr></thead>
    <tbody>${ITEMS.map(i=>{
      const a=i.ini?String(i.ini).slice(0,7):null, b=i.fin?String(i.fin).slice(0,7):null;
      let bar='';
      if(a&&b && idx(a)>=0 && idx(b)>=0){
        const l=idx(a)/total*100, wid=Math.max(1,(idx(b)-idx(a)+1)/total*100);
        bar=`<div style="position:relative;height:11px"><span class="bar" style="position:absolute;left:${l}%;width:${wid}%"></span></div>`;
      }
      const deps=(i.deps||[]).map(d=>`${d.id}${d.type!=='FS'?'('+d.type+')':''}`).join(', ');
      return `<tr><td>${i.id}</td><td>${xmlEsc(i.desc)}</td><td>${xmlEsc(i.cat)}</td>
        <td>${xmlEsc(i.estado)}</td><td>${i.ini||''}</td><td>${i.fin||''}</td>
        <td>${deps}</td><td>${bar}</td></tr>`;
    }).join('')}</tbody></table>`;
}
function pdfSemanal(){
  const wk=ALLWEEKS[weeklyIdx];
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
    <table><thead><tr><th>Ítem</th><th>Actividad</th><th>Frente</th><th>UM</th>
      <th class="r">Previsto</th><th class="r">Ejecutado</th><th class="r">% Cumpl.</th>
      <th>Causa</th><th class="r">Saldo mes</th></tr></thead>
    <tbody>${body}
      <tr class="tot"><td colspan="4">TOTAL</td><td class="r">${fmtN(tp)}</td>
      <td class="r">${fmtN(te)}</td><td class="r">${tp?(te/tp*100).toFixed(1)+'%':'—'}</td>
      <td colspan="2"></td></tr></tbody></table>`;
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
