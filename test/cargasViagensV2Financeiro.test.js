import test from "node:test";
import assert from "node:assert/strict";

import { aggregateFinancialStatuses } from "../src/routes/cargasViagensV2.js";

test("distingue carga sem CT-e de CT-e sem faturamento", () => {
  assert.equal(aggregateFinancialStatuses([], 0).status, "sem_cte");
  assert.equal(aggregateFinancialStatuses([], 1).status, "sem_titulo");
});

test("considera quitado somente quando todos os CT-es estao quitados", () => {
  const result = aggregateFinancialStatuses([
    { status: "quitado", titulos: 1, valorTotal: 1200, valorAberto: 0 },
    { status: "quitado", titulos: 2, valorTotal: 800, valorAberto: 0 },
  ], 2);

  assert.deepEqual(result, {
    status: "quitado",
    titulos: 3,
    valorTotal: 2000,
    valorAberto: 0,
    ctes: 2,
    parcelas: [],
  });
});

test("marca como parcial quando a viagem mistura titulo quitado e em aberto", () => {
  const result = aggregateFinancialStatuses([
    { status: "quitado", titulos: 1, valorTotal: 1000, valorAberto: 0 },
    { status: "em_aberto", titulos: 1, valorTotal: 1000, valorAberto: 1000 },
  ], 2);

  assert.equal(result.status, "parcial");
  assert.equal(result.valorAberto, 1000);
});

test("mantem revisar para status financeiros excepcionais", () => {
  const result = aggregateFinancialStatuses([
    { status: "revisar", titulos: 1, valorTotal: 500, valorAberto: 500 },
  ], 1);

  assert.equal(result.status, "revisar");
});

test("nao duplica a mesma fatura vinculada a mais de um CT-e da viagem", () => {
  const parcela = {
    id: "2:1:5000:1",
    status: "quitado",
    valorTotal: 3000,
    valorAberto: 0,
  };
  const result = aggregateFinancialStatuses([
    { status: "quitado", titulos: 1, valorTotal: 3000, valorAberto: 0, parcelas: [parcela] },
    { status: "quitado", titulos: 1, valorTotal: 3000, valorAberto: 0, parcelas: [parcela] },
  ], 2);

  assert.equal(result.titulos, 1);
  assert.equal(result.valorTotal, 3000);
  assert.equal(result.parcelas.length, 1);
});
