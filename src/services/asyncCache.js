// Bounded cache with shared in-flight work. Failed queries are never retained.
export function createAsyncCache({ ttlMs = 30_000, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map();
  return {
    clear() { entries.clear(); },
    get(key, fetch) {
      const existing = entries.get(key);
      if (existing && (existing.pending || existing.expiresAt > now())) return existing.promise;
      const entry = { pending: true, expiresAt: 0 };
      entry.promise = Promise.resolve().then(fetch).then(value => {
        entry.pending = false; entry.expiresAt = now() + ttlMs;
        return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key);
      entries.set(key, entry);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}
