import test from "node:test";
import assert from "node:assert/strict";
import { validateConfirmation, applyConfirmations, documentKey } from "../src/services/conferenciaDocumentos.js";
import { buildDocumentWindows, buildDocumentAudit } from "../src/services/documentosOciosidade.js";
const a = { placa: "RXO6C18", empresa: 1, serie: "1", codigo: 4375, numero: 4375, emissao_documento_at: "2026-08-24T23:40:00Z", entrega_at: "2026-08-31T03:00:00Z" };
const b = { ...a, codigo: 4376, numero: 4376 };
const c = { id: 10, placa: a.placa, documentos: [documentKey(a),documentKey(b)], inicio: "2026-08-25T18:00:00Z", fim: "2026-08-29T17:00:00Z" };
test("confirma grupo sem alterar originais nem duplicar carga", () => {
  const docs = applyConfirmations([a,b], [c]);
  const windows = buildDocumentWindows(docs, "2026-08-01T03:00:00.000Z", "2026-09-01T03:00:00.000Z");
  assert.equal(windows.loaded.length, 1);
  assert.equal(windows.loaded[0].fim, "2026-08-29T17:00:00.000Z");
  assert.equal(docs[0].emissaoOriginal, a.emissao_documento_at);
  assert.equal(a.entrega_at, "2026-08-31T03:00:00Z");
  const audit = buildDocumentAudit(docs, "2026-08-01T03:00:00.000Z", "2026-09-01T03:00:00.000Z");
  assert.equal(audit[0].proximoDocumento, null);
  assert.equal(applyConfirmations([a],[])[0].confirmacaoId, undefined);
});
test("rejeita horarios invertidos e documentos de outra placa", () => {
  assert.throws(() => validateConfirmation({ ...c, fim: c.inicio }), /horários/);
  assert.throws(() => validateConfirmation({ ...c, documentos: ["ABC1D23|1|1|4375"] }), /horários/);
  assert.equal(validateConfirmation(c).inicio, "2026-08-25T18:00:00.000Z");
});
