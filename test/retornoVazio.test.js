import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyReturnEvidence} from '../src/services/retornoVazio.js';
import {tvLoad,tvRoute} from '../src/services/painelTvService.js';
const sm={id:519330,placa:'RAA8G58',inicio:'22/09/2026 15:20:30',destino:'RODOBACH',previsaoFim:'23/09/2026 06:01:00'};
const locations=[{tipo_local:'DESTINO',refe_cod:79590}];
const history={rows:[{id:518769,placa:sm.placa,statusCodigo:5,fim:'21/09/2026 08:53:40'}]};
const now=new Date('2026-09-22T19:00:00Z');
test('base return counts empty time from previous SM closure and preserves route',()=>{
 const evidence=emptyReturnEvidence({operacaoCarga:{ultimaEmissao:'2026-09-18T10:00:00Z'}},sm,locations,history,[],now);
 assert.equal(evidence.desde,'2026-09-21T11:53:40.000Z');
 const load=tvLoad({retornoVazio:evidence},sm,now);
 assert.equal(load.codigo,'vazio');assert.ok(load.horasVazio>31);assert.equal(load.confirmacaoPendente,false);
 assert.equal(tvRoute({},sm).destino,'RODOBACH');
});
test('destination alone, new loads, intermediate deliveries and incomplete history are insufficient',()=>{
 assert.equal(emptyReturnEvidence({},sm,locations,{rows:[]},[],now),null);
 assert.equal(emptyReturnEvidence({},sm,locations,{...history,incompleto:true},[],now),null);
 assert.equal(emptyReturnEvidence({},sm,[...locations,{tipo_local:'ENTREGA'}],history,[],now),null);
 assert.equal(emptyReturnEvidence({operacaoCarga:{ultimaEmissao:'2026-09-22T10:00:00Z'}},sm,locations,history,[],now),null);
 assert.equal(emptyReturnEvidence({},sm,locations,history,[{tipo:'carregado',dataHora:'2026-09-22T10:00:00Z'}],now),null);
 assert.equal(emptyReturnEvidence({},{...sm,operacao:'CARREGADO'},locations,history,[],now),null);
 assert.equal(emptyReturnEvidence({},{...sm,fim:'22/09/2026 16:00:00'},locations,history,[],now),null);
});
