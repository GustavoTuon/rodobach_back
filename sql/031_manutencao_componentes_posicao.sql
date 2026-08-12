CREATE TABLE IF NOT EXISTS manutencao_componentes_posicao (
  id BIGSERIAL PRIMARY KEY,
  placa TEXT NOT NULL,
  conjunto_placa TEXT,
  layout_tipo TEXT NOT NULL,
  eixo_codigo TEXT NOT NULL,
  lado TEXT NOT NULL CHECK (lado IN ('E', 'D', 'CENTRO', 'GERAL')),
  componente TEXT NOT NULL,
  tipo_servico TEXT NOT NULL,
  data_servico DATE NOT NULL,
  km_servico INTEGER CHECK (km_servico IS NULL OR km_servico >= 0),
  proximo_km INTEGER CHECK (proximo_km IS NULL OR proximo_km >= 0),
  proxima_data DATE,
  marca TEXT,
  fornecedor TEXT,
  valor NUMERIC(14,2) CHECK (valor IS NULL OR valor >= 0),
  observacao TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manutencao_componentes_posicao_placa_idx
  ON manutencao_componentes_posicao (placa, data_servico DESC, id DESC);

CREATE INDEX IF NOT EXISTS manutencao_componentes_posicao_local_idx
  ON manutencao_componentes_posicao (placa, eixo_codigo, lado, componente, data_servico DESC);
