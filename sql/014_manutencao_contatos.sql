CREATE TABLE IF NOT EXISTS manutencao_contatos (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL,
  numero        VARCHAR(32) NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS manutencao_contatos_numero_uidx
  ON manutencao_contatos (numero);

ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS numeros TEXT,
  ADD COLUMN IF NOT EXISTS contato_id INTEGER,
  ADD COLUMN IF NOT EXISTS contato_nome VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contato_numero VARCHAR(32);

INSERT INTO manutencao_contatos (nome, numero)
VALUES ('gustavo', '5548996523702')
ON CONFLICT (numero) DO UPDATE
  SET nome = EXCLUDED.nome,
      ativo = TRUE,
      atualizado_em = NOW();

UPDATE automacao_mensagem_manutencao amm
SET contato_id = c.id,
    contato_nome = c.nome,
    contato_numero = c.numero,
    numeros = COALESCE(NULLIF(amm.numeros, ''), c.numero),
    atualizado_em = NOW()
FROM manutencao_contatos c
WHERE c.numero = '5548996523702'
  AND (amm.numeros IS NULL OR amm.numeros = '' OR amm.contato_numero IS NULL);
