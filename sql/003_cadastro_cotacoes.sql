CREATE TABLE IF NOT EXISTS cadastro_cotacao_frete (
  id SERIAL PRIMARY KEY,
  numero_viagem TEXT,
  placa_veiculo TEXT,
  situacao TEXT NOT NULL DEFAULT 'faltando_dados',
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  cidade_origem TEXT NOT NULL,
  uf_origem CHAR(2) NOT NULL,
  cidade_destino TEXT NOT NULL,
  uf_destino CHAR(2) NOT NULL,
  cliente TEXT NOT NULL,
  cliente_final TEXT,
  valor_cliente NUMERIC(12, 2) NOT NULL DEFAULT 0,
  material TEXT,
  peso_kg NUMERIC(12, 3) NOT NULL DEFAULT 0,
  motorista TEXT,
  valor_motorista NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vendedor TEXT,
  tomador_servico TEXT,
  condicao_pagamento TEXT,
  numero_motorista TEXT,
  cnh_motorista TEXT,
  antt_veiculo TEXT,
  conta_deposito TEXT,
  chave_pix TEXT,
  doc_placas BOOLEAN NOT NULL DEFAULT false,
  doc_antt BOOLEAN NOT NULL DEFAULT false,
  doc_conta_deposito BOOLEAN NOT NULL DEFAULT false,
  doc_chave_pix BOOLEAN NOT NULL DEFAULT false,
  doc_cnh_motorista BOOLEAN NOT NULL DEFAULT false,
  doc_consulta_motorista BOOLEAN NOT NULL DEFAULT false,
  doc_comprovante_residencia BOOLEAN NOT NULL DEFAULT false,
  doc_numero_motorista BOOLEAN NOT NULL DEFAULT false,
  valor_kg NUMERIC(12, 4) GENERATED ALWAYS AS (
    CASE WHEN peso_kg > 0 THEN valor_cliente / peso_kg ELSE 0 END
  ) STORED,
  valor_ton NUMERIC(12, 2) GENERATED ALWAYS AS (
    CASE WHEN peso_kg > 0 THEN valor_cliente / (peso_kg / 1000) ELSE 0 END
  ) STORED,
  rota_maps_url TEXT,
  observacoes TEXT,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadastro_cotacao_busca
  ON cadastro_cotacao_frete (cliente, cidade_origem, cidade_destino, motorista);

ALTER TABLE cadastro_cotacao_frete
  ADD COLUMN IF NOT EXISTS numero_viagem TEXT,
  ADD COLUMN IF NOT EXISTS placa_veiculo TEXT,
  ADD COLUMN IF NOT EXISTS situacao TEXT NOT NULL DEFAULT 'faltando_dados',
  ADD COLUMN IF NOT EXISTS km_viagem NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS tomador_servico TEXT,
  ADD COLUMN IF NOT EXISTS condicao_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS numero_motorista TEXT,
  ADD COLUMN IF NOT EXISTS cnh_motorista TEXT,
  ADD COLUMN IF NOT EXISTS antt_veiculo TEXT,
  ADD COLUMN IF NOT EXISTS conta_deposito TEXT,
  ADD COLUMN IF NOT EXISTS chave_pix TEXT,
  ADD COLUMN IF NOT EXISTS doc_placas BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_antt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_conta_deposito BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_chave_pix BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_cnh_motorista BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_consulta_motorista BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_comprovante_residencia BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_numero_motorista BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rota_maps_url TEXT;

CREATE TABLE IF NOT EXISTS cadastro_cotacao_frete_rotas (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cadastro_cotacao_frete(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 1,
  tipo_parada TEXT NOT NULL DEFAULT 'entrega',
  cidade TEXT,
  uf CHAR(2),
  cliente TEXT,
  endereco TEXT,
  numero_nota_fiscal TEXT,
  observacoes TEXT,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadastro_cotacao_rotas_cotacao
  ON cadastro_cotacao_frete_rotas (cotacao_id, ordem);

ALTER TABLE cadastro_cotacao_frete_rotas
  ADD COLUMN IF NOT EXISTS numero_nota_fiscal TEXT;

CREATE TABLE IF NOT EXISTS cadastro_cotacao_frete_documentos (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cadastro_cotacao_frete(id) ON DELETE CASCADE,
  tipo_documento TEXT NOT NULL DEFAULT 'CT-e',
  numero_documento TEXT,
  chave_documento TEXT,
  link_documento TEXT,
  observacoes TEXT,
  criado_por_id INTEGER,
  criado_por_login TEXT,
  atualizado_por_id INTEGER,
  atualizado_por_login TEXT,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cadastro_cotacao_documentos_cotacao
  ON cadastro_cotacao_frete_documentos (cotacao_id, id);

ALTER TABLE cadastro_cotacao_frete_documentos
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT 'CT-e',
  ADD COLUMN IF NOT EXISTS numero_documento TEXT,
  ADD COLUMN IF NOT EXISTS chave_documento TEXT,
  ADD COLUMN IF NOT EXISTS link_documento TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS criado_por_id INTEGER,
  ADD COLUMN IF NOT EXISTS criado_por_login TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_por_id INTEGER,
  ADD COLUMN IF NOT EXISTS atualizado_por_login TEXT,
  ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
