ALTER TABLE compras_cotacoes ADD COLUMN origem_chave text UNIQUE;
ALTER TABLE compras_cotacoes ADD COLUMN origem_dados jsonb;
ALTER TABLE compras_cotacoes ADD COLUMN importado_em timestamptz;
CREATE INDEX compras_cotacoes_criado_idx ON compras_cotacoes(criado_em DESC);
