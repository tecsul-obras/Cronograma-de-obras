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
// Marcador de versión: se ve en la consola (F12) y sirve para confirmar qué
// build cargó el navegador (útil cuando el caché sirve archivos viejos).
const APP_BUILD='2026-07-21.3 · fix permisos boot+sesiones';
console.log('%cCronograma de Obra · build '+APP_BUILD,'color:#f2c200;font-weight:bold');
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
    const intLen = pos;                 // dígitos ANTES del separador
    if(sep===','){
      // convención es-PY: la COMA es SIEMPRE decimal (12,5 · 0,125 · 1234,567).
      // salvo que haya varias comas (pegado raro estilo US) → serían miles.
      t = groups>1 ? t.split(',').join('') : t.replace(',','.');
    } else {
      // PUNTO: en es-PY es separador de miles. Se trata como miles cuando forma
      // grupos válidos (varios puntos, o un punto con 3 dígitos detrás y 1-3
      // delante: 1.234 · 12.500). Si no, es un decimal pegado (1234.567 · 0.5).
      const pareceMiles = groups>1 || (groups===1 && dec===3 && intLen>=1 && intLen<=3);
      t = pareceMiles ? t.split('.').join('') : t;
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
const EPS = 0.01;        // cantidades por debajo de esto se consideran cero (evita 0.003 fantasma)
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
    cant: parseNum(it.cant_contrato),
    cant_ajustada: (it.cant_ajustada!=null && it.cant_ajustada!=='') ? parseNum(it.cant_ajustada) : null,
    pu: parseNum(it.precio_unit),
    get ptot(){return cantVigente(this)*this.pu;},
    incidencia: it.incidencia!=null && it.incidencia!==''?parseNum(it.incidencia):null,
    avE: it.avance_esperado!=null && it.avance_esperado!==''? parseNum(it.avance_esperado):null,
    ini: it.real_start||it.fecha_ini||null,
    fin: it.real_end||it.fecha_fin||null,
    estado: it.estado||'Pendiente',
    cat: it.categoria||'Sin categoría',
    dist_mensual: Object.assign({}, it.dist_mensual||{}),
    deps: (it.deps && it.deps.length)? it.deps.map(d=>({id:String(d.id),type:d.type||'FS',lag:Number(d.lag)||0}))
          : parseDepInit(it.dependencia),
    avance_real_prod: it.avance_real_prod!=null?Number(it.avance_real_prod):null,
    nivel: Math.max(1, Math.min(3, parseInt(it.nivel)||1)),   // 1,2,3 — nivel de indentación
    es_grupo: it.es_grupo===true || it.es_grupo==='true' || it.es_grupo===1 || it.es_grupo==='1',
    orden: it.orden!=null && it.orden!==''? Number(it.orden) : null,
    _rev: it._rev||0,
  }));
  // respetar el orden guardado (columna 'orden'); si falta, mantener el de llegada
  if(ITEMS.some(i=>i.orden!=null)){
    ITEMS.forEach((i,k)=>{ if(i.orden==null) i.orden=k; });
    ITEMS.sort((a,b)=>a.orden-b.orden);
  }
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
  // clima + config de la obra (ajuste por lluvias)
  CLIMA = D.clima || {};
  CFG   = D.config || {};
  // el toggle arranca según la config de la obra; por defecto APAGADO
  LLUVIA_ON = cfgBool('lluvia:activo', false);
  MONTHS = computeMonths();

  // subtítulo del encabezado = nombre de la obra activa (cambia al cambiar de obra)
  const nom = (D.obra && D.obra.nombre) ? D.obra.nombre : '';
  const onEl = document.getElementById('obraName');
  if(onEl && nom) onEl.textContent = nom;
  if(nom) document.title = 'Cronograma de Obra · ' + nom;

  /* El plan semanal se DERIVA del mensual. Las filas que vienen del Sheet y
     fueron editadas a mano (_man) se respetan; el resto se regenera para que
     semanas y meses siempre cuadren. */
  WEEKLY.forEach(w=>{ if(w.cant_prevista!=null && w._man===undefined) w._man=false; });
  if(AUTO_WEEKS) ITEMS.forEach(i=>syncWeeksFromMonths(i));
  WEEKS.length=0; [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort().forEach(w=>WEEKS.push(w));

  if(typeof ALLWEEKS!=='undefined'){ ALLWEEKS=allProjectWeeks(); weeklyIdx=defaultWeekIdx(); }
  renderBaselineControls(); renderKPIs(); renderGantt();
}

/* Cantidad VIGENTE de un ítem: la ajustada (convenio modificatorio / ajuste de
   alcance) si el usuario la fijó a mano; si no, la cantidad de contrato original.
   La original (i.cant) queda SIEMPRE intacta como referencia inmutable. */
const cantVigente = i => (i && i.cant_ajustada!=null) ? i.cant_ajustada : (i? i.cant : 0);
/* ¿tiene ajuste cargado? */
const tieneAjuste = i => i && i.cant_ajustada!=null;

/* total incidencia base = sum of ptot (usa cantidad VIGENTE vía getter ptot) */
const contratoTotal = () => ITEMS.reduce((s,i)=>s+i.ptot,0);
/* monto de contrato ORIGINAL (referencia licitada, sin ajustes) */
const contratoOriginalTotal = () => ITEMS.reduce((s,i)=>s+(i.cant||0)*(i.pu||0),0);

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
    cant:i.cant, cant_ajustada:i.cant_ajustada, dist:Object.assign({},i.dist_mensual)}; });
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
/* Re-sincroniza TODA la obra: recalcula la distribución mensual/semanal de cada
   ítem desde su cantidad de contrato y fechas. Repara casos donde las cantidades
   quedaron desfasadas de la escala de tiempo. PROTEGE lo manual: por defecto
   respeta los meses cargados a mano; si los hay, pregunta antes. */
function resyncAll(){
  const conManual=ITEMS.filter(i=>Object.keys(i._manualMonths||{}).length>0
    || WEEKLY.some(w=>w.item_id===i.id && w._man));
  let respetar=true;
  if(conManual.length){
    respetar=confirm(
      `Hay ${conManual.length} ítem(s) con cantidades cargadas MANUALMENTE.\n\n`+
      `Aceptar = re-sincronizar RESPETANDO esas cantidades manuales (recomendado).\n`+
      `Cancelar = re-sincronizar TODO desde cero (se pierden los ajustes manuales `+
      `y se reparte proporcional por días).`);
  } else {
    if(!confirm('¿Re-sincronizar la distribución mensual y semanal de todos los '+
      'ítems desde su cantidad de contrato y fechas?')) return;
  }
  let n=0;
  ITEMS.forEach(i=>{
    if(!i.ini||!i.fin||!cantVigente(i)) return;
    if(!respetar) i._manualMonths={};
    redistributeMonths(i, respetar);
    n++;
  });
  MONTHS=computeMonths(); touch(); renderGantt(); renderKPIs();
  toast(`Re-sincronizados ${n} ítem(s)`+(respetar?' · manuales respetados':' · desde cero'));
}

/* Rule A: spread contract qty across touched months proportional to calendar days */
/* =========================================================================
 * AJUSTE POR LLUVIAS — Batch 1: config, conteo de días y días hábiles
 *
 * Modelo (ver notas de diseño):
 *  · Días no laborables por clima = LLUVIA + HUMEDAD (ambos cuentan).
 *    RECESO no cuenta: es parada no climática, día útil desperdiciado.
 *  · Dato GLOBAL de obra (una lista de fechas, no por frente).
 *  · Solo RETROSPECTIVO: un mes sin dato de clima usa calendario pleno.
 *  · La obra trabaja 7 días corridos → todo día del calendario es laborable.
 *  · Umbral en DÍAS (no en mm). Los mm quedan como dato informativo.
 * ========================================================================= */
let CLIMA = {};           // { '2025-06': {lluvia, humedad, receso, mm, dias:{}} }
let CFG   = {};           // { 'lluvia:activo':'true', ... }
let LLUVIA_ON = false;    // toggle maestro en runtime (apagado por defecto)

const cfgGet = (k, def) => {
  const v = CFG[k];
  return (v === undefined || v === null || v === '') ? def : v;
};
const cfgBool = (k, def=false) => {
  const v = String(cfgGet(k, def ? 'true' : 'false')).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'si' || v === 'sí';
};
const cfgNum = (k, def=0) => { const n = parseNum(cfgGet(k, def)); return isNaN(n) ? def : n; };

/* días de clima BRUTOS de un mes = lluvia + humedad (receso NO cuenta) */
function diasClimaBrutos(mk){
  const c = CLIMA[mk]; if(!c) return 0;
  return (c.lluvia||0) + (c.humedad||0);
}

/* días de clima RECONOCIDOS de un mes, aplicando la regla de la obra:
 *   modo 'todos'   → todos los días cuentan (obra privada)
 *   modo 'umbral'  → solo si supera el umbral; y según 'conteo':
 *        'excedente' → solo los días por encima del umbral
 *        'total'     → todos los días del mes (una vez superado el umbral)
 * Se resta el override manual lluvia:excluir:YYYY-MM.                      */
function diasClimaReconocidos(mk){
  let d = diasClimaBrutos(mk);
  if(!d) return 0;
  d = Math.max(0, d - cfgNum('lluvia:excluir:'+mk, 0));
  if(!d) return 0;
  const modo = String(cfgGet('lluvia:modo','todos')).trim().toLowerCase();
  if(modo !== 'umbral') return d;                 // privada: todos
  const u = cfgNum('lluvia:umbral', 8);
  if(d <= u) return 0;                            // no supera el umbral → no aplica
  const conteo = String(cfgGet('lluvia:conteo','excedente')).trim().toLowerCase();
  return conteo === 'total' ? d : (d - u);
}

/* días del mes 'mk' comprendidos entre a y b (ambos Date, inclusive) */
function diasCalendarioTramo(a, b){ return daysBetween(a,b)+1; }

/* DÍAS HÁBILES de un tramo dentro de un mes.
 * Si el ajuste está apagado, o el mes no tiene dato de clima (mes futuro),
 * devuelve los días calendario del tramo — comportamiento idéntico al actual.
 * Si hay clima, descuenta los días reconocidos PRORRATEADOS al tramo (un ítem
 * puede ocupar solo parte del mes).                                          */
function diasHabilesTramo(mk, a, b){
  const cal = diasCalendarioTramo(a,b);
  if(!LLUVIA_ON) return cal;
  const rec = diasClimaReconocidos(mk);
  if(!rec) return cal;
  const dm = new Date(a.getFullYear(), a.getMonth()+1, 0).getDate();   // días del mes
  const proporcion = cal / dm;                     // qué parte del mes ocupa el tramo
  const descuento  = rec * proporcion;
  return Math.max(0.5, cal - descuento);           // nunca 0: evita divisiones raras
}

/* días hábiles de un MES COMPLETO (para la curva S y el techo de plazo) */
function diasHabilesMes(mk){
  if(!mk) return 0;
  const [y,m] = mk.split('-').map(Number);
  const cal = new Date(y, m, 0).getDate();
  if(!LLUVIA_ON) return cal;
  return Math.max(0.5, cal - diasClimaReconocidos(mk));
}

/* total de días reconocidos en un rango de meses — alimenta el techo de la
 * curva operativa (Batch 2): fin de contrato + días ganados por lluvia.
 * NOTA: es independiente del toggle de visualización. El toggle decide si el
 * cronograma se REDISTRIBUYE en pantalla; los días ganados son un hecho
 * contractual que existe igual, y el Batch 2 los necesita siempre.          */
function diasGanadosPorLluvia(mkDesde, mkHasta){
  return Object.keys(CLIMA)
    .filter(mk => (!mkDesde || mk >= mkDesde) && (!mkHasta || mk <= mkHasta))
    .reduce((s,mk) => s + diasClimaReconocidos(mk), 0);
}

function redistributeMonths(i, respectManual=true){
  const a=parseD(i.ini), b=parseD(i.fin); if(!a||!b) return;
  // meses que realmente toca el rango de fechas vigente
  const enRango={}; { let c=new Date(a.getFullYear(),a.getMonth(),1);
    while(c<=b){ enRango[c.toISOString().slice(0,7)]=true; c=new Date(c.getFullYear(),c.getMonth()+1,1); } }
  // Un mes manual solo se respeta si sigue DENTRO del rango. Si el ítem se
  // movió de mes (p.ej. al pegar fechas nuevas desde Excel), los manuales
  // viejos se descartan para que la Σ no quede pegada al mes anterior.
  const manual={};
  Object.keys(i._manualMonths||{}).forEach(m=>{ if(enRango[m]) manual[m]=true; });
  i._manualMonths=manual;
  const manualSum = Object.entries(manual).reduce((s,[m])=> s + (respectManual? (i.dist_mensual[m]||0):0),0);
  const total=Math.max(0,(cantVigente(i)||0) - (respectManual?manualSum:0));
  const dist=respectManual? Object.fromEntries(Object.entries(i.dist_mensual).filter(([m])=>manual[m])) : {};
  let sumDays=0; const buckets=[];
  let cur=new Date(a);
  while(cur<=b){
    const mk=cur.toISOString().slice(0,7);
    if(!(respectManual&&manual[mk])){
      const mEnd=new Date(cur.getFullYear(),cur.getMonth()+1,0);
      const segEnd = b<mEnd? b:mEnd;
      // PESO del mes: días hábiles (calendario − días de clima reconocidos).
      // Con el ajuste apagado equivale exactamente a los días calendario.
      const d=diasHabilesTramo(mk,cur,segEnd); buckets.push([mk,d]); sumDays+=d;
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

/* ---- editar la cantidad de UNA semana (desde la grilla o el plan semanal) ----
   Reescala el reparto entre meses de esa semana y propaga al mensual, para que
   la Σ de la derecha se actualice al instante (bidireccionalidad). */
function setWeekQty(item, wk, val){
  let w=WEEKLY.find(x=>x.item_id===item.id && x.week===wk);
  const meses = mesesDeSemana(wk);
  if(!w){
    if(!(Math.abs(val)>0)) return;
    // crear la fila: repartir entre los meses que toca, por días
    const dias={}; let tot=0;
    const [mon,sun]=weekMondaySunday(wk);
    for(let d=new Date(mon); d<=sun; d.setDate(d.getDate()+1)){
      const mk=d.toISOString().slice(0,7); dias[mk]=(dias[mk]||0)+1; tot++;
    }
    const split={}; Object.entries(dias).forEach(([mk,n])=>split[mk]=round3(val*n/tot));
    w={ item_id:item.id, actividad:item.desc, frente:'', um:item.um,
        week:wk, month:mesPrincipal(split), mesSplit:split,
        cant_prevista:round3(val), cant_ejecutada:null,
        causa:'Sin observaciones', _man:true };
    WEEKLY.push(w);
    if(!WEEKS.includes(wk)){ WEEKS.push(wk); WEEKS.sort(); }
  } else {
    const prev=Object.values(w.mesSplit||{}).reduce((s,v)=>s+v,0);
    if(prev>0){
      const f=val/prev, rs={};
      Object.entries(w.mesSplit).forEach(([m,v])=>rs[m]=round3(v*f));
      w.mesSplit=rs;
    } else {
      // sin split previo: repartir por días
      const dias={}; let tot=0;
      const [mon,sun]=weekMondaySunday(wk);
      for(let d=new Date(mon); d<=sun; d.setDate(d.getDate()+1)){
        const mk=d.toISOString().slice(0,7); dias[mk]=(dias[mk]||0)+1; tot++;
      }
      const split={}; Object.entries(dias).forEach(([mk,n])=>split[mk]=round3(val*n/tot));
      w.mesSplit=split; w.month=mesPrincipal(split);
    }
    w.cant_prevista=round3(val); w._man=true;
    if(Math.abs(val)===0) WEEKLY=WEEKLY.filter(x=>x!==w);
  }
  syncMonthsFromWeeks(item.id);     // ← el mes (y la Σ) se actualizan al toque
  touch('weekly');
}

/* ---------- SEMANA → MES (propagación inversa, bidireccional) ----------
   Cuando se edita la cantidad de una semana, el mes debe reflejarlo al toque:
   la cantidad del mes pasa a ser la suma de los aportes de TODAS sus semanas.
   Sin esto, la Σ de la derecha no se actualizaba al tocar el plan semanal. */
function syncMonthsFromWeeks(itemId){
  const i=byId[itemId]; if(!i) return;
  const filas=WEEKLY.filter(w=>w.item_id===itemId);
  const nd={};
  filas.forEach(w=>{
    const split = (w.mesSplit && Object.keys(w.mesSplit).length)
      ? w.mesSplit
      : (w.month? {[w.month]: (w.cant_prevista||0)} : {});
    Object.entries(split).forEach(([mk,v])=>{ nd[mk]=round3((nd[mk]||0)+(v||0)); });
  });
  Object.keys(nd).forEach(m=>{ if(Math.abs(nd[m])===0) delete nd[m]; });
  i.dist_mensual=nd;
  i._manualMonths=i._manualMonths||{};
  Object.keys(nd).forEach(m=>i._manualMonths[m]=true);
  // reajustar fechas al nuevo rango, SIN regenerar las semanas (evita el bucle).
  // Se PRESERVA el día real de inicio/fin si el ítem ya lo tenía dentro del
  // primer/último mes: así un ítem que arranca el 20/07 no se resetea al 1/07
  // (era la causa del bucle W27/W28).
  const ms=Object.keys(nd).sort();
  if(ms.length){
    const [y0,m0]=ms[0].split('-').map(Number);
    const [y1,m1]=ms[ms.length-1].split('-').map(Number);
    const priMes=new Date(y0,m0-1,1), ultMes=new Date(y1,m1,0);
    const a=i.ini?parseD(i.ini):null, b=i.fin?parseD(i.fin):null;
    // si el inicio previo cae dentro del primer mes, se conserva; si no, día 1
    i.ini=dstr( (a && a.getFullYear()===y0 && a.getMonth()===m0-1 && a>priMes) ? a : priMes );
    // si el fin previo cae dentro del último mes, se conserva; si no, último día
    i.fin=dstr( (b && b.getFullYear()===y1 && b.getMonth()===m1-1 && b<ultMes) ? b : ultMes );
  }
}
/* diferencia contra el contrato: 0 = cuadra */
function difContrato(i){ return +(sumaCronograma(i)-(cantVigente(i)||0)).toFixed(3); }

/* ---------- MENSUAL → SEMANAL (generación automática) ----------
   La cantidad de cada mes se reparte entre las semanas que tocan ese mes,
   proporcional a los DÍAS de la semana que caen dentro del mes (Regla B:
   la semana es un bloque íntegro, pero su cantidad se prorratea).
   Solo se tocan las semanas AUTO: si el residente editó una a mano
   (_man = true), esa se respeta y se descuenta del reparto.            */
function syncWeeksFromMonths(item){
  if(!AUTO_WEEKS) return;
  const dist=item.dist_mensual||{};
  const meses=Object.keys(dist).filter(m=>Math.abs(dist[m]||0)>0);

  /* 1) Repartir cada mes entre las semanas que lo tocan, proporcional a los días.
        El redondeo se hace con "reparto de residuo": se redondea cada parte y la
        diferencia contra el total del mes se ajusta en la semana más grande.
        Así la suma de las semanas da EXACTAMENTE la cantidad del mes, incluso
        para ítems globales (GL) con cantidades chicas (0,02 / 0,08). */
  const split={};
  meses.forEach(mk=>{
    const totalMes=dist[mk]||0;
    const semanas=weeksOfMonth(mk, item.ini, item.fin);
    const diasMes=semanas.reduce((s,x)=>s+x.dias,0);
    if(!diasMes) return;
    const partes=semanas.map(s=>({wk:s.wk, raw: totalMes*s.dias/diasMes}));
    partes.forEach(p=>p.val=round3(p.raw));
    // ajustar el residuo de redondeo en la parte más grande
    const suma=partes.reduce((s,p)=>s+p.val,0);
    const resid=round3(totalMes-suma);
    if(Math.abs(resid)>0){
      let big=partes[0];
      partes.forEach(p=>{ if(p.raw>big.raw) big=p; });
      big.val=round3(big.val+resid);
    }
    partes.forEach(p=>{ if(Math.abs(p.val)>0) (split[p.wk]=split[p.wk]||{})[mk]=p.val; });
  });

  /* 2) UNA fila por (ítem, semana). La cantidad total es la suma de sus aportes
        mensuales; el desglose queda en w.mesSplit (Regla B, para certificar). */
  const semanasCalc=Object.keys(split);
  WEEKLY=WEEKLY.filter(w=>!(w.item_id===item.id && !w._man && !semanasCalc.includes(w.week)));
  const exist={}; WEEKLY.forEach(w=>{ if(w.item_id===item.id) exist[w.week]=w; });

  semanasCalc.forEach(wk=>{
    const porMes=split[wk];
    const total=round3(Object.values(porMes).reduce((s,v)=>s+v,0));
    if(Math.abs(total)===0) return;
    const w=exist[wk];
    if(w){
      w.um=item.um;
      if(!w._man){ w.mesSplit=porMes; w.month=mesPrincipal(porMes); w.cant_prevista=total; }
      else {
        // MANUAL: se respeta lo que puso el residente; el reparto se reescala
        w.month=mesPrincipal(porMes);
        if(w.cant_prevista!=null && total!==0){
          const f=w.cant_prevista/total, rs={};
          Object.entries(porMes).forEach(([m,v])=>rs[m]=round3(v*f));
          w.mesSplit=rs;
        } else w.mesSplit=porMes;
      }
    } else {
      WEEKLY.push({ item_id:item.id, actividad:item.desc, frente:'', um:item.um,
        week:wk, month:mesPrincipal(porMes), mesSplit:porMes,
        cant_prevista:total, cant_ejecutada:null,
        causa:'Sin observaciones', _man:false, _auto:true });
    }
  });
  WEEKS.length=0; [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort().forEach(w=>WEEKS.push(w));
}
const round3 = v => Math.round((v+Number.EPSILON)*1000)/1000;

/* mes con mayor aporte dentro de una semana (para agrupar/filtrar) */
function mesPrincipal(porMes){
  let best=null,bv=-1;
  for(const [m,v] of Object.entries(porMes||{})) if(v>bv){bv=v;best=m;}
  return best;
}
/* cuánto aporta una fila semanal a un mes dado (Regla B: prorrateo) */
function aporteMes(w, mk){
  if(w.mesSplit && w.mesSplit[mk]!=null) return w.mesSplit[mk];
  // filas sin desglose (cargadas a mano o viejas): se imputan a su mes
  return (w.month===mk) ? (w.cant_prevista||0) : 0;
}

/* semanas ISO que tocan un mes, con cuántos días de cada una caen dentro.
   Si se pasan ini/fin (rango real del ítem), el mes se recorta a esos límites:
   así un ítem que arranca el 20/07 solo reparte entre los días 20–31 y nunca
   aparecen cantidades en semanas anteriores a su inicio (ni se cuelga el bucle). */
function weeksOfMonth(mk, ini, fin){
  const [y,m]=mk.split('-').map(Number);
  let first=new Date(y,m-1,1), last=new Date(y,m,0);
  if(ini){ const a=parseD(ini); if(a && a>first) first=new Date(a.getFullYear(),a.getMonth(),a.getDate()); }
  if(fin){ const b=parseD(fin); if(b && b<last)  last =new Date(b.getFullYear(),b.getMonth(),b.getDate()); }
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
  setMonthQty(i, mk, +( (cantVigente(i)||0)*p/100 ).toFixed(3));
}
function monthPct(i, mk){ const q=i.dist_mensual[mk]||0; const b=cantVigente(i); return b? q/b*100:0; }

/* dependency helpers */
const DEP_TYPES={FS:'Fin→Inicio',SS:'Inicio→Inicio',FF:'Fin→Fin',SF:'Inicio→Fin'};
function depList(i){ return i.deps||[]; }
/* Recalcula la programación respetando TODAS las dependencias.
   A diferencia del cascade anterior (que solo empujaba hacia adelante y se
   quedaba corto), esto resuelve el grafo completo: ordena topológicamente y
   reposiciona cada ítem según sus predecesores. Mantiene la DURACIÓN de cada
   tarea y arrastra la distribución mensual con ella. */
function recalcSchedule(anchorId){
  const orden = topoSort();
  if(!orden) { toast('Hay dependencias circulares — no se pudo recalcular'); return 0; }
  let movidos=0;
  orden.forEach(id=>{
    const i=byId[id]; if(!i || !i.ini || !i.fin) return;
    const deps=(i.deps||[]).filter(d=>byId[d.id] && byId[d.id].ini && byId[d.id].fin);
    if(!deps.length) return;
    const iIni=parseD(i.ini), iFin=parseD(i.fin);
    const dur=daysBetween(iIni,iFin);
    // fecha de inicio más restrictiva impuesta por los predecesores
    let reqIni=null, reqFin=null;
    deps.forEach(d=>{
      const p=byId[d.id]; const pIni=parseD(p.ini), pFin=parseD(p.fin);
      const lag=(d.lag||0);
      let ri=null, rf=null;
      if(d.type==='FS'){ ri=addDays(pFin, 1+lag); }        // arranca al día siguiente de que termina
      else if(d.type==='SS'){ ri=addDays(pIni, lag); }
      else if(d.type==='FF'){ rf=addDays(pFin, lag); }
      else if(d.type==='SF'){ rf=addDays(pIni, lag); }
      if(ri && (!reqIni || ri>reqIni)) reqIni=ri;
      if(rf && (!reqFin || rf>reqFin)) reqFin=rf;
    });
    let nIni=iIni, nFin=iFin;
    if(reqIni){ nIni=reqIni; nFin=addDays(reqIni,dur); }
    if(reqFin){ // si además hay restricción de fin, la que mande es la más tardía
      if(!reqIni || addDays(reqFin,-dur) > nIni){ nFin=reqFin; nIni=addDays(reqFin,-dur); }
    }
    if(dstr(nIni)!==i.ini || dstr(nFin)!==i.fin){
      shiftItem(i, daysBetween(iIni,nIni));   // mueve fechas Y arrastra la distribución
      movidos++;
    }
  });
  return movidos;
}
const addDays=(d,n)=>{const x=new Date(d); x.setDate(x.getDate()+n); return x;};

/* Mueve un ítem N días arrastrando su distribución mensual.
   Si el desplazamiento es de meses completos, la distribución se traslada tal
   cual. Si no, se reparte de nuevo por días dentro del nuevo rango. */
function shiftItem(i, dias){
  if(!dias || !i.ini || !i.fin) return;
  const a=parseD(i.ini), b=parseD(i.fin);
  const na=addDays(a,dias), nb=addDays(b,dias);
  const total=sumaCronograma(i);
  i.ini=dstr(na); i.fin=dstr(nb);
  const mesesDesplazados = (na.getFullYear()*12+na.getMonth()) - (a.getFullYear()*12+a.getMonth());
  const mismoDia = na.getDate()===a.getDate();
  if(mesesDesplazados!==0 && mismoDia){
    // traslado limpio: correr las claves de mes
    const nd={}, nm={};
    Object.entries(i.dist_mensual||{}).forEach(([mk,q])=>{
      const [y,m]=mk.split('-').map(Number);
      const t=new Date(y, m-1+mesesDesplazados, 1);
      const k=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
      nd[k]=q; if(i._manualMonths&&i._manualMonths[mk]) nm[k]=true;
    });
    i.dist_mensual=nd; i._manualMonths=nm;
  } else {
    // reparto proporcional por días en el nuevo rango, conservando el total
    spreadByDays(i, total);
  }
  syncWeeksFromMonths(i);
}
/* Reparte `total` entre los meses del rango [ini,fin] proporcional a días.
   Ignora las marcas manuales: se usa cuando el rango cambia de verdad. */
function spreadByDays(i, total){
  const a=parseD(i.ini), b=parseD(i.fin); if(!a||!b) return;
  const buckets=[]; let sumDias=0;
  let cur=new Date(a.getFullYear(),a.getMonth(),1);
  while(cur<=b){
    const mk=`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
    const mIni=new Date(Math.max(cur, a));
    const mFinMes=new Date(cur.getFullYear(),cur.getMonth()+1,0);
    const mFin=new Date(Math.min(mFinMes, b));
    const dias=daysBetween(mIni,mFin)+1;
    if(dias>0){ buckets.push({mk,dias}); sumDias+=dias; }
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  if(!sumDias) return;
  const partes=buckets.map(x=>({mk:x.mk, raw: total*x.dias/sumDias}));
  partes.forEach(p=>p.val=round3(p.raw));
  const resid=round3(total - partes.reduce((s,p)=>s+p.val,0));
  if(Math.abs(resid)>0 && partes.length){
    let big=partes[0]; partes.forEach(p=>{ if(p.raw>big.raw) big=p; });
    big.val=round3(big.val+resid);
  }
  const nd={}; partes.forEach(p=>{ if(Math.abs(p.val)>0) nd[p.mk]=p.val; });
  i.dist_mensual=nd; i._manualMonths={};
}
/* orden topológico (predecesores antes que sucesores) */
function topoSort(){
  const grado={}, adj={};
  ITEMS.forEach(i=>{ grado[i.id]=0; adj[i.id]=[]; });
  ITEMS.forEach(i=>(i.deps||[]).forEach(d=>{
    if(!byId[d.id]) return;
    adj[d.id].push(i.id); grado[i.id]++;
  }));
  const cola=ITEMS.filter(i=>grado[i.id]===0).map(i=>i.id);
  const out=[];
  while(cola.length){
    const id=cola.shift(); out.push(id);
    (adj[id]||[]).forEach(s=>{ if(--grado[s]===0) cola.push(s); });
  }
  return out.length===ITEMS.length? out : null;   // null = ciclo
}
/* compat: se sigue llamando cascade() desde varios lados */
function cascade(src){ return recalcSchedule(src && src.id); }

/* ---- AJUSTAR DIFERENCIA: mete el residuo en el último mes con cantidad ---- */
function ajustarDif(i){
  const dif=difContrato(i);           // suma cronograma - contrato
  if(Math.abs(dif)<0.0005) return false;
  const ms=Object.keys(i.dist_mensual||{}).filter(m=>Math.abs(i.dist_mensual[m])>0).sort();
  if(!ms.length){
    // sin distribución: poner todo el contrato en el mes de inicio
    const mk=(i.ini||dstr(TODAY)).slice(0,7);
    i.dist_mensual[mk]=cantVigente(i)||0; (i._manualMonths=i._manualMonths||{})[mk]=true;
  } else {
    const last=ms[ms.length-1];
    const nuevo=round3((i.dist_mensual[last]||0) - dif);
    if(nuevo>0){ i.dist_mensual[last]=nuevo; }
    else { // no alcanza: repartir el ajuste hacia atrás
      delete i.dist_mensual[last];
      let resto=round3(-nuevo);
      for(let k=ms.length-2;k>=0 && resto>0;k--){
        const m=ms[k], v=i.dist_mensual[m]||0;
        const quita=Math.min(v,resto);
        i.dist_mensual[m]=round3(v-quita); resto=round3(resto-quita);
        if(i.dist_mensual[m]<=0) delete i.dist_mensual[m];
      }
    }
    (i._manualMonths=i._manualMonths||{})[last]=true;
  }
  syncDatesFromMonths(i);
  return true;
}
function ajustarTodos(){
  let n=0; ITEMS.forEach(i=>{ if(ajustarDif(i)) n++; });
  if(n){ touch(); renderGantt(); renderKPIs(); toast(`Ajustados <b>${n}</b> ítems — la Σ del cronograma cuadra con el contrato`); }
  else toast('Todos los ítems ya cuadran');
}

/* ===================== GANTT (aligned + editable) ====================== */
let ganttMode='time', showCrit=false, selId=null, catFilter='';
const G={x0:null,x1:null,pxDay:2.6};

// ancho de la semana en la vista Tiempo·Semanas (px por semana), ajustable con −/+
let TIME_WEEK_PX = 56;
try{ const v=parseFloat(localStorage.getItem('obra_timeweekpx')||''); if(v) TIME_WEEK_PX=v; }catch(e){}

function ganttDomain(){
  let min=null,max=null;
  ITEMS.forEach(i=>{const a=parseD(i.ini),b=parseD(i.fin); if(a&&(!min||a<min))min=a; if(b&&(!max||b>max))max=b;});
  min=min||new Date('2025-04-01'); max=max||new Date('2027-06-30');
  G.x0=new Date(min.getFullYear(),min.getMonth(),1);
  G.x1=new Date(max.getFullYear(),max.getMonth()+1,1);
  // en escala semanal (vista Tiempo) cada semana necesita ancho legible;
  // el resto de la escala (meses) mantiene el ajuste automático para que entre.
  if(SCALE==='week' && ganttMode==='time'){
    G.pxDay = TIME_WEEK_PX/7;                      // p.ej. 56px/semana → 8px/día
  } else {
    G.pxDay=Math.max(1.6,Math.min(4,1400/daysBetween(G.x0,G.x1)));
  }
}
const gx = d => daysBetween(G.x0, parseD(typeof d==='string'?d:dstr(d)))*G.pxDay;
const body_w=()=>daysBetween(G.x0,G.x1)*G.pxDay;

/* =======================================================================
   TABLA DE ÍTEMS TIPO EXCEL: columnas configurables, orden y filtro
   · columnas fijas: id, desc, um, cant (siempre visibles)
   · columnas opcionales: pu, ptot, dur, ini, fin, av, inc
   · scroll horizontal propio; el ancho del panel se ajusta con el divisor
   ======================================================================= */
const COLS_DEF = [
  {key:'id',   label:'ID',            w:40,  fixed:true,  align:'left',  type:'text'},
  {key:'desc', label:'Ítem de obra',  w:200, fixed:true,  align:'left',  type:'text'},
  {key:'um',   label:'UM',            w:48,  fixed:true,  align:'left',  type:'text'},
  {key:'cant', label:'Cant. contrato',w:104, fixed:true,  align:'right', type:'num'},
  {key:'cajust',label:'Cant. ajustada',w:108,fixed:false, align:'right', type:'num'},
  {key:'pu',   label:'Precio unit.',  w:118, fixed:false, align:'right', type:'num'},
  {key:'ptot', label:'Precio total',  w:130, fixed:false, align:'right', type:'money'},
  {key:'dur',  label:'Duración (d)',  w:84,  fixed:false, align:'right', type:'num'},
  {key:'ini',  label:'Inicio',        w:96,  fixed:false, align:'left',  type:'date'},
  {key:'fin',  label:'Fin',           w:96,  fixed:false, align:'left',  type:'date'},
  {key:'av',   label:'Avance',        w:70,  fixed:false, align:'right', type:'pct'},
  {key:'avE',  label:'% Planeado',    w:78,  fixed:false, align:'right', type:'pct'},
  {key:'cplan',label:'Cant. planeada',w:96,  fixed:false, align:'right', type:'num'},
  {key:'cejec',label:'Cant. ejecutada',w:96, fixed:false, align:'right', type:'num'},
  {key:'cpend',label:'Cant. pendiente',w:96, fixed:false, align:'right', type:'num'},
  {key:'brecha',label:'% Brecha',     w:76,  fixed:false, align:'right', type:'pct'},
  {key:'inc',  label:'Incidencia',    w:80,  fixed:false, align:'right', type:'pct'},
];
// visibilidad por defecto de las opcionales (fijas siempre on)
const COLS_VIS_DEF = {cajust:false, pu:false, ptot:false, dur:false, ini:false, fin:false, av:true, avE:false, cplan:false, cejec:false, cpend:false, brecha:false, inc:false};
let COLS_VIS = Object.assign({}, COLS_VIS_DEF);
try{ COLS_VIS = Object.assign(COLS_VIS, JSON.parse(localStorage.getItem('obra_colsvis')||'{}')); }catch(e){}
function saveColsVis(){ try{ localStorage.setItem('obra_colsvis', JSON.stringify(COLS_VIS)); }catch(e){} }
function activeCols(){ return COLS_DEF.filter(c=>c.fixed || COLS_VIS[c.key]); }
function gridTemplate(){ return activeCols().map(c=>c.w+'px').join(' '); }
// aplica los anchos de columna en vivo (durante el arrastre, sin re-render total)
function applyColWidths(){
  const tmpl=gridTemplate(); const w=gridInnerW()+'px';
  const gh=$('#gridHeadRow'); if(gh){ gh.style.gridTemplateColumns=tmpl; gh.style.width=w; }
  const gg=$('#ganttGrid'); if(gg){ gg.style.width=w;
    gg.querySelectorAll('.grow-row').forEach(r=>r.style.gridTemplateColumns=tmpl); }
}
// cargar anchos de columna guardados
(function(){ try{ const s=JSON.parse(localStorage.getItem('obra_colwidths')||'{}');
  COLS_DEF.forEach(c=>{ if(s[c.key]) c.w=s[c.key]; }); }catch(_){} })();
function gridInnerW(){ return activeCols().reduce((s,c)=>s+c.w,0); }

let SORT = {key:null, dir:1};   // dir 1 asc, -1 desc
let COLFILTER = {};             // {key: 'texto'} filtro por columna (substring, case-insens)

/* duración en días calendario de un ítem (inclusive) */
function itemDur(i){
  const a=parseD(i.ini), b=parseD(i.fin);
  return (a&&b)? daysBetween(a,b)+1 : null;
}
/* ===== JERARQUÍA / GRUPOS ============================================== */
// Un ítem es "grupo" si está marcado es_grupo, o si el siguiente ítem tiene
// un nivel mayor (es su hijo). Los hijos de un grupo son los ítems consecutivos
// con nivel > el del grupo, hasta el próximo ítem de nivel <= al del grupo.
function esGrupo(idx){
  const i=ITEMS[idx]; if(!i) return false;
  if(i.es_grupo) return true;
  const sig=ITEMS[idx+1];
  return !!(sig && sig.nivel>i.nivel);
}
function hijosDe(idx){
  const g=ITEMS[idx]; const out=[];
  for(let k=idx+1;k<ITEMS.length;k++){
    if(ITEMS[k].nivel<=g.nivel) break;   // volvió al nivel del grupo o superior
    out.push(ITEMS[k]);
  }
  return out;
}
// hijos DIRECTOS + indirectos que son ítems-hoja (con cantidad), para sumar montos/fechas
function hojasDe(idx){
  return hijosDe(idx).filter((c,k)=>{
    const kk=ITEMS.indexOf(c);
    return !esGrupo(kk);                 // solo hojas, no sub-grupos (evita doble conteo)
  });
}
// valores resumidos de un grupo: fecha ini (mín), fin (máx), monto (suma de hojas).
// CANTIDADES: si TODAS las hojas comparten la misma unidad de medida (ej. un
// terraplén dividido por progresivas, todo m3), el grupo también suma cantidad
// de contrato, planeada y ejecutada — igual que Project suma días porque la
// unidad es uniforme. Con unidades mezcladas no se suma (no tiene sentido).
function resumenGrupo(idx){
  const hojas=hojasDe(idx);
  let ini=null, fin=null, monto=0;
  // ¿UM uniforme y no vacía en todas las hojas?
  let um=null, umOk=hojas.length>0;
  hojas.forEach(h=>{
    const u=String(h.um||'').trim().toLowerCase();
    if(um===null) um=u; else if(u!==um) umOk=false;
  });
  umOk = umOk && !!um;
  let cant=0, cvig=0, cplan=0, cejec=0; let hayAjuste=false;
  hojas.forEach(h=>{
    const a=parseD(h.ini), b=parseD(h.fin);
    if(a&&(!ini||a<ini)) ini=a;
    if(b&&(!fin||b>fin)) fin=b;
    monto+=h.ptot||0;
    if(tieneAjuste(h)) hayAjuste=true;
    if(umOk){
      cant += h.cant||0;
      cvig += cantVigente(h)||0;
      cplan += sumaCronograma(h);
      const pr=(typeof PROD!=='undefined')?PROD[h.id]:null;
      cejec += (pr&&pr.total)||0;
    }
  });
  return {
    ini: ini?dstr(ini):null,
    fin: fin?dstr(fin):null,
    dur: (ini&&fin)?daysBetween(ini,fin)+1:null,
    monto,
    um: umOk? (hojas[0].um||'') : null,
    cant: umOk? cant : null,
    cvig: umOk? cvig : null,
    hayAjuste,
    cplan: umOk? cplan : null,
    cejec: umOk? cejec : null
  };
}
/* fecha corta d/m para las barras del gantt (ej. "17/7") */
function fmtDM(s){
  if(!s) return '';
  const p=String(s).slice(0,10).split('-');
  return p.length===3 ? (+p[2])+'/'+(+p[1]) : '';
}
// set de IDs colapsados (persistido por obra en localStorage)
let COLLAPSED=new Set();
try{ const raw=localStorage.getItem('obra_collapsed_'+(D.obra&&D.obra.id||'')); if(raw) COLLAPSED=new Set(JSON.parse(raw)); }catch(e){}
function saveCollapsed(){ try{ localStorage.setItem('obra_collapsed_'+(D.obra&&D.obra.id||''), JSON.stringify([...COLLAPSED])); }catch(e){} }
// ¿este ítem está oculto porque algún ancestro está colapsado?
function itemOculto(idx){
  const i=ITEMS[idx];
  for(let k=idx-1;k>=0;k--){
    if(ITEMS[k].nivel<i.nivel){          // ancestro
      if(COLLAPSED.has(ITEMS[k].id)) return true;
      if(ITEMS[k].nivel===1) break;      // llegamos a la raíz de esta rama
    }
  }
  return false;
}
// resalta la fila activa (selección tipo celda para navegación con teclado)
function selectRow(row){
  $$('#ganttGrid .grow-row.row-active').forEach(r=>r.classList.remove('row-active'));
  if(row){ row.classList.add('row-active'); scrollRowIntoView(row); }
}
function scrollRowIntoView(row){
  const sc=$('#gridScroll'); if(!sc) return;
  const rt=row.offsetTop, rh=row.offsetHeight, st=sc.scrollTop, sh=sc.clientHeight;
  if(rt<st) sc.scrollTop=rt;
  else if(rt+rh>st+sh) sc.scrollTop=rt+rh-sh;
}
// mover un ítem (con su bloque de hijos si es grupo) antes/después de un target
function moverItem(dragId, targetId, below){
  if(!dragId || dragId===targetId) return;
  const from=ITEMS.findIndex(i=>i.id===dragId);
  if(from<0) return;
  // bloque a mover: el ítem + sus hijos si es grupo
  const bloque = esGrupo(from) ? [ITEMS[from], ...hijosDe(from)] : [ITEMS[from]];
  const blockIds=new Set(bloque.map(i=>i.id));
  if(blockIds.has(targetId)) return;     // no soltar dentro de sí mismo
  // sacar el bloque
  const resto=ITEMS.filter(i=>!blockIds.has(i.id));
  // posición destino en el resto
  let ti=resto.findIndex(i=>i.id===targetId);
  if(ti<0) return;
  if(below) ti+=1;
  ITEMS=[...resto.slice(0,ti), ...bloque, ...resto.slice(ti)];
  reindex(); touch(); renderGantt(); renderKPIs();
}
/* % de avance físico PLANEADO de un ítem a la fecha de hoy, según la DISTRIBUCIÓN
   MENSUAL del cronograma (no lineal). Es lo que planea certificarse mes a mes:
   se acumula lo planificado de los meses ya cerrados + la parte proporcional del
   mes en curso (por días). Coincide con la curva S y con Power BI.
   Devuelve null si el ítem no tiene distribución ni fechas. */
function itemAvancePlaneado(i){
  const dist=i.dist_mensual||{};
  const totalPlan=Object.values(dist).reduce((s,v)=>s+(+v||0),0);
  const a=parseD(i.ini), b=parseD(i.fin);
  // sin distribución: caer al prorrateo lineal por días (mejor que nada)
  if(totalPlan<=0){
    if(!a||!b) return null;
    const hoy0=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());
    if(hoy0<a) return 0; if(hoy0>=b) return 100;
    return (daysBetween(a,hoy0)+1)/(daysBetween(a,b)+1)*100;
  }
  const hoy=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());
  const curMk=hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0');
  let acum=0;
  for(const[mk,q] of Object.entries(dist)){
    const val=+q||0; if(!val) continue;
    if(mk<curMk) acum+=val;                          // mes ya cerrado → completo
    else if(mk===curMk){                             // mes en curso → prorrateo por días
      const [y,m]=mk.split('-').map(Number);
      const diasMes=new Date(y,m,0).getDate();
      const transcurridos=Math.min(hoy.getDate(),diasMes);
      acum+=val*transcurridos/diasMes;
    }
    // mk>curMk → futuro, no suma
  }
  return acum/totalPlan*100;
}
/* valor crudo de una columna para orden/filtro */
function colValue(i, key){
  switch(key){
    case 'id':   return i.id;
    case 'desc': return i.desc||'';
    case 'um':   return i.um||'';
    case 'cant': return i.cant||0;
    case 'cajust': return i.cant_ajustada!=null? i.cant_ajustada : -1;
    case 'pu':   return i.pu||0;
    case 'ptot': return i.ptot||0;
    case 'dur':  return itemDur(i)||0;
    case 'ini':  return i.ini||'';
    case 'fin':  return i.fin||'';
    case 'av':   return i.avance_real_prod!=null?i.avance_real_prod:-1;
    case 'avE':  { const e=i.avE!=null?i.avE:itemAvancePlaneado(i); return e!=null?e:-1; }
    case 'cplan': return sumaCronograma(i);
    case 'cejec': { const pr=PROD[i.id]; return pr&&pr.total?pr.total:0; }
    case 'cpend': { const pr=PROD[i.id]; return sumaCronograma(i)-((pr&&pr.total)||0); }
    case 'brecha': { const av=i.avance_real_prod, esp=i.avE!=null?i.avE:itemAvancePlaneado(i);
                     return (av!=null&&esp!=null)?av-esp:-999; }
    case 'inc':  return i.incidencia!=null?i.incidencia:(contratoTotal()? i.ptot/contratoTotal()*100:0);
    default:     return '';
  }
}
/* texto mostrado (para el filtro por substring) */
function colText(i, key){
  const v=colValue(i,key);
  const c=COLS_DEF.find(c=>c.key===key);
  if(c && (c.type==='num'||c.type==='money')) return fmtN(v);
  if(c && c.type==='pct') return v<0?'':fmtN(v);
  return String(v);
}

function visibleItems(){
  let list = ITEMS.filter(i=>!catFilter||i.cat===catFilter);
  // filtro por columna (substring, sin acentos/caso)
  const norm = s => String(s).toLowerCase();
  const hayFiltro = Object.values(COLFILTER).some(t=>t);
  Object.entries(COLFILTER).forEach(([k,txt])=>{
    if(!txt) return; const q=norm(txt);
    list = list.filter(i=>norm(colText(i,k)).includes(q));
  });
  // orden
  if(SORT.key){
    const c=COLS_DEF.find(c=>c.key===SORT.key);
    const numeric = c && (c.type==='num'||c.type==='money'||c.type==='pct');
    list = list.slice().sort((a,b)=>{
      let va=colValue(a,SORT.key), vb=colValue(b,SORT.key);
      if(numeric){ return (va-vb)*SORT.dir; }
      return String(va).localeCompare(String(vb),'es',{numeric:true})*SORT.dir;
    });
  }
  // jerarquía: ocultar filas dentro de grupos colapsados (solo si no se está
  // ordenando/filtrando, porque eso rompe el orden jerárquico).
  if(!SORT.key && !hayFiltro && COLLAPSED.size){
    list = list.filter(i=>!itemOculto(ITEMS.indexOf(i)));
  }
  return list;
}

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

  /* ---- 1) tabla de ítems (columnas configurables) ---- */
  const cols=activeCols();
  const tmpl=gridTemplate();
  const cellHTML=(i,c)=>{
    const est=estadoBadge(i.estado);
    const idx=ITEMS.indexOf(i);
    const grupo=esGrupo(idx);
    const rg = grupo? resumenGrupo(idx) : null;
    const indent=(i.nivel-1)*16;
    switch(c.key){
      case 'id':   return `<div class="idc"><input type="checkbox" class="row-check" data-id="${i.id}" ${SELSET.has(i.id)?'checked':''} title="Seleccionar">${i.id}</div>`;
      case 'desc': {
        const toggle = grupo
          ? `<button class="grp-toggle" data-gid="${i.id}" title="Plegar/desplegar">${COLLAPSED.has(i.id)?'▸':'▾'}</button>`
          : '';
        return `<div class="descc${grupo?' is-group':''}" style="padding-left:${indent}px">
          ${toggle}<input class="ed-desc" data-id="${i.id}" value="${(i.desc||'').replace(/"/g,'&quot;')}" placeholder="Descripción del ítem" title="Clic para seleccionar · ↑↓ moverse · Alt+→/← indentar · doble clic edita el ítem">
          <div class="rowsub"><span class="um-tag">${i.cat}</span> ${est}</div></div>`;
      }
      case 'um':   return grupo? (rg.um? `<div class="num grp-val">${rg.um}</div>` : `<div class="grp-cell"></div>`) : `<div><input class="ed-um" data-id="${i.id}" value="${i.um||''}" placeholder="um"></div>`;
      case 'cant': return grupo? (rg.cant!=null? `<div class="num grp-val">${fmtN(rg.cant)}</div>` : `<div class="grp-cell"></div>`) : `<div><input class="ed-cant" data-id="${i.id}" value="${i.cant||''}" placeholder="0" title="Cantidad de contrato ORIGINAL (licitada) — referencia inmutable"></div>`;
      case 'cajust': {
        if(grupo) return rg.cvig!=null && rg.hayAjuste ? `<div class="num grp-val" style="color:var(--warn,#c9820b)">${fmtN(rg.cvig)}</div>` : `<div class="grp-cell"></div>`;
        const aj = i.cant_ajustada;
        return `<div><input class="ed-cajust${aj!=null?' has-adj':''}" data-id="${i.id}" value="${aj!=null?aj:''}" placeholder="${fmtN(i.cant)}" title="Cantidad ajustada (convenio modificatorio / ajuste de alcance). Vacío = vale la original (${fmtN(i.cant)}). Vaciar la celda revierte al valor de contrato."></div>`;
      }
      case 'pu':   return grupo? `<div class="grp-cell"></div>` : `<div><input class="ed-pu" data-id="${i.id}" value="${i.pu||''}" placeholder="0" title="Precio unitario"></div>`;
      case 'ptot': return grupo? `<div class="num mono2 grp-val">${fmtG(rg.monto)}</div>` : `<div class="num mono2">${fmtG(i.ptot)}</div>`;
      case 'dur':  { if(grupo) return `<div class="num grp-val">${rg.dur!=null?rg.dur:'—'}</div>`;
                     const d=itemDur(i); return `<div><input class="ed-dur" data-id="${i.id}" value="${d!=null?d:''}" placeholder="—" title="Duración en días. Al cambiarla se corre la fecha de fin (el inicio queda fijo)."></div>`; }
      case 'ini':  return grupo? `<div class="num grp-val">${rg.ini||'—'}</div>` : `<div><input class="ed-ini" type="date" data-id="${i.id}" value="${i.ini||''}" title="Fecha de inicio"></div>`;
      case 'fin':  return grupo? `<div class="num grp-val">${rg.fin||'—'}</div>` : `<div><input class="ed-fin" type="date" data-id="${i.id}" value="${i.fin||''}" title="Fecha de fin"></div>`;
      case 'av':   { if(grupo){ if(rg.cant) { const ga=rg.cejec/rg.cant*100; return `<div class="num grp-val${ga>100.5?' over100':''}">${pct(ga)}</div>`; } return `<div class="grp-cell"></div>`; } const a=i.avance_real_prod; return `<div class="num${a!=null&&a>100.5?' over100':''}">${a!=null?pct(a):'—'}</div>`; }
      case 'avE':  { if(grupo) return `<div class="grp-cell"></div>`; const e=i.avE!=null?i.avE:itemAvancePlaneado(i); return `<div class="num" style="color:var(--plan,#4a7fbd)">${e!=null?pct(e):'—'}</div>`; }
      case 'cplan': { if(grupo) return rg.cplan!=null? `<div class="num grp-val">${fmtN(rg.cplan)}</div>` : `<div class="grp-cell"></div>`; return `<div class="num">${fmtN(sumaCronograma(i))}</div>`; }
      case 'cejec': { if(grupo) return rg.cejec!=null? `<div class="num grp-val">${fmtN(rg.cejec)}</div>` : `<div class="grp-cell"></div>`; const pr=PROD[i.id]; return `<div class="num">${pr&&pr.total?fmtN(pr.total):'—'}</div>`; }
      case 'cpend': { if(grupo){ if(rg.cplan!=null){ const gp=rg.cplan-rg.cejec; return `<div class="num grp-val${gp<0?' over100':''}">${fmtN(gp)}</div>`; } return `<div class="grp-cell"></div>`; } const pr=PROD[i.id]; const p=sumaCronograma(i)-((pr&&pr.total)||0);
                      return `<div class="num${p<0?' over100':''}">${fmtN(p)}</div>`; }
      case 'brecha': { if(grupo) return `<div class="grp-cell"></div>`; const av=i.avance_real_prod, esp=i.avE!=null?i.avE:itemAvancePlaneado(i);
                       if(av==null||esp==null) return `<div class="num">—</div>`;
                       const b=av-esp; return `<div class="num" style="color:${b>=0?'var(--ok,#3f9d5a)':'var(--bad)'};font-weight:700">${(b>=0?'+':'')+b.toFixed(1)}%</div>`; }
      case 'inc':  { if(grupo) return `<div class="grp-cell"></div>`; const inc=i.incidencia!=null? i.incidencia : (contratoTotal()? i.ptot/contratoTotal()*100:0); return `<div class="num">${pct(inc)}</div>`; }
      default:     return `<div></div>`;
    }
  };
  $('#ganttGrid').style.width = gridInnerW()+'px';
  const dragOK = !SORT.key && !Object.values(COLFILTER).some(t=>t);   // solo sin orden/filtro
  $('#ganttGrid').innerHTML = list.map(i=>
    `<div class="grow-row" data-id="${i.id}" tabindex="0" style="grid-template-columns:${tmpl}"${dragOK?' draggable="true"':''}>`
    + cols.map(c=>cellHTML(i,c)).join('') + `</div>`
  ).join('') + `<div class="grow-add" id="addItemRow" style="width:${gridInnerW()}px">＋ Agregar ítem</div>`;

  /* header sincronizado (orden + filtro por columna) */
  const gh=$('#gridHeadRow');
  if(gh){
    gh.style.gridTemplateColumns=tmpl;
    gh.style.width=gridInnerW()+'px';
    const vis=visibleItems();
    const allSel = vis.length>0 && vis.every(x=>SELSET.has(x.id));
    gh.innerHTML=cols.map((c,ci)=>{
      const arrow = SORT.key===c.key ? (SORT.dir>0?' ▲':' ▼') : '';
      const filtered=(COLFILTER[c.key]||'')?' filt':'';
      const grip = ci<cols.length-1 ? `<span class="col-grip" data-col="${c.key}" title="Arrastrar para ajustar el ancho"></span>` : '';
      const pre = c.key==='id' ? `<input type="checkbox" id="chkAllRows" ${allSel?'checked':''} title="Seleccionar todos / ninguno">` : '';
      const post = c.key==='desc' ? `<button class="hdr-mini" id="btnColAll" title="Contraer todos los grupos">▸</button><button class="hdr-mini" id="btnExpAll" title="Expandir todos los grupos">▾</button>` : '';
      return `<div class="ghcell${filtered}" data-col="${c.key}">
        ${pre}<span class="ghsort" data-col="${c.key}" title="Ordenar por ${c.label}">${c.label}${arrow}</span>${post}
        <button class="gh-menu${filtered}" data-col="${c.key}" title="Orden y filtro">▾</button>
        ${grip}</div>`;
    }).join('');
    // seleccionar todo / contraer todos / expandir todos
    const chkAll=$('#chkAllRows');
    if(chkAll){
      chkAll.onclick=e=>e.stopPropagation();
      chkAll.onchange=e=>{
        if(e.target.checked) visibleItems().forEach(x=>SELSET.add(x.id));
        else SELSET.clear();
        updateSelBar(); renderGantt();
      };
    }
    $('#btnColAll') && ($('#btnColAll').onclick=e=>{ e.stopPropagation();
      ITEMS.forEach((it,ix)=>{ if(esGrupo(ix)) COLLAPSED.add(it.id); });
      saveCollapsed(); renderGantt(); });
    $('#btnExpAll') && ($('#btnExpAll').onclick=e=>{ e.stopPropagation();
      COLLAPSED.clear(); saveCollapsed(); renderGantt(); });
    // arrastrar el borde del encabezado para redimensionar la columna
    $$('#gridHeadRow .col-grip').forEach(grip=>{
      grip.onmousedown=e=>{
        e.preventDefault(); e.stopPropagation();
        const key=grip.dataset.col;
        const col=COLS_DEF.find(x=>x.key===key);
        const x0=e.clientX, w0=col.w;
        const move=ev=>{ col.w=Math.max(60,Math.min(600,w0+(ev.clientX-x0))); applyColWidths(); };
        const up=()=>{ document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
          try{ localStorage.setItem('obra_colwidths',JSON.stringify(Object.fromEntries(COLS_DEF.map(c=>[c.key,c.w])))); }catch(_){}; renderGantt(); };
        document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
      };
    });
  }

  /* ---- 2) encabezado ---- */
  const totalW = isGrid ? P.length*colw() : body_w();
  if(isGrid){
    $('#timeHead').innerHTML = P.map(p=>{
      const hoy = SCALE==='month' ? p===dstr(TODAY).slice(0,7) : p===isoWeekOf(TODAY);
      return `<div class="tmonth${hoy?' now':''}" style="width:${colw()}px">${periodLabel(p)}<small>${periodSub(p)}</small></div>`;
    }).join('') + `<div class="tmonth addcol" id="addColBtn" title="Agregar período">＋</div>`;
  } else if(SCALE==='week'){
    // Gantt con eje SEMANAL: una columna por semana ISO
    const cols=[]; let cur=new Date(G.x0);
    const dow=(cur.getDay()||7); cur.setDate(cur.getDate()-dow+1);
    while(cur<G.x1){
      const wk=isoWeekOf(cur);
      cols.push([new Date(cur), 7*G.pxDay, wk]);
      cur=addDays(cur,7);
    }
    $('#timeHead').innerHTML = cols.map(([d,w,wk])=>{
      const hoy = wk===isoWeekOf(TODAY);
      return `<div class="tmonth${hoy?' now':''}" style="width:${w}px">${wk.split('-W')[1]}<small>${isoWeekRange(wk)}</small></div>`;
    }).join('') + `<div class="tmonth addcol" id="addColBtn" title="Agregar mes">＋</div>`;
  } else {
    const ms=[]; let cur=new Date(G.x0);
    while(cur<G.x1){const nx=new Date(cur.getFullYear(),cur.getMonth()+1,1);
      ms.push([new Date(cur),daysBetween(cur,nx)*G.pxDay]);cur=nx;}
    $('#timeHead').innerHTML = ms.map(([d,w])=>
      `<div class="tmonth" style="width:${w}px">${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]}<small>${d.getFullYear()}</small></div>`).join('')
      + `<div class="tmonth addcol" id="addColBtn" title="Agregar mes">＋</div>`;
  }
  $('#timeHead').style.width=(totalW+(isGrid?44:0))+'px';
  // realinear el header con el scroll actual (el transform no persiste al re-render)
  { const ts=$('#timeScroll'); if(ts) $('#timeHead').style.transform='translateX('+(-ts.scrollLeft)+'px)'; }

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
      const lines=[];
      if(SCALE==='week'){
        let c=new Date(G.x0); const dw=(c.getDay()||7); c.setDate(c.getDate()-dw+1);
        while(c<G.x1){ lines.push(`<div class="vl" style="left:${gx(c)}px"></div>`); c=addDays(c,7); }
      } else {
        let c=new Date(G.x0);
        while(c<G.x1){ lines.push(`<div class="vl" style="left:${gx(c)}px"></div>`);
          c=new Date(c.getFullYear(),c.getMonth()+1,1); }
      }
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
      const v = ganttMode==='money'? q*i.pu : (ganttMode==='pct'? (cantVigente(i)? q/cantVigente(i)*100:0) : q);
      if(v>maxVal) maxVal=v;
    }));

    list.forEach((i,idx)=>{
      const row=document.createElement('div');
      row.className='trow'+(i.id===selId?' sel':'');
      row.style.top=tops[idx]+'px'; row.style.height=heights[idx]+'px';
      row.style.width=(totalW+(isGrid?44:0))+'px';
      const critc=crit.has(i.id)?' crit':'';

      if(!isGrid){
        const gidx=ITEMS.indexOf(i);
        const grupo=esGrupo(gidx);
        if(grupo){
          // barra RESUMEN del grupo: abarca de la fecha mín a la máx de sus hojas
          const rg=resumenGrupo(gidx);
          if(rg.ini&&rg.fin){
            const a=parseD(rg.ini),b=parseD(rg.fin);
            const x=gx(rg.ini),w=Math.max(6,daysBetween(a,b)*G.pxDay);
            row.innerHTML=`<span class="bar-date bd-l" style="left:${x-4}px">${fmtDM(rg.ini)}</span>
              <div class="bar-group" data-id="${i.id}" style="left:${x}px;width:${w}px">
              <div class="grp-cap grp-cap-l"></div><div class="grp-cap grp-cap-r"></div>
              <div class="lbl">${(i.desc||'').slice(0,30)}</div></div>
              <span class="bar-date" style="left:${x+w+4}px">${fmtDM(rg.fin)}</span>`;
          }
        } else {
          const a=parseD(i.ini),b=parseD(i.fin);
          if(a&&b){
            const x=gx(i.ini),w=Math.max(6,daysBetween(a,b)*G.pxDay);
            const av=i.avance_real_prod!=null?i.avance_real_prod:0;
            const baseHtml=(showBase&&bl&&bl.items[i.id]&&bl.items[i.id].ini)?
              `<div class="bar-base" style="left:${gx(bl.items[i.id].ini)}px;width:${Math.max(6,daysBetween(parseD(bl.items[i.id].ini),parseD(bl.items[i.id].fin))*G.pxDay)}px"></div>`:'';
            row.innerHTML=`${baseHtml}<span class="bar-date bd-l" style="left:${x-4}px">${fmtDM(i.ini)}</span>
              <div class="bar${critc}" data-id="${i.id}" style="left:${x}px;width:${w}px">
              <div class="fill" style="width:${av}%"></div><div class="lbl">${(i.desc||'').slice(0,30)}</div></div>
              <span class="bar-date" style="left:${x+w+4}px">${fmtDM(i.fin)}</span>`;
          }
        }
      } else {
        const gidx=ITEMS.indexOf(i);
        const grupo=esGrupo(gidx);
        if(grupo){
          const hojas=hojasDe(gidx);
          const rgG=resumenGrupo(gidx);
          if(ganttMode==='money'){
            // en vista MONTO el grupo SÍ muestra montos: Σ de sus hojas por período
            row.innerHTML = P.map((p,c)=>{
              const val=hojas.reduce((s,h)=>s+periodQty(h,p)*h.pu,0);
              return `<div class="gcell grp-sum${val?' has':''}" style="left:${c*colw()}px;width:${colw()-1}px"
                title="${SCALE==='month'?monthLabel(p):p} · ${i.desc||''}: ${fmtG(val)}"
              ><span class="gv">${val?fmtMoneyCell(val):''}</span></div>`;
            }).join('');
          } else if(ganttMode==='qty' && rgG.um){
            // en CANTIDAD, si la UM es uniforme (ej. terraplén por progresivas,
            // todo m3), el grupo suma las cantidades de sus hojas por período
            row.innerHTML = P.map((p,c)=>{
              const val=hojas.reduce((s,h)=>s+periodQty(h,p),0);
              return `<div class="gcell grp-sum${val?' has':''}" style="left:${c*colw()}px;width:${colw()-1}px"
                title="${SCALE==='month'?monthLabel(p):p} · ${i.desc||''}: ${fmtN(val)} ${rgG.um}"
              ><span class="gv">${val?fmtN(val):''}</span></div>`;
            }).join('');
          } else {
            // unidades mixtas (o vista %) → fila de grupo rayada, sin suma
            row.innerHTML = P.map((p,c)=>
              `<div class="gcell grp-empty" style="left:${c*colw()}px;width:${colw()-1}px"></div>`).join('');
          }
          body.appendChild(row); return;
        }
        const editable = (ganttMode==='qty'||ganttMode==='pct');   // editable en meses Y semanas
        row.innerHTML = P.map((p,c)=>{
          const q=periodQty(i,p);
          const val = ganttMode==='money'? q*i.pu : (ganttMode==='pct'? (cantVigente(i)? q/cantVigente(i)*100:0) : q);
          const lab = q ? (ganttMode==='money' ? fmtMoneyCell(val)
                        : ganttMode==='pct'   ? val.toFixed(1)+'%'
                        : fmtQty(q)) : '';
          const inR = i.ini&&i.fin && (SCALE==='month'
            ? (p>=String(i.ini).slice(0,7) && p<=String(i.fin).slice(0,7)) : true);
          const fill = q&&maxVal? Math.min(1,val/maxVal):0;
          return `<div class="gcell${editable?' edit':''}${q?' has':''}${inR?' inrange':''}"
            data-id="${i.id}" data-m="${p}"
            style="left:${c*colw()}px;width:${colw()-1}px;--fill:${fill.toFixed(3)}"
            title="${SCALE==='month'?monthLabel(p):p} · ${fmtN(q)} ${i.um||''} · ${(cantVigente(i)?q/cantVigente(i)*100:0).toFixed(1)}% · ${fmtG(q*i.pu)}"
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
        + `<div class="gfcell tot" style="left:${P.length*colw()}px;width:44px" title="Monto TOTAL PLANEADO: ${fmtG(gran)} — Σ de toda la distribución del cronograma × precio unitario. Puede diferir del monto de contrato si no se planea ejecutar todo.">Σ</div>`;
      body.style.height=(totalH+34)+'px';
      $('#footLabel').style.display='flex';
      $('#footLabel').title='Suma de monto por período: Σ (cantidad × precio unitario) · Total planeado: '+fmtG(gran);
    } else {
      if(foot) foot.remove();
      $('#footLabel').style.display='none';
    }

    /* ---- 5) columna de verificación: Σ cronograma vs contrato ---- */
    if(isGrid){
      $('#checkCol').innerHTML = list.map((i,idx)=>{
        const suma=sumaCronograma(i), dif=difContrato(i);
        const ok=Math.abs(dif)<0.005;
        const cls = ok? 'ok' : (Math.abs(dif) <= Math.max(0.05,(cantVigente(i)||0)*0.002) ? 'near':'bad');
        const icon= ok? '✓' : (dif>0? '▲':'▼');
        // en modo Porcentaje la Σ se muestra en %, no en cantidad
        const sumTxt = ganttMode==='pct'
          ? (cantVigente(i)? (suma/cantVigente(i)*100).toFixed(1)+'%' : '—')
          : fmtQty(suma);
        const difTxt = ganttMode==='pct'
          ? (cantVigente(i)? ((dif>0?'+':'')+(dif/cantVigente(i)*100).toFixed(1)+'%') : '')
          : ((dif>0?'+':'')+fmtQty(dif));
        return `<div class="chk ${cls}" data-id="${i.id}" style="height:${heights[idx]}px"
           title="Contrato: ${fmtN(i.cant)} ${i.um||''}&#10;Cronograma: ${fmtN(suma)}&#10;Diferencia: ${dif>0?'+':''}${fmtN(dif)}${ok?'':'&#10;&#10;Clic para ajustar la diferencia en el último mes'}">
          <span class="chk-sum">${sumTxt}</span>
          <span class="chk-ic">${icon}${ok?'':' '+difTxt}</span>
        </div>`;
      }).join('');
      const nOk=list.filter(i=>Math.abs(difContrato(i))<0.005).length;
      const nBad=list.length-nOk;
      $('#checkHead').innerHTML=`Σ Cronograma
        <small>${nOk}/${list.length} cuadran</small>
        ${nBad? `<button class="fixall" id="fixAllBtn" title="Ajustar la diferencia de todos los ítems en su último mes">⚖ Ajustar ${nBad}</button>`:''}`;
    }

    // alinear la columna Σ con el timeline (compensar la barra de scroll horizontal)
    const ts=$('#timeScroll');
    const hsb = ts? (ts.offsetHeight - ts.clientHeight) : 0;
    $('#checkColWrap') && $('#checkColWrap').style.setProperty('--hscroll', hsb+'px');

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

/* ---- menú de columna estilo Excel: orden asc/desc + filtro bajo demanda ----
   El menú se monta en <body> (no dentro del encabezado), así sobrevive a los
   re-renders de la grilla y el filtro en vivo no pierde el foco al escribir. */
function openColMenu(key, rect){
  closeColMenu();
  const c=COLS_DEF.find(x=>x.key===key); if(!c) return;
  const m=document.createElement('div');
  m.className='colmenu'; m.id='colMenu';
  m.innerHTML=`
    <button data-act="asc">▲&nbsp; Ordenar ascendente</button>
    <button data-act="desc">▼&nbsp; Ordenar descendente</button>
    <button data-act="none">✕&nbsp; Quitar orden</button>
    <div class="cm-sep"></div>
    <input id="cmFilter" placeholder="Filtrar ${c.label}…" value="${(COLFILTER[key]||'').replace(/"/g,'&quot;')}">
    <button data-act="clear">Limpiar filtro</button>`;
  document.body.appendChild(m);
  const mw=200;
  m.style.left=Math.max(8, Math.min(rect.left, innerWidth-mw-8))+'px';
  m.style.top=(rect.bottom+4)+'px';
  m.querySelectorAll('button[data-act]').forEach(bt=>bt.onclick=()=>{
    const a=bt.dataset.act;
    if(a==='asc'){ SORT.key=key; SORT.dir=1; }
    else if(a==='desc'){ SORT.key=key; SORT.dir=-1; }
    else if(a==='none'){ SORT.key=null; }
    else if(a==='clear'){ COLFILTER[key]=''; }
    closeColMenu(); renderGantt();
  });
  const inp=m.querySelector('#cmFilter');
  inp.focus(); inp.select();
  inp.oninput=e=>{ COLFILTER[key]=e.target.value;
    clearTimeout(inp._t); inp._t=setTimeout(()=>renderGantt(),200); };
  inp.onkeydown=e=>{ if(e.key==='Enter'||e.key==='Escape') closeColMenu(); };
  setTimeout(()=>document.addEventListener('mousedown', colMenuOutside),0);
}
function colMenuOutside(e){ const m=document.getElementById('colMenu'); if(m && !m.contains(e.target)) closeColMenu(); }
function closeColMenu(){ const m=document.getElementById('colMenu'); if(m){ m.remove(); document.removeEventListener('mousedown', colMenuOutside); } }

function bindGantt(){
  // navegación y jerarquía por teclado sobre la FILA (no el input):
  // ↑/↓ mueven la selección · Alt+→/← indentan/desindentan · Enter edita la descripción
  $$('#ganttGrid .grow-row').forEach(row=>{
    row.addEventListener('keydown',e=>{
      const editando = e.target.matches('input,select,textarea');
      const id=row.dataset.id;
      if((e.key==='ArrowDown'||e.key==='ArrowUp') && !e.altKey && !editando){
        e.preventDefault();
        const rows=[...document.querySelectorAll('#ganttGrid .grow-row')];
        const idx=rows.indexOf(row);
        const next=rows[idx+(e.key==='ArrowDown'?1:-1)];
        if(next){ next.focus(); selectRow(next); }
      }
      else if(e.key==='ArrowRight' && !e.altKey && !editando && ganttMode!=='time'){
        // → desde la fila: entrar a la PRIMERA celda de la grilla derecha
        e.preventDefault();
        const r=GRIDMAP.rows.indexOf(id);
        if(r>=0){ row.blur(); selectRow(null); SEL.anchor=SEL.focus={r,c:0}; paintSel(); }
      }
      else if(e.altKey && (e.key==='ArrowRight'||e.key==='ArrowLeft')){
        e.preventDefault();
        const i=byId[id];
        if(e.key==='ArrowRight') i.nivel=Math.min(3,(i.nivel||1)+1);
        else                     i.nivel=Math.max(1,(i.nivel||1)-1);
        touch(); renderGantt();
        const again=document.querySelector(`#ganttGrid .grow-row[data-id="${id}"]`);
        if(again){ again.focus(); selectRow(again); }
      }
      else if(e.key==='Enter' && !editando){
        e.preventDefault();
        const inp=row.querySelector('.ed-desc'); if(inp){ inp.focus(); inp.select&&inp.select(); }
      }
    });
    row.addEventListener('focus',()=>selectRow(row));
  });
  // drag & drop para reordenar ítems (mueve el grupo con sus hijos)
  let dragId=null;
  $$('#ganttGrid .grow-row[draggable="true"]').forEach(row=>{
    row.addEventListener('dragstart',e=>{
      dragId=row.dataset.id; row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
    });
    row.addEventListener('dragend',()=>{ dragId=null; row.classList.remove('dragging');
      $$('#ganttGrid .grow-row').forEach(r=>r.classList.remove('drop-above','drop-below')); });
    row.addEventListener('dragover',e=>{
      e.preventDefault();
      const r=e.currentTarget.getBoundingClientRect();
      const below=(e.clientY-r.top)>r.height/2;
      $$('#ganttGrid .grow-row').forEach(x=>x.classList.remove('drop-above','drop-below'));
      row.classList.add(below?'drop-below':'drop-above');
    });
    row.addEventListener('drop',e=>{
      e.preventDefault();
      const targetId=row.dataset.id;
      const r=row.getBoundingClientRect();
      const below=(e.clientY-r.top)>r.height/2;
      moverItem(dragId, targetId, below);
    });
  });
  // checkboxes de selección múltiple
  $$('#ganttGrid .row-check').forEach(chk=>{
    chk.onclick=e=>e.stopPropagation();
    chk.onchange=e=>toggleSel(e.target.dataset.id, e.target.checked);
  });
  // botón plegar/desplegar de grupos
  $$('#ganttGrid .grp-toggle').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const gid=b.dataset.gid;
    if(COLLAPSED.has(gid)) COLLAPSED.delete(gid); else COLLAPSED.add(gid);
    saveCollapsed(); renderGantt();
  });
  $$('#ganttGrid .grow-row').forEach(r=>r.onclick=e=>{
    if(e.target.closest('input,select,button')) return;
    r.focus(); selectRow(r);            // un clic selecciona (para navegar con ↑↓ / Alt+←→)
  });
  $('#addItemRow') && ($('#addItemRow').onclick=addItem);
  $('#addColBtn') && ($('#addColBtn').onclick=addPeriod);
  $('#fixAllBtn') && ($('#fixAllBtn').onclick=e=>{ e.stopPropagation(); ajustarTodos(); });
  // clic en una fila de la Σ que no cuadra → ajusta ese ítem
  $$('#checkCol .chk.bad, #checkCol .chk.near').forEach(el=>el.onclick=()=>{
    const i=byId[el.dataset.id]; if(!i) return;
    if(ajustarDif(i)){ touch(); renderGantt(); renderKPIs();
      toast(`Ítem <b>${i.id}</b> ajustado — la diferencia se aplicó al último mes`); }
  });
  // edición directa en la tabla de ítems
  $$('#ganttGrid .ed-desc').forEach(inp=>{
    inp.onchange=e=>{ byId[e.target.dataset.id].desc=e.target.value; touch(); };
    // dentro del input: ↑↓ saltan de ítem, Alt+←→ indentan (sin perder el flujo)
    inp.onkeydown=e=>{
      const id=e.target.dataset.id;
      if((e.key==='ArrowDown'||e.key==='ArrowUp') && !e.altKey){
        e.preventDefault();
        const rows=[...document.querySelectorAll('#ganttGrid .grow-row')];
        const idx=rows.findIndex(r=>r.dataset.id===id);
        const next=rows[idx+(e.key==='ArrowDown'?1:-1)];
        if(next){ e.target.blur(); next.focus(); selectRow(next); }
      } else if(e.altKey && (e.key==='ArrowRight'||e.key==='ArrowLeft')){
        e.preventDefault();
        const i=byId[id];
        if(e.key==='ArrowRight') i.nivel=Math.min(3,(i.nivel||1)+1);
        else                     i.nivel=Math.max(1,(i.nivel||1)-1);
        touch(); renderGantt();
        const again=document.querySelector(`#ganttGrid .grow-row[data-id="${id}"]`);
        if(again){ again.focus(); selectRow(again); }
      }
    };
  });
  $$('#ganttGrid .ed-um').forEach(inp=>inp.onchange=e=>{
    byId[e.target.dataset.id].um=e.target.value; touch(); renderGantt(); });
  $$('#ganttGrid .ed-cant').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; i.cant=parseNum(e.target.value);
    // solo cambia el contrato original. La distribución del cronograma queda como está;
    // el semáforo de la derecha muestra si cuadra o no.
    touch(); renderGantt(); renderKPIs(); });
  // cantidad AJUSTADA (convenio modificatorio): vacío = revertir a la original.
  // Al fijarla, el cronograma se redistribuye contra la nueva cantidad VIGENTE
  // RESPETANDO los meses cargados a mano (misma regla que la cantidad de contrato).
  $$('#ganttGrid .ed-cajust').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id];
    const raw=String(e.target.value).trim();
    i.cant_ajustada = raw==='' ? null : parseNum(raw);
    if(i.ini && i.fin) redistributeMonths(i, true);   // respeta manuales
    MONTHS=computeMonths();
    touch(); renderGantt(); renderKPIs();
    toast(i.cant_ajustada!=null
      ? `Cantidad ajustada de <b>${i.id}</b>: ${fmtN(i.cant_ajustada)} ${i.um||''} (original ${fmtN(i.cant)})`
      : `Ítem <b>${i.id}</b> vuelve a su cantidad de contrato: ${fmtN(i.cant)} ${i.um||''}`);
  });
  // precio unitario editable → recalcula ptot (getter) y monto de contrato
  $$('#ganttGrid .ed-pu').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; i.pu=parseNum(e.target.value);
    touch(); renderGantt(); renderKPIs(); });
  // duración editable → corre la fecha de FIN, deja el inicio fijo, reajusta Gantt
  $$('#ganttGrid .ed-dur').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; const d=Math.max(1,Math.round(parseNum(e.target.value)));
    if(!i.ini){ toast('Definí primero la fecha de inicio'); renderGantt(); return; }
    const a=parseD(i.ini); const b=new Date(a); b.setDate(b.getDate()+d-1);
    i.fin=dstr(b);
    syncWeeksFromMonths(i);          // realinea semanas al nuevo rango
    touch(); renderGantt(); renderKPIs(); });
  // fechas editables directamente en la tabla
  $$('#ganttGrid .ed-ini').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; const v=e.target.value;
    if(v && i.fin && parseD(v)>parseD(i.fin)) i.fin=v;   // no dejar fin < inicio
    i.ini=v||i.ini; syncWeeksFromMonths(i);
    touch(); renderGantt(); renderKPIs(); });
  $$('#ganttGrid .ed-fin').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; const v=e.target.value;
    if(v && i.ini && parseD(v)<parseD(i.ini)){ toast('El fin no puede ser anterior al inicio'); renderGantt(); return; }
    i.fin=v||i.fin; syncWeeksFromMonths(i);
    touch(); renderGantt(); renderKPIs(); });
  // orden por columna (clic en el nombre)
  $$('#gridHeadRow .ghsort').forEach(s=>s.onclick=e=>{
    const k=e.currentTarget.dataset.col;
    if(SORT.key===k) SORT.dir=-SORT.dir; else { SORT.key=k; SORT.dir=1; }
    renderGantt(); });
  // menú de columna estilo Excel (▾): orden + filtro bajo demanda
  $$('#gridHeadRow .gh-menu').forEach(b=>{
    b.onclick=e=>{ e.stopPropagation(); openColMenu(b.dataset.col, b.getBoundingClientRect()); };
  });
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
  i._pctBase = cantVigente(i)||0;               // base fija para el % (cantidad vigente)
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
    if(!isNaN(v)){
      if(SCALE==='week') setWeekQty(i, m, isPct? (cantVigente(i)||0)*v/100 : v);
      else               isPct? setMonthPct(i,m,v) : setMonthQty(i,m,v);
    }
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
    case 'ArrowLeft':
      if(SEL.focus.c===0){
        // desde la primera celda de la grilla → saltar a la FILA de la izquierda
        const rowId=GRIDMAP.rows[SEL.focus.r];
        const row=document.querySelector(`#ganttGrid .grow-row[data-id="${rowId}"]`);
        if(row){ SEL.anchor=SEL.focus=null; paintSel(); row.focus(); selectRow(row); e.preventDefault(); break; }
      }
      mv(0,-1); break;
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
    if(isPct) i._pctBase=cantVigente(i)||0;
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
  const it={id:String(maxId+1),desc:'Nuevo ítem',codigo_cc:'',um:'un',cant:0,cant_ajustada:null,pu:0,
    get ptot(){return cantVigente(this)*this.pu;},incidencia:null,avE:null,
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
/* ---- selección múltiple + borrado en lote ---- */
let SELSET=new Set();
function toggleSel(id, on){
  if(on) SELSET.add(id); else SELSET.delete(id);
  updateSelBar();
}
function clearSel(){ SELSET.clear(); updateSelBar(); renderGantt(); }
function updateSelBar(){
  const bar=$('#selBar'); if(!bar) return;
  const n=SELSET.size;
  bar.style.display = n? 'flex' : 'none';
  const lab=$('#selBarLabel'); if(lab) lab.textContent = n+(n===1?' ítem seleccionado':' ítems seleccionados');
}
function deleteSelected(){
  const ids=[...SELSET];
  if(!ids.length) return;
  // incluir hijos de grupos seleccionados (al borrar un grupo, se borran sus hijos)
  const aBorrar=new Set(ids);
  ids.forEach(id=>{
    const idx=ITEMS.findIndex(i=>i.id===id);
    if(idx>=0 && esGrupo(idx)) hijosDe(idx).forEach(h=>aBorrar.add(h.id));
  });
  const n=aBorrar.size;
  if(!confirm(`¿Eliminar ${n} ítem${n>1?'s':''}? Esta acción no se puede deshacer.`)) return;
  ITEMS=ITEMS.filter(i=>!aBorrar.has(i.id));
  ITEMS.forEach(i=>{i.deps=(i.deps||[]).filter(d=>!aBorrar.has(d.id));});
  SELSET.clear();
  reindex(); MONTHS=computeMonths(); closeDrawer(); touch(); renderGantt(); renderKPIs();
  updateSelBar();
  toast(n+' ítem'+(n>1?'s eliminados':' eliminado'));
}
/* ===================== DRAWER (scrollable, full editor) ================= */
const ESTADOS=['Pendiente','En proceso','Listo','Estancado','Eliminado'];
function openDrawer(id){
  selId=id; const i=byId[id]; if(!i){closeDrawer();return;}
  const dw=$('#drawer');
  const months=Object.keys(i.dist_mensual||{}).sort();
  const maxq=Math.max(1,...months.map(m=>i.dist_mensual[m]||0));
  const prod=PROD[i.id];
  const avProd=i.avance_real_prod!=null?i.avance_real_prod:(prod&&cantVigente(i)?prod.total/cantVigente(i)*100:null);
  const wkList=WEEKLY.filter(w=>w.item_id===i.id);
  const incid = i.incidencia!=null? i.incidencia*100 : (contratoTotal()? i.ptot/contratoTotal()*100:0);

  // dependency rows (con offset ±días: FS+2, SS-1, etc.)
  const depRows=(i.deps||[]).map((d,k)=>{
    const p=byId[d.id];
    return `<div class="deprow" data-k="${k}">
      <select class="dep-item">${ITEMS.filter(x=>x.id!==i.id).map(x=>`<option value="${x.id}" ${x.id===d.id?'selected':''}>${x.id} · ${(x.desc||'').slice(0,26)}</option>`).join('')}</select>
      <select class="dep-type">${Object.entries(DEP_TYPES).map(([t,l])=>`<option value="${t}" ${t===d.type?'selected':''}>${t}</option>`).join('')}</select>
      <span class="dep-lag-wrap" title="Desfase en días: positivo retrasa, negativo adelanta (ej. FS+2 arranca 2 días después de que termina el predecesor)">
        <input class="dep-lag" type="number" step="1" value="${d.lag||0}"><small>d</small></span>
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
      <div class="dsec">Jerarquía</div>
      <div class="dfield"><label>Nivel de indentación (1 = raíz)</label>
        <div class="row2" style="align-items:center;gap:8px">
          <button class="minibtn" id="dOutdent" title="Subir nivel (◄)" ${i.nivel<=1?'disabled':''}>◄</button>
          <span class="mono2" id="dNivelLab" style="min-width:70px;text-align:center">Nivel ${i.nivel}</span>
          <button class="minibtn" id="dIndent" title="Bajar nivel (►)" ${i.nivel>=3?'disabled':''}>►</button>
          <label style="margin-left:auto;font-size:11px;display:flex;align-items:center;gap:5px;cursor:pointer">
            <input type="checkbox" id="dEsGrupo" ${esGrupo(ITEMS.indexOf(i))?'checked':''}> Es grupo/título</label>
        </div>
        <div class="hint" style="margin-top:3px">Un grupo no lleva cantidad; en el Gantt resume fechas y monto de sus ítems hijos.</div>
      </div>

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
        <div class="dfield"><label>Cantidad contrato (original)</label><input type="number" id="dCant" value="${i.cant}"></div>
        <div class="dfield"><label>Precio unitario (Gs)</label><input type="number" id="dPu" value="${i.pu}"></div>
      </div>
      <div class="dfield"><label>Cantidad ajustada <span class="hint" style="font-weight:400">(convenio modificatorio · vacío = usa la original)</span></label>
        <input type="number" id="dCajust" value="${i.cant_ajustada!=null?i.cant_ajustada:''}" placeholder="${fmtN(i.cant)} (sin ajuste)"></div>
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
    const ajRaw=String($('#dCajust').value).trim();
    const cvig = ajRaw==='' ? c : (+ajRaw||0);   // vigente = ajustada si hay, si no la original
    $('#dMonto').textContent=fmtG(cvig*p);
    const others=ITEMS.filter(x=>x.id!==i.id).reduce((s,x)=>s+x.ptot,0);
    const tot=others+cvig*p; $('#dIncid').textContent=(tot?cvig*p/tot*100:0).toFixed(2)+'%';
  };
  $('#dCant').oninput=recompute; $('#dPu').oninput=recompute; $('#dCajust').oninput=recompute;

  // jerarquía: indentar/desindentar y marcar grupo
  $('#dIndent') && ($('#dIndent').onclick=()=>{ i.nivel=Math.min(3,(i.nivel||1)+1); touch(); renderGantt(); openDrawer(id); });
  $('#dOutdent') && ($('#dOutdent').onclick=()=>{ i.nivel=Math.max(1,(i.nivel||1)-1); touch(); renderGantt(); openDrawer(id); });
  $('#dEsGrupo') && ($('#dEsGrupo').onchange=e=>{ i.es_grupo=e.target.checked; touch(); renderGantt(); openDrawer(id); });

  // inline month qty/pct editing inside drawer
  $$('#dwrap .dm-qty, .dm-editor .dm-qty').forEach(inp=>inp.onchange=e=>{
    setMonthQty(i,e.target.dataset.m,+e.target.value||0); renderGantt(); openDrawer(id);
  });
  $$('.dm-editor .dm-pct').forEach(inp=>inp.onchange=e=>{
    setMonthPct(i,e.target.dataset.m,+e.target.value||0); renderGantt(); openDrawer(id);
  });

  // dependency add/edit/remove
  $('#addDep').onclick=()=>{ i.deps=i.deps||[]; const first=ITEMS.find(x=>x.id!==i.id);
    if(first){i.deps.push({id:first.id,type:'FS',lag:0}); cascade(i); openDrawer(id);} };
  $$('#depBox .deprow').forEach(rw=>{
    const k=+rw.dataset.k;
    rw.querySelector('.dep-item').onchange=e=>{i.deps[k].id=e.target.value; cascade(i); touch(); renderGantt();};
    rw.querySelector('.dep-type').onchange=e=>{i.deps[k].type=e.target.value; cascade(i); touch(); renderGantt();};
    const lag=rw.querySelector('.dep-lag');
    if(lag) lag.onchange=e=>{ i.deps[k].lag=Math.round(parseNum(e.target.value))||0; cascade(i); touch(); renderGantt(); renderKPIs(); };
    rw.querySelector('.dep-del').onclick=()=>{i.deps.splice(k,1); cascade(i); openDrawer(id);};
  });

  // category manager
  $('#catMgr').onclick=()=>openCatManager(id);

  if(prod) drawSpark(prod.by_date);

  $('#dSave').onclick=()=>{
    i.desc=$('#dDesc').value; i.codigo_cc=$('#dCC').value; i.um=$('#dUM').value;
    i.ini=$('#dIni').value; i.fin=$('#dFin').value;
    i.cat=$('#dCat').value; i.estado=$('#dEstado').value;
    i.cant=+$('#dCant').value||0; i.pu=+$('#dPu').value||0;
    const ajRaw=String($('#dCajust').value).trim();
    i.cant_ajustada = ajRaw==='' ? null : (+ajRaw||0);
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
  const hoy=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());
  let planTo=0,planTot=0,prod=0;
  ITEMS.forEach(i=>{
    const base=i.ptot;                 // monto total del ítem (cant × pu)
    planTot+=base;
    // avance planeado a la fecha = según la DISTRIBUCIÓN MENSUAL del cronograma
    // (curva S), no lineal. Coincide con la curva del informe y con Power BI.
    if(base){
      const fp=itemAvancePlaneado(i);
      if(fp!=null) planTo+=base*(fp/100);
    }
    // monto producido = cantidad ejecutada REAL (suma de liberaciones, con todos
    // los decimales) × precio unitario. No se usa el % de avance (viene redondeado
    // a 2 decimales y perdería precisión al reconstruir el monto).
    const pr=PROD[i.id];
    if(pr && pr.total){
      prod += pr.total * i.pu;
    } else if(i.avance_real_prod!=null){
      prod += base * (i.avance_real_prod/100);   // respaldo si no hay detalle de producción
    }
  });
  const contratoOrig = contratoOriginalTotal();   // monto licitado (cant original × pu)
  const hayAjustes = ITEMS.some(tieneAjuste);
  const avPlan=planTot?planTo/planTot*100:0, avProd=contrato?prod/contrato*100:0;
  // semana ISO ACTUAL (de hoy), no la última del cronograma
  const wk=isoWeekOf(TODAY);
  // monto total PLANEADO = Σ (cant. planeada × pu). Puede diferir del contrato
  // si no se planea ejecutar todo (o si se planea de más).
  const montoPlan=ITEMS.reduce((s,i)=>s+sumaCronograma(i)*i.pu,0);
  // "contrato" (=contratoTotal, ya usa cantidad vigente) es el monto AJUSTADO vigente.
  const K=[
    ['Monto contrato',fmtG(contratoOrig),'tape',ITEMS.length+' ítems · original'],
  ];
  if(hayAjustes){
    const dif=contrato-contratoOrig;
    K.push(['Monto ajustado',fmtG(contrato),'warn',
      (dif>=0?'+':'')+fmtG(dif).replace('₲ ','₲')+' vs contrato']);
  }
  K.push(
    ['Monto planeado',fmtG(montoPlan),'plan',montoPlan&&contrato?((montoPlan/contrato*100).toFixed(1)+'% del vigente'):'Σ cronograma × PU'],
    ['Monto producido',fmtG(prod),'cyan','avance físico real'],
    ['Avance planeado',pct(avPlan),'plan','a la fecha'],
    ['Avance producido',pct(avProd),'','físico'],
    ['Brecha',(avProd-avPlan>=0?'+':'')+(avProd-avPlan).toFixed(1)+'%',avProd-avPlan>=0?'pos':'neg',avProd-avPlan>=0?'adelantado':'atrasado'],
    ['Actividades semana',String(WEEKLY.filter(w=>w.week===wk).length),'',(wk||'—').replace('-',' ')]
  );
  $('#kpiStrip').innerHTML=K.map(([l,v,c,s])=>{
    const cls=c==='tape'?'tape':c==='cyan'?'cyan':c==='plan'?'plan':c==='warn'?'warn':'';
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
/* Cuánto de un ítem ya está programado en semanas PARA un mes dado.
   Usa el prorrateo (Regla B): una semana que cruza dos meses aporta a cada
   uno según los días que le corresponden, no entera al mes de su jueves.
   Este era el bug del "saldo" siempre negativo. */
function plannedInMonth(itemId, monthKey){
  return +WEEKLY.filter(w=>w.item_id===itemId)
    .reduce((s,w)=>s+aporteMes(w,monthKey),0).toFixed(3);
}

/* ¿los meses que toca esta semana están cuadrados? (para colorear el selector) */
function semanaDesbalanceada(wk){
  const meses=mesesDeSemana(wk);
  return meses.some(mk=>ITEMS.some(i=>{
    const plan=(i.dist_mensual||{})[mk]||0;
    if(Math.abs(plan)===0) return false;
    return Math.abs(plan - plannedInMonth(i.id,mk)) > 0.005;
  }));
}
function llenarSelectorSemanas(){
  const sel=$('#wkSelect'); if(!sel) return;
  const hoy=isoWeekOf(TODAY);
  sel.innerHTML=ALLWEEKS.map((w,k)=>{
    const bad=semanaDesbalanceada(w);
    const n=WEEKLY.filter(x=>x.week===w).length;
    const mark = bad? '⚠ ' : '';
    const hoyMark = w===hoy? ' · HOY' : '';
    return `<option value="${k}" ${k===weeklyIdx?'selected':''} class="${bad?'wopt-bad':''}">
      ${mark}${isoWeekRange(w)} · ${w.split('-')[1]} ${w.split('-')[0]}${hoyMark} (${n})</option>`;
  }).join('');
}

function renderWeekly(){
  const wk=ALLWEEKS[weeklyIdx];
  $('#wkLab').textContent=wk?isoWeekRange(wk):'—';
  $('#wkRange').textContent=wk?(wk.split('-')[1]+' · '+wk.split('-')[0]):'';
  llenarSelectorSemanas();
  const desbal = wk? semanaDesbalanceada(wk):false;
  $('#wkPick') && $('#wkPick').classList.toggle('bad', desbal);
  const fr=$('#frenteFilter'); const frentes=[...new Set(WEEKLY.map(w=>w.frente).filter(Boolean))].sort();
  if(fr.options.length<=1) frentes.forEach(f=>fr.add(new Option(f,f)));
  const frFilter=fr.value;

  // filas de esta semana, ordenadas por ítem (una por ítem+semana)
  let rows=WEEKLY.filter(w=>w.week===wk&&(!frFilter||w.frente===frFilter))
    .sort((a,b)=>(parseInt(a.item_id)||0)-(parseInt(b.item_id)||0));

  // ¿qué meses toca esta semana? (puede ser 1 o 2)
  const mesesSemana = wk? mesesDeSemana(wk) : [];
  const mKey = weekMonthKey(wk);                 // mes principal (para el panel)
  const cruza = mesesSemana.length>1;
  $('#wkCross').innerHTML = cruza
    ? `<span class="cross">Semana a caballo entre <b>${mesesSemana.map(m=>monthLabel(m)).join('</b> y <b>')}</b> — las cantidades se prorratean por días para certificación</span>`
    : '';

  /* ---- panel del plan mensual: SOLO los que no cuadran o tienen saldo ---- */
  const monthItems=ITEMS.filter(i=>Math.abs((i.dist_mensual||{})[mKey]||0)>0);
  const desc=monthItems.map(i=>{
    const planM=i.dist_mensual[mKey]||0;
    const usado=plannedInMonth(i.id,mKey);
    const saldo=+(planM-usado).toFixed(2);
    return {i,planM,usado,saldo,ok:Math.abs(saldo)<=0.005};
  });
  const desbalanceados=desc.filter(d=>!d.ok);
  const nOk=desc.length-desbalanceados.length;

  $('#wkMonth').innerHTML = !desc.length
    ? `<div class="wm-empty">Sin ítems con plan mensual en ${wk?monthLabel(mKey):'—'}.</div>`
    : `<div class="wm-head">
        Plan mensual de <b>${monthLabel(mKey)}</b> ·
        <span class="wm-ok">${nOk}/${desc.length} cuadran</span>
        ${desbalanceados.length? `<span class="wm-warn">${desbalanceados.length} con saldo</span>`:''}
        <button class="wm-toggle" id="wmToggle">${WM_ALL?'ver solo los que no cuadran':'ver todos'}</button>
      </div>
      <div class="wm-grid">${(WM_ALL?desc:desbalanceados).map(d=>{
        const {i,planM,usado,saldo,ok}=d;
        const pctUsed=planM?Math.min(100,usado/planM*100):0;
        const sc = ok? 'full' : (saldo<0? 'over':'under');
        return `<div class="wm-card ${sc}" data-id="${i.id}" title="Clic para agregar a esta semana&#10;Plan del mes: ${fmtN(planM)}&#10;Programado: ${fmtN(usado)}">
          <div class="wm-t">${i.id} · ${(i.desc||'').slice(0,26)}</div>
          <div class="wm-bar"><i style="width:${pctUsed}%"></i></div>
          <div class="wm-n"><span>plan ${fmtN(planM, Math.abs(planM)<10?2:0)} ${i.um||''}</span>
            ${ok? '<b class="ok">✓</b>'
                : `<b>${saldo>0?'+':''}${fmtN(saldo, Math.abs(saldo)<10?2:0)}</b>`}</div>
        </div>`;
      }).join('')}</div>
      ${(!WM_ALL && !desbalanceados.length)? '<div class="wm-allok">✓ Todos los ítems del mes están completamente programados</div>':''}`;
  $('#wmToggle') && ($('#wmToggle').onclick=()=>{ WM_ALL=!WM_ALL; renderWeekly(); });

  let tp=0,te=0,mp=0,me=0,done=0;
  $('#wkBody').innerHTML=rows.map((w,k)=>{
    const it=byId[w.item_id];const pu=it?it.pu:0;
    const prev=w.cant_prevista||0,ejec=w.cant_ejecutada||0;
    const cp=prev?Math.min(200,ejec/prev*100):(ejec?100:0);
    tp+=prev;te+=ejec;mp+=prev*pu;me+=ejec*pu;if(cp>=99.5)done++;
    const cls=cp>=99?'':cp>=70?'mid':'lo';

    // saldo del mes para este ítem: solo se muestra si NO cuadra
    const planM=it?(it.dist_mensual||{})[mKey]||0:0;
    const usado=plannedInMonth(w.item_id,mKey);
    const saldo=+(planM-usado).toFixed(2);
    const cuadra=Math.abs(saldo)<=0.005;
    const saldoCell = (!planM)? '<span class="sal-none">—</span>'
      : cuadra ? '<span class="sal-ok" title="El mes está completamente programado">✓</span>'
      : `<span class="sal-${saldo<0?'over':'under'}" title="Plan del mes: ${fmtN(planM)}&#10;Programado: ${fmtN(usado)}">${saldo>0?'+':''}${fmtN(saldo, Math.abs(saldo)<10?2:0)}</span>`;

    // desglose si la semana cruza meses
    const split = w.mesSplit && Object.keys(w.mesSplit).length>1
      ? `<div class="wsplit">${Object.entries(w.mesSplit).sort()
          .map(([m,v])=>`<span>${monthLabel(m)}: <b>${fmtN(v, Math.abs(v)<1?3:(Math.abs(v)<100?2:1))}</b></span>`).join('')}</div>` : '';

    const itemOpts=ITEMS.map(x=>`<option value="${x.id}" ${x.id===w.item_id?'selected':''}>${x.id} · ${(x.desc||'').slice(0,30)}</option>`).join('');
    return `<tr data-k="${k}">
      <td><select class="wk-item" data-k="${k}">${itemOpts}</select></td>
      <td><input class="wk-act" data-k="${k}" value="${(w.actividad||'').replace(/"/g,'&quot;')}" placeholder="Descripción">${split}</td>
      <td><input class="wk-frente" data-k="${k}" value="${(w.frente||'').replace(/"/g,'&quot;')}" placeholder="Frente"></td>
      <td class="mono">${w.um||it?.um||''}</td>
      <td class="r"><input class="qty-in" data-f="prev" data-k="${k}" value="${prev? +prev.toFixed(2):''}"></td>
      <td class="r ejec-ro" title="Viene del formulario de liberación">${ejec?fmtN(ejec):'—'}</td>
      <td class="r">${prev?pct(cp):'—'}</td>
      <td><select class="cause-sel" data-k="${k}">${CAUSES.map(c=>`<option ${w.causa===c?'selected':''}>${c}</option>`).join('')}</select></td>
      <td class="r">${saldoCell}</td>
      <td><button class="wk-del" data-k="${k}" title="Quitar">×</button></td>
    </tr>`;
  }).join('')||`<tr><td colspan="10" style="text-align:center;color:#8a8578;padding:20px">Sin actividades esta semana.</td></tr>`;

  $('#wkTotPrev').textContent=fmtN(tp);$('#wkTotEjec').textContent=fmtN(te);
  $('#wkTotPct').textContent=tp?pct(te/tp*100):'—';
  const ppc=rows.length?Math.round(done/rows.length*100):0;
  $('#ppcVal').textContent=ppc+'%';$('#ppcRing').style.setProperty('--p',ppc);
  $('#ppcDone').textContent=done;$('#ppcPlan').textContent=rows.length;
  $('#ppcMonto').textContent=mp?pct(me/mp*100).replace('%','')+'% · '+fmtG(me):'₲ 0';

  /* ---- bindings ---- */
  $$('#wkBody .qty-in').forEach(inp=>inp.onchange=e=>{
    const w=rows[+e.target.dataset.k];
    const nuevo=parseNum(e.target.value);
    // MANUAL: se respeta la cantidad; el reparto entre meses se reescala
    const total=+Object.values(w.mesSplit||{}).reduce((s,v)=>s+v,0).toFixed(3);
    if(w.mesSplit && total>0){
      const f=nuevo/total; const rs={};
      Object.entries(w.mesSplit).forEach(([m,v])=>rs[m]=+(v*f).toFixed(3));
      w.mesSplit=rs;
    }
    w.cant_prevista=nuevo; w._man=true;
    syncMonthsFromWeeks(w.item_id);       // propaga al mes → la Σ se actualiza
    touch(); renderWeekly(); renderKPIs();
  });
  $$('#wkBody .wk-item').forEach(s=>s.onchange=e=>{
    const w=rows[+e.target.dataset.k]; w.item_id=e.target.value; const it=byId[w.item_id];
    if(it){ w.um=it.um; if(!w.actividad) w.actividad=it.desc; }
    w._man=true; touch('weekly'); renderWeekly();
  });
  $$('#wkBody .wk-act').forEach(inp=>inp.onchange=e=>{rows[+e.target.dataset.k].actividad=e.target.value;touch('weekly');});
  $$('#wkBody .wk-frente').forEach(inp=>inp.onchange=e=>{rows[+e.target.dataset.k].frente=e.target.value;touch('weekly');});
  $$('#wkBody .cause-sel').forEach(s=>s.onchange=e=>{rows[+e.target.dataset.k].causa=e.target.value;touch('weekly');});
  $$('#wkBody .wk-del').forEach(btn=>btn.onclick=e=>{
    const w=rows[+e.target.dataset.k]; if(w.plan_id) deletedWeekly.push(w.plan_id);
    WEEKLY=WEEKLY.filter(x=>x!==w); touch('weekly'); renderWeekly(); renderKPIs();
  });
  $$('#wkMonth .wm-card').forEach(c=>c.onclick=()=>addWeeklyActivity(c.dataset.id));
}
let WM_ALL=false;    // panel mensual: false = solo los que no cuadran

/* meses que toca una semana ISO (1 ó 2) */
function mesesDeSemana(wk){
  const [mon,sun]=weekMondaySunday(wk);
  const s=new Set();
  for(let d=new Date(mon); d<=sun; d.setDate(d.getDate()+1)) s.add(d.toISOString().slice(0,7));
  return [...s].sort();
}

/* add a weekly activity; if itemId given, seed with the item's remaining monthly saldo */
function addWeeklyActivity(itemId){
  const wk=ALLWEEKS[weeklyIdx]; if(!wk){toast('Elegí una semana primero');return;}
  const mKey=weekMonthKey(wk);
  const it = itemId? byId[itemId] : ITEMS[0];
  if(!it) return;

  // si el ítem YA tiene una fila en esta semana, no duplicamos: la completamos
  const ya=WEEKLY.find(w=>w.item_id===it.id && w.week===wk);
  const planM=(it.dist_mensual||{})[mKey]||0;
  const usado=plannedInMonth(it.id,mKey);
  const saldo=Math.max(0,+(planM-usado).toFixed(2));
  if(ya){
    if(saldo>EPS){
      ya.cant_prevista=+((ya.cant_prevista||0)+saldo).toFixed(2);
      ya.mesSplit=Object.assign({},ya.mesSplit||{},
        {[mKey]:+((ya.mesSplit&&ya.mesSplit[mKey]||0)+saldo).toFixed(3)});
      ya._man=true;
      touch('weekly'); renderWeekly(); renderKPIs();
      toast(`Se agregó el saldo (${fmtN(saldo,0)} ${it.um||''}) a la fila existente de <b>${it.id}</b>`);
    } else toast(`El ítem <b>${it.id}</b> ya está completo en ${monthLabel(mKey)}`);
    return;
  }
  WEEKLY.push({
    item_id: it.id, actividad: it.desc, frente:'', um: it.um,
    week: wk, month: mKey, mesSplit: saldo>EPS? {[mKey]:saldo} : {},
    cant_prevista: saldo, cant_ejecutada: null,
    causa:'Sin observaciones', _man:true,
  });
  touch('weekly'); renderWeekly(); renderKPIs();
  toast(`Actividad de <b>${it.id}</b> agregada · saldo del mes: ${fmtN(saldo,0)} ${it.um||''}`);
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
  // producido: cantidad ejecutada real × pu (máxima precisión, igual que el KPI global)
  const prodTotal=ITEMS.reduce((s,i)=>{const pr=PROD[i.id];return s+((pr&&pr.total)?pr.total*i.pu:(i.avance_real_prod!=null?i.ptot*i.avance_real_prod/100:0));},0);
  // "certificado/esperado" del gráfico: avance planeado por días (o avE manual si existe)
  const certTotal=ITEMS.reduce((s,i)=>{const e=i.avE!=null?i.avE:itemAvancePlaneado(i);return s+(e!=null?i.ptot*e/100:0);},0);
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
  let yaxis='';for(let v=0;v<=ymax;v+=(ymax<=30?5:10)){yaxis+=`<line x1="${padL}" y1="${ys(v)}" x2="${W-padR}" y2="${ys(v)}" stroke="#e2e7ee" stroke-width="1"/><text x="${padL-6}" y="${ys(v)+3}" text-anchor="end" font-size="9" fill="#8794a6" font-family="var(--mono)">${v}%</text>`;}
  let xaxis='';MONTHS.forEach((m,k)=>{if(k%2===0)xaxis+=`<text x="${xs(k)}" y="${H-8}" text-anchor="middle" font-size="8.5" fill="#8794a6">${monthLabel(m)}</text>`;});
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

  // KPIs del informe
  const nItems=ITEMS.filter(i=>i.ptot>0).length;
  const sobre=ITEMS.filter(i=>i.avance_real_prod!=null&&i.avance_real_prod>100.5);
  const conAvance=ITEMS.filter(i=>i.avance_real_prod!=null&&i.avance_real_prod>0);
  const brechaGlobal=prodNow-certNow;
  const kpis=[
    ['Monto producido',fmtG(prodTotal),'tape'],
    ['Avance producido',pct(prodNow),'tape'],
    ['Avance esperado',pct(certNow),'plan'],
    ['Brecha',(brechaGlobal>=0?'+':'')+brechaGlobal.toFixed(1)+'%',brechaGlobal>=0?'pos':'neg'],
    ['Ítems con avance',conAvance.length+' / '+nItems,''],
    ['Sobre-ejecución',sobre.length+(sobre.length?' ítems':''),sobre.length?'neg':''],
  ];
  $('#repKpis').innerHTML=kpis.map(k=>`<div class="rkpi"><div class="rk-lab">${k[0]}</div><div class="rk-val ${k[2]||''}">${k[1]}</div></div>`).join('');

  // panel de ítems que necesitan atención: más atrasados y sobre-ejecutados
  const conBrecha=ITEMS.map(i=>{
    const av=i.avance_real_prod, esp=i.avE!=null?i.avE:itemAvancePlaneado(i);
    return (av!=null&&esp!=null)?{i,av,esp,br:av-esp}:null;
  }).filter(Boolean);
  const atrasados=conBrecha.filter(x=>x.br<-5).sort((a,b)=>a.br-b.br).slice(0,6);
  $('#critBox').innerHTML = atrasados.length
    ? atrasados.map(x=>`<div class="crit-row"><span class="cr-id">${x.i.id}</span><span class="cr-desc">${(x.i.desc||'').slice(0,34)}</span><span class="cr-br neg">${x.br.toFixed(0)}%</span></div>`).join('')
    : '<span class="hint">Ningún ítem atrasado más de 5% respecto al plan.</span>';

  $('#repBody').innerHTML=ITEMS.map(i=>{
    const av=i.avance_real_prod;
    const esp = i.avE!=null ? i.avE : itemAvancePlaneado(i);
    const brecha=(av!=null&&esp!=null)?av-esp:null;const bc=brecha==null?'':brecha>=0?'pos':'neg';
    const pr=PROD[i.id];
    const cantProd = pr&&pr.total ? pr.total : (av!=null&&cantVigente(i)?cantVigente(i)*av/100:null);
    const montoProd = cantProd!=null ? cantProd*i.pu : null;
    const avCls = av!=null&&av>100.5 ? 'over100' : '';
    return `<tr><td class="itemid">${i.id}</td><td>${i.desc||''}</td><td class="mono">${i.um||''}</td>
      <td class="r">${fmtN(i.cant)}</td><td class="r">${cantProd!=null?fmtN(cantProd):'—'}</td>
      <td class="r">${fmtN(i.ptot,0)}</td><td class="r">${montoProd!=null?fmtN(montoProd,0):'—'}</td>
      <td class="r ${avCls}">${av!=null?pct(av):'—'}</td><td class="r plan">${esp!=null?pct(esp):'—'}</td>
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
  const cv=$('#colwVal'); if(cv) cv.textContent=inTimeWeek()?Math.round(TIME_WEEK_PX):colw();
  SEL.anchor=SEL.focus=null; renderGantt();});
$('#catFilter').onchange=e=>{catFilter=e.target.value;renderGantt();};
$('#showBase').onchange=renderGantt;
$('#critBtn').onclick=()=>{showCrit=!showCrit;$('#critBtn').classList.toggle('active',showCrit);renderGantt();};

/* ---------------- AJUSTE POR LLUVIAS: toggle + panel de config ------------- */
function aplicarLluvia(on){
  LLUVIA_ON = !!on;
  const b=$('#lluviaBtn'); if(b) b.classList.toggle('active', LLUVIA_ON);
  // recalcular la distribución de todos los ítems con el nuevo peso.
  // NO destructivo: apagar el toggle vuelve al reparto por días calendario.
  ITEMS.forEach(i=>{ if(i.ini&&i.fin) redistributeMonths(i,true); });
  MONTHS=computeMonths(); renderGantt(); renderKPIs();
}
function openLluviaPanel(){
  const mesesConDato=Object.keys(CLIMA).sort();
  const modo=String(cfgGet('lluvia:modo','todos')).toLowerCase();
  const conteo=String(cfgGet('lluvia:conteo','excedente')).toLowerCase();
  const umbral=cfgNum('lluvia:umbral',8);
  const filas=mesesConDato.map(mk=>{
    const c=CLIMA[mk], br=diasClimaBrutos(mk), rec=diasClimaReconocidos(mk);
    const exc=cfgNum('lluvia:excluir:'+mk,0);
    return `<tr><td class="mono">${mk}</td>
      <td class="r mono">${c.lluvia||0}</td><td class="r mono">${c.humedad||0}</td>
      <td class="r mono" style="opacity:.55">${c.receso||0}</td>
      <td class="r mono"><b>${br}</b></td>
      <td class="r"><input class="lvExc mono" data-mk="${mk}" type="number" min="0" value="${exc||''}"
           style="width:52px;text-align:right" placeholder="0"></td>
      <td class="r mono ${rec?'':'muted'}"><b>${rec}</b></td>
      <td class="r mono" style="opacity:.55">${c.mm?fmtN(c.mm,1):'—'}</td></tr>`;}).join('');
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Ajuste del cronograma por lluvias</h3>
    <p class="hint" style="margin-bottom:10px">Los días de <b>lluvia</b> y <b>humedad</b> se descuentan de los
      días hábiles de cada mes; el cronograma reparte las cantidades según ese peso.
      El <b>receso</b> no cuenta (no es clima). Los meses sin dato usan calendario pleno.</p>
    <div class="dgrid2">
      <div class="dfield"><label>Regla de la obra</label>
        <select id="lvModo">
          <option value="todos"  ${modo!=='umbral'?'selected':''}>Privada — cuentan todos los días</option>
          <option value="umbral" ${modo==='umbral'?'selected':''}>Pública — a partir de un umbral</option>
        </select></div>
      <div class="dfield"><label>Umbral (días/mes)</label>
        <input id="lvUmbral" type="number" min="0" value="${umbral}" ${modo!=='umbral'?'disabled':''}></div>
    </div>
    <div class="dfield"><label>Al superar el umbral se reconocen</label>
      <select id="lvConteo" ${modo!=='umbral'?'disabled':''}>
        <option value="excedente" ${conteo!=='total'?'selected':''}>Solo los días por encima del umbral</option>
        <option value="total"     ${conteo==='total'?'selected':''}>Todos los días del mes</option>
      </select></div>
    <div class="prev-wrap" style="margin-top:12px;max-height:300px">
      <table class="prev-tbl"><thead><tr>
        <th>Mes</th><th class="r">Lluvia</th><th class="r">Humedad</th><th class="r">Receso</th>
        <th class="r">Brutos</th><th class="r">Excluir</th><th class="r">Reconocidos</th><th class="r">mm</th>
      </tr></thead><tbody>${filas||'<tr><td colspan="8" class="hint">Todavía no hay días de clima registrados para esta obra.</td></tr>'}</tbody></table>
    </div>
    <div class="hint" id="lvMsg" style="margin-top:8px"></div>
    <div class="dactions" style="display:flex;gap:8px;align-items:center">
      <label class="hint" style="flex:1"><input type="checkbox" id="lvOn" ${LLUVIA_ON?'checked':''}>
        Aplicar ajuste por lluvias (reversible)</label>
      <button class="dsave" id="lvApply">Aplicar</button>
    </div>
  </div>`;
  m.classList.add('open');
  const syncEnab=()=>{const u=$('#lvModo').value==='umbral';
    $('#lvUmbral').disabled=!u; $('#lvConteo').disabled=!u;};
  $('#lvModo').onchange=syncEnab;
  $('#lvApply').onclick=()=>{
    CFG['lluvia:modo']=$('#lvModo').value;
    CFG['lluvia:umbral']=$('#lvUmbral').value;
    CFG['lluvia:conteo']=$('#lvConteo').value;
    $$('.lvExc').forEach(inp=>{
      const v=parseNum(inp.value)||0;
      if(v) CFG['lluvia:excluir:'+inp.dataset.mk]=v;
      else  delete CFG['lluvia:excluir:'+inp.dataset.mk];
    });
    aplicarLluvia($('#lvOn').checked);
    closeModal();
    toast(LLUVIA_ON?'Ajuste por lluvias <b>aplicado</b>':'Ajuste por lluvias <b>desactivado</b>');
  };
}
if($('#lluviaBtn')) $('#lluviaBtn').onclick=openLluviaPanel;
$('#blSel')&&($('#blSel').onchange=e=>{activeBaseline=e.target.value||null;$('#showBase').checked=!!activeBaseline;renderGantt();});
$('#blSave')&&($('#blSave').onclick=()=>{const n=prompt('Nombre de la línea base:','Línea base '+(BASELINES.length+1));if(n!==null){const b=snapshotBaseline(n);activeBaseline=b.id;renderBaselineControls();$('#showBase').checked=true;renderGantt();toast('Línea base <b>'+b.name+'</b> guardada (fechas + cantidades por mes)');}});
$('#wkPrev').onclick=()=>{if(weeklyIdx>0){weeklyIdx--;renderWeekly();}};
$('#wkSelect')&&($('#wkSelect').onchange=e=>{ weeklyIdx=+e.target.value; renderWeekly(); });
$('#wkPick')&&($('#wkPick').onclick=()=>{ const s=$('#wkSelect'); if(s){ s.focus(); s.click(); } });
$('#wkNext').onclick=()=>{if(weeklyIdx<ALLWEEKS.length-1){weeklyIdx++;renderWeekly();}};
$('#frenteFilter').onchange=renderWeekly;
$('#wkAddRow')&&($('#wkAddRow').onclick=()=>addWeeklyActivity(null));
$('#updateProd')&&($('#updateProd').onclick=updateProduction);

/* scroll sync */
(function(){const gs=$('#gridScroll'),ts=$('#timeScroll'),th=$('#timeHead'),ghs=$('#gridHeadScroll');let lock=false;
  // el header del timeline se mueve con translateX (no scrollLeft): funciona
  // siempre, sin depender de que la caja tenga overflow scrolleable.
  const syncHead=x=>{ if(th) th.style.transform='translateX('+(-x)+'px)'; };
  ts.addEventListener('scroll',()=>{if(lock)return;lock=true;gs.scrollTop=ts.scrollTop;syncHead(ts.scrollLeft);lock=false;});
  gs.addEventListener('scroll',()=>{if(lock)return;lock=true;ts.scrollTop=gs.scrollTop; if(ghs)ghs.scrollLeft=gs.scrollLeft; lock=false;});})();

/* ---- divisor arrastrable entre la tabla de ítems y el Gantt ---- */
(function(){
  const rz=$('#gridResizer'), col=$('#gridCol'), wrap=document.querySelector('.gantt-wrap');
  if(!rz||!col||!wrap) return;
  const saved=parseFloat(localStorage.getItem('obra_gridw')||'');
  if(saved) col.style.setProperty('--gridw', saved+'px');
  let drag=false;
  const start=e=>{ drag=true; rz.classList.add('drag'); document.body.style.cursor='col-resize';
    document.body.style.userSelect='none'; e.preventDefault(); };
  const move=e=>{ if(!drag) return;
    const x=(e.touches?e.touches[0].clientX:e.clientX);
    const w=Math.max(300,Math.min(920, x - wrap.getBoundingClientRect().left));
    col.style.setProperty('--gridw', w+'px'); };
  const end=()=>{ if(!drag) return; drag=false; rz.classList.remove('drag');
    document.body.style.cursor=''; document.body.style.userSelect='';
    const w=parseFloat(getComputedStyle(col).getPropertyValue('--gridw'));
    if(w) localStorage.setItem('obra_gridw', Math.round(w));
    renderGantt();   // re-render → remide alturas y realinea con el timeline
  };
  rz.addEventListener('mousedown',start); rz.addEventListener('touchstart',start,{passive:false});
  window.addEventListener('mousemove',move); window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',end);   window.addEventListener('touchend',end);
})();

/* ---- menú mostrar/ocultar columnas ---- */
(function(){
  const btn=$('#colsBtn'), menu=$('#colsMenu');
  if(!btn||!menu) return;
  function build(){
    menu.innerHTML=COLS_DEF.map(c=>{
      if(c.fixed) return `<label class="fixed"><input type="checkbox" checked disabled>${c.label}</label>`;
      return `<label><input type="checkbox" data-col="${c.key}" ${COLS_VIS[c.key]?'checked':''}>${c.label}</label>`;
    }).join('');
    menu.querySelectorAll('input[data-col]').forEach(inp=>inp.onchange=e=>{
      COLS_VIS[e.target.dataset.col]=e.target.checked; saveColsVis(); renderGantt();
    });
  }
  btn.onclick=e=>{ e.stopPropagation();
    const show=menu.style.display==='none'; if(show) build();
    menu.style.display=show?'block':'none'; };
  document.addEventListener('click',e=>{ if(!menu.contains(e.target)&&e.target!==btn) menu.style.display='none'; });
})();

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
  const cv=$('#colwVal'); if(cv) cv.textContent=inTimeWeek()?Math.round(TIME_WEEK_PX):colw();
  if(SCALE==='week' && (ganttMode==='qty'||ganttMode==='pct'))
    toast('En escala semanal las celdas se muestran (se editan en escala mensual)');
  SEL.anchor=SEL.focus=null; renderGantt();
});
/* ---- ancho de columna / de semana ---- */
function inTimeWeek(){ return SCALE==='week' && ganttMode==='time'; }
function setColW(w){
  if(inTimeWeek()){
    // en vista Tiempo·Semanas el control ajusta el ANCHO DE SEMANA
    TIME_WEEK_PX=Math.max(28,Math.min(140,w));
    try{ localStorage.setItem('obra_timeweekpx',TIME_WEEK_PX); }catch(e){}
    $('#colwVal').textContent=Math.round(TIME_WEEK_PX);
    renderGantt(); return;
  }
  COLW_USER[ganttMode]=Math.max(48,Math.min(240,w));
  localStorage.setItem('obra_colw',JSON.stringify(COLW_USER));
  $('#colwVal').textContent=colw();
  renderGantt();
}
$('#colwPlus') &&($('#colwPlus').onclick =()=>setColW(inTimeWeek()?TIME_WEEK_PX+8:colw()+12));
$('#colwMinus')&&($('#colwMinus').onclick=()=>setColW(inTimeWeek()?TIME_WEEK_PX-8:colw()-12));
$('#selDelBtn') && ($('#selDelBtn').onclick=deleteSelected);
$('#selClearBtn') && ($('#selClearBtn').onclick=clearSel);

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

function bindExport(){
  $('#btnXls') && ($('#btnXls').onclick=()=>exportarExcel());
  $('#btnPdf') && ($('#btnPdf').onclick=()=>exportarPDF());
}
function bindCarga(){
  $('#btnResync')&&($('#btnResync').onclick=resyncAll);
  $('#btnNuevaObra')&&($('#btnNuevaObra').onclick=openNuevaObra);
  $('#btnPegarItems')&&($('#btnPegarItems').onclick=openPegarItems);
  $('#btnPegarMensual')&&($('#btnPegarMensual').onclick=openPegarMensual);
  $('#obraSel')&&($('#obraSel').onchange=async e=>{
    if(e.target.value==='__new__'){ openNuevaObra(); await refreshObraList(); return; }
    try{ await cambiarObra(e.target.value); }catch(err){ toast('Error: '+err.message); }
  });
}

/* ===================== ARRANQUE ======================================== */
/* ---- login: overlay que aparece cuando la API exige sesión ---- */
window.__showLogin=function(){
  const ov=$('#loginOverlay'); if(!ov) return;
  ov.style.display='flex';
  setTimeout(()=>{ const u=$('#loginUser'); if(u) u.focus(); },50);
};
function hideLogin(){ const ov=$('#loginOverlay'); if(ov) ov.style.display='none'; }
(function(){
  const btn=$('#loginBtn'); if(!btn) return;
  const doLogin=async()=>{
    const u=$('#loginUser').value.trim(), p=$('#loginPass').value;
    if(!u||!p){ $('#loginErr').textContent='Completá usuario y contraseña'; return; }
    btn.disabled=true; $('#loginErr').textContent='';
    try{
      await ObraAPI.login(u,p);
      hideLogin(); location.reload();          // arranca limpio con la sesión nueva
    }catch(err){
      $('#loginErr').textContent=err.message||'No se pudo iniciar sesión';
    }finally{ btn.disabled=false; }
  };
  btn.onclick=doLogin;
  ['loginUser','loginPass'].forEach(id=>{ const el=$('#'+id);
    if(el) el.onkeydown=e=>{ if(e.key==='Enter') doLogin(); }; });
})();

async function boot(){
  bindCarga(); bindExport();
  const chip=$('#saveChip');
  $('#saveTxt').textContent='Conectando…';
  try{
    const who=await ObraAPI.whoami();
    ONLINE=true;
    window.__role=who.role;
    window.__obras=who.obras||'';
    $('#userChip').textContent=(who.user||'anónimo')+' · '+who.role;
    $('#userChip').className='userchip role-'+who.role;
    $('#userChip').title='Clic para cerrar sesión';
    $('#userChip').style.cursor='pointer';
    $('#userChip').onclick=()=>{
      if(ObraAPI.hasToken() && confirm('¿Cerrar sesión?')){ ObraAPI.logout(); location.reload(); }
    };
    if(who.role==='lectura') document.body.classList.add('readonly');

    // elegir una obra que el usuario TENGA permitida antes de cargar nada
    const obras=await ObraAPI.listObras();
    if(!obras.length){
      $('#saveTxt').textContent='Sin obras';
      reloadModel({items:[],weekly:[],production:{},baselines:[],categorias:[]});
      toast('Tu usuario no tiene obras asignadas. Contactá al administrador.');
      return;
    }
    const sel=$('#obraSel');
    if(sel){
      const esAdmin=(who.role==='admin');
      sel.innerHTML=obras.map(o=>`<option value="${o.obra_id}">${o.nombre}</option>`).join('')
        + (esAdmin?`<option value="__new__">＋ Nueva obra…</option>`:'');
    }
    // obra guardada si sigue permitida; si no, la primera de la lista
    let target=ObraAPI.getObraId();
    if(!obras.some(o=>String(o.obra_id)===String(target))) target=obras[0].obra_id;
    ObraAPI.setObraId(target);
    if(sel) sel.value=target;

    const data=await ObraAPI.getObra(target);
    reloadModel(data);
    $('#saveTxt').textContent='Guardado';
    toast('Conectado · <b>'+ITEMS.length+'</b> ítems cargados desde Drive');
  }catch(err){
    ONLINE=false;
    if(String(err.message)==='auth_required'){
      $('#saveTxt').textContent='Sesión requerida';
      return;                                   // el overlay de login ya está visible
    }
    chip.classList.add('err'); $('#saveTxt').textContent='Sin conexión';
    // modo offline: si hay data embebida la usa, si no arranca vacío
    reloadModel(window.OBRA_DATA||null);
    toast('No se pudo conectar al backend: '+err.message+' — trabajando local');
  }
}
