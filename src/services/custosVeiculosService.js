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
  const v = normalizeText(value || "frota").toLowerCase();
  if (["frota", "terceiro", "terceiros", "todos"].includes(v)) return v === "terceiros" ? "terceiro" : v;
  return "frota";
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
        COALESCE(vei_doc.proprietariovei, vei_cc.proprietariovei) AS proprietario_codigo,
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
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%motorista%' OR COALESCE(cfi.nomecfi, '') ILIKE '%frete%' OR COALESCE(cfi.nomecfi, '') ILIKE '%carta frete%' THEN 'Motorista/frete'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%multa%' THEN 'Multas'::text
          WHEN COALESCE(cfi.nomecfi, '') ILIKE '%admin%' OR COALESCE(ccs.nomeccs, '') ILIKE '%admin%' OR COALESCE(ccs.nomeccs, '') ILIKE '%escritorio%' THEN 'Despesas administrativas'::text
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
        SELECT v.placavei, v.nomevei, v.tipopropriedadevei, v.proprietariovei, v.kmatualvei, v.centrocustovei
        FROM frotas.veiculos v
        WHERE NULLIF(TRIM(pag.veiculopag::text), '') IS NOT NULL
          AND UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(pag.veiculopag::text))
          AND COALESCE(v.situacaovei::text, '') <> 'I'
        ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
        LIMIT 1
      ) vei_doc ON true
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.tipopropriedadevei, v.proprietariovei, v.kmatualvei, v.centrocustovei
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
        v.proprietariovei AS proprietario_codigo,
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
    despesas_viagem_operacionais AS (
      SELECT
        ('despesa-viagem:' || cvd.empresacvd || ':' || cvd.codigocvd || ':' || cvd.sequenciacvd) AS id,
        cvd.empresacvd::int AS empresa,
        cvd.seriecvd AS serie,
        cvd.duplicatacvd AS duplicatapag,
        NULL::varchar AS parcelapag,
        cvd.fornecedorcvd AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        cvd.datacvd::date AS data,
        cvd.datacvd::date AS vencimento,
        cvd.datacvd::date AS data_pagamento,
        COALESCE(cvd.valorcvd, 0)::numeric AS valor,
        0::numeric AS valor_aberto,
        0::smallint AS statuspag,
        v.centrocustovei::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        desp.contafinanceiracpv AS conta_codigo,
        COALESCE(NULLIF(desp.nomecpv, ''), 'Despesa de viagem') AS conta_nome,
        NULL::text AS conta_mascara,
        cvd.observacaocvd AS historico,
        COALESCE(cvd.notafiscalcvd, cvd.documentocvd::text) AS documento,
        COALESCE(NULLIF(cvd.veiculocvd, ''), cvg.veiculocvg) AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.tipopropriedadevei::text = 'T' THEN 'terceiro'
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          ELSE 'frota'
        END AS proprietario,
        CASE
          WHEN COALESCE(desp.nomecpv, '') ILIKE '%pedagio%' THEN 'Pedagio'::text
          WHEN COALESCE(desp.nomecpv, '') ILIKE '%multa%' THEN 'Multas'::text
          WHEN COALESCE(desp.nomecpv, '') ILIKE '%motorista%' OR COALESCE(desp.nomecpv, '') ILIKE '%frete%' THEN 'Motorista/frete'::text
          WHEN COALESCE(desp.nomecpv, '') ILIKE '%admin%' THEN 'Despesas administrativas'::text
          ELSE 'Outros'::text
        END AS tipo_custo,
        'logistica.controleviagensdespesas'::text AS origem
      FROM logistica.controleviagensdespesas cvd
      LEFT JOIN logistica.controleviagens cvg
        ON cvg.empresacvg = cvd.empresacvd
       AND cvg.codigocvg = cvd.codigocvd
      LEFT JOIN logistica.despesasviagem desp
        ON desp.codigocpv = cvd.despesaviagemcvd
       AND (desp.empresacpv = cvd.empresacvd OR desp.empresacpv IS NULL)
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = cvd.fornecedorcvd
       AND (forn.empresafor = cvd.empresacvd OR forn.empresafor IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(NULLIF(cvd.veiculocvd, ''), cvg.veiculocvg)::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = v.centrocustovei
       AND (ccs.empresaccs = v.empresavei OR ccs.empresaccs IS NULL)
      WHERE cvd.datacvd::date >= $1::date
        AND cvd.datacvd::date <= $2::date
        AND COALESCE(cvd.valorcvd, 0) <> 0
        AND COALESCE(cvd.financeirocvd, 'N') <> 'S'
        AND NULLIF(TRIM(COALESCE(cvd.chaveduplicatapagarcvd, '')::text), '') IS NULL
    ),
    custos_base AS (
      SELECT * FROM rateios
      UNION ALL
      SELECT * FROM abastecimentos_operacionais
      UNION ALL
      SELECT * FROM despesas_viagem_operacionais
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

  if (filters.valorMin !== undefined && filters.valorMin !== null && filters.valorMin !== "") {
    values.push(Number(filters.valorMin));
    where.push(`valor >= $${i}`);
    i += 1;
  }
  if (filters.valorMax !== undefined && filters.valorMax !== null && filters.valorMax !== "") {
    values.push(Number(filters.valorMax));
    where.push(`valor <= $${i}`);
    i += 1;
  }
  if (filters.search) {
    values.push(`%${normalizeText(filters.search)}%`);
    where.push(`CONCAT_WS(' ', placa_resolvida, placa, veiculo_nome, centro_custo, tipo_custo, fornecedor, historico, documento, origem, conta_nome) ILIKE $${i}`);
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

function buildRevenueWhere(filters = {}, offset = 2) {
  const where = [
    "con.statuscon = 2",
    "con.dataemissaocon::date >= $1::date",
    "con.dataemissaocon::date <= $2::date",
    "NULLIF(TRIM(con.veiculocon::text), '') IS NOT NULL",
  ];
  const values = [];
  let i = offset + 1;

  if (filters.placa) {
    values.push(`%${normalizeUpper(filters.placa)}%`);
    where.push(`UPPER(TRIM(con.veiculocon::text)) ILIKE $${i}`);
    i += 1;
  }
  if (filters.empresa) {
    values.push(Number(filters.empresa));
    where.push(`con.empresacon = $${i}`);
    i += 1;
  }
  if (filters.search) {
    values.push(`%${normalizeText(filters.search)}%`);
    where.push(`CONCAT_WS(' ', con.veiculocon, vei.nomevei, con.codigocon::text, con.numeroctecon::text, con.chavectecon) ILIKE $${i}`);
    i += 1;
  }

  const owner = normalizeOwner(filters.proprietario);
  if (owner === "frota") {
    where.push("vei.placavei IS NOT NULL AND COALESCE(vei.tipopropriedadevei::text, '') <> 'T'");
  } else if (owner === "terceiro") {
    where.push("vei.tipopropriedadevei::text = 'T'");
  }

  return { clause: `WHERE ${where.join(" AND ")}`, values };
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
    maiorCategoria: row.maior_categoria || "Nao identificado",
    maiorCategoriaValor: money(row.maior_categoria_valor),
    maiorFornecedor: row.maior_fornecedor || "Nao identificado",
    maiorFornecedorValor: money(row.maior_fornecedor_valor),
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
    proprietarioCodigo: row.proprietario_codigo,
    veiculoNome: row.veiculo_nome || "",
  };
}

async function queryCostRows(sql, params) {
  const { rows } = await clientPool.query(sql, params);
  console.log("[custos-veiculos] sql", {
    params,
    rows: rows.length,
    sql: String(sql || "").replace(/\s+/g, " ").trim().slice(0, 1200),
  });
  return rows;
}

export async function getCustosVeiculos(filters = {}) {
  const period = resolvePeriod({ startDate: filters.startDate || filters.dataInicio, endDate: filters.endDate || filters.dataFim });
  const baseParams = [period.startDate, period.endDate];
  const where = buildWhere(filters, 2);
  const params = [...baseParams, ...where.values];
  const revenueWhere = buildRevenueWhere(filters, 2);
  const revenueParams = [...baseParams, ...revenueWhere.values];
  const limit = Math.min(Math.max(Number(filters.limit) || 250, 20), 800);

  const cte = baseCostCte();

  const [summaryRows, monthlyRows, rankingRows, costVehicleRows, typeRows, supplierRows, statusRows, launchesRows, revenueRows, validationRows, auditOriginRows, auditRows] = await Promise.all([
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
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status ${where.clause} GROUP BY placa_resolvida ORDER BY SUM(valor) DESC LIMIT 1) AS maior_custo_valor,
        (SELECT tipo_custo FROM custos_status ${where.clause} GROUP BY tipo_custo ORDER BY SUM(valor) DESC LIMIT 1) AS maior_categoria,
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status ${where.clause} GROUP BY tipo_custo ORDER BY SUM(valor) DESC LIMIT 1) AS maior_categoria_valor,
        (SELECT fornecedor FROM custos_status ${where.clause} GROUP BY fornecedor ORDER BY SUM(valor) DESC LIMIT 1) AS maior_fornecedor,
        (SELECT COALESCE(SUM(valor), 0) FROM custos_status ${where.clause} GROUP BY fornecedor ORDER BY SUM(valor) DESC LIMIT 1) AS maior_fornecedor_valor
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
        MAX(proprietario_codigo) AS proprietario_codigo,
        MAX(km_atual) AS km_atual,
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
      SELECT
        placa_resolvida AS placa,
        MAX(veiculo_nome) AS veiculo_nome,
        MAX(centro_custo) AS centro_custo,
        MAX(proprietario) AS proprietario,
        MAX(proprietario_codigo) AS proprietario_codigo,
        MAX(km_atual) AS km_atual,
        COALESCE(SUM(valor), 0) AS custo,
        COALESCE(SUM(valor_pago), 0) AS pago,
        COALESCE(SUM(valor_aberto), 0) AS aberto,
        COALESCE(SUM(CASE WHEN situacao = 'vencido' THEN valor_aberto ELSE 0 END), 0) AS vencido,
        COUNT(*)::int AS lancamentos
      FROM custos_status
      ${where.clause}
      GROUP BY placa_resolvida
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
      SELECT
        UPPER(TRIM(con.veiculocon::text)) AS placa,
        MAX(vei.nomevei) AS veiculo_nome,
        MAX(vei.centrocustovei) AS centro_codigo,
        MAX(ccs.nomeccs) AS centro_custo,
        MAX(vei.tipopropriedadevei) AS tipo_propriedade,
        MAX(vei.proprietariovei) AS proprietario_codigo,
        MAX(vei.kmatualvei) AS km_atual,
        COALESCE(SUM(COALESCE(NULLIF(con.totalcon, 0), con.valorfretecon, 0)), 0) AS receita,
        COUNT(*)::int AS conhecimentos,
        COUNT(DISTINCT COALESCE(con.viagemcon, con.numeroviagemcon, con.cargacontroleviagemcon))::int AS viagens,
        MAX(con.dataemissaocon)::date AS ultima_receita
      FROM logistica.conhecimentos con
      LEFT JOIN LATERAL (
        SELECT v.placavei, v.nomevei, v.tipopropriedadevei, v.proprietariovei, v.kmatualvei, v.centrocustovei, v.empresavei
        FROM frotas.veiculos v
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(con.veiculocon::text))
          AND COALESCE(v.situacaovei::text, '') <> 'I'
        ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
        LIMIT 1
      ) vei ON true
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = vei.centrocustovei
       AND (ccs.empresaccs = vei.empresavei OR ccs.empresaccs IS NULL)
      ${revenueWhere.clause}
      GROUP BY UPPER(TRIM(con.veiculocon::text))
    `, revenueParams),
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
    queryCostRows(`
      ${cte}
      SELECT origem, COUNT(*)::int AS registros, COALESCE(SUM(valor), 0) AS total
      FROM custos_status
      ${where.clause}
      GROUP BY origem
      ORDER BY total DESC
    `, params),
    queryCostRows(`
      ${cte}
      SELECT
        COUNT(*)::int AS registros_filtrados,
        COUNT(*) FILTER (WHERE NULLIF(TRIM(placa::text), '') IS NULL)::int AS registros_sem_placa,
        COUNT(*) FILTER (WHERE centro_codigo IS NULL)::int AS registros_sem_centro,
        COUNT(*) FILTER (WHERE centro_custo ILIKE '%admin%' OR centro_custo ILIKE '%escritorio%')::int AS registros_centro_administrativo,
        COUNT(*) FILTER (
          WHERE NULLIF(TRIM(placa::text), '') IS NOT NULL
            AND veiculo_documento IS NOT NULL
            AND UPPER(TRIM(placa::text)) <> UPPER(TRIM(veiculo_documento::text))
        )::int AS possiveis_divergencias_placa
      FROM custos_status
      ${where.clause}
    `, params),
  ]);

  const costMap = new Map();
  for (const row of costVehicleRows) {
    const placaKey = row.placa || "Nao identificado";
    costMap.set(placaKey, {
      placa: placaKey,
      veiculoNome: row.veiculo_nome || "",
      centroCusto: row.centro_custo || "Sem centro de custo",
      proprietario: row.proprietario || "nao_identificado",
      proprietarioCodigo: row.proprietario_codigo,
      kmAtual: num(row.km_atual),
      custo: num(row.custo),
      pago: num(row.pago),
      aberto: num(row.aberto),
      vencido: num(row.vencido),
      lancamentos: num(row.lancamentos),
    });
  }

  const profitMap = new Map(costMap);
  for (const row of revenueRows) {
    const placaKey = row.placa || "Nao identificado";
    const current = profitMap.get(placaKey) || {
      placa: placaKey,
      veiculoNome: row.veiculo_nome || "",
      centroCusto: row.centro_custo || "Sem centro de custo",
      proprietario: row.tipo_propriedade === "T" ? "terceiro" : "frota",
      proprietarioCodigo: row.proprietario_codigo,
      kmAtual: num(row.km_atual),
      custo: 0,
      pago: 0,
      aberto: 0,
      vencido: 0,
      lancamentos: 0,
    };
    current.receita = num(row.receita);
    current.conhecimentos = num(row.conhecimentos);
    current.viagens = num(row.viagens);
    current.ultimaReceita = dateOnly(row.ultima_receita);
    if (!current.veiculoNome) current.veiculoNome = row.veiculo_nome || "";
    if (!current.centroCusto || current.centroCusto === "Sem centro de custo") current.centroCusto = row.centro_custo || current.centroCusto;
    if (!current.kmAtual) current.kmAtual = num(row.km_atual);
    profitMap.set(placaKey, current);
  }

  const profitRows = Array.from(profitMap.values()).map((item) => {
    const receita = num(item.receita);
    const custo = num(item.custo);
    const lucro = receita - custo;
    const margem = receita > 0 ? (lucro / receita) * 100 : (lucro < 0 ? -100 : 0);
    return {
      ...item,
      receita: money(receita),
      custo: money(custo),
      lucro: money(lucro),
      margem: money(margem),
      custoPorKm: item.kmAtual > 0 ? money(custo / item.kmAtual) : 0,
      statusResultado: lucro > 0 ? "lucro" : lucro < 0 ? "prejuizo" : "empate",
      conhecimentos: num(item.conhecimentos),
      viagens: num(item.viagens),
      lancamentos: num(item.lancamentos),
    };
  }).sort((a, b) => b.lucro - a.lucro);

  const totalReceita = money(profitRows.reduce((sum, row) => sum + num(row.receita), 0));
  const totalCustoProfit = money(profitRows.reduce((sum, row) => sum + num(row.custo), 0));
  const totalLucro = money(totalReceita - totalCustoProfit);

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
      proprietarioCodigo: row.proprietario_codigo,
      kmAtual: num(row.km_atual),
      custo: money(row.custo),
      pago: money(row.pago),
      aberto: money(row.aberto),
      custoPorKm: num(row.km_atual) > 0 ? money(row.custo / num(row.km_atual)) : 0,
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
    profit: {
      summary: {
        receitaTotal: totalReceita,
        custoTotal: totalCustoProfit,
        lucroTotal: totalLucro,
        margem: totalReceita > 0 ? money((totalLucro / totalReceita) * 100) : 0,
        veiculos: profitRows.length,
        veiculosLucro: profitRows.filter((row) => row.statusResultado === "lucro").length,
        veiculosPrejuizo: profitRows.filter((row) => row.statusResultado === "prejuizo").length,
      },
      vehicles: profitRows,
      rankings: {
        lucro: [...profitRows].sort((a, b) => b.lucro - a.lucro).slice(0, 15),
        prejuizo: [...profitRows].filter((row) => row.lucro < 0).sort((a, b) => a.lucro - b.lucro).slice(0, 15),
        custoKm: [...profitRows].filter((row) => row.custoPorKm > 0).sort((a, b) => b.custoPorKm - a.custoPorKm).slice(0, 15),
      },
      fontes: {
        receita: "logistica.conhecimentos (statuscon=2, dataemissaocon, totalcon/valorfretecon, placa em veiculocon).",
        custo: "financeiro.pagarrateios + financeiro.pagar, com frotas.abastecimentos sem duplicata financeira.",
      },
    },
    audit: {
      devOnly: true,
      tables: [
        "financeiro.pagar",
        "financeiro.pagarrateios",
        "financeiro.pagarpagamentos",
        "frotas.abastecimentos",
        "frotas.veiculos",
        "logistica.controleviagensdespesas",
        "logistica.despesasviagem",
        "financeiro.centroscustos",
        "financeiro.contasfinanceiras",
        "logistica.conhecimentos",
      ],
      fieldsUsed: {
        proprietarioVeiculo: "frotas.veiculos.proprietariovei",
        tipoFrotaTerceiro: "frotas.veiculos.tipopropriedadevei",
        situacaoVeiculo: "frotas.veiculos.situacaovei",
        centroCustoPlaca: "frotas.veiculos.centrocustovei / financeiro.centroscustos.codigoccs",
      },
      filters: {
        ...filters,
        startDate: period.startDate,
        endDate: period.endDate,
        proprietario: normalizeOwner(filters.proprietario),
      },
      origins: auditOriginRows.map((row) => ({ origem: row.origem, registros: num(row.registros), total: money(row.total) })),
      registrosSemPlaca: num(auditRows[0]?.registros_sem_placa),
      registrosSemCentro: num(auditRows[0]?.registros_sem_centro),
      registrosCentroAdministrativo: num(auditRows[0]?.registros_centro_administrativo),
      possiveisDivergenciasPlaca: num(auditRows[0]?.possiveis_divergencias_placa),
      registrosFiltrados: num(auditRows[0]?.registros_filtrados),
      observacoes: [
        "Padrao frota: registros precisam resolver para veiculo com tipopropriedadevei diferente de 'T'.",
        "Centros administrativos sem placa resolvida ficam fora quando o filtro de proprietario e frota/terceiro.",
        "Receita de lucro por veiculo vem de conhecimentos/CT-e, nao de financeiro.receber.",
      ],
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
        v.proprietariovei AS proprietario_codigo,
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
      proprietarioCodigo: vehicle.proprietario_codigo,
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
