import test from 'node:test';
import assert from 'node:assert/strict';
import {includedFilterPlans, canAdvanceMaintenance, registerMaintenance} from '../src/services/maintenanceRegistration.js';

const plans = [
  {id: 1, titulo: 'VW - Troca de óleo motor', tipo_controle: 'km', intervalo_km: 40000},
  {id: 2, titulo: 'Troca de Filtros intermediária', tipo_controle: 'km', intervalo_km: 20000},
  {id: 3, titulo: 'Óleo diferencial', tipo_controle: 'km', intervalo_km: 150000},
  {id: 4, titulo: 'Filtro de ar', tipo_controle: 'km', intervalo_km: 30000},
];
const service = {automacao_id: 1, placa: 'ABC1D23', tipo_movimento: 'troca_oleo_motor', descricao: 'Troca completa', data_servico: '2026-09-16', km_servico: 600000};

test('complete motor oil service includes only intermediate filter plans', () => {
  assert.deepEqual(includedFilterPlans(plans, service).map(plan => plan.id), [2]);
  for (const title of ['Troa de Filtro Intermediaria', 'Troca de Filtro intermediários Combustivel']) {
    assert.equal(includedFilterPlans([plans[0], {...plans[1], titulo: title}], service).length, 1);
  }
  assert.deepEqual(includedFilterPlans(plans, {...service, automacao_id: 3}), []);
  assert.deepEqual(includedFilterPlans(plans, {...service, automacao_id: 2, tipo_movimento: 'filtro_combustivel'}), []);
  assert.deepEqual(includedFilterPlans(plans, {...service, descricao: 'Completar óleo', automacao_id: null}), []);
});

test('older dates or lower odometers never move the maintenance reference back', () => {
  assert.equal(canAdvanceMaintenance({data_servico: '2026-09-17', km_servico: 590000}, service), false);
  assert.equal(canAdvanceMaintenance({data_servico: '2026-09-15', km_servico: 610000}, service), false);
  assert.equal(canAdvanceMaintenance({data_servico: new Date('2026-09-15'), km_servico: 590000}, service), true);
});

function mockPool({history = [], failUpdate = false} = {}) {
  const calls = [];
  let id = 10, released = false;
  const client = {release() {released = true;}, async query(sql, params) {
    calls.push({sql, params});
    if (sql.includes('FOR UPDATE')) {assert.equal(params[0], service.placa); return {rows: plans};}
    if (sql.includes('SELECT DISTINCT')) return {rows: history};
    if (sql.startsWith('INSERT')) return {rows: [{id: id++, automacao_id: params[0]}]};
    if (sql.startsWith('UPDATE') && failUpdate) throw new Error('Simulated failure');
    return {rows: []};
  }};
  return {pool: {async connect() {return client;}}, calls, released: () => released};
}

test('records source and filters atomically with the same date and odometer, preserving intervals', async () => {
  const mock = mockPool();
  const result = await registerMaintenance(mock.pool, service, 42);
  assert.equal(result.planos_intermediarios_atualizados[0].km_proximo_envio, 620000);
  const inserts = mock.calls.filter(call => call.sql.startsWith('INSERT'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[1].params.slice(4, 6), ['2026-09-16', 600000]);
  assert.match(inserts[1].params[8], /Registro de origem: 10/);
  assert.deepEqual(mock.calls.filter(call => call.sql.startsWith('UPDATE')).map(call => call.params[2]), [1, 2]);
  assert.equal(mock.calls.at(-1).sql, 'COMMIT');
  assert.equal(mock.released(), true);
});

test('a newer intermediate service is preserved when an old oil change is entered', async () => {
  const mock = mockPool({history: [{automacao_id: 2, data_servico: '2026-09-18', km_servico: 601000}]});
  const result = await registerMaintenance(mock.pool, service, 42);
  assert.equal(result.planos_intermediarios_atualizados.length, 0);
  assert.equal(mock.calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
});

test('wrong vehicle plan and failures roll back and release connection', async () => {
  for (const [mock, input] of [[mockPool(), {...service, automacao_id: 999}], [mockPool({failUpdate: true}), service]]) {
    await assert.rejects(registerMaintenance(mock.pool, input, 42));
    assert.equal(mock.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(mock.calls.some(call => call.sql === 'COMMIT'), false);
    assert.equal(mock.released(), true);
  }
});
