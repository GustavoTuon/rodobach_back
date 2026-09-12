import assert from "node:assert/strict";
import test from "node:test";
import { baseCostCte } from "../src/services/custosVeiculosService.js";
import { clientPool } from "../src/db/clientPool.js";

test("totais por categoria e veiculo conciliam com os rateios, sem somar fontes operacionais", {
  skip: process.env.TEST_CLIENT_DB !== "true",
}, async () => {
  const client = await clientPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const dates = ["2026-07-01", "2026-09-30"];
    const { rows: [result] } = await client.query(`${baseCostCte()}
      SELECT COALESCE(SUM(valor), 0) total, COUNT(*)::int quantidade,
        COUNT(*) FILTER (WHERE origem <> 'financeiro.pagar')::int operacionais,
        COUNT(*) FILTER (WHERE statuspag::int NOT IN (1, 2))::int status_excluidos_pelo_dre,
        (SELECT COALESCE(SUM(custo), 0) FROM
          (SELECT SUM(valor) custo FROM custos_status GROUP BY placa_resolvida) p) por_veiculo,
        (SELECT COALESCE(SUM(custo), 0) FROM
          (SELECT SUM(valor) custo FROM custos_status GROUP BY tipo_custo) p) por_categoria
      FROM custos_status`, dates);
    const { rows: [erp] } = await client.query(`
      SELECT COALESCE(SUM(prt.valorrateioprt), 0) total, COUNT(*)::int quantidade
      FROM financeiro.pagarrateios prt JOIN financeiro.pagar pag ON
        (pag.empresapag, pag.seriepag, pag.duplicatapag, pag.parcelapag, pag.fornecedorpag) =
        (prt.empresaprt, prt.serieprt, prt.duplicataprt, prt.parcelaprt, prt.fornecedorprt)
      WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
        AND pag.statuspag IN (1, 2)
        AND COALESCE(prt.valorrateioprt, 0) <> 0`, dates);
    assert.equal(result.total, erp.total);
    assert.equal(result.quantidade, erp.quantidade);
    assert.equal(result.por_veiculo, erp.total);
    assert.equal(result.por_categoria, erp.total);
    assert.equal(result.operacionais, 0);
    assert.equal(result.status_excluidos_pelo_dre, 0);
    const { rows: [audit] } = await client.query(`${baseCostCte({ includeOperational: true })}
      SELECT COALESCE(SUM(valor) FILTER (WHERE origem = 'financeiro.pagar'), 0) financeiro
      FROM custos_status`, dates);
    assert.equal(audit.financeiro, erp.total);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await clientPool.end();
  }
});
