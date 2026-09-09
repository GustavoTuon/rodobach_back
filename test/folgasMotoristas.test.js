import test from "node:test";
import assert from "node:assert/strict";
import { buildBaseCycles } from "../src/services/folgasMotoristasService.js";

test("calcula ciclo entre saida e retorno confirmados pela cerca", () => {
  const cycles = buildBaseCycles([
    { na_base: true, inicio: "2026-09-01T08:00:00Z", fim: "2026-09-01T09:00:00Z" },
    { na_base: false, inicio: "2026-09-01T09:01:00Z", fim: "2026-09-03T10:00:00Z" },
    { na_base: true, inicio: "2026-09-03T10:01:00Z", fim: "2026-09-03T11:00:00Z" },
  ], [{ data_hora: "2026-09-02T08:00:00Z", macro_descricao: "REINICIO DE VIAGEM" }]);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].saidaEm, "2026-09-01T09:01:00.000Z");
  assert.equal(cycles[0].retornoEm, "2026-09-03T10:01:00.000Z");
  assert.equal(cycles[0].diasTrabalhados, 2);
  assert.equal(cycles[0].macrosConfirmacao, 1);
});

test("ignora oscilacao curta de GPS e nao inventa saida antes de observar a base", () => {
  const cycles = buildBaseCycles([
    { na_base: false, inicio: "2026-09-01T07:00:00Z", fim: "2026-09-01T08:00:00Z" },
    { na_base: true, inicio: "2026-09-01T08:01:00Z", fim: "2026-09-01T09:00:00Z" },
    { na_base: false, inicio: "2026-09-01T09:01:00Z", fim: "2026-09-01T09:05:00Z" },
    { na_base: true, inicio: "2026-09-01T09:06:00Z", fim: "2026-09-01T10:00:00Z" },
  ]);
  assert.equal(cycles.length, 0);
});
