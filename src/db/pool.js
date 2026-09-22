import pg from "pg";
import { config } from "../config.js";
import { tlsOptions } from "./tls.js";

export const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: tlsOptions(config.db.ssl, "DB"),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  query_timeout: 30000,
  statement_timeout: 30000,
  options: "-c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000",
});
pool.on("error", error => console.error("Pool da aplicacao indisponivel:", error.code));
