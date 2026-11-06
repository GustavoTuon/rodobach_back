import {selectFleetTarget} from './fleetRevenuePlan.js';
const r=value=>Math.round((value+Number.EPSILON)*100)/100;
const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function costKind(account) {
  const name=normalized(account);
  if(/aquisicao.*veicul|adiantamento|estorno de adiantamento/.test(name))return 'excluded';
  if(/financiam|emprestim|consorcio/.test(name))return 'finance';
  if(/combust|lubrific|pedagio|salarios variaveis|comissao|despesas de viagen|manuten|borrachar|pneu|lavacao|lavagem|icms|seguradora de riscos/.test(name))return 'variable';
  return 'fixed';
}
export function profitModel(item,costs,margin=15,reserve=0) {
  const sample=item.history.filter(row=>row.eligible),months=new Set(sample.map(row=>row.month));
  const costPlates=item.costPlates || [item.plate];
  const selected=costs.filter(row=>costPlates.includes(row.plate) && months.has(row.month));
  const totals={variable:0,fixed:0,finance:0,excluded:0},accounts=new Map();
  for(const row of selected){const kind=costKind(row.account),value=Number(row.cost);totals[kind]+=value;const key=`${row.plate}:${row.account}`;accounts.set(key,{plate:row.plate,account:row.account,kind,total:r((accounts.get(key)?.total||0)+value)});}
  const revenue=sample.reduce((sum,row)=>sum+row.revenue,0),count=sample.length;
  const covered=new Set(selected.filter(row=>costKind(row.account)!=='excluded' && Number(row.cost)>0).map(row=>row.month)).size;
  const variableRate=revenue>0 ? totals.variable/revenue : null;
  const fixed=count ? totals.fixed/count : 0;
  const recent=sample.slice(-3).map(row=>row.month);
  const recentFinance=recent.length ? selected.filter(row=>recent.includes(row.month)&&costKind(row.account)==='finance').reduce((sum,row)=>sum+Number(row.cost),0)/recent.length : 0;
  const finance=count ? Math.max(totals.finance/count,recentFinance) : 0;
  const ready=count>=3 && covered===count && revenue>0 && totals.variable>0 && fixed>0 && variableRate>=0 && variableRate<1;
  const contribution=variableRate==null ? null : 1-variableRate;
  const operatingBreakEven=ready ? r((fixed+reserve)/contribution) : null;
  const cashBreakEven=ready ? r((fixed+finance+reserve)/contribution) : null;
  const requiredForMargin=ready && contribution>margin/100 ? r((fixed+finance+reserve)/(contribution-margin/100)) : null;
  const target=requiredForMargin===null ? null : Math.ceil(Math.max(requiredForMargin,revenue/count)/1000)*1000;
  return {ready:target!==null,margin,reserve,months:count,coveredMonths:covered,variableRate:variableRate==null ? null : r(variableRate*100),fixed:r(fixed),finance:r(finance),
    operatingBreakEven,cashBreakEven,requiredForMargin,target,excluded:r(totals.excluded),accounts:[...accounts.values()].sort((a,b)=>b.total-a.total),
    reason:!ready ? 'Base incompleta: exige pelo menos 3 meses com receita e custos, incluindo custos fixos e variáveis.' : target===null ? 'A taxa variável consome a margem desejada. Rever preço, rota ou custos; aumentar faturamento neste padrão não resolve.' : null,
    historicalAverage:count ? r(revenue/count) : null,
    beyondHistory:target!==null && target>Math.max(...sample.map(row=>row.revenue)),
    estimatedCashAtTarget:target===null ? null : r(target*contribution-fixed-finance-reserve)};
}
export function applyProfitTargets(data,costs,margin=15,reserve=0) {
  const items=data.items.map(item=>{
    const model=profitModel(item,costs,margin,reserve);
    const selection=selectFleetTarget({...item,historicalTarget:item.target},model,data.period,margin,reserve),target=selection.target;
    model.minimumTarget=model.target;
    model.target=target;
    model.beyondHistory=target!==null && target>Math.max(0,...item.history.filter(row=>row.eligible).map(row=>row.revenue));
    model.estimatedCashAtTarget=target===null || !model.ready ? null : r(target*(1-model.variableRate/100)-model.fixed-model.finance-reserve);
    const expected=target==null ? null : r(target*data.period.elapsed/data.period.days);
    const pace=expected>0 ? r(item.actual/expected*100) : null;
    const status=pace==null || !model.ready ? 'sem_base' : pace>=100 ? 'acima' : pace>=90 ? 'atencao' : 'abaixo';
    return {...item,...selection,historicalTarget:item.target,profit:model,target,expected,pace,status,provisional:!model.ready,
      gap:expected==null ? null : r(item.actual-expected),remaining:target==null ? null : r(Math.max(0,target-item.actual)),
      series:item.series.map(point=>({...point,expected:target==null ? null : r(target*point.day/data.period.days)}))};
  });
  return {...data,items,summary:{...data.summary,target:r(items.reduce((sum,item)=>sum+(item.target||0),0)),withTarget:items.filter(item=>item.target!==null).length,above:items.filter(item=>item.status==='acima').length,below:items.filter(item=>item.status==='abaixo').length},method:{...data.method,
    target:`Necessário para margem = (custos fixos médios + parcelas de referência + reserva mensal por veículo) ÷ (1 − taxa variável histórica − margem de ${margin}%). Meta sugerida: o maior entre esse resultado e a média histórica de faturamento, arredondado para cima em R$ 1.000. Parcelas usam o maior entre média da base e dos últimos 3 meses para não diluir contratos recentes.`,
    costs:'Custos da mesma base de Custos por Veículo: rateios de contas a pagar, status 1/2, por vencimento. Não soma novamente abastecimentos ou ordens de serviço operacionais. Base: meses completos de 2026 anteriores ao mês selecionado.',
    plan:'Novembro/2026: metas individuais fixadas em 05/11 com custos até outubro. Critério: maior entre o necessário para sobra de 15%, P75 histórico e piso gerencial de R$ 95 mil para conjuntos com carreta; arredondado para cima em R$ 5 mil. O piso é uma decisão de gestão baseada na referência de R$ 90–100 mil, não custo comprovado. Alterar margem ou reserva abre simulação e não altera o plano. Outros meses mostram simulação.',
    classification:'Variáveis: combustível, pedágio, salários variáveis, comissão, viagens, manutenção, pneus, lavagem e ICMS. Financiamentos separados. Demais contas conservadas no orçamento fixo médio. Aquisição de veículos e adiantamentos excluídos; classificação disponível no histórico.',
    limits:'Custos do veículo e dos implementos próprios vinculados no cadastro atual. Esse vínculo é uma hipótese de planejamento do conjunto, não prova de que rodaram juntos em todos os meses. Não inclui automaticamente despesas administrativas sem rateio, depreciação ou tributos não lançados. Reserva mensal ajustável permite acrescentar um orçamento para essas despesas.',
    note:'Meta de sobra de caixa estimada, não garantia de lucro líquido. Parcelas incluem principal e juros sem separação; histórico por vencimento não representa competência contábil. Custos variam com quilometragem, rotas e preços. Metas acima do melhor mês são sinalizadas para revisão.'}};
}
