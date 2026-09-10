// Experimental: document emission is a proxy for loading, not a confirmed event.
export function buildDocumentAudit(documents, start, end) {
  const date = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
  const ordered = documents.map((doc) => ({ ...doc, placa: doc.placa.replace(/[^A-Z0-9]/gi, "").toUpperCase(),
    emissao: date(doc.emissao_documento_at), entrega: date(doc.entrega_at) }))
    .filter((doc) => doc.emissao).sort((a, b) => a.placa.localeCompare(b.placa) || a.emissao.localeCompare(b.emissao));
  return ordered.flatMap((doc, index) => {
    if (doc.emissao < start || doc.emissao > end) return [];
    const next = ordered.slice(index + 1).find((item) => item.placa === doc.placa && (!doc.confirmacaoId || item.confirmacaoId !== doc.confirmacaoId));
    const delivery = doc.entrega && doc.entrega > doc.emissao
      ? (doc.entrega_precisa ? doc.entrega : new Date(new Date(doc.entrega).getTime() + 86400000).toISOString()) : null;
    let status = !delivery ? "Entrega ausente ou inválida" : !next ? "Sem próximo documento no período" : delivery >= next.emissao ? "Datas sobrepostas: conferir viagem" : "Estimativa entre documentos";
    if (status === "Estimativa entre documentos" && ordered.some((other) => other !== doc && other.placa === doc.placa && other.emissao <= delivery && (!other.entrega || other.entrega <= other.emissao || (other.entrega_precisa ? other.entrega : new Date(new Date(other.entrega).getTime() + 86400000).toISOString()) > delivery))) status = "Outro documento pendente no intervalo";
    return [{ id: index + 1, documentKey: doc.documentKey, confirmacaoId: doc.confirmacaoId || null, emissaoOriginal: doc.emissaoOriginal || doc.emissao_documento_at, placa: doc.placa, documento: `ERP ${doc.serie}-${doc.numero}`, cliente: doc.cliente,
      destino: [doc.destino_cidade, doc.destino_uf].filter(Boolean).join("/"), emissao: doc.emissao,
      entrega: doc.entrega, entregaPrecisa: Boolean(doc.entrega_precisa),
      proximoDocumento: next ? `ERP ${next.serie}-${next.numero}` : null, proximaEmissao: next?.emissao || null,
      inicio: delivery, fim: next?.emissao || null, status, kmVazio: null }];
  });
}

export function buildDocumentWindows(documents, start, end) {
  const valid = documents.flatMap((doc) => {
    if (!doc.emissao_documento_at || !doc.entrega_at) return [];
    const inicio = new Date(doc.emissao_documento_at).toISOString();
    const delivery = new Date(doc.entrega_at).toISOString();
    if (delivery <= inicio) return [];
    const fim = doc.entrega_precisa ? delivery : new Date(new Date(delivery).getTime() + 86400000).toISOString();
    return [{ placa: doc.placa.replace(/[^A-Z0-9]/gi, "").toUpperCase(), inicio, fim,
      documento: `ERP ${doc.serie}-${doc.numero}`, destino: doc.destino_cidade, cliente: doc.cliente }];
  }).sort((a, b) => a.placa.localeCompare(b.placa) || a.inicio.localeCompare(b.inicio));
  const grouped = [];
  for (const item of valid) {
    const last = grouped.at(-1);
    if (last && last.placa === item.placa && item.inicio <= last.fim) {
      last.documento += ` / ${item.documento}`;
      if (item.fim > last.fim) { last.fim = item.fim; last.destino = item.destino; }
    } else grouped.push({ ...item });
  }
  const loaded = grouped.map((item) => ({ ...item, inicio: item.inicio < start ? start : item.inicio, fim: item.fim > end ? end : item.fim })).filter((item) => item.fim > item.inicio);
  const gaps = [];
  grouped.forEach((item, index) => {
    const next = grouped[index + 1]?.placa === item.placa ? grouped[index + 1] : null;
    const inicio = item.fim < start ? start : item.fim;
    const fim = next && next.inicio < end ? next.inicio : end;
    if (fim > inicio) gaps.push({ ...item, inicio, fim, entregaAt: item.fim,
      proximaOperacaoAt: next?.inicio || null, proximoDocumento: next?.documento || "",
      entregaFonte: "documentos_experimental", classificacao: "vazio_provavel" });
  });
  return { loaded: loaded.map((item, index) => ({ ...item, id: index + 1 })),
    gaps: gaps.map((item, index) => ({ ...item, id: index + 1 })), ignored: documents.length - valid.length };
}
