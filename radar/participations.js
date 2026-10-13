'use strict';
(function(){
 const {states,kpis,filtered}=window.RadarDomain;
 let filter={source:'all',from:'',to:'',query:''},message='Cargando participaciones…',loading=false;
 const percent=n=>n===null?'—':n.toLocaleString('es-PY',{maximumFractionDigits:1})+'%';
 // Licitaciones privadas: se cargan a mano (origen PRIV) y entran al mismo seguimiento y KPI.
 const pnames=Object.assign({},names,{PRIV:'Privada'});
 const abiertas=p=>['interested','preparing'].includes(p.stage);
 const DIA=86400000;
 function aLocal(iso){if(!iso)return '';const f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).reduce((o,x)=>(o[x.type]=x.value,o),{});return f.year+'-'+f.month+'-'+f.day+'T'+f.hour+':'+f.minute;}
 function deLocal(v){return v?v+':00-03:00':null;}
 // días de calendario (hora de Paraguay) entre hoy y la fecha: «mañana» es mañana aunque falten 20 h
 function diasA(iso){if(!iso)return null;const d=s=>Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10));return Math.round((d(aLocal(iso))-d(aLocal(new Date().toISOString())))/DIA);}
 function cuando(n){return n<0?'venció':n===0?'hoy':n===1?'mañana':'en '+n+' días';}
 function cierre(p){
  const d=p.record.deadline;if(!d)return '<span class="time cierre">Cierre: sin fecha</span>';
  const n=diasA(d),cls=abiertas(p)?(n<0?' vencido':n<=7?' pronto':''):'';
  return '<span class="time cierre'+cls+'">Cierre: '+date(d)+(d.includes('23:59:59')?'':' '+time(d))+(abiertas(p)?' · '+cuando(n):'')+'</span>';
 }
 function proximas(){
  const l=participationRecords.filter(p=>abiertas(p)&&p.record.deadline&&Date.parse(p.record.deadline)>=Date.now()-DIA).sort((a,b)=>a.record.deadline.localeCompare(b.record.deadline)).slice(0,6);
  if(!l.length)return '';
  return '<div class="proximas"><h3>Próximas presentaciones</h3><ul>'+l.map(p=>{const n=diasA(p.record.deadline);return '<li><span class="cuenta'+(n<=7?' pronto':'')+'">'+cuando(n)+'</span>'+badge(p.record)+'<button class="t-title" data-part-edit="'+safe(p.id)+'">'+safe(p.record.title)+'</button><span class="quien">'+safe(p.record.entity||'')+' · '+date(p.record.deadline)+(p.record.deadline.includes('23:59:59')?'':' '+time(p.record.deadline))+' · '+safe(states[p.stage])+'</span></li>';}).join('')+'</ul></div>';
 }
 function rows(){return filtered(participationRecords,filter).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 function render(){
  $('navParticipations').textContent=participationRecords.length;
  const r=rows(),k=kpis(r),panel=$('participationPanel');
  panel.innerHTML='<div class="panel-top"><div><h2>Seguimiento del equipo</h2><p>Se conserva aunque el llamado cierre o deje de aparecer en la fuente.</p></div><span class="part-actions"><button class="primary" id="newPrivate" '+(!radarUser?.canWrite?'disabled':'')+'>＋ Licitación privada</button><button class="outline" id="newParticipation" '+(!radarUser?.canWrite?'disabled':'')+'>＋ Proceso anterior (portal)</button></span><button class="outline" id="reloadParticipations" '+(loading?'disabled':'')+'>↻ Recargar</button></div>'+
  '<p class="notice">'+safe(message)+'</p><div class="participation-filters"><label>Fuente<select id="pSource">'+['all','public',...Object.keys(pnames)].map(s=>'<option value="'+s+'" '+(filter.source===s?'selected':'')+'>'+(s==='all'?'Todas':s==='public'?'Públicas (portales)':s==='PRIV'?'Privadas':pnames[s])+'</option>').join('')+'</select></label><label>Desde<input id="pFrom" type="date" value="'+safe(filter.from)+'"></label><label>Hasta<input id="pTo" type="date" value="'+safe(filter.to)+'"></label><label>Buscar<input id="pQuery" type="search" value="'+safe(filter.query)+'" placeholder="Proceso, cliente, responsable…"></label><button class="outline" id="pExport">↓ Exportar CSV</button><button class="outline" id="pBackup">↓ Respaldo JSON</button></div>'+
  '<section class="stats participation-stats"><article><span class="stat-label">EN SEGUIMIENTO</span><strong>'+k.total+'</strong><span class="stat-note">'+k.preparing+' de interés / en preparación'+(()=>{const c=r.filter(p=>abiertas(p)&&p.record.deadline&&diasA(p.record.deadline)>=0&&diasA(p.record.deadline)<=7).length;return c?' · <b class="pronto">'+c+' cierran en 7 días</b>':'';})()+'</span></article><article><span class="stat-label">GANADAS</span><strong>'+k.won+' <small>'+percent(k.winRate)+'</small></strong><span class="stat-note">de '+k.decided+' ofertas con resultado</span></article><article><span class="stat-label">PERDIDAS</span><strong>'+k.lost+' <small>'+percent(k.lossRate)+'</small></strong><span class="stat-note">de '+k.decided+' ofertas con resultado</span></article><article><span class="stat-label">ESPERANDO RESULTADO</span><strong>'+k.pending+'</strong><span class="stat-note">ofertas presentadas</span></article></section>'+
  '<div class="outcome-bar '+(k.decided?'':'no-decisions')+'" role="img" aria-label="Ganadas '+percent(k.winRate)+', perdidas '+percent(k.lossRate)+'"><span style="width:'+(k.winRate??0)+'%"></span></div><p class="tiny">Ganadas % = ganadas ÷ (ganadas + perdidas). Se excluyen pendientes, retiradas, canceladas y desiertas. El período filtra por fecha de resultado; para las pendientes, por presentación; para las de interés, por creación.</p>'+proximas()+
  (r.length?'<div class="table-wrap"><table class="participation-table"><thead><tr><th>Proceso / objeto</th><th>Estado</th><th>Responsable</th><th>Cierre · presentación · resultado</th><th>Oferta propia</th><th>Seguimiento</th></tr></thead><tbody>'+r.map(p=>'<tr><td>'+badge(p.record)+'<span class="process">'+safe(p.record.process)+'</span><button class="t-title" data-part-edit="'+safe(p.id)+'">'+safe(p.record.title)+'</button></td><td><span class="stage stage-'+p.stage+'">'+safe(states[p.stage])+'</span></td><td>'+safe(p.owner||'Sin asignar')+'</td><td>'+cierre(p)+'<span class="date">'+(p.submittedDate?'Presentada: '+date(p.submittedDate+'T12:00:00-03:00'):'Sin presentar')+'</span><span class="time">Resultado: '+(p.resultDate?date(p.resultDate+'T12:00:00-03:00'):'Pendiente')+'</span></td><td class="amount">'+(p.offerAmount===null?'Sin registrar':money({amount:p.offerAmount,currency:p.offerCurrency}))+'</td><td><button class="outline" data-part-edit="'+safe(p.id)+'">Abrir / editar</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty"><h3>No hay participaciones en esta vista</h3><p>Abrí una licitación o un favorito y tocá Registrar participación, o cargá una licitación privada con «＋ Licitación privada». También podés ampliar los filtros de este seguimiento.</p></div>');
  $('reloadParticipations').onclick=load;$('newParticipation').onclick=manual;$('newPrivate').onclick=nuevaPrivada;
  for(const [id,key]of Object.entries({pSource:'source',pFrom:'from',pTo:'to',pQuery:'query'}))$(id).onchange=e=>{filter[key]=e.target.value;render();};
  $('pExport').onclick=exportCSV;$('pBackup').onclick=()=>download('participaciones-tecsul-'+ymd(new Date().toISOString())+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),records:participationRecords},null,2),'application/json');
  panel.querySelectorAll('[data-part-edit]').forEach(b=>b.onclick=()=>{let p=participationRecords.find(p=>p.id===b.dataset.partEdit);edit(p.record);});
 }
 async function load(){if(loading)return;loading=true;if(tab==='participations')render();try{const result=await api('/api/participations');radarUser=result.user;participationRecords=result.records;message='Datos compartidos · '+radarUser.user+' · '+(radarUser.canWrite?'Podés editar':'Solo lectura');}catch(e){message=e.message;}finally{loading=false;if(tab==='participations')render();$('navParticipations').textContent=participationRecords.length;}}
 function nuevaPrivada(){edit({id:'',source:'PRIV',process:'',title:'',entity:'',url:'',amount:null,currency:'PYG',amountState:'unpublished',deadline:null,publication:null,scope:'obras',location:'',checkedAt:new Date().toISOString()});}
 async function edit(record){
  try{const current=await api('/api/participations');participationRecords=current.records;radarUser=current.user;}catch(e){toast(e.message);return;}
  closeDetail();
  const p=participationRecords.find(p=>p.id===record.id)||{record,stage:'interested',owner:'',submittedDate:'',resultDate:'',offerAmount:null,offerCurrency:record.currency||'PYG',awardedAmount:null,winner:'',reason:'',notes:notes[record.id]||'',rev:0,history:[]};
  const field=(id,label,type,value,extra='')=>'<label>'+label+'<input id="'+id+'" type="'+type+'" '+(type==='number'?'min="0" step="any"':'')+' value="'+safe(value??'')+'" '+extra+'></label>';
  const priv=record.source==='PRIV',nueva=priv&&!p.rev,rc=p.record;
  const privHtml=priv?'<fieldset class="priv-fields"><legend>Datos de la licitación privada</legend><div class="participation-form">'+
   field('vEntity','Cliente / contratante *','text',rc.entity,'required maxlength="500"')+
   field('vProcess','Referencia interna','text',rc.process,(nueva?'maxlength="120" placeholder="Opcional: se genera sola"':'readonly title="La referencia no cambia una vez guardada"'))+
   '<label class="full">Objeto / obra *<input id="vTitle" type="text" required maxlength="4000" value="'+safe(rc.title)+'"></label>'+
   field('vDeadline','Fecha y hora límite de presentación','datetime-local',aLocal(rc.deadline))+
   field('vPublication','Fecha de invitación','date',rc.publication?rc.publication.slice(0,10):'')+
   field('vAmount','Presupuesto estimado del cliente','number',rc.amount)+
   '<label>Moneda del presupuesto<select id="vCurrency">'+['PYG','USD','BRL','EUR'].map(c=>'<option '+((rc.currency||'PYG')===c?'selected':'')+'>'+c+'</option>').join('')+'</select></label>'+
   field('vLocation','Ubicación','text',rc.location,'maxlength="300"')+
   field('vUrl','Enlace o carpeta (opcional)','url',rc.url,'placeholder="https://…"')+
   '</div><p class="tiny">Estos datos se pueden corregir después (por ejemplo, si el cliente cambia la fecha de entrega).</p></fieldset>':'';
  modal('<h2>'+(nueva?'Nueva licitación privada':'Participación · '+safe(record.process))+'</h2>'+(nueva?'<p>Cargala para darle seguimiento: fecha de presentación, oferta y resultado. Cuenta en los KPI igual que las públicas.</p>':'<p>'+badge(rc)+' '+safe(rc.title)+(priv&&rc.entity?' · '+safe(rc.entity):'')+'</p>')+'<p class="tiny">Interés y preparación no cuentan como ofertas ganadas o perdidas.</p><form id="participationForm">'+privHtml+'<div class="participation-form"><label>Estado<select id="pStage">'+Object.entries(states).map(([s,label])=>'<option value="'+s+'" '+(p.stage===s?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+field('pOwner','Responsable','text',p.owner)+field('pSubmitted','Fecha de presentación','date',p.submittedDate)+field('pResult','Fecha del resultado','date',p.resultDate)+field('pOffer','Monto de nuestra oferta','number',p.offerAmount)+'<label>Moneda<select id="pCurrency">'+['PYG','USD','BRL','EUR'].map(c=>'<option '+(p.offerCurrency===c?'selected':'')+'>'+c+'</option>').join('')+'</select></label>'+field('pAwarded','Monto adjudicado (misma moneda)','number',p.awardedAmount)+field('pWinner','Empresa adjudicada','text',p.winner)+'</div><label class="note-label">Motivo del resultado<textarea id="pReason">'+safe(p.reason)+'</textarea></label><label class="note-label">Notas del equipo<textarea id="pNotes">'+safe(p.notes)+'</textarea></label><p id="pError" class="form-error" role="alert"></p><button class="primary" id="pSave" type="submit" '+(!radarUser?.canWrite?'disabled':'')+'>Guardar seguimiento compartido</button></form><h3>Historial de cambios</h3><ol class="participation-history">'+(p.history||[]).slice().reverse().map(h=>'<li>'+date(h.at)+' · '+time(h.at)+' · '+safe(h.by)+' · '+safe(states[h.to])+' · rev. '+h.revision+'</li>').join('')+'</ol>');
  if(!radarUser?.canWrite)$('pError').textContent='Necesitás una sesión con permiso de edición. Abrí Participaciones / KPI y recargá.';
  function validation(){const stage=$('pStage').value;$('pSubmitted').required=['submitted','won','lost'].includes(stage);$('pResult').required=['won','lost'].includes(stage);$('pResult').min=$('pSubmitted').value;}
  $('pStage').onchange=validation;$('pSubmitted').onchange=validation;validation();
  $('participationForm').onsubmit=async e=>{
   e.preventDefault();const button=$('pSave');button.disabled=true;$('pError').textContent='';
   let rec=p.record;
   if(priv){
    const ref=(nueva?$('vProcess').value.trim():rc.process)||('PRIV-'+new Date().getFullYear()+'-'+Date.now().toString(36).slice(-5).toUpperCase());
    const est=$('vAmount').value;
    rec=Object.assign({},rc,{id:'PRIV:'+ref,source:'PRIV',process:ref,title:$('vTitle').value.trim(),entity:$('vEntity').value.trim(),deadline:deLocal($('vDeadline').value),publication:$('vPublication').value?$('vPublication').value+'T12:00:00-03:00':null,amount:est===''?null:Number(est),currency:$('vCurrency').value,amountState:est===''?'unpublished':'known',location:$('vLocation').value.trim(),url:$('vUrl').value.trim(),scope:'obras',checkedAt:new Date().toISOString()});
    if(nueva&&participationRecords.some(x=>x.id===rec.id)){$('pError').textContent='Ya existe una licitación privada con la referencia «'+ref+'». Usá otra o dejala vacía.';button.disabled=false;return;}
   }
   const input={id:rec.id,record:rec,rev:p.rev,stage:$('pStage').value,owner:$('pOwner').value,submittedDate:$('pSubmitted').value,resultDate:$('pResult').value,offerAmount:$('pOffer').value,offerCurrency:$('pCurrency').value,awardedAmount:$('pAwarded').value,winner:$('pWinner').value,reason:$('pReason').value,notes:$('pNotes').value};
   try{const result=await api('/api/participations',input);participationRecords=participationRecords.filter(r=>r.id!==input.id);participationRecords.push(result.record);$('infoDialog').close();toast('Participación guardada para el equipo.');if(tab==='participations')render();$('navParticipations').textContent=participationRecords.length;}
   catch(error){$('pError').textContent=error.message+(error.conflict?' Tus cambios siguen en el formulario; copialos antes de cerrar y recargar.':'');button.disabled=false;}
  };
 }
 function manual(){
  modal('<h2>Registrar proceso anterior</h2><p>Para una licitación histórica que ya no aparece en las fuentes.</p><form id="manualForm"><div class="participation-form"><label>Fuente<select id="mSource">'+Object.entries(names).map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label><label>N.º de proceso<input id="mProcess" required maxlength="150"></label><label>Objeto<input id="mTitle" required maxlength="4000"></label><label>Entidad<input id="mEntity" maxlength="500"></label><label>Enlace oficial (opcional)<input id="mUrl" type="url" placeholder="https://…"></label></div><button type="submit" class="primary">Continuar con el seguimiento</button></form>');
  $('manualForm').onsubmit=e=>{e.preventDefault();const source=$('mSource').value,process=$('mProcess').value.trim();if(!process||!$('mTitle').value.trim())return;const record={id:source+':'+process,source,process,title:$('mTitle').value.trim(),entity:$('mEntity').value.trim()||names[source],url:$('mUrl').value.trim(),amount:null,currency:null,amountState:'unpublished',deadline:null,publication:null,scope:'otros',checkedAt:new Date().toISOString()};$('infoDialog').close();edit(record);};
 }
 function exportCSV(){const data=rows(),header=['Fuente','Proceso','Objeto','Cliente / entidad','Cierre','Estado','Responsable','Fecha presentación','Fecha resultado','Oferta','Moneda','Adjudicado','Adjudicatario','Motivo','Notas'];const csv=[header,...data.map(p=>[pnames[p.record.source]||p.record.source,p.record.process,p.record.title,p.record.entity||'',p.record.deadline?aLocal(p.record.deadline).replace('T',' '):'',states[p.stage],p.owner,p.submittedDate,p.resultDate,p.offerAmount??'',p.offerCurrency,p.awardedAmount??'',p.winner,p.reason,p.notes])].map(a=>a.map(v=>'"'+String(/^\s*[=+\-@]/.test(String(v))?"'"+v:v).replace(/"/g,'""')+'"').join(';')).join('\r\n');download('participaciones-tecsul-'+ymd(new Date().toISOString())+'.csv','\uFEFF'+csv,'text/csv;charset=utf-8');}
 window.RadarParticipations={render,load,edit,nuevaPrivada};
 // Cargar a pedido; evita una llamada al servidor por cada apertura del iframe.
})();
