CREATE TABLE IF NOT EXISTS movimento_folga_motorista (
  id BIGSERIAL PRIMARY KEY,
  empresa_motorista SMALLINT NOT NULL,
  codigo_motorista INTEGER NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  quantidade NUMERIC(8,2) NOT NULL,
  data_movimento DATE NOT NULL DEFAULT CURRENT_DATE,
  observacoes TEXT,
  criado_por VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movimento_folga_tipo_check CHECK (tipo IN ('uso', 'ajuste')),
  CONSTRAINT movimento_folga_quantidade_check CHECK (
    (tipo = 'uso' AND quantidade > 0) OR tipo = 'ajuste'
  )
);

CREATE INDEX IF NOT EXISTS idx_movimento_folga_motorista
  ON movimento_folga_motorista (empresa_motorista, codigo_motorista, data_movimento DESC);

