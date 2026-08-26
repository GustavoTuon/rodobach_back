import { config, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { getStatusCargaFrota } from "./statusCargaService.js";

const TABLE = () => tableName("alertas_veiculos_vazios");
const LOCK_ID = 78482931;
const hoursBetween = (a, b = new Date()) => (b.getTime() - new Date(a).getTime()) / 3600000;
const validDate = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null;

function stoppedSince(row, now) {
  const emptyAt = validDate(row.entregaAt || row.chegadaViagemAt || row.entregaViagemAt || row.eventoReferenciaAt) || now;
  const movementAt = validDate(row.localizacao?.ultimaMovimentacaoAt);
  return { emptyAt, stoppedAt: movementAt && movementAt > emptyAt ? movementAt : emptyAt };
}

function message(row, stoppedAt, elapsedHours) {
  const location = row.localizacao?.cidadeUf || row.localizacao?.endereco || "Nao informada";
  const days = Math.floor(elapsedHours / 24);
  const hours = Math.floor(elapsedHours % 24);
  return [
    "⚠️ VEICULO VAZIO E PARADO",
    "",
    `🚛 Placa: ${row.placa}`,
    `⏱️ Tempo parado: ${days} dia(s) e ${hours} hora(s)`,
    `📅 Desde: ${stoppedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `📍 Localizacao: ${location}`,
    row.documento ? `📄 Ultimo documento: ${row.documento}` : "📄 Sem documento ativo",
    row.localizacao?.mapsUrl ? `🗺️ Mapa: ${row.localizacao.mapsUrl}` : "",
  ].filter(Boolean).join("\n");
}

async function sendToN8n(item) {
  const url = config.n8n.statusCargaVazioWebhookUrl;
  if (!url) throw new Error("Webhook n8n do alerta de veiculo vazio nao configurado.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      evento: "veiculo_vazio_48h",
      geradoEm: new Date().toISOString(),
      destinatario: config.statusCargaAlert.destinatario,
      ...item,
    }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Webhook n8n respondeu HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  return { status: response.status };
}

export async function listEmptyVehicleAlerts() {
  const { rows } = await pool.query(`SELECT * FROM ${TABLE()} ORDER BY parado_desde NULLS LAST, placa`);
  return { configuracao: config.statusCargaAlert, alertas: rows };
}

export async function runEmptyVehicleAlerts({ dryRun = false } = {}) {
  const lockClient = await pool.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_ID]);
  if (!lock.rows[0]?.acquired) {
    lockClient.release();
    return { ok: true, ignorado: true, motivo: "verificacao_em_andamento" };
  }
  try {
    const now = new Date();
    const dashboard = await getStatusCargaFrota({ dias: 180 });
    const sent = [];
    const candidates = [];
    for (const row of dashboard.rows || []) {
      const isEmpty = row.situacaoOperacional?.tipo === "vazio";
      if (!isEmpty) {
        const situation = String(row.situacaoOperacional?.tipo || row.estado || "indefinido").slice(0, 30);
        await pool.query(`INSERT INTO ${TABLE()} (placa, ultima_verificacao, situacao, detalhes) VALUES ($1,NOW(),$2,$3::jsonb)
          ON CONFLICT (placa) DO UPDATE SET vazio_desde=NULL, parado_desde=NULL, ultima_verificacao=NOW(), ultimo_alerta_em=NULL, situacao=EXCLUDED.situacao, detalhes=EXCLUDED.detalhes`, [row.placa, situation, JSON.stringify({ estado: row.estado, situacaoOperacional: row.situacaoOperacional })]);
        continue;
      }
      const { emptyAt, stoppedAt } = stoppedSince(row, now);
      const elapsedHours = hoursBetween(stoppedAt, now);
      const { rows } = await pool.query(`INSERT INTO ${TABLE()} (placa,vazio_desde,parado_desde,ultima_verificacao,situacao,detalhes)
        VALUES ($1,$2,$3,NOW(),'vazio',$4::jsonb)
        ON CONFLICT (placa) DO UPDATE SET vazio_desde=EXCLUDED.vazio_desde, parado_desde=EXCLUDED.parado_desde, ultima_verificacao=NOW(), situacao='vazio', detalhes=EXCLUDED.detalhes
        RETURNING ultimo_alerta_em`, [row.placa, emptyAt, stoppedAt, JSON.stringify({ estado: row.estado, localizacao: row.localizacao, documento: row.documento })]);
      const lastAlert = validDate(rows[0]?.ultimo_alerta_em);
      if (elapsedHours < config.statusCargaAlert.horasVazio || (lastAlert && hoursBetween(lastAlert, now) < config.statusCargaAlert.repetirHoras)) continue;
      const item = { placa: row.placa, paradoDesde: stoppedAt, horasParado: Math.floor(elapsedHours), mensagem: message(row, stoppedAt, elapsedHours) };
      candidates.push(item);
      if (!dryRun) {
        await sendToN8n(item);
        await pool.query(`UPDATE ${TABLE()} SET ultimo_alerta_em=NOW(), total_alertas=total_alertas+1 WHERE placa=$1`, [row.placa]);
        sent.push(item);
      }
    }
    return { ok: true, dryRun, destinatario: config.statusCargaAlert.destinatario, candidatos: candidates, enviados: sent };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

export function startEmptyVehicleAlertScheduler() {
  if (!config.statusCargaAlert.enabled) return;
  const execute = () => runEmptyVehicleAlerts().catch((error) => console.error("Alerta de veiculo vazio:", error.message));
  const first = setTimeout(execute, 120000);
  const timer = setInterval(execute, Math.max(5, config.statusCargaAlert.intervaloMinutos) * 60000);
  first.unref?.();
}
