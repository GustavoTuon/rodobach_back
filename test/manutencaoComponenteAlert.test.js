import test from "node:test";
import assert from "node:assert/strict";
import { componentAlertType } from "../src/services/manutencaoAlertaService.js";

test("alerta de componente respeita condição crítica e atenção", () => {
  assert.equal(componentAlertType({ id: 1, condicao: "CRITICO" }, 100000).type, "vencido");
  assert.equal(componentAlertType({ id: 2, condicao: "ATENCAO" }, 100000).type, "antecipado");
});

test("alerta de componente usa faixa de 10% do intervalo por KM", () => {
  const item = { id: 3, km_servico: 100000, proximo_km: 200000 };
  assert.equal(componentAlertType(item, 189999), null);
  assert.equal(componentAlertType(item, 190000).type, "antecipado");
  assert.equal(componentAlertType(item, 200001).type, "vencido");
});

test("alerta de componente considera vencimento por data", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  assert.equal(componentAlertType({ id: 4, proxima_data: "2026-09-20" }, null, now), null);
  assert.equal(componentAlertType({ id: 4, proxima_data: "2026-09-01" }, null, now).type, "antecipado");
  assert.equal(componentAlertType({ id: 4, proxima_data: "2026-08-12" }, null, now).type, "vencido");
});
