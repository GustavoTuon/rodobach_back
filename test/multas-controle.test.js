import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/routes/multasFrota.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('export const multasFrotaRouter','const multasFrotaRouter');
function setup(row,previous={}) {
  const routes={}, writes=[];
  const client={release(){},async query(sql,args){writes.push({sql,args}); if(sql.startsWith('SELECT *'))return {rows:Object.keys(previous).length?[previous]:[]}; if(sql.startsWith('INSERT INTO controle_multas_frota '))return {rows:[{descontado_motorista:args[11]}]};return {rows:[]};}};
  const context={Router:()=>({get:(path,fn)=>routes[path]=fn,put:(path,fn)=>routes.put=fn}),pool:{connect:async()=>client},clientPool:{query:async()=>({rows:[row]})},tableName:x=>x};
  vm.createContext(context);vm.runInContext(source+';globalThis.mapFine=mapFine;globalThis.groupFines=groupFines;',context);
  return {...context,routes,writes};
}
const row={empresamtr:1,codigomtr:2,descontarmultamotoristamtr:'S',valormtr:100};
test('ERP points distinguish absent values from zero; driver indication starts pending',()=>{
  const ctx=setup(row);assert.equal(ctx.mapFine(row).pontos,null);assert.equal(ctx.mapFine({...row,pontos_infracao:0}).pontos,0);assert.equal(ctx.mapFine(row).controle.statusIndicacao,'pendente');
});
test('manual and ERP deductions stay independent of boleto payment',()=>{
  const ctx=setup(row);assert.equal(ctx.mapFine(row,{descontado_motorista:true}).controle.statusMotorista,'descontado');assert.equal(ctx.mapFine({...row,desconto_realizado:true}).controle.descontoErp,true);assert.equal(ctx.mapFine({...row,pagamtr:true}).controle.descontadoMotorista,false);
});
async function save(ctx,body){const res={status(code){this.code=code;return this;},json(data){this.data=data;}};await ctx.routes.put({params:{empresa:'1',codigo:'2'},body,user:{login:'teste',id:1}},res,error=>{throw error;});return res;}
test('partial indication update preserves notes and deduction, writes audit',async()=>{
  const ctx=setup(row,{status_indicacao:'pendente',observacoes:'Preservar',descontado_motorista:true,descontado_em:'2026-11-01'});
  await save(ctx,{statusIndicacao:'indicada',indicadoEm:'2026-11-06'});
  const write=ctx.writes.find(x=>x.sql.startsWith('INSERT INTO controle_multas_frota '));assert.equal(write.args[7],'Preservar');assert.equal(write.args[11],true);assert.equal(write.args[3],'2026-11-06');assert.ok(ctx.writes.some(x=>x.sql.startsWith('INSERT INTO controle_multas_frota_auditoria')));
});
test('rejects impossible dates and company deduction without persisting',async()=>{
  const ctx=setup(row);assert.equal((await save(ctx,{prazoIndicacao:'2026-02-30'})).code,400);assert.ok(!ctx.writes.some(x=>x.sql.startsWith('INSERT')));
  const company=setup({...row,descontarmultamotoristamtr:'N'});assert.equal((await save(company,{descontadoMotorista:true})).code,400);
});

test('driver groups use identity, keep complete totals and separate same names',()=>{
  const ctx=setup(row);
  const fine=ctx.mapFine({...row,motoristamtr:10,motorista_nome:'João',pontos_infracao:5,veiculomtr:'AAA1A11'});
  const second={...fine,id:'1:3',placa:'BBB2B22',pontos:7};
  const other={...fine,id:'1:4',motoristaCodigo:11};
  const groups=ctx.groupFines([fine,second,other],'motorista');
  assert.equal(groups.length,2);assert.equal(groups[0].pontos,12);assert.equal(groups[0].multas.length,2);assert.equal(groups[0].etapas,6);assert.equal(groups[0].concluidas,0);
  const plates=ctx.groupFines([fine,second],'placa');assert.equal(plates.length,2);
});
test('progress counts only applicable tasks and reports unknown points',()=>{
  const ctx=setup(row);
  const fine=ctx.mapFine({...row,descontarmultamotoristamtr:'N',pagamtr:true});
  const [group]=ctx.groupFines([fine],'motorista');assert.equal(group.progresso,100);assert.equal(group.etapas,1);assert.equal(group.semPontos,1);
});

test('group pagination never splits a driver or truncates point totals',async()=>{
  const ctx=setup(row);
  ctx.clientPool.query=async()=>({rows:[...Array.from({length:45},(_,i)=>({...row,codigomtr:i+1,motoristamtr:10,motorista_nome:'Ana',pontos_infracao:5})),{...row,codigomtr:90,motoristamtr:20,motorista_nome:'Bruno',pontos_infracao:3}]});
  ctx.pool.query=async()=>({rows:[]});
  const res={json(data){this.data=data;}};
  await ctx.routes['/frota/multas']({query:{agrupar:'motorista',pageSize:1}},res,error=>{throw error;});
  assert.equal(res.data.paginacao.totalPages,2);assert.equal(res.data.grupos.length,1);assert.equal(res.data.grupos[0].multas.length,45);assert.equal(res.data.grupos[0].pontos,225);assert.equal(res.data.totalMultas,46);
});

test('filters infraction date inclusively and returns autocomplete options',async()=>{
  const ctx=setup(row);
  ctx.clientPool.query=async()=>({rows:['2025-12-31','2026-01-01','2026-02-01','2026-02-02'].map((date,i)=>({...row,codigomtr:i+1,datainfracaomtr:date,motorista_nome:'Ana',veiculomtr:'AAA1A11'}))});
  ctx.pool.query=async()=>({rows:[]});const res={json(data){this.data=data;}};
  await ctx.routes['/frota/multas']({query:{agrupar:'motorista',infracaoDe:'2026-01-01',infracaoAte:'2026-02-01'}},res,error=>{throw error;});
  assert.equal(res.data.totalMultas,2);assert.equal(res.data.filtroPeriodoSuportado,true);assert.equal(res.data.opcoesFiltros.motoristas[0],'Ana');
});

test('stores and preserves the authority with audit on partial saves',async()=>{
  const ctx=setup(row,{orgao_autuador:'PRF'});
  assert.equal(ctx.mapFine(row,{orgao_autuador:'PRF'}).controle.orgaoAutuador,'PRF');
  await save(ctx,{statusIndicacao:'indicada'});
  assert.equal(ctx.writes.find(x=>x.sql.startsWith('INSERT INTO controle_multas_frota ')).args[14],'PRF');
  const changed=setup(row);await save(changed,{orgaoAutuador:'  DER-SP  '});
  assert.equal(changed.writes.find(x=>x.sql.startsWith('INSERT INTO controle_multas_frota ')).args[14],'DER-SP');
  assert.equal((await save(setup(row),{orgaoAutuador:'x'.repeat(161)})).code,400);
});

test('quick filters and KPI totals share the selected period without counting company fines as deductions',async()=>{
  const ctx=setup(row);ctx.pool.query=async()=>({rows:[]});
  ctx.clientPool.query=async()=>({rows:[
    {...row,codigomtr:1,datainfracaomtr:'2026-01-01'},
    {...row,codigomtr:2,datainfracaomtr:'2026-01-01',desconto_realizado:true,pagamtr:true},
    {...row,codigomtr:3,datainfracaomtr:'2026-01-01',descontarmultamotoristamtr:'N'},
    {...row,codigomtr:4,datainfracaomtr:'2025-01-01'}]});
  const res={json(data){this.data=data;}};
  await ctx.routes['/frota/multas']({query:{agrupar:'motorista',infracaoDe:'2026-01-01',rapido:'a_descontar'}},res,error=>{throw error;});
  assert.equal(res.data.totalMultas,1);assert.equal(res.data.resumo.total,3);assert.equal(res.data.resumo.aDescontar,1);assert.equal(res.data.resumo.descontadas,1);assert.equal(res.data.indicadoresFiltradosVersao,2);
});
