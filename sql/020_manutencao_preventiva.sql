-- Avisos preventivos por quilometragem, sem confirmacao manual da manutencao.
ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS antecedencia_km INTEGER NOT NULL DEFAULT 1000 CHECK (antecedencia_km >= 0),
  ADD COLUMN IF NOT EXISTS km_manutencao_prevista INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS km_proximo_aviso INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_envio_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_envio_km INTEGER,
  ADD COLUMN IF NOT EXISTS ultimo_envio_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS ultimo_envio_erro TEXT;

-- Preserva o ciclo existente: o antigo proximo envio representava o KM da manutencao.
UPDATE automacao_mensagem_manutencao
SET km_manutencao_prevista = CASE
      WHEN km_manutencao_prevista <= 0 THEN km_proximo_envio
      ELSE km_manutencao_prevista
    END,
    km_proximo_aviso = CASE
      WHEN km_proximo_aviso <= 0 THEN GREATEST(0, km_proximo_envio - antecedencia_km)
      ELSE km_proximo_aviso
    END;

CREATE INDEX IF NOT EXISTS automacao_manutencao_aviso_idx
  ON automacao_mensagem_manutencao (ativo, km_proximo_aviso);
