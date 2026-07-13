/* =========================================================================
   Obra · Plan Unificado — engine v3 (editable planning tool)
   - Row-height alignment between grid and timeline (measured, not fixed)
   - Editable monthly cells: Cantidad tab edits qty, Porcentaje tab edits %
   - Add items from the grid; full editable drawer with scroll
   - Category CRUD; dependencies in 4 modes (FS/SS/FF/SF)
   - Multiple baselines storing dates AND monthly quantities
   - Weekly plan spanning every project week; executed is read-only (form-fed)
   - Drawer footer: previsto vs ejecutado by month
   ========================================================================= */
'use strict';
let D = window.OBRA_DATA || {items:[],weekly:[],production:{},baselines:[],categorias:[]};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmtG = n => '₲ ' + Math.round(n||0).toLocaleString('es-PY');
const fmtGshort = n => { n=n||0; const s=n<0?'-':''; n=Math.abs(n);
  if(n>=1e9)return s+(n/1e9).toFixed(1)+'MM'; if(n>=1e6)return s+(n/1e6).toFixed(0)+'M';
  if(n>=1e3)return s+(n/1e3).toFixed(0)+'k'; return s+String(Math.round(n)); };
const fmtN = (n,d=2) => (n==null||isNaN(n))?'—':Number(n).toLocaleString('es-PY',{maximumFractionDigits:d});
const pct = n => (n==null||isNaN(n))?'—':(Number(n).toFixed(1)+'%');
const TODAY = new Date();
const parseD = s => s? new Date(String(s).slice(0,10)+'T00:00:00') : null;
const dstr = d => d.toISOString().slice(0,10);
const daysBetween = (a,b)=> Math.round((b-a)/86400000);
const uid = p => p+'_'+Math.random().toString(36).slice(2,8);

function parseDepInit(txt){
  if(!txt) return [];
  return String(txt).split(',').map(s=>{
    const m=s.trim().match(/^(\d+(?:\.\d+)?)/); return m?{id:m[1],type:'FS'}:null;
  }).filter(Boolean);
}

/* ---- modelo mutable (recargable al cambiar de obra) ---- */
let ITEMS=[], WEEKLY=[], PROD={}, CATS=[], BASELINES=[], MONTHS=[], WEEKS=[];
let byId={};
const reindex=()=>{byId={};ITEMS.forEach(i=>byId[i.id]=i);};
let wkIndex=0, activeBaseline=null;

function reloadModel(data){
  D = data || {items:[],weekly:[],production:{},baselines:[],categorias:[]};
  ITEMS = (D.items||[]).map(it=>({
    id: String(it.id),
    desc: it.desc||'',
    id_nivel3: it.id_nivel3||'', desc_nivel3: it.desc_nivel3||'',
    codigo_cc: it.codigo_cc||'',
    um: it.um||'',
    cant: Number(it.cant_contrato)||0,
    pu: Number(it.precio_unit)||0,
    get ptot(){return this.cant*this.pu;},
    incidencia: it.incidencia!=null && it.incidencia!==''?Number(it.incidencia):null,
    avE: it.avance_esperado!=null && it.avance_esperado!==''? Number(it.avance_esperado):null,
    ini: it.real_start||it.fecha_ini||null,
    fin: it.real_end||it.fecha_fin||null,
    estado: it.estado||'Pendiente',
    cat: it.categoria||'Sin categoría',
    dist_mensual: Object.assign({}, it.dist_mensual||{}),
    deps: (it.deps && it.deps.length)? it.deps.map(d=>({id:String(d.id),type:d.type||'FS'}))
          : parseDepInit(it.dependencia),
    avance_real_prod: it.avance_real_prod!=null?Number(it.avance_real_prod):null,
    _rev: it._rev||0,
  }));
  reindex();
  CATS = (D.categorias && D.categorias.length)? D.categorias.slice()
       : [...new Set(ITEMS.map(i=>i.cat).filter(Boolean))];
  if(!CATS.length) CATS=['Sin categoría'];
  WEEKLY = (D.weekly||[]).filter(w=>w.item_id && byId[w.item_id]).map(w=>({...w}));
  WEEKS = [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort();
  wkIndex = Math.max(0, WEEKS.length-1);
  PROD = D.production||{};
  BASELINES = (D.baselines||[]).map(b=>({...b}));
  activeBaseline=null;
  MONTHS = computeMonths();
  if(typeof ALLWEEKS!=='undefined'){ ALLWEEKS=allProjectWeeks(); weeklyIdx=defaultWeekIdx(); }
  renderBaselineControls(); renderKPIs(); renderGantt();
}

/* total incidencia base = sum of ptot */
const contratoTotal = () => ITEMS.reduce((s,i)=>s+i.ptot,0);

/* month axis */
function computeMonths(){
  const s=new Set();
  ITEMS.forEach(i=>{
    Object.keys(i.dist_mensual||{}).forEach(m=>s.add(m));
    if(i.ini&&i.fin){let c=new Date(parseD(i.ini).getFullYear(),parseD(i.ini).getMonth(),1);
      const e=parseD(i.fin); while(c<=e){s.add(c.toISOString().slice(0,7)); c=new Date(c.getFullYear(),c.getMonth()+1,1);}}
  });
  WEEKLY.forEach(w=>w.month&&s.add(w.month));
  return [...s].sort();
}
function snapshotBaseline(name){
  const snap={ id:uid('bl'), name:name||('Línea base '+(BASELINES.length+1)),
    date: dstr(TODAY), items:{} };
  ITEMS.forEach(i=>{ snap.items[i.id]={ini:i.ini, fin:i.fin,
    cant:i.cant, dist:Object.assign({},i.dist_mensual)}; });
  BASELINES.push(snap);
  if(ONLINE) ObraAPI.saveBaseline(snap.name, snap.items).catch(e=>toast('Error guardando línea base: '+e.message));
  return snap;
}

const monthLabel = m=>{const[y,mm]=m.split('-');return ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][+mm-1]+' '+y.slice(2);};
const monthShort = m=>{const[y,mm]=m.split('-');return ['E','F','M','A','M','J','J','A','S','O','N','D'][+mm-1];};

/* ===================== SAVE (debounced) ================================= */
let saveTimer=null;
let ONLINE = false;          // true cuando hay backend conectado
let dirty = { items:false, weekly:false, cats:false };
const deletedWeekly = [];    // plan_id de filas borradas

function touch(what){
  if(what) dirty[what]=true; else { dirty.items=true; }
  const chip=$('#saveChip'); if(!chip)return;
  chip.classList.remove('err');
  chip.classList.add('saving'); $('#saveTxt').textContent='Guardando…';
  clearTimeout(saveTimer);
  saveTimer=setTimeout(flush,1500);
}
async function flush(){
  const chip=$('#saveChip');
  if(!ONLINE){ chip.classList.remove('saving'); $('#saveTxt').textContent='Local'; return; }
  try{
    const jobs=[];
    if(dirty.items){ const s=ObraAPI.serializeItems(ITEMS); jobs.push(ObraAPI.saveItems(s.items,s.dist,s.deps)); }
    if(dirty.weekly){ jobs.push(ObraAPI.saveWeekly(ObraAPI.serializeWeekly(WEEKLY), deletedWeekly.splice(0))); }
    if(dirty.cats){ jobs.push(ObraAPI.saveCategorias(CATS)); }
    await Promise.all(jobs);
    dirty={items:false,weekly:false,cats:false};
    chip.classList.remove('saving'); $('#saveTxt').textContent='Guardado';
  }catch(err){
    chip.classList.remove('saving'); chip.classList.add('err');
    $('#saveTxt').textContent='Error al guardar';
    toast('No se pudo guardar: '+err.message);
  }
}
function toast(html){const t=$('#toast');if(!t)return;t.innerHTML=html;t.classList.add('show');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600);}

/* ================= distribution helpers ================================= */
/* Rule A: spread contract qty across touched months proportional to calendar days */
function redistributeMonths(i, respectManual=true){
  const a=parseD(i.ini), b=parseD(i.fin); if(!a||!b) return;
  // preserve manually-set months (flagged), redistribute the remainder
  const manual = i._manualMonths||{};
  const manualSum = Object.entries(manual).reduce((s,[m,v])=> s + (respectManual? (i.dist_mensual[m]||0):0),0);
  const total=Math.max(0,(i.cant||0) - (respectManual?manualSum:0));
  const dist=respectManual? Object.fromEntries(Object.entries(i.dist_mensual).filter(([m])=>manual[m])) : {};
  let sumDays=0; const buckets=[];
  let cur=new Date(a);
  while(cur<=b){
    const mk=cur.toISOString().slice(0,7);
    if(!(respectManual&&manual[mk])){
      const mEnd=new Date(cur.getFullYear(),cur.getMonth()+1,0);
      const segEnd = b<mEnd? b:mEnd;
      const d=daysBetween(cur,segEnd)+1; buckets.push([mk,d]); sumDays+=d;
    }
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  buckets.forEach(([mk,d])=>dist[mk]=+(total*d/sumDays).toFixed(3));
  i.dist_mensual=dist;
}
/* set one month's qty manually; rescale others to keep total = contract (Rule: month ceiling) */
function setMonthQty(i, mk, val){
  i._manualMonths=i._manualMonths||{}; i._manualMonths[mk]=true;
  i.dist_mensual[mk]=val;
  // rebalance non-manual months to fit remaining
  redistributeMonths(i, true);
  i.dist_mensual[mk]=val; // ensure exact
  touch();
}
function setMonthPct(i, mk, p){ setMonthQty(i, mk, +( (i.cant||0)*p/100 ).toFixed(3)); }
function monthPct(i, mk){ const q=i.dist_mensual[mk]||0; return i.cant? q/i.cant*100:0; }

/* dependency helpers */
const DEP_TYPES={FS:'Fin→Inicio',SS:'Inicio→Inicio',FF:'Fin→Fin',SF:'Inicio→Fin'};
function depList(i){ return i.deps||[]; }
function cascade(src){
  ITEMS.forEach(i=>{
    (i.deps||[]).forEach(dep=>{
      if(dep.id!==src.id) return;
      const sIni=parseD(src.ini), sFin=parseD(src.fin), iIni=parseD(i.ini), iFin=parseD(i.fin);
      if(!iIni||!iFin) return;
      const dur=daysBetween(iIni,iFin);
      let need=null;
      if(dep.type==='FS' && sFin) need=sFin;                 // start >= pred end
      else if(dep.type==='SS' && sIni) need=sIni;            // start >= pred start
      else if(dep.type==='FF' && sFin){ // end >= pred end -> shift so fin=sFin if earlier
        if(iFin<sFin){ i.fin=dstr(sFin); const nb=new Date(sFin); nb.setDate(nb.getDate()-dur); i.ini=dstr(nb); redistributeMonths(i); cascade(i);} return;
      }
      else if(dep.type==='SF' && sIni){ if(iFin<sIni){ i.fin=dstr(sIni);} return; }
      if(need && iIni<need){
        i.ini=dstr(need); const nb=new Date(need); nb.setDate(nb.getDate()+dur); i.fin=dstr(nb);
        redistributeMonths(i); cascade(i);
      }
    });
  });
}
/* ===================== GANTT (aligned + editable) ====================== */
let ganttMode='time', showCrit=false, selId=null, catFilter='';
const G={x0:null,x1:null,pxDay:2.6};

function ganttDomain(){
  let min=null,max=null;
  ITEMS.forEach(i=>{const a=parseD(i.ini),b=parseD(i.fin); if(a&&(!min||a<min))min=a; if(b&&(!max||b>max))max=b;});
  min=min||new Date('2025-04-01'); max=max||new Date('2027-06-30');
  G.x0=new Date(min.getFullYear(),min.getMonth(),1);
  G.x1=new Date(max.getFullYear(),max.getMonth()+1,1);
  G.pxDay=Math.max(1.6,Math.min(4,1400/daysBetween(G.x0,G.x1)));
}
const gx = d => daysBetween(G.x0, parseD(typeof d==='string'?d:dstr(d)))*G.pxDay;
const body_w=()=>daysBetween(G.x0,G.x1)*G.pxDay;

function visibleItems(){ return ITEMS.filter(i=>!catFilter||i.cat===catFilter); }

function renderGantt(){
  ganttDomain();
  const cats=CATS.slice().sort();
  const cf=$('#catFilter');
  cf.innerHTML='<option value="">Todas las categorías</option>'+cats.map(c=>`<option ${c===catFilter?'selected':''}>${c}</option>`).join('');
  const list=visibleItems();
  const crit=showCrit?critPath():new Set();

  /* ---- 1) render grid rows ---- */
  $('#ganttGrid').innerHTML = list.map(i=>{
    const est=estadoBadge(i.estado);
    const avp=i.avance_real_prod!=null?pct(i.avance_real_prod):'—';
    return `<div class="grow-row" data-id="${i.id}">
      <div class="idc">${i.id}</div>
      <div class="descc">${i.desc||'—'}<div class="rowsub"><span class="um-tag">${i.cat}</span> ${est}</div></div>
      <div class="um-tag2">${i.um||''}</div>
      <div class="num">${fmtN(i.cant)}</div>
      <div class="num">${avp}</div>
    </div>`;
  }).join('') + `<div class="grow-add" id="addItemRow">＋ Agregar ítem</div>`;

  /* ---- 2) month header ---- */
  const monthsSpan=[]; let cur=new Date(G.x0);
  while(cur<G.x1){const next=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    monthsSpan.push([new Date(cur),daysBetween(cur,next)*G.pxDay]);cur=next;}
  const totalW=body_w();
  $('#timeHead').innerHTML = monthsSpan.map(([d,w])=>
    `<div class="tmonth" style="width:${w}px">${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]}<small>${d.getFullYear()}</small></div>`).join('');
  $('#timeHead').firstChild && ($('#timeHead').style.width=totalW+'px');

  /* ---- 3) measure grid row heights for perfect alignment ---- */
  requestAnimationFrame(()=>{
    const gridRows=[...$('#ganttGrid').querySelectorAll('.grow-row')];
    const heights=gridRows.map(r=>r.getBoundingClientRect().height);
    const tops=[]; let acc=0; heights.forEach(h=>{tops.push(acc);acc+=h;});
    const totalH=acc;

    // vertical gridlines
    const lines=monthsSpan.map(([d])=>`<div class="vl" style="left:${gx(d)}px"></div>`).join('')
      +`<div class="vl today" style="left:${gx(TODAY)}px"></div>`;
    const gl=$('#gcolLines'); gl.innerHTML=lines; gl.style.width=totalW+'px'; gl.style.height=totalH+'px';

    const body=$('#timeBody');
    [...body.querySelectorAll('.trow')].forEach(e=>e.remove());
    body.style.width=totalW+'px'; body.style.height=(totalH+2)+'px';
    const showBase=$('#showBase').checked && activeBaseline;
    const bl = activeBaseline? BASELINES.find(b=>b.id===activeBaseline):null;

    let maxMonthVal=1;
    if(ganttMode==='qty'||ganttMode==='pct'||ganttMode==='money'){
      list.forEach(i=>{for(const[m,q]of Object.entries(i.dist_mensual||{})){
        const v=ganttMode==='money'?q*i.pu:(ganttMode==='pct'?monthPct(i,m):q); if(v>maxMonthVal)maxMonthVal=v;}});
    }

    list.forEach((i,idx)=>{
      const row=document.createElement('div');
      row.className='trow'+(i.id===selId?' sel':'');
      row.style.top=tops[idx]+'px'; row.style.height=heights[idx]+'px'; row.style.width=totalW+'px';
      const critc=crit.has(i.id)?' crit':'';
      const a=parseD(i.ini),b=parseD(i.fin);

      if(ganttMode==='time'){
        if(a&&b){
          const x=gx(i.ini),w=Math.max(6,daysBetween(a,b)*G.pxDay);
          const av=i.avance_real_prod!=null?i.avance_real_prod:0;
          const baseHtml = (showBase&&bl&&bl.items[i.id]&&bl.items[i.id].ini)?
            `<div class="bar-base" style="left:${gx(bl.items[i.id].ini)}px;width:${Math.max(6,daysBetween(parseD(bl.items[i.id].ini),parseD(bl.items[i.id].fin))*G.pxDay)}px"></div>`:'';
          row.innerHTML=`${baseHtml}<div class="bar${critc}" data-id="${i.id}" style="left:${x}px;width:${w}px">
            <div class="fill" style="width:${av}%"></div><div class="lbl">${(i.desc||'').slice(0,30)}</div></div>`;
        }
      } else {
        // qty / pct / money: editable month cells
        const cells=Object.keys(i.dist_mensual||{}).sort().map(m=>{
          const [yy,mm]=m.split('-').map(Number);
          const mStart=new Date(yy,mm-1,1),mEnd=new Date(yy,mm,1);
          const x=gx(mStart),w=Math.max(6,daysBetween(mStart,mEnd)*G.pxDay-1);
          const q=i.dist_mensual[m]||0;
          const val=ganttMode==='money'?q*i.pu:(ganttMode==='pct'?monthPct(i,m):q);
          const h=Math.max(6,val/maxMonthVal*Math.min(28,heights[idx]-8));
          const lab=ganttMode==='money'?fmtGshort(val):(ganttMode==='pct'?val.toFixed(0)+'%':fmtN(q,q<10?1:0));
          const editable=(ganttMode==='qty'||ganttMode==='pct');
          return `<div class="mcell${critc}${editable?' edit':''}" data-id="${i.id}" data-m="${m}"
            title="${monthLabel(m)}: ${ganttMode==='money'?fmtG(val):fmtN(q)+' '+(i.um||'')} (${monthPct(i,m).toFixed(1)}%)"
            style="left:${x}px;width:${w}px;height:${h}px">${w>=26?`<span class="mlab">${lab}</span>`:''}</div>`;
        }).join('');
        row.innerHTML=cells||'';
      }
      body.appendChild(row);
    });
    drawDeps(list,tops,heights);
    bindGantt();
  });
}

function estadoBadge(e){
  const s=(e||'').toLowerCase();
  if(s.includes('listo')) return '<span class="badge b-listo">Listo</span>';
  if(s.includes('proceso')) return '<span class="badge b-proc">En proceso</span>';
  if(s.includes('elimin')) return '<span class="badge b-elim">Eliminado</span>';
  if(s.includes('estanc')) return '<span class="badge b-est">Estancado</span>';
  return '<span class="badge b-nada">Pendiente</span>';
}

function critPath(){
  const crit=new Set();
  const sorted=[...ITEMS].filter(i=>i.ini&&i.fin).sort((a,b)=>parseD(b.fin)-parseD(a.fin));
  let cur=sorted[0]; const seen=new Set();
  while(cur&&!seen.has(cur.id)){crit.add(cur.id);seen.add(cur.id);
    const d=(cur.deps||[])[0]; cur=d?byId[d.id]:null;}
  return crit;
}

function drawDeps(list,tops,heights){
  const svg=$('#depSvg');
  svg.style.width=body_w()+'px'; svg.style.height=(tops[tops.length-1]+heights[heights.length-1])+'px';
  if(ganttMode!=='time'){svg.innerHTML='';return;}
  const idx={}; list.forEach((i,k)=>idx[i.id]=k);
  const cy=k=>tops[k]+Math.min(heights[k]/2, 8+10);   // bar centre within row
  const parts=[`<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 Z" fill="#6f9bd1"/></marker></defs>`];
  list.forEach((i,k)=>{
    if(!i.ini||!i.fin) return;
    (i.deps||[]).forEach(dep=>{
      const pk=idx[dep.id]; const p=byId[dep.id];
      if(pk==null||!p||!p.ini||!p.fin) return;
      let sx,sy,ex,ey;
      sy=cy(pk); ey=cy(k);
      const pIni=gx(p.ini),pFin=gx(p.fin),iIni=gx(i.ini),iFin=gx(i.fin);
      if(dep.type==='FS'){sx=pFin;ex=iIni;}
      else if(dep.type==='SS'){sx=pIni;ex=iIni;}
      else if(dep.type==='FF'){sx=pFin;ex=iFin;}
      else {sx=pIni;ex=iFin;} // SF
      const stub=9;
      let d;
      if(ex>=sx+stub) d=`M${sx},${sy} H${sx+stub} V${ey} H${ex-2}`;
      else{const midY=sy+(ey>sy?18:-18); d=`M${sx},${sy} H${sx+stub} V${midY} H${ex-stub} V${ey} H${ex-2}`;}
      parts.push(`<path d="${d}" fill="none" stroke="#6f9bd1" stroke-width="1.3" opacity=".7" marker-end="url(#arrow)" stroke-linejoin="round"/>`);
    });
  });
  svg.innerHTML=parts.join('');
}

function bindGantt(){
  $$('#ganttGrid .grow-row').forEach(r=>r.onclick=e=>{ if(e.target.closest('input'))return; openDrawer(r.dataset.id); });
  $('#addItemRow') && ($('#addItemRow').onclick=addItem);
  $$('#timeBody .bar').forEach(bar=>{
    bar.onmousedown=e=>startDrag(e,bar);
    bar.ontouchstart=e=>startDrag(e.touches[0],bar,e);
  });
  // editable month cells: click to edit value inline
  $$('#timeBody .mcell.edit').forEach(c=>{
    c.onclick=ev=>{ ev.stopPropagation(); editMonthCell(c); };
  });
  $$('#timeBody .mcell:not(.edit)').forEach(c=>c.onclick=()=>openDrawer(c.dataset.id));
}

function editMonthCell(cell){
  const i=byId[cell.dataset.id], m=cell.dataset.m;
  const isPct=ganttMode==='pct';
  const curVal=isPct? monthPct(i,m):(i.dist_mensual[m]||0);
  const inp=document.createElement('input');
  inp.className='mcell-input'; inp.value=+curVal.toFixed(isPct?1:2);
  inp.style.left=cell.style.left; inp.style.width=Math.max(46,parseFloat(cell.style.width))+'px';
  inp.style.top=(parseFloat(cell.parentElement.style.top)+2)+'px';
  cell.parentElement.appendChild(inp); inp.focus(); inp.select();
  let done=false;
  const commit=()=>{
    if(done) return; done=true;
    inp.onblur=null; inp.onkeydown=null;
    const v=parseFloat(inp.value);
    if(inp.isConnected) inp.remove();
    if(!isNaN(v)){ isPct? setMonthPct(i,m,v):setMonthQty(i,m,v); }
    renderGantt(); if(selId===i.id) openDrawer(i.id);
  };
  inp.onblur=commit;
  inp.onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault();commit();}
    if(e.key==='Escape'){done=true;inp.onblur=null;if(inp.isConnected)inp.remove();} };
}

/* drag bar = reschedule; qty redistributed (Rule A) + cascade by dep type */
function startDrag(e,bar,ev){
  ev&&ev.preventDefault();
  const id=bar.dataset.id,i=byId[id];
  const sx=e.clientX,sLeft=parseFloat(bar.style.left);
  const move=m=>{const cx=(m.touches?m.touches[0]:m).clientX;bar.style.left=(sLeft+cx-sx)+'px';};
  const up=()=>{
    document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
    document.removeEventListener('touchmove',move);document.removeEventListener('touchend',up);
    const shift=Math.round((parseFloat(bar.style.left)-gx(i.ini))/G.pxDay);
    if(!shift){renderGantt();return;}
    const a=parseD(i.ini),b=parseD(i.fin); a.setDate(a.getDate()+shift);b.setDate(b.getDate()+shift);
    i.ini=dstr(a);i.fin=dstr(b); i._manualMonths={}; redistributeMonths(i,false); cascade(i);
    touch();renderGantt();renderKPIs();
    toast(`Ítem <b>${i.id}</b> reprogramado ${shift>0?'+':''}${shift} días`);
    if(selId===id)openDrawer(id);
  };
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  document.addEventListener('touchmove',move,{passive:false});document.addEventListener('touchend',up);
}

/* ---- add / delete items ---- */
function addItem(){
  const maxId=Math.max(0,...ITEMS.map(i=>parseInt(i.id)||0));
  const it={id:String(maxId+1),desc:'Nuevo ítem',codigo_cc:'',um:'un',cant:0,pu:0,
    get ptot(){return this.cant*this.pu;},incidencia:null,avE:null,
    ini:dstr(TODAY),fin:dstr(new Date(TODAY.getFullYear(),TODAY.getMonth()+1,TODAY.getDate())),
    estado:'Pendiente',cat:CATS[0]||'Sin categoría',dist_mensual:{},deps:[],avance_real_prod:null};
  ITEMS.push(it); reindex(); MONTHS=computeMonths();
  touch(); renderGantt(); renderKPIs(); openDrawer(it.id);
  toast('Ítem <b>'+it.id+'</b> agregado — completá los datos');
}
function deleteItem(id){
  ITEMS=ITEMS.filter(i=>i.id!==id); ITEMS.forEach(i=>{i.deps=(i.deps||[]).filter(d=>d.id!==id);});
  reindex(); MONTHS=computeMonths(); closeDrawer(); touch(); renderGantt(); renderKPIs();
  toast('Ítem eliminado');
}
/* ===================== DRAWER (scrollable, full editor) ================= */
const ESTADOS=['Pendiente','En proceso','Listo','Estancado','Eliminado'];
function openDrawer(id){
  selId=id; const i=byId[id]; if(!i){closeDrawer();return;}
  const dw=$('#drawer');
  const months=Object.keys(i.dist_mensual||{}).sort();
  const maxq=Math.max(1,...months.map(m=>i.dist_mensual[m]||0));
  const prod=PROD[i.id];
  const avProd=i.avance_real_prod!=null?i.avance_real_prod:(prod&&i.cant?Math.min(100,prod.total/i.cant*100):null);
  const wkList=WEEKLY.filter(w=>w.item_id===i.id);
  const incid = i.incidencia!=null? i.incidencia*100 : (contratoTotal()? i.ptot/contratoTotal()*100:0);

  // dependency rows
  const depRows=(i.deps||[]).map((d,k)=>{
    const p=byId[d.id];
    return `<div class="deprow" data-k="${k}">
      <select class="dep-item">${ITEMS.filter(x=>x.id!==i.id).map(x=>`<option value="${x.id}" ${x.id===d.id?'selected':''}>${x.id} · ${(x.desc||'').slice(0,26)}</option>`).join('')}</select>
      <select class="dep-type">${Object.entries(DEP_TYPES).map(([t,l])=>`<option value="${t}" ${t===d.type?'selected':''}>${t}</option>`).join('')}</select>
      <button class="dep-del" title="Quitar">×</button>
    </div>`;
  }).join('');

  // month distribution editor (mini bars with editable values)
  const monthEditor=months.length? months.map(m=>{
    const q=i.dist_mensual[m]||0; const p=monthPct(i,m);
    return `<div class="dm-row">
      <span class="dm-lab">${monthLabel(m)}</span>
      <input class="dm-qty" data-m="${m}" value="${+q.toFixed(2)}" title="Cantidad">
      <input class="dm-pct" data-m="${m}" value="${p.toFixed(1)}" title="%">
      <span class="dm-mon">${fmtGshort(q*i.pu)}</span>
    </div>`;
  }).join('') : '<div class="hint">Sin distribución. Definí fechas y cantidad.</div>';

  // previsto vs ejecutado by month (footer)
  const execByMonth={}; wkList.forEach(w=>{ if(w.month) execByMonth[w.month]=(execByMonth[w.month]||0)+(w.cant_ejecutada||0); });
  const prodByMonth={}; if(prod){ for(const[d,q]of Object.entries(prod.by_date)){const mk=d.slice(0,7);prodByMonth[mk]=(prodByMonth[mk]||0)+q;} }
  const allMonths=[...new Set([...months,...Object.keys(execByMonth),...Object.keys(prodByMonth)])].sort();
  const pеFooter=allMonths.map(m=>{
    const prev=(i.dist_mensual[m]||0); const ejec=prodByMonth[m]||execByMonth[m]||0;
    const mprev=prev*i.pu, mejec=ejec*i.pu;
    const cmp=prev?Math.min(150,ejec/prev*100):0;
    return `<div class="pe-row">
      <span class="pe-m">${monthLabel(m)}</span>
      <span class="pe-bar"><i class="prev" style="width:${prev?Math.min(100,prev/maxq*100):0}%"></i><i class="ejec ${cmp>=95?'ok':cmp>=60?'mid':'lo'}" style="width:${prev?Math.min(100,ejec/maxq*100):0}%"></i></span>
      <span class="pe-v">${fmtGshort(mprev)}<small>/${fmtGshort(mejec)}</small></span>
    </div>`;
  }).join('');

  dw.innerHTML=`
   <div class="dwrap">
    <button class="x" onclick="closeDrawer()">×</button>
    <input class="dtitle" id="dDesc" value="${(i.desc||'').replace(/"/g,'&quot;')}">
    <div class="did">ID ${i.id} · <input class="dcc" id="dCC" value="${i.codigo_cc||''}" placeholder="cód. CC"> · <input class="dum" id="dUM" value="${i.um||''}" placeholder="um"></div>

    <div class="dscroll">
      <div class="dsec">Programación</div>
      <div class="dfield"><label>Fechas (inicio – fin)</label>
        <div class="row2"><input type="date" id="dIni" value="${i.ini||''}"><input type="date" id="dFin" value="${i.fin||''}"></div></div>
      <div class="dfield"><label>Categoría</label>
        <div class="row2">
          <select id="dCat">${CATS.map(c=>`<option ${c===i.cat?'selected':''}>${c}</option>`).join('')}</select>
          <button class="minibtn" id="catMgr" title="Gestionar categorías">⚙</button>
        </div></div>
      <div class="dfield"><label>Estado</label>
        <select id="dEstado">${ESTADOS.map(s=>`<option ${i.estado===s?'selected':''}>${s}</option>`).join('')}</select></div>

      <div class="dsec">Dependencias
        <button class="adddep" id="addDep">＋ dependencia</button></div>
      <div id="depBox">${depRows||'<div class="hint">Sin dependencias</div>'}</div>
      <div class="hint" style="margin-top:4px">FS Fin→Inicio · SS Inicio→Inicio · FF Fin→Fin · SF Inicio→Fin</div>

      <div class="dsec">Cantidad, precio e incidencia</div>
      <div class="dgrid2">
        <div class="dfield"><label>Cantidad contrato</label><input type="number" id="dCant" value="${i.cant}"></div>
        <div class="dfield"><label>Precio unitario (Gs)</label><input type="number" id="dPu" value="${i.pu}"></div>
      </div>
      <div class="dcalc">
        <div class="cl"><span>Precio total</span><b id="dMonto">${fmtG(i.ptot)}</b></div>
        <div class="cl"><span>Incidencia</span><b id="dIncid">${incid.toFixed(2)}%</b></div>
        <div class="cl"><span>Avance esperado (cronograma)</span><b>${i.avE!=null?pct(i.avE):'—'}</b></div>
        <div class="cl"><span>Avance real (producción)</span><b style="color:var(--tape)">${avProd!=null?pct(avProd):'—'}</b></div>
      </div>

      <div class="dsec">Distribución mensual <span class="hint" style="text-transform:none;letter-spacing:0">cant · % · monto</span></div>
      <div class="dm-editor">${monthEditor}</div>
      <div class="hint" style="margin-top:5px">Editá cantidad o %. Los meses no fijados se reparten por días (Regla A).</div>

      ${prod?`<div class="dsec">Producción diaria (liberaciones)</div>
      <div class="dcalc"><div class="cl"><span>Total ejecutado</span><b>${fmtN(prod.total)} ${i.um||''}</b></div>
      <div class="cl"><span>Días con registro</span><b>${Object.keys(prod.by_date).length}</b></div></div>
      <div class="dspark" id="dSpark"></div>`:''}

      <div class="dsec">Previsto vs Ejecutado por mes <span class="hint" style="text-transform:none;letter-spacing:0">Gs</span></div>
      <div class="pe-box">${pеFooter||'<div class="hint">Sin datos mensuales</div>'}</div>
      <div class="pe-legend"><span><i class="prev"></i>Previsto</span><span><i class="ejec"></i>Ejecutado</span></div>

      <div class="dsec">Vínculos</div>
      <div class="hint">${wkList.length} actividad${wkList.length===1?'':'es'} en plan semanal · ${(i.deps||[]).length} dependencia${(i.deps||[]).length===1?'':'s'}</div>

      <div class="dactions">
        <button class="dsave" id="dSave">Guardar cambios</button>
        <button class="ddel" id="dDel">Eliminar ítem</button>
      </div>
    </div>
   </div>`;
  dw.classList.add('open');

  // live recompute price total + incidencia
  const recompute=()=>{
    const c=+$('#dCant').value||0,p=+$('#dPu').value||0;
    $('#dMonto').textContent=fmtG(c*p);
    const others=ITEMS.filter(x=>x.id!==i.id).reduce((s,x)=>s+x.ptot,0);
    const tot=others+c*p; $('#dIncid').textContent=(tot?c*p/tot*100:0).toFixed(2)+'%';
  };
  $('#dCant').oninput=recompute; $('#dPu').oninput=recompute;

  // inline month qty/pct editing inside drawer
  $$('#dwrap .dm-qty, .dm-editor .dm-qty').forEach(inp=>inp.onchange=e=>{
    setMonthQty(i,e.target.dataset.m,+e.target.value||0); renderGantt(); openDrawer(id);
  });
  $$('.dm-editor .dm-pct').forEach(inp=>inp.onchange=e=>{
    setMonthPct(i,e.target.dataset.m,+e.target.value||0); renderGantt(); openDrawer(id);
  });

  // dependency add/edit/remove
  $('#addDep').onclick=()=>{ i.deps=i.deps||[]; const first=ITEMS.find(x=>x.id!==i.id);
    if(first){i.deps.push({id:first.id,type:'FS'}); openDrawer(id);} };
  $$('#depBox .deprow').forEach(rw=>{
    const k=+rw.dataset.k;
    rw.querySelector('.dep-item').onchange=e=>{i.deps[k].id=e.target.value;};
    rw.querySelector('.dep-type').onchange=e=>{i.deps[k].type=e.target.value;};
    rw.querySelector('.dep-del').onclick=()=>{i.deps.splice(k,1);openDrawer(id);};
  });

  // category manager
  $('#catMgr').onclick=()=>openCatManager(id);

  if(prod) drawSpark(prod.by_date);

  $('#dSave').onclick=()=>{
    i.desc=$('#dDesc').value; i.codigo_cc=$('#dCC').value; i.um=$('#dUM').value;
    i.ini=$('#dIni').value; i.fin=$('#dFin').value;
    i.cat=$('#dCat').value; i.estado=$('#dEstado').value;
    i.cant=+$('#dCant').value||0; i.pu=+$('#dPu').value||0;
    MONTHS=computeMonths(); redistributeMonths(i); cascade(i);
    touch(); renderGantt(); renderKPIs(); toast(`Ítem <b>${i.id}</b> guardado`); openDrawer(id);
  };
  $('#dDel').onclick=()=>{ if(confirm(`¿Eliminar el ítem ${i.id} — ${i.desc}?`)) deleteItem(id); };
}
window.closeDrawer=()=>{selId=null;$('#drawer').classList.remove('open');renderGantt();};

function drawSpark(byDate){
  const el=$('#dSpark'); if(!el)return;
  const entries=Object.entries(byDate).sort(); const mx=Math.max(...entries.map(([,q])=>q),1);
  const W=el.clientWidth||330,H=44,n=entries.length,bw=Math.max(2,(W-2)/n-1);
  el.innerHTML=`<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`+
    entries.map(([d,q],k)=>{const h=Math.max(2,q/mx*(H-6));return `<rect x="${k*(bw+1)+1}" y="${H-h}" width="${bw}" height="${h}" fill="#c99a00" rx="1"><title>${d}: ${fmtN(q)}</title></rect>`;}).join('')+`</svg>`;
}

/* ---- category manager modal ---- */
function openCatManager(returnId){
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Categorías</h3>
    <div id="catList">${CATS.map((c,k)=>`<div class="catrow"><input value="${c}" data-k="${k}"><button class="cat-del" data-k="${k}">×</button></div>`).join('')}</div>
    <button class="minibtn wide" id="catAdd">＋ Nueva categoría</button>
    <button class="dsave" id="catSave">Guardar</button>
  </div>`;
  m.classList.add('open');
  $('#catAdd').onclick=()=>{CATS.push('Nueva categoría');openCatManager(returnId);};
  $$('#catList .cat-del').forEach(b=>b.onclick=()=>{const k=+b.dataset.k;
    const used=ITEMS.some(i=>i.cat===CATS[k]);
    if(used){alert('Categoría en uso por ítems. Reasignalos primero.');return;}
    CATS.splice(k,1);openCatManager(returnId);});
  $('#catSave').onclick=()=>{
    const inputs=$$('#catList input'); const old=CATS.slice();
    CATS=inputs.map(inp=>inp.value.trim()).filter(Boolean);
    // propagate renames by position
    old.forEach((o,k)=>{ if(CATS[k]&&CATS[k]!==o) ITEMS.forEach(i=>{if(i.cat===o)i.cat=CATS[k];}); });
    if(!CATS.length)CATS=['Sin categoría'];
    touch('cats'); closeModal(); renderGantt(); if(returnId)openDrawer(returnId);
  };
}
window.closeModal=()=>{$('#modal').classList.remove('open');};
/* ===================== KPIs ============================================ */
function renderKPIs(){
  const contrato=contratoTotal();
  const tm=TODAY.toISOString().slice(0,7);
  let planTo=0,planTot=0,prod=0;
  ITEMS.forEach(i=>{
    for(const[m,q]of Object.entries(i.dist_mensual||{})){planTot+=q*i.pu;if(m<=tm)planTo+=q*i.pu;}
    const ap=i.avance_real_prod!=null?i.avance_real_prod:0; prod+=i.ptot*(ap/100);
  });
  const avPlan=planTot?planTo/planTot*100:0, avProd=contrato?prod/contrato*100:0;
  const wk=WEEKS[wkIndex];
  const K=[
    ['Monto contrato',fmtG(contrato),'tape',ITEMS.length+' ítems'],
    ['Monto producido',fmtG(prod),'cyan','avance físico real'],
    ['Avance planeado',pct(avPlan),'plan','a la fecha'],
    ['Avance producido',pct(avProd),'','físico'],
    ['Brecha',(avProd-avPlan>=0?'+':'')+(avProd-avPlan).toFixed(1)+'%',avProd-avPlan>=0?'pos':'neg',avProd-avPlan>=0?'adelantado':'atrasado'],
    ['Actividades semana',String(WEEKLY.filter(w=>w.week===wk).length),'',(wk||'—').replace('-',' ')],
  ];
  $('#kpiStrip').innerHTML=K.map(([l,v,c,s])=>{
    const cls=c==='tape'?'tape':c==='cyan'?'cyan':c==='plan'?'plan':'';
    const gap=(l==='Brecha')?c:'';
    return `<div class="kpi"><div class="lab">${l}</div><div class="val ${cls} ${gap}">${v}</div><div class="sub">${s}</div></div>`;
  }).join('');
}

/* ===================== WEEKLY (all project weeks) ====================== */
const CAUSES=['Sin observaciones','Falta de pagos','Falta de Flete','Falta de Equipos','Tiempo/Lluvias','Falta de personal','Otro'];
function allProjectWeeks(){
  // build every ISO week between project min start and max fin
  let min=null,max=null;
  ITEMS.forEach(i=>{const a=parseD(i.ini),b=parseD(i.fin);if(a&&(!min||a<min))min=a;if(b&&(!max||b>max))max=b;});
  if(!min||!max) return WEEKS;
  const weeks=[]; let c=new Date(min); const dow=c.getDay()||7; c.setDate(c.getDate()-dow+1);
  while(c<=max){const iy=c.getFullYear();const t=new Date(c);const d=t.getDay()||7;t.setDate(t.getDate()+4-d);
    const ys=new Date(t.getFullYear(),0,1);const wn=Math.ceil(((t-ys)/86400000+1)/7);
    weeks.push(`${t.getFullYear()}-W${String(wn).padStart(2,'0')}`);c.setDate(c.getDate()+7);}
  return [...new Set(weeks)];
}
let ALLWEEKS=allProjectWeeks();
if(!ALLWEEKS.includes(WEEKS[wkIndex])) { /* keep */ }
function isoWeekRange(wk){
  if(!wk)return''; const[y,w]=wk.split('-W').map(Number);
  const simple=new Date(y,0,1+(w-1)*7);const dow=simple.getDay()||7;const mon=new Date(simple);mon.setDate(simple.getDate()-dow+1);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);
  const f=d=>d.getDate()+'/'+(d.getMonth()+1);return f(mon)+' – '+f(sun);
}
function defaultWeekIdx(){
  const withData=new Set(WEEKLY.map(w=>w.week));
  // preferir la semana actual si existe, si no la última con datos
  const t=new Date(); const dow=(t.getDay()||7); const mon=new Date(t); mon.setDate(t.getDate()-dow+1);
  const thu=new Date(mon); thu.setDate(mon.getDate()+3);
  const ys=new Date(thu.getFullYear(),0,1);
  const wn=Math.ceil(((thu-ys)/86400000+1)/7);
  const cur=`${thu.getFullYear()}-W${String(wn).padStart(2,'0')}`;
  const ci=ALLWEEKS.indexOf(cur); if(ci>=0) return ci;
  for(let k=ALLWEEKS.length-1;k>=0;k--){if(withData.has(ALLWEEKS[k]))return k;}
  return Math.max(0,ALLWEEKS.length-1);
}
let weeklyIdx=defaultWeekIdx();
/* helper: which month does an ISO week mostly fall in (for monthly linkage) */
function weekMonthKey(wk){
  if(!wk)return null; const[y,n]=wk.split('-W').map(Number);
  const simple=new Date(y,0,1+(n-1)*7);const dow=simple.getDay()||7;const mon=new Date(simple);mon.setDate(simple.getDate()-dow+1);
  const thu=new Date(mon);thu.setDate(mon.getDate()+3);            // ISO week belongs to the month of its Thursday
  return thu.toISOString().slice(0,7);
}
function weekMondaySunday(wk){
  const[y,n]=wk.split('-W').map(Number);
  const simple=new Date(y,0,1+(n-1)*7);const dow=simple.getDay()||7;const mon=new Date(simple);mon.setDate(simple.getDate()-dow+1);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);return[mon,sun];
}
/* sum of what's already planned (previsto) across ALL weeks of a given month for an item */
function plannedInMonth(itemId, monthKey){
  return WEEKLY.filter(w=>w.item_id===itemId && weekMonthKey(w.week)===monthKey)
    .reduce((s,w)=>s+(w.cant_prevista||0),0);
}

function renderWeekly(){
  const wk=ALLWEEKS[weeklyIdx];
  $('#wkLab').textContent=wk?isoWeekRange(wk):'—';
  $('#wkRange').textContent=wk?(wk.split('-')[1]+' · '+wk.split('-')[0]):'';
  const mKey=weekMonthKey(wk);
  const fr=$('#frenteFilter'); const frentes=[...new Set(WEEKLY.map(w=>w.frente).filter(Boolean))].sort();
  if(fr.options.length<=1) frentes.forEach(f=>fr.add(new Option(f,f)));
  const frFilter=fr.value;
  let rows=WEEKLY.filter(w=>w.week===wk&&(!frFilter||w.frente===frFilter));

  /* ---- monthly balance panel: items with a monthly plan for this month ---- */
  const monthItems=ITEMS.filter(i=>(i.dist_mensual||{})[mKey]>0);
  $('#wkMonth').innerHTML = monthItems.length? `
    <div class="wm-head">Plan mensual de <b>${monthLabel(mKey)}</b> — lo previsto en semanas se descuenta del saldo</div>
    <div class="wm-grid">${monthItems.map(i=>{
      const planM=i.dist_mensual[mKey]||0;
      const usado=plannedInMonth(i.id,mKey);
      const saldo=planM-usado;
      const pctUsed=planM?Math.min(100,usado/planM*100):0;
      const sc=saldo<-0.01?'over':saldo<planM*0.02?'full':'';
      return `<div class="wm-card ${sc}" data-id="${i.id}" title="Clic para agregar a esta semana">
        <div class="wm-t">${i.id} · ${(i.desc||'').slice(0,26)}</div>
        <div class="wm-bar"><i style="width:${pctUsed}%"></i></div>
        <div class="wm-n"><span>plan ${fmtN(planM,0)}</span><b>saldo ${fmtN(saldo,0)} ${i.um||''}</b></div>
      </div>`;
    }).join('')}</div>` : `<div class="wm-empty">Sin ítems con plan mensual en ${wk?monthLabel(mKey):'—'}. Definí la distribución mensual en el cronograma.</div>`;

  let tp=0,te=0,mp=0,me=0,done=0;
  $('#wkBody').innerHTML=rows.map((w,k)=>{
    const it=byId[w.item_id];const pu=it?it.pu:0;
    const prev=w.cant_prevista||0,ejec=w.cant_ejecutada||0;
    const cp=prev?Math.min(200,ejec/prev*100):(ejec?100:0);
    tp+=prev;te+=ejec;mp+=prev*pu;me+=ejec*pu;if(cp>=99.5)done++;
    const cls=cp>=99?'':cp>=70?'mid':'lo';
    // saldo mes for this item
    const planM=it?(it.dist_mensual||{})[mKey]||0:0;
    const usado=plannedInMonth(w.item_id,mKey);
    const saldo=planM-usado;
    const saldoCls=saldo<-0.01?'neg':'';
    const itemOpts=ITEMS.map(x=>`<option value="${x.id}" ${x.id===w.item_id?'selected':''}>${x.id} · ${(x.desc||'').slice(0,30)}</option>`).join('');
    return `<tr data-k="${k}">
      <td><select class="wk-item" data-k="${k}">${itemOpts}</select></td>
      <td><input class="wk-act" data-k="${k}" value="${(w.actividad||'').replace(/"/g,'&quot;')}" placeholder="Descripción de la actividad"></td>
      <td><input class="wk-frente" data-k="${k}" value="${(w.frente||'').replace(/"/g,'&quot;')}" placeholder="Frente"></td>
      <td class="mono">${w.um||it?.um||''}</td>
      <td class="r"><input class="qty-in" data-f="prev" data-k="${k}" value="${prev||''}"></td>
      <td class="r ejec-ro" title="Viene del formulario de liberación (no editable)">${ejec?fmtN(ejec):'—'}</td>
      <td class="r">${prev?pct(cp):'—'}</td>
      <td><select class="cause-sel" data-k="${k}">${CAUSES.map(c=>`<option ${w.causa===c?'selected':''}>${c}</option>`).join('')}</select></td>
      <td class="r ${saldoCls}">${planM?fmtN(saldo,0):'—'}</td>
      <td><button class="wk-del" data-k="${k}" title="Quitar">×</button></td>
    </tr>`;
  }).join('')||`<tr><td colspan="10" style="text-align:center;color:#8a8578;padding:20px">Sin actividades esta semana. Agregá una abajo o hacé clic en un ítem del plan mensual.</td></tr>`;
  $('#wkTotPrev').textContent=fmtN(tp);$('#wkTotEjec').textContent=fmtN(te);
  $('#wkTotPct').textContent=tp?pct(te/tp*100):'—';
  const ppc=rows.length?Math.round(done/rows.length*100):0;
  $('#ppcVal').textContent=ppc+'%';$('#ppcRing').style.setProperty('--p',ppc);
  $('#ppcDone').textContent=done;$('#ppcPlan').textContent=rows.length;
  $('#ppcMonto').textContent=mp?pct(me/mp*100).replace('%','')+'% · '+fmtG(me):'₲ 0';

  /* ---- bindings ---- */
  // previsto editable
  $$('#wkBody .qty-in').forEach(inp=>inp.onchange=e=>{
    rows[+e.target.dataset.k].cant_prevista=+e.target.value||0; rows[+e.target.dataset.k]._man=true; touch('weekly'); renderWeekly(); renderKPIs();
  });
  // item change -> relink + pull um from monthly item
  $$('#wkBody .wk-item').forEach(s=>s.onchange=e=>{
    const w=rows[+e.target.dataset.k]; w.item_id=e.target.value; const it=byId[w.item_id];
    if(it){ w.um=it.um; if(!w.actividad) w.actividad=it.desc; }
    touch('weekly'); renderWeekly();
  });
  $$('#wkBody .wk-act').forEach(inp=>inp.onchange=e=>{rows[+e.target.dataset.k].actividad=e.target.value;touch('weekly');});
  $$('#wkBody .wk-frente').forEach(inp=>inp.onchange=e=>{rows[+e.target.dataset.k].frente=e.target.value;touch('weekly');});
  $$('#wkBody .cause-sel').forEach(s=>s.onchange=e=>{rows[+e.target.dataset.k].causa=e.target.value;touch('weekly');});
  $$('#wkBody .wk-del').forEach(btn=>btn.onclick=e=>{
    const w=rows[+e.target.dataset.k]; if(w.plan_id) deletedWeekly.push(w.plan_id); WEEKLY=WEEKLY.filter(x=>x!==w); touch('weekly'); renderWeekly(); renderKPIs();
  });
  // monthly card click -> add that item to this week with remaining saldo
  $$('#wkMonth .wm-card').forEach(c=>c.onclick=()=>addWeeklyActivity(c.dataset.id));
}

/* add a weekly activity; if itemId given, seed with the item's remaining monthly saldo */
function addWeeklyActivity(itemId){
  const wk=ALLWEEKS[weeklyIdx]; if(!wk){toast('Elegí una semana primero');return;}
  const mKey=weekMonthKey(wk);
  const it = itemId? byId[itemId] : ITEMS[0];
  let seedPrev=0;
  if(it){ const planM=(it.dist_mensual||{})[mKey]||0; const usado=plannedInMonth(it.id,mKey); seedPrev=Math.max(0,+(planM-usado).toFixed(2)); }
  WEEKLY.push({
    item_id: it?it.id:(ITEMS[0]&&ITEMS[0].id),
    actividad: it?it.desc:'', frente:'', um: it?it.um:'',
    week: wk, month: mKey,
    cant_prevista: seedPrev, cant_ejecutada: null,
    causa:'Sin observaciones', _man:true,
  });
  touch('weekly'); renderWeekly(); renderKPIs();
  toast(it?`Actividad de <b>${it.id}</b> agregada · saldo del mes: ${fmtN(seedPrev,0)} ${it.um||''}`:'Actividad agregada');
}
function updateProduction(){
  // In production: re-fetch liberación sheet via Apps Script, re-aggregate by day->week->item.
  // Here: re-derive weekly executed from PROD.by_date for the shown scope.
  let touched=0;
  WEEKLY.forEach(w=>{
    const it=byId[w.item_id]; if(!it||!PROD[w.item_id])return;
    // sum production days that fall inside this week
    const wk=w.week; if(!wk)return; const[y,n]=wk.split('-W').map(Number);
    const simple=new Date(y,0,1+(n-1)*7);const dow=simple.getDay()||7;const mon=new Date(simple);mon.setDate(simple.getDate()-dow+1);
    const sun=new Date(mon);sun.setDate(mon.getDate()+6);
    let sum=0; for(const[d,q]of Object.entries(PROD[w.item_id].by_date)){const dt=parseD(d);if(dt>=mon&&dt<=sun)sum+=q;}
    if(sum>0){w.cant_ejecutada=+sum.toFixed(2);touched++;}
  });
  touch(); renderWeekly(); renderKPIs();
  toast(`Producción actualizada · <b>${touched}</b> registros desde liberación`);
}

/* ===================== REPORT ========================================== */
function renderReport(){
  const contrato=contratoTotal();
  const planM={}; MONTHS.forEach(m=>planM[m]=0);
  ITEMS.forEach(i=>{for(const[m,q]of Object.entries(i.dist_mensual||{}))if(planM[m]!=null)planM[m]+=q*i.pu;});
  let cum=0;const planCurve=MONTHS.map(m=>{cum+=planM[m];return cum/contrato*100;});
  const nowIdx=MONTHS.findIndex(m=>m>TODAY.toISOString().slice(0,7));
  const cutoff=nowIdx<0?MONTHS.length:nowIdx;
  const planToDate=planCurve[cutoff-1]||0.0001;
  const prodTotal=ITEMS.reduce((s,i)=>s+(i.avance_real_prod!=null?i.ptot*i.avance_real_prod/100:0),0);
  const certTotal=ITEMS.reduce((s,i)=>s+(i.avE!=null?i.ptot*i.avE/100:0),0);
  const prodNow=prodTotal/contrato*100,certNow=certTotal/contrato*100;
  const prodCurve=MONTHS.map((m,k)=>k<cutoff?planCurve[k]*(prodNow/planToDate):null);
  const certCurve=MONTHS.map((m,k)=>k<cutoff?planCurve[k]*(certNow/planToDate):null);

  const W=800,H=230,padL=34,padR=52,padT=12,padB=26;
  const xs=k=>padL+k*(W-padL-padR)/(MONTHS.length-1||1);
  const ymax=Math.ceil(Math.max(40,...planCurve)/10)*10;
  const ys=v=>H-padB-(v/ymax)*(H-padT-padB);
  const line=(arr,col,dash='')=>{
    const pts=arr.map((v,k)=>v==null?null:[xs(k),ys(v),v]).filter(Boolean);if(!pts.length)return'';
    const poly=pts.map(p=>`${p[0]},${p[1]}`).join(' ');const last=pts[pts.length-1];
    return `<polyline points="${poly}" fill="none" stroke="${col}" stroke-width="2.6" ${dash?'stroke-dasharray="5 4"':''} stroke-linejoin="round"/>`
      +pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="2.4" fill="${col}"/>`).join('')
      +`<g><rect x="${last[0]+5}" y="${last[1]-9}" width="46" height="17" rx="4" fill="${col}"/><text x="${last[0]+28}" y="${last[1]+3}" text-anchor="middle" font-size="11" font-weight="700" fill="#04151f" font-family="var(--mono)">${last[2].toFixed(1)}%</text></g>`;
  };
  let yaxis='';for(let v=0;v<=ymax;v+=(ymax<=30?5:10)){yaxis+=`<line x1="${padL}" y1="${ys(v)}" x2="${W-padR}" y2="${ys(v)}" stroke="#d8d2c4" stroke-width=".8"/><text x="${padL-6}" y="${ys(v)+3}" text-anchor="end" font-size="9" fill="#8a8578" font-family="var(--mono)">${v}%</text>`;}
  let xaxis='';MONTHS.forEach((m,k)=>{if(k%2===0)xaxis+=`<text x="${xs(k)}" y="${H-8}" text-anchor="middle" font-size="8.5" fill="#8a8578">${monthLabel(m)}</text>`;});
  const hoyX=xs(cutoff-1);
  $('#curveSvg').innerHTML=yaxis+xaxis
    +`<line x1="${hoyX}" y1="${padT}" x2="${hoyX}" y2="${H-padB}" stroke="#d64545" stroke-width="1.4" stroke-dasharray="3 3"/><rect x="${hoyX-16}" y="${padT-2}" width="32" height="14" rx="3" fill="#d64545"/><text x="${hoyX}" y="${padT+8}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">HOY</text>`
    +line(planCurve,'#3a6ea5')+line(certCurve,'#178a8a','dash')+line(prodCurve,'#c99a00');
  $('#repRange').textContent=monthLabel(MONTHS[0])+' → '+monthLabel(MONTHS[MONTHS.length-1]);

  const win=MONTHS.slice(Math.max(0,cutoff-6),cutoff+2);
  const realM={};ITEMS.forEach(i=>{const f=i.avance_real_prod!=null?i.avance_real_prod/100:0;for(const[m,q]of Object.entries(i.dist_mensual||{}))realM[m]=(realM[m]||0)+q*i.pu*f;});
  const maxB=Math.max(1,...win.map(m=>Math.max(planM[m]||0,realM[m]||0)));
  $('#monthBars').innerHTML=win.map(m=>{
    const pv=planM[m]||0,rv=realM[m]||0,ph=pv/maxB*100,rh=rv/maxB*100;const cmp=pv?Math.round(rv/pv*100):0;
    const cc=cmp>=95?'ok':cmp>=70?'mid':'lo';
    return `<div class="bmonth" title="${monthLabel(m)} · Plan ${fmtGshort(pv)} / Real ${fmtGshort(rv)}">
      <div class="cmp-lab ${cc}">${pv?cmp+'%':'—'}</div>
      <div class="stack"><div class="bp" style="height:${ph}%"><span>${fmtGshort(pv)}</span></div><div class="br" style="height:${rh}%"><span>${fmtGshort(rv)}</span></div></div>
      <div class="ml">${monthLabel(m)}</div></div>`;
  }).join('');

  const cnt={};WEEKLY.forEach(w=>{const prev=w.cant_prevista||0,ej=w.cant_ejecutada||0;if(prev>0&&ej<prev*0.99){const c=w.causa||'Sin observaciones';if(c!=='Sin observaciones')cnt[c]=(cnt[c]||0)+1;}});
  const pe=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,6);const tot=pe.reduce((s,[,v])=>s+v,0)||1;const mx=pe.length?pe[0][1]:1;
  $('#paretoBox').innerHTML=pe.length?pe.map(([c,v])=>`<div class="pareto-row"><span class="pl">${c}</span><span class="pb"><i style="width:${v/mx*100}%"></i></span><span class="pv">${v} · ${Math.round(v/tot*100)}%</span></div>`).join(''):'<span class="hint">Sin incumplimientos registrados</span>';

  $('#repBody').innerHTML=ITEMS.map(i=>{
    const av=i.avance_real_prod;const brecha=(av!=null&&i.avE!=null)?av-i.avE:null;const bc=brecha==null?'':brecha>=0?'pos':'neg';
    return `<tr><td class="itemid">${i.id}</td><td>${i.desc||''}</td><td class="mono">${i.um||''}</td>
      <td class="r">${fmtN(i.cant)}</td><td class="r">${fmtN(i.ptot,0)}</td>
      <td class="r">${av!=null?pct(av):'—'}</td><td class="r">${i.avE!=null?pct(i.avE):'—'}</td>
      <td class="r ${bc}">${brecha==null?'—':(brecha>=0?'+':'')+brecha.toFixed(1)+'%'}</td></tr>`;
  }).join('');
}

/* ===================== BASELINES UI ==================================== */
function renderBaselineControls(){
  const sel=$('#blSel'); if(!sel)return;
  sel.innerHTML='<option value="">Sin comparar</option>'+BASELINES.map(b=>`<option value="${b.id}" ${b.id===activeBaseline?'selected':''}>${b.name} (${b.date})</option>`).join('');
}

/* ===================== NAV / INIT ===================================== */
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $$('#tabs button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  $$('.view').forEach(v=>v.classList.remove('on'));$('#v-'+b.dataset.v).classList.add('on');
  if(b.dataset.v==='report')renderReport(); if(b.dataset.v==='weekly')renderWeekly();});
$('#ganttMode').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $$('#ganttMode button').forEach(x=>x.classList.remove('on'));b.classList.add('on');ganttMode=b.dataset.m;renderGantt();});
$('#catFilter').onchange=e=>{catFilter=e.target.value;renderGantt();};
$('#showBase').onchange=renderGantt;
$('#critBtn').onclick=()=>{showCrit=!showCrit;$('#critBtn').classList.toggle('active',showCrit);renderGantt();};
$('#blSel')&&($('#blSel').onchange=e=>{activeBaseline=e.target.value||null;$('#showBase').checked=!!activeBaseline;renderGantt();});
$('#blSave')&&($('#blSave').onclick=()=>{const n=prompt('Nombre de la línea base:','Línea base '+(BASELINES.length+1));if(n!==null){const b=snapshotBaseline(n);activeBaseline=b.id;renderBaselineControls();$('#showBase').checked=true;renderGantt();toast('Línea base <b>'+b.name+'</b> guardada (fechas + cantidades por mes)');}});
$('#wkPrev').onclick=()=>{if(weeklyIdx>0){weeklyIdx--;renderWeekly();}};
$('#wkNext').onclick=()=>{if(weeklyIdx<ALLWEEKS.length-1){weeklyIdx++;renderWeekly();}};
$('#frenteFilter').onchange=renderWeekly;
$('#wkAddRow')&&($('#wkAddRow').onclick=()=>addWeeklyActivity(null));
$('#updateProd')&&($('#updateProd').onclick=updateProduction);

/* scroll sync */
(function(){const gs=$('#gridScroll'),ts=$('#timeScroll'),th=$('#timeHead');let lock=false;
  ts.addEventListener('scroll',()=>{if(lock)return;lock=true;gs.scrollTop=ts.scrollTop;th.scrollLeft=ts.scrollLeft;lock=false;});
  gs.addEventListener('scroll',()=>{if(lock)return;lock=true;ts.scrollTop=gs.scrollTop;lock=false;});})();

/* PWA */
let deferred=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').classList.add('show');});
$('#installBtn').onclick=async()=>{if(deferred){deferred.prompt();await deferred.userChoice;deferred=null;$('#installBtn').classList.remove('show');}};
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}

/* ---- botones de carga de datos (se enganchan en boot, cuando carga.js ya existe) ---- */
function bindCarga(){
  $('#btnNuevaObra')&&($('#btnNuevaObra').onclick=openNuevaObra);
  $('#btnPegarItems')&&($('#btnPegarItems').onclick=openPegarItems);
  $('#btnPegarMensual')&&($('#btnPegarMensual').onclick=openPegarMensual);
  $('#obraSel')&&($('#obraSel').onchange=async e=>{
    if(e.target.value==='__new__'){ openNuevaObra(); await refreshObraList(); return; }
    try{ await cambiarObra(e.target.value); }catch(err){ toast('Error: '+err.message); }
  });
}

/* ===================== ARRANQUE ======================================== */
async function boot(){
  bindCarga();
  const chip=$('#saveChip');
  $('#saveTxt').textContent='Conectando…';
  try{
    const who=await ObraAPI.whoami();
    ONLINE=true;
    $('#userChip').textContent=(who.user||'anónimo')+' · '+who.role;
    $('#userChip').className='userchip role-'+who.role;
    if(who.role==='lectura') document.body.classList.add('readonly');
    await refreshObraList();
    const data=await ObraAPI.getObra();
    reloadModel(data);
    $('#saveTxt').textContent='Guardado';
    toast('Conectado · <b>'+ITEMS.length+'</b> ítems cargados desde Drive');
  }catch(err){
    ONLINE=false;
    chip.classList.add('err'); $('#saveTxt').textContent='Sin conexión';
    // modo offline: si hay data embebida la usa, si no arranca vacío
    reloadModel(window.OBRA_DATA||null);
    toast('No se pudo conectar al backend: '+err.message+' — trabajando local');
  }
}
