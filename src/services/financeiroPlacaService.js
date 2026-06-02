import { clientPool } from "../db/clientPool.js";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function n(value) {
  const v = Number(value);
  return Number.isFinite(v) ? v : 0;
}

function r2(v) {
  return Math.round((n(v) + Number.EPSILON) * 100) / 100;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function resolvePeriod(period, startDate, endDate) {
  if (startDate && endDate) return { key: "custom", startDate, endDate };
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  const key = String(period || "30d").toLowerCase();
  if (key === "7d" || key === "7") {
    start.setUTCDate(end.getUTCDate() - 6);
    return { key: "7d", startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }
  if (key === "month" || key === "mes" || key === "este-mes") {
    start.setUTCDate(1);
    return { key: "month", startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }
  start.setUTCDate(end.getUTCDate() - 29);
  return { key: "30d", startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

function monthLabel(mes) {
  if (!mes) return "";
  const [year, month] = String(mes).split("-");
  const idx = Number(month) - 1;
  if (idx < 0 || idx >= 12) return mes;
  return `${MONTH_LABELS[idx]}/${String(year).slice(2)}`;
}

const STATUS_REC = `CASE WHEN statusrec::text ILIKE '%cancel%' THEN 'cancelado' WHEN COALESCE(valorabertorec,0)>0 AND datavencimentorec::date<CURRENT_DATE THEN 'vencido' WHEN COALESCE(valorabertorec,0)>0 THEN 'aberto' ELSE 'pago' END`;
const STATUS_PAG = `CASE WHEN statuspag::text ILIKE '%cancel%' THEN 'cancelado' WHEN COALESCE(valorabertopag,0)>0 AND datavencimentopag::date<CURRENT_DATE THEN 'vencido' WHEN COALESCE(valorabertopag,0)>0 THEN 'aberto' ELSE 'pago' END`;

const SEM_CENTRO = "Sem centro de custo";

function financeiroBaseSql({ tableName, tableAlias, companyColumn, dateColumn, valueColumn, openColumn, statusSql, vehicleColumn, centersColumn, accountsColumn }) {
  return `
    SELECT
      CASE
        WHEN NULLIF(TRIM(vei_cc.placavei::text),'') IS NOT NULL THEN 'plate:' || UPPER(TRIM(vei_cc.placavei::text))
        WHEN NULLIF(TRIM(${tableAlias}.${vehicleColumn}::text),'') IS NOT NULL THEN 'plate:' || UPPER(TRIM(${tableAlias}.${vehicleColumn}::text))
        WHEN centro.codigo IS NOT NULL THEN 'cc:' || ${tableAlias}.${companyColumn}::text || ':' || centro.codigo::text
        ELSE 'none'
      END AS group_key,
      COALESCE(
        NULLIF(TRIM(vei_cc.placavei::text),''),
        NULLIF(TRIM(${tableAlias}.${vehicleColumn}::text),''),
        NULLIF(TRIM(ccs.nomeccs::text),''),
        '${SEM_CENTRO}'
      ) AS label,
      NULLIF(TRIM(vei_cc.placavei::text),'') AS placa_veiculo,
      NULLIF(TRIM(vei_cc.nomevei::text),'') AS nome_veiculo,
      centro.codigo::int AS centro_codigo,
      NULLIF(TRIM(ccs.nomeccs::text),'') AS nome_centro_custo,
      ${tableAlias}.${dateColumn}::date AS data_vencimento,
      ${tableAlias}.${valueColumn} AS valor_documento,
      ${tableAlias}.${openColumn} AS valor_aberto,
      (${statusSql}) AS status_calculado
    FROM financeiro.${tableName} ${tableAlias}
    INNER JOIN LATERAL (
      SELECT centro.codigo::int AS codigo
      FROM unnest(${tableAlias}.${centersColumn}) WITH ORDINALITY AS centro(codigo, ord)
      WHERE centro.codigo IS NOT NULL
      ORDER BY centro.ord
    ) centro ON true
    LEFT JOIN LATERAL unnest(${tableAlias}.${accountsColumn}) AS conta_financeira(codigo) ON true
    LEFT JOIN LATERAL (
      SELECT c.nomeccs
      FROM financeiro.centroscustos c
      WHERE c.codigoccs = centro.codigo
      ORDER BY (c.empresaccs = ${tableAlias}.${companyColumn}) DESC, c.empresaccs
      LIMIT 1
    ) ccs ON true
    LEFT JOIN LATERAL (
      SELECT
        v.placavei,
        v.nomevei,
        c.nomeccs,
        v.centrocustovei::int AS centro_codigo
      FROM frotas.veiculos v
      LEFT JOIN financeiro.centroscustos c
        ON c.empresaccs = v.empresavei
       AND c.codigoccs = v.centrocustovei
      WHERE v.centrocustovei = centro.codigo
        AND NULLIF(TRIM(v.placavei::text),'') IS NOT NULL
      ORDER BY (v.empresavei = ${tableAlias}.${companyColumn}) DESC, v.empresavei
      LIMIT 1
    ) vei_cc ON true
    WHERE ${tableAlias}.${dateColumn}::date >= $1::date
      AND ${tableAlias}.${dateColumn}::date <= $2::date
  `;
}

const RECEBER_BASE = financeiroBaseSql({
  tableName: "receber",
  tableAlias: "rec",
  companyColumn: "empresarec",
  dateColumn: "datavencimentorec",
  valueColumn: "valorduplicatarec",
  openColumn: "valorabertorec",
  statusSql: STATUS_REC,
  vehicleColumn: "veiculorec",
  centersColumn: "centrosdecustorec",
  accountsColumn: "contasfinanceirasrec",
});

const PAGAR_BASE = financeiroBaseSql({
  tableName: "pagar",
  tableAlias: "pag",
  companyColumn: "empresapag",
  dateColumn: "datavencimentopag",
  valueColumn: "valorduplicatapag",
  openColumn: "valorabertopag",
  statusSql: STATUS_PAG,
  vehicleColumn: "veiculopag",
  centersColumn: "centrosdecustopag",
  accountsColumn: "contasfinanceiraspag",
});

export async function getFinanceiroPorPlaca({ period, startDate, endDate } = {}) {
  const p = resolvePeriod(period, startDate, endDate);
  const vals = [p.startDate, p.endDate];

  const [rec, pag, recMon, pagMon, validation] = await Promise.all([
    clientPool.query(`
      WITH base AS (${RECEBER_BASE})
      SELECT
        group_key,
        label,
        MAX(placa_veiculo) AS placa_veiculo,
        MAX(nome_veiculo) AS nome_veiculo,
        MAX(centro_codigo) AS centro_codigo,
        MAX(nome_centro_custo) AS nome_centro_custo,
        COUNT(*)::int AS lancamentos,
        COALESCE(SUM(valor_documento),0) AS receita,
        COALESCE(SUM(valor_aberto),0) AS aberto,
        COALESCE(SUM(GREATEST(COALESCE(valor_documento,0)-COALESCE(valor_aberto,0),0)),0) AS pago,
        COALESCE(SUM(CASE WHEN status_calculado='vencido' THEN COALESCE(valor_aberto,0) ELSE 0 END),0) AS vencido
      FROM base
      GROUP BY group_key, label
      ORDER BY receita DESC
    `, vals),

    clientPool.query(`
      WITH base AS (${PAGAR_BASE})
      SELECT
        group_key,
        label,
        MAX(placa_veiculo) AS placa_veiculo,
        MAX(nome_veiculo) AS nome_veiculo,
        MAX(centro_codigo) AS centro_codigo,
        MAX(nome_centro_custo) AS nome_centro_custo,
        COUNT(*)::int AS lancamentos,
        COALESCE(SUM(valor_documento),0) AS custo,
        COALESCE(SUM(valor_aberto),0) AS aberto,
        COALESCE(SUM(GREATEST(COALESCE(valor_documento,0)-COALESCE(valor_aberto,0),0)),0) AS pago,
        COALESCE(SUM(CASE WHEN status_calculado='vencido' THEN COALESCE(valor_aberto,0) ELSE 0 END),0) AS vencido
      FROM base
      GROUP BY group_key, label
      ORDER BY custo DESC
    `, vals),

    clientPool.query(`
      WITH base AS (${RECEBER_BASE})
      SELECT
        group_key,
        label,
        TO_CHAR(DATE_TRUNC('month',data_vencimento),'YYYY-MM') AS mes,
        COALESCE(SUM(valor_documento),0) AS receita
      FROM base
      GROUP BY group_key, label, mes
      ORDER BY label, mes
    `, vals),

    clientPool.query(`
      WITH base AS (${PAGAR_BASE})
      SELECT
        group_key,
        label,
        TO_CHAR(DATE_TRUNC('month',data_vencimento),'YYYY-MM') AS mes,
        COALESCE(SUM(valor_documento),0) AS custo
      FROM base
      GROUP BY group_key, label, mes
      ORDER BY label, mes
    `, vals),

    clientPool.query(`
      WITH
      rec_base AS (${RECEBER_BASE}),
      pag_base AS (${PAGAR_BASE})
      SELECT
        (
          SELECT COALESCE(SUM(rec.valorduplicatarec), 0)
          FROM financeiro.receber rec
          WHERE rec.datavencimentorec::date >= $1::date
            AND rec.datavencimentorec::date <= $2::date
        ) AS receita_bruta_tabela,
        (
          SELECT COALESCE(SUM(valor_documento), 0)
          FROM rec_base
        ) AS receita_base_agrupavel,
        (
          SELECT COALESCE(SUM(pag.valorduplicatapag), 0)
          FROM financeiro.pagar pag
          WHERE pag.datavencimentopag::date >= $1::date
            AND pag.datavencimentopag::date <= $2::date
        ) AS custo_bruto_tabela,
        (
          SELECT COALESCE(SUM(valor_documento), 0)
          FROM pag_base
        ) AS custo_base_agrupavel,
        (
          SELECT COUNT(*)
          FROM financeiro.receber rec
          WHERE rec.datavencimentorec::date >= $1::date
            AND rec.datavencimentorec::date <= $2::date
        ) AS receita_lancamentos_tabela,
        (
          SELECT COUNT(*)
          FROM rec_base
        ) AS receita_linhas_agrupaveis,
        (
          SELECT COUNT(*)
          FROM financeiro.pagar pag
          WHERE pag.datavencimentopag::date >= $1::date
            AND pag.datavencimentopag::date <= $2::date
        ) AS custo_lancamentos_tabela,
        (
          SELECT COUNT(*)
          FROM pag_base
        ) AS custo_linhas_agrupaveis
    `, vals),
  ]);

  // Build monthly map per plate
  const monthMap = {};
  for (const row of recMon.rows) {
    if (!monthMap[row.group_key]) monthMap[row.group_key] = {};
    if (!monthMap[row.group_key][row.mes]) monthMap[row.group_key][row.mes] = { mes: row.mes, label: monthLabel(row.mes), receita: 0, custo: 0 };
    monthMap[row.group_key][row.mes].receita = n(row.receita);
  }
  for (const row of pagMon.rows) {
    if (!monthMap[row.group_key]) monthMap[row.group_key] = {};
    if (!monthMap[row.group_key][row.mes]) monthMap[row.group_key][row.mes] = { mes: row.mes, label: monthLabel(row.mes), receita: 0, custo: 0 };
    monthMap[row.group_key][row.mes].custo = n(row.custo);
  }

  // Merge by plate
  const map = {};
  for (const row of rec.rows) {
    map[row.group_key] = {
      groupKey: row.group_key,
      label: row.label || SEM_CENTRO,
      placa: row.label || SEM_CENTRO,
      placaVeiculo: row.placa_veiculo || null,
      nomeVeiculo: row.nome_veiculo || null,
      centroCodigo: row.centro_codigo || null,
      nomeCentroCusto: row.nome_centro_custo || null,
      receita: n(row.receita), recAberto: n(row.aberto), recPago: n(row.pago), recVencido: n(row.vencido), recLancamentos: n(row.lancamentos),
      custo: 0, pagAberto: 0, pagPago: 0, pagVencido: 0, pagLancamentos: 0,
    };
  }
  for (const row of pag.rows) {
    if (!map[row.group_key]) {
      map[row.group_key] = {
        groupKey: row.group_key,
        label: row.label || SEM_CENTRO,
        placa: row.label || SEM_CENTRO,
        placaVeiculo: row.placa_veiculo || null,
        nomeVeiculo: row.nome_veiculo || null,
        centroCodigo: row.centro_codigo || null,
        nomeCentroCusto: row.nome_centro_custo || null,
        receita: 0, recAberto: 0, recPago: 0, recVencido: 0, recLancamentos: 0,
      };
    }
    map[row.group_key].custo = n(row.custo);
    map[row.group_key].pagAberto = n(row.aberto);
    map[row.group_key].pagPago = n(row.pago);
    map[row.group_key].pagVencido = n(row.vencido);
    map[row.group_key].pagLancamentos = n(row.lancamentos);
  }

  const placas = Object.values(map).map(item => {
    const saldo = item.receita - item.custo;
    const margem = item.receita > 0 ? (saldo / item.receita) * 100 : (item.custo > 0 ? -100 : 0);
    const monthly = Object.values(monthMap[item.groupKey] || {}).sort((a, b) => a.mes.localeCompare(b.mes));
    return {
      groupKey: item.groupKey,
      label: item.label,
      placa: item.placa,
      placaVeiculo: item.placaVeiculo,
      nomeVeiculo: item.nomeVeiculo,
      centroCodigo: item.centroCodigo,
      nomeCentroCusto: item.nomeCentroCusto,
      receita: r2(item.receita),
      recAberto: r2(item.recAberto),
      recPago: r2(item.recPago),
      recVencido: r2(item.recVencido),
      recLancamentos: item.recLancamentos,
      custo: r2(item.custo),
      pagAberto: r2(item.pagAberto),
      pagPago: r2(item.pagPago),
      pagVencido: r2(item.pagVencido),
      pagLancamentos: item.pagLancamentos,
      saldo: r2(saldo),
      margem: r2(margem),
      monthly,
    };
  }).sort((a, b) => b.saldo - a.saldo);

  const totReceita = r2(placas.reduce((s, x) => s + x.receita, 0));
  const totCusto = r2(placas.reduce((s, x) => s + x.custo, 0));
  const totSaldo = r2(totReceita - totCusto);
  const diagnostic = validation.rows[0] || {};
  const receitaBase = r2(diagnostic.receita_base_agrupavel);
  const custoBase = r2(diagnostic.custo_base_agrupavel);

  console.info("[financeiro/por-placa] validacao", {
    period: p,
    receita: {
      brutoTabela: r2(diagnostic.receita_bruta_tabela),
      baseAgrupavel: receitaBase,
      agrupado: totReceita,
      diffBrutoAgrupado: r2(n(diagnostic.receita_bruta_tabela) - totReceita),
      diffBaseAgrupado: r2(receitaBase - totReceita),
      lancamentosTabela: n(diagnostic.receita_lancamentos_tabela),
      linhasAgrupaveis: n(diagnostic.receita_linhas_agrupaveis),
    },
    custo: {
      brutoTabela: r2(diagnostic.custo_bruto_tabela),
      baseAgrupavel: custoBase,
      agrupado: totCusto,
      diffBrutoAgrupado: r2(n(diagnostic.custo_bruto_tabela) - totCusto),
      diffBaseAgrupado: r2(custoBase - totCusto),
      lancamentosTabela: n(diagnostic.custo_lancamentos_tabela),
      linhasAgrupaveis: n(diagnostic.custo_linhas_agrupaveis),
    },
  });

  return {
    period: p,
    totals: {
      receita: totReceita,
      custo: totCusto,
      saldo: totSaldo,
      margem: r2(totReceita > 0 ? (totSaldo / totReceita) * 100 : 0),
      placas: placas.length,
      placasPositivas: placas.filter(x => x.saldo > 0).length,
      placasNegativas: placas.filter(x => x.saldo < 0).length,
    },
    placas,
  };
}
