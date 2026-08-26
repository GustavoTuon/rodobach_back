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

function documentIdentity(documento, codigo, empresa) {
  const digits = String(documento || "").replace(/\D/g, "");
  const repeatedDigits = /^(\d)\1+$/.test(digits);
  if (digits.length === 14 && !repeatedDigits) return { key: `cnpj:${digits.slice(0, 8)}`, type: "cnpj", root: digits.slice(0, 8) };
  if (digits.length === 11 && !repeatedDigits) return { key: `cpf:${digits}`, type: "cpf", root: digits };
  return { key: `cadastro:${rowCompanyKey(empresa)}:${codigo}`, type: "cadastro", root: null };
}

function rowCompanyKey(empresa) {
  return empresa == null || empresa === "" ? "geral" : String(empresa);
}

function isTechnicalClient(row) {
  const name = String(row.nome || "").trim().toUpperCase();
  const digits = String(row.documento || "").replace(/\D/g, "");
  return /^(DESTINATARIO|REMETENTE|NULO)$/.test(name) && (!digits || /^(\d)\1+$/.test(digits));
}

function dateTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function consolidateClientBranches(rows = []) {
  const groups = new Map();
  const sumFields = [
    "total_periodo", "total_recebido", "total_aberto", "total_vencido",
    "total_inadimplente", "lancamentos_periodo", "total_anterior",
    "total_ano_anterior", "documentos_ano_anterior",
  ];

  for (const row of rows) {
    const identity = documentIdentity(row.documento, row.codigo, row.empresa);
    let group = groups.get(identity.key);
    if (!group) {
      group = {
        ...row,
        ...Object.fromEntries(sumFields.map(field => [field, 0])),
        identidade_cliente: identity.key,
        documento_raiz: identity.root,
        tipo_documento: identity.type,
        cliente_tecnico: isTechnicalClient(row),
        filiais: [],
      };
      groups.set(identity.key, group);
    }

    for (const field of sumFields) group[field] += num(row[field]);
    group.filiais.push({
      empresa: row.empresa ?? null,
      codigo: row.codigo,
      nome: row.nome || "Sem identificação",
      documento: row.documento || null,
      totalPeriodo: r2(row.total_periodo),
    });

    // O cadastro com maior faturamento representa o grupo na listagem.
    if (num(row.total_periodo) > num(group._representativeTotal)) {
      group.codigo = row.codigo;
      group.nome = row.nome;
      group.documento = row.documento;
      group._representativeTotal = num(row.total_periodo);
    }
    if (dateTime(row.ultimo_global) > (dateTime(group.ultimo_global) ?? -Infinity)) group.ultimo_global = row.ultimo_global;
    if (dateTime(row.primeiro) < (dateTime(group.primeiro) ?? Infinity)) group.primeiro = row.primeiro;
  }

  return [...groups.values()].map(group => {
    delete group._representativeTotal;
    group.dias_sem_faturar = group.ultimo_global
      ? Math.max(0, Math.floor((Date.now() - dateTime(group.ultimo_global)) / 86400000))
      : null;
    group.quantidade_filiais = group.filiais.length;
    return group;
  }).sort((a, b) => num(b.total_periodo) - num(a.total_periodo));
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

export function filterClientsForView(mapped, { status, inativoMin, inativoMax, incluirSemFaturamento } = {}) {
  const inactiveMin = Number(inativoMin);
  const inactiveMax = Number(inativoMax);
  const hasInactiveMin = Number.isFinite(inactiveMin);
  const hasInactiveMax = Number.isFinite(inactiveMax);
  const includeWithoutBilling = ["1", "true", "sim", "yes"].includes(String(incluirSemFaturamento || "").toLowerCase());

  if (status === "ativo") return mapped.filter(c => c.totalPeriodo > 0 && c.diasSemFaturar <= 60);
  if (status === "sem-faturamento") {
    return mapped.filter(c => {
      const dias = num(c.diasSemFaturar);
      return c.totalPeriodo === 0
        && (!hasInactiveMin || dias > inactiveMin)
        && (!hasInactiveMax || dias <= inactiveMax);
    });
  }
  return includeWithoutBilling ? mapped : mapped.filter(c => c.totalPeriodo > 0);
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

export async function getAnaliseClientes({ period, startDate, endDate, empresa, cliente, status, inativoMin, inativoMax, incluirVencidosAntigos, incluirSemFaturamento } = {}) {
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
      GROUP BY rec.clienterec
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
    WITH base AS (
      SELECT rec.*,
        CASE
          WHEN length(regexp_replace(COALESCE(cli.cnpjcpfcli, ''), '[^0-9]', '', 'g')) = 14
            AND regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g') !~ '^([0-9])\\1+$'
            THEN 'cnpj:' || left(regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g'), 8)
          WHEN length(regexp_replace(COALESCE(cli.cnpjcpfcli, ''), '[^0-9]', '', 'g')) = 11
            AND regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g') !~ '^([0-9])\\1+$'
            THEN 'cpf:' || regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g')
          ELSE 'cadastro:' || rec.empresarec::text || ':' || rec.clienterec::text
        END AS identidade_cliente
      FROM financeiro.receber rec
      LEFT JOIN LATERAL (
        SELECT cnpjcpfcli FROM gerais.clientes WHERE codigocli = rec.clienterec
        ORDER BY (empresacli = rec.empresarec) DESC, empresacli LIMIT 1
      ) cli ON true
      WHERE rec.dataemissaorec::date >= $1
        AND rec.dataemissaorec::date <= $2
        AND rec.statusrec IN (1,2)
        AND ($3::int IS NULL OR rec.empresarec = $3::int)
    )
    SELECT
      date_trunc('month', dataemissaorec::date)::date AS mes,
      SUM(valorduplicatarec)                AS valor_total,
      COUNT(DISTINCT identidade_cliente)    AS clientes_count,
      COUNT(*)                              AS lancamentos
    FROM base
    GROUP BY mes
    ORDER BY mes
  `;

  // ── Query 3: Monthly evolution for top 10 clients ─────────────────────────
  const topMonthlyQuery = `
    WITH base AS (
      SELECT
        rec.clienterec AS codigo,
        rec.dataemissaorec,
        rec.valorduplicatarec,
        COALESCE(NULLIF(cli.fantasiacli,''), NULLIF(cli.nomecli,''), 'Sem nome') AS nome,
        CASE
          WHEN length(regexp_replace(COALESCE(cli.cnpjcpfcli, ''), '[^0-9]', '', 'g')) = 14
            AND regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g') !~ '^([0-9])\\1+$'
            THEN 'cnpj:' || left(regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g'), 8)
          WHEN length(regexp_replace(COALESCE(cli.cnpjcpfcli, ''), '[^0-9]', '', 'g')) = 11
            AND regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g') !~ '^([0-9])\\1+$'
            THEN 'cpf:' || regexp_replace(cli.cnpjcpfcli, '[^0-9]', '', 'g')
          ELSE 'cadastro:' || rec.empresarec::text || ':' || rec.clienterec::text
        END AS identidade_cliente
      FROM financeiro.receber rec
      LEFT JOIN LATERAL (
        SELECT nomecli, fantasiacli, cnpjcpfcli
        FROM gerais.clientes WHERE codigocli = rec.clienterec
        ORDER BY (empresacli = rec.empresarec) DESC, empresacli LIMIT 1
      ) cli ON true
      WHERE rec.dataemissaorec::date >= $1 AND rec.dataemissaorec::date <= $2
        AND rec.statusrec IN (1,2)
        AND ($3::int IS NULL OR rec.empresarec = $3::int)
    ),
    top10 AS (
      SELECT identidade_cliente, SUM(valorduplicatarec) AS total
      FROM base
      GROUP BY identidade_cliente
      ORDER BY total DESC
      LIMIT 10
    ),
    monthly AS (
      SELECT
        b.identidade_cliente AS codigo,
        (array_agg(b.nome ORDER BY b.valorduplicatarec DESC))[1] AS nome,
        date_trunc('month', b.dataemissaorec::date)::date AS mes,
        SUM(b.valorduplicatarec) AS valor
      FROM base b
      INNER JOIN top10 t ON t.identidade_cliente = b.identidade_cliente
      GROUP BY b.identidade_cliente, mes
    )
    SELECT
      m.codigo,
      m.nome,
      m.mes,
      m.valor
    FROM monthly m
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

  const allClients = consolidateClientBranches(clientsRes.rows);
  const businessClients = allClients.filter(c => !c.cliente_tecnico);

  // ── Summary calculations ──────────────────────────────────────────────────
  const allWithBilling = allClients.filter(c => num(c.total_periodo) > 0);
  const withBilling = businessClients.filter(c => num(c.total_periodo) > 0);
  const totalFaturado = allWithBilling.reduce((s, c) => s + num(c.total_periodo), 0);
  const totalRecebido = allClients.reduce((s, c) => s + num(c.total_recebido), 0);
  const totalAberto = allClients.reduce((s, c) => s + num(c.total_aberto), 0);
  const totalVencido = allClients.reduce((s, c) => s + num(c.total_vencido), 0);
  const totalInadimplente = allClients.reduce((s, c) => s + num(c.total_inadimplente), 0);
  const documentosPeriodo = allWithBilling.reduce((s, c) => s + num(c.lancamentos_periodo), 0);
  const totalAnoAnterior = allClients.reduce((s, c) => s + num(c.total_ano_anterior), 0);
  const documentosAnoAnterior = allClients.reduce((s, c) => s + num(c.documentos_ano_anterior), 0);
  const clientesAtivos = withBilling.length;
  const ticketMedio = clientesAtivos > 0 ? totalFaturado / clientesAtivos : 0;
  const topCliente = withBilling.length > 0 ? withBilling[0] : null;

  // ── Map clients with business rules ──────────────────────────────────────
  const mapped = businessClients.map((c) => {
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
      documentoRaiz: c.documento_raiz,
      identidadeCliente: c.identidade_cliente,
      quantidadeFiliais: c.quantidade_filiais,
      filiais: c.filiais,
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
  const inactiveMin = Number(inativoMin);
  const inactiveMax = Number(inativoMax);
  const hasInactiveMin = Number.isFinite(inactiveMin);
  const hasInactiveMax = Number.isFinite(inactiveMax);

  const filteredClients = filterClientsForView(mapped, { status, inativoMin, inativoMax, incluirSemFaturamento });

  // ── Inactive distribution ─────────────────────────────────────────────────
  const inativo30 = businessClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 30 && d <= 60; }).length;
  const inativo60 = businessClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 60 && d <= 90; }).length;
  const inativo90 = businessClients.filter(c => { const d = num(c.dias_sem_faturar); return d > 90 && d <= 120; }).length;
  const inativo120 = businessClients.filter(c => num(c.dias_sem_faturar) > 120).length;

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
      inativoMin: hasInactiveMin ? inactiveMin : null,
      inativoMax: hasInactiveMax ? inactiveMax : null,
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
