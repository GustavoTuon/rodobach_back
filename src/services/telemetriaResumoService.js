import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { config } from "../config.js";
import { createAsyncCache } from "./asyncCache.js";

const metricCache = createAsyncCache({ ttlMs: 300000, maxEntries: 256 });

function normalizePlate(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

export function parseBrazilNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object") return parseBrazilNumber(value.result);
  const raw = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseDatePart(value) {
  const [day, month, year] = String(value || "").split("-").map(Number);
  if (!day || !month || !year) return null;
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function parsePeriodFromFilename(filename) {
  const match = filename.match(/_(\d{1,2}-\d{1,2}-\d{4})_A_(\d{1,2}-\d{1,2}-\d{4})_/i);
  return {
    startDate: parseDatePart(match?.[1]),
    endDate: parseDatePart(match?.[2]),
  };
}

function overlapsPeriod(report, filters = {}) {
  const startDate = dateOnly(filters.startDate || filters.dataInicio);
  const endDate = dateOnly(filters.endDate || filters.dataFim);
  if (!startDate || !endDate || !report.startDate || !report.endDate) return true;
  return report.startDate <= endDate && report.endDate >= startDate;
}

function reportKey(filename) {
  const period = parsePeriodFromFilename(filename);
  return `${normalizePlate(filename.split("_")[0])}|${period.startDate || ""}|${period.endDate || ""}`;
}

function reportTimestamp(filename) {
  const match = filename.match(/_(\d{8})_(\d{6})\.xlsx$/i);
  return match ? `${match[1]}${match[2]}` : "";
}

function latestReports(files) {
  const selected = new Map();
  for (const filename of files) {
    const key = reportKey(filename);
    const current = selected.get(key);
    if (!current || reportTimestamp(filename) > reportTimestamp(current)) selected.set(key, filename);
  }
  return [...selected.values()];
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function telemetryCoverage(periods, filters = {}) {
  const startDate = dateOnly(filters.startDate || filters.dataInicio);
  const endDate = dateOnly(filters.endDate || filters.dataFim);
  const valid = periods
    .filter((period) => period.startDate && period.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!startDate || !endDate || !valid.length) return "indisponivel";
  if (valid.some((period) => period.startDate < startDate || period.endDate > endDate)) return "parcial";

  let coveredUntil = null;
  for (const period of valid) {
    if (!coveredUntil) {
      if (period.startDate > startDate) return "parcial";
      coveredUntil = period.endDate;
    } else {
      if (period.startDate <= coveredUntil) return "parcial";
      if (period.startDate > addDays(coveredUntil, 1)) return "parcial";
      if (period.endDate > coveredUntil) coveredUntil = period.endDate;
    }
  }
  return coveredUntil >= endDate ? "confirmada" : "parcial";
}

async function readMetricPairs(filePath) {
  const stat = await fs.promises.stat(filePath);
  return metricCache.get(`${filePath}|${stat.mtimeMs}|${stat.size}`, () => loadMetricPairs(filePath));
}

async function loadMetricPairs(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet?.eachRow({ includeEmpty: true }, (row) => rows.push(row.values.slice(1).map((v) => v ?? "")));
  const metrics = {};

  for (let i = 0; i < rows.length - 1; i += 2) {
    const labels = rows[i] || [];
    const values = rows[i + 1] || [];
    labels.forEach((label, index) => {
      const key = String(label || "").trim();
      if (key) metrics[key] = values[index];
    });
  }

  return metrics;
}

function resolveTelemetryDir() {
  if (config.telemetriaResumoDir) return config.telemetriaResumoDir;
  if (!process.env.USERPROFILE) return "";
  return path.join(process.env.USERPROFILE, "OneDrive", "Desktop", "trucks");
}

export async function getTelemetriaResumoPorPlaca(filters = {}) {
  const dir = resolveTelemetryDir();
  let directoryFiles;
  try { directoryFiles = dir ? await fs.promises.readdir(dir) : null; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!directoryFiles) {
    return {
      summary: { placas: 0, distanciaKm: 0, consumoTotalLitros: 0, mediaConsumoKmL: 0 },
      byPlate: [],
      source: { files: 0, available: false },
    };
  }

  const targetPlate = normalizePlate(filters.placa);
  const discoveredFiles = directoryFiles
    .filter((name) => /\.xlsx$/i.test(name) && /Resumo de Telemetria/i.test(name));
  const files = latestReports(discoveredFiles).sort((a, b) => {
    const pa = parsePeriodFromFilename(a), pb = parsePeriodFromFilename(b);
    const inside = p => (!filters.startDate || p.startDate >= filters.startDate) && (!filters.endDate || p.endDate <= filters.endDate);
    return Number(inside(pb)) - Number(inside(pa)) || (new Date(pb.endDate) - new Date(pb.startDate)) - (new Date(pa.endDate) - new Date(pa.startDate)) || a.localeCompare(b);
  });
  const byPlate = new Map();
  const errors = [];
  let overlapsIgnored = 0;

  for (const filename of files) {
    const reportPeriod = parsePeriodFromFilename(filename);
    if (!overlapsPeriod(reportPeriod, filters)) continue;

    try {
      const metrics = await readMetricPairs(path.join(dir, filename));
      const placa = normalizePlate(metrics.Placa || filename.split("_")[0]);
      if (!placa || (targetPlate && placa !== targetPlate)) continue;

      const current = byPlate.get(placa) || {
        placa,
        marca: String(metrics.Marca || "").trim(),
        modelo: String(metrics.Modelo || "").trim(),
        distanciaKm: 0,
        consumoTotalLitros: 0,
        mediaSamples: [],
        arquivos: [],
        periodos: [],
      };

      if (!reportPeriod.startDate || !reportPeriod.endDate) throw new Error("Periodo do relatorio nao identificado.");
      const overlap = current.periodos.find(p => p.startDate <= reportPeriod.endDate && p.endDate >= reportPeriod.startDate);
      if (overlap) {
        overlapsIgnored++;
        // A contained report adds no coverage. A crossing report cannot be split safely.
        if (!(overlap.startDate <= reportPeriod.startDate && overlap.endDate >= reportPeriod.endDate)) current.conflitoPeriodo = true;
        continue;
      }

      current.distanciaKm += parseBrazilNumber(metrics["Distância percorrida"]);
      current.consumoTotalLitros += parseBrazilNumber(metrics["Consumo Total"]);
      const media = parseBrazilNumber(metrics["Média de Consumo"]);
      if (media > 0) current.mediaSamples.push(media);
      current.arquivos.push(filename);
      current.periodos.push(reportPeriod);
      byPlate.set(placa, current);
    } catch (error) {
      errors.push({ arquivo: filename, erro: error.message });
    }
  }

  const rows = [...byPlate.values()]
    .map((row) => {
      const mediaConsumoKmL = row.consumoTotalLitros > 0
        ? row.distanciaKm / row.consumoTotalLitros
        : row.mediaSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, row.mediaSamples.length);
      return {
        placa: row.placa,
        marca: row.marca,
        modelo: row.modelo,
        distanciaKm: money(row.distanciaKm),
        consumoTotalLitros: money(row.consumoTotalLitros),
        mediaConsumoKmL: money(mediaConsumoKmL),
        arquivos: row.arquivos,
        periodos: row.periodos,
        cobertura: row.conflitoPeriodo ? "parcial" : telemetryCoverage(row.periodos, filters),
      };
    })
    .sort((a, b) => a.placa.localeCompare(b.placa));

  const distanciaKm = rows.reduce((sum, row) => sum + row.distanciaKm, 0);
  const consumoTotalLitros = rows.reduce((sum, row) => sum + row.consumoTotalLitros, 0);
  const rowsComConsumo = rows.filter((row) => row.consumoTotalLitros > 0);
  const distanciaComConsumoKm = rowsComConsumo.reduce((sum, row) => sum + row.distanciaKm, 0);
  const mediaConsumoKmL = consumoTotalLitros > 0 ? distanciaComConsumoKm / consumoTotalLitros : 0;

  return {
    summary: {
      placas: rows.length,
      distanciaKm: money(distanciaKm),
      distanciaComConsumoKm: money(distanciaComConsumoKm),
      consumoTotalLitros: money(consumoTotalLitros),
      mediaConsumoKmL: money(mediaConsumoKmL),
      placasComConsumo: rowsComConsumo.length,
      placasSemConsumo: rows.filter((row) => row.distanciaKm > 0 && row.consumoTotalLitros <= 0).map((row) => row.placa),
    },
    byPlate: rows,
    source: {
      files: files.length,
      overlapsIgnored,
      duplicatesIgnored: discoveredFiles.length - files.length,
      available: true,
      errors,
    },
  };
}
