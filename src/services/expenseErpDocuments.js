import {clientPool} from '../db/clientPool.js';

// Same accounts-payable source used by the financial screen; no ERP writes.
export async function searchExpenseErpDocuments(query) {
  const {rows} = await clientPool.query(`
    SELECT pag.empresapag::text AS company, pag.seriepag::text AS series,
      pag.duplicatapag::text AS number, pag.parcelapag::text AS installment,
      pag.documentopag::text AS document, pag.dataemissaopag AS date,
      pag.valorduplicatapag AS amount, pag.veiculopag AS plate,
      COALESCE(NULLIF(TRIM(forn.fantasiafor),''),TRIM(forn.nomefor)) AS supplier
    FROM financeiro.pagar pag
    LEFT JOIN LATERAL (
      SELECT fantasiafor,nomefor FROM gerais.fornecedores
      WHERE codigofor=pag.fornecedorpag
      ORDER BY (empresafor=pag.empresapag) DESC,empresafor LIMIT 1
    ) forn ON TRUE
    WHERE pag.duplicatapag::text ILIKE '%' || $1 || '%'
      OR pag.documentopag::text ILIKE '%' || $1 || '%'
      OR forn.nomefor ILIKE '%' || $1 || '%'
      OR forn.fantasiafor ILIKE '%' || $1 || '%'
      OR pag.veiculopag::text ILIKE '%' || $1 || '%'
    ORDER BY pag.dataemissaopag DESC NULLS LAST,pag.empresapag,pag.seriepag,pag.duplicatapag,pag.parcelapag
    LIMIT 31`,[query]);
  return {documents:rows.slice(0,30),hasMore:rows.length>30};
}
