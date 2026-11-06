ALTER TABLE controle_multas_frota
  ADD COLUMN IF NOT EXISTS descontado_motorista BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS descontado_em DATE,
  ADD COLUMN IF NOT EXISTS prazo_indicacao DATE;
