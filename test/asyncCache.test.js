import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncCache } from '../src/services/asyncCache.js';

test('cache compartilha consultas simultâneas, expira e invalida sem ressuscitar resposta antiga', async () => {
  let time = 0, calls = 0, resolve;
  const cache = createAsyncCache({ ttlMs: 10, now: () => time });
  const fetch = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('a', fetch), cache.get('a', fetch)]), [1,1]);
  time = 11;
  assert.equal(await cache.get('a', fetch), 2);
  const old = cache.get('pending', () => new Promise(r => { resolve = r; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('pending', fetch), 3);
  resolve(99); await old;
  assert.equal(await cache.get('pending', fetch), 3);
});

test('falhas não ficam em cache e tamanho é limitado', async () => {
  const cache = createAsyncCache({ maxEntries: 1 });
  await assert.rejects(cache.get('a', () => { throw new Error('offline'); }));
  assert.equal(await cache.get('a', async () => 'ok'), 'ok');
  await cache.get('b', async () => 'b');
  assert.equal(await cache.get('a', async () => 'novo'), 'novo');
});
