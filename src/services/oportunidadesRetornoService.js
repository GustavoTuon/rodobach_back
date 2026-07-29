import XLSX from "xlsx";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { config, tableName } from "../config.js";
import { getTrafegusDashboard, getTrafegusGoogleRoute } from "./trafegusService.js";

const CLIENTES_TABLE = tableName("oportunidades_retorno_clientes");
const N8N_WEBHOOK_PATH = "rodobach-oportunidades-retorno";
const cityCoordinatesCache = new Map();

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
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function header(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

const COLUMN_ALIASES = {
  nome: ["nome", "cliente", "razaosocial", "empresa"],
  cidade: ["cidade", "municipio"],
  uf: ["uf", "estado"],
  endereco: ["endereco", "logradouro", "localizacao"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon"],
  contato: ["contato", "nomecontato", "responsavel"],
  telefone: ["telefone", "celular", "whatsapp"],
  tipoCarga: ["tipocarga", "carga", "produto", "segmento"],
  observacao: ["observacao", "observacoes", "obs"],
};

function mappedValue(row, aliases) {
  const entries = Object.entries(row);
  const found = entries.find(([key]) => aliases.includes(header(key)));
  return found ? found[1] : "";
}

function normalizeImportedRow(row) {
  return {
    nome: text(mappedValue(row, COLUMN_ALIASES.nome)),
    cidade: text(mappedValue(row, COLUMN_ALIASES.cidade)),
    uf: text(mappedValue(row, COLUMN_ALIASES.uf)).slice(0, 2).toUpperCase(),
    endereco: text(mappedValue(row, COLUMN_ALIASES.endereco)),
    latitude: number(mappedValue(row, COLUMN_ALIASES.latitude)),
    longitude: number(mappedValue(row, COLUMN_ALIASES.longitude)),
    contato: text(mappedValue(row, COLUMN_ALIASES.contato)),
    telefone: text(mappedValue(row, COLUMN_ALIASES.telefone)),
    tipoCarga: text(mappedValue(row, COLUMN_ALIASES.tipoCarga)),
    observacao: text(mappedValue(row, COLUMN_ALIASES.observacao)),
  };
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
  const key = `${text(city).toUpperCase()}/${text(uf).toUpperCase()}`;
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
    ) || payload.results?.[0];
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
        COALESCE(NULLIF(con.totalcon, 0), con.valorfretecon, 0)::numeric AS receita
      FROM logistica.conhecimentos con
      WHERE con.statuscon = 2
        AND con.dataemissaocon::date >= CURRENT_DATE - INTERVAL '24 months'
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
      MAX(h.data)::date AS ultimo_frete
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
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`,
      fonte: "Histórico de CT-es dos últimos 24 meses",
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

export function createClientesTemplate() {
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
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [28, 18, 8, 38, 14, 14, 24, 20, 24, 42].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Clientes");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function importClientesWorkbook(base64, { replace = true } = {}) {
  const buffer = Buffer.from(text(base64).replace(/^data:.*?;base64,/, ""), "base64");
  if (!buffer.length) throw new Error("Arquivo de importacao vazio.");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("A planilha nao possui abas validas.");
  const imported = XLSX.utils.sheet_to_json(sheet, { defval: "" }).map(normalizeImportedRow);
  const valid = imported.filter((row) => row.nome && row.cidade && row.uf);
  const invalid = imported.length - valid.length;
  const withoutCoordinates = valid.filter((row) => row.latitude === null || row.longitude === null).length;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (replace) await client.query(`UPDATE ${CLIENTES_TABLE} SET ativo = FALSE, atualizado_em = NOW() WHERE ativo = TRUE`);
    for (const row of valid) {
      await client.query(`
        INSERT INTO ${CLIENTES_TABLE}
          (nome, cidade, uf, endereco, latitude, longitude, contato, telefone, tipo_carga, observacao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        row.nome, row.cidade, row.uf, row.endereco, row.latitude, row.longitude,
        row.contato, row.telefone, row.tipoCarga, row.observacao,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, importados: valid.length, ignorados: invalid, semCoordenadas: withoutCoordinates };
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
    observacao: row.observacao,
    importadoEm: row.importado_em,
  }));
}

export async function getOportunidadesOverview() {
  const [clientes, trafegus] = await Promise.all([
    listClientesRetorno(),
    getTrafegusDashboard(),
  ]);
  return {
    clientes,
    sms: trafegus.sms || [],
    configuracao: {
      raioPadraoKm: 200,
      n8nConfigurado: Boolean(opportunitiesWebhookUrl()),
      envioHabilitado: sendingEnabled(),
      destinatario: text(process.env.N8N_OPORTUNIDADES_RETORNO_DESTINATARIO),
    },
  };
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

export async function analyzeSmOpportunities(smId, rawRadius = 200) {
  const radiusKm = Math.min(Math.max(number(rawRadius) || 200, 1), 1000);
  const [route, overview] = await Promise.all([
    getTrafegusGoogleRoute(smId),
    getOportunidadesOverview(),
  ]);
  const destination = route.destino;
  if (!destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
    throw new Error("A SM nao possui coordenadas validas no destino.");
  }
  const nearby = overview.clientes
    .filter((client) => Number.isFinite(client.latitude) && Number.isFinite(client.longitude))
    .map((client) => ({
      ...client,
      distanciaKm: haversineKm(destination, client),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${client.latitude},${client.longitude}`,
    }))
    .filter((client) => client.distanciaKm <= radiusKm)
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
  const destinationUf = text(destination.descricao).toUpperCase().match(/\/([A-Z]{2})(?:\W|$)/)?.[1] || "";
  const potenciais = await listBilledClientsNear(destination, destinationUf, radiusKm, 10);
  const sm = overview.sms.find((item) => String(item.id) === String(smId)) || {
    id: route.sm,
    placa: route.placa,
    motorista: route.motorista,
  };
  return {
    sm,
    destino: destination,
    raioKm: radiusKm,
    clientes: nearby,
    potenciais,
    mensagem: buildMessage({ sm, destino: destination, raioKm: radiusKm, clientes: potenciais }),
    n8nConfigurado: overview.configuracao.n8nConfigurado,
    destinatario: overview.configuracao.destinatario,
  };
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
  const analysis = await analyzeSmOpportunities(payload.smId, payload.raioKm);
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
