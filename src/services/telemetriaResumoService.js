import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { config } from "../config.js";

function normalizePlate(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function parseBrazilNumber(value) {
  if (value === null || value === undefined) return 0;
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

async function readMetricPairs(filePath) {
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
  return path.join(process.env.USERPROFILE, "OneDrive", "Desktop", "SXY5D26");
}

export async function getTelemetriaResumoPorPlaca(filters = {}) {
  const dir = resolveTelemetryDir();
  if (!dir || !fs.existsSync(dir)) {
    return {
      summary: { placas: 0, distanciaKm: 0, consumoTotalLitros: 0, mediaConsumoKmL: 0 },
      byPlate: [],
      source: { dir, files: 0, available: false },
    };
  }

  const targetPlate = normalizePlate(filters.placa);
  const files = fs.readdirSync(dir)
    .filter((name) => /\.xlsx$/i.test(name) && /Resumo de Telemetria/i.test(name));
  const byPlate = new Map();
  const errors = [];

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
      };
    })
    .sort((a, b) => a.placa.localeCompare(b.placa));

  const distanciaKm = rows.reduce((sum, row) => sum + row.distanciaKm, 0);
  const consumoTotalLitros = rows.reduce((sum, row) => sum + row.consumoTotalLitros, 0);
  const mediaConsumoKmL = consumoTotalLitros > 0 ? distanciaKm / consumoTotalLitros : 0;

  return {
    summary: {
      placas: rows.length,
      distanciaKm: money(distanciaKm),
      consumoTotalLitros: money(consumoTotalLitros),
      mediaConsumoKmL: money(mediaConsumoKmL),
    },
    byPlate: rows,
    source: { dir, files: files.length, available: true, errors },
  };
}
