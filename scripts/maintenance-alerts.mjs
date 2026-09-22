import {parseMaintenanceCommand} from '../src/services/maintenanceCommand.js';
import {runMaintenanceAlerts, startMaintenanceAlertScheduler} from '../src/services/manutencaoAlertaService.js';
import {getN8nAutomation} from '../src/services/n8nService.js';
import {config, tableName} from '../src/config.js';
import {pool} from '../src/db/pool.js';

try {
  const options = parseMaintenanceCommand(process.argv.slice(2));
  // Verify the durable audit is installed before any external side effect.
  await pool.query(`SELECT id FROM ${tableName('manutencao_auditoria')} LIMIT 0`);
  if (!options.dryRun) {
    if (config.readOnly) throw new Error('Modo somente consulta: envio desabilitado.');
    const workflow = await getN8nAutomation('hhjl1q5uyxov5kZI');
    if (workflow.active) throw new Error('O fluxo antigo de manutenção no n8n está ativo. Desative-o antes de iniciar o backend.');
    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) throw new Error('Configure a conexão com o WhatsApp.');
  }
  if (options.mode === '--worker') {
    const stop = startMaintenanceAlertScheduler();
    if (!stop) throw new Error('Não foi possível iniciar o worker.');
    console.log('Alertas de manutenção: backend ativo. Primeira verificação em 2 minutos; próximas a cada 10 minutos.');
    console.log('O processo precisa permanecer rodando. Ctrl+C encerra novas verificações.');
    const shutdown = async () => { await stop(); console.log('Agendador encerrado.'); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } else {
    const result = await runMaintenanceAlerts(options);
    if (result.ignorado) throw new Error('Já existe uma execução em andamento. Aguarde a conclusão.');
    console.table(result.candidatos.map(row => ({
      placa: row.placa, plano: row.automacaoId || row.registroId, servico: row.titulo || 'Componente',
      tipo: row.tipo, kmAtual: row.kmAtual, marco: row.referencia, destinatario: `…${row.numero.slice(-4)}`,
    })));
    console.log(options.dryRun
      ? `SIMULAÇÃO: ${result.candidatos.length} mensagem(ns) elegível(is). Nenhuma mensagem enviada.`
      : `${result.enviados.length} pedido(s) aceito(s), ${result.falhas.length} falha(s). Consulte a auditoria para os resultados por destinatário.`);
    process.exit(result.ok ? 0 : 1);
  }
} catch (error) {
  // Provider errors can contain credentials; output only known validation errors.
  console.error(error.statusCode ? `Não foi possível verificar o serviço externo (HTTP ${error.statusCode}). Nenhum novo envio iniciado.` : error.message);
  process.exit(1);
}
