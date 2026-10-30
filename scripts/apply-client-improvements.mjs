import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pool} from '../src/db/pool.js';
import {tableName,config,quoteIdent} from '../src/config.js';
const files=['077_cargas_responsavel.sql','078_plantao_reembolso.sql'];
const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rodobach-client-improvements'))");
  for(const filename of files) {
    const sql=await fs.readFile(new URL('../sql/'+filename,import.meta.url),'utf8');
    const checksum=crypto.createHash('sha256').update(sql).digest('hex');
    const applied=await client.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`,[filename]);
    if(applied.rows.length) {
      if(applied.rows[0].checksum!==checksum) throw new Error('Checksum divergente: '+filename);
      console.log('Já aplicada: '+filename);
    } else if(process.argv.includes('--apply')) {
      await client.query(sql);
      await client.query(`INSERT INTO ${tableName('schema_migrations')} (filename,checksum) VALUES ($1,$2)`,[filename,checksum]);
      console.log('Aplicada: '+filename);
    } else console.log('Pendente: '+filename);
  }
  await client.query('COMMIT');
} catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();await pool.end();}
