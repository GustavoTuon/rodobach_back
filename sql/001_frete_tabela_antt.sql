CREATE TABLE IF NOT EXISTS frete_tabela_antt (
  id SERIAL PRIMARY KEY,
  tipo_veiculo TEXT NOT NULL,
  eixos INTEGER NOT NULL UNIQUE,
  normal_custo_deslocamento NUMERIC(12, 4) NOT NULL,
  normal_carga_descarga NUMERIC(12, 2) NOT NULL,
  alto_desempenho_custo_deslocamento NUMERIC(12, 4) NOT NULL,
  alto_desempenho_carga_descarga NUMERIC(12, 2) NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'ANTT',
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO frete_tabela_antt (
  tipo_veiculo,
  eixos,
  normal_custo_deslocamento,
  normal_carga_descarga,
  alto_desempenho_custo_deslocamento,
  alto_desempenho_carga_descarga
) VALUES
  ('Truck', 3, 5.1295, 523.33, 4.3727, 190.36),
  ('Bitruck', 4, 5.8178, 568.72, 4.9981, 205.98),
  ('Carreta 5e', 5, 6.7126, 635.08, 5.7382, 220.28),
  ('Carreta 6e', 6, 7.4124, 648.95, 6.4057, 223.27),
  ('Carreta 7e', 7, 8.1252, 803.22, 6.8012, 263.47)
ON CONFLICT (eixos) DO UPDATE SET
  tipo_veiculo = EXCLUDED.tipo_veiculo,
  normal_custo_deslocamento = EXCLUDED.normal_custo_deslocamento,
  normal_carga_descarga = EXCLUDED.normal_carga_descarga,
  alto_desempenho_custo_deslocamento = EXCLUDED.alto_desempenho_custo_deslocamento,
  alto_desempenho_carga_descarga = EXCLUDED.alto_desempenho_carga_descarga,
  atualizado_em = CURRENT_TIMESTAMP;
