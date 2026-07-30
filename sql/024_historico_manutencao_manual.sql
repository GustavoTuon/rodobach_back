CREATE TABLE IF NOT EXISTS historico_manutencao_veiculo (
  id BIGSERIAL PRIMARY KEY,
  automacao_id INTEGER REFERENCES automacao_mensagem_manutencao(id) ON DELETE SET NULL,
  placa VARCHAR(20) NOT NULL,
  tipo_movimento VARCHAR(40) NOT NULL,
  descricao VARCHAR(255) NOT NULL,
  data_servico DATE NOT NULL,
  km_servico INTEGER NOT NULL CHECK (km_servico >= 0),
  fornecedor VARCHAR(255),
  documento VARCHAR(100),
  observacao TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT historico_manutencao_tipo_check CHECK (
    tipo_movimento IN (
      'troca_oleo_motor',
      'revisao',
      'filtro_combustivel',
      'filtro_ar',
      'oleo_cambio',
      'oleo_diferencial',
      'lubrificacao',
      'outro'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_historico_manutencao_placa_km
  ON historico_manutencao_veiculo (placa, km_servico DESC);

CREATE INDEX IF NOT EXISTS idx_historico_manutencao_automacao
  ON historico_manutencao_veiculo (automacao_id, data_servico DESC);
