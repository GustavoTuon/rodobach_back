import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  getVencimentoClientesAutomation,
  setVencimentoClientesAutomationActive,
} from "../services/n8nService.js";

const router = Router();

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
