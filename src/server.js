import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { requireAuth } from "./middleware/auth.js";
import { requireRoutePermission } from "./middleware/permissions.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { auditMutation } from "./services/auditService.js";
import { logger } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { financeiroRouter } from "./routes/financeiro.js";
import { freteRouter } from "./routes/frete.js";
import { localidadesRouter } from "./routes/localidades.js";
import { usuariosRouter } from "./routes/usuarios.js";
import { viagensRouter } from "./routes/viagens.js";
import { pneusRouter } from "./routes/pneus.js";
import { manutencaoRouter } from "./routes/manutencao.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { conducaoRouter } from "./routes/conducao.js";
import { automacoesRouter } from "./routes/automacoes.js";
import { abastecimentoAcordosRouter } from "./routes/abastecimentoAcordos.js";
import { statusCargaRouter } from "./routes/statusCarga.js";
import { trafegusRouter } from "./routes/trafegus.js";
import { oportunidadesRetornoRouter } from "./routes/oportunidadesRetorno.js";
import { folgasMotoristasRouter } from "./routes/folgasMotoristas.js";
import { consultaCteRouter } from "./routes/consultaCte.js";
import { canhotosRouter } from "./routes/canhotos.js";
import { startEmptyVehicleAlertScheduler } from "./services/statusCargaAlertaService.js";
import { startMaintenanceAlertScheduler } from "./services/manutencaoAlertaService.js";

export const app = express();

app.disable("x-powered-by");
app.use(pinoHttp({ logger, genReqId: (req) => req.headers["x-request-id"] || randomUUID() }));
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocalhost || config.frontendOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
}));

// ── Rotas públicas ────────────────────────────────────────────────────────────
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
    res.status(503).json({ ok: false, database: false, ...(config.isProduction ? {} : { error: error.message }) });
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
    res.status(503).json({ ok: false, database: false, ...(config.isProduction ? {} : { error: error.message }) });
  }
});

// Autenticação (login não requer token)
app.use("/api", authRouter);

// ── Rotas protegidas (JWT obrigatório a partir daqui) ─────────────────────────
app.use("/api", requireAuth);
app.use("/api", requireRoutePermission);
app.use("/api", auditMutation);

app.post("/api/admin/migrate", requireAdmin, async (_req, res, next) => {
  try {
    await runMigrations();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use("/api", freteRouter);
app.use("/api", localidadesRouter);
app.use("/api", financeiroRouter);
app.use("/api", viagensRouter);
app.use("/api", usuariosRouter);
app.use("/api", pneusRouter);
app.use("/api", manutencaoRouter);
app.use("/api", whatsappRouter);
app.use("/api", conducaoRouter);
app.use("/api", automacoesRouter);
app.use("/api", abastecimentoAcordosRouter);
app.use("/api", statusCargaRouter);
app.use("/api", trafegusRouter);
app.use("/api", oportunidadesRetornoRouter);
app.use("/api", folgasMotoristasRouter);
app.use("/api", consultaCteRouter);
app.use("/api", canhotosRouter);

// ── Handlers de erro ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Rota nao encontrada: ${req.method} ${req.path}` });
});

app.use((error, req, res, _next) => {
  req.log?.error({ err: error }, "Erro nao tratado");
  res.status(500).json({
    error: "Erro interno no servidor.",
    ...(config.isProduction ? {} : { detail: error.message }),
  });
});

export function startServer() {
  return app.listen(config.port, () => {
    logger.info({ port: config.port }, "Rodobach API iniciada");
    if (config.runSchedulers) {
      startEmptyVehicleAlertScheduler();
      startMaintenanceAlertScheduler();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
