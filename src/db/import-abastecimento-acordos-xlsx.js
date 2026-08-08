import "dotenv/config";
import ExcelJS from "exceljs";
import { tableName } from "../config.js";
import { clientPool } from "./clientPool.js";
import { pool } from "./pool.js";

const DEFAULT_FILE = "C:/Users/PC/Downloads/Rodobach.xlsx";

const UF_TO_REGION = {
  RS: "REGIÃO SUL",
  SC: "REGIÃO SUL",
  PR: "REGIÃO SUL",
  SP: "REGIÃO SUDESTE",
  RJ: "REGIÃO SUDESTE",
  MG: "REGIÃO SUDESTE",
  ES: "REGIÃO SUDESTE",
  GO: "REGIÃO CENTRO-OESTE",
  MT: "REGIÃO CENTRO-OESTE",
  MS: "REGIÃO CENTRO-OESTE",
  DF: "REGIÃO CENTRO-OESTE",
  BA: "REGIÃO NORDESTE",
  SE: "REGIÃO NORDESTE",
  AL: "REGIÃO NORDESTE",
  PE: "REGIÃO NORDESTE",
  PB: "REGIÃO NORDESTE",
  RN: "REGIÃO NORDESTE",
  CE: "REGIÃO NORDESTE",
  PI: "REGIÃO NORDESTE",
  MA: "REGIÃO NORDESTE",
  TO: "REGIÃO NORTE",
  PA: "REGIÃO NORTE",
  AP: "REGIÃO NORTE",
  AM: "REGIÃO NORTE",
  RR: "REGIÃO NORTE",
  AC: "REGIÃO NORTE",
  RO: "REGIÃO NORTE",
};

const PRODUCTS = [
  { name: "ARLA", valueColumn: "Valor Arla", dateColumn: "Data Arla" },
  { name: "S-10", valueColumn: "Valor S-10", dateColumn: "Data S-10" },
  { name: "S-500", valueColumn: "Valor S-500", dateColumn: "Data S-500" },
];

function clean(value) {
  return String(value || "").trim();
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  const text = clean(value);
  if (!text || text.includes("#")) return 0;
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  if (!value || clean(value).includes("#")) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return null;
}

function splitUfs(value) {
  return [...new Set(clean(value).toUpperCase().match(/[A-Z]{2}/g) || [])];
}

function normalizeText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

async function upsertAgreement(client, payload) {
  const existing = await client.query(`
    SELECT id
    FROM ${tableName("abastecimento_acordos")}
    WHERE origem_importacao = $1
      AND posto_codigo = $2
      AND COALESCE(grupo_cliente_codigo, 0) = COALESCE($3::int, 0)
      AND COALESCE(produto_nome, '') = COALESCE($4::text, '')
      AND vigencia_inicio = $5::date
    LIMIT 1
  `, [
    payload.origem_importacao,
    payload.posto_codigo,
    payload.grupo_cliente_codigo,
    payload.produto_nome,
    payload.vigencia_inicio,
  ]);

  const values = [
    payload.ativo,
    payload.posto_codigo,
    payload.posto_nome,
    payload.cidade,
    payload.uf,
    payload.grupo_cliente_codigo,
    payload.grupo_cliente,
    payload.produto_nome,
    payload.valor_maximo,
    payload.tolerancia,
    payload.vigencia_inicio,
    payload.contato_nome,
    payload.contato_telefone,
    payload.link_whatsapp,
    payload.observacoes,
    payload.origem_importacao,
  ];

  if (existing.rows[0]?.id) {
    await client.query(`
      UPDATE ${tableName("abastecimento_acordos")}
      SET ativo = $1, posto_codigo = $2, posto_nome = $3, cidade = $4, uf = $5,
          grupo_cliente_codigo = $6, grupo_cliente = $7, produto_nome = $8,
          valor_maximo = $9, tolerancia = $10, vigencia_inicio = $11,
          contato_nome = $12, contato_telefone = $13, link_whatsapp = $14,
          observacoes = $15, origem_importacao = $16, atualizado_em = NOW()
      WHERE id = $17
    `, [...values, existing.rows[0].id]);
    return "updated";
  }

  await client.query(`
    INSERT INTO ${tableName("abastecimento_acordos")} (
      ativo, posto_codigo, posto_nome, cidade, uf, grupo_cliente_codigo, grupo_cliente,
      produto_nome, valor_maximo, tolerancia, vigencia_inicio, contato_nome,
      contato_telefone, link_whatsapp, observacoes, origem_importacao
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
  `, values);
  return "inserted";
}

export async function importAbastecimentoAcordosXlsx(filePath = DEFAULT_FILE) {
  const groupRows = await clientPool.query(`
    SELECT codigogrc AS codigo, nomegrc AS nome
    FROM gerais.gruposclientes
    WHERE COALESCE(ativogrc, 'S') = 'S'
  `);
  const groupsByName = new Map(groupRows.rows.map((row) => [normalizeText(row.nome), row]));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet("Postos");
  if (!worksheet) throw new Error("A aba 'Postos' nao foi encontrada na planilha.");

  const headers = worksheet.getRow(1).values.slice(1).map((value) => String(value || ""));
  const rows = [];
  worksheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const row = {};
    headers.forEach((header, index) => {
      const cell = excelRow.getCell(index + 1);
      row[header] = cell.value instanceof Date ? cell.value : cell.text || null;
    });
    rows.push(row);
  });
  const client = await pool.connect();
  const stats = { inserted: 0, updated: 0, skipped: 0 };

  try {
    await client.query("BEGIN");

    for (const row of rows) {
      const posto = clean(row.Posto);
      if (!posto) continue;
      const ufs = splitUfs(row.UF);
      const regions = [...new Set(ufs.map((uf) => UF_TO_REGION[uf]).filter(Boolean))];
      if (!regions.length) {
        stats.skipped += 1;
        continue;
      }

      for (const region of regions) {
        const group = groupsByName.get(normalizeText(region));
        if (!group) {
          stats.skipped += 1;
          continue;
        }

        for (const product of PRODUCTS) {
          const value = parseMoney(row[product.valueColumn]);
          if (value <= 0) continue;
          const date = parseDate(row[product.dateColumn]) || "2026-07-09";
          const result = await upsertAgreement(client, {
            ativo: true,
            posto_codigo: posto,
            posto_nome: posto,
            cidade: clean(row.Cidade) || null,
            uf: clean(row.UF) || null,
            grupo_cliente_codigo: group.codigo,
            grupo_cliente: group.nome,
            produto_nome: product.name,
            valor_maximo: value,
            tolerancia: 0,
            vigencia_inicio: date,
            contato_nome: clean(row.Nome) || null,
            contato_telefone: clean(row.Contato) || null,
            link_whatsapp: clean(row.Link) || null,
            observacoes: `Importado de Rodobach.xlsx (${product.valueColumn})`,
            origem_importacao: "Rodobach.xlsx",
          });
          stats[result] += 1;
        }
      }
    }

    await client.query("COMMIT");
    return stats;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith("import-abastecimento-acordos-xlsx.js")) {
  importAbastecimentoAcordosXlsx(process.argv[2] || DEFAULT_FILE)
    .then(async (stats) => {
      console.log(JSON.stringify(stats, null, 2));
      await pool.end();
      await clientPool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      await clientPool.end();
      process.exit(1);
    });
}
