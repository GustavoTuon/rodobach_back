import { getLucroViagens } from "./lucroViagensService.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(base, days) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStartIso(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), "01"].join("-");
}

function daysAgoIso(days) {
  return addDaysIso(todayIso(), -days);
}

function normalizeTipo(value) {
  const v = String(value || "todos").trim().toLowerCase();
  if (["frota", "proprio", "próprio"].includes(v)) return "frota";
  if (["terceiro", "terceiros"].includes(v)) return "terceiro";
  return "todos";
}

function resolvePeriod(filters = {}) {
  const preset = String(filters.periodo || filters.period || "").toLowerCase();
  const today = todayIso();
  if (filters.startDate || filters.dataInicio || filters.dataInicial || filters.endDate || filters.dataFim || filters.dataFinal) {
    return {
      startDate: filters.startDate || filters.dataInicio || filters.dataInicial || daysAgoIso(29),
      endDate: filters.endDate || filters.dataFim || filters.dataFinal || today,
    };
  }
  if (preset === "hoje") return { startDate: today, endDate: today };
  if (preset === "ontem") {
    const yesterday = addDaysIso(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  if (preset === "7d") return { startDate: daysAgoIso(6), endDate: today };
  if (preset === "mes-atual" || preset === "month") return { startDate: monthStartIso(), endDate: today };
  if (preset === "mes-anterior") {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const start = monthStartIso(d);
    const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { startDate: start, endDate };
  }
  return { startDate: daysAgoIso(preset === "30d" || !preset ? 29 : 29), endDate: today };
}

function pctChange(current, previous) {
  return previous > 0 ? r2(((current - previous) / previous) * 100) : null;
}

function buildDias(period, lucroViagens) {
  const dailyMap = new Map();
  for (const viagem of lucroViagens.viagens || []) {
    const data = dateOnly(viagem.dataFaturamento || viagem.data);
    if (!data) continue;
    const row = dailyMap.get(data) || {
      data,
      faturamento: 0,
      custo: 0,
      documentos: 0,
      viagens: 0,
      clientesSet: new Set(),
    };
    row.faturamento += num(viagem.receita);
    row.custo += num(viagem.custo);
    row.documentos += num(viagem.documentos);
    row.viagens += 1;
    if (viagem.cliente) row.clientesSet.add(viagem.cliente);
    dailyMap.set(data, row);
  }

  const filledRows = [];
  for (let date = period.startDate; date <= period.endDate; date = addDaysIso(date, 1)) {
    filledRows.push(dailyMap.get(date) || {
      data: date,
      faturamento: 0,
      custo: 0,
      documentos: 0,
      viagens: 0,
      clientesSet: new Set(),
    });
  }

  const dias = filledRows.map((row) => {
    const faturamento = num(row.faturamento);
    const custo = num(row.custo);
    const lucro = faturamento - custo;
    return {
      data: dateOnly(row.data),
      faturamento: r2(faturamento),
      custo: r2(custo),
      lucro: r2(lucro),
      margem: r2(faturamento > 0 ? (lucro / faturamento) * 100 : 0),
      documentos: num(row.documentos),
      viagens: num(row.viagens),
      clientes: row.clientesSet?.size || 0,
      ticketMedio: r2(num(row.documentos) > 0 ? faturamento / num(row.documentos) : 0),
    };
  });
  return dias;
}

function buildResumo(dias) {
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const byDate = new Map(dias.map((row) => [row.data, row]));
  const faturamentoHoje = byDate.get(today)?.faturamento || 0;
  const faturamentoOntem = byDate.get(yesterday)?.faturamento || 0;
  const last7 = dias.filter((row) => row.data >= addDaysIso(today, -7) && row.data < today);
  const last30 = dias.filter((row) => row.data >= addDaysIso(today, -30) && row.data < today);
  const media7 = r2(last7.length ? last7.reduce((sum, row) => sum + row.faturamento, 0) / last7.length : 0);
  const media30 = r2(last30.length ? last30.reduce((sum, row) => sum + row.faturamento, 0) / last30.length : 0);

  const faturamentoTotal = r2(dias.reduce((sum, row) => sum + row.faturamento, 0));
  const custoTotal = r2(dias.reduce((sum, row) => sum + row.custo, 0));
  const lucroTotal = r2(faturamentoTotal - custoTotal);
  const documentos = dias.reduce((sum, row) => sum + row.documentos, 0);

  return {
    faturamentoHoje: r2(faturamentoHoje),
    faturamentoOntem: r2(faturamentoOntem),
    variacaoOntem: pctChange(faturamentoHoje, faturamentoOntem),
    media7,
    variacaoMedia7: pctChange(faturamentoHoje, media7),
    media30,
    variacaoMedia30: pctChange(faturamentoHoje, media30),
    faturamentoTotal,
    custoTotal,
    lucroTotal,
    margem: r2(faturamentoTotal > 0 ? (lucroTotal / faturamentoTotal) * 100 : 0),
    documentos,
    viagens: dias.reduce((sum, row) => sum + row.viagens, 0),
    clientesAtendidos: Math.max(0, ...dias.map((row) => row.clientes)),
    ticketMedio: r2(documentos > 0 ? faturamentoTotal / documentos : 0),
  };
}

export async function getFaturamentoDiario(filters = {}) {
  const period = resolvePeriod(filters);
  const tipoVeiculo = normalizeTipo(filters.tipoVeiculo || filters.tipo || filters.proprietario);
  const lucroViagens = await getLucroViagens({
    ...filters,
    startDate: period.startDate,
    endDate: period.endDate,
    tipoVeiculo,
    status: "todos",
  });
  const dias = buildDias(period, lucroViagens);
  const resumo = buildResumo(dias);

  return {
    periodo: period,
    filtros: lucroViagens.filtros || { clientes: [], placas: [] },
    resumo,
    dias,
    audit: {
      tabelas: lucroViagens.audit?.tabelas || ["financeiro.receber", "logistica.conhecimentos", "logistica.controleviagens*"],
      regraTipoVeiculo: "P=Frota; T/NULL/outros=Terceiro",
      observacao: "Faturamento diario usa a mesma base do Lucro por Viagem, agrupando as viagens por data.",
    },
  };
}
