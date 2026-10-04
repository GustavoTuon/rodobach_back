import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyReadings,summarizeDailyOdometers} from '../src/services/dailyOdometer.js';
const r=(data,km,placa='ABC1234')=>({data,km,placa});
test('preserva fechamento e calcula delta sem somar hodômetros ou duplicatas',()=>{
 const data=buildDailyReadings([r('2026-09-01T02:55:00Z',1000),r('2026-09-01T16:00:00Z',1300),r('2026-09-02T02:55:00Z',1500),r('2026-09-02T02:55:00Z',1500)],'2026-09-01','2026-09-01',new Date('2026-09-04'));
 assert.equal(data[0].km,500);assert.equal(data[0].status,'valido');assert.equal(data[0].odometro_inicial,1000);assert.equal(data[0].odometro_final,1500);
});
test('falta de fechamento não vira zero; dias atuais permanecem provisórios',()=>{
 const rows=[r('2026-09-01T02:55Z',1000),r('2026-09-01T12:00Z',1200)];
 assert.equal(buildDailyReadings(rows,'2026-09-01','2026-09-01',new Date('2026-09-04'))[0].km,null);
 assert.equal(buildDailyReadings(rows,'2026-09-01','2026-09-01',new Date('2026-09-01T15:00Z'))[0].status,'provisorio');
});
test('rejeita regressões e saltos e mantém zero real de veículo parado',()=>{
 for(const km of [900,90000]) {
 const [day]=buildDailyReadings([r('2026-09-01T02:55Z',1000),r('2026-09-02T02:55Z',km)],'2026-09-01','2026-09-01',new Date('2026-09-04'));
 assert.equal(day.status,'pendente');assert.equal(day.km,null);
 }
 const [day]=buildDailyReadings([r('2026-09-01T02:55Z',1000),r('2026-09-02T02:55Z',1000)],'2026-09-01','2026-09-01',new Date('2026-09-04'));
 assert.equal(day.km,0);assert.equal(day.status,'valido');
});
test('período parcial não autoriza km/l com todos os litros do período',()=>{
 const rows=[{dia:'2026-09-01',status:'valido',km:500}];
 assert.equal(summarizeDailyOdometers(rows,{startDate:'2026-09-01',endDate:'2026-09-02'}).km,null);
 assert.equal(summarizeDailyOdometers(rows,{startDate:'2026-09-01',endDate:'2026-09-02'}).kmObservado,500);
 assert.equal(summarizeDailyOdometers(rows,{startDate:'2026-09-01',endDate:'2026-09-01'}).km,500);
});
