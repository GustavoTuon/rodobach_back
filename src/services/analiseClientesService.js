import { clientPool } from "../db/clientPool.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(v) {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function logAnaliseClientes(label, { sql, params, rows, totals } = {}) {
  if (process.env.DEBUG_SQL !== "1") return;
  console.log("[analise-clientes]", label, {
    params,
    rows,
    totals,
    sql: String(sql || "").replace(/\s+/g, " ").trim().slice(0, 1200),
  });
}

function toIso(d) {
  return d.toISOString().slice(0, 10);
}

function addYearsIso(base, years) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return toIso(d);
}

function pctChange(current, previous) {
  return previous > 0 ? r2(((num(current) - num(previous)) / num(previous)) * 100) : null;
}

function monthLabel(v) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(v))
    .replace(".", "");
}

function resolvePeriod(period, startDate, endDate) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (start || end) {
    const now = new Date();
    const today = toIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
    return { key: "custom", label: "Personalizado", startDate: start || end, endDate: end || today };
  }
  const now = new Date();
  const ed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sd = new Date(ed);
  const key = String(period || "12m").toLowerCase();
  if (key === "3m") {
    sd.setUTCMonth(ed.getUTCMonth() - 3);
    return { key, label: "3 meses", startDate: toIso(sd), endDate: toIso(ed) };
  } else if (key === "6m") {
    sd.setUTCMonth(ed.getUTCMonth() - 6);
    return { key, label: "6 meses", startDate: toIso(sd), endDate: toIso(ed) };
  } else if (key === "30d") {
    sd.setUTCDate(ed.getUTCDate() - 29);
    return { key, label: "30 dias", startDate: toIso(sd), endDate: toIso(ed) };
  } else {
    sd.setUTCFullYear(ed.getUTCFullYear() - 1);
    return { key: "12m", label: "12 meses", startDate: toIso(sd), endDate: toIso(ed) };
  }
}

function classifyClient(totalPeriodo, totalAnterior, diasSemFaturar, lancamentos, ticketMedio, totalGeral) {
  const threshold = totalGeral > 0 ? totalGeral * 0.08 : 0;
  const ticketCliente = lancamentos > 0 ? totalPeriodo / lancamentos : 0;

  if (diasSemFaturar <= 30 && totalPeriodo > 0) {
    if (totalPeriodo >= threshold) return { status: "estrategico", acao: "manter-relacionamento" };
    if (lancamentos >= 2 && ticketCliente < ticketMedio * 0.35) return { status: "potencial", acao: "potencial" };
    return { status: "ativo", acao: "manter-relacionamento" };
  }
  if (diasSemFaturar > 30 && diasSemFaturar <= 90) {
    return { status: "atencao", acao: "entrar-contato" };
  }
  if (diasSemFaturar > 90) {
    if (totalAnterior > 0) return { status: "parado", acao: "recuperar-cliente" };
    return { status: "parado", acao: "cliente-parado" };
  }
  // totalPeriodo > 0 but diasSemFaturar 31-90 — edge case (billed in period but last bill was 31+ days ago)
  if (totalPeriodo > 0 && diasSemFaturar > 30) {
    return { status: "atencao", acao: "entrar-contato" };
  }
  return { status: "ativo", acao: "manter-relacionamento" };
}

export async function getAnaliseClientes({ period, startDate, endDate, empresa, cliente, status, incluirVencidosAntigos } = {}) {
  const resolved = resolvePeriod(period, startDate, endDate);
  const { startDate: sd, endDate: ed } = resolved;
  const includeOldOverdue = ["1", "true", "sim", "yes"].includes(String(incluirVencidosAntigos || "").toLowerCase());
  const overdueStartDate = includeOldOverdue ? "1900-01-01" : "2025-01-01";
  const empresaFilter = empresa && String(empresa).toLowerCase() !== "todas" ? Number(empresa) || null : null;

  // Previous period (same duration before the current period)
  const sdDate = new Date(sd + "T00:00:00Z");
  const edDate = new Date(ed + "T00:00:00Z");
  const durationMs = edDate - sdDate;
  const prevEnd = new Date(sdDate.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  const prevSd = toIso(prevStart);
  const prevEd = toIso(prevEnd);
  const yoySd = addYearsIso(sd, -1);
  const yoyEd = addYearsIso(ed, -1);

  const clienteFilter = cliente && !isNaN(Number(cliente)) ? Number(cliente) : null;

  // ── Query 1: Client aggregation ───────────────────────────────────────────
  const clientsQuery = `
    WITH rec_period AS (
      SELECT
        rec.clienterec   AS codigo,
        rec.empresarec   AS empresa,
        SUM(rec.valorduplicatarec)  AS total_periodo,
        SUM(COALESCE(rec.valorabertorec, 0)) AS total_aberto,
        SUM(CASE
          WHEN COALESCE(rec.valorabertorec, 0) > 0
            AND rec.datavencimentorec::date >= $6::date
            AND rec.datavencimentorec::date < CURRENT_DATE
            THEN COALESCE(rec.valorabertorec, 0)
          ELSE 0
        END) AS total_vencido,
        SUM(CASE
          WHEN COALESCE(rec.valorabertorec, 0) > 0
            AND rec.datavencimentorec::date >= $6::date
            AND rec.datavencimentorec::date < CURRENT_DATE - INTERVAL '5 days'
            THEN COALESCE(rec.valorabertorec, 0)
          ELSE 0
        END) AS total_inadimplente,
        COUNT(*)                    AS lancamentos_periodo,
        MAX(rec.dataemissaorec::date) AS ultimo_no_periodo
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec::date >= $1
        AND rec.dataemissaorec::date <= $2
        AND rec.statusrec IN (1,2)
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
        AND ($7::int IS NULL OR rec.empresarec = $7::int)
      GROUP BY rec.clienterec, rec.empresarec
    ),
    rec_recebido AS (
      SELECT
        COALESCE(rcb.clientercb, rec.clienterec) AS codigo,
        SUM(COALESCE(rcb.valorrecebidorcb, 0)) AS total_recebido
      FROM financeiro.receberrecebimentos rcb
      LEFT JOIN financeiro.receber rec
        ON rec.empresarec = rcb.empresarcb
       AND rec.serierec = rcb.seriercb
       AND rec.duplicatarec = rcb.duplicatarcb
       AND rec.parcelarec = rcb.parcelarcb
      WHERE rcb.datarecebimentorcb::date >= $1
        AND rcb.datarecebimentorcb::date <= $2
        AND rec.statusrec IN (1,2)
        AND ($5::int IS NULL OR COALESCE(rcb.clientercb, rec.clienterec) = $5::int)
        AND ($7::int IS NULL OR rec.empresarec = $7::int)
      GROUP BY COALESCE(rcb.clientercb, rec.clienterec)
    ),
    rec_hist AS (
      SELECT
        rec.clienterec   AS codigo,
        MAX(rec.dataemissaorec::date) AS ultimo_global,
        MIN(rec.dataemissaorec::date) AS primeiro
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec IS NOT NULL
        AND rec.statusrec IN (1,2)
        AND rec.dataemissaorec::date >= CURRENT_DATE - INTERVAL '3 years'
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
        AND ($7::int IS NULL OR rec.empresarec = $7::int)
      GROUP BY rec.clienterec
    ),
    rec_prev AS (
      SELECT
        rec.clienterec   AS codigo,
        SUM(rec.valorduplicatarec) AS total_anterior
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec::date >= $3
        AND rec.dataemissaorec::date <= $4
        AND rec.statusrec IN (1,2)
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
        AND ($7::int IS NULL OR rec.empresarec = $7::int)
      GROUP BY rec.clienterec
    ),
    rec_yoy AS (
      SELECT
        rec.clienterec   AS codigo,
        SUM(rec.valorduplicatarec) AS total_ano_anterior,
        COUNT(*)::int AS documentos_ano_anterior
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec::date >= $8
        AND rec.dataemissaorec::date <= $9
        AND rec.statusrec IN (1,2)
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
        AND ($7::int IS NULL OR rec.empresarec = $7::int)
      GROUP BY rec.clienterec
    ),
    combined AS (
      SELECT
        COALESCE(rp.codigo, rh.codigo)           AS codigo,
        rp.empresa                                AS empresa,
        COALESCE(rp.total_periodo, 0)             AS total_periodo,
        COALESCE(rr.total_recebido, 0)             AS total_recebido,
        COALESCE(rp.total_aberto, 0)               AS total_aberto,
        COALESCE(rp.total_vencido, 0)              AS total_vencido,
        COALESCE(rp.total_inadimplente, 0)         AS total_inadimplente,
        COALESCE(rp.lancamentos_periodo, 0)::int  AS lancamentos_periodo,
        rh.ultimo_global,
        rh.primeiro,
        (CURRENT_DATE - rh.ultimo_global)::int    AS dias_sem_faturar,
        COALESCE(rprev.total_anterior, 0)         AS total_anterior,
        COALESCE(ry.total_ano_anterior, 0)        AS total_ano_anterior,
        COALESCE(ry.documentos_ano_anterior, 0)::int AS documentos_ano_anterior
      FROM rec_hist rh
      LEFT JOIN rec_period  rp    ON rp.codigo    = rh.codigo
      LEFT JOIN rec_recebido rr    ON rr.codigo    = rh.codigo
      LEFT JOIN rec_prev    rprev ON rprev.codigo = rh.codigo
      LEFT JOIN rec_yoy     ry    ON ry.codigo    = rh.codigo
    )
    SELECT
      c.*,
      COALESCE(NULLIF(cli.fantasiacli,''), NULLIF(cli.nomecli,''), 'Sem identificação') AS nome,
      cli.cnpjcpfcli AS documento
    FROM combined c
    LEFT JOIN LATERAL (
      SELECT nomecli, fantasiacli, cnpjcpfcli
      FROM gerais.clientes
      WHERE codigocli = c.codigo
      ORDER BY codigocli
      LIMIT 1
    ) cli ON true
    WHERE c.codigo IS NOT NULL
    ORDER BY total_periodo DESC NULLS LAST, dias_sem_faturar ASC NULLS LAST
    LIMIT 2000
  `;

  // ── Query 2: Overall monthly evolution ────────────────────────────────────
  const monthlyQuery = `
    SELECT
      date_trunc('month', rec.dataemissaorec::date)::date AS mes,
      SUM(rec.valorduplicatarec)        AS valor_total,
      COUNT(DISTINCT rec.clienterec)    AS clientes_count,
      COUNT(*)                          AS lancamentos
    FROM financeiro.receber rec
    WHERE rec.dataemissaorec::date >= $1
      AND rec.dataemissaorec::date <= $2
      AND rec.statusrec IN (1,2)
      AND ($3::int IS NULL OR rec.empresarec = $3::int)
    GROUP BY mes
    ORDER BY mes
  `;

  // ── Query 3: Monthly evolution for top 10 clients ─────────────────────────
  const topMonthlyQuery = `
    WITH top10 AS (
      SELECT clienterec AS codigo, SUM(valorduplicatarec) AS total
      FROM financeiro.receber
      WHERE dataemissaorec::date >= $1 AND dataemissaorec::date <= $2
        AND dataemissaorec IS NOT NULL
        AND statusrec IN (1,2)
        AND ($3::int IS NULL OR empresarec = $3::int)
      GROUP BY clienterec
      ORDER BY total DESC
      LIMIT 10
    ),
    monthly AS (
      SELECT
        rec.clienterec AS codigo,
        date_trunc('month', rec.dataemissaorec::date)::date AS mes,
        SUM(rec.valorduplicatarec) AS valor
      FROM financeiro.receber rec
      INNER JOIN top10 t ON t.codigo = rec.clienterec
      WHERE rec.dataemissaorec::date >= $1 AND rec.dataemissaorec::date <= $2
        AND rec.statusrec IN (1,2)
        AND ($3::int IS NULL OR rec.empresarec = $3::int)
      GROUP BY rec.clienterec, mes
    )
    SELECT
      m.codigo,
      COALESCE(NULLIF(cli.fantasiacli,''), NULLIF(cli.nomecli,''), 'Sem nome') AS nome,
      m.mes,
      m.valor
    FROM monthly m
    LEFT JOIN LATERAL (
      SELECT nomecli, fantasiacli
      FROM gerais.clientes
      WHERE codigocli = m.codigo
      LIMIT 1
    ) cli ON true
    ORDER BY m.mes, m.valor DESC
  `;

  const params = [sd, ed, prevSd, prevEd, clienteFilter, overdueStartDate, empresaFilter, yoySd, yoyEd];
  const monthParams = [sd, ed, empresaFilter];

  const dbClient = await clientPool.connect();
  let clientsRes;
  let monthlyRes;
  let topMonthlyRes;
  try {
    clientsRes = await dbClient.query(clientsQuery, params);
    monthlyRes = await dbClient.query(monthlyQuery, monthParams);
    topMonthlyRes = await dbClient.query(topMonthlyQuery, monthParams);
  } finally {
    dbClient.release();
  }

  const allClients = clientsRes.rows;

  // ── Summary calculations ──────────────────────────────────────────────────
  const withBilling = allClients.filter(c => num(c.total_periodo) > 0);
  const totalFaturado = withBilling.reduce((s, c) => s + num(c.total_periodo), 0);
  const totalRecebido = allClients.reduce((s, c) => s + num(c.total_recebido), 0);
  const totalAberto = allClients.reduce((s, c) => s + num(c.total_aberto), 0);
  const totalVencido = allClients.reduce((s, c) => s + num(c.total_vencido), 0);
  const totalInadimplente = allClients.reduce((s, c) => s + num(c.total_inadimplente), 0);
  const documentosPeriodo = withBilling.reduce((s, c) => s + num(c.lancamentos_periodo), 0);
  const totalAnoAnterior = allClients.reduce((s, c) => s + num(c.total_ano_anterior), 0);
  const documentosAnoAnterior = allClients.reduce((s, c) => s + num(c.documentos_ano_anterior), 0);
  const clientesAtivos = withBilling.length;
  const ticketMedio = clientesAtivos > 0 ? totalFaturado / clientesAtivos : 0;
  const topCliente = withBilling.length > 0 ? withBilling[0] : null;

  // ── Map clients with business rules ──────────────────────────────────────
  const mapped = allClients.map((c) => {
    const total = num(c.total_periodo);
    const anterior = num(c.total_anterior);
    const totalYoY = num(c.total_ano_anterior);
    const docsYoY = num(c.documentos_ano_anterior);
    const dias = num(c.dias_sem_faturar);
    const lanc = num(c.lancamentos_periodo);
    const ticketC = lanc > 0 ? total / lanc : 0;
    const crescimento = anterior > 0 ? ((total - anterior) / anterior) * 100 : null;
    const crescimentoAnoAnterior = pctChange(total, totalYoY);
    const variacaoDocumentosAnoAnterior = pctChange(lanc, docsYoY);
    const { status: statusComercial, acao } = classifyClient(total, anterior, dias, lanc, ticketMedio, totalFaturado);

    return {
      codigo: c.codigo,
      nome: c.nome || "Sem identificação",
      documento: c.documento,
      ultimoFaturamento: dateOnly(c.ultimo_global),
      primeiroFaturamento: dateOnly(c.primeiro),
      totalPeriodo: total,
      totalRecebido: r2(c.total_recebido),
      totalAberto: r2(c.total_aberto),
      totalVencido: r2(c.total_vencido),
      totalInadimplente: r2(c.total_inadimplente),
      totalAnterior: anterior,
      totalAnoAnterior: r2(totalYoY),
      lancamentos: lanc,
      documentosPeriodo: lanc,
      documentosAnoAnterior: docsYoY,
      ticketMedio: ticketC,
      diasSemFaturar: dias,
      statusComercial,
      acaoSugerida: acao,
      crescimento,
      crescimentoAnoAnterior,
      variacaoDocumentosAnoAnterior,
    };
  });

  // ── Status filter (applied after classification) ──────────────────────────
  // Na visao padrao, a tabela acompanha o periodo selecionado. O historico completo
  // continua sendo usado nos KPIs de inatividade e fica acessivel pelo filtro dedicado.
  let filteredClients = mapped.filter(c => c.totalPeriodo > 0);
  if (status === "ativo") {
    filteredClients = mapped.filter(c => c.totalPeriodo > 0 && c.diasSemFaturar <= 60);
  } else if (status === "sem-faturamento") {
    filteredClients = mapped.filter(c => c.totalPeriodo === 0 && c.diasSemFaturar > 60);
  }

  // ── Inactive distribution ─────────────────────────────────────────────────
  const inativo30 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 30 && d <= 60; }).length;
  const inativo60 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 60 && d <= 90; }).length;
  const inativo90 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 90 && d <= 120; }).length;
  const inativo120 = allClients.filter(c => num(c.dias_sem_faturar) > 120).length;

  logAnaliseClientes("consulta-consolidada", {
    sql: clientsQuery,
    params,
    rows: {
      clientes: clientsRes.rowCount,
      mensal: monthlyRes.rowCount,
      topMensal: topMonthlyRes.rowCount,
    },
    totals: { totalFaturado: r2(totalFaturado), totalRecebido: r2(totalRecebido), totalAberto: r2(totalAberto), totalVencido: r2(totalVencido) },
  });

  return {
    period: resolved,
    filters: {
      empresa: empresaFilter,
      cliente: clienteFilter,
      status: status || "todos",
    },
    summary: {
      totalFaturado,
      totalRecebido: r2(totalRecebido),
      totalAberto: r2(totalAberto),
      totalVencido: r2(totalVencido),
      totalInadimplente: r2(totalInadimplente),
      totalAnoAnterior: r2(totalAnoAnterior),
      documentosPeriodo,
      documentosAnoAnterior,
      variacaoAnoAnterior: pctChange(totalFaturado, totalAnoAnterior),
      variacaoDocumentosAnoAnterior: pctChange(documentosPeriodo, documentosAnoAnterior),
      clientesAtivos,
      ticketMedio,
      topCliente: topCliente
        ? { nome: topCliente.nome, valor: num(topCliente.total_periodo) }
        : null,
      inativo30,
      inativo60,
      inativo90,
      inativo120,
    },
    audit: {
      tablesFound: [
        "financeiro.receber",
        "financeiro.receberrecebimentos",
        "gerais.clientes",
      ],
      fieldsUsed: {
        receitaPorCliente: ["receber.clienterec", "receber.dataemissaorec", "receber.valorduplicatarec"],
        recebido: ["receberrecebimentos.datarecebimentorcb", "receberrecebimentos.valorrecebidorcb"],
        abertoVencido: ["receber.valorabertorec", "receber.datavencimentorec"],
        cliente: ["gerais.clientes.codigocli", "nomecli", "fantasiacli", "cnpjcpfcli"],
      },
      regras: {
        statusReceber: "Somente statusrec IN (1,2), mesma base de recebiveis usada no DRE/Demonstrativo.",
        vencidosAntigos: includeOldOverdue ? "incluidos" : "ignorados antes de 2025-01-01",
        empresa: empresaFilter ? `Somente empresa ${empresaFilter}` : "Todas as empresas",
      },
      pending: [
        "A tela Clientes usa financeiro.receber por cliente; o DRE tambem pode incluir movimentacoes financeiras de receita sem cliente vinculado.",
        "Inadimplente foi definido como aberto vencido ha mais de 5 dias; ajuste a regra se a empresa usar outro prazo de tolerancia.",
      ],
    },
    monthly: monthlyRes.rows.map(r => ({
      mes: dateOnly(r.mes),
      label: monthLabel(r.mes),
      valorTotal: num(r.valor_total),
      clientesCount: num(r.clientes_count),
      lancamentos: num(r.lancamentos),
    })),
    topClientesMonthly: topMonthlyRes.rows.map(r => ({
      codigo: r.codigo,
      nome: r.nome,
      mes: dateOnly(r.mes),
      label: monthLabel(r.mes),
      valor: num(r.valor),
    })),
    clients: filteredClients,
  };
}
