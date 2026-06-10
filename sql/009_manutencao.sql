-- Adiciona permissão de manutenção aos usuários existentes
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_manutencao BOOLEAN NOT NULL DEFAULT TRUE;

-- Tabela de automações de mensagens de manutenção
CREATE TABLE IF NOT EXISTS automacao_mensagem_manutencao (
  id              SERIAL PRIMARY KEY,
  placa           VARCHAR(20) NOT NULL,
  titulo          VARCHAR(255) NOT NULL,
  mensagem        TEXT NOT NULL,
  intervalo_km    INTEGER NOT NULL CHECK (intervalo_km > 0),
  km_atual        INTEGER NOT NULL DEFAULT 0 CHECK (km_atual >= 0),
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
