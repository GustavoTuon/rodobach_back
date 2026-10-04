export function buildRouteMessage(sm, driverName, reasons = []) {
  const greeting = driverName ? `Olá, ${driverName}.` : "Olá.";
  return [
    greeting,
    "",
    `A rota de segurança da viagem/SM ${sm.id} foi ${reasons.some((r) => /criada/i.test(r)) ? "criada" : "atualizada"}.`,
    `Veículo: ${sm.veiculoPlaca || "não informado"}`,
    `Origem: ${sm.referenciaOrigemDescricao || "não informada"}`,
    `Destino: ${sm.referenciaDestinoDescricao || "não informado"}`,
    "",
    "Siga a rota oficial abaixo para evitar saída de rota e bloqueio do veículo:",
    sm.link_rota,
    "",
    "Se a rota não abrir, entre em contato com a operação antes de iniciar a viagem.",
  ].join("\n");
}
