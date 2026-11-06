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
const record=row=>({id:row.id,title:row.titulo,plate:row.placa,text:row.texto,version:row.revisao,updatedAt:row.atualizado_em,createdAt:row.criado_em});
notasRouter.use('/notas',requirePermission('bloco-notas'),enforceReadOnly,(req,res,next)=>{
 if(!req.user?.id)return res.status(401).json({error:'Autenticação necessária.'});
 res.set('Cache-Control','no-store');next();
});
notasRouter.get('/notas/placas',async(req,res,next)=>{
 try {const {rows}=await clientPool.query(`SELECT DISTINCT upper(trim(placavei)) AS plate FROM frotas.veiculos WHERE situacaovei::text='1' AND NULLIF(trim(placavei),'') IS NOT NULL ORDER BY 1`);res.json({plates:rows.map(row=>row.plate)});}catch(error){next(error);}
});
notasRouter.get('/notas',async(req,res,next)=>{
 const query=z.string().trim().max(120).safeParse(req.query.q||'');
 if(!query.success)return res.status(400).json({error:'Busca inválida.'});
 try {
  const {rows}=await pool.query(`SELECT id,titulo,placa,left(texto,160) AS texto,revisao,atualizado_em,criado_em FROM ${table()}
   WHERE usuario_id=$1 AND excluido_em IS NULL AND ($2='' OR strpos(lower(titulo || ' ' || placa || ' ' || texto),lower($2))>0)
   ORDER BY atualizado_em DESC,id LIMIT 101`,[req.user.id,query.data]);
  res.json({notes:rows.slice(0,100).map(record),hasMore:rows.length>100});
 }catch(error){next(error);}
});
notasRouter.get('/notas/:id',async(req,res,next)=>{
 if(!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Nota inválida.'});
 try {const {rows}=await pool.query(`SELECT * FROM ${table()} WHERE id=$1 AND usuario_id=$2 AND excluido_em IS NULL`,[req.params.id,req.user.id]);
  if(!rows[0])return res.status(404).json({error:'Nota não encontrada.'});res.json({note:record(rows[0])});
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
  if(rows[0])return res.json({note:record(rows[0])});
  const current=(await pool.query(`SELECT * FROM ${table()} WHERE id=$1 AND usuario_id=$2 AND excluido_em IS NULL`,[body.id,req.user.id])).rows[0];
  if(!current)return res.status(404).json({error:'Nota não encontrada ou removida. Salve seu texto como uma nova nota.'});
  if(current.titulo===body.title&&current.placa===body.plate&&current.texto===body.text)return res.json({note:record(current)});
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
