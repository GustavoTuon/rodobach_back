import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {pool} from '../src/db/pool.js';
import {cargasViagensV2Router} from '../src/routes/cargasViagensV2.js';
test('falha ao obter conexao ao salvar bonificacao chega ao middleware sem encerrar a API',async t=>{
 t.mock.method(pool,'connect',async()=>{throw new Error('database unavailable');});
 const app=express();app.use(express.json());app.use(cargasViagensV2Router);
 app.use((error,_req,res,_next)=>res.status(503).json({error:error.message}));
 const response=await request(app).put('/cargas-viagens-v2/cargas/4373/documentos').send({bonificacao:true,documentos:[]});
 assert.equal(response.status,503);assert.equal(response.body.error,'database unavailable');
});
