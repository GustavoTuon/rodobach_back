ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS pneu_vinculado JSONB;
COMMENT ON COLUMN manutencao_plantao.pneu_vinculado IS 'Identidade e posição do pneu no momento do vínculo da despesa; não movimenta o pneu.';
