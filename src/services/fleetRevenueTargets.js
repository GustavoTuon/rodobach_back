const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
export const saoPauloDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const daysInMonth=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
export function revenuePeriod(month,now=new Date()) {
  const today=saoPauloDay(now),current=today.slice(0,7);
  month=month || current;
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.slice(0,4)!==today.slice(0,4) || month>current) {
    const error=new Error('Selecione um mês deste ano, até o mês atual.');error.status=400;throw error;
  }
  const days=daysInMonth(month),elapsed=month===current ? Number(today.slice(8))-1 : days;
  return {month,year:Number(today.slice(0,4)),days,elapsed,cutoff:elapsed ? `${month}-${String(elapsed).padStart(2,'0')}` : null,today};
}
export function percentile75(values) {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*.75,lower=Math.floor(index);
  return sorted[lower]+(sorted[Math.ceil(index)]-sorted[lower])*(index-lower);
}
export function buildFleetRevenue(vehicles,daily,period) {
  const yearStart=`${period.year}-01`,byPlate=new Map();
  for(const row of daily) {
    if(!byPlate.has(row.plate))byPlate.set(row.plate,[]);
    byPlate.get(row.plate).push(row);
  }
  const items=vehicles.map(vehicle=>{
    const rows=(byPlate.get(vehicle.plate)||[]).filter(row=>row.day>=`${yearStart}-01` && period.cutoff && row.day<=period.cutoff);
    const monthly=new Map(),byDay=new Map();
    for(const row of rows) {
      const month=row.day.slice(0,7);
      monthly.set(month,(monthly.get(month)||0)+Number(row.revenue));
      byDay.set(row.day,(byDay.get(row.day)||0)+Number(row.revenue));
    }
    const first=rows.map(row=>row.day).sort()[0];
    let baseStart=first?.slice(0,7) || period.month;
    if(vehicle.acquired) {
      const acquired=vehicle.acquired.slice(0,10);
      if(acquired<`${yearStart}-01`)baseStart=yearStart;
      else {
        const date=new Date(`${acquired}T00:00:00Z`);
        if(date.getUTCDate()>1)date.setUTCMonth(date.getUTCMonth()+1,1);
        baseStart=date.toISOString().slice(0,7);
      }
    }
    const history=[];
    for(let month=1;month<=Number(period.month.slice(5));month++) {
      const key=`${period.year}-${String(month).padStart(2,'0')}`;
      history.push({month:key,revenue:round(monthly.get(key)||0),eligible:key>=baseStart && key<period.month});
    }
    const sample=history.filter(row=>row.eligible),p75=percentile75(sample.map(row=>row.revenue));
    const target=p75>0 ? Math.ceil(p75/1000)*1000 : null;
    const sufficient=sample.length>=3 && target!==null;
    const actual=round(monthly.get(period.month)||0),expected=target===null ? null : round(target*period.elapsed/period.days);
    const pace=expected>0 ? round(actual/expected*100) : null;
    const status=!sufficient || !period.elapsed ? 'sem_base' : pace>=100 ? 'acima' : pace>=90 ? 'atencao' : 'abaixo';
    let accumulated=0;
    const series=Array.from({length:period.elapsed+1},(_,day)=>{
      if(day)accumulated+=byDay.get(`${period.month}-${String(day).padStart(2,'0')}`)||0;
      return {day,revenue:round(accumulated),expected:target===null ? null : round(target*day/period.days)};
    });
    return {...vehicle,actual,target,expected,pace,status,baseStart,sampleMonths:sample.length,provisional:!sufficient,
      gap:expected===null ? null : round(actual-expected),remaining:target===null ? null : round(Math.max(0,target-actual)),
      projection:period.elapsed ? round(actual/period.elapsed*period.days) : null,
      yearRevenue:round(rows.reduce((sum,row)=>sum+Number(row.revenue),0)),history,series};
  });
  return {period,items,summary:{vehicles:items.length,actual:round(items.reduce((sum,item)=>sum+item.actual,0)),
    target:round(items.reduce((sum,item)=>sum+(item.target||0),0)),withTarget:items.filter(item=>item.target!==null).length,
    above:items.filter(item=>item.status==='acima').length,below:items.filter(item=>item.status==='abaixo').length},
    method:{source:'CT-es emitidos (status 2), valor do frete por data de emissão. Mesma base do Resultado por Veículo.',
      target:'Percentil 75 dos meses completos anteriores ao mês selecionado, no mesmo ano, arredondado para cima em R$ 1.000. Meses sem receita entram como zero após o início da base.',
      start:'Com data de aquisição: primeiro mês completo da propriedade. Sem data: mês do primeiro CT-e observado no ano (aproximação).',
      pace:'Meta proporcional aos dias corridos encerrados. Verde: 100% ou mais; amarelo: de 90% a menos de 100%; vermelho: abaixo de 90%. Menos de 3 meses: referência provisória, sem avaliação.',
      scope:'Veículos próprios ativos de transporte (caminhão/cavalo). Exclui terceiros, reboques e veículos de apoio. Classificação atual do cadastro.',
      note:'Referência histórica de faturamento, não meta de lucro. Não considera custos nem sazonalidade; projeção linear não é garantia de fechamento.'}};
}
