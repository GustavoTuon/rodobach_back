import fs from 'node:fs/promises';
import {clientPool} from '../src/db/clientPool.js';
import {getEmbarquesClientes} from '../src/services/embarquesClientesService.js';
const snapshot=JSON.parse(await fs.readFile('../.local-logs/auditoria-embarques-snapshot.json','utf8'));
const cache=new Map(snapshot.queries);
clientPool.query=async(...args)=>{const value=cache.get(JSON.stringify(args));if(!value)throw Error('Query fora do snapshot');return structuredClone(value);};
const {result,docs,operations}=snapshot;
const key=d=>JSON.stringify([String(d.empresa),String(d.serie||'').trim(),String(d.codigo)]);
const byId=new Map(docs.map(d=>[key(d),d]));
const uniq=values=>[...new Set(values)];
const displaced=[],onlyBudgets=[],nonAuthorizedFiscal=[],genericClients=[];
for(const a of result.conciliacao)for(const v of a.viagens){
  const originals=v.documentos.filter(d=>d.tipo===0);
  for(const cid of uniq(originals.map(d=>d.clienteCodigo))){
    const own=originals.filter(d=>d.clienteCodigo===cid);
    const fiscal=own.filter(d=>byId.get(d.id)?.chave);
    const valid=fiscal.length?fiscal:own;
    const first=valid.map(d=>d.data).sort()[0];
    if(first?.slice(0,7)!==v.competencia.data?.slice(0,7))displaced.push({viagem:v.id,cliente:own[0].cliente,mesTela:a.periodo.startDate.slice(0,7),primeiroDocumentoCliente:first,documentos:valid.map(d=>`${d.empresa}/${d.serie}/${d.codigo}`)});
    if(!fiscal.length)onlyBudgets.push({viagem:v.id,cliente:own[0].cliente,documentos:own.map(d=>({id:d.id,serie:d.serie,status:byId.get(d.id)?.status}))});
  }
  for(const d of originals){const raw=byId.get(d.id);if(raw?.chave&&Number(raw.status)!==2)nonAuthorizedFiscal.push({...d,status:raw.status});if(/^(REMETENTE|DESTINATARIO)$/.test(d.cliente))genericClients.push({viagem:v.id,...d});}
}
const filters={startDate:'2026-09-01',endDate:'2026-09-30'};
const sellerResults=[];
for(const vendedor of [...result.filtros.vendedores,'Múltiplos vendedores']){
 const filtered=await getEmbarquesClientes({...filters,vendedor});
 sellerResults.push({vendedor,resumo:filtered.resumo,matiola:filtered.rows.find(r=>/matiola/i.test(r.cliente))});
}
const docsWithoutGroup=docs.filter(d=>d.data_documento>='2026-07-01'&&d.data_documento<='2026-09-30'&&Number(d.status)!==3&&Number(d.tipo)===1);
const allShown=new Set(result.conciliacao.flatMap(a=>a.viagens.flatMap(v=>v.documentos.map(d=>d.id))));
const unshownComplements=docsWithoutGroup.filter(d=>!allShown.has(key(d))).map(d=>({id:key(d),emissao:d.data_documento,referencia:key({empresa:d.empresa,serie:d.serie_ref,codigo:d.codigo_ref})}));
const report={displaced,onlyBudgets,nonAuthorizedFiscal,genericClients,sellerResults,unshownComplements,clientesExemplos:result.rows.filter(r=>/CANA CAYANA|ERNANE WALDOW|LAZARO A|ESAF|^REMETENTE$|^DESTINATARIO$/.test(r.cliente)),gruposPorClienteDiferemDoTotal:result.conciliacao.map((a,i)=>({mes:a.periodo.startDate.slice(0,7),total:a.embarquesUnicos,soma:result.rows.reduce((n,r)=>n+r[['embarquesAtual','embarquesAnterior','embarquesRetrasado'][i]],0)}))};
await fs.writeFile('../.local-logs/auditoria-embarques-analise.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,onlyBudgets:{total:onlyBudgets.length,exemplos:onlyBudgets.slice(0,5)},displaced:{total:displaced.length,exemplos:displaced.slice(0,12)},genericClients:{total:genericClients.length,exemplos:genericClients.slice(0,3)}},null,2));
await clientPool.end();
