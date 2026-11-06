-- Notes initially granted access to everyone. Start individual grants from off.
-- Administrators retain access through the existing administrator permission rule.
ALTER TABLE usuarios ALTER COLUMN perm_bloco_notas SET DEFAULT false;
UPDATE usuarios SET perm_bloco_notas=false
WHERE admin IS NOT TRUE AND perm_bloco_notas=true;
