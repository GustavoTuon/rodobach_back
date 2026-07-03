-- Permissoes do menu atual e remocao de telas descontinuadas.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_diretoria BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_analise_frota BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_manutencoes_veiculos BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_diretoria SET DEFAULT TRUE,
  ALTER COLUMN perm_analise_frota SET DEFAULT TRUE,
  ALTER COLUMN perm_manutencoes_veiculos SET DEFAULT TRUE,
  ALTER COLUMN perm_dre_empresarial SET DEFAULT TRUE,
  ALTER COLUMN perm_custos_veiculos SET DEFAULT TRUE,
  ALTER COLUMN perm_clientes SET DEFAULT TRUE,
  ALTER COLUMN perm_clientes_lucro SET DEFAULT TRUE,
  ALTER COLUMN perm_pneus SET DEFAULT TRUE,
  ALTER COLUMN perm_manutencao SET DEFAULT TRUE,
  ALTER COLUMN perm_settings SET DEFAULT TRUE;

UPDATE usuarios
SET
  perm_diretoria = TRUE,
  perm_analise_frota = TRUE,
  perm_manutencoes_veiculos = TRUE
WHERE perm_diretoria IS DISTINCT FROM TRUE
   OR perm_analise_frota IS DISTINCT FROM TRUE
   OR perm_manutencoes_veiculos IS DISTINCT FROM TRUE;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS perm_diarias,
  DROP COLUMN IF EXISTS perm_custos,
  DROP COLUMN IF EXISTS perm_receita,
  DROP COLUMN IF EXISTS perm_demonstrativo,
  DROP COLUMN IF EXISTS perm_placa,
  DROP COLUMN IF EXISTS perm_dashboard,
  DROP COLUMN IF EXISTS perm_vehicles,
  DROP COLUMN IF EXISTS perm_alerts,
  DROP COLUMN IF EXISTS perm_reports,
  DROP COLUMN IF EXISTS perm_map,
  DROP COLUMN IF EXISTS perm_integration;
