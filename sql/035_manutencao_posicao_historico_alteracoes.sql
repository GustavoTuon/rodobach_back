CREATE TABLE IF NOT EXISTS manutencao_componentes_posicao_auditoria (
  id BIGSERIAL PRIMARY KEY,
  registro_id BIGINT NOT NULL REFERENCES manutencao_componentes_posicao(id) ON DELETE CASCADE,
  acao VARCHAR(20) NOT NULL CHECK (acao IN ('edicao', 'cancelamento')),
  dados_anteriores JSONB,
  dados_novos JSONB,
  motivo TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manutencao_componentes_posicao_auditoria_registro_idx
  ON manutencao_componentes_posicao_auditoria (registro_id, criado_em DESC);
