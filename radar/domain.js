(function(root){
  'use strict';
  const states={interested:'Nos interesa',preparing:'Preparando oferta',submitted:'Oferta presentada',won:'Ganada',lost:'Perdida',withdrawn:'Retirada / no presentada',cancelled:'Cancelada / desierta'};
  function kpis(rows){
    const won=rows.filter(r=>r.stage==='won').length,lost=rows.filter(r=>r.stage==='lost').length,decided=won+lost;
    return {total:rows.length,won,lost,decided,pending:rows.filter(r=>r.stage==='submitted').length,preparing:rows.filter(r=>['interested','preparing'].includes(r.stage)).length,winRate:decided?won/decided*100:null,lossRate:decided?lost/decided*100:null};
  }
  function filtered(rows,filter){return rows.filter(r=>{
    const d=(['won','lost'].includes(r.stage)?r.resultDate:'')||r.submittedDate||r.createdAt.slice(0,10);
    const text=[r.record.process,r.record.title,r.record.entity,r.owner,r.reason].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const q=String(filter.query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return (!filter.source||filter.source==='all'||r.record.source===filter.source)&&(!filter.from||d>=filter.from)&&(!filter.to||d<=filter.to)&&(!q||text.includes(q));
  });}
  root.RadarDomain={states,kpis,filtered};
  if(typeof module!=='undefined')module.exports=root.RadarDomain;
})(typeof window!=='undefined'?window:globalThis);
