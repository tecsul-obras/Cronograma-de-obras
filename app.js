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

/* ---------- parser de texto pegado desde Excel ----------
   Excel copia con TAB entre columnas y \n entre filas.
   Soporta también CSV pegado (coma o punto y coma) y comillas. */
function parsePasted(text){
  const raw = String(text||'').replace(/\r\n?/g,'\n').replace(/\n+$/,'');
  if(!raw.trim()) return [];
  const lines = raw.split('\n');
  // detectar separador: TAB gana; si no, ; y luego ,
  let sep = '\t';
  if(!lines[0].includes('\t')){
    const sc=(lines[0].match(/;/g)||[]).length, cc=(lines[0].match(/,/g)||[]).length;
    sep = sc>=cc && sc>0 ? ';' : (cc>0 ? ',' : '\t');
  }
  return lines.map(line=>splitLine(line,sep));
}
function splitLine(line,sep){
  const out=[]; let cur=''; let q=false;
  for(let k=0;k<line.length;k++){
    const ch=line[k];
    if(ch==='"'){ if(q && line[k+1]==='"'){cur+='"';k++;} else q=!q; }
    else if(ch===sep && !q){ out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
/* número al estilo local: 1.234,56 (PY) o 1,234.56 (US) o 1234.56 */
/* Parseo de números como los escribe Excel en es-PY y en en-US.
   Regla clave: un separador seguido de EXACTAMENTE 3 dígitos (y sin otro
   separador decimal presente) es separador de MILES.  "1.000" = mil, no uno.
   Si querés un decimal con 3 cifras usá coma: "1,000" con formato PY. */
function parseNum(s){
  if(s==null) return 0;
  if(typeof s==='number') return s;
  let t=String(s).trim().replace(/[₲$%\s]/g,'').replace(/\u00A0/g,'');
  if(!t) return 0;
  const neg=/^\(.*\)$/.test(t)||t.startsWith('-');
  t=t.replace(/[()\-]/g,'');
  const lastC=t.lastIndexOf(','), lastD=t.lastIndexOf('.');
  if(lastC>-1 && lastD>-1){
    // hay ambos: el ÚLTIMO es el decimal
    if(lastC>lastD) t=t.replace(/\./g,'').replace(',','.');   // 1.234,56  (PY)
    else            t=t.replace(/,/g,'');                      // 1,234.56  (US)
  } else if(lastC>-1 || lastD>-1){
    const sep = lastC>-1 ? ',' : '.';
    const pos = lastC>-1 ? lastC : lastD;
    const groups=(t.match(new RegExp('\\'+sep,'g'))||[]).length;
    const dec = t.length-pos-1;
    if(groups>1 || dec===3){
      // varios separadores, o exactamente 3 dígitos detrás → MILES
      t=t.split(sep).join('');
    } else {
      // 1 ó 2 dígitos detrás (o más de 3) → decimal
      t = sep===',' ? t.replace(',','.') : t;
    }
  }
  const n=parseFloat(t);
  return isNaN(n)?0:(neg?-n:n);
}
/* fecha: dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy */
function parseFecha(s){
  if(!s) return '';
  const t=String(s).trim();
  let m=t.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m=t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(m){ let y=+m[3]; if(y<100) y+=2000;
    return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`; }
  return '';
}


function parseDepInit(txt){
  if(!txt) return [];
  return String(txt).split(',').map(s=>{
    const m=s.trim().match(/^(\d+(?:\.\d+)?)/); return m?{id:m[1],type:'FS'}:null;
  }).filter(Boolean);
}

let AUTO_WEEKS = true;   // el plan semanal se genera automáticamente desde el mensual
const EXTRA_MONTHS = new Set();   // columnas agregadas a mano (aunque estén vacías)

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

  /* El plan semanal se DERIVA del mensual. Las filas que vienen del Sheet y
     fueron editadas a mano (_man) se respetan; el resto se regenera para que
     semanas y meses siempre cuadren. */
  WEEKLY.forEach(w=>{ if(w.cant_prevista!=null && w._man===undefined) w._man=false; });
  if(AUTO_WEEKS) ITEMS.forEach(i=>syncWeeksFromMonths(i));
  WEEKS.length=0; [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort().forEach(w=>WEEKS.push(w));

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
  EXTRA_MONTHS.forEach(m=>s.add(m));
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
let saving=false;
async function flush(manual){
  const chip=$('#saveChip');
  if(!ONLINE){ chip.classList.remove('saving'); $('#saveTxt').textContent='Local'; return false; }
  if(saving){ return false; }                       // evitar guardados solapados
  if(!dirty.items && !dirty.weekly && !dirty.cats && !manual){
    chip.classList.remove('saving'); $('#saveTxt').textContent='Guardado'; return true;
  }
  saving=true;
  chip.classList.remove('err'); chip.classList.add('saving'); $('#saveTxt').textContent='Guardando…';
  try{
    // SECUENCIAL: cada save reescribe su pestaña entera; en paralelo se pisan.
    if(dirty.items || manual){
      const s=ObraAPI.serializeItems(ITEMS);
      await ObraAPI.saveItems(s.items,s.dist,s.deps);
      dirty.items=false;
    }
    if(dirty.cats || manual){ await ObraAPI.saveCategorias(CATS); dirty.cats=false; }
    if(dirty.weekly || manual){
      await ObraAPI.saveWeekly(ObraAPI.serializeWeekly(WEEKLY), deletedWeekly.splice(0));
      dirty.weekly=false;
    }
    chip.classList.remove('saving'); $('#saveTxt').textContent='Guardado';
    if(manual) toast('Guardado en Drive ✓');
    saving=false; return true;
  }catch(err){
    saving=false;
    chip.classList.remove('saving'); chip.classList.add('err');
    $('#saveTxt').textContent='Error al guardar';
    toast('No se pudo guardar: '+err.message);
    return false;
  }
}
/* aviso si te vas con cambios sin guardar */
window.addEventListener('beforeunload', e=>{
  if(ONLINE && (dirty.items||dirty.weekly||dirty.cats)){
    e.preventDefault(); e.returnValue='Hay cambios sin guardar.'; return e.returnValue;
  }
});
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
  if(sumDays>0) buckets.forEach(([mk,d])=>dist[mk]=+(total*d/sumDays).toFixed(3));
  i.dist_mensual=dist;
  syncWeeksFromMonths(i);            // el mensual manda: regenerar semanas
}

/* ---------- SINCRONIZACIÓN INVERSA: cantidades por mes → fechas ----------
   Al cargar/editar la distribución mensual, las FECHAS del ítem se ajustan al
   rango de meses con cantidad (inicio = 1er día del primer mes, fin = último
   día del último mes).

   ⚠️ LA CANTIDAD DE CONTRATO NO SE TOCA. Es un dato del contrato y solo se
   edita en su propia celda. El cronograma se COMPARA contra ella (ver la
   columna "Σ Cronograma" y el semáforo), nunca la redefine.              */
function syncDatesFromMonths(i){
  const ms=Object.keys(i.dist_mensual||{}).filter(m=>(i.dist_mensual[m]||0)>0).sort();
  if(!ms.length){ syncWeeksFromMonths(i); return; }
  const [y0,m0]=ms[0].split('-').map(Number);
  const [y1,m1]=ms[ms.length-1].split('-').map(Number);
  i.ini=dstr(new Date(y0,m0-1,1));
  i.fin=dstr(new Date(y1,m1,0));            // último día del último mes
  syncWeeksFromMonths(i);
}
/* suma de lo distribuido en el cronograma (para comparar contra el contrato) */
function sumaCronograma(i){
  return +Object.values(i.dist_mensual||{}).reduce((s,v)=>s+(v||0),0).toFixed(3);
}
/* diferencia contra el contrato: 0 = cuadra */
function difContrato(i){ return +(sumaCronograma(i)-(i.cant||0)).toFixed(3); }

/* ---------- MENSUAL → SEMANAL (generación automática) ----------
   La cantidad de cada mes se reparte entre las semanas que tocan ese mes,
   proporcional a los DÍAS de la semana que caen dentro del mes (Regla B:
   la semana es un bloque íntegro, pero su cantidad se prorratea).
   Solo se tocan las semanas AUTO: si el residente editó una a mano
   (_man = true), esa se respeta y se descuenta del reparto.            */
function syncWeeksFromMonths(item){
  if(!AUTO_WEEKS) return;
  const dist=item.dist_mensual||{};
  const meses=Object.keys(dist).filter(m=>(dist[m]||0)>0);
  // borrar las semanas AUTO de este ítem cuyo mes ya no existe
  WEEKLY=WEEKLY.filter(w=>!(w.item_id===item.id && !w._man && !meses.includes(w.month)));

  meses.forEach(mk=>{
    const totalMes=dist[mk]||0;
    const semanas=weeksOfMonth(mk);                        // [{wk, dias}]
    if(!semanas.length) return;
    // semanas ya existentes de este ítem en ese mes
    const exist={}; WEEKLY.forEach(w=>{ if(w.item_id===item.id && w.month===mk) exist[w.week]=w; });
    // lo que el residente fijó a mano se respeta y se descuenta
    let manualSum=0, diasAuto=0;
    semanas.forEach(s=>{
      const w=exist[s.wk];
      if(w && w._man) manualSum+=(w.cant_prevista||0); else diasAuto+=s.dias;
    });
    const resto=Math.max(0,totalMes-manualSum);
    semanas.forEach(s=>{
      const w=exist[s.wk];
      if(w && w._man) return;                              // respetada
      const qty = diasAuto>0 ? +(resto*s.dias/diasAuto).toFixed(3) : 0;
      if(w){ w.cant_prevista=qty; w.um=item.um; }
      else if(qty>0){
        WEEKLY.push({ item_id:item.id, actividad:item.desc, frente:'', um:item.um,
          week:s.wk, month:mk, cant_prevista:qty, cant_ejecutada:null,
          causa:'Sin observaciones', _man:false, _auto:true });
      }
    });
  });
  WEEKS.length=0; [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort().forEach(w=>WEEKS.push(w));
}

/* semanas ISO que tocan un mes, con cuántos días de cada una caen dentro */
function weeksOfMonth(mk){
  const [y,m]=mk.split('-').map(Number);
  const first=new Date(y,m-1,1), last=new Date(y,m,0);
  const out={};
  for(let d=new Date(first); d<=last; d.setDate(d.getDate()+1)){
    const wk=isoWeekOf(d);
    out[wk]=(out[wk]||0)+1;
  }
  return Object.entries(out).map(([wk,dias])=>({wk,dias}));
}
function isoWeekOf(d){
  const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const day=(t.getDay()+6)%7; t.setDate(t.getDate()-day+3);
  const firstThu=new Date(t.getFullYear(),0,4);
  const fday=(firstThu.getDay()+6)%7; firstThu.setDate(firstThu.getDate()-fday+3);
  const wn=1+Math.round((t-firstThu)/(7*86400000));
  return `${t.getFullYear()}-W${String(wn).padStart(2,'0')}`;
}
/* Editar la cantidad de UN mes. No altera la cantidad de contrato. */
function setMonthQty(i, mk, val){
  i._manualMonths=i._manualMonths||{}; i._manualMonths[mk]=true;
  if(val>0) i.dist_mensual[mk]=val; else delete i.dist_mensual[mk];
  syncDatesFromMonths(i);
  touch();
}
function setMonthPct(i, mk, p){
  // el % SIEMPRE es sobre la cantidad de contrato (base fija, no circular)
  setMonthQty(i, mk, +( (i.cant||0)*p/100 ).toFixed(3));
}
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

/* ---- eje de períodos: meses o semanas (escala configurable) ---- */
let SCALE='month';          // 'month' | 'week'
/* ancho de columna por modo: el monto necesita más espacio (1.431.837.071) */
const COLW_DEF={qty:92, pct:78, money:124};
let COLW_USER={};   // si el usuario lo ajusta a mano, se respeta por modo
try{ COLW_USER=JSON.parse(localStorage.getItem('obra_colw')||'{}'); }catch(e){ COLW_USER={}; }
function colw(){ return COLW_USER[ganttMode] || COLW_DEF[ganttMode] || 92; }

function periodKeys(){
  if(SCALE==='month') return MONTHS.slice();
  // semanas: todas las ISO entre el primer y último mes con datos
  if(!MONTHS.length) return [];
  const [y0,m0]=MONTHS[0].split('-').map(Number);
  const [y1,m1]=MONTHS[MONTHS.length-1].split('-').map(Number);
  const a=new Date(y0,m0-1,1), b=new Date(y1,m1,0);
  const out=[]; const d=new Date(a); const dow=(d.getDay()||7); d.setDate(d.getDate()-dow+1);
  while(d<=b){ out.push(isoWeekOf(d)); d.setDate(d.getDate()+7); }
  return [...new Set(out)];
}
const periodLabel = p => SCALE==='month'
  ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][+p.split('-')[1]-1]
  : p.split('-W')[1];
const periodSub = p => SCALE==='month' ? p.split('-')[0] : isoWeekRange(p);
/* valor de un período para un ítem (en semanas se deriva del mensual) */
function periodQty(i,p){
  if(SCALE==='month') return i.dist_mensual[p]||0;
  const w=WEEKLY.find(w=>w.item_id===i.id && w.week===p);
  return w? (w.cant_prevista||0) : 0;
}

function renderGantt(){
  ganttDomain();
  const cats=CATS.slice().sort();
  const cf=$('#catFilter');
  cf.innerHTML='<option value="">Todas las categorías</option>'+cats.map(c=>`<option ${c===catFilter?'selected':''}>${c}</option>`).join('');
  const list=visibleItems();
  const crit=showCrit?critPath():new Set();
  const isGrid = ganttMode!=='time';
  const P = isGrid? periodKeys() : [];

  /* ---- 1) tabla de ítems ---- */
  $('#ganttGrid').innerHTML = list.map(i=>{
    const est=estadoBadge(i.estado);
    const avp=i.avance_real_prod!=null?pct(i.avance_real_prod):'—';
    return `<div class="grow-row" data-id="${i.id}">
      <div class="idc">${i.id}</div>
      <div class="descc">
        <input class="ed-desc" data-id="${i.id}" value="${(i.desc||'').replace(/"/g,'&quot;')}" placeholder="Descripción del ítem">
        <div class="rowsub"><span class="um-tag">${i.cat}</span> ${est}</div>
      </div>
      <div><input class="ed-um" data-id="${i.id}" value="${i.um||''}" placeholder="um"></div>
      <div><input class="ed-cant" data-id="${i.id}" value="${i.cant||''}" placeholder="0" title="Cantidad de contrato — solo se cambia acá"></div>
      <div class="num">${avp}</div>
    </div>`;
  }).join('') + `<div class="grow-add" id="addItemRow">＋ Agregar ítem</div>`;

  /* ---- 2) encabezado ---- */
  const totalW = isGrid ? P.length*colw() : body_w();
  if(isGrid){
    $('#timeHead').innerHTML = P.map(p=>{
      const hoy = SCALE==='month' ? p===dstr(TODAY).slice(0,7) : p===isoWeekOf(TODAY);
      return `<div class="tmonth${hoy?' now':''}" style="width:${colw()}px">${periodLabel(p)}<small>${periodSub(p)}</small></div>`;
    }).join('') + `<div class="tmonth addcol" id="addColBtn" title="Agregar período">＋</div>`;
  } else {
    const ms=[]; let cur=new Date(G.x0);
    while(cur<G.x1){const nx=new Date(cur.getFullYear(),cur.getMonth()+1,1);
      ms.push([new Date(cur),daysBetween(cur,nx)*G.pxDay]);cur=nx;}
    $('#timeHead').innerHTML = ms.map(([d,w])=>
      `<div class="tmonth" style="width:${w}px">${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]}<small>${d.getFullYear()}</small></div>`).join('');
  }
  $('#timeHead').style.width=(totalW+(isGrid?44:0))+'px';

  /* columna de verificación (solo en grilla) */
  $('#checkHead').style.display = isGrid? 'flex':'none';
  $('#checkCol').style.display  = isGrid? 'block':'none';
  document.body.classList.toggle('withcheck', isGrid);

  /* ---- 3) medir alturas y pintar ---- */
  requestAnimationFrame(()=>{
    const gridRows=[...$('#ganttGrid').querySelectorAll('.grow-row')];
    const heights=gridRows.map(r=>r.getBoundingClientRect().height);
    const tops=[]; let acc=0; heights.forEach(h=>{tops.push(acc);acc+=h;});
    const totalH=acc;

    const gl=$('#gcolLines');
    if(isGrid){ gl.innerHTML=''; }
    else {
      let cur=new Date(G.x0); const lines=[];
      while(cur<G.x1){ lines.push(`<div class="vl" style="left:${gx(cur)}px"></div>`);
        cur=new Date(cur.getFullYear(),cur.getMonth()+1,1); }
      lines.push(`<div class="vl today" style="left:${gx(TODAY)}px"></div>`);
      gl.innerHTML=lines.join('');
    }
    gl.style.width=totalW+'px'; gl.style.height=totalH+'px';

    const body=$('#timeBody');
    [...body.querySelectorAll('.trow')].forEach(e=>e.remove());
    body.style.width=(totalW+(isGrid?44:0))+'px'; body.style.height=(totalH+2)+'px';
    const showBase=$('#showBase').checked && activeBaseline;
    const bl = activeBaseline? BASELINES.find(b=>b.id===activeBaseline):null;

    let maxVal=1;
    if(isGrid) list.forEach(i=>P.forEach(p=>{
      const q=periodQty(i,p); if(!q) return;
      const v = ganttMode==='money'? q*i.pu : (ganttMode==='pct'? (i.cant? q/i.cant*100:0) : q);
      if(v>maxVal) maxVal=v;
    }));

    list.forEach((i,idx)=>{
      const row=document.createElement('div');
      row.className='trow'+(i.id===selId?' sel':'');
      row.style.top=tops[idx]+'px'; row.style.height=heights[idx]+'px';
      row.style.width=(totalW+(isGrid?44:0))+'px';
      const critc=crit.has(i.id)?' crit':'';

      if(!isGrid){
        const a=parseD(i.ini),b=parseD(i.fin);
        if(a&&b){
          const x=gx(i.ini),w=Math.max(6,daysBetween(a,b)*G.pxDay);
          const av=i.avance_real_prod!=null?i.avance_real_prod:0;
          const baseHtml=(showBase&&bl&&bl.items[i.id]&&bl.items[i.id].ini)?
            `<div class="bar-base" style="left:${gx(bl.items[i.id].ini)}px;width:${Math.max(6,daysBetween(parseD(bl.items[i.id].ini),parseD(bl.items[i.id].fin))*G.pxDay)}px"></div>`:'';
          row.innerHTML=`${baseHtml}<div class="bar${critc}" data-id="${i.id}" style="left:${x}px;width:${w}px">
            <div class="fill" style="width:${av}%"></div><div class="lbl">${(i.desc||'').slice(0,30)}</div></div>`;
        }
      } else {
        const editable = (ganttMode==='qty'||ganttMode==='pct') && SCALE==='month';
        row.innerHTML = P.map((p,c)=>{
          const q=periodQty(i,p);
          const val = ganttMode==='money'? q*i.pu : (ganttMode==='pct'? (i.cant? q/i.cant*100:0) : q);
          const lab = q ? (ganttMode==='money' ? fmtMoneyCell(val)
                        : ganttMode==='pct'   ? val.toFixed(1)+'%'
                        : fmtQty(q)) : '';
          const inR = i.ini&&i.fin && (SCALE==='month'
            ? (p>=String(i.ini).slice(0,7) && p<=String(i.fin).slice(0,7)) : true);
          const fill = q&&maxVal? Math.min(1,val/maxVal):0;
          return `<div class="gcell${editable?' edit':''}${q?' has':''}${inR?' inrange':''}"
            data-id="${i.id}" data-m="${p}"
            style="left:${c*colw()}px;width:${colw()-1}px;--fill:${fill.toFixed(3)}"
            title="${SCALE==='month'?monthLabel(p):p} · ${fmtN(q)} ${i.um||''} · ${(i.cant?q/i.cant*100:0).toFixed(1)}% · ${fmtG(q*i.pu)}"
          ><span class="gv">${lab}</span></div>`;
        }).join('');
      }
      body.appendChild(row);
    });

    /* ---- 4) fila de TOTALES por período (Σ monto = Σ cant × precio unit) ---- */
    let foot=$('#gridFoot');
    if(isGrid){
      if(!foot){ foot=document.createElement('div'); foot.id='gridFoot'; foot.className='gfoot'; body.appendChild(foot); }
      foot.style.top=totalH+'px'; foot.style.width=(totalW+44)+'px';
      const totals=P.map(p=>list.reduce((s,i)=>s+periodQty(i,p)*i.pu,0));
      const gran=totals.reduce((s,v)=>s+v,0);
      // si la columna es angosta, formato compacto (el completo va en el tooltip)
      const wide = colw()>=110;
      foot.innerHTML = P.map((p,c)=>
        `<div class="gfcell" style="left:${c*colw()}px;width:${colw()-1}px"
              title="${SCALE==='month'?monthLabel(p):p}: ${fmtG(totals[c])}">
           <span>${totals[c]? (wide? fmtMoneyCell(totals[c]) : fmtGshort(totals[c])) : ''}</span></div>`).join('')
        + `<div class="gfcell tot" style="left:${P.length*colw()}px;width:44px" title="Total: ${fmtG(gran)}">Σ</div>`;
      body.style.height=(totalH+34)+'px';
      $('#footLabel').style.display='flex';
      $('#footLabel').title='Suma de monto por período: Σ (cantidad × precio unitario)';
    } else {
      if(foot) foot.remove();
      $('#footLabel').style.display='none';
    }

    /* ---- 5) columna de verificación: Σ cronograma vs contrato ---- */
    if(isGrid){
      $('#checkCol').innerHTML = list.map((i,idx)=>{
        const suma=sumaCronograma(i), dif=difContrato(i);
        const ok=Math.abs(dif)<0.01;
        const cls = ok? 'ok' : (Math.abs(dif) <= (i.cant||0)*0.005 ? 'near':'bad');
        const icon= ok? '✓' : (dif>0? '▲':'▼');
        return `<div class="chk ${cls}" style="height:${heights[idx]}px"
           title="Contrato: ${fmtN(i.cant)} ${i.um||''}\nCronograma: ${fmtN(suma)}\nDiferencia: ${dif>0?'+':''}${fmtN(dif)}">
          <span class="chk-sum">${fmtQty(suma)}</span>
          <span class="chk-ic">${icon}${ok?'':' '+ (dif>0?'+':'')+fmtQty(dif)}</span>
        </div>`;
      }).join('');
      const nOk=list.filter(i=>Math.abs(difContrato(i))<0.01).length;
      $('#checkHead').innerHTML=`Σ Cronograma<small>${nOk}/${list.length} cuadran</small>`;
    }

    drawDeps(list,tops,heights);
    bindGantt();
  });
}
/* formatos de celda: completos, sin recortar */
function fmtQty(q){
  if(!q) return '';
  return Math.abs(q)>=1000 ? Math.round(q).toLocaleString('es-PY')
       : (+q.toFixed(2)).toLocaleString('es-PY');
}
function fmtMoneyCell(v){
  if(!v) return '';
  return Math.round(v).toLocaleString('es-PY');   // 125.280.320 completo
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
  $$('#ganttGrid .grow-row').forEach(r=>r.onclick=e=>{
    if(e.target.closest('input,select,button')) return;
    if(ganttMode==='time') openDrawer(r.dataset.id);
  });
  $('#addItemRow') && ($('#addItemRow').onclick=addItem);
  $('#addColBtn') && ($('#addColBtn').onclick=addPeriod);
  // edición directa en la tabla de ítems
  $$('#ganttGrid .ed-desc').forEach(inp=>inp.onchange=e=>{
    byId[e.target.dataset.id].desc=e.target.value; touch(); });
  $$('#ganttGrid .ed-um').forEach(inp=>inp.onchange=e=>{
    byId[e.target.dataset.id].um=e.target.value; touch(); renderGantt(); });
  $$('#ganttGrid .ed-cant').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; i.cant=parseNum(e.target.value);
    // solo cambia el contrato. La distribución del cronograma queda como está;
    // el semáforo de la derecha muestra si cuadra o no.
    touch(); renderGantt(); renderKPIs(); });
  // doble clic en la fila abre el panel completo
  $$('#ganttGrid .grow-row').forEach(r=>r.ondblclick=()=>openDrawer(r.dataset.id));
  $$('#timeBody .bar').forEach(bar=>{
    bar.onmousedown=e=>startDrag(e,bar);
    bar.ontouchstart=e=>startDrag(e.touches[0],bar,e);
  });
  bindGridCells();
}

/* =======================================================================
   GRILLA TIPO EXCEL para las vistas Cantidad / Porcentaje / Monto
   · clic = seleccionar · shift+clic o arrastre = rango
   · flechas = moverse · Enter/F2 o escribir = editar
   · Ctrl+C / Ctrl+V = copiar y pegar (compatible con Excel)
   · Delete = borrar · Ctrl+A = todo
   ======================================================================= */
const SEL = { anchor:null, focus:null, editing:false };   // {r,c} índices
let GRIDMAP = { rows:[], cols:[] };                        // ids visibles

function cellAt(r,c){
  if(r<0||c<0||r>=GRIDMAP.rows.length||c>=GRIDMAP.cols.length) return null;
  return document.querySelector(`#timeBody .gcell[data-id="${GRIDMAP.rows[r]}"][data-m="${GRIDMAP.cols[c]}"]`);
}
function selRange(){
  if(!SEL.anchor||!SEL.focus) return null;
  return { r0:Math.min(SEL.anchor.r,SEL.focus.r), r1:Math.max(SEL.anchor.r,SEL.focus.r),
           c0:Math.min(SEL.anchor.c,SEL.focus.c), c1:Math.max(SEL.anchor.c,SEL.focus.c) };
}
function paintSel(){
  $$('#timeBody .gcell').forEach(c=>c.classList.remove('sel','focus'));
  const R=selRange(); if(!R) return;
  for(let r=R.r0;r<=R.r1;r++) for(let c=R.c0;c<=R.c1;c++){
    const el=cellAt(r,c); if(el) el.classList.add('sel');
  }
  const f=cellAt(SEL.focus.r,SEL.focus.c); if(f){ f.classList.add('focus'); scrollIntoView(f); }
}
function scrollIntoView(el){
  const sc=$('#timeScroll'); if(!sc||!el) return;
  const er=el.getBoundingClientRect(), sr=sc.getBoundingClientRect();
  if(er.left<sr.left) sc.scrollLeft-=(sr.left-er.left)+8;
  else if(er.right>sr.right) sc.scrollLeft+=(er.right-sr.right)+8;
  if(er.top<sr.top) sc.scrollTop-=(sr.top-er.top)+8;
  else if(er.bottom>sr.bottom) sc.scrollTop+=(er.bottom-sr.bottom)+8;
}
function bindGridCells(){
  if(ganttMode==='time'){ SEL.anchor=SEL.focus=null; return; }
  const list=visibleItems();
  GRIDMAP={ rows:list.map(i=>i.id), cols:periodKeys() };
  // si no hay selección todavía, enfocar la primera celda: así el teclado
  // y el pegado funcionan de entrada, sin tener que pasar por "Cargar ítems"
  if(!SEL.focus && GRIDMAP.rows.length && GRIDMAP.cols.length){
    SEL.anchor=SEL.focus={r:0,c:0};
  }
  let dragging=false;
  $$('#timeBody .gcell').forEach(el=>{
    const r=GRIDMAP.rows.indexOf(el.dataset.id), c=GRIDMAP.cols.indexOf(el.dataset.m);
    el.onmousedown=e=>{
      e.preventDefault();
      if(e.shiftKey && SEL.anchor){ SEL.focus={r,c}; }
      else { SEL.anchor={r,c}; SEL.focus={r,c}; }
      dragging=true; paintSel(); $('#timeScroll').focus();
    };
    el.onmouseenter=()=>{ if(dragging){ SEL.focus={r,c}; paintSel(); } };
    el.ondblclick=()=>{ if(ganttMode!=='money'){ SEL.anchor=SEL.focus={r,c}; startEdit(); } };
  });
  document.addEventListener('mouseup',()=>{dragging=false;},{once:true});
  if(SEL.focus) paintSel();
}
/* editor inline sobre la celda enfocada */
function startEdit(initial){
  if(SEL.editing || ganttMode==='money' || !SEL.focus) return;
  const el=cellAt(SEL.focus.r,SEL.focus.c); if(!el) return;
  SEL.editing=true;
  const i=byId[el.dataset.id], m=el.dataset.m;
  const isPct=ganttMode==='pct';
  i._pctBase = i.cant||0;                       // base fija para el %
  const cur = isPct? monthPct(i,m) : (i.dist_mensual[m]||0);
  const inp=document.createElement('input');
  inp.className='gcell-input';
  inp.value = initial!=null? initial : (cur? +cur.toFixed(isPct?1:2) : '');
  el.appendChild(inp); inp.focus();
  if(initial==null) inp.select();
  let done=false;
  const finish=(move)=>{
    if(done) return; done=true; SEL.editing=false;
    inp.onblur=null; inp.onkeydown=null;
    const v=parseFloat(String(inp.value).replace(',','.'));
    if(inp.isConnected) inp.remove();
    if(!isNaN(v)){ isPct? setMonthPct(i,m,v) : setMonthQty(i,m,v); }
    delete i._pctBase;
    const keep={...SEL.focus};
    renderGantt();
    setTimeout(()=>{ SEL.anchor=SEL.focus= move? {r:Math.min(keep.r+1,GRIDMAP.rows.length-1),c:keep.c} : keep; paintSel(); },30);
  };
  inp.onblur=()=>finish(false);
  inp.onkeydown=e=>{
    e.stopPropagation();
    if(e.key==='Enter'){ e.preventDefault(); finish(true); }
    else if(e.key==='Escape'){ done=true; SEL.editing=false; inp.onblur=null; delete i._pctBase;
      if(inp.isConnected) inp.remove(); paintSel(); }
    else if(e.key==='Tab'){ e.preventDefault(); finish(false);
      setTimeout(()=>{ SEL.focus={r:SEL.focus.r,c:Math.min(SEL.focus.c+1,GRIDMAP.cols.length-1)}; SEL.anchor={...SEL.focus}; paintSel(); },40); }
  };
}
/* teclado global de la grilla */
document.addEventListener('keydown', e=>{
  if(ganttMode==='time' || SEL.editing) return;
  if(document.querySelector('.modal.open')) return;
  if(/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName||''))) return;
  if(!SEL.focus) return;
  const nR=GRIDMAP.rows.length-1, nC=GRIDMAP.cols.length-1;
  const mv=(dr,dc)=>{
    const f={ r:Math.max(0,Math.min(nR,SEL.focus.r+dr)), c:Math.max(0,Math.min(nC,SEL.focus.c+dc)) };
    SEL.focus=f; if(!e.shiftKey) SEL.anchor={...f};
    paintSel(); e.preventDefault();
  };
  switch(e.key){
    case 'ArrowUp': mv(-1,0); break;
    case 'ArrowDown': mv(1,0); break;
    case 'ArrowLeft': mv(0,-1); break;
    case 'ArrowRight': mv(0,1); break;
    case 'Home': SEL.focus={r:SEL.focus.r,c:0}; if(!e.shiftKey)SEL.anchor={...SEL.focus}; paintSel(); e.preventDefault(); break;
    case 'End': SEL.focus={r:SEL.focus.r,c:nC}; if(!e.shiftKey)SEL.anchor={...SEL.focus}; paintSel(); e.preventDefault(); break;
    case 'Enter': case 'F2': startEdit(); e.preventDefault(); break;
    case 'Delete': case 'Backspace': clearSel(); e.preventDefault(); break;
    case 'Escape': SEL.anchor={...SEL.focus}; paintSel(); break;
    default:
      if(e.ctrlKey||e.metaKey){
        if(e.key==='c'){ copySel(); e.preventDefault(); }
        else if(e.key==='v'){ /* lo maneja el listener de paste */ }
        else if(e.key==='a'){ SEL.anchor={r:0,c:0}; SEL.focus={r:nR,c:nC}; paintSel(); e.preventDefault(); }
      } else if(e.key.length===1 && /[\d.,\-]/.test(e.key)){
        startEdit(e.key); e.preventDefault();     // escribir directo reemplaza (como Excel)
      }
  }
});
function cellValue(r,c){
  const i=byId[GRIDMAP.rows[r]], m=GRIDMAP.cols[c];
  if(!i) return '';
  const q=i.dist_mensual[m]||0;
  if(!q) return '';
  if(ganttMode==='pct') return monthPct(i,m).toFixed(2);
  if(ganttMode==='money') return String(Math.round(q*i.pu));
  return String(q);
}
function copySel(){
  const R=selRange(); if(!R) return;
  const rows=[];
  for(let r=R.r0;r<=R.r1;r++){
    const cols=[];
    for(let c=R.c0;c<=R.c1;c++) cols.push(cellValue(r,c));
    rows.push(cols.join('\t'));
  }
  const txt=rows.join('\n');
  navigator.clipboard.writeText(txt).then(
    ()=>toast(`Copiado <b>${(R.r1-R.r0+1)}×${(R.c1-R.c0+1)}</b> celdas`),
    ()=>{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove(); toast('Copiado'); });
}
function clearSel(){
  const R=selRange(); if(!R || ganttMode==='money') return;
  const touched=new Set();
  for(let r=R.r0;r<=R.r1;r++){
    const i=byId[GRIDMAP.rows[r]]; if(!i) continue;
    for(let c=R.c0;c<=R.c1;c++){
      const m=GRIDMAP.cols[c];
      if(i.dist_mensual[m]!=null){ delete i.dist_mensual[m]; if(i._manualMonths) delete i._manualMonths[m]; touched.add(i); }
    }
  }
  touched.forEach(i=>syncDatesFromMonths(i));   // la cantidad de contrato NO se toca
  touch(); const keep={...SEL.focus}, ka={...SEL.anchor};
  renderGantt(); setTimeout(()=>{SEL.focus=keep;SEL.anchor=ka;paintSel();},30);
}
/* pegar desde Excel directo en la grilla */
document.addEventListener('paste', e=>{
  if(ganttMode==='time'||ganttMode==='money'||SEL.editing||!SEL.focus) return;
  if(document.querySelector('.modal.open')) return;
  if(/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName||''))) return;
  const txt=(e.clipboardData||window.clipboardData).getData('text');
  if(!txt) return;
  e.preventDefault();
  const grid=txt.replace(/\r/g,'').replace(/\n+$/,'').split('\n').map(l=>l.split('\t'));
  const r0=SEL.focus.r, c0=SEL.focus.c;
  const isPct=ganttMode==='pct';
  const touched=new Set();
  grid.forEach((line,dr)=>{
    const i=byId[GRIDMAP.rows[r0+dr]]; if(!i) return;
    if(isPct) i._pctBase=i.cant||0;
    line.forEach((cellTxt,dc)=>{
      const m=GRIDMAP.cols[c0+dc]; if(!m) return;
      const s=String(cellTxt).trim();
      if(s===''){ delete i.dist_mensual[m]; }
      else {
        const v=parseNum(s);       // maneja 1.234,56 y 1,234.56
        if(isPct) i.dist_mensual[m]=+((i._pctBase||0)*v/100).toFixed(3);
        else i.dist_mensual[m]=v;
        (i._manualMonths=i._manualMonths||{})[m]=true;
      }
      touched.add(i);
    });
    delete i._pctBase;
  });
  touched.forEach(i=>syncDatesFromMonths(i));   // la cantidad de contrato NO se toca
  touch(); renderGantt(); renderKPIs();
  const nr=Math.min(GRIDMAP.rows.length-1,r0+grid.length-1);
  const nc=Math.min(GRIDMAP.cols.length-1,c0+Math.max(...grid.map(l=>l.length))-1);
  setTimeout(()=>{ SEL.anchor={r:r0,c:c0}; SEL.focus={r:nr,c:nc}; paintSel(); },30);
  toast(`Pegadas <b>${grid.length}×${grid[0].length}</b> celdas · fechas y semanas resincronizadas`);
});

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
  $$('#ganttMode button').forEach(x=>x.classList.remove('on'));b.classList.add('on');ganttMode=b.dataset.m;
  document.body.classList.toggle('gridmode',ganttMode!=='time');
  const cv=$('#colwVal'); if(cv) cv.textContent=colw();
  SEL.anchor=SEL.focus=null; renderGantt();});
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
/* ---- escala del eje (meses / semanas) ---- */
$('#scaleSeg')&&($('#scaleSeg').onclick=e=>{
  const b=e.target.closest('button'); if(!b) return;
  $$('#scaleSeg button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  SCALE=b.dataset.s;
  if(SCALE==='week' && (ganttMode==='qty'||ganttMode==='pct'))
    toast('En escala semanal las celdas se muestran (se editan en escala mensual)');
  SEL.anchor=SEL.focus=null; renderGantt();
});
/* ---- ancho de columna ---- */
function setColW(w){
  COLW_USER[ganttMode]=Math.max(48,Math.min(240,w));
  localStorage.setItem('obra_colw',JSON.stringify(COLW_USER));
  $('#colwVal').textContent=colw();
  renderGantt();
}
$('#colwPlus') &&($('#colwPlus').onclick =()=>setColW(colw()+12));
$('#colwMinus')&&($('#colwMinus').onclick=()=>setColW(colw()-12));

/* ---- agregar período (mes/semana) al final del eje ---- */
function addPeriod(){
  if(SCALE!=='month'){ toast('Cambiá a escala de meses para agregar columnas'); return; }
  const last = MONTHS[MONTHS.length-1];
  let y,m;
  if(last){ [y,m]=last.split('-').map(Number); m++; if(m>12){m=1;y++;} }
  else { const t=TODAY; y=t.getFullYear(); m=t.getMonth()+1; }
  const mk=`${y}-${String(m).padStart(2,'0')}`;
  if(!MONTHS.includes(mk)) MONTHS.push(mk);
  MONTHS.sort();
  EXTRA_MONTHS.add(mk);            // se conserva aunque no tenga cantidades
  renderGantt();
  toast('Columna <b>'+monthLabel(mk)+'</b> agregada');
}

/* ---- botón guardar ---- */
$('#btnSave')&&($('#btnSave').onclick=async()=>{
  const b=$('#btnSave'); b.disabled=true;
  clearTimeout(saveTimer);
  await flush(true);
  b.disabled=false;
});
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey) && e.key==='s'){ e.preventDefault(); $('#btnSave') && $('#btnSave').click(); }
});

/* ---- sync de scroll de la columna de verificación ---- */
(function(){
  const ts=$('#timeScroll'), cs=$('#checkScroll');
  if(ts&&cs) ts.addEventListener('scroll',()=>{ cs.scrollTop=ts.scrollTop; });
})();

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
