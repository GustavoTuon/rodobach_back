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
  const sumCategory = (category) => rows
    .filter((row) => row.categoriaDre === category)
    .reduce((total, row) => total + Math.abs(n(row.valor)), 0);

  const receitaBruta = sumCategory("RECEITA BRUTA");
  const impostos = sumCategory("IMPOSTOS / DEDUCOES");
  const receitaLiquida = receitaBruta - impostos;
  const custosTransporte = sumCategory("CUSTOS DE TRANSPORTE");
  const custosFrota = sumCategory("CUSTOS COM FROTA");
  const lucroBruto = receitaLiquida - custosTransporte - custosFrota;
  const despesasPessoal = sumCategory("DESPESAS COM PESSOAL");
  const despesasAdministrativas = sumCategory("DESPESAS ADMINISTRATIVAS");
  const despesasFinanceiras = sumCategory("DESPESAS FINANCEIRAS");
  const despesasOperacionais = sumCategory("DESPESAS OPERACIONAIS");
  const resultadoFinal = lucroBruto - despesasPessoal - despesasAdministrativas - despesasFinanceiras - despesasOperacionais;
  const totalCustos = custosTransporte + custosFrota + despesasPessoal + despesasAdministrativas + despesasFinanceiras + despesasOperacionais;
  const margemLucro = receitaBruta > 0 ? (resultadoFinal / receitaBruta) * 100 : 0;

  const cards = {
    receitaBruta,
    impostos,
    receitaLiquida,
    custosTransporte,
    custosFrota,
    despesasOperacionais,
    despesasAdministrativas,
    despesasPessoal,
    despesasFinanceiras,
    resultadoFinal,
    margemLucro,
    totalCustos,
    lancamentos: rows.reduce((total, row) => total + n(row.lancamentos), 0),
  };

  const structure = [
    { label: "RECEITA BRUTA", value: receitaBruta, kind: "total" },
    { label: "(-) IMPOSTOS / DEDUCOES", value: -impostos, kind: "deduction" },
    { label: "= RECEITA LIQUIDA", value: receitaLiquida, kind: "result" },
    { label: "(-) CUSTOS DE TRANSPORTE", value: -custosTransporte, kind: "deduction" },
    { label: "(-) CUSTOS COM FROTA", value: -custosFrota, kind: "deduction" },
    { label: "= LUCRO BRUTO", value: lucroBruto, kind: "result" },
    { label: "(-) DESPESAS COM PESSOAL", value: -despesasPessoal, kind: "deduction" },
    { label: "(-) DESPESAS ADMINISTRATIVAS", value: -despesasAdministrativas, kind: "deduction" },
    { label: "(-) DESPESAS FINANCEIRAS", value: -despesasFinanceiras, kind: "deduction" },
    { label: "= RESULTADO OPERACIONAL / FINAL", value: resultadoFinal, kind: "final" },
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
    const receita = row.tipo === "Receita" ? Math.abs(row.valor) : 0;
    const custo = row.tipo !== "Receita" ? Math.abs(row.valor) : 0;
    const values = { valor: row.valor, receita, custo, lancamentos: row.lancamentos };
    add(monthly, row.mes, values, { mes: row.mes, label: row.labelMes });
    add(categories, row.categoriaDre, values, { categoriaDre: row.categoriaDre, order: DRE_ORDER.indexOf(row.categoriaDre) });
    add(accounts, `${row.contaCodigo || "sem"}:${row.categoriaDre}`, values, { contaCodigo: row.contaCodigo, contaNome: row.contaFinanceira, contaMascara: row.contaMascara, categoriaDre: row.categoriaDre });
    add(centers, String(row.centroCodigo || "sem"), values, { centroCodigo: row.centroCodigo, centroCusto: row.centroCusto, centroMascara: row.centroMascara });
    if (row.placa) add(plates, row.placa, values, { placa: row.placa, veiculoNome: row.veiculoNome, centroCusto: row.centroCusto });
  }

  return {
    monthly: Array.from(monthly.values()).sort((a, b) => String(a.mes).localeCompare(String(b.mes))).map((row) => ({ ...row, lucro: r2(row.receita - row.custo) })),
    categories: Array.from(categories.values()).sort((a, b) => a.order - b.order),
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

export async function getDreEmpresarial({
  period,
  startDate,
  endDate,
  mesAno,
  empresa = 2,
  centro,
  conta,
  placa,
  cliente,
  tipo = "todos",
  status = "todos",
  search,
} = {}) {
  const resolved = resolvePeriod({ period, startDate, endDate, mesAno });
  const params = [
    Number(empresa) || 2,
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
        con.empresacon AS empresa,
        con.dataemissaocon::date AS data_base,
        date_trunc('month', con.dataemissaocon::date)::date AS mes,
        'RECEITA BRUTA'::text AS categoria_dre,
        'Receita'::text AS tipo,
        'conhecimento'::text AS origem,
        COALESCE(NULLIF(TRIM(con.veiculocon::text), ''), NULL) AS placa,
        vei.nomevei AS veiculo_nome,
        vei.centrocustovei::int AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        NULL::int AS conta_codigo,
        'Receita de CT-e / Conhecimento'::text AS conta_nome,
        NULL::text AS conta_mascara,
        con.clientecon AS cliente_codigo,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, '')) AS pessoa_nome,
        (con.seriecon || '-' || con.codigocon::text) AS documento,
        COALESCE(con.observacaonfcon, '') AS historico,
        'recebido'::text AS status_financeiro,
        COALESCE(con.totalcon, con.valorfretecon, 0)::numeric AS valor,
        1::int AS lancamentos
      FROM logistica.conhecimentos con
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.centrocustovei
        FROM frotas.veiculos v
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(con.veiculocon::text))
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
        LIMIT 1
      ) vei ON true
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = vei.centrocustovei
        ORDER BY (c.empresaccs = con.empresacon) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT nomecli, fantasiacli
        FROM gerais.clientes
        WHERE codigocli = con.clientecon
        LIMIT 1
      ) cli ON true
      WHERE con.empresacon = p.empresa
        AND con.statuscon = 2
        AND con.dataemissaocon::date >= p.data_inicio
        AND con.dataemissaocon::date <= p.data_fim
        AND (p.centro IS NULL OR vei.centrocustovei = p.centro)
        AND (p.placa IS NULL OR UPPER(TRIM(con.veiculocon::text)) = p.placa)
        AND (p.cliente IS NULL OR con.clientecon = p.cliente)
    ),
    impostos AS (
      SELECT
        con.empresacon AS empresa,
        con.dataemissaocon::date AS data_base,
        date_trunc('month', con.dataemissaocon::date)::date AS mes,
        'IMPOSTOS / DEDUCOES'::text AS categoria_dre,
        'Imposto'::text AS tipo,
        'conhecimento'::text AS origem,
        COALESCE(NULLIF(TRIM(con.veiculocon::text), ''), NULL) AS placa,
        vei.nomevei AS veiculo_nome,
        vei.centrocustovei::int AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        NULL::int AS conta_codigo,
        'ICMS/PIS/COFINS sobre CT-e'::text AS conta_nome,
        NULL::text AS conta_mascara,
        con.clientecon AS cliente_codigo,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, '')) AS pessoa_nome,
        (con.seriecon || '-' || con.codigocon::text) AS documento,
        'Impostos do conhecimento'::text AS historico,
        'recebido'::text AS status_financeiro,
        (COALESCE(con.valoricmscon,0) + COALESCE(con.valorpiscon,0) + COALESCE(con.valorcofinscon,0))::numeric * -1 AS valor,
        1::int AS lancamentos
      FROM logistica.conhecimentos con
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.centrocustovei
        FROM frotas.veiculos v
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(con.veiculocon::text))
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
        ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
        LIMIT 1
      ) vei ON true
      LEFT JOIN LATERAL (
        SELECT c.nomeccs, c.mascaraccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = vei.centrocustovei
        ORDER BY (c.empresaccs = con.empresacon) DESC, c.empresaccs
        LIMIT 1
      ) cc ON true
      LEFT JOIN LATERAL (
        SELECT nomecli, fantasiacli
        FROM gerais.clientes
        WHERE codigocli = con.clientecon
        LIMIT 1
      ) cli ON true
      WHERE con.empresacon = p.empresa
        AND con.statuscon = 2
        AND con.dataemissaocon::date >= p.data_inicio
        AND con.dataemissaocon::date <= p.data_fim
        AND (COALESCE(con.valoricmscon,0) + COALESCE(con.valorpiscon,0) + COALESCE(con.valorcofinscon,0)) <> 0
        AND (p.centro IS NULL OR vei.centrocustovei = p.centro)
        AND (p.placa IS NULL OR UPPER(TRIM(con.veiculocon::text)) = p.placa)
        AND (p.cliente IS NULL OR con.clientecon = p.cliente)
    ),
    pagar AS (
      SELECT
        pag.empresapag AS empresa,
        pag.datavencimentopag::date AS data_base,
        date_trunc('month', pag.datavencimentopag::date)::date AS mes,
        CASE
          WHEN lower(COALESCE(cfi.nomecfi,'')) SIMILAR TO '%(icms|iss|pis|cofins|irpj|csll|inss|sest)%' THEN 'IMPOSTOS / DEDUCOES'
          WHEN lower(COALESCE(cfi.nomecfi,'')) SIMILAR TO '%(salario|folha|ferias|rescis|pro labore|motorista)%' THEN 'DESPESAS COM PESSOAL'
          WHEN lower(COALESCE(cfi.nomecfi,'')) SIMILAR TO '%(tarifa|juros|banc|cartao)%' THEN 'DESPESAS FINANCEIRAS'
          WHEN COALESCE(NULLIF(TRIM(pag.veiculopag::text), ''), NULLIF(TRIM(vei_cc.placavei::text), '')) IS NOT NULL
            OR lower(COALESCE(cfi.nomecfi,'')) SIMILAR TO '%(combust|pedagio|borracha|manutenc|rastreamento|seguro|veicul)%' THEN 'CUSTOS COM FROTA'
          WHEN COALESCE(cfi.mascaracfi,'') LIKE '4.%' THEN 'CUSTOS DE TRANSPORTE'
          WHEN COALESCE(cfi.mascaracfi,'') LIKE '6.%' THEN 'DESPESAS ADMINISTRATIVAS'
          ELSE 'DESPESAS OPERACIONAIS'
        END AS categoria_dre,
        CASE
          WHEN lower(COALESCE(cfi.nomecfi,'')) SIMILAR TO '%(icms|iss|pis|cofins|irpj|csll|inss|sest)%' THEN 'Imposto'
          WHEN COALESCE(cfi.mascaracfi,'') LIKE '4.%' OR NULLIF(TRIM(COALESCE(pag.veiculopag, vei_cc.placavei)::text), '') IS NOT NULL THEN 'Custo'
          ELSE 'Despesa'
        END AS tipo,
        'pagar'::text AS origem,
        UPPER(NULLIF(TRIM(COALESCE(pag.veiculopag, vei_cc.placavei, substring(cc.nomeccs from '[A-Z]{3}[0-9][A-Z0-9][0-9]{2}'))::text), '')) AS placa,
        vei_doc.nomevei AS veiculo_nome,
        vlp.centrocusto AS centro_codigo,
        cc.nomeccs AS centro_nome,
        cc.mascaraccs AS centro_mascara,
        vlp.contafinanceira AS conta_codigo,
        cfi.nomecfi AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        NULL::int AS cliente_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, '')) AS pessoa_nome,
        COALESCE(NULLIF(pag.documentopag, ''), pag.duplicatapag::text) AS documento,
        COALESCE(NULLIF(pag.observacaopag, ''), '') AS historico,
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
      WHERE pag.empresapag = p.empresa
        AND pag.statuspag IN (1,2)
        AND pag.datavencimentopag::date >= p.data_inicio
        AND pag.datavencimentopag::date <= p.data_fim
        AND (p.centro IS NULL OR vlp.centrocusto = p.centro)
        AND (p.conta IS NULL OR vlp.contafinanceira = p.conta)
    ),
    base AS (
      SELECT * FROM receita
      UNION ALL SELECT * FROM impostos
      UNION ALL SELECT * FROM pagar
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
    filters: { empresa: params[0], centro, conta, placa, cliente, tipo: params[7], status: params[8], search },
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
      "logistica.conhecimentos",
      "financeiro.pagar",
      "financeiro.valorliquidorateiospagar",
      "financeiro.contasfinanceiras",
      "financeiro.centroscustos",
      "frotas.veiculos",
      "gerais.clientes",
      "gerais.fornecedores",
    ],
  };
}
