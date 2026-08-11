import { config } from "../config.js";

const RODOBACH_FOLDER_WORKFLOW_IDS = new Set([
  "y9b8gFg18TmR7pzw", // Vencimento Clientes
  "ejntFPg5uY6n4tBq", // Alertas Operacionais WhatsApp
  "5HljsndMwUtCSCUZ", // Frete ANTT Terceiros WhatsApp
  "DRhfq0SRae2r94fj", // Faturamento Diario WhatsApp
  "pQVvQgICABwzSEvF", // Abastecimento
  "hhjl1q5uyxov5kZI", // Manutencao mensagem
  "gjC2UJ9FXtTpzv8N", // Motor ligado parado
  "6FgebeZvm6cYqlVP", // Resumo diario - distancia e horarios dos veiculos
  "cEpGFLlG4MzvpSja", // Desativado
]);

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

function assertManagedWorkflow(id) {
  if (!RODOBACH_FOLDER_WORKFLOW_IDS.has(id)) {
    const error = new Error("Workflow nao pertence a pasta Rodobach monitorada.");
    error.statusCode = 404;
    throw error;
  }
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

function workflowUrl(id) {
  if (!config.n8n.apiUrl || !id) return null;
  return `${config.n8n.apiUrl}/workflow/${encodeURIComponent(id)}`;
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

function mapWorkflow(workflow, executionsPayload = {}) {
  const executions = (executionsPayload?.data || []).map(mapExecution);
  const lastExecution = executions[0] || null;
  const lastStatus = lastExecution?.status || null;

  return {
    id: workflow.id,
    name: workflow.name,
    active: Boolean(workflow.active),
    archived: Boolean(workflow.isArchived),
    url: workflowUrl(workflow.id),
    updatedAt: workflow.updatedAt || null,
    createdAt: workflow.createdAt || null,
    nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : null,
    lastExecution: lastExecution
      ? { ...lastExecution, statusLabel: statusLabel(lastStatus) }
      : null,
    statusLabel: lastExecution ? statusLabel(lastStatus) : "Sem historico",
    health: !workflow.active
      ? "inactive"
      : ["error", "failed", "crashed"].includes(String(lastStatus || "").toLowerCase())
        ? "error"
        : ["success", "succeeded"].includes(String(lastStatus || "").toLowerCase())
          ? "ok"
          : lastExecution ? "warn" : "unknown",
    executions: executions.map((execution) => ({
      ...execution,
      statusLabel: statusLabel(execution.status),
    })),
  };
}

function sortWorkflows(a, b) {
  const healthOrder = { error: 0, warn: 1, unknown: 2, ok: 3, inactive: 4 };
  const healthCompare = (healthOrder[a.health] ?? 9) - (healthOrder[b.health] ?? 9);
  if (healthCompare) return healthCompare;
  if (a.active !== b.active) return a.active ? -1 : 1;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

export async function getN8nAutomations() {
  const payload = await n8nFetch("/workflows?limit=100");
  const rawWorkflows = (payload?.data || [])
    .filter((workflow) => !workflow.isArchived)
    .filter((workflow) => RODOBACH_FOLDER_WORKFLOW_IDS.has(workflow.id));
  const workflows = await Promise.all(rawWorkflows.map(async (workflow) => {
    try {
      const executionsPayload = await n8nFetch(`/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=10`);
      return mapWorkflow(workflow, executionsPayload);
    } catch (error) {
      return {
        ...mapWorkflow(workflow, { data: [] }),
        health: "warn",
        statusLabel: "Historico indisponivel",
        error: error.message,
      };
    }
  }));

  const sorted = workflows.sort(sortWorkflows);
  return {
    scope: {
      label: "Personal / Rodobach",
      workflowIds: [...RODOBACH_FOLDER_WORKFLOW_IDS],
    },
    summary: {
      total: sorted.length,
      active: sorted.filter((workflow) => workflow.active).length,
      inactive: sorted.filter((workflow) => !workflow.active).length,
      failing: sorted.filter((workflow) => workflow.health === "error").length,
      warning: sorted.filter((workflow) => ["warn", "unknown"].includes(workflow.health)).length,
    },
    workflows: sorted,
  };
}

export async function getN8nAutomation(id) {
  assertManagedWorkflow(id);
  const workflow = await n8nFetch(`/workflows/${encodeURIComponent(id)}`);
  const executionsPayload = await n8nFetch(`/executions?workflowId=${encodeURIComponent(id)}&limit=10`);
  return mapWorkflow(workflow, executionsPayload);
}

export async function setN8nAutomationActive(id, active) {
  assertManagedWorkflow(id);
  const action = active ? "activate" : "deactivate";
  await n8nFetch(`/workflows/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  return getN8nAutomation(id);
}

export async function retryLastFailedN8nAutomation(id) {
  assertManagedWorkflow(id);
  const executionsPayload = await n8nFetch(`/executions?workflowId=${encodeURIComponent(id)}&limit=10`);
  const failedExecution = (executionsPayload?.data || []).find((execution) => (
    ["error", "failed", "crashed"].includes(String(execution.status || "").toLowerCase())
  ));

  if (!failedExecution?.id) {
    const error = new Error("Nenhuma execucao com erro foi encontrada para tentar novamente.");
    error.statusCode = 409;
    throw error;
  }

  const retriedExecution = await n8nFetch(`/executions/${encodeURIComponent(failedExecution.id)}/retry`, {
    method: "POST",
    body: JSON.stringify({ loadWorkflow: true }),
  });

  return {
    originalExecutionId: failedExecution.id,
    retriedExecution: mapExecution(retriedExecution),
    workflow: await getN8nAutomation(id),
  };
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
    url: workflowUrl(workflow.id),
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
