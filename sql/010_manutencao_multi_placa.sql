-- Converte placa (singular) → placas (array); seguro de re-executar
ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS placas TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name   = 'automacao_mensagem_manutencao'
      AND column_name  = 'placa'
  ) THEN
    UPDATE automacao_mensagem_manutencao
      SET placas = ARRAY[placa]
      WHERE array_length(placas, 1) IS NULL AND placa IS NOT NULL AND placa <> '';

    ALTER TABLE automacao_mensagem_manutencao DROP COLUMN placa;
  END IF;
END $$;
