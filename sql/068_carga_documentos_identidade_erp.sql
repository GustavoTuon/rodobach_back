-- Nullable fields preserve existing links. Do not infer identities from numbers.
ALTER TABLE carga_documentos_v2
  ADD COLUMN IF NOT EXISTS empresa_documento TEXT,
  ADD COLUMN IF NOT EXISTS serie_documento TEXT;
