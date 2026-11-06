ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_bloco_notas boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS bloco_notas (
 id uuid PRIMARY KEY,usuario_id integer NOT NULL REFERENCES usuarios(id),
 titulo varchar(120) NOT NULL DEFAULT '',placa varchar(7) NOT NULL DEFAULT '',
 texto text NOT NULL CHECK(length(texto) BETWEEN 1 AND 20000),revisao integer NOT NULL DEFAULT 1,
 criado_em timestamptz NOT NULL DEFAULT now(),atualizado_em timestamptz NOT NULL DEFAULT now(),excluido_em timestamptz,
 CHECK(titulo<>'' OR placa<>''),CHECK(placa='' OR placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
);
CREATE INDEX IF NOT EXISTS bloco_notas_usuario_data_idx ON bloco_notas(usuario_id,atualizado_em DESC) WHERE excluido_em IS NULL;
