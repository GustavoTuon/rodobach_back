const item = $input.first().json;
const diasCorridos = Number(item.dias_para_vencer);
const hojeTexto = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const hoje = new Date(`${hojeTexto}T12:00:00Z`);
const vencimentoTexto = String(item.data_vencimento).slice(0, 10);
const vencimento = new Date(`${vencimentoTexto}T12:00:00Z`);
const hojeEhUtil = ![0, 6].includes(hoje.getUTCDay());

function contarDiasUteisInclusivos(inicio, fim) {
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) return 0;
  const cursor = new Date(inicio);
  let total = 0;
  while (cursor <= fim) {
    if (![0, 6].includes(cursor.getUTCDay())) total += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

const diasUteisRegra = contarDiasUteisInclusivos(vencimento, hoje);
const vencidoLiberado = diasCorridos < 0 && hojeEhUtil && diasUteisRegra >= 3;
if (diasCorridos < 0 && !vencidoLiberado) {
  item.deve_enviar = false;
  item.tipo_envio = null;
  item.motivo_decisao = !hojeEhUtil
    ? "fim_de_semana_nao_enviar"
    : "aguardando_terceiro_dia_util_desde_vencimento";
}
item.dias_uteis_regra = diasUteisRegra;

const empresa = item.cliente_nome || item.cliente_razao || "cliente";
const temBoleto = Boolean(item.boleto_codigo || item.nosso_numero);
const numeroDocumento = item.boleto_seu_numero || item.nosso_numero;
const titulo = [item.serie, item.duplicata].filter(Boolean).join("-") + (item.parcela ? `/${item.parcela}` : "");
// Keep the workflow source ASCII-only. Some n8n import/deploy paths can decode
// literal UTF-8 as Windows-1252, while escapes are interpreted safely by JS.
const identificador = temBoleto ? `boleto n\u00ba *${numeroDocumento || titulo}*` : `t\u00edtulo *${titulo}*`;
const valor = Number(item.valor_aberto || 0).toLocaleString("pt-BR", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const data = vencimento.toLocaleDateString("pt-BR", { timeZone: "UTC" });
const situacao = diasCorridos === 0
  ? "hoje"
  : diasCorridos === 1
    ? "amanh\u00e3"
    : diasCorridos > 1
      ? `em ${diasCorridos} dias`
      : diasUteisRegra === 1 ? "vencido h\u00e1 1 dia \u00fatil" : `vencido h\u00e1 ${diasUteisRegra} dias \u00fateis`;
const titulos = item.boleto_agrupado && item.duplicatas_agrupadas
  ? `\n\u{1F4C4} *T\u00edtulos vinculados:* ${item.duplicatas_agrupadas}`
  : "";

item.mensagem_sugerida = `Ol\u00e1, *${empresa}*! Tudo bem? \u{1F60A}

Este \u00e9 um lembrete sobre o ${identificador}.

\u{1F4C5} *Vencimento:* ${situacao} (${data})
\u{1F4B0} *Valor:* R$ ${valor}${titulos}

Caso o pagamento j\u00e1 tenha sido realizado, por favor desconsidere esta mensagem.

Precisa da segunda via do boleto ou ficou com alguma d\u00favida? Fale com nosso setor financeiro pelo WhatsApp: +55 48 9970-0358.

Atenciosamente,
*Equipe Financeira | Rodobach*`;

return [{ json: item }];
