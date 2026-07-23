import { clientPool } from "../db/clientPool.js";

const META_PADRAO = 1000000;
const FILIAIS_PADRAO = ["SC", "SP", "BA"];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function brl(value) {
  return num(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value) {
  return `${num(value).toFixed(2).replace(".", ",")}%`;
}

function dateBR(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "-";
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(base, days) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStartIso(base) {
  return `${String(base).slice(0, 7)}-01`;
}

function normalizeDate(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizeMeta(value) {
  const parsed = num(String(value || "").replace(/\./g, "").replace(",", "."));
  return parsed > 0 ? parsed : META_PADRAO;
}

function monthLabel(value) {
  const [year, month] = String(value || "").slice(0, 7).split("-");
  if (!year || !month) return "-";
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return label.replace(/^./, (char) => char.toUpperCase());
}

const RECEITA_SQL = `
  WITH receita AS (
    SELECT
      rec.empresarec,
      rec.veiculorec,
      vlr.centrocusto,
      vlr.valorliquido
    FROM financeiro.receber rec
    INNER JOIN financeiro.valorliquidorateiosreceber vlr
      ON rec.empresarec = vlr.empresa
     AND rec.serierec = vlr.serie
     AND rec.duplicatarec = vlr.duplicata
     AND rec.parcelarec = vlr.parcela
    WHERE rec.statusrec IN (1,2)
      AND rec.dataemissaorec::date BETWEEN $1::date AND $2::date
  ),
  base AS (
    SELECT
      COALESCE(NULLIF(TRIM(vei_doc.ufplacavei::text), ''), NULLIF(TRIM(vei_cc.ufplacavei::text), ''), 'SC') AS filial,
      CASE
        WHEN COALESCE(vei_doc.tipopropriedadevei, vei_cc.tipopropriedadevei)::text = 'P' THEN 'FROTA'
        WHEN NULLIF(TRIM(COALESCE(r.veiculorec, vei_cc.placavei)::text), '') IS NOT NULL THEN 'TERCEIRO'
        ELSE 'TERCEIRO'
      END AS tipo,
      r.valorliquido
    FROM receita r
    LEFT JOIN LATERAL (
      SELECT v.placavei, v.tipopropriedadevei, v.ufplacavei
      FROM frotas.veiculos v
      WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(r.veiculorec::text))
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY (v.empresavei = r.empresarec) DESC, v.empresavei
      LIMIT 1
    ) vei_doc ON true
    LEFT JOIN LATERAL (
      SELECT v.placavei, v.tipopropriedadevei, v.ufplacavei
      FROM frotas.veiculos v
      WHERE v.centrocustovei = r.centrocusto
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY (v.empresavei = r.empresarec) DESC, v.empresavei
      LIMIT 1
    ) vei_cc ON true
  )
  SELECT
    filial,
    tipo,
    COALESCE(SUM(valorliquido), 0)::numeric AS valor
  FROM base
  GROUP BY filial, tipo
  ORDER BY filial, tipo
`;

function buildFiliais(rows) {
  const map = new Map();
  for (const row of rows) {
    const filial = String(row.filial || "SC").trim().toUpperCase() || "SC";
    const tipo = String(row.tipo || "TERCEIRO").trim().toUpperCase();
    const current = map.get(filial) || { filial, frota: 0, terceiro: 0, total: 0 };
    if (tipo === "FROTA") current.frota += num(row.valor);
    else current.terceiro += num(row.valor);
    current.total += num(row.valor);
    map.set(filial, current);
  }

  const preferred = FILIAIS_PADRAO.map((filial) => map.get(filial)).filter(Boolean);
  const extra = [...map.values()]
    .filter((row) => !FILIAIS_PADRAO.includes(row.filial))
    .sort((a, b) => a.filial.localeCompare(b.filial));
  return [...preferred, ...extra].map((row) => ({
    filial: row.filial,
    frota: r2(row.frota),
    terceiro: r2(row.terceiro),
    total: r2(row.total),
  }));
}

function buildMessage({ dataReferencia, mesInicio, meta, dia, mes }) {
  const lines = [
    "FATURAMENTO DIARIO",
    `Faturamento do dia anterior: ${dateBR(dataReferencia)}`,
    "",
  ];

  for (const filial of dia.filiais) {
    lines.push(`Filial ${filial.filial}:`);
    if (filial.frota > 0) lines.push(`- FROTA: ${brl(filial.frota)}`);
    if (filial.terceiro > 0) lines.push(`- TERCEIRO: ${brl(filial.terceiro)}`);
    lines.push(`Total: ${brl(filial.total)}`, "");
  }

  lines.push(
    "RESUMO POR TIPO:",
    `- FROTA: ${brl(dia.frota)}`,
    `- TERCEIRO: ${brl(dia.terceiro)}`,
    "",
    `TOTAL DO DIA: ${brl(dia.total)}`,
    "",
    `DADOS DE ${monthLabel(mesInicio).toUpperCase()}:`,
    `- Frota: ${brl(mes.frota)}`,
    `- Terceiro: ${brl(mes.terceiro)}`,
    `- Total Mes: ${brl(mes.total)}`,
    `- Meta: ${brl(meta)}`,
    `- % Meta Atingida: ${pct(meta > 0 ? (mes.total / meta) * 100 : 0)}`,
    "",
    `Contribuicao do dia para meta de ${monthLabel(mesInicio).split(" ")[0]}: ${pct(meta > 0 ? (dia.total / meta) * 100 : 0)}`
  );

  return lines.join("\n");
}

async function loadResumo(startDate, endDate) {
  const { rows } = await clientPool.query(RECEITA_SQL, [startDate, endDate]);
  const filiais = buildFiliais(rows);
  const frota = r2(filiais.reduce((sum, row) => sum + row.frota, 0));
  const terceiro = r2(filiais.reduce((sum, row) => sum + row.terceiro, 0));
  return {
    filiais,
    frota,
    terceiro,
    total: r2(frota + terceiro),
  };
}

export async function getFaturamentoDiarioMensagem(filters = {}) {
  const today = todayIso();
  const dataReferencia = normalizeDate(filters.data || filters.date || filters.dataReferencia) || addDaysIso(today, -1);
  const mesInicio = normalizeDate(filters.mesInicio || filters.monthStart) || monthStartIso(dataReferencia);
  const meta = normalizeMeta(filters.meta);

  const [dia, mes] = await Promise.all([
    loadResumo(dataReferencia, dataReferencia),
    loadResumo(mesInicio, dataReferencia),
  ]);

  return {
    dataReferencia,
    mesInicio,
    meta,
    dia,
    mes,
    mensagem: buildMessage({ dataReferencia, mesInicio, meta, dia, mes }),
    audit: {
      fonte: "financeiro.receber + financeiro.valorliquidorateiosreceber",
      regraFilial: "UF do veiculo vinculado ao documento ou ao centro de custo; sem UF cai como SC.",
      regraTipo: "Veiculo P=FROTA; demais veiculos/sem propriedade=TERCEIRO.",
    },
  };
}
