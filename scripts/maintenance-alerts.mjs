import {parseMaintenanceCommand} from '../src/services/maintenanceCommand.js';
import {runMaintenanceAlerts} from '../src/services/manutencaoAlertaService.js';
try {
  const options=parseMaintenanceCommand(process.argv.slice(2));
  const result=await runMaintenanceAlerts(options);
  if(result.ignorado) throw new Error('Outra execução está em andamento.');
  console.table(result.candidatos.map(row=>({placa:row.placa,plano:row.automacaoId||row.registroId,servico:row.titulo||'Componente',tipo:row.tipo,kmAtual:row.kmAtual,marco:row.referencia})));
  console.log(`SIMULAÇÃO: ${result.candidatos.length} alertas elegíveis. Nenhuma mensagem enviada.`);
  process.exit(0);
} catch(error){console.error(error.code||error.message);process.exit(1);}
