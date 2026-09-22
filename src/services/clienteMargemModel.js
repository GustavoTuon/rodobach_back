const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function resolveMargemPeriod(filters = {}, today = new Date().toISOString().slice(0, 10)) {
  const endDate = filters.endDate || today;
  const startDate = filters.startDate || new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1;
  if (!valid(startDate) || !valid(endDate) || days < 1 || days > 366) throw Object.assign(new Error('Selecione datas válidas, em um intervalo de até 366 dias.'), {status: 400});
  const shift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  return {current: {startDate, endDate}, previous: {startDate: shift(startDate, -days), endDate: shift(startDate, -1)}};
}

export function documentMargin(row) {
  const cards = Array.isArray(row.cartas) ? row.cartas : [];
  const shared = cards.filter(card => Number(card.documentos) !== 1);
  const exclusive = cards.filter(card => Number(card.documentos) === 1);
  const validCards = exclusive.length > 0 && exclusive.every(card => numeric(card.valor) > 0);
  const direct = numeric(row.custo_motorista);
  let cost = null, source = 'Sem custo direto identificado';
  if (shared.length) source = 'Carta-frete compartilhada: custo não atribuído';
  else if (validCards) { cost = exclusive.reduce((sum, card) => sum + Number(card.valor), 0); source = 'Frete contratado em carta-frete exclusiva'; }
  else if (exclusive.length) source = 'Carta-frete sem valor de frete válido';
  else if (direct > 0) { cost = direct; source = 'Frete/comissão de motorista ligado ao documento'; }
  const revenue = numeric(row.receita);
  return {id: row.id, empresa: row.empresa, serie: row.serie, codigo: row.codigo, numero: row.numero, data: row.data,
    clienteId: JSON.stringify([row.empresa, row.cliente_codigo]), cliente: row.cliente || 'Cliente não identificado',
    clienteCodigo: row.cliente_codigo, placa: row.placa, origem: row.origem || 'Não informada', destino: row.destino || 'Não informado',
    viagem: row.viagem, empresaViagem: row.empresa_viagem,
    receita: revenue, custoDireto: cost === null ? null : money(cost), fonteCusto: source,
    saldoParcial: cost !== null && revenue !== null ? money(revenue - cost) : null,
    cartas: cards, compartilhadas: shared,
  };
}

function summarize(documents) {
  const withCost = documents.filter(row => row.custoDireto !== null && row.receita !== null);
  const revenue = documents.reduce((sum, row) => sum + (row.receita ?? 0), 0);
  const coveredRevenue = withCost.reduce((sum, row) => sum + row.receita, 0);
  const cost = withCost.reduce((sum, row) => sum + row.custoDireto, 0);
  return {documentos: documents.length, documentosComCusto: withCost.length,
    documentosSemReceita: documents.filter(row => row.receita === null).length,
    receita: money(revenue), receitaComCusto: money(coveredRevenue), receitaSemCusto: money(revenue - coveredRevenue),
    custoDireto: withCost.length ? money(cost) : null,
    saldoParcial: withCost.length ? money(coveredRevenue - cost) : null,
    margemParcial: coveredRevenue > 0 ? money((coveredRevenue - cost) / coveredRevenue * 100) : null,
    viagensIdentificadas: new Set(documents.filter(row => row.viagem != null).map(row => JSON.stringify([row.empresaViagem, row.viagem]))).size,
  };
}

export function buildClienteMargem(raw, periods) {
  const documents = raw.map(documentMargin);
  const inPeriod = (row, period) => row.data >= period.startDate && row.data <= period.endDate;
  const current = documents.filter(row => inPeriod(row, periods.current));
  const previous = documents.filter(row => inPeriod(row, periods.previous));
  function groups(keyOf) {
    const groups = new Map();
    for (const row of documents) {
      const key = keyOf(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups].map(([id, rows]) => {
      const now = summarize(rows.filter(row => inPeriod(row, periods.current)));
      const prior = summarize(rows.filter(row => inPeriod(row, periods.previous)));
      const comparable = now.documentos > 0 && prior.documentos > 0 && now.documentos === now.documentosComCusto && prior.documentos === prior.documentosComCusto;
      return {id, cliente: rows[0].cliente, empresa: rows[0].empresa, origem: rows[0].origem, destino: rows[0].destino,
        atual: now, anterior: prior,
        variacaoMargemPp: comparable && now.margemParcial !== null && prior.margemParcial !== null ? money(now.margemParcial - prior.margemParcial) : null,
      };
    }).sort((a, b) => b.atual.receitaSemCusto - a.atual.receitaSemCusto || (a.atual.saldoParcial ?? Infinity) - (b.atual.saldoParcial ?? Infinity));
  }
  const shared = new Map();
  for (const row of current) for (const card of row.compartilhadas) shared.set(card.id, card);
  return {periodos: periods, resumo: summarize(current), anterior: summarize(previous),
    clientes: groups(row => row.clienteId), rotas: groups(row => JSON.stringify([row.origem, row.destino])),
    documentos: current, documentosAnteriores: previous,
    custosCompartilhados: [...shared.values()],
    metodologia: 'Receita de CT-es autorizados normais/substitutos, pela emissão; orçamentos, complementos e cancelados não entram. Cada chave fiscal conta uma vez. Saldo e margem parciais consideram somente documentos com receita e custo direto identificados. Carta-frete exclusiva usa o valor do frete contratado; sem carta, usa frete/comissão do motorista vinculado ao documento. As duas fontes não são somadas. Custos compartilhados não são rateados. Combustível, manutenção, impostos e despesas gerais não estão incluídos. Não representa lucro líquido nem receita financeira da DRE.',
    atualizadoEm: new Date().toISOString(),
  };
}
