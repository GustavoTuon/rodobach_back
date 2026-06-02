CREATE TABLE IF NOT EXISTS parametro_diaria_motorista (
  id SERIAL PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  horario_referencia TIME,
  horas_rodadas_referencia NUMERIC(6, 2),
  valor NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO parametro_diaria_motorista (
  codigo,
  descricao,
  horario_referencia,
  horas_rodadas_referencia,
  valor,
  ativo,
  ordem
) VALUES
  ('cafe', 'Café', '08:00', NULL, 19.27, true, 1),
  ('almoco', 'Almoço', '12:00', NULL, 38.54, true, 2),
  ('janta', 'Janta', '21:00', 11, 28.90, true, 3)
ON CONFLICT (codigo) DO NOTHING;
