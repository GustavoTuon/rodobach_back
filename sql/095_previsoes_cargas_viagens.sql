ALTER TABLE cargas_v2 ADD COLUMN IF NOT EXISTS acompanhamento JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE viagens_v2 ADD COLUMN IF NOT EXISTS acompanhamento JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS cargas_v2_previsao_idx ON cargas_v2 ((acompanhamento->>'previsao')) WHERE status IN ('aguardando_viagem','aguardando_cte');
CREATE INDEX IF NOT EXISTS viagens_v2_previsao_idx ON viagens_v2 ((acompanhamento->>'previsao')) WHERE situacao NOT IN ('entregue','cancelado');
