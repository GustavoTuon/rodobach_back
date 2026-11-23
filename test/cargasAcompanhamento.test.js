import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastAlert,localClock,validateForecast,forecastFilter,saveForecast} from '../src/services/cargasAcompanhamento.js';
import {acompanhamentoRouter} from '../src/services/cargasAcompanhamento.js';
import express from 'express';
import request from 'supertest';
import {requireRoutePermission} from '../src/middleware/permissions.js';
import {enforceReadOnly} from '../src/middleware/readOnly.js';
import {pool} from '../src/db/pool.js';

test('permissoes e acesso somente consulta protegem novas rotas',async t=>{
  const connect=t.mock.method(pool,'connect',async()=>{throw new Error('No database connection expected');});
  for(const user of [{id:1,permissions:{}},{id:2,permissions:{viagens:true},readOnly:true}]){
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});app.use(requireRoutePermission,enforceReadOnly,acompanhamentoRouter);
    await request(app).post('/cargas-viagens-v2/cargas/1/nao-carregada').send({motivo:'Cliente desistiu'}).expect(403);
    if(!user.readOnly)await request(app).get('/cargas-viagens-v2/alertas').expect(403);
  }
  assert.equal(connect.mock.callCount(),0);
});

test('previsoes validam calendario, hora e tipo sem normalizar datas inexistentes',()=>{
  for(const value of ['2026-02-30T12:00','2026-11-23T24:01','2026-11-23',{},false,'1999-01-01T10:00','2026-11-23T10:00Z'])assert.throws(()=>validateForecast(value));
  assert.equal(validateForecast('2028-02-29T23:59'),'2028-02-29T23:59');
  assert.equal(validateForecast(''),null);
});
test('alertas respeitam Brasilia, virada do dia e pendencias operacionais',()=>{
  const now=new Date('2026-11-24T01:30:00Z');
  assert.equal(localClock(now),'2026-11-23T22:30');
  for(const [previsao,nivel] of [[null,'sem_previsao'],['2026-11-23T22:29','vencida'],['2026-11-23T22:30','hoje'],['2026-11-23T23:59','hoje'],['2026-11-24T00:01','amanha'],['2026-11-25T09:00','no_prazo']]){
    assert.equal(forecastAlert({status:'aguardando_viagem',acompanhamento:{previsao}},'carga',now).nivel,nivel);
  }
  for(const status of ['entregue','cancelado','nao_carregada','em_transito'])assert.equal(forecastAlert({status},'carga',now),null);
  assert.equal(forecastAlert({situacao:'em_transito',acompanhamento:{previsao:'2026-11-23T22:29'}},'viagem',now).nivel,'vencida');
  assert.equal(forecastAlert({situacao:'entregue'},'viagem',now),null);
  assert.equal(forecastAlert({status:'aguardando_cte'},'carga',now).pendencia,'Conferir CT-e');
  assert.equal(forecastAlert({status:'aguardando_viagem',acompanhamento:{previsao:'2027-01-01T00:00'}},'carga',new Date('2027-01-01T01:00:00Z')).nivel,'amanha');
});
test('filtro rejeita texto arbitrario e inclui timezone e estados ativos',()=>{
  assert.throws(()=>forecastFilter('carga',"' OR true"));
  assert.match(forecastFilter('carga','vencida'),/America\/Sao_Paulo/);
  assert.match(forecastFilter('viagem','sem_previsao'),/entregue/);
});
test('reagendamento exige motivo, detecta conflito e preserva historico',async()=>{
  let state={previsao:'2026-11-24T10:00',historico:[{tipo:'original'}]};
  const db={async query(sql,args){if(sql.startsWith('SELECT'))return {rows:[{acompanhamento:state}]};state=JSON.parse(args[1]);return {rows:[]};}};
  const change={previsao:'2026-11-25T10:00',previsaoAnterior:'2026-11-24T10:00'};
  await assert.rejects(saveForecast(db,'carga',1,change,{login:'teste'}),/motivo/);
  await saveForecast(db,'carga',1,{...change,motivoPrevisao:'Cliente reagendou'},{login:'teste'});
  assert.equal(state.historico.length,2);assert.equal(state.historico[1].usuario,'teste');
  assert.equal(state.historico[1].anterior,change.previsaoAnterior);
  await assert.rejects(saveForecast(db,'carga',1,{...change,motivoPrevisao:'Outra mudança'},{login:'teste'}),{statusCode:409});
  await saveForecast(db,'carga',1,{},{});assert.equal(state.previsao,change.previsao);
});
