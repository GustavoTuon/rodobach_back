import fs from 'node:fs/promises';
import {getDreEmpresarial} from '../src/services/dreEmpresarialService.js';
import {getCustosVeiculos} from '../src/services/custosVeiculosService.js';
import {getAbastecimento, getAnaliseFrota} from '../src/services/analiseFrotaService.js';
import {getFluxoCaixa} from '../src/services/fluxoCaixaService.js';

const month = process.argv[2] || '2026-08';
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Expected YYYY-MM');
const [year, number] = month.split('-').map(Number);
const startDate = `${month}-01`, endDate = new Date(Date.UTC(year, number, 0)).toISOString().slice(0,10);
const filters = {startDate, endDate, proprietario: 'frota', limit: 5000};
const round = value => Math.round(value * 100) / 100;
const sum = (rows, field) => round(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
const fuel = value => /combust|abastec|diesel/i.test(value || '');
const result = {capturedAt: new Date().toISOString(), filters, screens: {}};
const jobs = [
  ['dre', () => getDreEmpresarial({startDate, endDate, tipo: 'frota'})],
  ['custos', () => getCustosVeiculos(filters)],
  ['abastecimentos', () => getAbastecimento(filters)],
  ['fluxo', () => getFluxoCaixa({startDate, endDate, mode: 'realizado', limit: 5000})],
  ['analise', () => getAnaliseFrota(filters)],
];
for (const [name, execute] of jobs) {
  const started = Date.now();
  try {
    const data = await execute();
    result.screens[name] = data;
    const details = name === 'dre' ? {summary: data.summary, contasCombustivel: data.accounts.filter(row => fuel(row.contaNome)), custoPorSinal: -sum(data.rows.filter(row=>row.valor<0), 'valor')}
      : name === 'custos' ? {summary: data.summary, tipos: data.types, resultado: data.profit.summary, somaDetalhes: sum(data.launches,'valor'), detalhes: data.launches.length}
      : name === 'abastecimentos' ? {summary: data.summary, somaDetalhes: sum(data.lancamentos || [],'total')}
      : name === 'fluxo' ? {summary: data.summary, categoriasCombustivel: data.categories.filter(row=>row.tipo==='saida' && fuel(row.categoria))}
      : {visaoGeral: data.visaoGeral, custos: data.custos.summary, resultado: data.lucro?.summary, dreFrota: data.dreFrota?.summary};
    console.log(JSON.stringify({month, name, durationMs: Date.now()-started, ...details}));
  } catch(error) {
    result.screens[name] = {error: error.message, code: error.code};
    console.log(JSON.stringify({month,name,error:error.message,code:error.code}));
  }
  await fs.writeFile(new URL(`../../.local-logs/cost-screens-${month}.json`, import.meta.url), JSON.stringify(result, null, 2));
}
process.exit(0);
