import test from 'node:test';
import assert from 'node:assert/strict';
import {tvLoad} from '../src/services/painelTvService.js';
import {cargoOperationEvidence, pendingDocumentsInOperation} from '../src/services/statusCargaService.js';
const now = new Date('2026-09-22T15:00:00Z');
const doc = {documento:'1-4528', viagem:859, empresaOperacao:1, pesoKg:8000, emissaoAt:'2026-09-19T17:59:00Z', entregaAt:'2026-09-19T18:00:00Z'};
const sm = {id:519033, status:'EM VIAGEM', inicio:'19/09/2026 16:19:32'};

test('partial delivery keeps vehicle loaded, including future delivery dates and without SM', () => {
 const op=cargoOperationEvidence([doc,{...doc,documento:'1-4522',emissaoAt:'2026-09-19T17:00:00Z',entregaAt:'2026-09-25T12:00:00Z'}],now);
 assert.deepEqual(op.pendentes,['1-4522']);
 for(const trip of [sm,null]){
  const result=tvLoad({operacaoCarga:op,trafegusDivergente:true,documento:doc.documento},trip,now);
  assert.equal(result.codigo,'carregado');assert.equal(result.label,'Carregado');assert.equal(result.horasVazio,null);
 }
});
test('company and trip delimit the operation; cancelled and future documents are excluded', () => {
 const other={...doc,empresaOperacao:2,entregaAt:null,emissaoAt:'2026-09-18T12:00:00Z'};
 assert.deepEqual(pendingDocumentsInOperation(doc,[doc,other]),[doc]);
 const op=cargoOperationEvidence([doc,other,{...doc,emissaoAt:'2026-09-25T12:00:00Z',entregaAt:null},
  {...doc,statusConhecimento:'CANCELADO',emissaoAt:'2026-09-22T12:00:00Z',entregaAt:null}],now);
 assert.equal(op.entregaFinal,doc.entregaAt);assert.deepEqual(op.pendentes,[]);
});
test('new SM does not turn old delivery into a current conflict or assert a new load', () => {
 const result=tvLoad({operacaoCarga:cargoOperationEvidence([doc],now)}, {...sm,id:519194,inicio:'22/09/2026 07:08:42'},now);
 assert.equal(result.codigo,'sem_confirmacao');assert.equal(result.confirmacaoPendente,true);
 assert.equal(result.horasVazio,null);assert.match(result.fonte,/posterior/);
});
test('empty time starts at the last delivery of the operation', () => {
 const last={...doc,documento:'1-4522',emissaoAt:'2026-09-18T12:00:00Z',entregaAt:'2026-09-22T12:00:00Z'};
 const result=tvLoad({operacaoCarga:cargoOperationEvidence([doc,last],now)},null,now);
 assert.equal(result.codigo,'vazio');assert.equal(result.horasVazio,3);assert.equal(result.confirmacaoPendente,false);
 const activeSm=tvLoad({operacaoCarga:cargoOperationEvidence([doc,last],now)},{...sm,operacao:'CARREGADO'},now);
 assert.equal(activeSm.codigo,'vazio');assert.equal(activeSm.confirmacaoPendente,true);assert.equal(activeSm.horasVazio,null);
});
test('SM requires explicit load type, actual start and no end', () => {
 for(const trip of [sm,{...sm,operacao:'CARREGADO',fim:'22/09/2026 09:00:00'},
  {...sm,operacao:'CARREGADO',inicio:'23/09/2026 09:00:00'}])assert.equal(tvLoad({},trip,now).codigo,'sem_confirmacao');
 assert.equal(tvLoad({},{...sm,operacao:'CARREGADO'},now).codigo,'carregado');
 assert.equal(tvLoad({},{...sm,operacao:'VAZIO'},now).codigo,'vazio');
});
test('arrival, missing SM or stale documents do not prove discharge', () => {
 const pending={...doc,entregaAt:null};
 const op=cargoOperationEvidence([pending],now);
 assert.equal(tvLoad({estado:'vazio_provavel',operacaoCarga:op},null,now).codigo,'carregado');
 const old=cargoOperationEvidence([{...pending,emissaoAt:'2026-08-01T12:00:00Z'}],now);
 assert.equal(tvLoad({operacaoCarga:old},null,now).confirmacaoPendente,true);
 assert.equal(tvLoad({},null,now).label,'—');
});
