import test from 'node:test';
import assert from 'node:assert/strict';
import {cargoMacroType,cargoMacroEvidence} from '../src/services/painelCargaMacros.js';
import {tvLoad} from '../src/services/painelTvService.js';
import {cargoOperationEvidence} from '../src/services/statusCargaService.js';
const now=new Date('2026-09-22T15:00:00Z');
const event=(descricao,dataHora='2026-09-22T13:00:00Z',id='1')=>({id,descricao,dataHora,tipo:cargoMacroType(descricao)});
test('uses macro titles, not free text, and distinguishes arrival from final discharge',()=>{
 assert.equal(cargoMacroType('13. CHEGADA NO DESTINO\n13. CHEGADA NO DESTINO'),'chegada');
 assert.equal(cargoMacroType('INICIO DE VIAGEM CARREGADO'),'carregado');
 assert.equal(cargoMacroType('FIM DE DESCARGA'),'descarga');
 assert.equal(cargoMacroType('ÚLTIMA DESCARGA CONCLUÍDA'),'vazio');
 for(const text of ['RECADO\nVEICULO VAZIO','NAO CARREGAMENTO CONCLUIDO','FIM DE PERNOITE','PREVISAO DE FIM DE DESCARGA'])assert.equal(cargoMacroType(text),null);
});
test('old-operation and future macros cannot override current documents; retransmissions deduplicate',()=>{
 const old=event('VEICULO VAZIO','2026-09-20T13:00:00Z');
 const valid=event('CHEGADA AO CLIENTE');
 const data=cargoMacroEvidence([old,event('VEICULO VAZIO','2026-09-23T13:00:00Z'),valid,{...valid,id:'2'}],'2026-09-21T12:00:00Z',now);
 assert.equal(data.confirmacao,null);assert.equal(data.historico.length,2);
 assert.equal(data.historico.at(-1).operacaoAtual,false);
});
test('arrival and end of trip request confirmation without declaring empty',()=>{
 for(const title of ['CHEGADA AO CLIENTE','FIM DE VIAGEM','FIM DE DESCARGA']){
  const macrosCarga=cargoMacroEvidence([event(title)],null,now);
  const result=tvLoad({estado:'carregado_confirmado',statusFonte:'automatico',macrosCarga},null,now);
  assert.equal(result.codigo,'carregado');assert.equal(result.confirmacaoPendente,true);assert.equal(result.horasVazio,null);
 }
});
test('explicit final discharge supersedes pending documents, but later loading supersedes discharge',()=>{
 const empty=event('ULTIMA DESCARGA CONCLUIDA');
 const load=event('CARREGAMENTO CONCLUIDO','2026-09-22T14:00:00Z','2');
 const row={operacaoCarga:{pendentes:['1-10']}};
 const result=tvLoad({...row,macrosCarga:cargoMacroEvidence([empty],null,now)},null,now);
 assert.equal(result.codigo,'vazio');assert.equal(result.horasVazio,2);
 assert.equal(tvLoad({...row,macrosCarga:cargoMacroEvidence([empty,load],null,now)},null,now).codigo,'carregado');
 const conflict=cargoMacroEvidence([empty,{...load,dataHora:empty.dataHora}],null,now);
 assert.equal(conflict.confirmacao,null);assert.equal(conflict.conflito,true);
});
test('past forecast cannot close an operation or start the empty counter',()=>{
 const op=cargoOperationEvidence([{documento:'1-4512',viagem:856,empresaOperacao:1,pesoKg:80,
  emissaoAt:'2026-09-18T20:20:02Z',entregaAt:null,entregaInformadaAt:'2026-09-19T03:00:00Z'}],now);
 assert.equal(op.entregaFinal,null);assert.deepEqual(op.pendentes,['1-4512']);
 const result=tvLoad({operacaoCarga:op},null,now);
 assert.equal(result.codigo,'carregado');assert.equal(result.confirmacaoPendente,true);assert.equal(result.horasVazio,null);
});
