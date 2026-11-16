ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_colaboradores boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS colaboradores_registros (
 id uuid PRIMARY KEY,
 colaborador_codigo integer NOT NULL,
 colaborador_nome text NOT NULL,
 empresa integer NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('advertencia_verbal','advertencia_escrita','avaria','acidente','ferias','epi','uniforme','celular')),
 data date NOT NULL,
 prazo date,
 status text NOT NULL CHECK(status IN ('pendente','concluido','cancelado')),
 descricao text NOT NULL,
 responsavel text NOT NULL,
 detalhes jsonb NOT NULL DEFAULT '{}',
 anexos jsonb NOT NULL DEFAULT '[]',
 revisao integer NOT NULL DEFAULT 1,
 autor_id integer NOT NULL REFERENCES usuarios(id),
 atualizado_por integer NOT NULL REFERENCES usuarios(id),
 criado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS colaboradores_registros_pessoa_data ON colaboradores_registros(colaborador_codigo,data DESC);
CREATE TABLE IF NOT EXISTS colaboradores_registros_historico (
 registro_id uuid NOT NULL REFERENCES colaboradores_registros(id),
 revisao integer NOT NULL,
 usuario_id integer NOT NULL REFERENCES usuarios(id),
 alterado_em timestamptz NOT NULL DEFAULT now(),
 registro jsonb NOT NULL,
 PRIMARY KEY(registro_id,revisao)
);
