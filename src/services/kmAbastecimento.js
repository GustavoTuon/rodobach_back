import { getVeiculosPool } from '../db/pool-veiculos.js';
import { quoteIdent } from '../config.js';

export function avaliarOdometros(rows, startDate, endDate, exigirCobertura = true) {
  const points = rows.filter(r => Number(r.km) > 0).sort((a,b) => new Date(a.data)-new Date(b.data));
  if (points.length < 2) return null;
  const first = points[0], last = points.at(-1);
  const start = new Date(`${startDate}T00:00:00-03:00`).getTime();
  const end = new Date(`${endDate}T00:00:00-03:00`).getTime()+86400000;
  if (exigirCobertura && (new Date(first.data)-start > 86400000 || end-new Date(last.data) > 86400000)) return null;
  for (let i=1;i<points.length;i++) {
    const hours=(new Date(points[i].data)-new Date(points[i-1].data))/3600000;
    const delta=Number(points[i].km)-Number(points[i-1].km);
    if (delta < 0 || delta > hours*120+2 || (exigirCobertura && hours>24)) return null;
  }
  return { km: Number(last.km)-Number(first.km), inicio: first.data, fim: last.data, odometroInicial: Number(first.km), odometroFinal: Number(last.km) };
}

async function consultarOdometros(placas, period) {
  if (!placas.length) return [];
  const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA || 'rodobach');
  const result=await getVeiculosPool().query(`SELECT UPPER(TRIM(v.placa)) placa, m.data_hora data, m.odometro km
    FROM ${schema}.veiculos v JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id
    WHERE UPPER(TRIM(v.placa))=ANY($1::text[]) AND m.data_hora >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND m.data_hora < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND m.odometro>0
    ORDER BY v.placa,m.data_hora`,[placas,period.startDate,period.endDate]);
  return result.rows;
}

export async function carregarKmTelemetria(placas, period) {
  const rows=await consultarOdometros(placas,period);
  const groups=new Map();
  for(const row of rows) { if(!groups.has(row.placa)) groups.set(row.placa,[]); groups.get(row.placa).push(row); }
  return new Map([...groups].map(([placa,rows])=>[placa,avaliarOdometros(rows,period.startDate,period.endDate)]));
}

export async function carregarKmTelemetriaMensal(placas, period) {
  const rows=await consultarOdometros(placas,period);
  const groups=new Map();
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
  for(const row of rows) {
    const key=`${row.placa}|${localDate.format(new Date(row.data)).slice(0,7)}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const monthly=[];
  const cursor=new Date(`${period.startDate.slice(0,7)}-01T12:00:00Z`);
  while(cursor.toISOString().slice(0,7)<=period.endDate.slice(0,7)) {
    const mes=cursor.toISOString().slice(0,7);
    const last=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0)).toISOString().slice(0,10);
    const startDate=period.startDate>`${mes}-01`?period.startDate:`${mes}-01`;
    const endDate=period.endDate<last?period.endDate:last;
    for(const placa of placas) {
      const result=avaliarOdometros(groups.get(`${placa}|${mes}`)||[],startDate,endDate);
      monthly.push({placa,mes,km:result?.km??null,inicio:result?.inicio??null,fim:result?.fim??null});
    }
    cursor.setUTCMonth(cursor.getUTCMonth()+1);
  }
  return {available:true,monthly};
}
