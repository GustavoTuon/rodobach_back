const day = 86400000;
const iso = (date) => date.toISOString().slice(0, 10);
export function previousFuelPeriod(period) {
  const start = new Date(`${period.startDate}T12:00:00Z`);
  const end = new Date(`${period.endDate}T12:00:00Z`);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start)
    throw new Error("Período inválido");
  // Meses fechados são comparados com o mesmo número de meses anteriores.
  const next = new Date(+end + day);
  if (start.getUTCDate() === 1 && next.getUTCDate() === 1) {
    const months =
      (next.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      next.getUTCMonth() -
      start.getUTCMonth();
    const before = new Date(start);
    before.setUTCMonth(before.getUTCMonth() - months);
    return { startDate: iso(before), endDate: iso(new Date(+start - day)) };
  }
  return {
    startDate: iso(new Date(+start - (+end - +start + day))),
    endDate: iso(new Date(+start - day)),
  };
}
const change = (now, before) =>
  before > 0 && Number.isFinite(now) ? (now / before - 1) * 100 : null;
export function compareFuel(current, previous, period) {
  const old = new Map(previous.ranking.map((row) => [row.placa, row]));
  return {
    period,
    valor: change(current.summary.valor, previous.summary.valor),
    litros: change(current.summary.litros, previous.summary.litros),
    preco: change(
      current.summary.precoMedioPonderado,
      previous.summary.precoMedioPonderado,
    ),
    vehicles: current.ranking.map((row) => {
      const before = old.get(row.placa);
      const valid =
        row.combustivelFamilia === before?.combustivelFamilia &&
        row.cobertura?.completo &&
        before?.cobertura?.completo &&
        row.media > 0 &&
        before.media > 0;
      const variation = valid
        ? change(100 / row.media, 100 / before.media)
        : null;
      return {
        placa: row.placa,
        anterior: valid ? before.media : null,
        variacao: variation,
        status:
          variation === null
            ? "pendente"
            : variation >= 10
              ? "alerta"
              : variation >= 5
                ? "atencao"
                : variation <= -5
                  ? "melhora"
                  : "estavel",
      };
    }),
  };
}
