ALTER TABLE automacao_mensagem_manutencao
  DROP CONSTRAINT IF EXISTS automacao_mensagem_manutencao_intervalo_km_check;

ALTER TABLE automacao_mensagem_manutencao
  ALTER COLUMN intervalo_km DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tipo_controle VARCHAR(10) NOT NULL DEFAULT 'km',
  ADD COLUMN IF NOT EXISTS intervalo_dias INTEGER,
  ADD COLUMN IF NOT EXISTS data_ultimo_servico DATE,
  ADD COLUMN IF NOT EXISTS data_proximo_envio DATE;

ALTER TABLE automacao_mensagem_manutencao
  DROP CONSTRAINT IF EXISTS automacao_manutencao_tipo_controle_check,
  DROP CONSTRAINT IF EXISTS automacao_manutencao_intervalo_check;

ALTER TABLE automacao_mensagem_manutencao
  ADD CONSTRAINT automacao_manutencao_tipo_controle_check
    CHECK (tipo_controle IN ('km', 'data')) NOT VALID;

ALTER TABLE automacao_mensagem_manutencao
  ADD CONSTRAINT automacao_manutencao_intervalo_check
    CHECK (
      (tipo_controle = 'km' AND intervalo_km > 0)
      OR
      (tipo_controle = 'data' AND intervalo_dias > 0)
    ) NOT VALID;

ALTER TABLE historico_manutencao_veiculo
  DROP CONSTRAINT IF EXISTS historico_manutencao_tipo_check;

ALTER TABLE historico_manutencao_veiculo
  ADD CONSTRAINT historico_manutencao_tipo_check CHECK (
    tipo_movimento IN (
      'troca_oleo_motor', 'revisao', 'filtro_combustivel', 'filtro_ar',
      'oleo_cambio', 'oleo_diferencial', 'lubrificacao',
      'afericao_tacografo', 'outro'
    )
  );
