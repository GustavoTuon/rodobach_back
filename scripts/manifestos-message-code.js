// n8n formatter: compact message, preserving the daily duplicate guard.
export const manifestosMessageCode = String.raw`const rows=$input.all().map(i=>i.json).filter(r=>r.numero!=null);
if(!rows.length)return [];
const day=$now.setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd');
if($getWorkflowStaticData('global').lastSentDay===day)return [];
const total=Number(rows[0].total);
const lines=rows.map(r=>{
 const repeated=rows.filter(other=>String(other.numero)===String(r.numero)).length>1;
 const identity=repeated?' (série '+r.serie+', empresa '+r.empresa+')':'';
 return '• *'+r.numero+identity+' · '+(r.placa||'Sem placa')+'* · '+(r.autorizado||'não informada')+'\nRota: '+(r.origem?.trim()||'Origem não informada')+' x '+(r.destino?.trim()||'Destino não informado');
});
const message=['Boa tarde!','*Rodobach | Manifestos em aberto*',$now.setZone('America/Sao_Paulo').toFormat('dd/MM/yyyy'),'',total+' manifesto(s) em aberto no ERP.','',lines.join('\n\n'),...(total>rows.length?['+ '+(total-rows.length)+' no sistema.']:[]),'','Encerre apenas os manifestos de viagens concluídas.'].join('\n');
return ['5548999503759','5548996466096'].map(number=>({json:{number,text:message,day,total}}));`;
