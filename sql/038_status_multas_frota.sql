ALTER TABLE controle_multas_frota
  ADD COLUMN IF NOT EXISTS status_motorista VARCHAR(24) NOT NULL DEFAULT 'em_aberto',
  ADD COLUMN IF NOT EXISTS status_multa VARCHAR(24) NOT NULL DEFAULT 'desconto_20';

ALTER TABLE controle_multas_frota
  DROP CONSTRAINT IF EXISTS controle_multas_frota_status_motorista_check,
  ADD CONSTRAINT controle_multas_frota_status_motorista_check
    CHECK (status_motorista IN ('empresa','descontado','em_aberto','alerta')),
  DROP CONSTRAINT IF EXISTS controle_multas_frota_status_multa_check,
  ADD CONSTRAINT controle_multas_frota_status_multa_check
    CHECK (status_multa IN ('desconto_20','desconto_40','recorrer','paga'));
