CREATE TABLE IF NOT EXISTS usuarios (
  id          SERIAL PRIMARY KEY,
  login       VARCHAR(100) NOT NULL UNIQUE,
  senha       TEXT NOT NULL,
  email       VARCHAR(255),
  numero      VARCHAR(20),

  -- Permissões de telas ativas
  perm_simulador        BOOLEAN NOT NULL DEFAULT TRUE,
  perm_viagens          BOOLEAN NOT NULL DEFAULT TRUE,
  perm_custos_veiculos  BOOLEAN NOT NULL DEFAULT TRUE,
  perm_clientes         BOOLEAN NOT NULL DEFAULT TRUE,
  perm_clientes_lucro   BOOLEAN NOT NULL DEFAULT TRUE,
  perm_pneus            BOOLEAN NOT NULL DEFAULT TRUE,
  perm_settings         BOOLEAN NOT NULL DEFAULT TRUE,
  perm_manutencao       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Permissoes legadas/removidas ficam desativadas por padrao.
  perm_diarias          BOOLEAN NOT NULL DEFAULT FALSE,
  perm_custos           BOOLEAN NOT NULL DEFAULT FALSE,
  perm_receita          BOOLEAN NOT NULL DEFAULT FALSE,
  perm_demonstrativo    BOOLEAN NOT NULL DEFAULT FALSE,
  perm_dre_empresarial  BOOLEAN NOT NULL DEFAULT TRUE,
  perm_placa            BOOLEAN NOT NULL DEFAULT FALSE,

  -- Permissões de telas ocultas (para uso futuro)
  perm_dashboard    BOOLEAN NOT NULL DEFAULT FALSE,
  perm_vehicles     BOOLEAN NOT NULL DEFAULT FALSE,
  perm_alerts       BOOLEAN NOT NULL DEFAULT FALSE,
  perm_reports      BOOLEAN NOT NULL DEFAULT FALSE,
  perm_map          BOOLEAN NOT NULL DEFAULT FALSE,
  perm_integration  BOOLEAN NOT NULL DEFAULT FALSE,

  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
