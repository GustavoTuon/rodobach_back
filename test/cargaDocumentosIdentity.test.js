import test from "node:test";
import assert from "node:assert/strict";
import { resolveCargaDocumento, deliveredCargaIds } from "../src/services/cargaDocumentosIdentity.js";

const cte = { empresa: "1", serie: "1", numero: "123", chave: "key", placa: "ABC1234", entregue: true };
const budget = { ...cte, serie: "C", chave: "", entregue: false };

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
