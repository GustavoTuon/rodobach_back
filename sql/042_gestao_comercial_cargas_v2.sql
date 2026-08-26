-- Camada gerencial do modulo paralelo de Cargas e Viagens.
-- Nao altera lancamentos financeiros nem tabelas legadas do ERP.

ALTER TABLE cargas_v2
  ADD COLUMN IF NOT EXISTS km_estimado NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS dias_estimados NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pedagio_estimado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_extra_estimado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_estimado NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS preco_minimo_calculado NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS preco_sugerido_calculado NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS margem_estimada NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS calculo_preco JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE viagens_v2
  ADD COLUMN IF NOT EXISTS previsao_entrega TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_entrega TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS parametros_custos_v2 (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  preco_combustivel NUMERIC(10, 3) NOT NULL DEFAULT 6.10,
  consumo_km_litro NUMERIC(10, 3) NOT NULL DEFAULT 2.50,
  manutencao_por_km NUMERIC(10, 3) NOT NULL DEFAULT 0.45,
  pneus_por_km NUMERIC(10, 3) NOT NULL DEFAULT 0.18,
  custo_fixo_por_dia NUMERIC(14, 2) NOT NULL DEFAULT 450,
  impostos_percentual NUMERIC(8, 3) NOT NULL DEFAULT 8,
  margem_alvo_percentual NUMERIC(8, 3) NOT NULL DEFAULT 15,
  km_vazio_percentual NUMERIC(8, 3) NOT NULL DEFAULT 15,
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO parametros_custos_v2 (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS oportunidades_retorno_v2 (
  id BIGSERIAL PRIMARY KEY,
  viagem_id BIGINT NOT NULL UNIQUE REFERENCES viagens_v2(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'sem_acao',
  previsao_entrega TIMESTAMPTZ,
  responsavel TEXT,
  raio_km NUMERIC(10, 2) NOT NULL DEFAULT 200,
  receita_minima NUMERIC(14, 2),
  observacoes TEXT,
  ultima_acao_em TIMESTAMPTZ,
  criado_por_id INTEGER,
  criado_por_login VARCHAR(120),
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oportunidades_retorno_v2_status_idx
  ON oportunidades_retorno_v2 (status, previsao_entrega);

CREATE TABLE IF NOT EXISTS oportunidades_retorno_contatos_v2 (
  id BIGSERIAL PRIMARY KEY,
  oportunidade_id BIGINT NOT NULL REFERENCES oportunidades_retorno_v2(id) ON DELETE CASCADE,
  cliente TEXT NOT NULL,
  cidade TEXT,
  uf CHAR(2),
  contato TEXT,
  telefone TEXT,
  origem_dado VARCHAR(30) NOT NULL DEFAULT 'historico',
  status VARCHAR(24) NOT NULL DEFAULT 'sugerido',
  valor_cotado NUMERIC(14, 2),
  motivo_perda TEXT,
  observacoes TEXT,
  contatado_em TIMESTAMPTZ,
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (oportunidade_id, cliente, cidade, uf)
);

CREATE INDEX IF NOT EXISTS oportunidades_retorno_contatos_v2_status_idx
  ON oportunidades_retorno_contatos_v2 (oportunidade_id, status);

CREATE TABLE IF NOT EXISTS ciclos_operacionais_v2 (
  id BIGSERIAL PRIMARY KEY,
  viagem_ida_id BIGINT NOT NULL UNIQUE REFERENCES viagens_v2(id) ON DELETE CASCADE,
  viagem_retorno_id BIGINT UNIQUE REFERENCES viagens_v2(id) ON DELETE SET NULL,
  km_vazio NUMERIC(14, 2) NOT NULL DEFAULT 0,
  pedagio_adicional NUMERIC(14, 2) NOT NULL DEFAULT 0,
  custo_extra NUMERIC(14, 2) NOT NULL DEFAULT 0,
  dias_ciclo NUMERIC(10, 2),
  observacoes TEXT,
  criado_por_id INTEGER,
  criado_por_login VARCHAR(120),
  atualizado_por_id INTEGER,
  atualizado_por_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ciclos_operacionais_v2_retorno_idx
  ON ciclos_operacionais_v2 (viagem_retorno_id);
