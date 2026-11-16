CREATE TABLE manutencao_os_erp_estado (
  id integer PRIMARY KEY CHECK (id = 1),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  ultima_execucao timestamptz
);
CREATE TABLE manutencao_os_erp (
  chave text PRIMARY KEY,
  estado text NOT NULL CHECK (estado IN ('historico', 'pendente', 'importado')),
  motivo text,
  registros jsonb NOT NULL DEFAULT '[]',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
