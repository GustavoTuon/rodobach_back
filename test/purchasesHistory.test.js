import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { comprasRouter } from "../src/routes/compras.js";
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
import { proposalVersion } from "../src/services/purchasesSelection.js";
const id = "55926d25-6e7d-4c22-a36d-747c0402c18a";
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1 };
  next();
});
app.use(comprasRouter);
app.use((err, req, res, next) =>
  res.status(err.status || 500).json({ error: err.message }),
);
test("histórico paginado preserva empresa, período, filtro literal e próxima página", async (t) => {
  let params;
  t.mock.method(clientPool, "query", async (sql, p) => {
    params = p;
    return { rows: Array.from({ length: 21 }, (_, i) => ({ documento: i })) };
  });
  const response = await request(app)
    .get("/compras/historico")
    .query({
      empresa: "2",
      codigo: "669",
      page: 2,
      ate: "2026-07-15",
      de: "2024-01-01",
      fornecedor: "A_B%",
    });
  assert.equal(response.status, 200);
  assert.equal(response.body.rows.length, 20);
  assert.equal(response.body.hasMore, true);
  assert.deepEqual(params, [
    "2",
    "669",
    "2026-07-15",
    "2024-01-01",
    "%A\\_B\\%%",
    21,
    20,
  ]);
  const invalid = await request(app)
    .get("/compras/historico")
    .query({
      empresa: "2",
      codigo: "669",
      de: "2026-08-01",
      ate: "2026-07-15",
    });
  assert.equal(invalid.status, 400);
});
test("referência histórica usa a abertura persistida, não uma data fornecida pelo cliente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        criado_em: "2026-07-15T15:00:00Z",
        origem_dados: {empresa:2},
        itens: [{ id: "p", empresa: "1", codigo: "669" }],
      },
    ],
  }));
  let params, sql;
  t.mock.method(clientPool, "query", async (s, p) => {
    params = p;
    sql = s;
    return { rows: [] };
  });
  const response = await request(app).get(
    `/compras/cotacoes/${id}/historico?ate=2099-01-01`,
  );
  assert.equal(response.status, 200);
  assert.equal(params[1], "2026-07-15T15:00:00Z");
  assert.equal(JSON.parse(params[0])[0].empresa, "2");
  assert.match(sql, /America\/Sao_Paulo/);
  assert.match(sql, /LIMIT 3/);
  assert.match(sql, /i\.totalitemnep total_nota/);
  assert.match(sql, /i\.valorunitarionep valor_unitario/);
  assert.match(sql, /count\(\*\) FROM estoque\.unidades ux WHERE ux\.codigouni=i\.unidadenep\)=1/);
  assert.match(sql, /count\(\*\) FROM gerais\.fornecedores fx WHERE fx\.codigofor=n\.fornecedornfe\)=1/);
  const before = Date.now();
  const current = await request(app).get(`/compras/cotacoes/${id}/historico?referencia=atual&ate=2099-01-01`);
  assert.equal(current.status, 200);
  assert.ok(Date.parse(params[1]) >= before && Date.parse(params[1]) <= Date.now());
});
test("escolha com quantidade maior é bloqueada no servidor até confirmação", async (t) => {
  const product = { id, quantidade: 10 };
  const invite = {
    id,
    nome: "Fornecedor",
    resposta: { itens: [{ id, disponivel: true, valor: 5, quantidade: 30 }] },
  };
  let saved;
  t.mock.method(pool, "connect", async () => ({
    release() {},
    async query(sql, p) {
      if (sql.includes("FOR UPDATE"))
        return {
          rows: [{ id, status: "aberta", itens: [product], escolhas: {} }],
        };
      if (sql.includes("JOIN")) return { rows: [invite] };
      if (sql.startsWith("UPDATE")) saved = JSON.parse(p[0]);
      return { rows: [] };
    },
  }));
  const body = {
    produtoId: id,
    conviteId: id,
    versaoProposta: proposalVersion(invite),
  };
  assert.equal(
    (await request(app).post(`/compras/cotacoes/${id}/escolha`).send(body))
      .status,
    400,
  );
  assert.equal(saved, undefined);
  assert.equal(
    (
      await request(app)
        .post(`/compras/cotacoes/${id}/escolha`)
        .send({ ...body, quantidadeConfirmada: true })
    ).status,
    200,
  );
  assert.equal(saved[id].quantidadeConfirmada, true);
});
