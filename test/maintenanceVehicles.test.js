import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMaintenanceVehicles } from '../src/services/maintenanceVehicles.js';

test('includes vehicle 01 without telemetry and preserves tracked vehicles', () => {
  const rows = mergeMaintenanceVehicles([{ placa: 'RAA8G18', odometro: 123 }], [{ placa: 'LXG1J87' }]);
  assert.deepEqual(rows, [{ placa: 'LXG1J87' }, { placa: 'RAA8G18', odometro: 123 }]);
  assert.equal(rows[0].odometro, undefined);
});

test('does not duplicate vehicle 01 when telemetry becomes available', () => {
  const rows = mergeMaintenanceVehicles([{ placa: 'lxg-1j87', odometro: 456 }], [{ placa: 'LXG1J87' }, { placa: '' }]);
  assert.deepEqual(rows, [{ placa: 'LXG1J87', odometro: 456 }]);
});
