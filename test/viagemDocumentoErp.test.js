import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { clientPool } from '../src/db/clientPool.js';
import { searchTripDocuments } from '../src/services/viagemDocumentoErp.js';
import { cargasViagensV2Router } from '../src/routes/cargasViagensV2.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
const app=express();app.use(express.json());app.use(cargasViagensV2Router);app.use(errorHandler);
const doc={tipo:'carta_frete',numero:'123',empresa:'2',serie:'A',placa:'ABC1234',data:'2026-10-23'};
test('consulta ERP restringe placa, empresa e série e valida filtros',async t=>{
  const calls=[];
  t.mock.method(clientPool,'query',async(sql,args)=>{calls.push({sql,args});return {rows:[doc]};});
  const trip={tipo_propriedade:'TERCEIRO',placa_veiculo:'abc-1234'};
  await assert.rejects(searchTripDocuments(trip,{data:'2026-02-30'}));
  await assert.rejects(searchTripDocuments({...trip,tipo_propriedade:''},{}));
  assert.equal(calls.length,0);
  await searchTripDocuments(trip,{numero:'00123',empresa:'2',serie:'A',data:'2026-10-23'});
  assert.deepEqual(calls[0].args,['ABC1234','123','2026-10-23','2','A',0]);
  assert.match(calls[0].sql,/statuscfr,0\)<>3/);
  await searchTripDocuments({...trip,tipo_propriedade:'FROTA'},{page:2});
  assert.match(calls[1].sql,/logistica.controleviagens/);
  assert.deepEqual(calls[1].args,['ABC1234',50]);
});
test('mesmo documento pode vincular duas viagens; rejeita tipo errado e documento indisponível',async t=>{
  const saved=[];
  const commands=[];
  t.mock.method(pool,'connect',async()=>({release(){},query:async(sql,args)=>{
    commands.push(sql);
    if(sql.includes('FOR UPDATE'))return {rows:[{tipo_propriedade:'TERCEIRO',placa_veiculo:'ABC1234'}]};
    if(sql.includes('SET documento_erp')) saved.push(args);
    return {rows:[]};
  }}));
  let available=true;
  t.mock.method(clientPool,'query',async()=>({rows:available?[doc]:[]}));
  for(const id of [1,2]){
    const response=await request(app).put(`/cargas-viagens-v2/viagens/${id}/documento-erp`).send({documento:doc}).expect(200);
    assert.equal(response.body.documentoErp.numero,'123');
  }
  assert.equal(saved.length,2);
  await request(app).put('/cargas-viagens-v2/viagens/1/documento-erp').send({documento:{...doc,tipo:'viagem_frota'}}).expect(400);
  available=false;
  await request(app).put('/cargas-viagens-v2/viagens/1/documento-erp').send({documento:doc}).expect(409);
  assert.equal(saved.length,2);
  assert.equal(commands.at(-1),'ROLLBACK');
  await request(app).put('/cargas-viagens-v2/viagens/1/documento-erp').send({documento:null}).expect(200);
  assert.equal(saved.at(-1)[1],null);
});
