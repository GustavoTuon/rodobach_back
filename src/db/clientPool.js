import pg from "pg";
import { config } from "../config.js";

export const clientPool = new pg.Pool({
  host: config.clientDb.host,
  port: config.clientDb.port,
  database: config.clientDb.database,
  user: config.clientDb.user,
  password: config.clientDb.password,
  ssl: config.clientDb.ssl ? { rejectUnauthorized: false } : false,
  max: config.clientDb.max,
  connectionTimeoutMillis: config.clientDb.connectionTimeoutMillis,
  query_timeout: config.clientDb.queryTimeoutMillis,
  statement_timeout: config.clientDb.statementTimeoutMillis,
  idleTimeoutMillis: 30000,
  options: [
    `-c statement_timeout=${config.clientDb.statementTimeoutMillis}`,
    `-c lock_timeout=${config.clientDb.lockTimeoutMillis}`,
    "-c idle_in_transaction_session_timeout=10000",
    "-c default_transaction_read_only=on",
  ].join(" "),
});
