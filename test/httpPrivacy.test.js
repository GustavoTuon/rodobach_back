import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import request from "supertest";
import { logger, loggerOptions } from "../src/logger.js";
import { app } from "../src/server.js";
import { pool } from "../src/db/pool.js";
import { config } from "../src/config.js";
import jwt from "jsonwebtoken";
import { sessionVersion } from "../src/services/userSession.js";

test("HTTP logs omit query values, credentials, bodies and driver error details", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk; callback(); } });
  const logger = pino(loggerOptions, stream);
  const isolated = express();
  isolated.use(pinoHttp({ logger, serializers: loggerOptions.serializers }));
  isolated.get("/private", (req, res) => {
    const error = Object.assign(new Error("secret-error-message"), {
      code: "23505", detail: "secret-sql-value", query: "secret-query",
    });
    req.log.error({ err: error, password: "secret-password" }, "Request failed");
    res.setHeader("Set-Cookie", "secret-response-cookie");
    res.json({ token: "secret-response-token" });
  });
  await request(isolated).get("/private?token=secret-url-token")
    .set("Authorization", "Bearer secret-bearer")
    .set("Cookie", "session=secret-cookie");
  assert.equal(output.includes("secret-"), false, output);
  const records = output.trim().split("\n").map(line => JSON.parse(line));
  assert.ok(records.some(row => row.err?.code === "23505"));
  assert.ok(records.some(row => row.req?.url === "/private"));
  assert.ok(records.some(row => row.res?.statusCode === 200));
});

test("API authentication and failures cannot be cached", async () => {
  for (const [method, path, body] of [
    ["get", "/api/auth/me"],
    ["get", "/api/financeiro/dre-empresarial"],
    ["post", "/api/auth/login", {}],
  ]) {
    const response = await request(app)[method](path).send(body);
    assert.ok(response.status >= 400);
    assert.equal(response.headers["cache-control"], "no-store");
  }
});

test("denied authenticated mutations are audited without executing writes", async t => {
  const user = { id: 789, login: "privacy-fixture", ativo: true, admin: false, senha: "fixture" };
  t.mock.method(pool, "query", async sql => {
    assert.match(sql, /^SELECT/i);
    return { rows: [user] };
  });
  const events = [];
  t.mock.method(logger, "info", event => events.push(event));
  const token = jwt.sign({ id: user.id, sessionVersion: sessionVersion(user) }, config.jwtSecret);
  const response = await request(app).post("/api/usuarios")
    .set("Authorization", `Bearer ${token}`).set("X-Request-Id", "untrusted-request-id").send({});
  assert.equal(response.status, 403);
  const event = events.find(row => row.event === "audit.http_mutation");
  assert.equal(event.actorId, user.id);
  assert.equal(event.statusCode, 403);
  assert.notEqual(event.requestId, "untrusted-request-id");
  assert.match(event.requestId, /^[a-f0-9-]{36}$/);
});
