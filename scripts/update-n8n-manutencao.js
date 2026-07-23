import "dotenv/config";

const workflowId = process.env.N8N_MANUTENCAO_WORKFLOW_ID || "hhjl1q5uyxov5kZI";
const apiUrl = (process.env.N8N_API_URL || "").replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY || "";

if (!apiUrl || !apiKey) throw new Error("Configure N8N_API_URL e N8N_API_KEY.");

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
  if (!response.ok) throw new Error(data?.message || `n8n HTTP ${response.status}`);
  return data;
}

const workflow = await request(`/workflows/${workflowId}`);
const nodes = structuredClone(workflow.nodes);
const node = (name) => {
  const found = nodes.find((item) => item.name === name);
  if (!found) throw new Error(`Node nao encontrado: ${name}`);
  return found;
};

const condition = node("If").parameters.conditions.conditions[0];
condition.rightValue = "={{ Number($('Loop Over Items').item.json.km_proximo_aviso || $('Loop Over Items').item.json.km_proximo_envio) }}";

node("Code in JavaScript").parameters.jsCode = `const output = [];
const itensDoIf = $input.all();
const automacao = $('Loop Over Items').first().json;
const numeros = String(automacao.numeros || '')
  .split(',')
  .map(numero => numero.replace(/[^\\d]/g, ''))
  .filter(Boolean);

if (!numeros.length) throw new Error('Automacao sem numero de destino');

for (const item of itensDoIf) {
  const odometro = Number(item.json.odometro || 0);
  const manutencao = Number(automacao.km_manutencao_prevista || automacao.km_proximo_envio || 0);
  const faltam = Math.max(0, manutencao - odometro);
  const formato = new Intl.NumberFormat('pt-BR');
  const texto = [
    '⚠️ *Manutenção preventiva próxima*',
    '',
    '*Veículo:* ' + automacao.placa,
    '*Serviço:* ' + automacao.titulo,
    '',
    automacao.mensagem,
    '',
    '*KM atual:* ' + formato.format(odometro) + ' km',
    '*Manutenção prevista:* ' + formato.format(manutencao) + ' km',
    '*Faltam aproximadamente:* ' + formato.format(faltam) + ' km',
  ].join('\\n');

  for (const numero of numeros) {
    output.push({ json: { ...automacao, ...item.json, numero, texto } });
  }
}

return output;`;

node("HTTP Request").parameters.jsonBody = "={{ { number: $json.numero, text: $json.texto } }}";

const updateNode = node("Update rows in a table");
const values = updateNode.parameters.columns.value;
values.km_atual = "={{ Number($('BUSCA KM ATUAL').item.json.odometro) }}";
values.km_manutencao_prevista = "={{ Number($('Loop Over Items').item.json.km_manutencao_prevista || $('Loop Over Items').item.json.km_proximo_envio) + Number($('Loop Over Items').item.json.intervalo_km) }}";
values.km_proximo_aviso = "={{ Number($('Loop Over Items').item.json.km_proximo_aviso || $('Loop Over Items').item.json.km_proximo_envio) + Number($('Loop Over Items').item.json.intervalo_km) }}";
values.km_proximo_envio = values.km_proximo_aviso;
values.ultimo_envio_em = "={{ $now }}";
values.ultimo_envio_km = "={{ Number($('BUSCA KM ATUAL').item.json.odometro) }}";
values.ultimo_envio_status = "sucesso";
values.ultimo_envio_erro = null;

const schema = updateNode.parameters.columns.schema || [];
for (const [id, type] of [
  ["km_manutencao_prevista", "number"],
  ["km_proximo_aviso", "number"],
  ["ultimo_envio_em", "dateTime"],
  ["ultimo_envio_km", "number"],
  ["ultimo_envio_status", "string"],
  ["ultimo_envio_erro", "string"],
]) {
  if (!schema.some((field) => field.id === id)) {
    schema.push({ id, displayName: id, required: false, defaultMatch: false, display: true, type, canBeUsedToMatch: true, removed: false });
  }
}

const updated = await request(`/workflows/${workflowId}`, {
  method: "PUT",
  body: JSON.stringify({
    name: workflow.name,
    nodes,
    connections: workflow.connections,
    settings: { executionOrder: workflow.settings?.executionOrder || "v1" },
  }),
});

console.log(JSON.stringify({ id: updated.id, name: updated.name, active: updated.active, nodes: updated.nodes.length }));
