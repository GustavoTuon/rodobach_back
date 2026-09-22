// Bounded cache with one in-flight operation per key. Failures are never cached.
export function createAsyncCache({ ttlMs = 30000, maxEntries = 20, maxPending = 20, maxBytes = 20 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map(), pending = new Map();
  let bytes = 0;
  const remove = key => { const entry = entries.get(key); if (entry) bytes -= entry.bytes; entries.delete(key); };
  return {
    async get(key, loader) {
      for (const [id, entry] of entries) if (entry.expires <= now()) remove(id);
      if (entries.has(key)) {
        const entry = entries.get(key); entries.delete(key); entries.set(key, entry);
        return structuredClone(entry.value);
      }
      if (pending.has(key)) return structuredClone(await pending.get(key));
      if (pending.size >= maxPending) throw Object.assign(new Error("Muitas consultas em andamento."), { status: 503 });
      const promise = Promise.resolve().then(loader).then(value => {
        const size = Buffer.byteLength(JSON.stringify(value) || "");
        if (size <= maxBytes) {
          while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
          entries.set(key, { value: structuredClone(value), bytes: size, expires: now() + ttlMs }); bytes += size;
        }
        return value;
      });
      pending.set(key, promise);
      try { return structuredClone(await promise); } finally { pending.delete(key); }
    },
  };
}
