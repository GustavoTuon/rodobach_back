CREATE TABLE IF NOT EXISTS controle_canhotos (
  id BIGSERIAL PRIMARY KEY,
  empresa SMALLINT NOT NULL,
  serie_cte VARCHAR(20) NOT NULL,
  numero_cte INTEGER NOT NULL,
  sequencia_nota SMALLINT NOT NULL,
  numero_nota INTEGER NOT NULL,
  serie_nota VARCHAR(20) NOT NULL DEFAULT '',
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recebido_por VARCHAR(120) NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT controle_canhotos_documento_uk
    UNIQUE (empresa, serie_cte, numero_cte, sequencia_nota)
);

CREATE INDEX IF NOT EXISTS idx_controle_canhotos_recebido_em
  ON controle_canhotos (recebido_em DESC);
