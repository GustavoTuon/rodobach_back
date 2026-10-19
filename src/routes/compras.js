import {
  supplierSession,
  supplierAdminRouter,
  supplierPublicRouter,
} from "./comprasAccess.js";
import { importErpQuotes } from "../services/purchasesImport.js";
import express from "express";
import { z } from "zod";
import {
  eligibleOffer,
  proposalVersion,
  purchasePlan,
} from "../services/purchasesSelection.js";
import { randomUUID, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";
import { enforceReadOnly } from "../middleware/readOnly.js";
import {
  supplierSchema,
  quoteSchema,
  responseSchema,
  parsePurchase,
  validateAssignedItems,
} from "../services/purchases.js";

export const comprasRouter = express.Router();
export const comprasPublicRouter = express.Router();
comprasRouter.use(supplierAdminRouter);
comprasPublicRouter.use(supplierPublicRouter);
comprasRouter.post("/compras/importar-erp", routeImport);
function routeImport(req, res, next) {
  importErpQuotes(req.user.id)
    .then((data) => res.json(data))
    .catch(next);
}
const t = (name) => tableName(`compras_${name}`);
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const uuid = (value) =>
  /^[0-9a-f-]{36}$/i.test(value) ? value : fail("Identificador inválido.");

comprasRouter.get(
  "/compras/catalogo/:tipo",
  route(async (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 100);
    const params = [`%${q.replace(/[\\%_]/g, "\\$&")}%`];
    const sql =
      req.params.tipo === "produtos"
        ? `SELECT empresapro::text empresa,codigopro::text codigo,nomepro nome FROM estoque.produtos WHERE nomepro ILIKE $1 OR codigopro::text ILIKE $1 ORDER BY nomepro,empresapro LIMIT 40`
        : req.params.tipo === "fornecedores"
          ? `SELECT empresafor::text empresa,codigofor::text codigo,COALESCE(NULLIF(trim(fantasiafor),''),nomefor) nome FROM gerais.fornecedores WHERE nomefor ILIKE $1 OR fantasiafor ILIKE $1 OR codigofor::text ILIKE $1 ORDER BY nome,empresafor LIMIT 40`
          : fail("Catálogo inválido.");
    res.json((await clientPool.query(sql, params)).rows);
  }),
);
comprasRouter.get(
  "/compras/fornecedores",
  route(async (_req, res) => {
    res.json(
      (
        await pool.query(
          `SELECT f.*,a.ativo acesso_ativo,a.troca_obrigatoria FROM ${t("fornecedores")} f LEFT JOIN ${t("fornecedor_acessos")} a ON a.fornecedor_id=f.id ORDER BY f.nome`,
        )
      ).rows,
    );
  }),
);
comprasRouter.post(
  "/compras/fornecedores",
  route(async (req, res) => {
    const b = parsePurchase(supplierSchema, req.body);
    if (b.codigo) {
      const { rows } = await clientPool.query(
        `SELECT COALESCE(NULLIF(trim(fantasiafor),''),nomefor) nome FROM gerais.fornecedores WHERE empresafor::text=$1 AND codigofor::text=$2`,
        [b.empresa, b.codigo],
      );
      if (!rows[0]) fail("Fornecedor não encontrado no sistema.");
      b.nome = rows[0].nome;
    }
    const { rows } = await pool.query(
      `INSERT INTO ${t("fornecedores")} (id,nome,documento,email,telefone,empresa_erp,codigo_erp) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (empresa_erp,codigo_erp) DO UPDATE SET nome=EXCLUDED.nome,documento=EXCLUDED.documento,email=EXCLUDED.email,telefone=EXCLUDED.telefone RETURNING *`,
      [
        randomUUID(),
        b.nome,
        b.documento,
        b.email,
        b.telefone,
        b.empresa || null,
        b.codigo || null,
      ],
    );
    res.status(201).json(rows[0]);
  }),
);
comprasRouter.get(
  "/compras/cotacoes",
  route(async (_req, res) => {
    res.json(
      (
        await pool.query(
          `SELECT c.id,c.titulo,c.prazo,c.status,c.criado_em,c.origem_chave,c.importado_em,jsonb_array_length(c.itens) produtos,COALESCE((c.origem_dados->>'fornecedores')::int,count(v.id)::int) fornecedores,CASE WHEN c.origem_chave IS NOT NULL THEN jsonb_array_length(c.origem_dados->'ofertas') ELSE count(v.respondido_em)::int END respostas FROM ${t("cotacoes")} c LEFT JOIN ${t("convites")} v ON v.cotacao_id=c.id GROUP BY c.id ORDER BY c.criado_em DESC LIMIT 2000`,
        )
      ).rows,
    );
  }),
);
comprasRouter.post(
  "/compras/cotacoes",
  route(async (req, res) => {
    const b = parsePurchase(quoteSchema, req.body);
    const itens = [];
    for (const item of b.itens) {
      const { rows } = await clientPool.query(
        `SELECT nomepro nome FROM estoque.produtos WHERE empresapro::text=$1 AND codigopro::text=$2`,
        [item.empresa, item.codigo],
      );
      if (!rows[0]) fail("Produto não encontrado no sistema.");
      itens.push({ ...item, id: randomUUID(), nome: rows[0].nome });
    }
    const suppliers = [...new Set(itens.flatMap((i) => i.fornecedores))];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT id FROM ${t("fornecedores")} WHERE id=ANY($1::uuid[])`,
        [suppliers],
      );
      if (existing.rows.length !== suppliers.length)
        fail("Fornecedor não cadastrado.");
      const id = randomUUID();
      await client.query(
        `INSERT INTO ${t("cotacoes")} (id,titulo,prazo,observacoes,itens,criado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          b.titulo,
          b.prazo,
          b.observacoes,
          JSON.stringify(itens),
          String(req.user.id),
        ],
      );
      for (const supplier of suppliers)
        await client.query(
          `INSERT INTO ${t("convites")} (id,cotacao_id,fornecedor_id,token,itens) VALUES ($1,$2,$3,$4,$5)`,
          [
            randomUUID(),
            id,
            supplier,
            randomBytes(32).toString("hex"),
            JSON.stringify(
              itens
                .filter((i) => i.fornecedores.includes(supplier))
                .map((i) => i.id),
            ),
          ],
        );
      await client.query("COMMIT");
      res.status(201).json({ id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
comprasRouter.post(
  "/compras/cotacoes/:id/fornecedores",
  route(async (req, res) => {
    const body = parsePurchase(
      z.object({
        itens: z
          .array(
            z.object({
              id: z.string().uuid(),
              fornecedores: z.array(z.string().uuid()).min(1).max(100),
            }),
          )
          .min(1)
          .max(200),
      }),
      req.body,
    );
    if (new Set(body.itens.map((i) => i.id)).size !== body.itens.length)
      fail("Produto repetido.");
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        `SELECT * FROM ${t("cotacoes")} WHERE id=$1 FOR UPDATE`,
        [uuid(req.params.id)],
      );
      const quote = rows[0];
      if (!quote) fail("Cotação não encontrada.", 404);
      if (
        quote.origem_chave ||
        quote.status !== "aberta" ||
        new Date(quote.prazo) <= new Date()
      )
        fail(
          "Só é possível adicionar fornecedores em cotações abertas e dentro do prazo.",
          409,
        );
      const supplierIds = [
        ...new Set(body.itens.flatMap((i) => i.fornecedores)),
      ];
      const existing = await db.query(
        `SELECT id FROM ${t("fornecedores")} WHERE id=ANY($1::uuid[])`,
        [supplierIds],
      );
      if (existing.rows.length !== supplierIds.length)
        fail("Fornecedor não cadastrado.");
      for (const item of body.itens) {
        const target = quote.itens.find((i) => i.id === item.id);
        if (!target) fail("Produto não pertence à cotação.");
        target.fornecedores = [
          ...new Set([...target.fornecedores, ...item.fornecedores]),
        ];
        if (target.fornecedores.length > 100)
          fail("Limite de 100 fornecedores por produto.");
      }
      for (const supplier of supplierIds) {
        const assigned = quote.itens
          .filter((i) => i.fornecedores.includes(supplier))
          .map((i) => i.id);
        const invite = (
          await db.query(
            `SELECT * FROM ${t("convites")} WHERE cotacao_id=$1 AND fornecedor_id=$2`,
            [quote.id, supplier],
          )
        ).rows[0];
        if (invite) {
          const added = assigned.some((id) => !invite.itens.includes(id));
          if (added && (invite.resposta || invite.respondido_em))
            fail(
              "Um dos fornecedores já respondeu. Preserve sua proposta e selecione outro fornecedor para os novos itens.",
              409,
            );
          if (added)
            await db.query(`UPDATE ${t("convites")} SET itens=$1 WHERE id=$2`, [
              JSON.stringify(assigned),
              invite.id,
            ]);
        } else
          await db.query(
            `INSERT INTO ${t("convites")} (id,cotacao_id,fornecedor_id,token,itens) VALUES($1,$2,$3,$4,$5)`,
            [
              randomUUID(),
              quote.id,
              supplier,
              randomBytes(32).toString("hex"),
              JSON.stringify(assigned),
            ],
          );
      }
      await db.query(`UPDATE ${t("cotacoes")} SET itens=$1 WHERE id=$2`, [
        JSON.stringify(quote.itens),
        quote.id,
      ]);
      await db.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);
comprasRouter.get(
  "/compras/cotacoes/:id",
  route(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM ${t("cotacoes")} WHERE id=$1`,
      [uuid(req.params.id)],
    );
    if (!rows[0]) fail("Cotação não encontrada.", 404);
    const invites = await pool.query(
      `SELECT v.*,f.nome,f.email,f.telefone FROM ${t("convites")} v JOIN ${t("fornecedores")} f ON f.id=v.fornecedor_id WHERE v.cotacao_id=$1 ORDER BY f.nome`,
      [req.params.id],
    );
    res.json({
      ...rows[0],
      convites: invites.rows.map((i) => ({
        ...i,
        versaoProposta: proposalVersion(i),
      })),
      planoCompra: purchasePlan(rows[0], invites.rows),
    });
  }),
);
comprasRouter.post(
  "/compras/cotacoes/:id/encerrar",
  route(async (req, res) => {
    const result = await pool.query(
      `UPDATE ${t("cotacoes")} SET status='encerrada' WHERE id=$1 AND status='aberta' AND origem_chave IS NULL RETURNING id`,
      [uuid(req.params.id)],
    );
    if (!result.rowCount) fail("Cotação não encontrada.", 404);
    res.json({ ok: true });
  }),
);
comprasRouter.post(
  "/compras/cotacoes/:id/:acao(excluir|cancelar)",
  route(async (req, res) => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        `SELECT id,origem_chave,status FROM ${t("cotacoes")} WHERE id=$1 FOR UPDATE`,
        [uuid(req.params.id)],
      );
      const quote = rows[0];
      if (!quote) fail("Cotação não encontrada.", 404);
      if (quote.origem_chave)
        fail("O histórico importado do sistema deve ser preservado.", 409);
      if (req.params.acao === "excluir") {
        const responses = await db.query(
          `SELECT id FROM ${t("convites")} WHERE cotacao_id=$1 AND (resposta IS NOT NULL OR respondido_em IS NOT NULL) LIMIT 1`,
          [quote.id],
        );
        if (responses.rows.length)
          fail(
            "Esta cotação já recebeu resposta. Use Cancelar cotação para preservar as propostas.",
            409,
          );
        await db.query(`DELETE FROM ${t("convites")} WHERE cotacao_id=$1`, [
          quote.id,
        ]);
        await db.query(`DELETE FROM ${t("cotacoes")} WHERE id=$1`, [quote.id]);
      } else {
        await db.query(
          `UPDATE ${t("cotacoes")} SET status='cancelada' WHERE id=$1`,
          [quote.id],
        );
      }
      await db.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);
comprasRouter.get(
  "/compras/cotacoes/:id/historico",
  route(async (req, res) => {
    const quote = (
      await pool.query(`SELECT itens FROM ${t("cotacoes")} WHERE id=$1`, [
        uuid(req.params.id),
      ])
    ).rows[0];
    if (!quote) fail("Cotação não encontrada.", 404);
    const products = quote.itens.map((i) => ({
      id: String(i.id),
      empresa: String(i.empresa),
      codigo: String(i.codigo),
    }));
    const { rows } = await clientPool.query(
      `SELECT p.id produto_id,h.* FROM jsonb_to_recordset($1::jsonb) AS p(id text,empresa text,codigo text) CROSS JOIN LATERAL (
    SELECT COALESCE(n.dataentradanfe,n.dataemissaonfe) AS "data",n.codigonfe documento,f.nomefor fornecedor,i.quantidadenep quantidade,i.valorunitarionep valor_unitario
    FROM compras.notasfiscaisentradaprodutos i JOIN compras.notasfiscaisentrada n ON n.empresanfe=i.empresanep AND n.serienfe=i.serienep AND n.codigonfe=i.codigonep AND n.fornecedornfe=i.fornecedornep
    LEFT JOIN gerais.fornecedores f ON f.empresafor=n.empresanfe AND f.codigofor=n.fornecedornfe
    WHERE i.empresanep::text=p.empresa AND i.produtonep::text=p.codigo
    ORDER BY COALESCE(n.dataentradanfe,n.dataemissaonfe) DESC NULLS LAST,n.codigonfe DESC LIMIT 10
  ) h`,
      [JSON.stringify(products)],
    );
    res.json(rows);
  }),
);
comprasRouter.post(
  "/compras/cotacoes/:id/escolha",
  route(async (req, res) => {
    const b = parsePurchase(
      z.object({
        produtoId: z.string().uuid(),
        conviteId: z.string().uuid().nullable(),
        versaoProposta: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        motivo: z.string().trim().max(1000).default(""),
      }),
      req.body,
    );
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const quote = (
        await db.query(
          `SELECT * FROM ${t("cotacoes")} WHERE id=$1 FOR UPDATE`,
          [uuid(req.params.id)],
        )
      ).rows[0];
      if (!quote) fail("Cotação não encontrada.", 404);
      if (quote.origem_chave || quote.status === "cancelada")
        fail("Esta cotação não permite definir uma compra.", 409);
      const product = quote.itens.find((i) => i.id === b.produtoId);
      if (!product) fail("Produto não pertence à cotação.");
      const choices = { ...quote.escolhas };
      if (b.conviteId === null) delete choices[b.produtoId];
      else {
        const invites = (
          await db.query(
            `SELECT v.*,f.nome FROM ${t("convites")} v JOIN ${t("fornecedores")} f ON f.id=v.fornecedor_id WHERE v.cotacao_id=$1`,
            [quote.id],
          )
        ).rows;
        const invite = invites.find((i) => i.id === b.conviteId);
        if (!invite) fail("Fornecedor não pertence à cotação.");
        const candidate = eligibleOffer(product, invite);
        if (!candidate)
          fail(
            "Escolha uma proposta disponível que atenda toda a quantidade solicitada.",
          );
        const version = proposalVersion(invite);
        if (version !== b.versaoProposta)
          fail(
            "A proposta mudou. Atualize as respostas e confira novamente.",
            409,
          );
        const minimum = Math.min(
          ...invites.map((i) => eligibleOffer(product, i)?.price ?? Infinity),
        );
        if (candidate.price > minimum && !b.motivo)
          fail(
            "Informe o motivo para escolher uma oferta acima do menor preço, como marca ou prazo.",
          );
        choices[b.produtoId] = {
          conviteId: invite.id,
          fornecedor: invite.nome,
          versaoProposta: version,
          motivo: b.motivo,
          quantidade: product.quantidade,
          unitario: candidate.price,
          marca: candidate.offer.marca,
          escolhido_por: String(req.user.id),
          escolhido_em: new Date().toISOString(),
        };
      }
      await db.query(`UPDATE ${t("cotacoes")} SET escolhas=$1 WHERE id=$2`, [
        JSON.stringify(choices),
        quote.id,
      ]);
      await db.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);
comprasRouter.post(
  "/compras/cotacoes/:id/desconto",
  route(async (req, res) => {
    const b = parsePurchase(
      z.object({
        conviteId: z.string().uuid(),
        produtoId: z.string().uuid(),
        valor: z.number().finite().positive().max(1e9).nullable(),
        respondidoEm: z.string().datetime({ offset: true }),
        observacoes: z.string().trim().max(1000).default(""),
      }),
      req.body,
    );
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const quote = (
        await db.query(
          `SELECT status,origem_chave FROM ${t("cotacoes")} WHERE id=$1 FOR UPDATE`,
          [uuid(req.params.id)],
        )
      ).rows[0];
      if (!quote) fail("Cotação não encontrada.", 404);
      if (quote.origem_chave || quote.status === "cancelada")
        fail("Negociação indisponível para esta cotação.", 409);
      const invite = (
        await db.query(
          `SELECT * FROM ${t("convites")} WHERE id=$1 AND cotacao_id=$2 FOR UPDATE`,
          [b.conviteId, req.params.id],
        )
      ).rows[0];
      const offer = invite?.resposta?.itens.find(
        (i) => i.id === b.produtoId && i.disponivel,
      );
      if (!offer) fail("Proposta disponível não encontrada.", 404);
      if (
        new Date(invite.respondido_em).getTime() !==
        new Date(b.respondidoEm).getTime()
      )
        fail(
          "O fornecedor atualizou a proposta. Atualize as respostas antes de negociar.",
          409,
        );
      if (b.valor !== null && b.valor > offer.valor)
        fail("O valor negociado não pode superar o preço original.");
      const discounts = { ...invite.descontos };
      if (b.valor === null) delete discounts[b.produtoId];
      else
        discounts[b.produtoId] = {
          valor: b.valor,
          original: offer.valor,
          observacoes: b.observacoes,
          atualizado_por: String(req.user.id),
          atualizado_em: new Date().toISOString(),
        };
      await db.query(`UPDATE ${t("convites")} SET descontos=$1 WHERE id=$2`, [
        JSON.stringify(discounts),
        invite.id,
      ]);
      await db.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }),
);
comprasRouter.get(
  "/compras/historico",
  route(async (req, res) => {
    const empresa = String(req.query.empresa || "").slice(0, 40),
      codigo = String(req.query.codigo || "").slice(0, 40);
    if (!empresa || !codigo) fail("Informe empresa e produto.");
    const { rows } = await clientPool.query(
      `SELECT COALESCE(n.dataentradanfe,n.dataemissaonfe) AS "data",n.codigonfe documento,n.fornecedornfe fornecedor_codigo,f.nomefor fornecedor,i.quantidadenep quantidade,i.valorunitarionep valor_unitario,COALESCE(i.totalitemestoquenep,i.totalitemnep,0) total FROM compras.notasfiscaisentradaprodutos i JOIN compras.notasfiscaisentrada n ON n.empresanfe=i.empresanep AND n.serienfe=i.serienep AND n.codigonfe=i.codigonep AND n.fornecedornfe=i.fornecedornep LEFT JOIN gerais.fornecedores f ON f.empresafor=n.empresanfe AND f.codigofor=n.fornecedornfe WHERE i.empresanep::text=$1 AND i.produtonep::text=$2 ORDER BY "data" DESC NULLS LAST LIMIT 50`,
      [empresa, codigo],
    );
    res.json(rows);
  }),
);

comprasPublicRouter.use(
  "/compras-publico",
  rateLimit({
    windowMs: 60000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  enforceReadOnly,
  supplierSession(),
);
async function invitation(db, token, supplierId, lock = false) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail("Link inválido.", 404);
  const { rows } = await db.query(
    `SELECT v.id,v.itens atribuídos,v.resposta,c.titulo,c.observacoes,c.itens,c.prazo,c.status,f.nome FROM ${t("convites")} v JOIN ${t("cotacoes")} c ON c.id=v.cotacao_id JOIN ${t("fornecedores")} f ON f.id=v.fornecedor_id WHERE v.token=$1 AND v.fornecedor_id=$2 ${lock ? "FOR UPDATE OF c,v" : ""}`,
    [token, supplierId],
  );
  if (!rows[0]) fail("Link inválido.", 404);
  const row = rows[0];
  if (row.status !== "aberta" || new Date(row.prazo) <= new Date())
    fail("Esta cotação está encerrada ou o prazo expirou.", 410);
  return row;
}
comprasPublicRouter.get(
  "/compras-publico/:token",
  route(async (req, res) => {
    const row = await invitation(
      pool,
      req.params.token,
      req.supplier.fornecedor_id,
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json({
      titulo: row.titulo,
      observacoes: row.observacoes,
      prazo: row.prazo,
      fornecedor: row.nome,
      resposta: row.resposta,
      itens: row.itens
        .filter((i) => row.atribuídos.includes(i.id))
        .map(({ id, nome, quantidade, unidade }) => ({
          id,
          nome,
          quantidade,
          unidade,
        })),
    });
  }),
);
comprasPublicRouter.put(
  "/compras-publico/:token",
  route(async (req, res) => {
    const body = parsePurchase(responseSchema, req.body),
      client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await invitation(
        client,
        req.params.token,
        req.supplier.fornecedor_id,
        true,
      );
      validateAssignedItems(row.atribuídos, body);
      await client.query(
        `UPDATE ${t("convites")} SET resposta=$1,respondido_em=now(),descontos='{}'::jsonb WHERE id=$2`,
        [JSON.stringify(body), row.id],
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
