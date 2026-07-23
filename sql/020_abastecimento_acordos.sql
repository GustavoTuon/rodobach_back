CREATE TABLE IF NOT EXISTS abastecimento_acordos (
  id SERIAL PRIMARY KEY,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  posto_codigo TEXT NOT NULL,
  posto_nome TEXT,
  cidade TEXT,
  uf TEXT,
  grupo_cliente TEXT NOT NULL DEFAULT 'Geral',
  produto_codigo TEXT,
  produto_nome TEXT,
  valor_maximo NUMERIC(12,4) NOT NULL,
  tolerancia NUMERIC(12,4) NOT NULL DEFAULT 0,
  vigencia_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim DATE,
  contato_nome TEXT,
  contato_telefone TEXT,
  link_whatsapp TEXT,
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abastecimento_acordos_posto
  ON abastecimento_acordos (posto_codigo);

CREATE INDEX IF NOT EXISTS idx_abastecimento_acordos_ativo_vigencia
  ON abastecimento_acordos (ativo, vigencia_inicio, vigencia_fim);
