import assert from "node:assert/strict";
import test from "node:test";
import { abastecimentoFinanceiroMatchSql } from "../src/services/abastecimentoFinanceiroSql.js";

test("custos contam uma vez a nota financeira e preservam abastecimentos independentes", {
  skip: process.env.TEST_CLIENT_DB !== "true",
}, async () => {
  const { clientPool } = await import("../src/db/clientPool.js");
  try {
    // Apenas VALUES: nenhuma tabela real e nenhuma escrita no banco.
    const { rows } = await clientPool.query(`
      WITH pag AS (
        SELECT 2 AS empresapag, 148 AS fornecedorpag, 383776 AS duplicatapag,
          '5'::text AS seriepag, '999'::text AS documentopag,
          DATE '2026-08-05' AS dataemissaopag, 803.78 AS valor
      ), aba AS (
        SELECT * FROM (VALUES
          ('nota diesel', 2, 148, NULL::int, NULL::int, NULL::text, NULL::text, '383776', DATE '2026-08-05', 780.05),
          ('nota complemento', 2, 148, NULL, NULL, NULL, NULL, '383776', DATE '2026-08-05', 23.73),
          ('duplicata original', 2, 148, NULL, 383776, NULL, '5', NULL, DATE '2026-08-06', 10),
          ('duplicata gerada', 2, 148, 383776, NULL, '5', NULL, NULL, DATE '2026-08-06', 10),
          ('documento financeiro', 2, 148, NULL, NULL, NULL, NULL, '999', DATE '2026-08-05', 10),
          ('outra empresa', 3, 148, NULL, NULL, NULL, NULL, '383776', DATE '2026-08-05', 10),
          ('outro fornecedor', 2, 149, 383776, NULL, '5', NULL, NULL, DATE '2026-08-05', 10),
          ('outra data', 2, 148, NULL, NULL, NULL, NULL, '383776', DATE '2025-08-05', 10),
          ('outra serie', 2, 148, NULL, NULL, NULL, '6', '383776', DATE '2026-08-05', 10),
          ('sem documento', 2, 148, NULL, NULL, NULL, NULL, '', DATE '2026-08-05', 10),
          ('sem financeiro', 2, 148, NULL, NULL, NULL, NULL, '123', DATE '2026-08-05', 10),
          ('vinculo diferente', 2, 148, 123, NULL, '5', NULL, '383776', DATE '2026-08-05', 10)
        ) AS fixtures(caso, empresaaba, postocombustivelaba, duplicatageradaaba,
          duplicataaba, seriegeradaaba, serieaba, documentoaba, dataaba, valor)
      )
      SELECT caso, valor FROM aba
      WHERE NOT EXISTS (SELECT 1 FROM pag WHERE ${abastecimentoFinanceiroMatchSql()})
      ORDER BY caso
    `);
    assert.deepEqual(rows.map((row) => row.caso), [
      "outra data", "outra empresa", "outra serie", "outro fornecedor",
      "sem documento", "sem financeiro", "vinculo diferente",
    ]);
    assert.equal(803.78 + rows.reduce((sum, row) => sum + Number(row.valor), 0), 873.78);
  } finally {
    await clientPool.end();
  }
});
