import fs from 'node:fs/promises';
import { getVeiculosPool } from '../src/db/pool-veiculos.js';
import { clientPool } from '../src/db/clientPool.js';

const histories=JSON.parse(await fs.readFile('../.local-logs/custo-vazio-sm-historico.json','utf8'));
const date=s=>{const m=String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);return m?new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}-03:00`).toISOString():null;};
const start='2026-08-01T03:00:00.000Z',end='2026-09-25T03:00:00.000Z';
const gaps=[];
for(const h of histories){
 const sms=(h.rows||[]).map(s=>({...s,a:date(s.inicio),b:date(s.fim)})).filter(s=>s.a).sort((a,b)=>a.a.localeCompare(b.a));
 for(let i=0;i<sms.length-1;i++){
  const s=sms[i],n=sms[i+1];if(!s.b||s.b>=n.a)continue;
  const a=s.b>start?s.b:start,b=n.a<end?n.a:end;if(b<=a)continue;
  if(sms.some(x=>x.id!==s.id&&x.id!==n.id&&x.a<b&&(x.b||end)>a))continue;
  gaps.push({id:gaps.length+1,placa:h.placa,inicio:a,fim:b,sm:s.id,proximaSm:n.id});
 }
}
const p=getVeiculosPool();
try{
 const [metrics,daily,prices]=await Promise.all([
 p.query(`WITH intervals AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(id int,placa text,inicio timestamptz,fim timestamptz)), points AS (
 SELECT i.id,m.data_hora,m.odometro,lag(m.odometro) OVER w prev,lag(m.data_hora) OVER w prev_at
 FROM intervals i JOIN rodobach.veiculos v ON trim(v.placa)=i.placa JOIN rodobach.mensagens_cb m ON m.veiculo_id=v.veiculo_id AND m.data_hora>=i.inicio AND m.data_hora<=i.fim
 WHERE m.odometro>0 WINDOW w AS (PARTITION BY i.id ORDER BY m.data_hora,m.id))
 SELECT id,count(*)::int pontos,min(data_hora) primeira,max(data_hora) ultima,
 sum(CASE WHEN odometro>=prev AND odometro-prev<=extract(epoch from data_hora-prev_at)/3600*140+2 AND data_hora-prev_at<=interval '2 hours' THEN odometro-prev ELSE 0 END)::float km,
 count(*) FILTER(WHERE odometro<prev OR odometro-prev>extract(epoch from data_hora-prev_at)/3600*140+2)::int anomalias,
 count(*) FILTER(WHERE data_hora-prev_at>interval '2 hours')::int lacunas FROM points GROUP BY id`,[JSON.stringify(gaps)]),
 p.query(`SELECT v.placa,t.data_referencia::text dia,t.distancia::float km,t.consumo_total_litros::float litros,t.consumo_total::float legado,t.hodometro_ini::float odo_ini,t.hodometro_fim::float odo_fim,t.media_consumo::float media FROM rodobach.telemetria_relatorio t JOIN rodobach.veiculos v USING(veiculo_id) WHERE t.data_referencia>='2026-08-01' AND t.data_referencia<'2026-09-25' ORDER BY 1,2`),
 clientPool.query(`SELECT trim(a.veiculoaba) placa,sum(a.totalaba)::float/nullif(sum(a.litrosaba),0) preco FROM frotas.abastecimentos a JOIN LATERAL (SELECT nomepro FROM estoque.produtos p WHERE p.codigopro=a.combustivelaba ORDER BY (p.empresapro=a.empresaaba) DESC,p.empresapro LIMIT 1) p ON true WHERE a.dataaba>='2026-08-01' AND a.dataaba<'2026-09-25' AND p.nomepro ILIKE '%DIESEL%' GROUP BY 1`)
 ]);
 const map=new Map(metrics.rows.map(r=>[r.id,r]));const intervals=gaps.map(g=>({...g,...map.get(g.id)}));
 const days=daily.rows.map(d=>{
  const a=new Date(`${d.dia}T00:00:00-03:00`),b=new Date(+a+86400000);
  const gap=gaps.find(g=>g.placa===d.placa&&g.inicio<=a.toISOString()&&g.fim>=b.toISOString());
  return {...d,gapId:gap?.id??null,litros:d.litros??d.legado};
 });
 const summary=histories.map(h=>{
  const ints=intervals.filter(g=>g.placa===h.placa),ds=days.filter(d=>d.placa===h.placa&&d.gapId&&d.km>0&&d.litros>0&&d.odo_ini>0&&d.odo_fim>=d.odo_ini&&Math.abs(d.km-(d.odo_fim-d.odo_ini))<=1);
  const km=ds.reduce((s,d)=>s+d.km,0),litros=ds.reduce((s,d)=>s+d.litros,0),price=prices.rows.find(r=>r.placa===h.placa)?.preco;
  return {placa:h.placa,intervalos:ints.length,kmEntreSm:ints.reduce((s,g)=>s+(g.km||0),0),anomalias:ints.reduce((s,g)=>s+(g.anomalias||0),0),lacunas:ints.reduce((s,g)=>s+(g.lacunas||0),0),diasInteirosComConsumo:ds.length,kmAmostra:km,litrosAmostra:litros,kmL:litros?km/litros:null,precoDiesel:price,dieselPorKm:km?litros*price/km:null};
 });
 await fs.writeFile('../.local-logs/custo-vazio-telemetria.json',JSON.stringify({periodo:{start,end},summary,intervals,days},null,2));
 console.log(JSON.stringify(summary,null,2));
}finally{await Promise.all([p.end(),clientPool.end()]);}


