import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVolumes,validateCargaVolumes} from '../src/services/cargaVolumes.js';
test('volumes distinguem vazio e zero e rejeitam frações, negativos e excesso',()=>{
  assert.equal(parseVolumes(''),null);assert.equal(parseVolumes(0),0);assert.equal(parseVolumes('23'),23);
  for(const invalid of [-1,1.5,'abc',2147483648,true])assert.throws(()=>parseVolumes(invalid));
  assert.equal(validateCargaVolumes({volumes:23,paradas:[{tipo:'entrega',volumes:10},{tipo:'entrega',volumes:13},{tipo:'coleta',volumes:23}]}),23);
  assert.throws(()=>validateCargaVolumes({volumes:23,paradas:[{tipo:'entrega',volumes:24}]}));
  assert.throws(()=>validateCargaVolumes({volumes:23,paradas:[{tipo:'coleta',volumes:24}]}));
});
