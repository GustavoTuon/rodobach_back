-- Authorized historical settlement: spreadsheet loads before August 2026.
-- Keep the previous state and rationale on each record; never modify ERP titles.
UPDATE cargas_v2
SET dados_legados = dados_legados || jsonb_build_object('quitacao_historica', jsonb_build_object(
      'em', NOW(), 'motivo', 'Quitação do histórico importado de planilha anterior a agosto de 2026, sem controle de CT-e; solicitada pelo responsável.',
      'status_anterior', status, 'atualizado_em_anterior', atualizado_em)),
    status = 'entregue', atualizado_em = NOW()
WHERE data < DATE '2026-08-01' AND status = 'aguardando_cte' AND legado_id IS NOT NULL
  AND NOT (dados_legados ? 'quitacao_historica');

UPDATE viagens_v2 v
SET dados_legados = v.dados_legados || jsonb_build_object('quitacao_historica', jsonb_build_object(
      'em', NOW(), 'motivo', 'Todas as cargas vinculadas foram encerradas; ajuste do histórico importado anterior a agosto de 2026.',
      'status_anterior', v.situacao, 'atualizado_em_anterior', v.atualizado_em)),
    situacao = 'entregue', atualizado_em = NOW()
WHERE v.situacao = 'aguardando_cte'
  AND EXISTS (SELECT 1 FROM viagem_cargas_v2 vc JOIN cargas_v2 c ON c.id = vc.carga_id
    WHERE vc.viagem_id = v.id AND c.dados_legados ? 'quitacao_historica')
  AND NOT EXISTS (SELECT 1 FROM viagem_cargas_v2 vc JOIN cargas_v2 c ON c.id = vc.carga_id
    WHERE vc.viagem_id = v.id AND c.status <> 'entregue');

CREATE INDEX IF NOT EXISTS cargas_v2_status_data_id_idx ON cargas_v2 (status, data DESC, id DESC);
CREATE INDEX IF NOT EXISTS cargas_v2_data_id_idx ON cargas_v2 (data DESC, id DESC);
CREATE INDEX IF NOT EXISTS viagens_v2_status_data_id_idx ON viagens_v2 (situacao, data DESC, id DESC);
CREATE INDEX IF NOT EXISTS viagens_v2_data_id_idx ON viagens_v2 (data DESC, id DESC);
