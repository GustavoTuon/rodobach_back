import assert from 'node:assert/strict';
import test from 'node:test';
import {executeMaintenanceDaily} from '../src/services/maintenanceDaily.js';

test('daily execution uses Brasília calendar day and sends no failure notice on success', async () => {
  const result = await executeMaintenanceDaily({now: new Date('2026-09-22T01:00:00Z'), run: async options => {
    assert.deepEqual(options, {dryRun: false, dailyDate: '2026-09-21'});
    return {ok: true, enviados: [1, 2], falhas: []};
  }, notify: () => {throw new Error('Unexpected notification');}});
  assert.equal(result.accepted, 2);
  assert.equal(result.ok, true);
});

test('notifies partial send failures', async () => {
  const result = await executeMaintenanceDaily({run: async () => ({ok: false, enviados: [1], falhas: [2]}), notify: async message => {
    assert.match(message, /1 envio\(s\) falharam/);
    return {success: true};
  }});
  assert.equal(result.notification, 'accepted');
  assert.equal(result.ok, false);
});

test('records notification failure and does not disclose errors containing secrets', async () => {
  const result = await executeMaintenanceDaily({run: async () => {throw new Error('password=secret');}, notify: async message => {
    assert.doesNotMatch(message, /password|secret/);
    throw new Error('Offline');
  }});
  assert.equal(result.notification, 'failed');
  assert.equal(result.ok, false);
});
