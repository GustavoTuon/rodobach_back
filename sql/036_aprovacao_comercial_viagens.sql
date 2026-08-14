ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_aprovar_viagens BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cadastro_cotacao_frete
  ADD COLUMN IF NOT EXISTS status_aprovacao VARCHAR(24) NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS criado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS criado_por_login VARCHAR(120),
  ADD COLUMN IF NOT EXISTS aprovado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprovado_por_login VARCHAR(120),
  ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_aprovacao TEXT,
  ADD CONSTRAINT cadastro_cotacao_frete_status_aprovacao_chk
    CHECK (status_aprovacao IN ('rascunho','aguardando_aprovacao','aprovada','correcao_solicitada','reprovada','cancelada'));

-- Registros anteriores à implantação são preservados como já autorizados.
UPDATE cadastro_cotacao_frete
   SET status_aprovacao = 'aprovada',
       aprovado_por_login = 'Migração do sistema',
       aprovado_em = COALESCE(atualizado_em, criado_em, NOW())
 WHERE criado_por_id IS NULL AND status_aprovacao = 'rascunho';

CREATE TABLE IF NOT EXISTS cadastro_cotacao_frete_auditoria (
  id BIGSERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cadastro_cotacao_frete(id) ON DELETE CASCADE,
  acao VARCHAR(40) NOT NULL,
  status_anterior VARCHAR(24),
  status_novo VARCHAR(24),
  dados_anteriores JSONB,
  dados_novos JSONB,
  motivo TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cadastro_cotacao_frete_auditoria_idx
  ON cadastro_cotacao_frete_auditoria (cotacao_id, criado_em DESC);
