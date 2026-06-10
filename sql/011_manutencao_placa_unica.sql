-- Converte placas (array) → placa (singular, um registro por veículo); seguro de re-executar
ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS placa VARCHAR(20) NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'automacao_mensagem_manutencao'
      AND column_name  = 'placas'
  ) THEN
    UPDATE automacao_mensagem_manutencao
      SET placa = placas[1]
      WHERE placas IS NOT NULL AND array_length(placas, 1) > 0 AND placa = '';

    ALTER TABLE automacao_mensagem_manutencao DROP COLUMN placas;
  END IF;
END $$;
