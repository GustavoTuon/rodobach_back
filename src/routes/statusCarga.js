import { Router } from "express";
import { getStatusCargaFrota } from "../services/statusCargaService.js";
import { listEmptyVehicleAlerts, runEmptyVehicleAlerts } from "../services/statusCargaAlertaService.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const statusCargaRouter = Router();

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

statusCargaRouter.get("/frota/status-carga/alertas-vazio", requireAdmin, async (_req, res, next) => {
  try { res.json(await listEmptyVehicleAlerts()); } catch (error) { next(error); }
});

statusCargaRouter.post("/frota/status-carga/alertas-vazio/executar", requireAdmin, async (req, res, next) => {
  try { res.json(await runEmptyVehicleAlerts({ dryRun: req.body?.dryRun !== false })); } catch (error) { next(error); }
});
