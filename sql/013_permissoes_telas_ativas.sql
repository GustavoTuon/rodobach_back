-- Ajuste de permissoes das telas ativas.
-- DRE e Diarias foram removidas do menu. DRE Empresarial permanece ativa.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_custos_veiculos BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_clientes_lucro BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_diarias SET DEFAULT FALSE,
  ALTER COLUMN perm_demonstrativo SET DEFAULT FALSE,
  ALTER COLUMN perm_dre_empresarial SET DEFAULT TRUE;

UPDATE usuarios
SET
  perm_diarias = FALSE,
  perm_demonstrativo = FALSE,
  perm_dre_empresarial = TRUE
WHERE perm_diarias IS DISTINCT FROM FALSE
   OR perm_demonstrativo IS DISTINCT FROM FALSE
   OR perm_dre_empresarial IS DISTINCT FROM TRUE;
