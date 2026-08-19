import test from "node:test";
import assert from "node:assert/strict";

import { applyFinancialRevenue, routeUf } from "../src/services/resultadoFretesService.js";

test("usa a receita financeira e rateia um título entre CT-es vinculados", () => {
  const logistics = [
    { id: "a", empresa: 1, numero: 10, receita: 300, custo: 100 },
    { id: "b", empresa: 1, numero: 20, receita: 100, custo: 50 },
    { id: "correcao", empresa: 1, numero: 30, receita: 999, custo: 0 },
  ];
  const financial = [
    { categoriaDre: "RECEITA BRUTA", ctes: "10, 20", valor: 200, detailKey: { empresa: 1 } },
    { categoriaDre: "RECEITA BRUTA", ctes: null, valor: 80, detailKey: { empresa: 1 } },
  ];

  const result = applyFinancialRevenue(logistics, financial);

  assert.equal(result.documents.length, 2);
  assert.equal(result.documents.find(row => row.id === "a").receita, 150);
  assert.equal(result.documents.find(row => row.id === "b").receita, 50);
  assert.equal(result.summary.officialFinancialValue, 280);
  assert.equal(result.summary.linkedFinancialValue, 200);
  assert.equal(result.summary.unclassifiedFinancialValue, 80);
  assert.equal(result.summary.logisticsDocumentsExcluded, 1);
});

test("identifica UF em formatos usuais de rota", () => {
  assert.equal(routeUf("JOINVILLE/SC"), "SC");
  assert.equal(routeUf("JOINVILLE / SC"), "SC");
  assert.equal(routeUf("JOINVILLE - SC"), "SC");
  assert.equal(routeUf("JOINVILLE, SC"), "SC");
});
