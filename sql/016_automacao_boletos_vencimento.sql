-- Consulta operacional para automacao de lembrete de boletos/duplicatas.
--
-- IMPORTANTE:
--   Este arquivo NAO e migracao do sistema. Ele deve ser executado no banco
--   do cliente que possui os schemas financeiro e gerais.
--
-- Objetivo:
--   Listar titulos em aberto com vencimento proximo ou vencidos recentes,
--   trazendo cliente, telefone/e-mail e uma mensagem base para WhatsApp/e-mail.
--
-- Parametros principais:
--   data_referencia       = data base da automacao. Em producao use CURRENT_DATE.
--   dias_antes_vencimento = janela futura. Ex.: 3 pega hoje ate proximos 3 dias.
--   dias_depois_vencido   = janela passada. Ex.: 5 pega vencidos ha ate 5 dias.
--   empresa_filtro        = informe uma empresa especifica, ou NULL para todas.

WITH parametros AS (
  SELECT
    CURRENT_DATE::date AS data_referencia,
    3::int AS dias_antes_vencimento,
    5::int AS dias_depois_vencido,
    NULL::int AS empresa_filtro
),
base AS (
  SELECT
    rec.empresarec AS empresa,
    rec.serierec AS serie,
    rec.duplicatarec AS duplicata,
    rec.parcelarec AS parcela,
    rec.clienterec AS cliente_codigo,

    COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), rec.clienterec::text) AS cliente_nome,
    NULLIF(cli.nomecli, '') AS cliente_razao,
    NULLIF(cli.cnpjcpfcli, '') AS cliente_documento,
    NULLIF(cli.contatocli, '') AS cliente_contato,

    COALESCE(
      NULLIF(cli.emailboletocli, ''),
      NULLIF(cli.emailcli, ''),
      NULLIF(cli.emailctecli, '')
    ) AS email_envio,

    REGEXP_REPLACE(CONCAT(COALESCE(cli.dddcli, ''), COALESCE(cli.telefone1cli, '')), '[^0-9]', '', 'g') AS telefone_1_raw,
    REGEXP_REPLACE(CONCAT(COALESCE(cli.dddtelefone2cli, ''), COALESCE(cli.telefone2cli, '')), '[^0-9]', '', 'g') AS telefone_2_raw,

    rec.dataemissaorec::date AS data_emissao,
    rec.datavencimentorec::date AS data_vencimento,
    rec.valorduplicatarec::numeric AS valor_titulo,
    rec.valorabertorec::numeric AS valor_aberto,
    COALESCE(rec.valorjurosrec, 0)::numeric AS valor_juros,
    COALESCE(rec.valordescontorec, 0)::numeric AS valor_desconto,
    rec.documentorec AS documento,
    rec.nossonumerorec AS nosso_numero_receber,
    rec.observacaorec AS observacao,
    rec.formarecebimentorec AS forma_recebimento,
    rec.statusrec AS status_receber,

    bol.codigobol AS boleto_codigo,
    bol.nossonumerobol AS boleto_nosso_numero,
    bol.digitoverificadornossonumerobol AS boleto_nosso_numero_dv,
    bol.seunumerobol AS boleto_seu_numero,
    bol.statusbol AS boleto_status_codigo,
    sbo.descricaosbo AS boleto_status,
    bol.emailenviadobol AS boleto_email_enviado,

    rec.datavencimentorec::date - p.data_referencia AS dias_para_vencer,
    CASE
      WHEN rec.datavencimentorec::date = p.data_referencia THEN 'vence_hoje'
      WHEN rec.datavencimentorec::date > p.data_referencia THEN 'vence_em_breve'
      ELSE 'vencido'
    END AS tipo_lembrete
  FROM financeiro.receber rec
  CROSS JOIN parametros p
  LEFT JOIN LATERAL (
    SELECT
      c.nomecli,
      c.fantasiacli,
      c.cnpjcpfcli,
      c.contatocli,
      c.emailcli,
      c.emailboletocli,
      c.emailctecli,
      c.dddcli,
      c.telefone1cli,
      c.dddtelefone2cli,
      c.telefone2cli
    FROM gerais.clientes c
    WHERE c.codigocli = rec.clienterec
    ORDER BY (c.empresacli = rec.empresarec) DESC, c.empresacli
    LIMIT 1
  ) cli ON true
  LEFT JOIN financeiro.boletosduplicatas bod
    ON bod.empresabod = rec.empresarec
   AND bod.seriebod = rec.serierec
   AND bod.duplicatabod = rec.duplicatarec
   AND bod.parcelabod = rec.parcelarec
  LEFT JOIN financeiro.boletos bol
    ON bol.empresabol = bod.empresabod
   AND bol.codigobol = bod.codigobod
  LEFT JOIN financeiro.statusboletos sbo
    ON sbo.codigosbo = bol.statusbol
  WHERE COALESCE(rec.valorabertorec, 0) > 0
    AND rec.statusrec IN (1, 2)
    AND rec.datavencimentorec IS NOT NULL
    AND (p.empresa_filtro IS NULL OR rec.empresarec = p.empresa_filtro)
    AND rec.datavencimentorec::date >= (p.data_referencia - (p.dias_depois_vencido || ' days')::interval)::date
    AND rec.datavencimentorec::date <= (p.data_referencia + (p.dias_antes_vencimento || ' days')::interval)::date
),
contatos AS (
  SELECT
    b.*,
    CASE WHEN LENGTH(b.telefone_1_raw) BETWEEN 10 AND 13 THEN b.telefone_1_raw END AS telefone_1,
    CASE WHEN LENGTH(b.telefone_2_raw) BETWEEN 10 AND 13 THEN b.telefone_2_raw END AS telefone_2
  FROM base b
),
final AS (
  SELECT
    c.*,
    COALESCE(c.telefone_1, c.telefone_2) AS telefone_envio,
    COALESCE(c.boleto_nosso_numero, c.nosso_numero_receber) AS nosso_numero,
    CASE
      WHEN c.tipo_lembrete = 'vence_hoje' THEN 'Boleto vence hoje'
      WHEN c.tipo_lembrete = 'vence_em_breve' THEN 'Boleto vence em ' || c.dias_para_vencer::text || ' dia(s)'
      ELSE 'Boleto vencido ha ' || ABS(c.dias_para_vencer)::text || ' dia(s)'
    END AS resumo_lembrete
  FROM contatos c
)
SELECT
  empresa,
  serie,
  duplicata,
  parcela,
  cliente_codigo,
  cliente_nome,
  cliente_razao,
  cliente_documento,
  cliente_contato,
  email_envio,
  telefone_envio,
  telefone_1,
  telefone_2,
  data_emissao,
  data_vencimento,
  dias_para_vencer,
  tipo_lembrete,
  resumo_lembrete,
  valor_titulo,
  valor_aberto,
  valor_juros,
  valor_desconto,
  documento,
  boleto_codigo,
  nosso_numero,
  boleto_nosso_numero_dv,
  boleto_seu_numero,
  boleto_status_codigo,
  boleto_status,
  boleto_email_enviado,
  observacao,
  CONCAT(
    'Ola',
    CASE WHEN cliente_contato IS NOT NULL THEN ' ' || cliente_contato ELSE '' END,
    ', tudo bem? Identificamos que o boleto ',
    COALESCE(boleto_seu_numero::text, documento::text, duplicata::text),
    ' no valor de R$ ',
    TO_CHAR(valor_aberto, 'FM999G999G999G990D00'),
    ' ',
    CASE
      WHEN tipo_lembrete = 'vence_hoje' THEN 'vence hoje'
      WHEN tipo_lembrete = 'vence_em_breve' THEN 'vence em ' || dias_para_vencer::text || ' dia(s)'
      ELSE 'venceu ha ' || ABS(dias_para_vencer)::text || ' dia(s)'
    END,
    ' (', TO_CHAR(data_vencimento, 'DD/MM/YYYY'), ').'
  ) AS mensagem_sugerida
FROM final
WHERE email_envio IS NOT NULL
   OR telefone_envio IS NOT NULL
ORDER BY data_vencimento ASC, cliente_nome, valor_aberto DESC, duplicata, parcela;
