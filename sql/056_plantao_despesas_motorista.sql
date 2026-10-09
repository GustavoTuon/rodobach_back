ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'colaborador';
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS litros NUMERIC(10,3);
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS hodometro INTEGER;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS local_despesa TEXT NOT NULL DEFAULT '';
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS comprovante_foto TEXT;
