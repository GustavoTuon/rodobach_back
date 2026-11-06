import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {notasRouter} from '../src/routes/notas.js';
import {pool} from '../src/db/pool.js';
const id='55926d25-6e7d-4c22-a36d-747c0402c18a';
const body={id,title:'Revisar pneu',plate:'ABC1234',text:'Conferir antes da próxima viagem.',version:0};
const row={id,usuario_id:42,titulo:body.title,placa:body.plate,texto:body.text,revisao:1};
function app(user={id:42,permissions:{'bloco-notas':true}}){const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});app.use(notasRouter);return app;}
test('sem permissão e acesso somente consulta não chegam ao banco',async t=>{
 const query=t.mock.method(pool,'query',async()=>{throw Error('Unexpected database call');});
 assert.equal((await request(app({id:42,permissions:{}})).get('/notas')).status,403);
 assert.equal((await request(app({id:42,permissions:{'bloco-notas':true},readOnly:true})).put(`/notas/${id}`).send(body)).status,403);
 assert.equal(query.mock.callCount(),0);
});
test('listagem e leitura são restritas ao proprietário, inclusive administrador',async t=>{
 const query=t.mock.method(pool,'query',async(sql,params)=>{
  assert.match(sql,/usuario_id=\$[12]/);assert.ok(params.includes(77));return {rows:[]};
 });
 const admin=app({id:77,admin:true});
 assert.equal((await request(admin).get('/notas').query({q:"%' OR true"})).status,200);
 assert.equal((await request(admin).get(`/notas/${id}`)).status,404);assert.equal(query.mock.callCount(),2);
});
test('criação vincula autoria à sessão e aceita apenas campos previstos',async t=>{
 const query=t.mock.method(pool,'query',async(sql,params)=>{assert.equal(params[1],42);return {rows:[row]};});
 assert.equal((await request(app()).put(`/notas/${id}`).send({...body,usuario_id:77})).status,400);
 assert.equal((await request(app()).put(`/notas/${id}`).send({...body,title:'',plate:''})).status,400);
 const response=await request(app()).put(`/notas/${id}`).send(body);assert.equal(response.status,200);assert.equal(response.body.note.version,1);assert.equal(query.mock.callCount(),1);
});
test('repetir criação após resposta perdida não duplica a nota',async t=>{
 t.mock.method(pool,'query',async sql=>({rows:sql.startsWith('INSERT')?[]:[row]}));
 assert.equal((await request(app()).put(`/notas/${id}`).send(body)).status,200);
});
test('edição concorrente não sobrescreve nota e exclusão exige versão e dono',async t=>{
 t.mock.method(pool,'query',async(sql,params)=>{
  if(sql.startsWith('UPDATE')){assert.match(sql,/usuario_id=\$2/);assert.match(sql,/revisao=\$[36]/);assert.equal(params[1],42);return {rows:[]};}
  return {rows:[{...row,texto:'Texto mais novo no PC',revisao:3}]};
 });
 assert.equal((await request(app()).put(`/notas/${id}`).send({...body,version:1})).status,409);
 assert.equal((await request(app()).delete(`/notas/${id}`).send({version:1})).status,409);
});
