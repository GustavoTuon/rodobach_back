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

test("certificado vencido não anuncia vencimento próximo", () => {
  const message = buildMaintenanceAlertMessage({...item, tipo_controle: "data", data_proximo_envio: "2026-09-20", mensagem: "O certificado está próximo do vencimento."}, null, {type: "vencido", remaining: -1}, 617731);
  assert.match(message, /certificado está vencido/);
  assert.doesNotMatch(message, /próximo do vencimento/);
});

test("alerta antecipado informa que o marco está próximo", () => {
  const message = buildMaintenanceAlertMessage(item, null, { type: "antecipado", remaining: 192 }, 419808);

  assert.match(message, /Faltam 192 km/);
  assert.match(message, /O veículo está próximo do marco programado/);
  assert.doesNotMatch(message, /O veículo atingiu o marco programado/);
});

test("alerta baseado no abastecimento informa data e não afirma quilometragem atual", () => {
  const message = buildMaintenanceAlertMessage({...item, km_fonte: "abastecimento", km_data: "2026-09-19", telemetria_descartada: true}, null, {type: "vencido", remaining: -59}, 305059);
  assert.match(message, /Último KM registrado:\* 305.059 km/);
  assert.match(message, /Abastecimento — 19\/09\/2026/);
  assert.match(message, /não inclui o percurso posterior/);
  assert.match(message, /Telemetria divergente desconsiderada/);
  assert.doesNotMatch(message, /KM atual|�|\?\?/);
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
