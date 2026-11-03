import test from 'node:test';
import assert from 'node:assert/strict';
import {expenseTires,resolveExpenseTire} from '../src/services/expenseTires.js';

const tire={code:'123',company:'2',plate:'ABC1234',position:'D1',positionName:'Dianteiro direito',brand:'Marca',size:'295/80'};
test('lista identificação, posição e marca; exclui registros sem identidade de cadastro',async()=>{
 const result=await expenseTires('ABC1234',async()=>({posicoes:[{codigopop:'D1',nomepop:'Dianteiro direito'}],pneusNoVeiculo:[{codigopne:'123',empresapne:'2',posicao:'D1',marcapne:'Marca',tamanhopne:'295/80'},{codigopne:'99',_semDadosCliente:true}]}));
 assert.deepEqual(result,[{...tire,model:''}]);
});
test('vínculo usa empresa e número e aceita apenas pneu da placa consultada',async()=>{
 const body={plate:'ABC1234',service:'Borracharia',tire:{code:'123',company:'2'}};
 const load=async plate=>{assert.equal(plate,'ABC1234');return [tire];};
 assert.deepEqual(await resolveExpenseTire(body,null,load),tire);
 await assert.rejects(resolveExpenseTire({...body,tire:{code:'123',company:'3'}},null,load),{status:409});
 await assert.rejects(resolveExpenseTire(body,null,async()=>[]),{status:409});
 await assert.rejects(resolveExpenseTire({...body,service:'Mecânica'},null,load),{status:400});
});
test('edição preserva posição histórica sem consultar montagem atual e permite remover vínculo',async()=>{
 const before={placa:'ABC1234',servico:'Borracharia',pneu_vinculado:tire};
 const body={plate:'ABC1234',service:'Borracharia',tire:{code:'123',company:'2'}};
 const noLoad=async()=>{throw new Error('Não consultar pneu movimentado ao editar dados da despesa.');};
 assert.deepEqual(await resolveExpenseTire(body,before,noLoad),tire);
 assert.deepEqual(await resolveExpenseTire({...body,tire:undefined},before,noLoad),tire);
 assert.equal(await resolveExpenseTire({...body,tire:null},before,noLoad),null);
 assert.equal(await resolveExpenseTire({...body,tire:undefined,tireFireNumber:'999'},before,noLoad),null);
 assert.equal(await resolveExpenseTire({...body,tire:undefined,plate:'DEF4G56'},before,noLoad),null);
 await assert.rejects(resolveExpenseTire({...body,plate:'DEF4G56'},before,async()=>[]),{status:409});
});
