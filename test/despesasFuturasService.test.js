import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDespesasFuturas } from "../src/services/despesasFuturasService.js";

const rows = [
  { id: "1", vencimento: "2026-08-20", categoria: "Financiamento de Veículos", pessoa: "Banco A", valor: 1000 },
  { id: "2", vencimento: "2026-09-10", categoria: "Combustíveis", pessoa: "Posto B", valor: 500 },
  { id: "3", vencimento: "2026-09-15", categoria: "Pis/Cofins/CSLL", pessoa: "Receita", valor: 250 },
  { id: "4", vencimento: "2026-10-01", categoria: "Despesas Diversas", pessoa: "Fornecedor C", valor: 100 },
  { id: "fora", vencimento: "2026-11-01", categoria: "Seguro", pessoa: "Fornecedor D", valor: 999 },
];

test("mantém exatamente a quantidade de meses solicitada e inclui mês zerado", () => {
  const result = summarizeDespesasFuturas(rows, { today: "2026-08-19", months: 3 });
  assert.deepEqual(result.mensal.map((item) => item.mes), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(result.resumo.total, 1850);
  assert.equal(result.resumo.mediaMensal, 616.67);
  assert.equal(result.titulos.length, 4);
});

test("calcula próximos 30 dias e composição mensal", () => {
  const result = summarizeDespesasFuturas(rows, { today: "2026-08-19", months: 3 });
  assert.equal(result.resumo.proximos30, 1750);
  assert.equal(result.resumo.proximos30Quantidade, 3);
  assert.equal(result.resumo.financeiro, 1000);
  assert.deepEqual(result.mensal[1].composicao, { financeiro: 0, operacional: 500, impostos: 250, outros: 0 });
});

test("classifica pressão mensal em relação à média do período", () => {
  const result = summarizeDespesasFuturas(rows, { today: "2026-08-19", months: 3 });
  assert.equal(result.mensal[0].pressao.id, "critico");
  assert.equal(result.mensal[1].pressao.id, "atencao");
  assert.equal(result.mensal[2].pressao.id, "normal");
});
