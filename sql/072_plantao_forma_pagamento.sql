ALTER TABLE manutencao_plantao
  ADD COLUMN IF NOT EXISTS forma_pagamento_codigo text,
  ADD COLUMN IF NOT EXISTS forma_pagamento_empresa text,
  ADD COLUMN IF NOT EXISTS forma_pagamento_nome text;
