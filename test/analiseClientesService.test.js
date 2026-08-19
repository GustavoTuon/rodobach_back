import test from "node:test";
import assert from "node:assert/strict";

import { consolidateClientBranches, filterClientsForView } from "../src/services/analiseClientesService.js";

test("consolida filiais pelo CNPJ raiz sem duplicar os valores", () => {
  const rows = [
    { codigo: 10, nome: "Matriz", documento: "12.345.678/0001-10", total_periodo: 100, total_recebido: 80, lancamentos_periodo: 2, ultimo_global: "2026-08-10", primeiro: "2025-01-01" },
    { codigo: 20, nome: "Filial", documento: "12.345.678/0002-09", total_periodo: 50, total_recebido: 40, lancamentos_periodo: 1, ultimo_global: "2026-08-15", primeiro: "2024-01-01" },
  ];

  const result = consolidateClientBranches(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].identidade_cliente, "cnpj:12345678");
  assert.equal(result[0].total_periodo, 150);
  assert.equal(result[0].total_recebido, 120);
  assert.equal(result[0].lancamentos_periodo, 3);
  assert.equal(result[0].quantidade_filiais, 2);
  assert.equal(result[0].ultimo_global, "2026-08-15");
  assert.equal(result[0].primeiro, "2024-01-01");
});

test("mantem CPFs e cadastros sem documento como clientes separados", () => {
  const rows = [
    { codigo: 1, documento: "123.456.789-00", total_periodo: 10 },
    { codigo: 2, documento: "987.654.321-00", total_periodo: 20 },
    { codigo: 3, documento: null, total_periodo: 30 },
    { codigo: 4, documento: null, total_periodo: 40 },
  ];

  assert.equal(consolidateClientBranches(rows).length, 4);
});

test("ranking pode incluir clientes sem faturamento sem alterar a visao padrao", () => {
  const rows = [
    { codigo: 1, totalPeriodo: 100, diasSemFaturar: 2 },
    { codigo: 2, totalPeriodo: 0, diasSemFaturar: 45 },
  ];
  assert.deepEqual(filterClientsForView(rows).map(row => row.codigo), [1]);
  assert.deepEqual(filterClientsForView(rows, { incluirSemFaturamento: "1" }).map(row => row.codigo), [1, 2]);
});
