import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { ADDITIONAL_MAINTENANCE_PLATES, mergeMaintenanceVehicles } from "../services/maintenanceVehicles.js";
import { requirePermission } from "../middleware/permissions.js";
import { expenseTelemetryOdometer } from "../services/expenseTelemetryOdometer.js";
import {unloadingTrips,unloadingTrip,unloadingCtes,resolveUnloading} from '../services/expenseUnloading.js';
import { validateBody } from "../middleware/validate.js";
import { expenseAccess, isExpenseDriver, requireExpensePlate } from "../services/expenseDriverAccess.js";

export const manutencaoPlantaoRouter = express.Router();
const TABLE = () => tableName("manutencao_plantao");
const LIST_COLUMNS = `id,placa,valor,servico,observacao,fornecedor,fornecedor_codigo,fornecedor_empresa,
  usuario_id,usuario_login,data_despesa,documento,revisao,criado_em,conferido_em,conferido_login,forma_pagamento_codigo,forma_pagamento_empresa,forma_pagamento_nome,descarga,
  hora_despesa,perfil_autor,justificativa_sem_nota,pago,lancado,data_pagamento,origem,litros,hodometro,local_despesa,combustivel_tipo,cliente_nota,hodometro_telemetria_em,(comprovante_foto IS NOT NULL) AS tem_comprovante,(painel_foto IS NOT NULL) AS tem_painel,(bomba_foto IS NOT NULL) AS tem_bomba,valor_combustivel,arla_litros,arla_valor`;
const canRegister = requirePermission("manutencao-plantao");
const canReview = (req, res, next) => isExpenseDriver(req.user)
  ? res.status(403).json({error: "O perfil motorista não possui acesso à conferência."})
  : requirePermission("conferencia-manutencao")(req, res, next);
const canRead = requirePermission(["manutencao-plantao", "conferencia-manutencao"]);
const photoSchema = z.string().max(1500000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable();
const schema = z.object({
  unloading: z.object({
    trip:z.object({company:z.string().regex(/^\d{1,9}$/),number:z.string().regex(/^\d{1,9}$/)}).strict(),
    cte:z.object({company:z.string().regex(/^\d{1,9}$/),series:z.string().min(1).max(20),code:z.string().regex(/^\d{1,12}$/)}).strict(),
    reimbursement:z.boolean(),
  }).strict().nullable().optional(),
  expenseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(),
  receiptReason: z.string().trim().max(300).optional(),
  fuelType: z.string().trim().max(80).optional(),
  customerName: z.string().trim().max(160).optional(),
  photos: z.object({odometer:photoSchema.optional(),pump:photoSchema.optional(),invoice:photoSchema.optional()}).strict().optional(),
  arlaLiters: z.number().positive().max(9999).nullable().optional(),
  arlaAmount: z.number().positive().max(999999.99).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001).nullable().optional(),
  fuelAmount: z.number().positive().max(999999.99).nullable().optional(),
  source: z.enum(["colaborador", "motorista"]).optional(),
  liters: z.number().positive().max(9999).nullable().optional(),
  odometer: z.number().min(0).max(9999999.9).refine(v=>Math.abs(v*10-Math.round(v*10))<0.00001).nullable().optional(),
  location: z.string().trim().max(160).optional(),
  receipt: z.string().max(1500000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(),
  paid: z.boolean().nullable().optional(),
  posted: z.boolean().nullable().optional(),
  expenseDate: z.iso.date().optional(),
  document: z.string().trim().max(80).default(""),
  plate: z.string().regex(/^[A-Z]{3}\d[A-Z0-9]\d{2}$/),
  amount: z.number().positive().max(999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001),
  service: z.enum(["Borracharia", "Mecânica", "Elétrica", "Outros", "Abastecimento", "Manutenção", "Descarga"]),
  note: z.string().trim().max(300).default(""),
  supplier: z.string().trim().max(120).default(""),
  supplierCode: z.union([z.string().max(30), z.number()]).nullable().optional(),
  supplierCompany: z.union([z.string().max(30), z.number()]).nullable().optional(),
}).strict();
function record(row) {
  return {expenseTime: row.hora_despesa || null, authorProfile: row.perfil_autor || null, receiptReason: row.justificativa_sem_nota || "", fuelType: row.combustivel_tipo || "", customerName: row.cliente_nota || "", odometerDate: row.hodometro_telemetria_em || null, source: row.origem || "colaborador", liters: row.litros == null ? null : Number(row.litros), odometer: row.hodometro == null ? null : Number(row.hodometro),
    arlaLiters: row.arla_litros == null ? null : Number(row.arla_litros),
    arlaAmount: row.arla_valor == null ? null : Number(row.arla_valor),
    fuelAmount: row.valor_combustivel == null ? null : Number(row.valor_combustivel),
    photoKinds: {odometer:Boolean(row.painel_foto || row.tem_painel),pump:Boolean(row.bomba_foto || row.tem_bomba),invoice:Boolean(row.comprovante_foto || row.tem_comprovante)},
    location: row.local_despesa, hasReceipt: Boolean(row.comprovante_foto || row.tem_comprovante || row.painel_foto || row.tem_painel || row.bomba_foto || row.tem_bomba), id: row.id, plate: row.placa, amount: Number(row.valor), service: row.servico,
    note: row.observacao, supplier: row.fornecedor, supplierCode: row.fornecedor_codigo,
    supplierCompany: row.fornecedor_empresa, authorId: row.usuario_id, author: row.usuario_login,
    expenseDate: row.data_despesa instanceof Date ? row.data_despesa.toLocaleDateString("en-CA") : row.data_despesa,
    paymentDate: row.data_pagamento instanceof Date ? row.data_pagamento.toLocaleDateString("en-CA") : row.data_pagamento ?? null,
    unloading:row.descarga || null,
    paymentMethod: row.forma_pagamento_codigo == null ? null : {code:row.forma_pagamento_codigo,company:row.forma_pagamento_empresa,name:row.forma_pagamento_nome},
    paid: row.pago ?? null, posted: row.lancado ?? null, document: row.documento, version: row.revisao, checkedAt: row.conferido_em,
    date: row.criado_em, checked: Boolean(row.conferido_em), checkedBy: row.conferido_login};
}
manutencaoPlantaoRouter.get("/manutencao-plantao/formas-pagamento", canReview, async (_req,res,next) => {
  try {
    const {rows} = await clientPool.query(`SELECT codigofpg::text AS code,empresafpg::text AS company,TRIM(nomefpg) AS name
      FROM financeiro.formaspagamento WHERE ativofpg='S' ORDER BY nomefpg,empresafpg,codigofpg`);
    res.set("Cache-Control","no-store").json({methods:rows});
  } catch(error) {next(error);}
});
export async function plantaoPlates() {
  const [telemetry, extra] = await Promise.all([
    getVeiculosPool().query("SELECT DISTINCT placa FROM rodobach.veiculos WHERE placa IS NOT NULL"),
    clientPool.query(`SELECT DISTINCT placavei AS placa FROM frotas.veiculos
      WHERE regexp_replace(upper(placavei::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND tipopropriedadevei::text = 'P' AND COALESCE(situacaovei::text, '') <> 'I'`, [ADDITIONAL_MAINTENANCE_PLATES]),
  ]);
  return mergeMaintenanceVehicles(telemetry.rows, extra.rows);
}
manutencaoPlantaoRouter.get("/manutencao-plantao/placas", canRead, async (req, res, next) => {
  try {
    const access = await expenseAccess(req.user);
    const veiculos = isExpenseDriver(req.user)
      ? (access.plate ? [{placa: access.plate}] : []) : await plantaoPlates();
    res.json({veiculos, access});
  } catch (error) { next(error); }
});
manutencaoPlantaoRouter.get("/manutencao-plantao/placas/:plate/hodometro", canRead, async (req,res,next) => {
  try {
    const plate=req.params.plate.toUpperCase();
    await requireExpensePlate(req.user, plate);
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) return res.status(400).json({error:"Placa inválida."});
    if (!(await plantaoPlates()).some(item=>item.placa===plate)) return res.status(404).json({error:"Veículo não encontrado."});
    const expenseDate = req.query.date || today();
    if (!z.iso.date().safeParse(expenseDate).success || expenseDate > today()) return res.status(400).json({error:"Data da despesa inválida."});
    const time = req.query.time;
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time || "")) return res.status(400).json({error:"Informe o horário da nota."});
    if (new Date(`${expenseDate}T${time.length === 5 ? time+":00" : time}-03:00`) > new Date()) return res.status(400).json({error:"O horário da despesa não pode estar no futuro."});
    res.set("Cache-Control","no-store").json(await expenseTelemetryOdometer(plate, expenseDate, time));
  } catch(error) {next(error);}
});
manutencaoPlantaoRouter.get('/manutencao-plantao/placas/:plate/descarga-viagens',canRead,async(req,res,next)=>{
  try {
    const plate=req.params.plate.toUpperCase();
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) return res.status(400).json({error:'Placa inválida.'});
    await requireExpensePlate(req.user,plate);
    if (!(await plantaoPlates()).some(item=>item.placa===plate)) return res.status(404).json({error:'Veículo não encontrado.'});
    const number=String(req.query.number || '');
    const company=String(req.query.company || '');
    if ((number && !/^\d{1,9}$/.test(number)) || (company && (!/^\d{1,9}$/.test(company) || !number))) return res.status(400).json({error:'Viagem inválida.'});
    if (company) {
      const trip=await unloadingTrip(plate,company,number);
      return res.set('Cache-Control','no-store').json({trip,ctes:await unloadingCtes(company,number)});
    }
    res.set('Cache-Control','no-store').json({trips:await unloadingTrips(plate,number)});
  } catch(error) {next(error);}
});
manutencaoPlantaoRouter.get("/manutencao-plantao/placas/:plate/localizacao", canRead, async (req,res,next) => {
  try {
    const plate=req.params.plate.toUpperCase();
    await requireExpensePlate(req.user, plate);
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) return res.status(400).json({error:"Placa inválida."});
    if (!(await plantaoPlates()).some(item=>item.placa===plate)) return res.status(404).json({error:"Veículo não encontrado."});
    const {rows}=await getVeiculosPool().query(`SELECT m.municipio,m.uf,m.rodovia,m.rua,m.data_hora
      FROM rodobach.veiculos v JOIN LATERAL (
        SELECT municipio,uf,rodovia,rua,data_hora FROM rodobach.mensagens_cb
        WHERE veiculo_id=v.veiculo_id AND data_hora<=NOW()
          AND (NULLIF(TRIM(municipio),'') IS NOT NULL OR NULLIF(TRIM(rodovia),'') IS NOT NULL OR NULLIF(TRIM(rua),'') IS NOT NULL)
        ORDER BY data_hora DESC LIMIT 1
      ) m ON TRUE WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=$1
      ORDER BY m.data_hora DESC LIMIT 1`,[plate]);
    const row=rows[0];
    const city=[row?.municipio,row?.uf].map(v=>String(v || "").trim()).filter(Boolean).join(" / ");
    const address=[row?.rodovia,row?.rua].map(v=>String(v || "").trim()).filter(Boolean).join(" · ");
    res.set("Cache-Control","no-store").json({location:[city,address].filter(Boolean).join(" — ").slice(0,160),city,address,date:row?.data_hora || null,source:"telemetria"});
  } catch(error) {next(error);}
});
manutencaoPlantaoRouter.get("/manutencao-plantao/lancamentos", canRegister, async (req, res, next) => {
  try {
    const {rows} = await pool.query(`SELECT ${LIST_COLUMNS} FROM ${TABLE()} WHERE usuario_id = $1 AND excluido_em IS NULL ORDER BY criado_em DESC`, [req.user.id]);
    res.json({records: rows.map(record)});
  } catch (error) { next(error); }
});
manutencaoPlantaoRouter.get("/manutencao-plantao/conferencia", canReview, async (_req, res, next) => {
  try { const {rows} = await pool.query(`SELECT ${LIST_COLUMNS} FROM ${TABLE()} WHERE excluido_em IS NULL ORDER BY criado_em DESC`); res.json({records: rows.map(record)}); }
  catch (error) { next(error); }
});
const canManage = req => !isExpenseDriver(req.user) && (req.user.admin === true || req.user.permissions?.["conferencia-manutencao"] === true);
const today = () => new Date().toLocaleDateString("en-CA", {timeZone:"America/Sao_Paulo"});
const changeSchema = schema.extend({version: z.number().int().positive()});
const deleteSchema = z.object({version:z.number().int().positive(), reason:z.string().trim().min(5).max(300)}).strict();
const historyTable = () => tableName("manutencao_plantao_historico");
const uuidValid = (req, res) => {
  if (z.uuid().safeParse(req.params.id).success) return true;
  res.status(400).json({error:"Lançamento inválido."}); return false;
};
async function audit(client, req, event, before, after) {
  const snapshot = row => row ? { ...row, comprovante_foto: Boolean(row.comprovante_foto),painel_foto:Boolean(row.painel_foto),bomba_foto:Boolean(row.bomba_foto) } : null;
  await client.query(`INSERT INTO ${historyTable()} (lancamento_id, evento, usuario_id, usuario_login, antes, depois)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [after.id,event,req.user.id,req.user.login,before ? JSON.stringify(snapshot(before)) : null,JSON.stringify(snapshot(after))]);
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
  let telemetry = null;
  let unloading = null;
  try {
    const body = req.body;
    if (!canManage(req) && (action === "status" || body.paid !== undefined || body.posted !== undefined || body.paymentDate !== undefined)) {
      return res.status(403).json({error:"Pagamento e lançamento são exclusivos da conferência."});
    }
    if (action === "status" && body.paymentDate && body.paymentDate > today()) {
      return res.status(400).json({error:"A data do pagamento não pode estar no futuro."});
    }
    if (["create","edit"].includes(action)) {
      await requireExpensePlate(req.user, body.plate);
      if (body.paid !== undefined || body.posted !== undefined) return res.status(400).json({error:"Atualize os controles pela conferência."});
      const error = await validateRegistration(body);
      if (error) return res.status(400).json({error});
      if (body.service === 'Descarga') {
        if (!body.note.trim()) return res.status(400).json({error:'Descreva os custos da descarga, como chapa e outros serviços.'});
        unloading=await resolveUnloading(body.plate,body.unloading);
      } else if (body.unloading) return res.status(400).json({error:'Vínculo de descarga só pode ser usado no tipo Descarga.'});
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
      if (before.conferido_em && !["check", "status"].includes(action)) return await reject(409,"Lançamento conferido não pode ser editado ou excluído.");
      if (before.revisao !== body.version && !(action === "check" && before.conferido_em)) return await reject(409,"Este lançamento foi alterado. Atualize a lista antes de continuar.");
    }
    let after;
    if (["create","edit"].includes(action)) {
      const invoice = body.photos?.invoice !== undefined ? body.photos.invoice : body.receipt !== undefined ? body.receipt : before?.comprovante_foto;
      const receiptReason = body.receiptReason === undefined ? before?.justificativa_sem_nota || "" : body.receiptReason;
      if (!invoice && receiptReason.length < 10) return await reject(400,"Anexe a nota ou informe uma justificativa com pelo menos 10 caracteres.");
      const expenseTime = body.expenseTime === undefined ? before?.hora_despesa || null : body.expenseTime;
      const previousDay = before ? record(before).expenseDate : null;
      const normalizeTime = value => value?.length === 5 ? value+":00" : value || null;
      if (expenseTime && new Date(`${body.expenseDate}T${normalizeTime(expenseTime)}-03:00`) > new Date()) return await reject(400,"O horário da despesa não pode estar no futuro.");
      const preserveKm = before && before.placa === body.plate && previousDay === body.expenseDate
        && normalizeTime(before.hora_despesa) === normalizeTime(expenseTime) && before.hodometro != null;
      if (!preserveKm && (body.service === "Abastecimento" || body.odometer !== undefined)) {
        if (!expenseTime && body.service === "Abastecimento") return await reject(400,"Informe o horário da nota para consultar o KM do abastecimento.");
        if (expenseTime) {
          telemetry = await expenseTelemetryOdometer(body.plate, body.expenseDate, expenseTime);
        }
        body.odometer = telemetry?.odometer ?? null;
        if (body.service === "Abastecimento" && body.odometer == null) return await reject(422,"Sem leitura de telemetria anterior ao horário da nota neste dia. Confira data e horário.");
      } else if (preserveKm) body.odometer = Number(before.hodometro);
      const source = before?.origem || body.source || "colaborador";
      if (before && body.source && body.source !== before.origem) return await reject(400,"A origem do lançamento não pode ser alterada.");
      if (source === "motorista" && !["Abastecimento","Manutenção","Outros","Descarga"].includes(body.service)) return await reject(400,"Selecione um tipo de despesa válido.");
      if (source === "colaborador" && ["Abastecimento","Manutenção","Descarga"].includes(body.service)) return await reject(400,"Use a aba Motorista para este tipo de despesa.");
      const liters = body.liters === undefined ? before?.litros : body.liters;
      const odometer = body.odometer === undefined ? before?.hodometro : body.odometer;
      if (source === "motorista" && body.service === "Abastecimento" && (!(Number(liters) > 0) || odometer == null)) return await reject(400,"Informe os litros e o hodômetro do abastecimento.");
      if (source === "motorista" && body.service === "Outros" && !body.note) return await reject(400,"Descreva a despesa para a conferência.");
      const duplicate = await client.query(`SELECT id FROM ${TABLE()} WHERE excluido_em IS NULL AND ($1::uuid IS NULL OR id <> $1) AND (
        (placa=$2 AND valor=$3 AND data_despesa=$4::date AND servico=$5 AND lower(trim(fornecedor))=lower(trim($6)) AND (servico<>'Descarga' OR descarga @> $8::jsonb))
        OR ($7 <> '' AND $6 <> '' AND lower(trim(fornecedor))=lower(trim($6)) AND regexp_replace(upper(documento), '[^A-Z0-9]', '', 'g')=regexp_replace(upper($7), '[^A-Z0-9]', '', 'g'))
      ) LIMIT 1`,[before?.id || null,body.plate,body.amount,body.expenseDate,body.service,body.supplier,body.document,body.unloading ? JSON.stringify({trip:body.unloading.trip,cte:body.unloading.cte}) : null]);
      if (duplicate.rows.length) return await reject(409,"Possível duplicidade: já existe um lançamento com a mesma placa, data, valor, serviço e fornecedor, ou com o mesmo comprovante e fornecedor. Confira o registro existente.");
      const fuelAmount = body.fuelAmount === undefined ? before?.valor_combustivel : body.fuelAmount;
      if (body.service === "Abastecimento" && fuelAmount != null && Number(fuelAmount) > body.amount) return await reject(400,"O valor do combustível não pode superar o total da despesa.");
      const arlaLiters=body.arlaLiters === undefined ? before?.arla_litros : body.arlaLiters;
      const arlaAmount=body.arlaAmount === undefined ? before?.arla_valor : body.arlaAmount;
      if (body.service === "Abastecimento") {
        if ((arlaLiters != null) !== (arlaAmount != null)) return await reject(400,"Informe os litros e o valor do ARLA.");
        if (Math.round((Number(fuelAmount || 0)+Number(arlaAmount || 0))*100)>Math.round(body.amount*100)) return await reject(400,"Combustível e ARLA não podem superar o total da despesa.");
      } else if (body.arlaLiters != null || body.arlaAmount != null) return await reject(400,"ARLA só pode ser informado no abastecimento.");
      const values = [before?.id || randomUUID(),body.plate,body.amount,body.service,body.note,body.supplier,body.supplierCode ?? null,body.supplierCode == null ? null : body.supplierCompany,req.user.id,req.user.login,body.expenseDate,body.document,body.paid ?? null,body.posted ?? null];
      after = (await client.query(action === "create" ? `INSERT INTO ${TABLE()}
        (id,placa,valor,servico,observacao,fornecedor,fornecedor_codigo,fornecedor_empresa,usuario_id,usuario_login,data_despesa,documento,pago,lancado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *` : `UPDATE ${TABLE()} SET placa=$2,valor=$3,servico=$4,observacao=$5,fornecedor=$6,fornecedor_codigo=$7,fornecedor_empresa=$8,
        data_despesa=$9,documento=$10,pago=$11,lancado=$12,revisao=revisao+1 WHERE id=$1 RETURNING *`,action === "create" ? values : [...values.slice(0,8),body.expenseDate,body.document,body.paid === undefined ? before.pago : body.paid,body.posted === undefined ? before.lancado : body.posted])).rows[0];
      after = (await client.query(`UPDATE ${TABLE()} SET origem=$2,litros=$3,hodometro=$4,local_despesa=$5,comprovante_foto=$6,painel_foto=$7,bomba_foto=$8,valor_combustivel=$9,arla_litros=$10,arla_valor=$11,combustivel_tipo=$12,cliente_nota=$13,hodometro_telemetria_em=$14,hora_despesa=$15,perfil_autor=$16,justificativa_sem_nota=$17 WHERE id=$1 RETURNING *`,[
        after.id,source,body.service === "Abastecimento" ? liters : null,odometer ?? null,
        body.location === undefined ? before?.local_despesa || "" : body.location,
        body.photos?.invoice !== undefined ? body.photos.invoice : body.receipt === undefined ? before?.comprovante_foto || null : body.receipt,
        body.photos?.odometer === undefined ? before?.painel_foto || null : body.photos.odometer,
        body.photos?.pump === undefined ? before?.bomba_foto || null : body.photos.pump,
        body.service === "Abastecimento" ? fuelAmount ?? null : null,
        body.service === "Abastecimento" ? arlaLiters ?? null : null,
        body.service === "Abastecimento" ? arlaAmount ?? null : null,
        body.fuelType === undefined ? before?.combustivel_tipo || "" : body.fuelType,
        body.customerName === undefined ? before?.cliente_nota || "" : body.customerName,
        telemetry ? telemetry.date : before?.hodometro_telemetria_em || null,
        expenseTime,
        before ? before.perfil_autor : req.user.expenseProfile === "motorista" ? "motorista" : "colaborador",
        invoice ? "" : receiptReason,
      ])).rows[0];
      after = (await client.query(`UPDATE ${TABLE()} SET descarga=$2::jsonb WHERE id=$1 RETURNING *`,[after.id,unloading ? JSON.stringify(unloading) : null])).rows[0];
    } else if (action === "status") {
      let method = record(before).paymentMethod;
      if (body.paymentDate) {
        if (!body.paymentMethod) return await reject(400,"Selecione a forma de pagamento.");
        const {rows} = await clientPool.query(`SELECT codigofpg::text AS code,empresafpg::text AS company,TRIM(nomefpg) AS name
          FROM financeiro.formaspagamento WHERE codigofpg::text=$1 AND empresafpg::text=$2 AND ativofpg='S'`,
        [body.paymentMethod.code,body.paymentMethod.company]);
        if (!rows[0]) return await reject(400,"Forma de pagamento não encontrada ou inativa. Selecione uma opção atual do cadastro.");
        method=rows[0];
      } else if (body.paymentDate === null) method=null;
      after = (await client.query(`UPDATE ${TABLE()} SET pago=$2,lancado=$3,data_pagamento=$4,
        forma_pagamento_codigo=$5,forma_pagamento_empresa=$6,forma_pagamento_nome=$7,revisao=revisao+1 WHERE id=$1 RETURNING *`,
      [before.id,body.paymentDate === undefined ? before.pago : Boolean(body.paymentDate),body.posted === undefined ? before.lancado : body.posted,body.paymentDate === undefined ? before.data_pagamento : body.paymentDate,
        method?.code ?? null,method?.company ?? null,method?.name ?? null])).rows[0];
    } else if (action === "delete") {
      after = (await client.query(`UPDATE ${TABLE()} SET excluido_em=NOW(),excluido_por=$2,motivo_exclusao=$3,revisao=revisao+1 WHERE id=$1 RETURNING *`,[before.id,req.user.login,body.reason])).rows[0];
    } else {
      if (before.conferido_em) {await client.query("COMMIT"); return res.json({record:record(before)});}
      if (!before.comprovante_foto && (before.justificativa_sem_nota || "").trim().length<10) return await reject(400,"Anexe a nota ou registre a justificativa antes de conferir.");
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
  manutencaoPlantaoRouter.patch(`/manutencao-plantao/${path}/:id/controle`,canReview,validateBody(z.object({version:z.number().int().positive(),paymentDate:z.iso.date().nullable().optional(),paymentMethod:z.object({code:z.string().min(1).max(30),company:z.string().min(1).max(30)}).strict().optional(),posted:z.boolean().optional()}).strict().refine(body => body.posted !== undefined || body.paymentDate !== undefined).refine(body => !body.paymentMethod || Boolean(body.paymentDate))),(req,res,next)=>mutate(req,res,next,"status"));
  manutencaoPlantaoRouter.put(`/manutencao-plantao/${path}/:id`,permission,validateBody(changeSchema),(req,res,next)=>mutate(req,res,next,"edit"));
  manutencaoPlantaoRouter.delete(`/manutencao-plantao/${path}/:id`,permission,validateBody(deleteSchema),(req,res,next)=>mutate(req,res,next,"delete"));
  manutencaoPlantaoRouter.get(`/manutencao-plantao/${path}/:id/comprovante`,permission,async(req,res,next)=>{
    if (!uuidValid(req,res)) return;
    try {
      const {rows} = await pool.query(`SELECT usuario_id,comprovante_foto,painel_foto,bomba_foto FROM ${TABLE()} WHERE id=$1 AND excluido_em IS NULL`,[req.params.id]);
      if (!rows[0]) return res.status(404).json({error:"Lançamento não encontrado."});
      if (!canManage(req) && String(rows[0].usuario_id)!==String(req.user.id)) return res.status(403).json({error:"Sem acesso a este comprovante."});
      res.set("Cache-Control","no-store").json({receipt:rows[0].comprovante_foto,photos:{odometer:rows[0].painel_foto,pump:rows[0].bomba_foto,invoice:rows[0].comprovante_foto}});
    } catch(error) {next(error);}
  });
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
