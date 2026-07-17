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
  const head=['ID','Nivel','Descripción','Cód. CC','UM','Cant. contrato','Precio unit.','Precio total',
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
      {v:i.cant,t:'n'}, {v:i.pu,t:'m'}, {v:i.ptot,t:'m'},
      {v:suma,t:'n'}, {v:cejec||'',t:'n'}, {v:cpend,t:'n'},
      {v:av!=null?av:'',t:'n'}, {v:esp!=null?+esp.toFixed(1):'',t:'n'}, {v:brecha!==''?+brecha.toFixed(1):'',t:'n'},
      {v:i.cat,t:'s'}, {v:i.estado,t:'s'}, {v:i.ini,t:'s'}, {v:i.fin,t:'s'},
      ...P.map(m=>({v:(i.dist_mensual[m]||0)||'', t:'n'})),
      {v:suma,t:'n'}, {v:dif,t:'n'}
    ];
  });
  // fila de totales en Gs (incluye el MONTO PLANEADO total)
  const montoPlan=ITEMS.reduce((s,i)=>s+sumaCronograma(i)*i.pu,0);
  const tot=['','','TOTAL (Gs)','','','','',
    {v:ITEMS.reduce((s,i)=>s+i.ptot,0),t:'m'},
    {v:montoPlan,t:'m'},'','','','','','','','','',
    ...P.map(m=>({v:ITEMS.reduce((s,i)=>s+(i.dist_mensual[m]||0)*i.pu,0), t:'m'})),
    {v:montoPlan,t:'m'},''];
  rows.push([]); rows.push(tot);
  return {nombre:'Cronograma', head, rows,
          cols:[40,40,240,70,45,80,80,95,85,85,85,70,70,65,110,75,70,70, ...P.map(()=>70), 85,85]};
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
  // Para el Gantt, preguntar si va todo en una sola hoja o partido por páginas.
  let unaHoja=false;
  const esGantt = vista!=='v-weekly' && vista!=='v-report' && ganttMode==='time';
  if(esGantt){
    unaHoja = confirm('¿Exportar el cronograma en UNA SOLA HOJA?\n\n'
      + 'Aceptar = todo en una hoja (más ancha/alta, ideal para plotter o ver completo).\n'
      + 'Cancelar = partido por páginas A3 (un bloque por página).');
  }
  if(vista==='v-weekly'){ titulo='Plan semanal'; contenido=pdfSemanal(); }
  else if(vista==='v-report'){ titulo='Avance e informes'; contenido=pdfAvance(); }
  else { titulo = ganttMode==='time'? 'Cronograma (Gantt)' : `Cronograma · ${({qty:'Cantidades',pct:'Porcentajes',money:'Montos'})[ganttMode]}`;
         contenido = ganttMode==='time'? pdfGantt(unaHoja) : pdfGrilla(); }

  const w=window.open('','_blank');
  if(!w){ toast('El navegador bloqueó la ventana. Permití las ventanas emergentes.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <title>${xmlEsc(obraNombre())} · ${xmlEsc(titulo)}</title>
  <style>
    @page{ size:A3 landscape; margin:8mm; }
    ${unaHoja?`@page{ size:auto; margin:6mm; }`:''}
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
      ${unaHoja?`.gantt-wrap + .gantt-wrap{page-break-before:avoid !important}`:''}
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

function pdfGantt(unaHoja){
  const conFechas=ITEMS.filter(i=>i.ini&&i.fin);
  if(!conFechas.length) return '<p style="padding:20px;color:#888">Ningún ítem tiene fechas cargadas.</p>';

  // dominio temporal real (día a día, igual que la pantalla)
  let min=null,max=null;
  conFechas.forEach(i=>{const a=parseD(i.ini),b=parseD(i.fin);
    if(a&&(!min||a<min))min=a; if(b&&(!max||b>max))max=b;});
  const x0=new Date(min.getFullYear(),min.getMonth(),1);
  const x1=new Date(max.getFullYear(),max.getMonth()+1,1);
  const dias=Math.max(1,daysBetween(x0,x1));

  /* El SVG tiene que ENTRAR en la página. A3 apaisado = 297mm de alto; entre
     encabezado, KPIs y márgenes quedan ~185mm útiles. Con muchos ítems se
     comprime el alto de fila y, si aun así no entra, se parte en bloques
     (cada bloque = una página, repitiendo el eje de meses). */
  // Zona izquierda: ÍTEM DE OBRA + columnas Inicio · Fin · Días.
  // LEFT es el borde donde arranca el timeline. Reservamos columnas a su izquierda.
  const C_DUR=44, C_FIN=62, C_INI=62;          // anchos de las 3 columnas de fecha
  const LEFT=430, W=1120, TW=W-LEFT, HH=34;
  const X_DUR=LEFT-C_DUR, X_FIN=X_DUR-C_FIN, X_INI=X_FIN-C_INI;   // x de cada columna
  const DESC_W=X_INI;                          // la descripción ocupa hasta donde arrancan las fechas
  const MM_W=410, MM_H_MAX=185;
  const U=W/MM_W;                       // unidades de viewBox por mm
  const HMAX=MM_H_MAX*U;
  const RH=22;                          // alto de fila (más aire, como la pantalla)
  // en modo "una hoja" NO se parte: todos los ítems van en un único SVG.
  const PORBLOQUE = unaHoja ? conFechas.length : Math.max(5, Math.floor((HMAX-HH-8)/RH));

  const px=d=>LEFT+daysBetween(x0,(typeof d==='string'?parseD(d):d))/dias*TW;
  const MN=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const meses=[]; { let c=new Date(x0);
    while(c<x1){ const n=new Date(c.getFullYear(),c.getMonth()+1,1);
      meses.push([new Date(c),new Date(n)]); c=n; } }
  const hoy=new Date();
  const hoyX=(hoy>=x0&&hoy<=x1)? px(hoy):null;
  const filaGlobal={}; conFechas.forEach((i,k)=>filaGlobal[i.id]=k);

  const bloques=[];
  for(let b0=0; b0<conFechas.length; b0+=PORBLOQUE){
    const grupo=conFechas.slice(b0, b0+PORBLOQUE);
    const H=HH+grupo.length*RH+6;
    const MM_H=+(H/U).toFixed(1);
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

    // dependencias (solo si predecesor y sucesor están en el MISMO bloque)
    grupo.forEach((i,k)=>{
      (i.deps||[]).forEach(d=>{
        const gk=grupo.findIndex(x=>x.id===d.id);
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
    grupo.forEach((i,k)=>{
      const y=HH+k*RH;
      // línea horizontal de separación entre ítems (cuadrícula)
      s+=`<line x1="0" y1="${y+RH}" x2="${W}" y2="${y+RH}" stroke="#d8d2c4" stroke-width="0.5"/>`;
      // descripción recortada al ancho disponible (~1 car cada 4.6px a 8.2px)
      const maxCh=Math.max(10,Math.floor((DESC_W-26)/4.6));
      const dRaw=(i.desc||'');
      const txt=dRaw.length>maxCh? dRaw.slice(0,maxCh-1)+'…':dRaw;
      s+=`<text x="6" y="${y+RH/2+2.8}" font-size="7.5" fill="#8a8578">${xmlEsc(i.id)}</text>
          <text x="26" y="${y+RH/2+2.8}" font-size="8.2" fill="#111">${xmlEsc(txt)}</text>`;
      // columnas de fecha (Inicio · Fin · Días), centradas en su columna
      const dur=(i.ini&&i.fin)? daysBetween(parseD(i.ini),parseD(i.fin))+1 : '';
      s+=`<text x="${X_INI+C_INI/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="6.8" fill="#555">${i.ini||'—'}</text>
          <text x="${X_FIN+C_FIN/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="6.8" fill="#555">${i.fin||'—'}</text>
          <text x="${X_DUR+C_DUR/2}" y="${y+RH/2+2.8}" text-anchor="middle" font-size="7" fill="#333" font-weight="600">${dur}</text>`;
      // barra
      const xa=px(i.ini), xb=px(i.fin), w=Math.max(2,xb-xa);
      const elim=(i.estado||'').toLowerCase().includes('elimin');
      const bh=RH-10;                       // barra gruesa, con margen arriba/abajo
      const by=y+(RH-bh)/2;
      s+=`<rect x="${xa}" y="${by}" width="${w}" height="${bh}" rx="3" fill="${elim?'#b9b3a4':'#4a7fbd'}"/>`;
      const av=i.avance_real_prod||0;
      if(av>0) s+=`<rect x="${xa}" y="${by}" width="${w*Math.min(100,av)/100}" height="${bh}" rx="3" fill="#3f9d5a"/>`;
    });
    s+=`</svg>`;
    bloques.push(`<div class="gantt-wrap">${s}</div>`);
  }

  const sinFechas=ITEMS.length-conFechas.length;
  const aviso=sinFechas? `<p class="aviso">⚠ ${sinFechas} ítem(s) sin fechas cargadas no aparecen en el diagrama (figuran en la tabla de detalle).</p>`:'';
  const leyenda=`<div class="leg">
    <span><i style="background:#4a7fbd"></i>Planificado</span>
    <span><i style="background:#3f9d5a"></i>Avance real</span>
    <span><i style="background:#b9b3a4"></i>Eliminado</span>
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
