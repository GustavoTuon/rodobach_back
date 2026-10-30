import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pool} from '../src/db/pool.js';
import {tableName,config,quoteIdent} from '../src/config.js';
const filename='076_plantao_dados_pagamento.sql';
const sql=await fs.readFile(new URL('../sql/'+filename,import.meta.url),'utf8');
const checksum=crypto.createHash('sha256').update(sql).digest('hex');
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
 const applied=await client.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`,[filename]);
 if(applied.rows.length) {
  if(applied.rows[0].checksum!==checksum) throw new Error('Checksum da migração divergente.');
 } else {
  await client.query(sql);
  await client.query(`INSERT INTO ${tableName('schema_migrations')} (filename,checksum) VALUES ($1,$2)`,[filename,checksum]);
 }
 await client.query('COMMIT');
 console.log('Migração 076 aplicada e registrada.');
} catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();await pool.end();}
