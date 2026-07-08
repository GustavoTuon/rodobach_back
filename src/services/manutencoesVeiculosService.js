import { clientPool } from "../db/clientPool.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOwner(value) {
  const v = normalizeText(value || "todos").toLowerCase();
  if (["frota", "terceiro", "terceiros", "todos"].includes(v)) return v === "terceiros" ? "terceiro" : v;
  return "todos";
}

function resolvePeriod({ startDate, endDate } = {}) {
  return {
    startDate: startDate || daysAgoIso(29),
    endDate: endDate || todayIso(),
  };
}

function monthLabel(value) {
  if (!value) return "-";
  const [year, month] = String(value).split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return value;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(year).slice(2)}`;
}

export const CATEGORIA_LABELS = {
  abastecimento: "Abastecimento",
  pecas_manutencao: "Pecas/Produtos (OS Externa)",
  servicos_manutencao: "Servicos (OS Externa)",
  pecas_estoque: "Pecas/Produtos (NF)",
  pneus: "Pneus",
  multas: "Multas de transito",
  despesas_viagem: "Despesas de viagem",
};

// CTEs de apoio (lookup) compartilhadas por todos os ramos da UNION ALL abaixo.
// Pre-deduplicam as tabelas de dimensao (DISTINCT ON codigo, preferindo a menor empresa)
// para permitir LEFT JOIN simples (hash join) em vez de LATERAL por linha, que e
// extremamente lento no Postgres 9.6 quando o lado externo tem milhares de linhas.
const LOOKUP_CTES = `
  produtos_uniq AS (
    SELECT DISTINCT ON (codigopro) codigopro, nomepro, grupopro
    FROM estoque.produtos
    ORDER BY codigopro, empresapro
  ),
  grupos_uniq AS (
    SELECT DISTINCT ON (codigogru) codigogru, nomegru
    FROM estoque.grupos
    ORDER BY codigogru, empresagru
  ),
  fornecedores_uniq AS (
    SELECT DISTINCT ON (codigofor) codigofor, nomefor, fantasiafor
    FROM gerais.fornecedores
    ORDER BY codigofor, empresafor
  ),
  veiculos_uniq AS (
    SELECT DISTINCT ON (placa_norm) placa_norm, nomevei, tipopropriedadevei, centrocustovei
    FROM (
      SELECT UPPER(TRIM(placavei::text)) AS placa_norm, nomevei, tipopropriedadevei, centrocustovei, empresavei, situacaovei
      FROM frotas.veiculos
    ) x
    WHERE COALESCE(situacaovei::text, '') <> 'I'
    ORDER BY placa_norm, empresavei
  ),
  centroscustos_uniq AS (
    SELECT DISTINCT ON (codigoccs) codigoccs, nomeccs
    FROM financeiro.centroscustos
    ORDER BY codigoccs, empresaccs
  ),
  pneus_uniq AS (
    SELECT DISTINCT ON (codigopne) codigopne, nomepne
    FROM frotas.pneus
    ORDER BY codigopne, empresapne
  ),
  nf_header AS (
    SELECT empresanfe, serienfe, codigonfe, fornecedornfe,
      COALESCE(dataentradanfe, dataemissaonfe)::date AS data_custo,
      veiculonfe
    FROM compras.notasfiscaisentrada
    WHERE COALESCE(dataentradanfe, dataemissaonfe)::date >= $1::date
      AND COALESCE(dataentradanfe, dataemissaonfe)::date <= $2::date
    OFFSET 0
  )
`;

// CTE "custos_veiculo": unifica as origens operacionais de custo por placa,
// seguindo o mapeamento do relatorio (sem usar financeiro.pagar como fonte principal).
// $1 = data inicial, $2 = data final (aplicados em cada ramo da UNION ALL).
function custosVeiculoCte() {
  const abastecimentos = `
    SELECT
      aba.dataaba::date AS data_custo,
      UPPER(TRIM(aba.veiculoaba::text)) AS placa,
      'frotas.abastecimentos'::text AS origem_custo,
      'abastecimento'::text AS categoria_custo,
      'Abastecimento'::text AS categoria_label,
      'Abastecimento'::text AS tipo_documento,
      aba.documentoaba::text AS numero_documento,
      aba.serieaba::text AS serie_documento,
      aba.postocombustivelaba::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Posto ' || COALESCE(aba.postocombustivelaba::text, '-')) AS fornecedor_nome,
      aba.combustivelaba::text AS produto_codigo,
      COALESCE(NULLIF(prod.nomepro, ''), 'Combustivel') AS produto_nome,
      COALESCE(aba.litrosaba, 0) AS quantidade,
      COALESCE(aba.valorlitroaba, 0) AS valor_unitario,
      COALESCE(aba.totalaba, 0) AS valor_total,
      v.centrocustovei::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('ABA|' || aba.empresaaba || '|' || aba.codigoaba) AS chave_origem
    FROM frotas.abastecimentos aba
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(aba.veiculoaba::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = v.centrocustovei
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = aba.postocombustivelaba
    LEFT JOIN produtos_uniq prod ON prod.codigopro = aba.combustivelaba
    WHERE aba.dataaba::date >= $1::date
      AND aba.dataaba::date <= $2::date
      AND COALESCE(aba.totalaba, 0) <> 0
      AND NULLIF(TRIM(aba.veiculoaba::text), '') IS NOT NULL
  `;

  const osExternaProdutos = `
    SELECT
      COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data_custo,
      UPPER(TRIM(COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose)::text)) AS placa,
      'frotas.ordensservicosexternaprodutos'::text AS origem_custo,
      'pecas_manutencao'::text AS categoria_custo,
      'Pecas/Produtos (OS Externa)'::text AS categoria_label,
      'OS Externa'::text AS tipo_documento,
      o.codigoose::text AS numero_documento,
      o.serieose::text AS serie_documento,
      o.fornecedorose::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      i.produtooep::text AS produto_codigo,
      COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtooep::text) AS produto_nome,
      COALESCE(i.quantidadeoep, 0) AS quantidade,
      COALESCE(i.valorunitariooep, 0) AS valor_unitario,
      COALESCE(i.totalitemoep, 0) AS valor_total,
      COALESCE(i.centrocustooep, v.centrocustovei)::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('OSEP|' || i.empresaoep || '|' || i.serieoep || '|' || i.codigooep || '|' || i.fornecedoroep || '|' || i.sequenciaoep) AS chave_origem
    FROM frotas.ordensservicosexternaprodutos i
    JOIN frotas.ordensservicosexterna o
      ON o.empresaose = i.empresaoep
     AND o.serieose = i.serieoep
     AND o.codigoose = i.codigooep
     AND o.fornecedorose = i.fornecedoroep
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(COALESCE(NULLIF(i.veiculooep,''), o.veiculoose)::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = COALESCE(i.centrocustooep, v.centrocustovei)
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = o.fornecedorose
    LEFT JOIN produtos_uniq prod ON prod.codigopro = i.produtooep
    WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date
      AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
      AND COALESCE(i.totalitemoep, 0) <> 0
      AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculooep,''), o.veiculoose)::text), '') IS NOT NULL
  `;

  const osExternaServicos = `
    SELECT
      COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data_custo,
      UPPER(TRIM(COALESCE(NULLIF(i.veiculooes, ''), o.veiculoose)::text)) AS placa,
      'frotas.ordensservicosexternaservicos'::text AS origem_custo,
      'servicos_manutencao'::text AS categoria_custo,
      'Servicos (OS Externa)'::text AS categoria_label,
      'OS Externa'::text AS tipo_documento,
      o.codigoose::text AS numero_documento,
      o.serieose::text AS serie_documento,
      o.fornecedorose::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      i.servicooes::text AS produto_codigo,
      COALESCE(NULLIF(prod.nomepro, ''), 'Servico ' || i.servicooes::text) AS produto_nome,
      COALESCE(i.quantidadeoes, 0) AS quantidade,
      COALESCE(i.valorunitariooes, 0) AS valor_unitario,
      COALESCE(i.totalitemoes, 0) AS valor_total,
      COALESCE(i.centrocustooes, v.centrocustovei)::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('OSES|' || i.empresaoes || '|' || i.serieoes || '|' || i.codigooes || '|' || i.fornecedoroes || '|' || i.sequenciaoes) AS chave_origem
    FROM frotas.ordensservicosexternaservicos i
    JOIN frotas.ordensservicosexterna o
      ON o.empresaose = i.empresaoes
     AND o.serieose = i.serieoes
     AND o.codigoose = i.codigooes
     AND o.fornecedorose = i.fornecedoroes
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(COALESCE(NULLIF(i.veiculooes,''), o.veiculoose)::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = COALESCE(i.centrocustooes, v.centrocustovei)
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = o.fornecedorose
    LEFT JOIN produtos_uniq prod ON prod.codigopro = i.servicooes
    WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date
      AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
      AND COALESCE(i.totalitemoes, 0) <> 0
      AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculooes,''), o.veiculoose)::text), '') IS NOT NULL
  `;

  const nfEntradaProdutos = `
    SELECT
      n.data_custo AS data_custo,
      UPPER(TRIM(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text)) AS placa,
      'compras.notasfiscaisentradaprodutos'::text AS origem_custo,
      CASE
        WHEN TRIM(COALESCE(i.combustivelnep::text, '')) = 'S'
          OR i.postobombacombustivelnep IS NOT NULL
          OR LOWER(COALESCE(grp.nomegru, '')) LIKE '%combust%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%diesel%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%combust%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%lubrific%' THEN 'abastecimento'
        WHEN LOWER(COALESCE(grp.nomegru, '')) LIKE '%pneu%' OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%pneu%' THEN 'pneus'
        ELSE 'pecas_estoque'
      END AS categoria_custo,
      CASE
        WHEN TRIM(COALESCE(i.combustivelnep::text, '')) = 'S'
          OR i.postobombacombustivelnep IS NOT NULL
          OR LOWER(COALESCE(grp.nomegru, '')) LIKE '%combust%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%diesel%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%combust%'
          OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%lubrific%' THEN 'Abastecimento'
        WHEN LOWER(COALESCE(grp.nomegru, '')) LIKE '%pneu%' OR LOWER(COALESCE(prod.nomepro, '')) LIKE '%pneu%' THEN 'Pneus'
        ELSE 'Pecas/Produtos (NF)'
      END AS categoria_label,
      'Nota Fiscal'::text AS tipo_documento,
      n.codigonfe::text AS numero_documento,
      n.serienfe::text AS serie_documento,
      n.fornecedornfe::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      i.produtonep::text AS produto_codigo,
      COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtonep::text) AS produto_nome,
      COALESCE(i.quantidadenep, 0) AS quantidade,
      COALESCE(i.valorunitarionep, 0) AS valor_unitario,
      COALESCE(i.totalitemestoquenep, i.totalitemnep, 0) AS valor_total,
      COALESCE(i.centrocustonep, v.centrocustovei)::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('NFEI|' || i.empresanep || '|' || i.serienep || '|' || i.codigonep || '|' || i.fornecedornep || '|' || i.sequencianep) AS chave_origem
    FROM compras.notasfiscaisentradaprodutos i
    JOIN nf_header n
      ON n.empresanfe = i.empresanep
     AND n.serienfe = i.serienep
     AND n.codigonfe = i.codigonep
     AND n.fornecedornfe = i.fornecedornep
    LEFT JOIN frotas.ordensservicosexternanotasfiscaisentrada osn
      ON osn.empresaosn = i.empresanep
     AND osn.serienotafiscalosn = i.serienep
     AND osn.notafiscalosn = i.codigonep
     AND osn.fornecedornotaosn = i.fornecedornep
    LEFT JOIN produtos_uniq prod ON prod.codigopro = i.produtonep
    LEFT JOIN grupos_uniq grp ON grp.codigogru = prod.grupopro
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = n.fornecedornfe
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = COALESCE(i.centrocustonep, v.centrocustovei)
    WHERE osn.ordemosn IS NULL
      AND COALESCE(i.totalitemestoquenep, i.totalitemnep, 0) <> 0
      AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text), '') IS NOT NULL
  `;

  const multas = `
    SELECT
      COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date AS data_custo,
      UPPER(TRIM(m.veiculomtr::text)) AS placa,
      'frotas.multastransito'::text AS origem_custo,
      'multas'::text AS categoria_custo,
      'Multas de transito'::text AS categoria_label,
      'Multa'::text AS tipo_documento,
      m.numeroautomtr::text AS numero_documento,
      NULL::text AS serie_documento,
      m.fornecedorduplicatamtr::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      NULL::text AS produto_codigo,
      COALESCE(NULLIF(m.infracaomtr, ''), 'Multa de transito') AS produto_nome,
      1::numeric AS quantidade,
      (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) AS valor_unitario,
      (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) AS valor_total,
      v.centrocustovei::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('MTR|' || m.empresamtr || '|' || m.codigomtr) AS chave_origem
    FROM frotas.multastransito m
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(m.veiculomtr::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = v.centrocustovei
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = m.fornecedorduplicatamtr
    WHERE COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date >= $1::date
      AND COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date <= $2::date
      AND (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) <> 0
      AND NULLIF(TRIM(m.veiculomtr::text), '') IS NOT NULL
  `;

  const movimentacaoPneus = `
    SELECT
      p.datampn::date AS data_custo,
      UPPER(TRIM(p.veiculompn::text)) AS placa,
      'frotas.movimentacaopneus'::text AS origem_custo,
      'pneus'::text AS categoria_custo,
      'Pneus'::text AS categoria_label,
      'Movimentacao de pneu'::text AS tipo_documento,
      p.codigompn::text AS numero_documento,
      NULL::text AS serie_documento,
      p.fornecedormpn::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      p.pneumpn::text AS produto_codigo,
      COALESCE(NULLIF(pneu.nomepne, ''), 'Pneu ' || p.pneumpn::text) AS produto_nome,
      1::numeric AS quantidade,
      COALESCE(p.valormpn, 0) AS valor_unitario,
      COALESCE(p.valormpn, 0) AS valor_total,
      v.centrocustovei::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('MPN|' || p.empresampn || '|' || p.codigompn) AS chave_origem
    FROM frotas.movimentacaopneus p
    LEFT JOIN pneus_uniq pneu ON pneu.codigopne = p.pneumpn
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(p.veiculompn::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = v.centrocustovei
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = p.fornecedormpn
    WHERE p.datampn::date >= $1::date
      AND p.datampn::date <= $2::date
      AND COALESCE(p.valormpn, 0) <> 0
      AND NULLIF(TRIM(p.veiculompn::text), '') IS NOT NULL
  `;

  const despesasViagem = `
    SELECT
      d.datacvd::date AS data_custo,
      UPPER(TRIM(d.veiculocvd::text)) AS placa,
      'logistica.controleviagensdespesas'::text AS origem_custo,
      'despesas_viagem'::text AS categoria_custo,
      'Despesas de viagem'::text AS categoria_label,
      'Despesa de viagem'::text AS tipo_documento,
      d.documentocvd::text AS numero_documento,
      d.seriecvd::text AS serie_documento,
      d.fornecedorcvd::text AS fornecedor_codigo,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor_nome,
      d.despesaviagemcvd::text AS produto_codigo,
      'Despesa de viagem'::text AS produto_nome,
      COALESCE(d.litroscvd, 1) AS quantidade,
      CASE WHEN COALESCE(d.litroscvd, 0) <> 0 THEN d.valorcvd / d.litroscvd ELSE d.valorcvd END AS valor_unitario,
      COALESCE(d.valorcvd, 0) AS valor_total,
      v.centrocustovei::text AS centro_custo_codigo,
      COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo_nome,
      v.nomevei AS veiculo_nome,
      v.tipopropriedadevei::text AS tipo_propriedade,
      ('CVD|' || d.empresacvd || '|' || d.codigocvd || '|' || d.sequenciacvd) AS chave_origem
    FROM logistica.controleviagensdespesas d
    LEFT JOIN veiculos_uniq v ON v.placa_norm = UPPER(TRIM(d.veiculocvd::text))
    LEFT JOIN centroscustos_uniq ccs ON ccs.codigoccs = v.centrocustovei
    LEFT JOIN fornecedores_uniq forn ON forn.codigofor = d.fornecedorcvd
    WHERE d.datacvd::date >= $1::date
      AND d.datacvd::date <= $2::date
      AND d.datacvd::date <= (CURRENT_DATE + INTERVAL '1 year')
      AND COALESCE(d.valorcvd, 0) <> 0
      AND d.codigonotafiscalcvd IS NULL
      AND d.multacvd IS NULL
      AND NULLIF(TRIM(d.veiculocvd::text), '') IS NOT NULL
  `;

  return `
    WITH ${LOOKUP_CTES},
    custos_veiculo AS (
      ${abastecimentos}
      UNION ALL
      ${osExternaProdutos}
      UNION ALL
      ${osExternaServicos}
      UNION ALL
      ${nfEntradaProdutos}
      UNION ALL
      ${multas}
      UNION ALL
      ${movimentacaoPneus}
      UNION ALL
      ${despesasViagem}
    )
  `;
}

function buildWhere(filters = {}, offset = 2) {
  const where = [];
  const values = [];
  let i = offset + 1;

  if (filters.placa) {
    values.push(`%${normalizeUpper(filters.placa)}%`);
    where.push(`placa ILIKE $${i}`);
    i += 1;
  }
  if (filters.categoria) {
    values.push(normalizeText(filters.categoria));
    where.push(`categoria_custo = $${i}`);
    i += 1;
  }
  if (filters.fornecedor) {
    values.push(`%${normalizeText(filters.fornecedor)}%`);
    where.push(`fornecedor_nome ILIKE $${i}`);
    i += 1;
  }
  if (filters.centro) {
    values.push(`%${normalizeText(filters.centro)}%`);
    where.push(`centro_custo_nome ILIKE $${i}`);
    i += 1;
  }
  if (filters.produto) {
    values.push(`%${normalizeText(filters.produto)}%`);
    where.push(`produto_nome ILIKE $${i}`);
    i += 1;
  }
  const owner = normalizeOwner(filters.proprietario);
  if (owner === "frota") {
    where.push(`tipo_propriedade::text = 'P'`);
  }
  if (owner === "terceiro") {
    where.push(`COALESCE(tipo_propriedade::text, 'T') <> 'P'`);
  }
  if (filters.search) {
    values.push(`%${normalizeText(filters.search)}%`);
    where.push(
      `CONCAT_WS(' ', placa, veiculo_nome, fornecedor_nome, produto_nome, centro_custo_nome, categoria_label, tipo_documento, numero_documento, origem_custo) ILIKE $${i}`
    );
    i += 1;
  }

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values,
  };
}

async function queryRows(sql, params) {
  const { rows } = await clientPool.query(sql, params);
  if (process.env.DEBUG_SQL === "1") {
    console.log("[manutencoes-veiculos] sql", {
      params,
      rows: rows.length,
      sql: String(sql || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    });
  }
  return rows;
}

function mapSummary(row = {}) {
  const totalGeral = num(row.total_geral);
  const totalVeiculos = num(row.total_veiculos);
  return {
    totalGeral: money(totalGeral),
    totalLancamentos: num(row.total_lancamentos),
    totalVeiculos,
    mediaPorVeiculo: totalVeiculos > 0 ? money(totalGeral / totalVeiculos) : 0,
    placaMaiorGasto: row.placa_maior_gasto || "-",
    valorPlacaMaiorGasto: money(row.valor_placa_maior_gasto),
    categoriaMaiorGasto: row.categoria_maior_gasto || "-",
    valorCategoriaMaiorGasto: money(row.valor_categoria_maior_gasto),
    totalPneus: money(row.total_pneus),
    totalPecas: money(row.total_pecas),
    totalServicos: money(row.total_servicos),
    totalMultas: money(row.total_multas),
    totalAbastecimento: money(row.total_abastecimento),
    totalDespesasViagem: money(row.total_despesas_viagem),
  };
}

function mapLancamento(row) {
  return {
    data: dateOnly(row.data_custo),
    placa: row.placa,
    veiculoNome: row.veiculo_nome || "",
    origem: row.origem_custo,
    categoria: row.categoria_custo,
    categoriaLabel: row.categoria_label,
    tipoDocumento: row.tipo_documento,
    numeroDocumento: row.numero_documento || "",
    serieDocumento: row.serie_documento || "",
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedor: row.fornecedor_nome || "Nao informado",
    produtoCodigo: row.produto_codigo,
    produto: row.produto_nome || "",
    quantidade: num(row.quantidade),
    valorUnitario: money(row.valor_unitario),
    valorTotal: money(row.valor_total),
    centroCustoCodigo: row.centro_custo_codigo,
    centroCusto: row.centro_custo_nome || "Sem centro de custo",
    tipoPropriedade: row.tipo_propriedade,
    chaveOrigem: row.chave_origem,
  };
}

export async function getManutencoesVeiculos(filters = {}) {
  const period = resolvePeriod({
    startDate: filters.startDate || filters.dataInicio,
    endDate: filters.endDate || filters.dataFim,
  });
  const baseParams = [period.startDate, period.endDate];
  const where = buildWhere(filters, 2);
  const params = [...baseParams, ...where.values];
  const cte = custosVeiculoCte();
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 50), 2000);

  const [summaryRows, monthlyRows, rankingRows, categoriaRows, fornecedorRows, produtoRows, detalhesRows, semVeiculoRows] = await Promise.all([
    queryRows(
      `${cte}
      SELECT
        COALESCE(SUM(valor_total), 0) AS total_geral,
        COUNT(*)::int AS total_lancamentos,
        COUNT(DISTINCT placa)::int AS total_veiculos,
        COALESCE(SUM(CASE WHEN categoria_custo = 'pneus' THEN valor_total ELSE 0 END), 0) AS total_pneus,
        COALESCE(SUM(CASE WHEN categoria_custo IN ('pecas_manutencao', 'pecas_estoque') THEN valor_total ELSE 0 END), 0) AS total_pecas,
        COALESCE(SUM(CASE WHEN categoria_custo = 'servicos_manutencao' THEN valor_total ELSE 0 END), 0) AS total_servicos,
        COALESCE(SUM(CASE WHEN categoria_custo = 'multas' THEN valor_total ELSE 0 END), 0) AS total_multas,
        COALESCE(SUM(CASE WHEN categoria_custo = 'abastecimento' THEN valor_total ELSE 0 END), 0) AS total_abastecimento,
        COALESCE(SUM(CASE WHEN categoria_custo = 'despesas_viagem' THEN valor_total ELSE 0 END), 0) AS total_despesas_viagem,
        (SELECT placa FROM custos_veiculo ${where.clause} GROUP BY placa ORDER BY SUM(valor_total) DESC LIMIT 1) AS placa_maior_gasto,
        (SELECT COALESCE(SUM(valor_total), 0) FROM custos_veiculo ${where.clause} GROUP BY placa ORDER BY SUM(valor_total) DESC LIMIT 1) AS valor_placa_maior_gasto,
        (SELECT categoria_label FROM custos_veiculo ${where.clause} GROUP BY categoria_label ORDER BY SUM(valor_total) DESC LIMIT 1) AS categoria_maior_gasto,
        (SELECT COALESCE(SUM(valor_total), 0) FROM custos_veiculo ${where.clause} GROUP BY categoria_label ORDER BY SUM(valor_total) DESC LIMIT 1) AS valor_categoria_maior_gasto
      FROM custos_veiculo
      ${where.clause}`,
      params
    ),
    queryRows(
      `${cte}
      SELECT
        TO_CHAR(DATE_TRUNC('month', data_custo), 'YYYY-MM') AS mes,
        COALESCE(SUM(valor_total), 0) AS valor_total,
        COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${where.clause}
      GROUP BY DATE_TRUNC('month', data_custo), TO_CHAR(DATE_TRUNC('month', data_custo), 'YYYY-MM')
      ORDER BY DATE_TRUNC('month', data_custo)`,
      params
    ),
    queryRows(
      `${cte}
      SELECT
        placa,
        MAX(veiculo_nome) AS veiculo_nome,
        MAX(centro_custo_nome) AS centro_custo_nome,
        MAX(tipo_propriedade) AS tipo_propriedade,
        COALESCE(SUM(valor_total), 0) AS valor_total,
        COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${where.clause}
      GROUP BY placa
      ORDER BY valor_total DESC
      LIMIT 50`,
      params
    ),
    queryRows(
      `${cte}
      SELECT categoria_custo, categoria_label, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${where.clause}
      GROUP BY categoria_custo, categoria_label
      ORDER BY valor_total DESC`,
      params
    ),
    queryRows(
      `${cte}
      SELECT fornecedor_codigo, fornecedor_nome, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${where.clause}
      GROUP BY fornecedor_codigo, fornecedor_nome
      ORDER BY valor_total DESC
      LIMIT 15`,
      params
    ),
    queryRows(
      `${cte}
      SELECT produto_codigo, produto_nome, categoria_label, COALESCE(SUM(quantidade), 0) AS quantidade, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${where.clause}
      GROUP BY produto_codigo, produto_nome, categoria_label
      ORDER BY valor_total DESC
      LIMIT 15`,
      params
    ),
    queryRows(
      `${cte}
      SELECT *
      FROM custos_veiculo
      ${where.clause}
      ORDER BY data_custo DESC, valor_total DESC
      LIMIT ${limit}`,
      params
    ),
    // Lancamentos descartados do CTE principal por nao terem placa resolvida (usado so na auditoria).
    queryRows(
      `
      SELECT
        (SELECT COUNT(*)::int FROM frotas.abastecimentos aba
          WHERE aba.dataaba::date >= $1::date AND aba.dataaba::date <= $2::date
            AND COALESCE(aba.totalaba, 0) <> 0
            AND NULLIF(TRIM(aba.veiculoaba::text), '') IS NULL) AS abastecimento,
        (SELECT COUNT(*)::int FROM frotas.ordensservicosexternaprodutos i
          JOIN frotas.ordensservicosexterna o ON o.empresaose = i.empresaoep AND o.serieose = i.serieoep AND o.codigoose = i.codigooep AND o.fornecedorose = i.fornecedoroep
          WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
            AND COALESCE(i.totalitemoep, 0) <> 0
            AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculooep,''), o.veiculoose)::text), '') IS NULL) AS os_externa_produtos,
        (SELECT COUNT(*)::int FROM frotas.ordensservicosexternaservicos i
          JOIN frotas.ordensservicosexterna o ON o.empresaose = i.empresaoes AND o.serieose = i.serieoes AND o.codigoose = i.codigooes AND o.fornecedorose = i.fornecedoroes
          WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
            AND COALESCE(i.totalitemoes, 0) <> 0
            AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculooes,''), o.veiculoose)::text), '') IS NULL) AS os_externa_servicos,
        (SELECT COUNT(*)::int FROM frotas.multastransito m
          WHERE COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date >= $1::date
            AND COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date <= $2::date
            AND (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) <> 0
            AND NULLIF(TRIM(m.veiculomtr::text), '') IS NULL) AS multas
      `,
      [period.startDate, period.endDate]
    ),
  ]);

  const summary = mapSummary(summaryRows[0] || {});
  const totalGeral = summary.totalGeral || 0;

  return {
    periodo: period,
    resumo: summary,
    evolucaoMensal: monthlyRows.map((row) => ({
      mes: row.mes,
      mesLabel: monthLabel(row.mes),
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    rankingPlacas: rankingRows.map((row) => ({
      placa: row.placa,
      veiculoNome: row.veiculo_nome || "",
      centroCusto: row.centro_custo_nome || "Sem centro de custo",
      tipoPropriedade: row.tipo_propriedade,
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
      percentual: totalGeral > 0 ? money((num(row.valor_total) / totalGeral) * 100) : 0,
    })),
    categorias: categoriaRows.map((row) => ({
      categoria: row.categoria_custo,
      label: row.categoria_label,
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
      percentual: totalGeral > 0 ? money((num(row.valor_total) / totalGeral) * 100) : 0,
    })),
    fornecedores: fornecedorRows.map((row) => ({
      codigo: row.fornecedor_codigo,
      nome: row.fornecedor_nome || "Nao informado",
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    produtos: produtoRows.map((row) => ({
      codigo: row.produto_codigo,
      nome: row.produto_nome || "",
      categoriaLabel: row.categoria_label,
      quantidade: num(row.quantidade),
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    lancamentos: detalhesRows.map(mapLancamento),
    semVeiculo: {
      abastecimento: num(semVeiculoRows[0]?.abastecimento),
      osExternaProdutos: num(semVeiculoRows[0]?.os_externa_produtos),
      osExternaServicos: num(semVeiculoRows[0]?.os_externa_servicos),
      multas: num(semVeiculoRows[0]?.multas),
      total:
        num(semVeiculoRows[0]?.abastecimento) +
        num(semVeiculoRows[0]?.os_externa_produtos) +
        num(semVeiculoRows[0]?.os_externa_servicos) +
        num(semVeiculoRows[0]?.multas),
    },
  };
}

export async function getManutencoesVeiculosFiltros() {
  const cte = custosVeiculoCte();
  const params = ["2000-01-01", "2100-01-01"];

  const [placas, categorias, fornecedores, centros, produtos] = await Promise.all([
    queryRows(`${cte} SELECT DISTINCT placa FROM custos_veiculo WHERE placa IS NOT NULL ORDER BY placa`, params),
    queryRows(`${cte} SELECT DISTINCT categoria_custo, categoria_label FROM custos_veiculo ORDER BY categoria_label`, params),
    queryRows(
      `${cte} SELECT DISTINCT fornecedor_codigo, fornecedor_nome FROM custos_veiculo WHERE fornecedor_nome IS NOT NULL ORDER BY fornecedor_nome`,
      params
    ),
    queryRows(
      `${cte} SELECT DISTINCT centro_custo_codigo, centro_custo_nome FROM custos_veiculo WHERE centro_custo_nome IS NOT NULL ORDER BY centro_custo_nome`,
      params
    ),
    queryRows(
      `${cte} SELECT DISTINCT produto_codigo, produto_nome FROM custos_veiculo WHERE produto_nome IS NOT NULL ORDER BY produto_nome`,
      params
    ),
  ]);

  return {
    placas: placas.map((row) => row.placa),
    categorias: categorias.map((row) => ({ valor: row.categoria_custo, label: row.categoria_label })),
    fornecedores: fornecedores.map((row) => ({ codigo: row.fornecedor_codigo, nome: row.fornecedor_nome })),
    centrosCusto: centros.map((row) => ({ codigo: row.centro_custo_codigo, nome: row.centro_custo_nome })),
    produtos: produtos.map((row) => ({ codigo: row.produto_codigo, nome: row.produto_nome })),
  };
}

export async function getManutencaoVeiculoDetalhe(placa, filters = {}) {
  const placaUpper = normalizeUpper(placa);
  if (!placaUpper) {
    return null;
  }

  const period = resolvePeriod({
    startDate: filters.startDate || filters.dataInicio,
    endDate: filters.endDate || filters.dataFim,
  });
  const cte = custosVeiculoCte();
  const params = [period.startDate, period.endDate, placaUpper];
  const placaClause = "WHERE placa = $3";

  const [resumoRows, categoriaRows, mensalRows, produtoRows, fornecedorRows, origemRows, ultimasRows, infoRows] = await Promise.all([
    queryRows(
      `${cte}
      SELECT COALESCE(SUM(valor_total), 0) AS total, COUNT(*)::int AS lancamentos, MIN(data_custo) AS primeira_data, MAX(data_custo) AS ultima_data
      FROM custos_veiculo
      ${placaClause}`,
      params
    ),
    queryRows(
      `${cte}
      SELECT categoria_custo, categoria_label, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${placaClause}
      GROUP BY categoria_custo, categoria_label
      ORDER BY valor_total DESC`,
      params
    ),
    queryRows(
      `${cte}
      SELECT TO_CHAR(DATE_TRUNC('month', data_custo), 'YYYY-MM') AS mes, COALESCE(SUM(valor_total), 0) AS valor_total
      FROM custos_veiculo
      ${placaClause}
      GROUP BY DATE_TRUNC('month', data_custo), TO_CHAR(DATE_TRUNC('month', data_custo), 'YYYY-MM')
      ORDER BY DATE_TRUNC('month', data_custo)`,
      params
    ),
    queryRows(
      `${cte}
      SELECT produto_nome, categoria_label, COALESCE(SUM(quantidade), 0) AS quantidade, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${placaClause}
      GROUP BY produto_nome, categoria_label
      ORDER BY valor_total DESC
      LIMIT 10`,
      params
    ),
    queryRows(
      `${cte}
      SELECT fornecedor_nome, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${placaClause}
      GROUP BY fornecedor_nome
      ORDER BY valor_total DESC
      LIMIT 10`,
      params
    ),
    queryRows(
      `${cte}
      SELECT origem_custo, COALESCE(SUM(valor_total), 0) AS valor_total, COUNT(*)::int AS lancamentos
      FROM custos_veiculo
      ${placaClause}
      GROUP BY origem_custo
      ORDER BY valor_total DESC`,
      params
    ),
    queryRows(
      `${cte}
      SELECT *
      FROM custos_veiculo
      ${placaClause}
      ORDER BY data_custo DESC
      LIMIT 15`,
      params
    ),
    queryRows(
      `SELECT nomevei, tipopropriedadevei, centrocustovei
      FROM frotas.veiculos
      WHERE UPPER(TRIM(placavei::text)) = $1
        AND COALESCE(situacaovei::text, '') <> 'I'
      LIMIT 1`,
      [placaUpper]
    ),
  ]);

  const resumo = resumoRows[0] || {};
  const total = money(resumo.total);
  const meses = mensalRows.length || 1;

  return {
    placa: placaUpper,
    veiculoNome: infoRows[0]?.nomevei || "",
    tipoPropriedade: infoRows[0]?.tipopropriedadevei || null,
    periodo: period,
    totalGasto: total,
    totalLancamentos: num(resumo.lancamentos),
    primeiraData: dateOnly(resumo.primeira_data),
    ultimaData: dateOnly(resumo.ultima_data),
    custoMedioMensal: money(total / meses),
    categorias: categoriaRows.map((row) => ({
      categoria: row.categoria_custo,
      label: row.categoria_label,
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
      percentual: total > 0 ? money((num(row.valor_total) / total) * 100) : 0,
    })),
    evolucaoMensal: mensalRows.map((row) => ({
      mes: row.mes,
      mesLabel: monthLabel(row.mes),
      valor: money(row.valor_total),
    })),
    produtos: produtoRows.map((row) => ({
      nome: row.produto_nome || "",
      categoriaLabel: row.categoria_label,
      quantidade: num(row.quantidade),
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    fornecedores: fornecedorRows.map((row) => ({
      nome: row.fornecedor_nome || "Nao informado",
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    origens: origemRows.map((row) => ({
      origem: row.origem_custo,
      valor: money(row.valor_total),
      lancamentos: num(row.lancamentos),
    })),
    ultimasManutencoes: ultimasRows.map(mapLancamento),
  };
}
