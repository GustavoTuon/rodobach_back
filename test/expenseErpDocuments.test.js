import test from 'node:test';
import assert from 'node:assert/strict';
import {clientPool} from '../src/db/clientPool.js';
import {searchExpenseErpDocuments} from '../src/services/expenseErpDocuments.js';

// Executes the production SQL against inline fixtures; no database writes.
test('expense document plate fallback preserves the full invoice identity', {
  skip: process.env.EXPENSE_ERP_DB_TEST !== '1',
}, async () => {
  const original = clientPool.query.bind(clientPool);
  let invoice = {company:2,series:'1',number:527864,supplier:1877,plate:'RAA8G18'};
  let payablePlate = null;
  clientPool.query = (sql, params) => original(`WITH
    fixture_pagar AS (
      SELECT 2 AS empresapag,'1'::text AS seriepag,527864::bigint AS duplicatapag,
        '1'::text AS parcelapag,NULL::text AS documentopag,DATE '2026-11-18' AS dataemissaopag,
        2654.59 AS valorduplicatapag,$4::text AS veiculopag,1877 AS fornecedorpag
    ),
    fixture_notas AS (
      SELECT $5::int AS empresanfe,$6::text AS serienfe,$7::int AS codigonfe,
        $8::int AS fornecedornfe,$9::text AS veiculonfe
    ),
    fixture_fornecedores AS (
      SELECT 1 AS empresafor,1877 AS codigofor,'POSTO'::text AS fantasiafor,'POSTO LTDA'::text AS nomefor
    ) ${sql.replaceAll('financeiro.pagar','fixture_pagar')
      .replaceAll('compras.notasfiscaisentrada','fixture_notas')
      .replaceAll('gerais.fornecedores','fixture_fornecedores')}`,
  [...params,payablePlate,invoice.company,invoice.series,invoice.number,invoice.supplier,invoice.plate]);
  const search = (filters={}) => searchExpenseErpDocuments({q:'527864',plate:'RAA8G18',...filters});
  try {
    assert.equal((await search()).documents[0].plate,'RAA8G18');
    assert.equal((await search()).documents[0].plateSource,'invoice');
    assert.equal((await search()).documents[0].plateConflict,false);
    payablePlate='   ';
    assert.equal((await search()).documents.length,1);
    payablePlate='BBB1C23';
    assert.equal((await search()).documents.length,0,'conflicting financial plate takes precedence');
    const conflict=(await search({plate:'BBB1C23'})).documents[0];
    assert.equal(conflict.plateConflict,true);
    assert.equal(conflict.financialPlate,'BBB1C23');
    assert.equal(conflict.invoicePlate,'RAA8G18');
    assert.equal(conflict.plateSource,'financial');
    payablePlate=null;
    for (const [key,value] of Object.entries({company:3,series:'2',number:527865,supplier:1878,plate:'BBB1C23'})) {
      const previous=invoice[key]; invoice[key]=value;
      assert.equal((await search()).documents.length,0,`must match ${key}`);
      invoice[key]=previous;
    }
    assert.equal((await search({series:'2'})).documents.length,0);
    assert.equal((await search({q:'RAA8G18'})).documents.length,1);
    assert.equal((await search({q:'POSTO'})).documents.length,1);
    payablePlate='raa-8g18';
    assert.equal((await search()).documents[0].plateConflict,false,'formatting is not a conflict');
    invoice.plate=null;
    assert.equal((await search()).documents.length,1,'existing financial plate remains supported');
    payablePlate=null;
    assert.equal((await search()).documents.length,0,'missing plate does not bypass filtering');
  } finally {
    clientPool.query=original;
    await clientPool.end();
  }
});
