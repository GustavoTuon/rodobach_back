import { load } from "cheerio";
import { createHash } from "node:crypto";

export const ANTT_INDEXES = [
  "https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirResenhaAnoAto&cod_menu=7817&cod_modulo=161",
  "https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirResenhaAnoData&cod_menu=7804&cod_modulo=161",
];
export const ANTT_BASE =
  "https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RES&numeroAto=00005867&seqAto=000&valorAno=2020&orgao=DG/ANTT/MI&cod_menu=5408&cod_modulo=161";
const clean = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const months = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
function dateBR(day, month, year) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!Number(month) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new Error("Data oficial inválida.");
  return value;
}
function titleDate(text) {
  const m = clean(text).match(/de (\d{1,2}) de ([a-z]+) de (\d{4})/);
  if (!m) throw new Error("Data do ato não reconhecida.");
  return dateBR(m[1], months.indexOf(m[2]) + 1, m[3]);
}
export function officialUrl(raw, base = ANTT_BASE) {
  const u = new URL(raw, base);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "anttlegis.antt.gov.br" ||
    u.port ||
    u.username ||
    u.password ||
    !u.pathname.startsWith("/action/")
  )
    throw new Error("Fonte fora do portal oficial permitido.");
  if (u.searchParams.get("acao") === "abrirTextoAto") {
    u.searchParams.delete("link");
    u.searchParams.set("cod_menu", "9230");
    u.searchParams.set("cod_modulo", "623");
  }
  return u.href;
}
export async function fetchOfficial(url) {
  let current = officialUrl(url);
  for (let i = 0; i < 4; i++) {
    const response = await fetch(current, {
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
      headers: {
        "User-Agent": "Rodobach-ANTT-Monitor/1.0",
        Accept: "text/html",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = officialUrl(response.headers.get("location"), current);
      continue;
    }
    if (!response.ok)
      throw new Error(`Portal ANTT indisponível (HTTP ${response.status}).`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 5_000_000)
        throw new Error("Publicação excede o tamanho permitido.");
      chunks.push(chunk);
    }
    return new TextDecoder(
      /charset=iso-8859-1/i.test(response.headers.get("content-type") || "")
        ? "windows-1252"
        : "utf-8",
    ).decode(Buffer.concat(chunks));
  }
  throw new Error("Redirecionamentos excessivos no portal ANTT.");
}
export function discoverActs(html, base, consolidated = false) {
  const $ = load(html);
  const acts = [];
  $("a").each((_i, a) => {
    const text = $(a).text();
    const normalized = clean(text);
    if (!/portaria|resolucao/.test(normalized)) return;
    if (
      !consolidated &&
      !(
        /pisos minimos/.test(normalized) &&
        /coeficient|anexo ii/.test(normalized)
      )
    )
      return;
    if (!consolidated && /parametros de calculo/.test(normalized)) return;
    let href = $(a).attr("href") || "";
    const js = href.match(
      /^javascript:LinkTexto\('([^']+)','([^']+)','([^']+)','([^']+)','([^']+)'/,
    );
    if (js)
      href =
        "/action/ActionDatalegis.php?" +
        new URLSearchParams({
          acao: "abrirTextoAto",
          tipo: js[1],
          numeroAto: js[2],
          seqAto: js[3],
          valorAno: js[4],
          orgao: js[5],
          cod_menu: "9230",
          cod_modulo: "623",
        });
    try {
      const url = officialUrl(href, base);
      if (new URL(url).searchParams.get("acao") !== "abrirTextoAto") return;
      acts.push({ url, date: titleDate(text) });
    } catch {
      /* links unrelated to a published act */
    }
  });
  return acts;
}
export function parseAnttAct(html, source) {
  officialUrl(source);
  const $ = load(html);
  const title = $("title").text().trim();
  const actDate = titleDate(title);
  const content = $(".ato").first().length ? $(".ato").first() : $("body");
  const text = clean(content.text());
  if (!/coeficientes.*pisos minimos/.test(text) || !/anexo ii/.test(text))
    throw new Error("Ato não identificado como atualização dos coeficientes.");
  const publication = [
    ...text.matchAll(/d\.?o\.?u\.?,?\s*(\d{2})\/(\d{2})\/(\d{4})/g),
  ];
  const dates = [...new Set(publication.map((m) => dateBR(m[1], m[2], m[3])))];
  if (dates.length !== 1)
    throw new Error(
      "Data de publicação ausente ou ambígua. Revisão necessária.",
    );
  const published = dates[0];
  let effective;
  if (/entra em vigor no dia seguinte ao de sua publica/.test(text))
    effective = new Date(Date.parse(published + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  else if (/entra em vigor na data de sua publica/.test(text))
    effective = published;
  else {
    const m = text.match(
      /entra em vigor (?:no dia |em )(\d{1,2}) de ([a-z]+) de (\d{4})/,
    );
    if (m) effective = dateBR(m[1], months.indexOf(m[2]) + 1, m[3]);
  }
  if (!effective || effective < published || published < actDate)
    throw new Error("Vigência não reconhecida com segurança.");
  const tables = {};
  let section = null;
  content.find("p, table").each((_i, el) => {
    if ($(el).parents("table").length) return;
    if (el.tagName === "p") {
      const m = clean($(el).text()).match(/^tabela ([abcd])\s*-/);
      if (m) section = m[1];
      return;
    }
    if (!section) return;
    tables[section] ||= [];
    $(el)
      .find("tr")
      .each((_j, tr) =>
        tables[section].push(
          $(tr)
            .children("td,th")
            .toArray()
            .map((td) => $(td).text().replace(/\s+/g, " ").trim()),
        ),
      );
  });
  const rows = [];
  for (const [letter, mode] of [
    ["a", "normal"],
    ["c", "alto_desempenho"],
  ]) {
    const table = tables[letter];
    if (!table) throw new Error(`Tabela ${letter.toUpperCase()} ausente.`);
    const axes = [2, 3, 4, 5, 6, 7, 9];
    if (!table.some((r) => r.slice(-7).join(",") === axes.join(",")))
      throw new Error("Cabeçalho de eixos não reconhecido.");
    const matches = table
      .map((r, i) =>
        r.some((c) => clean(c) === "carga geral") &&
        r.some((c) => clean(c) === "deslocamento (ccd)")
          ? i
          : -1,
      )
      .filter((i) => i >= 0);
    if (matches.length !== 1)
      throw new Error("Carga geral ausente ou duplicada.");
    const index = matches[0];
    const cc = table[index + 1];
    if (
      !cc?.some((c) => clean(c) === "carga e descarga (cc)") ||
      !table[index].includes("R$/km") ||
      !cc.includes("R$")
    )
      throw new Error("Unidades ou carga/descarga não reconhecidas.");
    const parse = (r, decimals) =>
      r.slice(-7).map((v) => {
        if (!new RegExp(`^\\d+(?:\\.\\d{3})*,\\d{${decimals}}$`).test(v))
          throw new Error("Coeficiente ausente ou inválido.");
        const n = Number(v.replace(/\./g, "").replace(",", "."));
        if (n <= 0 || n > 100000)
          throw new Error("Coeficiente fora dos limites.");
        return n;
      });
    const km = parse(table[index], 4),
      charges = parse(cc, 2);
    for (const eixos of [3, 4, 5, 6, 7]) {
      const i = axes.indexOf(eixos);
      rows.push({
        eixos,
        tipoCarga: mode,
        kmValor: km[i],
        cargaDescarga: charges[i],
      });
    }
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ effective, rows }))
    .digest("hex");
  return {
    title,
    actDate,
    published,
    effective,
    source,
    hash,
    rows,
    htmlHash: createHash("sha256").update(html).digest("hex"),
  };
}
export function validateChange(candidate, current) {
  for (const row of candidate.rows) {
    const old = current.find(
      (r) => Number(r.eixos) === row.eixos && r.tipo_carga === row.tipoCarga,
    );
    if (!old)
      throw new Error(
        "Configuração sem referência anterior. Revisão necessária.",
      );
    for (const [field, key] of [
      ["kmValor", "km_valor"],
      ["cargaDescarga", "carga_descarga"],
    ]) {
      const previous = Number(old[key]);
      if (!previous || Math.abs(row[field] / previous - 1) > 0.2)
        throw new Error("Variação superior a 20%. Revisão necessária.");
    }
    const oldDate = String(old.data_vigencia).slice(0, 10);
    if (candidate.effective < oldDate)
      throw new Error("Publicação anterior à tabela cadastrada.");
    if (
      candidate.effective === oldDate &&
      (row.kmValor !== Number(old.km_valor) ||
        row.cargaDescarga !== Number(old.carga_descarga))
    )
      throw new Error(
        "Coeficientes alterados na mesma vigência. Revisão necessária.",
      );
  }
}
