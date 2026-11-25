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

test('sem veiculo persiste, edita, lista e audita sem placa ficticia', {skip:process.env.PLANTAO_DB_TEST !== '1'}, async t=>{
  const original = config.db.schema;
  const schema = `plantao_test_${Date.now()}`;
  const driver = {id:42,login:'motorista',permissions:{'manutencao-plantao':true}};
  const reviewer = {id:43,login:'financeiro',permissions:{'conferencia-manutencao':true}};
  const makeApp = user => {
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});
    app.use(requireRoutePermission);app.use(enforceReadOnly);app.use(manutencaoPlantaoRouter);
    app.use((error,_req,res,_next)=>res.status(error.statusCode || 500).json({error:error.message}));return app;
  };
  const driverApp=makeApp(driver), reviewerApp=makeApp(reviewer);
  const body={plate:'ABC1234',amount:200,service:'Borracharia',supplier:'Oficina Teste',paymentDetails:{holderName:' Titular Teste ',pixKey:' teste@example.com '},expenseDate:'2026-09-30',document:'NF-123',documentType:'nf_produto',receiptReason:'Fornecedor nao emitiu comprovante.'};
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
      await client.query(await fs.readFile(new URL('../sql/054_plantao_pago_lancado.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/055_plantao_data_pagamento.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/056_plantao_despesas_motorista.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/057_plantao_fotos_ocr.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/058_plantao_arla.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/060_plantao_dados_nota_telemetria.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/061_plantao_fluxo_conferencia.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/072_plantao_forma_pagamento.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/073_plantao_descarga.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/074_plantao_documento_pneu_viagem.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/076_plantao_dados_pagamento.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/078_plantao_reembolso.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/080_despesa_pneu_vinculado.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/081_despesa_documento_erp.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../sql/094_despesa_documentos_erp.sql',import.meta.url),'utf8'));
      assert.equal((await client.query('SELECT data_despesa::text AS dia FROM manutencao_plantao')).rows[0].dia,'2026-09-30');
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
    config.db.schema=schema;
    t.mock.method(getVeiculosPool(),'query',async()=>({rows:[{placa:'ABC1234'}]}));
    t.mock.method(clientPool,'query',async()=>({rows:[]}));
    // Expenses explicitly unassigned to a vehicle survive storage, edits and audit.
    const unassigned={...body,plate:'',withoutVehicle:true,service:'Outros',amount:77,document:'NO-VEHICLE',note:'Material de escritorio',trip:null};
    const noVehicle=await request(driverApp).post(path).send(unassigned).expect(201);
    const noVehicleId=noVehicle.body.record.id;
    assert.equal(noVehicle.body.record.withoutVehicle,true);
    assert.equal(noVehicle.body.record.plate,'');assert.equal(noVehicle.body.record.trip,null);
    const storedNoVehicle=(await request(driverApp).get(path)).body.records.find(r=>r.id===noVehicleId);
    assert.equal(storedNoVehicle.plate,'');
    const assign=await request(driverApp).put(`${path}/${noVehicleId}`).send({...unassigned,withoutVehicle:false,plate:'ABC1234',version:1}).expect(200);
    assert.equal(assign.body.record.withoutVehicle,false);
    await request(driverApp).put(`${path}/${noVehicleId}`).send({...unassigned,version:2}).expect(200);
    const noVehicleAudit=(await request(driverApp).get(`${path}/${noVehicleId}/historico`)).body.history;
    assert.equal(noVehicleAudit[0].antes.placa,'ABC1234');assert.equal(noVehicleAudit[0].depois.placa,'');
  } finally {
    config.db.schema=original;
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await pool.end();await clientPool.end();await getVeiculosPool().end();
  }
});
