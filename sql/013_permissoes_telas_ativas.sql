-- Ajuste de permissoes das telas ativas.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_diretoria BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_analise_frota BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_custos_veiculos BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_manutencoes_veiculos BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_clientes_lucro BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_diretoria SET DEFAULT TRUE,
  ALTER COLUMN perm_dre_empresarial SET DEFAULT TRUE,
  ALTER COLUMN perm_analise_frota SET DEFAULT TRUE,
  ALTER COLUMN perm_custos_veiculos SET DEFAULT TRUE,
  ALTER COLUMN perm_manutencoes_veiculos SET DEFAULT TRUE,
  ALTER COLUMN perm_clientes_lucro SET DEFAULT TRUE;

UPDATE usuarios
SET
  perm_diretoria = TRUE,
  perm_dre_empresarial = TRUE,
  perm_analise_frota = TRUE,
  perm_custos_veiculos = TRUE,
  perm_manutencoes_veiculos = TRUE,
  perm_clientes_lucro = TRUE
WHERE perm_diretoria IS DISTINCT FROM TRUE
   OR perm_dre_empresarial IS DISTINCT FROM TRUE
   OR perm_analise_frota IS DISTINCT FROM TRUE
   OR perm_custos_veiculos IS DISTINCT FROM TRUE
   OR perm_manutencoes_veiculos IS DISTINCT FROM TRUE
   OR perm_clientes_lucro IS DISTINCT FROM TRUE;
