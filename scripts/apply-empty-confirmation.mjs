import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { config, quoteIdent, tableName } from '../src/config.js';

// Apply only this additive migration; do not execute unrelated pending migrations.
const filename = '047_painel_vazio_ate_documento.sql';
const sql = await fs.readFile(new URL(`../sql/${filename}`, import.meta.url), 'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
  await client.query('SELECT pg_advisory_xact_lock(78482933)');
  await client.query(`CREATE TABLE IF NOT EXISTS ${tableName('schema_migrations')} (filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const {rows} = await client.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`, [filename]);
  if (rows[0] && rows[0].checksum !== checksum) throw new Error('Migration checksum mismatch');
  if (!rows.length) {
    await client.query(sql);
    await client.query(`INSERT INTO ${tableName('schema_migrations')} (filename,checksum) VALUES ($1,$2)`, [filename, checksum]);
  }
  await client.query('COMMIT');
  console.log(rows.length ? 'Empty confirmation validity already installed.' : 'Empty confirmation validity installed. No messages sent.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally { client.release(); await pool.end(); }
