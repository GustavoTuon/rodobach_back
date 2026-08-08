import "dotenv/config";

const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const isProduction = process.env.NODE_ENV === "production";
if (!process.env.JWT_SECRET && isProduction) throw new Error("JWT_SECRET is required in production");
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must have at least 32 characters");
}

export const config = {
  env: process.env.NODE_ENV || "development",
  isProduction,
  port: Number(process.env.PORT || 3333),
  jwtSecret: process.env.JWT_SECRET || "development-only-jwt-secret-32-chars",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
  telemetriaResumoDir: process.env.TELEMETRIA_RESUMO_DIR || "",
  runSchedulers: String(process.env.RUN_SCHEDULERS || "false").toLowerCase() === "true",
  statusCargaAlert: {
    enabled: String(process.env.STATUS_CARGA_ALERTA_ENABLED || "true").toLowerCase() === "true",
    destinatario: String(process.env.STATUS_CARGA_ALERTA_DESTINATARIO || "554899503759").replace(/\D/g, ""),
    horasVazio: Number(process.env.STATUS_CARGA_ALERTA_HORAS || 48),
    repetirHoras: Number(process.env.STATUS_CARGA_ALERTA_REPETIR_HORAS || 24),
    intervaloMinutos: Number(process.env.STATUS_CARGA_ALERTA_INTERVALO_MINUTOS || 60),
  },
  n8n: {
    apiUrl: (process.env.N8N_API_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.N8N_API_KEY || "",
    vencimentoClientesWorkflowId: process.env.N8N_VENCIMENTO_CLIENTES_WORKFLOW_ID || "",
    oportunidadesRetornoWebhookUrl: process.env.N8N_OPORTUNIDADES_RETORNO_WEBHOOK_URL || "",
    oportunidadesRetornoDestinatario: process.env.N8N_OPORTUNIDADES_RETORNO_DESTINATARIO || "",
    statusCargaVazioWebhookUrl: process.env.N8N_STATUS_CARGA_VAZIO_WEBHOOK_URL
      || ((process.env.N8N_API_URL || "").replace(/\/+$/, "")
        ? `${(process.env.N8N_API_URL || "").replace(/\/+$/, "")}/webhook/status-carga-veiculo-vazio`
        : ""),
  },
  frontendOrigins: (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    schema: process.env.DB_SCHEMA || "public",
    ssl: String(process.env.DB_SSL || "false").toLowerCase() === "true",
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  },
  veiculosDb: {
    host: process.env.VEICULOS_DB_HOST,
    port: Number(process.env.VEICULOS_DB_PORT || 5432),
    database: process.env.VEICULOS_DB_NAME,
    user: process.env.VEICULOS_DB_USER,
    password: process.env.VEICULOS_DB_PASSWORD,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  },
  clientDb: {
    host: process.env.CLIENT_DB_HOST || process.env.DB_HOST,
    port: Number(process.env.CLIENT_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.CLIENT_DB_NAME || process.env.DB_NAME,
    user: process.env.CLIENT_DB_USER || process.env.DB_USER,
    password: process.env.CLIENT_DB_PASSWORD || process.env.DB_PASSWORD,
    ssl: String(process.env.CLIENT_DB_SSL || "false").toLowerCase() === "true",
    max: Number(process.env.CLIENT_DB_MAX_CONNECTIONS || 4),
    connectionTimeoutMillis: Number(process.env.CLIENT_DB_CONNECTION_TIMEOUT_MS || 20000),
    queryTimeoutMillis: Number(process.env.CLIENT_DB_QUERY_TIMEOUT_MS || 30000),
    statementTimeoutMillis: Number(process.env.CLIENT_DB_STATEMENT_TIMEOUT_MS || 30000),
    lockTimeoutMillis: Number(process.env.CLIENT_DB_LOCK_TIMEOUT_MS || 5000),
  },
};

export function quoteIdent(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

export function tableName(name) {
  return `${quoteIdent(config.db.schema)}.${quoteIdent(name)}`;
}
