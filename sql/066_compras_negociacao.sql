ALTER TABLE compras_convites ADD COLUMN descontos jsonb NOT NULL DEFAULT '{}'::jsonb;
