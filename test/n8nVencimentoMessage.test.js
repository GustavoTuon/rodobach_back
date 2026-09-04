import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("mensagem de boleto vencido usa dias uteis e identidade Rodobach", async () => {
  const code = await fs.readFile(new URL("../n8n/vencimento-clientes-regra-dias-uteis.js", import.meta.url), "utf8");
  const execute = new Function("$input", code);
  const result = execute({
    first: () => ({
      json: {
        dias_para_vencer: -3,
        data_vencimento: "2026-08-19",
        cliente_contato: "Maria",
        cliente_nome: "Empresa Exemplo Ltda",
        boleto_codigo: 4220,
        boleto_seu_numero: "1-4220/1",
        valor_aberto: 2000,
        boleto_agrupado: true,
        duplicatas_agrupadas: "1-4218/1, 1-4219/1, 1-4220/1",
        serie: "1",
        duplicata: 4220,
        parcela: 1,
      },
    }),
  });
  const item = result[0].json;
  assert.match(item.mensagem_sugerida, /Olá, \*Empresa Exemplo Ltda\*! Tudo bem/);
  assert.match(item.mensagem_sugerida, /😊/);
  assert.match(item.mensagem_sugerida, /boleto nº/);
  assert.match(item.mensagem_sugerida, /📅 \*Vencimento:\*/);
  assert.match(item.mensagem_sugerida, /💰 \*Valor:\*/);
  assert.match(item.mensagem_sugerida, /📄 \*Títulos vinculados:\*/);
  assert.match(item.mensagem_sugerida, /dias úteis/);
  assert.match(item.mensagem_sugerida, /Títulos vinculados/);
  assert.match(item.mensagem_sugerida, /Equipe Financeira \| Rodobach/);
  assert.doesNotMatch(item.mensagem_sugerida, /�|\?\?/);
});

test("fonte do nó n8n é ASCII para não corromper no deploy", async () => {
  const code = await fs.readFile(new URL("../n8n/vencimento-clientes-regra-dias-uteis.js", import.meta.url), "utf8");
  assert.equal(/[^\x00-\x7F]/.test(code), false);
});
