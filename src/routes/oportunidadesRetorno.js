import { Router } from "express";
import {
  analyzeSmOpportunities,
  createClientesTemplate,
  getOportunidadesOverview,
  importClientesWorkbook,
  sendOpportunitiesToN8n,
  sendClientOpportunityToN8n,
} from "../services/oportunidadesRetornoService.js";

const router = Router();

router.get("/oportunidades-retorno", async (_req, res, next) => {
  try {
    res.json(await getOportunidadesOverview());
  } catch (error) {
    next(error);
  }
});

router.get("/oportunidades-retorno/modelo.xlsx", async (_req, res, next) => {
  try {
    const buffer = await createClientesTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="modelo-clientes-retorno.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.post("/oportunidades-retorno/importar", async (req, res, next) => {
  try {
    res.json(await importClientesWorkbook(req.body?.arquivoBase64, { replace: req.body?.substituir !== false }));
  } catch (error) {
    next(error);
  }
});

router.post("/oportunidades-retorno/analisar", async (req, res, next) => {
  try {
    res.json(await analyzeSmOpportunities(req.body?.smId, req.body?.raioKm));
  } catch (error) {
    next(error);
  }
});

router.post("/oportunidades-retorno/enviar-n8n", async (req, res, next) => {
  try {
    res.json(await sendOpportunitiesToN8n(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/oportunidades-retorno/enviar-cliente", async (req, res, next) => {
  try {
    res.json(await sendClientOpportunityToN8n(req.body || {}));
  } catch (error) {
    next(error);
  }
});

export { router as oportunidadesRetornoRouter };
