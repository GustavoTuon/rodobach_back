import { clientPool } from "../db/clientPool.js";

const iso = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const num = (value) => Number(value) || 0;
const money = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;

const FINANCING_PATTERN = /(financi|empr[eé]stim|cons[oó]rc)/i;

export function summarizeFutureExpenses(rows = []) {
  const normalized = rows.map((row) => ({
    ...row,
    data: iso(row.data),
    vencimento: iso(row.vencimento || row.data),
    valor: money(row.valor),
    financiamento: Boolean(row.financiamento) || FINANCING_PATTERN.test(`${row.categoria || ""} ${row.historico || ""}`),
  }));
  const total = money(normalized.reduce((sum, row) => sum + row.valor, 0));
  const financingRows = normalized.filter((row) => row.financiamento);
  const aggregate = (items, keyName, valueOf) => {
    const grouped = new Map();
    for (const item of items) {
      const key = valueOf(item) || "Não informado";
      const current = grouped.get(key) || { [keyName]: key, valor: 0, lancamentos: 0 };
      current.valor += item.valor;
      current.lancamentos += 1;
      grouped.set(key, current);
    }
    return [...grouped.values()].map((item) => ({ ...item, valor: money(item.valor) })).sort((a, b) => b.valor - a.valor);
  };
  return {
    horizonteMeses: 12,
    total,
    quantidade: normalized.length,
    financiamentos: {
      total: money(financingRows.reduce((sum, row) => sum + row.valor, 0)),
      quantidade: financingRows.length,
      mensal: aggregate(financingRows, "mes", (row) => row.data?.slice(0, 7)).sort((a, b) => a.mes.localeCompare(b.mes)),
      credores: aggregate(financingRows, "pessoa", (row) => row.pessoa).slice(0, 6),
      maiorParcela: financingRows.slice().sort((a, b) => b.valor - a.valor)[0] || null,
      proximos: financingRows.slice().sort((a, b) => a.data.localeCompare(b.data)).slice(0, 12),
    },
    mensal: aggregate(normalized, "mes", (row) => row.data?.slice(0, 7)).sort((a, b) => a.mes.localeCompare(b.mes)),
    categorias: aggregate(normalized, "categoria", (row) => row.categoria).slice(0, 8),
    fornecedores: aggregate(normalized, "pessoa", (row) => row.pessoa).slice(0, 8),
    proximos: normalized.slice().sort((a, b) => a.data.localeCompare(b.data)).slice(0, 20),
  };
}

function period(filters) {
  const now = new Date();
  const end = iso(filters.endDate || filters.dataFim) || iso(now.toISOString());
  const startDate = new Date(`${end}T12:00:00`);
  startDate.setDate(startDate.getDate() - 29);
  return { start: iso(filters.startDate || filters.dataInicio) || iso(startDate.toISOString()), end };
}

export async function getFluxoCaixa(filters = {}) {
  const range = period(filters);
  const mode = ["realizado", "previsto", "ambos"].includes(filters.mode) ? filters.mode : "ambos";
  const company = Number(filters.empresa) || null;
  const search = String(filters.search || "").trim() || null;

  const { rows } = await clientPool.query(`
    WITH movimentos AS (
      SELECT
        ('rec-real:' || rcb.empresarcb || ':' || rcb.seriercb || ':' || rcb.duplicatarcb || ':' || rcb.parcelarcb || ':' || rcb.datarecebimentorcb)::text AS id,
        rcb.datarecebimentorcb::date AS data,
        rec.datavencimentorec::date AS vencimento,
        'entrada'::text AS tipo,
        'realizado'::text AS natureza,
        'Recebimentos'::text AS categoria,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Cliente não informado')::text AS pessoa,
        COALESCE(rec.documentorec::text, rec.duplicatarec::text, rcb.duplicatarcb::text)::text AS documento,
        COALESCE(rec.observacaorec, 'Recebimento financeiro')::text AS historico,
        COALESCE(rcb.valorrecebidorcb, 0)::numeric AS valor,
        rcb.empresarcb::int AS empresa,
        false AS vencido
      FROM financeiro.receberrecebimentos rcb
      LEFT JOIN financeiro.receber rec ON rec.empresarec = rcb.empresarcb AND rec.serierec = rcb.seriercb AND rec.duplicatarec = rcb.duplicatarcb AND rec.parcelarec = rcb.parcelarcb
      LEFT JOIN LATERAL (SELECT c.nomecli, c.fantasiacli FROM gerais.clientes c WHERE c.codigocli = COALESCE(rcb.clientercb, rec.clienterec) ORDER BY (c.empresacli = rcb.empresarcb) DESC LIMIT 1) cli ON true
      WHERE rcb.datarecebimentorcb::date BETWEEN $1::date AND $2::date

      UNION ALL

      SELECT
        ('pag-real:' || ppg.empresappg || ':' || ppg.serieppg || ':' || ppg.duplicatappg || ':' || ppg.parcelappg || ':' || ppg.datapagamentoppg)::text,
        ppg.datapagamentoppg::date,
        pag.datavencimentopag::date,
        'saida'::text,
        'realizado'::text,
        COALESCE(cfi.nomecfi, 'Outros')::text,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Fornecedor não informado')::text,
        COALESCE(pag.documentopag::text, pag.duplicatapag::text, ppg.duplicatappg::text)::text,
        COALESCE(pag.observacaopag, 'Pagamento financeiro')::text,
        COALESCE(ppg.valorpagoppg, 0)::numeric,
        ppg.empresappg::int,
        false
      FROM financeiro.pagarpagamentos ppg
      LEFT JOIN financeiro.pagar pag ON pag.empresapag = ppg.empresappg AND pag.seriepag = ppg.serieppg AND pag.duplicatapag = ppg.duplicatappg AND pag.parcelapag = ppg.parcelappg AND pag.fornecedorpag = ppg.fornecedorppg
      LEFT JOIN LATERAL (SELECT f.nomefor, f.fantasiafor FROM gerais.fornecedores f WHERE f.codigofor = COALESCE(ppg.fornecedorppg, pag.fornecedorpag) ORDER BY (f.empresafor = ppg.empresappg) DESC LIMIT 1) forn ON true
      LEFT JOIN LATERAL (SELECT cf.nomecfi FROM unnest(pag.contasfinanceiraspag) conta(codigo) LEFT JOIN financeiro.contasfinanceiras cf ON cf.codigocfi = conta.codigo ORDER BY (cf.empresacfi = pag.empresapag) DESC LIMIT 1) cfi ON true
      WHERE ppg.datapagamentoppg::date BETWEEN $1::date AND $2::date

      UNION ALL

      SELECT
        ('rec-prev:' || rec.empresarec || ':' || rec.serierec || ':' || rec.duplicatarec || ':' || rec.parcelarec)::text,
        rec.datavencimentorec::date,
        rec.datavencimentorec::date,
        'entrada'::text,
        'previsto'::text,
        'Contas a receber'::text,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Cliente não informado')::text,
        COALESCE(rec.documentorec::text, rec.duplicatarec::text)::text,
        COALESCE(rec.observacaorec, 'Conta a receber')::text,
        COALESCE(rec.valorabertorec, 0)::numeric,
        rec.empresarec::int,
        rec.datavencimentorec::date < CURRENT_DATE
      FROM financeiro.receber rec
      LEFT JOIN LATERAL (SELECT c.nomecli, c.fantasiacli FROM gerais.clientes c WHERE c.codigocli = rec.clienterec ORDER BY (c.empresacli = rec.empresarec) DESC LIMIT 1) cli ON true
      WHERE rec.datavencimentorec::date BETWEEN $1::date AND $2::date AND COALESCE(rec.valorabertorec, 0) > 0 AND rec.statusrec IN (1,2)

      UNION ALL

      SELECT
        ('pag-prev:' || pag.empresapag || ':' || pag.seriepag || ':' || pag.duplicatapag || ':' || pag.parcelapag || ':' || pag.fornecedorpag)::text,
        pag.datavencimentopag::date,
        pag.datavencimentopag::date,
        'saida'::text,
        'previsto'::text,
        COALESCE(cfi.nomecfi, 'Outros')::text,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Fornecedor não informado')::text,
        COALESCE(pag.documentopag::text, pag.duplicatapag::text)::text,
        COALESCE(pag.observacaopag, 'Conta a pagar')::text,
        COALESCE(pag.valorabertopag, 0)::numeric,
        pag.empresapag::int,
        pag.datavencimentopag::date < CURRENT_DATE
      FROM financeiro.pagar pag
      LEFT JOIN LATERAL (SELECT f.nomefor, f.fantasiafor FROM gerais.fornecedores f WHERE f.codigofor = pag.fornecedorpag ORDER BY (f.empresafor = pag.empresapag) DESC LIMIT 1) forn ON true
      LEFT JOIN LATERAL (SELECT cf.nomecfi FROM unnest(pag.contasfinanceiraspag) conta(codigo) LEFT JOIN financeiro.contasfinanceiras cf ON cf.codigocfi = conta.codigo ORDER BY (cf.empresacfi = pag.empresapag) DESC LIMIT 1) cfi ON true
      WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date AND COALESCE(pag.valorabertopag, 0) > 0 AND pag.statuspag IN (1,2)
    )
    SELECT * FROM movimentos
    WHERE ($3::text = 'ambos' OR natureza = $3::text)
      AND ($4::int IS NULL OR empresa = $4::int)
      AND ($5::text IS NULL OR pessoa ILIKE '%' || $5 || '%' OR categoria ILIKE '%' || $5 || '%' OR documento ILIKE '%' || $5 || '%' OR historico ILIKE '%' || $5 || '%')
    ORDER BY data, tipo
  `, [range.start, range.end, mode, company, search]);

  const commonOpenPayable = `
    FROM financeiro.pagar pag
    LEFT JOIN LATERAL (SELECT f.nomefor, f.fantasiafor FROM gerais.fornecedores f WHERE f.codigofor = pag.fornecedorpag ORDER BY (f.empresafor = pag.empresapag) DESC LIMIT 1) forn ON true
    LEFT JOIN LATERAL (SELECT cf.nomecfi FROM unnest(pag.contasfinanceiraspag) conta(codigo) LEFT JOIN financeiro.contasfinanceiras cf ON cf.codigocfi = conta.codigo ORDER BY (cf.empresacfi = pag.empresapag) DESC LIMIT 1) cfi ON true
  `;
  const { rows: overdueRowsRaw } = await clientPool.query(`
    WITH vencidos AS (
      SELECT ('rec-prev:' || rec.empresarec || ':' || rec.serierec || ':' || rec.duplicatarec || ':' || rec.parcelarec)::text AS id,
        rec.datavencimentorec::date AS data, rec.datavencimentorec::date AS vencimento, 'entrada'::text AS tipo, 'previsto'::text AS natureza,
        'Contas a receber'::text AS categoria, COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Cliente não informado')::text AS pessoa,
        COALESCE(rec.documentorec::text, rec.duplicatarec::text)::text AS documento, COALESCE(rec.observacaorec, 'Conta a receber')::text AS historico,
        COALESCE(rec.valorabertorec, 0)::numeric AS valor, rec.empresarec::int AS empresa, true AS vencido
      FROM financeiro.receber rec
      LEFT JOIN LATERAL (SELECT c.nomecli, c.fantasiacli FROM gerais.clientes c WHERE c.codigocli = rec.clienterec ORDER BY (c.empresacli = rec.empresarec) DESC LIMIT 1) cli ON true
      WHERE rec.datavencimentorec::date < CURRENT_DATE AND COALESCE(rec.valorabertorec, 0) > 0 AND rec.statusrec IN (1,2)
      UNION ALL
      SELECT ('pag-prev:' || pag.empresapag || ':' || pag.seriepag || ':' || pag.duplicatapag || ':' || pag.parcelapag || ':' || pag.fornecedorpag)::text,
        pag.datavencimentopag::date, pag.datavencimentopag::date, 'saida'::text, 'previsto'::text, COALESCE(cfi.nomecfi, 'Outros')::text,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Fornecedor não informado')::text,
        COALESCE(pag.documentopag::text, pag.duplicatapag::text)::text, COALESCE(pag.observacaopag, 'Conta a pagar')::text,
        COALESCE(pag.valorabertopag, 0)::numeric, pag.empresapag::int, true
      ${commonOpenPayable}
      WHERE pag.datavencimentopag::date < CURRENT_DATE AND COALESCE(pag.valorabertopag, 0) > 0 AND pag.statuspag IN (1,2)
    ) SELECT * FROM vencidos
    WHERE ($1::int IS NULL OR empresa = $1::int)
      AND ($2::text IS NULL OR pessoa ILIKE '%' || $2 || '%' OR categoria ILIKE '%' || $2 || '%' OR documento ILIKE '%' || $2 || '%' OR historico ILIKE '%' || $2 || '%')
  `, [company, search]);
  const { rows: futureRowsRaw } = await clientPool.query(`
    SELECT ('pag-prev:' || pag.empresapag || ':' || pag.seriepag || ':' || pag.duplicatapag || ':' || pag.parcelapag || ':' || pag.fornecedorpag)::text AS id,
      pag.datavencimentopag::date AS data, pag.datavencimentopag::date AS vencimento, 'saida'::text AS tipo, 'previsto'::text AS natureza,
      COALESCE(cfi.nomecfi, 'Outros')::text AS categoria,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Fornecedor não informado')::text AS pessoa,
      COALESCE(pag.documentopag::text, pag.duplicatapag::text)::text AS documento, COALESCE(pag.observacaopag, 'Conta a pagar')::text AS historico,
      COALESCE(pag.valorabertopag, 0)::numeric AS valor, pag.empresapag::int AS empresa, false AS vencido,
      (COALESCE(cfi.nomecfi, '') ~* '(financi|empr[eé]stim|cons[oó]rc)' OR COALESCE(pag.observacaopag, '') ~* '(financi|empr[eé]stim|cons[oó]rc)') AS financiamento
    ${commonOpenPayable}
    WHERE pag.datavencimentopag::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '12 months')::date
      AND COALESCE(pag.valorabertopag, 0) > 0 AND pag.statuspag IN (1,2)
      AND ($1::int IS NULL OR pag.empresapag = $1::int)
      AND ($2::text IS NULL OR COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, '')) ILIKE '%' || $2 || '%' OR COALESCE(cfi.nomecfi, 'Outros') ILIKE '%' || $2 || '%' OR COALESCE(pag.documentopag::text, pag.duplicatapag::text) ILIKE '%' || $2 || '%' OR COALESCE(pag.observacaopag, '') ILIKE '%' || $2 || '%')
    ORDER BY pag.datavencimentopag
  `, [company, search]);

  const movements = rows.map((row) => ({ ...row, data: iso(row.data), vencimento: iso(row.vencimento), valor: money(row.valor), diasAtraso: row.vencido && row.vencimento ? Math.max(0, Math.floor((Date.now() - new Date(row.vencimento).getTime()) / 86400000)) : 0 }));
  const entradas = money(movements.filter((x) => x.tipo === "entrada").reduce((s, x) => s + x.valor, 0));
  const saidas = money(movements.filter((x) => x.tipo === "saida").reduce((s, x) => s + x.valor, 0));
  const overdueRows = overdueRowsRaw.map((row) => ({ ...row, data: iso(row.data), vencimento: iso(row.vencimento), valor: money(row.valor), diasAtraso: Math.max(0, Math.floor((Date.now() - new Date(row.vencimento).getTime()) / 86400000)) }));
  const vencidoReceber = money(overdueRows.filter((x) => x.tipo === "entrada").reduce((s, x) => s + x.valor, 0));
  const vencidoPagar = money(overdueRows.filter((x) => x.tipo === "saida").reduce((s, x) => s + x.valor, 0));
  const today = iso(new Date());
  const inSeven = new Date(); inSeven.setDate(inSeven.getDate() + 7); const sevenDate = iso(inSeven);
  const proximosSeteDias = money(movements.filter((x) => x.natureza === "previsto" && x.data >= today && x.data <= sevenDate).reduce((s, x) => s + (x.tipo === "entrada" ? x.valor : -x.valor), 0));
  const dayMap = new Map();
  const categoryMap = new Map();
  for (const item of movements) {
    const day = dayMap.get(item.data) || { data: item.data, entradas: 0, saidas: 0 };
    day[item.tipo === "entrada" ? "entradas" : "saidas"] += item.valor;
    dayMap.set(item.data, day);
    const key = `${item.tipo}:${item.categoria}`;
    const cat = categoryMap.get(key) || { tipo: item.tipo, categoria: item.categoria, valor: 0, lancamentos: 0 };
    cat.valor += item.valor; cat.lancamentos += 1; categoryMap.set(key, cat);
  }
  const cursor = new Date(`${range.start}T12:00:00`);
  const rangeEnd = new Date(`${range.end}T12:00:00`);
  while (cursor <= rangeEnd) {
    const key = iso(cursor);
    if (!dayMap.has(key)) dayMap.set(key, { data: key, entradas: 0, saidas: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  let accumulated = 0;
  const evolution = [...dayMap.values()].sort((a, b) => a.data.localeCompare(b.data)).map((day) => {
    day.entradas = money(day.entradas); day.saidas = money(day.saidas); day.saldo = money(day.entradas - day.saidas); accumulated += day.saldo; day.acumulado = money(accumulated); return day;
  });
  const personSummary = (type) => {
    const selected = movements.filter((x) => x.tipo === type);
    const total = selected.reduce((sum, x) => sum + x.valor, 0);
    const grouped = new Map();
    for (const item of selected) grouped.set(item.pessoa, (grouped.get(item.pessoa) || 0) + item.valor);
    const ranking = [...grouped].map(([pessoa, valor]) => ({ pessoa, valor: money(valor), percentual: total ? money(valor / total * 100) : 0 })).sort((a,b) => b.valor - a.valor);
    return { maior: ranking[0] || null, top5Percentual: total ? money(ranking.slice(0,5).reduce((sum,x) => sum + x.valor, 0) / total * 100) : 0, ranking: ranking.slice(0,5) };
  };
  overdueRows.sort((a,b) => (b.diasAtraso - a.diasAtraso) || (b.valor - a.valor));
  const futureExpenses = summarizeFutureExpenses(futureRowsRaw);
  const result = {
    period: range,
    mode,
    summary: { entradas, saidas, saldo: money(entradas - saidas), vencidoReceber, vencidoPagar, vencidoLiquido: money(vencidoReceber - vencidoPagar), proximosSeteDias, menorSaldo: evolution.length ? Math.min(...evolution.map((x) => x.acumulado)) : 0, lancamentos: movements.length },
    evolution,
    categories: [...categoryMap.values()].map((x) => ({ ...x, valor: money(x.valor) })).sort((a, b) => b.valor - a.valor),
    movements: movements.sort((a, b) => b.data.localeCompare(a.data)),
    concentration: { clientes: personSummary("entrada"), fornecedores: personSummary("saida") },
    overdue: { quantidade: overdueRows.length, receberQuantidade: overdueRows.filter((x) => x.tipo === "entrada").length, pagarQuantidade: overdueRows.filter((x) => x.tipo === "saida").length, maior: overdueRows.slice().sort((a,b) => b.valor - a.valor)[0] || null, maisAntigo: overdueRows[0] || null, movements: overdueRows },
    futureExpenses,
    note: "Saldo acumulado representa apenas a movimentação do período; não inclui saldo bancário inicial.",
  };
  if (!filters._skipComparison) {
    const start = new Date(`${range.start}T12:00:00`); const end = new Date(`${range.end}T12:00:00`);
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
    const comparisonMode = mode === "previsto" ? null : "realizado";
    const previous = comparisonMode ? await getFluxoCaixa({ ...filters, mode: comparisonMode, dataInicio: iso(prevStart), dataFim: iso(prevEnd), _skipComparison: true }) : null;
    const currentComparison = comparisonMode === "realizado" && mode !== "realizado" ? await getFluxoCaixa({ ...filters, mode: "realizado", _skipComparison: true }) : result;
    const variation = (current, old) => old ? money((current - old) / Math.abs(old) * 100) : null;
    result.comparison = previous ? { basis: "realizado", period: previous.period, entradas: variation(currentComparison.summary.entradas, previous.summary.entradas), saidas: variation(currentComparison.summary.saidas, previous.summary.saidas), saldo: variation(currentComparison.summary.saldo, previous.summary.saldo) } : { basis: null, entradas: null, saidas: null, saldo: null };
  }
  return result;
}
