import express from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config, tableName } from "../config.js";
import { enforceReadOnly } from "../middleware/readOnly.js";
import { parsePurchase } from "../services/purchases.js";
const t = (name) => tableName(`compras_${name}`);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const idSchema = z.string().uuid();
export function normalizeCnpj(value) {
  const cnpj = String(value || "").replace(/[./\s-]/g, "");
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return null;
  for (let size = 12; size <= 13; size++) {
    let sum = 0,
      weight = size - 7;
    for (let i = 0; i < size; i++) {
      sum += Number(cnpj[i]) * weight;
      if (--weight < 2) weight = 9;
    }
    const digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (Number(cnpj[size]) !== digit) return null;
  }
  return cnpj;
}
function session(account) {
  return {
    token: jwt.sign(
      { sub: account.fornecedor_id, version: account.versao },
      config.jwtSecret,
      {
        audience: "compras-fornecedor",
        issuer: "rodobach",
        expiresIn: account.troca_obrigatoria ? "15m" : "8h",
      },
    ),
    trocaObrigatoria: account.troca_obrigatoria,
  };
}
export const supplierSession = (allowChange = false) =>
  wrap(async (req, res, next) => {
    let claims;
    try {
      claims = jwt.verify(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
        config.jwtSecret,
        {
          audience: "compras-fornecedor",
          issuer: "rodobach",
          algorithms: ["HS256"],
        },
      );
    } catch {
      fail("Entre com seu CNPJ e senha.", 401);
    }
    if (!idSchema.safeParse(claims.sub).success) fail("Sessão inválida.", 401);
    const { rows } = await pool.query(
      `SELECT * FROM ${t("fornecedor_acessos")} WHERE fornecedor_id=$1`,
      [claims.sub],
    );
    const account = rows[0];
    if (!account?.ativo || account.versao !== claims.version)
      fail("Entre novamente no portal.", 401);
    if (account.troca_obrigatoria && !allowChange)
      fail("Altere sua senha para continuar.", 403);
    req.supplier = account;
    next();
  });
export const supplierPublicRouter = express.Router();
export const supplierAdminRouter = express.Router();
supplierPublicRouter.use("/compras-fornecedor", enforceReadOnly);
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde 15 minutos." },
});
supplierPublicRouter.post(
  "/compras-fornecedor/login",
  loginLimit,
  wrap(async (req, res) => {
    const b = parsePurchase(
      z.object({ cnpj: z.string().max(30), senha: z.string().max(72) }),
      req.body,
    );
    const cnpj = normalizeCnpj(b.cnpj);
    const { rows } = await pool.query(
      `SELECT * FROM ${t("fornecedor_acessos")} WHERE cnpj=$1 AND ativo`,
      [cnpj || ""],
    );
    const a = rows[0];
    const match = await bcrypt.compare(
      b.senha,
      a?.senha_hash ||
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!a || !match)
      fail("CNPJ ou senha inválidos, ou acesso ainda não ativado.", 401);
    res.setHeader("Cache-Control", "no-store");
    res.json(session(a));
  }),
);
supplierPublicRouter.post(
  "/compras-fornecedor/senha",
  loginLimit,
  supplierSession(true),
  wrap(async (req, res) => {
    const b = parsePurchase(
      z.object({
        senhaAtual: z.string().max(72),
        novaSenha: z.string().min(10).max(72),
      }),
      req.body,
    );
    if (
      Buffer.byteLength(b.novaSenha) > 72 ||
      !/[A-Z]/.test(b.novaSenha) ||
      !/[a-z]/.test(b.novaSenha) ||
      !/[0-9]/.test(b.novaSenha) ||
      !/[^A-Za-z0-9]/.test(b.novaSenha)
    )
      fail(
        "Use 10 ou mais caracteres, maiúscula, minúscula, número e símbolo.",
      );
    if (b.novaSenha === "Senha@123" || b.novaSenha === b.senhaAtual)
      fail("Escolha uma senha diferente da inicial e da atual.");
    if (!(await bcrypt.compare(b.senhaAtual, req.supplier.senha_hash)))
      fail("Senha atual incorreta.", 401);
    const hash = await bcrypt.hash(b.novaSenha, 12);
    const { rows } = await pool.query(
      `UPDATE ${t("fornecedor_acessos")} SET senha_hash=$1,troca_obrigatoria=false,versao=versao+1 WHERE fornecedor_id=$2 AND versao=$3 AND ativo RETURNING *`,
      [hash, req.supplier.fornecedor_id, req.supplier.versao],
    );
    if (!rows[0]) fail("Acesso alterado. Entre novamente.", 401);
    res.setHeader("Cache-Control", "no-store");
    res.json(session(rows[0]));
  }),
);
supplierPublicRouter.get(
  "/compras-fornecedor/cotacoes",
  supplierSession(),
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT v.token,v.respondido_em,c.titulo,c.prazo,c.status,jsonb_array_length(v.itens) produtos FROM ${t("convites")} v JOIN ${t("cotacoes")} c ON c.id=v.cotacao_id WHERE v.fornecedor_id=$1 ORDER BY c.criado_em DESC`,
      [req.supplier.fornecedor_id],
    );
    res.setHeader("Cache-Control", "no-store");
    res.json(rows);
  }),
);
supplierAdminRouter.post(
  "/compras/fornecedores/:id/acesso",
  wrap(async (req, res) => {
    const id = parsePurchase(idSchema, req.params.id);
    const { acao } = parsePurchase(
      z.object({ acao: z.enum(["ativar", "redefinir", "revogar"]) }),
      req.body,
    );
    if (acao === "revogar") {
      await pool.query(
        `UPDATE ${t("fornecedor_acessos")} SET ativo=false,versao=versao+1 WHERE fornecedor_id=$1`,
        [id],
      );
      return res.json({ ok: true });
    }
    const { rows } = await pool.query(
      `SELECT documento FROM ${t("fornecedores")} WHERE id=$1`,
      [id],
    );
    if (!rows[0]) fail("Fornecedor não encontrado.", 404);
    const cnpj = normalizeCnpj(rows[0].documento);
    if (!cnpj) fail("Cadastre um CNPJ válido para liberar o acesso.");
    const hash = await bcrypt.hash("Senha@123", 12);
    try {
      if (acao === "ativar")
        await pool.query(
          `INSERT INTO ${t("fornecedor_acessos")} (fornecedor_id,cnpj,senha_hash) VALUES ($1,$2,$3)`,
          [id, cnpj, hash],
        );
      else {
        const result = await pool.query(
          `UPDATE ${t("fornecedor_acessos")} SET cnpj=$2,senha_hash=$3,ativo=true,troca_obrigatoria=true,versao=versao+1 WHERE fornecedor_id=$1`,
          [id, cnpj, hash],
        );
        if (!result.rowCount) fail("Ative o acesso primeiro.");
      }
    } catch (e) {
      if (e.code === "23505")
        fail("Este fornecedor ou CNPJ já possui acesso cadastrado.");
      throw e;
    }
    res.json({ ok: true });
  }),
);
supplierAdminRouter.get(
  "/compras/grupos",
  wrap(async (_req, res) => {
    res.json(
      (
        await pool.query(
          `SELECT g.id,g.nome,COALESCE(jsonb_agg(m.fornecedor_id) FILTER(WHERE m.fornecedor_id IS NOT NULL),'[]'::jsonb) fornecedores FROM ${t("grupos")} g LEFT JOIN ${t("grupo_membros")} m ON m.grupo_id=g.id GROUP BY g.id ORDER BY g.nome`,
        )
      ).rows,
    );
  }),
);
supplierAdminRouter.post(
  "/compras/grupos",
  wrap(async (req, res) => {
    const b = parsePurchase(
      z.object({
        id: idSchema.optional(),
        nome: z.string().trim().min(2).max(80),
        fornecedores: z.array(idSchema).max(500),
      }),
      req.body,
    );
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const id = b.id || randomUUID();
      if (b.id) {
        const r = await db.query(
          `UPDATE ${t("grupos")} SET nome=$2 WHERE id=$1 RETURNING id`,
          [id, b.nome],
        );
        if (!r.rowCount) fail("Grupo não encontrado.", 404);
      } else
        await db.query(`INSERT INTO ${t("grupos")} (id,nome) VALUES($1,$2)`, [
          id,
          b.nome,
        ]);
      await db.query(`DELETE FROM ${t("grupo_membros")} WHERE grupo_id=$1`, [
        id,
      ]);
      for (const supplier of new Set(b.fornecedores))
        await db.query(`INSERT INTO ${t("grupo_membros")} VALUES($1,$2)`, [
          id,
          supplier,
        ]);
      await db.query("COMMIT");
      res.json({ id });
    } catch (e) {
      await db.query("ROLLBACK");
      if (e.code === "23505") fail("Já existe um grupo com esse nome.");
      if (e.code === "23503") fail("Fornecedor não encontrado.");
      throw e;
    } finally {
      db.release();
    }
  }),
);
