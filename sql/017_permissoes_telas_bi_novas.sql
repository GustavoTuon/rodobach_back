-- Permissoes para telas novas do BI/direcao.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_faturamento_diario BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_comparativo_faturamento BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_lucro_viagens BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_faturamento_diario SET DEFAULT TRUE,
  ALTER COLUMN perm_comparativo_faturamento SET DEFAULT TRUE,
  ALTER COLUMN perm_lucro_viagens SET DEFAULT TRUE;

UPDATE usuarios
SET
  perm_faturamento_diario = TRUE,
  perm_comparativo_faturamento = TRUE,
  perm_lucro_viagens = TRUE
WHERE perm_faturamento_diario IS DISTINCT FROM TRUE
   OR perm_comparativo_faturamento IS DISTINCT FROM TRUE
   OR perm_lucro_viagens IS DISTINCT FROM TRUE;
