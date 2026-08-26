-- Remove a camada analitica local criada para o controle comercial.
-- As analises corporativas usam exclusivamente os dados do ERP.

DROP TABLE IF EXISTS oportunidades_retorno_contatos_v2;
DROP TABLE IF EXISTS oportunidades_retorno_v2;
DROP TABLE IF EXISTS ciclos_operacionais_v2;
DROP TABLE IF EXISTS parametros_custos_v2;

ALTER TABLE cargas_v2
  DROP COLUMN IF EXISTS km_estimado,
  DROP COLUMN IF EXISTS dias_estimados,
  DROP COLUMN IF EXISTS pedagio_estimado,
  DROP COLUMN IF EXISTS custo_extra_estimado;

ALTER TABLE viagens_v2
  DROP COLUMN IF EXISTS previsao_entrega,
  DROP COLUMN IF EXISTS data_entrega;
