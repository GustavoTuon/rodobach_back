import ExcelJS from "exceljs";
import { parseClientesWorkbook, importedContactKey, mergeContactValues } from "./retornoWorkbook.js";
export { parseClientesWorkbook } from "./retornoWorkbook.js";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { config, tableName } from "../config.js";
import { getTrafegusDashboard, getTrafegusGoogleRoute } from "./trafegusService.js";
import { getStatusCargaFrota } from "./statusCargaService.js";

const CLIENTES_TABLE = tableName("oportunidades_retorno_clientes");
const N8N_WEBHOOK_PATH = "rodobach-oportunidades-retorno";
const cityCoordinatesCache = new Map();
let fleetSnapshot;
let fleetSnapshotExpiresAt = 0;

async function getReturnFleet() {
  if (!fleetSnapshot || Date.now() >= fleetSnapshotExpiresAt) {
    fleetSnapshotExpiresAt = Date.now() + 30000;
    fleetSnapshot = Promise.all([getTrafegusDashboard(), getStatusCargaFrota({ dias: 180 })]);
    fleetSnapshot.catch(() => { fleetSnapshot = null; });
  }
  return fleetSnapshot;
}

function sendingEnabled() {
  return String(process.env.N8N_OPORTUNIDADES_RETORNO_ENVIO_HABILITADO || "").toLowerCase() === "true";
}

function opportunitiesWebhookUrl() {
  return text(process.env.N8N_OPORTUNIDADES_RETORNO_WEBHOOK_URL)
    || (config.n8n.apiUrl ? `${config.n8n.apiUrl}/webhook/${N8N_WEBHOOK_PATH}` : "");
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function geocodeCity(city, uf) {
  if (!text(city) || !text(uf)) return null;
  const key = `${text(city).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()}/${text(uf).toUpperCase()}`;
  if (cityCoordinatesCache.has(key)) return await cityCoordinatesCache.get(key);
  const pending = (async () => {
    try {
    const query = new URLSearchParams({
      name: text(city),
      count: "10",
      language: "pt",
      format: "json",
      countryCode: "BR",
    });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${query}`, {
      headers: { "user-agent": "Rodobach/1.0 oportunidades-retorno" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const normalizedUf = text(uf).toUpperCase();
    const normalizeName = (value) => text(value).toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const match = (payload.results || []).find((item) =>
      normalizeName(item.admin1) === normalizeName({
        AC: "ACRE", AL: "ALAGOAS", AP: "AMAPA", AM: "AMAZONAS", BA: "BAHIA", CE: "CEARA",
        DF: "DISTRITO FEDERAL", ES: "ESPIRITO SANTO", GO: "GOIAS", MA: "MARANHAO",
        MT: "MATO GROSSO", MS: "MATO GROSSO DO SUL", MG: "MINAS GERAIS", PA: "PARA",
        PB: "PARAIBA", PR: "PARANA", PE: "PERNAMBUCO", PI: "PIAUI", RJ: "RIO DE JANEIRO",
        RN: "RIO GRANDE DO NORTE", RS: "RIO GRANDE DO SUL", RO: "RONDONIA", RR: "RORAIMA",
        SC: "SANTA CATARINA", SP: "SAO PAULO", SE: "SERGIPE", TO: "TOCANTINS",
      }[normalizedUf] || normalizedUf)
    );
    const result = match && Number.isFinite(Number(match.latitude)) && Number.isFinite(Number(match.longitude))
      ? { latitude: Number(match.latitude), longitude: Number(match.longitude) }
      : null;
    return result;
    } catch {
      return null;
    }
  })();
  cityCoordinatesCache.set(key, pending);
  const result = await pending;
  cityCoordinatesCache.set(key, result);
  return result;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function listBilledClientsNear(destination, destinationUf, radiusKm, limit = 10) {
  const neighboringStates = {
    MA: ["MA", "PI", "PA", "TO"],
    PI: ["PI", "MA", "CE", "PE", "BA", "TO"],
    PA: ["PA", "MA", "TO", "MT", "AP", "RR", "AM"],
    TO: ["TO", "MA", "PI", "BA", "GO", "MT", "PA"],
  };
  const states = neighboringStates[destinationUf] || [destinationUf].filter(Boolean);
  const { rows } = await clientPool.query(`
    WITH historico AS (
      SELECT
        CASE
          WHEN con.tomadorservicoctecon = 4 AND con.tomadorservicooutroscon IS NOT NULL THEN con.tomadorservicooutroscon
          WHEN con.tomadorservicoctecon = 3 AND con.destinatariocon IS NOT NULL THEN con.destinatariocon
          WHEN con.tomadorservicoctecon = 2 AND con.recebedorcon IS NOT NULL THEN con.recebedorcon
          WHEN con.tomadorservicoctecon = 1 AND con.expedidorcon IS NOT NULL THEN con.expedidorcon
          ELSE con.clientecon
        END AS cliente_codigo,
        con.empresacon,
        con.cidadecoletacon AS cidade_codigo,
        con.dataemissaocon::date AS data,
        UPPER(NULLIF(TRIM(con.veiculocon::text), '')) AS placa,
        NULLIF(TRIM(natureza.nomenat), '') AS material,
        COALESCE(NULLIF(con.totalcon, 0), con.valorfretecon, 0)::numeric AS receita
      FROM logistica.conhecimentos con
      LEFT JOIN LATERAL (
        SELECT n.nomenat
        FROM logistica.naturezascargas n
        WHERE n.codigonat = con.naturezacargacon
        ORDER BY (n.empresanat = con.empresacon) DESC, (n.empresanat = 1) DESC, n.empresanat
        LIMIT 1
      ) natureza ON true
      WHERE con.statuscon = 2
        AND con.dataemissaocon::date >= DATE '2023-01-01'
        AND con.cidadecoletacon IS NOT NULL
    )
    SELECT
      h.cliente_codigo,
      COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Cliente sem nome') AS nome,
      cli.cnpjcpfcli AS documento,
      cli.contatocli AS contato,
      CONCAT_WS('', NULLIF(cli.dddcli, ''), NULLIF(cli.telefone1cli, '')) AS telefone,
      cli.emailcli AS email,
      cid.nomecid AS cidade,
      TRIM(est.abreviaturaest) AS uf,
      COUNT(*)::int AS quantidade_fretes,
      SUM(h.receita)::numeric AS faturamento,
      MAX(h.data)::date AS ultimo_frete,
      ARRAY_AGG(DISTINCT h.material ORDER BY h.material) FILTER (WHERE h.material IS NOT NULL) AS materiais,
      ARRAY_AGG(DISTINCT h.placa ORDER BY h.placa) FILTER (WHERE h.placa IS NOT NULL) AS placas
    FROM historico h
    JOIN localidades.cidades cid ON cid.codigocid = h.cidade_codigo
    JOIN localidades.estados est ON est.codigoest = cid.estadocid
    LEFT JOIN LATERAL (
      SELECT c.*
      FROM gerais.clientes c
      WHERE c.codigocli = h.cliente_codigo
      ORDER BY (c.empresacli = h.empresacon) DESC, c.empresacli
      LIMIT 1
    ) cli ON true
    WHERE h.cliente_codigo IS NOT NULL
      AND (CARDINALITY($1::text[]) = 0 OR TRIM(est.abreviaturaest) = ANY($1::text[]))
    GROUP BY h.cliente_codigo, cli.fantasiacli, cli.nomecli, cli.cnpjcpfcli, cli.contatocli,
             cli.dddcli, cli.telefone1cli, cli.emailcli, cid.nomecid, est.abreviaturaest
    ORDER BY SUM(h.receita) DESC
    LIMIT 250
  `, [states]);

  const located = await mapWithConcurrency(rows, 6, async (row) => {
    const coordinates = await geocodeCity(row.cidade, row.uf);
    if (!coordinates) return null;
    return {
      id: `tms:${row.cliente_codigo}:${row.cidade}:${row.uf}`,
      clienteCodigo: row.cliente_codigo,
      nome: row.nome,
      documento: row.documento || "",
      contato: row.contato || "",
      telefone: row.telefone || "",
      email: row.email || "",
      cidade: row.cidade,
      uf: text(row.uf).toUpperCase(),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      distanciaKm: haversineKm(destination, coordinates),
      quantidadeFretes: Number(row.quantidade_fretes) || 0,
      faturamento: Number(row.faturamento) || 0,
      ultimoFrete: row.ultimo_frete,
      placas: Array.isArray(row.placas) ? row.placas : [],
      materiais: Array.isArray(row.materiais) ? row.materiais : [],
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`,
      fonte: "Histórico de CT-es desde 2023",
    };
  });

  return located
    .filter((client) =>
      client
      && client.distanciaKm <= radiusKm
      && !/^(DESTINATARIO|SEM IDENTIFICA)/i.test(client.nome)
    )
    .sort((a, b) => a.distanciaKm - b.distanciaKm || b.faturamento - a.faturamento)
    .slice(0, limit);
}

export async function createClientesTemplate() {
  const rows = [{
    Nome: "Cliente Exemplo",
    Cidade: "Cordeiropolis",
    UF: "SP",
    Endereco: "Rodovia ou endereco completo",
    Latitude: -22.4817,
    Longitude: -47.4567,
    Contato: "Nome do responsavel",
    Telefone: "5519999999999",
    "Tipo de carga": "Ceramica / carga seca",
    Observacao: "Horario de atendimento ou detalhe comercial",
  }];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clientes");
  sheet.columns = Object.keys(rows[0]).map((header, index) => ({
    header, key: header, width: [28, 18, 8, 38, 14, 14, 24, 20, 24, 42][index],
  }));
  sheet.addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function importClientesWorkbook(base64, { replace = false } = {}) {
  const parsed = await parseClientesWorkbook(base64);
  const withPhone = parsed.valid.filter((row) => /\d/.test(row.telefone));
  const withoutPhone = parsed.valid.length - withPhone.length;
  if (!withPhone.length) throw new Error("Nenhum contato com número de telefone para importar.");
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let consolidated = 0;
  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${CLIENTES_TABLE} IN SHARE ROW EXCLUSIVE MODE`);
    const { rows } = await client.query(`SELECT * FROM ${CLIENTES_TABLE} WHERE ativo = TRUE ORDER BY id`);
    const existing = new Map();
    for (const row of rows) {
      const key = importedContactKey(row);
      const previous = existing.get(key);
      if (previous) {
        previous.tipo_carga = mergeContactValues(previous.tipo_carga, row.tipo_carga);
        previous.observacao = mergeContactValues(previous.observacao, row.observacao);
        await client.query(`UPDATE ${CLIENTES_TABLE} SET tipo_carga=$2, observacao=$3, atualizado_em=NOW() WHERE id=$1`, [previous.id, previous.tipo_carga, previous.observacao]);
        await client.query(`UPDATE ${CLIENTES_TABLE} SET ativo=FALSE, atualizado_em=NOW() WHERE id=$1`, [row.id]);
        consolidated++;
      } else existing.set(key, row);
    }
    if (replace) await client.query(`UPDATE ${CLIENTES_TABLE} SET ativo=FALSE, atualizado_em=NOW() WHERE ativo=TRUE`);
    for (const row of withPhone) {
      const previous = existing.get(importedContactKey(row));
      if (previous) {
        const material = mergeContactValues(previous.tipo_carga, row.tipoCarga);
        const observation = mergeContactValues(previous.observacao, row.observacao);
        await client.query(`UPDATE ${CLIENTES_TABLE}
          SET tipo_carga=$2, observacao=$3, ativo=TRUE, atualizado_em=NOW() WHERE id=$1`,
        [previous.id, material, observation]);
        updated++;
      } else {
        await client.query(`INSERT INTO ${CLIENTES_TABLE}
          (nome,cidade,uf,endereco,latitude,longitude,contato,telefone,tipo_carga,observacao)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [row.nome,row.cidade,row.uf,row.endereco,row.latitude,row.longitude,row.contato,row.telefone,row.tipoCarga,row.observacao]);
        inserted++;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return { ok: true, importados: withPhone.length, semTelefoneIgnorados: withoutPhone, novos: inserted, atualizados: updated, duplicadosConsolidados: parsed.duplicates + consolidated,
    ignorados: parsed.invalid, semCoordenadas: parsed.withoutCoordinates, aba: parsed.aba, abas: parsed.abas, pendencias: parsed.pendencias };
}

export async function listClientesRetorno() {
  const { rows } = await pool.query(`
    SELECT id, nome, cidade, uf, endereco, latitude, longitude, contato, telefone,
           tipo_carga, observacao, importado_em
    FROM ${CLIENTES_TABLE}
    WHERE ativo = TRUE
    ORDER BY nome
  `);
  return rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    cidade: row.cidade,
    uf: row.uf,
    endereco: row.endereco,
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    contato: row.contato,
    telefone: row.telefone,
    tipoCarga: row.tipo_carga,
    materiais: String(row.tipo_carga || "").split(" | ").filter(Boolean),
    observacao: row.observacao,
    importadoEm: row.importado_em,
  }));
}

export async function getOportunidadesOverview() {
  const [clientes, [trafegus, frota]] = await Promise.all([
    listClientesRetorno(),
    getReturnFleet(),
  ]);
  const placasComSm = new Set((trafegus.sms || []).map((item) => text(item.placa).replace(/[^a-z0-9]/gi, "").toUpperCase()));
  const veiculosTelemetria = (frota.rows || [])
    .filter((item) => !placasComSm.has(text(item.placa).replace(/[^a-z0-9]/gi, "").toUpperCase()))
    .filter((item) => Number.isFinite(Number(item.localizacao?.latitude)) && Number.isFinite(Number(item.localizacao?.longitude)))
    .map((item) => ({
      placa: item.placa,
      modelo: item.modelo || item.veiculo || "",
      situacao: item.situacaoOperacional?.label || item.estadoLabel || "",
      localizacao: item.localizacao,
    }));
  return {
    clientes,
    sms: trafegus.sms || [],
    veiculosTelemetria,
    configuracao: {
      raioPadraoKm: 200,
      n8nConfigurado: Boolean(opportunitiesWebhookUrl()),
      envioHabilitado: sendingEnabled(),
      destinatario: text(process.env.N8N_OPORTUNIDADES_RETORNO_DESTINATARIO),
    },
  };
}

export function buildClientAvailabilityMessage({ sm, destino, cliente }) {
  const greeting = cliente.contato ? `Olá, ${cliente.contato}! Tudo bem?` : "Olá! Tudo bem?";
  return [
    greeting,
    "",
    `Teremos o veículo ${sm.placa} disponível na região de ${destino.descricao}.`,
    `Vocês têm alguma carga disponível para embarque em ${cliente.cidade}/${cliente.uf}?`,
    "",
    "Se tiverem, podem nos informar o destino, produto, peso e previsão de carregamento?",
  ].join("\n");
}

function buildMessage({ sm, destino, raioKm, clientes }) {
  const lines = [
    `Oportunidades de carga de retorno - ${sm.placa}`,
    `SM ${sm.id} | Destino: ${destino.descricao}`,
    `Clientes em um raio de ate ${raioKm} km:`,
    "",
  ];
  clientes.forEach((cliente, index) => {
    lines.push(`${index + 1}. ${cliente.nome} - ${cliente.cidade}/${cliente.uf} (${cliente.distanciaKm.toFixed(0)} km)`);
    if (cliente.contato || cliente.telefone) {
      lines.push(`   Contato: ${[cliente.contato, cliente.telefone].filter(Boolean).join(" - ")}`);
    }
    if (cliente.tipoCarga) lines.push(`   Carga: ${cliente.tipoCarga}`);
    if (cliente.quantidadeFretes) {
      lines.push(`   Historico: ${cliente.quantidadeFretes} frete(s) - R$ ${cliente.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    }
  });
  if (!clientes.length) lines.push("Nenhum cliente com coordenadas foi encontrado dentro do raio informado.");
  return lines.join("\n");
}

export async function analyzeSmOpportunities(smId, rawRadius = 200, fonte = "sistema") {
  if (!["sistema", "planilha"].includes(fonte)) throw new Error("Fonte de oportunidades inválida.");
  const radiusKm = Math.min(Math.max(number(rawRadius) || 200, 1), 1000);
  const selection = text(smId);
  const overview = await getOportunidadesOverview();
  const telemetryPlate = selection.startsWith("tel:") ? selection.slice(4).replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
  let sm;
  let destination;
  if (telemetryPlate) {
    const vehicle = overview.veiculosTelemetria.find((item) => item.placa === telemetryPlate);
    if (!vehicle) throw new Error("Veiculo sem SM nao encontrado na telemetria.");
    destination = {
      descricao: vehicle.localizacao.cidadeUf || vehicle.localizacao.endereco || `Posicao atual de ${vehicle.placa}`,
      latitude: Number(vehicle.localizacao.latitude),
      longitude: Number(vehicle.localizacao.longitude),
    };
    sm = { id: null, placa: vehicle.placa, motorista: "", origem: "telemetria" };
  } else {
    const numericSmId = selection.startsWith("sm:") ? selection.slice(3) : selection;
    const route = await getTrafegusGoogleRoute(numericSmId);
    destination = route.destino;
    sm = overview.sms.find((item) => String(item.id) === String(numericSmId)) || {
      id: route.sm,
      placa: route.placa,
      motorista: route.motorista,
    };
  }
  if (!destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
    throw new Error("O veiculo nao possui coordenadas validas para a analise.");
  }
  const located = fonte === "planilha" ? await mapWithConcurrency(overview.clientes, 6, async (client) => {
    const coordinates = Number.isFinite(client.latitude) && Number.isFinite(client.longitude)
      ? client : await geocodeCity(client.cidade, client.uf);
    return coordinates ? { ...client, latitude: coordinates.latitude, longitude: coordinates.longitude } : client;
  }) : [];
  // Persist resolved cities so later searches and process restarts avoid external geocoding.
  const newlyLocated = located.filter((client, index) =>
    Number.isFinite(client.latitude) && Number.isFinite(client.longitude)
    && (!Number.isFinite(overview.clientes[index].latitude) || !Number.isFinite(overview.clientes[index].longitude))
  ).map(({ id, latitude, longitude }) => ({ id: String(id), latitude, longitude }));
  if (newlyLocated.length) await pool.query(`
    UPDATE ${CLIENTES_TABLE} AS c SET latitude=p.latitude, longitude=p.longitude
    FROM jsonb_to_recordset($1::jsonb) AS p(id text, latitude numeric, longitude numeric)
    WHERE c.id=p.id::bigint AND (c.latitude IS NULL OR c.longitude IS NULL)
  `, [JSON.stringify(newlyLocated)]);
  const nearby = located
    .filter((client) => Number.isFinite(client.latitude) && Number.isFinite(client.longitude))
    .map((client) => ({
      ...client,
      id: `planilha:${client.id}`,
      fonte: "planilha",
      distanciaKm: haversineKm(destination, client),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${client.latitude},${client.longitude}`,
    }))
    .filter((client) => client.distanciaKm <= radiusKm)
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
  const destinationUf = telemetryPlate
    ? text(overview.veiculosTelemetria.find((item) => item.placa === telemetryPlate)?.localizacao?.uf).toUpperCase()
    : text(destination.descricao).toUpperCase().match(/\/([A-Z]{2})(?:\W|$)/)?.[1] || "";
  const potenciais = fonte === "planilha" ? nearby : await listBilledClientsNear(destination, destinationUf, radiusKm, 100);
  const potenciaisComMensagem = potenciais.map((cliente) => ({
    ...cliente,
    mensagemContato: buildClientAvailabilityMessage({ sm, destino: destination, cliente }),
  }));
  return {
    sm,
    destino: destination,
    raioKm: radiusKm,
    fonte,
    semLocalizacao: located.filter((client) => !Number.isFinite(client.latitude) || !Number.isFinite(client.longitude)).length,
    clientes: nearby,
    potenciais: potenciaisComMensagem,
    mensagem: buildMessage({ sm, destino: destination, raioKm: radiusKm, clientes: potenciaisComMensagem }),
    n8nConfigurado: overview.configuracao.n8nConfigurado,
    destinatario: overview.configuracao.destinatario,
  };
}

export async function sendClientOpportunityToN8n(payload) {
  if (!sendingEnabled()) throw new Error("Envio bloqueado: o modulo esta em modo de validacao.");
  const webhookUrl = opportunitiesWebhookUrl();
  if (!webhookUrl) throw new Error("Webhook n8n de oportunidades ainda nao configurado.");
  const analysis = await analyzeSmOpportunities(payload.smId, payload.raioKm, payload.fonte);
  const cliente = analysis.potenciais.find((item) => String(item.id) === String(payload.clienteId));
  if (!cliente) throw new Error("Cliente nao encontrado nesta analise.");
  const destinatario = normalizeOpportunityPhone(payload.destinatario || cliente.telefone);
  if (!destinatario) throw new Error("O cliente nao possui telefone. Informe um numero para envio.");
  const mensagem = text(payload.mensagem) || cliente.mensagemContato;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      evento: "oportunidade_retorno_cliente",
      geradoEm: new Date().toISOString(),
      destinatario,
      mensagem,
      sm: analysis.sm,
      destino: analysis.destino,
      raioKm: analysis.raioKm,
      cliente,
    }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Webhook n8n respondeu HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  return { ok: true, status: response.status, cliente: cliente.nome, destinatario };
}

export function normalizeOpportunityPhone(value) {
  const digits = text(value).replace(/\D/g, "");
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^55[1-9]\d{9,10}$/.test(normalized) ? normalized : "";
}

export async function sendSelectedOpportunitiesToN8n(payload) {
  if (!sendingEnabled()) throw new Error("Envio bloqueado: o modulo esta em modo de validacao.");
  const webhookUrl = opportunitiesWebhookUrl();
  if (!webhookUrl) throw new Error("Webhook n8n de oportunidades ainda nao configurado.");
  if (!text(payload.mensagem)) throw new Error("Informe a mensagem para os contatos selecionados.");
  if (!Array.isArray(payload.clienteIds) || !payload.clienteIds.length || payload.clienteIds.length > 100) {
    throw new Error("Selecione entre 1 e 100 contatos.");
  }
  const analysis = await analyzeSmOpportunities(payload.smId, payload.raioKm, payload.fonte);
  const ids = [...new Set(payload.clienteIds.map(String))];
  const clients = ids.map((id) => analysis.potenciais.find((client) => String(client.id) === id));
  if (clients.some((client) => !client)) throw new Error("Um contato não está mais disponível nesta análise. Analise novamente.");
  return dispatchSelectedOpportunityMessages(clients, analysis, webhookUrl, payload.mensagem);
}

export async function dispatchSelectedOpportunityMessages(clients, analysis, webhookUrl, mensagem) {
  const results = [];
  const phones = new Set();
  await mapWithConcurrency(clients, 5, async (cliente) => {
    const destinatario = normalizeOpportunityPhone(cliente.telefone);
    if (!destinatario || phones.has(destinatario)) {
      results.push({ id: cliente.id, status: "ignorado", motivo: destinatario ? "Telefone repetido" : "Telefone inválido ou ausente" });
      return;
    }
    phones.add(destinatario);
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ evento: "oportunidade_retorno_cliente", geradoEm: new Date().toISOString(), destinatario,
          mensagem: text(mensagem), sm: analysis.sm, destino: analysis.destino, raioKm: analysis.raioKm, cliente }),
      });
      await response.text();
      if (!response.ok) throw new Error(`Webhook respondeu HTTP ${response.status}`);
      results.push({ id: cliente.id, status: "enviado" });
    } catch (error) {
      results.push({ id: cliente.id, status: "falha", motivo: error.message });
    }
  });
  return { resultados: results };
}

export async function sendOpportunitiesToN8n(payload) {
  if (!sendingEnabled()) {
    throw new Error("Envio bloqueado: o modulo esta em modo de validacao.");
  }
  const webhookUrl = opportunitiesWebhookUrl();
  if (!webhookUrl) throw new Error("Webhook n8n de oportunidades ainda nao configurado.");
  if (!text(payload.destinatario || process.env.N8N_OPORTUNIDADES_RETORNO_DESTINATARIO)) {
    throw new Error("Informe o numero que deve receber a mensagem.");
  }
  const analysis = await analyzeSmOpportunities(payload.smId, payload.raioKm, payload.fonte);
  const body = {
    evento: "oportunidades_retorno",
    geradoEm: new Date().toISOString(),
    destinatario: text(payload.destinatario || process.env.N8N_OPORTUNIDADES_RETORNO_DESTINATARIO),
    mensagem: text(payload.mensagem) || analysis.mensagem,
    sm: analysis.sm,
    destino: analysis.destino,
    raioKm: analysis.raioKm,
    clientes: analysis.potenciais,
  };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Webhook n8n respondeu HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  return { ok: true, status: response.status, enviados: analysis.potenciais.length };
}
