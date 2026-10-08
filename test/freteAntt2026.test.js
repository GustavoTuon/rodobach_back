import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { freteRouter } from '../src/routes/frete.js';

// Portaria SUROC 22/2026: carga geral, tabelas A e C, 1.000 km.
const expected = [
  [3, 5.2177, 541.86, 4.4341, 195.81, 5759.56, 4629.91],
  [4, 5.9180, 588.86, 5.0693, 213.27, 6506.86, 5282.57],
  [5, 6.8284, 657.56, 5.8195, 228.08, 7485.96, 6047.58],
  [6, 7.5347, 671.93, 6.4924, 231.17, 8206.63, 6723.57],
  [7, 8.2727, 831.66, 6.9018, 272.80, 9104.36, 7174.60],
];

test('nova migração contém os dez coeficientes oficiais de carga geral', () => {
  const sql = fs.readFileSync(new URL('../sql/051_antt_setembro_2026.sql', import.meta.url), 'utf8');
  for (const [axes, normal, cc, high, hcc] of expected) {
    for (const [mode, km, charge] of [['normal', normal, cc], ['alto_desempenho', high, hcc]]) {
      assert.ok(sql.includes(`,${axes},'geral','${mode}',${km.toFixed(4)},${charge.toFixed(2)},DATE '2026-09-30'`));
    }
  }
});

test('API calcula os dez pisos e informa a versão efetivamente utilizada', async t => {
  t.mock.method(pool, 'query', async (_sql, [axes, mode]) => {
    const row = expected.find(r => r[0] === axes);
    return { rows: [{ tipo_veiculo: 'Teste', km_valor: row[mode === 'normal' ? 1 : 3], carga_descarga: row[mode === 'normal' ? 2 : 4], data_vigencia: '2026-09-30', versao: 'portaria_suroc_22_2026' }] };
  });
  const app = express(); app.use(express.json()); app.use(freteRouter);
  for (const row of expected) {
    for (const tipoCarga of ['normal', 'alto_desempenho']) {
      const { body } = await request(app).post('/frete/calcular').send({ eixos: row[0], tipoCarga, km: 1000 }).expect(200);
      assert.equal(body.tabela.valorMotoristaTabela, row[tipoCarga === 'normal' ? 5 : 6]);
      assert.equal(body.tabela.dataVigencia, '2026-09-30');
      assert.equal(body.tabela.versao, 'portaria_suroc_22_2026');
      assert.equal(body.tabela.categoria, 'Carga geral');
    }
  }
});
