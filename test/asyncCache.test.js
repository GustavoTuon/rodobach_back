import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncCache } from "../src/services/asyncCache.js";

test("cache deduplicates concurrent calls, isolates mutation and expires entries", async () => {
  let time = 0, calls = 0;
  const cache = createAsyncCache({ ttlMs: 10, now: () => time });
  const load = async () => { calls++; return { rows: [1] }; };
  const [first, second] = await Promise.all([cache.get("a", load), cache.get("a", load)]);
  first.rows.push(2);
  assert.deepEqual(second.rows, [1]);
  assert.deepEqual((await cache.get("a", load)).rows, [1]);
  assert.equal(calls, 1);
  time = 11;
  await cache.get("a", load);
  assert.equal(calls, 2);
});

test("cache evicts old entries, does not cache errors or oversized values", async () => {
  const cache = createAsyncCache({ maxEntries: 1, maxBytes: 10 });
  let calls = 0;
  const load = async () => { calls++; return 1; };
  await cache.get("a", load); await cache.get("b", load); await cache.get("a", load);
  assert.equal(calls, 3);
  await assert.rejects(cache.get("err", async () => { throw new Error("fixture"); }));
  assert.equal(await cache.get("err", load), 1);
  let largeCalls = 0;
  const large = () => { largeCalls++; return "x".repeat(20); };
  await cache.get("large", large); await cache.get("large", large);
  assert.equal(largeCalls, 2);
});
