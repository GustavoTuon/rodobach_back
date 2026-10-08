import test from 'node:test';
import assert from 'node:assert/strict';
import {clientPool} from '../src/db/clientPool.js';
import {loadOpenManifestosByPlate} from '../src/services/tripManifestos.js';
test('consulta por placa sem restringir empresa, viagem ou data e preserva identidades iguais de empresas distintas', async t=>{
 const query=t.mock.method(clientPool,'query',async()=>({rows:[
  {placa:'ABC-1234',empresa:1,serie:'1',numero:10,statusCodigo:5},
  {placa:'ABC1234',empresa:2,serie:'1',numero:10,statusCodigo:5}
 ]}));
 const result=await loadOpenManifestosByPlate(['abc-1234','ABC1234','XYZ9876']);
 assert.equal(result.get('ABC1234').length,2);
 assert.deepEqual(result.get('XYZ9876'),[]);
 const [sql,params]=query.mock.calls[0].arguments;
 assert.deepEqual(params,[['ABC1234','XYZ9876']]);
 assert.match(sql,/statusmdf IN \(3,5\)/);
 assert.match(sql,/datahoraencerramentomdf IS NULL/);
 assert.match(sql,/datahoracancelamentomdf IS NULL/);
 assert.doesNotMatch(sql,/empresamdf\s*=|viagemmdf\s*=|INTERVAL|LIMIT/i);
});
test('sem placas não consulta o ERP e falha não é convertida em lista vazia',async t=>{
 const query=t.mock.method(clientPool,'query',async()=>{throw new Error('ERP indisponível')});
 assert.equal((await loadOpenManifestosByPlate([])).size,0);
 assert.equal(query.mock.callCount(),0);
 await assert.rejects(loadOpenManifestosByPlate(['ABC1234']),/ERP indisponível/);
});
