import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { config, quoteIdent, tableName } from "../config.js";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(__dirname, "../../sql");

export async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(config.db.schema)}`);
    await client.query(`SET search_path TO ${quoteIdent(config.db.schema)}`);

    const files = (await fs.readdir(sqlDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
      const SKIP_FILES = new Set([
        "004_analise_clientes.sql",
        "016_automacao_boletos_vencimento.sql",
        "validate_financeiro_por_placa.sql",
      ]);
      if (SKIP_FILES.has(file) || file.startsWith("validate_")) {
        console.log(`skipped ${file} (arquivo de consulta, nao e migracao)`);
        continue;
      }

      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    }

    await seedAdminUser(client);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function seedAdminUser(client) {
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*) AS count FROM ${tableName("usuarios")}`
    );
    if (parseInt(rows[0].count, 10) > 0) return;

    const hash = await bcrypt.hash("rodobach123", 10);
    await client.query(
      `INSERT INTO ${tableName("usuarios")} (login, senha, email) VALUES ($1, $2, $3)`,
      ["diogo.arcenio", hash, "diogoleonardoa@gmail.com"]
    );
    console.log("Admin criado — login: diogo.arcenio / senha: rodobach123");
  } catch (err) {
    console.warn("Seed de usuário ignorado:", err.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      console.log("database ready");
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
