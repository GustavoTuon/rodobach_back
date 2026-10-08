import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import {pool} from '../src/db/pool.js';
import {clientPool} from '../src/db/clientPool.js';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {config, quoteIdent} from '../src/config.js';
import {manutencaoPlantaoRouter} from '../src/routes/manutencaoPlantao.js';
import {requireRoutePermission} from '../src/middleware/permissions.js';
import {enforceReadOnly} from '../src/middleware/readOnly.js';

test('controle de custos: concorrência, autoria, edição, exclusão, auditoria e conferência', {skip:process.env.PLANTAO_DB_TEST !== '1'}, async t=>{
  const original = config.db.schema;
  const schema = `plantao_test_${Date.now()}`;
  const driver = {id:42,login:'motorista',permissions:{'manutencao-plantao':true}};
  const reviewer = {id:43,login:'financeiro',permissions:{'conferencia-manutencao':true}};
  const makeApp = user => {
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});
    app.use(requireRoutePermission);app.use(enforceReadOnly);app.use(manutencaoPlantaoRouter);
    app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));return app;
  };
  const driverApp=makeApp(driver), reviewerApp=makeApp(reviewer);
  const body={plate:'ABC1234',amount:200,service:'Borracharia',supplier:'Oficina Teste',expenseDate:'2026-09-30',document:'NF-123'};
  const path='/manutencao-plantao/lancamentos';
  try {
    await pool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`);
      const baseline=await fs.readFile(new URL('../sql/048_permissoes_telas_plantao.sql',import.meta.url),'utf8');
      await client.query(baseline.slice(baseline.indexOf('CREATE TABLE IF NOT EXISTS manutencao_plantao')));
      await client.query("INSERT INTO manutencao_plantao (id,placa,valor,servico,usuario_id,usuario_login,criado_em) VALUES ('55926d25-6e7d-4c22-a36d-747c0402c18a','DEF4G56',15,'Outros',42,'motorista','2026-10-01T01:00:00Z')");
      const migration=await fs.readFile(new URL('../sql/050_plantao_controle_custos.sql',import.meta.url),'utf8');
      await client.query(migration);await client.query(migration);
      assert.equal((await client.query('SELECT data_despesa::text AS dia FROM manutencao_plantao')).rows[0].dia,'2026-09-30');
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    config.db.schema=schema;
    t.mock.method(getVeiculosPool(),'query',async()=>({rows:[{placa:'ABC1234'},{placa:'DEF4G56'}]}));
    t.mock.method(clientPool,'query',async()=>({rows:[]}));
    const parallel=await Promise.all([request(driverApp).post(path).send(body),request(driverApp).post(path).send(body)]);
    assert.deepEqual(parallel.map(r=>r.status).sort(),[201,409]);
    let record=parallel.find(r=>r.status===201).body.record;
    assert.equal(record.authorId,42);assert.equal(record.expenseDate,'2026-09-30');assert.equal(record.version,1);
    const id=record.id;
    assert.equal((await request(driverApp).post(path).send({...body,plate:'DEF4G56',amount:250,expenseDate:'2026-09-29',document:'nf 123'})).status,409);
    assert.equal((await request(makeApp({...driver,id:99})).put(`${path}/${id}`).send({...body,version:1})).status,403);
    assert.equal((await request(makeApp({...driver,id:99})).delete(`${path}/${id}`).send({version:1,reason:'duplicado'})).status,403);
    assert.equal((await request(makeApp({...driver,id:99})).get(`${path}/${id}/historico`)).status,403);
    let response=await request(reviewerApp).put(`/manutencao-plantao/conferencia/${id}`).send({...body,amount:220,version:1});
    assert.equal(response.status,200,JSON.stringify(response.body));record=response.body.record;
    assert.equal(record.authorId,42);assert.equal(record.version,2);assert.equal(record.amount,220);
    assert.equal((await request(driverApp).put(`${path}/${id}`).send({...body,version:1})).status,409);
    assert.equal((await request(reviewerApp).patch(`/manutencao-plantao/conferencia/${id}`).send({version:1})).status,409);
    response=await request(driverApp).get(`${path}/${id}/historico`);
    assert.equal(response.body.history.length,2);assert.equal(Number(response.body.history[0].antes.valor),200);assert.equal(Number(response.body.history[0].depois.valor),220);assert.equal(response.body.history[0].usuario_login,'financeiro');
    response=await request(reviewerApp).patch(`/manutencao-plantao/conferencia/${id}`).send({version:2});
    assert.equal(response.status,200);assert.equal(response.body.record.checkedBy,'financeiro');
    assert.equal((await request(driverApp).put(`${path}/${id}`).send({...body,version:3})).status,409);
    assert.equal((await request(driverApp).delete(`${path}/${id}`).send({version:3,reason:'duplicado'})).status,409);
    response=await request(driverApp).post(path).send({...body,document:'NF-456',amount:100});
    assert.equal(response.status,201);const removed=response.body.record.id;
    assert.equal((await request(driverApp).delete(`${path}/${removed}`).send({version:1,reason:'Lançado por engano'})).status,200);
    response=await request(driverApp).get(path);assert.ok(!response.body.records.some(r=>r.id===removed));
    response=await request(driverApp).get(`${path}/${removed}/historico`);assert.equal(response.body.history[0].evento,'delete');assert.equal(response.body.history[0].depois.motivo_exclusao,'Lançado por engano');
    assert.equal((await request(driverApp).post(path).send({...body,document:'NF-456',amount:100})).status,201);
  } finally {
    config.db.schema=original;
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await pool.end();await clientPool.end();await getVeiculosPool().end();
  }
});
