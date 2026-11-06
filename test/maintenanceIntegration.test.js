import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {createHash} from 'node:crypto';
import {createMaintenanceIntegration} from '../src/routes/maintenanceIntegration.js';
import {maintenanceWorkflow} from '../src/services/maintenanceWorkflow.js';
const token='a'.repeat(64);
function fixture({accepted=true,readOnly=false,result={ok:true,candidatos:[{}],enviados:[],falhas:[]}}={}) {
  const calls=[];
  const app=express();app.use(express.json());
  app.use(createMaintenanceIntegration({db:{query:async(_sql,args)=>{
    assert.equal(args[0],createHash('sha256').update(token).digest('hex'));
    return {rowCount:accepted?1:0,rows:accepted?[{id:1,destinatario:'5511999999999'}]:[]};
  }},run:async options=>{calls.push(options);return result;},readOnly:()=>readOnly}));
  return {app,calls};
}
test('integration rejects missing or invalid credentials without invoking sender',async()=>{
  const {app,calls}=fixture();await request(app).post('/integracoes/n8n/manutencao').send({dryRun:false}).expect(401);assert.equal(calls.length,0);
  const denied=fixture({accepted:false});await request(denied.app).post('/integracoes/n8n/manutencao').set('Authorization',`Bearer ${token}`).send({dryRun:false}).expect(401);assert.equal(denied.calls.length,0);
});
test('explicit simulation and stored recipient are passed to the unchanged alert service',async()=>{
  const {app,calls}=fixture();
  const response=await request(app).post('/integracoes/n8n/manutencao').set('Authorization',`Bearer ${token}`).send({dryRun:true,recipientNumber:'999'}).expect(200);
  assert.deepEqual(calls,[{dryRun:true,recipientNumber:'5511999999999'}]);
  assert.deepEqual(response.body,{ok:true,dryRun:true,candidatos:1,aceitos:0,falhas:0});
});
test('invalid mode and read-only execution cannot send',async()=>{
  const {app,calls}=fixture({readOnly:true});
  await request(app).post('/integracoes/n8n/manutencao').set('Authorization',`Bearer ${token}`).send({}).expect(400);
  await request(app).post('/integracoes/n8n/manutencao').set('Authorization',`Bearer ${token}`).send({dryRun:false}).expect(403);
  assert.equal(calls.length,0);
});
test('partial failure and overlapping execution fail the workflow',async()=>{
  for(const [result,status] of [[{ok:false,candidatos:[{}],enviados:[],falhas:[{}]},502],[{ignorado:true},409]]) {
    const {app}=fixture({result});await request(app).post('/integracoes/n8n/manutencao').set('Authorization',`Bearer ${token}`).send({dryRun:false}).expect(status);
  }
});
test('workflow uses hosted API, daily Brasília schedule, credential reference and no automatic retries',()=>{
  const workflow=maintenanceWorkflow({url:'https://example.com/api/integracoes/n8n/manutencao',credential:{id:'test',name:'test'}});
  assert.equal(workflow.settings.timezone,'America/Sao_Paulo');
  assert.equal(workflow.nodes[0].parameters.rule.interval[0].expression,'0 8 * * *');
  assert.equal(workflow.nodes[1].retryOnFail,false);
  assert.equal(workflow.nodes[1].parameters.jsonBody,'{"dryRun":false}');
  assert.ok(!JSON.stringify(workflow).includes('localhost'));
  assert.throws(()=>maintenanceWorkflow({url:'http://localhost:3333'}));
});
