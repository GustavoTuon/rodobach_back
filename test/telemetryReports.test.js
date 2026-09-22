import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { config } from "../src/config.js";
import { getTelemetriaResumoPorPlaca, parseBrazilNumber, telemetryCoverage } from "../src/services/telemetriaResumoService.js";

test("Excel numbers, localized strings and formula results preserve their decimal value", () => {
  for (const [input, expected] of [[123.45, 123.45], [0.5, 0.5], ["123,45", 123.45], ["1.234,56", 1234.56], [{ formula: "A1", result: 0.5 }, 0.5], [null, 0], [NaN, 0]]) assert.equal(parseBrazilNumber(input), expected);
});

async function reports(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rodobach-telemetry-test-"));
  const previous = config.telemetriaResumoDir;
  config.telemetriaResumoDir = dir;
  t.after(async () => { config.telemetriaResumoDir = previous; for (const file of await fs.readdir(dir)) await fs.unlink(path.join(dir, file)); await fs.rmdir(dir); });
  return async (start, end, distance, timestamp = "20260915_000000") => {
    const filename = path.join(dir, `ABC1D23_${start}_A_${end}_Resumo de Telemetria_${timestamp}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.addRow(["Placa", "Distância percorrida", "Consumo Total", "Média de Consumo"]);
    sheet.addRow(["ABC1D23", distance, 10.5, 2.5]);
    await workbook.xlsx.writeFile(filename);
    return filename;
  };
}
const filters = { startDate: "2026-09-01", endDate: "2026-09-30" };

test("contained reports and repeat exports do not double count a month", async t => {
  const write = await reports(t);
  await write("01-09-2026", "30-09-2026", 100.5, "20260914_000000");
  await write("01-09-2026", "30-09-2026", 123.45);
  await write("01-09-2026", "15-09-2026", 50);
  const result = await getTelemetriaResumoPorPlaca(filters);
  assert.equal(result.byPlate[0].distanciaKm, 123.45);
  assert.equal(result.byPlate[0].consumoTotalLitros, 10.5);
  assert.equal(result.byPlate[0].cobertura, "confirmada");
  assert.equal(result.source.duplicatesIgnored, 1);
  assert.equal(result.source.overlapsIgnored, 1);
});

test("crossing reports cannot claim confirmed coverage or sum overlapping totals", async t => {
  const write = await reports(t);
  await write("01-09-2026", "20-09-2026", 100);
  await write("15-09-2026", "30-09-2026", 80);
  const result = await getTelemetriaResumoPorPlaca(filters);
  assert.equal(result.byPlate[0].distanciaKm, 100);
  assert.equal(result.byPlate[0].cobertura, "parcial");
  assert.equal(telemetryCoverage([{ startDate: "2026-09-01", endDate: "2026-09-20" }, { startDate: "2026-09-15", endDate: "2026-09-30" }], filters), "parcial");
});

test("changed spreadsheet invalidates the metric cache", async t => {
  const write = await reports(t);
  const file = await write("01-09-2026", "30-09-2026", 100);
  await getTelemetriaResumoPorPlaca(filters);
  await write("01-09-2026", "30-09-2026", 200);
  await fs.utimes(file, new Date(), new Date(Date.now() + 2000));
  assert.equal((await getTelemetriaResumoPorPlaca(filters)).byPlate[0].distanciaKm, 200);
});
