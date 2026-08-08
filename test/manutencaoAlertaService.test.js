import assert from "node:assert/strict";
import test from "node:test";

import { buildMaintenanceAlertMessage, latestValidFuelOdometer } from "../src/services/manutencaoAlertaService.js";

const item = {
  placa: "RYI6H21",
  titulo: "Troca de filtro de combustível",
  tipo_controle: "km",
  km_proximo_envio: 420000,
  mensagem: "O veículo atingiu o marco programado. Verifique e programe a manutenção.",
};

test("alerta antecipado informa que o marco está próximo", () => {
  const message = buildMaintenanceAlertMessage(item, null, { type: "antecipado", remaining: 192 }, 419808);

  assert.match(message, /Faltam 192 km/);
  assert.match(message, /O veículo está próximo do marco programado/);
  assert.doesNotMatch(message, /O veículo atingiu o marco programado/);
});

test("alerta vencido mantém a informação de marco atingido", () => {
  const message = buildMaintenanceAlertMessage(item, null, { type: "vencido", remaining: -10 }, 420010);

  assert.match(message, /Marco excedido em 10 km/);
  assert.match(message, /O veículo atingiu o marco programado/);
});

test("odômetro de abastecimento ignora salto incompatível", () => {
  const reading = latestValidFuelOdometer([
    { data_ref: "2026-08-08", km: 900000 },
    { data_ref: "2026-08-04", km: 353625 },
    { data_ref: "2026-08-03", km: 353211 },
  ]);

  assert.equal(reading.km, 353625);
});

test("odômetro de abastecimento aceita evolução coerente", () => {
  const reading = latestValidFuelOdometer([
    { data_ref: "2026-08-08", km: 355100 },
    { data_ref: "2026-08-04", km: 353625 },
  ]);

  assert.equal(reading.km, 355100);
});
