import assert from "node:assert/strict";
import "dotenv/config";

const id = "y9b8gFg18TmR7pzw";
const oldValue = "={{ $('DEFINE PRA QUEM VAI MANDAR A MENSAGEM').item.json.tipo_envio }}";
const newValue = "={{ $('REGRA DIAS UTEIS').item.json.tipo_envio }}";
const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const expected = rollback ? newValue : oldValue;
const replacement = rollback ? oldValue : newValue;
const url = (process.env.N8N_API_URL || "").replace(/\/+$/, "");
const key = process.env.N8N_API_KEY;
if (!url || !key) throw new Error("Configure N8N_API_URL e N8N_API_KEY.");

async function request(path, options = {}) {
  const response = await fetch(`${url}/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "X-N8N-API-KEY": key },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

const workflow = await request(`/workflows/${id}`);
const nodes = structuredClone(workflow.nodes);
const target = nodes.find((node) => node.name === "Insert row");
assert(target, "No de historico ausente");
assert.equal(target.parameters.columns.value.tipo_envio, expected, "Expressao foi alterada; revisar antes de aplicar");
assert(nodes.some((node) => node.name === "REGRA DIAS UTEIS"));
target.parameters.columns.value.tipo_envio = replacement;

// Valida o campo na saida real da decisao, sem executar nenhum envio.
if (!rollback) {
  const execution = await request("/executions/29092?includeData=true");
  const runs = execution.data.resultData.runData["REGRA DIAS UTEIS"];
  const candidates = runs.flatMap((run) => run.data?.main?.[0] || []).filter((item) => item.json.deve_enviar);
  assert(candidates.length > 0);
  for (const item of candidates) assert(["pre_vencimento", "pos_vencimento"].includes(item.json.tipo_envio));
}

console.log(JSON.stringify({ workflow: workflow.name, id, apply, rollback, campo: "Insert row.tipo_envio", antes: expected, depois: replacement }));
if (apply) {
  const latest = await request(`/workflows/${id}`);
  assert.equal(latest.versionId, workflow.versionId, "Workflow mudou durante a revisao");
  // Campos internos retornados pelo GET, mas nao aceitos no PUT pelo schema
  // /api/v1/openapi.yml desta instancia. Seus valores sao conferidos apos salvar.
  const settings = Object.fromEntries(Object.entries(workflow.settings).filter(([field]) =>
    !["binaryMode", "timeSavedMode"].includes(field)));
  await request(`/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name: workflow.name, nodes, connections: workflow.connections,
      settings, staticData: workflow.staticData }),
  });
  const saved = await request(`/workflows/${id}`);
  assert.deepEqual(saved.nodes, nodes);
  assert.deepEqual(saved.connections, workflow.connections);
  assert.deepEqual(saved.settings, workflow.settings);
  assert.equal(saved.active, workflow.active);
  console.log(JSON.stringify({ saved: true, active: saved.active, versionId: saved.versionId,
    activeVersionId: saved.activeVersionId,
    publishedExpression: saved.activeVersion?.nodes?.find((node) => node.name === "Insert row")?.parameters?.columns?.value?.tipo_envio }));
}
