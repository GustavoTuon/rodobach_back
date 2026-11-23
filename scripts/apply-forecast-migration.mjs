import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pool} from '../src/db/pool.js';
import {config,quoteIdent,tableName} from '../src/config.js';
const filename='095_previsoes_cargas_viagens.sql';
const sql=await fs.readFile(new URL(`../sql/${filename}`,import.meta.url),'utf8');
const checksum=crypto.createHash('sha256').update(sql).digest('hex');
const db=await pool.connect();
try {
  await db.query('BEGIN');
  await db.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
  await db.query('SELECT pg_advisory_xact_lock(952026)');
  const {rows}=await db.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`,[filename]);
  if(rows[0] && rows[0].checksum!==checksum)throw new Error('Migration checksum mismatch');
  if(!rows.length){await db.query(sql);await db.query(`INSERT INTO ${tableName('schema_migrations')}(filename,checksum) VALUES($1,$2)`,[filename,checksum]);}
  await db.query('COMMIT');console.log(rows.length?'Forecast migration already applied':'Forecast migration applied');
}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();await pool.end();}
