import test from "node:test";
import assert from "node:assert/strict";
import { detectChanges } from "../src/change-detector.js";

const sm = {
  id: 123,
  link_rota: "https://example.test/rota",
  veiculoPlaca: "ABC1D23",
  referenciaOrigemDescricao: "Origem",
  referenciaDestinoDescricao: "Destino",
  statusViagemCodigo: "1",
};

test("primeira execução cria baseline e não dispara históricos", () => {
  const state = { initialized: false, sms: {}, routeChanges: {}, deliveries: [] };
  const result = detectChanges(state, [sm], [{ viag_codigo: 123, rota_codigo: 9, vrot_data_cadastro: "hoje" }]);
  assert.equal(result.events.length, 0);
  assert.equal(result.next.initialized, true);
});

test("detecta uma nova SM depois do baseline", () => {
  const state = { initialized: true, sms: {}, routeChanges: {}, deliveries: [] };
  const result = detectChanges(state, [sm], []);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0].reasons, ["SM criada"]);
});

test("agrupa alteração da SM e da rota em um envio", () => {
  const baseline = detectChanges(
    { initialized: false, sms: {}, routeChanges: {}, deliveries: [] },
    [sm],
    [],
  ).next;
  const changed = { ...sm, referenciaDestinoDescricao: "Novo destino" };
  const result = detectChanges(baseline, [changed], [{
    viag_codigo: 123,
    rota_codigo: 10,
    vrot_data_cadastro: "agora",
    vrot_operacao: "ALTERAÇÃO",
  }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].reasons.length, 2);
});
