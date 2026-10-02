import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { clientPool } from '../src/db/clientPool.js';
import { precoCargaErpV2Router, quotationPaging } from '../src/routes/precoCargaErpV2.js';

test('limita os fretes por UF antes de consultar clientes e viagens', async t => {
  let sql;
  t.mock.method(clientPool, 'query', async query => { sql = query; return {rows: []}; });
  const app = express(); app.use(express.json()); app.use(precoCargaErpV2Router);
  await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({filters:{ufOrigem:['RS','SC']},page:7}).expect(200);
  assert.match(sql, /SELECT \* FROM base WHERE [\s\S]*uf_origem[\s\S]*ORDER BY data DESC, id DESC LIMIT \$\d+ OFFSET \$\d+\s*\), enriched/);
  await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({optionsField:'placa'}).expect(200);
  assert.match(sql, /SELECT DISTINCT[^\n]+FROM page_base/);
  await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({optionsField:'clienteFinal',optionsSearch:'logistica'}).expect(200);
  assert.match(sql, /cliente_inicial ON false/);
  assert.match(sql, /cliente_final ON true/);
  assert.match(sql, /viagem ON false/);
});

test('combina seleções múltiplas com parâmetros e preserva seleção vazia', async t => {
  let query;
  t.mock.method(clientPool, 'query', async (sql, params) => { query = {sql, params}; return { rows: [] }; });
  const app = express(); app.use(express.json()); app.use(precoCargaErpV2Router);
  const filters = { ufOrigem: ['SC', 'PR'], ufDestino: ['GO', 'SP'], origem: ['IÇARA/SC', 'CURITIBA/PR'], material: [] };
  await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({filters}).expect(200);
  for (const selection of Object.values(filters)) assert.ok(query.params.some(value => JSON.stringify(value) === JSON.stringify(selection)));
  assert.equal((query.sql.match(/= ANY\(\$\d+::text\[\]\)/g) || []).length, 4);
  assert.ok(!query.sql.includes('CURITIBA'));
});

test('pesquisa opções em todo histórico ignorando somente o filtro da própria coluna', async t => {
  let query;
  t.mock.method(clientPool, 'query', async (sql, params) => { query = {sql, params}; return { rows: Array.from({length: 201}, (_, i) => ({value: `Cidade ${i}`})) }; });
  const app = express(); app.use(express.json()); app.use(precoCargaErpV2Router);
  const {body} = await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({optionsField: 'origem', optionsSearch: 'Içara%', optionsPage: 2, filters: {origem: ['ANTERIOR/SC'], ufOrigem: ['SC', 'PR']}}).expect(200);
  assert.equal(body.options.length, 200);
  assert.equal(body.hasMore, true);
  assert.deepEqual(query.params.slice(-2), [201, 200]);
  assert.ok(query.params.includes('%ICARA\\%%'));
  assert.ok(!JSON.stringify(query.params).includes('ANTERIOR'));
  assert.ok(query.sql.includes('SELECT DISTINCT'));
  assert.match(query.sql, /LIKE \$\d+/);
  assert.ok(!query.sql.includes('FROM base ORDER BY'));
  await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({optionsField: 'invalid'}).expect(400);
});

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

test('aplica UFs antes de paginar e ordena pelo valor por tonelada', async t => {
  let query;
  t.mock.method(clientPool, 'query', async (sql, params) => { query={sql,params}; return {rows:[{id:1,peso:20000,valor:5000},{id:2,peso:0,valor:100}]}; });
  const app=express();app.use(express.json());app.use(precoCargaErpV2Router);
  const {body}=await request(app).post('/cargas-viagens-v2/gestao/cotacao').send({filters:{ufOrigem:'sc',ufDestino:'go',origem:'Içara'},sort:{field:'valorTonelada',direction:'asc'}}).expect(200);
  assert.equal(query.params[2],'SC');
  assert.equal(query.params[3],'GO');
  assert.ok(query.params.includes('%ICARA%'));
  assert.ok(query.sql.includes('ORDER BY valor_tonelada ASC'));
  assert.ok(query.sql.includes('b.valor * 1000 / b.peso'));
  assert.equal(body.fretes[0].valorTonelada,250);
  assert.equal(body.fretes[1].valorTonelada,null);
});
