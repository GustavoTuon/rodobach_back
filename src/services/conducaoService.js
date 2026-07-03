import { quoteIdent } from "../config.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

const RPM_SCORE_WEIGHTS = {
  marchaLenta: 20,
  extraEconomica: 100,
  verde: 100,
  azul: 75,
  vermelha: 40,
  roxa: 10,
  acimaLimite: 0,
};

const RPM_BANDS = [
  { key: "marchaLenta", label: "Marcha lenta", min: 1, max: 600 },
  { key: "extraEconomica", label: "Extra economica", min: 601, max: 1100 },
  { key: "verde", label: "Verde", min: 1101, max: 1350 },
  { key: "azul", label: "Azul", min: 1351, max: 1600 },
  { key: "vermelha", label: "Vermelha", min: 1601, max: 2000 },
  { key: "roxa", label: "Roxa", min: 2001, max: 2500 },
  { key: "acimaLimite", label: "Acima do limite", min: 2501, max: null },
];

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseDateOnly(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}

function addOneDay(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function round(value, digits = 2) {
  const number = Number(value || 0);
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function toNumber(row, key) {
  return Number(row?.[key] || 0);
}

function buildBandRows(row, prefix = "") {
  return RPM_BANDS.map((band) => {
    const registros = toNumber(row, `${prefix}${band.key}_registros`);
    const segundos = toNumber(row, `${prefix}${band.key}_segundos`);
    return {
      ...band,
      pesoNota: RPM_SCORE_WEIGHTS[band.key],
      registros,
      segundos,
      horas: round(segundos / 3600, 2),
    };
  });
}

function calculateWeightedScore(bands, denominatorKey) {
  const total = bands.reduce((sum, band) => sum + Number(band[denominatorKey] || 0), 0);
  if (!total) return 0;
  const score = bands.reduce((sum, band) => {
    return sum + Number(band[denominatorKey] || 0) * RPM_SCORE_WEIGHTS[band.key];
  }, 0) / total;
  return round(score, 0);
}

export async function getAnaliseConducaoRpm({ placa, dataInicio, dataFim } = {}) {
  const placaNormalizada = normalizePlate(placa);
  if (!placaNormalizada) {
    throw new Error("Placa e obrigatoria.");
  }

  const inicio = parseDateOnly(dataInicio, "2026-06-01");
  const fimInclusivo = parseDateOnly(dataFim, "2026-06-30");
  const fimExclusivo = addOneDay(fimInclusivo);
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const pool = getVeiculosPool();

  const { rows } = await pool.query(`
    WITH dados AS (
      SELECT
        v.placa,
        v.nome_motorista,
        v.vehicle_model,
        o.data_hora,
        o.rpm,
        o.velocidade,
        LEAD(o.data_hora) OVER (ORDER BY o.data_hora) AS proxima_data_hora
      FROM ${schema}.ocorrencias_telemetria o
      JOIN ${schema}.veiculos v ON v.veiculo_id = o.veiculo_id
      WHERE regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') = $1
        AND o.data_hora >= $2::date
        AND o.data_hora < $3::date
        AND o.rpm IS NOT NULL
    ),
    base AS (
      SELECT
        *,
        CASE
          WHEN proxima_data_hora IS NULL THEN 0
          ELSE GREATEST(0, LEAST(EXTRACT(EPOCH FROM proxima_data_hora - data_hora), 300))
        END AS segundos_cap
      FROM dados
    ),
    movimento AS (
      SELECT * FROM base WHERE velocidade > 0
    )
    SELECT
      max(placa) AS placa,
      max(nome_motorista) AS motorista,
      max(vehicle_model) AS modelo,
      min(data_hora) AS primeira_leitura,
      max(data_hora) AS ultima_leitura,
      count(*) AS registros_total,
      count(*) FILTER (WHERE velocidade > 0) AS registros_movimento,
      round(avg(rpm)::numeric, 1) AS rpm_medio,
      max(rpm) AS rpm_maximo,
      round(avg(velocidade)::numeric, 1) AS velocidade_media,
      max(velocidade) AS velocidade_maxima,

      count(*) FILTER (WHERE rpm BETWEEN 1 AND 600) AS "marchaLenta_registros",
      count(*) FILTER (WHERE rpm BETWEEN 601 AND 1100) AS "extraEconomica_registros",
      count(*) FILTER (WHERE rpm BETWEEN 1101 AND 1350) AS verde_registros,
      count(*) FILTER (WHERE rpm BETWEEN 1351 AND 1600) AS azul_registros,
      count(*) FILTER (WHERE rpm BETWEEN 1601 AND 2000) AS vermelha_registros,
      count(*) FILTER (WHERE rpm BETWEEN 2001 AND 2500) AS roxa_registros,
      count(*) FILTER (WHERE rpm >= 2501) AS "acimaLimite_registros",

      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1 AND 600) AS "mov_marchaLenta_registros",
      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 601 AND 1100) AS "mov_extraEconomica_registros",
      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1101 AND 1350) AS mov_verde_registros,
      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1351 AND 1600) AS mov_azul_registros,
      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1601 AND 2000) AS mov_vermelha_registros,
      count(*) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 2001 AND 2500) AS mov_roxa_registros,
      count(*) FILTER (WHERE velocidade > 0 AND rpm >= 2501) AS "mov_acimaLimite_registros",

      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1 AND 600), 0) AS "mov_marchaLenta_segundos",
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 601 AND 1100), 0) AS "mov_extraEconomica_segundos",
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1101 AND 1350), 0) AS mov_verde_segundos,
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1351 AND 1600), 0) AS mov_azul_segundos,
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 1601 AND 2000), 0) AS mov_vermelha_segundos,
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm BETWEEN 2001 AND 2500), 0) AS mov_roxa_segundos,
      coalesce(sum(segundos_cap) FILTER (WHERE velocidade > 0 AND rpm >= 2501), 0) AS "mov_acimaLimite_segundos"
    FROM base
  `, [placaNormalizada, inicio, fimExclusivo]);

  const row = rows[0] || {};
  const registrosMovimento = toNumber(row, "registros_movimento");
  const faixasMovimento = buildBandRows(row, "mov_");
  const segundosMovimento = faixasMovimento.reduce((sum, band) => sum + band.segundos, 0);
  const notaPorTempo = calculateWeightedScore(faixasMovimento, "segundos");
  const notaPorRegistros = calculateWeightedScore(faixasMovimento, "registros");
  const faixaVerdeAtual = registrosMovimento
    ? Math.ceil((toNumber(row, "mov_verde_registros") / registrosMovimento) * 100)
    : 0;

  return {
    placa: row.placa || placaNormalizada,
    motorista: row.motorista || "",
    modelo: row.modelo || "",
    periodo: {
      dataInicio: inicio,
      dataFim: fimInclusivo,
      primeiraLeitura: row.primeira_leitura || null,
      ultimaLeitura: row.ultima_leitura || null,
    },
    notaRpmEconomico: segundosMovimento ? notaPorTempo : notaPorRegistros,
    notaRpmEconomicoPorTempo: notaPorTempo,
    notaRpmEconomicoPorRegistros: notaPorRegistros,
    faixaVerdeAtual,
    pesos: RPM_SCORE_WEIGHTS,
    resumo: {
      registrosTotal: toNumber(row, "registros_total"),
      registrosMovimento,
      horasMovimento: round(segundosMovimento / 3600, 2),
      rpmMedio: Number(row.rpm_medio || 0),
      rpmMaximo: Number(row.rpm_maximo || 0),
      velocidadeMedia: Number(row.velocidade_media || 0),
      velocidadeMaxima: Number(row.velocidade_maxima || 0),
    },
    faixasMovimento: faixasMovimento.map((band) => ({
      ...band,
      percentualRegistros: registrosMovimento ? round((band.registros / registrosMovimento) * 100, 2) : 0,
      percentualTempo: segundosMovimento ? round((band.segundos / segundosMovimento) * 100, 2) : 0,
    })),
    faixasTodosRegistros: buildBandRows(row),
  };
}
