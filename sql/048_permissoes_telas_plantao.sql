ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_painel_tv BOOLEAN;
UPDATE usuarios SET perm_painel_tv = COALESCE(perm_status_carga, FALSE) WHERE perm_painel_tv IS NULL;
ALTER TABLE usuarios ALTER COLUMN perm_painel_tv SET DEFAULT FALSE;
ALTER TABLE usuarios ALTER COLUMN perm_painel_tv SET NOT NULL;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_manutencao_plantao BOOLEAN;
UPDATE usuarios SET perm_manutencao_plantao = FALSE WHERE perm_manutencao_plantao IS NULL;
ALTER TABLE usuarios ALTER COLUMN perm_manutencao_plantao SET DEFAULT FALSE;
ALTER TABLE usuarios ALTER COLUMN perm_manutencao_plantao SET NOT NULL;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_conferencia_manutencao BOOLEAN;
UPDATE usuarios SET perm_conferencia_manutencao = FALSE WHERE perm_conferencia_manutencao IS NULL;
ALTER TABLE usuarios ALTER COLUMN perm_conferencia_manutencao SET DEFAULT FALSE;
ALTER TABLE usuarios ALTER COLUMN perm_conferencia_manutencao SET NOT NULL;

CREATE TABLE IF NOT EXISTS manutencao_plantao (
  id UUID PRIMARY KEY,
  placa TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0 AND valor <= 999999.99),
  servico TEXT NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  fornecedor TEXT NOT NULL DEFAULT '',
  fornecedor_codigo TEXT,
  fornecedor_empresa TEXT,
  usuario_id INTEGER NOT NULL,
  usuario_login TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conferido_por INTEGER,
  conferido_login TEXT,
  conferido_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS manutencao_plantao_usuario_idx ON manutencao_plantao (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS manutencao_plantao_placa_idx ON manutencao_plantao (placa, criado_em DESC);
