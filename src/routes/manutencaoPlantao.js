import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { ADDITIONAL_MAINTENANCE_PLATES, mergeMaintenanceVehicles } from "../services/maintenanceVehicles.js";
import { requirePermission } from "../middleware/permissions.js";
import { validateBody } from "../middleware/validate.js";

export const manutencaoPlantaoRouter = express.Router();
const TABLE = () => tableName("manutencao_plantao");
const canRegister = requirePermission("manutencao-plantao");
const canReview = requirePermission("conferencia-manutencao");
const canRead = requirePermission(["manutencao-plantao", "conferencia-manutencao"]);
const schema = z.object({
  plate: z.string().regex(/^[A-Z]{3}\d[A-Z0-9]\d{2}$/),
  amount: z.number().positive().max(999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001),
  service: z.enum(["Borracharia", "Mecânica", "Elétrica", "Outros"]),
  note: z.string().trim().max(300).default(""),
  supplier: z.string().trim().max(120).default(""),
  supplierCode: z.union([z.string().max(30), z.number()]).nullable().optional(),
  supplierCompany: z.union([z.string().max(30), z.number()]).nullable().optional(),
}).strict();
function record(row) {
  return {id: row.id, plate: row.placa, amount: Number(row.valor), service: row.servico,
    note: row.observacao, supplier: row.fornecedor, supplierCode: row.fornecedor_codigo,
    supplierCompany: row.fornecedor_empresa, authorId: row.usuario_id, author: row.usuario_login,
    date: row.criado_em, checked: Boolean(row.conferido_em), checkedBy: row.conferido_login};
}
export async function plantaoPlates() {
  const [telemetry, extra] = await Promise.all([
    getVeiculosPool().query("SELECT DISTINCT placa FROM rodobach.veiculos WHERE placa IS NOT NULL"),
    clientPool.query(`SELECT DISTINCT placavei AS placa FROM frotas.veiculos
      WHERE regexp_replace(upper(placavei::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND tipopropriedadevei::text = 'P' AND COALESCE(situacaovei::text, '') <> 'I'`, [ADDITIONAL_MAINTENANCE_PLATES]),
  ]);
  return mergeMaintenanceVehicles(telemetry.rows, extra.rows);
}
manutencaoPlantaoRouter.get("/manutencao-plantao/placas", canRead, async (_req, res, next) => {
  try { res.json({veiculos: await plantaoPlates()}); } catch (error) { next(error); }
});
manutencaoPlantaoRouter.get("/manutencao-plantao/lancamentos", canRegister, async (req, res, next) => {
  try {
    const {rows} = await pool.query(`SELECT * FROM ${TABLE()} WHERE usuario_id = $1 ORDER BY criado_em DESC`, [req.user.id]);
    res.json({records: rows.map(record)});
  } catch (error) { next(error); }
});
manutencaoPlantaoRouter.get("/manutencao-plantao/conferencia", canReview, async (_req, res, next) => {
  try { const {rows} = await pool.query(`SELECT * FROM ${TABLE()} ORDER BY criado_em DESC`); res.json({records: rows.map(record)}); }
  catch (error) { next(error); }
});
manutencaoPlantaoRouter.post("/manutencao-plantao/lancamentos", canRegister, validateBody(schema), async (req, res, next) => {
  try {
    const body = req.body;
    if (!(await plantaoPlates()).some(item => item.placa === body.plate)) return res.status(400).json({error: "Selecione uma placa cadastrada na frota."});
    if (body.supplierCode != null) {
      const {rows} = await clientPool.query(`SELECT COALESCE(NULLIF(TRIM(fantasiafor), ''), TRIM(nomefor)) AS nome FROM gerais.fornecedores WHERE codigofor::text = $1 AND empresafor::text = $2 LIMIT 1`, [String(body.supplierCode), String(body.supplierCompany)]);
      if (!rows[0]) return res.status(400).json({error:"Fornecedor não encontrado no cadastro."});
      body.supplier = rows[0].nome;
    }
    const {rows} = await pool.query(`INSERT INTO ${TABLE()}
      (id, placa, valor, servico, observacao, fornecedor, fornecedor_codigo, fornecedor_empresa, usuario_id, usuario_login)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [randomUUID(), body.plate, body.amount, body.service, body.note, body.supplier, body.supplierCode ?? null, body.supplierCode == null ? null : body.supplierCompany, req.user.id, req.user.login]);
    res.status(201).json({record: record(rows[0])});
  } catch (error) { next(error); }
});
manutencaoPlantaoRouter.patch("/manutencao-plantao/conferencia/:id", canReview, async (req, res, next) => {
  if (!z.uuid().safeParse(req.params.id).success) return res.status(400).json({error:"Lançamento inválido."});
  try {
    const {rows} = await pool.query(`UPDATE ${TABLE()} SET
      conferido_por = COALESCE(conferido_por, $2), conferido_login = COALESCE(conferido_login, $3),
      conferido_em = COALESCE(conferido_em, NOW()) WHERE id = $1 RETURNING *`, [req.params.id, req.user.id, req.user.login]);
    if (!rows[0]) return res.status(404).json({error:"Lançamento não encontrado."});
    res.json({record: record(rows[0])});
  } catch (error) { next(error); }
});
