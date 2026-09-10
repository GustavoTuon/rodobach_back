import { Router } from "express";
import { getStatusCargaFrota } from "../services/statusCargaService.js";
import { getOciosidadeFrota, loadDocuments } from "../services/ociosidadeFrotaService.js";
import { saveConfirmation, removeConfirmation, suggestStops, validateConfirmation, documentKey } from "../services/conferenciaDocumentos.js";
import { listEmptyVehicleAlerts, runEmptyVehicleAlerts } from "../services/statusCargaAlertaService.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const statusCargaRouter = Router();

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
