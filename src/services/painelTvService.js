import {getStatusCargaFrota} from './statusCargaService.js';
import {carregarCiclosPorPlaca} from './folgasMotoristasService.js';
import {getTrafegusDashboard} from './trafegusService.js';
import {getVeiculosPool} from '../db/pool-veiculos.js';
import {quoteIdent} from '../config.js';
import {cargoContext,withCargoConfirmations} from './painelCargaConfirmacoes.js';

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
 const emptySm=sm&&/\bvazi[oa]\b/i.test(sm.operacao||'');
 const conflict=row?.situacaoOperacional?.tipo==='divergente'||(emptySm&&row?.estado==='carregado_confirmado'&&row.statusFonte!=='trafegus');
 let codigo='conferir',label='Conferir carga',desde=null,fonte='Informações insuficientes';
 if(conflict){fonte='Fontes com informações diferentes';}
 else if(emptySm){codigo='vazio';label='SM de vazio';desde=timestamp(sm.inicio)||null;fonte='Início da SM de vazio';}
 else if(row?.estado==='carregado_confirmado'){codigo=row.statusFonte==='trafegus'?'conferir':'carregado';label=row.statusFonte==='trafegus'?'SM ativa · conferir carga':'Carregado';fonte=row.statusFonte==='trafegus'?'SM ativa; carga não confirmada por documento':'Conforme documentos da operação';}
 else if(row?.estado==='vazio_confirmado'&&row.entregaAt&&row.confianca!=='baixa'){codigo='vazio';label='Vazio';desde=row.entregaAt;fonte='Desde a entrega registrada';}
 else if(row?.estado==='vazio_provavel'){codigo='conferir';label='Possivelmente vazio';fonte='Aguardando confirmação de descarga';}
 else if(row?.estado==='vazio_sem_operacao'){label='Sem operação identificada';}
 const elapsed=desde?(now-new Date(desde))/3600000:null;
 return {codigo,label,desde,horasVazio:elapsed!=null&&Number.isFinite(elapsed)&&elapsed>=0?Math.round(elapsed*100)/100:null,fonte};
}
export function tvRoute(row,sm){
 // A previsão de fim pertence à SM, e não comprova horário de entrega.
 if(sm){
  const raw=timestamp(sm.previsaoFim),date=raw?new Date(raw):null;
  return {destino:String(sm.destino||'').trim()||null,fonte:'SM ativa',previsaoFim:date&&Number.isFinite(date.getTime())?date.toISOString():null};
 }
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
 if(!force&&cached&&cached.data.dia===day&&Date.now()-cached.at<60000)return withCargoConfirmations(cached.data);
 if(pending)return withCargoConfirmations(await pending);
 pending=(async()=>{
  const cargoPromise=getStatusCargaFrota({dias:180});
  const smPromise=cargoPromise.then(()=>getTrafegusDashboard(),()=>getTrafegusDashboard());
  const results=await Promise.allSettled([cargoPromise,carregarCiclosPorPlaca(),smPromise,distanceToday(day)]);
  const [cargo,base,sms,km]=results.map(r=>r.status==='fulfilled'?r.value:null);
  const smAvailable=Boolean(sms&&!sms.indisponivel);
  if(!cargo?.rows?.length)throw new Error('Não foi possível carregar os veículos. Tente atualizar novamente.');
  const now=new Date();
  const items=cargo.rows.map(row=>{
   const p=plate(row.placa),cycle=base?.cycles.get(p)?.at(-1),sm=sms?.sms?.filter(s=>plate(s.placa)===p&&!s.fim).sort((a,b)=>String(timestamp(b.inicio||b.previsaoInicio)||'').localeCompare(String(timestamp(a.inicio||a.previsaoInicio)||'')))[0];
   const outside=cycle&&!cycle.retornoEm;
   return {placa:p,contextoCarga:cargoContext(row,sm),rota:tvRoute(row,sm),motorista:String(row.motorista||'').trim()||null,carga:tvLoad(row,sm,now),sm:{disponivel:smAvailable,id:sm?.id||null,operacao:sm?.operacao||null},base:{situacao:cycle?(outside?'fora':'retornou'):'sem_dados',presenca:base?.presence?.get(p)||null,horasFora:outside?cycle.horasFora:null,saidaEm:cycle?.saidaEm||null,observadoEm:cycle?.telemetriaAte||null},kmHoje:km?.get(p)||{km:null,motivo:'Sem leituras suficientes hoje'},localizacao:[row.localizacao?.municipio,row.localizacao?.uf].filter(Boolean).join(' / '),posicaoEm:row.localizacao?.dataHora||row.localizacao?.data_hora||null};
  }).sort((a,b)=>a.placa.localeCompare(b.placa));
  const data={dia:day,atualizadoEm:now.toISOString(),itens:items,fontes:{carga:true,base:Boolean(base?.geofence),sm:smAvailable,quilometragem:Boolean(km)},avisos:results.map((r,i)=>r.status==='rejected'?['Carga indisponível','Tempo fora indisponível','SM indisponível','Quilometragem indisponível'][i]:null).filter(Boolean)};
  if(sms?.incompleto)data.avisos.push("Consulta parcial de SMs: confira veiculos sem viagem na origem.");
  cached={at:Date.now(),data};return data;
 })();
 try{return await withCargoConfirmations(await pending);}finally{pending=null;}
}
