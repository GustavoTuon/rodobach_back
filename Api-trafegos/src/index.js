import { createPollRunner } from "./poll-runner.js";
import http from "node:http";
import { loadConfig } from "./config.js";
import { TrafegusClient } from "./trafegus-client.js";
import { StateStore } from "./state-store.js";
import { PhoneResolver } from "./phone-resolver.js";
import { EvolutionClient } from "./evolution-client.js";
import { RouteMonitor } from "./monitor.js";

const config = loadConfig();
const trafegus = new TrafegusClient(config.trafegus);
const stateStore = new StateStore(config.stateFile);
const phoneResolver = new PhoneResolver(config.clientDb, config.countryCode);
const evolution = new EvolutionClient(config.evolution);
const monitor = new RouteMonitor({
  trafegus,
  stateStore,
  phoneResolver,
  evolution,
  dryRun: config.dryRun,
});

const runner = createPollRunner(() => monitor.poll(), {
  onSuccess: result => console.log(JSON.stringify({ at: new Date().toISOString(), ...result })),
  onError: error => console.error(error),
});
const runPoll = () => runner.run();
let lastManualRunAt = 0;

await trafegus.login();
await runPoll();
const timer = setInterval(runPoll, config.pollIntervalMs);
timer.unref();

const server = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.url === "/health") {
    const { lastError } = runner.state();
    res.statusCode = lastError ? 503 : 200;
    res.end(JSON.stringify({ ok: !lastError, dryRun: config.dryRun }));
    return;
  }
  if (req.url === "/run" && req.method === "POST") {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!config.adminToken || token !== config.adminToken) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Nao autorizado" }));
      return;
    }
    if (Date.now() - lastManualRunAt < 30000) {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: "Aguarde antes de executar novamente" }));
      return;
    }
    lastManualRunAt = Date.now();
    const outcome = await runPoll();
    res.statusCode = outcome.ok ? 200 : 503;
    res.end(JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Rota não encontrada" }));
});

server.listen(config.port, config.host, () => {
  console.log(`Monitor Trafegus na porta ${config.port} (DRY_RUN=${config.dryRun})`);
});

async function shutdown() {
  clearInterval(timer);
  server.close();
  await phoneResolver.close();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
