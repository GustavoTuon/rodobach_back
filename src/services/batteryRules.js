const MINUTE = 60_000;

// Pilot for a confirmed 24 V lead-acid supply. Voltage is not a SOC percentage.
export function evaluateBattery(rows, now = Date.now()) {
  const ordered = [...rows].sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));
  const samples = [];
  for (const row of ordered) {
    const time = new Date(row.data_hora).getTime();
    const voltage = row.bateria_carreta == null ? NaN : Number(row.bateria_carreta);
    if (!Number.isFinite(time) || time > now || now - time > 30 * MINUTE) break;
    if (!samples.length && now - time > 5 * MINUTE) break;
    if (samples.length && samples.at(-1).time === time) continue;
    if (samples.length && samples.at(-1).time - time > 6 * MINUTE) break;
    if (!Number.isFinite(voltage) || voltage < 16 || voltage > 24 ||
        row.ignicao !== false || Number(row.rpm || 0) > 0 || Number(row.velocidade || 0) > 0) break;
    samples.push({ time, voltage });
  }
  if (samples.length < 3 || samples[0].time - samples.at(-1).time < 10 * MINUTE) return null;
  return {
    voltage: samples[0].voltage,
    time: new Date(samples[0].time).toISOString(),
    level: samples.every(row => row.voltage < 23.5) ? 'critico' : 'baixo',
    samples: samples.length,
  };
}

export function batteryMessage(plate, event, test = false) {
  return [
    test ? '*TESTE — alerta de bateria Rodobach*' : '*ALERTA — bateria baixa Rodobach*',
    `Caminhão: ${plate} | sistema 24 V`,
    `Tensão${test ? ' simulada' : ''}: ${event.voltage.toLocaleString('pt-BR', {minimumFractionDigits: 1})} V`,
    `Nível: ${event.level === 'critico' ? 'CRÍTICO' : 'BAIXO'}`,
    'Condição: ignição desligada e tensão baixa por pelo menos 10 minutos.',
    ...(test ? ['Dados simulados para validar o envio. Não indica uma falha real.'] : [
      `Leitura: ${new Date(event.time).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}`,
      'Verifique consumidores ligados e solicite avaliação da bateria antes da próxima partida.',
    ]),
    'A tensão não representa uma porcentagem exata de carga.',
  ].join('\n');
}
