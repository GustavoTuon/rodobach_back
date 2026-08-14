import test from "node:test";
import assert from "node:assert/strict";
import { calcularSituacaoViagem } from "../src/mappers.js";

const viagemCompleta = {
  placa: "ABC1D23", cliente: "Cliente", material: "Carga", valorCliente: 1000,
  origem: "Origem", destino: "Destino", vehicleOwnershipType: "FROTA",
};

test("viagem completa sem CT-e aguarda CT-e", () => {
  assert.equal(calcularSituacaoViagem({ ...viagemCompleta, documentosFinanceiros: [{ tipo: "NF-e", numero: "123" }] }), "aguardando_cte");
});

test("CT-e valido coloca viagem em transito", () => {
  assert.equal(calcularSituacaoViagem({ ...viagemCompleta, documentosFinanceiros: [{ tipo: "CT-e", numero: "456" }] }), "em_transito");
});

test("CT-e vazio nao altera o status", () => {
  assert.equal(calcularSituacaoViagem({ ...viagemCompleta, documentosFinanceiros: [{ tipo: "CT-e", numero: "", chave: "" }] }), "aguardando_cte");
});

test("status final manual e preservado", () => {
  assert.equal(calcularSituacaoViagem({ ...viagemCompleta, situacao: "entregue", documentosFinanceiros: [] }), "entregue");
});
