import test from 'node:test';
import assert from 'node:assert/strict';
import {parseElitePosition} from '../src/services/elitePosition.js';
const now=new Date('2026-09-22T20:00:00Z');
const row={veiculo_placa:'IRF0D29',latitude:'-23.5958',longitude:'-49.866',cidade_referencia:'SIQUEIRA CAMPOS - PR',data_computador_bordo:'22/09/2026 16:22:07'};
const html=rows=>`<input type="hidden" id="posicoes" value='${JSON.stringify(rows)}'>`;
test('reads latest vehicle position and uses onboard time in Brasilia timezone',()=>{
 const r=parseElitePosition(html([{...row,data_computador_bordo:'22/09/2026 16:19:00'},row]),'IRF0D29',now);
 assert.equal(r.municipio,'SIQUEIRA CAMPOS');assert.equal(r.uf,'PR');assert.equal(r.fonte,'Elite');
 assert.equal(r.dataHora,'2026-09-22T19:22:07.000Z');assert.equal(r.latitude,-23.5958);
});
test('ignores other vehicles, future positions, missing dates and invalid coordinates',()=>{
 for(const patch of [{veiculo_placa:'RAA8G18'},{data_computador_bordo:'23/09/2026 12:00:00'},
  {data_computador_bordo:null},{latitude:null},{longitude:''},{latitude:100},{longitude:181}]){
  assert.equal(parseElitePosition(html([{...row,...patch}]),'IRF0D29',now),null);
 }
 assert.equal(parseElitePosition('<html>Login</html>','IRF0D29',now),null);
 assert.equal(parseElitePosition(`<input id="posicoes" value='invalid'>`,'IRF0D29',now),null);
});
