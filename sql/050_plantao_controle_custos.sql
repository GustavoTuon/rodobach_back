ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS data_despesa DATE;
UPDATE manutencao_plantao SET data_despesa = (criado_em AT TIME ZONE 'America/Sao_Paulo')::date WHERE data_despesa IS NULL;
ALTER TABLE manutencao_plantao ALTER COLUMN data_despesa SET DEFAULT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date);
ALTER TABLE manutencao_plantao ALTER COLUMN data_despesa SET NOT NULL;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS documento TEXT NOT NULL DEFAULT '';
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS revisao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS excluido_por TEXT;
ALTER TABLE manutencao_plantao ADD COLUMN IF NOT EXISTS motivo_exclusao TEXT;
CREATE TABLE IF NOT EXISTS manutencao_plantao_historico (
  id BIGSERIAL PRIMARY KEY,
  lancamento_id UUID NOT NULL REFERENCES manutencao_plantao(id),
  evento TEXT NOT NULL,
  usuario_id INTEGER NOT NULL,
  usuario_login TEXT NOT NULL,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  antes JSONB,
  depois JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS plantao_historico_lancamento_idx ON manutencao_plantao_historico (lancamento_id, ocorrido_em);
CREATE INDEX IF NOT EXISTS plantao_despesa_ativa_idx ON manutencao_plantao (placa, data_despesa) WHERE excluido_em IS NULL;
