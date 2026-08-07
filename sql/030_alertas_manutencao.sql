CREATE TABLE IF NOT EXISTS manutencao_alertas_enviados (
  id BIGSERIAL PRIMARY KEY,
  automacao_id INTEGER NOT NULL REFERENCES automacao_mensagem_manutencao(id) ON DELETE CASCADE,
  referencia VARCHAR(40) NOT NULL,
  tipo_alerta VARCHAR(20) NOT NULL CHECK (tipo_alerta IN ('antecipado', 'vencido')),
  numero VARCHAR(32) NOT NULL,
  mensagem TEXT NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manutencao_alerta_unico UNIQUE (automacao_id, referencia, tipo_alerta, numero)
);

CREATE INDEX IF NOT EXISTS manutencao_alertas_enviados_automacao_idx
  ON manutencao_alertas_enviados (automacao_id, enviado_em DESC);
