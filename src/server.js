import cors from "cors";
import express from "express";
import { config, tableName } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { freteRouter } from "./routes/frete.js";
import { financeiroRouter } from "./routes/financeiro.js";
import { viagensRouter } from "./routes/viagens.js";

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.frontendOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "rodobach-api" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rodobach-api" });
});

app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, database: true, now: rows[0].now });
  } catch (error) {
    res.status(503).json({ ok: false, database: false, error: error.message });
  }
});

app.get("/api/health/viagens", async (_req, res) => {
  try {
    const { rows: dbTime } = await pool.query("SELECT NOW() AS now");
    const { rows: tables } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name IN ('cadastro_cotacao_frete', 'cadastro_cotacao_frete_rotas')
    `, [config.db.schema]);
    const tableNames = tables.map(r => r.table_name);
    const allTables = tableNames.includes("cadastro_cotacao_frete") && tableNames.includes("cadastro_cotacao_frete_rotas");
    res.json({
      ok: allTables,
      database: true,
      now: dbTime[0].now,
      tablesFound: tableNames,
      hint: allTables ? null : "Execute POST /api/admin/migrate para criar as tabelas.",
    });
  } catch (error) {
    res.status(503).json({ ok: false, database: false, error: error.message });
  }
});

app.post("/api/admin/migrate", async (_req, res, next) => {
  try {
    await runMigrations();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use("/api", freteRouter);
app.use("/api", financeiroRouter);
app.use("/api", viagensRouter);

app.use((req, res) => {
  res.status(404).json({ error: `Rota nao encontrada: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Erro interno no servidor.", detail: error.message });
});

app.listen(config.port, () => {
  console.log(`Rodobach API on http://localhost:${config.port}`);
});
