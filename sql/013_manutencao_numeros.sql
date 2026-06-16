-- Números de destino da mensagem (separados por vírgula, ex: "5546999990000,5546888880000")
ALTER TABLE automacao_mensagem_manutencao
  ADD COLUMN IF NOT EXISTS numeros TEXT NOT NULL DEFAULT '';
