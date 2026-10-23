import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { clientPool } from '../src/db/clientPool.js';
import { viagensRouter } from '../src/routes/viagens.js';

const app = express();
app.use(viagensRouter);
test('plate/day search validates filters and paginates without losing the extra result', async t => {
  const calls = [];
  t.mock.method(clientPool, 'query', async (sql, params) => {
    calls.push({sql, params});
    return {rows: Array.from({length:101}, (_, i) => ({numero:i+1,empresa:2,serie:'1'}))};
  });
  for (const query of [{placa:'ABC1234'}, {placa:'ABC1234',data:'2026-02-30'}, {placa:'invalid',data:'2026-10-23'}, {placa:'ABC1234',data:'2026-10-23',page:-1}]) {
    await request(app).get('/viagens/documentos-financeiros').query(query).expect(400);
  }
  assert.equal(calls.length, 0);
  const response = await request(app).get('/viagens/documentos-financeiros').query({placa:'abc-1234',data:'2026-10-23',page:2}).expect(200);
  assert.deepEqual(calls[0].params, ['ABC1234','2026-10-23',101,100]);
  assert.match(calls[0].sql, /con.dataemissaocon >= \$2::date/);
  assert.match(calls[0].sql, /con.dataemissaocon < \$2::date \+ INTERVAL '1 day'/);
  assert.match(calls[0].sql, /COALESCE\(con.statuscon, 0\) <> 3/);
  assert.equal(response.body.items.length,100);
  assert.equal(response.body.hasMore,true);
  assert.equal(response.body.page,2);
});
test('legacy number and key search keep array response', async t => {
  const calls=[];
  t.mock.method(clientPool,'query',async (_,params)=> {calls.push(params); return {rows:[{numero:42}]};});
  const response=await request(app).get('/viagens/documentos-financeiros?q=0042').expect(200);
  assert.equal(response.body[0].numero,'42');
  assert.deepEqual(calls[0],['0042',false,30,0]);
  await request(app).get('/viagens/documentos-financeiros').query({q:'1'.repeat(44)}).expect(200);
  assert.equal(calls[1][1],true);
});
