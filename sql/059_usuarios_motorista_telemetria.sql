ALTER TABLE usuarios ADD COLUMN perfil_despesas TEXT NOT NULL DEFAULT 'colaborador';
ALTER TABLE usuarios ADD COLUMN telemetria_motorista_id TEXT;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_despesas_check CHECK (
  (perfil_despesas='colaborador' AND telemetria_motorista_id IS NULL)
  OR (perfil_despesas='motorista' AND telemetria_motorista_id ~ '^[1-9][0-9]{0,18}$'
    AND telemetria_motorista_id IS NOT NULL AND admin IS FALSE AND perm_conferencia_manutencao IS FALSE)
);
CREATE UNIQUE INDEX usuarios_motorista_telemetria_unique ON usuarios(telemetria_motorista_id)
  WHERE telemetria_motorista_id IS NOT NULL;
