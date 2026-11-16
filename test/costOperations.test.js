import assert from 'node:assert/strict';
import test from 'node:test';
import {clientPool} from '../src/db/clientPool.js';
import {pool} from '../src/db/pool.js';
import {getCostOperations} from '../src/services/costOperationsService.js';

test('preserva fonte disponível quando a consulta de OS falha',async(t)=>{
  t.mock.method(clientPool,'query',async(sql)=>{
    if(sql.includes('FROM frotas.ordensservicosexterna o'))throw new Error('OS offline');
    return {rows:[{data:'2026-10-15',id:'1',placa:'ABC1D23',litros:100,total:600,km:300,odometro:1000,combustivel:'DIESEL S10'}]};
  });
  t.mock.method(pool,'query',async()=>({rows:[{placa:'ABC1D23',control:'km'}]}));
  const d=await getCostOperations({startDate:'2026-10-01',endDate:'2026-10-31'},{proprietario:'frota'});
  assert.equal(d.fuel.available,true);
  assert.equal(d.fuel.rows.length,1);
  assert.equal(d.maintenance.available,false);
  assert.match(d.maintenance.message,/ordens de serviço/);
  assert.equal(d.plans.available,true);
  assert.deepEqual(d.prior,{startDate:'2026-09-01',endDate:'2026-09-30'});
});

test('OS vazias são distintas de fonte indisponível, e planos não bloqueiam a consulta',async(t)=>{
  const erp=t.mock.method(clientPool,'query',async()=>({rows:[]}));
  t.mock.method(pool,'query',async()=>{throw new Error('plans offline');});
  const d=await getCostOperations({startDate:'2026-08-01',endDate:'2026-08-31'},{proprietario:'terceiro'});
  assert.equal(d.maintenance.available,true);
  assert.deepEqual(d.maintenance.rows,[]);
  assert.equal(d.plans.available,false);
  const sql=erp.mock.calls.find(call=>call.arguments[0].includes('FROM frotas.ordensservicosexterna o')).arguments[0];
  assert.match(sql,/COALESCE\(v.tipopropriedadevei,'T'\)<>'P'/);
  assert.match(sql,/AS data/);
});
