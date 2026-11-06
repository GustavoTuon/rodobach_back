// Plano de novembro definido em 05/11/2026: custos registrados de janeiro a outubro,
// referência histórica P75, margem de caixa de 15% e piso gerencial de R$95 mil
// para conjuntos com carreta (referência de R$90–100 mil informada pela gestão).
// Arredondamento para cima em R$5 mil. Plano fixo: não muda com atualizações do ERP.
export const NOVEMBER_2026_PLAN=Object.freeze({
  LXG1J87:20000,RAA8G18:65000,RAA8G58:70000,RXO6C18:65000,RXW7J14:70000,
  RYI6H21:60000,RYP7D29:95000,RYU2G97:60000,SXR8D09:120000,SXY5D26:95000,
});
export function selectFleetTarget(item,model,period,margin,reserve) {
  const managementFloor=item.trailers?.length ? 95000 : 0;
  const calculated=model.requiredForMargin==null ? null : Math.ceil(Math.max(model.requiredForMargin,item.historicalTarget || 0,model.historicalAverage || 0,managementFloor)/5000)*5000;
  const planned=period.month==='2026-11' ? NOVEMBER_2026_PLAN[item.plate] ?? null : null;
  const usePlan=planned!==null && margin===15 && reserve===0;
  return {target:usePlan ? planned : calculated,plannedTarget:planned,calculatedTarget:calculated,
    managementFloor,targetMode:usePlan ? 'plano_novembro' : 'simulacao',
    planNeedsReview:usePlan && (model.requiredForMargin==null || model.requiredForMargin>planned),
    targetReason:usePlan ? 'Plano de novembro/2026 · definido em 05/11 · custos e histórico até outubro' : 'Simulação: custos, P75 histórico e piso gerencial dos conjuntos, arredondados em R$ 5 mil'};
}
