import test from "node:test";
import assert from "node:assert/strict";
import { resolveCargaDocumento, deliveredCargaIds } from "../src/services/cargaDocumentosIdentity.js";
import { manifestoCompletion } from "../src/services/tripManifestos.js";

const cte = { empresa: "1", serie: "1", numero: "123", chave: "key", placa: "ABC1234", entregue: true };
const budget = { ...cte, serie: "C", chave: "", entregue: false };

test("only closed manifests confirm delivery; partial, cancelled and future closures remain pending", () => {
  const now = new Date("2026-10-20T15:00:00Z");
  const doc = { placa: "ABC1234", emissaoAt: "2026-10-15T12:00:00Z" };
  const closed = { placa: "ABC1234", statusCodigo: 7, autorizadoEm: "2026-10-16T12:00:00Z", encerradoEm: "2026-10-19T12:00:00Z" };
  assert.equal(manifestoCompletion({ ...doc, manifestos: [closed] }, now), closed.encerradoEm);
  for (const manifests of [
    [], [{...closed,statusCodigo:5,encerradoEm:null}],
    [closed,{...closed,statusCodigo:5,encerradoEm:null}],
    [{...closed,statusCodigo:6}],
    [{...closed,encerradoEm:"2026-10-21T12:00:00Z"}],
    [{...closed,encerradoEm:"2026-10-14T12:00:00Z"}],
    [{...closed,encerradoEm:"2026-10-16T10:00:00Z"}],
    [{...closed,placa:"XYZ9999"}],
    [{...closed,encerradoEm:"invalid"}],
  ]) assert.equal(manifestoCompletion({ ...doc, entregaAt:"2026-10-19", manifestos:manifests }, now), null);
  assert.equal(manifestoCompletion({ ...doc, manifestos:[closed,{...closed,statusCodigo:6}] }, now), closed.encerradoEm);
});

test("same number in different series and companies resolves independently", () => {
  const other = { ...budget, empresa: "2" };
  assert.equal(resolveCargaDocumento(budget, [cte, budget, other]), budget);
  assert.equal(resolveCargaDocumento(other, [cte, budget, other]), other);
  assert.equal(resolveCargaDocumento({ ...budget, numero: "000123" }, [cte, budget]), budget);
});

test("known key or identity never falls back to a conflicting number", () => {
  assert.equal(resolveCargaDocumento({ ...cte, chave: "missing" }, [cte]), null);
  assert.equal(resolveCargaDocumento({ ...budget, empresa: "3" }, [budget]), null);
});

test("legacy references require a unique candidate; matching plate alone cannot disambiguate series", () => {
  const legacy = { numero: "123", placa: "ABC1234" };
  assert.equal(resolveCargaDocumento(legacy, [cte, budget], { plate: true }), null);
  assert.equal(resolveCargaDocumento(legacy, [cte], { plate: true }), cte);
  assert.equal(resolveCargaDocumento({ numero: "123" }, [cte], { plate: true }), null);
  assert.equal(resolveCargaDocumento(legacy, [cte, budget]), null);
});

test("only cargas with every document confirmed delivered may complete", () => {
  const documents = [
    { ...cte, carga_id: 1 }, { ...budget, carga_id: 1 },
    { ...cte, carga_id: 2 },
    { numero: "123", placa: "ABC1234", carga_id: 3 },
    { numero: "", carga_id: 4 },
    { ...cte, chave: "unknown", carga_id: 5 },
  ];
  assert.deepEqual(deliveredCargaIds(documents, [cte, budget]), [2]);
  assert.deepEqual(deliveredCargaIds(documents, [cte, { ...budget, entregue: true }]), [1, 2]);
  assert.deepEqual(deliveredCargaIds(documents, [{ ...cte, entregue: false }, budget]), []);
});
