import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { config, quoteIdent, tableName } from '../src/config.js';

const filename = '069_quitacao_historico_cargas.sql';
const sql = await readFile(new URL(`../sql/${filename}`, import.meta.url), 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
  const preview = await db.query(`SELECT COUNT(*)::int AS cargas FROM ${tableName('cargas_v2')}
    WHERE data < DATE '2026-08-01' AND status='aguardando_cte' AND legado_id IS NOT NULL
    AND NOT (dados_legados ? 'quitacao_historica')`);
  console.log(JSON.stringify({ candidatos: preview.rows[0].cargas, limiteExclusivo: '2026-08-01' }));
  if (process.argv.includes('--apply')) {
    const existing = await db.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`, [filename]);
    if (existing.rowCount && existing.rows[0].checksum !== checksum) throw new Error('Checksum da migração diverge.');
    if (!existing.rowCount) {
      await db.query(sql);
      await db.query(`INSERT INTO ${tableName('schema_migrations')} (filename,checksum) VALUES ($1,$2)`, [filename,checksum]);
    }
    const report = await db.query(`SELECT
      (SELECT COUNT(*)::int FROM ${tableName('cargas_v2')} WHERE dados_legados ? 'quitacao_historica') AS cargas_quitadas,
      (SELECT COUNT(*)::int FROM ${tableName('viagens_v2')} WHERE dados_legados ? 'quitacao_historica') AS viagens_encerradas,
      (SELECT COUNT(*)::int FROM ${tableName('cargas_v2')} WHERE data < DATE '2026-08-01' AND status='aguardando_cte') AS pendentes_anteriores_agosto`);
    await db.query('COMMIT');
    console.log(JSON.stringify({ applied: true, ...report.rows[0] }));
  } else await db.query('ROLLBACK');
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { db.release(); await pool.end(); }
