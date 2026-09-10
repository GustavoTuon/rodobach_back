import { suggestStops } from "./conferenciaDocumentos.js";

// Snapshot da consulta ERP realizada nesta conferência: RXO6C18, agosto/2026.
// Usado somente se a consulta atual não estiver disponível; identificado na resposta.
export const snapshotRxo = [
  ["2026-08-03", "IBRAP", "URUSSANGA", "ITAJUBÁ", ["1-4276"]],
  ["2026-08-04", "KAUE PRESTES VARGAS", "MORRO DA FUMAÇA", "ITUPEVA", ["O-1209", "1-4274"]],
  ["2026-08-06", "ESAF", "ITAJUBÁ", "SÃO PAULO", ["1-4283", "1-4284", "1-4285"]],
  ["2026-08-07", "DSM", "HORTOLÂNDIA", "TRÊS DE MAIO", ["O-1215"]],
  ["2026-08-13", "ROMAR", "INDEPENDÊNCIA", "BLUMENAU", ["O-1218"]],
  ["2026-08-18", "IBRAP", "URUSSANGA", "ITAJUBÁ", ["1-4343"]],
  ["2026-08-20", "ESAF", "ITAJUBÁ", "SÃO PAULO", ["1-4349", "1-4350"]],
  ["2026-08-21", "SOLUFIL", "VINHEDO", "MORRO DA FUMAÇA", ["1-4369"]],
  ["2026-08-24", "FUMACENSE ALIMENTOS", "MORRO DA FUMAÇA", "GAMELEIRAS", ["1-4375", "1-4377", "1-4381", "1-4382"]],
  ["2026-08-24", "FUMACENSE ALIMENTOS", "MORRO DA FUMAÇA", "ESPINOSA", ["1-4376", "1-4378", "1-4380"]],
  ["2026-08-24", "FUMACENSE ALIMENTOS", "MORRO DA FUMAÇA", "MAMONAS", ["1-4379"]],
  ["2026-08-24", "FUMACENSE ALIMENTOS", "MORRO DA FUMAÇA", "MONTE AZUL", ["1-4383"]],
  ["2026-08-31", "REMETENTE", "JAÍBA", "MANTENA", ["O-1235"]],
].flatMap(([dia, cliente, origem, destino, documentos]) => documentos.map((documento) => ({ dia, cliente, origem, destino, documento })));
const norm = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const x = Math.sin((b.latitude-a.latitude)*rad/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1,x)));
}
export function groupPilotDocuments(documents) {
  const groups = new Map();
  for (const d of documents) {
    const key = `${d.dia}|${norm(d.cliente)}|${norm(d.origem)}`;
    if (!groups.has(key)) groups.set(key, { dia: d.dia, cliente: d.cliente, origem: d.origem, documentos: [], destinos: [] });
    const group = groups.get(key);
    if (!group.documentos.includes(d.documento)) group.documentos.push(d.documento);
    if (!group.destinos.some((v) => norm(v) === norm(d.destino))) group.destinos.push(d.destino);
  }
  return [...groups.values()].sort((a,b) => a.dia.localeCompare(b.dia));
}
// Infer circles from stationary GPS observations, not from city centroids.
// These are candidate locations and cannot prove a loading/unloading event.
export function inferVisit(city, stops, start, end) {
  const candidates = stops.filter((s) => norm(s.municipio) === norm(city) && new Date(s.inicio) >= new Date(start) && new Date(s.fim) <= new Date(end) && new Date(s.fim)-new Date(s.inicio)>=30*60000)
    .sort((a,b) => new Date(a.inicio)-new Date(b.inicio));
  if (!candidates.length) return null;
  const first = candidates[0];
  const circle = { latitude: Number(first.latitude), longitude: Number(first.longitude), raioMetros: 300 };
  return { cidade: city, inicio: first.inicio, fim: first.fim, cerca: circle,
    odometroMinimo: first.odometro_minimo == null ? null : Number(first.odometro_minimo),
    odometroMaximo: first.odometro_maximo == null ? null : Number(first.odometro_maximo),
    candidatas: candidates.length, visitasNaCerca: candidates.filter((s) => distanceMeters(circle, s)<=300).length };
}
export async function runPilot(documents = snapshotRxo, source = "Snapshot da consulta ERP anterior; conexão atual indisponível") {
  const groups = groupPilotDocuments(documents);
  const stops = (await suggestStops({ placa: "RXO6C18", inicio: "2026-08-01T03:00:00Z", fim: "2026-09-01T02:59:59Z" }))
    .concat(await suggestStops({ placa: "RXO6C18", inicio: "2026-09-01T03:00:00Z", fim: "2026-09-08T02:59:59Z" }));
  const rows = groups.map((g) => {
    const start = `${g.dia}T00:00:00-03:00`;
    const end = new Date(Math.min(+new Date(start)+14*86400000,+new Date("2026-09-08T02:59:59Z"))).toISOString();
    const coleta = inferVisit(g.origem, stops, start, end);
    const entregas = g.destinos.map((cidade) => ({ cidade, visita: inferVisit(cidade, stops, coleta?.fim || start, end) }));
    const complete = entregas.every((e) => e.visita);
    const ultimaEntrega = complete ? entregas.map((e) => e.visita).sort((a,b) => new Date(b.fim)-new Date(a.fim))[0] : null;
    return { ...g, coleta, entregas, ultimaEntrega, kmVazio: null, status: complete ? "Paradas candidatas; confirmar descarga" : "Destino sem parada candidata" };
  });
  rows.forEach((r,i) => {
    const next = rows[i+1];
    r.proximaViagem = next ? `${next.dia} · ${next.cliente}` : null;
    if (!r.ultimaEntrega || !next?.coleta) return;
    if (new Date(next.coleta.fim)<=new Date(r.ultimaEntrega.fim)) { r.status = "Horários sobrepostos; conferir agrupamento"; return; }
    const from = r.ultimaEntrega.odometroMaximo, to = next.coleta.odometroMaximo;
    if (from == null || to == null || to<from) { r.status = "Odômetro ausente ou inconsistente"; return; }
    r.kmVazio = to-from;
    r.horasVazio = (+new Date(next.coleta.fim)-+new Date(r.ultimaEntrega.fim))/3600000;
    r.status = "Simulação entre paradas; não confirmado";
  });
  return { fonte: source, documentos: documents.length, paradas: stops.length, rows,
    aviso: "Agrupamento por dia, cliente e origem. Cercas candidatas de 300 m em paradas de pelo menos 30 min no município, até 14 dias após emissão. Não são coordenadas validadas do destinatário. Primeira parada elegível é apenas sugestão; saída da parada não comprova descarga. Não altera indicadores nem confirma viagens automaticamente." };
}
