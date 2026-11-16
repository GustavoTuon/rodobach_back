import assert from 'node:assert/strict';
import test from 'node:test';
import {pool} from '../src/db/pool.js';
import {clientPool} from '../src/db/clientPool.js';
import {searchExpenseSuppliers} from '../src/services/expenseSuppliers.js';

test('busca nomes já utilizados na Norte junto com ERP, sem atribuir código ERP ao cadastro local',async t=>{
  t.mock.method(clientPool,'query',async()=>({rows:[{nome:'Bolivar Chapa MG',codigo:10,empresa:1}]}));
  const local=t.mock.method(pool,'query',async()=>({rows:[{nome:'Bolivar Chapa MG'}]}));
  const result=await searchExpenseSuppliers('  Bolivar   Chapa MG  ');
  assert.equal(result.fornecedores.length,2);
  assert.deepEqual(result.fornecedores.find(r=>r.origem==='norte'),{nome:'Bolivar Chapa MG',codigo:null,empresa:null,origem:'norte'});
  assert.equal(result.fornecedores.find(r=>r.origem==='erp').codigo,10);
  assert.deepEqual(local.mock.calls[0].arguments[1],['Bolivar Chapa MG','%Bolivar Chapa MG%']);
  assert.match(local.mock.calls[0].arguments[0],/DISTINCT ON/);
  assert.match(local.mock.calls[0].arguments[0],/fornecedor_codigo IS NULL/);
});
test('continua buscando na Norte se ERP indisponível e avisa sobre resultado parcial',async t=>{
  t.mock.method(clientPool,'query',async()=>{throw new Error('offline');});
  t.mock.method(pool,'query',async()=>({rows:[{nome:'Bolivar Chapa MG'}]}));
  const result=await searchExpenseSuppliers('boliv');
  assert.equal(result.fornecedores[0].origem,'norte');
  assert.match(result.avisos[0],/ERP indisponível/);
});
test('escapa curingas da busca e não apresenta falha completa como nenhum fornecedor',async t=>{
  const erp=t.mock.method(clientPool,'query',async()=>({rows:[]}));
  t.mock.method(pool,'query',async()=>{throw new Error('offline');});
  const result=await searchExpenseSuppliers('oficina_100%');
  assert.equal(erp.mock.calls[0].arguments[1][1],String.raw`%oficina\_100\%%`);
  assert.equal(result.avisos.length,1);
  erp.mock.mockImplementation(async()=>{throw new Error('offline');});
  await assert.rejects(()=>searchExpenseSuppliers('boliv'),/consultar os fornecedores/);
});
