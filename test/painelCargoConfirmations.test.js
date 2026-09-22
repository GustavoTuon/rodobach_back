import test from 'node:test';
import assert from 'node:assert/strict';
import {cargoContext,validateCargoConfirmation,applyCargoConfirmation,correctionState} from '../src/services/painelCargaConfirmacoes.js';
const now=new Date('2026-09-16T15:00:00Z');
const item={placa:'RXO6C18',contextoCarga:'a'.repeat(64),carga:{codigo:'conferir'},rota:{destino:'Santos',fonte:'Documento'}};
const record={id:1,placa:item.placa,situacao:'vazio',contexto:item.contextoCarga,usuario_nome:'Admin',confirmado_em:'2026-09-16T13:00:00Z',expira_em:'2026-09-17T15:00:00Z'};
test('manual empty status uses discharge time and preserves automatic classification',()=>{
 const result=applyCargoConfirmation(item,record,now);
 assert.equal(result.carga.codigo,'vazio');assert.equal(result.carga.horasVazio,2);
 assert.equal(result.cargaAutomatica.codigo,'conferir');assert.equal(result.rota.destino,null);
 assert.equal(item.carga.codigo,'conferir');
 assert.equal(applyCargoConfirmation(item,{...record,situacao:'carregado'},now).carga.horasVazio,null);
});
test('expiry, cancellation and changed operations restore the automatic result',()=>{
 for(const row of [{...record,cancelado_em:now},{...record,expira_em:now},{...record,contexto:'b'.repeat(64)}])assert.equal(applyCargoConfirmation(item,row,now),item);
 assert.equal(correctionState(record,item,now),'Ativa');
});
test('GPS updates do not invalidate confirmation but new documents, deliveries and SMs do',()=>{
 const row={placa:item.placa,estado:'conferir',documento:'A-1'};
 const key=cargoContext(row,{id:10});
 assert.equal(cargoContext({...row,localizacao:{municipio:'Outra cidade'}},{id:10}),key);
 assert.notEqual(cargoContext(row,{id:11}),key);
 assert.notEqual(cargoContext({...row,documento:'A-2'},{id:10}),key);
 assert.notEqual(cargoContext({...row,entregaAt:now.toISOString()},{id:10}),key);
});
test('rejects invalid, future and ambiguous timestamps and enforces reason and context',()=>{
 const input={placa:item.placa,situacao:'vazio',confirmadoEm:record.confirmado_em,motivo:'Descarga confirmada',contexto:item.contextoCarga};
 assert.equal(validateCargoConfirmation(input,now).placa,item.placa);
 for(const extra of [{motivo:'abc'},{motivo:'a'.repeat(501)},{situacao:'outro'},{contexto:''},{placa:'bad'},{confirmadoEm:'2026-09-16T17:00:00Z'},{confirmadoEm:'2026-09-16T12:00'},{confirmadoEm:'2020-01-01T12:00:00Z'}])assert.throws(()=>validateCargoConfirmation({...input,...extra},now),error=>error.status===400);
});
