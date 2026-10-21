import test from "node:test";
import assert from "node:assert/strict";
import {
  purchasePlan,
  proposalVersion,
} from "../src/services/purchasesSelection.js";
test("resumo usa quantidade solicitada, desconto e frete uma vez por fornecedor", () => {
  const quote = {
    status: "aberta",
    itens: [
      { id: "p", nome: "P", quantidade: 2, unidade: "UN" },
      { id: "q", nome: "Q", quantidade: 3, unidade: "UN" },
    ],
    escolhas: {},
  };
  const invite = {
    id: "v",
    nome: "Fornecedor",
    respondido_em: "2026-10-19T00:00:00Z",
    resposta: {
      frete: 12,
      itens: [
        { id: "p", disponivel: true, valor: 10, quantidade: 100, marca: "X" },
        { id: "q", disponivel: true, valor: 20, quantidade: 3, marca: "Y" },
      ],
    },
    descontos: { p: { original: 10, valor: 8 } },
  };
  const version = proposalVersion(invite);
  quote.escolhas = {
    p: { conviteId: "v", versaoProposta: version, quantidadeConfirmada: true },
    q: { conviteId: "v", versaoProposta: version },
  };
  const plan = purchasePlan(quote, [invite]);
  assert.equal(plan.completa, true);
  assert.equal(plan.subtotal, 76);
  assert.equal(plan.total, 88);
  assert.equal(plan.frete, 12);
  assert.equal(plan.desconto, 4);
  assert.equal(plan.fornecedores.length, 1);
  invite.descontos.p.valor = 7;
  const revised = purchasePlan(quote, [invite]);
  assert.equal(revised.revisar, 2);
  assert.equal(revised.total, 0);
  assert.equal(revised.completa, false);
});
test("nova resposta invalida a escolha mesmo mantendo o preço", () => {
  const invite = {
    id: "v",
    respondido_em: "2026-10-19T00:00:00Z",
    resposta: {
      frete: 0,
      itens: [{ id: "p", disponivel: true, valor: 10, quantidade: 2 }],
    },
  };
  const quote = {
    status: "aberta",
    itens: [{ id: "p", quantidade: 2 }],
    escolhas: {
      p: { conviteId: "v", versaoProposta: proposalVersion(invite) },
    },
  };
  invite.respondido_em = "2026-10-19T01:00:00Z";
  assert.equal(purchasePlan(quote, [invite]).revisar, 1);
  quote.escolhas.p.versaoProposta = proposalVersion(invite);
  quote.status = "cancelada";
  assert.equal(purchasePlan(quote, [invite]).completa, false);
});

test("quantidade maior exige confirmação para entrar no total", () => {
  const invite = {
    id: "v",
    resposta: {
      frete: 0,
      itens: [{ id: "p", disponivel: true, valor: 10, quantidade: 30 }],
    },
  };
  const quote = {
    status: "aberta",
    itens: [{ id: "p", quantidade: 10 }],
    escolhas: {
      p: { conviteId: "v", versaoProposta: proposalVersion(invite) },
    },
  };
  assert.equal(purchasePlan(quote, [invite]).total, 0);
  assert.equal(purchasePlan(quote, [invite]).revisar, 1);
  quote.escolhas.p.quantidadeConfirmada = true;
  assert.equal(purchasePlan(quote, [invite]).total, 100);
});
