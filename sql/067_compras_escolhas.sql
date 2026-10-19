ALTER TABLE compras_cotacoes ADD COLUMN escolhas jsonb NOT NULL DEFAULT '{}'::jsonb;
