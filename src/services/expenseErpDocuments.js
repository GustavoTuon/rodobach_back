import {clientPool} from '../db/clientPool.js';
import {z} from 'zod';

const identitySchema=z.object({company:z.string().regex(/^\d{1,9}$/),series:z.string().max(20),number:z.string().regex(/^\d{1,20}$/),installment:z.string().min(1).max(20),supplierCode:z.string().regex(/^\d{1,12}$/)}).strict();
export const expenseErpDocumentsSchema=z.array(z.union([identitySchema,z.object({legacy:z.literal(true),number:z.string().min(1).max(80)}).strict()])).max(20);
const identityKey=item=>JSON.stringify([item.company,item.series,item.number,item.installment,item.supplierCode]);
export const expenseErpDocumentsOf=row=>row.documentos_erp?.length ? row.documentos_erp : row.documento_erp ? [{legacy:true,number:row.documento_erp}] : [];

// Same accounts-payable source used by the financial screen; no ERP writes.
const documentSelect=`
    SELECT pag.empresapag::text AS company, pag.seriepag::text AS series,
      pag.duplicatapag::text AS number, pag.parcelapag::text AS installment, pag.fornecedorpag::text AS "supplierCode",
      pag.documentopag::text AS document, pag.dataemissaopag AS date,
      pag.valorduplicatapag AS amount, vehicle.plate,
      CASE WHEN NULLIF(TRIM(pag.veiculopag::text),'') IS NULL
        THEN 'invoice' ELSE 'financial' END AS "plateSource",
      NULLIF(TRIM(pag.veiculopag::text),'') AS "financialPlate",
      NULLIF(TRIM(nf.veiculonfe::text),'') AS "invoicePlate",
      COALESCE(NULLIF(TRIM(pag.veiculopag::text),'') IS NOT NULL
        AND NULLIF(TRIM(nf.veiculonfe::text),'') IS NOT NULL
        AND regexp_replace(upper(pag.veiculopag::text),'[^A-Z0-9]','','g')
          <> regexp_replace(upper(nf.veiculonfe::text),'[^A-Z0-9]','','g'),false) AS "plateConflict",
      COALESCE(NULLIF(TRIM(forn.fantasiafor),''),TRIM(forn.nomefor)) AS supplier
    FROM financeiro.pagar pag
    LEFT JOIN compras.notasfiscaisentrada nf
      ON nf.empresanfe=pag.empresapag AND nf.serienfe=pag.seriepag
      AND nf.codigonfe=pag.duplicatapag AND nf.fornecedornfe=pag.fornecedorpag
    CROSS JOIN LATERAL (
      SELECT COALESCE(NULLIF(TRIM(pag.veiculopag::text),''),nf.veiculonfe::text) AS plate
    ) vehicle
    LEFT JOIN LATERAL (
      SELECT fantasiafor,nomefor FROM gerais.fornecedores
      WHERE codigofor=pag.fornecedorpag
      ORDER BY (empresafor=pag.empresapag) DESC,empresafor LIMIT 1
    ) forn ON TRUE`;

export async function searchExpenseErpDocuments({q='',plate,series=''}) {
  const {rows} = await clientPool.query(`${documentSelect}
    WHERE regexp_replace(upper(vehicle.plate),'[^A-Z0-9]','','g')=$2
      AND ($3::text='' OR upper(trim(pag.seriepag::text))=upper($3))
      AND (pag.duplicatapag::text ILIKE '%' || $1 || '%'
      OR pag.documentopag::text ILIKE '%' || $1 || '%'
      OR forn.nomefor ILIKE '%' || $1 || '%'
      OR forn.fantasiafor ILIKE '%' || $1 || '%'
      OR vehicle.plate ILIKE '%' || $1 || '%')
    ORDER BY pag.dataemissaopag DESC NULLS LAST,pag.empresapag,pag.seriepag,pag.duplicatapag,pag.parcelapag
    LIMIT 31`,[q.replace(/[\\%_]/g,'\\$&'),plate,series]);
  return {documents:rows.slice(0,30),hasMore:rows.length>30};
}

export async function resolveExpenseErpDocuments(documents, before) {
  const parsed=expenseErpDocumentsSchema.safeParse(documents);
  const invalid=message=>Object.assign(new Error(message),{status:400});
  if(!parsed.success)throw invalid('Selecione documentos válidos na busca do ERP.');
  const keys=new Set();
  const resolved=[];
  for(const item of parsed.data) {
    const key=item.legacy ? `legacy:${item.number}` : identityKey(item);
    if(keys.has(key))throw invalid('O mesmo documento e parcela não podem ser vinculados duas vezes.');
    keys.add(key);
    if(item.legacy) {
      if(parsed.data.some(other=>!other.legacy && other.number===item.number))throw invalid('Remova a referência antiga antes de selecionar novamente o mesmo número.');
      if(!expenseErpDocumentsOf(before).some(old=>old.legacy && old.number===item.number))throw invalid('Vínculo antigo não encontrado nesta despesa. Selecione o documento na busca.');
      resolved.push(item);
      continue;
    }
    const {rows}=await clientPool.query(`${documentSelect}
      WHERE pag.empresapag::text=$1 AND pag.seriepag::text=$2 AND pag.duplicatapag::text=$3
        AND pag.parcelapag::text=$4 AND pag.fornecedorpag::text=$5
        AND regexp_replace(upper(vehicle.plate),'[^A-Z0-9]','','g')=$6`,
    [item.company,item.series,item.number,item.installment,item.supplierCode,before.placa]);
    if(rows.length!==1)throw invalid(`Documento ${item.number} não encontrado de forma única para esta placa. Busque novamente.`);
    const amount=Number(rows[0].amount);
    if(!Number.isFinite(amount))throw invalid(`Valor indisponível para o documento ${item.number}.`);
    resolved.push({...rows[0],amount});
  }
  return resolved;
}
