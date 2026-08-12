ALTER TABLE manutencao_componentes_posicao
  ADD COLUMN IF NOT EXISTS grupo_id TEXT,
  ADD COLUMN IF NOT EXISTS condicao TEXT CHECK (condicao IS NULL OR condicao IN ('BOM', 'ATENCAO', 'CRITICO')),
  ADD COLUMN IF NOT EXISTS motivo TEXT;

CREATE INDEX IF NOT EXISTS manutencao_componentes_posicao_grupo_idx
  ON manutencao_componentes_posicao (grupo_id)
  WHERE grupo_id IS NOT NULL;
