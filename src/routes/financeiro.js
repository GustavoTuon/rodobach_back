import { Router } from "express";
import {
  getAvailableDrivers,
  getAvailableMonths,
  getAvailablePlates,
  getCustosResumo,
  getDashboardDiagnostics,
  getFuelDashboard,
  getOverviewDashboard,
} from "../services/custosService.js";
import { getLancamentosFinanceiros } from "../services/financeiroLancamentosService.js";
import { getFinanceiroPorPlaca } from "../services/financeiroPlacaService.js";
import { getAnaliseClientes } from "../services/analiseClientesService.js";
import { getDemonstrativoFinanceiro } from "../services/demonstrativoFinanceiroService.js";
import { getDreEmpresarial } from "../services/dreEmpresarialService.js";

export const financeiroRouter = Router();

function parseMonthsQuery(rawMonths) {
  if (!rawMonths) return [];

  return String(rawMonths)
    .split(",")
    .map((month) => month.trim())
    .filter(Boolean);
}

financeiroRouter.get("/financeiro/resumo", async (req, res, next) => {
  try {
    const data = await getCustosResumo({
      period: req.query.period || req.query.periodo,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/receitas", async (req, res, next) => {
  try {
    const data = await getLancamentosFinanceiros({
      type: "receivable",
      period: req.query.period || req.query.periodo,
      startDate: req.query.startDate || req.query.dataInicio,
      endDate: req.query.endDate || req.query.dataFim,
      centro: req.query.centro,
      search: req.query.search,
      status: req.query.status,
      classificacao: req.query.classificacao,
      limit: req.query.limit,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/custos", async (req, res, next) => {
  try {
    const data = await getLancamentosFinanceiros({
      type: "payable",
      period: req.query.period || req.query.periodo,
      startDate: req.query.startDate || req.query.dataInicio,
      endDate: req.query.endDate || req.query.dataFim,
      centro: req.query.centro,
      search: req.query.search,
      status: req.query.status,
      classificacao: req.query.classificacao,
      limit: req.query.limit,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/demonstrativo", async (req, res, next) => {
  try {
    const data = await getDemonstrativoFinanceiro({
      period: req.query.period || req.query.periodo,
      startDate: req.query.startDate || req.query.dataInicio,
      endDate: req.query.endDate || req.query.dataFim,
      empresa: req.query.empresa,
      centro: req.query.centro,
      conta: req.query.conta,
      search: req.query.search,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

async function loadDreEmpresarial(req) {
  return getDreEmpresarial({
    period: req.query.period || req.query.periodo,
    startDate: req.query.startDate || req.query.dataInicio,
    endDate: req.query.endDate || req.query.dataFim,
    mesAno: req.query.mesAno,
    empresa: req.query.empresa,
    centro: req.query.centro,
    conta: req.query.conta,
    placa: req.query.placa,
    cliente: req.query.cliente,
    tipo: req.query.tipo,
    status: req.query.status,
    search: req.query.search,
  });
}

financeiroRouter.get("/financeiro/dre-empresarial", async (req, res, next) => {
  try {
    res.json(await loadDreEmpresarial(req));
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/resumo", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, summary: data.summary, structure: data.structure, sources: data.sources });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/evolucao", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, monthly: data.monthly });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/rankings", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, categories: data.categories, accounts: data.accounts, management: data.management });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/centros", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, centers: data.centers });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/placas", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, plates: data.plates });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/dre-empresarial/lancamentos", async (req, res, next) => {
  try {
    const data = await loadDreEmpresarial(req);
    res.json({ period: data.period, rows: data.rows });
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/analise-clientes", async (req, res, next) => {
  try {
    const data = await getAnaliseClientes({
      period: req.query.period || req.query.periodo,
      startDate: req.query.dataInicio || req.query.startDate,
      endDate: req.query.dataFim || req.query.endDate,
      cliente: req.query.cliente,
      status: req.query.status,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/financeiro/por-placa", async (req, res, next) => {
  try {
    const data = await getFinanceiroPorPlaca({
      period: req.query.period || req.query.periodo,
      startDate: req.query.startDate || req.query.dataInicio,
      endDate: req.query.endDate || req.query.dataFim,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Endpoints mantidos com o mesmo contrato do backend antigo dash_sistem_Back.
financeiroRouter.get("/plates", async (_req, res, next) => {
  try {
    const data = await getAvailablePlates();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/months", async (_req, res, next) => {
  try {
    const data = await getAvailableMonths();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/drivers", async (req, res, next) => {
  try {
    const data = await getAvailableDrivers(req.query.placa);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/diagnostics", async (req, res, next) => {
  try {
    const data = await getDashboardDiagnostics({
      months: parseMonthsQuery(req.query.months),
      categoria: req.query.categoria,
      motorista: req.query.motorista,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/overview", async (req, res, next) => {
  try {
    const data = await getOverviewDashboard({
      placa: req.query.placa,
      months: parseMonthsQuery(req.query.months),
      categoria: req.query.categoria,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});

financeiroRouter.get("/fuel", async (req, res, next) => {
  try {
    const data = await getFuelDashboard({
      placa: req.query.placa,
      months: parseMonthsQuery(req.query.months),
      motorista: req.query.motorista,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
});
