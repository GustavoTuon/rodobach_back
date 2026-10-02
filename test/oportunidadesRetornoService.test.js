import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";
import { buildClientAvailabilityMessage, parseClientesWorkbook, normalizeOpportunityPhone, sendSelectedOpportunitiesToN8n, dispatchSelectedOpportunityMessages, importClientesWorkbook } from "../src/services/oportunidadesRetornoService.js";
import {pool} from "../src/db/pool.js";

test("monta mensagem individual perguntando por carga disponível", () => {
  const message = buildClientAvailabilityMessage({
    sm: { placa: "RAA8G18" },
    destino: { descricao: "BOA VISTA/PB" },
    cliente: { nome: "Cliente teste", contato: "Maria", cidade: "CAMPINA GRANDE", uf: "PB" },
  });

  assert.match(message, /Olá, Maria/);
  assert.match(message, /veículo RAA8G18 disponível na região de BOA VISTA\/PB/);
  assert.match(message, /carga disponível para embarque em CAMPINA GRANDE\/PB/);
  assert.match(message, /destino, produto, peso e previsão de carregamento/);
});

test("importa a aba Frete Retorno preservando empresa, pessoa e coordenadas ausentes", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Cargas").addRow(["Viagem", "Motorista"]);
  const sheet = workbook.addWorksheet("Frete Retorno");
  sheet.addRow(["nome", "cliente", "transportadora", "telefone", "estado", "cidade", "produto"]);
  sheet.addRow(["Maria", "Empresa", "", "(48) 99999-1234", "SC", "Joinville", "Ferro"]);
  sheet.addRow(["João", "", "Transportadora", "", "SP", "Guarulhos", ""]);
  sheet.addRow(["Sem cidade", "", "", "", "SP", "", ""]);
  const result = await parseClientesWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64"));
  assert.equal(result.aba, "Frete Retorno");
  assert.equal(result.valid.length, 3);
  assert.equal(result.invalid, 0);
  assert.equal(result.withoutCoordinates, 3);
  assert.equal(result.valid[0].nome, "Empresa");
  assert.equal(result.valid[0].contato, "Maria");
  assert.equal(result.valid[0].latitude, null);
  assert.equal(result.valid[0].tipoCarga, "Ferro");
  assert.equal(result.valid[1].nome, "Transportadora");
});

test("planilha inválida é rejeitada antes de substituir os contatos", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Clientes").addRow(["Nome", "Cidade", "UF"]);
  await assert.rejects(parseClientesWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64")), /Nenhum contato válido/);
});

test("importação não recadastra contatos sem número", async (t) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Clientes");
  sheet.addRow(["Nome", "Telefone", "Cidade", "UF"]);
  sheet.addRow(["Com número", "48999991234", "Joinville", "SC"]);
  sheet.addRow(["Sem número", "", "Joinville", "SC"]);
  const inserts = [];
  t.mock.method(pool, "connect", async () => ({ query: async (sql, values) => { if (sql.includes("INSERT INTO")) inserts.push(values); return { rows: [] }; }, release() {} }));
  const result = await importClientesWorkbook(Buffer.from(await book.xlsx.writeBuffer()).toString("base64"));
  assert.equal(result.novos, 1);
  assert.equal(result.semTelefoneIgnorados, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], "Com número");
});

test("normaliza telefones brasileiros e rejeita valores incompletos", () => {
  assert.equal(normalizeOpportunityPhone("(48) 9 9999-1234"), "5548999991234");
  assert.equal(normalizeOpportunityPhone("+55 48 99999-1234"), "5548999991234");
  assert.equal(normalizeOpportunityPhone("(55) 99999-1234"), "5555999991234");
  assert.equal(normalizeOpportunityPhone(""), "");
  assert.equal(normalizeOpportunityPhone("XXXXXXXX"), "");
  assert.equal(normalizeOpportunityPhone("12345"), "");
});

test("envio em lote respeita o modo de validação", async () => {
  const previous = process.env.N8N_OPORTUNIDADES_RETORNO_ENVIO_HABILITADO;
  process.env.N8N_OPORTUNIDADES_RETORNO_ENVIO_HABILITADO = "false";
  try { await assert.rejects(sendSelectedOpportunitiesToN8n({}), /Envio bloqueado/); }
  finally {
    if (previous === undefined) delete process.env.N8N_OPORTUNIDADES_RETORNO_ENVIO_HABILITADO;
    else process.env.N8N_OPORTUNIDADES_RETORNO_ENVIO_HABILITADO = previous;
  }
});

test("envia individualmente, elimina telefones repetidos e relata falha parcial", async (t) => {
  const deliveries = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    deliveries.push(body);
    return { ok: body.cliente.id !== "falha", status: 502, text: async () => "" };
  });
  const clients = [
    { id: "ok", telefone: "(48) 99999-1234" },
    { id: "duplicado", telefone: "+55 48 99999-1234" },
    { id: "semtelefone", telefone: "" },
    { id: "falha", telefone: "(11) 99999-1234" },
  ];
  const result = await dispatchSelectedOpportunityMessages(clients, { sm: { placa: "ABC1234" }, destino: {}, raioKm: 200 }, "https://example.invalid", "Minha mensagem");
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((item) => item.destinatario), ["5548999991234", "5511999991234"]);
  assert.ok(deliveries.every((item) => item.mensagem === "Minha mensagem" && item.evento === "oportunidade_retorno_cliente"));
  assert.deepEqual(Object.fromEntries(result.resultados.map((item) => [item.id, item.status])), { ok: "enviado", duplicado: "ignorado", semtelefone: "ignorado", falha: "falha" });
});
