-- Consultas de conferencia para comparar telas x banco.
-- Ajuste as datas no CTE params antes de rodar.
-- Regra aplicada: frotas.veiculos.tipopropriedadevei = 'P' => Frota; T/NULL/outros => Terceiro.

WITH params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-01-31' AS data_fim
)
SELECT
  CASE WHEN v.tipopropriedadevei::text = 'P' THEN 'Frota' ELSE 'Terceiro' END AS tipo_veiculo,
  COUNT(*) AS veiculos
FROM frotas.veiculos v
WHERE COALESCE(v.situacaovei::text, '') <> 'I'
GROUP BY 1
ORDER BY 1;

WITH params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-01-31' AS data_fim
)
SELECT
  con.dataemissaocon::date AS data,
  CASE WHEN v.tipopropriedadevei::text = 'P' THEN 'Frota' ELSE 'Terceiro' END AS tipo_veiculo,
  COUNT(*) AS documentos,
  COUNT(DISTINCT COALESCE(con.viagemcon, con.numeroviagemcon, con.cargacontroleviagemcon)) AS viagens,
  SUM(COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), 0)) AS faturamento
FROM logistica.conhecimentos con
CROSS JOIN params p
LEFT JOIN LATERAL (
  SELECT tipopropriedadevei
  FROM frotas.veiculos v
  WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(con.veiculocon::text))
    AND COALESCE(v.situacaovei::text, '') <> 'I'
  ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
  LIMIT 1
) v ON true
WHERE con.statuscon = 2
  AND con.dataemissaocon::date BETWEEN p.data_inicio AND p.data_fim
GROUP BY 1, 2
ORDER BY 1, 2;

WITH params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-01-31' AS data_fim
),
receita_viagem AS (
  SELECT
    COALESCE(con.viagemcon, cvf.codigocvf, con.numeroviagemcon, con.cargacontroleviagemcon) AS viagem,
    MIN(con.dataemissaocon::date) AS data,
    SUM(COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), NULLIF(cvf.valortotalcvf, 0), cvf.valorfretecvf, 0)) AS receita
  FROM logistica.conhecimentos con
  LEFT JOIN logistica.controleviagensfretes cvf
    ON cvf.empresaconhecimentocvf = con.empresacon
   AND cvf.serieconhecimentocvf = con.seriecon
   AND cvf.conhecimentocvf = con.codigocon
  CROSS JOIN params p
  WHERE con.statuscon = 2
    AND con.dataemissaocon::date BETWEEN p.data_inicio AND p.data_fim
  GROUP BY COALESCE(con.viagemcon, cvf.codigocvf, con.numeroviagemcon, con.cargacontroleviagemcon)
),
despesas AS (
  SELECT codigocvd AS viagem, SUM(valorcvd) AS valor
  FROM logistica.controleviagensdespesas
  GROUP BY codigocvd
),
abastecimentos AS (
  SELECT cva.codigocva AS viagem, SUM(aba.totalaba) AS valor
  FROM logistica.controleviagensabastecimentos cva
  JOIN frotas.abastecimentos aba
    ON aba.empresaaba = cva.empresaabastecimentocva
   AND aba.codigoaba = cva.abastecimentocva
  GROUP BY cva.codigocva
)
SELECT
  rv.viagem,
  rv.data,
  rv.receita,
  COALESCE(cv.totaldespesascvg, d.valor, 0)
    + COALESCE(cv.totalabastecimentoscvg, a.valor, 0)
    + COALESCE(cv.totalpedagiocvg, 0)
    + COALESCE(cv.totaldiariascvg, 0)
    + COALESCE(cv.valorcomissaomotoristacvg, cv.totaldespesasvalorcomissaocvg, 0) AS custo_operacional_minimo,
  rv.receita - (
    COALESCE(cv.totaldespesascvg, d.valor, 0)
    + COALESCE(cv.totalabastecimentoscvg, a.valor, 0)
    + COALESCE(cv.totalpedagiocvg, 0)
    + COALESCE(cv.totaldiariascvg, 0)
    + COALESCE(cv.valorcomissaomotoristacvg, cv.totaldespesasvalorcomissaocvg, 0)
  ) AS lucro_minimo
FROM receita_viagem rv
LEFT JOIN logistica.controleviagens cv ON cv.codigocvg = rv.viagem
LEFT JOIN despesas d ON d.viagem = rv.viagem
LEFT JOIN abastecimentos a ON a.viagem = rv.viagem
ORDER BY rv.data DESC, rv.viagem DESC
LIMIT 100;

WITH params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-01-31' AS data_fim
)
SELECT
  CASE
    WHEN con.tomadorservicoctecon = 4 AND con.tomadorservicooutroscon IS NOT NULL THEN con.tomadorservicooutroscon
    WHEN con.tomadorservicoctecon = 3 AND con.destinatariocon IS NOT NULL THEN con.destinatariocon
    WHEN con.tomadorservicoctecon = 2 AND con.recebedorcon IS NOT NULL THEN con.recebedorcon
    WHEN con.tomadorservicoctecon = 1 AND con.expedidorcon IS NOT NULL THEN con.expedidorcon
    ELSE con.clientecon
  END AS cliente_pagador,
  COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Sem identificacao') AS cliente,
  COUNT(*) AS documentos,
  COUNT(DISTINCT COALESCE(con.viagemcon, con.numeroviagemcon, con.cargacontroleviagemcon)) AS viagens,
  SUM(COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), 0)) AS faturamento,
  MAX(con.dataemissaocon::date) AS ultima_viagem
FROM logistica.conhecimentos con
CROSS JOIN params p
LEFT JOIN LATERAL (
  SELECT nomecli, fantasiacli
  FROM gerais.clientes cli
  WHERE cli.codigocli = CASE
    WHEN con.tomadorservicoctecon = 4 AND con.tomadorservicooutroscon IS NOT NULL THEN con.tomadorservicooutroscon
    WHEN con.tomadorservicoctecon = 3 AND con.destinatariocon IS NOT NULL THEN con.destinatariocon
    WHEN con.tomadorservicoctecon = 2 AND con.recebedorcon IS NOT NULL THEN con.recebedorcon
    WHEN con.tomadorservicoctecon = 1 AND con.expedidorcon IS NOT NULL THEN con.expedidorcon
    ELSE con.clientecon
  END
  ORDER BY (cli.empresacli = con.empresacon) DESC, cli.empresacli
  LIMIT 1
) cli ON true
WHERE con.statuscon = 2
  AND con.dataemissaocon::date BETWEEN p.data_inicio AND p.data_fim
GROUP BY 1, 2
ORDER BY faturamento DESC
LIMIT 50;

WITH params AS (
  SELECT DATE '2026-01-01' AS data_inicio, DATE '2026-01-31' AS data_fim
)
SELECT
  UPPER(TRIM(COALESCE(i.veiculooep, o.veiculoose)::text)) AS placa,
  CASE WHEN v.tipopropriedadevei::text = 'P' THEN 'Frota' ELSE 'Terceiro' END AS tipo_veiculo,
  COUNT(*) AS itens_os_externa,
  SUM(COALESCE(i.totalitemoep, 0)) AS custo_pecas
FROM frotas.ordensservicosexternaprodutos i
JOIN frotas.ordensservicosexterna o
  ON o.empresaose = i.empresaoep
 AND o.serieose = i.serieoep
 AND o.codigoose = i.codigooep
 AND o.fornecedorose = i.fornecedoroep
CROSS JOIN params p
LEFT JOIN frotas.veiculos v
  ON UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(i.veiculooep, o.veiculoose)::text))
WHERE COALESCE(o.dataentradaose, o.dataemissaoose)::date BETWEEN p.data_inicio AND p.data_fim
  AND COALESCE(i.totalitemoep, 0) <> 0
GROUP BY 1, 2
ORDER BY custo_pecas DESC
LIMIT 50;
