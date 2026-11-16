import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {colaboradoresRouter} from '../src/routes/colaboradores.js';
import {registroSchema} from '../src/services/colaboradoresService.js';
import {pool} from '../src/db/pool.js';
import {clientPool} from '../src/db/clientPool.js';
import {requireRoutePermission} from '../src/middleware/permissions.js';
const id='55926d25-6e7d-4c22-a36d-747c0402c18a';
const body={id,version:0,tipo:'advertencia_verbal',data:'2026-11-11',prazo:null,status:'pendente',descricao:'Registro de teste',responsavel:'Gestor',detalhes:{},anexos:[]};
const people=[{codigo:1,nome:'João',empresa:1,ativo:true,cargo:'Motorista'},{codigo:2,nome:'Maria',empresa:2,ativo:false,cargo:'Administrativo'}];
function app(user={id:42,permissions:{colaboradores:true}}){const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});app.use(requireRoutePermission);app.use(colaboradoresRouter);return app;}
test('permissions and read-only prevent reads/writes before database access',async t=>{
 const query=t.mock.method(pool,'query',async()=>{throw Error('Unexpected DB access');});
 assert.equal((await request(app({id:42,permissions:{}})).get('/frota/colaboradores')).status,403);
 assert.equal((await request(app({id:42,permissions:{colaboradores:true},readOnly:true})).put(`/frota/colaboradores/1/registros/${id}`).send(body)).status,403);
 assert.equal(query.mock.callCount(),0);
});
test('defaults to active; all includes inactive, name search ignores accents',async t=>{
 t.mock.method(clientPool,'query',async()=>({rows:people}));t.mock.method(pool,'query',async()=>({rows:[]}));
 const active=await request(app()).get('/frota/colaboradores');assert.equal(active.status,200);assert.deepEqual(active.body.itens.map(p=>p.codigo),[1]);
 const all=await request(app()).get('/frota/colaboradores?situacao=todos');assert.equal(all.body.itens.length,2);
 assert.equal((await request(app()).get('/frota/colaboradores?q=joao')).body.itens.length,1);
 assert.equal((await request(app()).get('/frota/colaboradores?situacao=inativos')).body.itens[0].codigo,2);
 assert.equal((await request(app()).get('/frota/colaboradores?situacao=invalid')).status,400);
});
test('validates dates, vacation order, equipment, IMEI, cancellation and attachments',()=>{
 assert.equal(registroSchema.safeParse(body).success,true);
 for(const change of [{data:'2026-02-30'},{prazo:'2026-01-01'},{tipo:'ferias',detalhes:{inicio:'2026-11-10',fim:'2026-11-09',retorno:'2026-11-11'}},{tipo:'epi',detalhes:{item:'Bota',quantidade:0}},{tipo:'celular',detalhes:{item:'Celular',imei:'123'}},{status:'cancelado'},{anexos:[{nome:'fake.pdf',data:'data:application/pdf;base64,YWJj'}]},{autor_id:9}])assert.equal(registroSchema.safeParse({...body,...change}).success,false,JSON.stringify(change));
 for(const change of [{tipo:'ferias',detalhes:{inicio:'2026-12-01',fim:'2026-12-30',retorno:'2026-12-31'}},{tipo:'celular',detalhes:{item:'Celular',imei:'123456789012345'}},{tipo:'uniforme',detalhes:{item:'Camisa',quantidade:2}}])assert.equal(registroSchema.safeParse({...body,...change}).success,true);
});
test('save uses ERP identity, session author, atomic audit and revision check',async t=>{
 t.mock.method(clientPool,'query',async()=>({rows:[people[0]]}));
 const query=t.mock.method(pool,'query',async(sql,values)=>{assert.match(sql,/INSERT INTO .*colaboradores_registros_historico/);assert.equal(values[1],1);assert.equal(values[2],'João');assert.equal(values[12],42);return {rows:[{id,revisao:1}]};});
 const saved=await request(app()).put(`/frota/colaboradores/1/registros/${id}`).send(body);assert.equal(saved.status,200);assert.equal(query.mock.callCount(),1);
});
test('stale revisions return conflict; identical retry is idempotent',async t=>{
 t.mock.method(clientPool,'query',async()=>({rows:[people[0]]}));
 let revision=3;
 t.mock.method(pool,'query',async(sql)=>({rows:sql.startsWith('WITH')?[]:[{...body,revisao:revision,atualizado_por:42}]}));
 assert.equal((await request(app()).put(`/frota/colaboradores/1/registros/${id}`).send(body)).status,409);
 revision=1;assert.equal((await request(app()).put(`/frota/colaboradores/1/registros/${id}`).send(body)).status,200);
});
test('detail excludes attachment bytes and download is scoped to employee',async t=>{
 t.mock.method(clientPool,'query',async()=>({rows:[people[0]]}));
 t.mock.method(pool,'query',async(sql,values)=>{if(sql.startsWith('SELECT anexos')){assert.equal(values[1],2);return {rows:[]};}return {rows:[{...body,anexos:[{nome:'foto.jpg',data:'private-bytes'}]}]};});
 const result=await request(app()).get('/frota/colaboradores/1');assert.deepEqual(result.body.registros[0].anexos,[{nome:'foto.jpg',index:0}]);
 assert.equal((await request(app()).get(`/frota/colaboradores/2/registros/${id}/anexos/0`)).status,404);
});
