import pg from "pg";
import { config } from "../config.js";

let _pool = null;

export function getVeiculosPool() {
  if (!config.veiculosDb.host) {
    throw new Error("Banco de veículos não configurado (VEICULOS_DB_HOST ausente).");
  }
  if (!_pool) {
    _pool = new pg.Pool(config.veiculosDb);
    _pool.on("error", (err) => {
      console.error("pool-veiculos erro:", err.message);
    });
  }
  return _pool;
}
