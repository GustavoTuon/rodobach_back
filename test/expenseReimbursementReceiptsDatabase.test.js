import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db/pool.js';
import {reimbursementReceipts} from '../src/services/expenseReimbursementReceipts.js';
test('reimbursement SQL preserves installments, series and reversal rules', {skip:process.env.PLANTAO_DB_TEST !== '1'}, async()=>{
const c=await pool.connect();
try {
 await c.query('BEGIN');
 const tables={
 'logistica.conhecimentos':'empresacon int,seriecon text,codigocon int,statuscon int',
 'financeiro.receber':'empresarec int,serierec text,duplicatarec int,parcelarec int,valorabertorec numeric,valorduplicatarec numeric,statusrec int',
 'financeiro.receberconhecimentosvinculados':'empresa int,serie text,duplicata int,serieconhecimento text,codigoconhecimento int',
 'financeiro.receberconhecimentos':'empresarcc int,seriercc text,duplicatarcc int,parcelarcc int,conhecimentorcc int',
 'financeiro.receberrecebimentos':'empresarcb int,seriercb text,duplicatarcb int,parcelarcb int,valorrecebidorcb numeric,datarecebimentorcb date'
 };
 for(const [name,columns] of Object.entries(tables))await c.query(`CREATE TEMP TABLE test_${name.split('.')[1]} (${columns}) ON COMMIT DROP`);
 const db={query:(sql,params)=>c.query(Object.keys(tables).sort((a,b)=>b.length-a.length).reduce((s,t)=>s.replaceAll(t,'test_'+t.split('.')[1]),sql),params)};
 const record={id:'test',reimbursement:{erpDocument:{company:'2',series:'1',code:'123'}}};
 const status=async()=> (await reimbursementReceipts([record],db))[0].reimbursement.status;
 await c.query("INSERT INTO test_conhecimentos VALUES(2,'1',123,2)");
 assert.equal(await status(),'cobrado');
 await c.query("INSERT INTO test_receber VALUES(2,'A',10,1,100,100,1),(2,'A',10,2,100,100,1)");
 await c.query("INSERT INTO test_receberconhecimentosvinculados VALUES(2,'A',10,'1',123),(2,'A',10,'1',123)");
 assert.equal(await status(),'cobrado');
 await c.query("INSERT INTO test_receberrecebimentos VALUES(2,'A',10,1,100,'2026-11-20')");
 await c.query('UPDATE test_receber SET valorabertorec=0 WHERE parcelarec=1');
 assert.equal(await status(),'cobrado');
 await c.query('UPDATE test_receber SET valorabertorec=0');
 assert.equal(await status(),'cobrado'); // zero balance alone is not proof
 await c.query("INSERT INTO test_receberrecebimentos VALUES(2,'A',10,2,100,'2026-11-21')");
 assert.equal(await status(),'recebido');
 assert.equal((await reimbursementReceipts([record],db))[0].reimbursement.receivedDate,'2026-11-21');
 await c.query('UPDATE test_receber SET valorabertorec=1 WHERE parcelarec=2');
 assert.equal(await status(),'cobrado');
 await c.query('UPDATE test_receber SET valorabertorec=0,statusrec=3 WHERE parcelarec=2');
 assert.equal(await status(),'cobrado');
 await c.query('UPDATE test_receber SET statusrec=1');
 await c.query("UPDATE test_receberconhecimentosvinculados SET serieconhecimento='2'");
 assert.equal(await status(),'cobrado');
 await c.query("INSERT INTO test_receberconhecimentos VALUES(2,'A',10,1,123),(2,'A',10,2,123)");
 assert.equal(await status(),'recebido');
 await c.query("INSERT INTO test_conhecimentos VALUES(2,'2',123,2)");
 assert.equal(await status(),'cobrado'); // ambiguous legacy link

} finally {await c.query('ROLLBACK');c.release();await pool.end();}

});
