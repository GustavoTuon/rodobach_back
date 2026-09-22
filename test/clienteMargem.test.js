import test from 'node:test';
import assert from 'node:assert/strict';
import {buildClienteMargem, documentMargin, resolveMargemPeriod} from '../src/services/clienteMargemModel.js';
import {getClienteMargem} from '../src/services/clienteMargemService.js';
import {clientPool} from '../src/db/clientPool.js';

const periods = resolveMargemPeriod({startDate: '2026-09-01', endDate: '2026-09-02'});
const row = (extra = {}) => ({id: '1:A:1', empresa: 1, cliente_codigo: 1, cliente: 'Cliente teste', data: '2026-09-01', origem: 'A/SC', destino: 'B/RS', receita: '100', custo_motorista: null, cartas: [], ...extra});

test('equivalent periods cross month boundaries and invalid dates never reach the database', async t => {
  assert.deepEqual(periods.previous, {startDate: '2026-08-30', endDate: '2026-08-31'});
  t.mock.method(clientPool, 'query', () => {throw new Error('Database must not be queried');});
  for (const dates of [{startDate: '2026-02-30', endDate: '2026-03-01'}, {startDate: '2026-09-02', endDate: '2026-09-01'}, {startDate: '2020-01-01', endDate: '2026-01-01'}, {startDate: ['2026-01-01']}]) {
    await assert.rejects(getClienteMargem(dates), error => error.status === 400);
  }
});

test('missing cost never becomes zero or a 100 percent margin', () => {
  const value = buildClienteMargem([row()], periods);
  assert.equal(value.resumo.receitaSemCusto, 100);
  assert.equal(value.resumo.custoDireto, null);
  assert.equal(value.resumo.saldoParcial, null);
  assert.equal(value.resumo.margemParcial, null);
});

test('exclusive contracted freight is not added again to the driver cost', () => {
  const value = documentMargin(row({custo_motorista: 40, cartas: [{id: 'CF1', valor: 60, documentos: 1}]}));
  assert.equal(value.custoDireto, 60);
  assert.equal(value.saldoParcial, 40);
  assert.match(value.fonteCusto, /exclusiva/);
});

test('shared cards stay unassigned and are listed once even across clients', () => {
  const card = {id: 'CF1', valor: 90, documentos: 2};
  const value = buildClienteMargem([row({cartas: [card], custo_motorista: 10}), row({id: '1:A:2', cliente_codigo: 2, cartas: [card]})], periods);
  assert.equal(value.custosCompartilhados.length, 1);
  assert.equal(value.resumo.documentosComCusto, 0);
  assert.equal(value.resumo.receitaSemCusto, 200);
});

test('partial balances include only the covered revenue and preserve company identities', () => {
  const value = buildClienteMargem([row({custo_motorista: 60}), row({id: '1:A:2'}), row({id: '2:A:1', empresa: 2, custo_motorista: 120})], periods);
  assert.equal(value.resumo.receita, 300);
  assert.equal(value.resumo.receitaComCusto, 200);
  assert.equal(value.resumo.saldoParcial, 20);
  assert.equal(value.resumo.margemParcial, 10);
  assert.equal(value.clientes.length, 2);
  assert.equal(value.rotas.length, 1);
});

test('margin trend needs complete coverage in both periods and positive revenue', () => {
  const now = row({custo_motorista: 60});
  const prior = row({id: 'old', data: '2026-08-30', custo_motorista: 80});
  assert.equal(buildClienteMargem([now, prior], periods).clientes[0].variacaoMargemPp, 20);
  assert.equal(buildClienteMargem([now, prior, row({id: 'missing'})], periods).clientes[0].variacaoMargemPp, null);
  assert.equal(documentMargin(row({receita: null, custo_motorista: 60})).saldoParcial, null);
});

test('more than 10000 documents rejects a truncated report', async t => {
  t.mock.method(clientPool, 'query', async (_sql, values) => {
    assert.deepEqual(values, ['2025-12-30', '2026-01-02']);
    return {rows: Array(10001).fill(row())};
  });
  await assert.rejects(getClienteMargem({startDate: '2026-01-01', endDate: '2026-01-02'}), error => error.status === 422);
});
