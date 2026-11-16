import express from 'express';
import {z} from 'zod';
import {pool} from '../db/pool.js';
import {tableName} from '../config.js';
import {requirePermission} from '../middleware/permissions.js';
import {enforceReadOnly} from '../middleware/readOnly.js';
import {erpColaboradores,registroSchema} from '../services/colaboradoresService.js';

export const colaboradoresRouter=express.Router();
const table=()=>tableName('colaboradores_registros');
const history=()=>tableName('colaboradores_registros_historico');
const codigoSchema=z.coerce.number().int().positive().max(2147483647);
colaboradoresRouter.use('/frota/colaboradores',requirePermission('colaboradores'),enforceReadOnly);
colaboradoresRouter.get('/frota/colaboradores',async(req,res,next)=>{
 const query=z.object({situacao:z.enum(['ativos','todos','inativos']).default('ativos'),q:z.string().trim().max(120).default('')}).safeParse(req.query);
 if(!query.success)return res.status(400).json({error:'Filtro inválido.'});
 try{
  const [people,summary]=await Promise.all([erpColaboradores(),pool.query(`SELECT colaborador_codigo,
   count(*) FILTER(WHERE status<>'cancelado')::integer AS total,
   count(*) FILTER(WHERE status='concluido')::integer AS concluidos,
   count(*) FILTER(WHERE status='pendente')::integer AS pendentes,
   count(*) FILTER(WHERE status='pendente' AND prazo<(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)::integer AS atrasados,
   count(*) FILTER(WHERE tipo='ferias' AND status<>'cancelado' AND detalhes->>'inicio'<=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AND detalhes->>'fim'>=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'))::integer AS ferias
   FROM ${table()} GROUP BY colaborador_codigo`)]);
  const summaries=new Map(summary.rows.map(r=>[r.colaborador_codigo,r]));
  const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const itens=people.filter(p=>(query.data.situacao==='todos'||(query.data.situacao==='ativos'?p.ativo:!p.ativo))&&normalize(`${p.nome} ${p.codigo} ${p.cargo}`).includes(normalize(query.data.q)))
   .map(p=>({...p,resumo:summaries.get(p.codigo)||{total:0,concluidos:0,pendentes:0,atrasados:0,ferias:0}}));
  res.json({itens,totalErp:people.length,atualizadoEm:new Date().toISOString()});
 }catch(error){next(error);}
});
colaboradoresRouter.get('/frota/colaboradores/:codigo',async(req,res,next)=>{
 const parsed=codigoSchema.safeParse(req.params.codigo);
 if(!parsed.success)return res.status(400).json({error:'Colaborador inválido.'});
 try{
  const [people,records]=await Promise.all([erpColaboradores(parsed.data),pool.query(`SELECT r.*,to_char(r.data,'YYYY-MM-DD') AS data,to_char(r.prazo,'YYYY-MM-DD') AS prazo,u.login AS autor,a.login AS atualizado_por_nome FROM ${table()} r LEFT JOIN ${tableName('usuarios')} u ON u.id=r.autor_id LEFT JOIN ${tableName('usuarios')} a ON a.id=r.atualizado_por WHERE colaborador_codigo=$1 ORDER BY r.data DESC,r.criado_em DESC`,[parsed.data])]);
  if(!people[0])return res.status(404).json({error:'Colaborador não encontrado no ERP.'});
  // Attachment bytes are only returned by the explicit download endpoint.
  res.json({colaborador:people[0],registros:records.rows.map(r=>({...r,anexos:r.anexos.map((a,index)=>({nome:a.nome,index}))}))});
 }catch(error){next(error);}
});
colaboradoresRouter.get('/frota/colaboradores/:codigo/registros/:id/anexos/:index',async(req,res,next)=>{
 const code=codigoSchema.safeParse(req.params.codigo),id=z.uuid().safeParse(req.params.id),index=z.coerce.number().int().min(0).max(2).safeParse(req.params.index);
 if(!code.success||!id.success||!index.success)return res.status(400).json({error:'Anexo inválido.'});
 try{const {rows}=await pool.query(`SELECT anexos FROM ${table()} WHERE id=$1 AND colaborador_codigo=$2`,[id.data,code.data]);const a=rows[0]?.anexos[index.data];if(!a)return res.status(404).json({error:'Anexo não encontrado.'});res.json(a);}catch(error){next(error);}
});
colaboradoresRouter.put('/frota/colaboradores/:codigo/registros/:id',async(req,res,next)=>{
 const code=codigoSchema.safeParse(req.params.codigo),parsed=registroSchema.safeParse(req.body);
 if(!code.success||!parsed.success||parsed.data.id!==req.params.id)return res.status(400).json({error:parsed.error?.issues?.[0]?.message||'Registro inválido.'});
 try{
  const person=(await erpColaboradores(code.data))[0];if(!person)return res.status(404).json({error:'Colaborador não encontrado no ERP.'});
  const b=parsed.data;
  const values=[b.id,code.data,person.nome,person.empresa,b.tipo,b.data,b.prazo,b.status,b.descricao,b.responsavel,JSON.stringify(b.detalhes),JSON.stringify(b.anexos),req.user.id,b.version];
  const mutation=b.version===0?`INSERT INTO ${table()} (id,colaborador_codigo,colaborador_nome,empresa,tipo,data,prazo,status,descricao,responsavel,detalhes,anexos,autor_id,atualizado_por)
   SELECT $1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$13 WHERE $14::integer=0 ON CONFLICT(id) DO NOTHING RETURNING *`
   :`UPDATE ${table()} SET colaborador_nome=$3,empresa=$4,tipo=$5,data=$6,prazo=$7,status=$8,descricao=$9,responsavel=$10,detalhes=$11,anexos=$12,atualizado_por=$13,revisao=revisao+1,atualizado_em=now() WHERE id=$1 AND colaborador_codigo=$2 AND revisao=$14 RETURNING *`;
  const {rows}=await pool.query(`WITH saved AS (${mutation}), audit AS (INSERT INTO ${history()} (registro_id,revisao,usuario_id,registro) SELECT id,revisao,atualizado_por,to_jsonb(saved)-'anexos' FROM saved RETURNING registro_id) SELECT id,revisao FROM saved`,values);
  if(rows.length)return res.json({id:rows[0].id,version:rows[0].revisao});
  // A retry after a lost response is safe, but may never overwrite a newer revision.
  const existing=(await pool.query(`SELECT *,to_char(data,'YYYY-MM-DD') AS data,to_char(prazo,'YYYY-MM-DD') AS prazo FROM ${table()} WHERE id=$1 AND colaborador_codigo=$2`,[b.id,code.data])).rows[0];
  const equal=(a,c)=>JSON.stringify(a,Object.keys(a||{}).sort())===JSON.stringify(c,Object.keys(c||{}).sort());
  if(existing&&existing.revisao===b.version+1&&existing.atualizado_por===req.user.id&&['tipo','data','prazo','status','descricao','responsavel'].every(k=>existing[k]===b[k])&&equal(existing.detalhes,b.detalhes)&&existing.anexos.length===b.anexos.length&&existing.anexos.every((a,i)=>a.nome===b.anexos[i].nome&&a.data===b.anexos[i].data))return res.json({id:b.id,version:existing.revisao});
  res.status(409).json({error:'Este registro foi alterado. Atualize a ficha antes de salvar novamente.'});
 }catch(error){next(error);}
});
