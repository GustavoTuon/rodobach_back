CREATE TABLE IF NOT EXISTS bloco_notas_tarefas (
 id uuid NOT NULL, usuario_id integer NOT NULL REFERENCES usuarios(id),
 placa varchar(7) NOT NULL CHECK(placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
 titulo varchar(200) NOT NULL CHECK(length(trim(titulo))>0),
 concluida boolean NOT NULL DEFAULT false, revisao integer NOT NULL DEFAULT 1,
 criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(usuario_id,id,placa)
);
CREATE INDEX IF NOT EXISTS bloco_notas_tarefas_placa_idx ON bloco_notas_tarefas(usuario_id,placa);
