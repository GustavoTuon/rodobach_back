import {clientPool} from '../db/clientPool.js';
import {pool} from '../db/pool.js';
import {tableName} from '../config.js';

export async function searchExpenseSuppliers(search='') {
  const q=String(search).trim().replace(/\s+/g,' ').slice(0,120);
  const pattern=`%${q.replace(/[\\%_]/g,'\\$&')}%`;
  const [erp,norte]=await Promise.allSettled([
    clientPool.query(`SELECT empresafor AS empresa,codigofor AS codigo,
      COALESCE(NULLIF(TRIM(fantasiafor),''),TRIM(nomefor)) AS nome
      FROM gerais.fornecedores
      WHERE NULLIF(TRIM(COALESCE(NULLIF(TRIM(fantasiafor),''),nomefor)),'') IS NOT NULL
        AND ($1='' OR nomefor ILIKE $2 OR fantasiafor ILIKE $2 OR codigofor::text=$1)
      ORDER BY nome,empresafor,codigofor LIMIT 30`,[q,pattern]),
    // Only supplier names, never expense amounts, documents, authors or payment details.
    pool.query(`SELECT nome FROM (
      SELECT DISTINCT ON (lower(regexp_replace(trim(fornecedor),'\\s+',' ','g')))
        regexp_replace(trim(fornecedor),'\\s+',' ','g') AS nome
      FROM ${tableName('manutencao_plantao')}
      WHERE fornecedor_codigo IS NULL AND NULLIF(trim(fornecedor),'') IS NOT NULL
        AND ($1='' OR regexp_replace(trim(fornecedor),'\\s+',' ','g') ILIKE $2)
      ORDER BY lower(regexp_replace(trim(fornecedor),'\\s+',' ','g')),criado_em DESC,id
    ) suppliers ORDER BY nome LIMIT 30`,[q,pattern]),
  ]);
  if(erp.status==='rejected'&&norte.status==='rejected')throw new Error('Não foi possível consultar os fornecedores.');
  const fornecedores=[
    ...(erp.status==='fulfilled'?erp.value.rows.map(row=>({...row,origem:'erp'})):[]),
    ...(norte.status==='fulfilled'?norte.value.rows.map(row=>({...row,codigo:null,empresa:null,origem:'norte'})):[]),
  ].sort((a,b)=>Number(b.nome.toLocaleLowerCase()===q.toLocaleLowerCase())-Number(a.nome.toLocaleLowerCase()===q.toLocaleLowerCase())||a.nome.localeCompare(b.nome,'pt-BR')||a.origem.localeCompare(b.origem));
  return {fornecedores,avisos:[...(erp.status==='rejected'?['Busca no ERP indisponível. Exibindo fornecedores da Norte.']:[]),...(norte.status==='rejected'?['Busca na Norte indisponível. Exibindo fornecedores do ERP.']:[])]};
}
