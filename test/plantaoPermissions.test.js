import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { manutencaoPlantaoRouter } from "../src/routes/manutencaoPlantao.js";
import { usuariosRouter } from "../src/routes/usuarios.js";
import { requireRoutePermission } from "../src/middleware/permissions.js";
import { enforceReadOnly } from "../src/middleware/readOnly.js";
import { publicUser } from "../src/services/userSession.js";
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
import { getVeiculosPool } from "../src/db/pool-veiculos.js";
import { config } from "../src/config.js";

const driver={id:42,login:"driver",permissions:{"manutencao-plantao":true}};
const reviewer={id:43,login:"reviewer",permissions:{"conferencia-manutencao":true}};
const id="55926d25-6e7d-4c22-a36d-747c0402c18a";
function app(user) {const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});app.use(requireRoutePermission);app.use(enforceReadOnly);app.use(manutencaoPlantaoRouter);app.use(usuariosRouter);return app;}
test("motorista não lê nem altera conferência, inclusive por URL direta",async t=>{
 const query=t.mock.method(pool,"query",async()=>{throw new Error("must not query");});
 assert.equal((await request(app(driver)).get("/manutencao-plantao/conferencia")).status,403);
 assert.equal((await request(app(driver)).patch(`/manutencao-plantao/conferencia/${id}`)).status,403);
 assert.equal((await request(app(reviewer)).post("/manutencao-plantao/lancamentos").send({})).status,403);
 assert.equal(query.mock.callCount(),0);
});
test("leitura do motorista aplica autoria no SQL, conferência exige permissão própria",async t=>{
 const query=t.mock.method(pool,"query",async()=>({rows:[]}));
 assert.equal((await request(app(driver)).get("/manutencao-plantao/lancamentos?usuario_id=43")).status,200);
 assert.match(query.mock.calls[0].arguments[0],/WHERE usuario_id = \$1/);
 assert.deepEqual(query.mock.calls[0].arguments[1],[42]);
 assert.equal((await request(app(reviewer)).get("/manutencao-plantao/conferencia")).status,200);
});
test("mutação exige versão válida e acesso somente consulta bloqueia alterações",async t=>{
 const connect=t.mock.method(pool,"connect",async()=>{throw new Error("must not connect");});
 assert.equal((await request(app(reviewer)).patch(`/manutencao-plantao/conferencia/${id}`).send({usuario_id:42})).status,400);
 assert.equal((await request(app({...reviewer,readOnly:true})).patch(`/manutencao-plantao/conferencia/${id}`).send({version:1})).status,403);
 assert.equal((await request(app(driver)).delete(`/manutencao-plantao/lancamentos/${id}`).send({version:1,reason:""})).status,400);
 assert.equal(connect.mock.callCount(),0);
});
test("criação valida frota e não aceita autoria enviada pelo navegador",async t=>{
 const originalVeiculosDb=config.veiculosDb;
 config.veiculosDb={host:"127.0.0.1",port:5432,database:"rodobach_test",user:"rodobach_test",password:"rodobach_test",ssl:false};
 t.after(()=>{config.veiculosDb=originalVeiculosDb;});
 t.mock.method(getVeiculosPool(),"query",async()=>({rows:[{placa:"ABC1234"}]}));
 t.mock.method(clientPool,"query",async()=>({rows:[]}));
 const connect=t.mock.method(pool,"connect",async()=>{throw new Error("must not connect");});
 const body={plate:"ABC1234",amount:10,service:"Borracharia",supplier:"Oficina sem cadastro"};
 assert.equal((await request(app(driver)).post("/manutencao-plantao/lancamentos").send({...body,authorId:43})).status,400);
 assert.equal((await request(app(driver)).post("/manutencao-plantao/lancamentos").send({...body,plate:"XYZ1234"})).status,400);
 assert.equal((await request(app(driver)).post("/manutencao-plantao/lancamentos").send({...body,expenseDate:"2026-02-30"})).status,400);
 assert.equal((await request(app(driver)).post("/manutencao-plantao/lancamentos").send({...body,expenseDate:"2099-01-01"})).status,400);
 assert.equal(connect.mock.callCount(),0);
});
test("Painel TV é independente e permissões públicas não usam fallback",async()=>{
 const isolated=express();let permissions={"status-carga":true};
 isolated.use((req,_res,next)=>{req.user={permissions};next();});isolated.use(requireRoutePermission);isolated.get("*",(_req,res)=>res.sendStatus(200));
 assert.equal((await request(isolated).get("/frota/painel-tv")).status,403);
 permissions={"painel-tv":true};assert.equal((await request(isolated).get("/frota/painel-tv")).status,200);
 const user=publicUser({perm_status_carga:true,perm_painel_tv:false,perm_manutencao_plantao:true,perm_conferencia_manutencao:false});
 assert.equal(user.permissions["painel-tv"],false);assert.equal(user.permissions["manutencao-plantao"],true);assert.equal(user.permissions["conferencia-manutencao"],false);
});
test("admin salva e lê as novas permissões; usuário comum não altera permissões",async t=>{
 const query=t.mock.method(pool,"query",async()=>({rows:[{id:42,perm_conferencia_manutencao:true}]}));
 const admin=app({id:1,login:"admin",admin:true});
 const body={perm_painel_tv:false,perm_manutencao_plantao:true,perm_conferencia_manutencao:true};
 assert.equal((await request(app(driver)).put("/usuarios/42").send(body)).status,403);
 assert.equal((await request(admin).put("/usuarios/42").send(body)).status,200);
 assert.match(query.mock.calls[0].arguments[0],/perm_painel_tv = \$1/);
 assert.deepEqual(query.mock.calls[0].arguments[1].slice(0,3),[false,true,true]);
 assert.equal((await request(admin).get("/usuarios")).status,200);
 assert.match(query.mock.calls[1].arguments[0],/perm_conferencia_manutencao/);
 assert.equal((await request(admin).post("/usuarios").send({login:"test-fixture",senha:"password-1234",...body})).status,201);
 const [sql,params]=query.mock.calls[2].arguments;assert.match(sql,/\$36/);assert.equal(params.length,36);assert.deepEqual(params.slice(-3),[false,true,true]);
});
