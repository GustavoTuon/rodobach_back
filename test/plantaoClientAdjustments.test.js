import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {manutencaoPlantaoRouter} from '../src/routes/manutencaoPlantao.js';
import {pool} from '../src/db/pool.js';
import {clientPool} from '../src/db/clientPool.js';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {config} from '../src/config.js';

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
