import pg from "pg";
import { config } from "../config.js";
import { tlsOptions } from "./tls.js";

let _pool = null;

export function getVeiculosPool() {
  if (!config.veiculosDb.host) {
    throw new Error("Banco de veículos não configurado (VEICULOS_DB_HOST ausente).");
  }
  if (!_pool) {
    _pool = new pg.Pool({
      ...config.veiculosDb,
      ssl: tlsOptions(config.veiculosDb.ssl, "VEICULOS_DB"),
      query_timeout: 60000,
      statement_timeout: 60000,
      options: "-c statement_timeout=60000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000 -c default_transaction_read_only=on",
    });
    _pool.on("error", (err) => {
      console.error("pool-veiculos erro:", err.message);
    });
  }
  return _pool;
}
