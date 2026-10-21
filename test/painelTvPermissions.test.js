import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {statusCargaRouter} from '../src/routes/statusCarga.js';
import {requireRoutePermission} from '../src/middleware/permissions.js';
import {enforceReadOnly} from '../src/middleware/readOnly.js';

// Invalid inputs exercise the real routes without changing operational records.
function app(user) {
  const app = express();
  app.use(express.json(), (req, _res, next) => {req.user = user; next();});
  app.use(requireRoutePermission, enforceReadOnly, statusCargaRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({error: error.message}));
  return app;
}
const cases = [['get', '/frota/painel-tv/confirmacoes?placa=invalida'], ['post', '/frota/painel-tv/confirmacoes'], ['delete', '/frota/painel-tv/confirmacoes/invalido']];
test('panel users and administrators reach correction validation on all three routes', async () => {
  for (const user of [{id: 1, permissions: {'painel-tv': true}}, {id: 2, admin: true}]) {
    for (const [method, path] of cases) {
      const response = await request(app(user))[method](path).send({});
      assert.equal(response.status, 400, `${method}: ${response.text}`);
    }
  }
});
test('users without panel access cannot access correction routes', async () => {
  for (const user of [{permissions: {}}, {permissions: {'status-carga': true}}, {permissions: {'painel-tv': false}}]) {
    for (const [method, path] of cases) assert.equal((await request(app(user))[method](path).send({})).status, 403);
  }
});
test('read-only panel access allows history validation but blocks changes', async () => {
  const server = app({permissions: {'painel-tv': true}, readOnly: true});
  for (const [method, path] of cases) assert.equal((await request(server)[method](path).send({})).status, method === 'get' ? 400 : 403);
});
