-- Payment is also a confirmation. Preserve earlier reviews and soft deletions.
WITH pending AS MATERIALIZED (
  SELECT m.* FROM manutencao_plantao m
  WHERE m.pago IS TRUE AND m.conferido_em IS NULL AND m.excluido_em IS NULL
  FOR UPDATE
), updated AS (
  UPDATE manutencao_plantao m SET
    conferido_em=NOW(),
    conferido_login='Automático (pagamento registrado)',
    revisao=m.revisao+1
  FROM pending p WHERE m.id=p.id
  RETURNING m.*
)
INSERT INTO manutencao_plantao_historico
  (lancamento_id,evento,usuario_id,usuario_login,antes,depois)
SELECT u.id,'check',0,'sistema',
  (to_jsonb(p)-'comprovante_foto'-'painel_foto'-'bomba_foto') || jsonb_build_object(
    'comprovante_foto',p.comprovante_foto IS NOT NULL,'painel_foto',p.painel_foto IS NOT NULL,'bomba_foto',p.bomba_foto IS NOT NULL),
  (to_jsonb(u)-'comprovante_foto'-'painel_foto'-'bomba_foto') || jsonb_build_object(
    'comprovante_foto',u.comprovante_foto IS NOT NULL,'painel_foto',u.painel_foto IS NOT NULL,'bomba_foto',u.bomba_foto IS NOT NULL,
    'motivo_conferencia','Conferência automática de despesa com pagamento já registrado.')
FROM updated u JOIN pending p ON p.id=u.id;
