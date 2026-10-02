import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {parseClientesWorkbook, importedContactKey} from "../src/services/retornoWorkbook.js";

test("lê todas as abas, conserva coleta/entrega e consolida materiais sem duplicar cópias", async () => {
  const book = new ExcelJS.Workbook();
  const rows = [
    ["Ana", "(48) 99999-1234", "Joinville", "SC", "Santos", "SP", "Ferro"],
    ["ANA", "+55 48 99999-1234", "JOINVILLE", "SC", "Curitiba", "PR", "Máquinas"],
    ["Ana", "(48) 99999-1234", "Blumenau", "SC", "Santos", "SP", "Ferro"],
    ["Ana", "(48) 99999-5678", "Joinville", "SC", "Santos", "SP", "Ferro"],
  ];
  for (const name of ["Cargas", "Cópia de Cargas"]) {
    const sheet = book.addWorksheet(name);
    sheet.addRow([]);
    sheet.addRow(["agenciador", "Contato", "cidade coleta", "UF", "cidade entrega", "UF", "material"]);
    sheet.addRows(rows);
  }
  const result = await parseClientesWorkbook(Buffer.from(await book.xlsx.writeBuffer()).toString("base64"));
  assert.equal(result.abas.length, 2);
  assert.equal(result.valid.length, 3);
  assert.equal(result.duplicates, 5);
  assert.equal(result.valid[0].uf, "SC");
  assert.equal(result.valid[0].tipoCarga, "Ferro | Máquinas");
  assert.match(result.valid[0].observacao, /Santos\/SP/);
  assert.match(result.valid[0].observacao, /Curitiba\/PR/);
  assert.equal(importedContactKey(result.valid[0]), importedContactKey({...result.valid[0], telefone: "5548999991234", nome: "ANA"}));
  assert.notEqual(importedContactKey(result.valid[0]), importedContactKey({...result.valid[0], nome: "Outro cliente"}));
});

test("complementos preservam o telefone do terceiro e o material na coluna sem título", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Complementos  Viagens fechadas");
  sheet.addRow(["Data", "Cliente", "Cidade", "UF", "Cidade", "UF", "KM", "", "", "Peso Mercadoria", "Valor cobrado", "Pago Terceiro", "Terceiro", "Telefone"]);
  sheet.addRow(["", "Cliente", "Colombo", "PR", "Serra", "ES", "", "", "Empilhadeira", "", "", "", "Transportador", "48999991234"]);
  const {valid} = await parseClientesWorkbook(Buffer.from(await book.xlsx.writeBuffer()).toString("base64"));
  assert.equal(valid[0].nome, "Transportador");
  assert.equal(valid[0].cidade, "Colombo");
  assert.equal(valid[0].uf, "PR");
  assert.equal(valid[0].tipoCarga, "Empilhadeira");
  assert.match(valid[0].observacao, /Cliente da carga: Cliente/);
});
