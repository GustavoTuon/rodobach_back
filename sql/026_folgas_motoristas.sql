CREATE TABLE IF NOT EXISTS jornada_motorista (
  id BIGSERIAL PRIMARY KEY,
  empresa_motorista SMALLINT NOT NULL,
  codigo_motorista INTEGER NOT NULL,
  saida_em TIMESTAMPTZ NOT NULL,
  retorno_previsto_em TIMESTAMPTZ,
  retorno_em TIMESTAMPTZ,
  origem_saida VARCHAR(20) NOT NULL DEFAULT 'manual',
  origem_retorno VARCHAR(20),
  observacoes TEXT,
  criado_por VARCHAR(120),
  atualizado_por VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jornada_motorista_datas_check
    CHECK (retorno_em IS NULL OR retorno_em >= saida_em)
);

CREATE INDEX IF NOT EXISTS idx_jornada_motorista_motorista
  ON jornada_motorista (empresa_motorista, codigo_motorista, saida_em DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jornada_motorista_aberta
  ON jornada_motorista (empresa_motorista, codigo_motorista)
  WHERE retorno_em IS NULL;

