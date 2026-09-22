CREATE TABLE IF NOT EXISTS painel_carga_confirmacoes (
  id bigserial PRIMARY KEY,
  placa varchar(7) NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('carregado', 'vazio')),
  confirmado_em timestamptz NOT NULL,
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 5 AND 500),
  contexto text NOT NULL,
  usuario_id integer NOT NULL,
  usuario_nome text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  cancelado_em timestamptz,
  cancelado_por integer
);
CREATE INDEX IF NOT EXISTS painel_carga_confirmacoes_placa_id
  ON painel_carga_confirmacoes (placa, id DESC);
