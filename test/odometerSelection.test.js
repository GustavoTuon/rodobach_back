import assert from "node:assert/strict";
import test from "node:test";
import { selectCurrentOdometer } from "../src/services/odometerSelection.js";

test("descarta telemetria muito abaixo do ERP", () => {
  const result = selectCurrentOdometer({ telemetryKm: 13844, telemetryDate: "2026-08-12", erpKm: 355128, erpDate: "2026-08-10" });
  assert.equal(result.km, 355128);
  assert.equal(result.source, "erp");
  assert.equal(result.telemetryRejected, true);
});

test("aceita telemetria com avanço plausível após o ERP", () => {
  const result = selectCurrentOdometer({ telemetryKm: 356482, telemetryDate: "2026-08-12", erpKm: 355128, erpDate: "2026-08-10" });
  assert.equal(result.km, 356482);
  assert.equal(result.source, "telemetria");
});

test("usa ERP ligeiramente maior sem marcar telemetria como inválida", () => {
  const result = selectCurrentOdometer({ telemetryKm: 354900, telemetryDate: "2026-08-12", erpKm: 355128, erpDate: "2026-08-10" });
  assert.equal(result.km, 355128);
  assert.equal(result.telemetryRejected, false);
});

test("descarta salto de telemetria incompatível com o tempo decorrido", () => {
  const result = selectCurrentOdometer({ telemetryKm: 900000, telemetryDate: "2026-08-12", erpKm: 355128, erpDate: "2026-08-10" });
  assert.equal(result.km, 355128);
  assert.equal(result.rejectionReason, "salto_telemetria_incompativel");
});
