import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { freteRouter, calcRpaCharges } from '../src/routes/frete.js';

test('custos TAC reproduzem RPA e INSS dos dois exemplos da planilha', () => {
  const normal = calcRpaCharges(8928.42);
  assert.equal(normal.totalDescontos, 247.76);
  assert.equal(normal.patronalInss, 367.05);
  assert.equal(normal.valorBruto, 9176.18);
  assert.equal(normal.custoMotorista, 9543.22);
  assert.equal(normal.valorLiquidoMot, 8928.42);
  const alto = calcRpaCharges(7064.67);
  assert.equal(alto.totalDescontos, 196.04);
  assert.equal(alto.patronalInss, 290.43);
  assert.equal(alto.custoMotorista, 7551.14);
});

test('percentual bruto calcula cliente e todos os custos reduzem lucro líquido', async t => {
  t.mock.method(pool, 'query', async () => ({ rows: [{ tipo_veiculo: 'Carreta', km_valor: 8.1252, carga_descarga: 803.22 }] }));
  const app = express(); app.use(express.json()); app.use(freteRouter);
  for (const operacao of ['etc', 'tac']) {
    const { body } = await request(app).post('/frete/calcular').send({ eixos: 6, km: 1000, margem: 30, icms: 12, operacao, seguroRCManual: 141.91 }).expect(200);
    assert.equal(body.resultado.valorCliente, 12754.89);
    assert.equal(body.resultado.icmsValor, 1530.59);
    assert.equal(body.resultado.lucro, operacao === 'etc' ? 2153.97 : 1539.17);
    assert.equal(body.resultado.margemPercent, operacao === 'etc' ? 16.89 : 12.07);
    assert.equal(Math.round((body.resultado.valorCliente - body.resultado.custoTotal) * 100) / 100, body.resultado.lucro);
  }
  const { body } = await request(app).post('/frete/calcular').send({ km: 1000, margem: 0, icms: 0, seguroRCManual: 0, valorClienteNegociado: 10000 }).expect(200);
  assert.equal(body.resultado.valorCliente, 8928.42);
  assert.equal(body.resultado.icmsValor, 0);
  assert.equal(body.simulacao.valorMotorista, 8928.42);
  await request(app).post('/frete/calcular').send({ km: 1000, margem: 100 }).expect(400);
});
