import test from 'node:test';
import assert from 'node:assert/strict';
import {reimbursementReceipts,reimbursementList} from '../src/services/expenseReimbursementReceipts.js';

const record={id:'one',paid:true,posted:false,reimbursement:{status:'cobrado',customer:'Cliente',document:'CT-e 123',note:'Teste',receivedDate:null,erpDocument:{company:'2',series:'1',code:'123'}}};
test('consulta em lote preserva despesa e identifica documento completo',async()=>{
  let calls=0;
  const plain={id:'manual',reimbursement:{status:'a_cobrar'}};
  const db={query:async(_sql,params)=>{calls++;assert.deepEqual(JSON.parse(params[0]),[{id:'one',company:'2',series:'1',code:'123'}]);return {rows:[{id:'one',paid:true,date:'2026-11-23'}]};}};
  const rows=await reimbursementReceipts([record,plain],db);
  assert.equal(calls,1);
  assert.deepEqual(rows[0],{...record,reimbursement:{...record.reimbursement,status:'recebido',receivedDate:'2026-11-23'}});
  assert.equal(rows[1],plain);
  assert.equal(record.reimbursement.status,'cobrado');
});
test('saldo reaberto ou documento sem financeiro remove recebimento antigo',async()=>{
  for(const rows of [[],[{id:'one',paid:false,date:'2026-11-23'}]]){
    const [result]=await reimbursementReceipts([{...record,reimbursement:{...record.reimbursement,status:'recebido',receivedDate:'2026-11-23'}}],{query:async()=>({rows})});
    assert.equal(result.reimbursement.status,'cobrado');
    assert.equal(result.reimbursement.receivedDate,null);
  }
});
test('sem vinculo nao consulta ERP; falha de consulta nao inventa recebimento',async()=>{
  const db={query:async()=>{throw new Error('ERP offline');}};
  assert.deepEqual(await reimbursementReceipts([{id:'manual'}],db),[{id:'manual'}]);
  await assert.rejects(reimbursementReceipts([record],db),/ERP offline/);
});

test('falha no ERP preserva a lista com aviso de dados nao atualizados',async()=>{
 const result=await reimbursementList([record],{query:async()=>{throw new Error('Offline');}});
 assert.deepEqual(result.records,[record]);
 assert.ok(result.reimbursementWarning);
});
