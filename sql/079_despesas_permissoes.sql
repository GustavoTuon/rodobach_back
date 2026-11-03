-- Financial actions are explicit; conference alone does not grant them.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_pagamento_despesas BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_lancamento_despesas BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perm_reembolso_despesas BOOLEAN NOT NULL DEFAULT FALSE;
