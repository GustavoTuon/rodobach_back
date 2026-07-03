import { Router } from "express";
import { getAnaliseConducaoRpm } from "../services/conducaoService.js";

export const conducaoRouter = Router();

conducaoRouter.get("/motoristas/conducao/rpm", async (req, res, next) => {
  try {
    const placa = String(req.query.placa || "").trim().toUpperCase();
    if (!placa) {
      res.status(400).json({ error: "Placa e obrigatoria." });
      return;
    }

    res.json(await getAnaliseConducaoRpm({
      placa,
      dataInicio: req.query.dataInicio || req.query.startDate,
      dataFim: req.query.dataFim || req.query.endDate,
    }));
  } catch (error) {
    next(error);
  }
});
