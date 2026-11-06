import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { clientPool } from '../src/db/clientPool.js';
import { cargasViagensV2Router } from '../src/routes/cargasViagensV2.js';

const responsavel = { codigo: '1', empresa: '1' };
function mockResponsavel(t) {
  t.mock.method(clientPool, 'query', async (sql, params) => {
    assert.match(sql, /financeiro\.responsaveis/);
    assert.deepEqual(params, ['1', '1']);
    return { rows: [{ ...responsavel, nome: 'Responsável ERP' }] };
  });
}

function app() {
  const server = express();
  server.use(express.json());
  server.use(cargasViagensV2Router);
  server.use((err, _req, res, _next) => res.status(503).json({ error: err.message }));
  return server;
}

test('falha de conexão retorna erro HTTP sem rejeição assíncrona não tratada', async t => {
  mockResponsavel(t);
  t.mock.method(pool, 'connect', async () => { throw new Error('Banco indisponível'); });
  const response = await request(app()).post('/cargas-viagens-v2/cargas').send({ cliente: 'Teste', responsavel });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'Banco indisponível');
});

test('falha ao reler a carga desfaz a gravação antes de responder erro', async t => {
  mockResponsavel(t);
  const calls = [];
  let released = false;
  const query = async sql => {
    calls.push(sql);
    if (sql.includes('SELECT c.*')) throw new Error('Falha ao ler carga');
    return { rows: [{ id: 10 }], rowCount: 1 };
  };
  t.mock.method(pool, 'connect', async () => ({ query, release() { released = true; } }));
  t.mock.method(pool, 'query', async () => { throw new Error('Leitura fora da transação'); });
  const response = await request(app()).post('/cargas-viagens-v2/cargas').send({ cliente: 'Teste', responsavel, paradas: [] });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'Falha ao ler carga');
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.includes('COMMIT'));
  assert.ok(released);
});

test('carga só é confirmada após a leitura e inicia sem documentos ou viagem', async t => {
  mockResponsavel(t);
  const calls = [];
  const query = async sql => {
    calls.push(sql);
    return { rows: [{ id: 10, codigo_carga: 'C-000010', status: 'aguardando_viagem', documentos: [], paradas: [] }], rowCount: 1 };
  };
  t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
  t.mock.method(pool, 'query', async () => { throw new Error('Leitura fora da transação'); });
  const response = await request(app()).post('/cargas-viagens-v2/cargas').send({ cliente: 'Teste', responsavel, paradas: [] });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.ok(calls.findIndex(sql => sql.includes('SELECT c.*')) < calls.indexOf('COMMIT'));
  assert.equal(calls.at(-1), 'COMMIT');
  assert.deepEqual(response.body.documentos, []);
  assert.equal(response.body.status, 'aguardando_viagem');
});
