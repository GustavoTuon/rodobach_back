ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS km_proximo_envio INTEGER NOT NULL DEFAULT 0;

-- Recalcula para registros existentes
UPDATE automacao_mensagem_manutencao
  SET km_proximo_envio = km_atual + intervalo_km
  WHERE km_proximo_envio = 0;
