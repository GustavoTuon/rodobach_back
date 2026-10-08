import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {consultaViagensRouter,tripFilters} from "../src/routes/consultaViagens.js";
import {clientPool} from "../src/db/clientPool.js";
import {requireRoutePermission} from "../src/middleware/permissions.js";
test("valida filtros e parametriza placa e número",()=>{
 assert.equal(tripFilters({numero:"1 OR 1=1"}),null);
 assert.equal(tripFilters({inicio:"2026-02-30"}),null);
 assert.equal(tripFilters({inicio:"2026-10-03",fim:"2026-09-01"}),null);
 assert.equal(tripFilters({page:-1}),null);
 const result=tripFilters({numero:"868",placa:"ABC-1234",page:2});
 assert.deepEqual(result.params,[868,"%ABC1234%"]);assert.equal(result.page,2);
 assert.ok(!result.where.includes("868"));
 const driver=tripFilters({motorista:"Juliana %"});
 assert.deepEqual(driver.params,['Juliana %']);assert.match(driver.where,/mf.empresamot=v.empresacvg/);assert.match(driver.where,/strpos/);
});
test("rejeita mês inválido dos indicadores antes de consultar o banco",async t=>{
 const query=t.mock.method(clientPool,"query",async()=>({rows:[]}));
 const app=express();app.use(consultaViagensRouter);
 for(const mes of ['2026-13','2026-00','abc','0000-01']) {
  const res=await request(app).get('/financeiro/consulta-viagens/1/868/indicadores').query({mes});
  assert.equal(res.status,400);
 }
 assert.equal(query.mock.callCount(),0);
});
test("consulta detalhes por empresa e número em todos os vínculos",async t=>{
 const query=t.mock.method(clientPool,"query",async sql=>({rows:sql.includes("FROM logistica.controleviagens v")?[{empresa:2,numero:868}]:[]}));
 const app=express();app.use(consultaViagensRouter);
 const res=await request(app).get('/financeiro/consulta-viagens/2/868');
 assert.equal(res.status,200);assert.equal(res.body.viagem.empresa,2);
 assert.equal(query.mock.callCount(),5);
 for(const call of query.mock.calls)assert.deepEqual(call.arguments[1],[2,868]);
 assert.match(query.mock.calls[1].arguments[0],/f.empresacvf=\$1 AND f.codigocvf=\$2/);
 assert.match(query.mock.calls[2].arguments[0],/d.empresacvd=\$1 AND d.codigocvd=\$2/);
 assert.match(query.mock.calls[3].arguments[0],/v.empresacva=\$1 AND v.codigocva=\$2/);
 assert.match(query.mock.calls[4].arguments[0],/m.empresaviagemmdf=\$1 AND m.viagemmdf=\$2/);
});
test("exige permissão de viagens e trata viagem inexistente",async t=>{
 t.mock.method(clientPool,"query",async()=>({rows:[]}));
 const app=express();let permissions={};app.use((req,_res,next)=>{req.user={permissions};next();});app.use(requireRoutePermission);app.use(consultaViagensRouter);
 assert.equal((await request(app).get('/financeiro/consulta-viagens')).status,403);
 permissions={"lucro-viagens":true};assert.equal((await request(app).get('/financeiro/consulta-viagens/1/999999')).status,404);
 assert.equal((await request(app).get('/financeiro/consulta-viagens/1/not-a-number')).status,400);
});
test("preserva detalhes e informa conferência indisponível quando a consulta de CT-es falha",async t=>{
 t.mock.method(clientPool,'query',async sql=>{
  if(sql.includes('WITH links'))throw Object.assign(new Error('timeout'),{code:'57014'});
  return {rows:sql.includes('FROM logistica.controleviagens v')?[{empresa:1,numero:22,placa:'ABC1234',saida:'2026-09-01',chegada:'2026-09-03'}]:[]};
 });
 const app=express();app.use(consultaViagensRouter);
 const res=await request(app).get('/financeiro/consulta-viagens/1/22');
 assert.equal(res.status,200);assert.equal(res.body.viagem.numero,22);
 assert.equal(res.body.conferencia.disponivel,false);assert.equal(res.body.conferencia.pendencias,undefined);
});
