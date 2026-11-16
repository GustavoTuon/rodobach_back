import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {manutencaoPlantaoRouter} from '../src/routes/manutencaoPlantao.js';
import {pool} from '../src/db/pool.js';
function app(permissions){const a=express();a.use(express.json());a.use((req,res,next)=>{req.user={id:1,permissions};next();});a.use(manutencaoPlantaoRouter);return a;}
test('busca coincidências por placa, valor e fornecedor nas últimas 72 horas, ignorando excluídos e o próprio registro',async t=>{
  const query=t.mock.method(pool,'query',async()=>({rows:[{id:'old',placa:'ABC1234',valor:'100.00',fornecedor:'Oficina',servico:'Mecânica',documento:'NF1',criado_em:'2026-11-16T12:00:00Z'}]}));
  const id='55926d25-6e7d-4c22-a36d-747c0402c18a';
  const response=await request(app({'manutencao-plantao':true})).post('/manutencao-plantao/duplicidades').send({plate:'ABC1234',amount:100,supplier:'Oficina',excludeId:id});
  assert.equal(response.status,200);assert.equal(response.body.matches[0].amount,100);
  const [sql,params]=query.mock.calls[0].arguments;
  assert.match(sql,/criado_em >= NOW\(\)-INTERVAL '3 days'/);assert.match(sql,/excluido_em IS NULL/);assert.match(sql,/id<>\$4/);
  assert.doesNotMatch(sql,/servico\s*=/);assert.deepEqual(params,['ABC1234',100,'Oficina',id]);
});
test('rejeita consulta sem permissão e parâmetros inválidos antes de ler os dados',async t=>{
  const query=t.mock.method(pool,'query',async()=>({rows:[]}));
  assert.equal((await request(app({})).post('/manutencao-plantao/duplicidades').send({plate:'ABC1234',amount:100,supplier:'Oficina'})).status,403);
  assert.equal((await request(app({'manutencao-plantao':true})).post('/manutencao-plantao/duplicidades').send({plate:'errada',amount:100,supplier:'Oficina'})).status,400);
  assert.equal(query.mock.callCount(),0);
});
