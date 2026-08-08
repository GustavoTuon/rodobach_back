import test from "node:test";
import assert from "node:assert/strict";
import { loginSchema } from "../src/middleware/validate.js";

test("valida payload de login", () => {
  assert.equal(loginSchema.safeParse({ login: "usuario", senha: "segredo" }).success, true);
  assert.equal(loginSchema.safeParse({ login: "", senha: "" }).success, false);
  assert.equal(loginSchema.safeParse({ login: "a", senha: "b", admin: true }).success, false);
});
