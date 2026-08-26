-- Importacao incremental e nao destrutiva do modulo legado para Cargas e Viagens V2.
-- Pode ser executada novamente: legado_id e as chaves naturais impedem duplicacoes.
-- Registros criados ou editados diretamente na V2 nunca sao sobrescritos.

CREATE TABLE IF NOT EXISTS migracao_cargas_viagens_v2_execucoes (
  id BIGSERIAL PRIMARY KEY,
  cargas_antes BIGINT NOT NULL,
  cargas_depois BIGINT NOT NULL,
  viagens_antes BIGINT NOT NULL,
  viagens_depois BIGINT NOT NULL,
  vinculos_antes BIGINT NOT NULL,
  vinculos_depois BIGINT NOT NULL,
  rotas_antes BIGINT NOT NULL,
  rotas_depois BIGINT NOT NULL,
  documentos_antes BIGINT NOT NULL,
  documentos_depois BIGINT NOT NULL,
  auditorias_antes BIGINT NOT NULL,
  auditorias_depois BIGINT NOT NULL,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TEMP TABLE importacao_v2_contagem (
  entidade TEXT PRIMARY KEY,
  quantidade_antes BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO importacao_v2_contagem VALUES
  ('cargas', (SELECT COUNT(*) FROM cargas_v2)),
  ('viagens', (SELECT COUNT(*) FROM viagens_v2)),
  ('vinculos', (SELECT COUNT(*) FROM viagem_cargas_v2)),
  ('rotas', (SELECT COUNT(*) FROM carga_rotas_v2)),
  ('documentos', (SELECT COUNT(*) FROM carga_documentos_v2)),
  ('auditorias', (SELECT COUNT(*) FROM carga_aprovacao_auditoria_v2));

-- Cada registro legado continua sendo uma carga individual na V2. O ID de
-- producao fica em legado_id; o novo ID e sempre gerado pela sequence da V2.
INSERT INTO cargas_v2 (
  legado_id, codigo_carga, data, cliente, cliente_final, tomador_servico,
  vendedor, cidade_origem, uf_origem, cidade_destino, uf_destino, material,
  peso_kg, valor_cliente, condicao_pagamento, observacoes, status,
  status_aprovacao, motivo_aprovacao, aprovado_por_id, aprovado_por_login,
  aprovado_em, criado_por_id, criado_por_login, atualizado_por_id,
  atualizado_por_login, dados_legados, criado_em, atualizado_em
)
SELECT
  c.id,
  'LEGADO-' || c.id::text,
  c.data,
  COALESCE(c.cliente, ''),
  c.cliente_final,
  c.tomador_servico,
  c.vendedor,
  COALESCE(c.cidade_origem, ''),
  LEFT(COALESCE(c.uf_origem, ''), 2),
  COALESCE(c.cidade_destino, ''),
  LEFT(COALESCE(c.uf_destino, ''), 2),
  c.material,
  COALESCE(c.peso_kg, 0),
  COALESCE(c.valor_cliente, 0),
  c.condicao_pagamento,
  c.observacoes,
  CASE
    WHEN c.situacao IN ('entregue', 'cancelado', 'em_transito') THEN c.situacao
    WHEN NULLIF(TRIM(c.numero_viagem), '') IS NULL THEN 'aguardando_viagem'
    WHEN EXISTS (
      SELECT 1
      FROM cadastro_cotacao_frete_documentos d
      WHERE d.cotacao_id = c.id
        AND UPPER(REGEXP_REPLACE(COALESCE(d.tipo_documento, ''), '[^A-Za-z]', '', 'g')) = 'CTE'
        AND COALESCE(NULLIF(TRIM(d.numero_documento), ''), NULLIF(TRIM(d.chave_documento), '')) IS NOT NULL
    ) THEN 'em_transito'
    ELSE 'aguardando_cte'
  END,
  COALESCE(c.status_aprovacao, 'rascunho'),
  c.motivo_aprovacao,
  c.aprovado_por_id,
  c.aprovado_por_login,
  c.aprovado_em,
  c.criado_por_id,
  c.criado_por_login,
  c.atualizado_por_id,
  c.atualizado_por_login,
  TO_JSONB(c),
  COALESCE(c.criado_em, NOW()),
  COALESCE(c.atualizado_em, NOW())
FROM cadastro_cotacao_frete c
WHERE NOT EXISTS (SELECT 1 FROM cargas_v2 nova WHERE nova.legado_id = c.id)
ON CONFLICT DO NOTHING;

-- No legado os dados da viagem se repetem em cada carga. Na V2 eles passam a
-- existir uma unica vez por numero de viagem.
INSERT INTO viagens_v2 (
  numero_viagem, data, placa_veiculo, motorista, km_viagem, numero_motorista,
  cnh_motorista, antt_veiculo, conta_deposito, chave_pix, valor_motorista,
  doc_placas, doc_antt, doc_conta_deposito, doc_chave_pix, doc_cnh_motorista,
  doc_consulta_motorista, doc_comprovante_residencia, doc_numero_motorista,
  rota_maps_url, observacoes, situacao, criado_por_id, criado_por_login,
  atualizado_por_id, atualizado_por_login, dados_legados, criado_em, atualizado_em
)
SELECT DISTINCT ON (LOWER(TRIM(c.numero_viagem)))
  TRIM(c.numero_viagem),
  c.data,
  c.placa_veiculo,
  c.motorista,
  c.km_viagem,
  c.numero_motorista,
  c.cnh_motorista,
  c.antt_veiculo,
  c.conta_deposito,
  c.chave_pix,
  COALESCE(c.valor_motorista, 0),
  c.doc_placas,
  c.doc_antt,
  c.doc_conta_deposito,
  c.doc_chave_pix,
  c.doc_cnh_motorista,
  c.doc_consulta_motorista,
  c.doc_comprovante_residencia,
  c.doc_numero_motorista,
  c.rota_maps_url,
  c.observacoes,
  CASE
    WHEN c.situacao IN ('entregue', 'cancelado', 'em_transito') THEN c.situacao
    WHEN EXISTS (
      SELECT 1
      FROM cadastro_cotacao_frete relacionada
      JOIN cadastro_cotacao_frete_documentos d ON d.cotacao_id = relacionada.id
      WHERE LOWER(TRIM(relacionada.numero_viagem)) = LOWER(TRIM(c.numero_viagem))
        AND UPPER(REGEXP_REPLACE(COALESCE(d.tipo_documento, ''), '[^A-Za-z]', '', 'g')) = 'CTE'
        AND COALESCE(NULLIF(TRIM(d.numero_documento), ''), NULLIF(TRIM(d.chave_documento), '')) IS NOT NULL
    ) THEN 'em_transito'
    ELSE 'aguardando_cte'
  END,
  c.criado_por_id,
  c.criado_por_login,
  c.atualizado_por_id,
  c.atualizado_por_login,
  TO_JSONB(c),
  COALESCE(c.criado_em, NOW()),
  COALESCE(c.atualizado_em, NOW())
FROM cadastro_cotacao_frete c
WHERE NULLIF(TRIM(c.numero_viagem), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM viagens_v2 existente
    WHERE LOWER(TRIM(existente.numero_viagem)) = LOWER(TRIM(c.numero_viagem))
  )
ORDER BY LOWER(TRIM(c.numero_viagem)), c.atualizado_em DESC NULLS LAST, c.id DESC
ON CONFLICT DO NOTHING;

INSERT INTO viagem_cargas_v2 (viagem_id, carga_id)
SELECT viagem.id, carga_nova.id
FROM cadastro_cotacao_frete carga_antiga
JOIN cargas_v2 carga_nova ON carga_nova.legado_id = carga_antiga.id
JOIN LATERAL (
  SELECT v.id
  FROM viagens_v2 v
  WHERE LOWER(TRIM(v.numero_viagem)) = LOWER(TRIM(carga_antiga.numero_viagem))
  ORDER BY v.id
  LIMIT 1
) viagem ON TRUE
WHERE NULLIF(TRIM(carga_antiga.numero_viagem), '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO carga_rotas_v2 (
  carga_id, legado_id, ordem, tipo_parada, cidade, uf, cliente, endereco,
  numero_nota_fiscal, observacoes, criado_em, atualizado_em
)
SELECT
  carga_nova.id, rota.id, rota.ordem, rota.tipo_parada, rota.cidade,
  LEFT(COALESCE(rota.uf, ''), 2), rota.cliente, rota.endereco,
  rota.numero_nota_fiscal, rota.observacoes,
  COALESCE(rota.criado_em, NOW()), COALESCE(rota.atualizado_em, NOW())
FROM cadastro_cotacao_frete_rotas rota
JOIN cargas_v2 carga_nova ON carga_nova.legado_id = rota.cotacao_id
WHERE NOT EXISTS (SELECT 1 FROM carga_rotas_v2 nova WHERE nova.legado_id = rota.id)
ON CONFLICT DO NOTHING;

INSERT INTO carga_documentos_v2 (
  carga_id, legado_id, tipo_documento, numero_documento, chave_documento,
  link_documento, observacoes, criado_por_id, criado_por_login,
  atualizado_por_id, atualizado_por_login, criado_em, atualizado_em
)
SELECT
  carga_nova.id, documento.id, documento.tipo_documento,
  documento.numero_documento, documento.chave_documento,
  documento.link_documento, documento.observacoes,
  documento.criado_por_id, documento.criado_por_login,
  documento.atualizado_por_id, documento.atualizado_por_login,
  COALESCE(documento.criado_em, NOW()), COALESCE(documento.atualizado_em, NOW())
FROM cadastro_cotacao_frete_documentos documento
JOIN cargas_v2 carga_nova ON carga_nova.legado_id = documento.cotacao_id
WHERE NOT EXISTS (SELECT 1 FROM carga_documentos_v2 novo WHERE novo.legado_id = documento.id)
ON CONFLICT DO NOTHING;

INSERT INTO carga_aprovacao_auditoria_v2 (
  legado_id, carga_id, acao, status_anterior, status_novo, motivo,
  usuario_id, usuario_login, criado_em
)
SELECT
  auditoria.id, carga_nova.id, auditoria.acao, auditoria.status_anterior,
  auditoria.status_novo, auditoria.motivo, auditoria.usuario_id,
  auditoria.usuario_login, COALESCE(auditoria.criado_em, NOW())
FROM cadastro_cotacao_frete_auditoria auditoria
JOIN cargas_v2 carga_nova ON carga_nova.legado_id = auditoria.cotacao_id
WHERE NOT EXISTS (
  SELECT 1 FROM carga_aprovacao_auditoria_v2 nova
  WHERE nova.legado_id = auditoria.id
)
ON CONFLICT DO NOTHING;

INSERT INTO migracao_cargas_viagens_v2_execucoes (
  cargas_antes, cargas_depois, viagens_antes, viagens_depois,
  vinculos_antes, vinculos_depois, rotas_antes, rotas_depois,
  documentos_antes, documentos_depois, auditorias_antes, auditorias_depois
)
SELECT
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'cargas'),
  (SELECT COUNT(*) FROM cargas_v2),
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'viagens'),
  (SELECT COUNT(*) FROM viagens_v2),
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'vinculos'),
  (SELECT COUNT(*) FROM viagem_cargas_v2),
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'rotas'),
  (SELECT COUNT(*) FROM carga_rotas_v2),
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'documentos'),
  (SELECT COUNT(*) FROM carga_documentos_v2),
  (SELECT quantidade_antes FROM importacao_v2_contagem WHERE entidade = 'auditorias'),
  (SELECT COUNT(*) FROM carga_aprovacao_auditoria_v2);
