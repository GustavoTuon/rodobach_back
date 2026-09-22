export function parseMaintenanceCommand(args) {
  const allowed = args.every(arg => ['--preview', '--send', '--worker'].includes(arg) || arg.startsWith('--ids='));
  if (!allowed) throw new Error('Opção inválida. Use --preview, --send --ids=65,82 ou --worker.');
  const modes = args.filter(arg => ['--preview', '--send', '--worker'].includes(arg));
  if (modes.length > 1) throw new Error('Escolha apenas um modo de execução.');
  const mode = modes[0] || '--preview';
  const selections = args.filter(arg => arg.startsWith('--ids='));
  if (selections.length > 1) throw new Error('Informe --ids apenas uma vez.');
  let planIds = null;
  if (selections.length) {
    const value = selections[0].slice(6);
    if (!/^\d+(,\d+)*$/.test(value)) throw new Error('IDs de planos inválidos.');
    planIds = [...new Set(value.split(',').map(Number))];
    if (planIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('IDs de planos inválidos.');
  }
  if (mode === '--send' && !planIds) throw new Error('O envio manual exige --ids com os planos escolhidos.');
  if (mode === '--worker' && planIds) throw new Error('O worker acompanha todos os planos; use --send para uma seleção.');
  return {mode, planIds, dryRun: mode === '--preview', onlyOverdue: mode === '--send'};
}
