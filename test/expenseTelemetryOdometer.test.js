import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {getVeiculosPool} from "../src/db/pool-veiculos.js";
import {clientPool} from "../src/db/clientPool.js";
import {pool} from "../src/db/pool.js";
import {expenseTelemetryOdometer} from "../src/services/expenseTelemetryOdometer.js";
import {manutencaoPlantaoRouter} from "../src/routes/manutencaoPlantao.js";
test("KM vem apenas da telemetria no dia selecionado, sem consultar abastecimentos",async t=>{
 const query=t.mock.method(getVeiculosPool(),"query",async()=>({rows:[{odometro:123456.7,data_hora:"2026-10-01T15:00:00Z"}]}));
 const erp=t.mock.method(clientPool,"query",async()=>{throw new Error("must not query ERP");});
 assert.deepEqual(await expenseTelemetryOdometer("ABC1234","2026-10-01","10:30:00"),{odometer:123456.7,date:"2026-10-01T15:00:00Z",source:"telemetria"});
 assert.deepEqual(query.mock.calls[0].arguments[1],["ABC1234","2026-10-01","10:30:00"]);
 assert.match(query.mock.calls[0].arguments[0],/America\/Sao_Paulo/);
 assert.match(query.mock.calls[0].arguments[0],/data_hora </);
 assert.equal(erp.mock.callCount(),0);
});
test("sem leitura não aceita KM manual para criar abastecimento",async t=>{
 t.mock.method(getVeiculosPool(),"query",async sql=>({rows:sql.includes("mensagens_cb")?[]:[{placa:"ABC1234"}]}));
 t.mock.method(clientPool,"query",async()=>({rows:[]}));
 const statements=[];t.mock.method(pool,"connect",async()=>({query:async sql=>{statements.push(sql);return {rows:[]};},release(){}}));
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:42,permissions:{"manutencao-plantao":true}};next();});app.use(manutencaoPlantaoRouter);
 const result=await request(app).post("/manutencao-plantao/lancamentos").send({plate:"ABC1234",amount:1200,service:"Abastecimento",source:"motorista",liters:200,odometer:999999,expenseDate:"2026-10-01",expenseTime:"10:30",receiptReason:"Nota nao disponibilizada pelo posto."});
 assert.equal(result.status,422);assert.match(result.body.error,/telemetria/);assert.equal(statements.some(sql=>/INSERT|UPDATE/.test(sql)),false);
 assert.equal((await expenseTelemetryOdometer("ABC1234","2026-10-01","10:30:00")).odometer,null);
});
