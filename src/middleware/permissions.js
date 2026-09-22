const ROUTE_PERMISSIONS = [
  [/^\/admin\//, "admin"],
  [/^\/usuarios(?:\/|$)/, "admin"],
  [/^\/automacoes(?:\/|$)/, "automacoes-n8n"],
  [/^\/whatsapp(?:\/|$)/, "manutencao"],
  [/^\/pneus(?:\/|$)/, "pneus"],
  [/^\/frota\/multas(?:\/|$)/, "multas-frota"],
  [/^\/manutencao\/componentes-posicao(?:\/|$)/, ["manutencao-posicoes", "manutencao"]],
  [/^\/manutencao(?:\/|$)/, "manutencao"],
  [/^\/cargas-viagens-v2(?:\/|$)/, "viagens"],
  [/^\/viagens(?:\/|$)/, "viagens"],
  [/^\/motoristas\/folgas(?:\/|$)/, "folgas-motoristas"],
  [/^\/motoristas\/jornada-macros(?:\/|$)/, "folgas-motoristas"],
  [/^\/motoristas\/conducao(?:\/|$)/, "analise-frota"],
  [/^\/motoristas\/diarias(?:\/|$)/, "simulador"],
  [/^\/localidades\/cidades(?:\/|$)/, ["simulador", "viagens"]],
  [/^\/frota\/status-carga(?:\/|$)/, "status-carga"],
  [/^\/frota\/painel-tv(?:\/|$)/, "status-carga"],
  [/^\/frota\/ociosidade(?:\/|$)/, "status-carga"],
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
  [/^\/financeiro\/fluxo-caixa(?:\/|$)/, "fluxo-caixa"],
  [/^\/financeiro\/embarques-clientes(?:\/|$)/, "clientes"],
  [/^\/financeiro\/(resumo|receitas|custos|demonstrativo)(?:\/|$)/, "dre-empresarial"],
  [/^\/financeiro\/por-placa(?:\/|$)/, "custos-veiculos"],
  [/^\/financeiro\/alertas-operacionais(?:\/|$)/, ["diretoria", "status-carga"]],
  [/^\/(plates|months|drivers|overview|fuel)(?:\/|$)/, "analise-frota"],
  [/^\/diagnostics(?:\/|$)/, "admin"],
];

export function requirePermission(permission) {
  return (req, res, next) => {
    if (req.user?.admin === true) return next();
    const permissions = Array.isArray(permission) ? permission : [permission];
    if (!permissions.some((key) => key !== "admin" && req.user?.permissions?.[key] === true)) {
      return res.status(403).json({ error: "Voce nao possui permissao para esta operacao." });
    }
    next();
  };
}

export function requireRoutePermission(req, res, next) {
  const path = req.path.toLowerCase();
  const match = ROUTE_PERMISSIONS.find(([pattern]) => pattern.test(path));
  if (!match) return res.status(403).json({ error: "Rota sem politica de acesso." });
  const sharedReads = {
    "/financeiro/custos-veiculos/filtros": ["custos-veiculos", "abastecimentos", "analise-frota"],
    "/manutencao/veiculos": ["manutencao", "manutencao-posicoes"],
  };
  if (["GET", "HEAD"].includes(req.method) && sharedReads[path.replace(/\/$/, "")]) return requirePermission(sharedReads[path.replace(/\/$/, "")])(req, res, next);
  // The executive screen consumes these existing reports, but cannot mutate them.
  const executiveReports = /^\/financeiro\/(dre-empresarial|analise-clientes|lucro-viagens|custos-veiculos\/auditoria)(?:\/|$)/;
  if (["GET", "HEAD"].includes(req.method) && req.user?.permissions?.diretoria === true && executiveReports.test(path)) return next();
  return requirePermission(match[1])(req, res, next);
}

export { ROUTE_PERMISSIONS };
