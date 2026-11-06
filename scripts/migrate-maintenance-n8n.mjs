// Upload an inactive workflow; never execute or activate it.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {config,tableName,quoteIdent} from '../src/config.js';
import {pool} from '../src/db/pool.js';
import {maintenanceWorkflow} from '../src/services/maintenanceWorkflow.js';
const id='hhjl1q5uyxov5kZI';
const apiUrl=process.env.MAINTENANCE_PUBLIC_API_URL;
if(!apiUrl?.startsWith('https://'))throw new Error('Configure MAINTENANCE_PUBLIC_API_URL com a URL hospedada.');
async function api(path,method='GET',body){
  const response=await fetch(`${config.n8n.apiUrl}/api/v1${path}`,{method,headers:{'X-N8N-API-KEY':config.n8n.apiKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`n8n: HTTP ${response.status} em ${method} ${path}`);
  return response.json();
}
try {
  await mkdir(new URL('../.local-logs/',import.meta.url),{recursive:true});
  const old=await api(`/workflows/${id}`);
  await writeFile(new URL(`../.local-logs/maintenance-workflow-before-${Date.now()}.json`,import.meta.url),JSON.stringify(old,null,2));
  if(old.active)await api(`/workflows/${id}/deactivate`,'POST');
  const token=randomBytes(32).toString('hex');
  const credential=await api('/credentials','POST',{name:'Rodobach — manutenção (acesso restrito)',type:'httpHeaderAuth',data:{name:'Authorization',value:`Bearer ${token}`}});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO ${quoteIdent(config.db.schema)}`);
    const filename='085_manutencao_n8n_integracao.sql';
    const sql=await readFile(new URL(`../sql/${filename}`,import.meta.url),'utf8');
    const hash=createHash('sha256').update(sql).digest('hex');
    const existing=await client.query(`SELECT checksum FROM ${tableName('schema_migrations')} WHERE filename=$1`,[filename]);
    if(existing.rowCount&&existing.rows[0].checksum!==hash)throw new Error('Checksum da migração divergente.');
    await client.query(sql);
    await client.query(`INSERT INTO ${tableName('schema_migrations')}(filename,checksum) VALUES($1,$2) ON CONFLICT DO NOTHING`,[filename,hash]);
    await client.query(`INSERT INTO ${tableName('manutencao_n8n_integracao')}(id,token_hash,destinatario) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET token_hash=$1,destinatario=$2,ativo=TRUE`,[createHash('sha256').update(token).digest('hex'),process.env.MAINTENANCE_ALERT_NUMBER||null]);
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const workflow=maintenanceWorkflow({url:`${apiUrl.replace(/\/$/,'')}/api/integracoes/n8n/manutencao`,credential:{id:credential.id,name:credential.name}});
  await api(`/workflows/${id}`,'PUT',workflow);
  const saved=await api(`/workflows/${id}`);
  if(saved.active)throw new Error('O fluxo precisa permanecer desativado.');
  await writeFile(new URL('../.local-logs/maintenance-workflow-migrated.json',import.meta.url),JSON.stringify(saved,null,2));
  console.log(JSON.stringify({id:saved.id,name:saved.name,active:saved.active,timezone:saved.settings.timezone,nodes:saved.nodes.length,url:`${config.n8n.apiUrl}/workflow/${id}`}));
} catch(error){console.error(error.code||error.message);process.exitCode=1;}finally{await pool.end();}
