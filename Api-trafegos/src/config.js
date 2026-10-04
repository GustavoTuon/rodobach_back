import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(moduleDir, "../../rodobach_back/.env") });
dotenv.config({ path: path.resolve(moduleDir, "../.env"), override: true });

function bool(name, fallback = false) {
  const value = process.env[name];
  return value == null ? fallback : /^(1|true|yes|sim)$/i.test(value);
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export function loadConfig({ requireDelivery = true } = {}) {
  const dryRun = bool("DRY_RUN", true);
  const config = {
    trafegus: {
      webUrl: String(process.env.TRAFEGUS_WEB_URL || "https://elite.trafegus.com.br/trafeguswebnovo").replace(/\/+$/, ""),
      user: required("TRAFEGUS_USER"),
      password: required("TRAFEGUS_PASSWORD"),
    },
    dryRun,
    pollIntervalMs: Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS || 60)) * 1000,
    port: Number(process.env.PORT || 3340),
    host: String(process.env.HOST || "127.0.0.1"),
    adminToken: String(process.env.MONITOR_ADMIN_TOKEN || ""),
    stateFile: path.resolve(process.env.STATE_FILE || "./data/state.json"),
    countryCode: String(process.env.WHATSAPP_COUNTRY_CODE || "55").replace(/\D/g, ""),
    evolution: {
      url: String(process.env.EVOLUTION_API_URL || "").replace(/\/+$/, ""),
      key: String(process.env.EVOLUTION_API_KEY || ""),
      instance: String(process.env.EVOLUTION_INSTANCE_NAME || "rodobach"),
    },
    clientDb: {
      host: process.env.CLIENT_DB_HOST,
      port: Number(process.env.CLIENT_DB_PORT || 5432),
      database: process.env.CLIENT_DB_NAME,
      user: process.env.CLIENT_DB_USER,
      password: process.env.CLIENT_DB_PASSWORD,
      ssl: bool("CLIENT_DB_SSL", false),
    },
  };

  if (requireDelivery && !dryRun && (!config.evolution.url || !config.evolution.key)) {
    throw new Error("EVOLUTION_API_URL e EVOLUTION_API_KEY são obrigatórias com DRY_RUN=false");
  }
  if (process.env.NODE_ENV === "production" && config.adminToken.length < 32) {
    throw new Error("MONITOR_ADMIN_TOKEN deve ter pelo menos 32 caracteres em producao");
  }
  return config;
}
