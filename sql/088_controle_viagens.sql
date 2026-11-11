CREATE TABLE IF NOT EXISTS controle_viagens_norte (
  id BIGSERIAL PRIMARY KEY,
  dados JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  erp_empresa INTEGER,
  erp_numero INTEGER,
  criado_por INTEGER NOT NULL,
  atualizado_por INTEGER NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (erp_empresa, erp_numero)
);
CREATE TABLE IF NOT EXISTS controle_viagens_norte_historico (
  id BIGSERIAL PRIMARY KEY,
  viagem_id BIGINT NOT NULL REFERENCES controle_viagens_norte(id),
  revisao INTEGER NOT NULL,
  dados JSONB NOT NULL,
  usuario_id INTEGER NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (viagem_id, revisao)
);
CREATE TABLE IF NOT EXISTS controle_viagens_norte_vinculos (
  vinculo TEXT PRIMARY KEY,
  viagem_id BIGINT NOT NULL REFERENCES controle_viagens_norte(id),
  tipo TEXT NOT NULL
);
