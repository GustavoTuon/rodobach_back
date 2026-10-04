import test from "node:test";
import assert from "node:assert/strict";
import { buildRouteMessage } from "../src/message.js";
import { normalizeWhatsappNumber } from "../src/phone-resolver.js";

test("normaliza celular brasileiro", () => {
  assert.equal(normalizeWhatsappNumber("(48) 99999-9999"), "5548999999999");
});

test("mensagem utiliza o link oficial da Trafegus", () => {
  const text = buildRouteMessage({
    id: 42,
    veiculoPlaca: "ABC1D23",
    referenciaOrigemDescricao: "A",
    referenciaDestinoDescricao: "B",
    link_rota: "https://elite.trafegus.com.br/guia-viagem?codigo=x",
  }, "João", ["SM criada"]);
  assert.match(text, /rota oficial/);
  assert.match(text, /guia-viagem/);
});
