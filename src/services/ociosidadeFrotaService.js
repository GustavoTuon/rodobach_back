import { quoteIdent } from "../config.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { getTrafegusSmsHistory } from "./trafegusService.js";
import { getFixedCostsByVehicle } from "./custosVeiculosService.js";

const PLATES = ["RAA8G18", "RAA8G58", "RXO6C18", "RXW7J14", "RYI6H21", "RYP7D29", "RYU2G97", "SXR8D09", "SXY5D26"];
const DAY_MS = 86400000;
const normalizePlate = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const iso = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const trafegusIso = (value) => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return match ? iso(`${match[3]}-${match[2]}-${match[1]}T${match[4] || "00"}:${match[5] || "00"}:${match[6] || "00"}-03:00`) : iso(value);
};

export function buildSmOperationalIntervals(sms, startDate, endDate, now = new Date()) {
  const rangeStart = new Date(`${startDate}T00:00:00-03:00`).toISOString();
  const requestedEnd = new Date(`${endDate}T23:59:59.999-03:00`);
  const rangeEnd = (requestedEnd < now ? requestedEnd : now).toISOString();
  const sorted = sms.map((sm) => ({ ...sm, placa: normalizePlate(sm.placa), inicioIso: trafegusIso(sm.inicio || sm.previsaoInicio), fimIso: trafegusIso(sm.fim) }))
    .filter((sm) => sm.placa && sm.inicioIso).sort((a, b) => a.placa.localeCompare(b.placa) || a.inicioIso.localeCompare(b.inicioIso));
  const loaded = [];
  const confirmedEmpty = [];
  const gaps = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const sm = sorted[index];
    const next = sorted.slice(index + 1).find((item) => item.placa === sm.placa);
    const end = sm.fimIso || (next?.inicioIso ?? rangeEnd);
    const operation = `${sm.operacao || ""} ${sm.tipo || ""}`;
    const isEmpty = sm.carregado === false || sm.carregado === "N" || /\bVAZI[OA]\b|REPOSICIONAMENTO/i.test(operation);
    const target = isEmpty ? confirmedEmpty : loaded;
    const inicio = sm.inicioIso > rangeStart ? sm.inicioIso : rangeStart;
    const fim = end < rangeEnd ? end : rangeEnd;
    if (fim > inicio) target.push({ id: target.length + 1, placa: sm.placa, inicio, fim, smId: sm.id, confirmado: true });
    if (sm.fimIso && next?.inicioIso && next.inicioIso > sm.fimIso) gaps.push({
      id: gaps.length + 1, placa: sm.placa, inicio: sm.fimIso, fim: next.inicioIso,
      entregaAt: sm.fimIso, proximaOperacaoAt: next.inicioIso, documento: `SM ${sm.id}`,
      proximoDocumento: `SM ${next.id}`, destino: sm.destino || "", cliente: sm.embarcador || "",
      entregaPrecisa: true, entregaFonte: "fim_sm_trafegus", classificacao: "vazio_provavel",
    });
  }
  return { loaded, confirmedEmpty, gaps };
}
function mergeIntervals(intervals) {
  const result = [];
  for (const item of [...intervals].sort((a, b) => a.placa.localeCompare(b.placa) || a.inicio.localeCompare(b.inicio))) {
    const last = result.at(-1);
    if (last?.placa === item.placa && new Date(item.inicio) <= new Date(last.fim)) {
      if (item.fim > last.fim) last.fim = item.fim;
    } else result.push({ ...item, id: result.length + 1 });
  }
  return result;
}

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nationalHolidays(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4)), endYear = Number(endDate.slice(0, 4));
  const result = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const day of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]) result.push(`${year}-${day}`);
    const easter = easterSunday(year); easter.setUTCDate(easter.getUTCDate() - 2); result.push(easter.toISOString().slice(0, 10));
  }
  return result.filter((day) => day >= startDate && day <= endDate);
}

async function loadBaseGeofence() {
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const pool = getVeiculosPool();
  const { rows } = await pool.query(`SELECT name, shape_type, polygon_points FROM ${schema}.geofences WHERE enabled IS TRUE AND type = 'base' AND exclude_from_daily IS TRUE ORDER BY id LIMIT 1`);
  const base = rows[0];
  if (!base || base.shape_type !== "polygon" || !Array.isArray(base.polygon_points) || base.polygon_points.length < 3) return null;
  return { name: base.name, polygon: `((${base.polygon_points.map((point) => `${Number(point.longitude)},${Number(point.latitude)}`).join(") , (")}))` };
}

export function buildEmptyIntervals(documents, startDate, endDate, now = new Date()) {
  const rangeStart = new Date(`${startDate}T00:00:00-03:00`);
  const requestedEnd = new Date(`${endDate}T23:59:59.999-03:00`);
  const rangeEnd = requestedEnd < now ? requestedEnd : now;
  const byPlate = new Map();

  for (const row of documents) {
    const plate = normalizePlate(row.placa);
    const operationAt = iso(row.operacao_at);
    const deliveredAt = iso(row.entrega_operacional_at || row.entrega_at);
    if (!plate || !operationAt) continue;
    const list = byPlate.get(plate) || [];
    list.push({ ...row, placa: plate, operationAt, deliveredAt });
    byPlate.set(plate, list);
  }

  const intervals = [];
  for (const [plate, docs] of byPlate) {
    docs.sort((a, b) => a.operationAt.localeCompare(b.operationAt));
    const candidates = docs.filter((doc) => doc.deliveredAt && doc.deliveredAt > doc.operationAt).map((doc) => {
      const next = docs.find((candidate) => candidate !== doc && candidate.operationAt > doc.deliveredAt);
      return { doc, end: next?.operationAt || rangeEnd.toISOString(), next };
    });
    const grouped = new Map();
    for (const candidate of candidates) {
      const key = candidate.end;
      const current = grouped.get(key);
      if (!current || candidate.doc.deliveredAt > current.doc.deliveredAt) grouped.set(key, candidate);
    }
    for (const { doc, end, next } of grouped.values()) {
      const rawStart = new Date(doc.deliveredAt);
      const rawEnd = new Date(end);
      const beginning = rawStart > rangeStart ? rawStart : rangeStart;
      const ending = rawEnd < rangeEnd ? rawEnd : rangeEnd;
      if (ending <= beginning) continue;
      intervals.push({
        id: intervals.length + 1,
        placa: plate,
        inicio: beginning.toISOString(),
        fim: ending.toISOString(),
        entregaAt: doc.deliveredAt,
        proximaOperacaoAt: next?.operationAt || null,
        documento: [doc.serie, doc.numero].filter(Boolean).join("-") || String(doc.codigo || ""),
        proximoDocumento: next ? ([next.serie, next.numero].filter(Boolean).join("-") || String(next.codigo || "")) : "",
        destino: [doc.destino_cidade, doc.destino_uf].filter(Boolean).join("/"),
        cliente: doc.cliente || "",
        entregaPrecisa: doc.entrega_precisa !== false,
        entregaFonte: doc.entrega_fonte || "erp",
      });
    }
  }
  return intervals.sort((a, b) => b.inicio.localeCompare(a.inicio));
}

async function loadDocuments(startDate, endDate, plate = "") {
  const from = new Date(`${startDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 45);
  const { rows } = await clientPool.query(`
    SELECT UPPER(TRIM(con.veiculocon::text)) placa, con.seriecon serie,
      COALESCE(con.numeroctecon, con.codigocon) numero, con.codigocon codigo,
      COALESCE(con.datahoracon, con.dataemissaocon::timestamp + COALESCE(con.horaemissaocon::time, TIME '00:00')) operacao_at,
      COALESCE(con.datahoraentregacon, con.dataentregacon::timestamp) entrega_at,
      (con.datahoraentregacon IS NOT NULL AND con.datahoraentregacon::time <> TIME '00:00') entrega_precisa,
      destino.nomecid destino_cidade, destino_uf.abreviaturaest destino_uf,
      COALESCE(NULLIF(cliente.fantasiacli, ''), NULLIF(cliente.nomecli, ''), '') cliente
    FROM logistica.conhecimentos con
    LEFT JOIN logistica.statusconhecimento sco ON sco.codigosco=con.statuscon
    LEFT JOIN localidades.cidades destino ON destino.codigocid=con.cidadeentregacon
    LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest=destino.estadocid
    LEFT JOIN gerais.clientes cliente ON cliente.codigocli=con.clientecon
    WHERE NULLIF(TRIM(con.veiculocon::text), '') IS NOT NULL
      AND con.dataemissaocon BETWEEN $1::date AND ($2::date + INTERVAL '1 day')
      AND regexp_replace(upper(con.veiculocon::text), '[^A-Z0-9]', '', 'g')=ANY($3::text[])
      AND COALESCE(UPPER(sco.nomesco), '') NOT IN ('CANCELADO','INUTILIZADO','ANULADO')
    ORDER BY con.dataemissaocon, con.codigocon
  `, [from.toISOString().slice(0, 10), endDate, plate ? [normalizePlate(plate)] : PLATES]);
  return rows;
}

async function enrichOperationalDeliveries(documents, endDate) {
  const ordered = documents.map((row, index) => ({ ...row, audit_id: index + 1, placa_norm: normalizePlate(row.placa), operacao_iso: iso(row.operacao_at) }))
    .filter((row) => row.placa_norm && row.operacao_iso);
  const payload = ordered.map((row) => {
    const next = ordered.filter((item) => item.placa_norm === row.placa_norm && item.operacao_iso > row.operacao_iso).sort((a, b) => a.operacao_iso.localeCompare(b.operacao_iso))[0];
    return { id: row.audit_id, placa: row.placa_norm, inicio: row.operacao_iso, fim: next?.operacao_iso || `${endDate}T23:59:59-03:00`, destino: row.destino_cidade || "" };
  });
  if (!payload.length) return documents;
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const pool = getVeiculosPool();
  const [arrivals, macros] = await Promise.all([
    pool.query(`WITH alvo AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int,placa text,inicio timestamptz,fim timestamptz,destino text))
      SELECT a.id,p.data_hora FROM alvo a LEFT JOIN LATERAL (
        SELECT m.data_hora FROM ${schema}.veiculos v JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id
        WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=a.placa AND m.data_hora BETWEEN a.inicio AND a.fim
          AND upper(trim(m.municipio))=upper(trim(a.destino)) ORDER BY m.data_hora LIMIT 1
      ) p ON true`, [JSON.stringify(payload)]),
    pool.query(`WITH alvo AS (SELECT id,placa,inicio,fim FROM jsonb_to_recordset($1::jsonb) AS x(id int,placa text,inicio timestamptz,fim timestamptz,destino text))
      SELECT a.id,regexp_replace(upper(v.placa),'[^A-Z0-9]','','g') placa,m.data_hora,m.macro_descricao
      FROM alvo a JOIN ${schema}.veiculos v ON regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=a.placa
      JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id AND m.data_hora BETWEEN a.inicio AND a.fim
      WHERE upper(m.macro_descricao) LIKE '%CHEGADA NO DESTINO%' ORDER BY m.data_hora`, [JSON.stringify(payload)]),
  ]);
  const arrivalById = new Map(arrivals.rows.filter((row) => row.data_hora).map((row) => [Number(row.id), iso(row.data_hora)]));
  return documents.map((row, index) => {
    const enriched = ordered.find((item) => item.audit_id === index + 1);
    if (!enriched) return row;
    const telemetryArrival = arrivalById.get(index + 1);
    const macroArrival = macros.rows.find((event) => Number(event.id) === index + 1)?.data_hora;
    const arrival = telemetryArrival || iso(macroArrival);
    if (!arrival) return row;
    const unloadedAt = new Date(new Date(arrival).getTime() + 2 * 3600000).toISOString();
    return { ...row, entrega_operacional_at: unloadedAt, entrega_precisa: false, entrega_fonte: telemetryArrival ? "telemetria_destino_mais_2h" : "macro_chegada_mais_2h", chegada_operacional_at: arrival };
  });
}

async function loadTelemetryMetrics(intervals, basePolygon = null, holidays = []) {
  if (!intervals.length) return new Map();
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const pool = getVeiculosPool();
  const payload = intervals.map(({ id, placa, inicio, fim }) => ({ id, placa, inicio, fim }));
  const { rows } = await pool.query(`
    WITH intervalos AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS x(id int, placa text, inicio timestamptz, fim timestamptz)
    ), pontos AS (
      SELECT i.id, i.inicio, i.fim, m.data_hora, m.velocidade, m.odometro, m.latitude, m.longitude,
        LAG(m.data_hora) OVER (PARTITION BY i.id ORDER BY m.data_hora) anterior_at,
        LAG(m.velocidade) OVER (PARTITION BY i.id ORDER BY m.data_hora) velocidade_anterior,
        LAG(m.odometro) OVER (PARTITION BY i.id ORDER BY m.data_hora) odometro_anterior,
        LAG(m.latitude) OVER (PARTITION BY i.id ORDER BY m.data_hora) latitude_anterior,
        LAG(m.longitude) OVER (PARTITION BY i.id ORDER BY m.data_hora) longitude_anterior
      FROM intervalos i
      JOIN ${schema}.veiculos v ON regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g')=i.placa
      JOIN ${schema}.mensagens_cb m ON m.veiculo_id=v.veiculo_id AND m.data_hora BETWEEN i.inicio AND i.fim
    )
    SELECT id, COUNT(*)::int amostras, MIN(data_hora) primeira_amostra, MAX(data_hora) ultima_amostra,
      GREATEST(0, COALESCE(MAX(odometro) FILTER (WHERE odometro>0),0)-COALESCE(MIN(odometro) FILTER (WHERE odometro>0),0)) km_odometro,
      COALESCE(SUM(CASE WHEN anterior_at IS NOT NULL AND COALESCE(velocidade_anterior,0)<5
        AND EXTRACT(EPOCH FROM data_hora-anterior_at) BETWEEN 0 AND 7200
        THEN EXTRACT(EPOCH FROM data_hora-anterior_at)/3600 ELSE 0 END),0) horas_parado,
      COALESCE(SUM(CASE WHEN anterior_at IS NOT NULL AND COALESCE(velocidade_anterior,0)<5 AND EXTRACT(EPOCH FROM data_hora-anterior_at) BETWEEN 0 AND 7200
        AND $2::text IS NOT NULL AND latitude_anterior IS NOT NULL AND longitude_anterior IS NOT NULL AND point(longitude_anterior,latitude_anterior) <@ $2::polygon
        THEN EXTRACT(EPOCH FROM data_hora-anterior_at)/3600 ELSE 0 END),0) horas_parado_base,
      COALESCE(SUM(CASE WHEN anterior_at IS NOT NULL AND COALESCE(velocidade_anterior,0)<5 AND EXTRACT(EPOCH FROM data_hora-anterior_at) BETWEEN 0 AND 7200
        AND NOT ($2::text IS NOT NULL AND latitude_anterior IS NOT NULL AND longitude_anterior IS NOT NULL AND point(longitude_anterior,latitude_anterior) <@ $2::polygon)
        AND (anterior_at AT TIME ZONE 'America/Sao_Paulo')::date = ANY($3::date[]) THEN EXTRACT(EPOCH FROM data_hora-anterior_at)/3600 ELSE 0 END),0) horas_parado_feriado,
      COALESCE(SUM(CASE WHEN anterior_at IS NOT NULL AND COALESCE(velocidade_anterior,0)<5 AND EXTRACT(EPOCH FROM data_hora-anterior_at) BETWEEN 0 AND 7200
        AND NOT ($2::text IS NOT NULL AND latitude_anterior IS NOT NULL AND longitude_anterior IS NOT NULL AND point(longitude_anterior,latitude_anterior) <@ $2::polygon)
        AND NOT ((anterior_at AT TIME ZONE 'America/Sao_Paulo')::date = ANY($3::date[])) AND EXTRACT(ISODOW FROM anterior_at AT TIME ZONE 'America/Sao_Paulo') IN (6,7) THEN EXTRACT(EPOCH FROM data_hora-anterior_at)/3600 ELSE 0 END),0) horas_parado_fim_semana,
      COALESCE(SUM(CASE WHEN anterior_at IS NOT NULL AND COALESCE(velocidade_anterior,0)<5 AND EXTRACT(EPOCH FROM data_hora-anterior_at) BETWEEN 0 AND 7200
        AND NOT ($2::text IS NOT NULL AND latitude_anterior IS NOT NULL AND longitude_anterior IS NOT NULL AND point(longitude_anterior,latitude_anterior) <@ $2::polygon)
        AND NOT ((anterior_at AT TIME ZONE 'America/Sao_Paulo')::date = ANY($3::date[])) AND EXTRACT(ISODOW FROM anterior_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 1 AND 5 THEN EXTRACT(EPOCH FROM data_hora-anterior_at)/3600 ELSE 0 END),0) horas_parado_dia_util,
      COALESCE(SUM(CASE WHEN odometro_anterior>0 AND odometro>=odometro_anterior
        AND odometro-odometro_anterior <= GREATEST(5, EXTRACT(EPOCH FROM data_hora-anterior_at)/3600*140+2)
        THEN odometro-odometro_anterior ELSE 0 END),0) km_vazio
    FROM pontos GROUP BY id
  `, [JSON.stringify(payload), basePolygon, holidays]);
  return new Map(rows.map((row) => [Number(row.id), row]));
}

export async function getOciosidadeFrota(filters = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.endDate || "")) ? filters.endDate : today;
  const fallbackStart = new Date(`${endDate}T00:00:00Z`);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 29);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.startDate || "")) ? filters.startDate : fallbackStart.toISOString().slice(0, 10);
  if (startDate > endDate) throw Object.assign(new Error("A data inicial deve ser anterior à data final."), { status: 400 });
  if ((new Date(endDate) - new Date(startDate)) / DAY_MS > 120) throw Object.assign(new Error("Selecione um período de até 120 dias."), { status: 400 });

  const requestedPlates = filters.placa ? [normalizePlate(filters.placa)] : PLATES;
  const histories = await Promise.all(requestedPlates.map((placa) => getTrafegusSmsHistory({ placa, inicio: startDate, fim: endDate }).catch(() => null)));
  const sms = histories.flatMap((history) => history?.rows || []);
  const rawDocuments = sms.length ? [] : await loadDocuments(startDate, endDate, filters.placa);
  const documents = sms.length ? [] : await enrichOperationalDeliveries(rawDocuments, endDate);
  let intervals = buildEmptyIntervals(documents, startDate, endDate);
  const rangeStart = new Date(`${startDate}T00:00:00-03:00`).toISOString();
  const rangeEnd = new Date(`${endDate}T23:59:59-03:00`).toISOString();
  let loadedIntervals = mergeIntervals(documents.map((doc) => ({ placa: normalizePlate(doc.placa), inicio: iso(doc.operacao_at), fim: iso(doc.chegada_operacional_at) })).filter((item) => item.placa && item.inicio && item.fim && item.fim > item.inicio))
    .map((item, index) => ({ ...item, id: index + 1, inicio: item.inicio > rangeStart ? item.inicio : rangeStart, fim: item.fim < rangeEnd ? item.fim : rangeEnd }))
    .filter((item) => item.fim > item.inicio);
  let confirmedEmptyIntervals = [];
  let trafegusAvailable = false;
  if (sms.length) {
    const smIntervals = buildSmOperationalIntervals(sms, startDate, endDate);
    loadedIntervals = smIntervals.loaded.map((item, index) => ({ ...item, id: index + 1 }));
    confirmedEmptyIntervals = smIntervals.confirmedEmpty.map((item, index) => ({ ...item, id: index + 1 }));
    intervals = smIntervals.gaps;
    trafegusAvailable = true;
  }
  const overlapIntervals = [];
  for (const loaded of loadedIntervals) for (const empty of intervals) {
    if (loaded.placa !== empty.placa) continue;
    const inicio = loaded.inicio > empty.inicio ? loaded.inicio : empty.inicio;
    const fim = loaded.fim < empty.fim ? loaded.fim : empty.fim;
    if (fim > inicio) overlapIntervals.push({ id: overlapIntervals.length + 1, placa: loaded.placa, inicio, fim });
  }
  const totalIntervals = (filters.placa ? [normalizePlate(filters.placa)] : PLATES).map((placa, index) => ({ id: index + 1, placa, inicio: `${startDate}T00:00:00-03:00`, fim: `${endDate}T23:59:59-03:00` }));
  const baseGeofence = await loadBaseGeofence().catch(() => null);
  const holidays = nationalHolidays(startDate, endDate);
  const [telemetry, loadedTelemetry, confirmedEmptyTelemetry, totalTelemetry, overlapTelemetry] = await Promise.all([loadTelemetryMetrics(intervals, baseGeofence?.polygon, holidays), loadTelemetryMetrics(loadedIntervals), loadTelemetryMetrics(confirmedEmptyIntervals), loadTelemetryMetrics(totalIntervals), loadTelemetryMetrics(overlapIntervals)]);
  const rows = intervals.map((interval) => {
    const metric = telemetry.get(interval.id) || {};
    const horasVazio = Math.max(0, (new Date(interval.fim) - new Date(interval.inicio)) / 3600000);
    const first = metric.primeira_amostra ? new Date(metric.primeira_amostra) : null;
    const last = metric.ultima_amostra ? new Date(metric.ultima_amostra) : null;
    const coverage = first && last && horasVazio > 0 ? Math.min(1, Math.max(0, (last - first) / 3600000 / horasVazio)) : 0;
    const confiancaTelemetria = Number(metric.amostras || 0) < 2 ? "sem telemetria" : coverage >= 0.4 ? "média" : "baixa";
    const confianca = confiancaTelemetria;
    const horasNaBase = Math.min(horasVazio, Number(metric.horas_parado_base || 0));
    return { ...interval, horasVazio: round(horasVazio), horasParadoVazio: round(Math.min(horasVazio, Math.max(0, Number(metric.horas_parado || 0) - horasNaBase))), horasDescartadasBase: round(horasNaBase), horasParadoDiaUtil: round(metric.horas_parado_dia_util), horasParadoFimSemana: round(metric.horas_parado_fim_semana), horasParadoFeriado: round(metric.horas_parado_feriado), kmVazio: round(metric.km_odometro), amostras: Number(metric.amostras || 0), coberturaPercentual: round(coverage * 100, 0), confianca };
  });
  const summary = {
    veiculos: new Set(rows.map((row) => row.placa)).size,
    intervalos: rows.length,
    horasVazio: round(rows.reduce((sum, row) => sum + row.horasVazio, 0)),
    horasParadoVazio: round(rows.reduce((sum, row) => sum + row.horasParadoVazio, 0)),
    horasDescartadasBase: round(rows.reduce((sum, row) => sum + row.horasDescartadasBase, 0)),
    horasParadoDiaUtil: round(rows.reduce((sum, row) => sum + row.horasParadoDiaUtil, 0)),
    horasParadoFimSemana: round(rows.reduce((sum, row) => sum + row.horasParadoFimSemana, 0)),
    horasParadoFeriado: round(rows.reduce((sum, row) => sum + row.horasParadoFeriado, 0)),
    kmVazio: round(rows.reduce((sum, row) => sum + row.kmVazio, 0)),
    kmVazioConfirmado: round([...confirmedEmptyTelemetry.values()].reduce((sum, row) => sum + Number(row.km_odometro || 0), 0)),
    kmCarregado: round([...loadedTelemetry.values()].reduce((sum, row) => sum + Number(row.km_odometro || 0), 0) - [...overlapTelemetry.values()].reduce((sum, row) => sum + Number(row.km_odometro || 0), 0)),
    kmTotal: round([...totalTelemetry.values()].reduce((sum, row) => sum + Number(row.km_odometro || 0), 0)),
  };
  summary.kmVazio = round(Math.max(0, summary.kmVazio - [...overlapTelemetry.values()].reduce((sum, row) => sum + Number(row.km_odometro || 0), 0)));
  summary.kmNaoClassificado = round(Math.max(0, summary.kmTotal - summary.kmCarregado - summary.kmVazio - summary.kmVazioConfirmado));
  summary.percentualParado = summary.horasVazio ? round(summary.horasParadoVazio / summary.horasVazio * 100, 0) : 0;
  const sumMetricsByPlate = (sourceIntervals, metrics, field) => {
    const values = new Map();
    for (const item of sourceIntervals) values.set(item.placa, (values.get(item.placa) || 0) + Number(metrics.get(item.id)?.[field] || 0));
    return values;
  };
  const totalByPlate = sumMetricsByPlate(totalIntervals, totalTelemetry, "km_odometro");
  const loadedByPlate = sumMetricsByPlate(loadedIntervals, loadedTelemetry, "km_odometro");
  const confirmedByPlate = sumMetricsByPlate(confirmedEmptyIntervals, confirmedEmptyTelemetry, "km_odometro");
  const rowGroups = new Map();
  for (const row of rows) {
    const group = rowGroups.get(row.placa) || { kmVazio: 0, horasVazio: 0, horasParado: 0, coberturas: [], intervalos: 0 };
    group.kmVazio += row.kmVazio; group.horasVazio += row.horasVazio; group.horasParado += row.horasParadoVazio; group.coberturas.push(row.coberturaPercentual); group.intervalos += 1;
    rowGroups.set(row.placa, group);
  }
  const ranking = requestedPlates.map((placa) => {
    const group = rowGroups.get(placa) || { kmVazio: 0, horasVazio: 0, horasParado: 0, coberturas: [], intervalos: 0 };
    const kmTotal = Number(totalByPlate.get(placa) || 0), kmCarregado = Number(loadedByPlate.get(placa) || 0), kmVazioConfirmado = Number(confirmedByPlate.get(placa) || 0);
    const kmVazio = group.kmVazio + kmVazioConfirmado;
    const cobertura = group.coberturas.length ? group.coberturas.reduce((a, b) => a + b, 0) / group.coberturas.length : 0;
    const kmNaoClassificado = Math.max(0, kmTotal - kmCarregado - kmVazio);
    return { placa, kmTotal: round(kmTotal), kmCarregado: round(kmCarregado), kmVazio: round(kmVazio), kmVazioConfirmado: round(kmVazioConfirmado), kmNaoClassificado: round(kmNaoClassificado), percentualVazio: kmTotal ? round(kmVazio / kmTotal * 100, 1) : 0, horasVazio: round(group.horasVazio), horasParadoVazio: round(group.horasParado), percentualParado: group.horasVazio ? round(group.horasParado / group.horasVazio * 100, 0) : 0, coberturaPercentual: round(cobertura, 0), intervalos: group.intervalos };
  }).filter((item) => item.kmTotal || item.intervalos).sort((a, b) => b.kmVazio - a.kmVazio);
  const fixedCosts = await getFixedCostsByVehicle({ endDate, placas: requestedPlates }).catch(() => []);
  const fixedCostByPlate = new Map(fixedCosts.map((item) => [item.placa, item]));
  for (const item of ranking) {
    const cost = fixedCostByPlate.get(item.placa);
    item.custoFixoDiario = round(cost?.custoFixoDiario, 2);
    item.custoOciosidadeEstimado = round(item.horasParadoVazio / 24 * item.custoFixoDiario, 2);
  }
  for (const item of rows) {
    const cost = fixedCostByPlate.get(item.placa);
    item.custoFixoDiario = round(cost?.custoFixoDiario, 2);
    item.custoOciosidadeEstimado = round(item.horasParadoVazio / 24 * item.custoFixoDiario, 2);
  }
  const periodDays = Math.max(1, Math.round((new Date(`${endDate}T12:00:00Z`) - new Date(`${startDate}T12:00:00Z`)) / DAY_MS) + 1);
  const analyzedVehicles = ranking.length || summary.veiculos;
  const availableFleetHours = analyzedVehicles * periodDays * 24;
  summary.diasPeriodo = periodDays;
  summary.horasDisponiveisFrota = round(availableFleetHours);
  summary.horasParadoMediaVeiculo = analyzedVehicles ? round(summary.horasParadoVazio / analyzedVehicles) : 0;
  summary.percentualParadoPeriodo = availableFleetHours ? round(summary.horasParadoVazio / availableFleetHours * 100, 1) : 0;
  summary.custoOciosidadeEstimado = round(ranking.reduce((sum, item) => sum + item.custoOciosidadeEstimado, 0), 2);
  for (const item of ranking) item.percentualParadoPeriodo = periodDays ? round(item.horasParadoVazio / (periodDays * 24) * 100, 1) : 0;
  summary.percentualKmVazio = summary.kmTotal ? round((summary.kmVazio + summary.kmVazioConfirmado) / summary.kmTotal * 100, 1) : 0;
  summary.percentualClassificado = summary.kmTotal ? round((summary.kmCarregado + summary.kmVazio + summary.kmVazioConfirmado) / summary.kmTotal * 100, 1) : 0;
  summary.coberturaPercentual = rows.length ? round(rows.reduce((sum, row) => sum + row.coberturaPercentual, 0) / rows.length, 0) : 0;
  const qualityScore = Math.round(summary.percentualClassificado * .65 + summary.coberturaPercentual * .35);
  const qualidade = { score: qualityScore, nivel: qualityScore >= 90 ? "Excelente" : qualityScore >= 75 ? "Boa" : qualityScore >= 55 ? "Regular" : "Insuficiente" };
  const top = ranking[0];
  const insights = [
    summary.percentualParado >= 75 ? { nivel: "critico", titulo: "Ociosidade elevada", texto: `${summary.percentualParado}% do tempo vazio ocorreu com os veículos parados.` } : null,
    summary.kmNaoClassificado > summary.kmTotal * .1 ? { nivel: "atencao", titulo: "Quilômetros sem classificação", texto: `${round(summary.kmNaoClassificado, 0)} km precisam de conciliação operacional.` } : null,
    top ? { nivel: "atencao", titulo: "Maior oportunidade", texto: `${top.placa} lidera com ${round(top.kmVazio, 0)} km vazios no período.` } : null,
    { nivel: qualidade.score >= 75 ? "ok" : "atencao", titulo: "Qualidade da análise", texto: `${qualidade.score}/100 — ${qualidade.nivel}; ${summary.coberturaPercentual}% de cobertura média.` },
  ].filter(Boolean);
  return { periodo: { startDate, endDate }, summary, qualidade, insights, ranking, rows, calendario: { feriadosNacionais: holidays }, cercaBase: baseGeofence ? { nome: baseGeofence.name, aplicada: true } : { nome: null, aplicada: false }, metodologia: { fonteOperacional: trafegusAvailable ? "SM Trafegus" : "CT-e e telemetria (fallback)", total: "variacao entre o menor e o maior odometro valido da telemetria no periodo", carregado: trafegusAvailable ? "inicio ao fim de cada SM carregada" : "emissao do CT-e ate chegada ao destino confirmada por telemetria ou macro", vazioConfirmado: "inicio ao fim de SM marcada como vazia", vazio: trafegusAvailable ? "fim de uma SM ate o inicio da proxima SM" : "chegada ao destino mais 2h ate a proxima operacao", parado: "intervalos vazios com velocidade abaixo de 5 km/h; periodos dentro da cerca da base sao descartados; lacunas de telemetria maiores que 2h nao sao somadas", naoClassificado: "distancia sem evidencias suficientes para carregado ou vazio" }, filters: { placas: PLATES } };
}
