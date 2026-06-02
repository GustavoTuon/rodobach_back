-- Validacao da tela Financeiro por Placa contra as telas Receita e Custos.
-- Ajuste as datas abaixo para comparar outro periodo.
WITH params AS (
  SELECT DATE '2026-05-02' AS data_inicio, DATE '2026-06-01' AS data_fim
),
receita_base AS (
  SELECT
    CASE
      WHEN NULLIF(TRIM(vei.placavei::text), '') IS NOT NULL THEN 'plate:' || UPPER(TRIM(vei.placavei::text))
      WHEN NULLIF(TRIM(rec.veiculorec::text), '') IS NOT NULL THEN 'plate:' || UPPER(TRIM(rec.veiculorec::text))
      WHEN centro.codigo IS NOT NULL THEN 'cc:' || rec.empresarec::text || ':' || centro.codigo::text
      ELSE 'none'
    END AS group_key,
    COALESCE(
      NULLIF(TRIM(vei.placavei::text), ''),
      NULLIF(TRIM(rec.veiculorec::text), ''),
      NULLIF(TRIM(ccs.nomeccs::text), ''),
      'Sem centro de custo'
    ) AS label,
    rec.valorduplicatarec AS valor_documento
  FROM financeiro.receber rec
  JOIN params p ON true
  INNER JOIN LATERAL (
    SELECT c.codigo::int AS codigo
    FROM unnest(rec.centrosdecustorec) WITH ORDINALITY AS c(codigo, ord)
    WHERE c.codigo IS NOT NULL
    ORDER BY c.ord
  ) centro ON true
  LEFT JOIN LATERAL unnest(rec.contasfinanceirasrec) AS conta_financeira(codigo) ON true
  LEFT JOIN LATERAL (
    SELECT cc.nomeccs
    FROM financeiro.centroscustos cc
    WHERE cc.codigoccs = centro.codigo
    ORDER BY (cc.empresaccs = rec.empresarec) DESC, cc.empresaccs
    LIMIT 1
  ) ccs ON true
  LEFT JOIN LATERAL (
    SELECT v.placavei
    FROM frotas.veiculos v
    WHERE v.centrocustovei = centro.codigo
      AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
    ORDER BY (v.empresavei = rec.empresarec) DESC, v.empresavei
    LIMIT 1
  ) vei ON true
  WHERE rec.datavencimentorec::date >= p.data_inicio
    AND rec.datavencimentorec::date <= p.data_fim
),
custo_base AS (
  SELECT
    CASE
      WHEN NULLIF(TRIM(vei.placavei::text), '') IS NOT NULL THEN 'plate:' || UPPER(TRIM(vei.placavei::text))
      WHEN NULLIF(TRIM(pag.veiculopag::text), '') IS NOT NULL THEN 'plate:' || UPPER(TRIM(pag.veiculopag::text))
      WHEN centro.codigo IS NOT NULL THEN 'cc:' || pag.empresapag::text || ':' || centro.codigo::text
      ELSE 'none'
    END AS group_key,
    COALESCE(
      NULLIF(TRIM(vei.placavei::text), ''),
      NULLIF(TRIM(pag.veiculopag::text), ''),
      NULLIF(TRIM(ccs.nomeccs::text), ''),
      'Sem centro de custo'
    ) AS label,
    pag.valorduplicatapag AS valor_documento
  FROM financeiro.pagar pag
  JOIN params p ON true
  INNER JOIN LATERAL (
    SELECT c.codigo::int AS codigo
    FROM unnest(pag.centrosdecustopag) WITH ORDINALITY AS c(codigo, ord)
    WHERE c.codigo IS NOT NULL
    ORDER BY c.ord
  ) centro ON true
  LEFT JOIN LATERAL unnest(pag.contasfinanceiraspag) AS conta_financeira(codigo) ON true
  LEFT JOIN LATERAL (
    SELECT cc.nomeccs
    FROM financeiro.centroscustos cc
    WHERE cc.codigoccs = centro.codigo
    ORDER BY (cc.empresaccs = pag.empresapag) DESC, cc.empresaccs
    LIMIT 1
  ) ccs ON true
  LEFT JOIN LATERAL (
    SELECT v.placavei
    FROM frotas.veiculos v
    WHERE v.centrocustovei = centro.codigo
      AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
    ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
    LIMIT 1
  ) vei ON true
  WHERE pag.datavencimentopag::date >= p.data_inicio
    AND pag.datavencimentopag::date <= p.data_fim
),
receita_agrupada AS (
  SELECT group_key, label, SUM(valor_documento) AS total
  FROM receita_base
  GROUP BY group_key, label
),
custo_agrupado AS (
  SELECT group_key, label, SUM(valor_documento) AS total
  FROM custo_base
  GROUP BY group_key, label
)
SELECT
  (SELECT COALESCE(SUM(valor_documento), 0) FROM receita_base) AS total_receita_geral,
  (SELECT COALESCE(SUM(total), 0) FROM receita_agrupada) AS total_receita_agrupada,
  (SELECT COALESCE(SUM(valor_documento), 0) FROM custo_base) AS total_custo_geral,
  (SELECT COALESCE(SUM(total), 0) FROM custo_agrupado) AS total_custo_agrupado,
  (SELECT COALESCE(SUM(total), 0) FROM receita_agrupada)
    - (SELECT COALESCE(SUM(total), 0) FROM custo_agrupado) AS saldo;
