import test from "node:test";
import assert from "node:assert/strict";
import { aplicarOperacoesComplementares, operacoesComplementares } from "../src/services/operacoesComplementares.js";

const op = operacoesComplementares[0];
const gap = { id: 1, placa: op.placa, inicio: "2026-08-24T10:53:49.000Z", fim: "2026-08-31T22:42:44.000Z", documento: "SM 514799", proximoDocumento: "SM 516271" };
test("separa antes e depois da viagem Fumacense sem perder as referencias", () => {
  const rows = aplicarOperacoesComplementares([gap], [op]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fim, op.inicio);
  assert.equal(rows[1].inicio, op.fim);
  assert.equal(rows[0].proximoDocumento, op.documento);
  assert.equal(rows[1].documento, op.documento);
  assert.equal(rows[1].proximoDocumento, "SM 516271");
  assert.equal(new Date(op.fim) - new Date(op.inicio), 95 * 3600000);
  assert.deepEqual(aplicarOperacoesComplementares(rows, [op]), rows);
});
test("preserva outras placas e remove janela inteiramente carregada", () => {
  const other = { ...gap, placa: "ABC1D23" };
  assert.deepEqual(aplicarOperacoesComplementares([other], [op]), [other]);
  assert.deepEqual(aplicarOperacoesComplementares([{ ...gap, inicio: op.inicio, fim: op.fim }], [op]), []);
});
test("recortes parciais preservam apenas trecho fora da carga", () => {
  assert.equal(aplicarOperacoesComplementares([{ ...gap, inicio: op.inicio }], [op])[0].inicio, op.fim);
  assert.equal(aplicarOperacoesComplementares([{ ...gap, fim: op.fim }], [op])[0].fim, op.inicio);
});
