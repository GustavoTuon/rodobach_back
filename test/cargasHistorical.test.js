import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db/pool.js';
import { clientPool } from '../src/db/clientPool.js';
import { enrichCargasFinancial } from '../src/routes/cargasViagensV2.js';

test('quitação histórica não inventa títulos, recebimentos nem consultas no ERP', async t => {
  t.mock.method(clientPool, 'query', () => { throw new Error('ERP não deve ser consultado'); });
  const marker = { em: '2026-10-23', motivo: 'Histórico de planilha' };
  const [historical, normal] = await enrichCargasFinancial([
    { id: 1, quitacaoHistorica: marker, valorCliente: 12000, documentos: [{ tipo: 'CT-e', numero: '123' }] },
    { id: 2, documentos: [] },
  ]);
  assert.equal(historical.financeiro.status, 'quitado');
  assert.equal(historical.financeiro.valorTotal, 0);
  assert.equal(historical.financeiro.ctes, 0);
  assert.deepEqual(historical.financeiro.quitacaoHistorica, marker);
  assert.equal(normal.financeiro.status, 'sem_cte');
});

test('SQL histórico respeita limite de agosto, origem legada, status, viagens mistas e repetição', {
  skip: process.env.CARGAS_WORKFLOW_DB_TEST !== '1',
}, async () => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE cargas_v2 (id bigint, legado_id int, data date, status text, dados_legados jsonb DEFAULT '{}', atualizado_em timestamptz DEFAULT NOW()) ON COMMIT DROP;
      CREATE TEMP TABLE viagens_v2 (id bigint, data date, situacao text, dados_legados jsonb DEFAULT '{}', atualizado_em timestamptz DEFAULT NOW()) ON COMMIT DROP;
      CREATE TEMP TABLE viagem_cargas_v2 (carga_id bigint, viagem_id bigint) ON COMMIT DROP;
      INSERT INTO cargas_v2(id,legado_id,data,status) VALUES
        (1,1,'2026-07-31','aguardando_cte'),(2,2,'2026-08-01','aguardando_cte'),
        (3,NULL,'2026-07-31','aguardando_cte'),(4,4,'2026-07-31','aguardando_viagem'),
        (5,5,'2026-07-31','aguardando_cte'),(6,6,'2026-07-31','cancelado');
      INSERT INTO viagens_v2(id,data,situacao) VALUES (1,'2026-07-31','aguardando_cte'),(2,'2026-07-31','aguardando_cte');
      INSERT INTO viagem_cargas_v2 VALUES(1,1),(5,2),(2,2);`);
    const sql = await readFile(new URL('../sql/069_quitacao_historico_cargas.sql', import.meta.url), 'utf8');
    await db.query(sql);
    const { rows } = await db.query('SELECT * FROM pg_temp.cargas_v2 ORDER BY id');
    assert.deepEqual(rows.map(row => row.status), ['entregue','aguardando_cte','aguardando_cte','aguardando_viagem','entregue','cancelado']);
    assert.equal(rows[0].dados_legados.quitacao_historica.status_anterior, 'aguardando_cte');
    assert.deepEqual((await db.query('SELECT situacao FROM pg_temp.viagens_v2 ORDER BY id')).rows.map(r => r.situacao), ['entregue','aguardando_cte']);
    await db.query(sql);
    assert.deepEqual((await db.query('SELECT * FROM pg_temp.cargas_v2 ORDER BY id')).rows, rows);
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); }
});
