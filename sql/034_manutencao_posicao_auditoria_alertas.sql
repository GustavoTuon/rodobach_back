ALTER TABLE manutencao_componentes_posicao
  ADD COLUMN IF NOT EXISTS atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancelado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

CREATE INDEX IF NOT EXISTS manutencao_componentes_posicao_ativos_idx
  ON manutencao_componentes_posicao (placa, eixo_codigo, lado, componente, data_servico DESC)
  WHERE cancelado = FALSE;

CREATE TABLE IF NOT EXISTS manutencao_componentes_alertas_enviados (
  id BIGSERIAL PRIMARY KEY,
  registro_id BIGINT NOT NULL REFERENCES manutencao_componentes_posicao(id) ON DELETE CASCADE,
  referencia VARCHAR(80) NOT NULL,
  tipo_alerta VARCHAR(20) NOT NULL CHECK (tipo_alerta IN ('antecipado', 'vencido')),
  numero VARCHAR(32) NOT NULL,
  mensagem TEXT NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manutencao_componente_alerta_unico UNIQUE (registro_id, referencia, tipo_alerta, numero)
);

ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS alertas_componentes BOOLEAN NOT NULL DEFAULT FALSE;
