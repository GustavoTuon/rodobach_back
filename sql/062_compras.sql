ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_compras boolean NOT NULL DEFAULT false;
CREATE TABLE compras_fornecedores (
 id uuid PRIMARY KEY, nome text NOT NULL, documento text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '', telefone text NOT NULL DEFAULT '',
 empresa_erp text, codigo_erp text, criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE (empresa_erp, codigo_erp)
);
CREATE TABLE compras_cotacoes (
 id uuid PRIMARY KEY, titulo text NOT NULL, prazo timestamptz NOT NULL,
 observacoes text NOT NULL DEFAULT '', itens jsonb NOT NULL,
 status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','encerrada')),
 criado_por text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE compras_convites (
 id uuid PRIMARY KEY, cotacao_id uuid NOT NULL REFERENCES compras_cotacoes(id),
 fornecedor_id uuid NOT NULL REFERENCES compras_fornecedores(id),
 token text NOT NULL UNIQUE, itens jsonb NOT NULL, resposta jsonb,
 respondido_em timestamptz, UNIQUE (cotacao_id, fornecedor_id)
);
CREATE INDEX compras_convites_cotacao_idx ON compras_convites(cotacao_id);
