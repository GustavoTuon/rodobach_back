const isBudget = d => ['O', 'OC'].includes(String(d.serie || '').trim().toUpperCase()) || Boolean(d.chave_orcamento);
const identity = d => JSON.stringify([String(d.empresa), String(d.serie || '').trim(), String(d.codigo)]);

// A linked budget is replaced by its authorized CT-e. Distinct fiscal keys
// remain distinct documents, even when they share a budget or an operation.
export function documentosContabilizados(documents, root = identity) {
  const groups = new Map();
  for (const d of documents) {
    if (![0, 3].includes(Number(d.tipo)) || !d.data_documento) continue;
    const budget = isBudget(d) && !d.chave;
    if (budget ? ![1, 2].includes(Number(d.status)) : Number(d.status) !== 2) continue;
    const groupId = root(d);
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(d);
  }
  const entries = [];
  for (const records of groups.values()) {
    records.sort((a,b)=>identity(a).localeCompare(identity(b)));
    const fiscal = records.filter(d=>d.chave || !isBudget(d));
    if (fiscal.length) {
      const seen = new Set();
      for (const d of fiscal) {
        const id = d.chave ? `CTE:${d.chave}` : `DOC:${identity(d)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push({id,documento:d,categoria:'CT-e',vinculados:records.filter(r=>isBudget(r)&&!r.chave || r!==d&&r.chave&&r.chave===d.chave)});
      }
    } else {
      const d = records[0];
      entries.push({id:`ORC:${identity(d)}`,documento:d,categoria:'Orçamento',vinculados:records.slice(1)});
    }
  }
  return entries.sort((a,b)=>a.documento.data_documento.localeCompare(b.documento.data_documento)||a.id.localeCompare(b.id));
}
