import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/server.js";
import { pool } from "../src/db/pool.js";
import { config } from "../src/config.js";
import { ROUTE_PERMISSIONS, requireRoutePermission } from "../src/middleware/permissions.js";
import { enforceReadOnly } from "../src/middleware/readOnly.js";
import { createUserSchema, updateUserSchema } from "../src/middleware/validate.js";
import { sessionVersion } from "../src/services/userSession.js";

const user = { id: 123, login: "audit-fixture", ativo: true, admin: false, senha: "test-hash-only", atualizado_em: new Date("2026-09-15T00:00:00Z") };
const token = (row = user) => jwt.sign({ id: row.id, sessionVersion: sessionVersion(row) }, config.jwtSecret, { expiresIn: "1h" });
test('cargo corrections and their history require administrator access', async t => {
  const reader = {...user, perm_status_carga: true};
  t.mock.method(pool, 'query', async () => ({rows:[reader]}));
  for (const [method,path] of [['post','/api/frota/painel-tv/confirmacoes'],['delete','/api/frota/painel-tv/confirmacoes/1'],['get','/api/frota/painel-tv/confirmacoes?placa=RXO6C18']]) {
    assert.equal((await request(app)[method](path).set('Authorization',`Bearer ${token(reader)}`)).status,403);
  }
});

test("all business router declarations have an explicit policy", () => {
  const dir = new URL("../src/routes/", import.meta.url);
  const missing = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js") || file === "auth.js") continue;
    const source = fs.readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(/\b\w+\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      if (match[2].startsWith("/") && !ROUTE_PERMISSIONS.some(([pattern]) => pattern.test(match[2].toLowerCase()))) missing.push(match[2]);
    }
  }
  assert.deepEqual(missing, []);
});

test("capitalization and unmapped routes cannot bypass permissions, including mutations", async () => {
  const isolated = express();
  isolated.use((req, _res, next) => { req.user = { admin: false, permissions: {} }; next(); });
  isolated.use("/api", requireRoutePermission);
  isolated.all("*", (_req, res) => res.sendStatus(200));
  for (const method of ["get", "post", "put", "delete"]) {
    for (const path of ["/financeiro/dre-empresarial", "/Financeiro/dre-empresarial", "/financeiro/fluxo-caixa", "/financeiro/embarques-clientes", "/Pneus/movimentar", "/unmapped"]) {
      assert.equal((await request(isolated)[method]("/api" + path)).status, 403, `${method} ${path}`);
    }
  }
});

test("read-only policy blocks writes even for administrator and permits calculations", async () => {
  const isolated = express();
  isolated.use((req, _res, next) => { req.user = { admin: true, readOnly: true }; next(); });
  isolated.use(enforceReadOnly);
  isolated.all("*", (_req, res) => res.sendStatus(200));
  assert.equal((await request(isolated).get("/pneus/estoque")).status, 200);
  assert.equal((await request(isolated).post("/frete/calcular")).status, 200);
  for (const path of ["/pneus/movimentar", "/automacoes/n8n/1/ativar", "/oportunidades-retorno/enviar-cliente", "/admin/migrate"]) {
    assert.equal((await request(isolated).post(path)).status, 403);
  }
});

test("authorized readers keep access to their screen's shared resources", async () => {
  const isolated = express();
  let permissions = {};
  isolated.use((req, _res, next) => { req.user = { admin: false, permissions }; next(); });
  isolated.use(requireRoutePermission);
  isolated.all("*", (_req, res) => res.sendStatus(200));
  for (const [permission, path] of [["dre-empresarial", "/Financeiro/dre-empresarial"], ["fluxo-caixa", "/financeiro/fluxo-caixa"], ["clientes", "/financeiro/embarques-clientes"], ["abastecimentos", "/financeiro/custos-veiculos/filtros"], ["manutencao-posicoes", "/manutencao/veiculos"]]) {
    permissions = { [permission]: true };
    assert.equal((await request(isolated).get(path)).status, 200, path);
  }
  permissions = { abastecimentos: true };
  assert.equal((await request(isolated).get("/financeiro/custos-veiculos")).status, 403);
});

test("existing session uses current database permissions and exposes no credential", async t => {
  t.mock.method(pool, "query", async () => ({ rows: [{ ...user, perm_clientes: true }] }));
  const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token()}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.permissions.clientes, true);
  assert.equal(response.body.user.senha, undefined);
  assert.equal(response.body.user.sessionVersion, undefined);
});

test("disabled, deleted, changed password, and edited users lose their old session", async t => {
  let row = user;
  t.mock.method(pool, "query", async () => ({ rows: row ? [row] : [] }));
  for (const state of [null, { ...user, ativo: false }, { ...user, senha: "new-hash" }, { ...user, atualizado_em: new Date("2026-09-15T00:00:01Z") }]) {
    row = state;
    assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token()}`)).status, 401);
  }
});

test("database failures return 503 rather than logging out a valid user", async t => {
  t.mock.method(pool, "query", async () => { throw new Error("fixture database outage"); });
  assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token()}`)).status, 503);
});

test("legacy tokens and unauthenticated diagnostics cannot access protected data", async () => {
  const legacy = jwt.sign({ id: user.id, admin: true }, config.jwtSecret);
  assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${legacy}`)).status, 401);
  assert.equal((await request(app).get("/api/health/viagens")).status, 401);
});

test("malformed JSON and oversized bodies keep their 4xx status without querying the database", async t => {
  const mock = t.mock.method(pool, "query", async () => { throw new Error("Forbidden database call"); });
  assert.equal((await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{")).status, 400);
  assert.equal((await request(app).post("/api/auth/login").send({ login: "x".repeat(2 * 1024 * 1024), senha: "fixture" })).status, 413);
  assert.equal(mock.mock.callCount(), 0);
});

test("user schemas reject string booleans, arbitrary fields and weak new passwords", () => {
  assert.equal(createUserSchema.safeParse({ login: "operator", senha: "valid-password", admin: "false" }).success, false);
  assert.equal(updateUserSchema.safeParse({ perm_clientes: "false" }).success, false);
  assert.equal(updateUserSchema.safeParse({ id: 123 }).success, false);
  assert.equal(createUserSchema.safeParse({ login: "operator", senha: "123" }).success, false);
  assert.equal(updateUserSchema.safeParse({ perm_clientes: false, senha: "" }).success, true);
});
