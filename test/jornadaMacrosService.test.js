import assert from "node:assert/strict";
import test from "node:test";
import { calculateMacroWork, macroState } from "../src/services/jornadaMacrosService.js";

test("classifica macros de inicio, reinicio e parada", () => {
  assert.equal(macroState("02. INICIO DE VIAGEM"), "trabalhando");
  assert.equal(macroState("03. REINICIO DE VIAGEM\r\n03. REINICIO DE VIAGEM"), "trabalhando");
  assert.equal(macroState("06. PARADA PARA REFEICAO"), "parado");
});

test("calcula trechos trabalhados entre reinicios e paradas", () => {
  const result = calculateMacroWork([
    { dataHora: "2026-08-31T10:00:00Z", descricao: "02. INICIO DE VIAGEM" },
    { dataHora: "2026-08-31T12:00:00Z", descricao: "06. PARADA PARA REFEICAO" },
    { dataHora: "2026-08-31T13:00:00Z", descricao: "03. REINICIO DE VIAGEM" },
    { dataHora: "2026-08-31T16:30:00Z", descricao: "16. FIM DE VIAGEM" },
  ], new Date("2026-08-31T17:00:00Z"));
  assert.equal(result.resumo.horasTrabalhadas, 5.5);
  assert.equal(result.resumo.horasParadas, 1.5);
  assert.equal(result.resumo.trechosTrabalhados, 2);
  assert.equal(result.resumo.maiorTrechoHoras, 3.5);
});
