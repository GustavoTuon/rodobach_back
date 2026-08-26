-- Modulo paralelo de Cargas e Viagens.
-- Nenhuma tabela legada e alterada por esta migracao.

CREATE TABLE IF NOT EXISTS cargas_v2 (
  id BIGSERIAL PRIMARY KEY,
  legado_id INTEGER UNIQUE,
  codigo_carga VARCHAR(32) UNIQUE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente TEXT NOT NULL DEFAULT '',
  cliente_final TEXT,
  tomador_servico TEXT,
  vendedor TEXT,
  cidade_origem TEXT NOT NULL DEFAULT '',
  uf_origem CHAR(2) NOT NULL DEFAULT '',
  cidade_destino TEXT NOT NULL DEFAULT '',
  uf_destino CHAR(2) NOT NULL DEFAULT '',
  material TEXT,
  peso_kg NUMERIC(14, 3) NOT NULL DEFAULT 0,
  valor_cliente NUMERIC(14, 2) NOT NULL DEFAULT 0,
  condicao_pagamento TEXT,
  observacoes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'aguardando_viagem',
  status_aprovacao VARCHAR(24) NOT NULL DEFAULT 'rascunho',
  criado_por_id INTEGER,
  criado_por_login VARCHAR(120),
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  dados_legados JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS viagens_v2 (
  id BIGSERIAL PRIMARY KEY,
  numero_viagem VARCHAR(64) NOT NULL UNIQUE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  placa_veiculo TEXT,
  tipo_propriedade VARCHAR(20),
  motorista TEXT,
  km_viagem NUMERIC(14, 2),
  numero_motorista TEXT,
  cnh_motorista TEXT,
  antt_veiculo TEXT,
  conta_deposito TEXT,
  chave_pix TEXT,
  valor_motorista NUMERIC(14, 2) NOT NULL DEFAULT 0,
  doc_placas BOOLEAN NOT NULL DEFAULT FALSE,
  doc_antt BOOLEAN NOT NULL DEFAULT FALSE,
  doc_conta_deposito BOOLEAN NOT NULL DEFAULT FALSE,
  doc_chave_pix BOOLEAN NOT NULL DEFAULT FALSE,
  doc_cnh_motorista BOOLEAN NOT NULL DEFAULT FALSE,
  doc_consulta_motorista BOOLEAN NOT NULL DEFAULT FALSE,
  doc_comprovante_residencia BOOLEAN NOT NULL DEFAULT FALSE,
  doc_numero_motorista BOOLEAN NOT NULL DEFAULT FALSE,
  rota_maps_url TEXT,
  observacoes TEXT,
  situacao VARCHAR(32) NOT NULL DEFAULT 'aguardando_cte',
  criado_por_id INTEGER,
  criado_por_login VARCHAR(120),
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  dados_legados JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS viagem_cargas_v2 (
  viagem_id BIGINT NOT NULL REFERENCES viagens_v2(id) ON DELETE CASCADE,
  carga_id BIGINT NOT NULL UNIQUE REFERENCES cargas_v2(id) ON DELETE RESTRICT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (viagem_id, carga_id)
);

CREATE TABLE IF NOT EXISTS carga_rotas_v2 (
  id BIGSERIAL PRIMARY KEY,
  carga_id BIGINT NOT NULL REFERENCES cargas_v2(id) ON DELETE CASCADE,
  legado_id INTEGER UNIQUE,
  ordem INTEGER NOT NULL DEFAULT 1,
  tipo_parada TEXT NOT NULL DEFAULT 'entrega',
  cidade TEXT,
  uf CHAR(2),
  cliente TEXT,
  endereco TEXT,
  numero_nota_fiscal TEXT,
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carga_documentos_v2 (
  id BIGSERIAL PRIMARY KEY,
  carga_id BIGINT NOT NULL REFERENCES cargas_v2(id) ON DELETE CASCADE,
  legado_id INTEGER UNIQUE,
  tipo_documento TEXT NOT NULL DEFAULT 'CT-e',
  numero_documento TEXT,
  chave_documento TEXT,
  link_documento TEXT,
  observacoes TEXT,
  criado_por_id INTEGER,
  criado_por_login TEXT,
  atualizado_por_id INTEGER,
  atualizado_por_login TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cargas_v2_busca_idx
  ON cargas_v2 (data DESC, cliente, cidade_origem, cidade_destino);
CREATE INDEX IF NOT EXISTS cargas_v2_status_idx ON cargas_v2 (status);
CREATE INDEX IF NOT EXISTS viagens_v2_busca_idx
  ON viagens_v2 (data DESC, numero_viagem, placa_veiculo, motorista);
CREATE INDEX IF NOT EXISTS viagens_v2_status_idx ON viagens_v2 (situacao);
CREATE INDEX IF NOT EXISTS viagem_cargas_v2_viagem_idx ON viagem_cargas_v2 (viagem_id);
CREATE INDEX IF NOT EXISTS carga_rotas_v2_carga_idx ON carga_rotas_v2 (carga_id, ordem);
CREATE INDEX IF NOT EXISTS carga_documentos_v2_carga_idx ON carga_documentos_v2 (carga_id, id);

-- Cada linha antiga representa uma carga. O id antigo e preservado como referencia.
INSERT INTO cargas_v2 (
  id, legado_id, codigo_carga, data, cliente, cliente_final, tomador_servico,
  vendedor, cidade_origem, uf_origem, cidade_destino, uf_destino, material,
  peso_kg, valor_cliente, condicao_pagamento, observacoes, status,
  status_aprovacao, criado_por_id, criado_por_login, atualizado_por_id,
  atualizado_por_login, dados_legados, criado_em, atualizado_em
)
SELECT
  c.id,
  c.id,
  'C-' || LPAD(c.id::text, 6, '0'),
  c.data,
  COALESCE(c.cliente, ''),
  c.cliente_final,
  c.tomador_servico,
  c.vendedor,
  COALESCE(c.cidade_origem, ''),
  COALESCE(c.uf_origem, ''),
  COALESCE(c.cidade_destino, ''),
  COALESCE(c.uf_destino, ''),
  c.material,
  COALESCE(c.peso_kg, 0),
  COALESCE(c.valor_cliente, 0),
  c.condicao_pagamento,
  c.observacoes,
  CASE
    WHEN c.situacao IN ('entregue', 'cancelado', 'em_transito') THEN c.situacao
    WHEN NULLIF(TRIM(c.numero_viagem), '') IS NULL THEN 'aguardando_viagem'
    WHEN EXISTS (
      SELECT 1 FROM cadastro_cotacao_frete_documentos d
      WHERE d.cotacao_id = c.id
        AND UPPER(REGEXP_REPLACE(COALESCE(d.tipo_documento, ''), '[^A-Za-z]', '', 'g')) = 'CTE'
        AND COALESCE(NULLIF(TRIM(d.numero_documento), ''), NULLIF(TRIM(d.chave_documento), '')) IS NOT NULL
    ) THEN 'em_transito'
    ELSE 'aguardando_cte'
  END,
  COALESCE(c.status_aprovacao, 'rascunho'),
  c.criado_por_id,
  c.criado_por_login,
  c.atualizado_por_id,
  c.atualizado_por_login,
  TO_JSONB(c),
  COALESCE(c.criado_em, NOW()),
  COALESCE(c.atualizado_em, NOW())
FROM cadastro_cotacao_frete c
ON CONFLICT (legado_id) DO NOTHING;

SELECT SETVAL(
  PG_GET_SERIAL_SEQUENCE('cargas_v2', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM cargas_v2), 1), 1),
  EXISTS (SELECT 1 FROM cargas_v2)
);

-- Linhas que compartilhavam numero passam a compor uma unica viagem.
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
      SELECT 1 FROM cadastro_cotacao_frete l
      JOIN cadastro_cotacao_frete_documentos d ON d.cotacao_id = l.id
      WHERE LOWER(TRIM(l.numero_viagem)) = LOWER(TRIM(c.numero_viagem))
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
ORDER BY LOWER(TRIM(c.numero_viagem)), c.atualizado_em DESC NULLS LAST, c.id DESC
ON CONFLICT (numero_viagem) DO NOTHING;

INSERT INTO viagem_cargas_v2 (viagem_id, carga_id)
SELECT v.id, nc.id
FROM cadastro_cotacao_frete c
JOIN cargas_v2 nc ON nc.legado_id = c.id
JOIN viagens_v2 v ON LOWER(TRIM(v.numero_viagem)) = LOWER(TRIM(c.numero_viagem))
WHERE NULLIF(TRIM(c.numero_viagem), '') IS NOT NULL
ON CONFLICT (carga_id) DO NOTHING;

INSERT INTO carga_rotas_v2 (
  carga_id, legado_id, ordem, tipo_parada, cidade, uf, cliente, endereco,
  numero_nota_fiscal, observacoes, criado_em, atualizado_em
)
SELECT
  nc.id, r.id, r.ordem, r.tipo_parada, r.cidade, r.uf, r.cliente, r.endereco,
  r.numero_nota_fiscal, r.observacoes, r.criado_em, r.atualizado_em
FROM cadastro_cotacao_frete_rotas r
JOIN cargas_v2 nc ON nc.legado_id = r.cotacao_id
ON CONFLICT (legado_id) DO NOTHING;

INSERT INTO carga_documentos_v2 (
  carga_id, legado_id, tipo_documento, numero_documento, chave_documento,
  link_documento, observacoes, criado_por_id, criado_por_login,
  atualizado_por_id, atualizado_por_login, criado_em, atualizado_em
)
SELECT
  nc.id, d.id, d.tipo_documento, d.numero_documento, d.chave_documento,
  d.link_documento, d.observacoes, d.criado_por_id, d.criado_por_login,
  d.atualizado_por_id, d.atualizado_por_login, d.criado_em, d.atualizado_em
FROM cadastro_cotacao_frete_documentos d
JOIN cargas_v2 nc ON nc.legado_id = d.cotacao_id
ON CONFLICT (legado_id) DO NOTHING;

SELECT SETVAL(
  PG_GET_SERIAL_SEQUENCE('carga_rotas_v2', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM carga_rotas_v2), 1), 1),
  EXISTS (SELECT 1 FROM carga_rotas_v2)
);
SELECT SETVAL(
  PG_GET_SERIAL_SEQUENCE('carga_documentos_v2', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM carga_documentos_v2), 1), 1),
  EXISTS (SELECT 1 FROM carga_documentos_v2)
);
