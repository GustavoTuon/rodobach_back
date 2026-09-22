import test from 'node:test';
import assert from 'node:assert/strict';
import {documentosContabilizados} from '../src/services/documentosEmbarques.js';
const doc=(codigo,extra={})=>({empresa:2,serie:'1',codigo,status:2,tipo:0,chave:String(codigo),data_documento:'2026-09-04',...extra});
test('conta documentos independentes mesmo na mesma viagem e inclui os sem viagem',()=>{
 const entries=documentosContabilizados([doc(1,{viagem:821}),doc(2,{viagem:821}),doc(3)]);
 assert.equal(entries.length,3);
 assert(entries.every(e=>e.documento.data_documento==='2026-09-04'));
});
test('CT-e substitui orçamento vinculado pela emissão do CT-e; dois CT-es distintos continuam dois',()=>{
 const entries=documentosContabilizados([doc(1,{serie:'O',chave:null,data_documento:'2026-08-31'}),doc(2),doc(3)],()=> 'vinculo');
 assert.equal(entries.length,2);
 assert(entries.every(e=>e.categoria==='CT-e'&&e.documento.data_documento==='2026-09-04'));
 assert.equal(entries[0].vinculados[0].serie,'O');
});
test('orçamento ativo conta; complementos, anulações, cancelados e CT-es pendentes não',()=>{
 const entries=documentosContabilizados([doc(1,{serie:'O',chave:null,status:1}),doc(2,{status:1}),doc(3,{status:3}),doc(4,{tipo:1}),doc(5,{tipo:2})]);
 assert.equal(entries.length,1);
 assert.equal(entries[0].categoria,'Orçamento');
});
test('cópia fiscal vinculada não duplica e orçamento independente continua contando',()=>{
 const entries=documentosContabilizados([doc(1),doc(2,{empresa:1,chave:'1'}),doc(3,{serie:'O',chave:null})],d=>d.chave||String(d.codigo));
 assert.equal(entries.length,2);
});
