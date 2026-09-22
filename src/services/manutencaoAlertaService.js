import {maintenanceDate, daysUntilMaintenance} from "./maintenanceDates.js";
import {sendAuditedMaintenance, maintenanceSendError, maintenanceAttemptExists} from "./maintenanceAudit.js";
import { config, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { sendWhatsappText } from "../routes/whatsapp.js";
import { getStatusCargaFrota } from "./statusCargaService.js";
import { loadMaintenanceOdometers } from "./maintenanceOdometer.js";
export { latestValidFuelOdometer } from "./maintenanceOdometer.js";

const AUTOMACOES = () => tableName("automacao_mensagem_manutencao");
const ENVIOS = () => tableName("manutencao_alertas_enviados");
const COMPONENTES = () => tableName("manutencao_componentes_posicao");
const COMPONENT_ENVIOS = () => tableName("manutencao_componentes_alertas_enviados");
const LOCK_ID = 78482932;

const normalizePlate = value => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const phones = value => [...new Set(String(value || "").split(/[,;\s]+/).map(v => v.replace(/\D/g, "")).filter(Boolean))];
const formatKm = value => `${Number(value || 0).toLocaleString("pt-BR")} km`;
const formatDate = value => maintenanceDate(value)?.split("-").reverse().join("/") || "-";
const formatDateTime = value => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  : "Não informada";

function odometerMessageLines(item) {
  if (!item.km_fonte) return [];
  return [
    `🧾 *Referência do KM:* ${item.km_fonte === "abastecimento" ? "Abastecimento" : item.km_fonte === "telemetria" ? "Telemetria" : "Indisponível"} — ${item.km_fonte === "abastecimento" ? formatDate(item.km_data) : formatDateTime(item.km_data)}`,
    item.km_fonte === "abastecimento" ? "KM registrado nessa data; não inclui o percurso posterior." : null,
    item.telemetria_descartada ? "Telemetria divergente desconsiderada no cálculo do alerta." : null,
  ].filter(Boolean);
}

function recommendedAction(item, overdue) {
  const message = item.mensagem || "Verifique e programe a manutenção antes de liberar o veículo.";
  if (overdue) return item.tipo_controle === "data"
    ? message.replace(/está próximo do vencimento/giu, "está vencido").replace(/está próxima do vencimento/giu, "está vencida")
    : message;
  return message.replace(/atingiu o marco/giu, "está próximo do marco");
}

export function alertType(item, currentKm, now = new Date()) {
  if (item.tipo_controle === "data") {
    const days = daysUntilMaintenance(item.data_proximo_envio, now);
    if (days === null) return null;
    if (days < 0) return { type: "vencido", remaining: days, reference: maintenanceDate(item.data_proximo_envio) };
    if (days <= 30) return { type: "antecipado", remaining: days, reference: maintenanceDate(item.data_proximo_envio) };
    return null;
  }
  const target = Number(item.km_proximo_envio);
  if (!Number.isFinite(currentKm) || !Number.isFinite(target) || target <= 0) return null;
  const remaining = target - currentKm;
  if (remaining <= 0) return { type: "vencido", remaining, reference: String(target) };
  if (remaining <= 1000) return { type: "antecipado", remaining, reference: String(target) };
  return null;
}

export function componentAlertType(item, currentKm, now = new Date()) {
  if (item.condicao === "CRITICO") return { type: "vencido", reference: `condicao-${item.id}-CRITICO`, detail: "Condição crítica" };
  if (item.condicao === "ATENCAO") return { type: "antecipado", reference: `condicao-${item.id}-ATENCAO`, detail: "Requer atenção" };
  const targetKm = Number(item.proximo_km);
  if (Number.isFinite(targetKm) && targetKm > 0 && Number.isFinite(currentKm)) {
    const remaining = targetKm - currentKm;
    const interval = Math.max(0, targetKm - Number(item.km_servico || 0));
    const threshold = Math.max(1000, interval * .1);
    if (remaining <= 0) return { type: "vencido", reference: `km-${targetKm}`, detail: `Limite excedido em ${formatKm(Math.abs(remaining))}` };
    if (remaining <= threshold) return { type: "antecipado", reference: `km-${targetKm}`, detail: `Faltam ${formatKm(remaining)}` };
  }
  if (item.proxima_data) {
    const days = daysUntilMaintenance(item.proxima_data, now);
    if (days === null) return null;
    if (days < 0) return { type: "vencido", reference: `data-${maintenanceDate(item.proxima_data)}`, detail: `Data vencida há ${Math.abs(days)} dia(s)` };
    if (days <= 30) return { type: "antecipado", reference: `data-${maintenanceDate(item.proxima_data)}`, detail: `Vence em ${days} dia(s)` };
  }
  return null;
}

function buildComponentAlertMessage(item, event, currentKm) {
  const side = item.lado === "E" ? "esquerdo" : item.lado === "D" ? "direito" : item.lado;
  return [
    event.type === "vencido" ? "🔴 *MANUTENÇÃO POR POSIÇÃO VENCIDA*" : "🟡 *MANUTENÇÃO POR POSIÇÃO PRÓXIMA*",
    "",
    `🚚 *Veículo:* ${item.conjunto_placa || item.placa}`,
    item.placa !== item.conjunto_placa ? `📦 *Implemento:* ${item.placa}` : null,
    `🔧 *Componente:* ${item.componente}`,
    `📍 *Posição:* ${item.eixo_codigo} · lado ${side}`,
    `⚠️ *Status:* ${event.detail}`,
    Number.isFinite(currentKm) ? `📏 *${item.km_fonte === "abastecimento" ? "Último KM registrado" : "KM atual"}:* ${formatKm(currentKm)}` : null,
    item.proximo_km ? `🎯 *Próximo marco:* ${formatKm(item.proximo_km)}` : null,
    item.proxima_data ? `📅 *Próxima data:* ${formatDate(item.proxima_data)}` : null,
    "",
    ...odometerMessageLines(item),
    "✅ *Ação recomendada:* revisar o item antes de liberar o veículo.",
  ].filter(Boolean).join("\n");
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
      : [`📏 *${item.km_fonte === "abastecimento" ? "Último KM registrado" : "KM atual"}:* ${formatKm(currentKm)}`, `🎯 *Próximo marco:* ${formatKm(item.km_proximo_envio)}`]),
    "",
    ...odometerMessageLines(item),
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

export async function runMaintenanceAlerts({ dryRun = true, planIds = null, onlyOverdue = false, dailyDate = null } = {}) {
  if (dailyDate !== null && maintenanceDate(dailyDate) !== dailyDate) throw new Error("Data de execução inválida.");
  const recipient = process.env.MAINTENANCE_ALERT_NUMBER;
  if (recipient && !/^\d{10,15}$/.test(recipient)) throw new Error("Destinatário de manutenção inválido.");
  if (!dryRun && config.readOnly) throw new Error("Envios desabilitados: ambiente somente consulta.");
  if (planIds !== null && (!Array.isArray(planIds) || !planIds.length || planIds.some(id => !Number.isSafeInteger(id) || id <= 0))) {
    throw new Error("Informe IDs válidos dos planos para envio.");
  }
  const lockClient = await pool.connect();
  let lock;
  try { lock = await lockClient.query("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_ID]); }
  catch (error) { lockClient.release(); throw error; }
  if (!lock.rows[0]?.acquired) {
    lockClient.release();
    return { ok: true, ignorado: true };
  }
  let executionId;
  const failures = [];
  const candidates = [];
  const sent = [];
  try {
    if (!dryRun) {
      const result = await pool.query(`INSERT INTO ${tableName("manutencao_alertas_execucoes")} DEFAULT VALUES RETURNING id`);
      executionId = result.rows[0].id;
    }
    const [{ rows: automations }, dashboard] = await Promise.all([
      pool.query(`SELECT * FROM ${AUTOMACOES()} WHERE ativo = TRUE AND ($1::int[] IS NULL OR id = ANY($1::int[])) ORDER BY id`, [planIds]),
      getStatusCargaFrota({ dias: 180 }),
    ]);
    const odometers = await loadMaintenanceOdometers(automations.map((item) => item.placa));
    const statusByPlate = new Map((dashboard.rows || []).map(row => [normalizePlate(row.placa), row]));
    const currentKmByPlate = new Map();
    for (const item of automations) {
      const status = statusByPlate.get(normalizePlate(item.placa));
      const reading = odometers.get(normalizePlate(item.placa));
      const currentKm = reading?.km_atual ?? null;
      currentKmByPlate.set(normalizePlate(item.placa), currentKm);
      const event = alertType(item, currentKm);
      if (!event || (onlyOverdue && event.type !== "vencido")) continue;
      if (dailyDate) event.reference = `${event.reference}|dia:${dailyDate}`;
      const message = buildMaintenanceAlertMessage({...item, ...reading}, status, event, currentKm);
      for (const number of phones(recipient || item.numeros)) {
        const exists = await pool.query(`SELECT 1 FROM ${ENVIOS()} WHERE automacao_id=$1 AND referencia=$2 AND tipo_alerta=$3 AND numero=$4`, [item.id, event.reference, event.type, number]);
        if (exists.rowCount || await maintenanceAttemptExists(pool, {origin: "plano", recordId: item.id, reference: event.reference, type: event.type, number})) continue;
        const candidate = { automacaoId: item.id, titulo: item.titulo, kmAtual: currentKm, placa: item.placa, numero: number, tipo: event.type, referencia: event.reference, mensagem: message };
        candidates.push(candidate);
        if (!dryRun) {
          const result = await sendAuditedMaintenance({pool, send: sendWhatsappText, candidate, item, currentKm});
          if (result.accepted) sent.push(candidate);
          if (result.failed) failures.push({...candidate, status: result.status});
        }
      }
    }
    const componentAutomations = planIds ? [] : automations.filter(item => item.alertas_componentes);
    if (componentAutomations.length) {
      const parentPlates = [...new Set(componentAutomations.map(item => normalizePlate(item.placa)))];
      const { rows: components } = await pool.query(`
        SELECT DISTINCT ON (placa, eixo_codigo, lado, componente) *
          FROM ${COMPONENTES()}
         WHERE cancelado = FALSE
           AND regexp_replace(upper(COALESCE(conjunto_placa, placa)), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
         ORDER BY placa, eixo_codigo, lado, componente, data_servico DESC, id DESC
      `, [parentPlates]);
      for (const item of components) {
        const parent = normalizePlate(item.conjunto_placa || item.placa);
        const currentKm = currentKmByPlate.get(parent);
        const event = componentAlertType(item, currentKm);
        if (!event || (onlyOverdue && event.type !== "vencido")) continue;
        if (dailyDate) event.reference = `${event.reference}|dia:${dailyDate}`;
        const related = componentAutomations.filter(automation => normalizePlate(automation.placa) === parent);
        const numbers = recipient ? phones(recipient) : [...new Set(related.flatMap(automation => phones(automation.numeros)))];
        const message = buildComponentAlertMessage({...item, ...odometers.get(parent)}, event, currentKm);
        for (const number of numbers) {
          const exists = await pool.query(`SELECT 1 FROM ${COMPONENT_ENVIOS()} WHERE registro_id=$1 AND referencia=$2 AND tipo_alerta=$3 AND numero=$4`, [item.id, event.reference, event.type, number]);
          if (exists.rowCount || await maintenanceAttemptExists(pool, {origin: "componente_posicao", recordId: item.id, reference: event.reference, type: event.type, number})) continue;
          const candidate = { origem: "componente_posicao", registroId: item.id, placa: parent, numero: number, tipo: event.type, referencia: event.reference, mensagem: message };
          candidates.push(candidate);
          if (!dryRun) {
            const result = await sendAuditedMaintenance({pool, send: sendWhatsappText, candidate, item, currentKm, component: true});
            if (result.accepted) sent.push(candidate);
            if (result.failed) failures.push({...candidate, status: result.status});
          }
        }
      }
    }
    if (executionId) await pool.query(`UPDATE ${tableName("manutencao_alertas_execucoes")}
      SET concluido_em=clock_timestamp(),status=$2,candidatos=$3,aceitos=$4,falhas=$5 WHERE id=$1`,
    [executionId, failures.length ? "com_falhas" : "concluido", candidates.length, sent.length, failures.length]);
    return { ok: failures.length === 0, dryRun, candidatos: candidates, enviados: sent, falhas: failures };
  } catch (error) {
    if (executionId) await pool.query(`UPDATE ${tableName("manutencao_alertas_execucoes")}
      SET concluido_em=clock_timestamp(),status='falha',erro=$2,candidatos=$3,aceitos=$4,falhas=$5 WHERE id=$1`,
    [executionId, error.code ? `Falha ao consultar/gravar dados (${String(error.code).slice(0, 30)}).` : maintenanceSendError(error), candidates.length, sent.length, failures.length]).catch(() => {});
    throw error;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

export function startMaintenanceAlertScheduler() {
  if (config.readOnly || !process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return null;
  let pending = null;
  const execute = () => {
    if (pending) return;
    pending = runMaintenanceAlerts({dryRun: false})
      .catch(error => console.error("Alerta de manutenção:", error.code || error.name))
      .finally(() => { pending = null; });
  };
  const first = setTimeout(execute, 120000);
  const timer = setInterval(execute, 10 * 60000);
  return async () => { clearTimeout(first); clearInterval(timer); await pending; };
}
