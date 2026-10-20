import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { driverAssignment, requireExpensePlate } from "../src/services/expenseDriverAccess.js";
import { getVeiculosPool } from "../src/db/pool-veiculos.js";
import { pool } from "../src/db/pool.js";
import { manutencaoPlantaoRouter } from "../src/routes/manutencaoPlantao.js";
import { usuariosRouter } from "../src/routes/usuarios.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { publicUser } from "../src/services/userSession.js";
import { config } from "../src/config.js";

// Queries are mocked below; pool construction must not depend on a local .env.
config.veiculosDb.host = "127.0.0.1";

const driver = {id: 42, login: "driver", expenseProfile: "motorista", telemetryDriverId: "987", permissions: {"manutencao-plantao": true}};
const row = () => ({id: "987", nome: "Motorista teste", placa: "ABC1234", observado_em: new Date().toISOString(), current_driver_id: "987", ambiguous: false});
function app(user) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => {req.user=user; next();});
  app.use(manutencaoPlantaoRouter); app.use(usuariosRouter); app.use(errorHandler); return app;
}
test("vínculo exige ID, placa única, identificação recente e motorista atual", () => {
  assert.equal(driverAssignment([row()], "987").plate, "ABC1234");
  for (const rows of [[], [row(),row()], [{...row(), ambiguous:true}], [{...row(), current_driver_id:"123"}], [{...row(), placa:null}]]) {
    assert.equal(driverAssignment(rows,"987").plate,null);
  }
  assert.equal(driverAssignment([{...row(),observado_em:"2020-01-01"}],"987").status,"stale");
  assert.equal(driverAssignment([{...row(),observado_em:"2099-01-01"}],"987").plate,null);
});
test("perfil público preserva identidade e mantém colaboradores existentes", () => {
  assert.equal(publicUser({login:"old"}).expenseProfile,"colaborador");
  assert.equal(publicUser({login:"driver",perfil_despesas:"motorista",telemetria_motorista_id:"987"}).telemetryDriverId,"987");
});
test("troca automática é revalidada e requisição forjada não escolhe outra placa", async t => {
  let current = row();
  t.mock.method(getVeiculosPool(),"query",async()=>({rows:[current]}));
  const connect = t.mock.method(pool,"connect",async()=>{throw new Error("must not write");});
  const api=app(driver);
  assert.deepEqual((await request(api).get("/manutencao-plantao/placas")).body.veiculos,[{placa:"ABC1234"}]);
  await requireExpensePlate(driver,"ABC1234");
  current = {...row(),placa:"DEF4G56"};
  assert.deepEqual((await request(api).get("/manutencao-plantao/placas")).body.veiculos,[{placa:"DEF4G56"}]);
  const body={plate:"ABC1234",amount:10,service:"Borracharia",source:"colaborador"};
  assert.equal((await request(api).post("/manutencao-plantao/lancamentos").send(body)).status,403);
  assert.equal((await request(api).put("/manutencao-plantao/lancamentos/55926d25-6e7d-4c22-a36d-747c0402c18a").send({...body,version:1})).status,403);
  assert.equal((await request(api).get("/manutencao-plantao/placas/ABC1234/localizacao")).status,403);
  assert.equal((await request(api).get("/manutencao-plantao/placas/ABC1234/hodometro")).status,403);
  assert.equal(connect.mock.callCount(),0);
  await requireExpensePlate({...driver,expenseProfile:"colaborador"},"ABC1234");
});
test("motorista sem vínculo ou sem telemetria não recebe frota completa", async t => {
  t.mock.method(getVeiculosPool(),"query",async()=>({rows:[]}));
  const result=await request(app(driver)).get("/manutencao-plantao/placas");
  assert.deepEqual(result.body.veiculos,[]); assert.equal(result.body.access.status,"unavailable");
  assert.equal((await request(app({...driver,admin:true})).get("/manutencao-plantao/conferencia")).status,403);
  assert.equal((await request(app(driver)).get("/usuarios/motoristas-telemetria")).status,403);
});
