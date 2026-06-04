import { Router } from "express";
import { clientPool } from "../db/clientPool.js";
import {
  getEstadoAtualPneusPorVeiculo,
  getPneusEstoque,
  getHistoricoMovimentacoes,
  registrarMovimentacaoPneu,
  fetchVehicles,
  fetchPositions,
} from "../services/pneusService.js";

export const pneusRouter = Router();

// GET /api/pneus/veiculos?q=
pneusRouter.get("/pneus/veiculos", async (req, res, next) => {
  try {
    res.json(await fetchVehicles(req.query.q || ""));
  } catch (error) {
    next(error);
  }
});

// GET /api/pneus/posicoes
pneusRouter.get("/pneus/posicoes", async (req, res, next) => {
  try {
    res.json(await fetchPositions());
  } catch (error) {
    next(error);
  }
});

// GET /api/pneus/veiculo/:placa — estado atual (banco cliente + movimentos aplicados)
pneusRouter.get("/pneus/veiculo/:placa", async (req, res, next) => {
  try {
    const placa = String(req.params.placa || "").trim().toUpperCase();
    if (!placa) { res.status(400).json({ error: "Placa é obrigatória." }); return; }
    res.json(await getEstadoAtualPneusPorVeiculo(placa));
  } catch (error) {
    next(error);
  }
});

// GET /api/pneus/estoque
pneusRouter.get("/pneus/estoque", async (req, res, next) => {
  try {
    res.json(await getPneusEstoque());
  } catch (error) {
    next(error);
  }
});

// GET /api/pneus/historico
pneusRouter.get("/pneus/historico", async (req, res, next) => {
  try {
    res.json(await getHistoricoMovimentacoes({
      veiculo: req.query.veiculo || null,
      pneu:    req.query.pneu    || null,
      empresa: req.query.empresa || null,
      tipo:    req.query.tipo    || null,
      dataInicio: req.query.dataInicio || null,
      dataFim:    req.query.dataFim    || null,
      limit:  req.query.limit  || 50,
      offset: req.query.offset || 0,
    }));
  } catch (error) {
    next(error);
  }
});

// POST /api/pneus/movimentar — SOMENTE grava no banco próprio, nunca no cliente
pneusRouter.post("/pneus/movimentar", async (req, res, next) => {
  try {
    const movimento = await registrarMovimentacaoPneu(req.body);
    res.status(201).json(movimento);
  } catch (error) {
    const isValidation = error.message && !/erro interno/i.test(error.message);
    res.status(isValidation ? 400 : 500).json({ error: error.message });
  }
});

// GET /api/pneus/diagnostico — inspeciona banco do cliente para depuração
pneusRouter.get("/pneus/diagnostico", async (req, res, next) => {
  const run = async (sql) => {
    try {
      const { rows } = await clientPool.query(sql);
      return { ok: true, rows };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  try {
    const [veiculos, pneus, posicoes] = await Promise.all([
      run(`SELECT placavei, nomevei, situacaovei, tipopropriedadevei
           FROM frotas.veiculos WHERE COALESCE(situacaovei::text,'') <> 'I' LIMIT 5`),
      run(`SELECT codigopne, nomepne, ativopne, veiculopne, posicaopne, localpne,
                  pg_typeof(ativopne) AS tipo_ativopne, pg_typeof(veiculopne) AS tipo_veiculopne
           FROM frotas.pneus LIMIT 5`),
      run(`SELECT codigopop, nomepop, abreviacaopop, eixoveiculopop, ativopop
           FROM frotas.posicoespneus LIMIT 5`),
    ]);
    res.json({ veiculos, pneus, posicoes });
  } catch (error) {
    next(error);
  }
});
