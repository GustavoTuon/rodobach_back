export function parseMaintenanceCommand(args) {
  if(args.some(arg=>arg!=='--preview'&&!arg.startsWith('--ids='))) throw new Error('Somente simulação local é permitida. Os envios são agendados pelo n8n.');
  const selections=args.filter(arg=>arg.startsWith('--ids='));
  if(selections.length>1)throw new Error('Informe --ids apenas uma vez.');
  let planIds=null;
  if(selections.length){
    const value=selections[0].slice(6);
    if(!/^\d+(,\d+)*$/.test(value))throw new Error('IDs de planos inválidos.');
    planIds=[...new Set(value.split(',').map(Number))];
    if(planIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('IDs de planos inválidos.');
  }
  return {mode:'--preview',planIds,dryRun:true,onlyOverdue:false};
}
