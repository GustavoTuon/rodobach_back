import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extraCatalogName} from '../src/services/itineraryExtraCatalog.js';
test('normalizes accents, case and whitespace while preserving display name',()=>{
  const first=extraCatalogName('  Máquina   de Cartão  ');
  assert.equal(first.description,'Máquina de Cartão');
  assert.equal(first.key,extraCatalogName('maquina de cartao').key);
  assert.notEqual(first.key,extraCatalogName('Máquina de cartão 2').key);
});
test('rejects empty, oversized and non-text descriptions',()=>{
  for(const value of ['', '  ', null, {}, 'x'.repeat(201)]) assert.throws(()=>extraCatalogName(value),{status:400});
});
