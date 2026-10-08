import test from 'node:test';
import assert from 'node:assert/strict';
import {monthShare,vehicleIndicators,tripIndicators,vehiclePeriod} from '../src/services/tripIndicators.js';
test('usa os dias da viagem por padrão e permite o mês inteiro inclusive bissexto',()=>{
  const trip={saida:'2026-09-25',chegada:'2026-09-30'};
  assert.deepEqual(vehiclePeriod(trip),{start:'2026-09-25',end:'2026-09-30'});
  assert.deepEqual(vehiclePeriod(trip,'2024-02'),{start:'2024-02-01',end:'2024-02-29'});
  assert.throws(()=>vehiclePeriod(trip,'2026-13'));
});
test('mês inteiro inclui receitas fora da viagem e o financiamento integral sem duplicar',()=>{
  const result=vehicleIndicators([
    {tipo:'Receita',data:'2026-09-01',valor:5000},
    {tipo:'Receita',data:'2026-09-25',valor:1000},
    {tipo:'Despesa',data:'2026-09-25',valor:-400,contaMascara:'4.1.004'},
    {tipo:'Despesa',data:'2026-09-25',valor:-3000,origem:'pagar',contaMascara:'6.5.001'},
  ],[{data:'2026-09-10',valor:3000,contaMascara:'6.5.001'}],'2026-09-01','2026-09-30');
  assert.equal(result.receita,6000);assert.equal(result.custo,3400);assert.equal(result.lucro,2600);assert.equal(result.financiamentos,3000);
});
test('rateio inclusivo considera mês curto, bissexto e viagem entre meses',()=>{
  assert.deepEqual(monthShare('2026-09-10','2026-09-25','2026-09-30'),{dias:6,diasMes:30});
  assert.deepEqual(monthShare('2024-02-10','2024-02-28','2024-03-02'),{dias:2,diasMes:29});
  assert.deepEqual(monthShare('2024-03-10','2024-02-28','2024-03-02'),{dias:2,diasMes:31});
});
test('não duplica fixos do pagar, preserva receitas e rateia parcelas por mês',()=>{
  const dre=[
    {tipo:'Receita',data:'2026-09-25',valor:5000,origem:'receber'},
    {tipo:'Receita',data:'2026-09-01',valor:90000,origem:'receber'},
    {tipo:'Despesa',data:'2026-09-25',valor:-400,origem:'pagar',contaMascara:'4.1.004'},
    {tipo:'Despesa',data:'2026-09-25',valor:-3000,origem:'pagar',contaMascara:'6.5.001'},
    {tipo:'Despesa',data:'2026-09-01',valor:-300,origem:'movimentacao',contaMascara:'6.2.015'},
  ];
  const fixed=[{data:'2026-09-10',valor:3000,contaMascara:'6.5.001'}];
  const result=vehicleIndicators(dre,fixed,'2026-09-25','2026-09-30');
  assert.equal(result.receita,5000);assert.equal(result.custo,1060);assert.equal(result.lucro,3940);
  assert.equal(result.fixos,660);assert.equal(result.financiamentos,600);assert.equal(result.itens.length,4);
});
test('custos líquidos da viagem conciliam com o saldo ERP e não duplicam o acerto',()=>{
  const result=tripIndicators({fretes:1000,totalViagem:650,despesas:200,abastecimentos:100,comissao:100,diarias:50});
  assert.equal(result.custo,350);assert.equal(result.lucro,650);assert.equal(result.componentes.at(-1).valor,-50);
  assert.equal(tripIndicators({fretes:0,totalViagem:0}).margem,null);
  assert.equal(tripIndicators({fretes:100}).disponivel,false);
});
