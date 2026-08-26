/*
  Analise de rentabilidade - ESAF / carregamento no presidio
  Periodo: 01/01/2026 a 26/08/2026

  Consulta somente leitura (SELECT).

  Regra importante:
  - Primeiro calcula e rateia os custos usando TODOS os CT-es do periodo.
  - Somente no final limita o resultado aos 57 CT-es classificados na auditoria
    como operacao do presidio. Filtrar ESAF antes do rateio superestima o custo.

  Pontos de auditoria:
  - 4105 foi cancelado/substituido; entra o 4106 autorizado.
  - 4213 e uma cobranca adicional/reentrega e permanece no cenario refinado de
    resultado financeiro. Retire-o de operacao_presidio para analisar apenas
    carregamentos fisicos novos.
  - Custos sem vinculo direto sao rateados por receita da viagem.
  - Manutencao e rateada por placa/mes.
  - Impostos, depreciacao, financiamento e administrativo nao entram aqui.
*/

WITH RECURSIVE
params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-08-26' AS data_fim
),
operacao_presidio (empresacon, seriecon, codigocon) AS (
  VALUES
    (2, '1', 3341), (2, '1', 3342), (2, '1', 3370),
    (2, '1', 3374), (2, '1', 3375),
    (2, '1', 3458), (2, '1', 3459), (2, '1', 3460),
    (2, '1', 3461), (2, '1', 3462), (2, '1', 3463),
    (2, '1', 3508), (2, '1', 3509), (2, '1', 3520),
    (2, '1', 3581), (2, '1', 3582), (2, '1', 3585),
    (2, '1', 3601), (2, '1', 3602), (2, '1', 3619),
    (2, '1', 3620),
    (2, '1', 3632), (2, '1', 3633), (2, '1', 3634),
    (2, '1', 3640), (2, '1', 3641), (2, '1', 3642),
    (2, '1', 3680), (2, '1', 3681), (2, '1', 3709),
    (2, '1', 3710), (2, '1', 3711),
    (2, '1', 3822), (2, '1', 3823), (2, '1', 3824),
    (2, '1', 3825), (2, '1', 3836), (2, '1', 3843),
    (2, '1', 3844), (2, '1', 3845), (2, '1', 3846),
    (2, '1', 3847), (2, '1', 3864), (2, '1', 3890),
    (2, '1', 3891), (2, '1', 3892),
    (2, '1', 4011), (2, '1', 4026), (2, '1', 4053),
    (2, '1', 4059), (2, '1', 4060),
    (2, '1', 4106), (2, '1', 4112), (2, '1', 4113),
    (2, '1', 4114), (2, '1', 4147), (2, '1', 4213)
),
cvf_conhecimento AS (
  SELECT
    cvf.empresaconhecimentocvf AS empresa_con,
    cvf.serieconhecimentocvf AS serie_con,
    cvf.conhecimentocvf AS codigo_con,
    MIN(cvf.codigocvf) AS viagem,
    MAX(NULLIF(TRIM(cvf.veiculocvf::text), '')) AS veiculo_cvf,
    COALESCE(SUM(cvf.valorfretecvf), 0)::numeric AS receita_frete,
    COALESCE(SUM(cvf.valortotalcvf), 0)::numeric AS receita_total_frete,
    COALESCE(SUM(cvf.valorfretemotoristacvf), 0)::numeric AS custo_motorista_frete,
    COALESCE(SUM(cvf.valorfretepesomotoristacvf), 0)::numeric AS custo_motorista_peso,
    COALESCE(SUM(cvf.valorcomissaocvf), 0)::numeric AS custo_comissao_frete
  FROM logistica.controleviagensfretes cvf
  WHERE cvf.conhecimentocvf IS NOT NULL
  GROUP BY
    cvf.empresaconhecimentocvf,
    cvf.serieconhecimentocvf,
    cvf.conhecimentocvf
),
carta_counts AS (
  SELECT empresacfc, seriecfc, codigocfc, COUNT(*)::numeric AS qtd_conhecimentos
  FROM logistica.cartasfretesconhecimentos
  GROUP BY empresacfc, seriecfc, codigocfc
),
carta_custos AS (
  SELECT
    cfc.empresacfc AS empresa_con,
    cfc.serieconhecimentocfc AS serie_con,
    cfc.conhecimentocfc AS codigo_con,
    COALESCE(SUM(
      (
        COALESCE(cfr.valorliquidocfr, cfr.valorfretecfr, 0)
        + COALESCE(cfr.valorpedagiocfr, 0)
        + COALESCE(cfr.valordiariacfr, 0)
        + COALESCE(cfr.valorcombustivelcfr, 0)
        + COALESCE(cfr.totaldespesasacessoriascfr, 0)
      ) / NULLIF(cc.qtd_conhecimentos, 0)
    ), 0)::numeric AS custo_carta_frete
  FROM logistica.cartasfretesconhecimentos cfc
  JOIN logistica.cartasfretes cfr
    ON cfr.empresacfr = cfc.empresacfc
   AND cfr.seriecfr = cfc.seriecfc
   AND cfr.codigocfr = cfc.codigocfc
  JOIN carta_counts cc
    ON cc.empresacfc = cfc.empresacfc
   AND cc.seriecfc = cfc.seriecfc
   AND cc.codigocfc = cfc.codigocfc
  GROUP BY cfc.empresacfc, cfc.serieconhecimentocfc, cfc.conhecimentocfc
),
conhecimentos_base AS (
  SELECT
    con.empresacon,
    con.seriecon,
    con.codigocon,
    COALESCE(con.numeroctecon, con.codigocon) AS numero_cte,
    con.dataemissaocon::date AS data,
    COALESCE(con.viagemcon, cvf.viagem, con.numeroviagemcon, con.cargacontroleviagemcon) AS viagem,
    UPPER(TRIM(COALESCE(NULLIF(con.veiculocon::text, ''), cvf.veiculo_cvf))) AS placa,
    COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0),
             NULLIF(cvf.receita_total_frete, 0), cvf.receita_frete, 0)::numeric AS receita,
    COALESCE(NULLIF(cvf.custo_motorista_frete, 0),
             NULLIF(cvf.custo_motorista_peso, 0),
             NULLIF(cvf.custo_comissao_frete, 0),
             NULLIF(con.viagemvalorfretemotoristacon, 0), 0)::numeric AS custo_motorista_direto,
    COALESCE(carta.custo_carta_frete, 0)::numeric AS custo_carta_frete
  FROM logistica.conhecimentos con
  LEFT JOIN cvf_conhecimento cvf
    ON cvf.empresa_con = con.empresacon
   AND cvf.serie_con = con.seriecon
   AND cvf.codigo_con = con.codigocon
  LEFT JOIN carta_custos carta
    ON carta.empresa_con = con.empresacon
   AND carta.serie_con = con.seriecon
   AND carta.codigo_con = con.codigocon
  CROSS JOIN params p
  WHERE (
      con.statuscon = 2
      OR UPPER(TRIM(con.seriecon)) IN ('O', 'OC')
      OR NULLIF(TRIM(con.chaveorcamentocon), '') IS NOT NULL
    )
    AND con.dataemissaocon::date BETWEEN p.data_inicio AND p.data_fim
),
trip_totals AS (
  SELECT
    viagem,
    COALESCE(SUM(receita), 0)::numeric AS receita_viagem,
    COUNT(*)::numeric AS qtd_ctes
  FROM conhecimentos_base
  WHERE viagem IS NOT NULL
  GROUP BY viagem
),
despesas_viagem AS (
  SELECT codigocvd AS viagem, COALESCE(SUM(valorcvd), 0)::numeric AS despesas
  FROM logistica.controleviagensdespesas
  GROUP BY codigocvd
),
abastecimentos_viagem AS (
  SELECT
    cva.codigocva AS viagem,
    COALESCE(SUM(aba.totalaba), 0)::numeric AS abastecimentos
  FROM logistica.controleviagensabastecimentos cva
  JOIN frotas.abastecimentos aba
    ON aba.empresaaba = cva.empresaabastecimentocva
   AND aba.codigoaba = cva.abastecimentocva
  GROUP BY cva.codigocva
),
custos_viagem AS (
  SELECT
    cvg.codigocvg AS viagem,
    COALESCE(NULLIF(ab.abastecimentos, 0), cvg.totalabastecimentoscvg, 0)::numeric AS abastecimentos,
    COALESCE(NULLIF(dv.despesas, 0), cvg.totaldespesascvg, 0)::numeric AS despesas,
    COALESCE(cvg.totalpedagiocvg, 0)::numeric AS pedagio,
    COALESCE(cvg.totaldiariascvg, 0)::numeric AS diarias,
    COALESCE(cvg.totaldespesasextrascvg, 0)::numeric AS outros,
    COALESCE(cvg.valorcomissaomotoristacvg, cvg.totaldespesasvalorcomissaocvg, 0)::numeric AS motorista_viagem
  FROM logistica.controleviagens cvg
  LEFT JOIN despesas_viagem dv ON dv.viagem = cvg.codigocvg
  LEFT JOIN abastecimentos_viagem ab ON ab.viagem = cvg.codigocvg
),
plate_month_totals AS (
  SELECT
    placa,
    DATE_TRUNC('month', data)::date AS mes,
    COALESCE(SUM(receita), 0)::numeric AS receita_mes,
    COUNT(*)::numeric AS qtd_ctes_mes
  FROM conhecimentos_base
  WHERE NULLIF(placa, '') IS NOT NULL
  GROUP BY placa, DATE_TRUNC('month', data)::date
),
custos_manutencao AS (
  SELECT
    UPPER(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text)) AS placa,
    DATE_TRUNC('month', pag.datavencimentopag::date)::date AS mes,
    COALESCE(SUM(prt.valorrateioprt), 0)::numeric AS manutencao
  FROM financeiro.pagarrateios prt
  JOIN financeiro.pagar pag
    ON pag.empresapag = prt.empresaprt
   AND pag.seriepag = prt.serieprt
   AND pag.duplicatapag = prt.duplicataprt
   AND pag.parcelapag = prt.parcelaprt
   AND pag.fornecedorpag = prt.fornecedorprt
  LEFT JOIN LATERAL (
    SELECT nomecfi
    FROM financeiro.contasfinanceiras c
    WHERE c.codigocfi = prt.contafinanceiraprt
    ORDER BY (c.empresacfi = pag.empresapag) DESC, c.empresacfi
    LIMIT 1
  ) cfi ON true
  LEFT JOIN LATERAL (
    SELECT placavei
    FROM frotas.veiculos v
    WHERE NULLIF(TRIM(pag.veiculopag::text), '') IS NOT NULL
      AND UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(pag.veiculopag::text))
    ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
    LIMIT 1
  ) vei_doc ON true
  LEFT JOIN LATERAL (
    SELECT placavei
    FROM frotas.veiculos v
    WHERE v.centrocustovei = prt.centrocustoprt
      AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
    ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
    LIMIT 1
  ) vei_cc ON true
  CROSS JOIN params p
  WHERE pag.datavencimentopag::date BETWEEN p.data_inicio AND p.data_fim
    AND COALESCE(prt.valorrateioprt, 0) <> 0
    AND (
      COALESCE(cfi.nomecfi, '') ILIKE '%manuten%'
      OR COALESCE(cfi.nomecfi, '') ILIKE '%oficina%'
      OR COALESCE(cfi.nomecfi, '') ILIKE '%reparo%'
      OR COALESCE(cfi.nomecfi, '') ILIKE '%pneu%'
    )
    AND NULLIF(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text), '') IS NOT NULL
  GROUP BY
    UPPER(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text)),
    DATE_TRUNC('month', pag.datavencimentopag::date)::date
),
conhecimento_custos AS (
  SELECT
    cb.*,
    COALESCE(cv.abastecimentos, 0) * CASE
      WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
      ELSE 1 / NULLIF(tt.qtd_ctes, 0)
    END AS custo_abastecimentos,
    COALESCE(cv.despesas, 0) * CASE
      WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
      ELSE 1 / NULLIF(tt.qtd_ctes, 0)
    END AS custo_despesas,
    COALESCE(cv.pedagio, 0) * CASE
      WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
      ELSE 1 / NULLIF(tt.qtd_ctes, 0)
    END AS custo_pedagio,
    COALESCE(cv.diarias, 0) * CASE
      WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
      ELSE 1 / NULLIF(tt.qtd_ctes, 0)
    END AS custo_diarias,
    COALESCE(cv.outros, 0) * CASE
      WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
      ELSE 1 / NULLIF(tt.qtd_ctes, 0)
    END AS custo_outros_viagem,
    CASE
      WHEN COALESCE(cb.custo_motorista_direto, 0) > 0 THEN cb.custo_motorista_direto
      WHEN COALESCE(cb.custo_carta_frete, 0) > 0 THEN cb.custo_carta_frete
      ELSE COALESCE(cv.motorista_viagem, 0) * CASE
        WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem
        ELSE 1 / NULLIF(tt.qtd_ctes, 0)
      END
    END AS custo_motorista,
    COALESCE(cm.manutencao, 0) * CASE
      WHEN pmt.receita_mes > 0 THEN cb.receita / pmt.receita_mes
      ELSE 1 / NULLIF(pmt.qtd_ctes_mes, 0)
    END AS custo_manutencao
  FROM conhecimentos_base cb
  LEFT JOIN trip_totals tt ON tt.viagem = cb.viagem
  LEFT JOIN custos_viagem cv ON cv.viagem = cb.viagem
  LEFT JOIN plate_month_totals pmt
    ON pmt.placa = cb.placa
   AND pmt.mes = DATE_TRUNC('month', cb.data)::date
  LEFT JOIN custos_manutencao cm
    ON cm.placa = cb.placa
   AND cm.mes = DATE_TRUNC('month', cb.data)::date
),
final AS (
  SELECT
    *,
    COALESCE(custo_motorista, 0)
      + COALESCE(custo_abastecimentos, 0)
      + COALESCE(custo_despesas, 0)
      + COALESCE(custo_pedagio, 0)
      + COALESCE(custo_diarias, 0)
      + COALESCE(custo_manutencao, 0)
      + COALESCE(custo_outros_viagem, 0) AS custo_total
  FROM conhecimento_custos
),
esaf_presidio AS (
  SELECT f.*
  FROM final f
  JOIN operacao_presidio op
    ON op.empresacon = f.empresacon
   AND op.seriecon = f.seriecon
   AND op.codigocon = f.codigocon
),
resultado_mensal AS (
  SELECT
    DATE_TRUNC('month', data)::date AS mes,
    COUNT(*)::integer AS qtd_ctes,
    COUNT(DISTINCT viagem)::integer AS qtd_viagens,
    SUM(receita)::numeric AS receita,
    -- Espelha a API: arredonda o custo de cada CT-e antes de consolidar.
    SUM(ROUND(custo_total, 2))::numeric AS custo
  FROM esaf_presidio
  GROUP BY DATE_TRUNC('month', data)::date
),
resultado AS (
  SELECT
    1 AS ordem_tipo,
    mes AS ordem_data,
    'MES'::text AS tipo,
    TO_CHAR(mes, 'YYYY-MM') AS periodo,
    qtd_ctes,
    qtd_viagens,
    receita,
    custo
  FROM resultado_mensal

  UNION ALL

  SELECT
    2 AS ordem_tipo,
    DATE '9999-12-31' AS ordem_data,
    'TOTAL'::text AS tipo,
    '01/01/2026 a 26/08/2026'::text AS periodo,
    COUNT(*)::integer AS qtd_ctes,
    COUNT(DISTINCT viagem)::integer AS qtd_viagens,
    SUM(receita)::numeric AS receita,
    SUM(ROUND(custo_total, 2))::numeric AS custo
  FROM esaf_presidio
)
SELECT
  tipo,
  periodo,
  qtd_ctes,
  qtd_viagens,
  ROUND(receita, 2) AS receita,
  ROUND(custo, 2) AS custo,
  ROUND(receita - custo, 2) AS resultado,
  ROUND(100 * (receita - custo) / NULLIF(receita, 0), 2) AS margem_percentual
FROM resultado
ORDER BY ordem_tipo, ordem_data;

/*
  Para conferir CT-e por CT-e, substitua o SELECT final acima por:

  SELECT
    empresacon, seriecon, codigocon, numero_cte, data, viagem, placa,
    ROUND(receita, 2) AS receita,
    ROUND(custo_total, 2) AS custo,
    ROUND(receita - custo_total, 2) AS resultado
  FROM esaf_presidio
  ORDER BY data, viagem, codigocon;
*/
