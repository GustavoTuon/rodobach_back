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
const identificador = temBoleto ? `boleto nº *${numeroDocumento || titulo}*` : `título *${titulo}*`;
const valor = Number(item.valor_aberto || 0).toLocaleString("pt-BR", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const data = vencimento.toLocaleDateString("pt-BR", { timeZone: "UTC" });
const situacao = diasCorridos === 0
  ? "hoje"
  : diasCorridos === 1
    ? "amanhã"
    : diasCorridos > 1
      ? `em ${diasCorridos} dias`
      : diasUteisRegra === 1 ? "vencido há 1 dia útil" : `vencido há ${diasUteisRegra} dias úteis`;
const titulos = item.boleto_agrupado && item.duplicatas_agrupadas
  ? `\n📄 *Títulos vinculados:* ${item.duplicatas_agrupadas}`
  : "";

item.mensagem_sugerida = `Olá, *${empresa}*! Tudo bem? 😊

Este é um lembrete sobre o ${identificador}.

📅 *Vencimento:* ${situacao} (${data})
💰 *Valor:* R$ ${valor}${titulos}

Caso o pagamento já tenha sido realizado, por favor desconsidere esta mensagem.

Precisa da segunda via do boleto ou ficou com alguma dúvida? Fale com nosso setor financeiro pelo WhatsApp: +55 48 9970-0358.

Atenciosamente,
*Equipe Financeira | Rodobach*`;

return [{ json: item }];
