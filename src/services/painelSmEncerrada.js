import {deliveryProgress} from './painelEntregas.js';

const time = value => {
  if (!value) return NaN;
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  return +new Date(match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6] || '00'}-03:00` : value);
};
const plate = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

// A finished SM and its closing macro are not independent proof of discharge.
export function latestFinishedSm(history, placa, now = new Date()) {
  if (!Array.isArray(history?.rows) || history.incompleto) return null;
  const rows = history.rows.filter(sm => plate(sm.placa) === plate(placa) && time(sm.inicio) <= +now)
    .sort((a, b) => time(b.inicio) - time(a.inicio));
  const sm = rows[0];
  if (!sm || String(sm.statusCodigo) !== '5' || !(time(sm.fim) >= time(sm.inicio)) || time(sm.fim) > +now) return null;
  if (rows.some(other => String(other.id) !== String(sm.id) && time(other.inicio) === time(sm.inicio))) return null;
  return sm;
}

export function finishedSmEvidence({row, sm, locations, events = [], manifestos, now = new Date()}) {
  if (!sm || plate(sm.placa) !== plate(row.placa) || String(sm.statusCodigo) !== '5') return null;
  const start = time(sm.inicio), end = time(sm.fim);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > +now) return null;
  // Missing manifest data is not equivalent to a successful empty result.
  if (!Array.isArray(manifestos) || manifestos.length) return null;
  const operationDates = [row.operacaoCarga?.ultimaEmissao, row.operacaoCarga?.inicio, row.emissaoAt, row.saidaAt].filter(Boolean).map(time);
  if (!operationDates.length || operationDates.some(date => !Number.isFinite(date) || date > end)) return null;
  if (events.some(event => event.tipo === 'carregado' && time(event.dataHora) >= end && time(event.dataHora) <= +now)) return null;
  const tripEvents = events.filter(event => time(event.dataHora) >= start && time(event.dataHora) <= end);
  const progress = Array.isArray(locations) ? deliveryProgress(locations, tripEvents, new Date(start).toISOString(), null, now) : null;
  if (progress?.total > 0 && progress.concluidas === progress.total) {
    const discharge = Math.max(...progress.paradas.map(stop => time(stop.concluidaEm)));
    // A load after the last discharge, even before SM closure, starts another operation.
    if (operationDates.some(date => date > discharge) || events.some(event => event.tipo === 'carregado' && time(event.dataHora) >= discharge && time(event.dataHora) <= +now)) return null;
    return {codigo: 'vazio', label: 'Vazio', desde: new Date(discharge).toISOString(),
      horasVazio: Math.max(0, (+now - discharge) / 3600000), confirmacaoPendente: false,
      smId: sm.id, encerradaEm: new Date(end).toISOString(), entregas: progress,
      fonte: `SM ${sm.id} finalizada e todas as ${progress.total} entregas confirmadas por macros de descarga nos locais previstos.`};
  }
  // A known partial delivery must never become a probable empty state.
  if (progress?.concluidas > 0 && progress.concluidas < progress.total) return null;
  const finish = tripEvents.find(event => event.tipo === 'fim_viagem');
  if (!finish || time(finish.dataHora) < Math.max(...operationDates)) return null;
  return {codigo: 'provavelmente_vazio', label: 'Provavelmente vazio', desde: null, horasVazio: null,
    confirmacaoPendente: true, smId: sm.id, encerradaEm: new Date(end).toISOString(), entregas: progress,
    fonte: `SM ${sm.id} finalizada e macro de fim de viagem, sem confirmação de todas as descargas.${!progress ? ' Guia de entregas indisponível.' : ''} Confira a situação do veículo.`};
}
