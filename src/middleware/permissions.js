const ROUTE_PERMISSIONS = [
  [/^\/admin\//, "admin"],
  [/^\/usuarios(?:\/|$)/, "admin"],
  [/^\/automacoes(?:\/|$)/, "automacoes-n8n"],
  [/^\/whatsapp(?:\/|$)/, "manutencao"],
  [/^\/pneus(?:\/|$)/, "pneus"],
  [/^\/frota\/multas(?:\/|$)/, "multas-frota"],
  [/^\/manutencao(?:\/|$)/, "manutencao"],
  [/^\/cargas-viagens-v2(?:\/|$)/, "viagens"],
  [/^\/viagens(?:\/|$)/, "viagens"],
  [/^\/motoristas\/folgas(?:\/|$)/, "folgas-motoristas"],
  [/^\/frota\/status-carga(?:\/|$)/, "status-carga"],
  [/^\/trafegus(?:\/|$)/, "trafegus"],
  [/^\/oportunidades-retorno(?:\/|$)/, "oportunidades-retorno"],
  [/^\/cte(?:\/|$)/, "consulta-cte"],
  [/^\/canhotos(?:\/|$)/, "controle-canhotos"],
  [/^\/frete(?:\/|$)/, "simulador"],
  [/^\/frota\/abastecimentos(?:\/|$)/, "abastecimentos"],
  [/^\/abastecimentos(?:\/|$)/, "precos-combustivel"],
  [/^\/frota\/analise(?:\/|$)/, "analise-frota"],
  [/^\/financeiro\/dre-empresarial(?:\/|$)/, "dre-empresarial"],
  [/^\/financeiro\/despesas-futuras(?:\/|$)/, "fluxo-caixa"],
  [/^\/financeiro\/faturamento-diario(?:\/|$)/, "faturamento-diario"],
  [/^\/financeiro\/faturamento-mensal-comparativo(?:\/|$)/, "comparativo-faturamento"],
  [/^\/financeiro\/lucro-viagens(?:\/|$)/, "lucro-viagens"],
  [/^\/financeiro\/resultado-fretes(?:\/|$)/, "lucro-viagens"],
  [/^\/financeiro\/analise-clientes(?:\/|$)/, "clientes"],
  [/^\/clientes\/rentabilidade(?:\/|$)/, "clientes-lucro"],
  [/^\/financeiro\/custos-veiculos(?:\/|$)/, "custos-veiculos"],
  [/^\/financeiro\/manutencoes-veiculos(?:\/|$)/, "manutencoes-veiculos"],
];

export function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.admin) return next();
    if (permission === "admin" || req.user?.permissions?.[permission] !== true) {
      return res.status(403).json({ error: "Voce nao possui permissao para esta operacao." });
    }
    next();
  };
}

export function requireRoutePermission(req, res, next) {
  const match = ROUTE_PERMISSIONS.find(([pattern]) => pattern.test(req.path));
  if (!match) return next();
  return requirePermission(match[1])(req, res, next);
}

export { ROUTE_PERMISSIONS };
