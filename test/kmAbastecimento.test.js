import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarOdometros } from '../src/services/kmAbastecimento.js';
const p=(data,km)=>({data,km});
test('usa diferenca de odometros, sem somar duplicatas',()=>{
 const rows=[p('2026-08-01T03:00Z',1000),p('2026-08-01T03:00Z',1000),p('2026-08-01T23:00Z',1100)];
 assert.equal(avaliarOdometros(rows,'2026-08-01','2026-08-01').km,100);
});
test('rejeita regressao, salto e cobertura desatualizada',()=>{
 assert.equal(avaliarOdometros([p('2026-08-01T03:00Z',1000),p('2026-08-01T04:00Z',900)],'2026-08-01','2026-08-01'),null);
 assert.equal(avaliarOdometros([p('2026-08-01T03:00Z',1000),p('2026-08-01T04:00Z',9000)],'2026-08-01','2026-08-01'),null);
 assert.equal(avaliarOdometros([p('2026-08-01T03:00Z',1000),p('2026-08-01T04:00Z',1010)],'2026-08-01','2026-08-31'),null);
});
test('ERP preserva datas efetivas e zero valido',()=>{
 const r=avaliarOdometros([p('2026-08-02T03:00Z',1000),p('2026-08-03T03:00Z',1000)],'2026-08-01','2026-08-31',false);
 assert.equal(r.km,0); assert.equal(r.inicio,'2026-08-02T03:00Z');
});
