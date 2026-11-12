import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateFuel,
  buildFuelAnalysis,
  validateFuelKm,
  getFuelAnalysis,
} from "../src/services/fuelAnalysisService.js";
const row = (data, extra = {}) => ({
  data,
  id: "1",
  placa: "ABC1234",
  combustivelCodigo: "4",
  combustivel: "DIESEL S10",
  litros: 100,
  total: 600,
  km: 300,
  odometro: 10000,
  desconto: 10,
  posto: "1",
  postoNome: "Posto",
  modelo: "Modelo",
  ...extra,
});
test("uses weighted recorded distance and liters, without daily tracker readings", () => {
  const result = aggregateFuel([
    row("2026-10-01"),
    row("2026-10-05", { litros: 200, km: 500 }),
  ]);
  assert.equal(result.ranking[0].media, 800 / 300);
  assert.equal(result.ranking[0].km, 800);
  assert.equal(result.ranking[0].cobertura.completo, true);
  assert.equal(result.summary.valor, 1200);
});
test("missing KM and additive keep expenses but block consumption comparison", () => {
  const result = aggregateFuel([
    row("2026-10-01"),
    row("2026-10-05", { km: 0 }),
  ]);
  assert.equal(result.ranking[0].media, null);
  assert.equal(result.summary.valor, 1200);
  assert.equal(
    aggregateFuel([row("2026-10-01", { combustivel: "ARLA" })]).ranking[0]
      .media,
    null,
  );
});
test("filters vehicle, fuel and period consistently on both sides and preserves options", () => {
  const rows = [
    row("2026-09-01"),
    row("2026-09-15"),
    row("2026-10-01", { km: 250 }),
    row("2026-10-15", { km: 250 }),
    row("2026-10-01", { placa: "DEF5678" }),
    row("2026-10-05", { combustivel: "GASOLINA", combustivelCodigo: "9" }),
  ];
  const result = buildFuelAnalysis(
    rows,
    {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      placa: "ABC1234",
      combustivel: "4",
    },
    { startDate: "2026-09-01", endDate: "2026-09-30" },
  );
  assert.equal(result.lancamentos.length, 2);
  assert.equal(result.summary.valor, 1200);
  assert.equal(result.filterOptions.placas.length, 2);
  assert.equal(result.filterOptions.combustiveis.length, 2);
  assert.ok(Math.abs(result.comparison.vehicles[0].variacao - 20) < 0.001);
  const station = buildFuelAnalysis(
    rows,
    { startDate: "2026-10-01", endDate: "2026-10-31", fornecedor: "1" },
    { startDate: "2026-09-01", endDate: "2026-09-30" },
  );
  assert.equal(station.comparison.vehicles[0].variacao, null);
});
test("flags odometer regression and impossible travel without removing expense", () => {
  const result = validateFuelKm([
    row("2026-10-01"),
    row("2026-10-02", { id: "2", odometro: 96770, km: 86770 }),
    row("2026-10-03", { id: "3", odometro: 10500 }),
  ]);
  assert.equal(result[0].kmValido, true);
  assert.equal(result[1].kmValido, false);
  assert.equal(result[2].kmValido, false);
  assert.equal(aggregateFuel(result).summary.valor, 1800);
  assert.equal(aggregateFuel(result).ranking[0].media, null);
});
test("rejects invalid dates before querying", async () => {
  await assert.rejects(
    getFuelAnalysis({ startDate: "2026-02-30", endDate: "2026-03-31" }),
    { status: 400 },
  );
});
