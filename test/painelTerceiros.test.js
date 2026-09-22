import test from 'node:test';
import assert from 'node:assert/strict';
import {activeRodobachPlates} from '../src/services/painelTerceiros.js';
test('only active Rodobach SMs qualify; plates normalize and deduplicate',()=>{
 const sm={placa:'IRF-0D29',transportador:'RODOBACH',statusCodigo:1};
 assert.deepEqual(activeRodobachPlates([sm,sm,{...sm,fim:'22/09/2026 12:00:00'},
  {...sm,placa:'ABC1234',transportador:'Outra empresa'},
  {...sm,placa:'DEF1234',statusCodigo:5},{...sm,placa:''}]),['IRF0D29']);
});
