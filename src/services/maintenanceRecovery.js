import {config,tableName} from '../config.js';

// Read-only provider search. Missing/incomplete history never authorizes a retry.
export async function verifyMaintenanceHistory(attempt,request=fetch){
  const base=process.env.EVOLUTION_API_URL,key=process.env.EVOLUTION_API_KEY;
  if(!base||!key)throw new Error('Provedor não configurado.');
  let total=null,seen=0;
  for(let page=1;page<=20;page++){
    const response=await request(`${base}/chat/findMessages/${encodeURIComponent(process.env.EVOLUTION_INSTANCE_NAME||'rodobach')}`,{
      method:'POST',headers:{apikey:key,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({where:{key:{remoteJid:attempt.numero,fromMe:true}},page,offset:100}),
    });
    if(!response.ok)throw new Error('Não foi possível conferir o histórico do provedor.');
    const {messages}=await response.json();
    if(!Array.isArray(messages?.records)||!Number.isInteger(messages.total)||!Number.isInteger(messages.pages))throw new Error('Histórico do provedor incompleto.');
    if(total!==null&&total!==messages.total)throw new Error('Histórico mudou durante a consulta. Consulte novamente.');
    total=messages.total;seen+=messages.records.length;
    for(const message of messages.records){
      const text=message.message?.conversation||message.message?.extendedTextMessage?.text;
      if(message.key?.remoteJid!==attempt.numero||message.key?.fromMe!==true)throw new Error('Provedor retornou histórico fora do destinatário solicitado.');
      if(text===attempt.mensagem&&Number(message.messageTimestamp)*1000>=new Date(attempt.ocorrido_em).getTime()-300000)
        return {found:true,providerId:message.key.id};
    }
    if(page>=messages.pages){if(seen!==total)throw new Error('Histórico do provedor incompleto.');return {found:false,checked:seen};}
  }
  throw new Error('Histórico extenso: necessária conferência adicional antes do reenvio.');
}

export async function authorizeMaintenanceRetry(db,id,{actor,reason,verify=verifyMaintenanceHistory}={}){
  if(config.readOnly)throw new Error('Ambiente somente consulta.');
  if(!Number.isSafeInteger(id)||id<=0||!actor||!reason)throw new Error('Informe tentativa, responsável e motivo.');
  const client=await db.connect();let locked=false;
  try{
    locked=(await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[78482932])).rows[0]?.acquired;
    if(!locked)throw new Error('Outra execução de manutenção está em andamento.');
    const {rows}=await client.query(`SELECT * FROM ${tableName('manutencao_auditoria')} WHERE id=$1`,[id]);
    const attempt=rows[0];
    if(!attempt||attempt.evento!=='envio'||attempt.origem!=='plano'||attempt.status!=='inconclusivo'||attempt.dados_novos?.reenvio_autorizado)
      throw new Error('A tentativa não está pendente de revisão. Nenhum reenvio liberado.');
    if(Date.now()-new Date(attempt.ocorrido_em).getTime()<600000)throw new Error('Aguarde 10 minutos antes de revisar uma tentativa.');
    const evidence=await verify(attempt);
    if(evidence.found)throw new Error('Mensagem encontrada no provedor. Reenvio bloqueado para evitar duplicidade.');
    if(!Number.isInteger(evidence.checked))throw new Error('Conferência do provedor não concluída.');
    const authorization={em:new Date().toISOString(),responsavel:actor,motivo:reason,historico_consultado:evidence.checked,resultado:'Mensagem não encontrada no histórico disponível; nova tentativa autorizada explicitamente.'};
    await client.query(`UPDATE ${tableName('manutencao_auditoria')} SET dados_novos=COALESCE(dados_novos,'{}'::jsonb)||jsonb_build_object('reenvio_autorizado',$2::jsonb) WHERE id=$1`,[id,JSON.stringify(authorization)]);
    return {planId:attempt.automacao_id,number:attempt.numero};
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock($1)',[78482932]).catch(()=>{});client.release();}
}
