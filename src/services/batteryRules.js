const MINUTE = 60_000;

function sustained(rows, now, accepts) {
  const samples = [];
  for (const row of [...rows].sort((a,b)=>new Date(b.data_hora)-new Date(a.data_hora))) {
    const time = new Date(row.data_hora).getTime();
    const voltage = row.bateria_carreta == null ? NaN : Number(row.bateria_carreta);
    if (!Number.isFinite(time) || time > now || now-time > 120*MINUTE) break;
    if (!samples.length && now-time > 5*MINUTE) break;
    if (samples.length && samples.at(-1).time === time) continue;
    if (samples.length && samples.at(-1).time-time > 6*MINUTE) break;
    if (!Number.isFinite(voltage) || voltage<16 || voltage>32 || !accepts(row,voltage)) break;
    samples.push({time,voltage});
  }
  return samples.length>=3 && samples[0].time-samples.at(-1).time>=10*MINUTE ? samples : null;
}

// Preserve the existing pilot thresholds. Recovery describes the signal, not battery health.
export function evaluateBattery(rows, now = Date.now()) {
  const stopped = r => r.ignicao === false && Number(r.rpm || 0) === 0 && Number(r.velocidade || 0) === 0;
  const critical = sustained(rows,now,(r,v)=>stopped(r)&&v<23.5);
  const low = sustained(rows,now,(r,v)=>stopped(r)&&v<=24);
  const recovered = sustained(rows,now,(r,v)=>v>=25 && (r.ignicao===false || r.ignicao===true));
  const samples = critical || low || recovered;
  if (!samples) return null;
  const delta=samples[0].voltage-samples.at(-1).voltage;
  return {
    voltage:samples[0].voltage,time:new Date(samples[0].time).toISOString(),
    since:new Date(samples.at(-1).time).toISOString(),
    level:critical?'critico':low?'atencao':'recuperado',samples:samples.length,
    durationMinutes:Math.floor((samples[0].time-samples.at(-1).time)/MINUTE),
    trend:delta<0?'Em queda':delta>0?'Em alta':'Sem queda entre a primeira e a última leitura',
  };
}

export function batteryTransition(state, event) {
  if (!event || (state?.lastSample && event.time<=state.lastSample)) return {state,notify:false};
  const next={...state,lastSample:event.time};
  // Attention and recovery are internal observations, never WhatsApp notifications.
  if(event.level==='recuperado') return {state:{...next,active:false,level:null,notified:false},notify:false};
  if(!state?.active) {
    const notify=event.level==='critico';
    return {state:{...next,active:true,level:event.level,startedAt:event.since,notified:notify},notify};
  }
  if(event.level==='critico' && state.level!=='critico') return {state:{...next,level:'critico',notified:true},notify:true};
  return {state:next,notify:false};
}

export function batteryMessage(plate,event,test=false) {
  const recovered=event.level==='recuperado';
  const title=recovered?'TENSÃO RECUPERADA':event.level==='critico'?'ALERTA CRÍTICO':'ATENÇÃO';
  return [
    test?'*TESTE — monitor de bateria Rodobach*':`*${title} — bateria Rodobach*`,
    `*${plate} · Sistema 24 V*`,'',
    `Tensão ${test?'simulada':'informada'}: *${event.voltage.toLocaleString('pt-BR')} V*`,
    `Nível: ${title}`,
    recovered?'Tensão acima do limite de atenção nas leituras recentes.':'Veículo parado · Ignição desligada',
    `Confirmação: ${event.samples} leituras em ${event.durationMinutes} minutos`,
    `Tendência: ${event.trend}`,'',
    `Última leitura: ${new Date(event.time).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`,
    test?'Dados simulados para validar o envio. Não indica uma falha real.':recovered?
      'Ocorrência encerrada no monitor. Isso não confirma a saúde da bateria.':event.level==='critico'?
      'Verifique consumidores ligados e solicite avaliação antes da próxima partida.':
      'Verifique se há consumidores ligados. O monitor acompanha a persistência e eventual piora.',
    '', 'A tensão não confirma defeito nem indica percentual de carga.',
  ].join('\n');
}
