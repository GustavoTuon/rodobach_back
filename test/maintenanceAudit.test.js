import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAuditedMaintenance, maintenanceMutation, getMaintenanceAudit } from '../src/services/maintenanceAudit.js';

const candidate = {placa: 'TEST123', numero: '5500000000000', mensagem: 'Teste simulado', referencia: '300000', tipo: 'vencido'};
const item = {id: 42, titulo: 'Revisão', km_proximo_envio: 300000};
function database({pending = false, failStart = false, failSave = false} = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({sql, params});
    if (sql.includes('SELECT id FROM')) return {rows: pending ? [{id: 7}] : [], rowCount: pending ? 1 : 0};
    if (sql.includes("'iniciado',$10)")) {
      if (failStart) throw new Error('database unavailable');
      return {rows: [{id: 7}], rowCount: 1};
    }
    if (sql.includes("status='aceito'") && failSave) throw new Error('database unavailable');
    return {rows: [], rowCount: 0};
  };
  const pool = {query, connect: async () => ({query, release: () => calls.push({sql: 'RELEASE'})})};
  return {pool, calls};
}

test('persists the attempt BEFORE sending, then acknowledgement and dedup marker atomically', async () => {
  const {pool, calls} = database();
  const result = await sendAuditedMaintenance({pool, candidate, item, currentKm: 303292, send: async () => {
    assert.ok(calls.at(-1).sql.includes("'iniciado',$10)"));
    return {key: {id: 'provider-123'}, status: 'PENDING', secret: 'never store'};
  }});
  assert.equal(result.accepted, true);
  const saved = calls.find(call => call.sql.includes("status='aceito'"));
  assert.deepEqual(saved.params, [7, 'provider-123', 'PENDING']);
  assert.ok(calls.find(call => call.sql.includes('tentativa_id)')));
  assert.deepEqual(calls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
  assert.ok(!JSON.stringify(calls).includes('never store'));
});

test('does not send when the durable attempt cannot be recorded or a previous attempt is unresolved', async () => {
  let sent = 0;
  const send = async () => { sent++; };
  const pending = database({pending: true});
  assert.equal((await sendAuditedMaintenance({...pending, send, candidate, item})).skipped, true);
  await assert.rejects(sendAuditedMaintenance({...database({failStart: true}), send, candidate, item}));
  assert.equal(sent, 0);
});

test('records rejection or ambiguous transport failure without falsely claiming delivery', async () => {
  for (const [error, expected] of [[Object.assign(new Error('secret response'), {status: 401}), 'falha'], [new Error('network failed'), 'inconclusivo']]) {
    const {pool, calls} = database();
    const result = await sendAuditedMaintenance({pool, candidate, item, send: async () => {throw error;}});
    assert.equal(result.status, expected);
    const saved = calls.at(-1);
    assert.equal(saved.params[1], expected);
    assert.ok(!saved.params[2].includes('secret'));
    assert.equal(calls.some(call => call.sql.includes('tentativa_id)')), false);
  }
});

test('provider success followed by persistence failure keeps pending attempt and rolls back acknowledgement', async () => {
  const db = database({failSave: true});
  await assert.rejects(sendAuditedMaintenance({...db, candidate, item, send: async () => ({key: {id: '123'}})}));
  assert.deepEqual(db.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  assert.equal(db.calls.some(call => call.sql === 'COMMIT'), false);
});

test('actor is transaction local and mutation failures roll back audit and change together', async () => {
  const db = database();
  await maintenanceMutation(db.pool, {id: 9, login: 'operador'}, 'UPDATE example SET value=$1', [12]);
  assert.deepEqual(db.calls[1].params, ['9', 'operador']);
  assert.match(db.calls[1].sql, /set_config.*true/);
  assert.deepEqual(db.calls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
});

test('audit endpoint validates filters and binds plate/date/pagination parameters', async () => {
  const db = database();
  await assert.rejects(getMaintenanceAudit(db.pool, {inicio: 'invalid'}), /Data inválida/);
  await assert.rejects(getMaintenanceAudit(db.pool, {automacaoId: '1 OR 1=1'}), /Plano inválido/);
  await getMaintenanceAudit(db.pool, {placa: 'ABC1D23', tipo: 'envios', inicio: '2026-09-01', fim: '2026-09-17', pagina: '2'});
  const query = db.calls.find(call => call.sql.includes('LIMIT 51'));
  assert.match(query.sql, /America\/Sao_Paulo/);
  assert.deepEqual(query.params, ['%ABC1D23%', '2026-09-01', '2026-09-17', 50]);
});
