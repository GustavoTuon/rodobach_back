import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyDistance,tvLoad,tvDay,tvRoute,distanceBySource} from '../src/services/painelTvService.js';
import {ROUTE_PERMISSIONS} from '../src/middleware/permissions.js';
const day='2026-09-14';
const points=[{data:'2026-09-14T03:01:00Z',km:1000},{data:'2026-09-14T04:01:00Z',km:1060}];
test('movimento validado não fica escondido pela madrugada parada mais longa',()=>{
 const point=(hour,km)=>({data:`2026-09-14T${hour}:00-03:00`,km,origem_mensagem:5,tipo_mensagem:2});
 const result=distanceBySource([point('00:01',1000),point('01:01',1000),point('02:01',1000),point('03:01',1000),point('04:01',1000),point('05:01',900),point('05:11',910),point('05:21',920)],day);
 assert.equal(result.km,20);assert.equal(result.parcial,true);
 assert.equal(result.inicio,point('05:01',0).data);
});
test('km hoje valida hodômetro, distingue zero de ausência e marca início parcial',()=>{
 assert.equal(dailyDistance(points,day).km,60);
 assert.equal(dailyDistance(points,day).parcial,false);
 assert.equal(dailyDistance([points[0],{...points[1],km:1000}],day).km,0);
 assert.equal(dailyDistance([points[0]],day).km,null);
 assert.equal(dailyDistance([points[0],{...points[1],km:900}],day).km,null);
 assert.equal(dailyDistance([points[0],{...points[1],km:3000}],day).km,null);
 assert.equal(dailyDistance(points.map(p=>({...p,data:p.data.replace('03:01','13:01').replace('04:01','14:01')})),day).parcial,true);
 assert.equal(tvDay(new Date('2026-09-15T02:00:00Z')),day);
});
test('SM ativa não comprova carga; SM vazia tem tempo próprio e conflitos ficam visíveis',()=>{
 const now=new Date('2026-09-14T15:00:00Z');
 const row={estado:'carregado_confirmado',statusFonte:'trafegus'};
 assert.equal(tvLoad(row,{id:1,operacao:'TRANSPORTE'},now).codigo,'sem_confirmacao');
 const empty=tvLoad(row,{operacao:'VAZIO',inicio:'14/09/2026 09:00:00'},now);
 assert.equal(empty.codigo,'vazio');assert.equal(empty.horasVazio,3);
 assert.equal(tvLoad({...row,statusFonte:'automatico'},{operacao:'VAZIO',inicio:'14/09/2026 09:00:00'},now).confirmacaoPendente,true);
 assert.equal(tvLoad({estado:'vazio_sem_operacao'},null,now).horasVazio,null);
 assert.equal(tvLoad({estado:'vazio_confirmado',confianca:'alta',entregaAt:'2026-09-14T12:00:00Z'},null,now).horasVazio,null);
 assert.equal(tvLoad({estado:'vazio_confirmado',confianca:'baixa'},null,now).codigo,'sem_confirmacao');
});
test('painel TV exige a permissão de status de carga',()=>{
 assert.equal(ROUTE_PERMISSIONS.find(([regex])=>regex.test('/frota/painel-tv'))?.[1],'status-carga');
});

test('destino usa operação ativa e previsão de fim é exclusiva da SM',()=>{
 const loaded={estado:'carregado_confirmado',destino:'Curitiba / PR',entregaAt:'2026-09-20'};
 assert.equal(tvRoute(loaded,null).destino,'Curitiba / PR');
 assert.equal(tvRoute(loaded,null).previsaoFim,null);
 assert.equal(tvRoute({...loaded,estado:'vazio_confirmado'},null).destino,null);
 assert.equal(tvRoute({...loaded,situacaoOperacional:{tipo:'divergente'}},null).destino,null);
 const sm=tvRoute(loaded,{destino:'Santos / SP',previsaoFim:'15/09/2026 18:00:00'});
 assert.equal(sm.destino,'Santos / SP');assert.equal(sm.previsaoFim,'2026-09-15T21:00:00.000Z');
 assert.equal(tvRoute(loaded,{previsaoFim:'inválido'}).previsaoFim,null);
 assert.equal(tvRoute(loaded,{}).destino,null);
});

test('duplicatas idênticas não invalidam km, mas conflito no mesmo horário continua inválido',()=>{
 assert.equal(dailyDistance([points[0],points[0],points[1]],day).km,60);
 assert.equal(dailyDistance([points[0],points[0]],day).km,null);
 assert.equal(dailyDistance([points[0],{...points[0],km:1001},points[1]],day).km,null);
});

test('deduplica reenvios fora de ordem com formatos equivalentes e preserva leituras de veículo parado',()=>{
 const repeated={data:'2026-09-14T00:01:00-03:00',km:'1000.00'};
 const input=[points[1],repeated,points[0],points[1]],before=JSON.stringify(input);
 const result=dailyDistance(input,day);
 assert.equal(result.km,60);assert.equal(result.duplicatasIgnoradas,2);
 assert.equal(JSON.stringify(input),before);
 const stationary=dailyDistance([points[0],{...points[1],km:1000}],day);
 assert.equal(stationary.km,0);assert.equal(stationary.duplicatasIgnoradas,0);
 assert.equal(dailyDistance([{data:'inválido',km:500},...input],day).km,60);
});

test('seleciona uma fonte consistente sem somar fontes sobrepostas',()=>{
 const main=points.map(p=>({...p,origem_mensagem:5,tipo_mensagem:2}));
 const other=[{data:points[0].data,km:900,origem_mensagem:7,tipo_mensagem:2},{data:points[1].data,km:950,origem_mensagem:7,tipo_mensagem:2}];
 const result=distanceBySource([...main,...other],day);
 assert.equal(result.km,60);assert.equal(result.parcial,true);assert.equal(result.origem,5);
 assert.equal(distanceBySource([...main,...main],day).km,60);
});
test('recupera somente um trecho contínuo e não soma saltos ou regressões',()=>{
 const row=(time,km)=>({data:`2026-09-14T${time}:00-03:00`,km,origem_mensagem:5,tipo_mensagem:2});
 const result=distanceBySource([row('00:00',1000),row('01:00',1060),row('01:01',500),row('01:02',1062),row('02:02',1122),row('03:02',1182)],day);
 assert.equal(result.km,120);assert.equal(result.parcial,true);assert.equal(result.inicio,row('01:02',0).data);
 const conflict=distanceBySource([row('00:00',1000),row('00:00',1001),row('01:00',1060)],day);
 assert.equal(conflict.km,null);
 assert.equal(distanceBySource([row('00:00',1000),row('03:00',1100)],day).km,null);
 assert.equal(distanceBySource([row('00:00',1000),row('01:00',1000)],day).km,0);
});
