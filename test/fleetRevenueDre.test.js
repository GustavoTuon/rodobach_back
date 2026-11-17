import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDreRevenueDaily,buildFleetRevenue,revenuePeriod} from '../src/services/fleetRevenueTargets.js';
import {getDreEmpresarial} from '../src/services/dreEmpresarialService.js';
import {clientPool} from '../src/db/clientPool.js';

test('panel optimization preserves DRE joins and keeps its cache separate',async t=>{
 const queries=[];
 t.mock.method(clientPool,'query',async(sql,params)=>{queries.push({sql,params});return {rows:[]};});
 const period={startDate:'2026-11-01',endDate:'2026-11-16'};
 await getDreEmpresarial(period);
 await getDreEmpresarial(period,{positiveFinancialOnly:true});
 assert.equal(queries.length,2);
 assert.deepEqual(queries[0].params,queries[1].params);
 assert.match(queries[0].sql,/UNION ALL SELECT \* FROM receita_cte_sem_titulo/);
 assert.doesNotMatch(queries[1].sql,/UNION ALL SELECT \* FROM receita_cte_sem_titulo/);
 assert.match(queries[1].sql,/AND b.valor > 0/);
 for(const {sql} of queries){
  assert.match(sql,/financeiro.valorliquidorateiosreceber/);
  assert.match(sql,/UNION ALL SELECT \* FROM movimentacao/);
 }
});

test('financial installments include OC titles and exclude untitled transport documents',()=>{
 const rows=[
  {placa:'RYP7D29',data:'2026-11-13',valor:4335.50,origem:'receber'},
  {placa:'RYP7D29',data:'2026-11-13',valor:4335.50,origem:'receber'},
  {placa:'RYP7D29',data:'2026-11-13',valor:2164.50,origem:'receber'},
  {placa:'RYP7D29',data:'2026-11-13',valor:2164.50,origem:'receber'},
  {placa:'RXO6C18',data:'2026-11-09',valor:5,origem:'cte_sem_titulo'},
  {placa:'RXO6C18',data:'2026-11-09',valor:4200,origem:'receber'},
  {placa:'RXO6C18',data:'2026-11-09',valor:-100,origem:'pagar'},
 ];
 assert.deepEqual(buildDreRevenueDaily(rows),[
  {plate:'RYP7D29',day:'2026-11-13',revenue:13000},
  {plate:'RXO6C18',day:'2026-11-09',revenue:4200},
 ]);
});

test('DRE source feeds both history and current totals, respecting closed days and fleet scope',()=>{
 const daily=buildDreRevenueDaily([
  {placa:'SXR8D09',data:'2026-10-07',valor:9319.05,origem:'receber'},
  {placa:'SXR8D09',data:'2026-11-01',valor:3200,origem:'receber'},
  {placa:'SXR8D09',data:'2026-11-09',valor:9000,origem:'receber'},
  {placa:'SXR8D09',data:'2026-11-17',valor:9999,origem:'receber'},
  {placa:'OUT1234',data:'2026-11-09',valor:9999,origem:'receber'},
 ]);
 const data=buildFleetRevenue([{plate:'SXR8D09'}],daily,revenuePeriod('2026-11',new Date('2026-11-17T15:00:00Z')));
 assert.equal(data.summary.actual,12200);
 assert.equal(data.items[0].history.find(r=>r.month==='2026-10').revenue,9319.05);
 assert.equal(data.items[0].series.at(-1).revenue,12200);
});
