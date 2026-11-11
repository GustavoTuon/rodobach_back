CREATE TABLE IF NOT EXISTS controle_viagens_diarias_parametros (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  refeicoes JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_por INTEGER,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO controle_viagens_diarias_parametros(id,refeicoes)
SELECT 1,jsonb_agg(jsonb_build_object(
  'nome',CASE codigo WHEN 'cafe' THEN 'Café da manhã' WHEN 'almoco' THEN 'Almoço' ELSE 'Jantar' END,
  'horario',left(horario_referencia::text,5),
  'valor',valor,'horas',horas_rodadas_referencia
) ORDER BY CASE codigo WHEN 'cafe' THEN 1 WHEN 'almoco' THEN 2 ELSE 3 END)
FROM parametro_diaria_motorista
WHERE ativo=TRUE AND codigo IN ('cafe','almoco','janta')
HAVING COUNT(*)=3 AND COUNT(DISTINCT codigo)=3
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS controle_viagens_diarias_historico (
  revisao INTEGER PRIMARY KEY,
  refeicoes JSONB NOT NULL,
  usuario_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO controle_viagens_diarias_historico(revisao,refeicoes)
SELECT revisao,refeicoes FROM controle_viagens_diarias_parametros WHERE id=1
ON CONFLICT DO NOTHING;
