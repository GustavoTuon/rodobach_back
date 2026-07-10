-- Permissao independente para a tela de Analise de Abastecimentos.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_abastecimentos BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_abastecimentos SET DEFAULT TRUE;

-- Preserva o acesso atual dos usuarios existentes.
UPDATE usuarios
SET perm_abastecimentos = TRUE
WHERE perm_abastecimentos IS DISTINCT FROM TRUE;
