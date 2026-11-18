import test from 'node:test';
import assert from 'node:assert/strict';
import {alertType, componentAlertType, buildMaintenanceAlertMessage} from '../src/services/manutencaoAlertaService.js';

const plan={tipo_controle:'km',km_proximo_envio:100000,titulo:'Troca de óleo',placa:'RAA8G58'};
test('faixas incluem limites exatos e selecionam apenas o aviso atual',()=>{
  for(const [remaining,stage] of [[2001,null],[2000,2000],[1001,2000],[1000,1000],[501,1000],[500,500],[1,500]]) {
    const event=alertType(plan,100000-remaining);
    if(stage===null)assert.equal(event,null);
    else {assert.equal(event.stage,stage);assert.equal(event.remaining,remaining);assert.equal(event.type,'antecipado');}
  }
  for(const km of [null,undefined,NaN,Infinity])assert.equal(alertType(plan,km),null);
  for(const remaining of [0,-121])assert.equal(alertType(plan,100000-remaining).type,'vencido');
});
test('faixas têm chaves independentes estáveis e preservam histórico de 1000 km e vencimento',()=>{
  for(const get of [km=>alertType(plan,km),km=>componentAlertType({proximo_km:100000},km)]) {
    const events=[98000,99000,99500,100000].map(get);
    assert.equal(new Set(events.map(e=>`${e.type}:${e.reference}`)).size,4);
    assert.equal(get(98001).reference,events[0].reference);
    assert.equal(get(99100).reference,events[1].reference);
    assert.equal(get(99999).reference,events[2].reference);
    assert.equal(events[1].reference,events[3].reference);
  }
  assert.equal(alertType(plan,99000).reference,'100000');
  assert.equal(componentAlertType({proximo_km:100000},99000).reference,'km-100000');
  assert.notEqual(alertType({...plan,km_proximo_envio:120000},118000).reference,alertType(plan,98000).reference);
});
test('mensagens identificam urgência por cor e mostram distância real',()=>{
  for(const [km,emoji,label] of [[98000,'🟡','2.000'],[99000,'🟠','1.000'],[99500,'🔴','500']]) {
    const message=buildMaintenanceAlertMessage(plan,null,alertType(plan,km),km);
    assert.ok(message.startsWith(emoji));
    assert.ok(message.includes(`ATÉ ${label} KM`));
    assert.ok(message.includes(`Faltam ${label} km`));
  }
  const reached=buildMaintenanceAlertMessage(plan,null,alertType(plan,100000),100000);
  assert.ok(reached.startsWith('🚨'));
  assert.match(reached,/Status:\* Marco atingido/);
  const exceeded=buildMaintenanceAlertMessage(plan,null,alertType(plan,100121),100121);
  assert.match(exceeded,/Marco excedido em 121 km/);
});
