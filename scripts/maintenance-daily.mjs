import {mkdirSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {config} from '../src/config.js';
import {getN8nAutomation} from '../src/services/n8nService.js';
import {runMaintenanceAlerts} from '../src/services/manutencaoAlertaService.js';
import {executeMaintenanceDaily} from '../src/services/maintenanceDaily.js';
import {sendWhatsappText} from '../src/routes/whatsapp.js';

const logDir = fileURLToPath(new URL('../.local-logs/', import.meta.url));
mkdirSync(logDir, {recursive: true});
const recipient = process.env.MAINTENANCE_ALERT_NUMBER;
const result = await executeMaintenanceDaily({
  run: async options => {
    if (config.readOnly || !/^\d{10,15}$/.test(recipient || '')) throw new Error('Configuração de envio inválida.');
    const workflow = await getN8nAutomation('hhjl1q5uyxov5kZI');
    if (workflow.active) throw new Error('Fluxo antigo ativo.');
    return runMaintenanceAlerts(options);
  },
  notify: async message => {
    if (config.readOnly || !/^\d{10,15}$/.test(recipient || '')) throw new Error('Notificação indisponível.');
    return sendWhatsappText(recipient, message);
  },
});
const entry = JSON.stringify({time: new Date().toISOString(), ...result});
appendFileSync(`${logDir}/maintenance-daily.jsonl`, entry + '\n');
console.log(entry);
process.exit(result.ok ? 0 : 1);
