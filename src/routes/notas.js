import express from 'express';
import {z} from 'zod';
import {pool} from '../db/pool.js';
import {clientPool} from '../db/clientPool.js';
import {tableName} from '../config.js';
import {requirePermission} from '../middleware/permissions.js';
import {enforceReadOnly} from '../middleware/readOnly.js';
export const notasRouter=express.Router();
const table=()=>tableName('bloco_notas');
const bodySchema=z.object({id:z.uuid(),title:z.string().trim().max(120),plate:z.string().regex(/^$|^[A-Z]{3}\d[A-Z0-9]\d{2}$/),text:z.string().trim().min(1).max(20000),version:z.number().int().nonnegative()}).strict().refine(body=>body.title||body.plate);
const record=(row,user)=>({authorId:row.usuario_id,authorName:row.autor||(row.usuario_id===user.id?user.login:null)||null,canEdit:row.usuario_id===user.id&&!user.readOnly,id:row.id,title:row.titulo,plate:row.placa,text:row.texto,version:row.revisao,updatedAt:row.atualizado_em,createdAt:row.criado_em});
notasRouter.use('/notas',requirePermission('bloco-notas'),enforceReadOnly,(req,res,next)=>{
 if(!req.user?.id)return res.status(401).json({error:'Autenticação necessária.'});
 res.set('Cache-Control','no-store');next();
});
notasRouter.get('/notas/placas',async(req,res,next)=>{
 try {const {rows}=await clientPool.query(`SELECT DISTINCT upper(trim(placavei)) AS plate FROM frotas.veiculos WHERE situacaovei::text='1' AND NULLIF(trim(placavei),'') IS NOT NULL ORDER BY 1`);res.json({plates:rows.map(row=>row.plate)});}catch(error){next(error);}
});
// Tasks remain personal; saved notes are readable by everyone granted notes access.
const taskTable=()=>tableName('bloco_notas_tarefas');
const plateSchema=z.string().regex(/^[A-Z]{3}\d[A-Z0-9]\d{2}$/);
const taskRecord=row=>({id:row.id,plate:row.placa,title:row.titulo,done:row.concluida,version:row.revisao,updatedAt:row.atualizado_em});
async function fleet(){
 const [vehicles,links]=await Promise.all([
  clientPool.query(`SELECT DISTINCT ON (upper(trim(placavei))) upper(trim(placavei)) AS plate, COALESCE(NULLIF(trim(modelovei),''),NULLIF(trim(marcamodelorenavamvei),''),NULLIF(trim(nomevei),''),'') AS model,tipovei,tipoveiculoctevei,numeroeixosvei FROM frotas.veiculos WHERE situacaovei::text='1' AND tipopropriedadevei::text='P' AND NULLIF(trim(placavei),'') IS NOT NULL ORDER BY 1`),
  clientPool.query('SELECT placa_principal,placa_reboque1,placa_reboque2,placa_reboque3 FROM frotas.veiculosreboquesmotoristas')
 ]);
 const normalize=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const trailers=new Map();
 for(const row of links.rows){const main=normalize(row.placa_principal);if(!main)continue;trailers.set(main,[...new Set([...(trailers.get(main)||[]),...[row.placa_reboque1,row.placa_reboque2,row.placa_reboque3].map(normalize).filter(p=>plateSchema.safeParse(p).success&&p!==main)])]);}
 return vehicles.rows.map(row=>{
  const plate=normalize(row.plate),implementsList=trailers.get(plate)||[];
  const parent=[...trailers].find(([,items])=>items.includes(plate))?.[0]||null;
  const model=(row.model||'').trim();
  const trailer=Boolean(parent)||Number(row.tipoveiculoctevei)===1||Number(row.tipovei)===2||/^(SR|R)\//i.test(model);
  const car=!trailer&&Number(row.numeroeixosvei)>0&&Number(row.numeroeixosvei)<=2&&Number(row.tipovei)!==1;
  return {plate,model:/^VE[IÍ]CULO\s/i.test(model)?'Modelo não informado':model||'Modelo não informado',category:trailer?'implemento':car?'carro':implementsList.length?'carreta':'caminhao',parentPlate:parent,implements:implementsList};
 }).filter(v=>plateSchema.safeParse(v.plate).success);
}
notasRouter.get('/notas/frota',async(req,res,next)=>{try{res.json({vehicles:await fleet()});}catch(error){next(error);}});
notasRouter.get('/notas/tarefas',async(req,res,next)=>{
 try{const {rows}=await pool.query(`SELECT * FROM ${taskTable()} WHERE usuario_id=$1 ORDER BY criado_em DESC,id,placa`,[req.user.id]);res.json({tasks:rows.map(taskRecord)});}catch(error){next(error);}
});
notasRouter.post('/notas/tarefas',async(req,res,next)=>{
 const parsed=z.object({id:z.uuid(),title:z.string().trim().min(1).max(200),plates:z.array(plateSchema).min(1).max(1000)}).strict().safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Informe a tarefa e selecione ao menos uma placa.'});
 try{
  const body=parsed.data,plates=[...new Set(body.plates)],allowed=new Set((await fleet()).filter(v=>v.category!=='implemento').map(v=>v.plate));
  if(plates.some(p=>!allowed.has(p)))return res.status(400).json({error:'Uma das placas não pertence à frota. Atualize a lista.'});
  // One statement creates the whole batch atomically; the ID makes retries safe.
  await pool.query(`INSERT INTO ${taskTable()} (id,usuario_id,placa,titulo) SELECT $1,$2,unnest($3::varchar[]),$4 ON CONFLICT (usuario_id,id,placa) DO NOTHING`,[body.id,req.user.id,plates,body.title]);
  const {rows}=await pool.query(`SELECT * FROM ${taskTable()} WHERE usuario_id=$1 AND id=$2 ORDER BY placa`,[req.user.id,body.id]);
  if(rows.length!==plates.length||rows.some(r=>r.titulo!==body.title||!plates.includes(r.placa)))return res.status(409).json({error:'Esta tarefa já foi lançada com outros dados. Atualize a lista.'});
  res.json({tasks:rows.map(taskRecord)});
 }catch(error){next(error);}
});
notasRouter.patch('/notas/tarefas/:id/:plate',async(req,res,next)=>{
 const parsed=z.object({done:z.boolean(),version:z.number().int().positive()}).strict().safeParse(req.body);
 if(!parsed.success||!z.uuid().safeParse(req.params.id).success||!plateSchema.safeParse(req.params.plate).success)return res.status(400).json({error:'Tarefa inválida.'});
 try{const {rows}=await pool.query(`UPDATE ${taskTable()} SET concluida=$4,revisao=revisao+1,atualizado_em=now() WHERE usuario_id=$1 AND id=$2 AND placa=$3 AND revisao=$5 RETURNING *`,[req.user.id,req.params.id,req.params.plate,parsed.data.done,parsed.data.version]);
 if(!rows.length)return res.status(409).json({error:'Tarefa alterada em outro aparelho. Atualize e tente novamente.'});res.json({task:taskRecord(rows[0])});
 }catch(error){next(error);}
});
notasRouter.get('/notas',async(req,res,next)=>{
 const query=z.string().trim().max(120).safeParse(req.query.q||'');
 const plate=z.string().regex(/^$|^[A-Z]{3}\d[A-Z0-9]\d{2}$/).optional().safeParse(req.query.plate);
 if(!plate.success)return res.status(400).json({error:'Placa inválida.'});
 if(!query.success)return res.status(400).json({error:'Busca inválida.'});
 try {
  const {rows}=await pool.query(`SELECT id,usuario_id,(SELECT login FROM ${tableName('usuarios')} WHERE id=n.usuario_id) AS autor,titulo,placa,left(texto,160) AS texto,revisao,atualizado_em,criado_em FROM ${table()} n
   WHERE excluido_em IS NULL AND ($1='' OR strpos(lower(titulo || ' ' || placa || ' ' || texto),lower($1))>0)
   AND ($2::text IS NULL OR placa=$2) ORDER BY atualizado_em DESC,id LIMIT 101`,[query.data,plate.data??null]);
  res.json({notes:rows.slice(0,100).map(row=>record(row,req.user)),hasMore:rows.length>100});
 }catch(error){next(error);}
});
notasRouter.get('/notas/:id',async(req,res,next)=>{
 if(!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Nota inválida.'});
 try {const {rows}=await pool.query(`SELECT n.*,(SELECT login FROM ${tableName('usuarios')} WHERE id=n.usuario_id) AS autor FROM ${table()} n WHERE id=$1 AND excluido_em IS NULL`,[req.params.id]);
  if(!rows[0])return res.status(404).json({error:'Nota não encontrada.'});res.json({note:record(rows[0],req.user)});
 }catch(error){next(error);}
});
// Client-generated IDs make retries safe; versions protect simultaneous edits.
notasRouter.put('/notas/:id',async(req,res,next)=>{
 const parsed=bodySchema.safeParse(req.body);
 if(!parsed.success || parsed.data.id!==req.params.id)return res.status(400).json({error:'Informe título ou placa e o texto da nota (até 20.000 caracteres).'});
 const body=parsed.data;
 try {
  let rows;
  if(body.version===0){
   ({rows}=await pool.query(`INSERT INTO ${table()} (id,usuario_id,titulo,placa,texto) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING *`,[body.id,req.user.id,body.title,body.plate,body.text]));
  }else{
   ({rows}=await pool.query(`UPDATE ${table()} SET titulo=$3,placa=$4,texto=$5,revisao=revisao+1,atualizado_em=now() WHERE id=$1 AND usuario_id=$2 AND revisao=$6 AND excluido_em IS NULL RETURNING *`,[body.id,req.user.id,body.title,body.plate,body.text,body.version]));
  }
  if(rows[0])return res.json({note:record(rows[0],req.user)});
  const current=(await pool.query(`SELECT * FROM ${table()} WHERE id=$1 AND usuario_id=$2 AND excluido_em IS NULL`,[body.id,req.user.id])).rows[0];
  if(!current)return res.status(404).json({error:'Nota não encontrada ou removida. Salve seu texto como uma nova nota.'});
  if(current.titulo===body.title&&current.placa===body.plate&&current.texto===body.text)return res.json({note:record(current,req.user)});
  res.status(409).json({error:'Esta nota foi alterada em outro aparelho. Seu rascunho foi preservado. Reabra a nota ou salve como nova nota.'});
 }catch(error){next(error);}
});
notasRouter.delete('/notas/:id',async(req,res,next)=>{
 const parsed=z.object({version:z.number().int().positive()}).strict().safeParse(req.body);
 if(!parsed.success||!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Nota inválida.'});
 try {const {rows}=await pool.query(`UPDATE ${table()} SET excluido_em=now(),atualizado_em=now(),revisao=revisao+1 WHERE id=$1 AND usuario_id=$2 AND revisao=$3 AND excluido_em IS NULL RETURNING id`,[req.params.id,req.user.id,parsed.data.version]);
  if(!rows.length)return res.status(409).json({error:'Nota alterada ou removida. Atualize antes de excluir.'});res.json({ok:true});
 }catch(error){next(error);}
});
