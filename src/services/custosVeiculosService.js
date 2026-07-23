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
        pag.duplicatapag::bigint AS duplicatapag,
        pag.parcelapag::text AS parcelapag,
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
        pag.statuspag::text AS statuspag,
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
          WHEN COALESCE(vei_doc.placavei, vei_cc.placavei) IS NULL THEN 'nao_identificado'
          WHEN COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei)::text = 'P' THEN 'frota'
          ELSE 'terceiro'
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
        aba.parcelaaba::text AS parcelapag,
        aba.postocombustivelaba AS fornecedor_codigo,
        ('Posto ' || COALESCE(aba.postocombustivelaba::text, 'nao informado')) AS fornecedor,
        aba.dataaba::date AS data,
        COALESCE(aba.datavencimentoaba, aba.dataaba)::date AS vencimento,
        aba.databaixaaba::date AS data_pagamento,
        COALESCE(aba.totalaba, 0)::numeric AS valor,
        CASE WHEN aba.databaixaaba IS NULL THEN COALESCE(aba.totalaba, 0) ELSE 0 END::numeric AS valor_aberto,
        aba.statusaba::text AS statuspag,
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
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
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
        0::text AS statuspag,
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
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
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
        AND cvd.codigonotafiscalcvd IS NULL
        AND cvd.multacvd IS NULL
        AND NULLIF(TRIM(COALESCE(cvd.chaveduplicatapagarcvd, '')::text), '') IS NULL
    ),
    os_externa_operacional AS (
      SELECT
        ('os-produto:' || i.empresaoep || ':' || i.serieoep || ':' || i.codigooep || ':' || i.fornecedoroep || ':' || i.sequenciaoep) AS id,
        i.empresaoep::int AS empresa,
        i.serieoep AS serie,
        i.codigooep::bigint AS duplicatapag,
        i.sequenciaoep::text AS parcelapag,
        i.fornecedoroep AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS vencimento,
        NULL::date AS data_pagamento,
        COALESCE(i.totalitemoep, 0)::numeric AS valor,
        COALESCE(i.totalitemoep, 0)::numeric AS valor_aberto,
        NULL::text AS statuspag,
        COALESCE(i.centrocustooep, v.centrocustovei)::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        i.contafinanceiraoep::int AS conta_codigo,
        COALESCE(NULLIF(prod.nomepro, ''), 'Produto de OS externa') AS conta_nome,
        NULL::text AS conta_mascara,
        o.observacaoose AS historico,
        o.codigoose::text AS documento,
        COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose) AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
        END AS proprietario,
        CASE
          WHEN COALESCE(prod.nomepro, '') ILIKE '%pneu%' THEN 'Pneus'
          ELSE 'Manutencao'
        END AS tipo_custo,
        'frotas.ordensservicosexternaprodutos'::text AS origem
      FROM frotas.ordensservicosexternaprodutos i
      JOIN frotas.ordensservicosexterna o
        ON o.empresaose = i.empresaoep
       AND o.serieose = i.serieoep
       AND o.codigoose = i.codigooep
       AND o.fornecedorose = i.fornecedoroep
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = i.fornecedoroep
       AND (forn.empresafor = i.empresaoep OR forn.empresafor IS NULL)
      LEFT JOIN estoque.produtos prod
        ON prod.codigopro = i.produtooep
       AND (prod.empresapro = i.empresaoep OR prod.empresapro IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose)::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = COALESCE(i.centrocustooep, v.centrocustovei)
       AND (ccs.empresaccs = i.empresaoep OR ccs.empresaccs IS NULL)
      WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date
        AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
        AND COALESCE(i.totalitemoep, 0) <> 0
        AND COALESCE(i.financeirooep, 'N') <> 'S'
        AND NOT EXISTS (
          SELECT 1
          FROM frotas.ordensservicosexternanotasfiscaisentrada osn
          WHERE osn.empresaosn = i.empresaoep
            AND osn.serieosn = i.serieoep
            AND osn.ordemosn = i.codigooep
            AND osn.fornecedorosn = i.fornecedoroep
        )

      UNION ALL

      SELECT
        ('os-servico:' || i.empresaoes || ':' || i.serieoes || ':' || i.codigooes || ':' || i.fornecedoroes || ':' || i.sequenciaoes) AS id,
        i.empresaoes::int AS empresa,
        i.serieoes AS serie,
        i.codigooes::bigint AS duplicatapag,
        i.sequenciaoes::text AS parcelapag,
        i.fornecedoroes AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS vencimento,
        NULL::date AS data_pagamento,
        COALESCE(i.totalitemoes, 0)::numeric AS valor,
        COALESCE(i.totalitemoes, 0)::numeric AS valor_aberto,
        NULL::text AS statuspag,
        COALESCE(i.centrocustooes, v.centrocustovei)::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        i.contafinanceiraoes::int AS conta_codigo,
        ('Servico ' || COALESCE(i.servicooes::text, '')) AS conta_nome,
        NULL::text AS conta_mascara,
        o.observacaoose AS historico,
        o.codigoose::text AS documento,
        COALESCE(NULLIF(i.veiculooes, ''), o.veiculoose) AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
        END AS proprietario,
        'Manutencao'::text AS tipo_custo,
        'frotas.ordensservicosexternaservicos'::text AS origem
      FROM frotas.ordensservicosexternaservicos i
      JOIN frotas.ordensservicosexterna o
        ON o.empresaose = i.empresaoes
       AND o.serieose = i.serieoes
       AND o.codigoose = i.codigooes
       AND o.fornecedorose = i.fornecedoroes
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = i.fornecedoroes
       AND (forn.empresafor = i.empresaoes OR forn.empresafor IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(NULLIF(i.veiculooes, ''), o.veiculoose)::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = COALESCE(i.centrocustooes, v.centrocustovei)
       AND (ccs.empresaccs = i.empresaoes OR ccs.empresaccs IS NULL)
      WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date >= $1::date
        AND COALESCE(o.dataentradaose, o.dataemissaoose)::date <= $2::date
        AND COALESCE(i.totalitemoes, 0) <> 0
        AND COALESCE(i.financeirooes, 'N') <> 'S'
        AND NOT EXISTS (
          SELECT 1
          FROM frotas.ordensservicosexternanotasfiscaisentrada osn
          WHERE osn.empresaosn = i.empresaoes
            AND osn.serieosn = i.serieoes
            AND osn.ordemosn = i.codigooes
            AND osn.fornecedorosn = i.fornecedoroes
        )
    ),
    nf_entrada_operacional AS (
      SELECT
        ('nf-entrada:' || i.empresanep || ':' || i.serienep || ':' || i.codigonep || ':' || i.fornecedornep || ':' || i.sequencianep) AS id,
        i.empresanep::int AS empresa,
        i.serienep AS serie,
        i.codigonep::bigint AS duplicatapag,
        i.sequencianep::text AS parcelapag,
        i.fornecedornep AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(n.dataentradanfe, n.dataemissaonfe)::date AS data,
        COALESCE(n.dataentradanfe, n.dataemissaonfe)::date AS vencimento,
        NULL::date AS data_pagamento,
        COALESCE(i.totalitemestoquenep, i.totalitemnep, 0)::numeric AS valor,
        COALESCE(i.totalitemestoquenep, i.totalitemnep, 0)::numeric AS valor_aberto,
        n.statusnfe::text AS statuspag,
        COALESCE(i.centrocustonep, v.centrocustovei)::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        i.contafinanceiranep::int AS conta_codigo,
        COALESCE(NULLIF(prod.nomepro, ''), 'Produto NF entrada') AS conta_nome,
        NULL::text AS conta_mascara,
        n.observacaonfe AS historico,
        n.codigonfe::text AS documento,
        COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe) AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
        END AS proprietario,
        CASE
          WHEN TRIM(COALESCE(i.combustivelnep::text, '')) = 'S'
            OR i.postobombacombustivelnep IS NOT NULL
            OR COALESCE(prod.nomepro, '') ILIKE '%diesel%'
            OR COALESCE(prod.nomepro, '') ILIKE '%combust%'
            OR COALESCE(prod.nomepro, '') ILIKE '%lubrific%' THEN 'Abastecimento'
          WHEN COALESCE(prod.nomepro, '') ILIKE '%pneu%' THEN 'Pneus'
          ELSE 'Manutencao'
        END AS tipo_custo,
        'compras.notasfiscaisentradaprodutos'::text AS origem
      FROM compras.notasfiscaisentradaprodutos i
      JOIN compras.notasfiscaisentrada n
        ON n.empresanfe = i.empresanep
       AND n.serienfe = i.serienep
       AND n.codigonfe = i.codigonep
       AND n.fornecedornfe = i.fornecedornep
      LEFT JOIN estoque.produtos prod
        ON prod.codigopro = i.produtonep
       AND (prod.empresapro = i.empresanep OR prod.empresapro IS NULL)
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = i.fornecedornep
       AND (forn.empresafor = i.empresanep OR forn.empresafor IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = COALESCE(i.centrocustonep, v.centrocustovei)
       AND (ccs.empresaccs = i.empresanep OR ccs.empresaccs IS NULL)
      WHERE COALESCE(n.dataentradanfe, n.dataemissaonfe)::date >= $1::date
        AND COALESCE(n.dataentradanfe, n.dataemissaonfe)::date <= $2::date
        AND COALESCE(i.totalitemestoquenep, i.totalitemnep, 0) <> 0
        AND NULLIF(TRIM(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM frotas.ordensservicosexternanotasfiscaisentrada osn
          WHERE osn.empresaosn = i.empresanep
            AND osn.serienotafiscalosn = i.serienep
            AND osn.notafiscalosn = i.codigonep
            AND osn.fornecedornotaosn = i.fornecedornep
        )
        AND NOT EXISTS (
          SELECT 1
          FROM financeiro.pagar pag
          WHERE pag.fornecedorpag = i.fornecedornep
            AND pag.duplicatapag = i.codigonep
            AND pag.datavencimentopag::date >= ($1::date - INTERVAL '90 days')
            AND pag.datavencimentopag::date <= ($2::date + INTERVAL '90 days')
        )
    ),
    multas_operacionais AS (
      SELECT
        ('multa:' || m.empresamtr || ':' || m.codigomtr) AS id,
        m.empresamtr::int AS empresa,
        m.serieduplicatamtr AS serie,
        m.sequenciaduplicatamtr::bigint AS duplicatapag,
        m.parceladuplicatamtr::text AS parcelapag,
        m.fornecedorduplicatamtr AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date AS data,
        COALESCE(m.datavencimentoboletomtr, m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date AS vencimento,
        m.datapagamentomtr::date AS data_pagamento,
        (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0))::numeric AS valor,
        CASE WHEN m.datapagamentomtr IS NULL THEN (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) ELSE 0 END::numeric AS valor_aberto,
        m.statusmtr::text AS statuspag,
        v.centrocustovei::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        NULL::int AS conta_codigo,
        'Multa de transito'::text AS conta_nome,
        NULL::text AS conta_mascara,
        m.observacaomtr AS historico,
        COALESCE(m.numeroautomtr, m.codigomtr::text) AS documento,
        m.veiculomtr AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
        END AS proprietario,
        'Multas'::text AS tipo_custo,
        'frotas.multastransito'::text AS origem
      FROM frotas.multastransito m
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = m.fornecedorduplicatamtr
       AND (forn.empresafor = m.empresamtr OR forn.empresafor IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(m.veiculomtr::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = v.centrocustovei
       AND (ccs.empresaccs = v.empresavei OR ccs.empresaccs IS NULL)
      WHERE COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date >= $1::date
        AND COALESCE(m.dataentradamtr, m.dataemissaomtr, m.datainfracaomtr)::date <= $2::date
        AND (COALESCE(m.valormtr, 0) - COALESCE(m.valordescontomtr, 0) + COALESCE(m.valorjurosmtr, 0)) <> 0
        AND NOT COALESCE(m.pagafinanceiromtr, false)
    ),
    pneus_operacionais AS (
      SELECT
        ('pneu:' || p.empresampn || ':' || p.codigompn) AS id,
        p.empresampn::int AS empresa,
        NULL::varchar AS serie,
        p.codigompn::bigint AS duplicatapag,
        NULL::varchar AS parcelapag,
        p.fornecedormpn AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        p.datampn::date AS data,
        p.datampn::date AS vencimento,
        p.datampn::date AS data_pagamento,
        COALESCE(p.valormpn, 0)::numeric AS valor,
        0::numeric AS valor_aberto,
        0::text AS statuspag,
        v.centrocustovei::int AS centro_codigo,
        COALESCE(ccs.nomeccs, 'Sem centro de custo') AS centro_custo,
        NULL::int AS conta_codigo,
        COALESCE(NULLIF(pne.nomepne, ''), 'Movimentacao de pneu') AS conta_nome,
        NULL::text AS conta_mascara,
        p.observacaompn AS historico,
        p.codigompn::text AS documento,
        p.veiculompn AS veiculo_documento,
        v.placavei AS placa,
        v.nomevei AS veiculo_nome,
        v.tipopropriedadevei AS tipo_propriedade,
        v.proprietariovei AS proprietario_codigo,
        v.kmatualvei AS km_atual,
        v.centrocustovei::int AS centro_veiculo,
        CASE
          WHEN v.placavei IS NULL THEN 'nao_identificado'
          WHEN v.tipopropriedadevei::text = 'P' THEN 'frota'
          ELSE 'terceiro'
        END AS proprietario,
        'Pneus'::text AS tipo_custo,
        'frotas.movimentacaopneus'::text AS origem
      FROM frotas.movimentacaopneus p
      LEFT JOIN frotas.pneus pne
        ON pne.codigopne = p.pneumpn
       AND (pne.empresapne = p.empresampn OR pne.empresapne IS NULL)
      LEFT JOIN gerais.fornecedores forn
        ON forn.codigofor = p.fornecedormpn
       AND (forn.empresafor = p.empresampn OR forn.empresafor IS NULL)
      LEFT JOIN frotas.veiculos v
        ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(p.veiculompn::text))
       AND COALESCE(v.situacaovei::text, '') <> 'I'
      LEFT JOIN financeiro.centroscustos ccs
        ON ccs.codigoccs = v.centrocustovei
       AND (ccs.empresaccs = v.empresavei OR ccs.empresaccs IS NULL)
      WHERE p.datampn::date >= $1::date
        AND p.datampn::date <= $2::date
        AND COALESCE(p.valormpn, 0) <> 0
    ),
    custos_base AS (
      SELECT * FROM rateios
      UNION ALL
      SELECT * FROM abastecimentos_operacionais
      UNION ALL
      SELECT * FROM despesas_viagem_operacionais
      UNION ALL
      SELECT * FROM os_externa_operacional
      UNION ALL
      SELECT * FROM nf_entrada_operacional
      UNION ALL
      SELECT * FROM multas_operacionais
      UNION ALL
      SELECT * FROM pneus_operacionais
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
  if (filters.modelo) {
    values.push(`%${normalizeText(filters.modelo)}%`);
    where.push(`EXISTS (
      SELECT 1
      FROM frotas.veiculos fv
      WHERE UPPER(TRIM(fv.placavei::text)) = UPPER(TRIM(placa_resolvida::text))
        AND COALESCE(fv.situacaovei::text, '') <> 'I'
        AND COALESCE(fv.modelovei::text, fv.marcamodelorenavamvei::text, '') ILIKE $${i}
    )`);
    i += 1;
  }
  if (filters.marca) {
    values.push(`%${normalizeText(filters.marca)}%`);
    where.push(`EXISTS (
      SELECT 1
      FROM frotas.veiculos fv
      LEFT JOIN frotas.marcas fm
        ON fm.codigomar = fv.marcavei
       AND (fm.empresamar = fv.empresavei OR fm.empresamar IS NULL)
      WHERE UPPER(TRIM(fv.placavei::text)) = UPPER(TRIM(placa_resolvida::text))
        AND COALESCE(fv.situacaovei::text, '') <> 'I'
        AND COALESCE(fm.nomemar::text, fv.marcavei::text, '') ILIKE $${i}
    )`);
    i += 1;
  }
  if (filters.ano) {
    values.push(String(filters.ano).trim());
    where.push(`EXISTS (
      SELECT 1
      FROM frotas.veiculos fv
      WHERE UPPER(TRIM(fv.placavei::text)) = UPPER(TRIM(placa_resolvida::text))
        AND COALESCE(fv.situacaovei::text, '') <> 'I'
        AND fv.anomodelovei::text = $${i}
    )`);
    i += 1;
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
  if (filters.modelo) {
    values.push(`%${normalizeText(filters.modelo)}%`);
    where.push(`COALESCE(vei.modelovei::text, vei.marcamodelorenavamvei::text, '') ILIKE $${i}`);
    i += 1;
  }
  if (filters.marca) {
    values.push(`%${normalizeText(filters.marca)}%`);
    where.push(`COALESCE(vei.marca_nome::text, vei.marcavei::text, '') ILIKE $${i}`);
    i += 1;
  }
  if (filters.ano) {
    values.push(String(filters.ano).trim());
    where.push(`vei.anomodelovei::text = $${i}`);
    i += 1;
  }

  const owner = normalizeOwner(filters.proprietario);
  if (owner === "frota") {
    where.push("vei.placavei IS NOT NULL AND vei.tipopropriedadevei::text = 'P'");
  } else if (owner === "terceiro") {
    where.push("COALESCE(vei.tipopropriedadevei::text, 'T') <> 'P'");
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
  if (process.env.DEBUG_SQL === "1") {
    console.log("[custos-veiculos] sql", {
      params,
      rows: rows.length,
      sql: String(sql || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    });
  }
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

  const [summaryRows, monthlyRows, revenueMonthlyRows, rankingRows, costVehicleRows, typeRows, supplierRows, statusRows, launchesRows, revenueRows, validationRows, auditOriginRows, auditRows, auditExtraRows] = await Promise.all([
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
      SELECT
        TO_CHAR(DATE_TRUNC('month', con.dataemissaocon), 'YYYY-MM') AS mes,
        COALESCE(SUM(COALESCE(NULLIF(con.totalcon, 0), con.valorfretecon, 0)), 0) AS receita
      FROM logistica.conhecimentos con
      LEFT JOIN LATERAL (
      SELECT v.placavei, v.tipopropriedadevei, v.empresavei
             , v.modelovei, v.marcamodelorenavamvei, v.marcavei, v.anomodelovei, m.nomemar AS marca_nome
        FROM frotas.veiculos v
        LEFT JOIN frotas.marcas m
          ON m.codigomar = v.marcavei
         AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
        WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(con.veiculocon::text))
          AND COALESCE(v.situacaovei::text, '') <> 'I'
        ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
        LIMIT 1
      ) vei ON true
      ${revenueWhere.clause}
      GROUP BY DATE_TRUNC('month', con.dataemissaocon), TO_CHAR(DATE_TRUNC('month', con.dataemissaocon), 'YYYY-MM')
      ORDER BY DATE_TRUNC('month', con.dataemissaocon)
    `, revenueParams),
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
    // Origem da receita por placa: logistica.conhecimentos (CT-e emitidos), status=2 = ativo, valor = totalcon ou valorfretecon.
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
        SELECT
          v.placavei,
          v.nomevei,
          v.tipopropriedadevei,
          v.proprietariovei,
          v.kmatualvei,
          v.centrocustovei,
          v.empresavei,
          v.modelovei,
          v.marcamodelorenavamvei,
          v.marcavei,
          v.anomodelovei,
          m.nomemar AS marca_nome
        FROM frotas.veiculos v
        LEFT JOIN frotas.marcas m
          ON m.codigomar = v.marcavei
         AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
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
    queryCostRows(`
      SELECT
        (SELECT COUNT(*)::int FROM logistica.conhecimentos con
          WHERE con.statuscon = 2
            AND con.dataemissaocon::date >= $1::date AND con.dataemissaocon::date <= $2::date
            AND NULLIF(TRIM(con.veiculocon::text), '') IS NULL) AS receitas_sem_veiculo,
        (SELECT COUNT(*)::int FROM frotas.abastecimentos aba
          WHERE aba.dataaba::date >= $1::date AND aba.dataaba::date <= $2::date
            AND COALESCE(aba.totalaba, 0) <> 0
            AND aba.duplicatageradaaba IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM financeiro.pagar pag
              WHERE pag.empresapag = COALESCE(aba.empresaaba, pag.empresapag)
                AND pag.seriepag = COALESCE(aba.seriegeradaaba, aba.serieaba, pag.seriepag)
                AND pag.duplicatapag = COALESCE(aba.duplicatageradaaba, aba.duplicataaba)
            )) AS abastecimentos_ja_no_financeiro,
        (SELECT COUNT(*)::int FROM frotas.abastecimentos aba
          WHERE aba.dataaba::date >= $1::date AND aba.dataaba::date <= $2::date
            AND COALESCE(aba.diferencakilometragemaba, 0) = 0) AS abastecimentos_sem_km
    `, [period.startDate, period.endDate]),
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
      proprietario: row.tipo_propriedade === "P" ? "frota" : "terceiro",
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
    // receita vem de logistica.conhecimentos (CT-e); sem receita no periodo + custo > 0 = prejuizo de -100%.
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

  const revenueByMonth = new Map(revenueMonthlyRows.map((row) => [row.mes, num(row.receita)]));
  const monthly = monthlyRows.map((row) => {
    const receita = revenueByMonth.get(row.mes) || 0;
    const custo = num(row.custo);
    return {
      mes: row.mes,
      label: monthLabel(row.mes),
      custo: money(custo),
      pago: money(row.pago),
      aberto: money(row.aberto),
      vencido: money(row.vencido),
      receita: money(receita),
      lucro: money(receita - custo),
    };
  });
  for (const [mes, receita] of revenueByMonth) {
    if (!monthly.some((item) => item.mes === mes)) {
      monthly.push({ mes, label: monthLabel(mes), custo: 0, pago: 0, aberto: 0, vencido: 0, receita: money(receita), lucro: money(receita) });
    }
  }
  monthly.sort((a, b) => String(a.mes).localeCompare(String(b.mes)));

  return {
    period,
    summary: mapSummary(summaryRows[0]),
    monthly,
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
        // mesma regra usada por veiculo (linha ~1172): sem receita no periodo mas com custo = prejuizo de -100%, nao 0,00.
        margem: totalReceita > 0 ? money((totalLucro / totalReceita) * 100) : (totalLucro < 0 ? -100 : 0),
        veiculos: profitRows.length,
        veiculosLucro: profitRows.filter((row) => row.statusResultado === "lucro").length,
        veiculosPrejuizo: profitRows.filter((row) => row.statusResultado === "prejuizo").length,
        veiculosCustoSemReceita: profitRows.filter((row) => row.custo > 0 && row.receita === 0).length,
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
      receitasSemVeiculo: num(auditExtraRows[0]?.receitas_sem_veiculo),
      abastecimentosJaNoFinanceiro: num(auditExtraRows[0]?.abastecimentos_ja_no_financeiro),
      abastecimentosSemKm: num(auditExtraRows[0]?.abastecimentos_sem_km),
      observacoes: [
        "Padrao frota: registros precisam resolver para veiculo com tipopropriedadevei = 'P'; NULL e demais valores sao terceiro.",
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

export async function getAuditoriaCustosVeiculos(filters = {}) {
  const period = resolvePeriod({
    startDate: filters.startDate || filters.dataInicio,
    endDate: filters.endDate || filters.dataFim,
  });
  const params = [period.startDate, period.endDate];

  const [nfRows, cteRows, financeiroRows, amostrasRows] = await Promise.all([
    queryCostRows(
      `
      WITH own AS (
        SELECT UPPER(TRIM(placavei::text)) placa, centrocustovei
        FROM frotas.veiculos
        WHERE COALESCE(situacaovei::text,'') <> 'I'
      ),
      centers AS (
        SELECT centrocustovei, COUNT(*) qtd, MIN(placa) placa_unica
        FROM own
        WHERE centrocustovei IS NOT NULL
        GROUP BY centrocustovei
      ),
      nf AS (
        SELECT i.empresanep, i.serienep, i.codigonep, i.fornecedornep, i.sequencianep,
          UPPER(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text)) placa_nf,
          COALESCE(i.totalitemestoquenep, i.totalitemnep,0)::numeric valor_nf
        FROM compras.notasfiscaisentradaprodutos i
        JOIN compras.notasfiscaisentrada n
          ON n.empresanfe=i.empresanep
         AND n.serienfe=i.serienep
         AND n.codigonfe=i.codigonep
         AND n.fornecedornfe=i.fornecedornep
        JOIN own ov
          ON ov.placa=UPPER(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text))
        WHERE COALESCE(n.dataentradanfe,n.dataemissaonfe)::date BETWEEN $1::date AND $2::date
          AND COALESCE(i.totalitemestoquenep, i.totalitemnep,0) <> 0
      ),
      match AS (
        SELECT nf.*, pag.empresapag, pag.veiculopag, prt.centrocustoprt, prt.valorrateioprt,
          COALESCE(NULLIF(UPPER(TRIM(pag.veiculopag::text)),''), CASE WHEN c.qtd=1 THEN c.placa_unica END) placa_pagar_resolvida
        FROM nf
        LEFT JOIN financeiro.pagar pag
          ON pag.fornecedorpag=nf.fornecedornep
         AND pag.duplicatapag=nf.codigonep
         AND pag.datavencimentopag::date BETWEEN ($1::date - INTERVAL '90 days') AND ($2::date + INTERVAL '90 days')
        LEFT JOIN financeiro.pagarrateios prt
          ON pag.empresapag=prt.empresaprt
         AND pag.seriepag=prt.serieprt
         AND pag.duplicatapag=prt.duplicataprt
         AND pag.parcelapag=prt.parcelaprt
         AND pag.fornecedorpag=prt.fornecedorprt
        LEFT JOIN centers c
          ON c.centrocustovei=prt.centrocustoprt
      )
      SELECT CASE
          WHEN empresapag IS NULL THEN 'sem_pagar'
          WHEN placa_pagar_resolvida IS NULL THEN 'pagar_sem_placa_resolvida'
          WHEN placa_pagar_resolvida = placa_nf THEN 'pagar_mesma_placa_nf'
          ELSE 'pagar_placa_diferente_nf'
        END AS situacao,
        COUNT(*)::int AS linhas,
        COUNT(DISTINCT (empresanep, serienep, codigonep, fornecedornep, sequencianep))::int AS itens,
        COALESCE(SUM(valor_nf),0) AS valor_nf,
        COALESCE(SUM(COALESCE(valorrateioprt,0)),0) AS valor_rateio
      FROM match
      GROUP BY 1
      ORDER BY valor_nf DESC
      `,
      params,
    ),
    queryCostRows(
      `
      WITH cvf AS (
        SELECT empresaconhecimentocvf empresa, serieconhecimentocvf serie, conhecimentocvf codigo,
          COUNT(*)::int linhas_cvf,
          COUNT(DISTINCT NULLIF(UPPER(TRIM(veiculocvf::text)),''))::int placas_cvf,
          SUM(COALESCE(valortotalcvf, valorfretecvf, 0))::numeric valor_cvf
        FROM logistica.controleviagensfretes
        WHERE conhecimentocvf IS NOT NULL
        GROUP BY 1,2,3
      )
      SELECT CASE
          WHEN NULLIF(TRIM(con.veiculocon::text),'') IS NULL THEN 'cte_sem_placa'
          WHEN cvf.placas_cvf > 1 THEN 'cte_cvf_multiplas_placas'
          WHEN cvf.codigo IS NULL THEN 'cte_sem_cvf'
          WHEN ABS(COALESCE(NULLIF(con.totalcon,0), con.valorfretecon,0) - COALESCE(cvf.valor_cvf,0)) > 1 THEN 'cte_cvf_valor_diferente'
          ELSE 'cte_ok'
        END AS situacao,
        COUNT(*)::int AS ctes,
        COALESCE(SUM(COALESCE(NULLIF(con.totalcon,0), con.valorfretecon,0)),0) AS receita_cte,
        COALESCE(SUM(COALESCE(cvf.valor_cvf,0)),0) AS valor_cvf
      FROM logistica.conhecimentos con
      LEFT JOIN cvf
        ON cvf.empresa=con.empresacon
       AND cvf.serie=con.seriecon
       AND cvf.codigo=con.codigocon
      WHERE con.statuscon=2
        AND con.dataemissaocon::date BETWEEN $1::date AND $2::date
      GROUP BY 1
      ORDER BY receita_cte DESC
      `,
      params,
    ),
    queryCostRows(
      `
      WITH own AS (
        SELECT UPPER(TRIM(placavei::text)) placa, centrocustovei
        FROM frotas.veiculos
        WHERE COALESCE(situacaovei::text, '') <> 'I'
      ),
      centers AS (
        SELECT centrocustovei, COUNT(*) qtd
        FROM own
        WHERE centrocustovei IS NOT NULL
        GROUP BY centrocustovei
      ),
      base AS (
        SELECT prt.valorrateioprt::numeric AS valor, pag.veiculopag, od.placa AS match_doc, c.qtd AS centro_qtd
        FROM financeiro.pagarrateios prt
        JOIN financeiro.pagar pag
          ON pag.empresapag=prt.empresaprt
         AND pag.seriepag=prt.serieprt
         AND pag.duplicatapag=prt.duplicataprt
         AND pag.parcelapag=prt.parcelaprt
         AND pag.fornecedorpag=prt.fornecedorprt
        LEFT JOIN own od
          ON od.placa = UPPER(TRIM(pag.veiculopag::text))
        LEFT JOIN centers c
          ON c.centrocustovei = prt.centrocustoprt
        WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
          AND COALESCE(prt.valorrateioprt,0) <> 0
      )
      SELECT CASE
          WHEN match_doc IS NOT NULL THEN 'placa_no_pagar_propria'
          WHEN NULLIF(TRIM(veiculopag::text),'') IS NOT NULL AND match_doc IS NULL THEN 'placa_no_pagar_nao_encontrada_ou_terceiro'
          WHEN centro_qtd = 1 THEN 'sem_placa_pagar_centro_unico'
          WHEN centro_qtd > 1 THEN 'sem_placa_pagar_centro_ambiguo'
          ELSE 'sem_placa_pagar_sem_centro_veiculo'
        END AS situacao,
        COUNT(*)::int AS lancamentos,
        COALESCE(SUM(valor),0) AS valor
      FROM base
      GROUP BY 1
      ORDER BY valor DESC
      `,
      params,
    ),
    queryCostRows(
      `
      WITH own AS (
        SELECT UPPER(TRIM(placavei::text)) placa, centrocustovei
        FROM frotas.veiculos
        WHERE COALESCE(situacaovei::text,'') <> 'I'
      ),
      centers AS (
        SELECT centrocustovei, COUNT(*) qtd, MIN(placa) placa_unica
        FROM own
        WHERE centrocustovei IS NOT NULL
        GROUP BY centrocustovei
      ),
      nf AS (
        SELECT i.empresanep, i.serienep, i.codigonep, i.fornecedornep, i.sequencianep,
          COALESCE(n.dataentradanfe,n.dataemissaonfe)::date AS data_nf,
          UPPER(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text)) placa_nf,
          COALESCE(i.totalitemestoquenep, i.totalitemnep,0)::numeric valor_nf
        FROM compras.notasfiscaisentradaprodutos i
        JOIN compras.notasfiscaisentrada n
          ON n.empresanfe=i.empresanep
         AND n.serienfe=i.serienep
         AND n.codigonfe=i.codigonep
         AND n.fornecedornfe=i.fornecedornep
        JOIN own ov
          ON ov.placa=UPPER(TRIM(COALESCE(NULLIF(i.veiculonep,''), n.veiculonfe)::text))
        WHERE COALESCE(n.dataentradanfe,n.dataemissaonfe)::date BETWEEN $1::date AND $2::date
          AND COALESCE(i.totalitemestoquenep, i.totalitemnep,0) <> 0
      )
      SELECT nf.data_nf, nf.placa_nf, nf.empresanep, nf.serienep, nf.codigonep, nf.fornecedornep, nf.sequencianep,
        nf.valor_nf, pag.veiculopag, prt.centrocustoprt, c.placa_unica AS placa_rateio, prt.valorrateioprt AS valor_rateio
      FROM nf
      LEFT JOIN financeiro.pagar pag
        ON pag.fornecedorpag=nf.fornecedornep
       AND pag.duplicatapag=nf.codigonep
       AND pag.datavencimentopag::date BETWEEN ($1::date - INTERVAL '90 days') AND ($2::date + INTERVAL '90 days')
      LEFT JOIN financeiro.pagarrateios prt
        ON pag.empresapag=prt.empresaprt
       AND pag.seriepag=prt.serieprt
       AND pag.duplicatapag=prt.duplicataprt
       AND pag.parcelapag=prt.parcelaprt
       AND pag.fornecedorpag=prt.fornecedorprt
      LEFT JOIN centers c
        ON c.centrocustovei=prt.centrocustoprt
      WHERE COALESCE(NULLIF(UPPER(TRIM(pag.veiculopag::text)),''), CASE WHEN c.qtd=1 THEN c.placa_unica END) IS DISTINCT FROM nf.placa_nf
      ORDER BY nf.valor_nf DESC
      LIMIT 20
      `,
      params,
    ),
  ]);

  const nfDivergente = nfRows.find((row) => row.situacao === "pagar_placa_diferente_nf");
  const nfSemPlaca = nfRows.find((row) => row.situacao === "pagar_sem_placa_resolvida");
  const cteSemPlaca = cteRows.find((row) => row.situacao === "cte_sem_placa");
  const cteMultiPlaca = cteRows.find((row) => row.situacao === "cte_cvf_multiplas_placas");
  const centroAmbiguo = financeiroRows.find((row) => row.situacao === "sem_placa_pagar_centro_ambiguo");

  return {
    periodo: period,
    resumo: {
      nfPlacaDiferente: {
        itens: num(nfDivergente?.itens),
        valorNf: money(nfDivergente?.valor_nf),
        valorRateio: money(nfDivergente?.valor_rateio),
      },
      nfSemPlacaResolvida: {
        itens: num(nfSemPlaca?.itens),
        valorNf: money(nfSemPlaca?.valor_nf),
        valorRateio: money(nfSemPlaca?.valor_rateio),
      },
      cteSemPlaca: {
        ctes: num(cteSemPlaca?.ctes),
        receita: money(cteSemPlaca?.receita_cte),
      },
      cteMultiplasPlacas: {
        ctes: num(cteMultiPlaca?.ctes),
        receita: money(cteMultiPlaca?.receita_cte),
      },
      financeiroCentroAmbiguo: {
        lancamentos: num(centroAmbiguo?.lancamentos),
        valor: money(centroAmbiguo?.valor),
      },
    },
    notasFiscais: nfRows.map((row) => ({
      situacao: row.situacao,
      linhas: num(row.linhas),
      itens: num(row.itens),
      valorNf: money(row.valor_nf),
      valorRateio: money(row.valor_rateio),
    })),
    ctes: cteRows.map((row) => ({
      situacao: row.situacao,
      ctes: num(row.ctes),
      receitaCte: money(row.receita_cte),
      valorCvf: money(row.valor_cvf),
    })),
    financeiro: financeiroRows.map((row) => ({
      situacao: row.situacao,
      lancamentos: num(row.lancamentos),
      valor: money(row.valor),
    })),
    amostras: amostrasRows.map((row) => ({
      data: dateOnly(row.data_nf),
      placaNf: row.placa_nf,
      empresa: row.empresanep,
      serie: row.serienep,
      nota: row.codigonep,
      fornecedor: row.fornecedornep,
      item: row.sequencianep,
      valorNf: money(row.valor_nf),
      placaPagar: row.veiculopag || "",
      centroCusto: row.centrocustoprt,
      placaRateio: row.placa_rateio || "",
      valorRateio: money(row.valor_rateio),
    })),
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
      proprietario: vehicle.tipo_propriedade === "P" ? "frota" : "terceiro",
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
