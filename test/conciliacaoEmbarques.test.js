import test from 'node:test';
import assert from 'node:assert/strict';
import { components, resolveDataEmbarque } from '../src/services/conciliacaoEmbarques.js';

test('Matiola: originais de agosto continuam em agosto com saída e complementos em setembro',()=>{
 const docs=[4426,4427].map(codigo=>({codigo,tipo:0,status:2,chave:String(codigo),data_documento:'2026-08-31'}));
 docs.push({tipo:1,status:2,chave:'complemento',data_documento:'2026-09-09'});
 assert.equal(resolveDataEmbarque(docs,[{id:'V:1:850',date:'2026-09-03'}]).data,'2026-08-31');
 assert.equal(resolveDataEmbarque([{tipo:0,status:2,chave:'4453',data_documento:'2026-09-04'}]).data,'2026-09-04');
});

test('data de orçamento, cancelamento ou complemento não antecipa a emissão do CT-e original',()=>{
 const docs=[{tipo:0,status:2,data_documento:'2026-07-01'},{tipo:0,status:3,chave:'cancelado',data_documento:'2026-06-01'},{tipo:1,status:2,chave:'complemento',data_documento:'2026-07-02'},{tipo:0,status:2,chave:'original',data_documento:'2026-08-31'}];
 assert.equal(resolveDataEmbarque(docs).data,'2026-08-31');
 assert.equal(resolveDataEmbarque([],[{id:'C:1:1',date:'2026-09-01'}]).data,'2026-09-01');
});

test('une orçamento e CT-e e cópias fiscais sem agrupar fretes independentes',()=>{
 const docs=[{empresa:1,serie:'O',codigo:10,serie_cte:'1',codigo_cte:20},{empresa:1,serie:'1',codigo:20,chave:'fiscal'},{empresa:2,serie:'1',codigo:30,chave:'fiscal'},{empresa:1,serie:'1',codigo:21}];
 const graph=components(docs);
 assert.equal(graph.root(docs[0].id),graph.root(docs[1].id));
 assert.equal(graph.root(docs[1].id),graph.root(docs[2].id));
 assert.notEqual(graph.root(docs[2].id),graph.root(docs[3].id));
 assert.equal(new Set([docs[0],docs[1],docs[0],docs[2]].map(d=>graph.root(d.id))).size,1);
});
