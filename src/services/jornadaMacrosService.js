import { getVeiculosPool } from "../db/pool-veiculos.js";

const HOUR_MS = 60 * 60 * 1000;

function cleanMacro(value) {
  return String(value || "")
    .split(/\r?\n/)[0]
    .replace(/^\s*\d+\s*[.\-)]+\s*/, "")
    .trim();
}

function normalizedMacro(value) {
  return cleanMacro(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function macroState(description) {
  const value = normalizedMacro(description);
  if (/^(INICIO|REINICIO) DE VIAGEM/.test(value)) return "trabalhando";
  if (value) return "parado";
  return "desconhecido";
}

export function calculateMacroWork(events = [], rangeEnd = new Date()) {
  const ordered = [...events]
    .filter((event) => event.dataHora && event.descricao)
    .sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora));
  const end = new Date(rangeEnd);
  const sessions = [];
  const pauses = [];
  let state = "desconhecido";
  let stateStartedAt = null;
  let stateStartedBy = null;

  const closeState = (at, closedBy) => {
    if (!stateStartedAt || at <= stateStartedAt) return;
    const target = state === "trabalhando" ? sessions : state === "parado" ? pauses : null;
    if (target) target.push({
      inicio: stateStartedAt.toISOString(), fim: at.toISOString(),
      duracaoHoras: Math.round(((at - stateStartedAt) / HOUR_MS) * 100) / 100,
      inicioMacro: stateStartedBy, fimMacro: cleanMacro(closedBy), aberto: false,
    });
  };

  for (const event of ordered) {
    const at = new Date(event.dataHora);
    const nextState = macroState(event.descricao);
    if (Number.isNaN(at.getTime()) || nextState === "desconhecido") continue;
    if (nextState === state) continue;
    closeState(at, event.descricao);
    state = nextState;
    stateStartedAt = at;
    stateStartedBy = cleanMacro(event.descricao);
  }

  if (stateStartedAt && end > stateStartedAt) {
    const target = state === "trabalhando" ? sessions : state === "parado" ? pauses : null;
    if (target) target.push({
      inicio: stateStartedAt.toISOString(), fim: end.toISOString(),
      duracaoHoras: Math.round(((end - stateStartedAt) / HOUR_MS) * 100) / 100,
      inicioMacro: stateStartedBy, fimMacro: null, aberto: true,
    });
  }

  const total = (items) => Math.round(items.reduce((sum, item) => sum + item.duracaoHoras, 0) * 100) / 100;
  return {
    estadoAtual: state,
    sessoes: sessions,
    pausas: pauses,
    resumo: {
      horasTrabalhadas: total(sessions),
      horasParadas: total(pauses),
      trechosTrabalhados: sessions.length,
      maiorTrechoHoras: Math.round(Math.max(0, ...sessions.map((item) => item.duracaoHoras)) * 100) / 100,
    },
  };
}

function validDate(value, fallback) {
  const date = value ? new Date(`${value}T00:00:00-03:00`) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export async function getJornadaMacros(filters = {}) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  const inicio = validDate(filters.inicio, defaultStart);
  const requestedEnd = filters.fim ? new Date(`${filters.fim}T23:59:59.999-03:00`) : now;
  const fim = Number.isNaN(requestedEnd.getTime()) ? now : new Date(Math.min(requestedEnd.getTime(), now.getTime()));
  if (fim <= inicio) { const error = new Error("Periodo de macros invalido."); error.statusCode = 400; throw error; }
  if (fim - inicio > 31 * 24 * HOUR_MS) { const error = new Error("Consulte no maximo 31 dias por vez."); error.statusCode = 400; throw error; }

  const schema = String(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Schema de veiculos invalido.");
  const pool = getVeiculosPool();
  const vehiclesResult = await pool.query(`
    SELECT DISTINCT ON (regexp_replace(UPPER(placa), '[^A-Z0-9]', '', 'g'))
      veiculo_id, UPPER(TRIM(placa)) AS placa, COALESCE(nome_motorista, '') AS motorista
    FROM "${schema}".veiculos
    WHERE teclado_macro IS TRUE AND NULLIF(TRIM(placa), '') IS NOT NULL
    ORDER BY regexp_replace(UPPER(placa), '[^A-Z0-9]', '', 'g'), updated_at DESC NULLS LAST
  `);
  const vehicles = vehiclesResult.rows.map((row) => ({
    id: String(row.veiculo_id), placa: row.placa, motorista: row.motorista,
  }));
  const requestedPlate = String(filters.placa || "SXY5D26").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const vehicle = vehicles.find((item) => item.placa.replace(/[^A-Z0-9]/g, "") === requestedPlate);
  if (!vehicle) { const error = new Error("Veiculo com teclado de macros nao encontrado."); error.statusCode = 404; throw error; }

  const { rows } = await pool.query(`
    SELECT id, data_hora, macro_id, macro_descricao, motorista_id, motorista_nome,
           municipio, uf
    FROM "${schema}".mensagens_cb
    WHERE veiculo_id = $1
      AND data_hora >= $2 AND data_hora <= $3
      AND NULLIF(TRIM(macro_descricao), '') IS NOT NULL
    ORDER BY data_hora, id
  `, [vehicle.id, inicio, fim]);
  const events = rows.map((row) => ({
    id: String(row.id), dataHora: row.data_hora, macroId: row.macro_id ? String(row.macro_id) : null,
    descricao: cleanMacro(row.macro_descricao), motoristaId: row.motorista_id ? String(row.motorista_id) : null,
    motorista: row.motorista_nome || vehicle.motorista, municipio: row.municipio || "", uf: row.uf || "",
    estado: macroState(row.macro_descricao),
  }));
  const calculation = calculateMacroWork(events, fim);
  return {
    veiculos: vehicles, veiculo: vehicle,
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    eventos: [...events].reverse(), ...calculation,
    aviso: "Apuracao operacional baseada nas macros enviadas pelo motorista; nao substitui controle legal de ponto.",
  };
}
