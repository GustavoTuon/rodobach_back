import { Router } from "express";
import {
  listarMotoristasFolgas,
  registrarRetorno,
  registrarSaida,
  registrarMovimentoFolga,
} from "../services/folgasMotoristasService.js";
import { getJornadaMacros } from "../services/jornadaMacrosService.js";

export const folgasMotoristasRouter = Router();

folgasMotoristasRouter.get("/motoristas/folgas", async (req, res, next) => {
  try {
    res.json(await listarMotoristasFolgas(req.query));
  } catch (error) { next(error); }
});

folgasMotoristasRouter.get("/motoristas/jornada-macros", async (req, res, next) => {
  try {
    res.json(await getJornadaMacros(req.query));
  } catch (error) { next(error); }
});

folgasMotoristasRouter.post("/motoristas/folgas/movimentos", async (req, res, next) => {
  try {
    res.status(201).json(await registrarMovimentoFolga(req.body, req.user?.login));
  } catch (error) { next(error); }
});

folgasMotoristasRouter.post("/motoristas/folgas/saidas", async (req, res, next) => {
  try {
    res.status(201).json(await registrarSaida(req.body, req.user?.login));
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Este motorista ja possui uma jornada em aberto." });
    next(error);
  }
});

folgasMotoristasRouter.put("/motoristas/folgas/jornadas/:id/retorno", async (req, res, next) => {
  try {
    res.json(await registrarRetorno(req.params.id, req.body, req.user?.login));
  } catch (error) { next(error); }
});
