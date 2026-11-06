CREATE TABLE IF NOT EXISTS manutencao_n8n_integracao (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL,
  destinatario TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
