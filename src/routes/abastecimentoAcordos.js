import { Router } from "express";
import {
  deleteAbastecimentoAcordo,
  getDivergenciasAbastecimento,
  listAbastecimentoAcordos,
  listGruposClientes,
  listPostosAbastecimento,
  saveAbastecimentoAcordo,
} from "../services/abastecimentoAcordosService.js";

export const abastecimentoAcordosRouter = Router();

function handleError(error, res, next) {
  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

abastecimentoAcordosRouter.get("/abastecimentos/acordos", async (req, res, next) => {
  try {
    res.json(await listAbastecimentoAcordos({
      search: req.query.search,
      ativo: req.query.ativo,
    }));
  } catch (error) {
    next(error);
  }
});

abastecimentoAcordosRouter.post("/abastecimentos/acordos", async (req, res, next) => {
  try {
    const result = await saveAbastecimentoAcordo(req.body);
    res.status(req.body?.id ? 200 : 201).json(result);
  } catch (error) {
    handleError(error, res, next);
  }
});

abastecimentoAcordosRouter.put("/abastecimentos/acordos/:id", async (req, res, next) => {
  try {
    res.json(await saveAbastecimentoAcordo({ ...req.body, id: req.params.id }));
  } catch (error) {
    handleError(error, res, next);
  }
});

abastecimentoAcordosRouter.delete("/abastecimentos/acordos/:id", async (req, res, next) => {
  try {
    const ok = await deleteAbastecimentoAcordo(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Acordo nao encontrado." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

abastecimentoAcordosRouter.get("/abastecimentos/acordos/postos", async (req, res, next) => {
  try {
    res.json(await listPostosAbastecimento(req.query.q || req.query.search || ""));
  } catch (error) {
    next(error);
  }
});

abastecimentoAcordosRouter.get("/abastecimentos/acordos/grupos-clientes", async (_req, res, next) => {
  try {
    res.json(await listGruposClientes());
  } catch (error) {
    next(error);
  }
});

abastecimentoAcordosRouter.get("/abastecimentos/acordos/divergencias", async (req, res, next) => {
  try {
    res.json(await getDivergenciasAbastecimento({
      startDate: req.query.startDate || req.query.dataInicio,
      endDate: req.query.endDate || req.query.dataFim,
      fornecedor: req.query.fornecedor,
      postoCodigo: req.query.postoCodigo,
      placa: req.query.placa,
    }));
  } catch (error) {
    next(error);
  }
});
