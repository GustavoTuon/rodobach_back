ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_status_carga BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perm_automacoes_n8n BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE usuarios
  ALTER COLUMN perm_status_carga SET DEFAULT TRUE,
  ALTER COLUMN perm_automacoes_n8n SET DEFAULT TRUE;

UPDATE usuarios
SET
  perm_status_carga = TRUE,
  perm_automacoes_n8n = TRUE
WHERE perm_status_carga IS DISTINCT FROM TRUE
   OR perm_automacoes_n8n IS DISTINCT FROM TRUE;
