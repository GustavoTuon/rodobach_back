ALTER TABLE manutencao_plantao ADD COLUMN combustivel_tipo TEXT NOT NULL DEFAULT '';
ALTER TABLE manutencao_plantao ADD COLUMN cliente_nota TEXT NOT NULL DEFAULT '';
ALTER TABLE manutencao_plantao ADD COLUMN hodometro_telemetria_em TIMESTAMPTZ;
