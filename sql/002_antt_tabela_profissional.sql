CREATE TABLE IF NOT EXISTS antt_tabela (
  id SERIAL PRIMARY KEY,
  tipo_veiculo TEXT NOT NULL,
  eixos INTEGER NOT NULL,
  operacao TEXT NOT NULL DEFAULT 'geral',
  tipo_carga TEXT NOT NULL CHECK (tipo_carga IN ('normal', 'alto_desempenho')),
  km_valor NUMERIC(12, 4) NOT NULL,
  carga_descarga NUMERIC(12, 2) NOT NULL,
  data_vigencia DATE NOT NULL,
  versao TEXT NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'ANTT',
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (eixos, operacao, tipo_carga, data_vigencia, versao)
);

INSERT INTO antt_tabela (
  tipo_veiculo,
  eixos,
  operacao,
  tipo_carga,
  km_valor,
  carga_descarga,
  data_vigencia,
  versao
) VALUES
  ('Truck', 3, 'geral', 'normal', 5.0977, 541.86, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Bitruck', 4, 'geral', 'normal', 5.7822, 588.86, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 5e', 5, 'geral', 'normal', 6.6718, 657.56, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 6e', 6, 'geral', 'normal', 7.3547, 671.93, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 7e', 7, 'geral', 'normal', 8.0927, 831.66, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Truck', 3, 'geral', 'alto_desempenho', 4.3141, 195.81, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Bitruck', 4, 'geral', 'alto_desempenho', 4.9335, 213.27, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 5e', 5, 'geral', 'alto_desempenho', 5.6630, 228.08, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 6e', 6, 'geral', 'alto_desempenho', 6.3124, 231.17, DATE '2026-07-17', 'resolucao_antt_6084_2026'),
  ('Carreta 7e', 7, 'geral', 'alto_desempenho', 6.7218, 272.80, DATE '2026-07-17', 'resolucao_antt_6084_2026')
ON CONFLICT (eixos, operacao, tipo_carga, data_vigencia, versao) DO UPDATE SET
  tipo_veiculo = EXCLUDED.tipo_veiculo,
  km_valor = EXCLUDED.km_valor,
  carga_descarga = EXCLUDED.carga_descarga,
  atualizado_em = CURRENT_TIMESTAMP;
