import { clientPool } from '../db/clientPool.js';

export async function listResponsaveis(search = '') {
  const { rows } = await clientPool.query(`SELECT codigorep::text AS codigo,
    empresarep::text AS empresa, TRIM(nomerep) AS nome
    FROM financeiro.responsaveis WHERE ativorep='S'
      AND NULLIF(TRIM(nomerep),'') IS NOT NULL AND nomerep ILIKE $1
    ORDER BY nomerep,codigorep`, [`%${String(search).trim().slice(0,160)}%`]);
  return rows;
}

export async function resolveResponsavel(input) {
  if (!input || !/^\d{1,6}$/.test(String(input.codigo)) || !/^\d{1,6}$/.test(String(input.empresa))) {
    throw Object.assign(new Error('Selecione um responsável do ERP para a carga.'), {statusCode:400});
  }
  const {rows} = await clientPool.query(`SELECT codigorep::text AS codigo,
    empresarep::text AS empresa, TRIM(nomerep) AS nome FROM financeiro.responsaveis
    WHERE codigorep=$1 AND empresarep=$2 AND ativorep='S'`,[input.codigo,input.empresa]);
  if (!rows[0]) throw Object.assign(new Error('Responsável não encontrado ou inativo no ERP.'), {statusCode:400});
  return rows[0];
}
