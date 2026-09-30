import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { clientPool } from '../src/db/clientPool.js';
import { precoCargaErpV2Router, quotationPaging } from '../src/routes/precoCargaErpV2.js';

test('carrega planilha sem exigir origem ou destino', async t => {
  let query;
  t.mock.method(clientPool, 'query', async (sql, params) => {
    query = { sql, params };
    return { rows: [] };
  });
  const app = express();
  app.use(express.json());
  app.use(precoCargaErpV2Router);
  const response = await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({ meses: '24' }).expect(200);
  assert.deepEqual(response.body.fretes, []);
  assert.equal(query.params[2], '');
  assert.equal(query.params[3], '');
  assert.ok(query.sql.includes("$3::text='' OR"));
  assert.ok(query.sql.includes("$4::text='' OR"));
});

test('limita a página no SQL, indica próxima página e separa cache por página', async t => {
  const queries = [];
  t.mock.method(clientPool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows: Array.from({ length: 26 }, (_, id) => ({ id, valor: 100 })) };
  });
  const app = express(); app.use(express.json()); app.use(precoCargaErpV2Router);
  for (const page of [2, 3]) {
    const { body } = await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({ page, pageSize: 25 }).expect(200);
    assert.equal(body.page, page);
    assert.equal(body.fretes.length, 25);
    assert.equal(body.hasMore, true);
    assert.deepEqual(queries.at(-1).params.slice(-2), [26, (page - 1) * 25]);
    assert.ok(queries.at(-1).sql.includes('FROM base ORDER BY data DESC, id DESC LIMIT'));
    assert.ok(!queries.at(-1).sql.includes('OVER()'));
  }
  assert.equal(queries.length, 2);
});

test('filtra e ordena antes de paginar sem interpolar conteúdo do usuário', async t => {
  let query;
  t.mock.method(clientPool, 'query', async (sql, params) => { query = { sql, params }; return { rows: [] }; });
  const app = express(); app.use(express.json()); app.use(precoCargaErpV2Router);
  const { body } = await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({
    page: 4, filters: { clienteInicial: "Empresa d'Água" }, sort: { field: 'valor', direction: 'asc' },
  }).expect(200);
  assert.equal(body.hasMore, false);
  assert.ok(query.params.includes("%EMPRESA D'AGUA%"));
  assert.ok(!query.sql.includes("EMPRESA D'AGUA"));
  assert.ok(query.sql.includes('ORDER BY valor ASC, id ASC'));
  assert.deepEqual(query.params.slice(-2), [26, 75]);
});

test('valida limites e usa lista de colunas permitidas', () => {
  assert.deepEqual(quotationPaging({ page: -1, pageSize: 5000, sort: { field: 'DROP TABLE', direction: 'invalid' }, filters: { unknown: 'x' } }),
    { page: 1, pageSize: 100, sort: 'data', direction: 'DESC', filters: {} });
});
