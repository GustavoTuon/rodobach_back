import { clientPool } from "../db/clientPool.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function pctChange(current, previous) {
  return previous > 0 ? r2(((current - previous) / previous) * 100) : null;
}

function currentYear() {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(new Date()));
}

function currentMonth() {
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    month: "numeric",
  }).format(new Date()));
}

function normalizeYear(value) {
  const year = Number(value);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  return currentYear();
}

function normalizeTipo(value) {
  const v = String(value || "todos").trim().toLowerCase();
  if (["frota", "proprio", "próprio"].includes(v)) return "frota";
  if (["terceiro", "terceiros"].includes(v)) return "terceiro";
  return "todos";
}

function normalizeMonth(value) {
  const month = Number(value);
  if (Number.isInteger(month) && month >= 1 && month <= 12) return month;
  return currentMonth();
}

function parseMesAno(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = normalizeYear(match[1]);
  const month = normalizeMonth(match[2]);
  return { year, month };
}

function monthName(index) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, index - 1, 1)))
    .replace(".", "")
    .replace(/^./, (char) => char.toUpperCase());
}

function emptyMonths(year) {
  return Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    chave: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: monthName(i + 1),
    faturamento: 0,
    ticketMedio: 0,
    clientes: 0,
    lancamentos: 0,
  }));
}

function sumRows(rows) {
  const faturamento = r2(rows.reduce((sum, row) => sum + num(row.faturamento), 0));
  const lancamentos = rows.reduce((sum, row) => sum + num(row.lancamentos), 0);
  const clientes = rows.reduce((sum, row) => sum + num(row.clientes), 0);
  return {
    faturamento,
    lancamentos,
    clientes,
    ticketMedio: r2(lancamentos > 0 ? faturamento / lancamentos : 0),
  };
}

function mapMonths(year, rows) {
  const months = emptyMonths(year);
  const map = new Map(months.map((row) => [row.mes, row]));

  rows.forEach((row) => {
    const month = num(row.mes);
    const current = map.get(month);
    if (!current) return;
    current.faturamento = r2(row.faturamento);
    current.lancamentos = num(row.lancamentos);
    current.clientes = num(row.clientes);
    current.ticketMedio = r2(current.lancamentos > 0 ? current.faturamento / current.lancamentos : 0);
  });

  return months;
}

function optionParams(filters, year, tipoVeiculo, mesReferencia, modoMes) {
  return [
    year,
    filters.cliente ? Number(filters.cliente) || null : null,
    filters.placa ? String(filters.placa).trim().toUpperCase() : null,
    tipoVeiculo,
    mesReferencia,
    modoMes,
  ];
}

const RECEITA_BASE = `
  FROM financeiro.receber rec
  INNER JOIN financeiro.valorliquidorateiosreceber vlr
    ON rec.empresarec = vlr.empresa
   AND rec.serierec = vlr.serie
   AND rec.duplicatarec = vlr.duplicata
   AND rec.parcelarec = vlr.parcela
  LEFT JOIN LATERAL (
    SELECT v.placavei, v.tipopropriedadevei
    FROM frotas.veiculos v
    WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(rec.veiculorec::text))
      AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
    ORDER BY (v.empresavei = rec.empresarec) DESC, v.empresavei
    LIMIT 1
  ) vei_doc ON true
  LEFT JOIN LATERAL (
    SELECT v.placavei, v.tipopropriedadevei
    FROM frotas.veiculos v
    WHERE v.centrocustovei = vlr.centrocusto
      AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
    ORDER BY (v.empresavei = rec.empresarec) DESC, v.empresavei
    LIMIT 1
  ) vei_cc ON true
`;

const RECEITA_FILTERS = `
  rec.statusrec IN (1,2)
  AND rec.dataemissaorec::date >= make_date(($1::int - 1), 1, 1)
  AND rec.dataemissaorec::date <= (make_date($1::int, $5::int, 1) + INTERVAL '1 month - 1 day')::date
  AND EXTRACT(MONTH FROM rec.dataemissaorec)::int <= $5::int
  AND ($6::boolean = false OR EXTRACT(MONTH FROM rec.dataemissaorec)::int = $5::int)
  AND ($2::int IS NULL OR rec.clienterec = $2::int)
  AND ($3::text IS NULL OR UPPER(TRIM(COALESCE(rec.veiculorec, vei_cc.placavei)::text)) = $3::text)
  AND (
    $4::text = 'todos'
    OR ($4::text = 'frota' AND COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei)::text = 'P')
    OR ($4::text = 'terceiro'
      AND NULLIF(TRIM(COALESCE(rec.veiculorec, vei_cc.placavei)::text), '') IS NOT NULL
      AND COALESCE(COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei)::text, 'T') <> 'P')
  )
`;

export async function getFaturamentoMensalComparativo(filters = {}) {
  const mesAno = parseMesAno(filters.mesAno || filters.monthYear);
  const year = mesAno?.year || normalizeYear(filters.ano || filters.year);
  const previousYear = year - 1;
  const tipoVeiculo = normalizeTipo(filters.tipoVeiculo || filters.tipo || filters.proprietario);
  const mesReferencia = mesAno?.month || normalizeMonth(filters.mesReferencia || filters.mes || filters.month);
  const modoMes = Boolean(mesAno || filters.modoMes || filters.somenteMes);
  const params = optionParams(filters, year, tipoVeiculo, mesReferencia, modoMes);

  const [monthlyRes, optionsRes] = await Promise.all([
    clientPool.query(`
      SELECT
        EXTRACT(YEAR FROM rec.dataemissaorec)::int AS ano,
        EXTRACT(MONTH FROM rec.dataemissaorec)::int AS mes,
        COALESCE(SUM(vlr.valorliquido), 0) AS faturamento,
        COUNT(*)::int AS lancamentos,
        COUNT(DISTINCT rec.clienterec)::int AS clientes
      ${RECEITA_BASE}
      WHERE ${RECEITA_FILTERS}
      GROUP BY EXTRACT(YEAR FROM rec.dataemissaorec), EXTRACT(MONTH FROM rec.dataemissaorec)
      ORDER BY ano, mes
    `, params),
    clientPool.query(`
      SELECT
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'codigo', rec.clienterec,
          'nome', COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), rec.clienterec::text)
        )) FILTER (WHERE rec.clienterec IS NOT NULL), '[]'::jsonb) AS clientes,
        COALESCE(jsonb_agg(DISTINCT UPPER(TRIM(COALESCE(rec.veiculorec, vei_cc.placavei)::text)))
          FILTER (WHERE NULLIF(TRIM(COALESCE(rec.veiculorec, vei_cc.placavei)::text), '') IS NOT NULL), '[]'::jsonb) AS placas
      ${RECEITA_BASE}
      LEFT JOIN LATERAL (
        SELECT nomecli, fantasiacli
        FROM gerais.clientes
        WHERE codigocli = rec.clienterec
        LIMIT 1
      ) cli ON true
      WHERE ${RECEITA_FILTERS}
        AND EXTRACT(YEAR FROM rec.dataemissaorec)::int = $1::int
    `, params),
  ]);

  const allMesesAtual = mapMonths(year, monthlyRes.rows.filter((row) => num(row.ano) === year)).slice(0, mesReferencia);
  const allMesesAnterior = mapMonths(previousYear, monthlyRes.rows.filter((row) => num(row.ano) === previousYear)).slice(0, mesReferencia);
  const mesesAtual = modoMes ? allMesesAtual.filter((row) => row.mes === mesReferencia) : allMesesAtual;
  const mesesAnterior = modoMes ? allMesesAnterior.filter((row) => row.mes === mesReferencia) : allMesesAnterior;

  const meses = mesesAtual.map((row, index) => {
    const prev = mesesAnterior[index] || {};
    return {
      mes: row.mes,
      label: row.label,
      atual: row,
      anterior: prev,
      diferenca: {
        faturamento: r2(num(row.faturamento) - num(prev.faturamento)),
        faturamentoPct: pctChange(row.faturamento, prev.faturamento),
        lancamentos: num(row.lancamentos) - num(prev.lancamentos),
      },
    };
  });

  const resumoAtual = sumRows(mesesAtual);
  const resumoAnterior = sumRows(mesesAnterior);
  const optionRow = optionsRes.rows[0] || {};

  return {
    ano: year,
    anoAnterior: previousYear,
    mesReferencia,
    mesReferenciaLabel: monthName(mesReferencia),
    mesAno: `${year}-${String(mesReferencia).padStart(2, "0")}`,
    modoMes,
    filtros: {
      tipoVeiculo,
      clientes: Array.isArray(optionRow.clientes) ? optionRow.clientes.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""))) : [],
      placas: Array.isArray(optionRow.placas) ? optionRow.placas.sort().map((placa) => ({ placa })) : [],
    },
    resumo: {
      atual: resumoAtual,
      anterior: resumoAnterior,
      diferenca: {
        faturamento: r2(resumoAtual.faturamento - resumoAnterior.faturamento),
        faturamentoPct: pctChange(resumoAtual.faturamento, resumoAnterior.faturamento),
        lancamentos: resumoAtual.lancamentos - resumoAnterior.lancamentos,
      },
    },
    meses,
    audit: {
      fonte: "financeiro.receber + financeiro.valorliquidorateiosreceber, agrupado por data de emissao.",
      tabelas: ["financeiro.receber", "financeiro.valorliquidorateiosreceber", "frotas.veiculos"],
    },
  };
}
