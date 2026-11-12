import test from "node:test";
import assert from "node:assert/strict";
import {
  previousFuelPeriod,
  compareFuel,
} from "../src/services/fuelComparison.js";
test("closed months compare with closed months across year boundary", () => {
  assert.deepEqual(
    previousFuelPeriod({ startDate: "2026-01-01", endDate: "2026-03-31" }),
    { startDate: "2025-10-01", endDate: "2025-12-31" },
  );
  assert.deepEqual(
    previousFuelPeriod({ startDate: "2026-11-05", endDate: "2026-11-11" }),
    { startDate: "2026-10-29", endDate: "2026-11-04" },
  );
});
test("consumption uses inverse km/l and requires complete comparable readings", () => {
  const make = (media, completo = true) => ({
    summary: { valor: 100, litros: 50, precoMedioPonderado: 2 },
    ranking: [{ placa: "ABC1234", media, cobertura: { completo } }],
  });
  const result = compareFuel(make(2), make(2.5), {});
  assert.equal(result.vehicles[0].variacao, 25);
  assert.equal(result.vehicles[0].status, "alerta");
  assert.equal(
    compareFuel(make(2, false), make(2.5), {}).vehicles[0].variacao,
    null,
  );
  assert.equal(
    compareFuel(make(null), make(2.5), {}).vehicles[0].status,
    "pendente",
  );
  assert.equal(
    compareFuel(make(3), make(2.5), {}).vehicles[0].status,
    "melhora",
  );
  assert.equal(
    compareFuel(make(2.5), make(2.5), {}).vehicles[0].status,
    "estavel",
  );
});
