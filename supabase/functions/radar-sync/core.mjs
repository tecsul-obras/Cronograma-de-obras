import {SOURCES,collect,enrich} from './sources.mjs';
const empty=s=>({records:[],coverage:'Aún sin consultar.',url:SOURCES[s].url,checkedAt:null,error:null});
function checked(result){if(result.error)throw Error(result.error.message);return result.data;}
async function state(admin,source){const data=checked(await admin.from('radar_sources').select('payload').eq('source',source).maybeSingle());return data?.payload||empty(source);}
async function withLease(admin,source,work){
 const lease=checked(await admin.rpc('radar_claim_source',{p_source:source}));
 if(!lease)throw Object.assign(Error('Esta fuente ya se está actualizando. Reintentá en unos minutos.'),{status:409});
 const old=await state(admin,source);
 const value=await work(old);
 checked(await admin.rpc('radar_publish_source',{p_source:source,p_token:lease,p_payload:value}));
 return value;
}
export async function syncSource(admin,source){
 if(!SOURCES[source])throw Object.assign(Error('Fuente inválida.'),{status:400});
 return withLease(admin,source,async previous=>{
  try{
   const result=await collect(source),old=new Map(previous.records.map(r=>[r.id,r]));
   for(const r of result.records){const p=old.get(r.id);if(source==='DNCP'&&p)for(const k of ['amount','currency','amountState','amountCheckedAt','amountAttemptAt','amountError'])r[k]=p[k]??r[k];}
   return {...result,url:SOURCES[source].url,error:null,checkedAt:new Date().toISOString(),lastAttemptAt:new Date().toISOString()};
  }catch(e){return {...previous,error:e.message,lastAttemptAt:new Date().toISOString()};}
 });
}
export async function syncAmounts(admin,ids=null){
 if(ids!==null&&(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string')))throw Object.assign(Error('Enviá hasta 20 IDs DNCP.'),{status:400});
 return withLease(admin,'DNCP',async previous=>{
  const wanted=ids===null?previous.records.filter(r=>r.deadline&&Date.parse(r.deadline)>Date.now()&&['obras','ingenieria','mantenimiento'].includes(r.scope)&&(!r.amountAttemptAt||Date.now()-Date.parse(r.amountAttemptAt)>86400000)&&(!r.amountCheckedAt||Date.now()-Date.parse(r.amountCheckedAt)>86400000)).slice(0,16):previous.records.filter(r=>ids.includes(r.id));
  const results=await enrich(wanted),changes=new Map(results.map(r=>[r.id,r]));
  return {...previous,records:previous.records.map(r=>changes.has(r.id)?{...r,...changes.get(r.id),amountAttemptAt:new Date().toISOString()}:r)};
 });
}
export async function sameSecret(provided,expected){
 if(!expected||expected.length<24||expected.includes('REEMPLAZAR')||!provided)return false;
 const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [a,b]=await Promise.all([hash(provided),hash(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
// createClient y env inyectables para probar sin tocar la base de producción.
export function handler(createClient,env){return async req=>{
 const origin=env.RADAR_ALLOWED_ORIGIN||'https://tecsul-obras.github.io';
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-radar-cron','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json;charset=utf-8'};
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:cors});
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return reply({error:'Origen no permitido.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Usar POST.'},405);
 try{
  const raw=await req.text();if(raw.length>10000)return reply({error:'Solicitud demasiado grande.'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'JSON inválido.'},400);}
  if(!body||typeof body!=='object')return reply({error:'Solicitud inválida.'},400);
  const cron=body.action==='cron_refresh'||body.action==='cron_enrich';
  if(cron){if(!await sameSecret(req.headers.get('x-radar-cron'),env.RADAR_CRON_SECRET))return reply({error:'Acceso programado no autorizado.'},401);}
  else{
   const authorization=req.headers.get('Authorization')||'';
   if(!/^Bearer\s+\S+$/i.test(authorization))return reply({error:'Iniciá sesión en el Cronograma.'},401);
   const token=authorization.replace(/^Bearer\s+/i,'');
   const userClient=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await userClient.auth.getUser(token);
   if(auth.error||!auth.data.user)return reply({error:'La sesión venció. Volvé a ingresar.'},401);
   // Actualizar fuentes solo lee portales públicos: alcanza con poder ver el Radar (gerentes incluidos).
   const access=await userClient.rpc('radar_access',{p_write:false});
   if(access.error||access.data!==true)return reply({error:'Sin acceso al Radar de licitaciones.'},403);
   if(!['refresh','enrich'].includes(body.action))return reply({error:'Acción inválida.'},400);
  }
  const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const source=body.action==='refresh'||body.action==='cron_refresh'?body.source:'DNCP';
  const result=body.action==='refresh'||body.action==='cron_refresh'?await syncSource(admin,source):await syncAmounts(admin,cron?null:body.ids);
  return reply({ok:true,source,records:result.records.length,checkedAt:result.checkedAt,error:result.error});
 }catch(e){return reply({error:e.status?e.message:'No se pudo completar la actualización. Revisá los logs del Radar y reintentá.'},e.status||500);}
};}
