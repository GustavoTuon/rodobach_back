CREATE TABLE IF NOT EXISTS oportunidades_retorno_clientes (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cidade TEXT NOT NULL DEFAULT '',
  uf VARCHAR(2) NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  contato TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  tipo_carga TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oportunidades_retorno_clientes_ativo
  ON oportunidades_retorno_clientes (ativo);

CREATE INDEX IF NOT EXISTS idx_oportunidades_retorno_clientes_cidade_uf
  ON oportunidades_retorno_clientes (UPPER(cidade), UPPER(uf));
