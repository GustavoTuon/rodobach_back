CREATE TABLE compras_grupos (
 id uuid PRIMARY KEY, nome text NOT NULL CHECK(length(trim(nome)) BETWEEN 2 AND 80)
);
CREATE UNIQUE INDEX compras_grupos_nome ON compras_grupos(lower(trim(nome)));
CREATE TABLE compras_grupo_membros (
 grupo_id uuid REFERENCES compras_grupos(id) ON DELETE CASCADE,
 fornecedor_id uuid REFERENCES compras_fornecedores(id),
 PRIMARY KEY(grupo_id,fornecedor_id)
);
CREATE TABLE compras_fornecedor_acessos (
 fornecedor_id uuid PRIMARY KEY REFERENCES compras_fornecedores(id),
 cnpj text NOT NULL UNIQUE,
 senha_hash text NOT NULL,
 troca_obrigatoria boolean NOT NULL DEFAULT true,
 ativo boolean NOT NULL DEFAULT true,
 versao integer NOT NULL DEFAULT 1
);
