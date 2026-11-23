ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS documentos_erp JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE manutencao_plantao ALTER COLUMN documento_erp TYPE TEXT;
