ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_ociosidade_frota BOOLEAN;
UPDATE usuarios SET perm_ociosidade_frota = COALESCE(perm_status_carga, perm_viagens, false)
WHERE perm_ociosidade_frota IS NULL;
ALTER TABLE usuarios ALTER COLUMN perm_ociosidade_frota SET DEFAULT false;
ALTER TABLE usuarios ALTER COLUMN perm_ociosidade_frota SET NOT NULL;
