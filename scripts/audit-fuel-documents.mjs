import fs from 'node:fs/promises';
import {clientPool} from '../src/db/clientPool.js';
import {baseCostCte} from '../src/services/custosVeiculosService.js';
import {abastecimentoFinanceiroMatchSql} from '../src/services/abastecimentoFinanceiroSql.js';
const month = process.argv[2] || '2026-08';
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Expected YYYY-MM');
const [year, number] = month.split('-').map(Number);
const params = [`${month}-01`, new Date(Date.UTC(year, number, 0)).toISOString().slice(0,10)];
try {
  const ops = (await clientPool.query(`
    SELECT a.empresaaba AS empresa,a.codigoaba AS codigo,a.dataaba::date AS data,
      a.veiculoaba AS placa,a.documentoaba AS documento,a.totalaba AS total,
      a.financeiroaba AS financeiro,p.nomepro AS produto,m.matches
    FROM frotas.abastecimentos a
    LEFT JOIN LATERAL (
      SELECT v.tipopropriedadevei FROM frotas.veiculos v
      WHERE upper(trim(v.placavei))=upper(trim(a.veiculoaba))
      ORDER BY(v.empresavei=a.empresaaba) DESC,v.empresavei LIMIT 1
    )v ON true
    LEFT JOIN LATERAL (
      SELECT p.nomepro FROM estoque.produtos p WHERE p.codigopro=a.combustivelaba
      ORDER BY(p.empresapro=a.empresaaba) DESC,p.empresapro LIMIT 1
    )p ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('empresa',pag.empresapag,'serie',pag.seriepag,
        'duplicata',pag.duplicatapag,'parcela',pag.parcelapag,'fornecedor',pag.fornecedorpag,
        'emissao',pag.dataemissaopag::date,'vencimento',pag.datavencimentopag::date,
        'status',pag.statuspag,'valor',pag.valorduplicatapag)) AS matches
      FROM financeiro.pagar pag WHERE ${abastecimentoFinanceiroMatchSql().replaceAll('aba.', 'a.')}
    )m ON true
    WHERE a.dataaba::date BETWEEN $1::date AND $2::date AND v.tipopropriedadevei='P'
  `, params)).rows;
  const cte = baseCostCte().replace(
    'WHERE pag.datavencimentopag::date >= $1::date\n        AND pag.datavencimentopag::date <= $2::date',
    'WHERE pag.dataemissaopag::date >= $1::date\n        AND pag.dataemissaopag::date <= $2::date');
  const financial = (await clientPool.query(cte + `
    SELECT id,empresa,serie,duplicatapag,parcelapag,fornecedor_codigo,placa_resolvida,
      data,vencimento,valor,documento,historico FROM custos_status
    WHERE proprietario='frota' AND tipo_custo='Abastecimento' ORDER BY data,id
  `, params)).rows;
  const sum = rows => Math.round(rows.reduce((total,row)=>total+Number(row.total),0)*100)/100;
  console.log(JSON.stringify({month,operacionais:ops.length,total:sum(ops),comVinculo:ops.filter(row=>row.matches).length,
    semVinculo:ops.filter(row=>!row.matches).length,valorSemVinculo:sum(ops.filter(row=>!row.matches)),financeiro:financial.length}));
  await fs.writeFile(new URL(`../../.local-logs/fuel-documents-${month}.json`,import.meta.url), JSON.stringify({ops,financial},null,2));
} finally {await clientPool.end();}
