ALTER TABLE cargas_v2
  ADD COLUMN IF NOT EXISTS motivo_aprovacao TEXT,
  ADD COLUMN IF NOT EXISTS aprovado_por_id INTEGER,
  ADD COLUMN IF NOT EXISTS aprovado_por_login VARCHAR(120),
  ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;

UPDATE cargas_v2 nova
SET motivo_aprovacao = antiga.motivo_aprovacao,
    aprovado_por_id = antiga.aprovado_por_id,
    aprovado_por_login = antiga.aprovado_por_login,
    aprovado_em = antiga.aprovado_em
FROM cadastro_cotacao_frete antiga
WHERE nova.legado_id = antiga.id
  AND nova.aprovado_em IS NULL;

CREATE TABLE IF NOT EXISTS carga_aprovacao_auditoria_v2 (
  id BIGSERIAL PRIMARY KEY,
  legado_id INTEGER UNIQUE,
  carga_id BIGINT NOT NULL REFERENCES cargas_v2(id) ON DELETE CASCADE,
  acao VARCHAR(40) NOT NULL,
  status_anterior VARCHAR(24),
  status_novo VARCHAR(24),
  motivo TEXT,
  usuario_id INTEGER,
  usuario_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carga_aprovacao_auditoria_v2_carga_idx
  ON carga_aprovacao_auditoria_v2 (carga_id, criado_em DESC);

INSERT INTO carga_aprovacao_auditoria_v2 (
  legado_id, carga_id, acao, status_anterior, status_novo, motivo,
  usuario_id, usuario_login, criado_em
)
SELECT
  auditoria.id, nova.id, auditoria.acao, auditoria.status_anterior,
  auditoria.status_novo, auditoria.motivo, auditoria.usuario_id,
  auditoria.usuario_login, auditoria.criado_em
FROM cadastro_cotacao_frete_auditoria auditoria
JOIN cargas_v2 nova ON nova.legado_id = auditoria.cotacao_id
ON CONFLICT (legado_id) DO NOTHING;
