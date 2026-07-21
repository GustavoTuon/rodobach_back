-- Consulta de vencimentos ajustada para boletos agrupados.
-- Regra principal:
-- - Se a duplicata estiver em financeiro.boletosduplicatasagrupadas, a cobranca valida e o boleto agrupador.
-- - Duplicatas do mesmo boleto agrupador sao consolidadas em uma unica linha.
-- - Boletos individuais baixados por substituicao nao fazem a duplicata parecer quitada.

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

    bda.codigobda AS boleto_agrupador_codigo,
    bda.seriebda AS boleto_agrupador_serie_principal,
    bda.duplicatabda AS boleto_agrupador_duplicata_principal,
    bda.parcelabda AS boleto_agrupador_parcela_principal,

    bol_ind.codigobol AS boleto_individual_codigo,
    bol_ind.nossonumerobol AS boleto_individual_nosso_numero,
    bol_ind.digitoverificadornossonumerobol AS boleto_individual_nosso_numero_dv,
    bol_ind.seunumerobol AS boleto_individual_seu_numero,
    bol_ind.statusbol AS boleto_individual_status_codigo,
    sbo_ind.descricaosbo AS boleto_individual_status,

    bol_agr.codigobol AS boleto_agrupador_codigobol,
    bol_agr.nossonumerobol AS boleto_agrupador_nosso_numero,
    bol_agr.digitoverificadornossonumerobol AS boleto_agrupador_nosso_numero_dv,
    bol_agr.seunumerobol AS boleto_agrupador_seu_numero,
    bol_agr.statusbol AS boleto_agrupador_status_codigo,
    sbo_agr.descricaosbo AS boleto_agrupador_status,

    rec.datavencimentorec::date - p.data_referencia AS dias_para_vencer,
    CASE
      WHEN rec.datavencimentorec::date = p.data_referencia THEN 'vence_hoje'
      WHEN rec.datavencimentorec::date > p.data_referencia THEN 'vence_em_breve'
      ELSE 'vencido'
    END AS tipo_lembrete
  FROM financeiro.receber rec
  CROSS JOIN parametros p
  LEFT JOIN LATERAL (
    SELECT c.*
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
  LEFT JOIN financeiro.boletos bol_ind
    ON bol_ind.empresabol = bod.empresabod
   AND bol_ind.codigobol = bod.codigobod
  LEFT JOIN financeiro.statusboletos sbo_ind
    ON sbo_ind.codigosbo = bol_ind.statusbol
  LEFT JOIN financeiro.boletosduplicatasagrupadas bda
    ON bda.empresabda = rec.empresarec
   AND bda.serieagrupadabda = rec.serierec
   AND bda.duplicataagrupadabda = rec.duplicatarec
   AND bda.parcelaagrupadabda = rec.parcelarec
  LEFT JOIN financeiro.boletos bol_agr
    ON bol_agr.empresabol = bda.empresabda
   AND bol_agr.codigobol = bda.codigobda
  LEFT JOIN financeiro.statusboletos sbo_agr
    ON sbo_agr.codigosbo = bol_agr.statusbol
  WHERE COALESCE(rec.valorabertorec, 0) > 0
    AND rec.statusrec IN (1, 2)
    AND rec.datavencimentorec IS NOT NULL
    AND (p.empresa_filtro IS NULL OR rec.empresarec = p.empresa_filtro)
    AND rec.datavencimentorec::date >= (p.data_referencia - (p.dias_depois_vencido || ' days')::interval)::date
    AND rec.datavencimentorec::date <= (p.data_referencia + (p.dias_antes_vencimento || ' days')::interval)::date
),
normalizada_raw AS (
  SELECT
    b.*,
    CASE WHEN LENGTH(b.telefone_1_raw) BETWEEN 10 AND 13 THEN b.telefone_1_raw END AS telefone_1,
    CASE WHEN LENGTH(b.telefone_2_raw) BETWEEN 10 AND 13 THEN b.telefone_2_raw END AS telefone_2,
    COALESCE(b.boleto_agrupador_codigo, b.boleto_individual_codigo, b.duplicata) AS chave_cobranca,
    CASE WHEN b.boleto_agrupador_codigo IS NOT NULL THEN true ELSE false END AS boleto_agrupado,
    COALESCE(b.boleto_agrupador_codigobol, b.boleto_individual_codigo) AS boleto_codigo,
    COALESCE(b.boleto_agrupador_nosso_numero, b.boleto_individual_nosso_numero, b.nosso_numero_receber) AS nosso_numero,
    COALESCE(b.boleto_agrupador_seu_numero, b.boleto_individual_seu_numero, b.documento::text, b.duplicata::text) AS boleto_seu_numero,
    COALESCE(b.boleto_agrupador_status_codigo, b.boleto_individual_status_codigo) AS boleto_status_codigo,
    COALESCE(b.boleto_agrupador_status, b.boleto_individual_status) AS boleto_status
  FROM base b
),
normalizada AS (
  SELECT DISTINCT ON (empresa, serie, duplicata, parcela, cliente_codigo, chave_cobranca)
    *
  FROM normalizada_raw
  ORDER BY
    empresa,
    serie,
    duplicata,
    parcela,
    cliente_codigo,
    chave_cobranca,
    boleto_agrupado DESC,
    (boleto_status_codigo = 1) DESC,
    boleto_codigo DESC NULLS LAST
),
agrupada AS (
  SELECT
    empresa,
    MIN(serie) AS serie,
    MIN(duplicata) AS duplicata,
    MIN(parcela) AS parcela,
    cliente_codigo,
    cliente_nome,
    cliente_razao,
    cliente_documento,
    cliente_contato,
    email_envio,
    COALESCE(MAX(telefone_1), MAX(telefone_2)) AS telefone_envio,
    MAX(telefone_1) AS telefone_1,
    MAX(telefone_2) AS telefone_2,
    MIN(data_emissao) AS data_emissao,
    MIN(data_vencimento) AS data_vencimento,
    MIN(dias_para_vencer) AS dias_para_vencer,
    MIN(tipo_lembrete) AS tipo_lembrete,
    SUM(valor_titulo) AS valor_titulo,
    SUM(valor_aberto) AS valor_aberto,
    SUM(valor_juros) AS valor_juros,
    SUM(valor_desconto) AS valor_desconto,
    STRING_AGG(serie || '-' || duplicata::text || '/' || parcela, ', ' ORDER BY duplicata, parcela) AS duplicatas_agrupadas,
    BOOL_OR(boleto_agrupado) AS boleto_agrupado,
    chave_cobranca,
    MAX(boleto_codigo) AS boleto_codigo,
    MAX(nosso_numero) AS nosso_numero,
    MAX(boleto_seu_numero) AS boleto_seu_numero,
    MAX(boleto_status_codigo) AS boleto_status_codigo,
    MAX(boleto_status) AS boleto_status
  FROM normalizada
  GROUP BY empresa, cliente_codigo, cliente_nome, cliente_razao, cliente_documento, cliente_contato, email_envio, chave_cobranca
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
  CASE
    WHEN tipo_lembrete = 'vence_hoje' THEN 'Boleto vence hoje'
    WHEN tipo_lembrete = 'vence_em_breve' THEN 'Boleto vence em ' || dias_para_vencer::text || ' dia(s)'
    ELSE 'Boleto vencido ha ' || ABS(dias_para_vencer)::text || ' dia(s)'
  END AS resumo_lembrete,
  valor_titulo,
  valor_aberto,
  valor_juros,
  valor_desconto,
  boleto_codigo,
  nosso_numero,
  boleto_seu_numero,
  boleto_status_codigo,
  boleto_status,
  boleto_agrupado,
  duplicatas_agrupadas,
  CONCAT(
    'Olá',
    CASE WHEN cliente_contato IS NOT NULL THEN ' ' || cliente_contato ELSE '' END,
    ', tudo bem? 😊',
    E'\n\n',
    'Passando para lembrar que o boleto nº ',
    COALESCE(boleto_seu_numero::text, nosso_numero::text, duplicata::text),
    CASE WHEN boleto_agrupado THEN ' (referente aos títulos ' || duplicatas_agrupadas || ')' ELSE '' END,
    ', no valor de R$ ',
    TO_CHAR(valor_aberto, 'FM999G999G999G990D00'),
    ', ',
    CASE
      WHEN tipo_lembrete = 'vence_hoje' THEN 'vence hoje'
      WHEN tipo_lembrete = 'vence_em_breve' THEN 'vence em ' || dias_para_vencer::text || ' dia(s)'
      ELSE 'está vencido há ' || ABS(dias_para_vencer)::text || ' dia(s)'
    END,
    ' (',
    TO_CHAR(data_vencimento, 'DD/MM/YYYY'),
    ').',
    E'\n\n',
    'Caso o pagamento já tenha sido realizado, por favor desconsidere esta mensagem.',
    E'\n\n',
    'Se você ainda não recebeu o boleto ou estiver com qualquer dúvida, entre em contato com nosso setor financeiro pelo WhatsApp: +55 48 9970-0358.',
    E'\n\n',
    'Agradecemos a atenção e permanecemos à disposição!'
  ) AS mensagem_sugerida
FROM agrupada
WHERE (email_envio IS NOT NULL OR telefone_envio IS NOT NULL)
  AND boleto_codigo IS NOT NULL
  AND boleto_status_codigo = 1
ORDER BY data_vencimento ASC, cliente_nome, valor_aberto DESC, duplicata, parcela;
