import { clientPool } from "../db/clientPool.js";

const TYPES = {
  receivable: {
    label: "Receitas",
    cte: `
WITH lancamentos AS (
        SELECT
          'receivable'::text AS tipo,
          centro.codigo::int AS centro_codigo,
          to_jsonb(ccs) AS centro_data,
          rec.empresarec AS empresa,
          rec.serierec AS serie,
          rec.duplicatarec AS duplicata,
          rec.parcelarec AS parcela,
          rec.clienterec AS pessoa,
          COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, '')) AS pessoa_nome,
          cli.nomecli AS pessoa_razao,
          cli.fantasiacli AS pessoa_fantasia,
          cli.cnpjcpfcli AS pessoa_documento,
          rec.dataemissaorec AS data_emissao,
          rec.datavencimentorec AS data_vencimento,
          rec.valorfaturarec AS valor_fatura,
          rec.valorduplicatarec AS valor_documento,
          rec.valordescontorec AS valor_desconto,
          rec.valorjurosrec AS valor_juros,
          rec.valorabertorec AS valor_aberto,
          rec.statusrec AS status,
          rec.condicaopagamentorec AS condicao_pagamento,
          rec.formarecebimentorec AS forma_pagamento,
          rec.observacaorec AS observacao,
          rec.documentorec AS documento,
          rec.contasfinanceirasrec AS conta_financeira,
          conta_financeira.codigo::int AS classificacao_codigo,
          cfi.nomecfi AS classificacao_nome,
          cfi.tipocfi AS classificacao_tipo,
          cfi.naturezacfi AS classificacao_natureza,
          cfi.mascaracfi AS classificacao_mascara,
          rec.contacontabilrec AS conta_contabil,
          rec.motoristarec AS motorista,
          rec.veiculorec AS veiculo
        FROM financeiro.receber rec
        INNER JOIN LATERAL unnest(rec.centrosdecustorec) AS centro(codigo) ON true
        LEFT JOIN LATERAL unnest(rec.contasfinanceirasrec) AS conta_financeira(codigo) ON true
        LEFT JOIN financeiro.centroscustos ccs
          ON ccs.codigoccs = centro.codigo
        LEFT JOIN LATERAL (
          SELECT conta.nomecfi, conta.tipocfi, conta.naturezacfi, conta.mascaracfi
          FROM financeiro.contasfinanceiras conta
          WHERE conta.codigocfi = conta_financeira.codigo
          ORDER BY (conta.empresacfi = rec.empresarec) DESC, conta.empresacfi
          LIMIT 1
        ) cfi ON true
        LEFT JOIN LATERAL (
          SELECT cliente.nomecli, cliente.fantasiacli, cliente.cnpjcpfcli
          FROM gerais.clientes cliente
          WHERE cliente.codigocli = rec.clienterec
          ORDER BY (cliente.empresacli = rec.empresarec) DESC, cliente.empresacli
          LIMIT 1
        ) cli ON true
        WHERE ($1::date IS NULL OR rec.datavencimentorec::date >= $1::date)
          AND ($2::date IS NULL OR rec.datavencimentorec::date <= $2::date)
          AND ($3::int IS NULL OR $3::int = ANY(rec.centrosdecustorec))
          AND ($3::int IS NULL OR centro.codigo = $3::int)
          AND (
            $4::text IS NULL
            OR rec.clienterec::text ILIKE '%' || $4::text || '%'
            OR centro.codigo::text ILIKE '%' || $4::text || '%'
            OR rec.veiculorec::text ILIKE '%' || $4::text || '%'
            OR ccs::text ILIKE '%' || $4::text || '%'
            OR cfi.nomecfi ILIKE '%' || $4::text || '%'
            OR cfi.mascaracfi ILIKE '%' || $4::text || '%'
            OR cli.nomecli ILIKE '%' || $4::text || '%'
            OR cli.fantasiacli ILIKE '%' || $4::text || '%'
            OR cli.cnpjcpfcli ILIKE '%' || $4::text || '%'
            OR rec.duplicatarec::text ILIKE '%' || $4::text || '%'
            OR rec.documentorec::text ILIKE '%' || $4::text || '%'
            OR rec.observacaorec::text ILIKE '%' || $4::text || '%'
          )
      )`,
  },
  payable: {
    label: "Custos",
    cte: `
WITH lancamentos AS (
        SELECT
          'payable'::text AS tipo,
          centro.codigo::int AS centro_codigo,
          to_jsonb(ccs) AS centro_data,
          pag.empresapag AS empresa,
          pag.seriepag AS serie,
          pag.duplicatapag AS duplicata,
          pag.parcelapag AS parcela,
          pag.fornecedorpag AS pessoa,
          COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, '')) AS pessoa_nome,
          forn.nomefor AS pessoa_razao,
          forn.fantasiafor AS pessoa_fantasia,
          forn.cnpjcpffor AS pessoa_documento,
          pag.dataemissaopag AS data_emissao,
          pag.datavencimentopag AS data_vencimento,
          pag.valorfaturapag AS valor_fatura,
          pag.valorduplicatapag AS valor_documento,
          pag.valordescontopag AS valor_desconto,
          pag.valorjurospag AS valor_juros,
          pag.valorabertopag AS valor_aberto,
          pag.statuspag AS status,
          pag.condicaopagamentopag AS condicao_pagamento,
          pag.formapagamentopag AS forma_pagamento,
          pag.observacaopag AS observacao,
          pag.documentopag AS documento,
          pag.contasfinanceiraspag AS conta_financeira,
          conta_financeira.codigo::int AS classificacao_codigo,
          cfi.nomecfi AS classificacao_nome,
          cfi.tipocfi AS classificacao_tipo,
          cfi.naturezacfi AS classificacao_natureza,
          cfi.mascaracfi AS classificacao_mascara,
          pag.contacontabilfornecedorpag AS conta_contabil,
          pag.motoristapag AS motorista,
          pag.veiculopag AS veiculo
        FROM financeiro.pagar pag
        INNER JOIN LATERAL unnest(pag.centrosdecustopag) AS centro(codigo) ON true
        LEFT JOIN LATERAL unnest(pag.contasfinanceiraspag) AS conta_financeira(codigo) ON true
        LEFT JOIN financeiro.centroscustos ccs
          ON ccs.codigoccs = centro.codigo
        LEFT JOIN LATERAL (
          SELECT conta.nomecfi, conta.tipocfi, conta.naturezacfi, conta.mascaracfi
          FROM financeiro.contasfinanceiras conta
          WHERE conta.codigocfi = conta_financeira.codigo
          ORDER BY (conta.empresacfi = pag.empresapag) DESC, conta.empresacfi
          LIMIT 1
        ) cfi ON true
        LEFT JOIN LATERAL (
          SELECT fornecedor.nomefor, fornecedor.fantasiafor, fornecedor.cnpjcpffor
          FROM gerais.fornecedores fornecedor
          WHERE fornecedor.codigofor = pag.fornecedorpag
          ORDER BY (fornecedor.empresafor = pag.empresapag) DESC, fornecedor.empresafor
          LIMIT 1
        ) forn ON true
        WHERE ($1::date IS NULL OR pag.datavencimentopag::date >= $1::date)
          AND ($2::date IS NULL OR pag.datavencimentopag::date <= $2::date)
          AND ($3::int IS NULL OR $3::int = ANY(pag.centrosdecustopag))
          AND ($3::int IS NULL OR centro.codigo = $3::int)
          AND (
            $4::text IS NULL
            OR pag.fornecedorpag::text ILIKE '%' || $4::text || '%'
            OR centro.codigo::text ILIKE '%' || $4::text || '%'
            OR pag.veiculopag::text ILIKE '%' || $4::text || '%'
            OR ccs::text ILIKE '%' || $4::text || '%'
            OR cfi.nomecfi ILIKE '%' || $4::text || '%'
            OR cfi.mascaracfi ILIKE '%' || $4::text || '%'
            OR forn.nomefor ILIKE '%' || $4::text || '%'
            OR forn.fantasiafor ILIKE '%' || $4::text || '%'
            OR forn.cnpjcpffor ILIKE '%' || $4::text || '%'
            OR pag.duplicatapag::text ILIKE '%' || $4::text || '%'
            OR pag.documentopag::text ILIKE '%' || $4::text || '%'
            OR pag.observacaopag::text ILIKE '%' || $4::text || '%'
          )
      )`,
  },
};

const statusSql = `
CASE
    WHEN status::text ILIKE '%cancel%' THEN 'cancelado'
    WHEN COALESCE(valor_aberto, 0) > 0 AND data_vencimento::date < CURRENT_DATE THEN 'vencido'
    WHEN COALESCE(valor_aberto, 0) > 0 THEN 'aberto'
    ELSE 'pago'
  END`;

function number(value) {
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

function resolvePeriod(period = "30d") {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  let key = String(period || "30d").toLowerCase();
  let label = "30 dias";

  if (key === "7d" || key === "7") {
    start.setUTCDate(end.getUTCDate() - 6);
    key = "7d";
    label = "7 dias";
  } else if (key === "month" || key === "mes" || key === "este-mes") {
    start.setUTCDate(1);
    key = "month";
    label = "Este mes";
  } else {
    start.setUTCDate(end.getUTCDate() - 29);
    key = "30d";
    label = "30 dias";
  }

  return { key, label, startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

function buildFilteredQuery(cte, selectSql, orderLimitSql = "") {
  return `${cte},
    filtered_lancamentos AS (
      SELECT
        *,
        ${statusSql} AS status_calculado,
        GREATEST(COALESCE(valor_documento, 0) - COALESCE(valor_aberto, 0), 0)::numeric AS valor_pago
      FROM lancamentos
      WHERE (
        $5::text IS NULL
        OR ${statusSql} = $5::text
        OR status::text = $5::text
      )
      AND ($6::int IS NULL OR classificacao_codigo = $6::int)
    )
    ${selectSql}
    ${orderLimitSql}`;
}

function mapSummary(row = {}) {
  const valorDocumento = number(row.valor_documento);
  const valorAberto = number(row.valor_aberto);
  const valorPago = number(row.valor_pago);
  const valorVencido = number(row.valor_vencido);
  return {
    totalLancamentos: number(row.total_lancamentos),
    valorFatura: number(row.valor_fatura),
    valorDocumento,
    valorDesconto: number(row.valor_desconto),
    valorJuros: number(row.valor_juros),
    valorAberto,
    valorPago,
    valorVencido,
    lancamentosAbertos: number(row.lancamentos_abertos),
    lancamentosVencidos: number(row.lancamentos_vencidos),
    lancamentosPagos: number(row.lancamentos_pagos),
    totalRecebido: valorPago,
    totalAReceber: valorAberto,
    totalPago: valorPago,
    totalAPagar: valorAberto,
    totalVencido: valorVencido,
  };
}

function mapMoneyRow(row) {
  return {
    valorDocumento: number(row.valor_documento),
    valorAberto: number(row.valor_aberto),
    valorPago: number(row.valor_pago),
    valorVencido: number(row.valor_vencido),
    totalLancamentos: number(row.total_lancamentos),
    lancamentosVencidos: number(row.lancamentos_vencidos),
    lancamentosPagos: number(row.lancamentos_pagos),
  };
}

function mapLaunch(row) {
  return {
    id: [row.empresa, row.serie, row.duplicata, row.parcela].filter((item) => item !== null && item !== undefined).join("-"),
    tipo: row.tipo,
    empresa: row.empresa,
    serie: row.serie,
    duplicata: row.duplicata,
    parcela: row.parcela,
    pessoaCodigo: row.pessoa,
    pessoaNome: row.pessoa_nome || row.pessoa_razao || row.pessoa_fantasia || "Nao informado",
    pessoaDocumento: row.pessoa_documento,
    dataEmissao: dateOnly(row.data_emissao),
    dataVencimento: dateOnly(row.data_vencimento),
    dataPagamento: null,
    dataRecebimento: null,
    valorFatura: number(row.valor_fatura),
    valorDocumento: number(row.valor_documento),
    valorDesconto: number(row.valor_desconto),
    valorJuros: number(row.valor_juros),
    valorAberto: number(row.valor_aberto),
    valorPago: number(row.valor_pago),
    valorVencido: row.status_calculado === "vencido" ? number(row.valor_aberto) : 0,
    status: row.status,
    statusCalculado: row.status_calculado,
    descricao: row.observacao || row.documento || "",
    historico: row.observacao || "",
    documento: row.documento,
    formaPagamento: row.forma_pagamento,
    condicaoPagamento: row.condicao_pagamento,
    classificacaoCodigo: row.classificacao_codigo,
    classificacaoNome: row.classificacao_nome || "Sem classificacao",
    classificacaoMascara: row.classificacao_mascara,
    centroCodigo: row.centro_codigo,
    centroData: row.centro_data,
    motorista: row.motorista,
    veiculo: row.veiculo,
  };
}

function monthLabel(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(value))
    .replace(".", "")
    .replace(/^./, (char) => char.toUpperCase());
}

export async function getLancamentosFinanceiros({
  type,
  period,
  startDate,
  endDate,
  centro,
  search,
  status,
  classificacao,
  limit,
} = {}) {
  const source = TYPES[type];
  if (!source) {
    throw new Error("Tipo financeiro invalido. Use receivable ou payable.");
  }

  const resolvedPeriod = resolvePeriod(period);
  const params = [
    startDate || resolvedPeriod.startDate,
    endDate || resolvedPeriod.endDate,
    centro ? Number(centro) : null,
    search ? String(search).trim() : null,
    status ? String(status).trim() : null,
    classificacao ? Number(classificacao) : null,
  ];
  const rowLimit = Math.min(Math.max(Number(limit) || 80, 1), 300);

  const summaryQuery = buildFilteredQuery(source.cte, `
    SELECT
      COUNT(*) AS total_lancamentos,
      COALESCE(SUM(valor_fatura), 0) AS valor_fatura,
      COALESCE(SUM(valor_documento), 0) AS valor_documento,
      COALESCE(SUM(valor_desconto), 0) AS valor_desconto,
      COALESCE(SUM(valor_juros), 0) AS valor_juros,
      COALESCE(SUM(valor_aberto), 0) AS valor_aberto,
      COALESCE(SUM(valor_pago), 0) AS valor_pago,
      COALESCE(SUM(CASE WHEN status_calculado = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS valor_vencido,
      COUNT(*) FILTER (WHERE status_calculado IN ('aberto', 'vencido')) AS lancamentos_abertos,
      COUNT(*) FILTER (WHERE status_calculado = 'vencido') AS lancamentos_vencidos,
      COUNT(*) FILTER (WHERE status_calculado = 'pago') AS lancamentos_pagos
    FROM filtered_lancamentos`);

  const monthlyQuery = buildFilteredQuery(source.cte, `
    SELECT
      date_trunc('month', data_vencimento::date)::date AS mes,
      COALESCE(SUM(valor_documento), 0) AS valor_documento,
      COALESCE(SUM(valor_aberto), 0) AS valor_aberto,
      COALESCE(SUM(valor_pago), 0) AS valor_pago,
      COALESCE(SUM(CASE WHEN status_calculado = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS valor_vencido
    FROM filtered_lancamentos
    GROUP BY mes
    ORDER BY mes`);

  const classificationQuery = buildFilteredQuery(source.cte, `
    SELECT
      classificacao_codigo,
      COALESCE(NULLIF(classificacao_nome, ''), 'Sem classificacao') AS classificacao_nome,
      classificacao_tipo,
      classificacao_natureza,
      classificacao_mascara,
      COUNT(*) AS total_lancamentos,
      COALESCE(SUM(valor_documento), 0) AS valor_documento,
      COALESCE(SUM(valor_aberto), 0) AS valor_aberto,
      COALESCE(SUM(valor_pago), 0) AS valor_pago,
      COALESCE(SUM(CASE WHEN status_calculado = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS valor_vencido,
      COUNT(*) FILTER (WHERE status_calculado = 'vencido') AS lancamentos_vencidos,
      COUNT(*) FILTER (WHERE status_calculado = 'pago') AS lancamentos_pagos
    FROM filtered_lancamentos
    GROUP BY classificacao_codigo, classificacao_nome, classificacao_tipo, classificacao_natureza, classificacao_mascara
    ORDER BY valor_aberto DESC, valor_vencido DESC, valor_documento DESC, classificacao_nome`);

  const rowsQuery = buildFilteredQuery(source.cte, `
    SELECT *
    FROM filtered_lancamentos
    ORDER BY data_vencimento ASC NULLS LAST, valor_aberto DESC, duplicata
    LIMIT $7`);

  const [summaryResult, monthlyResult, classificationResult, rowsResult] = await Promise.all([
    clientPool.query(summaryQuery, params),
    clientPool.query(monthlyQuery, params),
    clientPool.query(classificationQuery, params),
    clientPool.query(rowsQuery, [...params, rowLimit]),
  ]);

  return {
    type,
    label: source.label,
    source: type === "receivable" ? "financeiro.receber" : "financeiro.pagar",
    period: {
      ...resolvedPeriod,
      startDate: params[0],
      endDate: params[1],
    },
    summary: mapSummary(summaryResult.rows[0]),
    monthly: monthlyResult.rows.map((row) => ({
      mes: dateOnly(row.mes),
      label: monthLabel(row.mes),
      ...mapMoneyRow(row),
    })),
    classifications: classificationResult.rows.map((row) => ({
      classificacaoCodigo: row.classificacao_codigo,
      classificacaoNome: row.classificacao_nome,
      classificacaoTipo: row.classificacao_tipo,
      classificacaoNatureza: row.classificacao_natureza,
      classificacaoMascara: row.classificacao_mascara,
      ...mapMoneyRow(row),
    })),
    rows: rowsResult.rows.map(mapLaunch),
  };
}
