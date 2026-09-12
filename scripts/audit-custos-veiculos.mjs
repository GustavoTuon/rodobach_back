import { clientPool } from "../src/db/clientPool.js";
import { baseCostCte } from "../src/services/custosVeiculosService.js";

const dates = process.argv.slice(2);
if (dates.length !== 2 || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || dates[0] > dates[1]) {
  throw new Error("Uso: node scripts/audit-custos-veiculos.mjs AAAA-MM-DD AAAA-MM-DD");
}

const client = await clientPool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const query = async (sql) => (await client.query(sql, dates)).rows;
  const categorias = await query(`${baseCostCte({ includeOperational: true })}
    SELECT tipo_custo, origem, COUNT(*)::int lancamentos, SUM(valor) valor
    FROM custos_status WHERE proprietario = 'frota'
    GROUP BY 1, 2 ORDER BY 1, 2`);
  const mensal = await query(`${baseCostCte({ includeOperational: true })}
    SELECT TO_CHAR(CASE WHEN origem = 'financeiro.pagar' THEN vencimento ELSE data END, 'YYYY-MM') mes,
      SUM(valor) total_anterior,
      COALESCE(SUM(valor) FILTER (WHERE origem = 'financeiro.pagar'), 0) total_financeiro,
      COALESCE(SUM(valor) FILTER (WHERE origem <> 'financeiro.pagar'), 0) operacional_fora_do_total
    FROM custos_status WHERE proprietario = 'frota' GROUP BY 1 ORDER BY 1`);
  const repeticoes = await query(`${baseCostCte({ includeOperational: true })}
    SELECT origem, id, COUNT(*)::int repeticoes, SUM(valor) valor
    FROM custos_status GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY 1, 2`);
  const conciliacao = await query(`${baseCostCte()}
    SELECT (SELECT SUM(valor) FROM custos_status) total_tela_sem_filtro,
      (SELECT SUM(prt.valorrateioprt) FROM financeiro.pagarrateios prt
        JOIN financeiro.pagar pag ON
          (pag.empresapag, pag.seriepag, pag.duplicatapag, pag.parcelapag, pag.fornecedorpag) =
          (prt.empresaprt, prt.serieprt, prt.duplicataprt, prt.parcelaprt, prt.fornecedorprt)
        WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
          AND pag.statuspag IN (1, 2)) total_rateios_erp,
      (SELECT SUM(valor) FROM custos_status WHERE proprietario = 'frota') total_frota,
      (SELECT SUM(custo) FROM (SELECT SUM(valor) custo FROM custos_status
        WHERE proprietario = 'frota' GROUP BY placa_resolvida) p) soma_veiculos,
      (SELECT COUNT(*) FROM custos_status WHERE origem <> 'financeiro.pagar') operacionais_no_total`);
  const rateiosDivergentes = await query(`
    SELECT pag.empresapag empresa, pag.seriepag serie, pag.duplicatapag duplicata,
      pag.parcelapag parcela, pag.fornecedorpag fornecedor,
      pag.valorduplicatapag valor_titulo, SUM(prt.valorrateioprt) valor_rateios
    FROM financeiro.pagar pag JOIN financeiro.pagarrateios prt ON
      (pag.empresapag, pag.seriepag, pag.duplicatapag, pag.parcelapag, pag.fornecedorpag) =
      (prt.empresaprt, prt.serieprt, prt.duplicataprt, prt.parcelaprt, prt.fornecedorprt)
    WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date AND pag.statuspag IN (1, 2)
    GROUP BY 1, 2, 3, 4, 5, 6 HAVING ABS(SUM(prt.valorrateioprt) - pag.valorduplicatapag) > 0.02`);
  const titulosSemRateio = await query(`
    SELECT COUNT(*)::int quantidade, COALESCE(SUM(pag.valorduplicatapag), 0) valor
    FROM financeiro.pagar pag WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
      AND pag.statuspag IN (1, 2)
      AND NOT EXISTS (SELECT 1 FROM financeiro.pagarrateios prt WHERE
        (pag.empresapag, pag.seriepag, pag.duplicatapag, pag.parcelapag, pag.fornecedorpag) =
        (prt.empresaprt, prt.serieprt, prt.duplicataprt, prt.parcelaprt, prt.fornecedorprt))`);
  const excluidosPorStatus = await query(`
    SELECT pag.statuspag status, COUNT(*)::int rateios, SUM(prt.valorrateioprt) valor
    FROM financeiro.pagar pag JOIN financeiro.pagarrateios prt ON
      (pag.empresapag, pag.seriepag, pag.duplicatapag, pag.parcelapag, pag.fornecedorpag) =
      (prt.empresaprt, prt.serieprt, prt.duplicataprt, prt.parcelaprt, prt.fornecedorprt)
    WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
      AND (pag.statuspag IS NULL OR pag.statuspag NOT IN (1, 2))
    GROUP BY 1 ORDER BY 1`);
  console.log(JSON.stringify({ periodo: dates, statusIncluidos: [1, 2], categorias, mensal, repeticoes,
    conciliacao, rateiosDivergentes, titulosSemRateio, excluidosPorStatus }, null, 2));
  await client.query("ROLLBACK");
} finally {
  client.release();
  await clientPool.end();
}
