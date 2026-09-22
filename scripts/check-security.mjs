// Read-only infrastructure check. Does not create roles or change grants.
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
import { getVeiculosPool } from "../src/db/pool-veiculos.js";

const results = [];
const targets = [["aplicacao", pool], ["erp", clientPool]];
try { targets.push(["telemetria", getVeiculosPool()]); }
catch { results.push({ conexao: "telemetria", erro: "nao configurada" }); }

for (const [name, connectionPool] of targets) {
  let client;
  try {
    client = await connectionPool.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const { rows: [row] } = await client.query(`SELECT rolsuper AS superusuario,
      rolcreatedb AS cria_bancos, rolcreaterole AS cria_usuarios,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
      current_setting('default_transaction_read_only') AS leitura_por_padrao
      FROM pg_roles WHERE rolname=current_user`);
    results.push({ conexao: name, ...row });
  } catch (error) {
    results.push({ conexao: name, erro: error.code || "falha_de_conexao" });
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    await connectionPool.end();
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some(row => row.erro || row.superusuario || row.cria_bancos || row.cria_usuarios || !row.tls)) process.exitCode = 1;
