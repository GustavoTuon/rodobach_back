import test from 'node:test';
import assert from 'node:assert/strict';
import {costKind,profitModel,applyProfitTargets} from '../src/services/fleetProfitModel.js';
const history=['2026-01','2026-02','2026-03'].map(month=>({month,revenue:50000,eligible:true}));
const item={plate:'ABC1234',history,actual:10000,target:60000,series:[{day:1,revenue:10000}]};
const costs=history.flatMap(({month})=>[{account:'Combustíveis e Lubrificantes',cost:20000},{account:'Seguro',cost:5000},{account:'Financiamento de Veículos',cost:10000},{account:'Aquisição de novos Veiculos',cost:100000}].map(row=>({...row,plate:item.plate,month})));
test('meta usa margem sobre receita, parcelas separadas e piso histórico',()=>{
 const model=profitModel(item,costs,15);
 assert.equal(model.operatingBreakEven,8333.33);assert.equal(model.cashBreakEven,25000);
 assert.equal(model.requiredForMargin,33333.33);assert.equal(model.target,50000);
 assert.equal(model.excluded,300000);assert.equal(model.estimatedCashAtTarget,15000);
 assert.equal(costKind('Salários Variáveis'),'variable');assert.equal(costKind('Adiantamento Viagens'),'excluded');
});
test('reserva e margem elevam meta sem multiplicar custo por 1+margem',()=>{
 const model=profitModel(item,costs,20,15000);
 assert.equal(model.requiredForMargin,75000);assert.equal(model.target,75000);assert.equal(model.beyondHistory,true);
});
test('não inventa meta com custos ausentes ou contribuição insuficiente',()=>{
 assert.equal(profitModel(item,[],15).target,null);
 assert.equal(profitModel(item,costs.filter(row=>row.month!=='2026-02'),15).target,null);
 const expensive=costs.map(row=>({...row,cost:row.account.includes('Combust')?45000:row.cost}));
 assert.equal(profitModel(item,expensive,15).target,null);
});
test('não usa custos de outro mês, outra placa ou mês selecionado',()=>{
 const original=profitModel(item,costs);
 const altered=profitModel(item,[...costs,{plate:item.plate,month:'2026-04',account:'Seguro',cost:999999},{plate:'ZZZ1234',month:'2026-01',account:'Seguro',cost:999999}]);
 assert.deepEqual(altered,original);
});
test('controles, série e resumo usam a nova meta sem alterar entrada',()=>{
 const result=applyProfitTargets({period:{days:30,elapsed:6},items:[item],summary:{vehicles:1},method:{}},costs);
 assert.equal(result.items[0].expected,12000);assert.equal(result.items[0].status,'abaixo');
 assert.equal(result.summary.target,60000);assert.equal(result.items[0].series[0].expected,2000);
 assert.equal(item.target,60000);
});
