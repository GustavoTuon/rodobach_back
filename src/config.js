import "dotenv/config";

const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 3333),
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
  clientDb: {
    host: process.env.CLIENT_DB_HOST || process.env.DB_HOST,
    port: Number(process.env.CLIENT_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.CLIENT_DB_NAME || process.env.DB_NAME,
    user: process.env.CLIENT_DB_USER || process.env.DB_USER,
    password: process.env.CLIENT_DB_PASSWORD || process.env.DB_PASSWORD,
    ssl: String(process.env.CLIENT_DB_SSL || "false").toLowerCase() === "true",
    max: Number(process.env.CLIENT_DB_MAX_CONNECTIONS || 2),
    connectionTimeoutMillis: Number(process.env.CLIENT_DB_CONNECTION_TIMEOUT_MS || 10000),
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
