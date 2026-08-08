import { tableName } from "../config.js";
import { clientPool } from "../db/clientPool.js";
import { pool } from "../db/pool.js";
import { sendWhatsappText } from "../routes/whatsapp.js";
import { getStatusCargaFrota } from "./statusCargaService.js";

const AUTOMACOES = () => tableName("automacao_mensagem_manutencao");
const ENVIOS = () => tableName("manutencao_alertas_enviados");
const LOCK_ID = 78482932;

const normalizePlate = value => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const phones = value => [...new Set(String(value || "").split(/[,;\s]+/).map(v => v.replace(/\D/g, "")).filter(Boolean))];
const formatKm = value => `${Number(value || 0).toLocaleString("pt-BR")} km`;
const formatDate = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "-";
const formatDateTime = value => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  : "Não informada";

export function latestValidFuelOdometer(readings = []) {
  const valid = readings
    .map((row) => ({ ...row, km: Number(row.km), date: new Date(row.data_ref) }))
    .filter((row) => Number.isFinite(row.km) && row.km >= 10000 && row.km <= 2000000 && !Number.isNaN(row.date.getTime()))
    .sort((a, b) => b.date - a.date);

  for (const candidate of valid) {
    const previous = valid.find((row) => row.date < candidate.date);
    if (!previous) return candidate;
    const elapsedDays = Math.max(1, (candidate.date - previous.date) / 86400000);
    const increase = candidate.km - previous.km;
    if (increase >= -500 && increase <= (elapsedDays * 2000) + 2000) return candidate;
  }
  return null;
}

async function loadFuelOdometers(plates = []) {
  const normalized = [...new Set(plates.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await clientPool.query(`
    SELECT regexp_replace(upper(veiculoaba::text), '[^A-Z0-9]', '', 'g') AS placa,
           dataaba::date AS data_ref,
           kilometragematualaba::numeric AS km
      FROM frotas.abastecimentos
     WHERE regexp_replace(upper(veiculoaba::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
       AND dataaba IS NOT NULL
       AND kilometragematualaba BETWEEN 10000 AND 2000000
     ORDER BY placa, dataaba DESC
  `, [normalized]);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.placa)) grouped.set(row.placa, []);
    if (grouped.get(row.placa).length < 30) grouped.get(row.placa).push(row);
  }
  return new Map([...grouped].map(([plate, readings]) => [plate, latestValidFuelOdometer(readings)]));
}

function recommendedAction(item, overdue) {
  const message = item.mensagem || "Verifique e programe a manutenção antes de liberar o veículo.";
  if (overdue) return message;
  return message.replace(/atingiu o marco/giu, "está próximo do marco");
}

function alertType(item, currentKm, now = new Date()) {
  if (item.tipo_controle === "data") {
    const due = new Date(`${String(item.data_proximo_envio).slice(0, 10)}T23:59:59`);
    if (Number.isNaN(due.getTime())) return null;
    const days = Math.ceil((due - now) / 86400000);
    if (days <= 0) return { type: "vencido", remaining: days, reference: String(item.data_proximo_envio).slice(0, 10) };
    if (days <= 30) return { type: "antecipado", remaining: days, reference: String(item.data_proximo_envio).slice(0, 10) };
    return null;
  }
  const target = Number(item.km_proximo_envio);
  if (!Number.isFinite(currentKm) || !Number.isFinite(target) || target <= 0) return null;
  const remaining = target - currentKm;
  if (remaining <= 0) return { type: "vencido", remaining, reference: String(target) };
  if (remaining <= 1000) return { type: "antecipado", remaining, reference: String(target) };
  return null;
}

export function buildMaintenanceAlertMessage(item, status, event, currentKm) {
  const location = status?.localizacao?.cidadeUf || status?.localizacao?.endereco || "Não informada";
  const operation = status?.situacaoOperacional?.label || status?.estadoLabel || "Não identificada";
  const isDate = item.tipo_controle === "data";
  const overdue = event.type === "vencido";
  const remaining = Math.abs(Number(event.remaining || 0));
  const deadlineStatus = isDate
    ? (overdue ? `Vencida há ${remaining} dia(s)` : `Vence em ${remaining} dia(s)`)
    : (overdue ? `Marco excedido em ${formatKm(remaining)}` : `Faltam ${formatKm(remaining)}`);
  return [
    overdue ? "🔴 *MANUTENÇÃO VENCIDA*" : "🟡 *MANUTENÇÃO PRÓXIMA*",
    "",
    `🚛 *Placa:* ${item.placa}`,
    `🔧 *Serviço:* ${item.titulo}`,
    `📋 *Controle:* ${isDate ? "Validade por data" : "Quilometragem"}`,
    `⚠️ *Status:* ${deadlineStatus}`,
    "",
    ...(isDate
      ? [`📅 *Último serviço:* ${formatDate(item.data_ultimo_servico)}`, `⏳ *Validade:* ${formatDate(item.data_proximo_envio)}`]
      : [`📏 *KM atual:* ${formatKm(currentKm)}`, `🎯 *Próximo marco:* ${formatKm(item.km_proximo_envio)}`]),
    "",
    `📦 *Situação:* ${operation}`,
    `🧭 *Destino:* ${status?.destino || "Não informado"}`,
    `🏢 *Cliente:* ${status?.cliente || "Não informado"}`,
    `📍 *Localização:* ${location}`,
    `🕒 *Posição atualizada:* ${formatDateTime(status?.localizacao?.dataHora)}`,
    status?.localizacao?.mapsUrl ? `🗺️ *Mapa:* ${status.localizacao.mapsUrl}` : null,
    "",
    `✅ *Ação recomendada:* ${recommendedAction(item, overdue)}`,
  ].filter(line => line !== null && line !== undefined).join("\n");
}

export async function runMaintenanceAlerts({ dryRun = false } = {}) {
  const lockClient = await pool.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_ID]);
  if (!lock.rows[0]?.acquired) {
    lockClient.release();
    return { ok: true, ignorado: true };
  }
  try {
    const [{ rows: automations }, dashboard] = await Promise.all([
      pool.query(`SELECT * FROM ${AUTOMACOES()} WHERE ativo = TRUE ORDER BY id`),
      getStatusCargaFrota({ dias: 180 }),
    ]);
    const fuelOdometers = await loadFuelOdometers(automations.map((item) => item.placa));
    const statusByPlate = new Map((dashboard.rows || []).map(row => [normalizePlate(row.placa), row]));
    const candidates = [];
    const sent = [];
    for (const item of automations) {
      const status = statusByPlate.get(normalizePlate(item.placa));
      const fuelOdometer = fuelOdometers.get(normalizePlate(item.placa));
      const currentKm = Number(fuelOdometer?.km) > 0
        ? Number(fuelOdometer.km)
        : Number(status?.localizacao?.odometro) > 0
          ? Number(status.localizacao.odometro)
        : (Number(item.km_atual) > 0 ? Number(item.km_atual) : null);
      const event = alertType(item, currentKm);
      if (!event) continue;
      const message = buildMaintenanceAlertMessage(item, status, event, currentKm);
      for (const number of phones(item.numeros)) {
        const exists = await pool.query(`SELECT 1 FROM ${ENVIOS()} WHERE automacao_id=$1 AND referencia=$2 AND tipo_alerta=$3 AND numero=$4`, [item.id, event.reference, event.type, number]);
        if (exists.rowCount) continue;
        const candidate = { automacaoId: item.id, placa: item.placa, numero: number, tipo: event.type, referencia: event.reference, mensagem: message };
        candidates.push(candidate);
        if (!dryRun) {
          await sendWhatsappText(number, message);
          await pool.query(`INSERT INTO ${ENVIOS()} (automacao_id,referencia,tipo_alerta,numero,mensagem) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [item.id, event.reference, event.type, number, message]);
          sent.push(candidate);
        }
      }
    }
    return { ok: true, dryRun, candidatos: candidates, enviados: sent };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

export function startMaintenanceAlertScheduler() {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;
  const execute = () => runMaintenanceAlerts().catch(error => console.error("Alerta de manutenção:", error.message));
  const first = setTimeout(execute, 120000);
  const timer = setInterval(execute, 10 * 60000);
  first.unref?.();
  timer.unref?.();
}
