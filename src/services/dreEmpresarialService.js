import { clientPool } from "../db/clientPool.js";

const DRE_ORDER = [
  "RECEITA BRUTA",
  "IMPOSTOS / DEDUCOES",
  "RECEITA LIQUIDA",
  "CUSTOS DE TRANSPORTE",
  "CUSTOS COM FROTA",
  "LUCRO BRUTO",
  "DESPESAS COM PESSOAL",
  "DESPESAS ADMINISTRATIVAS",
  "DESPESAS FINANCEIRAS",
  "RESULTADO OPERACIONAL / FINAL",
];

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function r2(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100;
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

function resolvePeriod({ period, startDate, endDate, mesAno } = {}) {
  if (mesAno && /^\d{4}-\d{2}$/.test(String(mesAno))) {
    const [year, month] = String(mesAno).split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { key: "month-year", label: mesAno, startDate: toIsoDate(start), endDate: toIsoDate(end), mesAno };
  }
  if (startDate && endDate) return { key: "custom", label: "Personalizado", startDate, endDate };

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  const key = String(period || "month").toLowerCase();
  if (key === "7d") start.setUTCDate(end.getUTCDate() - 6);
  else if (key === "30d") start.setUTCDate(end.getUTCDate() - 29);
  else start.setUTCDate(1);
  return { key: key === "7d" || key === "30d" ? key : "month", label: key, startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

function normalizeTipo(value) {
  const tipo = String(value || "todos").toLowerCase();
  if (tipo === "administrativo" || tipo === "frota") return tipo;
  return "todos";
}

function normalizeStatus(value) {
  const status = String(value || "todos").toLowerCase();
  return ["pago", "aberto", "vencido", "recebido", "pendente"].includes(status) ? status : "todos";
}

function dreSign(category) {
  return category === "RECEITA BRUTA" ? 1 : -1;
}

function extractPlate(...values) {
  for (const value of values) {
    const match = String(value || "").toUpperCase().match(/[A-Z]{3}[0-9][A-Z0-9][0-9]{2}/);
    if (match) return match[0];
  }
  return null;
}

function buildSummary(rows) {
  // Soma com sinal preservado e so entao inverte o sinal das categorias de
  // dedução, garantindo que o "Resultado Final" seja sempre a soma
  // líquida de todos os lançamentos (igual ao "Total Geral" do
  // Demonstrativo por Conta Financeira).
  const sumCategory = (category) => rows
    .filter((row) => row.categoriaDre === category)
    .reduce((total, row) => total + n(row.valor), 0);

  const receitaBruta = sumCategory("RECEITA BRUTA");
  const impostos = -sumCategory("IMPOSTOS / DEDUCOES");
  const custosTransporte = -sumCategory("CUSTOS DE TRANSPORTE");
  const custosFrota = -sumCategory("CUSTOS COM FROTA");
  const despesasPessoal = -sumCategory("DESPESAS COM PESSOAL");
  const despesasAdministrativas = -sumCategory("DESPESAS ADMINISTRATIVAS");
  const despesasFinanceiras = -sumCategory("DESPESAS FINANCEIRAS");
  const despesasOperacionais = -sumCategory("DESPESAS OPERACIONAIS");

  const receitaLiquida = receitaBruta - impostos;
  const lucroBruto = receitaLiquida - custosTransporte - custosFrota;
  const resultadoFinal = lucroBruto - despesasPessoal - despesasAdministrativas - despesasFinanceiras - despesasOperacionais;
  const totalCustos = custosTransporte + custosFrota + despesasPessoal + despesasAdministrativas + despesasFinanceiras + despesasOperacionais;
  const margemLucro = receitaBruta > 0 ? (resultadoFinal / receitaBruta) * 100 : 0;

  const cards = {
    receitaBruta: r2(receitaBruta),
    impostos: r2(impostos),
    receitaLiquida: r2(receitaLiquida),
    custosTransporte: r2(custosTransporte),
    custosFrota: r2(custosFrota),
    despesasOperacionais: r2(despesasOperacionais),
    despesasAdministrativas: r2(despesasAdministrativas),
    despesasPessoal: r2(despesasPessoal),
    despesasFinanceiras: r2(despesasFinanceiras),
    resultadoFinal: r2(resultadoFinal),
    margemLucro: r2(margemLucro),
    totalCustos: r2(totalCustos),
    lancamentos: rows.reduce((total, row) => total + n(row.lancamentos), 0),
  };

  const structure = [
    { label: "RECEITA BRUTA", value: cards.receitaBruta, kind: "total" },
    { label: "(-) IMPOSTOS / DEDUCOES", value: -cards.impostos, kind: "deduction" },
    { label: "= RECEITA LIQUIDA", value: cards.receitaLiquida, kind: "result" },
    { label: "(-) CUSTOS DE TRANSPORTE", value: -cards.custosTransporte, kind: "deduction" },
    { label: "(-) CUSTOS COM FROTA", value: -cards.custosFrota, kind: "deduction" },
    { label: "= LUCRO BRUTO", value: r2(lucroBruto), kind: "result" },
    { label: "(-) DESPESAS COM PESSOAL", value: -cards.despesasPessoal, kind: "deduction" },
    { label: "(-) DESPESAS ADMINISTRATIVAS", value: -cards.despesasAdministrativas, kind: "deduction" },
    { label: "(-) DESPESAS FINANCEIRAS", value: -cards.despesasFinanceiras, kind: "deduction" },
    { label: "(-) FINANCIAMENTO / OUTRAS DESPESAS OPERACIONAIS", value: -cards.despesasOperacionais, kind: "deduction" },
    { label: "= RESULTADO OPERACIONAL / FINAL", value: cards.resultadoFinal, kind: "final" },
  ];

  return { cards, structure };
}

function add(map, key, values, meta = {}) {
  const current = map.get(key) || { valor: 0, receita: 0, custo: 0, lancamentos: 0, ...meta };
  current.valor += n(values.valor);
  current.receita += n(values.receita);
  current.custo += n(values.custo);
  current.lancamentos += n(values.lancamentos);
  map.set(key, current);
}

function aggregate(rows) {
  const monthly = new Map();
  const categories = new Map();
  const accounts = new Map();
  const centers = new Map();
  const plates = new Map();

  for (const row of rows) {
    const receita = row.valor > 0 ? row.valor : 0;
    const custo = row.valor < 0 ? Math.abs(row.valor) : 0;
    const values = { valor: row.valor, receita, custo, lancamentos: row.lancamentos };
    add(monthly, row.mes, values, { mes: row.mes, label: row.labelMes });
    add(categories, row.categoriaDre, values, { categoriaDre: row.categoriaDre, order: DRE_ORDER.indexOf(row.categoriaDre) });
    add(accounts, `${row.contaCodigo || "sem"}:${row.categoriaDre}`, values, { contaCodigo: row.contaCodigo, contaNome: row.contaFinanceira, contaMascara: row.contaMascara, categoriaDre: row.categoriaDre });
    add(centers, String(row.centroCodigo || "sem"), values, { centroCodigo: row.centroCodigo, centroCusto: row.centroCusto, centroMascara: row.centroMascara });
    if (row.placa) add(plates, row.placa, values, { placa: row.placa, veiculoNome: row.veiculoNome, centroCusto: row.centroCusto });
  }

  return {
    monthly: Array.from(monthly.values()).sort((a, b) => String(a.mes).localeCompare(String(b.mes))).map((row) => ({ ...row, lucro: r2(row.receita - row.custo) })),
    categories: Array.from(categories.values()).sort((a, b) => {
      const orderA = a.order === -1 ? DRE_ORDER.length : a.order;
      const orderB = b.order === -1 ? DRE_ORDER.length : b.order;
      return orderA - orderB;
    }),
    accounts: Array.from(accounts.values()).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    centers: Array.from(centers.values()).sort((a, b) => a.valor - b.valor),
    plates: Array.from(plates.values()).sort((a, b) => b.custo - a.custo),
  };
}

function buildManagement(rows, aggr) {
  const expenseRows = rows.filter((row) => row.tipo !== "Receita");
  const recurring = aggr.accounts
    .map((account) => {
      const months = new Set(rows.filter((row) => row.contaCodigo === account.contaCodigo && row.tipo !== "Receita").map((row) => row.mes));
      return { ...account, meses: months.size };
    })
    .filter((account) => account.meses >= 2)
    .sort((a, b) => b.custo - a.custo)
    .slice(0, 10);

  return {
    topDespesas: expenseRows.slice().sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 10),
    recorrentes: recurring,
    veiculosMaiorCusto: aggr.plates.slice(0, 10),
    contasImpacto: aggr.accounts.filter((row) => row.custo > 0).slice(0, 10),
    alertas: [
      ...aggr.centers.filter((row) => row.valor < 0).slice(0, 5).map((row) => ({
        tipo: "centro",
        label: row.centroCusto || "Sem centro",
        valor: row.valor,
        mensagem: "Centro de custo com resultado negativo",
      })),
      ...aggr.plates.filter((row) => row.receita - row.custo < 0).slice(0, 5).map((row) => ({
        tipo: "placa",
        label: row.placa,
        valor: row.receita - row.custo,
        mensagem: "Placa com custo maior que receita",
      })),
    ],
  };
}

// Classificação do DRE por mascaracfi (hierarquia do plano de contas), espelhando
// os grupos do "Demonstrativo por Conta Financeira": 1.x = receita, 2.x = impostos,
// 4.1.x = custo com frota, demais 4.x = custo de transporte, 6.1/6.3 = pessoal,
// 6.2.x = administrativas, 6.4/6.5 = financeiras, demais 6.x = operacionais.
const CATEGORIA_CASE = `
  CASE
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '1%' THEN 'RECEITA BRUTA'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '2%' THEN 'IMPOSTOS / DEDUCOES'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '4.1%' THEN 'CUSTOS COM FROTA'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '4%' THEN 'CUSTOS DE TRANSPORTE'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.1%' THEN 'DESPESAS COM PESSOAL'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.3%' THEN 'DESPESAS COM PESSOAL'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.2%' THEN 'DESPESAS ADMINISTRATIVAS'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.4%' THEN 'DESPESAS FINANCEIRAS'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.5%' THEN 'DESPESAS FINANCEIRAS'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '6%' THEN 'DESPESAS OPERACIONAIS'
    ELSE 'DESPESAS OPERACIONAIS'
  END
`;

const TIPO_CASE = `
  CASE
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '1%' THEN 'Receita'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '2%' THEN 'Imposto'
    WHEN COALESCE(cfi.mascaracfi,'') LIKE '4%' THEN 'Custo'
    ELSE 'Despesa'
  END
`;

export async function getDreEmpresarial({
  period,
  startDate,
  endDate,
  mesAno,
  empresa,
  centro,
  conta,
  placa,
  cliente,
  tipo = "todos",
  status = "todos",
  search,
} = {}) {
  const resolved = resolvePeriod({ period, startDate, endDate, mesAno });
  const empresaCod = empresa ? Number(empresa) || null : null;
  const params = [
    empresaCod,
    resolved.startDate,
    resolved.endDate,
    centro ? Number(centro) : null,
    conta ? Number(conta) : null,
    placa ? String(placa).trim().toUpperCase() : null,
    cliente ? Number(cliente) : null,
    normalizeTipo(tipo),
    normalizeStatus(status),
    search ? String(search).trim() : null,
  ];

  const query = `
    WITH params AS (
      SELECT $1::int empresa, $2::date data_inicio, $3::date data_fim, $4::int centro,
             $5::int conta, NULLIF($6::text, '') placa, $7::int cliente,
             $8::text tipo_filtro, $9::text status_filtro, NULLIF($10::text, '') busca
    ),
    receita AS (
      SELECT
        rec.empresarec AS empresa,
        rec.dataemissaorec::date AS data_base,
        date_trunc('month', rec.dataemissaorec::date)::date AS mes,
        'RECEITA BRUTA'::text AS categoria_dre,
        'Receita'::text AS tipo,
        'receber'::text AS origem,
        UPPER(NULLIF(TRIM(rec.veiculorec::text), '')) AS placa,
        vei_doc.nomevei::text AS veiculo_nome,
        vlr.centrocusto AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        vlr.contafinanceira AS conta_codigo,
        cfi.nomecfi AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        rec.clienterec AS cliente_codigo,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, '')) AS pessoa_nome,
        COALESCE(NULLIF(rec.documentorec::text, ''), rec.duplicatarec::text)::text AS documento,
        COALESCE(NULLIF(rec.observacaorec, ''), '')::text AS historico,
        CASE
          WHEN COALESCE(rec.valorabertorec,0) > 0 AND rec.datavencimentorec::date < CURRENT_DATE THEN 'vencido'
          WHEN COALESCE(rec.valorabertorec,0) > 0 THEN 'aberto'
          ELSE 'recebido'
        END AS status_financeiro,
        vlr.valorliquido::numeric AS valor,
        1::int AS lancamentos
      FROM financeiro.receber rec
      INNER JOIN financeiro.valorliquidorateiosreceber vlr
        ON rec.empresarec = vlr.empresa
       AND rec.serierec = vlr.serie
       AND rec.duplicatarec = vlr.duplicata
       AND rec.parcelarec = vlr.parcela
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = vlr.centrocusto
        ORDER BY (c.empresaccs = rec.empresarec) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT c.nomecfi, c.mascaracfi
        FROM financeiro.contasfinanceiras c
        WHERE c.codigocfi = vlr.contafinanceira
        ORDER BY (c.empresacfi = rec.empresarec) DESC, c.empresacfi
        LIMIT 1
      ) cfi ON true
      LEFT JOIN LATERAL (
        SELECT v.nomevei
        FROM frotas.veiculos v
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(rec.veiculorec::text))
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = rec.empresarec) DESC, v.empresavei
        LIMIT 1
      ) vei_doc ON true
      LEFT JOIN LATERAL (
        SELECT nomecli, fantasiacli
        FROM gerais.clientes
        WHERE codigocli = rec.clienterec
        LIMIT 1
      ) cli ON true
      WHERE rec.statusrec IN (1,2)
        AND (p.empresa IS NULL OR rec.empresarec = p.empresa)
        AND rec.dataemissaorec::date >= p.data_inicio
        AND rec.dataemissaorec::date <= p.data_fim
        AND (p.centro IS NULL OR vlr.centrocusto = p.centro)
        AND (p.conta IS NULL OR vlr.contafinanceira = p.conta)
    ),
    pagar AS (
      SELECT
        pag.empresapag AS empresa,
        pag.dataemissaopag::date AS data_base,
        date_trunc('month', pag.dataemissaopag::date)::date AS mes,
        ${CATEGORIA_CASE} AS categoria_dre,
        ${TIPO_CASE} AS tipo,
        'pagar'::text AS origem,
        UPPER(NULLIF(TRIM(COALESCE(pag.veiculopag, vei_cc.placavei, substring(cc.nomeccs from '[A-Z]{3}[0-9][A-Z0-9][0-9]{2}'))::text), '')) AS placa,
        vei_doc.nomevei::text AS veiculo_nome,
        vlp.centrocusto AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        vlp.contafinanceira AS conta_codigo,
        cfi.nomecfi AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        NULL::int AS cliente_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, '')) AS pessoa_nome,
        COALESCE(NULLIF(pag.documentopag, ''), pag.duplicatapag::text)::text AS documento,
        COALESCE(NULLIF(pag.observacaopag, ''), '')::text AS historico,
        CASE
          WHEN COALESCE(pag.valorabertopag,0) > 0 AND pag.datavencimentopag::date < CURRENT_DATE THEN 'vencido'
          WHEN COALESCE(pag.valorabertopag,0) > 0 THEN 'aberto'
          ELSE 'pago'
        END AS status_financeiro,
        vlp.valorliquido::numeric * -1 AS valor,
        1::int AS lancamentos
      FROM financeiro.pagar pag
      INNER JOIN financeiro.valorliquidorateiospagar vlp
        ON pag.empresapag = vlp.empresa
       AND pag.seriepag = vlp.serie
       AND pag.duplicatapag = vlp.duplicata
       AND pag.parcelapag = vlp.parcela
       AND pag.fornecedorpag = vlp.fornecedor
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = vlp.centrocusto
        ORDER BY (c.empresaccs = pag.empresapag) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT c.nomecfi, c.mascaracfi
        FROM financeiro.contasfinanceiras c
        WHERE c.codigocfi = vlp.contafinanceira
        ORDER BY (c.empresacfi = pag.empresapag) DESC, c.empresacfi
        LIMIT 1
      ) cfi ON true
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei
        FROM frotas.veiculos v
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(pag.veiculopag::text))
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
        LIMIT 1
      ) vei_doc ON true
      LEFT JOIN LATERAL (
        SELECT v.placavei
        FROM frotas.veiculos v
        WHERE v.centrocustovei = vlp.centrocusto
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
        LIMIT 1
      ) vei_cc ON true
      LEFT JOIN LATERAL (
        SELECT nomefor, fantasiafor
        FROM gerais.fornecedores
        WHERE codigofor = pag.fornecedorpag
        LIMIT 1
      ) forn ON true
      WHERE pag.statuspag IN (1,2)
        AND (p.empresa IS NULL OR pag.empresapag = p.empresa)
        AND pag.dataemissaopag::date >= p.data_inicio
        AND pag.dataemissaopag::date <= p.data_fim
        AND (p.centro IS NULL OR vlp.centrocusto = p.centro)
        AND (p.conta IS NULL OR vlp.contafinanceira = p.conta)
    ),
    movimentacao AS (
      SELECT
        mfr.empresa AS empresa,
        mfr.data::date AS data_base,
        date_trunc('month', mfr.data::date)::date AS mes,
        ${CATEGORIA_CASE} AS categoria_dre,
        ${TIPO_CASE} AS tipo,
        'movimentacao'::text AS origem,
        UPPER(NULLIF(TRIM(vei_cc.placavei::text), '')) AS placa,
        NULL::text AS veiculo_nome,
        mfr.centrocusto AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        mfr.contafinanceira AS conta_codigo,
        cfi.nomecfi AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        NULL::int AS cliente_codigo,
        NULL::text AS pessoa_nome,
        COALESCE(NULLIF(mfr.documento, ''), '')::text AS documento,
        COALESCE(NULLIF(mfr.historico, ''), '')::text AS historico,
        CASE WHEN mfr.valor >= 0 THEN 'recebido' ELSE 'pago' END AS status_financeiro,
        mfr.valor::numeric AS valor,
        1::int AS lancamentos
      FROM financeiro.movimentacaofinanceirarateadasinalizada mfr
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = mfr.centrocusto
        ORDER BY (c.empresaccs = mfr.empresa) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT c.nomecfi, c.mascaracfi
        FROM financeiro.contasfinanceiras c
        WHERE c.codigocfi = mfr.contafinanceira
        ORDER BY (c.empresacfi = mfr.empresa) DESC, c.empresacfi
        LIMIT 1
      ) cfi ON true
      LEFT JOIN LATERAL (
        SELECT v.placavei
        FROM frotas.veiculos v
        WHERE v.centrocustovei = mfr.centrocusto
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = mfr.empresa) DESC, v.empresavei
        LIMIT 1
      ) vei_cc ON true
      WHERE NOT mfr.duplicatagerada
        AND (p.empresa IS NULL OR mfr.empresa = p.empresa)
        AND mfr.data::date >= p.data_inicio
        AND mfr.data::date <= p.data_fim
        AND (p.centro IS NULL OR mfr.centrocusto = p.centro)
        AND (p.conta IS NULL OR mfr.contafinanceira = p.conta)
    ),
    base AS (
      SELECT * FROM receita
      UNION ALL SELECT * FROM pagar
      UNION ALL SELECT * FROM movimentacao
    )
    SELECT *
    FROM base b
    CROSS JOIN params p
    WHERE (p.conta IS NULL OR b.conta_codigo = p.conta)
      AND (p.placa IS NULL OR UPPER(TRIM(b.placa::text)) = p.placa)
      AND (p.cliente IS NULL OR b.cliente_codigo = p.cliente)
      AND (
        p.tipo_filtro = 'todos'
        OR (p.tipo_filtro = 'frota' AND NULLIF(TRIM(b.placa::text), '') IS NOT NULL)
        OR (p.tipo_filtro = 'administrativo' AND NULLIF(TRIM(b.placa::text), '') IS NULL)
      )
      AND (
        p.status_filtro = 'todos'
        OR b.status_financeiro = p.status_filtro
        OR (p.status_filtro = 'pendente' AND b.status_financeiro IN ('aberto','vencido'))
      )
      AND (
        p.busca IS NULL
        OR b.centro_nome ILIKE '%' || p.busca || '%'
        OR b.conta_nome ILIKE '%' || p.busca || '%'
        OR b.placa ILIKE '%' || p.busca || '%'
        OR b.pessoa_nome ILIKE '%' || p.busca || '%'
        OR b.documento ILIKE '%' || p.busca || '%'
      )
    ORDER BY b.data_base DESC, b.categoria_dre, b.valor
  `;

  const result = await clientPool.query(query, params);
  const rows = result.rows.map((row) => {
    const categoria = row.categoria_dre;
    const valor = r2(row.valor);
    return {
      data: dateOnly(row.data_base),
      mes: dateOnly(row.mes),
      labelMes: monthLabel(row.mes),
      centroCodigo: row.centro_codigo,
      centroCusto: row.centro_nome || "Sem centro de custo",
      centroMascara: row.centro_mascara,
      contaCodigo: row.conta_codigo,
      contaFinanceira: row.conta_nome || "Sem conta financeira",
      contaMascara: row.conta_mascara,
      categoriaDre: categoria,
      tipo: row.tipo,
      placa: extractPlate(row.placa, row.centro_nome, row.historico),
      veiculoNome: row.veiculo_nome,
      clienteCodigo: row.cliente_codigo,
      pessoaNome: row.pessoa_nome,
      documento: row.documento,
      historico: row.historico,
      valor,
      valorAbs: Math.abs(valor),
      status: row.status_financeiro,
      origem: row.origem,
      lancamentos: n(row.lancamentos),
      sinal: dreSign(categoria),
    };
  });

  const summary = buildSummary(rows);
  const aggregations = aggregate(rows);
  const management = buildManagement(rows, aggregations);

  return {
    period: resolved,
    filters: { empresa: empresaCod, centro, conta, placa, cliente, tipo: params[7], status: params[8], search },
    summary: summary.cards,
    structure: summary.structure,
    monthly: aggregations.monthly,
    categories: aggregations.categories,
    accounts: aggregations.accounts,
    centers: aggregations.centers,
    plates: aggregations.plates,
    management,
    rows,
    sources: [
      "financeiro.receber",
      "financeiro.valorliquidorateiosreceber",
      "financeiro.pagar",
      "financeiro.valorliquidorateiospagar",
      "financeiro.movimentacaofinanceirarateadasinalizada",
      "financeiro.contasfinanceiras",
      "financeiro.centroscustos",
      "frotas.veiculos",
      "gerais.clientes",
      "gerais.fornecedores",
    ],
  };
}
