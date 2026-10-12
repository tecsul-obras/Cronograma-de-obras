export const SOURCES = {
  DNCP: {name:'DNCP',url:'https://www.contrataciones.gov.py/buscador/licitaciones.html?etapas_licitacion%5B0%5D=CONV'},
  ITAIPU: {name:'ITAIPÚ',url:'https://compras.itaipu.gov.py/portal/Mural.aspx'},
  PTI: {name:'PTI',url:'https://pp.pti.org.py/process'},
  OEI: {name:'OEI Paraguay',url:'https://oei.int/licitaciones-y-convocatorias/?office%5B%5D=65'}
};
export function clean(s='') {
 return String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#039;/g,"'").replace(/&ndash;|&mdash;/g,'–').replace(/\s+/g,' ').trim();
}
export const norm=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function csvParse(text) {
 const rows=[];let row=[],v='',q=false;
 for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){v+='"';i++;}else q=!q;}else if(c===';'&&!q){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x))rows.push(row);row=[];v='';}else v+=c;}
 if(v||row.length){row.push(v);rows.push(row);}const head=rows.shift().map(x=>x.replace(/^\uFEFF/,''));return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]||''])));
}
export function isoDate(s) {
 if(!s)return null;s=clean(s);if(/^\d{4}-\d{2}-\d{2}/.test(s)){if(/[zZ]$|[+-]\d\d:\d\d$/.test(s))return new Date(s).toISOString();return s.slice(0,10)+'T'+(s.slice(11,19)||'23:59:59')+'-03:00';}
 const ms=s.replace(/\\\//g,'/').match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);if(ms)return new Date(+ms[1]).toISOString();
 let m=s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);let month,day,year;
 if(m){day=m[1];month=m[2];year=m[3];}else{m=norm(s).match(/(\d{1,2})\s*(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?|dez(?:embro)?)\.?\s*(?:de\s+)?(\d{4})/);if(!m)return null;day=m[1];month=({ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,set:9,oct:10,nov:11,dic:12,dez:12})[m[2].slice(0,3)];year=m[3];}
 const t=s.match(/\b(\d{1,2}):(\d{2})/);const time=t?`${t[1].padStart(2,'0')}:${t[2]}:00`:'23:59:59';const d=`${year}-${String(month).padStart(2,'0')}-${day.padStart(2,'0')}T${time}-03:00`;return Number.isNaN(Date.parse(d))?null:d;
}
export function money(s){s=clean(s);const m=s.match(/(?:Gs\.?|₲|PYG|US\$|USD|R\$|BRL|EUR|€)\s*([\d][\d.,]*)/i);if(!m)return {amount:null,currency:null,amountState:'unpublished'};let n=m[1];if(n.includes(','))n=n.replace(/\./g,'').replace(',','.');else if(/\.\d{3}(?:\.|$)/.test(n))n=n.replace(/\./g,'');return {amount:Number(n),currency:/USD|US\$/i.test(m[0])?'USD':/R\$|BRL/i.test(m[0])?'BRL':/€|EUR/i.test(m[0])?'EUR':'PYG',amountState:'known'};}
export function classify(title,category=''){
 const s=norm(title);if(/fiscaliz|consultor|topograf|proyecto ejecutivo|diseno|estudio|supervision/.test(s)&&!/(?:ejecucion|construccion|suministro e instalacion)/.test(s))return 'ingenieria';
 if(/climatiza|aire acondicionado|ascensor|informat|software|vehicul|equipo|generador|motor|electromec|fotovolta|computador/.test(s)&&!/(?:construccion de|obras de|infraestructura educativa)/.test(s))return 'otros';
 if(/constru|refaccion|paviment|empedrad|alcantarill|desague|saneamiento|mamposter|edific|aula|techo|ruta|vial|vereda|muralla|puente|reacondicionamiento|tinglado|muro|agua potable|infraestructura|albanil|polideportivo/.test(s))return 'obras';
 return category.startsWith('720')?'mantenimiento':'otros';
}
function rowBase(source,process,title,url,deadline,publication=null){return {id:source+':'+process,source,process:String(process),title:clean(title),url,deadline,publication,entity:SOURCES[source].name,category:'',scope:classify(title),status:'Abierta',amount:null,currency:null,amountState:'pending',checkedAt:new Date().toISOString()};}
export function parseDNCP(text){const rows=csvParse(text);if(!rows.length||!('nro_licitacion' in rows[0]))throw Error('El formato del listado DNCP cambió.');return rows.filter(x=>x._etapa_licitacion==='CONV'&&x.convocatoria_slug).map(x=>({...rowBase('DNCP',x.nro_licitacion,x.nombre_licitacion,'https://www.contrataciones.gov.py/licitaciones/convocatoria/'+x.convocatoria_slug+'.html',isoDate(x.fecha_entrega_oferta),isoDate(x.fecha_publicacion_convocatoria)),entity:x.convocante,category:x.categoria,procedure:x.tipo_procedimiento,scope:classify(x.nombre_licitacion,x.categoria),status:x.etapa_licitacion,location:x.geo||null}));}
export function parseOEI(text){const links=[...text.matchAll(/<a\b[^>]*class="contracting__lite[^>]*>[\s\S]*?<\/a>/g)];if(!links.length)throw Error('No se reconoció el listado OEI.');return links.map(m=>{const s=m[0];let u=s.match(/href="([^"]+)"/)?.[1];if(!u?.includes('/paraguay/'))return null;let label=clean(s);if(!/En presentaci[oó]n/i.test(label))return null;let ref=label.match(/Ref\.\s*(.*?)\s*·/)?.[1]||s.match(/data-id="([^"]+)"/)?.[1];let title=s.match(/data-title="([^"]+)"/)?.[1]||ref;let d=clean(s.match(/class="__col __date[^>]*>([\s\S]*?)<\/div>/)?.[1]);return rowBase('OEI',ref,title,u,isoDate(d));}).filter(Boolean);}
// PTI encodes local wall-clock times with Z; its portal renders these with utc().
function ptiDate(value){return value?isoDate(String(value).replace(/Z$/,'-03:00')):null;}
export function parsePTI(processes){
 if(!Array.isArray(processes)||processes.some(p=>!p.processId||!p.code||!p.processStatusAcronym))throw Error('El formato del portal de procesos PTI cambió.');
 return processes.filter(p=>p.processStatusAcronym==='EC').map(p=>{
 const title=clean(p.description);
 return {...rowBase('PTI',p.code,title,'https://pp.pti.org.py/process/'+p.processId+'/details',ptiDate(p.presentationOfferEndDate),ptiDate(p.publishDate)),status:clean(p.processStatusDescription),procedure:clean(p.processModeDescription),amountState:'unpublished',location:clean(p.firstLocationOpeningDescription),portalProcessId:p.processId};
 });
}
export function parseITAIPU(data){let rows=data.d;if(typeof rows==='string')rows=JSON.parse(rows);if(!Array.isArray(rows))throw Error('El formato de ITAIPÚ cambió.');return rows.map(x=>{const title=clean(x.sDsObjeto||x.sDsTitulo);const process=x.sNrProcessoDisplay||x.sNrEdital||x.sNrProcesso||x.sDsProcesso||x.nCdProcesso;const deadline=isoDate(x.tDtFinal);const state=clean(x.sDsSituacao);if(/cancel|suspend|encerrad|homolog|adjudic|anulad|desiert|desert|revog|fracas|cerrad|evaluaci/i.test(state))return null;return {...rowBase('ITAIPU',process,title,'https://compras.itaipu.gov.py/portal/Mural.aspx?nCdModulo='+x.nCdModulo+'&sDsProcesso='+encodeURIComponent(process)+'&nCdProcesso='+x.nCdProcesso,deadline,isoDate(x.tDtInicial)),entity:clean(x.sNmEmpresa||'ITAIPÚ Binacional'),status:state||'En curso',amountState:'unpublished',procedure:clean(x.sNmModalidadeTipo||x.sNmModalidade),country:'Paraguay'};}).filter(Boolean);}
export function detailsDNCP(text){const raw=text.match(/Monto Estimado\s*<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/i)?.[1];if(raw===undefined&&!/Datos de la Licitaci|Datos de la Convocatoria|Nombre de la Licitaci/i.test(clean(text)))throw Error('Respuesta de convocatoria no reconocida.');return {...money(raw||''),amountCheckedAt:new Date().toISOString()};}
export function detailsOEI(text){let fields={};for(const m of text.matchAll(/<div class="__double_list_item">([\s\S]*?)<\/div>/g)){let label=clean(m[1].match(/class="__title[^>]*>([\s\S]*?)<\/span>/)?.[1]);let value=clean(m[1].match(/class="__text[^>]*>([\s\S]*?)<\/span>/)?.[1]);fields[label]=value;}const title=clean(text.match(/class="__abstract">([\s\S]*?)<\/div>/)?.[1]);return {...money(fields['Valor estimado']||fields['Importe de referencia / Presupuesto base']||''),publication:isoDate(fields['Fecha inicio']),deadline:isoDate(fields['Fecha entrega']||fields['Fecha finalización']),title,scope:classify(title),location:fields['Localidad'],procedure:fields['Tipo de procedimiento'],amountCheckedAt:new Date().toISOString()};}
async function publicFetch(url,init={}){let r=await fetch(url,{...init,signal:AbortSignal.timeout(22000),headers:{'User-Agent':'RadarLicitaciones/1.0 (consulta de fuentes publicas)','Accept':'text/html,application/json,text/csv;q=0.9',...init.headers}});if(!r.ok)throw Error('La fuente respondió HTTP '+r.status);return r;}
export async function collect(source){
 if(source==='DNCP'){let r=await publicFetch('https://www.contrataciones.gov.py/buscador/licitaciones.csv?etapas_licitacion%5B0%5D=CONV');return {records:parseDNCP(await r.text()),coverage:'Listado completo de convocatorias DNCP. Clasificación automática por categoría y objeto.'};}
 if(source==='OEI'){const records=parseOEI(await (await publicFetch(SOURCES.OEI.url)).text());await Promise.all(records.slice(0,15).map(async row=>{try{Object.assign(row,detailsOEI(await (await publicFetch(row.url)).text()));}catch{}}));return {records,coverage:'Últimos 20 procesos de OEI Paraguay; solo en presentación. Revisar adendas en la fuente.'};}
 if(source==='PTI'){let r=await publicFetch('https://pp.pti.org.py/api/public/process');return {records:parsePTI(await r.json()),coverage:'Listado completo del portal público PTI; procesos en convocatoria. Fecha límite de presentación del calendario vigente del portal, en horario Paraguay. Verificar documentos y adendas en el enlace oficial.'};}
 if(source==='ITAIPU'){
 const dto={nAnoFinalizacao:0,tmpTipoMuralProcesso:4,nCdModulo:0,nCdModalidade:0,nCdModalidadeFase:0,nCdTipoModalidade:0,tmpTipoMuralVisao:0,nCdSituacao:0,nCdTipoProcesso:998,nCdEmpresa:0,sNrProcesso:'',nCdProcesso:0,sDsObjeto:'',sDtPeriodoDe:'',sDtPeriodoAte:'',sOrdenarPor:'TDTINICIAL',sOrdenarPorDirecao:'DESC',dtoPaginacao:{nPaginaDe:1,nPaginaAte:100},dtoIdioma:{nCdIdioma:4}};
 let r=await publicFetch('https://compras.itaipu.gov.py/portal/WebService/Servicos.asmx/PesquisarProcessosPorSituacoesAgrupadas',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({dtoProcesso:dto})});let json=await r.json();let records=parseITAIPU(json);return {records,coverage:'Últimos 100 procesos de la margen paraguaya, descartando estados cerrados y en evaluación. Los montos estimados no se exponen en el mural público.'};}
 throw Error('Fuente no admitida');
}
export async function enrich(rows){return await Promise.all(rows.map(async row=>{try{return {id:row.id,...detailsDNCP(await (await publicFetch(row.url)).text())};}catch(e){return {id:row.id,amountState:'pending',amountError:e.message};}}));}
