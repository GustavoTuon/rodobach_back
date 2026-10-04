CREATE TABLE IF NOT EXISTS hodometro_diario (
  placa text NOT NULL,
  dia date NOT NULL,
  fonte text NOT NULL DEFAULT 'telemetria',
  odometro_inicial numeric,
  odometro_final numeric,
  leitura_inicial timestamptz,
  leitura_final timestamptz,
  km numeric,
  status text NOT NULL,
  motivo text,
  amostras integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (placa,dia,fonte),
  CHECK (km IS NULL OR km >= 0)
);
CREATE INDEX IF NOT EXISTS hodometro_diario_dia_idx ON hodometro_diario(dia);
