ALTER TABLE manutencao_plantao ALTER COLUMN hodometro TYPE NUMERIC(10,1);
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS painel_foto TEXT;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS bomba_foto TEXT;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS valor_combustivel NUMERIC(12,2);
