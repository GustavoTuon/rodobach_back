ALTER TABLE manutencao_plantao
  ADD COLUMN IF NOT EXISTS tipo_documento text,
  ADD COLUMN IF NOT EXISTS numero_fogo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS viagem_despesa jsonb;
