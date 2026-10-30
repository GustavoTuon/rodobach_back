import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBattery, batteryMessage, batteryTransition} from '../src/services/batteryRules.js';
const now = Date.parse('2026-10-26T13:00:00Z');
const rows = (v=24) => [0,5,10].map(minutes => ({data_hora:new Date(now-minutes*60000),bateria_carreta:v,ignicao:false,rpm:null,velocidade:0}));
test('requires sustained distinct readings and fresh data', () => {
  assert.equal(evaluateBattery(rows(),now).level,'atencao');
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

test('critical suffix is evaluated independently of earlier attention readings',()=>{
  const data=[...rows(23),{...rows()[0],data_hora:new Date(now-15*60000)}];
  const event=evaluateBattery(data,now);
  assert.equal(event.level,'critico');assert.equal(event.durationMinutes,10);
  assert.equal(event.samples,3);
  assert.equal(evaluateBattery([{...rows()[0],bateria_carreta:23},...rows().slice(1)],now).level,'atencao');
});

test('recovery requires sustained fresh readings and never follows missing telemetry',()=>{
  assert.equal(evaluateBattery(rows(25),now).level,'recuperado');
  assert.equal(evaluateBattery(rows(27).map(r=>({...r,ignicao:true,rpm:600})),now).level,'recuperado');
  assert.equal(evaluateBattery(rows(25).slice(0,2),now),null);
  assert.equal(evaluateBattery(rows(25),now+6*60000),null);
  assert.equal(evaluateBattery(rows(25).map(r=>({...r,ignicao:null})),now),null);
});

test('persistent incidents notify once, escalate once, recover and permit a new incident',()=>{
  const event=evaluateBattery(rows(),now);
  let result=batteryTransition(undefined,event);
  assert.equal(result.notify,false);
  let state=JSON.parse(JSON.stringify(result.state));
  assert.equal(batteryTransition(state,event).notify,false);
  assert.equal(batteryTransition(state,null).notify,false);
  result=batteryTransition(state,{...event,time:new Date(now+2*86400000).toISOString()});
  assert.equal(result.notify,false);
  state=result.state;
  result=batteryTransition(state,{...event,level:'critico',time:new Date(now+2*86400000+60000).toISOString()});
  assert.equal(result.notify,true);state=result.state;
  result=batteryTransition(state,{...event,time:new Date(now+2*86400000+120000).toISOString()});
  assert.equal(result.notify,false);assert.equal(result.state.level,'critico');state=result.state;
  result=batteryTransition(state,{...event,level:'recuperado',time:new Date(now+2*86400000+180000).toISOString()});
  assert.equal(result.notify,false);assert.equal(result.state.active,false);
  assert.equal(batteryTransition(result.state,{...event,level:'critico',time:new Date(now+2*86400000+240000).toISOString()}).notify,true);
  assert.equal(batteryTransition(undefined,{...event,level:'recuperado'}).notify,false);
});

test('message reports observed duration without inventing precision or diagnosis',()=>{
  const event=evaluateBattery(rows(),now);
  const message=batteryMessage('RAA8G58',event);
  assert.match(message,/ATENÇÃO/);assert.match(message,/\*24 V\*/);
  assert.match(message,/3 leituras em 10 minutos/);
  assert.match(message,/não confirma defeito/);
});

test('attention and recovery stay silent but critical escalation is sent',()=>{
  const event=evaluateBattery(rows(),now);
  let state=batteryTransition(undefined,event).state;
  state=batteryTransition(state,{...event,level:'recuperado',time:new Date(now+60000).toISOString()}).state;
  let result=batteryTransition(state,{...event,time:new Date(now+120000).toISOString()});
  assert.equal(result.notify,false);
  assert.equal(batteryTransition(result.state,{...event,level:'recuperado',time:new Date(now+180000).toISOString()}).notify,false);
  result=batteryTransition(result.state,{...event,level:'critico',time:new Date(now+180000).toISOString()});
  assert.equal(result.notify,true);
});

test('critical notifications survive restarts and do not repeat after 24 hours or missing data',()=>{
  const event=evaluateBattery(rows(23),now);
  const first=batteryTransition(undefined,event);
  assert.equal(first.notify,true);
  const state=JSON.parse(JSON.stringify(first.state));
  assert.equal(batteryTransition(state,null).notify,false);
  assert.equal(batteryTransition(state,{...event,time:new Date(now+2*86400000).toISOString()}).notify,false);
});
