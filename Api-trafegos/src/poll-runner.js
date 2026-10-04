export function createPollRunner(poll, { onSuccess = () => {}, onError = () => {} } = {}) {
  let pending = null, lastResult = null, lastError = null;
  return {
    state: () => ({ lastResult, lastError }),
    async run() {
      if (pending) return pending;
      pending = Promise.resolve().then(poll).then(result => {
        lastResult = result; lastError = null;
        onSuccess(result);
        return { ok: true, result };
      }).catch(error => {
        lastError = { at: new Date().toISOString(), message: error.message };
        onError(lastError);
        return { ok: false, error: "Falha ao executar monitor" };
      });
      try { return await pending; } finally { pending = null; }
    },
  };
}
