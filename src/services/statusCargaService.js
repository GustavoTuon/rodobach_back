import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { quoteIdent } from "../config.js";
import { getTrafegusDashboard } from "./trafegusService.js";

const PLACAS_STATUS_CARGA = [
  "RAA8G18",
  "RAA8G58",
  "RXO6C18",
  "RXW7J14",
  "RYI6H21",
  "RYP7D29",
  "RYU2G97",
  "SXR8D09",
  "SXY5D26",
];

const DEFAULT_UNLOAD_GRACE_HOURS = 2;

function unloadGraceHours() {
  const value = Number(process.env.STATUS_CARGA_DESCARGA_HORAS || DEFAULT_UNLOAD_GRACE_HOURS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_UNLOAD_GRACE_HOURS;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateTimeISO(date, time) {
  if (!date) return null;
  const d = dateOnly(date);
  const t = time ? String(time).slice(0, 8) : "00:00:00";
  return `${d}T${t}`;
}

function normalizePlate(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function locationLabel(city, uf) {
  return [city, String(uf || "").trim().toUpperCase()].filter(Boolean).join("/");
}

function sameLocationCity(cityA, ufA, labelB = "") {
  const [cityB, ufB] = String(labelB || "").split("/");
  return Boolean(cityA && cityB)
    && normalizeText(cityA) === normalizeText(cityB)
    && normalizeText(ufA) === normalizeText(ufB);
}

function isPastOrNow(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date <= new Date();
}

function daysBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return (da.getTime() - db.getTime()) / 86400000;
}

function hoursBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return (da.getTime() - db.getTime()) / 3600000;
}

function hoursSince(value) {
  if (!value) return Infinity;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 3600000;
}

function buildSummary(rows) {
  const summary = {
    total: rows.length,
    carregado: 0,
    vazioConfirmado: 0,
    vazioProvavel: 0,
    semOperacao: 0,
    indefinido: 0,
    pesoEmAbertoKg: 0,
  };

  for (const row of rows) {
    if (row.estado === "carregado_confirmado") summary.carregado += 1;
    else if (row.estado === "vazio_confirmado") summary.vazioConfirmado += 1;
    else if (row.estado === "vazio_provavel") summary.vazioProvavel += 1;
    else if (row.estado === "vazio_sem_operacao") summary.semOperacao += 1;
    else summary.indefinido += 1;

    if (row.estado === "carregado_confirmado") {
      summary.pesoEmAbertoKg += num(row.pesoKg);
    }
  }

  summary.pesoEmAbertoKg = money(summary.pesoEmAbertoKg);
  return summary;
}

async function getLatestLocations(plates = []) {
  const list = [...new Set(plates.map(normalizePlate).filter(Boolean))];
  if (!list.length) return new Map();

  const pool = getVeiculosPool();
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const { rows } = await pool.query(`
    WITH veiculos_alvo AS (
      SELECT v.veiculo_id, UPPER(TRIM(v.placa)) AS placa
      FROM ${schema}.veiculos v
      WHERE regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
    ), posicao AS (
      SELECT DISTINCT ON (m.veiculo_id)
        m.veiculo_id, m.data_hora, m.latitude, m.longitude, m.municipio,
        m.uf, m.rodovia, m.rua, m.velocidade, m.odometro
      FROM ${schema}.mensagens_cb m
      JOIN veiculos_alvo va ON va.veiculo_id = m.veiculo_id
      WHERE m.latitude IS NOT NULL OR m.longitude IS NOT NULL OR NULLIF(TRIM(m.municipio), '') IS NOT NULL
      ORDER BY m.veiculo_id, m.data_hora DESC
    ), movimento AS (
      SELECT m.veiculo_id, MAX(m.data_hora) AS ultima_movimentacao_at
      FROM ${schema}.mensagens_cb m
      JOIN veiculos_alvo va ON va.veiculo_id = m.veiculo_id
      WHERE COALESCE(m.velocidade, 0) >= 5
      GROUP BY m.veiculo_id
    )
    SELECT va.placa, p.data_hora, p.latitude, p.longitude, p.municipio,
      p.uf, p.rodovia, p.rua, p.velocidade, p.odometro, movimento.ultima_movimentacao_at
    FROM veiculos_alvo va
    JOIN posicao p ON p.veiculo_id = va.veiculo_id
    LEFT JOIN movimento ON movimento.veiculo_id = va.veiculo_id
    ORDER BY va.placa
  `, [list]);

  return new Map(rows.map((row) => {
    const cidadeUf = locationLabel(row.municipio, row.uf);
    const endereco = [row.rodovia, row.rua].map((value) => String(value || "").trim()).filter(Boolean).join(" - ");
    return [normalizePlate(row.placa), {
      dataHora: row.data_hora || null,
      ultimaMovimentacaoAt: row.ultima_movimentacao_at || null,
      latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
      municipio: row.municipio || "",
      uf: row.uf || "",
      cidadeUf,
      endereco,
      velocidade: row.velocidade === null || row.velocidade === undefined ? null : Number(row.velocidade),
      odometro: row.odometro === null || row.odometro === undefined ? null : Number(row.odometro),
      mapsUrl: row.latitude !== null && row.latitude !== undefined && row.longitude !== null && row.longitude !== undefined
        ? `https://www.google.com/maps?q=${row.latitude},${row.longitude}`
        : "",
    }];
  }));
}

function classifyVehicle(vehicle, docs = [], thirdPartyFreights = [], trafegusSm = null) {
  const activeDocs = docs
    .filter((doc) =>
      !["CANCELADO", "INUTILIZADO", "ANULADO"].includes(doc.statusConhecimento)
      && num(doc.pesoKg) > 0
      && hoursSince(doc.emissaoAt) <= 21 * 24
    )
    .sort((a, b) => String(b.saidaAt || b.emissaoAt || "").localeCompare(String(a.saidaAt || a.emissaoAt || "")));
  const lastDoc = [...docs].sort((a, b) => String(b.eventoReferenciaAt || "").localeCompare(String(a.eventoReferenciaAt || "")))[0];
  const active = activeDocs[0];
  const loc = vehicle.localizacao || {};
  const currentSpeed = Number(loc.velocidade || 0);
  const ignoredThirdPartyFreight = [...thirdPartyFreights]
    .filter((freight) => freight.pefResiduo)
    .sort((a, b) => String(b.emissaoAt || "").localeCompare(String(a.emissaoAt || "")))[0];
  const activeThirdPartyFreight = [...thirdPartyFreights]
    .filter((freight) =>
      !freight.pefResiduo
      && !["CANCELADO", "ENCERRADO", "INUTILIZADO"].includes(freight.statusConhecimento)
    )
    .sort((a, b) => String(b.emissaoAt || "").localeCompare(String(a.emissaoAt || "")))[0];

  const deliveredActiveDocs = activeDocs.filter((doc) => doc.entregaAt && isPastOrNow(doc.entregaAt));
  const pendingActiveDocs = activeDocs.filter((doc) => !doc.entregaAt || !isPastOrNow(doc.entregaAt));
  const activeDelivered = deliveredActiveDocs.length > 0;
  const activeDeliveredRecently = deliveredActiveDocs.some((doc) => hoursSince(doc.entregaAt) <= 24);
  const stillAtDeliveredDestination = deliveredActiveDocs.some((doc) => sameLocationCity(loc.municipio, loc.uf, doc.destino));

  if (activeThirdPartyFreight && (!active || (activeDelivered && !activeDeliveredRecently && !stillAtDeliveredDestination))) {
    return {
      ...vehicle,
      ...activeThirdPartyFreight,
      estado: "carregado_confirmado",
      estadoLabel: "Carregado",
      confianca: active ? "alta" : "media",
      evidencia: active
        ? "Ultimo CT-e ja possui entrega registrada, mas ha PEF/e-Frete ativo para esta placa; indica nova operacao de terceiro sem CT-e emitido."
        : "PEF/e-Frete ativo para esta placa; indica operacao de terceiro mesmo sem CT-e emitido.",
      statusFonte: "pef_terceiro",
    };
  }

  if (active) {
    const atOrigem = sameLocationCity(loc.municipio, loc.uf, active.origem);
    const atDestino = pendingActiveDocs.length > 0
      && pendingActiveDocs.every((doc) => sameLocationCity(loc.municipio, loc.uf, doc.destino));
    const justEmitted = hoursSince(active.emissaoAt) <= 24;
    const descargaHoras = unloadGraceHours();
    const chegadaDestinoAt = atDestino ? (active.chegadaViagemAt || active.entregaViagemAt) : null;
    // Em viagens com múltiplas entregas, chegar a um dos destinos não encerra a
    // operação enquanto a SM permanecer ativa no Trafegus.
    const descargaExpirada = !trafegusSm && atDestino && chegadaDestinoAt && hoursSince(chegadaDestinoAt) >= descargaHoras;
    const entregaRegistrada = active.entregaAt && isPastOrNow(active.entregaAt);

    if (entregaRegistrada) {
      if (trafegusSm) {
        return {
          ...vehicle,
          ...active,
          trafegusSm,
          trafegusDivergente: true,
          estado: "carregado_confirmado",
          estadoLabel: "Carregado",
          confianca: "media",
          evidencia: `SM ${trafegusSm.id} em viagem no Trafegus, mas o CT-e possui entrega registrada; conferir encerramento da SM ou nova operacao.`,
          statusFonte: "trafegus",
        };
      }
      return {
        ...vehicle,
        ...active,
        estado: "vazio_confirmado",
        estadoLabel: "Vazio",
        confianca: "alta",
        evidencia: ignoredThirdPartyFreight
          ? `CT-e possui entrega real registrada; PEF ${ignoredThirdPartyFreight.documento} ignorado porque a carta frete esta cancelada e todos os CT-es vinculados foram entregues.`
          : "CT-e possui entrega real registrada; veiculo tratado como vazio.",
        statusFonte: "automatico",
      };
    }

    if (descargaExpirada) {
      return {
        ...vehicle,
        ...active,
        estado: "vazio_provavel",
        estadoLabel: "Vazio",
        confianca: "media",
        evidencia: `Veiculo chegou ao destino ha ${descargaHoras}h ou mais; tempo de descarga expirado sem baixa no CT-e.`,
        statusFonte: "automatico",
      };
    }

    return {
      ...vehicle,
      ...active,
      trafegusSm,
      estado: "carregado_confirmado",
      estadoLabel: "Carregado",
      confianca: trafegusSm || atOrigem || atDestino || justEmitted ? "alta" : "media",
      evidencia: trafegusSm
        ? `CT-e ativo sem entrega e SM ${trafegusSm.id} em viagem no Trafegus; operacao confirmada pelas duas fontes.`
        : atDestino
        ? `CT-e recente com veiculo na cidade de destino/entrega; aguardando ate ${descargaHoras}h para descarga.`
        : atOrigem
          ? "CT-e recente com veiculo na cidade de coleta/origem."
          : justEmitted
            ? "CT-e emitido nas ultimas 24 horas."
            : currentSpeed > 5
              ? "CT-e recente sem entrega registrada; veiculo em deslocamento."
              : "CT-e recente sem entrega registrada.",
      statusFonte: "automatico",
    };
  }

  if (activeThirdPartyFreight) {
    return {
      ...vehicle,
      ...activeThirdPartyFreight,
      estado: "carregado_confirmado",
      estadoLabel: "Carregado",
      confianca: "media",
      evidencia: "PEF/e-Frete ativo para esta placa; indica operacao de terceiro mesmo sem CT-e emitido.",
      statusFonte: "pef_terceiro",
    };
  }

  if (trafegusSm) {
    return {
      ...vehicle,
      trafegusSm,
      estado: "carregado_confirmado",
      estadoLabel: "Carregado",
      confianca: "media",
      evidencia: `SM ${trafegusSm.id} em viagem no Trafegus para ${trafegusSm.destino || "destino nao informado"}; ainda sem CT-e ativo confiavel no cruzamento.`,
      statusFonte: "trafegus",
      documento: "",
      cliente: trafegusSm.embarcador || "",
      origem: trafegusSm.origem || "",
      destino: trafegusSm.destino || "",
      pesoKg: 0,
      emissaoAt: trafegusSm.inicio || trafegusSm.previsaoInicio || null,
      saidaAt: trafegusSm.inicio || trafegusSm.previsaoInicio || null,
      entregaAt: null,
      chegadaViagemAt: null,
      eventoReferenciaAt: trafegusSm.inicio || trafegusSm.previsaoInicio || null,
    };
  }

  if (lastDoc?.entregaAt && isPastOrNow(lastDoc.entregaAt)) {
    return {
      ...vehicle,
      ...lastDoc,
      estado: "vazio_confirmado",
      estadoLabel: "Vazio",
      confianca: "media",
      evidencia: ignoredThirdPartyFreight
        ? `Sem CT-e ativo; PEF ${ignoredThirdPartyFreight.documento} ignorado porque a carta frete esta cancelada e todos os CT-es vinculados foram entregues.`
        : "Sem CT-e ativo pela regra atual; ultimo CT-e possui data de entrega/passagem vencida.",
      statusFonte: "automatico",
    };
  }

  if (lastDoc) {
    return {
      ...vehicle,
      ...lastDoc,
      estado: "vazio_confirmado",
      estadoLabel: "Vazio",
      confianca: "baixa",
      evidencia: "Ha documento recente, mas sem evidencia suficiente de carga ativa.",
      statusFonte: "automatico",
    };
  }

  return {
    ...vehicle,
    estado: "vazio_sem_operacao",
    estadoLabel: "Vazio",
    confianca: "media",
    evidencia: "Veiculo da frota sem CT-e/carga ativa no periodo consultado.",
    statusFonte: "automatico",
    documento: "",
    cliente: "",
    origem: "",
    destino: "",
    pesoKg: 0,
    emissaoAt: null,
    saidaAt: null,
    entregaAt: null,
    chegadaViagemAt: null,
    eventoReferenciaAt: null,
  };
}

function buildDivergenceAlert(row) {
  const loc = row.localizacao || {};
  const speed = Number(loc.velocidade || 0);
  const atDestination = sameLocationCity(loc.municipio, loc.uf, row.destino);
  const atOrigin = sameLocationCity(loc.municipio, loc.uf, row.origem);
  const evidence = normalizeText(row.evidencia || "");

  if (row.trafegusDivergente) {
    return {
      nivel: "alto",
      label: "SM x CT-e",
      descricao: "Trafegus informa SM em viagem, mas o CT-e relacionado possui entrega registrada.",
    };
  }

  if (row.statusFonte === "pef_terceiro" && normalizeText(row.cartaFreteStatus) === "CANCELADA") {
    return {
      nivel: "alto",
      label: "PEF x carta",
      descricao: "PEF ativo com carta frete cancelada; validar se e nova operacao ou residuo do ERP.",
    };
  }

  if (row.estado === "carregado_confirmado" && row.entregaAt && isPastOrNow(row.entregaAt)) {
    return {
      nivel: "alto",
      label: "Entregue x carregado",
      descricao: "Documento possui entrega registrada, mas a linha ainda foi classificada como carregada.",
    };
  }

  if (row.estado === "carregado_confirmado" && atDestination && !row.entregaAt) {
    return {
      nivel: "medio",
      label: "Destino sem baixa",
      descricao: "Telemetria esta na cidade de destino, mas o documento ainda nao registrou entrega.",
    };
  }

  if (evidence.includes("PEF") && evidence.includes("IGNORADO")) {
    return {
      nivel: "medio",
      label: "PEF residual",
      descricao: "Existe PEF aberto ignorado pela regra de carta cancelada e CT-es entregues.",
    };
  }

  if (row.estado === "vazio_confirmado" && speed >= 25 && !atOrigin && !atDestination) {
    return {
      nivel: "baixo",
      label: "Vazio em deslocamento",
      descricao: "Sistema marcou vazio, mas a placa esta em movimento fora da base/origem/destino; pode estar indo carregar.",
    };
  }

  return null;
}

function buildOperationalSituation(row) {
  if (row.alertaDivergencia && ["alto", "medio"].includes(row.alertaDivergencia.nivel)) {
    return {
      tipo: "divergente",
      label: "Divergente",
      descricao: "Documento, telemetria ou ERP apontam sinais conflitantes; precisa de conferencia operacional.",
    };
  }

  if (row.statusFonte === "pef_terceiro") {
    return {
      tipo: "indicio_operacional",
      label: "Indicio operacional",
      descricao: "Localizacao ou informacao operacional sugere viagem, mas ainda nao existe CT-e ativo confiavel.",
    };
  }

  if (row.estado === "carregado_confirmado") {
    return {
      tipo: "carregado",
      label: "Carregado",
      descricao: "Documento confiavel ativo sem entrega registrada.",
    };
  }

  if (["vazio_confirmado", "vazio_provavel", "vazio_sem_operacao"].includes(row.estado)) {
    return {
      tipo: "vazio",
      label: "Vazio",
      descricao: "CT-e entregue ou ausencia de operacao ativa.",
    };
  }

  return {
    tipo: "divergente",
    label: "Divergente",
    descricao: "Situacao sem regra conclusiva; precisa de conferencia operacional.",
  };
}

function buildSituationSummary(rows) {
  const summary = { carregado: 0, vazio: 0, indicioOperacional: 0, divergente: 0 };
  for (const row of rows) {
    if (row.situacaoOperacional?.tipo === "carregado") summary.carregado += 1;
    else if (row.situacaoOperacional?.tipo === "vazio") summary.vazio += 1;
    else if (row.situacaoOperacional?.tipo === "indicio_operacional") summary.indicioOperacional += 1;
    else if (row.situacaoOperacional?.tipo === "divergente") summary.divergente += 1;
  }
  return summary;
}

export async function getStatusCargaFrota(filters = {}) {
  const startDate = dateOnly(filters.startDate || filters.dataInicio) || daysAgoISO(Number(filters.dias || 90));
  const placa = normalizePlate(filters.placa);
  const search = String(filters.search || "").trim().toLowerCase();
  const estadoFiltro = String(filters.estado || "todos");
  const limit = Math.min(Number(filters.limit || 500), 1000);
  const targetPlates = placa
    ? PLACAS_STATUS_CARGA.filter((item) => item === placa)
    : PLACAS_STATUS_CARGA;

  const vehicleParams = [targetPlates];
  const vehicleWhere = ["COALESCE(v.situacaovei::text, '') <> 'I'", "v.tipopropriedadevei::text = 'P'"];
  vehicleWhere.push(`regexp_replace(upper(v.placavei::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])`);

  const trafegusDashboard = await getTrafegusDashboard().catch((error) => ({
    sms: [],
    indisponivel: true,
    erro: error?.message || "Trafegus indisponivel",
  }));

  const [vehicleResult, docsResult, pefResult, locations] = await Promise.all([
    clientPool.query(`
      SELECT DISTINCT ON (UPPER(TRIM(v.placavei::text)))
        UPPER(TRIM(v.placavei::text)) AS placa,
        v.nomevei AS veiculo,
        COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado') AS modelo,
        v.anomodelovei AS ano_modelo,
        v.kmatualvei AS km_atual,
        v.capacidadepesonormalvei AS capacidade_kg,
        motoristas.nomemot AS motorista,
        c.nomeccs AS centro_custo
      FROM frotas.veiculos v
      LEFT JOIN frotas.motoristas motoristas
        ON motoristas.empresamot = v.empresavei
       AND motoristas.codigomot = v.motoristavei
      LEFT JOIN financeiro.centroscustos c
        ON c.codigoccs = v.centrocustovei
       AND (c.empresaccs = v.empresavei OR c.empresaccs IS NULL)
      WHERE ${vehicleWhere.join(" AND ")}
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY UPPER(TRIM(v.placavei::text)), v.empresavei
      LIMIT ${limit}
    `, vehicleParams),
    clientPool.query(`
      SELECT
        UPPER(TRIM(con.veiculocon::text)) AS placa,
        con.empresacon,
        con.seriecon,
        con.codigocon,
        con.numeroctecon,
        con.chavectecon,
        con.dataemissaocon,
        con.horaemissaocon,
        con.datahoracon,
        con.pesocon,
        con.statuscon,
        sco.nomesco AS status_conhecimento,
        con.viagemcon,
        con.cargacon,
        con.cargacontroleviagemcon,
        con.numeroviagemcon,
        con.datahoraentregacon,
        con.dataentregacon,
        origem.nomecid AS origem_cidade,
        origem_uf.abreviaturaest AS origem_uf,
        destino.nomecid AS destino_cidade,
        destino_uf.abreviaturaest AS destino_uf,
        COALESCE(NULLIF(cliente.fantasiacli, ''), NULLIF(cliente.nomecli, ''), con.clientecon::text) AS cliente,
        cv.datasaidacvg,
        cv.horasaidacvg,
        cv.datachegadacvg,
        cv.horachegadacvg,
        cv.statuscvg,
        vi.datavia,
        vi.horasaidavia,
        vi.dataentregavia,
        vi.horaretornovia,
        vi.statusvia
      FROM logistica.conhecimentos con
      LEFT JOIN logistica.statusconhecimento sco ON sco.codigosco = con.statuscon
      LEFT JOIN localidades.cidades origem ON origem.codigocid = con.cidadecoletacon
      LEFT JOIN localidades.estados origem_uf ON origem_uf.codigoest = origem.estadocid
      LEFT JOIN localidades.cidades destino ON destino.codigocid = con.cidadeentregacon
      LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest = destino.estadocid
      LEFT JOIN gerais.clientes cliente ON cliente.codigocli = con.clientecon
      LEFT JOIN LATERAL (
        SELECT cv.*
        FROM logistica.controleviagens cv
        WHERE cv.codigocvg IN (con.viagemcon, con.cargacontroleviagemcon, con.numeroviagemcon)
          AND (cv.empresacvg = con.empresaviagemcon OR cv.empresacvg = con.empresacon OR con.empresaviagemcon IS NULL)
        ORDER BY (cv.codigocvg = con.viagemcon) DESC, cv.codigocvg DESC
        LIMIT 1
      ) cv ON true
      LEFT JOIN LATERAL (
        SELECT vi.*
        FROM logistica.viagens vi
        WHERE vi.codigovia IN (con.viagemcon, con.numeroviagemcon)
          AND (vi.empresavia = con.empresaviagemcon OR vi.empresavia = con.empresacon OR con.empresaviagemcon IS NULL)
        ORDER BY (vi.codigovia = con.viagemcon) DESC, vi.codigovia DESC
        LIMIT 1
      ) vi ON true
      WHERE NULLIF(TRIM(con.veiculocon::text), '') IS NOT NULL
        AND con.dataemissaocon >= $1::date
        AND ($2::text = '' OR UPPER(TRIM(con.veiculocon::text)) = $2::text)
      ORDER BY con.dataemissaocon DESC, con.codigocon DESC
      LIMIT 5000
    `, [startDate, placa]),
    clientPool.query(`
      SELECT
        UPPER(TRIM(pfv.veiculopfv::text)) AS placa,
        pfv.empresapfv,
        pfv.seriepfv,
        pfv.codigopfv,
        p.datainiciopfr,
        p.dataterminopfr,
        p.datahoraemissaopfr,
        p.datahoraencerramentopfr,
        p.valorfretepfr,
        p.valorestimadopfr,
        p.statuspfr,
        sp.descricaospf AS status_pef,
        p.numerociotpfr,
        p.codigocartafretepfr,
        p.codigocontratofretepfr,
        p.codigofichafretepfr,
        p.origempedagiopfr,
        p.destinopedagiopfr,
        p.pesoentregapfr,
        cfr.motoristacfr,
        mot.nomemot AS motorista_carta,
        cfr.statuscfr AS status_carta_frete,
        scfr.nomescf AS status_carta_frete_nome,
        cfr.pesocfr AS peso_carta_frete,
        cfr.motivocancelamentocfr AS motivo_cancelamento_carta,
        cfr.observacaocfr AS observacao_carta,
        rota_carta.origens AS rota_carta_origens,
        rota_carta.destinos AS rota_carta_destinos,
        rota_carta.documentos AS rota_carta_documentos,
        rota_carta.documentos_entregues AS rota_carta_documentos_entregues,
        rota_carta.peso_total AS rota_carta_peso_total
      FROM logistica.peffreteveiculos pfv
      JOIN logistica.peffrete p
        ON p.empresapfr = pfv.empresapfv
       AND p.codigopfr = pfv.codigopfv
       AND (p.seriepfr = pfv.seriepfv OR p.seriepfr IS NULL OR pfv.seriepfv IS NULL)
      LEFT JOIN logistica.statuspeffretes sp ON sp.codigospf = p.statuspfr
      LEFT JOIN logistica.cartasfretes cfr
        ON cfr.empresacfr = p.empresapfr
       AND cfr.codigocfr = p.codigocartafretepfr
       AND (cfr.seriecfr = p.seriecartafretepfr OR p.seriecartafretepfr IS NULL OR cfr.seriecfr IS NULL)
      LEFT JOIN logistica.statuscartasfretes scfr ON scfr.codigoscf = cfr.statuscfr
      LEFT JOIN frotas.motoristas mot ON mot.codigomot = cfr.motoristacfr
      LEFT JOIN LATERAL (
        SELECT
          string_agg(DISTINCT locationLabel.nome_origem, ', ' ORDER BY locationLabel.nome_origem) AS origens,
          string_agg(DISTINCT locationLabel.nome_destino, ', ' ORDER BY locationLabel.nome_destino) AS destinos,
          COUNT(*)::int AS documentos,
          COUNT(*) FILTER (WHERE con.datahoraentregacon IS NOT NULL OR con.dataentregacon IS NOT NULL)::int AS documentos_entregues,
          SUM(COALESCE(con.pesocon, 0)) AS peso_total
        FROM logistica.cartasfretesconhecimentos cfc
        LEFT JOIN logistica.conhecimentos con
          ON con.empresacon = cfc.empresaconhecimentocfc
         AND con.seriecon = cfc.serieconhecimentocfc
         AND con.codigocon = cfc.conhecimentocfc
        LEFT JOIN localidades.cidades origem ON origem.codigocid = con.cidadecoletacon
        LEFT JOIN localidades.estados origem_uf ON origem_uf.codigoest = origem.estadocid
        LEFT JOIN localidades.cidades destino ON destino.codigocid = con.cidadeentregacon
        LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest = destino.estadocid
        CROSS JOIN LATERAL (
          SELECT
            CONCAT_WS('/', NULLIF(TRIM(origem.nomecid), ''), NULLIF(TRIM(origem_uf.abreviaturaest), '')) AS nome_origem,
            CONCAT_WS('/', NULLIF(TRIM(destino.nomecid), ''), NULLIF(TRIM(destino_uf.abreviaturaest), '')) AS nome_destino
        ) locationLabel
        WHERE cfr.codigocfr IS NOT NULL
          AND cfc.empresacfc = cfr.empresacfr
          AND cfc.seriecfc = cfr.seriecfr
          AND cfc.codigocfc = cfr.codigocfr
      ) rota_carta ON true
      WHERE regexp_replace(upper(pfv.veiculopfv::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
        AND p.statuspfr IN (1,3,4,7)
        AND p.datahoraencerramentopfr IS NULL
        AND COALESCE(p.dataterminopfr, CURRENT_DATE) >= CURRENT_DATE
        AND (NULLIF($2::text, '') IS NULL OR regexp_replace(upper(pfv.veiculopfv::text), '[^A-Z0-9]', '', 'g') = $2::text)
      ORDER BY COALESCE(p.datahoraemissaopfr, p.datainiciopfr::timestamp) DESC, pfv.codigopfv DESC
      LIMIT 500
    `, [targetPlates, placa]),
    getLatestLocations(targetPlates).catch(() => new Map()),
  ]);

  const trafegusByPlate = new Map(
    (Array.isArray(trafegusDashboard?.sms) ? trafegusDashboard.sms : [])
      .map((sm) => [normalizePlate(sm.placa), sm])
      .filter(([smPlate]) => smPlate)
  );

  const docsByPlate = new Map();
  for (const row of docsResult.rows) {
    const rowPlate = normalizePlate(row.placa);
    if (!rowPlate) continue;

    const emissaoAt = row.datahoracon
      ? (row.datahoracon.toISOString?.() || String(row.datahoracon))
      : dateTimeISO(row.dataemissaocon, row.horaemissaocon);
    const rawSaidaAt = dateTimeISO(row.datasaidacvg || row.datavia || row.dataemissaocon, row.horasaidacvg || row.horasaidavia || row.horaemissaocon);
    const saidaAt = rawSaidaAt && emissaoAt && daysBetween(emissaoAt, rawSaidaAt) > 3
      ? dateTimeISO(row.dataemissaocon, row.horaemissaocon)
      : rawSaidaAt;
    const entregaAt = row.datahoraentregacon
      ? (row.datahoraentregacon.toISOString?.() || String(row.datahoraentregacon))
      : dateTimeISO(row.dataentregacon, null);
    const rawChegadaViagemAt = dateTimeISO(row.datachegadacvg, row.horachegadacvg);
    const rawEntregaViagemAt = dateTimeISO(row.dataentregavia, row.horaretornovia);
    const chegadaViagemAt = rawChegadaViagemAt
      && ((emissaoAt && daysBetween(emissaoAt, rawChegadaViagemAt) > 3)
        || (saidaAt && hoursBetween(rawChegadaViagemAt, saidaAt) < 0.25))
      ? null
      : rawChegadaViagemAt;
    const entregaViagemAt = rawEntregaViagemAt && emissaoAt && daysBetween(emissaoAt, rawEntregaViagemAt) > 3 ? null : rawEntregaViagemAt;
    const eventoReferenciaAt = entregaAt || chegadaViagemAt || entregaViagemAt || saidaAt || emissaoAt;

    const doc = {
      documento: [row.seriecon, row.numeroctecon || row.codigocon].filter(Boolean).join("-"),
      codigoConhecimento: row.codigocon,
      chaveCte: row.chavectecon || "",
      cliente: row.cliente || "",
      origem: locationLabel(row.origem_cidade, row.origem_uf),
      destino: locationLabel(row.destino_cidade, row.destino_uf),
      pesoKg: money(row.pesocon),
      statusConhecimento: row.status_conhecimento || "",
      viagem: row.viagemcon || row.cargacontroleviagemcon || row.numeroviagemcon || null,
      carga: row.cargacon || null,
      emissaoAt,
      saidaAt,
      entregaAt,
      chegadaViagemAt,
      entregaViagemAt,
      eventoReferenciaAt,
    };
    const list = docsByPlate.get(rowPlate) || [];
    list.push(doc);
    docsByPlate.set(rowPlate, list);
  }

  const thirdPartyFreightsByPlate = new Map();
  for (const row of pefResult.rows) {
    const rowPlate = normalizePlate(row.placa);
    if (!rowPlate) continue;
    const emissaoAt = row.datahoraemissaopfr
      ? (row.datahoraemissaopfr.toISOString?.() || String(row.datahoraemissaopfr))
      : dateTimeISO(row.datainiciopfr, null);
    const freight = {
      documento: ["PEF", row.seriepfv, row.codigopfv].filter(Boolean).join("-"),
      codigoConhecimento: row.codigopfv,
      chaveCte: "",
      cliente: "Operacao de terceiro / e-Frete",
      origem: row.origempedagiopfr || row.rota_carta_origens || "",
      destino: row.destinopedagiopfr || row.rota_carta_destinos || "",
      pesoKg: money(row.pesoentregapfr || row.rota_carta_peso_total || row.peso_carta_frete),
      statusConhecimento: row.status_pef || "",
      viagem: null,
      carga: null,
      emissaoAt,
      saidaAt: dateTimeISO(row.datainiciopfr, null),
      entregaAt: row.datahoraencerramentopfr ? (row.datahoraencerramentopfr.toISOString?.() || String(row.datahoraencerramentopfr)) : null,
      chegadaViagemAt: null,
      entregaViagemAt: null,
      eventoReferenciaAt: emissaoAt,
      ciot: row.numerociotpfr || "",
      valorFrete: money(row.valorfretepfr || row.valorestimadopfr),
      cartaFrete: row.codigocartafretepfr || null,
      contratoFrete: row.codigocontratofretepfr || null,
      fichaFrete: row.codigofichafretepfr || null,
      pefInicioAt: dateTimeISO(row.datainiciopfr, null),
      pefFimAt: dateTimeISO(row.dataterminopfr, null),
      pefStatus: row.status_pef || "",
      motoristaFrete: row.motorista_carta || "",
      cartaFreteStatus: row.status_carta_frete_nome || "",
      cartaFreteMotivo: row.motivo_cancelamento_carta || "",
      cartaFretePesoKg: money(row.peso_carta_frete),
      cartaFreteObservacao: row.observacao_carta || "",
      pefDocumentos: num(row.rota_carta_documentos),
      pefDocumentosEntregues: num(row.rota_carta_documentos_entregues),
      pefResiduo: normalizeText(row.status_carta_frete_nome) === "CANCELADA"
        && num(row.rota_carta_documentos) > 0
        && num(row.rota_carta_documentos_entregues) >= num(row.rota_carta_documentos),
    };
    const list = thirdPartyFreightsByPlate.get(rowPlate) || [];
    list.push(freight);
    thirdPartyFreightsByPlate.set(rowPlate, list);
  }

  let rows = vehicleResult.rows.map((vehicle) => {
    const normalized = {
      placa: normalizePlate(vehicle.placa),
      veiculo: vehicle.veiculo || "",
      modelo: vehicle.modelo || "",
      anoModelo: vehicle.ano_modelo || null,
      kmAtual: vehicle.km_atual || null,
      capacidadeKg: money(vehicle.capacidade_kg),
      motorista: vehicle.motorista || "",
      centroCusto: vehicle.centro_custo || "",
      localizacao: locations.get(normalizePlate(vehicle.placa)) || null,
    };
    const classified = classifyVehicle(
      normalized,
      docsByPlate.get(normalized.placa) || [],
      thirdPartyFreightsByPlate.get(normalized.placa) || [],
      trafegusByPlate.get(normalized.placa) || null,
    );
    const alertaDivergencia = buildDivergenceAlert(classified);
    return {
      ...classified,
      alertaDivergencia,
      situacaoOperacional: buildOperationalSituation({ ...classified, alertaDivergencia }),
    };
  });

  if (estadoFiltro !== "todos") {
    rows = rows.filter((row) => row.estado === estadoFiltro || row.situacaoOperacional?.tipo === estadoFiltro);
  }

  if (search) {
    rows = rows.filter((row) => [
      row.placa, row.veiculo, row.modelo, row.motorista, row.cliente, row.origem,
      row.destino, row.documento, row.estadoLabel, row.situacaoOperacional?.label, row.evidencia,
    ].join(" ").toLowerCase().includes(search));
  }

  rows.sort((a, b) => {
    const priority = {
      descarregando: 1,
      entregando: 2,
      carregou_agora: 3,
      carregado_confirmado: 4,
      vazio_provavel: 5,
      indefinido: 6,
      vazio_confirmado: 7,
      vazio_sem_operacao: 8,
    };
    return (priority[a.estado] || 9) - (priority[b.estado] || 9)
      || String(b.eventoReferenciaAt || "").localeCompare(String(a.eventoReferenciaAt || ""))
      || a.placa.localeCompare(b.placa);
  });

  return {
    periodo: { startDate, endDate: dateOnly(new Date()) },
    trafegus: {
      disponivel: !trafegusDashboard?.indisponivel,
      erro: trafegusDashboard?.erro || "",
      smsAtivas: trafegusByPlate.size,
      atualizadoEm: trafegusDashboard?.atualizadoEm || null,
    },
    regra: {
      carregado: "CT-e recente sem entrega real registrada ou PEF/e-Frete ativo sem sinal de residuo.",
      vazioConfirmado: "CT-e com datahoraentregacon/dataentregacon ja vencida.",
      vazioProvavel: `Quando viagem/controle chegou ao destino e passaram ${unloadGraceHours()}h de descarga, mas o CT-e ainda nao registrou entrega.`,
      semOperacao: "Veiculo da frota sem CT-e/carga ativa no periodo.",
      pefResiduo: "PEF aberto e ignorado quando o CT-e vinculado ja foi entregue recentemente ou o veiculo permanece na cidade de destino.",
      situacoes: {
        carregado: "Documento confiavel ativo.",
        vazio: "CT-e entregue ou sem operacao ativa.",
        indicioOperacional: "Localizacao, PEF ou informacao operacional sugere viagem, mas sem CT-e confiavel.",
        divergente: "Documento, telemetria ou ERP trazem sinais conflitantes.",
      },
    },
    summary: { ...buildSummary(rows), situacoes: buildSituationSummary(rows) },
    rows,
    filters: {
      placas: vehicleResult.rows.map((row) => normalizePlate(row.placa)).filter(Boolean).sort(),
      estados: [
        { id: "todos", label: "Todos" },
        { id: "carregado", label: "Carregado" },
        { id: "vazio", label: "Vazio" },
        { id: "indicio_operacional", label: "Indicio operacional" },
        { id: "divergente", label: "Divergente" },
        { id: "carregado_confirmado", label: "Tecnico: carregado" },
        { id: "vazio_confirmado", label: "Tecnico: vazio" },
      ],
    },
  };
}
