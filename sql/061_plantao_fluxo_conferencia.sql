ALTER TABLE manutencao_plantao ADD COLUMN hora_despesa TIME;
ALTER TABLE manutencao_plantao ADD COLUMN perfil_autor TEXT CHECK (perfil_autor IN ('motorista','colaborador'));
ALTER TABLE manutencao_plantao ADD COLUMN justificativa_sem_nota TEXT NOT NULL DEFAULT '';
