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
const APP_BUILD='2026-08-13.d · subtotal del padre también en vista Semanas · limpieza sin botón (consola)';
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

/* ---------- detección de móvil ----------
   En el celular el Gantt no se dibuja ni se muestra su pestaña (es una
   herramienta de planificación de escritorio). El campo usa Producción,
   Plan semanal e Informes. La clase se aplica ya para que el CSS oculte el
   Gantt sin parpadeo. */
const IS_MOBILE = window.matchMedia('(max-width:760px)').matches;
// activa una vista por su data-v (para arrancar en Producción en el celular)
function activarVistaMobil(v){
  try{
    document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('on'));
    var b=document.querySelector('#tabs button[data-v="'+v+'"]'); if(b) b.classList.add('on');
    document.querySelectorAll('.view').forEach(el=>el.classList.remove('on'));
    var view=document.getElementById('v-'+v); if(view) view.classList.add('on');
  }catch(e){}
}
if (IS_MOBILE && document.body) {
  document.body.classList.add('mobile');
  // arrancar en Producción DESDE EL PRIMER PINTADO: evita el flash del Gantt y
  // el arranque lento (no se monta la vista pesada del cronograma en el celular).
  activarVistaMobil('prod');
}

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
let ITEMS=[], WEEKLY=[], PROD={}, CATS=[], BASELINES=[], MONTHS=[], WEEKS=[], CERT={};
let byId={};
const reindex=()=>{byId={};ITEMS.forEach(i=>byId[i.id]=i);};
let wkIndex=0, activeBaseline=null;

/* Refresca la obra ACTUAL desde el servidor y redibuja todo. Se usa después de
   cargar producción, para que el avance (KPIs y curvas) refleje lo recién
   guardado. Mantiene la fuente de verdad en el backend (una sola lógica). */
window.refrescarObraActual = async function(){
  try{
    const target = ObraAPI.getObraId();
    if(!target) return false;
    const data = await ObraAPI.getObra(target);
    reloadModel(data);
    if(window.LocalStore) LocalStore.guardarObra(target, data);
    return true;
  }catch(e){
    if(window.toast) toast('No se pudo refrescar: '+e.message);
    return false;
  }
};

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
    avance_manual: (it.avance_manual!=null && it.avance_manual!=='')?Number(it.avance_manual):null,  // % manual para actividades/hitos sin cantidad
    cant_certificada_acum: it.cant_certificada_acum!=null?Number(it.cant_certificada_acum):0,
    cert_por_mes: Object.assign({}, it.cert_por_mes||{}),
    nivel: Math.max(1, Math.min(8, parseInt(it.nivel)||1)),   // nivel de indentación (1-8, libre para títulos)
    es_grupo: it.es_grupo===true || it.es_grupo==='true' || it.es_grupo===1 || it.es_grupo==='1',
    tipo: it.tipo || '',            // FIX: preservar el tipo (hito/actividad/subdivisión) al recargar
    padre_id: (it.padre_id!=null && it.padre_id!=='') ? String(it.padre_id) : null,
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
  repararPadreIds();   // recupera vínculos que Sheets convirtió en fechas
  normalizarTipos();   // clasifica los subítems por cantidad (tramo / actividad)
  // CERT: mapa item_id → { total, by_month } para la curva de certificado
  CERT = {};
  ITEMS.forEach(i=>{
    const bm = i.cert_por_mes||{};
    const total = i.cant_certificada_acum||0;
    if(total || Object.keys(bm).length){ CERT[i.id] = { total, by_month: bm }; }
  });
  BASELINES = (D.baselines||[]).map(b=>({...b}));
  activeBaseline=null;
  // clima + config de la obra (ajuste por lluvias)
  CLIMA = D.clima || {};
  CFG   = D.config || {};
  OBRA  = D.obra || {};
  // El toggle SIEMPRE arranca apagado: es una vista temporal, no un estado de
  // la obra. (lluvia:activo sigue en Config para la configuración de la regla,
  // pero no debe dejar la sesión en modo simulación al abrir.)
  PROD_ON = false; PLAN_ORIG = null;   // el ajuste por producción arranca limpio
  LLUVIA_CURVA = { contractual:false, meta:false };   // toggles «+ lluvia» de las curvas
  GANTT_LLUVIA = null;                 // el snapshot del motor de lluvia también
  invalidarCacheLluvia();              // y el caché de series por lluvia
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
  // refrescar el plan semanal también: su "ejecutado" (PPC) depende de la
  // producción, que pudo cambiar. Sin esto, al cargar producción el plan
  // semanal quedaba con datos viejos hasta cambiar de pestaña.
  try{ if(typeof renderWeekly==='function' && $('#v-weekly')) renderWeekly(); }catch(e){}
  // y el informe/curvas, por lo mismo, si esa vista está montada
  try{ if(typeof renderReport==='function' && $('#v-report')){ renderReport(); renderCurvas(); } }catch(e){}
}

/* Cantidad VIGENTE de un ítem: la ajustada (convenio modificatorio / ajuste de
   alcance) si el usuario la fijó a mano; si no, la cantidad de contrato original.
   La original (i.cant) queda SIEMPRE intacta como referencia inmutable. */
const cantVigente = i => (i && i.cant_ajustada!=null) ? i.cant_ajustada : (i? i.cant : 0);
/* ¿tiene ajuste cargado? */
const tieneAjuste = i => i && i.cant_ajustada!=null;

/* total incidencia base = sum of ptot (usa cantidad VIGENTE vía getter ptot) */
// suma solo ítems con cantidad (item/subdivision); grupos/actividades/hitos no.
// Además, si un ítem tiene subdivisiones, se cuenta el PADRE (su cant de contrato),
// no las subdivisiones, para no duplicar (las subdivisiones son desglose interno).
const contratoTotal = () => ITEMS.reduce((s,i)=>{
  if(!tieneCantidad(i)) return s;               // grupo/actividad/hito: 0
  if(tipoDe(i)==='subdivision') return s;        // el monto lo aporta el padre
  return s+i.ptot;
},0);
/* monto de contrato ORIGINAL (referencia licitada, sin ajustes) */
const contratoOriginalTotal = () => ITEMS.reduce((s,i)=>esComputable(i)? s+((i.cant||0)*(i.pu||0)) : s,0);

/* month axis */
function computeMonths(){
  const s=new Set();
  ITEMS.forEach(i=>{
    Object.keys(i.dist_mensual||{}).forEach(m=>s.add(m));
    if(i.ini&&i.fin){let c=new Date(parseD(i.ini).getFullYear(),parseD(i.ini).getMonth(),1);
      const e=parseD(i.fin); while(c<=e){s.add(c.toISOString().slice(0,7)); c=new Date(c.getFullYear(),c.getMonth()+1,1);}}
  });
  WEEKLY.forEach(w=>w.month&&s.add(w.month));
  // meses con certificación cargada: para que la curva de certificado tenga
  // dónde ubicarse aunque caigan fuera del rango de fechas de los ítems.
  Object.keys(CERT||{}).forEach(id=>{
    const bm=CERT[id]&&CERT[id].by_month; if(bm) Object.keys(bm).forEach(m=>s.add(m));
  });
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
  if(!what || what==='items') normalizarTipos(true);   // el tipo sigue a la cantidad
  if(what) dirty[what]=true; else { dirty.items=true; }
  const chip=$('#saveChip'); if(!chip)return;
  // Con un ajuste TEMPORAL activo el plan en pantalla es una simulación: no se
  // guarda, para que siga siendo reversible.
  //  · PRODUCCIÓN: se puede adoptar con "Aplicar definitivamente".
  //  · LLUVIA: es solo REFERENCIA comparativa (el modelo de curvas define que
  //    la lluvia no mueve el plan operativo), así que nunca se persiste.
  if(PROD_ON){
    chip.classList.remove('saving','err');
    $('#saveTxt').textContent = 'Simulación (sin guardar)';
    clearTimeout(saveTimer);
    return;
  }
  chip.classList.remove('err');
  chip.classList.add('saving'); $('#saveTxt').textContent='Guardando…';
  clearTimeout(saveTimer);
  saveTimer=setTimeout(flush,1500);
}
let saving=false;

/* ---- Bloque 5: estado de sincronización visible ----
   Con local-first el guardado deja de ser "esperá a que el servidor conteste".
   El dato queda a salvo en el dispositivo al instante y el envío va por detrás,
   así que el chip tiene que distinguir tres cosas distintas:
     · Guardado            → local y servidor al día
     · Guardado · N sin subir → a salvo en el equipo, viajando
     · Requiere atención   → el servidor RECHAZÓ algo (permiso, tope de
                             certificación...). Eso no se arregla esperando. */
let pendSync = 0, errSync = 0;
function pintarChipSync(){
  const chip=$('#saveChip'), txt=$('#saveTxt');
  if(!chip||!txt) return;
  chip.classList.remove('saving');
  if(errSync){
    chip.classList.add('err');
    txt.textContent = errSync+' cambio(s) rechazado(s) — clic para ver';
    chip.style.cursor='pointer';
    chip.onclick = verErroresSync;
    return;
  }
  chip.classList.remove('err');
  chip.onclick=null; chip.style.cursor='';
  txt.textContent = pendSync ? ('Guardado · '+pendSync+' sin subir') : 'Guardado';
}
async function verErroresSync(){
  if(!window.LocalStore) return;
  const jobs=(await LocalStore.listar()).filter(j=>j.error);
  if(!jobs.length){ errSync=0; pintarChipSync(); return; }
  const det=jobs.map(j=>'· '+j.tipo+': '+j.error).join('\n');
  if(confirm('El servidor rechazó estos cambios:\n\n'+det+
             '\n\nAceptar = reintentar.\nCancelar = descartarlos (se pierden).')){
    await LocalStore.reintentar();
  } else {
    for(const j of jobs) await LocalStore.quitar(j.id);
  }
  await refrescarEstadoSync();
}
async function refrescarEstadoSync(){
  if(!window.LocalStore) return;
  const jobs=await LocalStore.listar();
  pendSync=jobs.filter(j=>!j.error).length;
  errSync =jobs.filter(j=> j.error).length;
  pintarChipSync();
}
if(window.LocalStore) LocalStore.onChange(()=>refrescarEstadoSync());

/* Firmas del último guardado EXITOSO, por tabla. Si la firma no cambió, esa
   tabla no se manda: el backend no la toca y nos ahorramos la reescritura.
   Antes, tocar una sola fecha reenviaba items + dist + deps completos.
   Se reinician al cambiar de obra (las firmas son por obra). */
let lastSig={items:null,dist:null,deps:null,obra:null};
function resetFirmas(){ lastSig={items:null,dist:null,deps:null,obra:null}; }
async function flush(manual){
  const chip=$('#saveChip');
  // Bloque 5: SIN conexión ya no es un callejón sin salida. Se encola igual y
  // la cola vive en IndexedDB, así que sobrevive a cerrar el navegador.
  const local = !!window.LocalStore;
  if(!ONLINE && !local){ chip.classList.remove('saving'); $('#saveTxt').textContent='Local'; return false; }
  if(PROD_ON){                                     // ajuste temporal: no persistir
    chip.classList.remove('saving');
    $('#saveTxt').textContent = 'Simulación (sin guardar)';
    if(manual) toast('El ajuste por producción es una <b>simulación</b>. Usá «Aplicar definitivamente» para guardarlo.');
    return false;
  }
  if(saving){ return false; }                       // evitar guardados solapados
  if(!dirty.items && !dirty.weekly && !dirty.cats && !manual){
    chip.classList.remove('saving'); $('#saveTxt').textContent='Guardado'; return true;
  }
  saving=true;
  chip.classList.remove('err'); chip.classList.add('saving'); $('#saveTxt').textContent='Guardando…';
  const oid=ObraAPI.getObraId();
  try{
    if(lastSig.obra!==oid) resetFirmas(), lastSig.obra=oid;   // obra distinta: firmas de cero

    /* Encolar (local-first) o enviar directo, según haya IndexedDB.
       encolar() escribe en disco y vuelve en ~5 ms; el envío real lo hace
       LocalStore.sincronizar() por detrás, con reintentos. */
    const despachar = local
      ? (tipo,payload)=>LocalStore.encolar(tipo,oid,payload)
      : (tipo,payload)=>{
          if(tipo==='saveItems')      return ObraAPI.saveItemsParcial(payload);
          if(tipo==='saveCategorias') return ObraAPI.saveCategorias(payload.categorias);
          if(tipo==='saveWeekly')     return ObraAPI.saveWeekly(payload.rows,payload.deleted);
        };

    if(dirty.items || manual){
      const s=ObraAPI.serializeItems(ITEMS);
      const sg={items:ObraAPI.firma(s.items),dist:ObraAPI.firma(s.dist),deps:ObraAPI.firma(s.deps)};
      const env={};
      if(sg.items!==lastSig.items) env.items=s.items;
      if(sg.dist !==lastSig.dist ) env.dist =s.dist;
      if(sg.deps !==lastSig.deps ) env.deps =s.deps;
      if(env.items||env.dist||env.deps){
        await despachar('saveItems', env);
        lastSig.items=sg.items; lastSig.dist=sg.dist; lastSig.deps=sg.deps; lastSig.obra=oid;
      }
      dirty.items=false;
    }
    if(dirty.cats || manual){ await despachar('saveCategorias',{categorias:CATS}); dirty.cats=false; }
    if(dirty.weekly || manual){
      await despachar('saveWeekly',{rows:ObraAPI.serializeWeekly(WEEKLY), deleted:deletedWeekly.splice(0)});
      dirty.weekly=false;
    }

    saving=false;
    if(local){
      await refrescarEstadoSync();
      LocalStore.sincronizar();          // SIN await: el usuario no espera la red
      if(manual) toast('Guardado ✓ — subiendo a Drive en segundo plano');
    } else {
      chip.classList.remove('saving'); $('#saveTxt').textContent='Guardado';
      if(manual) toast('Guardado en Drive ✓');
    }
    return true;
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
  // Con local-first, irse con la cola llena NO pierde nada (vive en IndexedDB
  // y se reintenta al volver). Solo avisamos por lo que aún no se encoló.
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
let OBRA  = {};           // { id, nombre, fecha_inicio, fecha_fin }

const cfgGet = (k, def) => {
  const v = CFG[k];
  return (v === undefined || v === null || v === '') ? def : v;
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

/* PESO de un tramo dentro de un mes = días calendario.
 * La lluvia NO re-pesa el reparto mensual: en el modelo vigente la lluvia
 * TRASLADA el cronograma (ver correrMotorLluvia), no lo re-distribuye.       */
function diasHabilesTramo(mk, a, b){
  const cal = diasCalendarioTramo(a,b);
  return cal;
  /* eslint-disable no-unreachable */
  const rec = diasClimaReconocidos(mk);
  if(!rec) return cal;
  const dm = new Date(a.getFullYear(), a.getMonth()+1, 0).getDate();   // días del mes
  const proporcion = cal / dm;                     // qué parte del mes ocupa el tramo
  const descuento  = rec * proporcion;
  return Math.max(0.5, cal - descuento);           // nunca 0: evita divisiones raras
}

/* PESO de un mes completo para repartos proporcionales = días calendario.
   (La lluvia no re-pesa: traslada. Ver correrMotorLluvia.)                  */
function diasHabilesMes(mk){
  if(!mk) return 0;
  const [y,m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/* total de días reconocidos en un rango de meses — alimenta el techo de la
 * curva operativa (Batch 2): fin de contrato + días ganados por lluvia.
 * NOTA: es independiente del toggle de visualización. El toggle decide si el
 * cronograma se REDISTRIBUYE en pantalla; los días ganados son un hecho
 * contractual que existe igual, y el Batch 2 los necesita siempre.          */
function diasGanadosPorLluvia(mkDesde, mkHasta){
  const tope = mkHasta || mesActual();          // nunca meses futuros
  return Object.keys(CLIMA)
    .filter(mk => (!mkDesde || mk >= mkDesde) && mk <= tope)
    .reduce((s,mk) => s + diasClimaReconocidos(mk), 0);
}

/* -------------------------------------------------------------------------
 * CORRIMIENTO ACUMULADO — base del modelo de lluvia
 *
 * Una fecha del cronograma no se corre por el TOTAL de días de clima de la
 * obra, sino por los que ya habían ocurrido HASTA esa fecha. Si llovió en
 * julio, marzo no se mueve; agosto se corre por la lluvia de marzo..agosto.
 *
 *      fecha_ajustada(t) = t + (días de clima reconocidos con fecha ≤ t)
 *
 * Es monótona creciente, así que nunca invierte el orden de los ítems ni
 * rompe dependencias, y el corrimiento jamás supera el total reconocido.
 * ------------------------------------------------------------------------- */
var _fechasClimaCache = null;

/* fechas de clima RECONOCIDAS por la regla de la obra, ordenadas.
   De cada mes se toman los `diasClimaReconocidos` primeros días con clima
   (lluvia antes que humedad): cuando la regla reconoce menos días que los
   registrados —modo excedente sobre umbral— hay que elegir cuáles cuentan. */
function fechasClimaOrdenadas(){
  if(_fechasClimaCache) return _fechasClimaCache;
  const out=[];
  Object.keys(CLIMA).forEach(mk=>{
    const c=CLIMA[mk]; if(!c || !c.dias) return;
    const rec=Math.round(diasClimaReconocidos(mk));
    if(!rec) return;
    const dias=Object.keys(c.dias).sort((a,b)=>{
      const ra=c.dias[a]==='lluvia'?0:1, rb=c.dias[b]==='lluvia'?0:1;
      return ra-rb || a.localeCompare(b);
    }).slice(0, rec);
    dias.forEach(d=>out.push(d));
  });
  out.sort();
  _fechasClimaCache=out;
  return out;
}

/* cuántos días de clima habían ocurrido hasta `fecha` (inclusive).
   = el corrimiento que le corresponde a esa fecha.                          */
function corrimientoA(fecha){
  const arr=fechasClimaOrdenadas();
  if(!arr.length) return 0;
  const f=(typeof fecha==='string') ? fecha : dstr(fecha);
  let lo=0, hi=arr.length;                       // búsqueda binaria
  while(lo<hi){ const mid=(lo+hi)>>1; if(arr[mid]<=f) lo=mid+1; else hi=mid; }
  return lo;
}

/* aplica el corrimiento acumulado a una fecha */
function correrFecha(d){ const f=(typeof d==='string')?parseD(d):d;
  return f? addDays(f, corrimientoA(f)) : null; }

/* =========================================================================
 * AJUSTE POR PRODUCCIÓN — Batch 2: plan operativo vivo (capa 4)
 *
 * Reprograma el faltante mes a mes contra la CANTIDAD VIGENTE:
 *   faltante = cantVigente − ejecutado real
 * BIDIRECCIONAL: si se ejecutó de más, adelanta y descuenta del mes siguiente.
 *
 * TECHO automático de extensión = fin de contrato + días ganados por lluvia
 * (con la regla de lluvia configurada en la obra). Agotado el colchón, NO
 * extiende más: infla los meses finales y los marca en rojo como alarma.
 * Extender más allá del techo es siempre acción MANUAL.
 *
 * A diferencia de la lluvia (que es referencia), esto SÍ mueve el plan: es el
 * cronograma operativo de qué falta ejecutar realmente cada mes.
 * ========================================================================= */
let PROD_ON = false;              // toggle del ajuste por producción
let PROD_MODO = 'siguiente';      // 'siguiente' | 'repartir'
let PLAN_ORIG = null;             // backup para revertir (no destructivo)

/* producción real de un ítem agregada por mes → { '2025-06': 1234, ... } */
function prodPorMes(itemId){
  const pr = PROD[itemId];
  if(!pr || !pr.by_date) return {};
  const out = {};
  Object.entries(pr.by_date).forEach(([d,q])=>{
    const mk = String(d).slice(0,7);
    out[mk] = (out[mk]||0) + (q||0);
  });
  return out;
}

/* producción real ejecutada de un ítem en una semana ISO dada (suma los días
   de esa semana). Se usa para detectar ejecución NO planeada. */
function prodEnSemana(itemId, wk){
  const pr = PROD[itemId];
  if(!pr || !pr.by_date || !wk) return 0;
  let s = 0;
  Object.entries(pr.by_date).forEach(([d,q])=>{
    const dt = parseD(d);                       // by_date usa fecha string; isoWeekOf necesita Date
    if(dt && isoWeekOf(dt)===wk) s += (q||0);
  });
  return s;
}

/* mes actual en formato YYYY-MM */
function mesActual(){
  const h = new Date();
  return h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0');
}

/* fecha fin de contrato de la obra (la vigente) */
function finContrato(){
  if(OBRA && OBRA.fecha_fin) return parseD(OBRA.fecha_fin);
  // fallback: el fin más tardío del cronograma actual
  let mx=null;
  ITEMS.forEach(i=>{ const f=parseD(i.fin); if(f && (!mx||f>mx)) mx=f; });
  return mx;
}

/* TECHO de la curva operativa = fin de contrato + días ganados por lluvia.
   Usa la MISMA regla de lluvia configurada en la obra (umbral o todos).     */
function techoOperativo(){
  const fc = finContrato();
  if(!fc) return null;
  const dias = diasGanadosPorLluvia();
  const t = new Date(fc); t.setDate(t.getDate()+dias);
  return t;
}
function mesDeTecho(){
  const t = techoOperativo(); if(!t) return null;
  return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0');
}

/* -------------------------------------------------------------------------
   Reprograma UN ítem. Devuelve un objeto con el diagnóstico del ajuste.
   · Meses PASADOS (< mes actual): el plan se iguala al ejecutado real.
     Es la definición de la capa 4: en el pasado, plan operativo = real.
   · El desvío acumulado (faltante o excedente) se traslada al futuro.
   · Si el faltante no entra antes del techo, los meses finales se inflan
     y se marcan con _sobrecarga para pintarlos en rojo.
------------------------------------------------------------------------- */
function reprogramarItem(i, modo){
  const mAct   = mesActual();
  const techo  = mesDeTecho();
  const ejec   = prodPorMes(i.id);
  const dist   = {...(i.dist_mensual||{})};
  const vigente= cantVigente(i);

  // 1) meses pasados: el plan se iguala a lo realmente ejecutado.
  //    IMPORTANTE: hay que recorrer la unión de los meses del PLAN y los de la
  //    PRODUCCIÓN. Si se ejecutó en un mes que no estaba planificado, ese mes
  //    igual debe reflejarse (si no, el total se descuadra).
  let desvio = 0;                        // + = falta ejecutar, − = se adelantó
  const todosMeses = new Set([...Object.keys(dist), ...Object.keys(ejec)]);
  const mesesPasados = [...todosMeses].filter(mk => mk < mAct).sort();
  mesesPasados.forEach(mk=>{
    const prev = dist[mk]||0;
    const real = ejec[mk]||0;
    desvio += (prev - real);             // lo que no se hizo (o se hizo de más)
    dist[mk] = real;                     // capa 4: pasado = real
  });

  // 2) el mes actual: lo ya ejecutado no se puede "desplanificar", pero el mes
  //    todavía está abierto. Si ya se ejecutó MÁS de lo previsto, el plan del
  //    mes sube a lo ejecutado y esa diferencia se descuenta del futuro.
  const ejecAct = ejec[mAct]||0, planAct = dist[mAct]||0;
  if(ejecAct > planAct){
    desvio -= (ejecAct - planAct);
    dist[mAct] = ejecAct;
  }

  let futuros = [...new Set([...Object.keys(dist), ...Object.keys(ejec)])]
                  .filter(mk => mk >= mAct).sort();

  // si no quedan meses futuros pero hay faltante, hay que abrir meses nuevos
  if(!futuros.length && Math.abs(desvio) > 0.001){
    const arranque = mAct;
    dist[arranque] = 0; futuros = [arranque];
  }

  // 3) repartir el desvío en los meses futuros
  const sobrecargados = {};
  if(Math.abs(desvio) > 0.001 && futuros.length){
    if(modo === 'siguiente'){
      // todo al primer mes futuro
      const m0 = futuros[0];
      dist[m0] = Math.max(0, (dist[m0]||0) + desvio);
    } else if(modo === 'repartir_techo' && techo && techo >= mAct && rangoMeses(mAct, techo).length){
      // repartir en TODOS los meses desde el actual hasta el TECHO, incluida la
      // extensión por lluvia (fin de contrato + días ganados). Abre los meses de
      // la extensión que hagan falta; reparte por días hábiles.
      const rango = rangoMeses(mAct, techo);
      const pesos = rango.map(mk => diasHabilesMes(mk));
      const sp = pesos.reduce((s,v)=>s+v,0) || 1;
      rango.forEach((mk,k)=>{
        dist[mk] = Math.max(0, (dist[mk]||0) + desvio * pesos[k]/sp);
      });
    } else {
      // repartir proporcional a los días hábiles de cada mes futuro existente
      const pesos = futuros.map(mk => diasHabilesMes(mk));
      const sp = pesos.reduce((s,v)=>s+v,0) || 1;
      futuros.forEach((mk,k)=>{
        dist[mk] = Math.max(0, (dist[mk]||0) + desvio * pesos[k]/sp);
      });
    }
  }

  // 4) control de techo: si el cronograma se pasa del techo, se comprime
  //    el excedente en los meses que quedan hasta el techo y se marca en rojo.
  if(techo){
    const masAllaDelTecho = Object.keys(dist).filter(mk => mk > techo && (dist[mk]||0) > 0);
    if(masAllaDelTecho.length){
      const exceso = masAllaDelTecho.reduce((s,mk)=>s+(dist[mk]||0),0);
      masAllaDelTecho.forEach(mk=>{ delete dist[mk]; });
      const dentro = Object.keys(dist).filter(mk => mk >= mAct && mk <= techo).sort();
      if(dentro.length){
        const pesos = dentro.map(mk => diasHabilesMes(mk));
        const sp = pesos.reduce((s,v)=>s+v,0) || 1;
        dentro.forEach((mk,k)=>{
          dist[mk] = (dist[mk]||0) + exceso * pesos[k]/sp;
          sobrecargados[mk] = true;      // alarma visual: no entra en plazo
        });
      }
    }
  }

  // limpiar ceros y redondear
  Object.keys(dist).forEach(mk=>{
    dist[mk] = +(dist[mk]||0).toFixed(3);
    if(!dist[mk]) delete dist[mk];
  });

  const total = Object.values(dist).reduce((s,v)=>s+v,0);
  return { dist, desvio, sobrecargados, total, vigente };
}

/* aplica/revierte el ajuste por producción a TODOS los ítems */
function aplicarProduccion(on, modo){
  PROD_MODO = modo || PROD_MODO;
  if(on){
    // Guardar el estado original UNA sola vez (para poder revertir).
    // Incluye el PLAN SEMANAL: syncDatesFromMonths lo regenera, así que sin
    // este backup al revertir quedarían las semanas de la simulación.
    if(!PLAN_ORIG){
      PLAN_ORIG = { items:{}, weekly: WEEKLY.map(w=>({...w})) };
      ITEMS.forEach(i=>{ PLAN_ORIG.items[i.id] = {
        dist: {...(i.dist_mensual||{})}, ini: i.ini, fin: i.fin }; });
    }
    ITEMS.forEach(i=>{
      if(!esPortadorPlan(i)) return;   // el plan lo llevan los tramos/hojas, no el padre-contenedor
      const r = reprogramarItem(i, PROD_MODO);
      i.dist_mensual = r.dist;
      i._sobrecarga  = r.sobrecargados;
      if(Object.keys(r.dist).length) syncDatesFromMonths(i);
    });
    PROD_ON = true;
  } else {
    // revertir exactamente al estado previo
    if(PLAN_ORIG){
      ITEMS.forEach(i=>{
        const o = PLAN_ORIG.items[i.id]; if(!o) return;
        i.dist_mensual = {...o.dist}; i.ini = o.ini; i.fin = o.fin;
        delete i._sobrecarga;
      });
      WEEKLY = PLAN_ORIG.weekly.map(w=>({...w}));   // restaurar plan semanal
      PLAN_ORIG = null;
    }
    PROD_ON = false;
  }
  const b=$('#prodBtn'); if(b) b.classList.toggle('active', PROD_ON);
  MONTHS=computeMonths(); renderGantt(); renderKPIs();
  if(typeof renderWeekly==='function' && $('#v-weekly')) renderWeekly();
}

/* =========================================================================
 * MOTOR DE LLUVIA — CORRIMIENTO ACUMULADO
 *
 * Regla del modelo: 1 día de clima = 1 día más de plazo, y el cronograma se
 * corre desde ese día en adelante. Una fecha se mueve por la lluvia que YA
 * había ocurrido, no por el total de la obra:
 *
 *     ini_ajustado = ini_base + corrimientoA(ini_base)
 *     fin_ajustado = fin_base + corrimientoA(fin_base)
 *
 * Un ítem que atraviesa un mes lluvioso se corre Y se estira (su fin acumula
 * más días que su inicio). Uno anterior a la lluvia no se mueve.
 * Fin de obra ajustado = fin de la línea base + días ganados reconocidos.
 *
 * Como el corrimiento es monótono creciente, el orden de los ítems y las
 * dependencias de la línea base se conservan solos: no hace falta topología.
 * Y ningún ítem puede correrse más que el total reconocido (el modelo viejo
 * recontaba la lluvia dentro de cada ventana ya corrida, se realimentaba y
 * disparaba el fin de obra muy por encima del total).
 *
 * Es un cálculo de REFERENCIA: no toca el plan operativo (ese se reprograma
 * solo por producción).
 * ========================================================================= */
let GANTT_LLUVIA = null;      // snapshot: { base, fecha, items:{id:{ini,fin,corrido}} }

/* duración en días laborables de un ítem según una línea base (o su plan) */
function duracionBase(i, bl){
  let ini, fin;
  if(bl && bl.items && bl.items[i.id]){
    ini = parseD(bl.items[i.id].ini); fin = parseD(bl.items[i.id].fin);
  }
  if(!ini || !fin){ ini = parseD(i.ini); fin = parseD(i.fin); }
  if(!ini || !fin) return null;
  return { ini, fin, dur: daysBetween(ini,fin)+1 };
}

/* corre el motor sobre una línea base; devuelve el snapshot de fechas.
   Cada fecha se corre por la lluvia acumulada HASTA esa fecha.              */
function correrMotorLluvia(bl){
  const D = diasGanadosRetro();
  const out = { base: bl?bl.id:null, baseNom: bl?bl.name:'plan', fecha: dstr(TODAY),
                items:{}, dias: D };
  const msDia = 86400000;
  let maxCorr = 0;

  ITEMS.forEach(i=>{
    const b = duracionBase(i, bl);
    if(!b) return;
    const ini = correrFecha(b.ini);
    const fin = correrFecha(b.fin);
    if(!ini || !fin) return;
    const corrido = Math.round((ini - b.ini)/msDia);
    if(corrido > maxCorr) maxCorr = corrido;
    out.items[i.id] = { ini: dstr(ini), fin: dstr(fin), corrido: corrido,
                        estirado: Math.round((fin - b.fin)/msDia) - corrido,
                        iniBase: dstr(b.ini), finBase: dstr(b.fin) };
  });

  const finBase = finBaseline(bl);
  if(finBase){
    // el fin de obra se ancla en el TOTAL reconocido: es el número contractual
    // que se reclama al MOPC (y coincide con corrimientoA(finBase) siempre que
    // la lluvia haya caído dentro del plazo, que es el caso normal).
    out.finObraBase  = dstr(finBase);
    out.finObraAjust = dstr(addDays(finBase, D));
    out.diasGanados  = D;
    out.diasLluvia   = D;
  }
  out.maxCorrido = maxCorr;
  return out;
}

/* dispara el motor de lluvia (día a día, respeta dependencias si las hay) y
   guarda el snapshot. Solo sobre LÍNEAS BASE: el operativo se ajusta por producción. */
function recalcularGanttLluvia(blId){
  const bl = blId ? BASELINES.find(b=>b.id===blId) : null;
  if(!bl){ toast('Elegí una línea base: el ajuste por lluvia se aplica sobre líneas base, no sobre el operativo'); return; }
  const snap = correrMotorLluvia(bl);
  if(!snap) return;
  GANTT_LLUVIA = snap;
  const n = Object.keys(snap.items).length;
  const finTxt = snap.finObraAjust ? ` · fin de obra <b>${fmtDM(snap.finObraAjust)}</b>` : '';
  toast(`Gantt con lluvia · <b>${n}</b> ítems · corrimiento máx. <b>${snap.maxCorrido||0}</b> de <b>${snap.dias}</b> días${finTxt}`);
  renderGantt();
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
  /* Reparto con COMPENSACIÓN DE RESIDUO (mayor resto fraccionario).
     Redondear cada mes por separado a 3 decimales dejaba un sobrante de hasta
     ~0.0005 por mes que nunca sumaba la cantidad exacta; multiplicado por el
     precio unitario y por 100+ ítems, eso era la diferencia entre el monto
     planeado y el ajustado. Ahora la Σ de los meses da EXACTO. */
  if(sumDays>0){
    const partes=buckets.map(([mk,d])=>{
      const exacto=total*d/sumDays, v=round3(exacto);
      return { mk, v, resto: exacto-v };
    });
    let acum=0; partes.forEach(p=>{ acum+=p.v; });
    const resid=total-acum;               // sin redondear: tiene que cerrar exacto
    if(Math.abs(resid)>1e-9 && partes.length){
      // el sobrante va al mes con mayor resto (o menor, si el residuo es negativo)
      const orden=partes.slice().sort((x,y)=> resid>0 ? y.resto-x.resto : x.resto-y.resto);
      orden[0].v=round6(orden[0].v+resid);
    }
    partes.forEach(p=>{ dist[p.mk]=p.v; });
  }
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
  return round6(Object.values(i.dist_mensual||{}).reduce((s,v)=>s+(v||0),0));
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
/* Diferencia entre lo PLANEADO y la cantidad vigente de un ítem.
   Usa `sumaPlanItem` (la distribución EFECTIVA: para un padre-con-tramos, la
   suma de sus tramos) — que es exactamente la cantidad que alimenta el KPI
   «Monto planeado». Antes usaba `sumaCronograma` (la dist propia del ítem), así
   que un padre podía figurar como ✓ mientras el monto se calculaba con otra
   cifra. */
function difContrato(i){ return round6(sumaPlanItem(i)-(cantVigente(i)||0)); }

/* ---------- MENSUAL → SEMANAL (generación automática) ----------
   La cantidad de cada mes se reparte entre las semanas que tocan ese mes,
   proporcional a los DÍAS de la semana que caen dentro del mes (Regla B:
   la semana es un bloque íntegro, pero su cantidad se prorratea).
   Solo se tocan las semanas AUTO: si el residente editó una a mano
   (_man = true), esa se respeta y se descuenta del reparto.            */
function syncWeeksFromMonths(item){
  if(!AUTO_WEEKS) return;
  /* item-padre con tramos (o grupo/titulo): NO se le generan filas semanales.
     Las que ya existan en el Sheet no se borran (dato historico), simplemente
     dejan de generarse y el render las oculta. */
  if(!vaAlPlanSemanal(item)) return;
  /* actividades / hitos / items sin cantidad: van al plan semanal por FECHA,
     sin cantidad prevista. Su cumplimiento se marca con el estado. */
  if(sinCantidadPlan(item)) return syncWeeksActividad(item);
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
/* ---- ACTIVIDADES / HITOS SIN CANTIDAD -> filas semanales por fecha ----
   Una actividad sin cantidad (armado de encofrado, plano final, sello de
   limpieza) no tiene reparto mensual que prorratear: lo unico que define en
   que semana va es su rango de fechas. Se genera UNA fila por cada semana ISO
   que toca. cant_prevista queda en null (no suma monto ni cantidad), pero la
   fila SI cuenta como compromiso de la semana para el PPC.
   Las filas editadas a mano (_man) nunca se tocan.                         */
function syncWeeksActividad(item){
  const wks=semanasDeItem(item);
  const mid=String(item.id);
  // sacar las filas AUTO en semanas que el item ya no toca (se corrio la fecha)
  WEEKLY=WEEKLY.filter(w=>!(String(w.item_id)===mid && !w._man && !wks.includes(w.week)));
  const exist={}; WEEKLY.forEach(w=>{ if(String(w.item_id)===mid) exist[w.week]=w; });
  wks.forEach(wk=>{
    const w=exist[wk];
    if(w){
      w.um=item.um||'';
      if(!w._man){ w.cant_prevista=null; w.mesSplit=null; w.month=weekMonthKey(wk); }
    } else {
      WEEKLY.push({ item_id:item.id, actividad:item.desc, frente:'', um:item.um||'',
        week:wk, month:weekMonthKey(wk), mesSplit:null,
        cant_prevista:null, cant_ejecutada:null,
        causa:'Sin observaciones', _man:false, _auto:true });
    }
  });
  WEEKS.length=0; [...new Set(WEEKLY.map(w=>w.week).filter(Boolean))].sort().forEach(w=>WEEKS.push(w));
}
const round3 = v => Math.round((v+Number.EPSILON)*1000)/1000;
/* Las cantidades de contrato del MOPC llegan con 4 decimales (263.0262). Si el
   reparto mensual se guarda con 3, la Σ NUNCA puede dar la cantidad exacta y
   queda un residuo que, multiplicado por el PU, descuadra el monto planeado.
   El mes que absorbe el residuo se guarda con 6 decimales para cerrar exacto. */
const round6 = v => Math.round((v+Number.EPSILON)*1e6)/1e6;

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
    /* La dependencia es un PISO, no un pin.
       Solo empuja hacia adelante: si el ítem YA arrancaba después de lo que
       exige el predecesor, conserva su fecha. Antes se asignaba reqIni sin
       comparar, y eso RETROCEDÍA el sucesor hasta pegarlo al fin del
       predecesor — que es el comportamiento que había que corregir. */
    if(reqIni && reqIni > iIni){ nIni=reqIni; nFin=addDays(reqIni,dur); }
    // restricción de FIN (FF/SF): idem, solo si empuja el fin más allá del actual
    if(reqFin && reqFin > nFin){ nFin=reqFin; nIni=addDays(reqFin,-dur); }
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
  const dif=difContrato(i);           // plan efectivo - cantidad vigente
  if(Math.abs(dif)<1e-6) return false;
  // Un padre-con-tramos no lleva plan propio: el residuo se corrige en el
  // ÚLTIMO TRAMO, que es donde vive la distribución que suma el monto.
  if(tieneSubdivisiones(i.id)){
    const tramos=ITEMS.filter(x=>tipoDe(x)==='subdivision' && idKey_(x.padre_id)===idKey_(i.id));
    if(!tramos.length) return false;
    const t=tramos[tramos.length-1];
    const mst=Object.keys(t.dist_mensual||{}).filter(m=>Math.abs(t.dist_mensual[m])>0).sort();
    if(!mst.length) return false;
    const lastT=mst[mst.length-1];
    const nv=round6((t.dist_mensual[lastT]||0) - dif);
    if(nv>0){ t.dist_mensual[lastT]=nv; (t._manualMonths=t._manualMonths||{})[lastT]=true;
              syncDatesFromMonths(t); return true; }
    return false;
  }
  const ms=Object.keys(i.dist_mensual||{}).filter(m=>Math.abs(i.dist_mensual[m])>0).sort();
  if(!ms.length){
    // sin distribución: poner todo el contrato en el mes de inicio
    const mk=(i.ini||dstr(TODAY)).slice(0,7);
    i.dist_mensual[mk]=cantVigente(i)||0; (i._manualMonths=i._manualMonths||{})[mk]=true;
  } else {
    const last=ms[ms.length-1];
    const nuevo=round6((i.dist_mensual[last]||0) - dif);
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
  const antes=ITEMS.reduce((s,i)=>esComputable(i)? s+sumaPlanItem(i)*(i.pu||0) : s,0);
  let n=0; ITEMS.forEach(i=>{ if(ajustarDif(i)) n++; });
  if(n){
    touch(); renderGantt(); renderKPIs();
    const despues=ITEMS.reduce((s,i)=>esComputable(i)? s+sumaPlanItem(i)*(i.pu||0) : s,0);
    const d=Math.round(despues-antes);
    toast(`Ajustados <b>${n}</b> ítems — la Σ del cronograma cuadra con el contrato`
      + (Math.abs(d)>=1? ` · monto planeado ${d>0?'+':''}${fmtG(d).replace('₲ ','₲')}`:''));
  }
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
/* ===== REPARACIÓN: padre_id convertido a FECHA por Google Sheets =======
   Un id jerárquico como "7.1" escrito en una celda con formato automático se
   interpreta como 7 de enero: la planilla guarda una FECHA y el backend la
   devuelve como ISO ("2026-01-07T…") o, si después se pasó la columna a texto,
   como número de serie ("46029"). En ambos casos no coincide con ningún id y la
   relación padre-hijo se pierde en silencio.
   Se reconstruye "día.mes" y SOLO se acepta si resuelve a un id existente; si no
   resuelve, se deja intacto y se avisa por consola. Nunca se inventa un vínculo. */
function candidatosPadreId_(v){
  const out=[];
  const push=(d)=>{ if(d && !isNaN(d)){
    out.push(d.getDate()+'.'+(d.getMonth()+1));
    out.push(d.getUTCDate()+'.'+(d.getUTCMonth()+1));
  }};
  if(v instanceof Date) push(v);
  const s=String(v==null?'':v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){
    push(new Date(s));
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if(m) out.push((+m[3])+'.'+(+m[2]));
  }
  // número de serie de planilla (1899-12-30 = 0). Rango razonable: 1955-2100.
  const n=Number(s.replace(',','.'));
  if(isFinite(n) && n>20000 && n<80000) push(new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000));
  return [...new Set(out)];
}
function repararPadreIds(){
  const ids=new Set(ITEMS.map(x=>idKey_(x.id)));
  const rotos=[], huerfanos=[];
  ITEMS.forEach(i=>{
    if(i.padre_id==null || i.padre_id==='') return;
    if(ids.has(idKey_(i.padre_id))) return;                 // resuelve bien: nada que hacer
    const cand=candidatosPadreId_(i.padre_id).find(c=>ids.has(idKey_(c)));
    if(cand){ rotos.push({item:i.id, de:String(i.padre_id).slice(0,26), a:cand}); i.padre_id=cand; }
    else     { huerfanos.push({item:i.id, padre_id:String(i.padre_id).slice(0,26), desc:(i.desc||'').slice(0,36)}); }
  });
  if(rotos.length){
    console.warn('[padre_id] '+rotos.length+' vínculo(s) recuperados de fechas de Google Sheets — GUARDÁ la obra para persistirlos');
    try{ console.table(rotos); }catch(e){}
  }
  if(huerfanos.length){
    console.warn('[padre_id] '+huerfanos.length+' subítem(s) con padre que NO resuelve — revisar a mano');
    try{ console.table(huerfanos); }catch(e){}
  }
  // aviso extra: si la misma corrupción tocó la columna id, no se puede reparar
  // sola (el id es la clave de todo: producción, certificación, plan semanal).
  const idsFecha=ITEMS.filter(x=>/^\d{4}-\d{2}-\d{2}/.test(String(x.id||''))).map(x=>x.id);
  if(idsFecha.length) console.error('[id] ⚠ hay ids guardados como FECHA en la planilla: '+idsFecha.join(', ')+' — corregir en la planilla, no se repara desde acá');
  return {rotos:rotos.length, huerfanos:huerfanos.length};
}

/* ===== JERARQUÍA / GRUPOS ============================================== */
/* --- clasificación automática de subítems (REGLA ÚNICA) ---------------
   Un hijo que cuelga de un ÍTEM DE CONTRATO se clasifica solo, por cantidad:
     · con cantidad  → subdivision (tramo, lleva plan y producción propios)
     · sin cantidad  → actividad   (no suma monto, avance por % manual)
   El HITO se mantiene explícito: no se puede deducir, porque un hito y una
   actividad de un día son idénticos en fechas.
   Un tramo con producción cargada sigue siendo tramo aunque le borren la
   cantidad (Regla C: lo ejecutado nunca se recalcula hacia abajo).
   Los hijos que cuelgan de un TÍTULO/GRUPO no entran en la regla: son ítems de
   contrato normales y siguen contando en los totales de la obra.            */
// id normalizado solo para comparar padre_id ↔ id (Sheets a veces devuelve la
// coma como separador decimal). NO parsea números: "17.10" sigue ≠ "17.1".
const idKey_ = v => String(v==null?'':v).trim().replace(/,/g,'.');
function padreDeItem(i){
  if(!i || i.padre_id==null || i.padre_id==='') return null;
  const p = byId[i.padre_id];
  if(p) return p;
  const k = idKey_(i.padre_id);
  return ITEMS.find(x=>idKey_(x.id)===k) || null;
}
// ¿este hijo cuelga de un ítem de contrato (y no de un título)?
function colgaDeItem(i){
  const p=padreDeItem(i); if(!p) return false;
  const tp=String(p.tipo||'').trim().toLowerCase();
  if(tp==='grupo' || (!tp && p.es_grupo)) return false;   // hijo de título: ítem normal
  return true;
}
// tipo deducido de un hijo de ítem. No lee 'tipo' salvo para respetar el hito.
function tipoDerivado(i){
  if(String(i.tipo||'').trim().toLowerCase()==='hito') return 'hito';
  const cv = (i.cant_ajustada!=null ? i.cant_ajustada : i.cant) || 0;
  if(cv>0) return 'subdivision';
  const pr = (typeof PROD!=='undefined' && PROD && PROD[i.id]) ? (PROD[i.id].total||0) : 0;
  if(pr>0) return 'subdivision';            // tiene producción: sigue siendo tramo
  return 'actividad';
}
// vuelca el tipo deducido a los DATOS, para que la planilla —y por lo tanto la
// PWA de producción y el rollup del backend— vean lo mismo que la pantalla.
// Se persiste en el próximo guardado; no marca la obra como modificada por sí solo.
function normalizarTipos(silencioso){
  const cambios=[];
  ITEMS.forEach(i=>{
    if(!colgaDeItem(i)) return;
    const nuevo=tipoDerivado(i);
    const viejo=String(i.tipo||'').trim().toLowerCase();
    if(viejo===nuevo) return;
    cambios.push({ id:i.id, desc:(i.desc||'').slice(0,40), de:viejo||'(vacío)', a:nuevo,
                   cant:(i.cant_ajustada!=null?i.cant_ajustada:i.cant)||0 });
    i.tipo=nuevo;
  });
  if(cambios.length && !silencioso){
    console.info('[tipos] '+cambios.length+' subítem(s) reclasificados por cantidad — se persisten al guardar');
    try{ console.table(cambios); }catch(e){}
  }
  return cambios;
}
// TIPO de un ítem (fuente de verdad). Grupo manda; un hijo de ítem se deduce por
// cantidad; para el resto vale el campo 'tipo' explícito.
function tipoDe(i){
  if(!i) return 'item';
  const t=String(i.tipo||'').trim().toLowerCase();
  if(t==='grupo') return 'grupo';
  if(!t && i.es_grupo) return 'grupo';      // marca vieja de grupo
  if(colgaDeItem(i)) return tipoDerivado(i);
  if(t) return t;
  return 'item';
}
function tieneCantidad(i){ const t=tipoDe(i); return t==='item'||t==='subdivision'; }
// ¿este ítem cuenta para los TOTALES de la obra (monto contrato, producido,
// curvas)? Sí solo los ítems de contrato. Se excluyen: grupos, actividades,
// hitos (sin cantidad) y subdivisiones (su producción ya se suma al padre en el
// backend; contarlas de nuevo duplicaría).
function esComputable(i){ return tipoDe(i)==='item'; }

// ¿este ítem tiene hijos plegables debajo? (el siguiente tiene nivel mayor).
// Sirve para mostrar la flecha ▾ y permitir plegar, INDEPENDIENTE de si es grupo.
// Un ítem de contrato con subdivisiones NO es grupo pero SÍ es plegable.
function tieneHijos(idx){
  const i=ITEMS[idx]; if(!i) return false;
  const sig=ITEMS[idx+1];
  if(sig && (sig.nivel||1) > (i.nivel||1)) return true;      // hijo por nivel (grupo/contenedor)
  // hijo por relación explícita (subdivisión/actividad/hito que cuelga de este ítem)
  return ITEMS.some(x=>x.padre_id!=null && idKey_(x.padre_id)===idKey_(i.id));
}

// ¿este ítem cuelga de otro? (subdivisión, actividad, hito, o hijo por nivel).
// Solo se usa para la LECTURA de la grilla: los ids de los subítems se pintan
// en un tono más claro para que la jerarquía se vea sin leer los números.
function esSubItem(i){
  if(!i) return false;
  if(i.padre_id!=null && String(i.padre_id)!=='') return true;
  return (i.nivel||1) > 1;
}

// hijos DIRECTOS de un ítem por relación explícita padre_id (subdivisiones,
// actividades, hitos). No usa niveles: es la relación de datos, no visual.
function hijosDirectos(itemId){
  return ITEMS.filter(x=>x.padre_id!=null && idKey_(x.padre_id)===idKey_(itemId));
}
// ¿este ítem tiene subdivisiones (tramos con cantidad)?
function tieneSubdivisiones(itemId){
  return ITEMS.some(x=>tipoDe(x)==='subdivision' && idKey_(x.padre_id)===idKey_(itemId));
}
// distribución mensual EFECTIVA para PLAN/curvas/totales. Un ítem-padre con
// subdivisiones usa la SUMA de las dist de sus tramos (los tramos son el plan
// detallado, D1); cualquier otro ítem usa la suya. `distOf(x)` obtiene la dist
// de un ítem en la fuente que toque (live: x=>x.dist_mensual; línea base:
// x=>snapshot[x.id].dist). Así el mismo criterio sirve para la curva viva y las
// congeladas, sin doble conteo (las subdivisiones nunca se suman por su cuenta).
function distEfectivaDe(i, distOf){
  if(tieneSubdivisiones(i.id)){
    const acc={}; let tot=0;
    hijosDirectos(i.id).forEach(h=>{
      if(tipoDe(h)!=='subdivision') return;
      const d=distOf(h)||{};
      Object.entries(d).forEach(([m,q])=>{ const v=+q||0; acc[m]=(acc[m]||0)+v; tot+=v; });
    });
    // si los tramos todavía no tienen distribución mensual cargada, NO se borra
    // el plan del padre: se sigue usando el suyo hasta que los tramos lo tengan.
    if(tot>0) return acc;
  }
  return distOf(i)||{};
}
// dist efectiva LIVE (desde dist_mensual) y su suma. Reemplazan el uso directo
// de i.dist_mensual / sumaCronograma en los cálculos de plan por ÍTEM DE CONTRATO.
function distPlanItem(i){ return distEfectivaDe(i, x=>x.dist_mensual||{}); }
function sumaPlanItem(i){ return round6(Object.values(distPlanItem(i)).reduce((s,v)=>s+(+v||0),0)); }
// ¿este ítem LLEVA su propio plan (no es contenedor)? = hoja de contrato (ítem
// sin subdivisiones) o una subdivisión. Un padre-con-tramos NO: su plan lo
// llevan los tramos. Sirve para sumar/reprogramar por el detalle real sin doble
// conteo (curva por motor, reprogramación por producción).
function esPortadorPlan(i){
  const t=tipoDe(i);
  if(t==='subdivision') return true;
  if(t==='item') return !tieneSubdivisiones(i.id);
  return false;
}

/* ===== PLAN SEMANAL: quien va y quien no ================================
   Un item-padre cuyos TRAMOS llevan la cantidad (subdivisiones) NO va al plan
   semanal: sus cantidades ya salen de 17.5, 17.7, etc. Repetir el padre
   duplicaria la carga de la semana y el monto. Los grupos/titulos tampoco van.
   Todo lo demas SI, incluidas las actividades e hitos SIN cantidad: son
   compromisos de la semana y cuentan para el PPC.                          */
function vaAlPlanSemanal(i){
  if(!i) return false;
  if(tipoDe(i)==='grupo') return false;          // titulo: no es un compromiso
  if(tieneSubdivisiones(i.id)) return false;     // el plan lo llevan los tramos
  if((i.estado||'').toLowerCase().includes('elimin')) return false;
  return true;
}
/* Un item que NO maneja cantidad: actividad, hito, o item cuya cantidad vigente
   es 0 y no tiene distribucion mensual. Su cumplimiento es BINARIO (se hizo o
   no se hizo) y se resuelve con el estado, no con un porcentaje de cantidad. */
function sinCantidadPlan(i){
  if(!i) return false;
  const t=tipoDe(i);
  if(t==='grupo') return false;
  if(t==='actividad'||t==='hito') return true;
  return Math.abs(cantVigente(i)||0)===0 && Math.abs(sumaCronograma(i))===0;
}
/* semanas ISO que toca el rango EFECTIVO de un item (un hito toca una sola) */
function semanasDeItem(i){
  const fe=fechasEfectivas(i);
  const a=parseD(fe.ini||i.ini);
  if(!a) return [];
  let b=parseD(fe.fin||i.fin||fe.ini||i.ini);
  if(!b || b<a) b=a;
  const out=new Set();
  for(let d=new Date(a); d<=b; d.setDate(d.getDate()+1)) out.add(isoWeekOf(d));
  return [...out].sort();
}
// rango de fechas [ini,fin] que abarcan los hijos directos de un ítem (o null)
function rangoHijos(itemId){
  let ini=null, fin=null;
  hijosDirectos(itemId).forEach(h=>{
    const a=parseD(h.ini), b=parseD(h.fin);
    if(a&&(!ini||a<ini)) ini=a;
    if(b&&(!fin||b>fin)) fin=b;
  });
  return (ini&&fin)? {ini,fin} : null;
}
// fechas EFECTIVAS de un ítem: si tiene hijos directos (subdivisiones O actividades),
// su rango de fechas/duración lo definen ellos automáticamente (el padre se comporta
// como contenedor de fechas). Si no tiene hijos, usa sus propias fechas.
function fechasEfectivas(i){
  if(!i) return {ini:null, fin:null, auto:false};
  if(hijosDirectos(i.id).length){
    const rh=rangoHijos(i.id);
    if(rh) return {ini:dstr(rh.ini), fin:dstr(rh.fin), auto:true};
  }
  return {ini:i.ini, fin:i.fin, auto:false};
}
function itemDurEf(i){
  const fe=fechasEfectivas(i);
  const a=parseD(fe.ini), b=parseD(fe.fin);
  return (a&&b)? daysBetween(a,b)+1 : null;
}

// consistencia de subdivisiones: compara la SUMA de cantidades de las
// subdivisiones contra la cantidad VIGENTE del padre (ajustada si existe, si no
// la original). Devuelve null si el ítem no tiene subdivisiones.
function chequeoSubdiv(itemId){
  const subs=ITEMS.filter(x=>tipoDe(x)==='subdivision' && idKey_(x.padre_id)===idKey_(itemId));
  if(!subs.length) return null;
  const padre=byId[itemId]; if(!padre) return null;
  const sumaSub=subs.reduce((s,x)=>s+(cantVigente(x)||0),0);
  const objetivo=cantVigente(padre)||0;
  const dif=+(sumaSub-objetivo).toFixed(4);
  return { suma:sumaSub, objetivo, dif, cuadra:Math.abs(dif)<=0.005, n:subs.length };
}

// Un ítem es "grupo/título" SOLO si su tipo lo dice. Ya NO se usa la heurística
// de "el siguiente tiene nivel mayor" para decidir grupo, porque eso rompía los
// ítems-padre-con-subdivisiones (que tienen hijos pero SÍ llevan cantidad).
function esGrupo(idx){
  const i=ITEMS[idx]; if(!i) return false;
  return tipoDe(i)==='grupo';
}
function hijosDe(idx){
  const g=ITEMS[idx]; const out=[];
  for(let k=idx+1;k<ITEMS.length;k++){
    if(ITEMS[k].nivel<=g.nivel) break;   // volvió al nivel del grupo o superior
    out.push(ITEMS[k]);
  }
  return out;
}
// hijos que cuentan para los TOTALES del grupo (monto/cant/fechas): solo ítems
// de CONTRATO (padres + hojas). Se excluyen subdivisiones (su monto ya lo aporta
// el padre → contarlas duplicaría), grupos anidados, hitos y actividades.
function hojasDe(idx){
  return hijosDe(idx).filter(c=>esComputable(c));
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
    const feh=fechasEfectivas(h);
    const a=parseD(feh.ini), b=parseD(feh.fin);
    if(a&&(!ini||a<ini)) ini=a;
    if(b&&(!fin||b>fin)) fin=b;
    monto+=h.ptot||0;
    if(tieneAjuste(h)) hayAjuste=true;
    if(umOk){
      cant += h.cant||0;
      cvig += cantVigente(h)||0;
      cplan += sumaPlanItem(h);          // padre-con-tramos: suma de sus subdivisiones
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
// ¿este ítem está oculto porque algún ANCESTRO REAL está colapsado?
// Se sube tomando, para cada nivel, el primer ítem de nivel estrictamente menor
// (ese es el contenedor). Un hermano del mismo nivel NO es ancestro. Antes se
// cortaba mal al toparse con cualquier nivel 1, lo que hacía que un grupo no se
// pudiera expandir si un grupo hermano anterior estaba colapsado.
function itemOculto(idx){
  const i=ITEMS[idx];
  let nivelBuscado=(i.nivel||1)-1;
  for(let k=idx-1;k>=0 && nivelBuscado>=1;k--){
    const nk=ITEMS[k].nivel||1;
    if(nk<=nivelBuscado){                 // primer ancestro de un nivel superior
      if(COLLAPSED.has(ITEMS[k].id)) return true;
      nivelBuscado=nk-1;                   // ahora busco el ancestro del ancestro
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
/* lunes real de una semana ISO "YYYY-Www" (inverso exacto de isoWeekOf) */
function lunesDeSemana_(wk){
  const p=String(wk||'').split('-W'); const y=+p[0], w=+p[1];
  if(!y || !w) return null;
  const j4=new Date(y,0,4), dow=(j4.getDay()||7);
  const mon=new Date(j4); mon.setDate(j4.getDate()-dow+1+(w-1)*7);
  return mon;
}
/* filas de PLAN SEMANAL de un ítem, agregadas por semana. Un padre-con-tramos
   no lleva filas propias: se suman las de sus tramos (igual que periodQty). */
function filasSemanales_(i){
  const ids = tieneSubdivisiones(i.id)
    ? hijosDirectos(i.id).filter(h=>tipoDe(h)==='subdivision').map(h=>String(h.id))
    : [String(i.id)];
  const acc={};
  WEEKLY.forEach(w=>{
    if(ids.indexOf(String(w.item_id))<0) return;
    const q=+w.cant_prevista||0; if(!q) return;
    acc[w.week]=(acc[w.week]||0)+q;
  });
  return acc;
}
/* fracción TRANSCURRIDA de un período [p0,p1] para un ítem con ventana [a,b].
   Regla única, sirve para meses y para semanas:
     · período ya cerrado      → 1
     · período futuro          → 0
     · período en curso        → días del ÍTEM transcurridos / días del ÍTEM en
       el período. Si el ítem arranca el 15 y hoy es 14, da 0: no se planea
       trabajo antes de que la actividad empiece.
   Sin fechas de ítem cae a los días del calendario del período (comportamiento
   anterior), que es lo único posible sin más información.                    */
function fracPeriodo_(p0,p1,a,b,hoy){
  if(hoy<p0) return 0;
  if(hoy>=p1) return 1;
  let ini=(a&&a>p0)?a:p0, fin=(b&&b<p1)?b:p1;
  if(fin<ini){ ini=p0; fin=p1; }        // plan fuera de la ventana del ítem
  if(hoy<ini) return 0;
  if(hoy>=fin) return 1;
  return (daysBetween(ini,hoy)+1)/(daysBetween(ini,fin)+1);
}
/* % PLANEADO de un ítem A LA FECHA, prorrateado al día.
   Fuentes, de la más fina a la más gruesa:
     1) PLAN SEMANAL, si cubre todo el plan del ítem (tolerancia 1%): semanas
        cerradas completas + la semana en curso prorrateada por días del ítem.
     2) DISTRIBUCIÓN MENSUAL: meses cerrados completos + el mes en curso
        prorrateado por los días del ítem en ese mes.
     3) Sin plan cargado: prorrateo lineal entre ini y fin.
   El denominador es SIEMPRE el plan total del ítem, así el % nunca depende de
   cuántas semanas estén cargadas.                                            */
function itemAvancePlaneado(i){
  const dist=distPlanItem(i);          // padre-con-tramos: suma de subdivisiones
  const totalPlan=Object.values(dist).reduce((s,v)=>s+(+v||0),0);
  const fe=fechasEfectivas(i);
  const a=parseD(fe.ini), b=parseD(fe.fin);
  const hoy=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());

  if(totalPlan<=0){
    if(!a||!b) return null;
    if(hoy<a) return 0; if(hoy>=b) return 100;
    return (daysBetween(a,hoy)+1)/(daysBetween(a,b)+1)*100;
  }

  // 1) plan semanal (solo si cuadra con el plan total: si está cargado a medias
  //    el mensual es más confiable que un semanal incompleto)
  const sem=filasSemanales_(i);
  const totSem=Object.values(sem).reduce((s,v)=>s+v,0);
  if(totSem>0 && Math.abs(totSem-totalPlan)<=Math.max(0.01,totalPlan*0.01)){
    let acum=0;
    for(const wk of Object.keys(sem)){
      const p0=lunesDeSemana_(wk); if(!p0) continue;
      const p1=new Date(p0); p1.setDate(p0.getDate()+6);
      acum += sem[wk]*fracPeriodo_(p0,p1,a,b,hoy);
    }
    return acum/totSem*100;
  }

  // 2) distribución mensual
  let acum=0;
  for(const mk of Object.keys(dist)){
    const val=+dist[mk]||0; if(!val) continue;
    const y=+mk.split('-')[0], m=+mk.split('-')[1];
    const p0=new Date(y,m-1,1), p1=new Date(y,m,0);
    acum += val*fracPeriodo_(p0,p1,a,b,hoy);
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
    case 'dur':  return itemDurEf(i)||0;
    case 'ini':  { const fe=fechasEfectivas(i); return fe.ini||''; }
    case 'fin':  { const fe=fechasEfectivas(i); return fe.fin||''; }
    case 'av':   return i.avance_real_prod!=null?i.avance_real_prod:(i.avance_manual!=null?i.avance_manual:-1);
    case 'avE':  { const e=i.avE!=null?i.avE:itemAvancePlaneado(i); return e!=null?e:-1; }
    case 'cplan': return sumaPlanItem(i);
    case 'cejec': { const pr=PROD[i.id]; return pr&&pr.total?pr.total:0; }
    case 'cpend': { const pr=PROD[i.id]; return sumaPlanItem(i)-((pr&&pr.total)||0); }
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

// ítem eliminado por convenio (Eliminado + cantidad ajustada = 0): SÍ se ve en el
// listado (izquierda) pero NO se dibuja su barra/celdas en el timeline (derecha).
function itemSinBarra(i){
  return (i.estado||'').toLowerCase().includes('elimin') && i.cant_ajustada!=null && i.cant_ajustada!=='' && Number(i.cant_ajustada)===0;
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
/* valor de un período para un ítem (en semanas se deriva del mensual).
   Lee la distribución EFECTIVA: un ítem-padre con tramos devuelve la SUMA de
   sus subdivisiones, no su dist_mensual propio (que es dato muerto y puede
   estar desactualizado). Así la grilla dice lo mismo que las curvas. */
function periodQty(i,p){
  if(SCALE==='month') return distPlanItem(i)[p]||0;
  // ESCALA SEMANAL: un padre con tramos tampoco lleva filas de plan semanal
  // propias (las lleva cada tramo), así que su subtotal es la suma de las
  // filas semanales de sus subdivisiones. Sin esto la fila queda en blanco.
  if(tieneSubdivisiones(i.id)){
    return round6(hijosDirectos(i.id)
      .filter(h=>tipoDe(h)==='subdivision')
      .reduce((s,h)=>{
        const w=WEEKLY.find(w=>w.item_id===h.id && w.week===p);
        return s + (w? (w.cant_prevista||0) : 0);
      },0));
  }
  const w=WEEKLY.find(w=>w.item_id===i.id && w.week===p);
  return w? (w.cant_prevista||0) : 0;
}
/* aporte de una FILA al total del período, sin doble conteo:
   · portador de plan (hoja de contrato o tramo) → su propia cantidad
   · padre con tramos → solo si sus tramos están OCULTOS (plegado); si están a
     la vista aportan ellos y el padre aporta 0. Así el total no cambia al
     plegar o desplegar.
   · grupos/títulos/actividades/hitos → 0 */
function aportePeriodo(i, p, visIds){
  if(esPortadorPlan(i)) return periodQty(i,p);
  if(tieneSubdivisiones(i.id)){
    const tramosVisibles=hijosDirectos(i.id)
      .some(h=>tipoDe(h)==='subdivision' && visIds.has(h.id));
    if(!tramosVisibles) return distPlanItem(i)[p]||0;
  }
  return 0;
}

function renderGantt(){
  ganttDomain();
  if(IS_MOBILE) return;   // en móvil el Gantt no se dibuja; su pestaña está oculta
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
    const est=estadoBadge(estadoEfectivo(i));
    const idx=ITEMS.indexOf(i);
    const grupo=esGrupo(idx);
    const plegable=tieneHijos(idx);          // grupo O ítem-padre con subdivisiones
    const rg = grupo? resumenGrupo(idx) : null;
    const indent=(i.nivel-1)*16;
    switch(c.key){
      case 'id':   { const idVis=(tipoDe(i)==='grupo')?'':i.id;
                     // jerarquía a la vista: el padre en negrita, el subítem en tono claro
                     const clsId = plegable? ' id-padre' : (esSubItem(i)? ' id-sub':'');
                     return `<div class="idc${clsId}"><input type="checkbox" class="row-check" data-id="${i.id}" ${SELSET.has(i.id)?'checked':''} title="Seleccionar">${idVis}</div>`; }
      case 'desc': {
        const toggle = plegable
          ? `<button class="grp-toggle" data-gid="${i.id}" title="Plegar/desplegar">${COLLAPSED.has(i.id)?'▸':'▾'}</button>`
          : '';
        const nH = grupo ? hijosDe(idx).filter(c=>(c.nivel||1)===((i.nivel||1)+1)).length : 0;
        const sub = grupo
          ? `<span class="um-tag">${i.cat||'Sin categoría'}</span> <span class="grp-count">${nH} ítem${nH===1?'':'s'}</span>`
          : `<span class="um-tag">${i.cat}</span> ${est}`;
        return `<div class="descc${grupo?' is-group':''}${(plegable&&!grupo)?' is-padre':''}" style="padding-left:${indent}px">
          ${toggle}<div class="desc-main"><input class="ed-desc" data-id="${i.id}" value="${(i.desc||'').replace(/"/g,'&quot;')}" placeholder="Descripción del ítem" title="Clic para seleccionar · ↑↓ moverse · Alt+→/← indentar · doble clic edita el ítem">
          <div class="rowsub">${sub}</div></div></div>`;
      }
      case 'um':   return grupo? (rg.um? `<div class="num grp-val">${rg.um}</div>` : `<div class="grp-cell"></div>`) : `<div><input class="ed-um" data-id="${i.id}" value="${i.um||''}" placeholder="um"></div>`;
      case 'cant': {
        if(grupo) return rg.cant!=null? `<div class="num grp-val">${fmtN(rg.cant)}</div>` : `<div class="grp-cell"></div>`;
        // indicador de consistencia si el ítem tiene subdivisiones
        const chk=chequeoSubdiv(i.id);
        let sig='';
        if(chk){
          sig = chk.cuadra
            ? `<span class="sub-ck ok" title="Las ${chk.n} subdivisiones suman ${fmtN(chk.suma)} = cantidad del ítem ✓">✓</span>`
            : `<span class="sub-ck bad" title="Las ${chk.n} subdivisiones suman ${fmtN(chk.suma)}, el ítem es ${fmtN(chk.objetivo)}. Diferencia: ${chk.dif>0?'+':''}${fmtN(chk.dif)}">${chk.dif>0?'+':''}${fmtN(chk.dif, Math.abs(chk.dif)<10?2:0)}</span>`;
        }
        return `<div class="cant-cell"><input class="ed-cant" data-id="${i.id}" value="${i.cant||''}" placeholder="0" title="Cantidad de contrato ORIGINAL (licitada) — referencia inmutable">${sig}</div>`;
      }
      case 'cajust': {
        if(grupo) return rg.cvig!=null && rg.hayAjuste ? `<div class="num grp-val" style="color:var(--warn,#c9820b)">${fmtN(rg.cvig)}</div>` : `<div class="grp-cell"></div>`;
        const aj = i.cant_ajustada;
        return `<div><input class="ed-cajust${aj!=null?' has-adj':''}" data-id="${i.id}" value="${aj!=null?aj:''}" placeholder="${fmtN(i.cant)}" title="Cantidad ajustada (convenio modificatorio / ajuste de alcance). Vacío = vale la original (${fmtN(i.cant)}). Vaciar la celda revierte al valor de contrato."></div>`;
      }
      case 'pu':   return grupo? `<div class="grp-cell"></div>` : `<div><input class="ed-pu" data-id="${i.id}" data-raw="${i.pu||''}" value="${i.pu?Number(i.pu).toLocaleString('es-PY'):''}" placeholder="0" title="Precio unitario" inputmode="decimal"></div>`;
      case 'ptot': return grupo? `<div class="num mono2 grp-val">${fmtG(rg.monto)}</div>` : `<div class="num mono2">${fmtG(i.ptot)}</div>`;
      case 'dur':  { if(grupo) return `<div class="num grp-val">${rg.dur!=null?rg.dur:'—'}</div>`;
                     const fe=fechasEfectivas(i);
                     if(fe.auto){ const d=itemDurEf(i); return `<div class="num grp-val" title="Duración automática: la definen sus subdivisiones/actividades">${d!=null?d:'—'}</div>`; }
                     const d=itemDur(i); return `<div><input class="ed-dur" data-id="${i.id}" value="${d!=null?d:''}" placeholder="—" title="Duración en días. Al cambiarla se corre la fecha de fin (el inicio queda fijo)."></div>`; }
      case 'ini':  { if(grupo) return `<div class="num grp-val">${rg.ini||'—'}</div>`;
                     const fe=fechasEfectivas(i); if(fe.auto) return `<div class="num grp-val" title="Inicio automático: lo define el primer hijo">${fe.ini||'—'}</div>`;
                     return `<div><input class="ed-ini" type="date" data-id="${i.id}" value="${i.ini||''}" title="Fecha de inicio"></div>`; }
      case 'fin':  { if(grupo) return `<div class="num grp-val">${rg.fin||'—'}</div>`;
                     const fe=fechasEfectivas(i); if(fe.auto) return `<div class="num grp-val" title="Fin automático: lo define el último hijo">${fe.fin||'—'}</div>`;
                     return `<div><input class="ed-fin" type="date" data-id="${i.id}" value="${i.fin||''}" title="Fecha de fin"></div>`; }
      case 'av':   { if(grupo){ if(rg.cant) { const ga=rg.cejec/rg.cant*100; return `<div class="num grp-val${ga>100.5?' over100':''}">${pct(ga)}</div>`; } return `<div class="grp-cell"></div>`; }
        const tI=tipoDe(i);
        if(tI==='actividad'||tI==='hito'){   // sin cantidad: avance MANUAL editable (mueve el verde del Gantt)
          const v=i.avance_manual!=null?i.avance_manual:'';
          return `<div><input class="ed-avm num" data-id="${i.id}" value="${v}" placeholder="—" title="Avance manual (%)" inputmode="decimal" style="width:54px"></div>`;
        }
        const a=i.avance_real_prod; return `<div class="num${a!=null&&a>100.5?' over100':''}">${a!=null?pct(a):'—'}</div>`; }
      case 'avE':  { if(grupo) return `<div class="grp-cell"></div>`; const e=i.avE!=null?i.avE:itemAvancePlaneado(i); return `<div class="num" style="color:var(--plan,#4a7fbd)">${e!=null?pct(e):'—'}</div>`; }
      case 'cplan': { if(grupo) return rg.cplan!=null? `<div class="num grp-val">${fmtN(rg.cplan)}</div>` : `<div class="grp-cell"></div>`; return `<div class="num">${fmtN(sumaPlanItem(i))}</div>`; }
      case 'cejec': { if(grupo) return rg.cejec!=null? `<div class="num grp-val">${fmtN(rg.cejec)}</div>` : `<div class="grp-cell"></div>`; const pr=PROD[i.id]; return `<div class="num">${pr&&pr.total?fmtN(pr.total):'—'}</div>`; }
      case 'cpend': { if(grupo){ if(rg.cplan!=null){ const gp=rg.cplan-rg.cejec; return `<div class="num grp-val${gp<0?' over100':''}">${fmtN(gp)}</div>`; } return `<div class="grp-cell"></div>`; } const pr=PROD[i.id]; const p=sumaPlanItem(i)-((pr&&pr.total)||0);
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
  // Al cambiar de obra el DOM se reconstruye entero; un solo requestAnimationFrame
  // puede ejecutarse ANTES de que el navegador asiente el layout, y entonces las
  // alturas de fila salen en 0/iguales → todas las barras se apilan arriba
  // ("encimadas"). Detectamos ese caso y reintentamos en el frame siguiente.
  let _intentosPintado = 0;
  const pintarGantt = ()=>{
    const gridRows=[...$('#ganttGrid').querySelectorAll('.grow-row')];
    const heights=gridRows.map(r=>r.getBoundingClientRect().height);
    // layout no asentado: hay filas pero todas miden 0 (o no hay filas todavía).
    // Reintentar hasta 5 frames; después pintar igual para no colgar nunca.
    const layoutListo = !gridRows.length || heights.some(h=>h>0);
    if(!layoutListo && _intentosPintado<5){
      _intentosPintado++;
      return requestAnimationFrame(pintarGantt);
    }
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
      // Opción 2: línea de "plazo ampliado" cuando el overlay B tiene fin de obra ajustado
      if(GANTT_LLUVIA && GANTT_LLUVIA.finObraAjust){
        const fx=gx(parseD(GANTT_LLUVIA.finObraAjust));
        lines.push(`<div class="vl plazo-ampliado" style="left:${fx}px" title="Plazo ampliado por lluvia: ${fmtDM(GANTT_LLUVIA.finObraAjust)} (+${GANTT_LLUVIA.diasGanados||0} días)"></div>`);
      }
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

      // eliminado por convenio: la fila existe (alineada con el listado) pero el lado
      // derecho del Gantt queda vacío — sin barra, sin celdas, sin hito.
      if(itemSinBarra(i)){ body.appendChild(row); return; }

      if(!isGrid){
        const gidx=ITEMS.indexOf(i);
        const grupo=esGrupo(gidx);
        const tipoI=tipoDe(i);
        if(tipoI==='hito'){
          // HITO: se dibuja como un rombo en su fecha (ini). Duración 0.
          const a=parseD(i.ini);
          if(a){
            const x=gx(i.ini);
            const hOk=(i.avance_manual||0)>=100 || estadoEfectivo(i)==='Listo';
            row.innerHTML=`<div class="bar-hito${hOk?' is-done':''}" data-id="${i.id}" title="${(i.desc||'Hito')}${hOk?' · finalizado':''}" style="left:${x-7}px"></div>
              <span class="hito-lbl" style="left:${x+10}px">${(i.desc||'').slice(0,28)}</span>`;
          }
        } else if(grupo){
          // barra RESUMEN del grupo/título: abarca de la fecha mín a la máx de sus hojas
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
          // fechas EFECTIVAS: si el ítem tiene hijos directos (subdivisiones O
          // actividades), su barra abarca el rango de ellos (contenedor de fechas),
          // pero conserva cant/monto propios. Si no tiene hijos, sus propias fechas.
          const fe=fechasEfectivas(i);
          let iniEf=fe.ini, finEf=fe.fin;
          const a=parseD(iniEf),b=parseD(finEf);
          if(a&&b){
            const x=gx(iniEf),w=Math.max(6,daysBetween(a,b)*G.pxDay);
            let av=i.avance_real_prod!=null?i.avance_real_prod:(i.avance_manual!=null?i.avance_manual:0);
            /* ITEMS SIN CANTIDAD: no hay produccion que los mida. Si el estado
               dice Listo, la barra va verde y llena. En los items CON cantidad
               sigue mandando la produccion real: el estado manual no la pisa,
               para no falsear el avance fisico. */
            const listoSinCant = sinCantidadPlan(i) && estadoEfectivo(i)==='Listo';
            if(listoSinCant) av=100;
            const esPadre=tieneSubdivisiones(i.id);      // ítem-padre (subdivisiones): estilo de contenedor+avance
            const esActiv=(tipoI==='actividad');          // actividad: sin cantidad, estilo tenue
            const claseExtra=(esPadre?' bar-padre':'')+(esActiv?' bar-activ':'');
            const baseHtml=(showBase&&bl&&bl.items[i.id]&&bl.items[i.id].ini)?
              `<div class="bar-base" style="left:${gx(bl.items[i.id].ini)}px;width:${Math.max(6,daysBetween(parseD(bl.items[i.id].ini),parseD(bl.items[i.id].fin))*G.pxDay)}px"></div>`:'';
            // overlay del Gantt corrido por lluvia (snapshot del motor day-by-day)
            let lluviaHtml='';
            if(GANTT_LLUVIA && GANTT_LLUVIA.items[i.id]){
              const s=GANTT_LLUVIA.items[i.id];
              const lx=gx(s.ini), lw=Math.max(6,daysBetween(parseD(s.ini),parseD(s.fin))*G.pxDay);
              const tip=`Corrido por lluvia: ${fmtDM(s.ini)} → ${fmtDM(s.fin)} (+${s.corrido} días`
                       + (s.estirado ? `, se estira ${s.estirado}` : '') + ')';
              lluviaHtml=`<div class="bar-lluvia" title="${tip}" style="left:${lx}px;width:${lw}px"></div>`;
            }
            row.innerHTML=`${baseHtml}${lluviaHtml}<span class="bar-date bd-l" style="left:${x-4}px">${fmtDM(iniEf)}</span>
              <div class="bar${critc}${claseExtra}${av>=100?' is-done':''}" data-id="${i.id}" style="left:${x}px;width:${w}px">
              <div class="fill" style="width:${av}%"></div><div class="lbl">${(i.desc||'').slice(0,30)}</div></div>
              <span class="bar-date" style="left:${x+w+4}px">${fmtDM(finEf)}</span>`;
          }
        }
      } else {
        const gidx=ITEMS.indexOf(i);
        const grupo=esGrupo(gidx);
        if(grupo){
          const hojas=hojasDe(gidx);
          const rgG=resumenGrupo(gidx);
          if(ganttMode==='money'){
            // en vista MONTO el grupo SÍ muestra montos: Σ de sus hojas por período.
            // distPlanItem() en cada hoja resuelve sola el caso padre-con-tramos,
            // así que el subtotal no depende de si el grupo está plegado.
            row.innerHTML = P.map((p,c)=>{
              const val=hojas.reduce((s,h)=>s+(distPlanItem(h)[p]||0)*h.pu,0);
              return `<div class="gcell grp-sum${val?' has':''}" style="left:${c*colw()}px;width:${colw()-1}px"
                title="${SCALE==='month'?monthLabel(p):p} · ${i.desc||''}: ${fmtG(val)}"
              ><span class="gv">${val?fmtMoneyCell(val):''}</span></div>`;
            }).join('');
          } else if(ganttMode==='qty' && rgG.um){
            // en CANTIDAD, si la UM es uniforme (ej. terraplén por progresivas,
            // todo m3), el grupo suma las cantidades de sus hojas por período
            row.innerHTML = P.map((p,c)=>{
              const val=hojas.reduce((s,h)=>s+(distPlanItem(h)[p]||0),0);
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
        // Un padre con tramos NO edita meses: su fila es un SUBTOTAL derivado de
        // las subdivisiones. Editarla reescribiría dato muerto y volvería a
        // desincronizar la pantalla de las curvas.
        const portador = esPortadorPlan(i);
        const editable = (ganttMode==='qty'||ganttMode==='pct') && portador;
        row.innerHTML = P.map((p,c)=>{
          const q=periodQty(i,p);
          const val = ganttMode==='money'? q*i.pu : (ganttMode==='pct'? (cantVigente(i)? q/cantVigente(i)*100:0) : q);
          const lab = q ? (ganttMode==='money' ? fmtMoneyCell(val)
                        : ganttMode==='pct'   ? val.toFixed(1)+'%'
                        : fmtQty(q)) : '';
          const inR = i.ini&&i.fin && (SCALE==='month'
            ? (p>=String(i.ini).slice(0,7) && p<=String(i.fin).slice(0,7)) : true);
          const fill = q&&maxVal? Math.min(1,val/maxVal):0;
          const tip = portador
            ? `${SCALE==='month'?monthLabel(p):p} · ${fmtN(q)} ${i.um||''} · ${(cantVigente(i)?q/cantVigente(i)*100:0).toFixed(1)}% · ${fmtG(q*i.pu)}`
            : `${SCALE==='month'?monthLabel(p):p} · SUBTOTAL de los tramos: ${fmtN(q)} ${i.um||''} · ${fmtG(q*i.pu)}&#10;No editable: cargá la cantidad en los subtramos.`;
          return `<div class="gcell${editable?' edit':''}${portador?'':' derivado'}${q?' has':''}${inR?' inrange':''}"
            data-id="${i.id}" data-m="${p}"
            style="left:${c*colw()}px;width:${colw()-1}px;--fill:${fill.toFixed(3)}"
            title="${tip}"
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
      const visIds=new Set(list.map(x=>x.id));
      const totals=P.map(p=>list.reduce((s,i)=>s+aportePeriodo(i,p,visIds)*i.pu,0));
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
        const suma=sumaPlanItem(i), dif=difContrato(i);
        // MISMA tolerancia que ajustarDif(): si el ajuste lo corregiría, no
        // puede figurar como ✓. Con 0.005 se daban por buenas diferencias que
        // sí movían el monto planeado.
        const ok=Math.abs(dif)<1e-6;
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
      const nOk=list.filter(i=>Math.abs(difContrato(i))<1e-6).length;
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
  };
  // doble requestAnimationFrame: el primero deja que el navegador procese el DOM
  // recién insertado, el segundo se ejecuta ya con el layout asentado. Así las
  // alturas de fila son correctas desde el primer pintado (sin barras encimadas).
  requestAnimationFrame(()=>requestAnimationFrame(pintarGantt));
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

// estado EFECTIVO: la producción manda. Eliminado/Estancado (marcas manuales) se
// respetan; si no, se deriva de la producción: ≥100% de la cantidad vigente = Listo,
// >0 = En proceso, sin producción = lo que tenga (Pendiente por defecto).
function estadoEfectivo(i){
  if(!i) return 'Pendiente';
  const e=(i.estado||'').toLowerCase();
  if(e.includes('elimin')) return 'Eliminado';   // marca de convenio: se respeta
  if(e.includes('estanc')) return 'Estancado';   // marca manual "trabado": se respeta
  // ITEMS SIN CANTIDAD (actividades, hitos, cantidad 0): no hay produccion que
  // los mida, asi que el "Listo" manual es la unica fuente de verdad y manda
  // sobre cualquier otra cosa. Es lo que pinta la barra verde en el Gantt.
  if(e.includes('listo') && sinCantidadPlan(i)) return 'Listo';
  const av=i.avance_real_prod;                    // % producido sobre la cantidad vigente
  if(av!=null && av>0) return av>=100 ? 'Listo' : 'En proceso';
  // sin produccion cargada: el avance MANUAL (columna Av. de actividades/hitos)
  // tambien define el estado, para que los dos controles digan lo mismo.
  const am=i.avance_manual;
  if(am!=null && am>0) return am>=100 ? 'Listo' : 'En proceso';
  return i.estado || 'Pendiente';
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
  // el SVG no debe robar clics a las barras; solo las líneas de golpe (.dep-hit)
  // vuelven a habilitar pointer-events para poder editar/borrar la dependencia.
  svg.style.pointerEvents='none';
  if(ganttMode!=='time'){svg.innerHTML='';return;}
  const idx={}; list.forEach((i,k)=>idx[i.id]=k);
  const cy=k=>tops[k]+Math.min(heights[k]/2, 8+10);   // bar centre within row
  const parts=[`<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 Z" fill="#6f9bd1"/></marker></defs>`];
  list.forEach((i,k)=>{
    if(!i.ini||!i.fin||itemSinBarra(i)) return;
    (i.deps||[]).forEach(dep=>{
      const pk=idx[dep.id]; const p=byId[dep.id];
      if(pk==null||!p||!p.ini||!p.fin||itemSinBarra(p)) return;
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
      // línea de golpe invisible y más gruesa: hace la flecha clickeable para
      // editar el tipo/desfase o eliminar el vínculo.
      parts.push(`<path class="dep-hit" d="${d}" fill="none" stroke="transparent" stroke-width="9"
        style="pointer-events:stroke;cursor:pointer" data-pred="${xmlA(dep.id)}" data-suc="${xmlA(i.id)}"><title>${xmlA(dep.id)} → ${xmlA(i.id)} · ${dep.type}${dep.lag?(dep.lag>0?'+':'')+dep.lag+'d':''} — clic para editar</title></path>`);
    });
  });
  svg.innerHTML=parts.join('');
  svg.querySelectorAll('.dep-hit').forEach(p=>{
    p.addEventListener('click', ev=>{
      ev.stopPropagation();
      abrirDepPopover(p.dataset.suc, p.dataset.pred, ev.clientX, ev.clientY);
    });
  });
}
/* escape para atributos dentro de strings SVG/HTML */
function xmlA(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
    // clic derecho → menú de creación de elementos en contexto
    row.addEventListener('contextmenu',e=>{
      e.preventDefault();
      abrirCtxMenu(e.clientX,e.clientY,row.dataset.id);
    });
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
        if(e.key==='ArrowRight') i.nivel=Math.min(8,(i.nivel||1)+1);
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
        if(e.key==='ArrowRight') i.nivel=Math.min(8,(i.nivel||1)+1);
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
  $$('#ganttGrid .ed-pu').forEach(inp=>{
    // al enfocar: mostrar el número crudo para editar cómodo
    inp.onfocus=e=>{ const r=e.target.dataset.raw; e.target.value=(r&&Number(r))?String(Number(r)):''; e.target.select&&e.target.select(); };
    inp.onchange=e=>{
      const i=byId[e.target.dataset.id]; i.pu=parseNum(e.target.value);
      e.target.dataset.raw=i.pu||'';
      // al confirmar: reformatear con separador de miles
      e.target.value=i.pu?Number(i.pu).toLocaleString('es-PY'):'';
      touch(); renderGantt(); renderKPIs(); };
  });
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
    const mv=cascade(i);                 // las dependencias empujan a los sucesores
    touch(); renderGantt(); renderKPIs();
    if(mv) toast(`<b>${mv}</b> ítem(s) reprogramado(s) por dependencia`); });
  $$('#ganttGrid .ed-fin').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; const v=e.target.value;
    if(v && i.ini && parseD(v)<parseD(i.ini)){ toast('El fin no puede ser anterior al inicio'); renderGantt(); return; }
    i.fin=v||i.fin; syncWeeksFromMonths(i);
    const mv=cascade(i);
    touch(); renderGantt(); renderKPIs();
    if(mv) toast(`<b>${mv}</b> ítem(s) reprogramado(s) por dependencia`); });
  // avance MANUAL de actividades/hitos (sin cantidad): 0–100. Pinta el verde del
  // Gantt y marca "finalizado" al llegar a 100. Vacío = sin avance.
  $$('#ganttGrid .ed-avm').forEach(inp=>inp.onchange=e=>{
    const i=byId[e.target.dataset.id]; const raw=String(e.target.value).trim();
    if(raw===''){ i.avance_manual=null; }
    else { let v=parseNum(raw); if(!isFinite(v)||isNaN(v)) v=0; i.avance_manual=Math.max(0,Math.min(100,v)); }
    touch(); renderGantt(); });
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
  bindLinkHandles();
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
  if(!esPortadorPlan(i)){        // padre con tramos: la fila es un subtotal derivado
    SEL.editing=false;
    toast('Ese ítem no lleva plan propio: cargá la cantidad en sus subtramos');
    return;
  }
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
  const q=periodQty(i,m)||0;   // efectiva: el padre copia el subtotal de sus tramos
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
    const i=byId[GRIDMAP.rows[r]]; if(!i || !esPortadorPlan(i)) continue;   // el padre no lleva plan propio
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
  let omitidos=0;
  grid.forEach((line,dr)=>{
    const i=byId[GRIDMAP.rows[r0+dr]]; if(!i) return;
    if(!esPortadorPlan(i)){ omitidos++; return; }   // padre con tramos: fila derivada
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
  if(omitidos) toast(`<b>${omitidos}</b> fila(s) omitida(s): son ítems padre y su plan lo llevan los subtramos`);
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

/* =======================================================================
   VÍNCULOS POR MOUSE — crear dependencias arrastrando sobre el Gantt
   -----------------------------------------------------------------------
   Al pasar el mouse por una barra aparecen dos manijas (inicio y fin).
   Se arrastra desde una manija hasta OTRA barra y el vínculo queda creado.
   El TIPO sale del par de extremos, igual que en MS Project:
       fin → inicio  = FS      inicio → inicio = SS
       fin → fin     = FF      inicio → fin    = SF
   El ítem donde ARRANCA el arrastre es el PREDECESOR.
   Arrastrar el CUERPO de la barra sigue siendo reprogramar (startDrag): la
   manija es un elemento aparte, así que los dos gestos no se pisan.
   ======================================================================= */
const LINK = { on:false, pred:null, ladoP:null, path:null, x0:0, y0:0, target:null };

/* ¿este elemento puede participar de un vínculo?
   Grupos/títulos NO: sus fechas se derivan de los hijos (resumenGrupo), así que
   un vínculo sobre ellos mentiría. Eliminados por convenio tampoco (no hay barra). */
function puedeVincular(i){
  if(!i || !i.ini || !i.fin) return false;
  if(itemSinBarra(i)) return false;
  const idx=ITEMS.indexOf(i);
  if(idx<0 || esGrupo(idx)) return false;
  return true;
}

/* CSS del módulo: se inyecta desde acá para no tocar index.html */
function injectLinkCss(){
  if(document.getElementById('depLinkCss')) return;
  const st=document.createElement('style'); st.id='depLinkCss';
  st.textContent=`
  .dep-h{position:absolute;width:11px;height:11px;margin-top:-5.5px;border-radius:50%;
    background:var(--station,#2ec5c5);border:2px solid var(--asphalt,#0d1b2a);
    box-shadow:0 0 0 1px rgba(0,0,0,.45);cursor:crosshair;z-index:12}
  .dep-h:hover{width:14px;height:14px;margin-top:-7px}
  body.linking{cursor:crosshair}
  body.linking .dep-h{pointer-events:none}
  body.linking .bar,body.linking .bar-hito{cursor:crosshair}
  body.linking .dep-svg{z-index:20}
  .link-target{outline:2px solid var(--station,#2ec5c5);outline-offset:2px}
  .dep-pop{position:fixed;z-index:9000;background:var(--asphalt-2,#13253a);
    border:1px solid var(--line,#28405e);border-radius:7px;padding:9px 10px;
    box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:var(--sans,sans-serif);
    color:var(--paper,#f5f3ec);font-size:12px;min-width:216px}
  .dep-pop .dp-t{font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;
    color:var(--ink-soft,#8b98a6);margin-bottom:7px}
  .dep-pop .dp-r{display:flex;align-items:center;gap:6px;margin-bottom:7px}
  .dep-pop select,.dep-pop input{background:var(--band,#1b3350);color:var(--paper,#f5f3ec);
    border:1px solid var(--line,#28405e);border-radius:4px;padding:3px 5px;font-size:12px}
  .dep-pop input{width:58px;text-align:right}
  .dep-pop .dp-a{display:flex;gap:6px;justify-content:space-between;margin-top:9px}
  .dep-pop button{border-radius:4px;padding:4px 9px;font-size:11.5px;font-weight:600}
  .dep-pop .dp-del{background:rgba(214,69,69,.16);color:#ef8b8b;border:1px solid rgba(214,69,69,.45)}
  .dep-pop .dp-ok{background:var(--tape,#f2c200);color:#1a1200}
  .chipbtn.dep-chain{background:rgba(46,197,197,.14);color:var(--station,#2ec5c5);
    border:1px solid rgba(46,197,197,.42);border-radius:4px;padding:3px 9px;font-weight:600}
  /* celda mensual DERIVADA (padre con tramos): subtotal, no editable */
  .gcell.derivado{cursor:default}
  .gcell.derivado .gv{font-style:italic;opacity:.72}
  .gcell.derivado::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;
    background:repeating-linear-gradient(90deg,rgba(140,150,165,.55) 0 3px,transparent 3px 6px)}
  /* modal simple del preview de limpieza */
  .ms-back{position:fixed;inset:0;z-index:9500;background:rgba(6,12,20,.62);
    display:flex;align-items:center;justify-content:center;padding:22px}
  .ms-box{background:var(--asphalt-2,#13253a);border:1px solid var(--line,#28405e);
    border-radius:10px;box-shadow:0 22px 60px rgba(0,0,0,.55);color:var(--paper,#f5f3ec);
    font-family:var(--sans,sans-serif);max-width:940px;width:100%;max-height:86vh;
    display:flex;flex-direction:column}
  .ms-head{padding:12px 14px;border-bottom:1px solid var(--line,#28405e);font-weight:700;
    font-size:14px;display:flex;justify-content:space-between;align-items:center}
  .ms-x{background:none;color:var(--ink-soft,#8b98a6);font-size:15px;padding:0 4px}
  .ms-body{padding:13px 14px;overflow:auto;font-size:12.5px}
  .ms-foot{padding:11px 14px;border-top:1px solid var(--line,#28405e);
    display:flex;gap:8px;justify-content:flex-end}
  .ms-foot button{border-radius:5px;padding:6px 14px;font-size:12.5px;font-weight:600}
  .ms-cancel{background:var(--band,#1b3350);color:var(--paper,#f5f3ec);border:1px solid var(--line,#28405e)}
  .ms-ok{background:var(--tape,#f2c200);color:#1a1200}
  .lm-warn{background:rgba(242,194,0,.10);border:1px solid rgba(242,194,0,.35);
    border-radius:6px;padding:9px 11px;margin-bottom:11px;line-height:1.5}
  .lm-tab{width:100%;border-collapse:collapse;font-size:12px}
  .lm-tab th,.lm-tab td{border-bottom:1px solid var(--line,#28405e);padding:5px 7px;text-align:left}
  .lm-tab th{color:var(--ink-soft,#8b98a6);font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}
  .lm-tab .num{text-align:right;font-variant-numeric:tabular-nums}
  .lm-tab .lm-id{font-weight:700}
  .lm-tab .lm-old{color:#ef8b8b;text-decoration:line-through}
  .lm-tab .lm-new{color:var(--station,#2ec5c5);font-weight:700}
  .lm-otras{margin-top:10px;color:var(--ink-soft,#8b98a6)}
  .lm-tot{margin-top:11px;font-weight:700}
  .lm-conf{margin-top:12px;display:flex;align-items:center;gap:8px}
  .lm-conf input{background:var(--band,#1b3350);color:var(--paper,#f5f3ec);
    border:1px solid var(--line,#28405e);border-radius:4px;padding:4px 8px;font-size:12.5px;width:130px}
  .chipbtn.lm-btn{background:rgba(242,194,0,.12);color:var(--tape,#f2c200);
    border:1px solid rgba(242,194,0,.40);border-radius:4px;padding:3px 9px;font-weight:600}`;
  document.head.appendChild(st);
}

/* manijas: aparecen al pasar el mouse por una barra, se van al salir de la fila */
function quitarHandles(){ $$('#timeBody .dep-h').forEach(h=>h.remove()); }
function mostrarHandles(bar){
  if(LINK.on) return;
  quitarHandles();
  const i=byId[bar.dataset.id];
  if(!puedeVincular(i)) return;
  const row=bar.parentElement; if(!row) return;
  /* OJO: la manija es hija de la FILA, así que su `top` va en coordenadas de la
     fila (mismo offsetParent que la barra). Sumar row.offsetTop acá duplicaba
     el desplazamiento y tiraba el círculo filas más abajo. */
  const yRow = bar.offsetTop + bar.offsetHeight/2;
  [['l', bar.offsetLeft], ['r', bar.offsetLeft + bar.offsetWidth]].forEach(([lado,x])=>{
    const h=document.createElement('div');
    h.className='dep-h'; h.dataset.lado=lado; h.dataset.id=i.id;
    h.style.left=(x-5.5)+'px'; h.style.top=yRow+'px';
    h.title = lado==='l' ? 'Arrastrar desde el INICIO de este ítem para vincular'
                         : 'Arrastrar desde el FIN de este ítem para vincular';
    h.addEventListener('mousedown', ev=>startLink(ev, bar, i.id, lado));
    row.appendChild(h);
  });
}
function bindLinkHandles(){
  if(ganttMode!=='time' || IS_MOBILE) return;
  $$('#timeBody .bar, #timeBody .bar-hito').forEach(bar=>{
    bar.addEventListener('mouseenter', ()=>mostrarHandles(bar));
  });
  $$('#timeBody .trow').forEach(row=>{
    row.addEventListener('mouseleave', ()=>{ if(!LINK.on) quitarHandles(); });
  });
}

/* arrastre de la manija hasta la barra destino */
function startLink(ev, bar, predId, lado){
  ev.preventDefault(); ev.stopPropagation();
  const svg=$('#depSvg'), tb=$('#timeBody');
  if(!svg||!tb) return;
  /* Origen de la línea elástica en coordenadas del #timeBody (que es el sistema
     del SVG). Se saca de los rects reales: no depende de la cadena de
     offsetParent, así que no se puede volver a desfasar. */
  const rTb=tb.getBoundingClientRect(), rB=bar.getBoundingClientRect();
  const x0=(lado==='r'? rB.right : rB.left) - rTb.left;
  const y0=rB.top + rB.height/2 - rTb.top;
  LINK.on=true; LINK.pred=predId; LINK.ladoP=lado; LINK.x0=x0; LINK.y0=y0; LINK.target=null;
  document.body.classList.add('linking');

  LINK.path=document.createElementNS('http://www.w3.org/2000/svg','path');
  LINK.path.setAttribute('fill','none');
  LINK.path.setAttribute('stroke','#2ec5c5');
  LINK.path.setAttribute('stroke-width','1.8');
  LINK.path.setAttribute('stroke-dasharray','4 3');
  svg.appendChild(LINK.path);

  const move=m=>{
    const r=tb.getBoundingClientRect();
    const px=m.clientX-r.left, py=m.clientY-r.top;
    LINK.path.setAttribute('d', `M${LINK.x0},${LINK.y0} L${px},${py}`);
    // resaltar la barra bajo el cursor si es un destino válido
    const el=document.elementFromPoint(m.clientX, m.clientY);
    const cand=el && el.closest ? el.closest('.bar, .bar-hito') : null;
    const nuevo=(cand && cand.dataset.id!==predId && puedeVincular(byId[cand.dataset.id])) ? cand : null;
    if(nuevo!==LINK.target){
      if(LINK.target) LINK.target.classList.remove('link-target');
      LINK.target=nuevo;
      if(LINK.target) LINK.target.classList.add('link-target');
    }
  };
  const up=m=>{
    document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
    document.body.classList.remove('linking');
    if(LINK.path && LINK.path.parentNode) LINK.path.parentNode.removeChild(LINK.path);
    const destino=LINK.target;
    if(destino) destino.classList.remove('link-target');
    LINK.on=false; LINK.path=null; LINK.target=null;
    if(!destino){ quitarHandles(); return; }
    // lado de LLEGADA: mitad izquierda de la barra destino = inicio, si no = fin
    const r=destino.getBoundingClientRect();
    const ladoS = (m.clientX - r.left) < r.width/2 ? 'l' : 'r';
    const tipo = (lado==='r' && ladoS==='l') ? 'FS'
               : (lado==='l' && ladoS==='l') ? 'SS'
               : (lado==='r' && ladoS==='r') ? 'FF' : 'SF';
    crearDep(predId, destino.dataset.id, tipo);
  };
  document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
}

/* alta de una dependencia con todas las guardas.
   Devuelve true si quedó creada. */
function crearDep(predId, sucId, tipo, silencio){
  const p=byId[predId], s=byId[sucId];
  if(!p||!s||predId===sucId) return false;
  if(!puedeVincular(p)||!puedeVincular(s)){
    if(!silencio) toast('Solo se pueden vincular ítems con barra propia (los títulos y los eliminados no)');
    return false;
  }
  s.deps=s.deps||[];
  if(s.deps.some(d=>String(d.id)===String(predId))){
    if(!silencio) toast(`<b>${sucId}</b> ya depende de <b>${predId}</b>`);
    return false;
  }
  s.deps.push({id:predId, type:tipo||'FS', lag:0});
  if(!topoSort()){                       // ciclo: deshacer y avisar
    s.deps.pop();
    if(!silencio) toast('Ese vínculo genera una dependencia circular — no se creó');
    return false;
  }
  if(silencio) return true;              // el encadenado recalcula una sola vez al final
  const mv=recalcSchedule(sucId);
  touch(); renderGantt(); renderKPIs();
  toast(`<b>${predId}</b> → <b>${sucId}</b> · ${tipo} (${DEP_TYPES[tipo]})`
        + (mv? ` · <b>${mv}</b> ítem(s) reprogramado(s)` : ' · sin cambios de fecha'));
  return true;
}

/* encadenar en Fin→Inicio todos los ítems tildados, en el orden del listado */
function encadenarSeleccion(){
  const ids=ITEMS.filter(i=>SELSET.has(i.id) && puedeVincular(i)).map(i=>i.id);
  if(ids.length<2){ toast('Elegí al menos 2 ítems vinculables (los títulos y los eliminados no cuentan)'); return; }
  let n=0;
  for(let k=1;k<ids.length;k++){ if(crearDep(ids[k-1], ids[k], 'FS', true)) n++; }
  if(!n){ toast('No se creó ningún vínculo nuevo (ya existían o generaban ciclo)'); return; }
  const mv=recalcSchedule();
  touch(); renderGantt(); renderKPIs();
  toast(`<b>${n}</b> vínculo(s) Fin→Inicio creado(s)`
        + (mv? ` · <b>${mv}</b> ítem(s) reprogramado(s)` : ''));
}

/* popover de la flecha: cambiar tipo, desfase en días, o eliminar el vínculo */
function cerrarDepPopover(){
  const p=document.getElementById('depPop');
  if(p){ p.remove(); document.removeEventListener('mousedown', depPopFuera, true); }
}
function depPopFuera(e){ if(!e.target.closest || !e.target.closest('#depPop')) cerrarDepPopover(); }
function abrirDepPopover(sucId, predId, cx, cy){
  cerrarDepPopover();
  const s=byId[sucId]; if(!s) return;
  const k=(s.deps||[]).findIndex(d=>String(d.id)===String(predId));
  if(k<0) return;
  const dep=s.deps[k];
  const pop=document.createElement('div');
  pop.className='dep-pop'; pop.id='depPop';
  pop.innerHTML=`
    <div class="dp-t">${xmlA(predId)} → ${xmlA(sucId)}</div>
    <div class="dp-r">
      <select id="dpTipo">${Object.entries(DEP_TYPES).map(([t,l])=>
        `<option value="${t}" ${t===dep.type?'selected':''}>${t} · ${l}</option>`).join('')}</select>
    </div>
    <div class="dp-r"><span>Desfase</span>
      <input id="dpLag" type="number" step="1" value="${dep.lag||0}"><span>días</span></div>
    <div class="dp-a">
      <button class="dp-del" id="dpDel">Eliminar vínculo</button>
      <button class="dp-ok" id="dpOk">Aplicar</button>
    </div>`;
  document.body.appendChild(pop);
  const w=pop.offsetWidth, h=pop.offsetHeight;
  pop.style.left=Math.max(6, Math.min(window.innerWidth-w-6, cx-w/2))+'px';
  pop.style.top =Math.max(6, Math.min(window.innerHeight-h-6, cy+12))+'px';

  pop.querySelector('#dpDel').onclick=()=>{
    s.deps.splice(k,1);
    cerrarDepPopover(); touch(); renderGantt(); renderKPIs();
    toast(`Vínculo <b>${predId}</b> → <b>${sucId}</b> eliminado (las fechas no se mueven)`);
  };
  pop.querySelector('#dpOk').onclick=()=>{
    const tipo=pop.querySelector('#dpTipo').value;
    const lag=Math.round(parseNum(pop.querySelector('#dpLag').value))||0;
    dep.type=tipo; dep.lag=lag;
    if(!topoSort()){ toast('Dependencia circular — revisá el vínculo'); return; }
    cerrarDepPopover();
    const mv=recalcSchedule(sucId);
    touch(); renderGantt(); renderKPIs();
    toast(`Vínculo actualizado a <b>${tipo}${lag?(lag>0?'+':'')+lag+'d':''}</b>`
          + (mv? ` · <b>${mv}</b> ítem(s) reprogramado(s)` : ' · sin cambios de fecha'));
  };
  setTimeout(()=>document.addEventListener('mousedown', depPopFuera, true), 0);
}

/* botón «Vincular» en la barra de selección múltiple (se inyecta, no toca el HTML) */
function injectChainBtn(){
  const cont=document.querySelector('#selBar .sel-actions');
  if(!cont || document.getElementById('selChainBtn')) return;
  const b=document.createElement('button');
  b.id='selChainBtn'; b.className='chipbtn dep-chain';
  b.textContent='⛓ Vincular FS';
  b.title='Encadenar los ítems seleccionados en Fin→Inicio, en el orden del listado';
  b.onclick=encadenarSeleccion;
  cont.insertBefore(b, cont.firstChild);
}
injectLinkCss();
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', injectChainBtn);
else injectChainBtn();

/* =======================================================================
   LIMPIEZA DE DATO MUERTO DE ÍTEMS PADRE
   -----------------------------------------------------------------------
   Un ítem-padre con subdivisiones NO lleva plan propio: su plan lo llevan los
   tramos. Pero de cargas viejas pueden quedar dos residuos:
     · su dist_mensual propio (que ya no describe nada real)
     · filas suyas en PlanSemanal (hoy ocultas, pero siguen en el Sheet)
   Esta acción los elimina. Es DESTRUCTIVA, así que el preview es obligatorio
   y hay que confirmar escribiendo. Nada se toca sin confirmación explícita.
   NO toca cantidades de contrato, fechas, ni nada de los tramos.
   ======================================================================= */
function diagnosticoResiduos(){
  const padres=[];
  ITEMS.forEach(i=>{
    if(!tieneSubdivisiones(i.id)) return;
    const dm=i.dist_mensual||{};
    const meses=Object.keys(dm).filter(m=>Math.abs(+dm[m]||0)>0).sort();
    const filas=WEEKLY.filter(w=>String(w.item_id)===String(i.id));
    if(!meses.length && !filas.length) return;
    padres.push({
      i, meses, filas,
      sumaPropia: round6(meses.reduce((s,m)=>s+(+dm[m]||0),0)),
      sumaTramos: sumaPlanItem(i)
    });
  });
  // filas de plan semanal de ítems que hoy ya no van al plan (grupos, eliminados)
  const otras=WEEKLY.filter(w=>{
    const it=byId[w.item_id];
    if(!it) return false;
    if(tieneSubdivisiones(it.id)) return false;   // ya contadas arriba
    return !vaAlPlanSemanal(it);
  });
  return {padres, otras};
}

function abrirLimpieza(){
  const {padres, otras}=diagnosticoResiduos();
  const nFilas=padres.reduce((s,p)=>s+p.filas.length,0)+otras.length;
  if(!padres.length && !otras.length){
    toast('No hay dato muerto para limpiar: los ítems padre ya están limpios');
    return;
  }
  const filasHTML=padres.map(p=>`
    <tr>
      <td class="lm-id">${p.i.id}</td>
      <td>${(p.i.desc||'').slice(0,52)}</td>
      <td class="num">${p.meses.length? p.meses.map(m=>monthLabel(m)).join(', ') : '—'}</td>
      <td class="num lm-old">${p.meses.length? fmtN(p.sumaPropia) : '—'}</td>
      <td class="num lm-new">${fmtN(p.sumaTramos)}</td>
      <td class="num">${p.filas.length||'—'}</td>
    </tr>`).join('');

  const html=`
    <div class="lm-warn">Esto borra <b>dato muerto</b>: la distribución mensual propia de los
      ítems padre y sus filas viejas del plan semanal. <b>No toca</b> cantidades de contrato,
      fechas, subtramos, producción ni certificación. Se aplica recién al guardar.</div>
    <table class="lm-tab">
      <thead><tr><th>ID</th><th>Ítem</th><th>Meses propios</th>
        <th class="num">Suma propia</th><th class="num">Suma tramos</th><th class="num">Filas plan</th></tr></thead>
      <tbody>${filasHTML || '<tr><td colspan="6">Ningún ítem padre con distribución propia</td></tr>'}</tbody>
    </table>
    ${otras.length? `<div class="lm-otras">Además hay <b>${otras.length}</b> fila(s) del plan semanal
      de ítems que ya no van al plan (títulos o eliminados). También se eliminan.</div>` : ''}
    <div class="lm-tot"><b>${padres.length}</b> ítem(s) padre a limpiar ·
      <b>${nFilas}</b> fila(s) del plan semanal a eliminar</div>
    <div class="lm-conf">Para confirmar, escribí <b>LIMPIAR</b>:
      <input id="lmConf" autocomplete="off" placeholder="LIMPIAR"></div>`;

  abrirModalSimple('Limpiar dato muerto de ítems padre', html, ()=>{
    const txt=($('#lmConf')&&$('#lmConf').value||'').trim().toUpperCase();
    if(txt!=='LIMPIAR'){ toast('Escribí LIMPIAR para confirmar'); return false; }
    aplicarLimpieza(padres, otras);
    return true;
  }, 'Limpiar');
}

function aplicarLimpieza(padres, otras){
  let nMeses=0, nFilas=0;
  padres.forEach(p=>{
    nMeses += p.meses.length;
    p.i.dist_mensual={};
    if(p.i._manualMonths) p.i._manualMonths={};
  });
  const aBorrar=new Set();
  padres.forEach(p=>p.filas.forEach(w=>aBorrar.add(w)));
  otras.forEach(w=>aBorrar.add(w));
  aBorrar.forEach(w=>{ if(w.plan_id) deletedWeekly.push(w.plan_id); nFilas++; });
  for(let k=WEEKLY.length-1;k>=0;k--) if(aBorrar.has(WEEKLY[k])) WEEKLY.splice(k,1);

  touch(); touch('weekly');
  renderGantt(); renderKPIs();
  if(typeof renderWeekly==='function') renderWeekly();
  toast(`Limpieza aplicada: <b>${nMeses}</b> mes(es) propios de padres vaciados y
         <b>${nFilas}</b> fila(s) del plan semanal eliminadas. Guardá para persistirlo.`);
}

/* modal genérico chiquito para el preview (no depende de index.html) */
function abrirModalSimple(titulo, innerHTML, onOk, okLabel){
  cerrarModalSimple();
  const back=document.createElement('div');
  back.className='ms-back'; back.id='msBack';
  back.innerHTML=`<div class="ms-box">
      <div class="ms-head">${titulo}<button class="ms-x" id="msX">✕</button></div>
      <div class="ms-body">${innerHTML}</div>
      <div class="ms-foot">
        <button class="ms-cancel" id="msCancel">Cancelar</button>
        <button class="ms-ok" id="msOk">${okLabel||'Aceptar'}</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.querySelector('#msX').onclick=cerrarModalSimple;
  back.querySelector('#msCancel').onclick=cerrarModalSimple;
  back.querySelector('#msOk').onclick=()=>{ if(onOk()!==false) cerrarModalSimple(); };
  back.addEventListener('mousedown', e=>{ if(e.target===back) cerrarModalSimple(); });
}
function cerrarModalSimple(){ const b=document.getElementById('msBack'); if(b) b.remove(); }

/* La limpieza es una MIGRACIÓN de una sola vez por obra, no una función de uso
   diario: no lleva botón en pantalla. Queda accesible desde la consola del
   navegador con  limpiarPadres()  por si otra obra arrastra el mismo residuo.
   El preview con confirmación escrita sigue siendo obligatorio igual. */
window.limpiarPadres = abrirLimpieza;

/* ---- add / delete items ---- */
/* ---- creación de elementos por TIPO ----
   tipos: 'item' | 'grupo' (título) | 'actividad' | 'hito' | 'subdivision'
   opts.despuesDe: id del ítem tras el cual insertar (si no, va al final)
   opts.padreId:   para subdivisiones/actividades/hitos, de quién cuelgan       */
function crearElemento(tipo, opts){
  opts = opts || {};
  const padre = opts.padreId ? byId[opts.padreId] : null;

  // ID según tipo:
  // - grupo/título: SIN id (no consume numeración; no es un ítem cargable)
  // - subdivision/actividad/hito con padre: id jerárquico padre.N (1.1, 1.2…)
  // - item suelto: siguiente entero disponible
  let nuevoId;
  if(tipo==='grupo'){
    // los títulos NO consumen numeración de ítems, pero necesitan un id interno
    // único para que el sistema los maneje (byId, guardado). Usamos 'T'+n, que
    // no colisiona con ids numéricos ni jerárquicos, y se OCULTA en la vista.
    let n=1; while(ITEMS.some(x=>String(x.id)==='T'+n)) n++;
    nuevoId='T'+n;
  } else if(padre && (tipo==='subdivision'||tipo==='actividad'||tipo==='hito')){
    // buscar cuántos hijos directos ya tiene el padre para el sufijo .N
    const base=String(padre.id);
    let n=1;
    while(ITEMS.some(x=>String(x.id)===base+'.'+n)) n++;
    nuevoId=base+'.'+n;
  } else {
    const maxId=Math.max(0,...ITEMS.map(i=>parseInt(i.id)||0));
    nuevoId=String(maxId+1);
  }

  // nivel base: si cuelga de un padre, un nivel más que el padre; si no, nivel 1
  const nivelBase = padre ? Math.min(8,(padre.nivel||1)+1) : (opts.nivel||1);

  const nombres = { item:'Nuevo ítem', grupo:'Nuevo título', actividad:'Nueva actividad',
                    hito:'Nuevo hito', subdivision:'Nueva subdivisión' };
  const esGrupo = (tipo==='grupo');
  const sinCant = (tipo==='grupo' || tipo==='actividad' || tipo==='hito');

  const it={
    id:nuevoId, desc:nombres[tipo]||'Nuevo', codigo_cc:'',
    um: (tipo==='subdivision'&&padre)? (padre.um||'un') : (sinCant?'':'un'),
    cant:0, cant_ajustada:null,
    pu: (tipo==='subdivision'&&padre)? (padre.pu||0) : 0,
    get ptot(){return cantVigente(this)*this.pu;}, incidencia:null, avE:null,
    ini:dstr(TODAY),
    fin: tipo==='hito' ? dstr(TODAY)   // hito: duración 0 (inicio=fin)
       : dstr(new Date(TODAY.getFullYear(),TODAY.getMonth()+1,TODAY.getDate())),
    estado:'Pendiente', cat:CATS[0]||'Sin categoría', dist_mensual:{}, deps:[],
    avance_real_prod:null,
    avance_manual:null,
    nivel:nivelBase, es_grupo:esGrupo,
    tipo:tipo, padre_id: (padre? padre.id : null)
  };

  // insertar en la posición correcta
  let insertIdx = ITEMS.length;
  if(opts.despuesDe){
    const idx=ITEMS.findIndex(x=>x.id===opts.despuesDe);
    if(idx>=0){
      // si es hijo (subdivision/actividad/hito), insertar tras el último descendiente
      // del padre para que quede agrupado debajo de él
      if(padre){
        let k=idx+1;
        while(k<ITEMS.length && (ITEMS[k].nivel||1) > (padre.nivel||1)) k++;
        insertIdx=k;
      } else {
        insertIdx=idx+1;
      }
    }
  }
  ITEMS.splice(insertIdx,0,it);
  reindex(); MONTHS=computeMonths();
  touch(); renderGantt(); renderKPIs(); openDrawer(it.id);
  const etiqueta={item:'Ítem',grupo:'Título',actividad:'Actividad',hito:'Hito',subdivision:'Subdivisión'}[tipo]||'Elemento';
  toast(etiqueta+' <b>'+it.id+'</b> agregado — completá los datos');
  return it;
}

function addItem(){ return crearElemento('item',{}); }

/* ---- menú contextual (clic derecho sobre una fila del cronograma) ---- */
let CTX_TARGET=null;   // id del ítem sobre el que se abrió el menú
function abrirCtxMenu(x,y,itemId){
  CTX_TARGET=itemId;
  const menu=$('#ctxMenu'); if(!menu) return;
  const it=byId[itemId];
  // las opciones de hijo (subdivisión/actividad/hito) solo aplican si el target
  // es un ítem de contrato (no un grupo, no ya una subdivisión).
  const tipo = it? (it.tipo || (it.es_grupo?'grupo':'item')) : null;
  const puedeHijo = it && (tipo==='item');
  $('#ctxSepHijo').style.display = puedeHijo?'block':'none';
  $('#ctxSubLabel').style.display = puedeHijo?'block':'none';
  ['subdivision','actividad','hito'].forEach(t=>{
    const b=menu.querySelector(`[data-ctx="${t}"]`); if(b) b.style.display=puedeHijo?'flex':'none';
  });
  $('#ctxHead').textContent = it? ('Crear (tras "'+(it.desc||'ítem').slice(0,24)+'")') : 'Crear…';
  menu.style.display='block';
  // posicionar sin salirse de la pantalla
  const mw=menu.offsetWidth||230, mh=menu.offsetHeight||200;
  menu.style.left=Math.min(x,window.innerWidth-mw-8)+'px';
  menu.style.top=Math.min(y,window.innerHeight-mh-8)+'px';
}
function cerrarCtxMenu(){ const m=$('#ctxMenu'); if(m) m.style.display='none'; CTX_TARGET=null; }

document.addEventListener('click',e=>{ if(!e.target.closest('#ctxMenu')) cerrarCtxMenu(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') cerrarCtxMenu(); });
// delegación: clic en una opción del menú
document.addEventListener('click',e=>{
  const b=e.target.closest('.ctx-item'); if(!b) return;
  const tipo=b.dataset.ctx; const target=CTX_TARGET;
  cerrarCtxMenu();
  if(tipo==='subdivision'||tipo==='actividad'||tipo==='hito'){
    crearElemento(tipo,{padreId:target,despuesDe:target});
  } else {
    crearElemento(tipo,{despuesDe:target});
  }
});

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
    <div class="did">${tipoDe(i)==='grupo'?'Título':'ID '+i.id} · <input class="dcc" id="dCC" value="${i.codigo_cc||''}" placeholder="cód. CC"> · <input class="dum" id="dUM" value="${i.um||''}" placeholder="um"></div>

    <div class="dscroll">
      <div class="dsec">Jerarquía</div>
      <div class="dfield"><label>Nivel de indentación (1 = raíz)</label>
        <div class="row2" style="align-items:center;gap:8px">
          <button class="minibtn" id="dOutdent" title="Subir nivel (◄)" ${(i.nivel||1)<=1?'disabled':''}>◄</button>
          <span class="mono2" id="dNivelLab" style="min-width:70px;text-align:center">Nivel ${i.nivel||1}</span>
          <button class="minibtn" id="dIndent" title="Bajar nivel (►)" ${(i.nivel||1)>=8?'disabled':''}>►</button>
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
        <select id="dEstado">${ESTADOS.map(s=>`<option ${estadoEfectivo(i)===s?'selected':''}>${s}</option>`).join('')}</select></div>

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
  $('#dIndent') && ($('#dIndent').onclick=()=>{ i.nivel=Math.min(8,(i.nivel||1)+1); touch(); renderGantt(); openDrawer(id); });
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
    if(!esComputable(i)) return;       // grupos, actividades, hitos y subdivisiones no cuentan
                                       // (la producción de tramos ya está sumada en el padre)
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
  const montoPlan=ITEMS.reduce((s,i)=>esComputable(i)? s+sumaPlanItem(i)*i.pu : s,0);
  // monto certificado acumulado = Σ (cantidad certificada acumulada × PU)
  const montoCert=ITEMS.reduce((s,i)=>s+(i.cant_certificada_acum||0)*i.pu,0);
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
    ['Monto planeado',fmtG(montoPlan),'plan', (()=>{
        if(!montoPlan||!contrato) return 'Σ cronograma × PU';
        const d=Math.round(montoPlan-contrato);
        // no redondear la diferencia a "100.0%": si falta o sobra plata, decirlo
        return Math.abs(d)>=1
          ? (d>0?'+':'')+fmtG(d).replace('₲ ','₲')+' vs vigente'
          : 'cuadra con el vigente';
      })()],
    ['Monto producido',fmtG(prod),'cyan','avance físico real'],
    ['Monto certificado',fmtG(montoCert),'warn',montoCert&&contratoOrig?((montoCert/contratoOrig*100).toFixed(1)+'% del contrato'):'Σ certificado × PU'],
    ['Avance planeado',pct(avPlan),'plan','a la fecha'],
    ['Avance producido',pct(avProd),'','físico'],
    ['Brecha',(avProd-avPlan>=0?'+':'')+(avProd-avPlan).toFixed(1)+'%',avProd-avPlan>=0?'pos':'neg',avProd-avPlan>=0?'adelantado':'atrasado'],
    ['Actividades semana',String(WEEKLY.filter(w=>w.week===wk).length),'',(wk||'—').replace('-',' ')]
  );
  const brechaPlan = Math.round(montoPlan-contrato);
  $('#kpiStrip').innerHTML=K.map(([l,v,c,s])=>{
    const cls=c==='tape'?'tape':c==='cyan'?'cyan':c==='plan'?'plan':c==='warn'?'warn':'';
    const gap=(l==='Brecha')?c:'';
    // el KPI de plan se vuelve clickeable si no cuadra con el vigente
    const desc=(l==='Monto planeado' && Math.abs(brechaPlan)>=1);
    return `<div class="kpi${desc?' kpi-click':''}"${desc?' id="kpiPlanDesc" title="Clic para ver qué ítems no cuadran"':''}>`
      +`<div class="lab">${l}</div><div class="val ${cls} ${gap}">${v}</div><div class="sub">${s}</div></div>`;
  }).join('');
  const kp=$('#kpiPlanDesc'); if(kp) kp.onclick=openConciliacionPanel;
}

/* ---- CONCILIACIÓN: por qué el monto planeado ≠ el monto ajustado ----------
   Lista los ítems cuya distribución mensual no suma exactamente su cantidad
   vigente, ordenados por el impacto EN PLATA (diferencia × precio unitario).
   Casi siempre es residuo de redondeo del reparto por meses; el botón de
   ajuste lo manda al último mes de cada ítem y el total cierra exacto.       */
function openConciliacionPanel(){
  const desc=ITEMS.filter(i=>esComputable(i))
    .map(i=>({ i, dif:difContrato(i), gs:difContrato(i)*(i.pu||0) }))
    .filter(x=>Math.abs(x.dif)>=1e-6)
    .sort((a,b)=>Math.abs(b.gs)-Math.abs(a.gs));
  const totGs=desc.reduce((s,x)=>s+x.gs,0);
  const m=$('#modal');
  const filas=desc.slice(0,60).map(({i,dif,gs})=>
    `<tr><td class="mono">${i.id}</td><td>${(i.desc||'').slice(0,44)}</td>
      <td class="r mono">${fmtN(cantVigente(i)||0)}</td>
      <td class="r mono">${fmtN(sumaPlanItem(i))}</td>
      <td class="r mono ${dif>0?'':'over100'}"><b>${dif>0?'+':''}${fmtN(dif,4)}</b></td>
      <td class="r mono">${(gs>0?'+':'')+Math.round(gs).toLocaleString('es-PY')}</td></tr>`).join('');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Por qué el monto planeado no cuadra</h3>
    <p class="hint" style="margin-bottom:10px">El <b>monto planeado</b> es Σ (cantidad repartida por mes × PU) y el
      <b>monto ajustado</b> es Σ (cantidad vigente × PU). Si el reparto mensual de un ítem no suma exactamente su
      cantidad, la diferencia aparece acá. Suele ser <b>residuo de redondeo</b> del reparto por días.</p>
    <div class="kpis" style="display:flex;gap:16px;margin:10px 0;font-size:13px">
      <div>Ítems que no cuadran: <b class="${desc.length?'over100':''}">${desc.length}</b></div>
      <div>Diferencia total: <b class="${Math.abs(totGs)>=1?'over100':''}">${(totGs>0?'+':'')+Math.round(totGs).toLocaleString('es-PY')} Gs</b></div>
    </div>
    ${desc.length? `<div class="prev-wrap" style="max-height:320px">
      <table class="prev-tbl"><thead><tr>
        <th>ID</th><th>Ítem</th><th class="r">Cant. vigente</th><th class="r">Σ plan</th>
        <th class="r">Diferencia</th><th class="r">Gs</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
      ${desc.length>60?`<p class="hint" style="margin-top:6px">Se muestran los 60 de mayor impacto.</p>`:''}
      <div class="dactions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="dsave" id="cnFix">⚖ Ajustar los ${desc.length}</button></div>`
      : '<p class="hint">Todos los ítems cuadran: el monto planeado coincide con el ajustado.</p>'}
  </div>`;
  m.classList.add('open');
  const b=$('#cnFix'); if(b) b.onclick=()=>{ ajustarTodos(); closeModal(); };
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
    if(!vaAlPlanSemanal(i) || sinCantidadPlan(i)) return false;   // el padre no programa: programan sus tramos
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

/* orden del plan semanal = orden del cronograma (17, 17.1, 17.2, ... 17.10).
   parseInt() solo no alcanza: "17.5" y "17.10" dan 17 los dos. */
function cmpItemId(a,b){
  const ia=ITEMS.findIndex(x=>String(x.id)===String(a));
  const ib=ITEMS.findIndex(x=>String(x.id)===String(b));
  if(ia>=0 && ib>=0 && ia!==ib) return ia-ib;
  if(ia>=0 && ib<0) return -1;
  if(ib>=0 && ia<0) return 1;
  return String(a).localeCompare(String(b),'es',{numeric:true});
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
  /* Se ocultan las filas de items-padre con tramos y de grupos: la carga de la
     semana la llevan los subtramos (17.5, 17.7, ...). Las filas viejas siguen
     en el Sheet, solo dejan de mostrarse y de contarse. */
  let rows=WEEKLY.filter(w=>{
    if(w.week!==wk) return false;
    if(frFilter && w.frente!==frFilter) return false;
    const it=byId[w.item_id];
    return it? vaAlPlanSemanal(it) : true;      // filas huerfanas se muestran igual
  }).sort((a,b)=>cmpItemId(a.item_id,b.item_id));

  // PRODUCCIÓN NO PLANEADA: ítems que se ejecutaron esta semana pero NO tienen
  // fila en el plan. Se agregan como filas "fantasma" (planeado 0, ejecutado X),
  // resaltadas. No cuentan como actividad completa en el PPC (no tenían meta),
  // pero sí suman al monto ejecutado. En obra pasa seguido: se ejecuta lo que
  // se puede, no lo que estaba en el papel.
  if(wk && !frFilter){
    const yaEnPlan = new Set(rows.map(w=>String(w.item_id)));
    ITEMS.forEach(i=>{
      if(yaEnPlan.has(String(i.id))) return;
      if(!vaAlPlanSemanal(i)) return;           // el padre no genera fila propia
      const ejec = prodEnSemana(i.id, wk);
      if(ejec>0){
        rows.push({ item_id:i.id, actividad:'', frente:'', um:i.um||'',
          week:wk, month:weekMonthKey(wk), cant_prevista:null,
          cant_ejecutada:Math.round(ejec*100)/100, causa:'', _noPlan:true });
      }
    });
  }

  // ¿qué meses toca esta semana? (puede ser 1 o 2)
  const mesesSemana = wk? mesesDeSemana(wk) : [];
  const mKey = weekMonthKey(wk);                 // mes principal (para el panel)
  const cruza = mesesSemana.length>1;
  $('#wkCross').innerHTML = cruza
    ? `<span class="cross">Semana a caballo entre <b>${mesesSemana.map(m=>monthLabel(m)).join('</b> y <b>')}</b> — las cantidades se prorratean por días para certificación</span>`
    : '';

  /* ---- panel del plan mensual: SOLO los que no cuadran o tienen saldo ---- */
  const monthItems=ITEMS.filter(i=>vaAlPlanSemanal(i) && !sinCantidadPlan(i)
    && Math.abs((i.dist_mensual||{})[mKey]||0)>0);
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

  let tp=0,te=0,mp=0,me=0,done=0,nPlan=0,nSinCant=0,doneSinCant=0;
  $('#wkBody').innerHTML=rows.map((w,k)=>{
    const it=byId[w.item_id];const pu=it?it.pu:0;
    const prev=w.cant_prevista||0,ejec=w.cant_ejecutada||0;
    const noPlan=!!w._noPlan;
    // ACTIVIDAD SIN CANTIDAD: no tiene meta numerica. Se cumple o no se cumple,
    // y eso lo dice el ESTADO del item (Listo). Cuenta 1 en el PPC igual que
    // cualquier otro compromiso de la semana.
    const sinCant=!noPlan && !!it && sinCantidadPlan(it);
    const estIt=it?estadoEfectivo(it):'Pendiente';
    const listo=estIt==='Listo';
    const cp=sinCant? (listo?100:0)
           : (prev?Math.min(200,ejec/prev*100):(ejec?100:0));
    // totales: el monto ejecutado SIEMPRE suma (incluida producción no planeada).
    // el % de ACTIVIDADES completas solo considera las filas planeadas: una
    // ejecución no planeada no "cumple" un plan que no existía.
    te+=ejec; me+=ejec*pu;
    if(!noPlan){
      nPlan++;
      if(sinCant){ nSinCant++; if(listo){ done++; doneSinCant++; } }
      else { tp+=prev; mp+=prev*pu; if(cp>=99.5)done++; }
    }
    const cls=cp>=99?'':cp>=70?'mid':'lo';
    // selector de estado: editable en las actividades sin cantidad (ahi el
    // estado ES el cumplimiento); en las que tienen cantidad manda la
    // produccion real, asi que se muestra el badge de solo lectura.
    const estadoCell = sinCant
      ? `<select class="wk-estado" data-k="${k}" title="Estado de la actividad. Marcala Listo cuando se cumplio: cuenta en el PPC y pinta la barra de verde en el Gantt.">${
          ESTADOS.filter(e=>e!=='Eliminado').map(e=>`<option ${estIt===e?'selected':''}>${e}</option>`).join('')}</select>`
      : `<span title="Lo define la producción real cargada">${estadoBadge(estIt)}</span>`;

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

    // el selector no ofrece items-padre con tramos ni grupos: en el plan semanal
    // solo entran los que realmente ejecutan (subtramos, hojas y actividades)
    const itemOpts=ITEMS.filter(x=>vaAlPlanSemanal(x)||x.id===w.item_id)
      .map(x=>`<option value="${x.id}" ${x.id===w.item_id?'selected':''}>${x.id} · ${(x.desc||'').slice(0,30)}</option>`).join('');

    // fila NO planeada: resaltada, sin edición de plan (no tiene sentido editar
    // una fila que no se guarda; es un reflejo de la producción real).
    if(noPlan){
      return `<tr data-k="${k}" class="wk-noplan" title="Producción NO planeada: se ejecutó pero no estaba en el plan de la semana">
        <td class="mono">${w.item_id} · ${(it?.desc||'').slice(0,28)}</td>
        <td><span class="noplan-tag">No planeado</span></td>
        <td>—</td>
        <td class="mono">${w.um||it?.um||''}</td>
        <td class="r">0</td>
        <td class="r ejec-ro"><b>${fmtN(ejec)}</b></td>
        <td class="r">—</td>
        <td>${estadoBadge(estIt)}</td>
        <td>—</td>
        <td class="r">${saldoCell}</td>
        <td></td>
      </tr>`;
    }

    return `<tr data-k="${k}" class="${sinCant?'wk-sincant'+(listo?' wk-listo':''):''}">
      <td><select class="wk-item" data-k="${k}">${itemOpts}</select></td>
      <td><input class="wk-act" data-k="${k}" value="${(w.actividad||'').replace(/"/g,'&quot;')}" placeholder="Descripción">${split}</td>
      <td><input class="wk-frente" data-k="${k}" value="${(w.frente||'').replace(/"/g,'&quot;')}" placeholder="Frente"></td>
      <td class="mono">${w.um||it?.um||''}</td>
      <td class="r">${sinCant
          ? `<span class="sincant-tag" title="Actividad sin cantidad: se cumple o no se cumple">s/cant</span>`
          : `<input class="qty-in" data-f="prev" data-k="${k}" value="${prev? +prev.toFixed(2):''}">`}</td>
      <td class="r ejec-ro" title="Viene del formulario de liberación">${sinCant?'—':(ejec?fmtN(ejec):'—')}</td>
      <td class="r">${sinCant? (listo?'<b class="cp-ok">100%</b>':'<span class="cp-no">0%</span>') : (prev?pct(cp):'—')}</td>
      <td>${estadoCell}</td>
      <td><select class="cause-sel" data-k="${k}">${CAUSES.map(c=>`<option ${w.causa===c?'selected':''}>${c}</option>`).join('')}</select></td>
      <td class="r">${sinCant?'<span class="sal-none">—</span>':saldoCell}</td>
      <td><button class="wk-del" data-k="${k}" title="Quitar">×</button></td>
    </tr>`;
  }).join('')||`<tr><td colspan="11" style="text-align:center;color:#8a8578;padding:20px">Sin actividades esta semana.</td></tr>`;

  $('#wkTotPrev').textContent=fmtN(tp);$('#wkTotEjec').textContent=fmtN(te);
  $('#wkTotPct').textContent=tp?pct(te/tp*100):'—';
  // % de ACTIVIDADES completas: solo sobre las planeadas (nPlan), no sobre las
  // filas de producción no planeada (que no tenían meta que cumplir).
  const ppc=nPlan?Math.round(done/nPlan*100):0;
  $('#ppcVal').textContent=ppc+'%';$('#ppcRing').style.setProperty('--p',ppc);
  $('#ppcDone').textContent=done;$('#ppcPlan').textContent=nPlan;
  // desglose: cuantos de esos compromisos son actividades sin cantidad
  const elSC=$('#ppcSinCant');
  if(elSC){
    elSC.style.display = nSinCant? 'block':'none';
    elSC.textContent = nSinCant? `incluye ${doneSinCant}/${nSinCant} actividad${nSinCant===1?'':'es'} sin cantidad` : '';
  }
  // % de MONTO ejecutado sobre el planeado (incluye el ejecutado no planeado en
  // el numerador: es plata que se ejecutó, aunque no estuviera en el plan).
  $('#ppcMonto').textContent=mp?pct(me/mp*100).replace('%','')+'% · '+fmtG(me):(me?fmtG(me):'₲ 0');
  const elMP=$('#ppcMontoPrev'); if(elMP) elMP.textContent=fmtG(mp);
  // aviso de producción no planeada en la semana
  const nNoPlan=rows.filter(w=>w._noPlan).length;
  const elNoPlan=$('#wkNoPlan');
  if(elNoPlan){
    elNoPlan.style.display = nNoPlan? 'inline-flex':'none';
    elNoPlan.textContent = nNoPlan? ('⚠ '+nNoPlan+' ítem'+(nNoPlan>1?'s':'')+' ejecutado'+(nNoPlan>1?'s':'')+' sin planificar') : '';
  }

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
  /* estado de una actividad SIN cantidad: se escribe en el ITEM (fuente unica),
     asi el mismo valor se ve en la grilla, en el drawer y en el plan semanal.
     Se sincroniza el avance manual para que la barra del Gantt acompane. */
  $$('#wkBody .wk-estado').forEach(sel=>sel.onchange=e=>{
    const w=rows[+e.target.dataset.k]; const it=byId[w.item_id]; if(!it) return;
    const v=e.target.value;
    it.estado=v;
    if(v==='Listo') it.avance_manual=100;
    else if(v==='Pendiente') it.avance_manual=null;
    touch(); renderWeekly(); renderGantt(); renderKPIs();
  });
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
  const it = itemId? byId[itemId] : ITEMS.find(x=>vaAlPlanSemanal(x));
  if(!it) return;
  if(!vaAlPlanSemanal(it)){
    toast(`<b>${it.id}</b> es un ítem padre: cargá la semana en sus subtramos`);
    return;
  }
  // actividad SIN cantidad: no hay saldo que repartir, es un compromiso a secas
  if(sinCantidadPlan(it)){
    if(WEEKLY.some(w=>w.item_id===it.id && w.week===wk)){
      toast(`<b>${it.id}</b> ya está en esta semana`); return;
    }
    WEEKLY.push({ item_id:it.id, actividad:it.desc, frente:'', um:it.um||'',
      week:wk, month:mKey, mesSplit:null, cant_prevista:null, cant_ejecutada:null,
      causa:'Sin observaciones', _man:true });
    touch('weekly'); renderWeekly(); renderKPIs();
    toast(`Actividad <b>${it.id}</b> agregada a la semana (sin cantidad)`);
    return;
  }

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

/* =========================================================================
 * CURVAS DE AVANCE ACUMULADO — Batch 3
 *
 * Modelo de curvas (todas en % sobre el CONTRATO ORIGINAL, denominador fijo):
 *   1    Contractual         línea base congelada (con historial de convenios)
 *   1.5  Meta empresa        línea base interna, más exigente
 *   2    Planeado + lluvia   la base re-pesada por días hábiles (referencia MOPC)
 *   3    Ejecutado real      del form de liberación, intocable
 *   3.5  Producción + lluvia ritmo real extrapolado a días calendario
 *   4    Plan operativo      el plan vivo (pasado = real, futuro = reprogramado)
 *
 * El denominador NUNCA se re-basa con los convenios: si un convenio amplía el
 * alcance, la curva cruza el 100% y eso es información, no un error.
 * ========================================================================= */
/* La lluvia NO es una curva propia: es un MODIFICADOR que se aplica sobre una
   línea base (contractual o meta) para generar su versión "ajustada por lluvia".
   El plan operativo no lo admite porque ya está ajustado a la producción real. */
const CURVAS_DEF = [
  { k:'contractual', nom:'Contractual',          col:'#8a8782', lluviaOpc:true, versiones:'contractual' },
  { k:'meta',        nom:'Meta empresa',         col:'#5b4bc4', lluviaOpc:true, versiones:'meta' },
  { k:'real',        nom:'Ejecutado real',       col:'#2f74d0' },
  { k:'prodLluvia',  nom:'Producción + lluvia',  col:'#00a3b5', dash:true },
  { k:'operativa',   nom:'Plan operativo',       col:'#e0682c' },
  { k:'certificado', nom:'Certificado',          col:'#b8860b' }
];
/* toggles de "+ lluvia" por línea base */
let LLUVIA_CURVA = { contractual:false, meta:false };
let CURVAS_ON = null;    // se inicializa desde localStorage

function curvasSel(){
  if(CURVAS_ON) return CURVAS_ON;
  try{
    const raw=localStorage.getItem('obra_curvas_'+(OBRA.id||''));
    CURVAS_ON = raw? JSON.parse(raw) : {contractual:true, real:true, operativa:true};
  }catch(e){ CURVAS_ON={contractual:true, real:true, operativa:true}; }
  return CURVAS_ON;
}
function guardarCurvasSel(){
  try{ localStorage.setItem('obra_curvas_'+(OBRA.id||''), JSON.stringify(CURVAS_ON)); }catch(e){}
}

/* denominador FIJO: monto del contrato original (cant original × pu).
   No usa cantVigente a propósito — así la línea del 100% conserva el
   significado de "contrato licitado" y los convenios se ven cruzándola.    */
function montoContratoOriginal(){
  return ITEMS.reduce((s,i)=>esComputable(i)? s+((i.cant||0)*(i.pu||0)) : s,0) || 1;
}

/* clasifica una línea base por su nombre: 'Contractual v0…' → contractual */
function tipoBaseline(bl){
  const n=String(bl&&bl.name||'').toLowerCase();
  if(n.startsWith('meta')) return 'meta';
  if(n.startsWith('contractual')) return 'contractual';
  return 'otra';
}
function baselinesDe(tipo){ return BASELINES.filter(b=>tipoBaseline(b)===tipo); }

/* acumulado mensual en GUARANÍES a partir de un mapa item→dist_mensual.
   `eje` opcional (por defecto MONTHS); permite dibujar sobre calendario extendido. */
function acumDeDist(getDist, eje){
  const porMes={};
  ITEMS.forEach(i=>{
    if(!esComputable(i)) return;      // solo ítems de contrato; subdivisiones/grupos/hitos no
    const d=getDist(i); if(!d) return;  // getDist ya devuelve la dist EFECTIVA (padre = suma de tramos)
    Object.entries(d).forEach(([m,q])=>{ porMes[m]=(porMes[m]||0)+(q||0)*(i.pu||0); });
  });
  let cum=0;
  return (eje||MONTHS).map(m=>{ cum+=(porMes[m]||0); return cum; });
}

/* ---- curva 1 / 1.5: desde una línea base congelada ---- */
function curvaBaseline(bl, eje){
  if(!bl) return null;
  return acumDeDist(i=>distEfectivaDe(i, x=>{ const s=bl.items&&bl.items[x.id]; return s? s.dist : null; }), eje);
}

/* ---- curva 2: la base re-pesada por días hábiles (lluvia) ----
   No mueve el plan operativo: es una referencia teórica de cómo se debería
   haber distribuido el trabajo descontando los días de clima.              */
/* añade `n` meses a una clave 'YYYY-MM' → 'YYYY-MM' */
function mesMas(mk, n){
  const [y,m]=mk.split('-').map(Number);
  const d=new Date(y, m-1+n, 1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
/* lista contigua de meses [desde..hasta] inclusive */
function rangoMeses(desde, hasta){
  const out=[]; let cur=desde;
  while(cur<=hasta){ out.push(cur); cur=mesMas(cur,1); if(out.length>600) break; }
  return out;
}

/* días de clima RECONOCIDOS de forma RETROSPECTIVA ESTRICTA: solo meses ya
   transcurridos (≤ mes actual). Los meses futuros = calendario completo, no se
   puede reclamar lluvia que todavía no ocurrió. Es el número legal que va a MOPC.
   Usa la MISMA regla de la obra (lluvia:modo / lluvia:conteo).               */
function diasGanadosRetro(mkHasta){
  const tope = mkHasta || mesActual();
  return Object.keys(CLIMA)
    .filter(mk => mk <= tope)
    .reduce((s,mk) => s + diasClimaReconocidos(mk), 0);
}

/* fecha fin contractual de una baseline = último día del último mes con trabajo.
   Se usa como ancla para calcular la fecha fin extendida por lluvia.          */
function finBaseline(bl){
  const baseMes={};
  ITEMS.forEach(i=>{
    const s=bl&&bl.items&&bl.items[i.id]; if(!s||!s.dist) return;
    Object.entries(s.dist).forEach(([m,q])=>{ if((q||0)>0) baseMes[m]=(baseMes[m]||0)+1; });
  });
  const meses=Object.keys(baseMes).sort();
  if(!meses.length) return null;
  const ult=meses[meses.length-1];
  const [y,m]=ult.split('-').map(Number);
  return new Date(y, m, 0);            // último día de ese mes
}

/* mes 'YYYY-MM' de una fecha */
function mkDe(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }

/* ---- curva «+lluvia»: la línea base con CORRIMIENTO ACUMULADO --------------
 * Mismo modelo que el Gantt: cada día se corre por la lluvia ocurrida hasta
 * ese día.
 *
 * Implementación: la distribución mensual de la base se convierte en un perfil
 * DIARIO (el monto del mes se reparte entre sus días); cada día se manda a
 * `día + corrimientoA(día)` y se vuelve a agregar por mes. Si llueve todo
 * julio, el trabajo de julio aparece en agosto y el de agosto en septiembre,
 * pero los meses previos a la lluvia quedan donde estaban.
 *
 * fecha_fin_ajustada = fecha_fin_baseline + días ganados (hecho contractual,
 * no un subproducto del reparto).
 *
 * Devuelve { serie:{ 'YYYY-MM': acumG }, ultimoMes, finAjustada, diasGanados }. */
/* caché de la serie por baseline: el motor día-a-día es caro y la serie se pide
   varias veces por render (eje, curvas, marcas de fin). Se invalida al cambiar
   de obra, al recargar datos o al cambiar la config de lluvia.               */
var _serieLluviaCache = {};
function invalidarCacheLluvia(){ _serieLluviaCache = {}; _fechasClimaCache = null; }

function curvaPlaneadoLluviaSerie(bl){
  if(!bl) return null;
  const ck = bl.id || 'plan';
  if(_serieLluviaCache[ck] !== undefined) return _serieLluviaCache[ck];
  const r = _curvaPlaneadoLluviaSerieCalc(bl);
  _serieLluviaCache[ck] = r;
  return r;
}

function _curvaPlaneadoLluviaSerieCalc(bl){
  if(!bl) return null;
  // aporte financiero por mes de la baseline (Σ q×pu)
  const baseMes={};
  ITEMS.forEach(i=>{
    if(!esComputable(i)) return;
    const d = distEfectivaDe(i, x=>{ const sx=bl.items&&bl.items[x.id]; return sx? sx.dist : null; });
    if(!d) return;
    Object.entries(d).forEach(([m,q])=>{ if((q||0)>0) baseMes[m]=(baseMes[m]||0)+(q||0)*(i.pu||0); });
  });
  const meses=Object.keys(baseMes).sort();
  if(!meses.length) return null;

  const D = diasGanadosRetro();
  const finBase = finBaseline(bl);
  const totalFin = meses.reduce((a,m)=>a+baseMes[m],0);

  // sin días ganados → la curva ajustada = la baseline tal cual
  if(D<=0){
    const serie={}; let c=0;
    meses.forEach(m=>{ c+=baseMes[m]; serie[m]=c; });
    return { serie, ultimoMes:meses[meses.length-1], finAjustada:finBase, diasGanados:0 };
  }

  // ---- CORRIMIENTO ACUMULADO: cada día va a día + lluvia ocurrida hasta él ----
  const aporte={};                       // mes → monto ya corrido
  const add=(mk,v)=>{ aporte[mk]=(aporte[mk]||0)+v; };
  meses.forEach(m=>{
    const [y,mo]=m.split('-').map(Number);
    const nd=new Date(y,mo,0).getDate();       // días del mes original
    const porDia=baseMes[m]/nd;
    for(let k=1;k<=nd;k++){
      const dst=correrFecha(new Date(y,mo-1,k));
      add(dst.getFullYear()+'-'+String(dst.getMonth()+1).padStart(2,'0'), porDia);
    }
  });

  const finAjust = finBase ? addDays(finBase, D) : null;
  const mkUlt = Object.keys(aporte).sort().pop();
  const mkFinal = (finAjust && mkDe(finAjust)>mkUlt) ? mkDe(finAjust) : mkUlt;
  const eje = rangoMeses(meses[0], mkFinal);

  const serie={}; let acum=0;
  eje.forEach(mk=>{ acum+=(aporte[mk]||0); serie[mk]=acum; });
  serie[mkFinal]=totalFin;               // cierra exactamente en el 100%

  return { serie, ultimoMes:mkFinal, finAjustada:finAjust, diasGanados:D };
}

/* días de calendario de un mes 'YYYY-MM' */
function diasMes(mk){ const [y,m]=mk.split('-').map(Number); return new Date(y,m,0).getDate(); }

/* wrapper compat: proyecta la serie extendida sobre el eje que reciba.
   Si el eje pasado no cubre los meses extendidos, la curva se corta ahí (por eso
   calcularCurvas extiende el eje cuando hay +lluvia activa).                   */
function curvaPlaneadoLluvia(bl, eje){
  const r=curvaPlaneadoLluviaSerie(bl);
  if(!r) return null;
  const E = eje || MONTHS;
  let last=0;
  return E.map(m=>{
    if(r.serie[m]!=null){ last=r.serie[m]; return last; }
    // meses del eje anteriores al inicio de la serie → 0; posteriores → arrastra el último
    if(m < Object.keys(r.serie)[0]) return 0;
    return last;
  });
}

/* ---- curva 3: ejecutado real acumulado (del form) ---- */
function curvaReal(eje){
  const porMes={};
  ITEMS.forEach(i=>{
    const pr=PROD[i.id]; if(!pr||!pr.by_date) return;
    Object.entries(pr.by_date).forEach(([d,q])=>{
      const m=String(d).slice(0,7);
      porMes[m]=(porMes[m]||0)+(q||0)*(i.pu||0);
    });
  });
  const mAct=mesActual();
  let cum=0;
  return (eje||MONTHS).map(m=>{
    if(m>mAct) return null;                 // el real no existe en el futuro
    cum+=(porMes[m]||0); return cum;
  });
}

/* ---- curva 3.5: producción ajustada por lluvia ----
   ritmo_real = ejecutado_mes / días_útiles   (días útiles con la regla de la obra)
   producción_ajustada = ritmo_real × días_calendario
   Sin filtro ni mínimo: si un mes tuvo pocos días útiles y el número se
   dispara, se muestra tal cual — el usuario interpreta.                     */
function curvaProdLluvia(eje){
  const porMes={};
  ITEMS.forEach(i=>{
    const pr=PROD[i.id]; if(!pr||!pr.by_date) return;
    Object.entries(pr.by_date).forEach(([d,q])=>{
      const m=String(d).slice(0,7);
      porMes[m]=(porMes[m]||0)+(q||0)*(i.pu||0);
    });
  });
  const mAct=mesActual();
  let cum=0;
  return (eje||MONTHS).map(m=>{
    if(m>mAct) return null;
    const [y,mm]=m.split('-').map(Number);
    const cal=new Date(y,mm,0).getDate();
    const utiles=Math.max(0.5, cal - diasClimaReconocidos(m));
    const ejec=porMes[m]||0;
    cum += ejec * (cal/utiles);             // extrapolación al mes completo
    return cum;
  });
}

/* ---- curva 4: plan operativo vivo (lo que hay hoy en dist_mensual) ---- */
function curvaOperativa(eje){ return acumDeDist(i=>distPlanItem(i), eje); }

/* eje de meses para las curvas: MONTHS extendido con los meses ganados por
   lluvia cuando Contractual+lluvia o Meta+lluvia están activas. Así la curva con
   fecha fin desplazada tiene dónde dibujarse a la derecha del plazo original.  */
function ejeCurvas(blContractual, blMeta){
  let ult = MONTHS[MONTHS.length-1] || mesActual();
  if(LLUVIA_CURVA.contractual && blContractual){
    const r=curvaPlaneadoLluviaSerie(blContractual);
    if(r && r.ultimoMes>ult) ult=r.ultimoMes;
  }
  if(LLUVIA_CURVA.meta && blMeta){
    const r=curvaPlaneadoLluviaSerie(blMeta);
    if(r && r.ultimoMes>ult) ult=r.ultimoMes;
  }
  if(!MONTHS.length) return [ult];
  return ult>MONTHS[MONTHS.length-1] ? rangoMeses(MONTHS[0], ult) : MONTHS.slice();
}

/* arma todas las curvas seleccionadas, en % sobre el contrato original.
   Devuelve también `_eje` (array de meses) para que el render dibuje el X. */
function calcularCurvas(blContractual, blMeta){
  const den=montoContratoOriginal();
  const eje=ejeCurvas(blContractual, blMeta);
  const pct=arr=>arr? arr.map(v=>v==null?null:v/den*100) : null;
  return {
    _eje: eje,
    contractual: pct(LLUVIA_CURVA.contractual ? curvaPlaneadoLluvia(blContractual, eje) : curvaBaseline(blContractual, eje)),
    meta:        pct(LLUVIA_CURVA.meta        ? curvaPlaneadoLluvia(blMeta, eje)        : curvaBaseline(blMeta, eje)),
    planLluvia:  pct(curvaPlaneadoLluvia(blContractual, eje)),
    real:        pct(curvaReal(eje)),
    prodLluvia:  pct(curvaProdLluvia(eje)),
    operativa:   pct(curvaOperativa(eje)),
    certificado: pct(curvaCertificado(eje))
  };
}
/* ---- selección de curva de referencia para KPIs e informes (Batch 3) ----
   El "avance esperado" y la "brecha" se miden contra la curva que elija el
   usuario, no contra una fija. Así se puede comparar contra el contrato, la
   meta interna, la base ajustada por lluvia o el plan operativo.           */
let KPI_REF  = null;     // 'contractual' | 'meta' | 'planLluvia' | 'operativa'
let KPI_REAL = null;     // 'real' | 'certificado'

function kpiRef(){
  if(KPI_REF) return KPI_REF;
  try{ KPI_REF = localStorage.getItem('obra_kpiref_'+(OBRA.id||'')) || 'operativa'; }
  catch(e){ KPI_REF='operativa'; }
  return KPI_REF;
}
function kpiReal(){
  if(KPI_REAL) return KPI_REAL;
  try{ KPI_REAL = localStorage.getItem('obra_kpireal_'+(OBRA.id||'')) || 'real'; }
  catch(e){ KPI_REAL='real'; }
  return KPI_REAL;
}

/* curvas disponibles como referencia (solo las que tienen datos) */
function refsDisponibles(){
  const contrs=baselinesDe('contractual'), metas=baselinesDe('meta');
  const r=[{k:'operativa', nom:'Plan operativo'}];
  // el nombre refleja si esa línea base tiene el ajuste por lluvia activado
  if(contrs.length) r.push({k:'contractual', nom:'Contractual'+(LLUVIA_CURVA.contractual?' + lluvia':'')});
  if(metas.length)  r.push({k:'meta',        nom:'Meta empresa'+(LLUVIA_CURVA.meta?' + lluvia':'')});
  return r;
}

/* valor de la curva de referencia AL MES ACTUAL, en % y en guaraníes */
function refInfo(){
  const k=kpiRef();
  const disp=refsDisponibles();
  const usar = disp.some(d=>d.k===k) ? k : 'operativa';
  const contrs=baselinesDe('contractual'), metas=baselinesDe('meta');
  const blC = CURVA_BL_CONTR ? BASELINES.find(b=>b.id===CURVA_BL_CONTR) : contrs[contrs.length-1];
  const blM = CURVA_BL_META  ? BASELINES.find(b=>b.id===CURVA_BL_META)  : metas[metas.length-1];
  const C=calcularCurvas(blC, blM);
  const mAct=mesActual();
  // el índice debe ser sobre el EJE con el que se calcularon las curvas:
  // MONTHS puede tener huecos (meses sin trabajo) y el eje extendido no.
  const eje=C._eje||MONTHS;
  let idx=eje.indexOf(mAct); if(idx<0) idx=eje.length-1;
  const arr=C[usar]||[];
  let v=null;
  for(let j=Math.min(idx,arr.length-1); j>=0; j--){ if(arr[j]!=null){ v=arr[j]; break; } }
  const nom=(disp.find(d=>d.k===usar)||{}).nom||'Plan operativo';
  return { pctEsp: v==null?0:v, montoEsp: (v==null?0:v)*montoContratoOriginal()/100,
           nombre: nom, key: usar };
}

/* ---- CERTIFICADO (preparado para el Excel de SharePoint) ----
   CERT[item_id] = { total, by_month:{'2025-06':cant} }
   Mientras no haya datos cargados, la opción queda deshabilitada.          */
/* Reconstruye el objeto CERT global desde el mapa de la vista de certificación
   ('mes|item_id' → {cant}) y refresca KPIs y curvas, sin recargar la obra. */
window.aplicarCertAlModelo = function(porMesItem){
  const acc = {};   // item_id → { total, by_month }
  Object.keys(porMesItem||{}).forEach(k=>{
    const idx=k.indexOf('|'); if(idx<0) return;
    const mes=k.slice(0,idx), item=k.slice(idx+1);
    const cant=Number(porMesItem[k] && porMesItem[k].cant)||0;
    if(!cant) return;
    const o = acc[item] || (acc[item]={ total:0, by_month:{} });
    o.total += cant; o.by_month[mes] = (o.by_month[mes]||0) + cant;
  });
  CERT = acc;
  // reflejar en los ítems (para el KPI de monto certificado)
  ITEMS.forEach(i=>{ i.cant_certificada_acum = acc[i.id] ? acc[i.id].total : 0;
                     i.cert_por_mes = acc[i.id] ? acc[i.id].by_month : {}; });
  try{ renderKPIs(); }catch(e){}
  try{ if($('#v-report') && $('#v-report').classList.contains('on')){ renderReport(); renderCurvas(); } }catch(e){}
};
function hayCertificados(){ return Object.keys(CERT).length>0; }
function montoCertificado(){
  return ITEMS.reduce((s,i)=>{ const c=CERT[i.id]; return s+((c&&c.total?c.total:0)*(i.pu||0)); },0);
}
/* curva de certificado acumulada, en % sobre el contrato original.
   A diferencia del ejecutado real, NO se corta en el mes actual: el certificado
   puede cargarse por adelantado o en meses futuros, y la curva debe mostrarlo
   donde exista el dato. Corta después del último mes con certificación. */
function curvaCertificado(eje){
  if(!hayCertificados()) return null;
  const porMes={};
  ITEMS.forEach(i=>{
    const c=CERT[i.id]; if(!c||!c.by_month) return;
    Object.entries(c.by_month).forEach(([m,q])=>{ porMes[m]=(porMes[m]||0)+(q||0)*(i.pu||0); });
  });
  // último mes que tiene certificación cargada (hasta ahí llega la curva)
  const mesesCert=Object.keys(porMes).sort();
  const ultimoCert=mesesCert[mesesCert.length-1];
  if(!ultimoCert) return null;
  let cum=0;
  return (eje||MONTHS).map(m=>{ if(m>ultimoCert) return null; cum+=(porMes[m]||0); return cum; });
}

/* qué se compara contra la referencia: producción real o certificado */
function realSel(){
  const den=montoContratoOriginal();
  if(kpiReal()==='certificado' && hayCertificados()){
    const mt=montoCertificado();
    return { pct: mt/den*100, monto: mt, nombre:'certificado' };
  }
  const mt=ITEMS.reduce((s,i)=>{ const pr=PROD[i.id]; return s+((pr&&pr.total)?pr.total*(i.pu||0):0); },0);
  return { pct: mt/den*100, monto: mt, nombre:'producido' };
}

/* selectores embebidos en la etiqueta del KPI */
function selRefHTML(){
  const disp=refsDisponibles(), cur=refInfo().key;
  return `Avance esperado <select id="kpiRefSel" class="kpi-sel">`
    + disp.map(d=>`<option value="${d.k}" ${d.k===cur?'selected':''}>${d.nom}</option>`).join('')
    + `</select>`;
}
function selRealHTML(){
  const cert=hayCertificados();
  return `Monto <select id="kpiRealSel" class="kpi-sel">`
    + `<option value="real" ${kpiReal()==='real'?'selected':''}>producido</option>`
    + `<option value="certificado" ${kpiReal()==='certificado'?'selected':''} ${cert?'':'disabled'}>certificado${cert?'':' (sin datos)'}</option>`
    + `</select>`;
}
function bindKpiSelectores(){
  const a=$('#kpiRefSel');
  if(a) a.onchange=()=>{ KPI_REF=a.value;
    try{ localStorage.setItem('obra_kpiref_'+(OBRA.id||''), KPI_REF); }catch(e){}
    renderReport(); renderCurvas(); };
  const b=$('#kpiRealSel');
  if(b) b.onchange=()=>{ KPI_REAL=b.value;
    try{ localStorage.setItem('obra_kpireal_'+(OBRA.id||''), KPI_REAL); }catch(e){}
    renderReport(); renderCurvas(); };
}

/* ---------------- render del panel de curvas (Batch 3) ------------------- */
let CURVA_BL_CONTR = null, CURVA_BL_META = null;   // versiones elegidas

function renderCurvas(){
  const cont=$('#curvasPanel'); if(!cont) return;
  const sel=curvasSel();
  const contrs=baselinesDe('contractual'), metas=baselinesDe('meta');
  const blC = CURVA_BL_CONTR ? BASELINES.find(b=>b.id===CURVA_BL_CONTR) : contrs[contrs.length-1];
  const blM = CURVA_BL_META  ? BASELINES.find(b=>b.id===CURVA_BL_META)  : metas[metas.length-1];
  const C=calcularCurvas(blC, blM);
  const EJE=C._eje||MONTHS;               // eje extendido si hay +lluvia activa

  const W=880,H=300,padL=42,padR=58,padT=14,padB=30;
  const n=EJE.length||1;
  const xs=k=>padL+k*(W-padL-padR)/(n-1||1);
  let maxV=100;
  CURVAS_DEF.forEach(d=>{ if(sel[d.k]&&C[d.k]) C[d.k].forEach(v=>{ if(v!=null&&v>maxV) maxV=v; }); });
  const ymax=Math.ceil(maxV/10)*10;
  const ys=v=>H-padB-(v/ymax)*(H-padT-padB);

  const linea=(arr,col,dash)=>{
    if(!arr) return '';
    const pts=arr.map((v,k)=>v==null?null:[xs(k),ys(v),v]).filter(Boolean);
    if(!pts.length) return '';
    const poly=pts.map(p=>p[0]+','+p[1]).join(' ');
    const last=pts[pts.length-1];
    return `<polyline points="${poly}" fill="none" stroke="${col}" stroke-width="2.4" ${dash?'stroke-dasharray="6 4"':''} stroke-linejoin="round"/>`
      +`<g><rect x="${Math.min(last[0]+5,W-52)}" y="${last[1]-9}" width="48" height="17" rx="4" fill="${col}"/>`
      +`<text x="${Math.min(last[0]+29,W-28)}" y="${last[1]+3}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff" font-family="var(--mono)">${last[2].toFixed(1)}%</text></g>`;
  };

  let grid='';
  const step = ymax<=120?20:25;
  for(let v=0; v<=ymax; v+=step){
    grid+=`<line x1="${padL}" y1="${ys(v)}" x2="${W-padR}" y2="${ys(v)}" stroke="#e2e7ee"/>`
        +`<text x="${padL-6}" y="${ys(v)+3}" text-anchor="end" font-size="9" fill="#8794a6" font-family="var(--mono)">${v}%</text>`;
  }
  grid+=`<line x1="${padL}" y1="${ys(100)}" x2="${W-padR}" y2="${ys(100)}" stroke="#b0453a" stroke-width="1.4" stroke-dasharray="4 3"/>`
      +`<text x="${W-padR+4}" y="${ys(100)+3}" font-size="9" fill="#b0453a" font-weight="700">100%</text>`;
  let xax='';
  const cada=Math.max(1,Math.ceil(n/14));
  EJE.forEach((m,k)=>{ if(k%cada===0)
    xax+=`<text x="${xs(k)}" y="${H-9}" text-anchor="middle" font-size="8.5" fill="#8794a6">${monthLabel(m)}</text>`; });
  // marcas verticales de FIN: contrato original (siempre) y ajustado por lluvia
  // (cuando el eje se extendió). Con fecha exacta dd/mm/aa.
  let finOrig='';
  // La marca de FIN DE CONTRATO sale de la LÍNEA BASE contractual (el plazo
  // firmado), no del último mes del plan operativo ni de OBRA.fecha_fin, que
  // se mueven con la reprogramación y desplazaban la marca.
  const fcOrig = (blC && finBaseline(blC)) || finContrato();
  const ultOrig = fcOrig ? mkDe(fcOrig) : MONTHS[MONTHS.length-1];
  let iFinOrig = EJE.indexOf(ultOrig);
  if(iFinOrig<0) iFinOrig = EJE.indexOf(MONTHS[MONTHS.length-1]);
  const fmtF=d=>d?`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`:'';
  if(iFinOrig>=0){
    const lblOrig = fcOrig ? 'fin contrato '+fmtF(fcOrig) : 'fin contrato';
    finOrig=`<line x1="${xs(iFinOrig)}" y1="${padT+12}" x2="${xs(iFinOrig)}" y2="${H-padB}" stroke="#8a8782" stroke-width="1" stroke-dasharray="2 3"/>`
      +`<text x="${xs(iFinOrig)}" y="${padT+9}" text-anchor="middle" font-size="8" fill="#6b6862" font-weight="600">${lblOrig}</text>`;
  }
  // fin ajustado: solo si alguna curva +lluvia está activa y extendió el eje
  let finAjust='';
  if(EJE.length>MONTHS.length){
    // fecha fin ajustada = la mayor entre contractual+lluvia y meta+lluvia activas
    let fAj=null;
    if(LLUVIA_CURVA.contractual && blC){ const r=curvaPlaneadoLluviaSerie(blC); if(r&&r.finAjustada&&(!fAj||r.finAjustada>fAj)) fAj=r.finAjustada; }
    if(LLUVIA_CURVA.meta && blM){ const r=curvaPlaneadoLluviaSerie(blM); if(r&&r.finAjustada&&(!fAj||r.finAjustada>fAj)) fAj=r.finAjustada; }
    const iFinAj=EJE.length-1;   // último mes del eje = mes de la fecha ajustada
    if(fAj){
      finAjust=`<line x1="${xs(iFinAj)}" y1="${padT+12}" x2="${xs(iFinAj)}" y2="${H-padB}" stroke="#2f7d4f" stroke-width="1.2" stroke-dasharray="4 2"/>`
        +`<text x="${xs(iFinAj)}" y="${padT+9}" text-anchor="middle" font-size="8" fill="#2f7d4f" font-weight="700">fin ajust. ${fmtF(fAj)}</text>`;
    }
  }
  const mAct=mesActual();
  const iHoy=EJE.indexOf(mAct);
  let hoy='';
  if(iHoy>=0){
    hoy=`<line x1="${xs(iHoy)}" y1="${padT}" x2="${xs(iHoy)}" y2="${H-padB}" stroke="#d64545" stroke-width="1.2" stroke-dasharray="3 3"/>`
      +`<rect x="${xs(iHoy)-16}" y="${padT-2}" width="32" height="13" rx="3" fill="#d64545"/>`
      +`<text x="${xs(iHoy)}" y="${padT+8}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff">HOY</text>`;
  }
  let paths='';
  CURVAS_DEF.forEach(d=>{ if(sel[d.k]) paths+=linea(C[d.k], d.col, d.dash); });

  // cada curva: checkbox + (si aplica) dropdown de versión + toggle "+ lluvia"
  const opcion=d=>{
    const hay = C[d.k] && C[d.k].some(v=>v!=null);
    const arr = d.versiones==='contractual' ? contrs : d.versiones==='meta' ? metas : null;
    const cur = d.versiones==='contractual' ? blC : d.versiones==='meta' ? blM : null;
    const idSel = d.versiones==='contractual' ? 'selBlC' : 'selBlM';
    const ver = (arr && arr.length>1)
      ? `<select class="curva-ver" id="${idSel}">${arr.map(b=>
          `<option value="${b.id}" ${b.id===(cur&&cur.id)?'selected':''}>${b.name}</option>`).join('')}</select>`
      : (arr && arr.length===1 ? `<span class="curva-ver-fijo">${arr[0].name}</span>` : '');
    const lluvia = (d.lluviaOpc && hay && Object.keys(CLIMA).length)
      ? `<label class="curva-lluvia" title="Aplicar el ajuste por lluvia a esta línea base">
          <input type="checkbox" data-l="${d.k}" ${LLUVIA_CURVA[d.k]?'checked':''}> + lluvia</label>`
      : '';
    return `<div class="curva-grp">
      <label class="curva-chk${hay?'':' off'}" title="${hay?'':'sin datos para esta curva'}">
        <input type="checkbox" data-c="${d.k}" ${sel[d.k]?'checked':''} ${hay?'':'disabled'}>
        <span class="curva-col" style="background:${d.col}"></span>${d.nom}</label>
      ${ver}${lluvia}</div>`;
  };

  const ult=arr=>{ if(!arr) return null; for(let k=arr.length-1;k>=0;k--) if(arr[k]!=null) return arr[k]; return null; };
  const iAct = iHoy>=0? iHoy : EJE.length-1;
  const val=arr=>arr&&arr[iAct]!=null?arr[iAct]:null;
  // Para el desglose de atraso hay que comparar SIEMPRE contractual PURA vs
  // contractual+lluvia. Si se usara C.contractual y el checkbox «+lluvia» está
  // activo, esa curva YA viene ajustada y la diferencia daría 0 (bug).
  const denK = montoContratoOriginal();
  const curvaPura = curvaBaseline(blC, EJE);
  const vCpuro = curvaPura ? (curvaPura[iAct]!=null ? curvaPura[iAct]/denK*100 : null) : null;
  const vR=ult(C.real);
  const atrasoContrato = (vCpuro!=null&&vR!=null)? vCpuro-vR : null;
  // El pp justificado por lluvia solo tiene sentido MIENTRAS la contractual
  // todavía sube (dentro del plazo original). Pasado el fin de contrato la
  // contractual queda clavada en 100% y la resta vertical se achica sola, dando
  // la impresión falsa de que la lluvia justifica menos. Por eso se evalúa en
  // min(hoy, fin de contrato) y se acompaña siempre con los días de corrimiento,
  // que es la medida que no baja nunca.
  const idxFinContr = (()=>{
    const fc = finContrato();
    if(!fc) return iAct;
    const mkFC = mkDe(fc);
    const k = EJE.indexOf(mkFC);
    return (k>=0 && k<iAct) ? k : iAct;
  })();
  const vCpuroFC = curvaPura && curvaPura[idxFinContr]!=null ? curvaPura[idxFinContr]/denK*100 : null;
  const vLfc     = C.planLluvia && C.planLluvia[idxFinContr]!=null ? C.planLluvia[idxFinContr] : null;
  const atrasoLluvia = (vCpuroFC!=null&&vLfc!=null)? vCpuroFC-vLfc : null;
  const atrasoPropio   = (atrasoContrato!=null&&atrasoLluvia!=null)? atrasoContrato-atrasoLluvia : null;
  // días de corrimiento por lluvia (medida horizontal: no baja nunca)
  const serieLl = blC ? curvaPlaneadoLluviaSerie(blC) : null;
  const diasCorr = serieLl ? serieLl.diasGanados : null;
  const num=v=>v==null?'<b>—</b>':`<b class="${v>0.05?'over100':''}">${v.toFixed(1)} pp</b>`;

  // ---- montos a la fecha, contra la curva de referencia seleccionada ----
  const den=montoContratoOriginal();
  const ref=refInfo(), rs=realSel();
  const brechaMonto = rs.monto - ref.montoEsp;
  const montos=`<div class="curvas-montos">
      <div class="cm-card"><div class="cm-lab">Monto ${rs.nombre}</div><div class="cm-val tape">${fmtG(rs.monto)}</div></div>
      <div class="cm-card"><div class="cm-lab">Esperado · ${ref.nombre}</div><div class="cm-val plan">${fmtG(ref.montoEsp)}</div></div>
      <div class="cm-card"><div class="cm-lab">Brecha</div><div class="cm-val ${brechaMonto>=0?'pos':'neg'}">${brechaMonto>=0?'+':''}${fmtG(brechaMonto)}</div></div>
    </div>`;

  cont.innerHTML=`<div class="curvas-wrap">
      <div class="curvas-side">
        <div class="curvas-tit">Curvas</div>
        ${CURVAS_DEF.filter(d=>d.k!=='planLluvia').map(opcion).join('')}
      </div>
      <div style="flex:1;min-width:0">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${grid}${xax}${finOrig}${finAjust}${hoy}${paths}</svg>
        ${montos}
        <div class="curvas-res">
          <div>Atraso vs contrato ${num(atrasoContrato)}</div>
          <div>Justificado por lluvia ${num(atrasoLluvia)}${diasCorr?` <span class="hint">(${diasCorr} días de corrimiento)</span>`:''}</div>
          <div>Atraso propio ${num(atrasoPropio)}</div>
        </div>
      </div>
    </div>`;
  $$('#curvasPanel input[data-c]').forEach(ch=>ch.onchange=()=>{
    CURVAS_ON[ch.dataset.c]=ch.checked; guardarCurvasSel(); renderCurvas(); renderReport();
  });
  $$('#curvasPanel input[data-l]').forEach(ch=>ch.onchange=()=>{
    LLUVIA_CURVA[ch.dataset.l]=ch.checked; renderCurvas(); renderReport(); renderKPIs();
  });
  const sC=$('#selBlC'); if(sC) sC.onchange=()=>{ CURVA_BL_CONTR=sC.value; renderCurvas(); };
  const sM=$('#selBlM'); if(sM) sM.onchange=()=>{ CURVA_BL_META=sM.value; renderCurvas(); };
  renderInformeLluvia();
}

/* =========================================================================
 * INFORME DE LLUVIAS — calendario mes × día (estilo Planilla de Liberación).
 * Filas = meses con datos de clima; columnas = días 1..31.
 * Celda:  B = laborable · R + mm = día de lluvia · H = exceso de humedad ·
 *         (vacío) = sin dato / fuera de mes.
 * Panel lateral: por mes → Lluvia, Humedad, No Laborables, Laborables, % Laborables.
 * Los "No Laborables" usan la regla de la obra (umbral/todos) vía
 * diasClimaReconocidos; los brutos se muestran como conteo directo.          */
function renderInformeLluvia(){
  const cont=$('#lluviaPanel'); if(!cont) return;
  const meses=Object.keys(CLIMA).sort();
  if(!meses.length){
    cont.innerHTML='<span class="hint">Sin registros de clima para esta obra en la Planilla de Liberación.</span>';
    return;
  }
  const NOMBRE_MES=['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const modo=String(cfgGet('lluvia:modo','todos')).trim().toLowerCase();
  const umbral=cfgNum('lluvia:umbral',8);
  const conteo=String(cfgGet('lluvia:conteo','excedente')).trim().toLowerCase();

  // encabezado de días 1..31
  let head='<th class="ll-mes">Mes</th>';
  for(let d=1; d<=31; d++) head+=`<th class="ll-d">${d}</th>`;

  // acumuladores globales
  let gLluvia=0, gHum=0, gNoLab=0, gLab=0, gCalTot=0;

  let filas='', totales='';
  meses.forEach(mk=>{
    const c=CLIMA[mk]||{};
    const dias=c.dias||{};        // { 'YYYY-MM-DD': 'lluvia'|'humedad'|'receso' }
    const mmDia=c.mmDia||{};      // { 'YYYY-MM-DD': mm }
    const [y,m]=mk.split('-').map(Number);
    const calDias=new Date(y,m,0).getDate();

    let cll=0, chu=0, cre=0;
    let celdas=`<td class="ll-mes">${NOMBRE_MES[m]||mk} <small>${y}</small></td>`;
    for(let d=1; d<=31; d++){
      if(d>calDias){ celdas+='<td class="ll-x"></td>'; continue; }
      const key=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cls=dias[key];
      if(cls==='lluvia'){
        cll++;
        const mm=mmDia[key]||0;
        celdas+=`<td class="ll-r" title="Lluvia · ${mm} mm">${mm?mm:'R'}</td>`;
      }else if(cls==='humedad'){
        chu++;
        celdas+='<td class="ll-h" title="Exceso de humedad">H</td>';
      }else if(cls==='receso'){
        cre++;
        celdas+='<td class="ll-re" title="Receso">Re</td>';
      }else{
        celdas+='<td class="ll-b" title="Laborable">B</td>';
      }
    }
    filas+=`<tr>${celdas}</tr>`;

    // totales del mes: no laborables = reconocidos (regla obra); laborables = cal − no lab
    const brutos=cll+chu;                    // receso NO cuenta como clima ganado
    const reconocidos=diasClimaReconocidos(mk);
    const noLab=reconocidos;
    const lab=Math.max(0, calDias - noLab);
    const pctLab=calDias? (lab/calDias*100):0;
    gLluvia+=cll; gHum+=chu; gNoLab+=noLab; gLab+=lab; gCalTot+=calDias;

    totales+=`<tr>
      <td class="lt-mes">${NOMBRE_MES[m]||mk}</td>
      <td class="r">${cll}</td><td class="r">${chu}</td>
      <td class="r">${noLab}</td><td class="r">${lab}</td>
      <td class="r">${pctLab.toFixed(1)}</td></tr>`;
  });

  const pctLabG=gCalTot? (gLab/gCalTot*100):0;
  const reglaTxt = modo==='umbral'
    ? `Regla: obra pública · umbral ${umbral} mm · cuenta ${conteo==='total'?'el total del mes':'solo el excedente'}`
    : 'Regla: obra privada · todos los días de clima cuentan';

  cont.innerHTML=`
    <div class="lluvia-wrap">
      <div class="lluvia-cal">
        <table class="lluvia-tab">
          <thead><tr>${head}</tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <div class="lluvia-leyenda">
          <span class="lg lg-b">B laborable</span>
          <span class="lg lg-r">R / mm lluvia</span>
          <span class="lg lg-h">H humedad</span>
          <span class="lg lg-re">Re receso</span>
        </div>
      </div>
      <div class="lluvia-tot">
        <table class="lluvia-tab-tot">
          <thead><tr><th>Mes</th><th class="r">Lluvia</th><th class="r">Humedad</th><th class="r">No Lab.</th><th class="r">Lab.</th><th class="r">% Lab.</th></tr></thead>
          <tbody>${totales}</tbody>
          <tfoot><tr class="lt-total">
            <td>Total</td><td class="r">${gLluvia}</td><td class="r">${gHum}</td>
            <td class="r">${gNoLab}</td><td class="r">${gLab}</td><td class="r">${pctLabG.toFixed(1)}</td>
          </tr></tfoot>
        </table>
        <div class="lluvia-regla">${reglaTxt}</div>
        <div class="lluvia-ganados">Días ganados reconocidos (retrospectivo): <b>${diasGanadosRetro()}</b></div>
      </div>
    </div>`;
}

/* % esperado de UN ítem a la fecha, según la curva de referencia elegida.
   · operativa   → el plan vivo actual (dist_mensual)
   · contractual → la distribución congelada en la línea base contractual
   · meta        → idem, línea base meta
   · planLluvia  → la contractual re-pesada por días hábiles                */
function esperadoItem(i, kref){
  if(i.avE!=null && kref==='operativa') return i.avE;
  const contrs=baselinesDe('contractual'), metas=baselinesDe('meta');
  const blC = CURVA_BL_CONTR ? BASELINES.find(b=>b.id===CURVA_BL_CONTR) : contrs[contrs.length-1];
  const blM = CURVA_BL_META  ? BASELINES.find(b=>b.id===CURVA_BL_META)  : metas[metas.length-1];
  let dist=null;
  const bl = kref==='contractual' ? blC : kref==='meta' ? blM : null;
  if(bl && bl.items && bl.items[i.id]){
    // padre-con-tramos: suma las dist congeladas de sus subdivisiones en esa base
    dist = distEfectivaDe(i, x=>{ const s=bl.items&&bl.items[x.id]; return s? s.dist : null; });
    // si esa línea base tiene «+lluvia» activo, se corre igual que la curva:
    // perfil diario del ítem con corrimiento acumulado (mismo modelo).
    if(LLUVIA_CURVA[kref] && dist && diasGanadosRetro()>0){
      const d2={};
      Object.keys(dist).forEach(m=>{
        const q=dist[m]||0; if(!q) return;
        const [y,mo]=m.split('-').map(Number);
        const nd=new Date(y,mo,0).getDate(), porDia=q/nd;
        for(let k=1;k<=nd;k++){
          const t=correrFecha(new Date(y,mo-1,k));
          const mk=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0');
          d2[mk]=(d2[mk]||0)+porDia;
        }
      });
      dist=d2;
    }
  }
  // sin distribución congelada (o curva operativa): manda el plan vivo, que ya
  // prorratea al día y usa el plan semanal cuando existe.
  if(!dist) return itemAvancePlaneado(i);
  const total=Object.values(dist).reduce((a,b)=>a+(b||0),0);
  if(!total) return itemAvancePlaneado(i);
  // MISMO criterio que la grilla: mes cerrado completo, mes en curso
  // prorrateado por los días del ítem. Antes se sumaba el mes en curso entero
  // (m<=mesActual), lo que daba 100% a cualquier ítem que termine este mes.
  const fe=fechasEfectivas(i);
  const a=parseD(fe.ini), b=parseD(fe.fin);
  const hoy=new Date(TODAY.getFullYear(),TODAY.getMonth(),TODAY.getDate());
  let acum=0;
  for(const mk of Object.keys(dist)){
    const val=+dist[mk]||0; if(!val) continue;
    const y=+mk.split('-')[0], m=+mk.split('-')[1];
    acum += val*fracPeriodo_(new Date(y,m-1,1), new Date(y,m,0), a, b, hoy);
  }
  return +(acum/total*100).toFixed(1);
}

function renderReport(){
  const contrato=contratoTotal();
  const planM={}; MONTHS.forEach(m=>planM[m]=0);
  ITEMS.forEach(i=>{if(!esComputable(i))return;for(const[m,q]of Object.entries(distPlanItem(i)))if(planM[m]!=null)planM[m]+=q*i.pu;});
  let cum=0;const planCurve=MONTHS.map(m=>{cum+=planM[m];return cum/contrato*100;});
  const nowIdx=MONTHS.findIndex(m=>m>TODAY.toISOString().slice(0,7));
  const cutoff=nowIdx<0?MONTHS.length:nowIdx;
  const planToDate=planCurve[cutoff-1]||0.0001;
  // producido: cantidad ejecutada real × pu (máxima precisión, igual que el KPI global)
  const prodTotal=ITEMS.reduce((s,i)=>{if(!esComputable(i))return s;const pr=PROD[i.id];return s+((pr&&pr.total)?pr.total*i.pu:(i.avance_real_prod!=null?i.ptot*i.avance_real_prod/100:0));},0);
  // "certificado/esperado" del gráfico: avance planeado por días (o avE manual si existe)
  const certTotal=ITEMS.reduce((s,i)=>{if(!esComputable(i))return s;const e=i.avE!=null?i.avE:itemAvancePlaneado(i);return s+(e!=null?i.ptot*e/100:0);},0);
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
  // el panel viejo de curva físico-financiera fue reemplazado por renderCurvas()
  const svgOld=$('#curveSvg');
  if(svgOld){ svgOld.innerHTML=yaxis+xaxis+line(planCurve,'#3a6ea5'); }
  const rng=$('#repRange');
  if(rng) rng.textContent=monthLabel(MONTHS[0])+' → '+monthLabel(MONTHS[MONTHS.length-1]);

  const win=MONTHS.slice(Math.max(0,cutoff-6),cutoff+2);
  const realM={};ITEMS.forEach(i=>{if(!esComputable(i))return;const f=i.avance_real_prod!=null?i.avance_real_prod/100:0;for(const[m,q]of Object.entries(distPlanItem(i)))realM[m]=(realM[m]||0)+q*i.pu*f;});
  const maxB=Math.max(1,...win.map(m=>Math.max(planM[m]||0,realM[m]||0)));
  if($('#monthBars'))$('#monthBars').innerHTML=win.map(m=>{
    const pv=planM[m]||0,rv=realM[m]||0,ph=pv/maxB*100,rh=rv/maxB*100;const cmp=pv?Math.round(rv/pv*100):0;
    const cc=cmp>=95?'ok':cmp>=70?'mid':'lo';
    return `<div class="bmonth" title="${monthLabel(m)} · Plan ${fmtGshort(pv)} / Real ${fmtGshort(rv)}">
      <div class="cmp-lab ${cc}">${pv?cmp+'%':'—'}</div>
      <div class="stack"><div class="bp" style="height:${ph}%"><span>${fmtGshort(pv)}</span></div><div class="br" style="height:${rh}%"><span>${fmtGshort(rv)}</span></div></div>
      <div class="ml">${monthLabel(m)}</div></div>`;
  }).join('');

  // KPIs del informe
  const nItems=ITEMS.filter(i=>esComputable(i)&&i.ptot>0).length;
  const sobre=ITEMS.filter(i=>esComputable(i)&&i.avance_real_prod!=null&&i.avance_real_prod>100.5);
  const conAvance=ITEMS.filter(i=>esComputable(i)&&i.avance_real_prod!=null&&i.avance_real_prod>0);
  // ---- KPIs con curva de referencia SELECCIONABLE (Batch 3) ----
  // "Avance esperado" y "Brecha" se miden contra la curva que elija el usuario
  // (contractual, meta, planeado+lluvia, plan operativo…), no contra una fija.
  const ref = refInfo();                  // {pctEsp, montoEsp, nombre}
  const realInfo = realSel();             // {pct, monto, nombre} → producido o certificado
  const brechaGlobal = realInfo.pct - ref.pctEsp;
  const den = montoContratoOriginal();
  const kpis=[
    [selRealHTML(), fmtG(realInfo.monto),'tape'],
    ['Avance '+realInfo.nombre.toLowerCase(), pct(realInfo.pct),'tape'],
    [selRefHTML(),  pct(ref.pctEsp),'plan'],
    ['Brecha',(brechaGlobal>=0?'+':'')+brechaGlobal.toFixed(1)+'%',brechaGlobal>=0?'pos':'neg'],
    ['Ítems con avance',conAvance.length+' / '+nItems,''],
    ['Sobre-ejecución',sobre.length+(sobre.length?' ítems':''),sobre.length?'neg':''],
  ];
  $('#repKpis').innerHTML=kpis.map(k=>`<div class="rkpi"><div class="rk-lab">${k[0]}</div><div class="rk-val ${k[2]||''}">${k[1]}</div></div>`).join('');
  bindKpiSelectores();

  // panel de ítems que necesitan atención: más atrasados y sobre-ejecutados
  const conBrecha=ITEMS.map(i=>{
    const av=i.avance_real_prod, esp=i.avE!=null?i.avE:itemAvancePlaneado(i);
    return (av!=null&&esp!=null)?{i,av,esp,br:av-esp}:null;
  }).filter(Boolean);
  const atrasados=conBrecha.filter(x=>x.br<-5).sort((a,b)=>a.br-b.br).slice(0,6);
  if($('#critBox'))$('#critBox').innerHTML = atrasados.length
    ? atrasados.map(x=>`<div class="crit-row"><span class="cr-id">${x.i.id}</span><span class="cr-desc">${(x.i.desc||'').slice(0,34)}</span><span class="cr-br neg">${x.br.toFixed(0)}%</span></div>`).join('')
    : '<span class="hint">Ningún ítem atrasado más de 5% respecto al plan.</span>';

  // el "esperado" por ítem también sale de la curva de referencia elegida
  const kref=refInfo().key;
  $('#repBody').innerHTML=ITEMS.filter(i=>tipoDe(i)!=='subdivision').map(i=>{
    const av=i.avance_real_prod;
    const esp = esperadoItem(i, kref);
    // sin producción real el avance es 0, no "sin dato": si estaba planeado
    // el 100% y no se ejecutó nada, la brecha es −100%, no un guion.
    const avNum = av!=null ? av : (PROD[i.id]&&PROD[i.id].total ? null : 0);
    const brecha=(avNum!=null&&esp!=null)?avNum-esp:null;
    const bc=brecha==null?'':brecha>=0?'pos':'neg';
    const pr=PROD[i.id];
    const cantProd = pr&&pr.total ? pr.total : (av!=null&&cantVigente(i)?cantVigente(i)*av/100:null);
    const montoProd = cantProd!=null ? cantProd*i.pu : null;
    const avCls = av!=null&&av>100.5 ? 'over100' : '';
    return `<tr><td class="itemid">${i.id}</td><td>${i.desc||''}</td><td class="mono">${i.um||''}</td>
      <td class="r">${fmtN(i.cant)}</td><td class="r">${cantProd!=null?fmtN(cantProd):'—'}</td>
      <td class="r">${fmtN(i.ptot,0)}</td><td class="r">${montoProd!=null?fmtN(montoProd,0):'—'}</td>
      <td class="r ${avCls}">${av!=null?pct(av):(avNum===0?pct(0):'—')}</td><td class="r plan">${esp!=null?pct(esp):'—'}</td>
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
  if(b.dataset.v==='report'){renderReport(); renderCurvas();} if(b.dataset.v==='weekly')renderWeekly();
  if(b.dataset.v==='pbi')loadPbi();
  if(b.dataset.v==='prod' && window.ProduccionView) window.ProduccionView.abrir();
  if(b.dataset.v==='cert' && window.CertificacionView) window.CertificacionView.abrir();});

const PBI_URL='https://app.powerbi.com/reportEmbed?reportId=1ea8db13-3f09-46a9-86fe-127ebec7d176&autoAuth=true&ctid=462f0ae8-a483-4bbe-b0ca-af2484c8f018';
function loadPbi(){const f=$('#pbiFrame');if(f&&!f.src)f.src=PBI_URL;}
$('#ganttMode').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $$('#ganttMode button').forEach(x=>x.classList.remove('on'));b.classList.add('on');ganttMode=b.dataset.m;
  document.body.classList.toggle('gridmode',ganttMode!=='time');
  const cv=$('#colwVal'); if(cv) cv.textContent=inTimeWeek()?Math.round(TIME_WEEK_PX):colw();
  SEL.anchor=SEL.focus=null; renderGantt();});
$('#catFilter').onchange=e=>{catFilter=e.target.value;renderGantt();};
$('#showBase').onchange=renderGantt;
$('#critBtn').onclick=()=>{showCrit=!showCrit;$('#critBtn').classList.toggle('active',showCrit);renderGantt();};

/* ---------------- AJUSTE POR LLUVIAS: panel de configuración --------------- */
/* El ajuste por lluvia NO toca el cronograma operativo: vive en las líneas base
   (curva «+ lluvia» y overlay «Gantt con lluvia»). El operativo se reprograma
   solo por producción. */
/* persiste SOLO las claves lluvia:* de la obra en la tab Config (no toca el
   cronograma operativo). El ajuste por lluvia se visualiza sobre líneas base. */
function guardarConfigLluvia(){
  const cfg={};
  Object.keys(CFG||{}).forEach(k=>{ if(/^lluvia:/.test(k)) cfg[k]=CFG[k]; });
  if(ONLINE && typeof ObraAPI!=='undefined' && ObraAPI.saveConfig){
    ObraAPI.saveConfig(cfg).catch(e=>toast('Error guardando configuración: '+(e.message||e)));
  }
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
      <td class="r mono lvRec ${rec?'':'muted'}" data-mk="${mk}"><b>${rec}</b></td>
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
      </tr></thead><tbody>${filas||'<tr><td colspan="8" class="hint">Todavía no hay días de clima registrados para esta obra.</td></tr>'}</tbody>
      ${filas?`<tfoot><tr style="border-top:2px solid var(--line)">
        <td colspan="6" class="r"><b>Total días reconocidos</b></td>
        <td class="r mono" id="lvTot"><b>0</b></td><td></td></tr></tfoot>`:''}
      </table>
    </div>
    <div class="hint" id="lvMsg" style="margin-top:8px"></div>
    <div class="hint" style="margin-top:6px;padding:7px 10px;background:rgba(26,158,111,.09);
         border-left:3px solid #1a9e6f;border-radius:4px">
      Esta es la <b>configuración de la regla de clima</b> de la obra: define cómo se
      cuentan los días de lluvia/humedad. El ajuste por lluvia se visualiza sobre las
      <b>líneas base</b> (en la curva de avance y en «Gantt con lluvia»); <b>nunca</b> toca
      el cronograma operativo, que se reprograma por producción.</div>
    <div class="dactions" style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
      <button class="dsave" id="lvApply">Guardar configuración</button>
    </div>
  </div>`;
  m.classList.add('open');
  const syncEnab=()=>{const u=$('#lvModo').value==='umbral';
    $('#lvUmbral').disabled=!u; $('#lvConteo').disabled=!u;};

  /* recalcula la columna RECONOCIDOS en vivo, con lo que el usuario ve en los
     controles (sin tocar CFG todavía: eso recién pasa al presionar Aplicar) */
  const recalcTabla=()=>{
    const cfgPrev={...CFG};
    CFG['lluvia:modo']=$('#lvModo').value;
    CFG['lluvia:umbral']=$('#lvUmbral').value;
    CFG['lluvia:conteo']=$('#lvConteo').value;
    $$('.lvExc').forEach(inp=>{
      const v=parseNum(inp.value)||0;
      if(v) CFG['lluvia:excluir:'+inp.dataset.mk]=v;
      else  delete CFG['lluvia:excluir:'+inp.dataset.mk];
    });
    let totRec=0;
    $$('.lvRec').forEach(td=>{
      const mk=td.dataset.mk, rec=diasClimaReconocidos(mk);
      totRec+=rec;
      td.innerHTML='<b>'+rec+'</b>';
      td.classList.toggle('muted',!rec);
    });
    const tot=$('#lvTot'); if(tot) tot.innerHTML='<b>'+totRec+'</b>';
    CFG=cfgPrev;   // restaurar: el panel es una previsualización
  };
  $('#lvModo').onchange=()=>{syncEnab();recalcTabla();};
  $('#lvUmbral').oninput=recalcTabla;
  $('#lvConteo').onchange=recalcTabla;
  $$('.lvExc').forEach(inp=>inp.oninput=recalcTabla);
  recalcTabla();
  $('#lvApply').onclick=()=>{
    CFG['lluvia:modo']=$('#lvModo').value;
    CFG['lluvia:umbral']=$('#lvUmbral').value;
    CFG['lluvia:conteo']=$('#lvConteo').value;
    $$('.lvExc').forEach(inp=>{
      const v=parseNum(inp.value)||0;
      if(v) CFG['lluvia:excluir:'+inp.dataset.mk]=v;
      else  delete CFG['lluvia:excluir:'+inp.dataset.mk];
    });
    guardarConfigLluvia();            // persiste la regla en Config (no toca el operativo)
    invalidarCacheLluvia();           // la regla cambió → recalcular curvas
    // el overlay del Gantt es un snapshot con la regla ANTERIOR: se recalcula
    // si estaba visible (si no, se descarta) para que nada quede desfasado.
    if(GANTT_LLUVIA){
      const blPrev = GANTT_LLUVIA.base ? BASELINES.find(b=>b.id===GANTT_LLUVIA.base) : null;
      GANTT_LLUVIA = blPrev ? correrMotorLluvia(blPrev) : null;
    }
    closeModal();
    renderKPIs(); renderGantt(); renderCurvas(); renderReport();
    toast('Configuración de lluvia guardada · <b>'+diasGanadosRetro()+'</b> días reconocidos');
  };
}
if($('#lluviaBtn')) $('#lluviaBtn').onclick=openLluviaPanel;

/* -------------- AJUSTE POR PRODUCCIÓN: panel (capa 4, plan vivo) ----------- */
function openProdPanel(){
  const mAct=mesActual(), techo=mesDeTecho(), fc=finContrato();
  const dias=diasGanadosPorLluvia();
  // diagnóstico global: cuánto falta y cuánto se adelantó
  let falta=0, adel=0, nSobre=0;
  const prev=ITEMS.filter(i=>esPortadorPlan(i)).map(i=>{
    const r=reprogramarItem(i,PROD_MODO);
    if(r.desvio>0.001) falta+=r.desvio*(i.pu||0);
    if(r.desvio<-0.001) adel+=(-r.desvio)*(i.pu||0);
    if(Object.keys(r.sobrecargados).length) nSobre++;
    return {i,r};
  });
  const filas=prev.filter(x=>Math.abs(x.r.desvio)>0.001)
    .sort((a,b)=>Math.abs(b.r.desvio*(b.i.pu||0))-Math.abs(a.r.desvio*(a.i.pu||0)))
    .slice(0,40).map(({i,r})=>{
      const sob=Object.keys(r.sobrecargados).length;
      return `<tr><td class="mono">${i.id}</td><td>${(i.desc||'').slice(0,38)}</td>
        <td class="r mono">${fmtN(r.vigente)}</td>
        <td class="r mono">${fmtN(r.vigente-r.desvio-(r.vigente-r.total))}</td>
        <td class="r mono ${r.desvio>0?'':'over100'}"><b>${r.desvio>0?'+':''}${fmtN(r.desvio)}</b></td>
        <td class="r mono">${sob?'<span class="over100">⚠ '+sob+' mes'+(sob>1?'es':'')+'</span>':'—'}</td></tr>`;
    }).join('');
  const m=$('#modal');
  m.innerHTML=`<div class="modal-card wide">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Reprogramar por producción</h3>
    <p class="hint" style="margin-bottom:10px">Ajusta el <b>plan operativo</b>: en los meses pasados iguala
      el plan a lo realmente ejecutado, y traslada el faltante hacia adelante.
      Trabaja contra la <b>cantidad vigente</b> (incluye convenios). No toca lo ejecutado real.</p>
    <div class="dgrid2" style="margin-bottom:6px">
      <div class="dfield"><label>Destino del faltante</label>
        <select id="pdModo">
          <option value="siguiente" ${PROD_MODO==='siguiente'?'selected':''}>Todo al mes siguiente</option>
          <option value="repartir"  ${PROD_MODO==='repartir'?'selected':''}>Repartir en los meses restantes</option>
          <option value="repartir_techo" ${PROD_MODO==='repartir_techo'?'selected':''}>Repartir en meses restantes (incluye extensión por lluvia)</option>
        </select></div>
      <div class="dfield"><label>Techo de extensión automática</label>
        <input readonly value="${techo? techo+'  (fin contrato '+(fc?dstr(fc):'—')+' + '+dias+' días de lluvia)' : 'sin fecha de contrato'}"></div>
    </div>
    <div class="kpis" style="display:flex;gap:16px;margin:10px 0;font-size:13px">
      <div>Falta ejecutar: <b>${fmtGshort(falta)}</b></div>
      <div>Adelantado: <b class="over100">${fmtGshort(adel)}</b></div>
      <div>Ítems que no entran en plazo: <b class="${nSobre?'over100':''}">${nSobre}</b></div>
    </div>
    <div class="prev-wrap" style="max-height:280px">
      <table class="prev-tbl"><thead><tr>
        <th>ID</th><th>Ítem</th><th class="r">Vigente</th><th class="r">Ejecutado</th>
        <th class="r">Desvío</th><th class="r">Alarma</th></tr></thead>
      <tbody>${filas||'<tr><td colspan="6" class="hint">No hay desvíos entre lo planeado y lo ejecutado.</td></tr>'}</tbody>
      </table></div>
    <div class="hint" style="margin-top:8px">Los meses que se inflan por no entrar en el techo se muestran
      <span class="over100">en rojo</span>. Extender más allá del techo es una decisión manual.</div>
    <div class="hint" style="margin-top:6px;padding:7px 10px;background:rgba(224,104,44,.09);
         border-left:3px solid #e0682c;border-radius:4px">
      Mientras el ajuste esté activo el plan es una <b>simulación</b>: no se guarda en la
      planilla y podés revertirlo cuando quieras. Para dejarlo escrito usá
      <b>Aplicar definitivamente</b>.</div>
    <div class="dactions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label class="hint" style="flex:1;min-width:180px">
        <input type="checkbox" id="pdOn" ${PROD_ON?'checked':''}>
        Ver reprogramación (reversible)</label>
      <button class="dsave" id="pdCommit" ${PROD_ON?'':'disabled'}
        style="background:#b3311f;color:#fff">Aplicar definitivamente</button>
      <button class="dsave" id="pdApply">Aplicar</button>
    </div>
  </div>`;
  m.classList.add('open');
  $('#pdModo').onchange=()=>{ PROD_MODO=$('#pdModo').value; openProdPanel(); };
  $('#pdApply').onclick=()=>{
    aplicarProduccion($('#pdOn').checked, $('#pdModo').value);
    closeModal();
    toast(PROD_ON?'Simulación activa · <b>no se guarda</b> hasta aplicar definitivamente'
                 :'Reprogramación <b>revertida</b>');
  };
  $('#pdCommit').onclick=()=>{
    if(!PROD_ON){ toast('Primero activá la reprogramación para ver el resultado'); return; }
    if(!confirm('El plan reprogramado se va a escribir en la planilla y ya no se podrá revertir.\n\n¿Confirmás?')) return;
    // el plan ajustado pasa a ser el plan real: se suelta el backup y se guarda
    PLAN_ORIG=null; PROD_ON=false;
    const b=$('#prodBtn'); if(b) b.classList.remove('active');
    touch(); flush(true);
    closeModal();
    toast('Plan operativo <b>aplicado definitivamente</b>');
  };
}
if($('#prodBtn')) $('#prodBtn').onclick=openProdPanel;

/* -------- GANTT CON LLUVIA: sobre líneas base, dos métodos -------- */
function openGanttLluviaPanel(){
  const contrs=baselinesDe('contractual'), metas=baselinesDe('meta');
  const bases=[...contrs, ...metas];
  const m=$('#modal');
  if(!bases.length){
    m.innerHTML=`<div class="modal-card">
      <button class="x" onclick="closeModal()">×</button>
      <h3>Gantt corrido por lluvia</h3>
      <p class="hint">El ajuste por lluvia se aplica sobre <b>líneas base</b> (Contractual o Meta),
        no sobre el cronograma operativo. Todavía no hay ninguna línea base creada:
        creá una desde el botón «+ Línea base» y volvé a intentarlo.</p></div>`;
    m.classList.add('open'); return;
  }
  m.innerHTML=`<div class="modal-card">
    <button class="x" onclick="closeModal()">×</button>
    <h3>Gantt corrido por lluvia</h3>
    <p class="hint" style="margin-bottom:10px">Corre las fechas de una <b>línea base</b> según la
      lluvia acumulada hasta cada fecha (<b>${diasGanadosRetro()}</b> días reconocidos en total).
      Es una <b>vista de referencia</b>: no toca el plan operativo (ese se reprograma por
      producción). El resultado se dibuja como barra celeste sobre el Gantt.</p>

    <div class="dfield"><label>Línea base a correr</label>
      <select id="glBase">
        ${bases.map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}
      </select></div>

    <div class="hint" id="glNota" style="padding:7px 10px;border-left:3px solid #2f7d4f;
      background:rgba(47,125,79,.08);border-radius:4px;margin-bottom:6px">
      Regla: <b>1 día de clima = 1 día de plazo</b>, corrido <b>desde ese día en adelante</b>.
      Cada fecha se mueve por la lluvia que ya había ocurrido, no por el total: lo anterior a
      la lluvia queda donde está y lo posterior se corre. Un ítem que atraviesa un mes lluvioso
      se corre y además se estira.
      <b>Fin de obra ajustado = fin de la línea base + ${diasGanadosRetro()} días.</b>
    </div>

    <div class="dactions" style="display:flex;gap:8px;align-items:center">
      ${GANTT_LLUVIA?`<button class="dsave" id="glClear" style="flex:1;background:#8a8782">Quitar overlay</button>`:'<span style="flex:1"></span>'}
      <button class="dsave" id="glRun">Recalcular</button>
    </div>
  </div>`;
  m.classList.add('open');
  $('#glRun').onclick=()=>{ recalcularGanttLluvia($('#glBase').value||null); closeModal(); };
  // si no hay días reconocidos no tiene sentido correr nada
  if(!diasGanadosRetro()){
    const r=$('#glRun'); if(r){ r.disabled=true; r.textContent='Sin días de lluvia'; }
  }
  const clr=$('#glClear'); if(clr) clr.onclick=()=>{ GANTT_LLUVIA=null; renderGantt(); closeModal(); toast('Overlay de lluvia quitado'); };
}
if($('#ganttLluviaBtn')) $('#ganttLluviaBtn').onclick=openGanttLluviaPanel;
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
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

/* ---- conectividad: banner "sin conexión" + vaciar la cola al reconectar ---- */
function setupConnectivity(){
  const b=$('#offlineBanner');
  const upd=()=>{ const off=!navigator.onLine;
    if(b) b.classList.toggle('show',off);
    document.body.classList.toggle('offline',off); };
  window.addEventListener('online',()=>{ upd();
    if(window.Outbox){
      window.Outbox.flush().then(res=>{
        if(res && res.sent){ toast('Conexión restablecida · <b>'+res.sent+'</b> jornada(s) sincronizada(s) ✓');
          if(window.refrescarObraActual) window.refrescarObraActual(); }
        else toast('Conexión restablecida.');
      });
    } else toast('Conexión restablecida.');
  });
  window.addEventListener('offline',()=>{ upd();
    toast('📴 Sin conexión — podés seguir cargando producción; se enviará al reconectar.'); });
  upd();
}
setupConnectivity();

/* ---- en móvil: arrancar en Producción (el Gantt está oculto) ---- */
function applyMobileDefault(){
  if(!IS_MOBILE) return;
  activarVistaMobil('prod');                 // asegura que quede en Producción
  if(window.ProduccionView) window.ProduccionView.abrir();
}

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
    const v=e.target.value;
    // las acciones no son obras: devolver el selector a la obra actual
    if(v==='__new__'||v==='__dup__'||v==='__del__'){
      e.target.value=ObraAPI.getObraId();
      if(v==='__new__') openNuevaObra();
      else if(v==='__dup__') openDuplicarObra();
      else openEliminarObra();
      return;
    }
    try{ await cambiarObra(v); }catch(err){ toast('Error: '+err.message); }
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

  /* ---- Bloque 5: PINTAR PRIMERO, PREGUNTAR DESPUÉS ----
     Medido en producción: whoami 750 ms + listObras 1.135 ms + getObra 9.247 ms
     ≈ 11 s de pantalla vacía en cada arranque. Y el piso no baja: whoami casi
     no hace nada y aun así tarda 750 ms, porque el costo es el viaje a Apps
     Script, no el trabajo.
     Así que mostramos el último snapshot guardado en el dispositivo (~50 ms) y
     revalidamos contra el servidor por detrás. */
  let pintadoLocal=false;
  if(window.LocalStore){
    try{
      const oidPrev=ObraAPI.getObraId();
      const snap=oidPrev ? await LocalStore.leerObra(oidPrev) : null;
      if(snap && snap.data && (snap.data.items||[]).length){
        reloadModel(snap.data);
        pintadoLocal=true;
        $('#saveTxt').textContent='Local · actualizando…';
        applyMobileDefault();
      }
    }catch(e){}
    refrescarEstadoSync();
  }

  if(!pintadoLocal) $('#saveTxt').textContent='Conectando…';
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
        + (esAdmin?`<option value="__new__">＋ Nueva obra…</option>`
                  +`<option value="__dup__">⧉ Duplicar esta obra…</option>`
                  +`<option value="__del__">🗑 Eliminar esta obra…</option>`:'');
    }
    // obra guardada si sigue permitida; si no, la primera de la lista
    let target=ObraAPI.getObraId();
    if(!obras.some(o=>String(o.obra_id)===String(target))) target=obras[0].obra_id;
    ObraAPI.setObraId(target);
    if(sel) sel.value=target;

    /* Si quedó trabajo sin subir de una sesión anterior, se sube ANTES de leer.
       Si no, el servidor nos devolvería una versión anterior a lo que el
       usuario ya dio por guardado, y se lo pisaríamos en pantalla. */
    if(window.LocalStore){
      const pend=await LocalStore.pendientes();
      if(pend.length){
        $('#saveTxt').textContent='Subiendo '+pend.length+' cambio(s) pendiente(s)…';
        await LocalStore.sincronizar();
        await refrescarEstadoSync();
      }
    }

    const data=await ObraAPI.getObra(target);
    // No pisar al usuario si ya empezó a editar sobre lo pintado desde local.
    if(dirty.items||dirty.weekly||dirty.cats){
      toast('Llegaron datos del servidor, pero tenés cambios sin guardar: se conserva lo que ves.');
    } else {
      reloadModel(data);
    }
    if(window.LocalStore) LocalStore.guardarObra(target, data);   // snapshot para el próximo arranque
    await refrescarEstadoSync();
    toast((pintadoLocal?'Actualizado':'Conectado')+' · <b>'+ITEMS.length+'</b> ítems desde Drive');
    applyMobileDefault();                 // en móvil, abrir Producción
    if(window.Outbox && navigator.onLine) window.Outbox.flush();   // cola de producción
  }catch(err){
    ONLINE=false;
    if(String(err.message)==='auth_required'){
      $('#saveTxt').textContent='Sesión requerida';
      return;                                   // el overlay de login ya está visible
    }
    chip.classList.add('err');
    if(pintadoLocal){
      // Ya hay datos reales en pantalla desde IndexedDB: NO los borramos.
      // El usuario puede seguir trabajando y todo se sube al reconectar.
      $('#saveTxt').textContent='Sin conexión · trabajando local';
      toast('Sin conexión. Estás viendo la última versión guardada en este equipo; podés seguir trabajando.');
    } else {
      $('#saveTxt').textContent='Sin conexión';
      reloadModel(window.OBRA_DATA||null);
      toast('No se pudo conectar al backend: '+err.message+' — trabajando local');
    }
    applyMobileDefault();                 // en móvil, abrir Producción igual
  }
}
