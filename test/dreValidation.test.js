import test from "node:test";
import assert from "node:assert/strict";
import { clientPool } from "../src/db/clientPool.js";
import { getDreEmpresarial } from "../src/services/dreEmpresarialService.js";

test("invalid or excessive DRE periods fail before querying the ERP", async t => {
  const query = t.mock.method(clientPool, "query", async () => { throw new Error("Unexpected ERP query"); });
  for (const filters of [
    { startDate: "2026-02-30", endDate: "2026-03-01" },
    { startDate: "2026-09-20", endDate: "2026-09-01" },
    { startDate: "2020-01-01", endDate: "2026-09-01" },
    { startDate: "2026-09-01" },
    { mesAno: "2026-13" },
  ]) await assert.rejects(getDreEmpresarial(filters), error => error.status === 400);
  assert.equal(query.mock.callCount(), 0);
});
