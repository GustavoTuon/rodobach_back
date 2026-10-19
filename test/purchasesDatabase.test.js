import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
import { config, quoteIdent } from "../src/config.js";
import { comprasRouter, comprasPublicRouter } from "../src/routes/compras.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
test(
  "ciclo de cotação no PostgreSQL com catálogo real e isolamento por fornecedor",
  { skip: process.env.PURCHASES_DB_TEST !== "1" },
  async () => {
    const previous = config.db.schema,
      schema = `compras_test_${Date.now()}`;
    try {
      await pool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`);
        await client.query("CREATE TABLE usuarios(id integer)");
        await client.query(
          await fs.readFile(
            new URL("../sql/062_compras.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query(
          await fs.readFile(
            new URL("../sql/063_compras_importacao.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query(
          await fs.readFile(
            new URL("../sql/064_compras_acessos.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query(
          await fs.readFile(
            new URL("../sql/065_compras_cancelamento.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query(
          await fs.readFile(
            new URL("../sql/066_compras_negociacao.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query(
          await fs.readFile(
            new URL("../sql/067_compras_escolhas.sql", import.meta.url),
            "utf8",
          ),
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      config.db.schema = schema;
      const app = express();
      app.use(express.json());
      app.use(comprasPublicRouter);
      app.use((req, res, next) => {
        req.user = { id: 42 };
        next();
      });
      app.use(comprasRouter);
      app.use(errorHandler);
      const products = await request(app).get("/compras/catalogo/produtos");
      assert.equal(products.status, 200);
      assert.ok(products.body.length);
      const catalog = await request(app).get("/compras/catalogo/fornecedores");
      assert.equal(catalog.status, 200);
      const suppliers = [];
      for (const nome of ["Teste A", "Teste B"]) {
        const r = await request(app)
          .post("/compras/fornecedores")
          .send({
            nome,
            documento: nome === "Teste A" ? "11222333000181" : "11444777000161",
            email: "teste@example.com",
          });
        assert.equal(r.status, 201);
        suppliers.push(r.body.id);
      }
      const group = await request(app)
        .post("/compras/grupos")
        .send({ nome: "Eletrica", fornecedores: suppliers });
      assert.equal(group.status, 200);
      assert.equal(
        (await request(app).get("/compras/grupos")).body[0].fornecedores.length,
        2,
      );
      const edit = await request(app)
        .post("/compras/grupos")
        .send({
          id: group.body.id,
          nome: "Eletrica",
          fornecedores: [suppliers[1]],
        });
      assert.equal(edit.status, 200);
      assert.deepEqual(
        (await request(app).get("/compras/grupos")).body[0].fornecedores,
        [suppliers[1]],
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/fornecedores/${suppliers[1]}/acesso`)
            .send({ acao: "ativar" })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/fornecedores/${suppliers[1]}/acesso`)
            .send({ acao: "ativar" })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(app)
            .post("/compras-fornecedor/login")
            .send({ cnpj: "11444777000161", senha: "errada" })
        ).status,
        401,
      );
      const login = await request(app)
        .post("/compras-fornecedor/login")
        .send({ cnpj: "11.444.777/0001-61", senha: "Senha@123" });
      assert.equal(login.status, 200);
      assert.equal(login.body.trocaObrigatoria, true);
      const initial = login.body.token;
      assert.equal(
        (
          await request(app)
            .get("/compras-fornecedor/cotacoes")
            .set("Authorization", `Bearer ${initial}`)
        ).status,
        403,
      );
      const changed = await request(app)
        .post("/compras-fornecedor/senha")
        .set("Authorization", `Bearer ${initial}`)
        .send({ senhaAtual: "Senha@123", novaSenha: "NovaSenha@12345" });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.trocaObrigatoria, false);
      const auth = `Bearer ${changed.body.token}`;
      assert.equal(
        (
          await request(app)
            .get("/compras-fornecedor/cotacoes")
            .set("Authorization", `Bearer ${initial}`)
        ).status,
        401,
      );
      const items = products.body.slice(0, 2).map((p, index) => ({
        ...p,
        quantidade: 3,
        unidade: "UN",
        fornecedores: index ? [suppliers[0]] : suppliers,
      }));
      const created = await request(app).post("/compras/cotacoes").send({
        titulo: "Teste integração",
        prazo: "2099-01-01T00:00:00Z",
        itens: items,
      });
      assert.equal(created.status, 201);
      const disposable = await request(app).post("/compras/cotacoes").send({
        titulo: "Teste descartavel",
        prazo: "2099-01-01T00:00:00Z",
        itens: items,
      });
      assert.equal(disposable.status, 201);
      const disposableDetail = await request(app).get(
        `/compras/cotacoes/${disposable.body.id}`,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${disposable.body.id}/excluir`)
            .send({})
        ).status,
        200,
      );
      assert.equal(
        (await request(app).get(`/compras/cotacoes/${disposable.body.id}`))
          .status,
        404,
      );
      assert.equal(
        (
          await request(app)
            .get(`/compras-publico/${disposableDetail.body.convites[1].token}`)
            .set("Authorization", auth)
        ).status,
        404,
      );
      let detail = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(detail.status, 200);
      assert.equal(detail.body.convites.length, 2);
      const invite = detail.body.convites.find(
        (v) => v.fornecedor_id === suppliers[1],
      );
      assert.equal(
        (await request(app).get(`/compras-publico/${invite.token}`)).status,
        401,
      );
      const another = detail.body.convites.find(
        (v) => v.fornecedor_id === suppliers[0],
      );
      assert.equal(
        (
          await request(app)
            .get(`/compras-publico/${another.token}`)
            .set("Authorization", auth)
        ).status,
        404,
      );
      const mine = await request(app)
        .get("/compras-fornecedor/cotacoes")
        .set("Authorization", auth);
      assert.equal(mine.body.length, 1);
      assert.equal(mine.body[0].token, invite.token);
      const publicData = await request(app)
        .get(`/compras-publico/${invite.token}`)
        .set("Authorization", auth);
      assert.equal(publicData.status, 200);
      assert.equal(publicData.body.itens.length, 1);
      const answer = {
        frete: 10,
        prazoEntrega: "2 dias",
        pagamento: "À vista",
        itens: publicData.body.itens.map((i) => ({
          id: i.id,
          disponivel: true,
          quantidade: 3,
          valor: 20,
          marca: "Teste",
        })),
      };
      assert.equal(
        (
          await request(app)
            .put(`/compras-publico/${invite.token}`)
            .set("Authorization", auth)
            .send(answer)
        ).status,
        200,
      );
      detail = await request(app).get(`/compras/cotacoes/${created.body.id}`);
      assert.equal(
        detail.body.convites.find((v) => v.id === invite.id).resposta.itens[0]
          .valor,
        20,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/excluir`)
            .send({})
        ).status,
        409,
      );
      const negotiate = {
        respondidoEm: detail.body.convites.find((v) => v.id === invite.id)
          .respondido_em,
        conviteId: invite.id,
        produtoId: publicData.body.itens[0].id,
        valor: 18,
        observacoes: "Desconto confirmado",
      };
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/desconto`)
            .send({ ...negotiate, valor: 21 })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/desconto`)
            .send(negotiate)
        ).status,
        200,
      );
      const negotiated = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(
        negotiated.body.convites.find((v) => v.id === invite.id).descontos[
          negotiate.produtoId
        ].valor,
        18,
      );
      assert.equal(
        negotiated.body.convites.find((v) => v.id === invite.id).resposta
          .itens[0].valor,
        20,
      );
      const choice = {
        produtoId: negotiate.produtoId,
        conviteId: invite.id,
        versaoProposta: negotiated.body.convites.find((v) => v.id === invite.id)
          .versaoProposta,
        motivo: "",
      };
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/escolha`)
            .send({ ...choice, versaoProposta: "a".repeat(64) })
        ).status,
        409,
      );
      await pool.query(
        `UPDATE ${quoteIdent(schema)}.compras_convites SET resposta=$1,respondido_em=now() WHERE id=$2`,
        [
          JSON.stringify({
            frete: 7,
            prazoEntrega: "1 dia",
            pagamento: "30 dias",
            itens: detail.body.itens.map((i) => ({
              id: i.id,
              disponivel: true,
              quantidade: 6,
              valor: 10,
              marca: "A",
            })),
          }),
          another.id,
        ],
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/escolha`)
            .send(choice)
        ).status,
        400,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/escolha`)
            .send({ ...choice, motivo: "Marca solicitada pelo setor" })
        ).status,
        200,
      );
      const partialPlan = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(partialPlan.body.planoCompra.total, 64);
      assert.equal(partialPlan.body.planoCompra.pendentes, 1);
      const secondChoice = {
        produtoId: detail.body.itens[1].id,
        conviteId: another.id,
        versaoProposta: partialPlan.body.convites.find(
          (v) => v.id === another.id,
        ).versaoProposta,
        motivo: "",
      };
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/escolha`)
            .send(secondChoice)
        ).status,
        200,
      );
      const completePlan = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(completePlan.body.planoCompra.completa, true);
      assert.equal(completePlan.body.planoCompra.total, 101);
      assert.equal(completePlan.body.planoCompra.frete, 17);
      const privateData = await request(app)
        .get(`/compras-publico/${invite.token}`)
        .set("Authorization", auth);
      assert.equal(privateData.body.descontos, undefined);
      assert.equal(privateData.body.planoCompra, undefined);
      assert.equal(privateData.body.escolhas, undefined);
      assert.equal(
        (
          await request(app)
            .put(`/compras-publico/${invite.token}`)
            .set("Authorization", auth)
            .send(answer)
        ).status,
        200,
      );
      const resubmitted = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.deepEqual(
        resubmitted.body.convites.find((v) => v.id === invite.id).descontos,
        {},
      );
      assert.equal(resubmitted.body.planoCompra.revisar, 1);
      assert.equal(resubmitted.body.planoCompra.total, 37);
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/escolha`)
            .send({ ...choice, conviteId: null })
        ).status,
        200,
      );
      const removedChoice = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(removedChoice.body.planoCompra.pendentes, 1);
      const productHistory = await request(app).get(
        `/compras/cotacoes/${created.body.id}/historico`,
      );
      assert.equal(productHistory.status, 200);
      assert.ok(
        productHistory.body.every((h) =>
          detail.body.itens.some((i) => i.id === h.produto_id),
        ),
      );
      const extra = await request(app)
        .post("/compras/fornecedores")
        .send({ nome: "Fornecedor adicional" });
      assert.equal(extra.status, 201);
      const addBody = {
        itens: [{ id: detail.body.itens[0].id, fornecedores: [extra.body.id] }],
      };
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/fornecedores`)
            .send(addBody)
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/fornecedores`)
            .send(addBody)
        ).status,
        200,
      );
      const expanded = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(expanded.body.convites.length, 3);
      assert.equal(
        expanded.body.convites.find((v) => v.id === invite.id).token,
        invite.token,
      );
      assert.equal(
        expanded.body.convites.find((v) => v.id === invite.id).resposta.itens[0]
          .valor,
        20,
      );
      assert.deepEqual(
        expanded.body.convites.find((v) => v.fornecedor_id === extra.body.id)
          .itens,
        [detail.body.itens[0].id],
      );
      const extraToken = expanded.body.convites.find(
        (v) => v.fornecedor_id === extra.body.id,
      ).token;
      assert.notEqual(extraToken, invite.token);
      assert.equal(
        (
          await request(app)
            .get(`/compras-publico/${extraToken}`)
            .set("Authorization", auth)
        ).status,
        404,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/fornecedores`)
            .send({
              itens: [
                { id: detail.body.itens[1].id, fornecedores: [suppliers[1]] },
              ],
            })
        ).status,
        409,
      );
      const unchanged = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(
        unchanged.body.itens[1].fornecedores.includes(suppliers[1]),
        false,
      );
      const history = await request(app).get(
        `/compras/historico?empresa=${encodeURIComponent(items[0].empresa)}&codigo=${encodeURIComponent(items[0].codigo)}`,
      );
      assert.equal(history.status, 200);
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/encerrar`)
            .send({})
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .put(`/compras-publico/${invite.token}`)
            .set("Authorization", auth)
            .send(answer)
        ).status,
        410,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/cancelar`)
            .send({})
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/fornecedores`)
            .send(addBody)
        ).status,
        409,
      );
      const cancelled = await request(app).get(
        `/compras/cotacoes/${created.body.id}`,
      );
      assert.equal(cancelled.body.status, "cancelada");
      assert.equal(
        cancelled.body.convites.find((v) => v.id === invite.id).resposta
          .itens[0].valor,
        20,
      );
      assert.equal(
        (
          await request(app)
            .get(`/compras-publico/${invite.token}`)
            .set("Authorization", auth)
        ).status,
        410,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/cotacoes/${created.body.id}/encerrar`)
            .send({})
        ).status,
        404,
      );
      assert.equal(
        (
          await request(app)
            .post(`/compras/fornecedores/${suppliers[1]}/acesso`)
            .send({ acao: "revogar" })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(app)
            .get("/compras-fornecedor/cotacoes")
            .set("Authorization", auth)
        ).status,
        401,
      );
      assert.equal(
        (
          await request(app)
            .post("/compras-fornecedor/login")
            .send({ cnpj: "11444777000161", senha: "NovaSenha@12345" })
        ).status,
        401,
      );
    } finally {
      config.db.schema = previous;
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
      await pool.end();
      await clientPool.end();
    }
  },
);
