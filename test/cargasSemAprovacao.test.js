import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {pool} from '../src/db/pool.js';
import {cargasViagensV2Router} from '../src/routes/cargasViagensV2.js';

function setup(t, status='reprovada', operationalStatus='aguardando_cte') {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('SELECT c.id FROM') && params[0]?.length === 0)return {rows:[],rowCount:0};
    if(sql.includes('SELECT carga_id FROM'))return {rows:[],rowCount:0};
    if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:0,com_cte:0,entregues:0}],rowCount:1};
    if(sql.includes('SELECT viagem_id'))return {rows:[],rowCount:0};
    return {rows:[{id:1,status:operationalStatus,status_aprovacao:status,documentos:[],paradas:[],cargas:[]}],rowCount:1};
  };
  t.mock.method(pool,'connect',async()=>({query,release(){}}));
  t.mock.method(pool,'query',query);
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:2,login:'operador',admin:false,permissions:{viagens:true}};next();});app.use(cargasViagensV2Router);app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
  return {app,calls};
}
const input={cliente:'Cliente',clienteFinal:'Entrega',tomadorServico:'Tomador',origem:'Origem',ufOrigem:'SC',destino:'Destino',ufDestino:'SP',valorCliente:500};

test('desvincula o último CT-e sem excluir carga ou viagem e preserva a entrega', async t => {
 const {app,calls}=setup(t,'aprovada','entregue');
 await request(app).put('/cargas-viagens-v2/cargas/1/documentos').send({documentos:[]}).expect(200);
 const deletes=calls.filter(c=>c.sql.startsWith('DELETE'));
 assert.equal(deletes.length,1);
 assert.ok(deletes[0].sql.includes('carga_documentos_v2'));
 assert.deepEqual(deletes[0].params,['1']);
 assert.ok(calls.some(c=>c.sql.includes('SET status=$2') && c.params[1]==='entregue'));
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
});
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
test('salva mais de um CT-e na mesma carga',async t=>{
 const {app,calls}=setup(t);
 await request(app).put('/cargas-viagens-v2/cargas/1/documentos').send({documentos:[
  {tipo:'CT-e',numero:'100',chave:'chave100'},
  {tipo:'CT-e',numero:'200',chave:'chave200'},
  {tipo:'NF-e',numero:'50',chave:'nf50'},
 ]}).expect(200);
 const docs=calls.filter(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('tipo_documento'));
 assert.deepEqual(docs.map(c=>c.params[2]),['100','200','50']);
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
});
test('cadastra carga sem informações comerciais e usa valores padrão',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/cargas').send({}).expect(201);
 const insert=calls.find(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('status_aprovacao'));
 assert.equal(insert.params[1],'');
 assert.equal(insert.params[5],'');
 assert.equal(insert.params[11],0);
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
});

test('edita carga com campos comerciais vazios',async t=>{
 const {app,calls}=setup(t);
 await request(app).put('/cargas-viagens-v2/cargas/1').send({cliente:'Cliente conhecido'}).expect(200);
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
});

test('cadastra viagem sem placa, motorista, valor ou cargas',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/viagens').send({}).expect(201);
 assert.ok(calls.some(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('numero_viagem')));
 assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('(viagem_id,carga_id)')));
});

test('edita viagem incompleta preservando identificador quando vazio',async t=>{
 const {app,calls}=setup(t);
 await request(app).put('/cargas-viagens-v2/viagens/1').send({numero:'',data:'',placa:'',cargaIds:[]}).expect(200);
 assert.ok(calls.some(c=>c.sql.includes('SET data=$2,placa_veiculo=$3')&&!c.sql.includes('numero_viagem=')));
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
});

test('continua impedindo vínculo de carga indisponível',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/viagens').send({cargaIds:[1,2]}).expect(409);
 assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
});

test('reserva número automático e usa o mesmo ao salvar ignorando número digitado',async t=>{
 const {app,calls}=setup(t);
 const {body}=await request(app).post('/cargas-viagens-v2/viagens/numero').expect(200);
 assert.match(body.numero,/^V-\d{4}-0001$/);
 await request(app).post('/cargas-viagens-v2/viagens').send({reservaNumero:body.reservaNumero,numero:'MANUAL'}).expect(201);
 const insert=calls.find(c=>c.sql.includes('INSERT INTO')&&c.sql.includes('numero_viagem'));
 assert.equal(insert.params[1],body.numero);
 assert.equal(calls.filter(c=>c.sql.includes('nextval')).length,1);
});

test('rejeita reserva adulterada antes de gravar a viagem',async t=>{
 const {app,calls}=setup(t);
 await request(app).post('/cargas-viagens-v2/viagens').send({reservaNumero:'invalida'}).expect(400);
 assert.ok(!calls.some(c=>c.sql.includes('INSERT')));
});

test('ignora tentativa de alterar identificador na edição',async t=>{
 const {app,calls}=setup(t);
 await request(app).put('/cargas-viagens-v2/viagens/1').send({numero:'MANUAL'}).expect(200);
 const update=calls.find(c=>c.sql.includes('SET data=$2,placa_veiculo=$3'));
 assert.ok(update);
 assert.ok(!update.params.includes('MANUAL'));
});
