import {pool} from '../db/pool.js';
import {getVeiculosPool} from '../db/pool-veiculos.js';
import {tableName,quoteIdent} from '../config.js';
const dayMs=86400000;
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const localDay=value=>dayFormatter.format(new Date(value));
const shift=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*dayMs).toISOString().slice(0,10);

export function buildDailyReadings(rows,start,end,now=new Date()) {
  const groups=new Map();
  for(const r of rows) {
    const time=new Date(r.data).getTime(),km=Number(r.km);
    if(!Number.isFinite(time)||time>now.getTime()||!Number.isFinite(km)||km<=0)continue;
    const placa=String(r.placa).toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!groups.has(placa))groups.set(placa,[]);
    groups.get(placa).push({...r,placa,time,km,dia:localDay(time)});
  }
  const result=[];
  for(const [placa,points] of groups) {
    points.sort((a,b)=>a.time-b.time);
    const days=new Map();
    for(const p of points){if(!days.has(p.dia))days.set(p.dia,[]);days.get(p.dia).push(p);}
    for(let dia=start;dia<=end;dia=shift(dia,1)) {
      const samples=days.get(dia)||[],previous=days.get(shift(dia,-1))?.at(-1);
      const last=samples.at(-1),boundary=Date.parse(dia+'T00:00:00-03:00');
      let motivo=null;
      if(!samples.length)motivo='Sem leitura no dia';
      else if(dia>=localDay(now))motivo='Dia em andamento';
      else if(!previous||boundary-previous.time>2*3600000)motivo='Falta leitura próxima ao início do dia';
      else if(boundary+dayMs-last.time>2*3600000)motivo='Falta leitura próxima ao fechamento';
      const chain=previous?[previous,...samples]:samples;
      for(let i=1;i<chain.length;i++) {
        const hours=(chain[i].time-chain[i-1].time)/3600000,delta=chain[i].km-chain[i-1].km;
        if(delta<0){motivo='Hodômetro regrediu ou foi substituído';break;}
        if(delta>hours*120+2){motivo='Salto de hodômetro incompatível';break;}
        if(hours>24){motivo='Intervalo de mais de 24 horas sem leitura';break;}
      }
      result.push({placa,dia,odometro_inicial:previous?.km??null,odometro_final:last?.km??null,
        leitura_inicial:previous?new Date(previous.time).toISOString():null,leitura_final:last?new Date(last.time).toISOString():null,
        km:!motivo?last.km-previous.km:null,status:motivo?(dia===localDay(now)?'provisorio':'pendente'):'valido',motivo,amostras:samples.length});
    }
  }
  return result;
}

export async function collectDailyOdometers(start,end) {
  const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA||'rodobach');
  const {rows}=await getVeiculosPool().query(`SELECT v.placa,m.data_hora AS data,m.odometro AS km
    FROM ${schema}.veiculos v JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id
    WHERE m.data_hora >= (($1::date-1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND m.data_hora < (($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND m.data_hora<=now()
      AND m.odometro>0 ORDER BY v.placa,m.data_hora`,[start,end]);
  const readings=buildDailyReadings(rows,start,end);
  if(!readings.length)return 0;
  await pool.query(`INSERT INTO ${tableName('hodometro_diario')} AS saved
    (placa,dia,odometro_inicial,odometro_final,leitura_inicial,leitura_final,km,status,motivo,amostras)
    SELECT placa,dia,odometro_inicial,odometro_final,leitura_inicial,leitura_final,km,status,motivo,amostras
    FROM jsonb_to_recordset($1::jsonb) AS r(placa text,dia date,odometro_inicial numeric,odometro_final numeric,
      leitura_inicial timestamptz,leitura_final timestamptz,km numeric,status text,motivo text,amostras integer)
    ON CONFLICT(placa,dia,fonte) DO UPDATE SET odometro_inicial=excluded.odometro_inicial,odometro_final=excluded.odometro_final,
      leitura_inicial=excluded.leitura_inicial,leitura_final=excluded.leitura_final,km=excluded.km,status=excluded.status,
      motivo=excluded.motivo,amostras=excluded.amostras,atualizado_em=now()
    WHERE excluded.amostras>=saved.amostras`,[JSON.stringify(readings)]);
  return readings.length;
}

export async function readDailyOdometers(placas,period) {
  const {rows}=await pool.query(`SELECT placa,dia::text,fonte,odometro_inicial,odometro_final,leitura_inicial,leitura_final,km,status,motivo,amostras,atualizado_em
    FROM ${tableName('hodometro_diario')} WHERE placa=ANY($1::text[]) AND dia BETWEEN $2::date AND $3::date ORDER BY dia DESC,placa`,[placas,period.startDate,period.endDate]);
  return rows.map(r=>({...r,km:r.km==null?null:Number(r.km),odometro_inicial:r.odometro_inicial==null?null:Number(r.odometro_inicial),odometro_final:r.odometro_final==null?null:Number(r.odometro_final)}));
}
export function summarizeDailyOdometers(rows,period) {
  const diasEsperados=Math.round((Date.parse(period.endDate)-Date.parse(period.startDate))/dayMs)+1;
  const valid=rows.filter(r=>r.status==='valido'&&r.km!=null);
  const completo=valid.length===diasEsperados;
  const ordered=[...valid].sort((a,b)=>a.dia.localeCompare(b.dia));
  const kmObservado=valid.reduce((s,r)=>s+Number(r.km),0);
  return {km:completo?kmObservado:null,kmObservado,diasValidos:valid.length,diasEsperados,completo,
    inicio:ordered[0]?.leitura_inicial??null,fim:ordered.at(-1)?.leitura_final??null,
    odometroInicial:ordered[0]?.odometro_inicial??null,odometroFinal:ordered.at(-1)?.odometro_final??null};
}
let timer,busy=false;
export function startDailyOdometerCollector() {
  if(timer)return;
  const run=async()=>{
    if(busy)return;busy=true;
    try {const today=localDay(new Date());await collectDailyOdometers(shift(today,-2),today);}
    catch(error){console.error('Coleta de hodômetro diário indisponível:',error.code||error.message);}
    finally {busy=false;}
  };
  void run();timer=setInterval(run,15*60*1000);timer.unref();
}
