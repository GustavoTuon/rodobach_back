const clean = value => String(value ?? "").trim();
const numeric = value => clean(value).replace(/^0+(?=\d)/, "");

export async function cargaDocumentosDelivery(candidates, now = new Date()) {
  const manifests = await loadCteManifestos(candidates.map(row => ({
    empresa: row.empresa, serie: row.serie, codigo: Number(row.numero),
  })));
  return candidates.map(row => {
    const manifestos = manifests.get(cteIdentity({
      empresa: row.empresa, serie: row.serie, codigo: Number(row.numero),
    })) || [];
    return { ...row, entregue: Boolean(manifestoCompletion({ ...row, manifestos }, now)) };
  });
}

// A known key or ERP identity must never fall back to a different document.
// Legacy number-only links are usable only when the ERP candidate is unique.
export function resolveCargaDocumento(document, candidates, { plate = false } = {}) {
  const key = clean(document.chave);
  const empresa = clean(document.empresa);
  const serie = clean(document.serie);
  const numero = numeric(document.numero);
  let matches;
  if (key) matches = candidates.filter(row => clean(row.chave) === key
    && (!empresa || clean(row.empresa) === empresa)
    && (!serie || clean(row.serie) === serie)
    && (!numero || numeric(row.numero) === numero));
  else if (empresa && serie && numero) {
    matches = candidates.filter(row => clean(row.empresa) === empresa
      && clean(row.serie) === serie && numeric(row.numero) === numero);
  } else {
    matches = candidates.filter(row => numero && numeric(row.numero) === numero
      && (!empresa || clean(row.empresa) === empresa)
      && (!serie || clean(row.serie) === serie)
      && (!plate || (clean(document.placa) && clean(row.placa) === clean(document.placa))));
  }
  return matches.length === 1 ? matches[0] : null;
}

export function deliveredCargaIds(documents, candidates) {
  const groups = new Map();
  for (const document of documents) {
    if (!groups.has(document.carga_id)) groups.set(document.carga_id, []);
    groups.get(document.carga_id).push(document);
  }
  return [...groups].filter(([, docs]) => docs.every(doc =>
    resolveCargaDocumento(doc, candidates, { plate: true })?.entregue === true,
  )).map(([id]) => Number(id));
}
import { loadCteManifestos, cteIdentity, manifestoCompletion } from "./tripManifestos.js";

