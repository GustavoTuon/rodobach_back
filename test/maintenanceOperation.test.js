import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMaintenanceCommand} from '../src/services/maintenanceCommand.js';
import {maintenanceDate, daysUntilMaintenance} from '../src/services/maintenanceDates.js';
import {alertType, componentAlertType, buildMaintenanceAlertMessage, runMaintenanceAlerts} from '../src/services/manutencaoAlertaService.js';
import {setN8nAutomationActive, retryLastFailedN8nAutomation} from '../src/services/n8nService.js';
import {config} from '../src/config.js';

test('terminal only permits simulation; local send and worker modes are removed', () => {
  assert.equal(parseMaintenanceCommand([]).dryRun, true);
  assert.throws(()=>parseMaintenanceCommand(['--send','--ids=65,82']));
  assert.throws(()=>parseMaintenanceCommand(['--worker']));
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

test('legacy n8n maintenance cannot be activated or retried from the application', async (t) => {
  const previous = config.n8n;
  config.n8n = {...previous, apiUrl:'https://n8n.example.test', apiKey:'test-only-key'};
  t.after(()=>{config.n8n=previous;});
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{calls.push({url,method:options?.method||'GET'});return {ok:true,text:async()=>JSON.stringify({nodes:[]})};});
  await assert.rejects(setN8nAutomationActive('hhjl1q5uyxov5kZI', true), {statusCode: 409});
  await assert.rejects(retryLastFailedN8nAutomation('hhjl1q5uyxov5kZI'), {statusCode: 409});
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.method==='GET'));
});

test('missing n8n configuration fails before any network request', async (t) => {
  const previous = config.n8n;
  config.n8n = {...previous, apiUrl:'', apiKey:''};
  t.after(()=>{config.n8n=previous;});
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected network request');});
  await assert.rejects(setN8nAutomationActive('hhjl1q5uyxov5kZI',true),{statusCode:503});
  await assert.rejects(retryLastFailedN8nAutomation('hhjl1q5uyxov5kZI'),{statusCode:503});
  assert.equal(fetch.mock.callCount(),0);
});

test('invalid plan filters and read-only mode fail before connecting or sending', async () => {
  await assert.rejects(runMaintenanceAlerts({planIds: []}), /IDs válidos/);
  const before = config.readOnly;
  try { config.readOnly = true; await assert.rejects(runMaintenanceAlerts({dryRun: false}), /somente consulta/); }
  finally { config.readOnly = before; }
});
