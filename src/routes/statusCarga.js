import { Router } from "express";
import { getStatusCargaFrota } from "../services/statusCargaService.js";

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
