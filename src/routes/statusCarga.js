import { Router } from "express";
import { getStatusCargaFrota } from "../services/statusCargaService.js";
import { getOciosidadeFrota, loadDocuments } from "../services/ociosidadeFrotaService.js";
import { saveConfirmation, removeConfirmation, suggestStops, validateConfirmation, documentKey } from "../services/conferenciaDocumentos.js";
import { listEmptyVehicleAlerts, runEmptyVehicleAlerts } from "../services/statusCargaAlertaService.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {getPainelTv} from '../services/painelTvService.js';
import {validateCargoConfirmation,saveCargoConfirmation,cargoConfirmationHistory,cancelCargoConfirmation,correctionState} from '../services/painelCargaConfirmacoes.js';

export const statusCargaRouter = Router();
statusCargaRouter.get('/frota/painel-tv',async(_req,res,next)=>{try{res.json(await getPainelTv());}catch(error){next(error);}});
statusCargaRouter.get('/frota/painel-tv/confirmacoes',requireAdmin,async(req,res,next)=>{
  try {
    const rows=await cargoConfirmationHistory(String(req.query.placa||'').toUpperCase());
    const data=await getPainelTv();
    const item=data.itens.find(item=>item.placa===String(req.query.placa||'').toUpperCase());
    res.json({registros:rows.map((row,index)=>({...row,estado:index>0&&!row.cancelado_em?'Substituída':correctionState(row,item)}))});
  } catch(error){next(error);}
});
statusCargaRouter.post('/frota/painel-tv/confirmacoes',requireAdmin,async(req,res,next)=>{
  try {
    const input=validateCargoConfirmation(req.body);
    const data=await getPainelTv({force:true});
    const item=data.itens.find(item=>item.placa===input.placa);
    if(!item)return res.status(400).json({error:'Veículo não encontrado no painel.'});
    if(item.contextoCarga!==input.contexto)return res.status(409).json({error:'A operação mudou. Atualize o painel e confira novamente.'});
    res.status(201).json({registro:await saveCargoConfirmation(input,req.user)});
  } catch(error){next(error);}
});
statusCargaRouter.delete('/frota/painel-tv/confirmacoes/:id',requireAdmin,async(req,res,next)=>{
  try {await cancelCargoConfirmation(req.params.id,req.user);res.json({ok:true});}catch(error){next(error);}
});

statusCargaRouter.get("/frota/ociosidade/paradas", async (req, res, next) => {
  try { res.json(await suggestStops(req.query)); } catch (e) { next(e); }
});
statusCargaRouter.post("/frota/ociosidade/confirmacoes", async (req, res, next) => {
  try {
    const input = validateConfirmation(req.body);
    const docs = await loadDocuments(input.inicio.slice(0,10), input.fim.slice(0,10), input.placa);
    const keys = new Set(docs.map(documentKey));
    if (input.documentos.some((key) => !keys.has(key))) return res.status(400).json({ error: "Documento não localizado para a placa e período." });
    res.json(await saveConfirmation(input, req.user?.id || req.user?.email || "usuario autenticado"));
  } catch (e) { next(e); }
});
statusCargaRouter.delete("/frota/ociosidade/confirmacoes/:id", async (req, res, next) => {
  try { await removeConfirmation(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});

statusCargaRouter.get("/frota/status-carga", async (req, res, next) => {
  try {
    res.json(await getStatusCargaFrota({
      startDate: req.query.startDate || req.query.dataInicio,
      placa: req.query.placa,
      estado: req.query.estado,
      search: req.query.search,
      dias: req.query.dias,
      limit: req.query.limit,
    }));
  } catch (error) {
    next(error);
  }
});

statusCargaRouter.get("/frota/ociosidade", async (req, res, next) => {
  try {
    res.json(await getOciosidadeFrota({
      modo: req.query.modo,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      placa: req.query.placa,
    }));
  } catch (error) {
    next(error);
  }
});

statusCargaRouter.get("/frota/status-carga/alertas-vazio", requireAdmin, async (_req, res, next) => {
  try { res.json(await listEmptyVehicleAlerts()); } catch (error) { next(error); }
});

statusCargaRouter.post("/frota/status-carga/alertas-vazio/executar", requireAdmin, async (req, res, next) => {
  try { res.json(await runEmptyVehicleAlerts({ dryRun: req.body?.dryRun !== false })); } catch (error) { next(error); }
});
