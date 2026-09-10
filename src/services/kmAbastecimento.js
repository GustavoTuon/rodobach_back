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

export async function carregarKmTelemetria(placas, period) {
  if (!placas.length) return new Map();
  const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA || 'rodobach');
  const result=await getVeiculosPool().query(`SELECT UPPER(TRIM(v.placa)) placa, m.data_hora data, m.odometro km
    FROM ${schema}.veiculos v JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id
    WHERE UPPER(TRIM(v.placa))=ANY($1::text[]) AND m.data_hora >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND m.data_hora < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND m.odometro>0
    ORDER BY v.placa,m.data_hora`,[placas,period.startDate,period.endDate]);
  const groups=new Map();
  for(const row of result.rows) { if(!groups.has(row.placa)) groups.set(row.placa,[]); groups.get(row.placa).push(row); }
  return new Map([...groups].map(([placa,rows])=>[placa,avaliarOdometros(rows,period.startDate,period.endDate)]));
}
