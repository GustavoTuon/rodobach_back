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
  expenseDate: z.iso.date().optional(),
  document: z.string().trim().max(80).default(""),
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
    expenseDate: row.data_despesa instanceof Date ? row.data_despesa.toLocaleDateString("en-CA") : row.data_despesa,
    document: row.documento, version: row.revisao, checkedAt: row.conferido_em,
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
    const {rows} = await pool.query(`SELECT * FROM ${TABLE()} WHERE usuario_id = $1 AND excluido_em IS NULL ORDER BY criado_em DESC`, [req.user.id]);
    res.json({records: rows.map(record)});
  } catch (error) { next(error); }
});
manutencaoPlantaoRouter.get("/manutencao-plantao/conferencia", canReview, async (_req, res, next) => {
  try { const {rows} = await pool.query(`SELECT * FROM ${TABLE()} WHERE excluido_em IS NULL ORDER BY criado_em DESC`); res.json({records: rows.map(record)}); }
  catch (error) { next(error); }
});
const canManage = req => req.user.admin === true || req.user.permissions?.["conferencia-manutencao"] === true;
const today = () => new Date().toLocaleDateString("en-CA", {timeZone:"America/Sao_Paulo"});
const changeSchema = schema.extend({version: z.number().int().positive()});
const deleteSchema = z.object({version:z.number().int().positive(), reason:z.string().trim().min(5).max(300)}).strict();
const historyTable = () => tableName("manutencao_plantao_historico");
const uuidValid = (req, res) => {
  if (z.uuid().safeParse(req.params.id).success) return true;
  res.status(400).json({error:"Lançamento inválido."}); return false;
};
async function audit(client, req, event, before, after) {
  await client.query(`INSERT INTO ${historyTable()} (lancamento_id, evento, usuario_id, usuario_login, antes, depois)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [after.id,event,req.user.id,req.user.login,before ? JSON.stringify(before) : null,JSON.stringify(after)]);
}
async function validateRegistration(body) {
  if (!(await plantaoPlates()).some(item => item.placa === body.plate)) return "Selecione uma placa cadastrada na frota.";
  body.expenseDate ||= today();
  if (body.expenseDate > today()) return "A data da despesa não pode estar no futuro.";
  if (body.supplierCode != null) {
    const {rows} = await clientPool.query(`SELECT COALESCE(NULLIF(TRIM(fantasiafor), ''), TRIM(nomefor)) AS nome FROM gerais.fornecedores WHERE codigofor::text = $1 AND empresafor::text = $2 LIMIT 1`, [String(body.supplierCode), String(body.supplierCompany)]);
    if (!rows[0]) return "Fornecedor não encontrado no cadastro.";
    body.supplier = rows[0].nome;
  }
}
async function mutate(req, res, next, action) {
  if (action !== "create" && !uuidValid(req,res)) return;
  let client;
  try {
    const body = req.body;
    if (["create","edit"].includes(action)) {
      const error = await validateRegistration(body);
      if (error) return res.status(400).json({error});
    }
    client = await pool.connect();
    await client.query("BEGIN");
    // Serialize writes, including edits and confirmations, to prevent concurrent duplicates.
    await client.query(`LOCK TABLE ${TABLE()} IN SHARE ROW EXCLUSIVE MODE`);
    const reject = async (status,error) => {await client.query("ROLLBACK"); return res.status(status).json({error});};
    let before = null;
    if (action !== "create") {
      before = (await client.query(`SELECT * FROM ${TABLE()} WHERE id=$1 AND excluido_em IS NULL FOR UPDATE`,[req.params.id])).rows[0];
      if (!before) return await reject(404,"Lançamento não encontrado.");
      if (!canManage(req) && String(before.usuario_id) !== String(req.user.id)) return await reject(403,"Você s? pode alterar seus próprios lançamentos.");
      if (before.conferido_em && action !== "check") return await reject(409,"Lançamento conferido não pode ser editado ou excluído.");
      if (before.revisao !== body.version && !(action === "check" && before.conferido_em)) return await reject(409,"Este lançamento foi alterado. Atualize a lista antes de continuar.");
    }
    let after;
    if (["create","edit"].includes(action)) {
      const duplicate = await client.query(`SELECT id FROM ${TABLE()} WHERE excluido_em IS NULL AND ($1::uuid IS NULL OR id <> $1) AND (
        (placa=$2 AND valor=$3 AND data_despesa=$4::date AND servico=$5 AND lower(trim(fornecedor))=lower(trim($6)))
        OR ($7 <> '' AND $6 <> '' AND lower(trim(fornecedor))=lower(trim($6)) AND regexp_replace(upper(documento), '[^A-Z0-9]', '', 'g')=regexp_replace(upper($7), '[^A-Z0-9]', '', 'g'))
      ) LIMIT 1`,[before?.id || null,body.plate,body.amount,body.expenseDate,body.service,body.supplier,body.document]);
      if (duplicate.rows.length) return await reject(409,"Possível duplicidade: já existe um lançamento com a mesma placa, data, valor, serviço e fornecedor, ou com o mesmo comprovante e fornecedor. Confira o registro existente.");
      const values = [before?.id || randomUUID(),body.plate,body.amount,body.service,body.note,body.supplier,body.supplierCode ?? null,body.supplierCode == null ? null : body.supplierCompany,req.user.id,req.user.login,body.expenseDate,body.document];
      after = (await client.query(action === "create" ? `INSERT INTO ${TABLE()}
        (id,placa,valor,servico,observacao,fornecedor,fornecedor_codigo,fornecedor_empresa,usuario_id,usuario_login,data_despesa,documento)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *` : `UPDATE ${TABLE()} SET placa=$2,valor=$3,servico=$4,observacao=$5,fornecedor=$6,fornecedor_codigo=$7,fornecedor_empresa=$8,
        data_despesa=$9,documento=$10,revisao=revisao+1 WHERE id=$1 RETURNING *`,action === "create" ? values : [...values.slice(0,8),body.expenseDate,body.document])).rows[0];
    } else if (action === "delete") {
      after = (await client.query(`UPDATE ${TABLE()} SET excluido_em=NOW(),excluido_por=$2,motivo_exclusao=$3,revisao=revisao+1 WHERE id=$1 RETURNING *`,[before.id,req.user.login,body.reason])).rows[0];
    } else {
      if (before.conferido_em) {await client.query("COMMIT"); return res.json({record:record(before)});}
      after = (await client.query(`UPDATE ${TABLE()} SET conferido_por=$2,conferido_login=$3,conferido_em=NOW(),revisao=revisao+1 WHERE id=$1 RETURNING *`,[before.id,req.user.id,req.user.login])).rows[0];
    }
    await audit(client,req,action,before,after);
    await client.query("COMMIT");
    res.status(action === "create" ? 201 : 200).json(action === "delete" ? {ok:true} : {record:record(after)});
  } catch (error) {if (client) await client.query("ROLLBACK").catch(()=>{}); next(error);}
  finally {client?.release();}
}
manutencaoPlantaoRouter.post("/manutencao-plantao/lancamentos",canRegister,validateBody(schema),(req,res,next)=>mutate(req,res,next,"create"));
for (const path of ["lancamentos","conferencia"]) {
  const permission = path === "conferencia" ? canReview : canRegister;
  manutencaoPlantaoRouter.put(`/manutencao-plantao/${path}/:id`,permission,validateBody(changeSchema),(req,res,next)=>mutate(req,res,next,"edit"));
  manutencaoPlantaoRouter.delete(`/manutencao-plantao/${path}/:id`,permission,validateBody(deleteSchema),(req,res,next)=>mutate(req,res,next,"delete"));
  manutencaoPlantaoRouter.get(`/manutencao-plantao/${path}/:id/historico`,permission,async(req,res,next)=>{
    if (!uuidValid(req,res)) return;
    try {
      const {rows} = await pool.query(`SELECT usuario_id FROM ${TABLE()} WHERE id=$1`,[req.params.id]);
      if (!rows[0]) return res.status(404).json({error:"Lançamento não encontrado."});
      if (!canManage(req) && String(rows[0].usuario_id)!==String(req.user.id)) return res.status(403).json({error:"Sem acesso a este lançamento."});
      const history = await pool.query(`SELECT evento, usuario_login, ocorrido_em, antes, depois FROM ${historyTable()} WHERE lancamento_id=$1 ORDER BY ocorrido_em DESC,id DESC`,[req.params.id]);
      res.json({history:history.rows});
    } catch(error) {next(error);}
  });
}
manutencaoPlantaoRouter.patch("/manutencao-plantao/conferencia/:id",canReview,validateBody(z.object({version:z.number().int().positive()}).strict()),(req,res,next)=>mutate(req,res,next,"check"));
