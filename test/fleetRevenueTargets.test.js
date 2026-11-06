import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {requireRoutePermission} from '../src/middleware/permissions.js';
import {buildFleetRevenue,revenuePeriod,percentile75} from '../src/services/fleetRevenueTargets.js';
const now=new Date('2026-11-05T15:00:00Z');
const vehicle={plate:'ABC1234',acquired:null};
test('percentil usa interpolação e não altera amostra',()=>{
 const values=[40000,10000,30000,20000];assert.equal(percentile75(values),32500);assert.deepEqual(values,[40000,10000,30000,20000]);
});
test('meta exclui mês em curso, inclui meses zerados e compara somente dias encerrados',()=>{
 const daily=[{plate:'ABC1234',day:'2026-01-20',revenue:40000},{plate:'ABC1234',day:'2026-02-20',revenue:60000},{plate:'ABC1234',day:'2026-11-04',revenue:10000},{plate:'ABC1234',day:'2026-11-05',revenue:999999}];
 const item=buildFleetRevenue([vehicle],daily,revenuePeriod(null,now)).items[0];
 assert.equal(item.sampleMonths,10);assert.equal(item.target,null);assert.equal(item.actual,10000);
 assert.equal(item.history.find(row=>row.month==='2026-03').revenue,0);assert.equal(item.history.at(-1).eligible,false);
 assert.equal(item.series.at(-1).day,4);assert.equal(item.series.at(-1).revenue,10000);assert.equal(item.status,'sem_base');
});
test('aquisição parcial começa no mês seguinte e meta histórica não usa futuro',()=>{
 const daily=Array.from({length:6},(_,i)=>({plate:'ABC1234',day:`2026-${String(i+5).padStart(2,'0')}-20`,revenue:i===0?999999:80000+i*1000}));
 const item=buildFleetRevenue([{...vehicle,acquired:'2026-05-15'}],daily,revenuePeriod(null,now)).items[0];
 assert.equal(item.baseStart,'2026-06');assert.equal(item.sampleMonths,5);assert.equal(item.target,84000);
 const past=buildFleetRevenue([{...vehicle,acquired:'2026-05-15'}],daily,revenuePeriod('2026-08',now)).items[0];
 assert.equal(past.sampleMonths,2);assert.equal(past.provisional,true);assert.equal(past.status,'sem_base');assert.equal(past.actual,83000);
});
test('sem histórico não recebe meta inventada; janeiro e dia 1 não dividem por zero',()=>{
 for(const time of ['2026-01-01T15:00:00Z','2026-11-01T15:00:00Z']){
  const item=buildFleetRevenue([vehicle],[],revenuePeriod(null,new Date(time))).items[0];
  assert.equal(item.target,null);assert.equal(item.pace,null);assert.equal(item.projection,null);assert.equal(item.status,'sem_base');
 }
});
test('ritmo usa meta proporcional, mantém valor acumulado e distingue limiares',()=>{
 const base=Array.from({length:10},(_,i)=>({plate:'ABC1234',day:`2026-${String(i+1).padStart(2,'0')}-10`,revenue:30000}));
 for(const [revenue,status] of [[4000,'acima'],[3600,'atencao'],[3590,'abaixo']]) {
  const item=buildFleetRevenue([vehicle],[...base,{plate:'ABC1234',day:'2026-11-03',revenue}],revenuePeriod(null,now)).items[0];
  assert.equal(item.target,30000);assert.equal(item.expected,4000);assert.equal(item.status,status);assert.equal(item.series[4].revenue,revenue);
 }
});
test('datas respeitam Brasília, rejeitam mês futuro e ano diferente',()=>{
 assert.equal(revenuePeriod(null,new Date('2026-11-01T01:00:00Z')).month,'2026-10');
 for(const month of ['2025-12','2026-12','2026-00','invalid'])assert.throws(()=>revenuePeriod(month,now),/Selecione/);
});
test('painel financeiro exige acesso financeiro, não apenas Painel TV operacional',async()=>{
 const app=express();let user={permissions:{'painel-tv':true}};
 app.use((req,res,next)=>{req.user=user;next();});app.use(requireRoutePermission);app.get('/financeiro/painel-faturamento',(req,res)=>res.json({ok:true}));
 assert.equal((await request(app).get('/financeiro/painel-faturamento')).status,403);
 user={permissions:{'faturamento-diario':true}};assert.equal((await request(app).get('/financeiro/painel-faturamento')).status,200);
});
