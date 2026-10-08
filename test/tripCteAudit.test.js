import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTripCtes, classifyTripCtes } from '../src/services/tripCteAudit.js';
import { clientPool } from '../src/db/clientPool.js';
const trip = {empresa:1,numero:22,placa:'ABC-1234',saida:'2026-09-01',chegada:'2026-09-03'};
test('separa faltantes, outra empresa, duplicados e documentos fora do período',()=>{
  const rows = [
    {noPeriodo:true,vinculos:[]},
    {noPeriodo:true,vinculos:[{empresa:1,numero:22}]},
    {noPeriodo:true,vinculos:[{empresa:2,numero:22}]},
    {noPeriodo:true,vinculos:[{empresa:1,numero:22},{empresa:1,numero:23}]},
    {noPeriodo:false,vinculos:[{empresa:1,numero:22}]},
  ];
  const audit=classifyTripCtes(rows,trip);
  assert.deepEqual(audit.documentos.map(d=>d.situacao),['sem_vinculo','outra_viagem','duplicado','vinculado','vinculado']);
  assert.equal(audit.emitidos,4);assert.equal(audit.vinculados,2);assert.equal(audit.semVinculo,1);assert.equal(audit.divergencias,2);assert.equal(audit.pendencias,3);
});
test('não conclui conferência sem placa ou período válido',async t=>{
  const query=t.mock.method(clientPool,'query',async()=>{throw Error('Não deve consultar');});
  for(const changes of [{saida:null},{chegada:null},{placa:''},{chegada:'2026-08-30'}]) assert.equal((await auditTripCtes({...trip,...changes})).disponivel,false);
  assert.equal(query.mock.callCount(),0);
});
test('consulta apenas emitidos com datas inclusivas e identidade completa do CT-e',async t=>{
  const query=t.mock.method(clientPool,'query',async()=>({rows:[]}));
  const audit=await auditTripCtes(trip);
  const [sql,params]=query.mock.calls[0].arguments;
  assert.deepEqual(params,[1,22,'2026-09-01','2026-09-03','ABC1234']);
  assert.match(sql,/c.statuscon=2/);assert.match(sql,/BETWEEN \$3::date AND \$4::date/);
  assert.match(sql,/r.statusrec IN \(1,2\)/);assert.match(sql,/rv.serieconhecimento=c.seriecon/);
  assert.match(sql,/r.parcelarec=rc.parcelarcc/);assert.match(sql,/same_code.codigocon=c.codigocon\)=1/);
  assert.match(sql,/l.empresa=c.empresacon AND l.serie=c.seriecon AND l.codigo=c.codigocon/);
  assert.match(sql,/l."empresaViagem"=\$1 AND l.viagem=\$2/);
  assert.equal(audit.emitidos,0);assert.equal(audit.pendencias,0);
});

test('emissão anterior não invalida vínculo; placa errada e duplicidade continuam pendentes',()=>{
  const audit=classifyTripCtes([
    {codigo:4302,placa:'ABC1234',noPeriodo:false,vinculos:[{empresa:1,numero:22}]},
    {codigo:2,placa:'XYZ9876',noPeriodo:false,vinculos:[{empresa:1,numero:22}]},
    {codigo:3,placa:'ABC1234',noPeriodo:false,vinculos:[{empresa:1,numero:22},{empresa:2,numero:22}]}
  ],trip);
  assert.equal(audit.documentos.find(d=>d.codigo===4302).situacao,'vinculado');
  assert.equal(audit.documentos.find(d=>d.codigo===2).situacao,'placa_divergente');
  assert.equal(audit.documentos.find(d=>d.codigo===3).situacao,'duplicado');
  assert.equal(audit.pendencias,2);
});
