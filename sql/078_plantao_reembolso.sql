ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS reembolso JSONB;
-- Existing confirmations remain recorded. Future payments do not confirm expenses.
