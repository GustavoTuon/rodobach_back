import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { comprasRouter, comprasPublicRouter } from "../src/routes/compras.js";
import { requireRoutePermission } from "../src/middleware/permissions.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import {
  parsePurchase,
  quoteSchema,
  responseSchema,
  validateAssignedItems,
} from "../src/services/purchases.js";
const id = "55926d25-6e7d-4c22-a36d-747c0402c18a",
  other = "65926d25-6e7d-4c22-a36d-747c0402c18a";
const token = "a".repeat(64);
const auth =
  "Bearer " +
  jwt.sign({ sub: id, version: 1 }, config.jwtSecret, {
    audience: "compras-fornecedor",
    issuer: "rodobach",
  });
const account = {
  fornecedor_id: id,
  versao: 1,
  ativo: true,
  troca_obrigatoria: false,
};
const body = {
  frete: 10,
  prazoEntrega: "2 dias",
  pagamento: "30 dias",
  itens: [{ id, disponivel: true, quantidade: 2, valor: 12, marca: "ABC" }],
};
function app(user) {
  const a = express();
  a.use(express.json());
  a.use(comprasPublicRouter);
  a.use((req, res, next) => {
    req.user = user;
    next();
  });
  a.use(requireRoutePermission);
  a.use(comprasRouter);
  a.use(errorHandler);
  return a;
}
test("valida quantidade, preço, marca e duplicação de produtos", () => {
  assert.throws(() =>
    parsePurchase(responseSchema, {
      ...body,
      itens: [{ ...body.itens[0], valor: -1 }],
    }),
  );
  assert.throws(() =>
    parsePurchase(responseSchema, {
      ...body,
      itens: [{ ...body.itens[0], marca: "" }],
    }),
  );
  const item = {
    empresa: "1",
    codigo: "10",
    quantidade: 2,
    unidade: "UN",
    fornecedores: [id, other],
  };
  assert.throws(() =>
    parsePurchase(quoteSchema, {
      titulo: "Teste",
      prazo: "2099-01-01T00:00:00Z",
      itens: [item, item],
    }),
  );
  assert.equal(
    parsePurchase(quoteSchema, {
      titulo: "Teste",
      prazo: "2099-01-01T00:00:00Z",
      itens: [item],
    }).itens[0].fornecedores.length,
    2,
  );
  assert.throws(() => validateAssignedItems([id], { itens: [{ id: other }] }));
  assert.throws(() =>
    validateAssignedItems([id, other], { itens: [{ id }, { id }] }),
  );
});
test("consulta interna exige permissão de compras", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  assert.equal(
    (await request(app({ permissions: {} })).get("/compras/cotacoes")).status,
    403,
  );
  assert.equal(
    (
      await request(app({ permissions: { compras: true } })).get(
        "/compras/cotacoes",
      )
    ).status,
    200,
  );
});
test("link público mostra apenas itens atribuídos, sem concorrentes", async (t) => {
  t.mock.method(pool, "query", async (q) => ({
    rows: q.includes("fornecedor_acessos")
      ? [account]
      : [
          {
            id,
            atribuídos: [id],
            itens: [
              {
                id,
                nome: "Filtro",
                quantidade: 2,
                unidade: "UN",
                fornecedores: [other],
              },
              { id: other, nome: "Pneu" },
            ],
            status: "aberta",
            prazo: "2099-01-01",
            nome: "Oficina",
            titulo: "Teste",
          },
        ],
  }));
  const r = await request(app())
    .get(`/compras-publico/${token}`)
    .set("Authorization", auth);
  assert.equal(r.status, 200);
  assert.equal(r.body.itens.length, 1);
  assert.equal(r.body.itens[0].fornecedores, undefined);
  assert.equal(r.body.id, undefined);
});
test("link vencido é bloqueado e token malformado não consulta banco", async (t) => {
  const query = t.mock.method(pool, "query", async (q) => ({
    rows: q.includes("fornecedor_acessos")
      ? [account]
      : [{ status: "aberta", prazo: "2000-01-01" }],
  }));
  assert.equal(
    (
      await request(app())
        .get("/compras-publico/invalido")
        .set("Authorization", auth)
    ).status,
    404,
  );
  assert.equal(query.mock.callCount(), 1);
  assert.equal(
    (
      await request(app())
        .get(`/compras-publico/${token}`)
        .set("Authorization", auth)
    ).status,
    410,
  );
});
test("resposta válida é atômica; item de outro convite causa rollback", async (t) => {
  const sql = [];
  t.mock.method(pool, "query", async () => ({ rows: [account] }));
  t.mock.method(pool, "connect", async () => ({
    release() {},
    async query(q) {
      sql.push(q);
      return {
        rows: q.startsWith("SELECT")
          ? [{ id, atribuídos: [id], status: "aberta", prazo: "2099-01-01" }]
          : [],
      };
    },
  }));
  assert.equal(
    (
      await request(app())
        .put(`/compras-publico/${token}`)
        .set("Authorization", auth)
        .send(body)
    ).status,
    200,
  );
  assert.ok(sql.some((s) => s.includes("FOR UPDATE OF c,v")));
  assert.equal(sql.at(-1), "COMMIT");
  sql.length = 0;
  assert.equal(
    (
      await request(app())
        .put(`/compras-publico/${token}`)
        .set("Authorization", auth)
        .send({ ...body, itens: [{ ...body.itens[0], id: other }] })
    ).status,
    400,
  );
  assert.equal(sql.at(-1), "ROLLBACK");
  assert.ok(!sql.some((s) => s.startsWith("UPDATE")));
});
