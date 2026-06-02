import { quoteIdent, config } from "../config.js";
import { pool } from "../db/pool.js";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const COST_CODES = {
  fuel: ["4.1.004"],
  toll: ["4.1.005"],
  maintenance: ["4.1.008", "4.1.014"],
  drivers: ["6.1.002", "4.1.015"],
};

const REQUIRED_FINANCIAL_VIEW = "vw_dashboard_financeiro";
const REQUIRED_FUEL_VIEW = "vw_abastecimento_dashboard";

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function normalizePeriod(rawPeriod) {
  const value = String(rawPeriod || "7d").trim().toLowerCase();

  if (["30", "30d", "30dias", "30-dias"].includes(value)) {
    return "30d";
  }

  if (["month", "mes", "este-mes", "este_mes", "this-month"].includes(value)) {
    return "month";
  }

  return "7d";
}

function resolvePeriod(rawPeriod) {
  const key = normalizePeriod(rawPeriod);
  const today = startOfDay(new Date());
  const endExclusive = addDays(today, 1);
  const start =
    key === "30d"
      ? addDays(today, -29)
      : key === "month"
        ? startOfMonth(today)
        : addDays(today, -6);

  return {
    key,
    label: key === "30d" ? "30 dias" : key === "month" ? "Este mês" : "7 dias",
    start,
    endExclusive,
    startDate: formatDate(start),
    endDate: formatDate(addDays(endExclusive, -1)),
  };
}

function parseMonths(rawMonths = []) {
  return rawMonths
    .filter(Boolean)
    .map((month) => String(month).trim())
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
}

function parseMonthLabel(reference) {
  const [year, month] = String(reference || "").split("-");
  const index = Number(month) - 1;
  return index >= 0 && index < MONTH_LABELS.length ? `${MONTH_LABELS[index]}/${year}` : reference;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(date) {
  return DAY_LABELS[date.getDay()];
}

function costCase(column, codes) {
  const list = codes.map((code) => `'${code}'`).join(", ");
  return `CASE WHEN tipo_movimento = 'D' AND ${column} IN (${list}) THEN valor ELSE 0 END`;
}

function emptyOverview() {
  return {
    summary: {
      receitaTotal: 0,
      custoTotal: 0,
      lucroTotal: 0,
      totalCompetencias: 0,
      totalPlacas: 0,
      margemPercentual: 0,
      ticketMedioReceita: 0,
      ticketMedioCusto: 0,
    },
    monthly: [],
    categories: [],
    topAccounts: [],
    costIndicators: [
      { id: "pedagio", label: "Pedágio", total: 0 },
      { id: "combustivel", label: "Combustível", total: 0 },
      { id: "manutencao", label: "Manutenção", total: 0 },
      { id: "motoristas", label: "Motoristas", total: 0 },
    ],
    selectedCategory: "",
  };
}

function emptyFuel() {
  return {
    summary: {
      gastoTotal: 0,
      litrosTotal: 0,
      kmTotal: 0,
      mediaConsumo: 0,
      precoMedio: 0,
      totalAbastecimentos: 0,
      custoPorKm: 0,
      ticketMedioAbastecimento: 0,
    },
    monthly: [],
    drivers: [],
    stations: [],
    recentSupplies: [],
  };
}

async function findSchemaWith(tableName) {
  const candidates = unique([config.db.schema, "dashboard_cliente", "public"]);

  for (const schema of candidates) {
    const { rows } = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = $2
        ) AS exists;
      `,
      [schema, tableName],
    );

    if (rows[0]?.exists) {
      return schema;
    }
  }

  return null;
}

async function queryRows(sql, values = []) {
  try {
    const { rows } = await pool.query(sql, values);
    return rows;
  } catch (error) {
    console.warn("Consulta de custos ignorada:", error.message);
    return [];
  }
}

function buildOldDashboardFilters({ placa, plateColumn, months = [], monthColumn, motorista, driverColumn, categoria, categoryColumn }) {
  const values = [];
  const where = [];
  const normalizedMonths = parseMonths(months);

  if (placa && plateColumn) {
    values.push(placa);
    where.push(`${plateColumn} = $${values.length}`);
  }

  if (monthColumn && normalizedMonths.length) {
    values.push(normalizedMonths);
    where.push(`TO_CHAR(${monthColumn}, 'YYYY-MM') = ANY($${values.length})`);
  }

  if (motorista && driverColumn) {
    values.push(motorista);
    where.push(`${driverColumn} = $${values.length}`);
  }

  if (categoria && categoryColumn) {
    values.push(categoria);
    where.push(`${categoryColumn} = $${values.length}`);
  }

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    values,
  };
}

export async function getOverviewDashboard({ placa, months = [], categoria } = {}) {
  const schema = await findSchemaWith(REQUIRED_FINANCIAL_VIEW);
  if (!schema) return emptyOverview();

  const view = `${quoteIdent(schema)}.${quoteIdent(REQUIRED_FINANCIAL_VIEW)}`;
  const filters = buildOldDashboardFilters({
    placa,
    plateColumn: "placa",
    monthColumn: "competencia",
    months,
    categoria,
    categoryColumn: "categoria_principal",
  });
  const expenseClause = filters.clause ? `${filters.clause} AND tipo_movimento = 'D'` : "WHERE tipo_movimento = 'D'";

  const [summaryRows, monthlyRows, categoryRows, accountRows, indicatorRows] = await Promise.all([
    queryRows(
      `
        SELECT
          COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END), 0) AS receita_total,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS custo_total,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE -valor END), 0) AS lucro_total,
          COUNT(DISTINCT competencia) AS total_competencias,
          COUNT(DISTINCT placa) AS total_placas
        FROM ${view}
        ${filters.clause};
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          TO_CHAR(competencia, 'YYYY-MM') AS referencia,
          SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END) AS receita,
          SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END) AS custo,
          SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE -valor END) AS lucro
        FROM ${view}
        ${filters.clause}
        GROUP BY competencia
        ORDER BY competencia;
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT categoria_principal, SUM(valor) AS total
        FROM ${view}
        ${expenseClause}
        GROUP BY categoria_principal
        ORDER BY total DESC;
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT descricao_conta, SUM(valor) AS total
        FROM ${view}
        ${expenseClause}
        GROUP BY descricao_conta
        ORDER BY total DESC
        LIMIT 20;
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.toll)}), 0) AS pedagio,
          COALESCE(SUM(${costCase("codigo_conta", ["4.009", "6.2.067"])}), 0) AS seguro,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.fuel)}), 0) AS combustivel,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.maintenance)}), 0) AS manutencao,
          COALESCE(SUM(${costCase("codigo_conta", ["6.5.001"])}), 0) AS financiamento,
          COALESCE(SUM(${costCase("codigo_conta", ["4.1.015"])}), 0) AS despesas_viagem,
          COALESCE(SUM(${costCase("codigo_conta", ["6.1.002"])}), 0) AS salarios_variaveis,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS total_custos
        FROM ${view}
        ${filters.clause};
      `,
      filters.values,
    ),
  ]);

  const summary = summaryRows[0] || {};
  const indicators = indicatorRows[0] || {};
  const driverTotal = toNumber(indicators.despesas_viagem) + toNumber(indicators.salarios_variaveis);
  const costIndicators = [
    { id: "pedagio", label: "Pedágio", total: toNumber(indicators.pedagio) },
    { id: "seguro", label: "Seguro", total: toNumber(indicators.seguro) },
    { id: "combustivel", label: "Combustível", total: toNumber(indicators.combustivel) },
    { id: "manutencao", label: "Manutenção", total: toNumber(indicators.manutencao) },
    { id: "financiamento", label: "Financiamento", total: toNumber(indicators.financiamento) },
    { id: "motoristas", label: "Motoristas", total: driverTotal },
  ];
  const mappedCostTotal = costIndicators.reduce((total, item) => total + item.total, 0);
  const otherCosts = Math.max(toNumber(indicators.total_custos) - mappedCostTotal, 0);

  if (otherCosts > 0) {
    costIndicators.push({ id: "outros", label: "Outros custos", total: otherCosts });
  }

  return {
    summary: {
      receitaTotal: toNumber(summary.receita_total),
      custoTotal: toNumber(summary.custo_total),
      lucroTotal: toNumber(summary.lucro_total),
      totalCompetencias: toNumber(summary.total_competencias),
      totalPlacas: toNumber(summary.total_placas),
      margemPercentual:
        toNumber(summary.receita_total) > 0
          ? (toNumber(summary.lucro_total) / toNumber(summary.receita_total)) * 100
          : 0,
      ticketMedioReceita:
        toNumber(summary.total_competencias) > 0
          ? toNumber(summary.receita_total) / toNumber(summary.total_competencias)
          : 0,
      ticketMedioCusto:
        toNumber(summary.total_competencias) > 0
          ? toNumber(summary.custo_total) / toNumber(summary.total_competencias)
          : 0,
    },
    monthly: monthlyRows.map((row) => ({
      referencia: row.referencia,
      label: parseMonthLabel(row.referencia),
      receita: toNumber(row.receita),
      custo: toNumber(row.custo),
      lucro: toNumber(row.lucro),
    })),
    categories: categoryRows.map((row) => ({
      categoria: row.categoria_principal || "Sem categoria",
      total: toNumber(row.total),
    })),
    topAccounts: accountRows.map((row) => ({
      conta: row.descricao_conta || "Sem conta",
      total: toNumber(row.total),
    })),
    costIndicators,
    selectedCategory: categoria || "",
  };
}

export async function getFuelDashboard({ placa, months = [], motorista } = {}) {
  const schema = await findSchemaWith(REQUIRED_FUEL_VIEW);
  if (!schema) return emptyFuel();

  const view = `${quoteIdent(schema)}.${quoteIdent(REQUIRED_FUEL_VIEW)}`;
  const filters = buildOldDashboardFilters({
    placa,
    plateColumn: "placa_veiculo",
    monthColumn: "data_abastecimento",
    months,
    motorista,
    driverColumn: "motorista",
  });

  const [summaryRows, monthlyRows, driverRows, stationRows, supplyRows] = await Promise.all([
    queryRows(
      `
        SELECT
          COALESCE(SUM(valor_abastecimento), 0) AS gasto_total,
          COALESCE(SUM(litros_abastecidos), 0) AS litros_total,
          COALESCE(SUM(km_rodado), 0) AS km_total,
          COALESCE(AVG(media_km_l), 0) AS media_consumo,
          COALESCE(AVG(valor_por_litro), 0) AS preco_medio,
          COUNT(*) AS total_abastecimentos
        FROM ${view}
        ${filters.clause};
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          TO_CHAR(data_abastecimento, 'YYYY-MM') AS referencia,
          SUM(valor_abastecimento) AS gasto_total,
          SUM(litros_abastecidos) AS litros_total,
          SUM(km_rodado) AS km_total,
          AVG(media_km_l) AS media_consumo,
          AVG(valor_por_litro) AS preco_medio
        FROM ${view}
        ${filters.clause}
        GROUP BY DATE_TRUNC('month', data_abastecimento), TO_CHAR(data_abastecimento, 'YYYY-MM')
        ORDER BY DATE_TRUNC('month', data_abastecimento);
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          motorista,
          COUNT(*) AS abastecimentos,
          SUM(valor_abastecimento) AS gasto_total,
          AVG(media_km_l) AS media_consumo
        FROM ${view}
        ${filters.clause}
        GROUP BY motorista
        ORDER BY gasto_total DESC;
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          posto,
          COUNT(*) AS abastecimentos,
          SUM(valor_abastecimento) AS gasto_total,
          AVG(valor_por_litro) AS preco_medio
        FROM ${view}
        ${filters.clause}
        GROUP BY posto
        ORDER BY gasto_total DESC
        LIMIT 20;
      `,
      filters.values,
    ),
    queryRows(
      `
        SELECT
          codigo_abastecimento,
          data_abastecimento,
          motorista,
          posto,
          km_rodado,
          litros_abastecidos,
          media_km_l,
          valor_abastecimento,
          valor_por_litro
        FROM ${view}
        ${filters.clause}
        ORDER BY data_abastecimento DESC, codigo_abastecimento DESC
        LIMIT 20;
      `,
      filters.values,
    ),
  ]);

  const summary = summaryRows[0] || {};
  const kmTotal = toNumber(summary.km_total);
  const gastoTotal = toNumber(summary.gasto_total);
  const totalAbastecimentos = toNumber(summary.total_abastecimentos);

  return {
    summary: {
      gastoTotal,
      litrosTotal: toNumber(summary.litros_total),
      kmTotal,
      mediaConsumo: toNumber(summary.media_consumo),
      precoMedio: toNumber(summary.preco_medio),
      totalAbastecimentos,
      custoPorKm: kmTotal > 0 ? gastoTotal / kmTotal : 0,
      ticketMedioAbastecimento: totalAbastecimentos > 0 ? gastoTotal / totalAbastecimentos : 0,
    },
    monthly: monthlyRows.map((row) => ({
      referencia: row.referencia,
      label: parseMonthLabel(row.referencia),
      gastoTotal: toNumber(row.gasto_total),
      litrosTotal: toNumber(row.litros_total),
      kmTotal: toNumber(row.km_total),
      mediaConsumo: toNumber(row.media_consumo),
      precoMedio: toNumber(row.preco_medio),
    })),
    drivers: driverRows.map((row) => ({
      motorista: row.motorista || "Não informado",
      abastecimentos: toNumber(row.abastecimentos),
      gastoTotal: toNumber(row.gasto_total),
      mediaConsumo: toNumber(row.media_consumo),
    })),
    stations: stationRows.map((row) => ({
      posto: row.posto || "Não informado",
      abastecimentos: toNumber(row.abastecimentos),
      gastoTotal: toNumber(row.gasto_total),
      precoMedio: toNumber(row.preco_medio),
    })),
    recentSupplies: supplyRows.map((row) => ({
      codigoAbastecimento: row.codigo_abastecimento,
      dataAbastecimento: row.data_abastecimento,
      motorista: row.motorista,
      posto: row.posto,
      kmRodado: toNumber(row.km_rodado),
      litrosAbastecidos: toNumber(row.litros_abastecidos),
      mediaKmL: toNumber(row.media_km_l),
      valorAbastecimento: toNumber(row.valor_abastecimento),
      valorPorLitro: toNumber(row.valor_por_litro),
    })),
  };
}

export async function getAvailablePlates() {
  const schema = await findSchemaWith("veiculo");
  if (!schema) return [];

  const rows = await queryRows(
    `
      SELECT DISTINCT placa, descricao, empresa
      FROM ${quoteIdent(schema)}.${quoteIdent("veiculo")}
      ORDER BY placa;
    `,
  );

  return rows;
}

export async function getAvailableDrivers(placa) {
  const schema = await findSchemaWith(REQUIRED_FUEL_VIEW);
  if (!schema) return [];

  const filters = buildOldDashboardFilters({
    placa,
    plateColumn: "placa_veiculo",
  });
  const rows = await queryRows(
    `
      SELECT DISTINCT motorista
      FROM ${quoteIdent(schema)}.${quoteIdent(REQUIRED_FUEL_VIEW)}
      ${filters.clause}
      ORDER BY motorista;
    `,
    filters.values,
  );

  return rows
    .map((row) => row.motorista)
    .filter(Boolean)
    .map((motorista) => ({ value: motorista, label: motorista }));
}

export async function getAvailableMonths() {
  const financialSchema = await findSchemaWith(REQUIRED_FINANCIAL_VIEW);
  const fuelSchema = await findSchemaWith(REQUIRED_FUEL_VIEW);
  const queries = [];

  if (financialSchema) {
    queries.push(`
      SELECT DISTINCT TO_CHAR(competencia, 'YYYY-MM') AS referencia
      FROM ${quoteIdent(financialSchema)}.${quoteIdent(REQUIRED_FINANCIAL_VIEW)}
    `);
  }

  if (fuelSchema) {
    queries.push(`
      SELECT DISTINCT TO_CHAR(data_abastecimento, 'YYYY-MM') AS referencia
      FROM ${quoteIdent(fuelSchema)}.${quoteIdent(REQUIRED_FUEL_VIEW)}
    `);
  }

  if (!queries.length) return [];

  const rows = await queryRows(`
    SELECT referencia
    FROM (${queries.join(" UNION ")}) base
    WHERE referencia IS NOT NULL
    ORDER BY referencia;
  `);

  return rows.map((row) => ({
    value: row.referencia,
    label: parseMonthLabel(row.referencia),
  }));
}

async function countTable(tableName) {
  const schema = await findSchemaWith(tableName);
  if (!schema) return 0;

  const rows = await queryRows(
    `SELECT COUNT(*) AS total FROM ${quoteIdent(schema)}.${quoteIdent(tableName)};`,
  );

  return toNumber(rows[0]?.total);
}

export async function getDashboardDiagnostics({ months = [], categoria, motorista } = {}) {
  const [vehicles, financialEntries, supplies, overview, fuel] = await Promise.all([
    countTable("veiculo"),
    countTable("lancamento_financeiro"),
    countTable("abastecimento"),
    getOverviewDashboard({ months, categoria }),
    getFuelDashboard({ months, motorista }),
  ]);

  return {
    totals: {
      vehicles,
      financialEntries,
      supplies,
    },
    averages: {
      receitaMediaPorCompetencia: overview.summary.ticketMedioReceita,
      custoMedioPorCompetencia: overview.summary.ticketMedioCusto,
      mediaConsumo: fuel.summary.mediaConsumo,
      ticketMedioAbastecimento: fuel.summary.ticketMedioAbastecimento,
    },
  };
}

async function getFinancialCostsForPeriod(period) {
  const schema = await findSchemaWith(REQUIRED_FINANCIAL_VIEW);
  if (!schema) {
    return {
      schema: null,
      vehicleRows: [],
      dailyRows: [],
      monthlyRows: [],
      summary: {
        totalCost: 0,
        revenue: 0,
        fuelCost: 0,
        maintenanceCost: 0,
        tollCost: 0,
        driverCost: 0,
        otherCost: 0,
      },
    };
  }

  const view = `${quoteIdent(schema)}.${quoteIdent(REQUIRED_FINANCIAL_VIEW)}`;
  const values = [period.startDate, formatDate(period.endExclusive)];
  const lastPeriodDay = addDays(period.endExclusive, -1);
  const monthStart = formatDate(startOfMonth(addMonths(lastPeriodDay, -5)));
  const monthEnd = formatDate(period.endExclusive);

  const [vehicleRows, dailyRows, monthlyRows, summaryRows] = await Promise.all([
    queryRows(
      `
        SELECT
          COALESCE(NULLIF(TRIM(placa::text), ''), 'Sem placa') AS plate,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS total_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.fuel)}), 0) AS fuel_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.maintenance)}), 0) AS maintenance_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.toll)}), 0) AS toll_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.drivers)}), 0) AS driver_cost
        FROM ${view}
        WHERE competencia >= $1::date
          AND competencia < $2::date
        GROUP BY COALESCE(NULLIF(TRIM(placa::text), ''), 'Sem placa')
        ORDER BY total_cost DESC
        LIMIT 80;
      `,
      values,
    ),
    queryRows(
      `
        SELECT
          competencia::date AS day,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS total_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.fuel)}), 0) AS fuel_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.maintenance)}), 0) AS maintenance_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.toll)}), 0) AS toll_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.drivers)}), 0) AS driver_cost
        FROM ${view}
        WHERE competencia >= $1::date
          AND competencia < $2::date
        GROUP BY competencia::date
        ORDER BY competencia::date;
      `,
      values,
    ),
    queryRows(
      `
        SELECT
          TO_CHAR(DATE_TRUNC('month', competencia), 'YYYY-MM') AS reference,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS cost
        FROM ${view}
        WHERE competencia >= $1::date
          AND competencia < $2::date
        GROUP BY DATE_TRUNC('month', competencia), TO_CHAR(DATE_TRUNC('month', competencia), 'YYYY-MM')
        ORDER BY DATE_TRUNC('month', competencia);
      `,
      [monthStart, monthEnd],
    ),
    queryRows(
      `
        SELECT
          COALESCE(SUM(CASE WHEN tipo_movimento = 'C' THEN valor ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN tipo_movimento = 'D' THEN valor ELSE 0 END), 0) AS total_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.fuel)}), 0) AS fuel_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.maintenance)}), 0) AS maintenance_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.toll)}), 0) AS toll_cost,
          COALESCE(SUM(${costCase("codigo_conta", COST_CODES.drivers)}), 0) AS driver_cost
        FROM ${view}
        WHERE competencia >= $1::date
          AND competencia < $2::date;
      `,
      values,
    ),
  ]);

  const summary = summaryRows[0] || {};
  const knownCost =
    toNumber(summary.fuel_cost) +
    toNumber(summary.maintenance_cost) +
    toNumber(summary.toll_cost) +
    toNumber(summary.driver_cost);

  return {
    schema,
    vehicleRows,
    dailyRows,
    monthlyRows,
    summary: {
      totalCost: toNumber(summary.total_cost),
      revenue: toNumber(summary.revenue),
      fuelCost: toNumber(summary.fuel_cost),
      maintenanceCost: toNumber(summary.maintenance_cost),
      tollCost: toNumber(summary.toll_cost),
      driverCost: toNumber(summary.driver_cost),
      otherCost: Math.max(toNumber(summary.total_cost) - knownCost, 0),
    },
  };
}

async function getFuelCostsForPeriod(period) {
  const schema = await findSchemaWith(REQUIRED_FUEL_VIEW);
  if (!schema) {
    return {
      schema: null,
      vehicleRows: [],
      dailyRows: [],
      summary: {
        fuelCost: 0,
        kmTotal: 0,
        litrosTotal: 0,
      },
      drivers: [],
    };
  }

  const view = `${quoteIdent(schema)}.${quoteIdent(REQUIRED_FUEL_VIEW)}`;
  const values = [period.startDate, formatDate(period.endExclusive)];

  const [vehicleRows, dailyRows, summaryRows, driverRows] = await Promise.all([
    queryRows(
      `
        SELECT
          COALESCE(NULLIF(TRIM(placa_veiculo::text), ''), 'Sem placa') AS plate,
          COALESCE(NULLIF(TRIM(motorista::text), ''), 'Não informado') AS driver,
          COALESCE(SUM(valor_abastecimento), 0) AS fuel_cost,
          COALESCE(SUM(km_rodado), 0) AS km_total,
          COALESCE(AVG(media_km_l), 0) AS media_consumo,
          COUNT(*) AS supplies
        FROM ${view}
        WHERE data_abastecimento >= $1::date
          AND data_abastecimento < $2::date
        GROUP BY
          COALESCE(NULLIF(TRIM(placa_veiculo::text), ''), 'Sem placa'),
          COALESCE(NULLIF(TRIM(motorista::text), ''), 'Não informado')
        ORDER BY fuel_cost DESC;
      `,
      values,
    ),
    queryRows(
      `
        SELECT
          data_abastecimento::date AS day,
          COALESCE(SUM(valor_abastecimento), 0) AS fuel_cost,
          COALESCE(SUM(km_rodado), 0) AS km_total
        FROM ${view}
        WHERE data_abastecimento >= $1::date
          AND data_abastecimento < $2::date
        GROUP BY data_abastecimento::date
        ORDER BY data_abastecimento::date;
      `,
      values,
    ),
    queryRows(
      `
        SELECT
          COALESCE(SUM(valor_abastecimento), 0) AS fuel_cost,
          COALESCE(SUM(km_rodado), 0) AS km_total,
          COALESCE(SUM(litros_abastecidos), 0) AS litros_total
        FROM ${view}
        WHERE data_abastecimento >= $1::date
          AND data_abastecimento < $2::date;
      `,
      values,
    ),
    queryRows(
      `
        SELECT
          COALESCE(NULLIF(TRIM(motorista::text), ''), 'Não informado') AS motorista,
          COALESCE(SUM(valor_abastecimento), 0) AS total_cost,
          COALESCE(SUM(km_rodado), 0) AS km_total,
          COUNT(*) AS supplies
        FROM ${view}
        WHERE data_abastecimento >= $1::date
          AND data_abastecimento < $2::date
        GROUP BY COALESCE(NULLIF(TRIM(motorista::text), ''), 'Não informado')
        ORDER BY total_cost DESC
        LIMIT 20;
      `,
      values,
    ),
  ]);

  const summary = summaryRows[0] || {};

  return {
    schema,
    vehicleRows,
    dailyRows,
    summary: {
      fuelCost: toNumber(summary.fuel_cost),
      kmTotal: toNumber(summary.km_total),
      litrosTotal: toNumber(summary.litros_total),
    },
    drivers: driverRows.map((row) => ({
      motorista: row.motorista,
      totalCost: toNumber(row.total_cost),
      kmTotal: toNumber(row.km_total),
      supplies: toNumber(row.supplies),
      costPerKm: toNumber(row.km_total) > 0 ? toNumber(row.total_cost) / toNumber(row.km_total) : 0,
    })),
  };
}

function indexFuelByPlate(fuelRows) {
  const map = new Map();

  for (const row of fuelRows) {
    const plate = row.plate || "Sem placa";
    const current = map.get(plate) || {
      plate,
      driver: row.driver || "Não informado",
      driverCostBasis: -1,
      fuelCost: 0,
      kmTotal: 0,
      supplies: 0,
    };
    const fuelCost = toNumber(row.fuel_cost);
    current.fuelCost += fuelCost;
    current.kmTotal += toNumber(row.km_total);
    current.supplies += toNumber(row.supplies);

    if (fuelCost > current.driverCostBasis) {
      current.driver = row.driver || "Não informado";
      current.driverCostBasis = fuelCost;
    }

    map.set(plate, current);
  }

  return map;
}

function buildVehicleFin(financialRows, fuelRows) {
  const fuelByPlate = indexFuelByPlate(fuelRows);
  const plates = new Set([
    ...financialRows.map((row) => row.plate || "Sem placa"),
    ...fuelRows.map((row) => row.plate || "Sem placa"),
  ]);

  return [...plates]
    .map((plate) => {
      const financial = financialRows.find((row) => (row.plate || "Sem placa") === plate) || {};
      const fuel = fuelByPlate.get(plate) || {};
      const fuelCost = toNumber(financial.fuel_cost) > 0 ? toNumber(financial.fuel_cost) : toNumber(fuel.fuelCost);
      const totalCost = toNumber(financial.total_cost) > 0 ? toNumber(financial.total_cost) : fuelCost;
      const km = toNumber(fuel.kmTotal);
      const revenue = toNumber(financial.revenue);

      return {
        plate,
        driver: fuel.driver || "Não informado",
        model: "",
        km7d: roundMoney(km),
        fuelCost: roundMoney(fuelCost),
        maintCost: roundMoney(financial.maintenance_cost),
        tollCost: roundMoney(financial.toll_cost),
        driverCost: roundMoney(financial.driver_cost),
        otherCost: roundMoney(Math.max(totalCost - fuelCost - toNumber(financial.maintenance_cost) - toNumber(financial.toll_cost) - toNumber(financial.driver_cost), 0)),
        totalCost: roundMoney(totalCost),
        revenue: roundMoney(revenue),
        trips: toNumber(fuel.supplies),
        cpkm: km > 0 ? roundMoney(totalCost / km) : 0,
        margin: revenue > 0 ? roundMoney(((revenue - totalCost) / revenue) * 100) : 0,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);
}

function buildDailyCosts(period, financialRows, fuelRows) {
  const byDay = new Map();
  const fuelByDay = new Map();

  for (const row of fuelRows) {
    const key = formatDate(new Date(row.day));
    fuelByDay.set(key, {
      fuelCost: toNumber(row.fuel_cost),
      kmTotal: toNumber(row.km_total),
    });
  }

  for (const row of financialRows) {
    const key = formatDate(new Date(row.day));
    const totalCost = toNumber(row.total_cost);
    const known =
      toNumber(row.fuel_cost) +
      toNumber(row.maintenance_cost) +
      toNumber(row.toll_cost) +
      toNumber(row.driver_cost);

    byDay.set(key, {
      combustivel: toNumber(row.fuel_cost),
      manutencao: toNumber(row.maintenance_cost),
      pedagios: toNumber(row.toll_cost),
      motoristas: toNumber(row.driver_cost),
      outros: Math.max(totalCost - known, 0),
      total: totalCost,
      km: 0,
    });
  }

  const rows = [];
  for (let date = new Date(period.start); date < period.endExclusive; date = addDays(date, 1)) {
    const key = formatDate(date);
    const item = byDay.get(key) || {
      combustivel: 0,
      manutencao: 0,
      pedagios: 0,
      motoristas: 0,
      outros: 0,
      total: 0,
      km: 0,
    };
    const fuel = fuelByDay.get(key);
    if (fuel) {
      item.km = fuel.kmTotal;
      if (item.combustivel === 0) {
        item.combustivel = fuel.fuelCost;
        item.total += fuel.fuelCost;
      }
    }

    rows.push({
      date: key,
      day: dayLabel(date),
      combustivel: roundMoney(item.combustivel),
      manutencao: roundMoney(item.manutencao),
      pedagios: roundMoney(item.pedagios),
      motoristas: roundMoney(item.motoristas),
      outros: roundMoney(item.outros),
      total: roundMoney(item.total),
      km: roundMoney(item.km),
    });
  }

  return rows;
}

function buildMonthlyCosts(period, monthlyRows) {
  const byMonth = new Map(
    monthlyRows.map((row) => [
      row.reference,
      {
        mes: MONTH_LABELS[Number(String(row.reference).slice(5, 7)) - 1] || row.reference,
        receita: toNumber(row.revenue),
        custo: toNumber(row.cost),
      },
    ]),
  );

  const months = [];
  const lastPeriodDay = addDays(period.endExclusive, -1);
  const firstMonth = startOfMonth(addMonths(lastPeriodDay, -5));
  for (let date = firstMonth; date <= startOfMonth(lastPeriodDay); date = addMonths(date, 1)) {
    const key = monthKey(date);
    months.push(byMonth.get(key) || {
      mes: MONTH_LABELS[date.getMonth()],
      receita: 0,
      custo: 0,
    });
  }

  return months.slice(-6);
}

export async function getCustosResumo({ period: rawPeriod } = {}) {
  const period = resolvePeriod(rawPeriod);
  const [financial, fuel] = await Promise.all([
    getFinancialCostsForPeriod(period),
    getFuelCostsForPeriod(period),
  ]);

  const vehicleFin = buildVehicleFin(financial.vehicleRows, fuel.vehicleRows);
  const totalFromVehicles = vehicleFin.reduce((sum, item) => sum + item.totalCost, 0);
  const fuelCost = financial.summary.fuelCost > 0 ? financial.summary.fuelCost : fuel.summary.fuelCost;
  const totalCost = financial.summary.totalCost > 0 ? financial.summary.totalCost : totalFromVehicles;
  const kmTotal = fuel.summary.kmTotal || vehicleFin.reduce((sum, item) => sum + item.km7d, 0);
  const driverCost = financial.summary.driverCost;
  const maintenanceCost = financial.summary.maintenanceCost;
  const tollCost = financial.summary.tollCost;
  const knownCost = fuelCost + driverCost + maintenanceCost + tollCost;
  const otherCost = Math.max(totalCost - knownCost, 0);
  const highCostPerKm = vehicleFin.filter((item) => item.cpkm > 1.5).length;
  const maintenanceAlerts = vehicleFin.filter((item) => item.maintCost >= 2000).length;
  const tollVehicles = vehicleFin.filter((item) => item.tollCost > 0).length;

  return {
    period: {
      key: period.key,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    summary: {
      totalCost: roundMoney(totalCost),
      costPerKm: kmTotal > 0 ? roundMoney(totalCost / kmTotal) : 0,
      vehiclesAttention: highCostPerKm + maintenanceAlerts,
      kmTotal: roundMoney(kmTotal),
      fuelCost: roundMoney(fuelCost),
      driverCost: roundMoney(driverCost),
      maintenanceCost: roundMoney(maintenanceCost),
      tollCost: roundMoney(tollCost),
      otherCost: roundMoney(otherCost),
      revenue: roundMoney(financial.summary.revenue),
    },
    vehicleFin,
    driverCosts: fuel.drivers,
    costDaily: buildDailyCosts(period, financial.dailyRows, fuel.dailyRows),
    revenueMonthly: buildMonthlyCosts(period, financial.monthlyRows),
    costBreakdown: [
      { id: "combustivel", label: "Combustível", value: roundMoney(fuelCost) },
      { id: "motoristas", label: "Motoristas", value: roundMoney(driverCost) },
      { id: "manutencao", label: "Manutenção", value: roundMoney(maintenanceCost) },
      { id: "pedagios", label: "Pedágios", value: roundMoney(tollCost) },
      { id: "outros", label: "Outros", value: roundMoney(otherCost) },
    ].filter((item) => item.value > 0 || item.id !== "outros"),
    alerts: {
      highCostPerKm,
      maintenance: maintenanceAlerts,
      tollVehicles,
    },
    sources: {
      financial: financial.schema ? `${financial.schema}.${REQUIRED_FINANCIAL_VIEW}` : null,
      fuel: fuel.schema ? `${fuel.schema}.${REQUIRED_FUEL_VIEW}` : null,
    },
  };
}
