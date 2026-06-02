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
  ('Truck', 3, 'geral', 'normal', 5.1295, 523.33, CURRENT_DATE, 'planilha_inicial'),
  ('Bitruck', 4, 'geral', 'normal', 5.8178, 568.72, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 5e', 5, 'geral', 'normal', 6.7126, 635.08, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 6e', 6, 'geral', 'normal', 7.4124, 648.95, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 7e', 7, 'geral', 'normal', 8.1252, 803.22, CURRENT_DATE, 'planilha_inicial'),
  ('Truck', 3, 'geral', 'alto_desempenho', 4.3727, 190.36, CURRENT_DATE, 'planilha_inicial'),
  ('Bitruck', 4, 'geral', 'alto_desempenho', 4.9981, 205.98, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 5e', 5, 'geral', 'alto_desempenho', 5.7382, 220.28, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 6e', 6, 'geral', 'alto_desempenho', 6.4057, 223.27, CURRENT_DATE, 'planilha_inicial'),
  ('Carreta 7e', 7, 'geral', 'alto_desempenho', 6.8012, 263.47, CURRENT_DATE, 'planilha_inicial')
ON CONFLICT (eixos, operacao, tipo_carga, data_vigencia, versao) DO UPDATE SET
  tipo_veiculo = EXCLUDED.tipo_veiculo,
  km_valor = EXCLUDED.km_valor,
  carga_descarga = EXCLUDED.carga_descarga,
  atualizado_em = CURRENT_TIMESTAMP;
