import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {pool} from '../src/db/pool.js';
import {cargasViagensV2Router} from '../src/routes/cargasViagensV2.js';

function setup(t, status='reprovada') {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('SELECT viagem_id'))return {rows:[],rowCount:0};
    return {rows:[{id:1,status:'aguardando_cte',status_aprovacao:status,documentos:[],paradas:[],cargas:[]}],rowCount:1};
  };
  t.mock.method(pool,'connect',async()=>({query,release(){}}));
  t.mock.method(pool,'query',query);
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:2,login:'operador',admin:false,permissions:{viagens:true}};next();});app.use(cargasViagensV2Router);app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
  return {app,calls};
}
const input={cliente:'Cliente',clienteFinal:'Entrega',tomadorServico:'Tomador',origem:'Origem',ufOrigem:'SC',destino:'Destino',ufDestino:'SP',valorCliente:500};
test('aprovar e reprovar estão desativados sem alterar banco',async t=>{
 const {app,calls}=setup(t);
 for(const acao of ['aprovar','reprovar','enviar'])await request(app).post('/cargas-viagens-v2/cargas/1/aprovacao').send({acao}).expect(410);
 assert.equal(calls.length,0);
});
test('cadastra carga sem permissão de aprovação e ignora status enviado',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/cargas').send({...input,statusAprovacao:'aprovada'}).expect(201);
 const insert=calls.find(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('status_aprovacao'));
 assert.ok(insert);assert.ok(!insert.params.includes('aprovada'));assert.ok(calls.some(c=>c.sql==='COMMIT'));
});
test('edita carga anteriormente aprovada sem exigir reabertura',async t=>{
 const {app,calls}=setup(t,'aprovada');
 await request(app).put('/cargas-viagens-v2/cargas/1').send(input).expect(200);
 assert.ok(calls.some(c=>c.sql.includes('SET data=')));assert.ok(calls.some(c=>c.sql==='COMMIT'));
});
test('programa veículo em carga reprovada pelo fluxo antigo',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/viagens').send({placa:'RXO6C18',tipoPropriedade:'FROTA',cargaIds:[1]}).expect(201);
 assert.ok(calls.some(c=>c.sql.includes("status='aguardando_cte'")));
});
test('vincula CT-e sem aprovação e mantém transição operacional',async t=>{
 const {app,calls}=setup(t);
 await request(app).put('/cargas-viagens-v2/cargas/1/documentos').send({documentos:[{tipo:'CT-e',numero:'123'}]}).expect(200);
 assert.ok(calls.some(c=>c.sql.includes('SET status=$2')&&c.params[1]==='em_transito'));
});
test('validação obrigatória de carga continua ativa',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/cargas').send({}).expect(400);
 assert.ok(!calls.some(c=>c.sql.includes('INSERT')));
});
