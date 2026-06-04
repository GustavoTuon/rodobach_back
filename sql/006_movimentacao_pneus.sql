-- Controle proprio de movimentacao de pneus.
-- As tabelas frotas.* do cliente sao somente leitura; nenhuma escrita deve ser feita nelas.

CREATE TABLE IF NOT EXISTS movimentacoes_pneus (
  id                    SERIAL PRIMARY KEY,
  empresa               TEXT,
  codigo_pneu_cliente   TEXT NOT NULL,
  nome_pneu             TEXT,
  veiculo_origem        TEXT,
  veiculo_destino       TEXT,
  posicao_origem        TEXT,
  posicao_destino       TEXT,
  local_origem          TEXT,
  local_destino         TEXT NOT NULL,
  tipo_movimento        TEXT NOT NULL CHECK (tipo_movimento IN (
    'MONTAGEM', 'DESMONTAGEM', 'TROCA_POSICAO', 'ESTOQUE', 'CONSERTO', 'BAIXA', 'DESCARTE'
  )),
  km_veiculo            NUMERIC(12, 0),
  km_pneu_atual         NUMERIC(12, 0),
  data_movimento        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id            TEXT,
  observacao            TEXT,
  snapshot_pneu_json    JSONB,
  criado_em             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF to_regclass('movimentos_pneus') IS NOT NULL THEN
    INSERT INTO movimentacoes_pneus (
      empresa, codigo_pneu_cliente, veiculo_destino,
      posicao_origem, posicao_destino, local_origem, local_destino,
      tipo_movimento, km_veiculo, km_pneu_atual, data_movimento,
      usuario_id, observacao, snapshot_pneu_json, criado_em
    )
    SELECT
      empresa,
      codigo_pneu_cliente,
      veiculo_cliente,
      posicao_origem,
      posicao_destino,
      local_origem,
      local_destino,
      UPPER(tipo_movimento),
      km_veiculo,
      km_pneu_atual,
      data_movimento,
      usuario,
      observacao,
      dados_snapshot_json,
      criado_em
    FROM movimentos_pneus old_mov
    WHERE NOT EXISTS (
      SELECT 1
      FROM movimentacoes_pneus new_mov
      WHERE new_mov.codigo_pneu_cliente = old_mov.codigo_pneu_cliente
        AND new_mov.data_movimento = old_mov.data_movimento
        AND new_mov.tipo_movimento = UPPER(old_mov.tipo_movimento)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_pneus_codigo
  ON movimentacoes_pneus (codigo_pneu_cliente, data_movimento DESC);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_pneus_veiculo_destino
  ON movimentacoes_pneus (veiculo_destino, data_movimento DESC);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_pneus_veiculo_origem
  ON movimentacoes_pneus (veiculo_origem, data_movimento DESC);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_pneus_empresa_data
  ON movimentacoes_pneus (empresa, data_movimento DESC);
