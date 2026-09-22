import fs from 'node:fs/promises';
import { clientPool } from '../src/db/clientPool.js';
import { getEmbarquesClientes } from '../src/services/embarquesClientesService.js';

// Read-only audit. Replays the same query results for filters to keep one snapshot.
const originalQuery = clientPool.query.bind(clientPool);
const cache = new Map();
clientPool.query = async (...args) => {
  const id = JSON.stringify(args);
  if (!cache.has(id)) { const response=await originalQuery(...args); cache.set(id,{rows:response.rows}); }
  return structuredClone(cache.get(id));
};
const unique = values => [...new Set(values.filter(v=>v!=null&&v!==''))];
const key = d=>JSON.stringify([String(d.empresa),String(d.serie||'').trim(),String(d.codigo)]);
const money = n=>Math.round(n*100)/100;
try {
  const started = Date.now();
  const filters = {startDate:'2026-09-01',endDate:'2026-09-30'};
  const result = await getEmbarquesClientes(filters);
  const entries = [...cache.entries()];
  const docs = entries.find(([q])=>JSON.parse(q)[0].trim().startsWith('SELECT con.empresacon AS empresa'))[1].rows;
  const operations = entries.find(([q])=>q.includes('AS operacao'))[1].rows;
  const rawById = new Map(docs.map(d=>[key(d),d]));
  const financial = await originalQuery(`SELECT to_char(rec.dataemissaorec,'YYYY-MM') AS mes,
    rec.clienterec::text AS cliente, SUM(v.valorliquido)::numeric AS valor
    FROM financeiro.receber rec JOIN financeiro.valorliquidorateiosreceber v
    ON rec.empresarec=v.empresa AND rec.serierec=v.serie AND rec.duplicatarec=v.duplicata AND rec.parcelarec=v.parcela
    WHERE rec.statusrec IN (1,2) AND rec.dataemissaorec::date BETWEEN '2026-07-01' AND '2026-09-30'
    GROUP BY 1,2`);
  const suffix = ['Atual','Anterior','Retrasado'];
  const totals = result.conciliacao.map((a,i)=>{
    const month=a.periodo.startDate.slice(0,7);
    const finance=financial.rows.filter(r=>r.mes===month);
    const expected=money(finance.reduce((n,r)=>n+Number(r.valor),0));
    return {mes:month,viagens:a.embarquesUnicos,somaViagensClientes:result.rows.reduce((n,r)=>n+r['embarques'+suffix[i]],0),receitaTela:result.resumo['faturamento'+suffix[i]],receitaDre:a.receitaDre,receitaSqlIndependente:expected,diferenca:money(result.resumo['faturamento'+suffix[i]]-expected),divergenciasPorCliente:result.rows.filter(r=>Math.abs(r['faturamento'+suffix[i]]-Number(finance.find(f=>f.cliente===r.clienteCodigo)?.valor||0))>0.01).map(r=>({cliente:r.cliente,tela:r['faturamento'+suffix[i]],sql:Number(finance.find(f=>f.cliente===r.clienteCodigo)?.valor||0)})),pendentes:a.documentosSemViagem,receitaSemFrete:a.receitaSemFrete,receitaMultiplasAtribuicoes:a.receitaMultiplasAtribuicoes};
  });
  const allTrips=result.conciliacao.flatMap(a=>a.viagens.map(v=>({...v,periodo:a.periodo.startDate.slice(0,7)})));
  const anomalies=allTrips.map(v=>{
    const normals=v.documentos.filter(d=>![1,2].includes(d.tipo));
    const ids=new Set(v.documentos.map(d=>d.id));
    const operationIds=unique(operations.filter(l=>ids.has(key(l))).map(l=>l.operacao));
    const plates=unique(normals.map(d=>d.placa));
    const months=unique(normals.map(d=>d.data?.slice(0,7)));
    const tripIds=operationIds.filter(id=>id.startsWith('V:'));
    const statuses=unique(normals.map(d=>rawById.get(d.id)?.status));
    return {id:v.id,periodo:v.periodo,competencia:v.competencia,plates,months,tripIds,operationIds,statuses,clientes:unique(normals.map(d=>d.cliente)),documentos:v.documentos};
  });
  const repeatedDocuments=[];
  const seen=new Map();
  for(const v of allTrips)for(const d of v.documentos){if(seen.has(d.id)&&seen.get(d.id)!==v.id)repeatedDocuments.push({documento:d.id,viagens:[seen.get(d.id),v.id]});seen.set(d.id,v.id);}
  const rawStats={documentos:docs.length,statuses:docs.reduce((a,d)=>(a[d.status]=(a[d.status]||0)+1,a),{}),tipos:docs.reduce((a,d)=>(a[d.tipo]=(a[d.tipo]||0)+1,a),{})};
  const regions=['Norte','Nordeste','Centro-Oeste','Sudeste','Sul','Não informada','Múltiplas regiões'];
  const filtered=[];
  for(const regiao of regions){const value=await getEmbarquesClientes({...filters,regiao});filtered.push({regiao,resumo:value.resumo,clientes:value.rows.map(r=>({cliente:r.cliente,viagens:r.embarquesAtual,receita:r.faturamentoAtual}))});}
  const companyClients=await originalQuery(`SELECT codigocli, COUNT(DISTINCT nomecli) AS nomes_distintos FROM gerais.clientes GROUP BY codigocli HAVING COUNT(DISTINCT nomecli)>1`);
  const report={geradoEm:new Date().toISOString(),duracaoMs:Date.now()-started,totals,rawStats,agrupamentosSuspeitos:anomalies.filter(a=>a.plates.length>1||a.months.length>1||a.tripIds.length>1||a.statuses.some(s=>Number(s)!==2)),repeatedDocuments,filtered,companyClients,pendentes:result.conciliacao.map(a=>({periodo:a.periodo,grupos:a.pendentes})),matiola:result.rows.filter(r=>/matiola/i.test(r.cliente))};
  await fs.writeFile('../.local-logs/auditoria-embarques-dados.json',JSON.stringify(report,null,2));
  await fs.writeFile('../.local-logs/auditoria-embarques-snapshot.json',JSON.stringify({result,docs,operations,queries:[...cache.entries()]}));
  console.log(JSON.stringify({...report,agrupamentosSuspeitos:report.agrupamentosSuspeitos.map(({documentos,...rest})=>({...rest,documentos:documentos.map(d=>`${d.empresa}/${d.serie}/${d.codigo}`)})),pendentes:report.pendentes.map(a=>({...a,grupos:a.grupos.map(g=>({id:g.id,documentos:g.documentos.map(d=>({codigo:d.codigo,serie:d.serie,cliente:d.cliente,placa:d.placa,data:d.data,tipo:d.tipo}))}))})),filtered:filtered.map(({regiao,resumo})=>({regiao,resumo}))},null,2));
} finally {await clientPool.end();}
