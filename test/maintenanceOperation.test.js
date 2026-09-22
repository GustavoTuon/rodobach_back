import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMaintenanceCommand} from '../src/services/maintenanceCommand.js';
import {maintenanceDate, daysUntilMaintenance} from '../src/services/maintenanceDates.js';
import {alertType, componentAlertType, buildMaintenanceAlertMessage, runMaintenanceAlerts} from '../src/services/manutencaoAlertaService.js';
import {setN8nAutomationActive, retryLastFailedN8nAutomation} from '../src/services/n8nService.js';
import {config} from '../src/config.js';

test('terminal defaults to simulation; live manual send requires an explicit plan selection', () => {
  assert.equal(parseMaintenanceCommand([]).dryRun, true);
  assert.deepEqual(parseMaintenanceCommand(['--send', '--ids=65,82']), {mode: '--send', planIds: [65,82], dryRun: false, onlyOverdue: true});
  for (const args of [['--send'], ['--send','--preview'], ['--worker','--ids=65'], ['--send','--ids='], ['--send','--ids=65,0'], ['--all']]) {
    assert.throws(() => parseMaintenanceCommand(args));
  }
});

test('date alerts accept actual PostgreSQL Date objects and respect Brasília calendar days', () => {
  const due = new Date('2026-09-18T03:00:00Z');
  assert.equal(maintenanceDate(due), '2026-09-18');
  assert.equal(maintenanceDate('2026-02-30'), null);
  assert.equal(daysUntilMaintenance(due, new Date('2026-09-17T23:00:00Z')), 1);
  const item = {tipo_controle: 'data', data_proximo_envio: due};
  assert.deepEqual(alertType(item, null, new Date('2026-09-18T23:00:00Z')), {type: 'antecipado', remaining: 0, reference: '2026-09-18'});
  assert.deepEqual(alertType(item, null, new Date('2026-09-19T03:01:00Z')), {type: 'vencido', remaining: -1, reference: '2026-09-18'});
  assert.equal(alertType({...item, data_proximo_envio: null}, null), null);
  assert.equal(componentAlertType({proxima_data: due}, null, new Date('2026-09-19T03:01:00Z')).type, 'vencido');
  const message = buildMaintenanceAlertMessage({...item, data_ultimo_servico: due}, null, {type: 'antecipado', remaining: 1}, null);
  assert.match(message, /18\/09\/2026/);
  assert.doesNotMatch(message, /Invalid Date/);
});

test('kilometre alerts preserve exact service threshold and do not infer movement from missing telemetry', () => {
  const item = {tipo_controle: 'km', km_proximo_envio: 300000};
  assert.equal(alertType(item, null), null);
  assert.equal(alertType(item, 298999), null);
  assert.equal(alertType(item, 299000).type, 'antecipado');
  assert.equal(alertType(item, 303292).type, 'vencido');
  assert.equal(item.km_proximo_envio, 300000);
});

test('legacy n8n maintenance cannot be activated or retried from the application', async () => {
  await assert.rejects(setN8nAutomationActive('hhjl1q5uyxov5kZI', true), {statusCode: 409});
  await assert.rejects(retryLastFailedN8nAutomation('hhjl1q5uyxov5kZI'), {statusCode: 409});
});

test('invalid plan filters and read-only mode fail before connecting or sending', async () => {
  await assert.rejects(runMaintenanceAlerts({planIds: []}), /IDs válidos/);
  const before = config.readOnly;
  try { config.readOnly = true; await assert.rejects(runMaintenanceAlerts({dryRun: false}), /somente consulta/); }
  finally { config.readOnly = before; }
});
