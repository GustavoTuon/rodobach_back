import test from 'node:test';
import assert from 'node:assert/strict';
import {clientPool} from '../src/db/clientPool.js';
import {listResponsaveis,resolveResponsavel} from '../src/services/cargaResponsavel.js';

test('responsável usa cadastro próprio do ERP e ignora nome enviado pelo cliente',async t=>{
  t.mock.method(clientPool,'query',async(sql,values)=>{
    assert.match(sql,/financeiro\.responsaveis/);assert.match(sql,/ativorep='S'/);
    return {rows:values[0]==='9' ? [] : [{codigo:'1',empresa:'1',nome:'Nome ERP'}]};
  });
  assert.deepEqual(await resolveResponsavel({codigo:'1',empresa:'1',nome:'Nome falsificado'}),{codigo:'1',empresa:'1',nome:'Nome ERP'});
  await assert.rejects(resolveResponsavel(null),{statusCode:400});
  await assert.rejects(resolveResponsavel({codigo:'9',empresa:'1'}),{statusCode:400});
  assert.equal((await listResponsaveis('Nome'))[0].nome,'Nome ERP');
});
