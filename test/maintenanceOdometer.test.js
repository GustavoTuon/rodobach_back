import assert from "node:assert/strict";
import test from "node:test";
import { latestValidFuelOdometer, resolveMaintenanceOdometer, loadMaintenanceOdometers } from "../src/services/maintenanceOdometer.js";
import { clientPool } from "../src/db/clientPool.js";
import { getVeiculosPool } from "../src/db/pool-veiculos.js";
import { config } from "../src/config.js";

test("new valid fuel readings update the reference without following a lower tracker", () => {
  const telemetry = {odometro: 230327, data_hora: "2026-09-21T15:00:00Z"};
  const before = resolveMaintenanceOdometer(telemetry, {km: 305059, data_ref: "2026-09-19"});
  const fuel = latestValidFuelOdometer([{km: 305059, data_ref: "2026-09-19"}, {km: 305600, data_ref: "2026-09-21"}], new Date("2026-09-21T16:00:00Z"));
  const after = resolveMaintenanceOdometer(telemetry, fuel);
  assert.equal(before.km_atual, 305059);
  assert.equal(after.km_atual, 305600);
  assert.equal(after.km_fonte, "abastecimento");
  assert.equal(after.km_data, "2026-09-21");
  assert.equal(after.telemetria_descartada, true);
});

test("fuel validation excludes future dates, decreases and implausible jumps", () => {
  const now = new Date("2026-09-21T16:00:00Z");
  const prior = {km: 305059, data_ref: "2026-09-19"};
  for (const bad of [{km: 900000, data_ref: "2026-09-21"}, {km: 304000, data_ref: "2026-09-21"}, {km: 306000, data_ref: "2026-09-22"}]) {
    assert.equal(latestValidFuelOdometer([prior, bad], now).km, 305059);
  }
});

test("uses corrected telemetry only when newer and compatible", () => {
  const fuel = {km: 305059, data_ref: "2026-09-19"};
  assert.equal(resolveMaintenanceOdometer({odometro: 305500, data_hora: "2026-09-21"}, fuel).km_fonte, "telemetria");
  assert.equal(resolveMaintenanceOdometer({odometro: 305500, data_hora: "2026-09-18"}, fuel).km_fonte, "abastecimento");
  assert.equal(resolveMaintenanceOdometer(null, null).km_atual, null);
});

test("shared loader re-reads fuel and retrieves positive telemetry rather than zero positions", async t => {
  const originalHost = config.veiculosDb.host;
  config.veiculosDb.host = "127.0.0.1";
  t.after(() => { config.veiculosDb.host = originalHost; });
  let fuelKm = 305059;
  const erpMock = t.mock.method(clientPool, "query", async () => ({rows: [{placa: "RYP7D29", km: fuelKm, data_ref: "2026-09-19"}]}));
  t.mock.method(getVeiculosPool(), "query", async sql => {
    assert.match(sql, /odometro > 0/);
    return {rows: [{placa: "RYP7D29", odometro: 230327, data_hora: "2026-09-21"}]};
  });
  assert.equal((await loadMaintenanceOdometers(["RYP-7D29"])).get("RYP7D29").km_atual, 305059);
  fuelKm = 305800;
  assert.equal((await loadMaintenanceOdometers(["RYP7D29"])).get("RYP7D29").km_atual, 305800);
  assert.equal(erpMock.mock.callCount(), 2);
});
