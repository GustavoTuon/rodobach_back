import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {clientPool} from '../src/db/clientPool.js';
import {payableStatus} from '../src/services/driverAdvances.js';
import {driverAdvancesRouter} from '../src/routes/driverAdvances.js';
test('status usa saldo aberto e vencimento, inclusive pagamentos parciais',()=>{
 assert.equal(payableStatus({open:12,due:'2026-11-15'},'2026-11-16'),'overdue');
 assert.equal(payableStatus({open:12,due:'2026-11-16'},'2026-11-16'),'today');
 assert.equal(payableStatus({open:12,due:'2026-11-17'},'2026-11-16'),'future');
 assert.equal(payableStatus({open:12,due:null},'2026-11-16'),'undated');
 assert.equal(payableStatus({open:0,due:'2026-11-15'},'2026-11-16'),'settled');
});
test('consulta exige permissao e nao oferece endpoint de escrita',async t=>{
 const query=t.mock.method(clientPool,'query',async()=>({rows:[]}));
 const app=permissions=>{const app=express();app.use((req,res,next)=>{req.user={permissions};next();});app.use(driverAdvancesRouter);return app;};
 const url='/viagens/adiantamentos-motoristas';
 assert.equal((await request(app({})).get(url)).status,403);
 assert.equal(query.mock.callCount(),0);
 const result=await request(app({viagens:true})).get(url);
 assert.equal(result.status,200);assert.deepEqual(result.body.records,[]);
 assert.equal((await request(app({viagens:true})).post(url)).status,404);
});
