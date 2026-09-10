// Piloto autorizado pelo usuario: horarios confirmados pela operacao, em Brasilia.
// Nao cria nem altera SMs no Trafegus. Remover este registro desfaz o ajuste.
export const operacoesComplementares = [{
  id: "rxo6c18-fumacense-20260825",
  placa: "RXO6C18",
  documento: "ERP 1-4375 a 1-4383",
  cliente: "Fumacense Alimentos",
  origem: "Fumacense Alimentos - Morro da Fumaça/SC",
  destino: "Gameleiras/MG",
  inicio: "2026-08-25T18:00:00.000Z",
  fim: "2026-08-29T17:00:00.000Z",
  fonte: "Horarios confirmados pelo usuario; documentos ERP 1-4375 a 1-4383",
}];

export function aplicarOperacoesComplementares(intervals, operations) {
  let result = intervals.map((item) => ({ ...item }));
  for (const op of operations) {
    result = result.flatMap((item) => {
      if (item.placa !== op.placa || item.fim <= op.inicio || item.inicio >= op.fim) return [item];
      const parts = [];
      if (item.inicio < op.inicio) parts.push({ ...item, fim: op.inicio,
        proximaOperacaoAt: op.inicio, proximoDocumento: op.documento, proximaOrigem: op.origem || op.cliente, operacaoComplementarId: op.id });
      if (item.fim > op.fim) parts.push({ ...item, inicio: op.fim, entregaAt: op.fim,
        documento: op.documento, cliente: op.cliente, destino: op.destino,
        entregaFonte: "confirmacao_operacional", operacaoComplementarId: op.id });
      return parts;
    });
  }
  return result.map((item, index) => ({ ...item, id: index + 1 }));
}
