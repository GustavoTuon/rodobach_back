import test from "node:test";
import assert from "node:assert/strict";
import { collectPages } from "../src/services/pagedResults.js";
test("collects multiple pages and reports an explicit cap", async () => {
  const values = [1, 2, 3, 4, 5];
  const fetchPage = async ({ start, length }) => ({ total: values.length, rows: values.slice(start, start + length) });
  assert.deepEqual(await collectPages(fetchPage, { pageSize: 2, maxRows: 8 }), { rows: values, total: 5, incompleto: false });
  assert.deepEqual(await collectPages(fetchPage, { pageSize: 2, maxRows: 3 }), { rows: [1, 2, 3], total: 5, incompleto: true });
});
test("does not loop or claim completeness if upstream repeats its first page", async () => {
  let calls = 0;
  const result = await collectPages(async () => { calls++; return { total: 10, rows: [1, 2] }; }, { pageSize: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(result.rows, [1, 2]);
  assert.equal(result.incompleto, true);
});
