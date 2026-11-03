import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {manutencaoPlantaoRouter} from '../src/routes/manutencaoPlantao.js';
import {pool} from '../src/db/pool.js';
import {clientPool} from '../src/db/clientPool.js';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {config} from '../src/config.js';
import {requireRoutePermission} from '../src/middleware/permissions.js';
import {errorHandler} from '../src/middleware/errorHandler.js';

test('borracharia valida pneu montado e salva identidade oficial e número no histórico',async t=>{
  const original=config.veiculosDb;
  config.veiculosDb={host:'127.0.0.1',port:5432,database:'fixture',user:'fixture',password:'fixture',ssl:false};
  t.after(()=>{config.veiculosDb=original;});
  t.mock.method(getVeiculosPool(),'query',async()=>({rows:[{placa:'ABC1234'}]}));
  t.mock.method(clientPool,'query',async sql=>({rows:sql.includes('FROM frotas.pneus') ? [{codigopne:'123',empresapne:'2',veiculopne:'ABC1234',posicaopne:'D1',marcapne:'Marca'}] : sql.includes('FROM frotas.posicoespneus') ? [{codigopop:'D1',nomepop:'Dianteiro direito'}] : []}));
  t.mock.method(pool,'query',async()=>({rows:[]}));
  const writes=[];let row={id:'55926d25-6e7d-4c22-a36d-747c0402c18a',placa:'ABC1234',valor:100,servico:'Borracharia',revisao:1};
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql,params){
    writes.push({sql,params});
    if(sql.includes('SELECT id FROM')) return {rows:[]};
    if(sql.includes('SET descarga=')) row={...row,numero_fogo:params[3],pneu_vinculado:JSON.parse(params[6])};
    return {rows:[row]};
  }}));
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:1,login:'tester',permissions:{'manutencao-plantao':true}};next();});app.use(requireRoutePermission);app.use(manutencaoPlantaoRouter);app.use(errorHandler);
  const body={plate:'ABC1234',amount:100,service:'Borracharia',supplier:'Oficina',documentType:'sem_documento',receiptReason:'Fornecedor não emitiu a nota.',tire:{code:'123',company:'2'},tireFireNumber:'numero adulterado'};
  const list=await request(app).get('/manutencao-plantao/placas/ABC1234/pneus');assert.equal(list.status,200);assert.equal(list.body.tires[0].code,'123');
  const response=await request(app).post('/manutencao-plantao/lancamentos').send(body);
  assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.body.record.tireFireNumber,'123');assert.equal(response.body.record.tire.company,'2');assert.equal(response.body.record.tire.positionName,'Dianteiro direito');
  const audit=writes.find(item=>item.sql.includes('INSERT INTO') && item.sql.includes('historico'));
  assert.equal(JSON.parse(audit.params[5]).pneu_vinculado.code,'123');
  const rejected=await request(app).post('/manutencao-plantao/lancamentos').send({...body,tire:{code:'123',company:'9'}});
  assert.equal(rejected.status,409);assert.equal(writes.at(-1).sql,'ROLLBACK');
});

test('despesas exigem fornecedor e classificação; NFS exige número; viagem é opcional', async t=>{
  const originalVeiculosDb=config.veiculosDb;
  config.veiculosDb={host:'127.0.0.1',port:5432,database:'rodobach_test',user:'rodobach_test',password:'rodobach_test',ssl:false};
  t.after(()=>{config.veiculosDb=originalVeiculosDb;});
  t.mock.method(getVeiculosPool(),'query',async()=>({rows:[{placa:'ABC1234'}]}));
  t.mock.method(clientPool,'query',async sql=>({rows:sql.includes('controleviagens') ? [{company:'1',number:'880',plate:'ABC1234'}] : []}));
  const writes=[];
  const row={id:'55926d25-6e7d-4c22-a36d-747c0402c18a',placa:'ABC1234',valor:100,servico:'Borracharia',revisao:1};
  const client={release(){},async query(sql,params){
    writes.push({sql,params});
    if(sql.includes('SELECT id FROM')) return {rows:[]};
    if(sql.includes('SET descarga=')) return {rows:[{...row,tipo_documento:params[2],numero_fogo:params[3],viagem_despesa:JSON.parse(params[4])}]};
    return {rows:[row]};
  }};
  t.mock.method(pool,'connect',async()=>client);
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:1,login:'tester',permissions:{'manutencao-plantao':true}};next();});app.use(manutencaoPlantaoRouter);
  const body={plate:'ABC1234',amount:100,service:'Borracharia',supplier:'Oficina manual',documentType:'sem_documento',receiptReason:'Fornecedor não emitiu comprovante.'};
  const send=data=>request(app).post('/manutencao-plantao/lancamentos').send(data);
  assert.equal((await send({...body,supplier:'  '})).status,400);
  assert.equal((await send({...body,documentType:undefined})).status,400);
  assert.equal((await send({...body,documentType:'nf_servico'})).status,400);
  assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO public.manutencao_plantao ')).length,0);
  const plain=await send({...body,tireFireNumber:'PNEU-12'});
  assert.equal(plain.status,201);assert.equal(plain.body.record.tireFireNumber,'PNEU-12');assert.equal(plain.body.record.trip,null);
  const linked=await send({...body,documentType:'nf_servico',document:'123',trip:{company:'1',number:'880'}});
  assert.equal(linked.status,201);assert.equal(linked.body.record.trip.number,'880');assert.equal(linked.body.record.documentType,'nf_servico');
  assert.equal((await send({...body,trip:{company:'x',number:'880'}})).status,400);
});
