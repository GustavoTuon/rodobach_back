CREATE TABLE IF NOT EXISTS antt_monitor_execucoes (
 id BIGSERIAL PRIMARY KEY,
 iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 finalizado_em TIMESTAMPTZ,
 status TEXT NOT NULL CHECK (status IN ('running','ok','updated','review','error')),
 mensagem TEXT,
 fonte TEXT,
 publicacao JSONB
);
CREATE TABLE IF NOT EXISTS antt_publicacoes (
 hash TEXT PRIMARY KEY,
 titulo TEXT NOT NULL,
 fonte TEXT NOT NULL,
 publicada_em DATE NOT NULL,
 vigencia DATE NOT NULL,
 html_hash TEXT NOT NULL,
 dados JSONB NOT NULL,
 registrada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
