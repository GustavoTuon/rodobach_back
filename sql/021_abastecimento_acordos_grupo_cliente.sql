ALTER TABLE abastecimento_acordos
  ADD COLUMN IF NOT EXISTS grupo_cliente_codigo INTEGER,
  ADD COLUMN IF NOT EXISTS origem_importacao TEXT;

UPDATE abastecimento_acordos
SET grupo_cliente = 'Geral'
WHERE NULLIF(TRIM(grupo_cliente), '') IS NULL;

CREATE INDEX IF NOT EXISTS idx_abastecimento_acordos_grupo
  ON abastecimento_acordos (grupo_cliente_codigo);
