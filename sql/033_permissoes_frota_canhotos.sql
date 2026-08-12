ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_manutencao_posicoes BOOLEAN,
  ADD COLUMN IF NOT EXISTS perm_controle_canhotos BOOLEAN;

-- Preserva exatamente os acessos anteriores, que eram herdados destas telas.
UPDATE usuarios
SET perm_manutencao_posicoes = COALESCE(perm_manutencao_posicoes, perm_manutencao, TRUE),
    perm_controle_canhotos = COALESCE(perm_controle_canhotos, perm_consulta_nfe, perm_viagens, TRUE);

ALTER TABLE usuarios
  ALTER COLUMN perm_manutencao_posicoes SET DEFAULT TRUE,
  ALTER COLUMN perm_manutencao_posicoes SET NOT NULL,
  ALTER COLUMN perm_controle_canhotos SET DEFAULT TRUE,
  ALTER COLUMN perm_controle_canhotos SET NOT NULL;
