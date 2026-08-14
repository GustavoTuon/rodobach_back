ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perm_multas_frota BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS controle_multas_frota (
  empresa SMALLINT NOT NULL,
  codigo_multa INTEGER NOT NULL,
  status_indicacao VARCHAR(24) NOT NULL DEFAULT 'nao_aplicavel'
    CHECK (status_indicacao IN ('nao_aplicavel','pendente','indicada','confirmada','prazo_perdido')),
  indicado_em DATE,
  responsavel VARCHAR(160),
  status_interno VARCHAR(24) NOT NULL DEFAULT 'acompanhar'
    CHECK (status_interno IN ('acompanhar','em_defesa','deferida','indeferida','encerrada')),
  comprovante_url TEXT,
  observacoes TEXT,
  atualizado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_por_login VARCHAR(120),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_multa)
);

CREATE TABLE IF NOT EXISTS controle_multas_frota_auditoria (
  id BIGSERIAL PRIMARY KEY,
  empresa SMALLINT NOT NULL,
  codigo_multa INTEGER NOT NULL,
  dados_anteriores JSONB,
  dados_novos JSONB NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_login VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS controle_multas_frota_auditoria_idx
  ON controle_multas_frota_auditoria (empresa, codigo_multa, criado_em DESC);
