-- Analise de clientes por faturamento.
-- Base usada:
--   gerais.clientes.codigocli / empresacli
--   logistica.conhecimentos.clientecon / empresacon
-- Valor considerado como faturamento: totalcon; se estiver nulo, usa valorfretecon.

-- 1) Ranking de clientes com representatividade no faturamento.
-- Parametros esperados:
--   $1 = data inicial, exemplo '2026-01-01'::date ou null
--   $2 = data final, exemplo '2026-12-31'::date ou null
--   $3 = busca por cliente/cnpj/codigo, exemplo 'ACME' ou null
--   $4 = limite do ranking, exemplo 20
WITH documentos AS (
  SELECT
    con.empresacon,
    con.clientecon,
    con.dataemissaocon,
    COALESCE(con.totalcon, con.valorfretecon, 0)::numeric AS valor_faturado
  FROM logistica.conhecimentos con
  WHERE ($1::date IS NULL OR con.dataemissaocon::date >= $1::date)
    AND ($2::date IS NULL OR con.dataemissaocon::date <= $2::date)
),
faturamento_cliente AS (
  SELECT
    cli.empresacli,
    cli.codigocli,
    cli.nomecli,
    cli.fantasiacli,
    cli.cnpjcpfcli,
    COUNT(*) AS quantidade_ctes,
    MIN(doc.dataemissaocon) AS primeira_emissao,
    MAX(doc.dataemissaocon) AS ultima_emissao,
    COALESCE(SUM(doc.valor_faturado), 0) AS faturamento_total
  FROM documentos doc
  INNER JOIN gerais.clientes cli
    ON cli.codigocli = doc.clientecon
   AND cli.empresacli = doc.empresacon
  WHERE (
    $3::text IS NULL
    OR cli.nomecli ILIKE '%' || $3::text || '%'
    OR cli.fantasiacli ILIKE '%' || $3::text || '%'
    OR cli.cnpjcpfcli ILIKE '%' || $3::text || '%'
    OR cli.codigocli::text = $3::text
  )
  GROUP BY
    cli.empresacli,
    cli.codigocli,
    cli.nomecli,
    cli.fantasiacli,
    cli.cnpjcpfcli
)
SELECT
  DENSE_RANK() OVER (ORDER BY faturamento_total DESC) AS posicao,
  empresacli AS empresa,
  codigocli AS codigo_cliente,
  nomecli AS razao_social,
  fantasiacli AS nome_fantasia,
  cnpjcpfcli AS cnpj_cpf,
  quantidade_ctes,
  primeira_emissao,
  ultima_emissao,
  faturamento_total,
  CASE
    WHEN SUM(faturamento_total) OVER () > 0
      THEN ROUND((faturamento_total / SUM(faturamento_total) OVER () * 100)::numeric, 2)
    ELSE 0
  END AS representatividade_percentual
FROM faturamento_cliente
ORDER BY faturamento_total DESC, nomecli
LIMIT $4;

-- 2) Cliente que mais fatura no periodo.
WITH documentos AS (
  SELECT
    con.empresacon,
    con.clientecon,
    COALESCE(con.totalcon, con.valorfretecon, 0)::numeric AS valor_faturado
  FROM logistica.conhecimentos con
  WHERE ($1::date IS NULL OR con.dataemissaocon::date >= $1::date)
    AND ($2::date IS NULL OR con.dataemissaocon::date <= $2::date)
),
faturamento_cliente AS (
  SELECT
    cli.codigocli,
    COALESCE(NULLIF(cli.fantasiacli, ''), cli.nomecli) AS cliente,
    COUNT(*) AS quantidade_ctes,
    SUM(doc.valor_faturado) AS faturamento_total
  FROM documentos doc
  INNER JOIN gerais.clientes cli
    ON cli.codigocli = doc.clientecon
   AND cli.empresacli = doc.empresacon
  GROUP BY cli.codigocli, COALESCE(NULLIF(cli.fantasiacli, ''), cli.nomecli)
)
SELECT *
FROM faturamento_cliente
ORDER BY faturamento_total DESC
LIMIT 1;

-- 3) Faturamento mensal geral para acompanhar evolucao.
SELECT
  TO_CHAR(con.dataemissaocon, 'YYYY-MM') AS competencia,
  COUNT(*) AS quantidade_ctes,
  SUM(COALESCE(con.totalcon, con.valorfretecon, 0)) AS faturamento_total
FROM logistica.conhecimentos con
WHERE ($1::date IS NULL OR con.dataemissaocon::date >= $1::date)
  AND ($2::date IS NULL OR con.dataemissaocon::date <= $2::date)
GROUP BY DATE_TRUNC('month', con.dataemissaocon), TO_CHAR(con.dataemissaocon, 'YYYY-MM')
ORDER BY DATE_TRUNC('month', con.dataemissaocon);
