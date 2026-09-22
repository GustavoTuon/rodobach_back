// Explicit, bounded backfill from the read-only audit. Never changes distance or averages.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {quoteIdent} from '../src/config.js';

const audit=JSON.parse(await fs.readFile('../.local-logs/consumo-telemetria-auditoria.json','utf8'));
const excluded=new Set(['RAA8G18','SXR8D09']);
const eligible=audit.comparison.filter(row=>!excluded.has(row.placa)&&Number.isFinite(row.litros)&&row.litros>0);
assert.equal(new Set(eligible.map(row=>`${row.placa}|${row.dia}`)).size,eligible.length);
const sources={};
for(const row of eligible) {
  assert.ok(/^2026-09-(0[1-9]|1[0-5])$/.test(row.dia));
  assert.equal(row.registrosBanco,1);
  if(!sources[row.arquivo]) sources[row.arquivo]=createHash('sha256').update(await fs.readFile(path.join('C:/Users/pauli/OneDrive/Desktop/trucks',row.arquivo))).digest('hex');
}
const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA||'rodobach');
assert.equal(audit.schema,process.env.VEICULOS_DB_SCHEMA||'rodobach');
const pool=getVeiculosPool(),client=await pool.connect();
const apply=process.argv.includes('--apply');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=path.resolve(`../.local-logs/consumo-backup-${stamp}.json`);
try {
  await client.query(apply?'BEGIN READ WRITE':'BEGIN READ ONLY');
  const changes=[];
  for(const input of eligible) {
    const {rows}=await client.query(`SELECT t.* FROM ${schema}.telemetria_relatorio t JOIN ${schema}.veiculos v USING(veiculo_id)
      WHERE v.placa=$1 AND t.data_referencia=$2::date ${apply?'FOR UPDATE OF t':''}`, [input.placa,input.dia]);
    assert.equal(rows.length,1,`Ambiguous/missing row: ${input.placa} ${input.dia}`);
    const before=rows[0];
    for(const key of ['consumo_total','consumo_total_litros']) {
      assert.ok(before[key]===null||Math.abs(Number(before[key])-input.litros)<.001,`Existing conflicting consumption: ${input.placa} ${input.dia} ${key}`);
    }
    if(before.consumo_total!==null&&before.consumo_total_litros!==null)continue;
    changes.push({placa:input.placa,dia:input.dia,litros:input.litros,arquivo:input.arquivo,before});
  }
  await fs.writeFile(backup,JSON.stringify({aplicar:apply,geradoEm:new Date().toISOString(),schema:audit.schema,sources,changes},null,2));
  for(const change of apply?changes:[]) {
    const {rows}=await client.query(`UPDATE ${schema}.telemetria_relatorio SET consumo_total_litros=$1,consumo_total=$1,updated_at=now()
      WHERE id=$2 RETURNING *`,[change.litros,change.before.id]);
    assert.equal(rows.length,1);
    for(const [key,value] of Object.entries(change.before)) {
      if(['consumo_total','consumo_total_litros','updated_at'].includes(key))continue;
      assert.deepEqual(rows[0][key],value,`Unexpected field change: ${key}`);
    }
    assert.equal(Number(rows[0].consumo_total_litros),change.litros);
    assert.equal(Number(rows[0].consumo_total),change.litros);
  }
  await client.query(apply?'COMMIT':'ROLLBACK');
  const summary={aplicado:apply,registros:changes.length,backup,porPlaca:[...Map.groupBy(changes,row=>row.placa)].map(([placa,rows])=>({placa,dias:rows.length,litros:Math.round(rows.reduce((n,row)=>n+row.litros,0)*100)/100}))};
  console.log(JSON.stringify(summary,null,2));
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await pool.end();}
