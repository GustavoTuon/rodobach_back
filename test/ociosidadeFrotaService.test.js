import assert from "node:assert/strict";
import test from "node:test";
import { buildEmptyIntervals, buildSmOperationalIntervals } from "../src/services/ociosidadeFrotaService.js";

test("intervalo vazio vai da entrega ate a proxima operacao", () => {
  const rows = buildEmptyIntervals([
    { placa: "ABC1D23", operacao_at: "2026-08-01T10:00:00Z", entrega_at: "2026-08-02T10:00:00Z", serie: "1", numero: 10 },
    { placa: "ABC1D23", operacao_at: "2026-08-03T08:00:00Z", entrega_at: "2026-08-04T10:00:00Z", serie: "1", numero: 11 },
  ], "2026-08-01", "2026-08-05", new Date("2026-08-05T12:00:00Z"));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].inicio, "2026-08-02T10:00:00.000Z");
  assert.equal(rows[1].fim, "2026-08-03T08:00:00.000Z");
  assert.equal(rows[1].proximoDocumento, "1-11");
});

test("multiplos CT-es entregues antes da proxima carga iniciam no ultimo descarregamento", () => {
  const rows = buildEmptyIntervals([
    { placa: "ABC1D23", operacao_at: "2026-08-01T08:00:00Z", entrega_at: "2026-08-02T08:00:00Z", numero: 10 },
    { placa: "ABC1D23", operacao_at: "2026-08-01T09:00:00Z", entrega_at: "2026-08-02T12:00:00Z", numero: 11 },
    { placa: "ABC1D23", operacao_at: "2026-08-03T08:00:00Z", entrega_at: null, numero: 12 },
  ], "2026-08-01", "2026-08-05", new Date("2026-08-05T12:00:00Z"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inicio, "2026-08-02T12:00:00.000Z");
  assert.equal(rows[0].fim, "2026-08-03T08:00:00.000Z");
});

test("ignora entrega anterior a emissao do proprio CT-e", () => {
  const rows = buildEmptyIntervals([
    { placa: "ABC1D23", operacao_at: "2026-08-28T14:58:00Z", entrega_at: "2026-08-28T03:00:00Z", numero: 1233 },
  ], "2026-08-01", "2026-09-03", new Date("2026-09-03T12:00:00Z"));
  assert.equal(rows.length, 0);
});

test("usa fim e inicio das SMs como intervalo vazio provavel", () => {
  const result = buildSmOperationalIntervals([
    { id: 10, placa: "ABC1D23", inicio: "01/08/2026 08:00:00", fim: "02/08/2026 10:00:00", destino: "Cidade A" },
    { id: 11, placa: "ABC1D23", inicio: "03/08/2026 09:00:00", fim: "04/08/2026 12:00:00" },
  ], "2026-08-01", "2026-08-05", new Date("2026-08-05T15:00:00Z"));
  assert.equal(result.loaded.length, 2);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].documento, "SM 10");
  assert.equal(result.gaps[0].proximoDocumento, "SM 11");
  assert.equal(result.gaps[0].classificacao, "vazio_provavel");
});

test("separa SM explicitamente vazia", () => {
  const result = buildSmOperationalIntervals([
    { id: 20, placa: "ABC1D23", inicio: "01/08/2026 08:00:00", fim: "01/08/2026 12:00:00", operacao: "VEICULO VAZIO" },
  ], "2026-08-01", "2026-08-02", new Date("2026-08-02T15:00:00Z"));
  assert.equal(result.loaded.length, 0);
  assert.equal(result.confirmedEmpty.length, 1);
});
