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

function baseCostCte() {
  return `
    WITH pagamentos AS (
      SELECT
        empresappg,
        serieppg,
        duplicatappg,
        parcelappg,
        fornecedorppg,
        MAX(datapagamentoppg)::date AS data_pagamento,
        COALESCE(SUM(valorpagoppg), 0) AS valor_pago_real
      FROM financeiro.pagarpagamentos
      GROUP BY empresappg, serieppg, duplicatappg, parcelappg, fornecedorppg
    ),
    rateios AS (
      SELECT
        ('pagar:' || pag.empresapag || ':' || pag.seriepag || ':' || pag.duplicatapag || ':' || pag.parcelapag || ':' || pag.fornecedorpag || ':' || prt.centrocustoprt || ':' || prt.contafinanceiraprt) AS id,
        pag.empresapag::int AS empresa,
        pag.seriepag AS serie,
        pag.duplicatapag,
        pag.parcelapag,
        pag.fornecedorpag AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        pag.dataemissaopag::date AS data,
        pag.datavencimentopag::date AS vencimento,
        pgt.data_pagamento,
        COALESCE(prt.valorrateioprt, 0)::numeric AS valor,
        CASE
          WHEN COALESCE(pag.valorduplicatapag, 0) > 0
            THEN COALESCE(pag.valorabertopag, 0) * (COALESCE(prt.valorrateioprt, 0) / NULLIF(pag.valorduplicatapag, 0))
          ELSE COALESCE(pag.valorabertopag, 0)
        END::numeric AS valor_aberto,
        pag.statuspag,
        prt.centrocustoprt::int AS centro_codigo,
        COALESCE(NULLIF(ccs.nomeccs, ''), 'Sem centro de custo') AS centro_custo,
        prt.contafinanceiraprt::int AS conta_codigo,
        COALESCE(NULLIF(cfi.nomecfi, ''), 'Sem classificacao') AS conta_nome,
        cfi.mascaracfi AS conta_mascara,
        pag.observacaopag AS historico,
        pag.documentopag AS documento,
        pag.veiculopag AS veiculo_documento,
        COALESCE(vei_doc.placavei, vei_cc.placavei) AS placa,
        COALESCE(vei_doc.nomevei, vei_cc.nomevei) AS veiculo_nome,
        COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei) AS tipo_propriedade,
        COALESCE(vei_doc.kmatualvei, vei_cc.kmatualvei) AS km_atual,
        COALESCE(vei_doc.centrocustovei, vei_cc.centrocustovei, prt.centrocustoprt)::int AS centro_veiculo,
        CASE
          WHEN COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei)::text = 'T' THEN 'terceiro'
          WHEN COALESCE(vei_doc.placavei, vei_cc.placavei) IS NULL THEN 'nao_identificado'
          ELSE 'frota'
        END AS proprietario,
        CASE
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%combust%' OR COALESCE(cfi.nomecfi, '') ILIKE '%abastec%' THEN 'Abastecimento'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%manuten%' OR COALESCE(cfi.nomecfi, '') ILIKE '%oficina%' OR COALESCE(cfi.nomecfi, '') ILIKE '%reparo%' THEN 'Manutencao'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%pneu%' THEN 'Pneus'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%pedagio%' THEN 'Pedagio'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%seguro%' THEN 'Seguro'::text
          ELSE 'Outros'::text
        END AS tipo_custo,
        'financeiro.pagar'::text AS origem
      FROM financeiro.pagarrateios prt
      JOIN financeiro.pagar pag
        ON pag.empresapag = prt.empresaprt
       AND pag.seriepag = prt.serieprt
       AND pag.duplicatapag = prt.duplicataprt
       AND pag.parcelapag = prt.parcelaprt
       AND pag.fornecedorpag = prt.fornecedorprt
      LEFT JOIN LATERAL (
        SELECT c.nomeccs
        FROM financeiro.centroscustos c
        WHERE c.codigoccs = prt.centrocustoprt
        ORDER BY (c.empresaccs = pag.empresapag) DESC, c.empresaccs
        LIMIT 1
      ) ccs ON true
      LEFT JOIN LATERAL (
        SELECT c.nomecfi, c.mascaracfi
        FROM financeiro.contasfinanceiras c
        WHERE c.codigocfi = prt.contafinanceiraprt
        ORDER BY (c.empresacfi = pag.empresapag) DESC, c.empresacfi
        LIMIT 1
      ) cfi ON true
      LEFT JOIN LATERAL (
        SELECT f.nomefor, f.fantasiafor
        FROM gerais.fornecedores f
        WHERE f.codigofor = pag.fornecedorpag
        ORDER BY (f.empresafor = pag.empresapag) DESC, f.empresafor
        LIMIT 1
      ) forn ON true
      LEFT JOIN pagamentos pgt
        ON pgt.empresappg = pag.empresapag
       AND pgt.serieppg = pag.seriepag
       AND pgt.duplicatappg = pag.duplicatapag
       AND pgt.parcelappg = pag.parcelapag
       AND pgt.fornecedorppg = pag.fornecedorpag
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.tipopropriedadevei, v.kmatualvei, v.centrocustovei
        FROM frotas.veiculos v
        WHERE NULLIF(TRIM(pag.veiculopag::text), '') IS NOT NULL
          AND UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(pag.veiculopag::text))
          AND COALESCE(v.situacaovei::text, '') <> 'I'
        ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
        LIMIT 1
      ) vei_doc ON true
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.tipopropriedadevei, v.kmatualvei, v.centrocustovei
        FROM frotas.veiculos v
        WHERE v.centrocustovei = prt.centrocustoprt
          AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
          AND COALESCE(v.situacaovei::text, '') <> 'I'
        ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
        LIMIT 1
      ) vei_cc ON true
      WHERE pag.datavencimentopag::date >= $1::date
        AND pag.datavencimentopag::date <= $2::date
        AND COALESCE(prt.valorrateioprt, 0) <> 0
    ),
    abastecimentos_operacionais AS (
      SELECT
        ('abastecimento:' || aba.empresaaba || ':' || aba.codigoaba) AS id,
        aba.empresaaba::int AS empresa,
        aba.serieaba AS serie,
        aba.duplicataaba AS duplicatapag,
        aba.parcelaaba AS parcelapag,
        aba.postocombustivelaba AS fornecedor_codigo,
        ('Posto ' || COALESCE(aba.postocombustivelaba::text, 'nao informado')) AS fornecedor,
        aba.dataaba::date AS data,
        COALESCE(aba.datavencimentoaba, aba.dataaba)::date AS vencimento,
        aba.databaixaaba::date AS data_pagamento,
        COALESCE(aba.totalaba, 0)::numeric AS valor,
        CASE WHEN aba.databaixaaba IS NULL THEN COALESCE(aba.totalaba, 0) ELSE 0 END::numeric AS valor_aberto,
        aba.statusaba AS statuspag,
        v.centrocustovei::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        v.contafinanceiraabastecimentovei AS conta_codigo,
        'Abastecimento operacional'::text AS conta_nome,
        NULL::text AS conta_mascara,
        aba.observacaoaba AS historico,
        aba.documentoaba::text AS documento,
        aba.veiculoaba AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.tipopropriedadevei::text = 'T' THEN 'terceiro'
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          ELSE 'frota'
        END AS proprietario,
        'Abastecimento'::text AS tipo_custo,
        'frotas.abastecimentos'::text AS origem
      FROM frotas.abastecimentos aba
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(aba.veiculoaba::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = v.centrocustovei
       AND (ccs.empresaccs = v.empresavei OR ccs.empresaccs IS NULL)
      WHERE aba.dataaba::date >= $1::date
        AND aba.dataaba::date <= $2::date
        AND COALESCE(aba.totalaba, 0) <> 0
        AND (
          aba.duplicatageradaaba IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM financeiro.pagar pag
            WHERE pag.empresapag = COALESCE(aba.empresaaba, pag.empresapag)
              AND pag.seriepag = COALESCE(aba.seriegeradaaba, aba.serieaba, pag.seriepag)
              AND pag.duplicatapag = COALESCE(aba.duplicatageradaaba, aba.duplicataaba)
          )
        )
    ),
    custos_base AS (
      SELECT * FROM rateios
      UNION ALL
      SELECT * FROM abastecimentos_operacionais
    ),
    custos_status AS (
      SELECT
        *,
        CASE
          WHEN statuspag::text ILIKE '%cancel%' THEN 'cancelado'
          WHEN COALESCE(valor_aberto, 0) > 0 AND vencimento < CURRENT_DATE THEN 'vencido'
          WHEN COALESCE(valor_aberto, 0) > 0 THEN 'aberto'
          ELSE 'pago'
        END AS situacao,
        GREATEST(COALESCE(valor, 0) - COALESCE(valor_aberto, 0), 0)::numeric AS valor_pago,
        CASE
          WHEN NULLIF(TRIM(placa::text), '') IS NOT NULL THEN UPPER(TRIM(placa::text))
          WHEN centro_codigo IS NOT NULL THEN 'CC ' || centro_codigo::text
          ELSE 'Nao identificado'
        END AS placa_resolvida
      FROM custos_base
    )
  `;
}

function buildWhere(filters = {}, offset = 2) {
  const where = [];
  const values = [];
  let i = offset + 1;

  if (filters.placa) {
    values.push(`%${normalizeUpper(filters.placa)}%`);
    where.push(`(UPPER(COALESCE(placa_resolvida, '')) ILIKE $${i} OR UPPER(COALESCE(veiculo_documento, '')) ILIKE $${i})`);
    i += 1;
  }
  if (filters.centro) {
    const centroText = normalizeText(filters.centro);
    const centroCode = centroText.match(/^(\d+)/)?.[1];
    values.push(`%${centroText}%`);
    if (centroCode) {
      values.push(Number(centroCode));
      where.push(`(centro_codigo::text ILIKE $${i} OR centro_custo ILIKE $${i} OR centro_codigo = $${i + 1})`);
      i += 2;
    } else {
      where.push(`(centro_codigo::text ILIKE $${i} OR centro_custo ILIKE $${i})`);
      i += 1;
    }
  }
  if (filters.tipoCusto && filters.tipoCusto !== "todos") {
    values.push(filters.tipoCusto);
    where.push(`tipo_custo = $${i}`);
    i += 1;
  }
  if (filters.situacao && filters.situacao !== "todos") {
    values.push(filters.situacao);
    where.push(`situacao = $${i}`);
    i += 1;
  }
  if (filters.fornecedor) {
    const fornecedorText = normalizeText(filters.fornecedor);
    const fornecedorCode = fornecedorText.match(/^(\d+)/)?.[1];
    values.push(`%${fornecedorText}%`);
    if (fornecedorCode) {
      values.push(Number(fornecedorCode));
      where.push(`(fornecedor ILIKE $${i} OR fornecedor_codigo::text ILIKE $${i} OR fornecedor_codigo = $${i + 1})`);
      i += 2;
    } else {
      where.push(`(fornecedor ILIKE $${i} OR fornecedor_codigo::text ILIKE $${i})`);
      i += 1;
    }
  }
  if (filters.empresa) {
    values.push(Number(filters.empresa));
    where.push(`empresa = $${i}`);
    i += 1;
  }

  const owner = normalizeOwner(filters.proprietario);
  if (owner === "frota" || owner === "terceiro") {
    values.push(owner);
    where.push(`proprietario = $${i}`);
    i += 1;
  }

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values,
  };
}

function mapSummary(row = {}) {
  const custoTotal = num(row.custo_total);
  const totalVeiculos = num(row.total_veiculos);
  return {
    custoTotal: money(custoTotal),
    custoPago: money(row.custo_pago),
    custoAberto: money(row.custo_aberto),
    custoVencido: money(row.custo_vencido),
    custoMedioVeiculo: totalVeiculos > 0 ? money(custoTotal / totalVeiculos) : 0,
    veiculoMaiorCusto: row.veiculo_maior_custo || "Nao identificado",
    maiorCustoValor: money(row.maior_custo_valor),
    quantidadeLancamentos: num(row.quantidade_lancamentos),
    totalVeiculos,
  };
}

function mapLaunch(row) {
  return {
    id: row.id,
    data: dateOnly(row.data),
    placa: row.placa_resolvida || "Nao identificado",
    placaOriginal: row.placa || row.veiculo_documento || "",
    centroCodigo: row.centro_codigo,
    centroCusto: row.centro_custo || "Sem centro de custo",
    tipoCusto: row.tipo_custo || "Outros",
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedor: row.fornecedor || "Nao informado",
    descricao: row.conta_nome || row.historico || row.documento || "",
    historico: row.historico || "",
    documento: row.documento || "",
    valor: money(row.valor),
    valorPago: money(row.valor_pago),
    valorAberto: money(row.valor_aberto),
    vencimento: dateOnly(row.vencimento),
    pagamento: dateOnly(row.data_pagamento),
    situacao: row.situacao,
    origem: row.origem,
    empresa: row.empresa,
    proprietario: row.proprietario,
    veiculoNome: row.veiculo_nome || "",
  };
}

async function queryCostRows(sql, params) {
  const { rows } = await clientPool.query(sql, params);
  return rows;
}

export async function getCustosVeiculos(filters = {}) {
  const period = resolvePeriod({ startDate: filters.startDate || filters.dataInicio, endDate: filters.endDate || filters.dataFim });
  const baseParams = [period.startDate, period.endDate];
  const where = buildWhere(filters, 2);
  const params = [...baseParams, ...where.values];
  const limit = Math.min(Math.max(Number(filters.limit) || 250, 20), 800);

  const cte = baseCostCte();

  const [summaryRows, monthlyRows, rankingRows, typeRows, supplierRows, statusRows, launchesRows, validationRows] = await Promise.all([
    queryCostRows(`
      ${cte}
      SELECT
        COALESCE(SUM(valor), 0) AS custo_total,
        COALESCE(SUM(valor_pago), 0) AS custo_pago,
        COALESCE(SUM(valor_aberto), 0) AS custo_aberto,
        COALESCE(SUM(CASE WHEN situacao = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS custo_vencido,
        COUNT(*)::int AS quantidade_lancamentos,
        COUNT(DISTINCT placa_resolvida)::int AS total_veiculos,
        (SELECT placa_resolvida FROM custos_status ${where.clause} GROUP BY placa_resolvida ORDER BY SUM(valor) DESC LIMIT 1) AS veiculo_maior_custo,
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status ${where.clause} GROUP BY placa_resolvida ORDER BY SUM(valor) DESC LIMIT 1) AS maior_custo_valor
      FROM custos_status
      ${where.clause}
    `, params),
    queryCostRows(`
      ${cte}
      SELECT
        TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM') AS mes,
        COALESCE(SUM(valor), 0) AS custo,
        COALESCE(SUM(valor_pago), 0) AS pago,
        COALESCE(SUM(valor_aberto), 0) AS aberto,
        COALESCE(SUM(CASE WHEN situacao = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS vencido
      FROM custos_status
      ${where.clause}
      GROUP BY DATE_TRUNC('month', data), TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')
      ORDER BY DATE_TRUNC('month', data)
    `, params),
    queryCostRows(`
      ${cte}
      SELECT
        placa_resolvida AS placa,
        MAX(veiculo_nome) AS veiculo_nome,
        MAX(centro_custo) AS centro_custo,
        MAX(proprietario) AS proprietario,
        COALESCE(SUM(valor), 0) AS custo,
        COALESCE(SUM(valor_pago), 0) AS pago,
        COALESCE(SUM(valor_aberto), 0) AS aberto,
        COUNT(*)::int AS lancamentos
      FROM custos_status
      ${where.clause}
      GROUP BY placa_resolvida
      ORDER BY custo DESC
      LIMIT 30
    `, params),
    queryCostRows(`
      ${cte}
      SELECT tipo_custo AS tipo, COALESCE(SUM(valor), 0) AS custo, COUNT(*)::int AS lancamentos
      FROM custos_status
      ${where.clause}
      GROUP BY tipo_custo
      ORDER BY custo DESC
    `, params),
    queryCostRows(`
      ${cte}
      SELECT fornecedor, fornecedor_codigo, COALESCE(SUM(valor), 0) AS custo, COUNT(*)::int AS lancamentos
      FROM custos_status
      ${where.clause}
      GROUP BY fornecedor, fornecedor_codigo
      ORDER BY custo DESC
      LIMIT 30
    `, params),
    queryCostRows(`
      ${cte}
      SELECT situacao, COALESCE(SUM(valor), 0) AS custo, COUNT(*)::int AS lancamentos
      FROM custos_status
      ${where.clause}
      GROUP BY situacao
      ORDER BY custo DESC
    `, params),
    queryCostRows(`
      ${cte}
      SELECT *
      FROM custos_status
      ${where.clause}
      ORDER BY data DESC, valor DESC
      LIMIT ${limit}
    `, params),
    queryCostRows(`
      ${cte}
      SELECT
        (SELECT COALESCE(SUM(prt.valorrateioprt), 0)
         FROM financeiro.pagarrateios prt
         JOIN financeiro.pagar pag
           ON pag.empresapag = prt.empresaprt
          AND pag.seriepag = prt.serieprt
          AND pag.duplicatapag = prt.duplicataprt
          AND pag.parcelapag = prt.parcelaprt
          AND pag.fornecedorpag = prt.fornecedorprt
         WHERE pag.datavencimentopag::date >= $1::date
           AND pag.datavencimentopag::date <= $2::date) AS financeiro_rateios_periodo,
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status) AS base_periodo,
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status ${where.clause}) AS base_filtrada
    `, params),
  ]);

  return {
    period,
    summary: mapSummary(summaryRows[0]),
    monthly: monthlyRows.map((row) => ({
      mes: row.mes,
      label: monthLabel(row.mes),
      custo: money(row.custo),
      pago: money(row.pago),
      aberto: money(row.aberto),
      vencido: money(row.vencido),
    })),
    ranking: rankingRows.map((row) => ({
      placa: row.placa || "Nao identificado",
      veiculoNome: row.veiculo_nome || "",
      centroCusto: row.centro_custo || "Sem centro de custo",
      proprietario: row.proprietario || "nao_identificado",
      custo: money(row.custo),
      pago: money(row.pago),
      aberto: money(row.aberto),
      lancamentos: num(row.lancamentos),
    })),
    types: typeRows.map((row) => ({ tipo: row.tipo || "Outros", custo: money(row.custo), lancamentos: num(row.lancamentos) })),
    suppliers: supplierRows.map((row) => ({
      fornecedor: row.fornecedor || "Nao informado",
      fornecedorCodigo: row.fornecedor_codigo,
      custo: money(row.custo),
      lancamentos: num(row.lancamentos),
    })),
    status: statusRows.map((row) => ({ situacao: row.situacao, custo: money(row.custo), lancamentos: num(row.lancamentos) })),
    launches: launchesRows.map(mapLaunch),
    validation: {
      financeiroRateiosPeriodo: money(validationRows[0]?.financeiro_rateios_periodo),
      basePeriodo: money(validationRows[0]?.base_periodo),
      baseFiltrada: money(validationRows[0]?.base_filtrada),
      observacao: "Base principal em financeiro.pagarrateios/financeiro.pagar; abastecimentos operacionais entram apenas quando nao ha duplicata financeira gerada.",
    },
  };
}

export async function getCustosVeiculosFiltros() {
  const period = resolvePeriod({});
  const cte = baseCostCte();
  const params = [period.startDate, period.endDate];
  const [plates, centers, types, statuses, suppliers, companies] = await Promise.all([
    queryCostRows(`${cte} SELECT DISTINCT placa_resolvida AS value FROM custos_status WHERE placa_resolvida IS NOT NULL ORDER BY value LIMIT 300`, params),
    queryCostRows(`${cte} SELECT DISTINCT centro_codigo AS codigo, centro_custo AS nome FROM custos_status WHERE centro_codigo IS NOT NULL ORDER BY centro_custo LIMIT 300`, params),
    queryCostRows(`${cte} SELECT DISTINCT tipo_custo AS value FROM custos_status ORDER BY value`, params),
    queryCostRows(`${cte} SELECT DISTINCT situacao AS value FROM custos_status ORDER BY value`, params),
    queryCostRows(`${cte} SELECT DISTINCT fornecedor AS nome, fornecedor_codigo AS codigo FROM custos_status WHERE fornecedor IS NOT NULL ORDER BY fornecedor LIMIT 300`, params),
    queryCostRows(`${cte} SELECT DISTINCT empresa AS value FROM custos_status WHERE empresa IS NOT NULL ORDER BY empresa`, params),
  ]);

  return {
    period,
    placas: plates.map((row) => row.value).filter(Boolean),
    centros: centers.map((row) => ({ codigo: row.codigo, nome: row.nome })),
    tipos: types.map((row) => row.value).filter(Boolean),
    situacoes: statuses.map((row) => row.value).filter(Boolean),
    fornecedores: suppliers.map((row) => ({ codigo: row.codigo, nome: row.nome })),
    empresas: companies.map((row) => row.value).filter((v) => v !== null && v !== undefined),
    proprietarios: ["todos", "frota", "terceiro"],
  };
}

export async function getCustosVeiculoDetalhe(placa, filters = {}) {
  const target = normalizeUpper(placa);
  const data = await getCustosVeiculos({ ...filters, placa: target, limit: 120 });
  const vehicleRows = await queryCostRows(
    `
      SELECT
        v.empresavei AS empresa,
        v.placavei AS placa,
        v.nomevei AS nome,
        v.modelovei AS modelo,
        v.tipopropriedadevei AS tipo_propriedade,
        v.kmatualvei AS km_atual,
        v.dataatualkmvei AS data_km,
        v.centrocustovei AS centro_codigo,
        c.nomeccs AS centro_custo,
        v.situacaovei AS situacao,
        v.numeroeixosvei AS eixos,
        v.dataaquisicaovei AS data_aquisicao
      FROM frotas.veiculos v
      LEFT JOIN financeiro.centroscustos c
        ON c.codigoccs = v.centrocustovei
       AND (c.empresaccs = v.empresavei OR c.empresaccs IS NULL)
      WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM($1::text))
      ORDER BY v.empresavei
      LIMIT 1
    `,
    [target],
  );

  const manutencoes = await queryCostRows(
    `
      SELECT
        datamvm::date AS data,
        produtomvm AS produto,
        kilometragematualmvm AS km,
        quantidademvm AS quantidade,
        observacaomvm AS observacao,
        ordemservicoexternamvm AS ordem_servico,
        fornecedorordemservicoexternamvm AS fornecedor
      FROM frotas.movimentacaomanutencoes
      WHERE UPPER(TRIM(veiculomvm::text)) = UPPER(TRIM($1::text))
      ORDER BY datamvm DESC, codigomvm DESC
      LIMIT 30
    `,
    [target],
  ).catch(() => []);

  const abastecimentos = await queryCostRows(
    `
      SELECT
        dataaba::date AS data,
        codigoaba AS codigo,
        veiculoaba AS placa,
        litrosaba AS litros,
        valorlitroaba AS valor_litro,
        totalaba AS total,
        kilometragematualaba AS km,
        mediaaba AS media,
        postocombustivelaba AS posto,
        observacaoaba AS observacao
      FROM frotas.abastecimentos
      WHERE UPPER(TRIM(veiculoaba::text)) = UPPER(TRIM($1::text))
      ORDER BY dataaba DESC, codigoaba DESC
      LIMIT 30
    `,
    [target],
  ).catch(() => []);

  const vehicle = vehicleRows[0] || {};
  return {
    ...data,
    vehicle: {
      empresa: vehicle.empresa,
      placa: vehicle.placa || target,
      nome: vehicle.nome || "",
      modelo: vehicle.modelo || "",
      proprietario: vehicle.tipo_propriedade === "T" ? "terceiro" : "frota",
      kmAtual: num(vehicle.km_atual),
      dataKm: dateOnly(vehicle.data_km),
      centroCodigo: vehicle.centro_codigo,
      centroCusto: vehicle.centro_custo || "",
      situacao: vehicle.situacao,
      eixos: vehicle.eixos,
      dataAquisicao: dateOnly(vehicle.data_aquisicao),
      custoPorKm: num(vehicle.km_atual) > 0 ? money(data.summary.custoTotal / num(vehicle.km_atual)) : 0,
    },
    manutencoes: manutencoes.map((row) => ({
      data: dateOnly(row.data),
      produto: row.produto,
      km: num(row.km),
      quantidade: num(row.quantidade),
      observacao: row.observacao || "",
      ordemServico: row.ordem_servico,
      fornecedor: row.fornecedor,
    })),
    abastecimentos: abastecimentos.map((row) => ({
      data: dateOnly(row.data),
      codigo: row.codigo,
      litros: num(row.litros),
      valorLitro: money(row.valor_litro),
      total: money(row.total),
      km: num(row.km),
      media: num(row.media),
      posto: row.posto,
      observacao: row.observacao || "",
    })),
  };
}
