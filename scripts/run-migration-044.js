import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";
import { config, tableName } from "../src/config.js";

const filename = "044_importacao_incremental_cargas_viagens_v2.sql";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(scriptDir, "../sql", filename);
const apply = process.argv.includes("--apply");
const requiredTables = [
  "cadastro_cotacao_frete",
  "cadastro_cotacao_frete_rotas",
  "cadastro_cotacao_frete_documentos",
  "cadastro_cotacao_frete_auditoria",
  "cargas_v2",
  "viagens_v2",
  "viagem_cargas_v2",
  "carga_rotas_v2",
  "carga_documentos_v2",
  "carga_aprovacao_auditoria_v2",
];

async function snapshot(client) {
  const counts = {};
  for (const name of requiredTables) {
    const relation = `${config.db.schema}.${name}`;
    const exists = await client.query("SELECT TO_REGCLASS($1) AS relation", [relation]);
    if (!exists.rows[0].relation) throw new Error(`Tabela obrigatoria ausente: ${relation}`);
    const result = await client.query(`SELECT COUNT(*)::bigint AS total FROM ${tableName(name)}`);
    counts[name] = Number(result.rows[0].total);
  }
  return counts;
}

async function integrity(client) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM ${tableName("cargas_v2")} WHERE legado_id IS NOT NULL) AS cargas_importadas,
      (SELECT COUNT(*)::int FROM (
        SELECT legado_id FROM ${tableName("cargas_v2")}
        WHERE legado_id IS NOT NULL GROUP BY legado_id HAVING COUNT(*) > 1
      ) duplicadas) AS cargas_legado_duplicadas,
      (SELECT COUNT(*)::int FROM ${tableName("viagem_cargas_v2")} vinculo
        LEFT JOIN ${tableName("viagens_v2")} viagem ON viagem.id=vinculo.viagem_id
        LEFT JOIN ${tableName("cargas_v2")} carga ON carga.id=vinculo.carga_id
        WHERE viagem.id IS NULL OR carga.id IS NULL) AS vinculos_orfaos,
      (SELECT COUNT(*)::int FROM ${tableName("cargas_v2")} carga
        LEFT JOIN ${tableName("viagem_cargas_v2")} vinculo ON vinculo.carga_id=carga.id
        WHERE carga.status <> 'aguardando_viagem' AND vinculo.carga_id IS NULL) AS cargas_ativas_sem_viagem
  `);
  return result.rows[0];
}

const client = await pool.connect();
try {
  const info = await client.query("SELECT CURRENT_DATABASE() AS database, INET_SERVER_ADDR()::text AS server");
  const applied = await client.query(
    `SELECT checksum, applied_at FROM ${tableName("schema_migrations")} WHERE filename=$1`,
    [filename],
  );
  const before = await snapshot(client);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "check",
    database: info.rows[0].database,
    schema: config.db.schema,
    remoteServer: Boolean(info.rows[0].server),
    alreadyApplied: Boolean(applied.rowCount),
    before,
    integrity: await integrity(client),
  }, null, 2));

  if (!apply || applied.rowCount) process.exitCode = 0;
  else {
    const sql = await fs.readFile(sqlPath, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      const after = await snapshot(client);
      await client.query(
        `INSERT INTO ${tableName("schema_migrations")} (filename, checksum) VALUES ($1,$2)`,
        [filename, checksum],
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ applied: true, after, integrity: await integrity(client) }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
