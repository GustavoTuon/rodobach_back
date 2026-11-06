import test from 'node:test';
import assert from 'node:assert/strict';
import {NOVEMBER_2026_PLAN,selectFleetTarget} from '../src/services/fleetRevenuePlan.js';
import {profitModel} from '../src/services/fleetProfitModel.js';
test('plano soma 720 mil, permanece fixo e simulação não o modifica',()=>{
 assert.equal(Object.values(NOVEMBER_2026_PLAN).reduce((a,b)=>a+b,0),720000);
 const item={plate:'RYP7D29',trailers:['RYZ2D12'],historicalTarget:77000},model={requiredForMargin:66778,historicalAverage:70508};
 assert.equal(selectFleetTarget(item,model,{month:'2026-11'},15,0).target,95000);
 const revised=selectFleetTarget(item,{...model,requiredForMargin:105000},{month:'2026-11'},15,0);
 assert.equal(revised.target,95000);assert.equal(revised.planNeedsReview,true);
 assert.equal(selectFleetTarget(item,{...model,requiredForMargin:105000},{month:'2026-11'},20,0).target,105000);
 assert.equal(NOVEMBER_2026_PLAN.RYP7D29,95000);
 assert.equal(selectFleetTarget(item,model,{month:'2026-10'},15,0).targetMode,'simulacao');
});
test('custos do implemento entram uma vez e permanecem identificados',()=>{
 const history=['2026-01','2026-02','2026-03'].map(month=>({month,revenue:100000,eligible:true}));
 const costs=history.flatMap(({month})=>[{plate:'AAA1234',account:'Combustivel',cost:30000},{plate:'AAA1234',account:'Seguro',cost:1000},{plate:'BBB1234',account:'Seguro',cost:2000},{plate:'CCC1234',account:'Seguro',cost:999999}].map(row=>({...row,month})));
 const model=profitModel({plate:'AAA1234',costPlates:['AAA1234','BBB1234','BBB1234'],history},costs);
 assert.equal(model.fixed,3000);assert.equal(model.accounts.length,3);
 assert.equal(model.accounts.some(row=>row.plate==='BBB1234'),true);
 assert.equal(model.accounts.some(row=>row.plate==='CCC1234'),false);
});
