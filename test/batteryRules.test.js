import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBattery, batteryMessage} from '../src/services/batteryRules.js';
const now = Date.parse('2026-10-26T13:00:00Z');
const rows = (v=24) => [0,5,10].map(minutes => ({data_hora:new Date(now-minutes*60000),bateria_carreta:v,ignicao:false,rpm:null,velocidade:0}));
test('requires sustained distinct readings and fresh data', () => {
  assert.equal(evaluateBattery(rows(),now).level,'baixo');
  assert.equal(evaluateBattery(rows(23),now).level,'critico');
  assert.equal(evaluateBattery(rows().slice(0,2),now),null);
  assert.equal(evaluateBattery(rows(),now+6*60000),null);
  assert.equal(evaluateBattery([rows()[0],rows()[0],rows()[2]],now),null);
});
test('ignition, missing values, movement, charging and gaps block alerts', () => {
  for (const patch of [{ignicao:true},{ignicao:null},{rpm:600},{velocidade:5},{bateria_carreta:null},{bateria_carreta:0},{bateria_carreta:28},{bateria_carreta:12}]) {
    const data=rows(); Object.assign(data[1],patch); assert.equal(evaluateBattery(data,now),null);
  }
  assert.equal(evaluateBattery([rows()[0],rows()[2],{...rows()[2],data_hora:new Date(now-15*60000)}],now),null);
});
test('simulated message clearly labels fictitious data', () => {
  assert.match(batteryMessage('RAA8G58',{voltage:23,level:'critico'},true),/Dados simulados/);
});
