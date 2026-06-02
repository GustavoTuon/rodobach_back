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

function toIso(d) {
  return d.toISOString().slice(0, 10);
}

function monthLabel(v) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(v))
    .replace(".", "");
}

function resolvePeriod(period, startDate, endDate) {
  if (startDate && endDate) {
    return { key: "custom", label: "Personalizado", startDate, endDate };
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

export async function getAnaliseClientes({ period, startDate, endDate, cliente, status } = {}) {
  const resolved = resolvePeriod(period, startDate, endDate);
  const { startDate: sd, endDate: ed } = resolved;

  // Previous period (same duration before the current period)
  const sdDate = new Date(sd + "T00:00:00Z");
  const edDate = new Date(ed + "T00:00:00Z");
  const durationMs = edDate - sdDate;
  const prevEnd = new Date(sdDate.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  const prevSd = toIso(prevStart);
  const prevEd = toIso(prevEnd);

  const clienteFilter = cliente && !isNaN(Number(cliente)) ? Number(cliente) : null;

  // ── Query 1: Client aggregation ───────────────────────────────────────────
  const clientsQuery = `
    WITH rec_period AS (
      SELECT
        rec.clienterec   AS codigo,
        rec.empresarec   AS empresa,
        SUM(rec.valorduplicatarec)  AS total_periodo,
        COUNT(*)                    AS lancamentos_periodo,
        MAX(rec.dataemissaorec::date) AS ultimo_no_periodo
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec::date >= $1
        AND rec.dataemissaorec::date <= $2
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
      GROUP BY rec.clienterec, rec.empresarec
    ),
    rec_hist AS (
      SELECT
        rec.clienterec   AS codigo,
        MAX(rec.dataemissaorec::date) AS ultimo_global,
        MIN(rec.dataemissaorec::date) AS primeiro
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec IS NOT NULL
        AND rec.dataemissaorec::date >= CURRENT_DATE - INTERVAL '3 years'
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
      GROUP BY rec.clienterec
    ),
    rec_prev AS (
      SELECT
        rec.clienterec   AS codigo,
        SUM(rec.valorduplicatarec) AS total_anterior
      FROM financeiro.receber rec
      WHERE rec.dataemissaorec::date >= $3
        AND rec.dataemissaorec::date <= $4
        AND ($5::int IS NULL OR rec.clienterec = $5::int)
      GROUP BY rec.clienterec
    ),
    combined AS (
      SELECT
        COALESCE(rp.codigo, rh.codigo)           AS codigo,
        rp.empresa                                AS empresa,
        COALESCE(rp.total_periodo, 0)             AS total_periodo,
        COALESCE(rp.lancamentos_periodo, 0)::int  AS lancamentos_periodo,
        rh.ultimo_global,
        rh.primeiro,
        (CURRENT_DATE - rh.ultimo_global)::int    AS dias_sem_faturar,
        COALESCE(rprev.total_anterior, 0)         AS total_anterior
      FROM rec_hist rh
      LEFT JOIN rec_period  rp    ON rp.codigo    = rh.codigo
      LEFT JOIN rec_prev    rprev ON rprev.codigo = rh.codigo
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

  const params = [sd, ed, prevSd, prevEd, clienteFilter];
  const monthParams = [sd, ed];

  const [clientsRes, monthlyRes, topMonthlyRes] = await Promise.all([
    clientPool.query(clientsQuery, params),
    clientPool.query(monthlyQuery, monthParams),
    clientPool.query(topMonthlyQuery, monthParams),
  ]);

  const allClients = clientsRes.rows;

  // ── Summary calculations ──────────────────────────────────────────────────
  const withBilling = allClients.filter(c => num(c.total_periodo) > 0);
  const totalFaturado = withBilling.reduce((s, c) => s + num(c.total_periodo), 0);
  const clientesAtivos = withBilling.length;
  const ticketMedio = clientesAtivos > 0 ? totalFaturado / clientesAtivos : 0;
  const topCliente = withBilling.length > 0 ? withBilling[0] : null;

  // ── Map clients with business rules ──────────────────────────────────────
  const mapped = allClients.map((c) => {
    const total = num(c.total_periodo);
    const anterior = num(c.total_anterior);
    const dias = num(c.dias_sem_faturar);
    const lanc = num(c.lancamentos_periodo);
    const ticketC = lanc > 0 ? total / lanc : 0;
    const crescimento = anterior > 0 ? ((total - anterior) / anterior) * 100 : null;
    const { status: statusComercial, acao } = classifyClient(total, anterior, dias, lanc, ticketMedio, totalFaturado);

    return {
      codigo: c.codigo,
      nome: c.nome || "Sem identificação",
      documento: c.documento,
      ultimoFaturamento: dateOnly(c.ultimo_global),
      primeiroFaturamento: dateOnly(c.primeiro),
      totalPeriodo: total,
      totalAnterior: anterior,
      lancamentos: lanc,
      ticketMedio: ticketC,
      diasSemFaturar: dias,
      statusComercial,
      acaoSugerida: acao,
      crescimento,
    };
  });

  // ── Status filter (applied after classification) ──────────────────────────
  let filteredClients = mapped;
  if (status === "ativo") {
    filteredClients = mapped.filter(c => c.totalPeriodo > 0 && c.diasSemFaturar <= 60);
  } else if (status === "sem-faturamento") {
    filteredClients = mapped.filter(c => c.diasSemFaturar > 60);
  }

  // ── Inactive distribution ─────────────────────────────────────────────────
  const inativo30 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 30 && d <= 60; }).length;
  const inativo60 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 60 && d <= 90; }).length;
  const inativo90 = allClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 90 && d <= 120; }).length;
  const inativo120 = allClients.filter(c => num(c.dias_sem_faturar) > 120).length;

  return {
    period: resolved,
    summary: {
      totalFaturado,
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
