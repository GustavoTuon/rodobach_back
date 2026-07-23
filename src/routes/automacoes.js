import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  getN8nAutomation,
  getN8nAutomations,
  getVencimentoClientesAutomation,
  retryLastFailedN8nAutomation,
  setN8nAutomationActive,
  setVencimentoClientesAutomationActive,
} from "../services/n8nService.js";

const router = Router();

router.get("/automacoes/n8n", async (_req, res, next) => {
  try {
    res.json(await getN8nAutomations());
  } catch (error) {
    next(error);
  }
});

router.get("/automacoes/n8n/:id", async (req, res, next) => {
  try {
    res.json(await getN8nAutomation(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post("/automacoes/n8n/:id/ativar", requireAdmin, async (req, res, next) => {
  try {
    res.json(await setN8nAutomationActive(req.params.id, true));
  } catch (error) {
    next(error);
  }
});

router.post("/automacoes/n8n/:id/desativar", requireAdmin, async (req, res, next) => {
  try {
    res.json(await setN8nAutomationActive(req.params.id, false));
  } catch (error) {
    next(error);
  }
});

router.post("/automacoes/n8n/:id/executar-novamente", requireAdmin, async (req, res, next) => {
  try {
    res.json(await retryLastFailedN8nAutomation(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get("/automacoes/vencimento-clientes", async (_req, res, next) => {
  try {
    res.json(await getVencimentoClientesAutomation());
  } catch (error) {
    next(error);
  }
});

router.post("/automacoes/vencimento-clientes/ativar", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await setVencimentoClientesAutomationActive(true));
  } catch (error) {
    next(error);
  }
});

router.post("/automacoes/vencimento-clientes/desativar", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await setVencimentoClientesAutomationActive(false));
  } catch (error) {
    next(error);
  }
});

export { router as automacoesRouter };
