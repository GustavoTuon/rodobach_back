import test from 'node:test';
import assert from 'node:assert/strict';
import {clientPool} from '../src/db/clientPool.js';
import {resolveExpenseErpDocuments,expenseErpDocumentsOf} from '../src/services/expenseErpDocuments.js';

const diesel={company:'2',series:'1',number:'100',installment:'1',supplierCode:'7'};
const arla={...diesel,number:'101'};
const before={placa:'RAA8G18',documento_erp:''};
test('multiple links use full identity and authoritative ERP values',async t=>{
 const query=t.mock.method(clientPool,'query',async(_sql,p)=>({rows:[{company:p[0],series:p[1],number:p[2],installment:p[3],supplierCode:p[4],plate:p[5],amount:p[2]==='100'?'2400.00':'254.59'}]}));
 const links=await resolveExpenseErpDocuments([diesel,arla],before);
 assert.equal(links.length,2);assert.equal(links.reduce((sum,x)=>sum+x.amount,0),2654.59);
 assert.deepEqual(query.mock.calls[0].arguments[1],['2','1','100','1','7','RAA8G18']);
 assert.match(query.mock.calls[0].arguments[0],/pag\.fornecedorpag::text=\$5/);
 assert.match(query.mock.calls[0].arguments[0],/upper\(vehicle.plate\).*\$6/);
 await assert.rejects(resolveExpenseErpDocuments([{...diesel,amount:1}],before),{status:400});
});
test('duplicates, missing documents and ambiguous matches are rejected',async t=>{
 t.mock.method(clientPool,'query',async()=>({rows:[{...diesel,amount:100}]}));
 await assert.rejects(resolveExpenseErpDocuments([diesel,diesel],before),/duas vezes/);
 t.mock.method(clientPool,'query',async()=>({rows:[]}));
 await assert.rejects(resolveExpenseErpDocuments([diesel],before),{status:400});
 t.mock.method(clientPool,'query',async()=>({rows:[{...diesel,amount:100},{...diesel,amount:100}]}));
 await assert.rejects(resolveExpenseErpDocuments([diesel],before),{status:400});
});
test('legacy references can only be preserved from this expense and removed explicitly',async()=>{
 const old={...before,documento_erp:'OLD'};
 assert.deepEqual(expenseErpDocumentsOf(old),[{legacy:true,number:'OLD'}]);
 assert.deepEqual(await resolveExpenseErpDocuments([{legacy:true,number:'OLD'}],old),[{legacy:true,number:'OLD'}]);
 assert.deepEqual(await resolveExpenseErpDocuments([],old),[]);
 await assert.rejects(resolveExpenseErpDocuments([{legacy:true,number:'INVENTED'}],old),{status:400});
 await assert.rejects(resolveExpenseErpDocuments([{legacy:true,number:'100'},diesel],{...old,documento_erp:'100'}),{status:400});
});
