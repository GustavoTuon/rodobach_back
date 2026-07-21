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
  ('Truck', 3, 5.0977, 541.86, 4.3141, 195.81),
  ('Bitruck', 4, 5.7822, 588.86, 4.9335, 213.27),
  ('Carreta 5e', 5, 6.6718, 657.56, 5.6630, 228.08),
  ('Carreta 6e', 6, 7.3547, 671.93, 6.3124, 231.17),
  ('Carreta 7e', 7, 8.0927, 831.66, 6.7218, 272.80)
ON CONFLICT (eixos) DO UPDATE SET
  tipo_veiculo = EXCLUDED.tipo_veiculo,
  normal_custo_deslocamento = EXCLUDED.normal_custo_deslocamento,
  normal_carga_descarga = EXCLUDED.normal_carga_descarga,
  alto_desempenho_custo_deslocamento = EXCLUDED.alto_desempenho_custo_deslocamento,
  alto_desempenho_carga_descarga = EXCLUDED.alto_desempenho_carga_descarga,
  atualizado_em = CURRENT_TIMESTAMP;
