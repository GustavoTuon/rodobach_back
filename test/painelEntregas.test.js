import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryProgress} from '../src/services/painelEntregas.js';
const now=new Date('2026-09-22T15:00:00Z'),since='2026-09-20T00:00:00Z';
const stops=[{tipo_local:'ORIGEM',descricao:'Origem'},
 {tipo_local:'ENTREGA',descricao:'Cliente A',latitude:-12,longitude:-38,raio:250},
 {tipo_local:'DESTINO',descricao:'Cliente B',latitude:-6,longitude:-38,raio:250}];
const event={tipo:'descarga',dataHora:'2026-09-22T14:00:00Z',latitude:-12,longitude:-38};
test('only matched discharge advances to next stop',()=>{
 const result=deliveryProgress(stops,[event],since,null,now);
 assert.equal(result.total,2);assert.equal(result.concluidas,1);assert.equal(result.proxima.descricao,'Cliente B');
});
test('arrival, proximity and old or future discharge never mark completion',()=>{
 for(const e of [{...event,tipo:'chegada'},{...event,dataHora:'2026-09-19T10:00:00Z'}, {...event,dataHora:'2026-09-23T10:00:00Z'},{...event,latitude:null,longitude:null}]){
 const result=deliveryProgress(stops,[e],since,{latitude:-12,longitude:-38,dataHora:'2026-09-22T14:50:00Z'},now);
 assert.equal(result.concluidas,0);assert.equal(result.proxima.ordem,1);assert.match(result.proxima.situacao,/Próximo/);
 }
});
test('overlapping stops and missing trip start cannot advance the sequence',()=>{
 assert.equal(deliveryProgress([...stops,{...stops[1]}],[event],since,null,now).concluidas,0);
 assert.equal(deliveryProgress(stops,[event],undefined,null,now).concluidas,0);
});
test('stale GPS does not indicate current proximity; pending earlier stops remain first',()=>{
 const result=deliveryProgress(stops,[{...event,latitude:-6}],since,{latitude:-12,longitude:-38,dataHora:since},now);
 assert.equal(result.proxima.ordem,1);assert.equal(result.concluidas,1);assert.equal(result.proxima.situacao,'Sem confirmação de entrega');
});
