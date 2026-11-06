import {Router} from 'express';
import {createHash} from 'node:crypto';
import {pool} from '../db/pool.js';
import {config, tableName} from '../config.js';
import {runMaintenanceAlerts} from '../services/manutencaoAlertaService.js';

export function createMaintenanceIntegration({db=pool, run=runMaintenanceAlerts, readOnly=()=>config.readOnly}={}) {
  const router=Router();
  router.post('/integracoes/n8n/manutencao', async (req,res,next)=>{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Integração não autorizada.'});
    try {
      const hash=createHash('sha256').update(token).digest('hex');
      const auth=await db.query(`SELECT id,destinatario FROM ${tableName('manutencao_n8n_integracao')} WHERE id=1 AND ativo=TRUE AND token_hash=$1`,[hash]);
      if(!auth.rowCount)return res.status(401).json({error:'Integração não autorizada.'});
      if(typeof req.body?.dryRun!=='boolean')return res.status(400).json({error:'Informe dryRun como booleano.'});
      if(!req.body.dryRun&&readOnly())return res.status(403).json({error:'Ambiente somente consulta.'});
      const result=await run({dryRun:req.body.dryRun,recipientNumber:auth.rows[0].destinatario});
      if(result.ignorado)return res.status(409).json({ok:false,error:'Outra execução de manutenção está em andamento.'});
      // Keep phones and message bodies out of n8n execution logs.
      res.status(result.ok?200:502).json({ok:result.ok,dryRun:req.body.dryRun,candidatos:result.candidatos.length,aceitos:result.enviados.length,falhas:result.falhas.length});
    } catch(error){next(error);}
  });
  return router;
}
export const maintenanceIntegrationRouter=createMaintenanceIntegration();
