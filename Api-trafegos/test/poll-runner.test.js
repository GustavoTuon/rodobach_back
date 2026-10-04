import test from "node:test";
import assert from "node:assert/strict";
import { createPollRunner } from "../src/poll-runner.js";

test("initial failure and failure after success return current failure, never stale success", async () => {
  let fail = true;
  const runner = createPollRunner(async () => { if (fail) throw new Error("offline"); return { sent: 0 }; });
  assert.equal((await runner.run()).ok, false);
  assert.equal(runner.state().lastResult, null);
  fail = false;
  assert.deepEqual(await runner.run(), { ok: true, result: { sent: 0 } });
  fail = true;
  const outcome = await runner.run();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.result, undefined);
});

test("concurrent triggers share a single poll", async () => {
  let calls = 0;
  const runner = createPollRunner(async () => { calls++; return { sent: 0 }; });
  await Promise.all([runner.run(), runner.run()]);
  assert.equal(calls, 1);
});
