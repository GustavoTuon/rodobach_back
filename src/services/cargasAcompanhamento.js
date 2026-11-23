import { Router } from 'express';
import { pool } from '../db/pool.js';
import { tableName } from '../config.js';

const fail = (message, statusCode=400) => { throw Object.assign(new Error(message),{statusCode}); };
export const motivosNaoCarregada = ['Cliente desistiu','Não coube no caminhão','Motorista não coletou','Carga indisponível','Outro'];
export function localClock(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function validateForecast(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) fail('Informe uma data e hora de previsão válidas.');
  const parsed=new Date(`${value}:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,16)!==value || value<'2000' || value>='2100') fail('Data ou horário de previsão inválido.');
  return value;
}
export function forecastAlert(row, kind, now=new Date()) {
  const active=kind==='carregamento' ? row.situacao==='aguardando_cte' : kind==='carga' ? ['aguardando_viagem','aguardando_cte'].includes(row.status) : !['entregue','cancelado'].includes(row.situacao);
  if (!active) return null;
  const forecast=row.acompanhamento?.[kind==='carregamento'?'previsaoCarregamento':'previsao'];
  const pending=kind==='carregamento' ? 'Conferir carregamento e CT-e' : kind==='viagem' ? 'Viagem ainda não entregue' : row.status==='aguardando_viagem' ? 'Vincular viagem' : 'Conferir CT-e';
  if (!forecast) return {nivel:'sem_previsao',pendencia:pending};
  const clock=localClock(now),today=clock.slice(0,10);
  const tomorrow=new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  const nivel=forecast<clock?'vencida':forecast.slice(0,10)===today?'hoje':forecast.slice(0,10)===tomorrow?'amanha':'no_prazo';
  return {nivel,pendencia:pending};
}
export function forecastFilter(kind, level) {
  if (!level) return '';
  if (!['vencida','hoje','amanha','sem_previsao'].includes(level)) fail('Filtro de previsão inválido.');
  const alias=kind==='carga'?'c':'v', field=`${alias}.acompanhamento->>'${kind==='carregamento'?'previsaoCarregamento':'previsao'}'`;
  const active=kind==='carregamento'?"v.situacao='aguardando_cte'":kind==='carga'?"c.status IN ('aguardando_viagem','aguardando_cte')":"v.situacao NOT IN ('entregue','cancelado')";
  const clock="NOW() AT TIME ZONE 'America/Sao_Paulo'";
  const condition=level==='sem_previsao'?`NULLIF(${field},'') IS NULL`:level==='vencida'?`${field}<TO_CHAR(${clock},'YYYY-MM-DD"T"HH24:MI')`:
    `LEFT(${field},10)=TO_CHAR((${clock})${level==='amanha'?" + INTERVAL '1 day'":''},'YYYY-MM-DD') AND ${field}>=TO_CHAR(${clock},'YYYY-MM-DD"T"HH24:MI')`;
  return `(${active} AND (${condition}))`;
}
export async function saveForecast(db, kind, id, input, user, creating=false, field="previsao") {
  if (input.previsao===undefined) return;
  const previsao=validateForecast(input.previsao);
  const table=tableName(kind==='carga'?'cargas_v2':'viagens_v2');
  const {rows}=await db.query(`SELECT acompanhamento FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
  if (!rows[0]) fail('Registro não encontrado.',404);
  const old=rows[0].acompanhamento || {}, previous=old[field] || null;
  if (!creating && Object.hasOwn(input,'previsaoAnterior') && (input.previsaoAnterior || null)!==previous) fail('A previsão foi alterada por outra pessoa. Atualize o registro.',409);
  if (previous===previsao) return;
  const motivo=String(input.motivoPrevisao || '').trim();
  if (previous && motivo.length<5) fail('Informe o motivo do reagendamento (ao menos 5 caracteres).');
  if (motivo.length>500) fail('O motivo deve ter até 500 caracteres.');
  const entry={tipo:'previsao',campo:field,anterior:previous,previsao,motivo,usuario:user?.login || '',em:new Date().toISOString()};
  await db.query(`UPDATE ${table} SET acompanhamento=$2::jsonb WHERE id=$1`,[id,JSON.stringify({...old,[field]:previsao,historico:[...(old.historico || []),entry]})]);
}

export async function saveTripForecasts(db,id,input,user,creating=false) {
  if(input.previsao===undefined && input.previsaoCarregamento===undefined)return;
  await saveForecast(db,'viagem',id,input,user,creating);
  if(input.previsaoCarregamento!==undefined) {
    const loading={previsao:input.previsaoCarregamento,motivoPrevisao:input.motivoCarregamento};
    if(Object.hasOwn(input,'carregamentoAnterior'))loading.previsaoAnterior=input.carregamentoAnterior;
    await saveForecast(db,'viagem',id,loading,user,creating,'previsaoCarregamento');
  }
  const {rows}=await db.query(`SELECT acompanhamento FROM ${tableName('viagens_v2')} WHERE id=$1 FOR UPDATE`,[id]);
  const data=rows[0]?.acompanhamento || {};
  if(data.previsao && data.previsaoCarregamento && data.previsao<data.previsaoCarregamento)fail('A entrega prevista deve ser igual ou posterior ao carregamento.');
}

export const acompanhamentoRouter=Router();
acompanhamentoRouter.get('/cargas-viagens-v2/alertas',async(req,res,next)=>{
  try {
    const result={};
    for(const kind of ['carga','viagem','carregamento']) {
      const alias=kind==='carga'?'c':'v',table=tableName(kind==='carga'?'cargas_v2':'viagens_v2');
      const fields=['vencida','hoje','amanha','sem_previsao'].map(level=>`COUNT(*) FILTER(WHERE ${forecastFilter(kind,level)})::int AS ${level}`).join(',');
      const {rows}=await pool.query(`SELECT ${fields} FROM ${table} ${alias}`);
      result[kind]=rows[0];
    }
    res.set('Cache-Control','no-store').json(result);
  }catch(error){next(error);}
});
acompanhamentoRouter.get('/cargas-viagens-v2/nao-carregadas',async(req,res,next)=>{
  try {
    const {rows}=await pool.query(`SELECT codigo_carga AS codigo,cliente,cidade_origem AS origem,cidade_destino AS destino,responsavel_erp->>'nome' AS responsavel,acompanhamento FROM ${tableName('cargas_v2')} WHERE status='nao_carregada' ORDER BY atualizado_em DESC,id DESC`);
    res.json(rows);
  }catch(error){next(error);}
});
acompanhamentoRouter.post('/cargas-viagens-v2/cargas/:id/nao-carregada',async(req,res,next)=>{
  let db;
  try {
    const {motivo,observacoes='',reabrir=false}=req.body || {};
    if(typeof reabrir!=='boolean' || typeof observacoes!=='string' || observacoes.trim().length>500) fail('Dados da justificativa inválidos.');
    if(reabrir ? typeof motivo!=='string'||motivo.trim().length<5||motivo.length>500 : !motivosNaoCarregada.includes(motivo)) fail('Informe o motivo.');
    if(!reabrir && motivo==='Outro' && observacoes.trim().length<5) fail('Descreva o motivo em Observações.');
    db=await pool.connect();await db.query('BEGIN');
    const {rows}=await db.query(`SELECT status,acompanhamento FROM ${tableName('cargas_v2')} WHERE id=$1 FOR UPDATE`,[req.params.id]);
    if(!rows[0]) fail('Carga não encontrada.',404);
    if(rows[0].status!==(reabrir?'nao_carregada':'aguardando_viagem')) fail('A situação da carga mudou. Atualize a lista antes de continuar.',409);
    const link=await db.query(`SELECT carga_id FROM ${tableName('viagem_cargas_v2')} WHERE carga_id=$1`,[req.params.id]);
    if(link.rowCount) fail('Remova a carga da viagem antes de registrar que não foi carregada.',409);
    if(!reabrir) {
      const docs=await db.query(`SELECT id FROM ${tableName('carga_documentos_v2')} WHERE carga_id=$1`,[req.params.id]);
      if(docs.rowCount) fail('Confira e desvincule os documentos desta carga antes de registrar que não foi carregada.',409);
    }
    const old=rows[0].acompanhamento || {};
    const entry={tipo:reabrir?'reabertura':'nao_carregada',motivo:motivo.trim(),observacoes:observacoes.trim(),usuario:req.user?.login || '',em:new Date().toISOString()};
    const data={...old,naoCarregada:reabrir?null:entry,historico:[...(old.historico || []),entry]};
    await db.query(`UPDATE ${tableName('cargas_v2')} SET status=$2,acompanhamento=$3::jsonb,atualizado_por_id=$4,atualizado_por_login=$5,atualizado_em=NOW() WHERE id=$1`,[req.params.id,reabrir?'aguardando_viagem':'nao_carregada',JSON.stringify(data),req.user?.id || null,req.user?.login || null]);
    await db.query('COMMIT');res.json({ok:true});
  }catch(error){if(db)await db.query('ROLLBACK');next(error);}finally{db?.release();}
});
