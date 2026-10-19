import test from "node:test";
import assert from "node:assert/strict";
import {
  groupErpQuotes,
  importErpQuotes,
} from "../src/services/purchasesImport.js";
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
test("agrupa por empresa e solicitação, sem descartar versões de ofertas", () => {
  const rows = [
    { empresacot: 1, solicitacaocompracot: 10, codigocot: 1 },
    { empresacot: 1, solicitacaocompracot: 10, codigocot: 2 },
    { empresacot: 2, solicitacaocompracot: 10, codigocot: 3 },
    { empresacot: 1, solicitacaocompracot: null, codigocot: 4 },
    { empresacot: 1, solicitacaocompracot: null, codigocot: 5 },
  ];
  const groups = groupErpQuotes(rows);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].ofertas.length, 2);
  assert.equal(groups.flatMap((g) => g.ofertas).length, 5);
});
test("importação mantém chave estável, histórico fechado e valores originais", async (t) => {
  const row = {
    empresacot: 1,
    solicitacaocompracot: 10,
    codigocot: 1,
    produtocot: 3,
    produto_empresa: "1",
    produto: "Filtro",
    fornecedorcot: 4,
    fornecedor_empresa: "1",
    fornecedor: "Fornecedor",
    data: "2026-01-01",
    quantidade_solicitada: "2",
    quantidadecotadacot: "2",
    valorunitariocot: "20",
    valortotalcot: "36",
    valordescontocot: "4",
    unidade: "UN",
  };
  const source = t.mock.method(clientPool, "query", async () => ({
    rows: [row],
  }));
  const calls = [];
  t.mock.method(pool, "connect", async () => ({
    release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows:
          sql.startsWith("INSERT INTO") && sql.includes("compras_fornecedores")
            ? [{ id: "supplier" }]
            : sql.startsWith("SELECT id")
              ? [{ id: "existing" }]
              : [],
      };
    },
  }));
  const result = await importErpQuotes("42");
  assert.equal(result.novas, 0);
  assert.equal(result.atualizadas, 1);
  assert.equal(result.ofertas, 1);
  const insert = calls.find(
    (c) =>
      c.sql.startsWith("INSERT INTO") && c.sql.includes("compras_cotacoes"),
  );
  assert.match(insert.sql, /'encerrada'/);
  assert.match(insert.sql, /ON CONFLICT \(origem_chave\)/);
  assert.equal(insert.params[7], "cotacoescompras:1:10");
  assert.equal(JSON.parse(insert.params[8]).ofertas[0].valortotalcot, "36");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.ok(!calls.some((c) => c.sql.includes("compras_convites")));
  assert.match(source.mock.calls[0].arguments[0], /^SELECT/);
});
test("falha durante importação desfaz o lote inteiro", async (t) => {
  t.mock.method(clientPool, "query", async () => ({
    rows: [{ empresacot: 1, solicitacaocompracot: 2, codigocot: 3 }],
  }));
  const calls = [];
  t.mock.method(pool, "connect", async () => ({
    release() {},
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  }));
  await assert.rejects(importErpQuotes(), /sem data/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.includes("COMMIT"));
});
