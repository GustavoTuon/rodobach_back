import { clientPool } from "../db/clientPool.js";
import { BASE_SQL } from "./rentabilidadeClientesService.js";

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
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(base, days) {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStartIso(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), "01"].join("-");
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

export async function getFaturamentoDiario(filters = {}) {
  const period = resolvePeriod(filters);
  const tipoVeiculo = normalizeTipo(filters.tipoVeiculo || filters.tipo || filters.proprietario);
  const params = [
    period.startDate,
    period.endDate,
    filters.cliente || null,
    filters.placa || null,
    null,
    null,
    filters.material || filters.produto || null,
    tipoVeiculo,
  ];

  const tipoClause = `($8::text = 'todos' OR LOWER(tipo_veiculo) = $8::text)`;
  const dailyQuery = `
    ${BASE_SQL}
    SELECT
      data::date AS data,
      COALESCE(SUM(receita), 0) AS faturamento,
      COALESCE(SUM(custo_total), 0) AS custo,
      COUNT(*)::int AS documentos,
      COUNT(DISTINCT cliente_codigo)::int AS clientes,
      COUNT(DISTINCT COALESCE(viagem::text, id))::int AS viagens
    FROM final
    WHERE ${tipoClause}
    GROUP BY data::date
    ORDER BY data::date
  `;

  const optionsQuery = `
    ${BASE_SQL}
    SELECT
      ARRAY(SELECT DISTINCT cliente_nome FROM final WHERE cliente_nome IS NOT NULL ORDER BY cliente_nome LIMIT 300) AS clientes,
      ARRAY(SELECT DISTINCT placa FROM final WHERE NULLIF(TRIM(placa::text), '') IS NOT NULL ORDER BY placa LIMIT 300) AS placas
  `;

  const [dailyRes, optionsRes] = await Promise.all([
    clientPool.query(dailyQuery, params),
    clientPool.query(optionsQuery, params.slice(0, 7)),
  ]);

  const dias = dailyRes.rows.map((row) => {
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
      clientes: num(row.clientes),
      ticketMedio: r2(num(row.documentos) > 0 ? faturamento / num(row.documentos) : 0),
    };
  });

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
    periodo: period,
    filtros: optionsRes.rows[0] || { clientes: [], placas: [] },
    resumo: {
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
    },
    dias,
    audit: {
      tabelas: ["logistica.conhecimentos", "frotas.veiculos", "gerais.clientes", "logistica.controleviagens*"],
      regraTipoVeiculo: "P=Frota; T/NULL/outros=Terceiro",
      observacao: "Faturamento diario usa CT-e emitido por dataemissaocon e evita financeiro.receber para nao duplicar receita.",
    },
  };
}
