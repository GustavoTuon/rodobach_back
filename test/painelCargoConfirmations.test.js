import test from 'node:test';
import assert from 'node:assert/strict';
import {cargoContext,validateCargoConfirmation,applyCargoConfirmation,correctionState} from '../src/services/painelCargaConfirmacoes.js';
const now=new Date('2026-09-16T15:00:00Z');
const item={placa:'RXO6C18',contextoCarga:'a'.repeat(64),carga:{codigo:'conferir'},rota:{destino:'Santos',fonte:'Documento'}};
const record={id:1,placa:item.placa,situacao:'vazio',contexto:item.contextoCarga,usuario_nome:'Admin',confirmado_em:'2026-09-16T13:00:00Z',expira_em:'2026-09-17T15:00:00Z'};
test('empty confirmation has no expiry and survives SM changes until a new document',()=>{
 const input=validateCargoConfirmation({placa:item.placa,situacao:'vazio',confirmadoEm:record.confirmado_em,motivo:'Descarga confirmada',contexto:item.contextoCarga},now);
 assert.equal(input.expiraEm,null);
 const saved={...record,expira_em:null,documentos_referencia:['doc-1','doc-2']};
 const current={...item,contextoCarga:'b'.repeat(64),documentosCarga:['doc-2'],rota:{destino:'Base',fonte:'SM ativa'}};
 const later=new Date('2026-09-23T15:00:00Z');
 assert.equal(correctionState(saved,current,later),'Ativa');
 const applied=applyCargoConfirmation(current,saved,later);
 assert.equal(applied.carga.codigo,'vazio');assert.equal(applied.carga.horasVazio,170);
 assert.equal(applied.rota.destino,'Base');assert.equal(applied.confirmacaoManual.expiraEm,null);
 const newDoc={...current,documentosCarga:['doc-2','doc-3']};
 assert.equal(correctionState(saved,newDoc,later),'Novo documento');
 assert.equal(applyCargoConfirmation(newDoc,saved,later),newDoc);
 assert.equal(applyCargoConfirmation(current,{...saved,novo_documento_em:later},later),current);
 assert.equal(applyCargoConfirmation(current,{...saved,cancelado_em:later},later),current);
});
test('manual empty status uses discharge time and preserves automatic classification',()=>{
 const result=applyCargoConfirmation(item,record,now);
 assert.equal(result.carga.codigo,'vazio');assert.equal(result.carga.horasVazio,2);
 assert.equal(result.cargaAutomatica.codigo,'conferir');assert.equal(result.rota.destino,null);
 assert.equal(item.carga.codigo,'conferir');
 assert.equal(applyCargoConfirmation(item,{...record,situacao:'carregado'},now).carga.horasVazio,null);
});
test('cancellation and changed operations restore automatic result; expiry retains a pending reference',()=>{
 for(const row of [{...record,cancelado_em:now},{...record,contexto:'b'.repeat(64)}])assert.equal(applyCargoConfirmation(item,row,now),item);
 const expired=applyCargoConfirmation(item,{...record,expira_em:now},now);
 assert.equal(expired.carga.codigo,'vazio');assert.equal(expired.carga.confirmacaoPendente,true);assert.equal(expired.carga.horasVazio,null);
 assert.equal(correctionState(record,item,now),'Ativa');
});
test('GPS updates do not invalidate confirmation but new documents, deliveries and SMs do',()=>{
 const row={placa:item.placa,estado:'conferir',documento:'A-1'};
 const key=cargoContext(row,{id:10});
 assert.equal(cargoContext({...row,localizacao:{municipio:'Outra cidade'}},{id:10}),key);
 assert.notEqual(cargoContext(row,{id:11}),key);
 assert.notEqual(cargoContext({...row,documento:'A-2'},{id:10}),key);
 assert.notEqual(cargoContext({...row,entregaAt:now.toISOString()},{id:10}),key);
 assert.notEqual(cargoContext({...row,operacaoCarga:{pendentes:['B-1']}},{id:10}),key);
});
test('rejects invalid, future and ambiguous timestamps and enforces reason and context',()=>{
 const input={placa:item.placa,situacao:'vazio',confirmadoEm:record.confirmado_em,motivo:'Descarga confirmada',contexto:item.contextoCarga};
 assert.equal(validateCargoConfirmation(input,now).placa,item.placa);
 for(const extra of [{motivo:'abc'},{motivo:'a'.repeat(501)},{situacao:'outro'},{contexto:''},{placa:'bad'},{confirmadoEm:'2026-09-16T17:00:00Z'},{confirmadoEm:'2026-09-16T12:00'},{confirmadoEm:'2020-01-01T12:00:00Z'}])assert.throws(()=>validateCargoConfirmation({...input,...extra},now),error=>error.status===400);
});

test('custom expiry keeps loaded confirmation active beyond 24 hours until the chosen deadline',()=>{
 const input={placa:item.placa,situacao:'carregado',confirmadoEm:record.confirmado_em,motivo:'Carregado mesmo com SM finalizada',contexto:item.contextoCarga,expiraEm:'2026-09-23T23:59:00-03:00'};
 const validated=validateCargoConfirmation(input,now);
 assert.equal(validated.expiraEm,'2026-09-24T02:59:00.000Z');
 const saved={...record,situacao:validated.situacao,expira_em:validated.expiraEm};
 const active=applyCargoConfirmation(item,saved,new Date('2026-09-23T20:00:00Z'));
 assert.equal(active.carga.codigo,'carregado');
 assert.equal(active.confirmacaoManual.expiraEm,validated.expiraEm);
 assert.equal(active.carga.confirmacaoPendente,undefined);
 assert.equal(applyCargoConfirmation(item,saved,new Date(validated.expiraEm)).carga.confirmacaoPendente,true);
 for(const expiraEm of ['',null,'invalid','2026-09-23T23:59',now.toISOString(),'2026-09-15T10:00:00Z'])assert.throws(()=>validateCargoConfirmation({...input,expiraEm},now),error=>error.status===400);
 const {expiraEm,...legacy}=input;
 assert.equal(validateCargoConfirmation(legacy,now).expiraEm,'2026-09-17T15:00:00.000Z');
});
