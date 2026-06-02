import { clientPool } from "../db/clientPool.js";

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(value))
    .replace(".", "");
}

function resolvePeriod({ period, startDate, endDate } = {}) {
  if (startDate && endDate) {
    return { key: "custom", label: "Personalizado", startDate, endDate };
  }

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  const key = String(period || "month").toLowerCase();

  if (key === "7d") {
    start.setUTCDate(end.getUTCDate() - 6);
    return { key, label: "7 dias", startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  if (key === "30d") {
    start.setUTCDate(end.getUTCDate() - 29);
    return { key, label: "30 dias", startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  start.setUTCDate(1);
  return { key: "month", label: "Este mes", startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

function classifyGroup(row) {
  const name = String(row.contaFinanceira || "").toLowerCase();
  const mask = String(row.mascara || "");

  if (row.origem === "receita") return "Receita Bruta";
  if (name.includes("icms") || name.includes("iss") || name.includes("pis") || name.includes("cofins") || name.includes("irpj") || name.includes("csll") || name.includes("inss") || name.includes("sest")) return "Impostos";
  if (name.includes("combust") || name.includes("pedagio") || name.includes("borracha") || name.includes("manutenc") || name.includes("seguro") || mask.startsWith("4.")) return "Custos de Transporte";
  if (name.includes("salario") || name.includes("folha") || name.includes("ferias") || name.includes("rescis") || name.includes("pro labore")) return "Despesas com Pessoal";
  if (name.includes("tarifa") || name.includes("juros") || name.includes("banc") || name.includes("cartao")) return "Despesas Financeiras";
  if (name.includes("financi") || name.includes("consorcio") || name.includes("emprestimo")) return "Financiamento de Veiculos";
  if (name.includes("veicul") || name.includes("frota") || name.includes("rastreamento")) return "Frota";
  if (mask.startsWith("6.")) return "Despesas Administrativas";
  return row.origem === "movimentacao" ? "Outras Movimentacoes" : "Despesas Operacionais";
}

function accumulate(map, key, values, meta) {
  const current = map.get(key) || { valor: 0, receita: 0, custo: 0, lancamentos: 0, ...meta };
  current.valor += values.valor || 0;
  current.receita += values.receita || 0;
  current.custo += values.custo || 0;
  current.lancamentos += values.lancamentos || 0;
  map.set(key, current);
}

export async function getDemonstrativoFinanceiro({
  period,
  startDate,
  endDate,
  empresa = 2,
  centro,
  conta,
  search,
} = {}) {
  const resolved = resolvePeriod({ period, startDate, endDate });
  const empresaCod = Number(empresa) || 2;
  const centroCod = centro ? Number(centro) : null;
  const contaCod = conta ? Number(conta) : null;
  const searchText = search ? String(search).trim() : null;

  const query = `
    WITH params AS (
      SELECT
        $1::int AS empresa,
        $2::date AS data_inicio,
        $3::date AS data_fim,
        $4::int AS centro,
        $5::int AS conta,
        NULLIF($6::text, '') AS busca
    ),
    base AS (
      SELECT
        'receita'::text AS origem,
        rec.empresarec AS empresa,
        rec.datavencimentorec::date AS data_base,
        vlr.centrocusto,
        vlr.contafinanceira,
        vlr.valorliquido AS valor
      FROM financeiro.receber rec
      INNER JOIN financeiro.valorliquidorateiosreceber vlr
        ON rec.empresarec = vlr.empresa
       AND rec.serierec = vlr.serie
       AND rec.duplicatarec = vlr.duplicata
       AND rec.parcelarec = vlr.parcela
      INNER JOIN params p ON p.empresa = rec.empresarec
      WHERE rec.statusrec IN (1, 2)
        AND rec.datavencimentorec::date >= p.data_inicio
        AND rec.datavencimentorec::date <= p.data_fim
        AND (p.centro IS NULL OR vlr.centrocusto = p.centro)
        AND (p.conta IS NULL OR vlr.contafinanceira = p.conta)

      UNION ALL

      SELECT
        'custo_despesa'::text AS origem,
        pag.empresapag AS empresa,
        pag.datavencimentopag::date AS data_base,
        vlp.centrocusto,
        vlp.contafinanceira,
        vlp.valorliquido * -1 AS valor
      FROM financeiro.pagar pag
      INNER JOIN financeiro.valorliquidorateiospagar vlp
        ON pag.empresapag = vlp.empresa
       AND pag.seriepag = vlp.serie
       AND pag.duplicatapag = vlp.duplicata
       AND pag.parcelapag = vlp.parcela
       AND pag.fornecedorpag = vlp.fornecedor
      INNER JOIN params p ON p.empresa = pag.empresapag
      WHERE pag.statuspag IN (1, 2)
        AND pag.datavencimentopag::date >= p.data_inicio
        AND pag.datavencimentopag::date <= p.data_fim
        AND (p.centro IS NULL OR vlp.centrocusto = p.centro)
        AND (p.conta IS NULL OR vlp.contafinanceira = p.conta)

      UNION ALL

      SELECT
        'movimentacao'::text AS origem,
        mfr.empresa,
        mfr.data::date AS data_base,
        mfr.centrocusto,
        mfr.contafinanceira,
        mfr.valor
      FROM financeiro.movimentacaofinanceirarateadasinalizada mfr
      INNER JOIN params p ON p.empresa = mfr.empresa
      WHERE mfr.data::date >= p.data_inicio
        AND mfr.data::date <= p.data_fim
        AND NOT mfr.duplicatagerada
        AND (p.centro IS NULL OR mfr.centrocusto = p.centro)
        AND (p.conta IS NULL OR mfr.contafinanceira = p.conta)
    ),
    enriched AS (
      SELECT
        b.*,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        cfi.nomecfi AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        cfi.naturezacfi AS conta_natureza
      FROM base b
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = b.centrocusto
        ORDER BY (c.empresaccs = b.empresa) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT c.nomecfi, c.mascaracfi, c.naturezacfi
        FROM financeiro.contasfinanceiras c
        WHERE c.codigocfi = b.contafinanceira
        ORDER BY (c.empresacfi = b.empresa) DESC, c.empresacfi
        LIMIT 1
      ) cfi ON true
      CROSS JOIN params p
      WHERE (
        p.busca IS NULL
        OR cc.nomeccs ILIKE '%' || p.busca || '%'
        OR cfi.nomecfi ILIKE '%' || p.busca || '%'
        OR cc.mascaraccs ILIKE '%' || p.busca || '%'
        OR cfi.mascaracfi ILIKE '%' || p.busca || '%'
      )
    )
    SELECT
      origem,
      empresa,
      date_trunc('month', data_base)::date AS mes,
      centrocusto AS centro_codigo,
      COALESCE(centro_nome, 'Sem centro de custo') AS centro_nome,
      centro_mascara,
      contafinanceira AS conta_codigo,
      COALESCE(conta_nome, 'Sem conta financeira') AS conta_nome,
      conta_mascara,
      conta_natureza,
      COUNT(*)::int AS lancamentos,
      SUM(valor)::numeric AS valor
    FROM enriched
    GROUP BY origem, empresa, mes, centrocusto, centro_nome, centro_mascara, contafinanceira, conta_nome, conta_mascara, conta_natureza
    ORDER BY mes, centro_mascara NULLS LAST, conta_mascara NULLS LAST, conta_nome
  `;

  const result = await clientPool.query(query, [
    empresaCod,
    resolved.startDate,
    resolved.endDate,
    centroCod,
    contaCod,
    searchText,
  ]);

  const rows = result.rows.map((row) => {
    const valor = num(row.valor);
    const grupo = classifyGroup({
      origem: row.origem,
      contaFinanceira: row.conta_nome,
      mascara: row.conta_mascara,
    });

    return {
      origem: row.origem,
      empresa: row.empresa,
      mes: dateOnly(row.mes),
      labelMes: monthLabel(row.mes),
      centroCodigo: row.centro_codigo,
      centroNome: row.centro_nome,
      centroMascara: row.centro_mascara,
      contaCodigo: row.conta_codigo,
      contaNome: row.conta_nome,
      contaMascara: row.conta_mascara,
      contaNatureza: row.conta_natureza,
      grupo,
      lancamentos: num(row.lancamentos),
      valor,
      receita: valor > 0 ? valor : 0,
      custo: valor < 0 ? Math.abs(valor) : 0,
    };
  });

  const summary = rows.reduce((acc, row) => {
    acc.receita += row.receita;
    acc.custos += row.custo;
    acc.movimentacoes += row.origem === "movimentacao" ? row.valor : 0;
    acc.lancamentos += row.lancamentos;
    return acc;
  }, { receita: 0, custos: 0, movimentacoes: 0, lancamentos: 0 });
  summary.lucro = summary.receita - summary.custos + summary.movimentacoes;
  summary.margem = summary.receita > 0 ? (summary.lucro / summary.receita) * 100 : 0;

  const monthlyMap = new Map();
  const groupMap = new Map();
  const centerMap = new Map();
  const accountMap = new Map();

  for (const row of rows) {
    const values = { valor: row.valor, receita: row.receita, custo: row.custo, lancamentos: row.lancamentos };
    accumulate(monthlyMap, row.mes, values, { mes: row.mes, label: row.labelMes });
    accumulate(groupMap, row.grupo, values, { grupo: row.grupo });
    accumulate(centerMap, String(row.centroCodigo), values, {
      centroCodigo: row.centroCodigo,
      centroNome: row.centroNome,
      centroMascara: row.centroMascara,
    });
    accumulate(accountMap, `${row.contaCodigo}:${row.grupo}`, values, {
      contaCodigo: row.contaCodigo,
      contaNome: row.contaNome,
      contaMascara: row.contaMascara,
      grupo: row.grupo,
    });
  }

  return {
    period: resolved,
    empresa: empresaCod,
    summary,
    monthly: Array.from(monthlyMap.values()).sort((a, b) => String(a.mes).localeCompare(String(b.mes))),
    groups: Array.from(groupMap.values()).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    centers: Array.from(centerMap.values()).sort((a, b) => b.valor - a.valor),
    accounts: Array.from(accountMap.values()).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    rows,
    sources: [
      "financeiro.receber",
      "financeiro.pagar",
      "financeiro.valorliquidorateiosreceber",
      "financeiro.valorliquidorateiospagar",
      "financeiro.movimentacaofinanceirarateadasinalizada",
      "financeiro.centroscustos",
      "financeiro.contasfinanceiras",
    ],
  };
}
