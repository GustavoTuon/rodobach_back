ALTER TABLE painel_carga_confirmacoes ALTER COLUMN expira_em DROP NOT NULL;
ALTER TABLE painel_carga_confirmacoes ADD COLUMN IF NOT EXISTS documentos_referencia jsonb;
ALTER TABLE painel_carga_confirmacoes ADD COLUMN IF NOT EXISTS novo_documento_em timestamptz;
