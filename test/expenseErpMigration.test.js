import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pool} from '../src/db/pool.js';

test('multi-document migration preserves legacy links and round-trips full identities',{
 skip:process.env.EXPENSE_ERP_DB_TEST!=='1',
},async()=>{
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE manutencao_plantao (id integer, documento_erp varchar(80)) ON COMMIT DROP');
  await client.query("INSERT INTO manutencao_plantao VALUES (1,'OLD')");
  const sql=await readFile(new URL('../sql/094_despesa_documentos_erp.sql',import.meta.url),'utf8');
  await client.query(sql);
  await client.query(sql);
  const old=(await client.query('SELECT * FROM manutencao_plantao')).rows[0];
  assert.equal(old.documento_erp,'OLD');assert.deepEqual(old.documentos_erp,[]);
  const docs=['100','101'].map(number=>({company:'2',series:'1',number,installment:'1',supplierCode:'7',amount:100}));
  await client.query('UPDATE manutencao_plantao SET documentos_erp=$1::jsonb,documento_erp=$2',[JSON.stringify(docs),'100, 101']);
  assert.deepEqual((await client.query('SELECT documentos_erp FROM manutencao_plantao')).rows[0].documentos_erp,docs);
 }finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
