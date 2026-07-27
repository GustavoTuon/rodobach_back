import { Router } from "express";
import { getTrafegusDashboard, getTrafegusGoogleRoute } from "../services/trafegusService.js";

const router = Router();

router.get("/trafegus/dashboard", async (_req, res, next) => {
  try {
    res.json(await getTrafegusDashboard());
  } catch (error) {
    next(error);
  }
});

router.post("/trafegus/atualizar", async (_req, res, next) => {
  try {
    res.json(await getTrafegusDashboard({ force: true }));
  } catch (error) {
    next(error);
  }
});

router.get("/trafegus/sms/:id/rota-google", async (req, res, next) => {
  try {
    res.json(await getTrafegusGoogleRoute(req.params.id));
  } catch (error) {
    next(error);
  }
});

export { router as trafegusRouter };
