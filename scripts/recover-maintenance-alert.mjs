import {pool} from '../src/db/pool.js';
import {authorizeMaintenanceRetry} from '../src/services/maintenanceRecovery.js';
import {runMaintenanceAlerts} from '../src/services/manutencaoAlertaService.js';
const [id,actor,reason,confirm,...extra]=process.argv.slice(2);
try{
  if(confirm!=='--retry'||extra.length||!/^\d+$/.test(id||''))throw new Error('Uso: node scripts/recover-maintenance-alert.mjs ID RESPONSAVEL MOTIVO --retry');
  const recovered=await authorizeMaintenanceRetry(pool,Number(id),{actor,reason});
  const result=await runMaintenanceAlerts({dryRun:false,planIds:[recovered.planId],recipientNumber:recovered.number});
  console.log(JSON.stringify({ok:result.ok,ignored:result.ignorado,planId:recovered.planId,candidates:result.candidatos?.length,accepted:result.enviados?.length,failures:result.falhas?.length}));
  if(!result.ok||result.ignorado)process.exitCode=1;
}catch(error){console.error(error.name==='TimeoutError'?'Consulta ao provedor excedeu o tempo limite.':error.code||error.message);process.exitCode=1;}
finally{await pool.end();}
process.exit(process.exitCode||0);
