import assert from 'node:assert/strict';
import test from 'node:test';
import {clientPool} from '../src/db/clientPool.js';
import {getEvolucaoCustos,baseCostCte} from '../src/services/custosVeiculosService.js';

test('custos sem telemetria retornam os lançamentos em uma única consulta',async(t)=>{
  const query=t.mock.method(clientPool,'query',async()=>({rows:[{id:'teste',data:'2026-08-10',placa_resolvida:'ABC1D23',valor:150,tipo_custo:'Abastecimento'}]}));
  const result=await getEvolucaoCustos({startDate:'2026-08-01',endDate:'2026-08-31',includeDistance:'false'});
  assert.equal(query.mock.callCount(),1);
  assert.equal(result.launches[0].valor,150);
  assert.deepEqual(result.distance,{available:false,monthly:[]});
  assert.deepEqual(result.prior,{startDate:'2026-07-01',endDate:'2026-07-31'});
  const sql=query.mock.calls[0].arguments[0];
  assert.match(sql,/WHERE pag.dataemissaopag::date >= \$1/);
  assert.doesNotMatch(sql,/WHERE pag.datavencimentopag::date >= \$1/);
  assert.match(sql,/AS fuel_products/);
  assert.match(baseCostCte(),/WHERE pag.datavencimentopag::date >= \$1/);
});

test('consulta exclusiva de KM sem placas não consulta custos',async(t)=>{
  const query=t.mock.method(clientPool,'query',async()=>{throw new Error('Não deve consultar o ERP');});
  const result=await getEvolucaoCustos({startDate:'2026-08-01',endDate:'2026-08-31',distanceOnly:'true',placas:''});
  assert.equal(query.mock.callCount(),0);
  assert.deepEqual(result,{available:true,monthly:[]});
  await assert.rejects(()=>getEvolucaoCustos({startDate:'2026-08-31',endDate:'2026-08-01',distanceOnly:'true'}),{status:400});
  await assert.rejects(()=>getEvolucaoCustos({startDate:'2026-02-30',endDate:'2026-03-01',distanceOnly:'true'}),{status:400});
});
