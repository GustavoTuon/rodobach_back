CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  login       VARCHAR(100) NOT NULL UNIQUE,
  senha       TEXT NOT NULL,
  email       VARCHAR(255),
  numero      VARCHAR(20),

  -- Permissoes de telas ativas
  perm_diretoria        BOOLEAN NOT NULL DEFAULT TRUE,
  perm_simulador        BOOLEAN NOT NULL DEFAULT TRUE,
  perm_viagens          BOOLEAN NOT NULL DEFAULT TRUE,
  perm_dre_empresarial  BOOLEAN NOT NULL DEFAULT TRUE,
  perm_analise_frota    BOOLEAN NOT NULL DEFAULT TRUE,
  perm_custos_veiculos  BOOLEAN NOT NULL DEFAULT TRUE,
  perm_manutencoes_veiculos BOOLEAN NOT NULL DEFAULT TRUE,
  perm_clientes         BOOLEAN NOT NULL DEFAULT TRUE,
  perm_clientes_lucro   BOOLEAN NOT NULL DEFAULT TRUE,
  perm_pneus            BOOLEAN NOT NULL DEFAULT TRUE,
  perm_settings         BOOLEAN NOT NULL DEFAULT TRUE,
  perm_manutencao       BOOLEAN NOT NULL DEFAULT TRUE,

  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
