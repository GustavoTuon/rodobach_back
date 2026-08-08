import assert from "node:assert/strict";
import test from "node:test";

import { buildClientAvailabilityMessage } from "../src/services/oportunidadesRetornoService.js";

test("monta mensagem individual perguntando por carga disponível", () => {
  const message = buildClientAvailabilityMessage({
    sm: { placa: "RAA8G18" },
    destino: { descricao: "BOA VISTA/PB" },
    cliente: { nome: "Cliente teste", contato: "Maria", cidade: "CAMPINA GRANDE", uf: "PB" },
  });

  assert.match(message, /Olá, Maria/);
  assert.match(message, /veículo RAA8G18 disponível na região de BOA VISTA\/PB/);
  assert.match(message, /carga disponível para embarque em CAMPINA GRANDE\/PB/);
  assert.match(message, /destino, produto, peso e previsão de carregamento/);
});
