const timestamp=value=>{
 const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
 return m?`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`:value;
};
export function isBaseReturn(sm,locations=[]) {
 const destinations=locations.filter(l=>String(l.tipo_local).toUpperCase()==='DESTINO');
 return Boolean(sm?.inicio&&!sm.fim&&!/carregad[oa]/i.test(sm.operacao||'')&&destinations.length===1
  &&String(destinations[0].refe_cod)==='79590'
  &&!locations.some(l=>String(l.tipo_local).toUpperCase()==='ENTREGA'));
}
export function emptyReturnEvidence(row,sm,locations,history,events=[],now=new Date()) {
 if(!isBaseReturn(sm,locations)||history?.incompleto)return null;
 const start=+new Date(timestamp(sm.inicio));
 if(!Number.isFinite(start)||start>now)return null;
 const previous=(history?.rows||[]).filter(s=>s.placa===sm.placa&&String(s.id)!==String(sm.id)&&s.fim
  &&String(s.statusCodigo)==='5'&&+new Date(timestamp(s.fim))<=start)
  .sort((a,b)=>new Date(timestamp(b.fim))-new Date(timestamp(a.fim)))[0];
 if(!previous)return null;
 const since=+new Date(timestamp(previous.fim));
 if(!Number.isFinite(since))return null;
 const newDocument=+new Date(timestamp(row.operacaoCarga?.ultimaEmissao||row.emissaoAt));
 if(newDocument>since)return null;
 if(events.some(e=>e.tipo==='carregado'&&+new Date(e.dataHora)>since&&new Date(e.dataHora)<=now))return null;
 return {desde:new Date(since).toISOString(),smAnterior:previous.id,smRetorno:sm.id,
  fonte:`Retorno à base sem entregas na SM ${sm.id}; vazio desde o encerramento da SM ${previous.id}.`};
}
