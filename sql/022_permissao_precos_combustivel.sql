ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_precos_combustivel BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_precos_combustivel SET DEFAULT TRUE;

UPDATE usuarios
SET perm_precos_combustivel = TRUE
WHERE perm_precos_combustivel IS DISTINCT FROM TRUE;
