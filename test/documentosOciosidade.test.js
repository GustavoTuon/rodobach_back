import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentWindows, buildDocumentAudit } from "../src/services/documentosOciosidade.js";
const start = "2026-08-01T03:00:00.000Z", end = "2026-09-01T02:59:59.000Z";
const doc = { placa: "RXO6C18", serie: "O", numero: 1209, emissao_documento_at: "2026-08-04T13:47:00Z", entrega_at: "2026-08-06T03:00:00Z", entrega_precisa: false };
test("auditoria preserva cada documento e identifica sobreposicao", () => {
  const rows = buildDocumentAudit([doc, { ...doc, numero: 4274, emissao_documento_at: "2026-08-04T18:00:00Z" }], start, end);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "Datas sobrepostas: conferir viagem");
  assert.equal(rows[0].kmVazio, null);
});
test("auditoria cria janela entre entrega e proxima emissao", () => {
  const rows = buildDocumentAudit([doc, { ...doc, numero: 1215, emissao_documento_at: "2026-08-08T15:00:00Z", entrega_at: "2026-08-10T03:00:00Z" }], start, end);
  assert.equal(rows[0].status, "Estimativa entre documentos");
  assert.equal(rows[0].inicio, "2026-08-07T03:00:00.000Z");
});
test("usa emissao e une orcamento e CTe sobrepostos", () => {
  const r = buildDocumentWindows([doc, { ...doc, serie: "1", numero: 4274, emissao_documento_at: "2026-08-04T18:16:00Z" }], start, end);
  assert.equal(r.loaded.length, 1);
  assert.equal(r.loaded[0].inicio, "2026-08-04T13:47:00.000Z");
  assert.equal(r.gaps[0].inicio, "2026-08-07T03:00:00.000Z");
});
test("ignora entrega invalida e limita janelas ao filtro", () => {
  const r = buildDocumentWindows([doc, { ...doc, entrega_at: null }], "2026-08-05T03:00:00.000Z", end);
  assert.equal(r.ignored, 1);
  assert.equal(r.loaded[0].inicio, "2026-08-05T03:00:00.000Z");
});
