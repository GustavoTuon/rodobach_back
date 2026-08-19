import assert from "node:assert/strict";
import test from "node:test";

import { summarizeFutureExpenses } from "../src/services/fluxoCaixaService.js";

test("resume despesas futuras e separa compromissos financeiros", () => {
  const result = summarizeFutureExpenses([
    { id: "1", data: "2026-09-10", categoria: "Financiamento de Veículos", pessoa: "Banco A", valor: "1000" },
    { id: "2", data: "2026-09-20", categoria: "Seguro", pessoa: "Fornecedor B", valor: "250.50" },
    { id: "3", data: "2026-10-05", categoria: "Despesas Diversas", historico: "Parcela empréstimo", pessoa: "Banco A", valor: "500" },
  ]);

  assert.equal(result.total, 1750.5);
  assert.equal(result.quantidade, 3);
  assert.equal(result.financiamentos.total, 1500);
  assert.equal(result.financiamentos.quantidade, 2);
  assert.deepEqual(result.mensal, [
    { mes: "2026-09", valor: 1250.5, lancamentos: 2 },
    { mes: "2026-10", valor: 500, lancamentos: 1 },
  ]);
  assert.deepEqual(result.fornecedores[0], { pessoa: "Banco A", valor: 1500, lancamentos: 2 });
});

test("não classifica despesa comum como financiamento", () => {
  const result = summarizeFutureExpenses([
    { id: "1", data: "2026-11-01", categoria: "Combustíveis", historico: "Abastecimento", pessoa: "Posto", valor: 300 },
  ]);

  assert.equal(result.financiamentos.total, 0);
  assert.equal(result.financiamentos.quantidade, 0);
  assert.deepEqual(result.financiamentos.mensal, []);
});
