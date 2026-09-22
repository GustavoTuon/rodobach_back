import test from 'node:test';
import assert from 'node:assert/strict';

test('historical daily references block repeats but allow a new milestone or alert type', {skip: process.env.MAINTENANCE_DEDUP_DB_TEST !== '1'}, async () => {
  const {pool} = await import('../src/db/pool.js');
  const {tableName} = await import('../src/config.js');
  const {maintenanceAttemptExists, sendAuditedMaintenance} = await import('../src/services/maintenanceAudit.js');
  // Read-only fixture: no schemas, records or messages are created.
  const fixture = {query: (sql, params) => pool.query(sql.replace(tableName('manutencao_auditoria'),
    `(VALUES (1,'envio','plano',65,'610902|dia:2026-09-21','vencido','5500000000000','aceito'),
      (2,'envio','componente_posicao',70,'km-400000|dia:2026-09-21','antecipado','5500000000000','inconclusivo'))
      AS fixture(id,evento,origem,registro_id,referencia,tipo_alerta,numero,status)`), params)};
  const base = {origin: 'plano', recordId: 65, reference: '610902', type: 'vencido', number: '5500000000000'};
  try {
    assert.equal(await maintenanceAttemptExists(fixture, base), true);
    assert.equal(await maintenanceAttemptExists(fixture, {...base, reference: '610902|dia:2026-09-23'}), true);
    assert.equal(await maintenanceAttemptExists(fixture, {...base, reference: '630902'}), false);
    assert.equal(await maintenanceAttemptExists(fixture, {...base, type: 'antecipado'}), false);
    assert.equal(await maintenanceAttemptExists(fixture, {...base, origin: 'componente_posicao', recordId: 70, reference: 'km-400000', type: 'antecipado'}), true);
    let sent = false;
    const result = await sendAuditedMaintenance({pool: fixture, item: {id: 65},
      candidate: {referencia: '610902', tipo: 'vencido', numero: base.number}, send: async () => {sent = true;}});
    assert.equal(result.skipped, true);
    assert.equal(sent, false);
  } finally {await pool.end();}
});
