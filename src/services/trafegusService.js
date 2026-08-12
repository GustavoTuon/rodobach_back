import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { clientPool } from "../db/clientPool.js";
import { parseOfficialPolyline } from "./trafegusRoute.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const legacyEnvPath = path.resolve(moduleDir, "../../../Api-trafegos/.env");
const LOGIN_FORM_MARKER = 'id="usua_login"';
const CACHE_TTL_MS = 30_000;

function localCredentials() {
  if (!fs.existsSync(legacyEnvPath)) return {};
  return dotenv.parse(fs.readFileSync(legacyEnvPath));
}

function trafegusConfig() {
  const legacy = localCredentials();
  return {
    webUrl: String(process.env.TRAFEGUS_WEB_URL || legacy.TRAFEGUS_WEB_URL || "https://elite.trafegus.com.br/trafeguswebnovo").replace(/\/+$/, ""),
    user: String(process.env.TRAFEGUS_USER || legacy.TRAFEGUS_USER || "").trim(),
    password: String(process.env.TRAFEGUS_PASSWORD || legacy.TRAFEGUS_PASSWORD || ""),
  };
}

function cookiePairs(headers) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return raw.map((item) => item.split(";", 1)[0]).filter((item) => item.includes("="));
}

class TrafegusSession {
  constructor() {
    this.cookies = new Map();
    this.loginPromise = null;
  }

  rememberCookies(headers) {
    for (const pair of cookiePairs(headers)) {
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(pathname, options = {}, redirects = 5) {
    const config = trafegusConfig();
    const response = await fetch(`${config.webUrl}${pathname}`, {
      ...options,
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(options.headers || {}),
      },
    });
    this.rememberCookies(response.headers);

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (!redirects) throw new Error("Redirecionamentos excessivos no Trafegus");
      const target = new URL(response.headers.get("location"), `${config.webUrl}${pathname}`);
      const base = new URL(config.webUrl);
      if (target.origin !== base.origin) throw new Error("Redirecionamento externo inesperado no Trafegus");
      const nextPath = `${target.pathname}${target.search}`.replace(base.pathname.replace(/\/$/, ""), "");
      return this.request(nextPath || "/", { method: "GET" }, redirects - 1);
    }
    return response;
  }

  async login() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.performLogin();
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  async performLogin() {
    const config = trafegusConfig();
    if (!config.user || !config.password) {
      throw new Error("Credenciais do Trafegus não configuradas");
    }
    await this.request("/login");
    const response = await this.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        login: config.user,
        senha: config.password,
        submit: "ACESSAR",
        token_recapcha: "",
        propriedadesTela: "",
      }),
    });
    const html = await response.text();
    if (!response.ok || html.includes(LOGIN_FORM_MARKER)) throw new Error("Login recusado pelo Trafegus");
  }

  async dataTable(pathname, { length = 50, search = "", orderColumn = 1, flags, retry = true } = {}) {
    const body = new URLSearchParams({
      draw: "1",
      start: "0",
      length: String(length),
      "search[value]": search,
      "search[regex]": "false",
      "order[0][column]": String(orderColumn),
      "order[0][dir]": "desc",
    });
    if (flags && Object.keys(flags).length) body.set("flags", JSON.stringify(flags));
    const response = await this.request(pathname, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    if ((response.status === 401 || response.status === 403 || text.includes(LOGIN_FORM_MARKER)) && retry) {
      await this.login();
      return this.dataTable(pathname, { length, search, orderColumn, flags, retry: false });
    }
    if (!response.ok) throw new Error(`Trafegus ${pathname}: HTTP ${response.status}`);
    const payload = JSON.parse(text);
    return {
      rows: Array.isArray(payload.data) ? payload.data : [],
      total: Number(payload.recordsFiltered ?? payload.recordsTotal ?? payload.data?.length ?? 0),
    };
  }
}

const session = new TrafegusSession();
let cache = null;
let rawSmsById = new Map();

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value) {
  let phone = digits(value);
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  return phone.length >= 12 ? phone : "";
}

function normalizeSm(row) {
  return {
    id: row.id,
    placa: row.veiculoPlaca || "",
    carreta: [row.carretaPlaca, row.carretaPlaca2].filter(Boolean).join(" / "),
    motorista: row.nomeMotorista || "",
    origem: row.referenciaOrigemDescricao || "",
    destino: row.referenciaDestinoDescricao || "",
    rotaId: row.rota_identificador || "",
    linkRota: row.link_rota || "",
    status: row.statusViagem || "",
    statusCodigo: row.statusViagemCodigo,
    operacao: row.tipoOperacaoDescricao || "",
    transportador: row.transportadorNome || "",
    embarcador: row.embarcadorNome || "",
    previsaoInicio: row.dataPrevisaoInicio || "",
    previsaoFim: row.dataPrevisaoFim || "",
    inicio: row.dataInicio || "",
    fim: row.dataFim || "",
    manifesto: row.numManifesto || "",
    usuarioAlterou: row.usuarioAlterou || "",
  };
}

function normalizeChange(row) {
  return {
    viagemId: row.viag_codigo,
    placa: row.veic_placa || "",
    frota: row.veic_frota || "",
    transportador: row.pess_nome_transportador || row.transportador || "",
    embarcador: row.pjur_razao_embarcador || row.embarcador || "",
    gestor: row.pess_nome_gestor || row.gestor || "",
    rotaId: row.rota_codigo,
    rota: row.rota_descricao || "",
    origem: row.rpon_origem_descricao || "",
    destino: row.rpon_destino_descricao || "",
    inicio: row.viag_data_inicio || "",
    fim: row.viag_data_fim || "",
    alteradoEm: row.vrot_data_cadastro || "",
    operacao: row.vrot_operacao || "",
    usuarioAdicionou: row.vrot_usuario_adicionou || "",
    usuarioAlterou: row.vrot_usuario_alterou || "",
  };
}

export async function getTrafegusDashboard({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) return cache.payload;
  const startedAt = Date.now();
  const [smsPage, changesPage] = await Promise.all([
    session.dataTable("/solicitacaomonitoramento/getjsondata", {
      length: 100,
      orderColumn: 1,
      flags: { status: ["1"] },
    }),
    session.dataTable("/relatorioalteracaorotasviagem/getjsondata", {
      length: 50,
      orderColumn: 0,
    }),
  ]);
  rawSmsById = new Map(smsPage.rows.map((row) => [String(row.id), row]));
  const sms = smsPage.rows.map(normalizeSm).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  const alteracoes = changesPage.rows.map(normalizeChange);
  const payload = {
    ok: true,
    atualizadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - startedAt,
    resumo: {
      totalSms: smsPage.total,
      exibindoSms: sms.length,
      totalAlteracoes: changesPage.total,
      exibindoAlteracoes: alteracoes.length,
      comLinkRota: sms.filter((row) => row.linkRota).length,
      semLinkRota: sms.filter((row) => !row.linkRota).length,
      emAndamento: sms.filter((row) => /andamento|iniciad|viagem/i.test(row.status)).length,
    },
    sms,
    alteracoes,
  };
  cache = { cachedAt: Date.now(), payload };
  return payload;
}

async function resolveDriverPhone(sm) {
  const cpf = digits(sm?.cpfMotorista);
  const plate = String(sm?.veiculoPlaca || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const { rows } = await clientPool.query(`
    SELECT
      mot.nomemot AS motorista,
      CONCAT_WS('', NULLIF(mot.dddcelularmot::text, ''), NULLIF(mot.celularmot::text, '')) AS celular,
      CONCAT_WS('', NULLIF(mot.dddmot::text, ''), NULLIF(mot.telefone1mot::text, '')) AS telefone
    FROM frotas.motoristas mot
    LEFT JOIN frotas.veiculos vei
      ON vei.empresavei = mot.empresamot
     AND vei.motoristavei = mot.codigomot
    WHERE
      ($1 <> '' AND regexp_replace(COALESCE(mot.cpfmot::text, ''), '[^0-9]', '', 'g') = $1)
      OR
      ($2 <> '' AND regexp_replace(UPPER(COALESCE(vei.placavei::text, '')), '[^A-Z0-9]', '', 'g') = $2)
    ORDER BY
      CASE WHEN $1 <> '' AND regexp_replace(COALESCE(mot.cpfmot::text, ''), '[^0-9]', '', 'g') = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `, [cpf, plate]);
  const row = rows[0];
  return {
    motorista: row?.motorista || sm?.nomeMotorista || "",
    telefone: normalizePhone(row?.celular || row?.telefone),
  };
}

function coordinate(local) {
  const latitude = Number(local?.latitude);
  const longitude = Number(local?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude},${longitude}` : "";
}

export async function getTrafegusGoogleRoute(smId) {
  const id = String(smId || "").replace(/\D/g, "");
  if (!id) throw new Error("SM inválida");
  if (!rawSmsById.has(id)) await getTrafegusDashboard({ force: true });
  const rawSm = rawSmsById.get(id);
  if (!rawSm) throw new Error("SM em viagem não encontrada");

  const response = await fetch(`https://elite.trafegus.com.br:2083/api/proxy-api/guia-viagem?cod_viagem=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Guia de Viagem: HTTP ${response.status}`);
  const payload = await response.json();
  const guide = payload?.data;
  const allLocations = Array.isArray(guide?.locais_viagem) ? guide.locais_viagem : [];
  const locations = allLocations
    .filter((local) => ["ORIGEM", "ENTREGA", "DESTINO"].includes(String(local.tipo_local || "").toUpperCase()))
    .map((local, index) => ({
      ordem: index + 1,
      tipo: String(local.tipo_local || "").toUpperCase(),
      descricao: local.descricao || "",
      latitude: Number(local.latitude),
      longitude: Number(local.longitude),
      previsao: local.previsao_chegada || "",
    }))
    .filter((local) => Number.isFinite(local.latitude) && Number.isFinite(local.longitude));

  if (locations.length < 2) throw new Error("O Guia de Viagem não possui origem e destino suficientes");
  const origin = locations.find((local) => local.tipo === "ORIGEM") || locations[0];
  const destination = [...locations].reverse().find((local) => local.tipo === "DESTINO") || locations.at(-1);
  const deliveries = locations.filter((local) => local.tipo === "ENTREGA" && local !== origin && local !== destination);
  const params = new URLSearchParams({
    api: "1",
    origin: coordinate(origin),
    destination: coordinate(destination),
    travelmode: "driving",
    dir_action: "navigate",
  });
  if (deliveries.length) params.set("waypoints", deliveries.map(coordinate).join("|"));
  const googleMapsUrl = `https://www.google.com/maps/dir/?${params.toString()}`;
  const officialUrl = rawSm.link_rota || "";
  const officialPolyline = parseOfficialPolyline(guide?.informacoes_rota?.polyline);
  const instructions = String(guide?.informacoes_rota?.instrucao || "")
    .split("|")
    .map((instruction) => instruction.replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  const contact = await resolveDriverPhone(rawSm);
  const deliveryLines = deliveries.map((local, index) => `${index + 1}. ${local.descricao}`).join("\n");
  const message = [
    `Olá, ${contact.motorista || rawSm.nomeMotorista || "motorista"}.`,
    "",
    `Rota da viagem/SM ${id} — veículo ${rawSm.veiculoPlaca || "não informado"}.`,
    `Origem: ${origin.descricao}`,
    deliveryLines ? `Entregas:\n${deliveryLines}` : "",
    `Destino: ${destination.descricao}`,
    "",
    "Abra e siga somente a rota oficial do Elite:",
    officialUrl,
    "",
    "Não utilize uma rota recalculada pelo Google Maps ou Waze. Qualquer desvio pode bloquear o veículo.",
  ].filter(Boolean).join("\n");

  return {
    sm: Number(id),
    placa: rawSm.veiculoPlaca || guide?.informacoes_veiculo?.placa || "",
    motorista: contact.motorista,
    telefoneEncontrado: Boolean(contact.telefone),
    telefoneFinal: contact.telefone ? contact.telefone.slice(-4) : "",
    origem: origin,
    entregas: deliveries,
    destino: destination,
    locais: locations,
    rotaOficial: {
      url: officialUrl,
      descricao: guide?.informacoes_rota?.descricao || "",
      distanciaKm: Number(guide?.informacoes_rota?.distancia) || null,
      polyline: officialPolyline,
      instrucoes: instructions,
    },
    googleMapsUrl,
    whatsappUrl: `https://wa.me/${contact.telefone || ""}?text=${encodeURIComponent(message)}`,
    mensagem: message,
  };
}
