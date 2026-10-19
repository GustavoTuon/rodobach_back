ALTER TABLE compras_cotacoes DROP CONSTRAINT compras_cotacoes_status_check;
ALTER TABLE compras_cotacoes ADD CONSTRAINT compras_cotacoes_status_check CHECK(status IN ('aberta','encerrada','cancelada'));
