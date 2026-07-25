import "dotenv/config";

const workflowIds = (process.env.N8N_LOGIN_WORKFLOW_IDS || [
  "DRhfq0SRae2r94fj",
  "ejntFPg5uY6n4tBq",
].join(","))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const apiUrl = (process.env.N8N_API_URL || "").replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY || "";

if (!apiUrl || !apiKey) {
  throw new Error("Configure N8N_API_URL e N8N_API_KEY.");
}

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || `n8n HTTP ${response.status}`);
  }
  return data;
}

for (const workflowId of workflowIds) {
  const workflow = await request(`/workflows/${workflowId}`);
  const nodes = structuredClone(workflow.nodes);
  const loginNode = nodes.find((node) => node.name === "Login Rodobach");

  if (!loginNode) {
    throw new Error(`Node "Login Rodobach" não encontrado em ${workflow.name}.`);
  }
  if (!loginNode.parameters?.jsonBody) {
    throw new Error(`JSON de login não configurado em ${workflow.name}.`);
  }

  loginNode.parameters.sendBody = true;
  loginNode.parameters.contentType = "json";
  loginNode.parameters.specifyBody = "json";

  const updated = await request(`/workflows/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: workflow.name,
      nodes,
      connections: workflow.connections,
      settings: workflow.settings || { executionOrder: "v1" },
      staticData: workflow.staticData || undefined,
    }),
  });

  console.log(JSON.stringify({
    id: updated.id,
    name: updated.name,
    active: updated.active,
    loginBodyMode: "json",
  }));
}
