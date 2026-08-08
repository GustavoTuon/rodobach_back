import test from "node:test";
import assert from "node:assert/strict";
import { requirePermission } from "../src/middleware/permissions.js";

function execute(permission, user) {
  let nextCalled = false; let status;
  const res = { status(value) { status = value; return this; }, json() { return this; } };
  requirePermission(permission)({ user }, res, () => { nextCalled = true; });
  return { nextCalled, status };
}
test("administrador ignora permissoes individuais", () => assert.equal(execute("pneus", { admin: true }).nextCalled, true));
test("usuario precisa de permissao explicitamente verdadeira", () => {
  assert.equal(execute("pneus", { permissions: { pneus: true } }).nextCalled, true);
  assert.equal(execute("pneus", { permissions: { pneus: false } }).status, 403);
  assert.equal(execute("pneus", { permissions: {} }).status, 403);
});
