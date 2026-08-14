ALTER TABLE cadastro_cotacao_frete
  ADD COLUMN IF NOT EXISTS atualizado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_por_login VARCHAR(120);

UPDATE cadastro_cotacao_frete
   SET atualizado_por_id = COALESCE(atualizado_por_id, criado_por_id),
       atualizado_por_login = COALESCE(atualizado_por_login, criado_por_login, aprovado_por_login, 'Migração do sistema')
 WHERE atualizado_por_login IS NULL;
