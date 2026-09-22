-- Independent snapshots survive plan deletion. Existing sends are historical
-- records, not delivery receipts. No notifications are sent by this migration.
CREATE TABLE IF NOT EXISTS manutencao_auditoria (
  id BIGSERIAL PRIMARY KEY,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  concluido_em TIMESTAMPTZ,
  evento TEXT NOT NULL,
  origem TEXT NOT NULL,
  registro_id BIGINT,
  automacao_id INTEGER,
  placa TEXT,
  titulo TEXT,
  usuario_id TEXT,
  usuario_login TEXT,
  dados_anteriores JSONB,
  dados_novos JSONB,
  numero TEXT,
  mensagem TEXT,
  referencia TEXT,
  tipo_alerta TEXT,
  status TEXT,
  provedor_id TEXT,
  provedor_status TEXT,
  erro TEXT,
  legado_chave TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS manutencao_auditoria_data_idx ON manutencao_auditoria (ocorrido_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS manutencao_auditoria_plano_idx ON manutencao_auditoria (automacao_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS manutencao_auditoria_placa_idx ON manutencao_auditoria (placa, ocorrido_em DESC);

CREATE TABLE IF NOT EXISTS manutencao_alertas_execucoes (
  id BIGSERIAL PRIMARY KEY,
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  concluido_em TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'executando',
  candidatos INTEGER NOT NULL DEFAULT 0,
  aceitos INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  erro TEXT
);

ALTER TABLE manutencao_alertas_enviados ADD COLUMN IF NOT EXISTS tentativa_id BIGINT;
ALTER TABLE manutencao_componentes_alertas_enviados ADD COLUMN IF NOT EXISTS tentativa_id BIGINT;

CREATE OR REPLACE FUNCTION auditar_manutencao_plano() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE antes JSONB; depois JSONB; registro JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN antes := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN depois := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (antes - 'atualizado_em') = (depois - 'atualizado_em') THEN RETURN NEW; END IF;
  registro := COALESCE(depois, antes);
  INSERT INTO manutencao_auditoria
    (evento, origem, registro_id, automacao_id, placa, titulo, usuario_id, usuario_login, dados_anteriores, dados_novos)
  VALUES
    (CASE TG_OP WHEN 'INSERT' THEN 'criacao' WHEN 'UPDATE' THEN 'alteracao' ELSE 'exclusao' END,
     TG_TABLE_NAME, (registro->>'id')::bigint,
     CASE WHEN TG_TABLE_NAME = 'automacao_mensagem_manutencao' THEN (registro->>'id')::integer ELSE (registro->>'automacao_id')::integer END,
     registro->>'placa', COALESCE(registro->>'titulo',registro->>'descricao'),
     COALESCE(NULLIF(current_setting('app.actor_id', true), ''), registro->>'criado_por'),
     NULLIF(current_setting('app.actor_login', true), ''), antes, depois);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manutencao_plano_auditoria ON automacao_mensagem_manutencao;
CREATE TRIGGER manutencao_plano_auditoria AFTER INSERT OR UPDATE OR DELETE ON automacao_mensagem_manutencao
  FOR EACH ROW EXECUTE FUNCTION auditar_manutencao_plano();
DROP TRIGGER IF EXISTS manutencao_servico_auditoria ON historico_manutencao_veiculo;
CREATE TRIGGER manutencao_servico_auditoria AFTER INSERT OR UPDATE OR DELETE ON historico_manutencao_veiculo
  FOR EACH ROW EXECUTE FUNCTION auditar_manutencao_plano();

-- Preserve older send records, including writes from an older worker.
CREATE OR REPLACE FUNCTION auditar_manutencao_envio_legado() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE registro JSONB := to_jsonb(NEW); placa_ref TEXT; titulo_ref TEXT;
BEGIN
  IF registro->>'tentativa_id' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'manutencao_alertas_enviados' THEN
    SELECT placa,titulo INTO placa_ref,titulo_ref FROM automacao_mensagem_manutencao WHERE id=NEW.automacao_id;
  ELSE
    SELECT COALESCE(conjunto_placa,placa),componente INTO placa_ref,titulo_ref FROM manutencao_componentes_posicao WHERE id=NEW.registro_id;
  END IF;
  INSERT INTO manutencao_auditoria
    (ocorrido_em,evento,origem,registro_id,automacao_id,placa,titulo,numero,mensagem,referencia,tipo_alerta,status,legado_chave)
  VALUES (NEW.enviado_em,'envio',TG_TABLE_NAME,NEW.id,(registro->>'automacao_id')::integer,placa_ref,titulo_ref,
    NEW.numero,NEW.mensagem,NEW.referencia,NEW.tipo_alerta,'registro_legado',TG_TABLE_NAME||':'||NEW.id)
  ON CONFLICT (legado_chave) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manutencao_envio_auditoria ON manutencao_alertas_enviados;
CREATE TRIGGER manutencao_envio_auditoria AFTER INSERT ON manutencao_alertas_enviados
  FOR EACH ROW EXECUTE FUNCTION auditar_manutencao_envio_legado();
DROP TRIGGER IF EXISTS manutencao_componente_envio_auditoria ON manutencao_componentes_alertas_enviados;
CREATE TRIGGER manutencao_componente_envio_auditoria AFTER INSERT ON manutencao_componentes_alertas_enviados
  FOR EACH ROW EXECUTE FUNCTION auditar_manutencao_envio_legado();

INSERT INTO manutencao_auditoria
  (ocorrido_em,evento,origem,registro_id,automacao_id,placa,titulo,numero,mensagem,referencia,tipo_alerta,status,legado_chave)
SELECT e.enviado_em,'envio','manutencao_alertas_enviados',e.id,e.automacao_id,p.placa,p.titulo,
  e.numero,e.mensagem,e.referencia,e.tipo_alerta,'registro_legado','manutencao_alertas_enviados:'||e.id
FROM manutencao_alertas_enviados e LEFT JOIN automacao_mensagem_manutencao p ON p.id=e.automacao_id
WHERE e.tentativa_id IS NULL
ON CONFLICT (legado_chave) DO NOTHING;
INSERT INTO manutencao_auditoria
  (ocorrido_em,evento,origem,registro_id,placa,titulo,numero,mensagem,referencia,tipo_alerta,status,legado_chave)
SELECT e.enviado_em,'envio','manutencao_componentes_alertas_enviados',e.id,COALESCE(p.conjunto_placa,p.placa),p.componente,
  e.numero,e.mensagem,e.referencia,e.tipo_alerta,'registro_legado','manutencao_componentes_alertas_enviados:'||e.id
FROM manutencao_componentes_alertas_enviados e LEFT JOIN manutencao_componentes_posicao p ON p.id=e.registro_id
WHERE e.tentativa_id IS NULL
ON CONFLICT (legado_chave) DO NOTHING;
