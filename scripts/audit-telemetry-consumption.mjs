// Read-only comparison: spreadsheets and telemetry database; writes local evidence only.
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {quoteIdent} from '../src/config.js';
import {parseBrazilNumber} from '../src/services/telemetriaResumoService.js';

const directory='C:/Users/pauli/OneDrive/Desktop/trucks';
const output=path.resolve('../.local-logs');
const schema=process.env.VEICULOS_DB_SCHEMA||'rodobach';
const inventory=[], records=[];
for(const file of (await fs.readdir(directory)).sort()) {
  const match=file.match(/Resumo de Telemetria_(\d{1,2})-9-2026_A_(\d{1,2})-9-2026_(\d{8})_(\d{6})\.xlsx$/i);
  if(!match||match[1]!==match[2]||+match[1]>15||!['20260909','20260916'].includes(match[3]))continue;
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(directory,file));
  let count=0;
  for(const sheet of book.worksheets) {
    let header=null;
    sheet.eachRow(row=>{
      const cells=row.values.slice(1);
      if(cells.includes('Placa')) {header=cells.includes('Consumo Total')?cells:null;return;}
      if(!header)return;
      const get=label=>cells[header.indexOf(label)];
      const placa=String(get('Placa')||'').trim().toUpperCase();
      if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa))return;
      const metric=label=>get(label)==null||get(label)===''?null:parseBrazilNumber(get(label));
      records.push({placa,dia:`2026-09-${match[1].padStart(2,'0')}`,arquivo:file,exportacao:match[3]+match[4],km:metric('Distância percorrida'),litros:metric('Consumo Total'),media:metric('Média de Consumo'),hodometroInicial:metric('Hodometro inicial'),hodometroFinal:metric('Hodometro final')});count++;
    });
  }
  inventory.push({arquivo:file,registros:count});
}
const grouped=Map.groupBy(records,row=>`${row.placa}|${row.dia}`);
const selected=[...grouped.values()].map(rows=>rows.sort((a,b)=>b.exportacao.localeCompare(a.exportacao))[0]);
const pool=getVeiculosPool();let database, freshness;
try {
 const client=await pool.connect();
 try {
  await client.query('BEGIN READ ONLY');
  ({rows:database}=await client.query(`SELECT v.placa,t.id,t.data_referencia::text AS dia,t.distancia,t.consumo_total_litros,t.consumo_total,t.media_consumo,t.hodometro_ini,t.hodometro_fim,t.created_at,t.updated_at
    FROM ${quoteIdent(schema)}.telemetria_relatorio t JOIN ${quoteIdent(schema)}.veiculos v USING(veiculo_id)
    WHERE t.data_referencia BETWEEN $1::date AND $2::date AND v.placa=ANY($3::text[]) ORDER BY t.updated_at DESC NULLS LAST,t.id DESC`,['2026-09-01','2026-09-15',[...new Set(selected.map(row=>row.placa))]]));
  ({rows:freshness}=await client.query(`SELECT v.placa,MAX(t.data_referencia)::text AS ultima_data,MAX(t.updated_at) AS ultima_atualizacao,
    COUNT(*) FILTER(WHERE t.data_referencia BETWEEN '2026-09-01' AND '2026-09-15')::int AS registros_periodo
    FROM ${quoteIdent(schema)}.telemetria_relatorio t JOIN ${quoteIdent(schema)}.veiculos v USING(veiculo_id)
    WHERE v.placa=ANY($1::text[]) GROUP BY v.placa ORDER BY v.placa`,[[...new Set(selected.map(row=>row.placa))]]));
 }finally{await client.query('ROLLBACK');client.release();}
}finally{await pool.end();}
const dbGroups=Map.groupBy(database,row=>`${row.placa}|${row.dia}`);
const number=value=>value==null?null:Number(value);
const equal=(a,b,tolerance=.02)=>a!==null&&b!==null&&Math.abs(a-b)<=tolerance;
const comparison=selected.map(row=>{
 const matches=dbGroups.get(`${row.placa}|${row.dia}`)||[],db=matches[0];
 const liters=number(db?.consumo_total_litros),legacy=number(db?.consumo_total),km=number(db?.distancia);
 return {...row,bancoLitros:liters,bancoConsumoLegado:legacy,bancoKm:km,bancoMedia:number(db?.media_consumo),bancoAtualizadoEm:db?.updated_at??null,
   registrosBanco:matches.length,copiasPlanilha:grouped.get(`${row.placa}|${row.dia}`).length,
   consumoStatus:!db?'Sem registro no banco':liters===null?'Consumo nulo no banco':equal(row.litros,liters)?'Confere':'Divergente',
   kmStatus:!db?'Sem registro no banco':equal(row.km,km,.5)?'Confere':'Divergente',
   alertaPlanilha:row.km>0&&row.litros===0?'Rodou, mas planilha também informa consumo zero':'',
   copiaDivergente:grouped.get(`${row.placa}|${row.dia}`).some(other=>other.litros!==row.litros||other.km!==row.km),
 };
}).sort((a,b)=>a.placa.localeCompare(b.placa)||a.dia.localeCompare(b.dia));
const round=value=>Math.round(value*100)/100;
const summary=[...Map.groupBy(comparison,row=>row.placa)].map(([placa,rows])=>({placa,dias:rows.length,
 planilhaLitros:round(rows.reduce((n,r)=>n+(r.litros??0),0)),bancoLitros:rows.some(r=>r.bancoLitros!==null)?round(rows.reduce((n,r)=>n+(r.bancoLitros??0),0)):null,
 confere:rows.filter(r=>r.consumoStatus==='Confere').length,divergente:rows.filter(r=>r.consumoStatus==='Divergente').length,nulo:rows.filter(r=>r.consumoStatus==='Consumo nulo no banco').length,semRegistro:rows.filter(r=>r.consumoStatus==='Sem registro no banco').length,
 planilhaZeroComMovimento:rows.filter(r=>r.alertaPlanilha).length,kmDivergente:rows.filter(r=>r.kmStatus==='Divergente').length}));
const result={schema,arquivos:inventory.length,linhas:records.length,diasPlaca:selected.length,copiasIgnoradas:records.length-selected.length,inventory,summary,freshness,comparison};
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'consumo-telemetria-auditoria.json'),JSON.stringify(result,null,2));
const columns=Object.keys(comparison[0]||{});const cell=value=>`"${String(value??'').replaceAll('"','""')}"`;
await fs.writeFile(path.join(output,'consumo-telemetria-comparativo.csv'),'\uFEFF'+[columns,...comparison.map(row=>columns.map(key=>row[key]))].map(row=>row.map(cell).join(';')).join('\r\n'));
console.log(JSON.stringify({arquivos:result.arquivos,linhas:result.linhas,diasPlaca:result.diasPlaca,copiasIgnoradas:result.copiasIgnoradas,summary,freshness,exemplos:comparison.filter(r=>r.placa==='RXO6C18').slice(-3)},null,2));
