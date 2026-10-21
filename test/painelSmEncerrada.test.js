import test from 'node:test';
import assert from 'node:assert/strict';
import {latestFinishedSm,finishedSmEvidence} from '../src/services/painelSmEncerrada.js';
import {tvLoad} from '../src/services/painelTvService.js';
const now=new Date('2026-10-21T18:00:00Z');
const sm={id:123,placa:'RAA8G58',statusCodigo:'5',inicio:'2026-10-20T10:00:00Z',fim:'2026-10-21T15:00:00Z'};
const row={placa:sm.placa,operacaoCarga:{inicio:sm.inicio,ultimaEmissao:sm.inicio,pendentes:['A','B']}};
const locations=[{tipo_local:'ENTREGA',descricao:'Cliente A'},{tipo_local:'DESTINO',descricao:'Cliente B'}];
const events=[{tipo:'descarga',ponto:'Cliente A',dataHora:'2026-10-21T12:00:00Z'},
 {tipo:'descarga',ponto:'Cliente B',dataHora:'2026-10-21T14:00:00Z'},
 {tipo:'fim_viagem',dataHora:sm.fim}];
const input={row,sm,locations,events,manifestos:[],now};
test('closed SM and all mapped discharges confirm empty even with old unclosed documents',()=>{
 const result=finishedSmEvidence(input);
 assert.equal(result.codigo,'vazio');assert.equal(result.horasVazio,4);assert.equal(result.confirmacaoPendente,false);
 assert.equal(tvLoad({...row,smEncerrada:result},null,now).codigo,'vazio');
});
test('closing event alone is probable empty, never starts empty hours',()=>{
 for(const guide of [locations,null,[]]){
  const result=finishedSmEvidence({...input,locations:guide,events:[events[2]]});
  assert.equal(result.codigo,'provavelmente_vazio');assert.equal(result.horasVazio,null);assert.equal(result.confirmacaoPendente,true);
 }
});
test('partial discharge cannot become probable empty even with end of trip',()=>{
 assert.equal(finishedSmEvidence({...input,events:[events[0],events[2]]}),null);
});
test('new documents and later loading prevent automatic empty',()=>{
 for(const at of ['2026-10-21T14:30:00Z','2026-10-21T16:00:00Z']){
  assert.equal(finishedSmEvidence({...input,row:{...row,emissaoAt:at}}),null);
  assert.equal(finishedSmEvidence({...input,events:[...events,{tipo:'carregado',dataHora:at}]}),null);
 }
});
test('manifest unavailable or open, invalid dates, canceled SM and wrong plate cannot confirm',()=>{
 for(const override of [{manifestos:null},{manifestos:[{numero:1}]},{sm:{...sm,statusCodigo:'6'}},
  {sm:{...sm,placa:'ABC1234'}},{sm:{...sm,fim:'2026-10-22T15:00:00Z'}},{sm:{...sm,inicio:null}},
  {row:{placa:row.placa}},{row:{...row,emissaoAt:'bad'}}]) assert.equal(finishedSmEvidence({...input,...override}),null);
});
test('events outside SM and unlocated discharge never confirm empty',()=>{
 for(const changes of [{dataHora:'2026-10-19T12:00:00Z'},{dataHora:'2026-10-21T16:00:00Z'},{ponto:'Outro local'},{tipo:'chegada'}]){
  assert.equal(finishedSmEvidence({...input,events:events.slice(0,2).map(e=>({...e,...changes}))}),null);
 }
});
test('incomplete history or a newer started SM prevents using an old closed trip',()=>{
 assert.equal(latestFinishedSm({rows:[sm],incompleto:true},sm.placa,now),null);
 assert.equal(latestFinishedSm({rows:[sm,{...sm,id:124,inicio:'2026-10-21T16:00:00Z',fim:null}]},sm.placa,now),null);
 assert.equal(latestFinishedSm({rows:[sm]},sm.placa,now).id,123);
 assert.equal(latestFinishedSm({rows:[sm,{...sm,id:124}]},sm.placa,now),null);
});
test('Brazilian timestamps are parsed and future scheduled SM does not hide completed trip',()=>{
 const finished={...sm,inicio:'20/10/2026 07:00:00',fim:'21/10/2026 12:00:00'};
 assert.equal(finishedSmEvidence({...input,sm:finished}).codigo,'vazio');
 assert.equal(latestFinishedSm({rows:[finished,{...sm,id:124,inicio:'2026-10-22T10:00:00Z',fim:null}]},sm.placa,now).id,123);
});
