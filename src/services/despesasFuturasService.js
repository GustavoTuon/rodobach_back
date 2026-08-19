import { clientPool } from "../db/clientPool.js";

const num = (value) => Number(value) || 0;
const money = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;
const iso = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
const plain = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function addDays(value, days) {
  const date = new Date(`${iso(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

function monthKey(date) {
  return iso(date)?.slice(0, 7) || "";
}

function monthLabel(key) {
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const [year, month] = String(key).split("-");
  return `${names[Number(month) - 1]}/${year}`;
}

function monthKeys(startDate, months) {
  const start = new Date(`${iso(startDate)}T12:00:00Z`);
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1, 12));
    return iso(date).slice(0, 7);
  });
}

function periodEnd(startDate, months) {
  const start = new Date(`${iso(startDate)}T12:00:00Z`);
  return iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 0, 12)));
}

function expenseGroup(row) {
  const text = plain(`${row.categoria} ${row.historico}`);
  if (/(financi|emprestim|consorci)/.test(text)) return "financeiro";
  if (/(imposto|tribut|pis|cofins|csll|icms|iss|inss|fgts|irpj|contribui|simples nacional)/.test(text)) return "impostos";
  if (/(outros|diversas|diversos|nao informado)/.test(text)) return "outros";
  return "operacional";
}

function aggregate(rows, field, limit = 8) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row[field] || "Não informado";
    const current = grouped.get(key) || { nome: key, valor: 0, quantidade: 0 };
    current.valor += row.valor;
    current.quantidade += 1;
    grouped.set(key, current);
  }
  const total = rows.reduce((sum, row) => sum + row.valor, 0);
  return [...grouped.values()]
    .map((item) => ({ ...item, valor: money(item.valor), percentual: total ? money(item.valor / total * 100) : 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit);
}

export function summarizeDespesasFuturas(rawRows = [], options = {}) {
  const today = iso(options.today || new Date());
  const months = [3, 6, 12].includes(Number(options.months)) ? Number(options.months) : 12;
  const keys = monthKeys(today, months);
  const endDate = periodEnd(today, months);
  const rows = rawRows.map((row) => ({
    ...row,
    data: iso(row.data || row.vencimento),
    vencimento: iso(row.vencimento || row.data),
    valor: money(row.valor),
    grupo: row.grupo || expenseGroup(row),
  })).filter((row) => row.vencimento >= today && row.vencimento <= endDate && keys.includes(monthKey(row.vencimento)));
  const total = money(rows.reduce((sum, row) => sum + row.valor, 0));
  const next30End = addDays(today, 29);
  const next7End = addDays(today, 6);
  const proximos30Rows = rows.filter((row) => row.vencimento <= next30End);
  const proximos7Rows = rows.filter((row) => row.vencimento <= next7End);
  const financialRows = rows.filter((row) => row.grupo === "financeiro");
  const monthly = keys.map((mes) => {
    const selected = rows.filter((row) => monthKey(row.vencimento) === mes);
    const composicao = { financeiro: 0, operacional: 0, impostos: 0, outros: 0 };
    for (const row of selected) composicao[row.grupo] += row.valor;
    Object.keys(composicao).forEach((key) => { composicao[key] = money(composicao[key]); });
    return { mes, total: money(selected.reduce((sum, row) => sum + row.valor, 0)), quantidade: selected.length, composicao };
  });
  const average = money(total / months);
  const pressure = (value) => {
    const ratio = average ? value / average : 0;
    if (ratio > 1.5) return { id: "critico", label: "Crítico", ratio: money(ratio * 100) };
    if (ratio > 1.25) return { id: "alto", label: "Alto", ratio: money(ratio * 100) };
    if (ratio > 1) return { id: "atencao", label: "Atenção", ratio: money(ratio * 100) };
    return { id: "normal", label: "Normal", ratio: money(ratio * 100) };
  };
  monthly.forEach((item) => { item.pressao = pressure(item.total); });
  const peak = monthly.slice().sort((a, b) => b.total - a.total)[0] || null;
  const categories = aggregate(rows, "categoria");
  const suppliers = aggregate(rows, "pessoa");
  const creditors = aggregate(financialRows, "pessoa", 6);
  const financialTotal = money(financialRows.reduce((sum, row) => sum + row.valor, 0));
  const attention = [];
  if (peak?.total) attention.push({ tipo: peak.pressao.id, titulo: `${monthLabel(peak.mes)} é o mês de maior pressão`, detalhe: `${money(peak.pressao.ratio - 100)}% ${peak.pressao.ratio >= 100 ? "acima" : "abaixo"} da média mensal`, valor: peak.total, filtro: { mes: peak.mes } });
  if (total && financialTotal / total >= 0.5) attention.push({ tipo: financialTotal / total > 0.7 ? "alto" : "atencao", titulo: "Alta concentração em dívidas financeiras", detalhe: `${money(financialTotal / total * 100)}% dos compromissos`, valor: financialTotal, filtro: { grupo: "financeiro" } });
  if (suppliers[0] && suppliers[0].percentual >= 25) attention.push({ tipo: suppliers[0].percentual >= 40 ? "alto" : "atencao", titulo: `Concentração em ${suppliers[0].nome}`, detalhe: `${suppliers[0].percentual}% de todos os compromissos`, valor: suppliers[0].valor, filtro: { pessoa: suppliers[0].nome } });
  const next7Total = money(proximos7Rows.reduce((sum, row) => sum + row.valor, 0));
  if (next7Total > 0) attention.push({ tipo: total && next7Total / total > 0.1 ? "alto" : "normal", titulo: "Vencimentos nos próximos 7 dias", detalhe: `${proximos7Rows.length} títulos exigem acompanhamento`, valor: next7Total, filtro: { dias: 7 } });

  return {
    periodo: { meses: months, inicio: today, fim: endDate },
    resumo: {
      total,
      quantidade: rows.length,
      proximos30: money(proximos30Rows.reduce((sum, row) => sum + row.valor, 0)),
      proximos30Quantidade: proximos30Rows.length,
      proximos30Percentual: total ? money(proximos30Rows.reduce((sum, row) => sum + row.valor, 0) / total * 100) : 0,
      proximos7: next7Total,
      proximos7Quantidade: proximos7Rows.length,
      financeiro: financialTotal,
      financeiroQuantidade: financialRows.length,
      financeiroPercentual: total ? money(financialTotal / total * 100) : 0,
      mediaMensal: average,
      pico: peak,
    },
    mensal: monthly,
    categorias: categories,
    fornecedores: suppliers,
    financiamentos: {
      total: financialTotal,
      quantidade: financialRows.length,
      percentual: total ? money(financialTotal / total * 100) : 0,
      maiorParcela: financialRows.slice().sort((a, b) => b.valor - a.valor)[0] || null,
      proximo: financialRows.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0] || null,
      credores: creditors,
      proximos: financialRows.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 20),
    },
    pontosAtencao: attention,
    titulos: rows.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor),
  };
}

export async function getDespesasFuturas(filters = {}) {
  const months = [3, 6, 12].includes(Number(filters.months || filters.meses)) ? Number(filters.months || filters.meses) : 12;
  const company = Number(filters.empresa) || null;
  const search = String(filters.search || "").trim() || null;
  const today = iso(new Date());
  const endDate = periodEnd(today, months);
  const { rows } = await clientPool.query(`
    SELECT ('pag-prev:' || pag.empresapag || ':' || pag.seriepag || ':' || pag.duplicatapag || ':' || pag.parcelapag || ':' || pag.fornecedorpag)::text AS id,
      pag.datavencimentopag::date AS vencimento,
      COALESCE(cfi.nomecfi, 'Outros')::text AS categoria,
      COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Fornecedor não informado')::text AS pessoa,
      COALESCE(pag.documentopag::text, pag.duplicatapag::text)::text AS documento,
      COALESCE(pag.observacaopag, 'Conta a pagar')::text AS historico,
      COALESCE(pag.valorabertopag, 0)::numeric AS valor,
      pag.empresapag::int AS empresa,
      'financeiro.pagar'::text AS origem
    FROM financeiro.pagar pag
    LEFT JOIN LATERAL (SELECT f.nomefor, f.fantasiafor FROM gerais.fornecedores f WHERE f.codigofor = pag.fornecedorpag ORDER BY (f.empresafor = pag.empresapag) DESC LIMIT 1) forn ON true
    LEFT JOIN LATERAL (SELECT cf.nomecfi FROM unnest(pag.contasfinanceiraspag) conta(codigo) LEFT JOIN financeiro.contasfinanceiras cf ON cf.codigocfi = conta.codigo ORDER BY (cf.empresacfi = pag.empresapag) DESC LIMIT 1) cfi ON true
    WHERE pag.datavencimentopag::date BETWEEN $1::date AND $2::date
      AND COALESCE(pag.valorabertopag, 0) > 0 AND pag.statuspag IN (1,2)
      AND ($3::int IS NULL OR pag.empresapag = $3::int)
      AND ($4::text IS NULL OR COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, '')) ILIKE '%' || $4 || '%' OR COALESCE(cfi.nomecfi, 'Outros') ILIKE '%' || $4 || '%' OR COALESCE(pag.documentopag::text, pag.duplicatapag::text) ILIKE '%' || $4 || '%' OR COALESCE(pag.observacaopag, '') ILIKE '%' || $4 || '%')
    ORDER BY pag.datavencimentopag, valor DESC
  `, [today, endDate, company, search]);
  return summarizeDespesasFuturas(rows, { today, months });
}
