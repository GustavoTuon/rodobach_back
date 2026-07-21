import { config } from "../config.js";

function assertN8nConfig() {
  if (!config.n8n.apiUrl || !config.n8n.apiKey) {
    const error = new Error("Integracao n8n nao configurada.");
    error.statusCode = 503;
    throw error;
  }
}

function workflowId() {
  const id = config.n8n.vencimentoClientesWorkflowId;
  if (!id) {
    const error = new Error("Workflow de vencimento de clientes nao configurado.");
    error.statusCode = 503;
    throw error;
  }
  return id;
}

async function n8nFetch(path, options = {}) {
  assertN8nConfig();

  const response = await fetch(`${config.n8n.apiUrl}/api/v1${path}`, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": config.n8n.apiKey,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `n8n API ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function mapExecution(execution) {
  return {
    id: execution.id,
    workflowId: execution.workflowId,
    status: execution.status || (execution.finished ? "success" : "running"),
    finished: Boolean(execution.finished),
    mode: execution.mode || null,
    startedAt: execution.startedAt || null,
    stoppedAt: execution.stoppedAt || null,
    waitTill: execution.waitTill || null,
  };
}

function statusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (["success", "succeeded"].includes(normalized)) return "Sucesso";
  if (["error", "failed", "crashed"].includes(normalized)) return "Falhou";
  if (["running", "new"].includes(normalized)) return "Rodando";
  if (normalized === "waiting") return "Aguardando";
  return status || "Desconhecido";
}

export async function getVencimentoClientesAutomation() {
  const id = workflowId();
  const [workflow, executionsPayload] = await Promise.all([
    n8nFetch(`/workflows/${encodeURIComponent(id)}`),
    n8nFetch(`/executions?workflowId=${encodeURIComponent(id)}&limit=10`),
  ]);

  const executions = (executionsPayload?.data || []).map(mapExecution);
  const lastExecution = executions[0] || null;

  return {
    id: workflow.id,
    name: workflow.name,
    active: Boolean(workflow.active),
    lastExecution: lastExecution
      ? { ...lastExecution, statusLabel: statusLabel(lastExecution.status) }
      : null,
    executions: executions.map((execution) => ({
      ...execution,
      statusLabel: statusLabel(execution.status),
    })),
  };
}

export async function setVencimentoClientesAutomationActive(active) {
  const id = workflowId();
  const action = active ? "activate" : "deactivate";
  await n8nFetch(`/workflows/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  return getVencimentoClientesAutomation();
}
