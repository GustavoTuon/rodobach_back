import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${tableName("schema_migrations")} (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await fs.readdir(sqlDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const baselineExisting = String(process.env.MIGRATIONS_BASELINE_EXISTING || "false").toLowerCase() === "true";

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

      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const { rows: applied } = await client.query(
        `SELECT checksum FROM ${tableName("schema_migrations")} WHERE filename = $1`, [file]
      );
      if (applied[0]) {
        if (applied[0].checksum !== checksum) {
          throw new Error(`Migration already applied but changed: ${file}`);
        }
        console.log(`already applied ${file}`);
        continue;
      }
      if (baselineExisting) {
        await client.query(
          `INSERT INTO ${tableName("schema_migrations")} (filename, checksum) VALUES ($1, $2)`,
          [file, checksum]
        );
        console.log(`baselined ${file}`);
        continue;
      }

      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${tableName("schema_migrations")} (filename, checksum) VALUES ($1, $2)`,
        [file, checksum]
      );
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
    const login = process.env.BOOTSTRAP_ADMIN_LOGIN?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    if (!login || !password || !email) return;
    if (password.length < 12) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must have at least 12 characters");
    const { rows } = await client.query(
      `SELECT COUNT(*) AS count FROM ${tableName("usuarios")}`
    );
    if (parseInt(rows[0].count, 10) > 0) return;

    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO ${tableName("usuarios")} (login, senha, email, admin) VALUES ($1, $2, $3, TRUE)`,
      [login, hash, email]
    );
    console.log(`Admin bootstrap criado: ${login}`);
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
