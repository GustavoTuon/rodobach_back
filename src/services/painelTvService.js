import {getStatusCargaFrota} from './statusCargaService.js';
import {carregarCiclosPorPlaca} from './folgasMotoristasService.js';
import {getTrafegusDashboard,getTrafegusSmsHistory,getTrafegusPosition,getTrafegusDailyDistance} from './trafegusService.js';
import {getVeiculosPool} from '../db/pool-veiculos.js';
import {quoteIdent} from '../config.js';
import {cargoContext,withCargoConfirmations} from './painelCargaConfirmacoes.js';
import {loadCargoMacros,cargoMacroEvidence} from './painelCargaMacros.js';
import {loadDeliveryGuide,deliveryProgress} from './painelEntregas.js';
import {isBaseReturn,emptyReturnEvidence} from './retornoVazio.js';

const plate=value=>String(value||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
const timestamp=value=>{const match=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);return match?`${match[3]}-${match[2]}-${match[1]}T${match[4]||'00'}:${match[5]||'00'}:${match[6]||'00'}-03:00`:value;};
export const tvDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function dailyDistance(points,day){
 // Chamado separadamente para cada placa. Horários equivalentes e km numéricos
 // equivalentes identificam a mesma leitura, mesmo em reenvios fora de ordem.
 const seen=new Set(),valid=[];
 let duplicatasIgnoradas=0;
 for(const point of points){
  const time=new Date(point.data).getTime(),km=Number(point.km);
  if(!point.data||!Number.isFinite(time)||point.km==null||!Number.isFinite(km)||km<=0)continue;
  const key=`${time}:${km}`;
  if(seen.has(key)){duplicatasIgnoradas++;continue;}
  seen.add(key);valid.push({...point,time,km});
 }
 valid.sort((a,b)=>a.time-b.time);
 const result=value=>({...value,duplicatasIgnoradas});
 if(valid.length<2)return result({km:null,motivo:'Leituras insuficientes'});
 for(let i=1;i<valid.length;i++){
  const hours=(valid[i].time-valid[i-1].time)/3600000,delta=valid[i].km-valid[i-1].km;
  if(hours<=0||hours>2||delta<0||delta>hours*120+2)return result({km:null,motivo:'Conferir leituras do hodômetro'});
 }
 const first=valid[0],last=valid.at(-1);
 return result({km:Math.round((last.km-first.km)*10)/10,inicio:first.data,fim:last.data,parcial:first.time-new Date(`${day}T00:00:00-03:00`)>15*60000});
}
export function distanceBySource(points,day){
 const groups=new Map();
 for(const p of points){
  const time=new Date(p.data).getTime();
  if(!p.data||!Number.isFinite(time)||p.km==null||!Number.isFinite(Number(p.km))||Number(p.km)<=0)continue;
  const key=JSON.stringify([p.origem_mensagem??null,p.tipo_mensagem??null]);
  if(!groups.has(key))groups.set(key,new Map());
  const times=groups.get(key);
  if(!times.has(time))times.set(time,new Map());
  times.get(time).set(Number(p.km),p);
 }
 const candidates=[];
 for(const [key,times] of groups){
  let segment=[];
  const finish=()=>{
   const result=dailyDistance(segment,day);
   if(result.km!=null)candidates.push({...result,origem:JSON.parse(key)[0],tipo:JSON.parse(key)[1],amostras:segment.length});
   segment=[];
  };
  for(const [,readings] of [...times].sort((a,b)=>a[0]-b[0])){
   // Um horário com valores conflitantes não serve de ponta de um trecho.
   if(readings.size!==1){finish();continue;}
   const p=[...readings.values()][0];
   if(segment.length&&dailyDistance([segment.at(-1),p],day).km==null)finish();
   segment.push(p);
  }
  finish();
 }
 // Uma única sequência: nunca somar fontes sobrepostas ou unir trechos rompidos.
 // A stationary overnight segment must not hide validated movement later today.
 candidates.sort((a,b)=>Number(b.km>0)-Number(a.km>0)||(new Date(b.fim)-new Date(b.inicio))-(new Date(a.fim)-new Date(a.inicio))||b.amostras-a.amostras||new Date(b.fim)-new Date(a.fim));
 const best=candidates[0];
 if(!best)return {km:null,motivo:'Sem sequência consistente de hodômetro'};
 const combined=dailyDistance(points,day);
 const latest=Math.max(...points.map(p=>new Date(p.data).getTime()).filter(Number.isFinite));
 return {...best,parcial:best.parcial||combined.km==null||latest-new Date(best.fim)>15*60000,metodo:'sequencia_por_fonte',observacao:'Uma sequência validada; outras fontes e trechos não são somados',duplicatasIgnoradas:combined.duplicatasIgnoradas};
}
export function tvLoad(row,sm,now=new Date()){
 if(row?.retornoVazio){
  const evidence=row.retornoVazio;
  return {codigo:'vazio',label:'Vazio',desde:evidence.desde,horasVazio:Math.max(0,(now-new Date(evidence.desde))/3600000),confirmacaoPendente:false,fonte:evidence.fonte};
 }
 const started=sm&&!sm.fim&&sm.inicio&&new Date(timestamp(sm.inicio))<=now;
 const emptySm=started&&/\bvazi[oa]\b/i.test(sm.operacao||'');
 const loadedSm=started&&!emptySm&&/\bcarregad[oa]\b/i.test(sm.operacao||'');
 const op=row?.operacaoCarga;
 const macros=row?.macrosCarga;
 const event=macros?.operacional;
 const eventNote={chegada:'Macro de chegada/parada no cliente; falta confirmar a descarga.',
  descarga:'Macro de fim de descarga; falta confirmar se foi a última entrega.',
  fim_viagem:'Macro de fim de viagem; falta confirmar se o veículo ficou vazio.'}[event?.tipo];
 const newerSm=started&&op?.entregaFinal&&new Date(timestamp(sm.inicio))>new Date(op.entregaFinal);
 const result=(codigo,fonte,{desde=null,pendente=false}={})=>{
  if(macros?.conflito){pendente=true;fonte+=' Macros simultâneas informam situações diferentes.';}
  if(eventNote){pendente=true;fonte+=` ${eventNote}`;}
  const elapsed=desde?(now-new Date(desde))/3600000:null;
  return {codigo,label:codigo==='carregado'?'Carregado':codigo==='vazio'?'Vazio':'—',desde,
   horasVazio:codigo==='vazio'&&!pendente&&elapsed!=null&&Number.isFinite(elapsed)&&elapsed>=0?Math.round(elapsed*100)/100:null,
   confirmacaoPendente:pendente,fonte:pendente?`Confirmação pendente · ${fonte}`:fonte};
 };
 if(macros?.confirmacao){
  const confirmation=macros.confirmacao;
  // Subsequent arrival/end events preserve the last state, with confirmation pending.
  return result(confirmation.tipo,`Conforme macro: ${confirmation.descricao}.`,
   {desde:confirmation.dataHora,pendente:now-new Date(confirmation.dataHora)>24*3600000});
 }
 if(emptySm){
  const conflict=Boolean(op?.pendentes?.length||(!op&&row?.estado==='carregado_confirmado'&&row.statusFonte!=='trafegus'));
  if(conflict)return result('carregado','Documentos sem baixa; SM informa deslocamento vazio.',{pendente:true});
  return result('vazio','Conforme SM de deslocamento vazio.',{desde:timestamp(sm.inicio)});
 }
 if(loadedSm&&(!op?.entregaFinal||newerSm))return result('carregado','Conforme SM de transporte carregado.');
 if(row?.statusFonte==='pef_terceiro')return result('carregado','Indicação de frete de terceiro ativo; confirmar carregamento.',{pendente:true});
 if(op?.pendentes?.length){
  const stale=now-new Date(op.ultimaEmissao)>21*86400000;
  if(op.baixasNaoConfirmadas?.length)return result('carregado',
   'Última carga documentada, sem descarga comprovada. As datas anteriores de previsão não confirmam entrega.'+(started?' SM ativa; confirmar vínculo com a carga atual.':''),{pendente:true});
  if(new Date(timestamp(op.inicio))>now)return result('carregado','Carga documentada com saída futura; confirmar carregamento concluído.',{pendente:true});
  return result('carregado',stale?'Última operação com documentos sem baixa; confirmar situação atual.'
   :row?.trafegusDivergente?`Há entregas pendentes na viagem ${op.viagem || 'atual'}; a baixa de ${row.documento} não encerra a carga.`
   :'Conforme documentos da operação; aguardando a última entrega.',{pendente:stale});
 }
 if(op?.entregaFinal){
  if(newerSm)return result('sem_confirmacao',`SM ${sm.id} posterior à última descarga; confirmar o novo carregamento.`,{pendente:true});
  const pending=Boolean(started||!op.agrupamentoConhecido);
  return result('vazio',pending?'Última entrega registrada; confirmar encerramento de toda a carga.'
   :'Desde a última entrega registrada da viagem.',{desde:op.entregaFinal,pendente:pending});
 }
 if(row?.estado==='vazio_confirmado'&&row.entregaAt&&new Date(row.entregaAt)<=now){
  return result('vazio','Última entrega registrada; confirmar situação atual.',{pendente:true});
 }
 if(row?.estado==='carregado_confirmado'&&row.statusFonte!=='trafegus')return result('carregado','Conforme documentos da operação.');
 return result('sem_confirmacao',sm?'SM sem indicação de carga; confirme Carregado ou Vazio em Corrigir carga.'
  :'Sem referência suficiente; confirme Carregado ou Vazio em Corrigir carga.',{pendente:true});
}
export function tvRoute(row,sm){
 // A previsão de fim pertence à SM, e não comprova horário de entrega.
 if(sm){
  const raw=timestamp(sm.previsaoFim),date=raw?new Date(raw):null;
  return {destino:String(sm.destino||'').trim()||null,fonte:'SM ativa',previsaoFim:date&&Number.isFinite(date.getTime())?date.toISOString():null};
 }
 if(row?.operacaoCarga?.pendentes?.length)return {destino:row.operacaoCarga.destino||null,fonte:'Documento da operação',previsaoFim:null};
 // Documentos encerrados não representam o próximo destino do veículo vazio.
 if(row?.estado==='carregado_confirmado'&&row.statusFonte!=='trafegus'&&row.situacaoOperacional?.tipo!=='divergente'){
  return {destino:String(row.destino||'').trim()||null,fonte:'Documento da operação',previsaoFim:null};
 }
 return {destino:null,fonte:null,previsaoFim:null};
}
async function distanceToday(day){
 const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA||'rodobach');
 const {rows}=await getVeiculosPool().query(`SELECT regexp_replace(upper(v.placa),'[^A-Z0-9]','','g') placa,m.data_hora data,m.odometro km,m.origem_mensagem,m.tipo_mensagem
 FROM ${schema}.mensagens_cb m JOIN ${schema}.veiculos v ON v.veiculo_id=m.veiculo_id
 WHERE m.data_hora >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND m.data_hora < (($1::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND m.data_hora<=NOW()
 ORDER BY v.placa,m.data_hora`,[day]);
 const grouped=new Map();for(const row of rows){if(!grouped.has(row.placa))grouped.set(row.placa,[]);grouped.get(row.placa).push(row);}
 return new Map([...grouped].map(([p,points])=>[p,distanceBySource(points,day)]));
}
let cached=null,pending=null;
export async function getPainelTv({force=false}={}){
 const day=tvDay();
 const yesterday=new Date(new Date(`${day}T12:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
 if(!force&&cached&&cached.data.dia===day&&Date.now()-cached.at<60000)return withCargoConfirmations(cached.data);
 if(pending)return withCargoConfirmations(await pending);
 pending=(async()=>{
  const cargoPromise=getStatusCargaFrota({dias:180,includeThirdPartySms:true});
  const smPromise=cargoPromise.then(()=>getTrafegusDashboard(),()=>getTrafegusDashboard());
  const macroPromise=cargoPromise.then(cargo=>loadCargoMacros(cargo.rows.map(row=>plate(row.placa))));
  const results=await Promise.allSettled([cargoPromise,carregarCiclosPorPlaca(),smPromise,distanceToday(day),macroPromise,distanceToday(yesterday)]);
  const [cargo,base,sms,km,macros,kmYesterday]=results.map(r=>r.status==='fulfilled'?r.value:null);
  const smAvailable=Boolean(sms&&!sms.indisponivel);
  if(!cargo?.rows?.length)throw new Error('Não foi possível carregar os veículos. Tente atualizar novamente.');
  const now=new Date();
  const items=(await Promise.all(cargo.rows.map(async row=>{
   const p=plate(row.placa),cycle=base?.cycles.get(p)?.at(-1),sm=sms?.sms?.filter(s=>plate(s.placa)===p&&!s.fim).sort((a,b)=>String(timestamp(b.inicio||b.previsaoInicio)||'').localeCompare(String(timestamp(a.inicio||a.previsaoInicio)||'')))[0];
   const outside=cycle&&!cycle.retornoEm;
   const localTime=+new Date(row.localizacao?.dataHora||row.localizacao?.data_hora);
   if(row.tipoFrota==='terceiro'&&sm?.id&&(!Number.isFinite(localTime)||now-localTime>1800000)){
    const elite=await getTrafegusPosition(sm.id,p).catch(()=>null);
    if(elite&&(!Number.isFinite(localTime)||+new Date(elite.dataHora)>localTime))row={...row,localizacao:elite};
   }
   const [eliteYesterday,eliteToday]=row.tipoFrota==='terceiro'&&sm?.id
    ?await Promise.all([yesterday,day].map(date=>getTrafegusDailyDistance(sm.id,p,date).catch(()=>null))):[null,null];
   const dailyYesterday=row.tipoFrota==='terceiro'?eliteYesterday:kmYesterday?.get(p);
   const dailyToday=row.tipoFrota==='terceiro'?eliteToday:km?.get(p);
   const dates=[row.operacaoCarga?.ultimaEmissao,row.operacaoCarga?.inicio,row.operacaoCarga?.entregaFinal,sm?.inicio]
    .filter(Boolean).map(value=>+new Date(timestamp(value))).filter(Number.isFinite);
   const macroData=cargoMacroEvidence(macros?.get(p)||[],dates.length?new Date(Math.max(...dates)):null,now);
   const enriched={...row,macrosCarga:macroData,macroCargaContexto:macroData.confirmacao
    ?`${macroData.confirmacao.tipo}:${new Date(macroData.confirmacao.dataHora).toISOString()}`:null};
   let entregas=null;
   if(sm?.id){
    try{
     const locations=await loadDeliveryGuide(sm.id);
     entregas=deliveryProgress(locations,macros?.get(p)||[],timestamp(sm.inicio),row.localizacao,now);
     if(isBaseReturn(sm,locations)){
      const history=await getTrafegusSmsHistory({placa:p});
      enriched.retornoVazio=emptyReturnEvidence(row,sm,locations,history,macros?.get(p)||[],now);
     }
    }
    catch{entregas={disponivel:false,observacao:'Sequência de entregas indisponível na Elite.'};}
   }
   return {placa:p,tipoFrota:row.tipoFrota,documentosCarga:row.documentosCarga,entregas,contextoCarga:cargoContext(enriched,sm),rota:tvRoute(row,sm),motorista:String((row.tipoFrota==='terceiro'?sm?.motorista:null)||row.motorista||'').trim()||null,carga:tvLoad(enriched,sm,now),macros:{...macroData,disponivel:Boolean(macros)},sm:{disponivel:smAvailable,id:sm?.id||null,operacao:sm?.operacao||null},base:{situacao:cycle?(outside?'fora':'retornou'):'sem_dados',presenca:base?.presence?.get(p)||null,horasFora:outside?cycle.horasFora:null,saidaEm:cycle?.saidaEm||null,observadoEm:cycle?.telemetriaAte||null},kmOntem:{dia:yesterday,...(dailyYesterday||{km:null,motivo:'Sem leituras suficientes ontem'})},kmHoje:dailyToday||{km:null,motivo:'Sem leituras suficientes hoje'},localizacao:[row.localizacao?.municipio,row.localizacao?.uf].filter(Boolean).join(' / '),posicaoFonte:row.localizacao?.fonte||null,posicaoEm:row.localizacao?.dataHora||row.localizacao?.data_hora||null};
  }))).sort((a,b)=>a.placa.localeCompare(b.placa));
  const data={dia:day,atualizadoEm:now.toISOString(),itens:items,fontes:{carga:true,base:Boolean(base?.geofence),sm:smAvailable,quilometragem:Boolean(km),quilometragemOntem:Boolean(kmYesterday),macros:Boolean(macros)},avisos:results.map((r,i)=>r.status==='rejected'?['Carga indisponível','Tempo fora indisponível','SM indisponível','Quilometragem indisponível','Macros indisponíveis','Quilometragem de ontem indisponível'][i]:null).filter(Boolean)};
  if(sms?.incompleto)data.avisos.push("Consulta parcial de SMs: confira veiculos sem viagem na origem.");
  cached={at:Date.now(),data};return data;
 })();
 try{return await withCargoConfirmations(await pending);}finally{pending=null;}
}
