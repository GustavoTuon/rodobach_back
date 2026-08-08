CREATE TABLE IF NOT EXISTS alertas_veiculos_vazios (
  placa VARCHAR(10) PRIMARY KEY,
  vazio_desde TIMESTAMPTZ,
  parado_desde TIMESTAMPTZ,
  ultima_verificacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_alerta_em TIMESTAMPTZ,
  total_alertas INTEGER NOT NULL DEFAULT 0,
  situacao VARCHAR(30) NOT NULL DEFAULT 'monitorando',
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb
);
