import ExcelJS from "exceljs";

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
export const contactKeyPart = (value) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const headerKey = (value) => contactKeyPart(value).replace(/[^A-Z0-9]/g, "");
const states = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const coordinate = (value) => clean(value) && Number.isFinite(Number(clean(value).replace(",", "."))) ? Number(clean(value).replace(",", ".")) : null;

export function mergeContactValues(...values) {
  const result = new Map();
  for (const value of values.flatMap((item) => clean(item).split(" | "))) {
    if (clean(value) && !result.has(contactKeyPart(value))) result.set(contactKeyPart(value), clean(value));
  }
  return [...result.values()].join(" | ");
}

export function importedContactKey(row) {
  let phone = clean(row.telefone).replace(/\D/g, "");
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  // Keep different people, companies and loading locations separate, even with a shared phone.
  return JSON.stringify([row.nome, row.contato, row.cidade, row.uf, row.endereco].map(contactKeyPart).concat(phone || contactKeyPart(row.telefone)));
}

export async function parseClientesWorkbook(base64) {
  const buffer = Buffer.from(String(base64 || "").replace(/^data:.*?;base64,/, ""), "base64");
  if (!buffer.length) throw new Error("Arquivo de importacao vazio.");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("A planilha excede o limite de 5 MB.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const contacts = new Map();
  const sheets = [];
  const issues = [];
  let invalid = 0;
  let duplicates = 0;
  let total = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 10000) throw new Error("A planilha excede o limite de 10.000 linhas por aba.");
    let headerRow;
    let headers;
    for (let n = 1; n <= Math.min(sheet.rowCount, 10); n++) {
      const candidate = Array.from({ length: sheet.columnCount }, (_, i) => headerKey(sheet.getRow(n).getCell(i + 1).text));
      if (candidate.some((h) => ["CIDADE", "CIDADECOLETA", "MUNICIPIO"].includes(h)) && candidate.some((h) => ["NOME", "CLIENTE", "AGENCIADOR", "EMPRESA", "RAZAOSOCIAL"].includes(h))) {
        headerRow = n; headers = candidate; break;
      }
    }
    if (!headerRow) { sheets.push({ aba: sheet.name, reconhecida: false, lidas: 0, validas: 0 }); continue; }
    const stats = { aba: sheet.name, reconhecida: true, lidas: 0, validas: 0 };
    const trip = headers.includes("CIDADECOLETA");
    const complement = headerKey(sheet.name).startsWith("COMPLEMENTOS") && headers.includes("TERCEIRO");
    sheet.eachRow((row, n) => {
      if (n <= headerRow) return;
      const read = (...aliases) => {
        for (const alias of aliases) {
          const index = headers.indexOf(alias);
          if (index >= 0 && clean(row.getCell(index + 1).text)) return clean(row.getCell(index + 1).text);
        }
        return "";
      };
      // Both Cidade/UF pairs must retain their original positions: the first is loading.
      const destinationCityIndex = trip ? headers.indexOf("CIDADEENTREGA") : headers.indexOf("CIDADE", headers.indexOf("CIDADE") + 1);
      const destinationUfIndex = trip ? headers.findIndex((h, i) => i > destinationCityIndex && ["UF", "UF2"].includes(h)) : headers.indexOf("UF", headers.indexOf("UF") + 1);
      const destination = destinationCityIndex >= 0 ? [row.getCell(destinationCityIndex + 1).text, destinationUfIndex >= 0 ? row.getCell(destinationUfIndex + 1).text : ""].map(clean).filter(Boolean).join("/") : "";
      const rawContact = trip ? read("AGENCIADOR") : complement ? read("TERCEIRO") : read("NOMECONTATO", "CONTATO", "RESPONSAVEL", "NOME");
      const contact = /^\d+$/.test(rawContact) ? "" : rawContact;
      const phone = trip ? read("CONTATO", "TELEFONE") : read("TELEFONE", "CELULAR", "WHATSAPP");
      const name = trip ? contact : complement ? (contact || read("CLIENTE")) : read("CLIENTE", "EMPRESA", "RAZAOSOCIAL", "TRANSPORTADORA", "NOME");
      const city = read("CIDADECOLETA", "CIDADE", "MUNICIPIO");
      const uf = read("UF", "ESTADO").toUpperCase();
      const material = complement ? clean(row.getCell(9).text) : read("MATERIAL", "TIPOCARGA", "TIPODECARGA", "CARGA", "PRODUTO", "SEGMENTO");
      if (![name, phone, city, material].some(Boolean)) return;
      stats.lidas++; total++;
      // Exclude footer calculations, which have names but no location or actual phone.
      if ((!name && phone.replace(/\D/g, "").length < 10) || (!city && !states.has(uf) && phone.replace(/\D/g, "").length < 10)) {
        invalid++; issues.push({ aba: sheet.name, linha: n, motivo: "Sem identificação de contato/localização; linha não cadastrada", cidade: city, uf, material, nomeOriginal: name, telefone: phone, destino: destination }); return;
      }
      const observation = mergeContactValues(read("OBSERVACAO", "OBSERVACOES", "OBS", "FRETERETORNO"), destination ? `Entrega registrada: ${destination}` : "", complement ? `Cliente da carga: ${read("CLIENTE")}; telefone informado na coluna do terceiro` : "", !states.has(uf) && uf ? `UF original: ${uf}` : "");
      const item = {
        nome: name || "Contato sem nome", contato: contact || name,
        telefone: phone, cidade: city, uf: states.has(uf) ? uf : "", endereco: read("ENDERECO", "LOGRADOURO", "LOCALIZACAO"),
        latitude: coordinate(read("LATITUDE", "LAT")), longitude: coordinate(read("LONGITUDE", "LNG", "LON")),
        tipoCarga: material, observacao: observation,
      };
      if (!item.cidade || !item.uf || !item.telefone) issues.push({ aba: sheet.name, linha: n, motivo: "Cadastrado com dados incompletos", nome: item.nome, cidade: item.cidade, uf: item.uf, semTelefone: !item.telefone });
      const key = importedContactKey(item);
      const existing = contacts.get(key);
      if (existing) {
        existing.tipoCarga = mergeContactValues(existing.tipoCarga, item.tipoCarga);
        existing.observacao = mergeContactValues(existing.observacao, item.observacao);
        existing.origens.push({ aba: sheet.name, linha: n });
        duplicates++;
      } else contacts.set(key, { ...item, origens: [{ aba: sheet.name, linha: n }] });
      stats.validas++;
    });
    sheets.push(stats);
  }
  const valid = [...contacts.values()];
  if (!valid.length) throw new Error("Nenhum contato válido. Confira as colunas de nome, telefone, cidade e UF.");
  return { valid, invalid, duplicates, total, withoutCoordinates: valid.filter((row) => row.latitude === null || row.longitude === null).length,
    aba: sheets.filter((s) => s.reconhecida).map((s) => s.aba).join(", "), abas: sheets, pendencias: issues };
}
