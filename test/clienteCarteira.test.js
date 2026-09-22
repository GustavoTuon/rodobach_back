import test from 'node:test';
import assert from 'node:assert/strict';
import {carteiraFilters,summarizeCarteira} from '../src/services/clienteCarteiraModel.js';
import {getClienteCarteira,CARTEIRA_SUMMARY_SQL,CARTEIRA_TITLES_SQL} from '../src/services/clienteCarteiraService.js';
import {requireRoutePermission} from '../src/middleware/permissions.js';

test('rota de carteira exige permissão de clientes ou diretoria',()=>{
  for(const [permissions,allowed] of [[{},false],[{clientes:true},true],[{diretoria:true},true],[{'clientes-lucro':true},false]]) {
    let proceeded=false;let status;
    const res={status(value){status=value;return this;},json(){return this;}};
    requireRoutePermission({path:'/financeiro/analise-clientes/carteira',method:'GET',user:{permissions}},res,()=>{proceeded=true;});
    assert.equal(proceeded,allowed);if(!allowed)assert.equal(status,403);
  }
});

test('carteira rejeita filtros inválidos antes de consultar e não aceita período como restrição', () => {
  assert.deepEqual(carteiraFilters({empresa:'todas',startDate:'2026-09-01'}),{empresa:null,cliente:null,faixa:'todas',pagina:1});
  for (const input of [{empresa:'1 OR 1=1'},{empresa:-1},{pagina:0},{cliente:'cnpj:12'},{cliente:['cnpj:12345678']},{faixa:'antigo'}]) {
    assert.throws(()=>carteiraFilters(input),{status:400});
  }
});

test('somatórios preservam centavos e títulos sem vencimento', () => {
  const result=summarizeCarteira([{total:0.1,aVencer:0.1,titulos:1},{total:0.2,semVencimento:0.2,titulos:1}]);
  assert.equal(result.total,0.3); assert.equal(result.semVencimento,0.2);assert.equal(result.titulos,2);
  assert.equal(summarizeCarteira([]).total,0);
});

test('carteira mantém consultas em snapshot somente leitura e libera conexão', async () => {
  const queries=[];let released=false;
  const pool={connect:async()=>({query:async(sql)=>{
    queries.push(sql);
    if(sql.includes('AS atualizado'))return {rows:[{data:'2026-09-16',atualizado:'2026-09-16T15:00:00Z'}]};
    return {rows:[]};
  },release:()=>{released=true;}})};
  const result=await getClienteCarteira({},pool);
  assert.equal(result.resumo.total,0);
  assert.equal(queries[0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(queries.at(-1),'COMMIT');assert.equal(released,true);
});

test('cliente inexistente reverte snapshot e não informa saldo zero inventado', async()=>{
  const queries=[];let released=false;
  const pool={connect:async()=>({query:async sql=>{queries.push(sql);return {rows:sql.includes('AS atualizado')?[{data:'2026-09-16'}]:[]};},release:()=>{released=true;}})};
  await assert.rejects(getClienteCarteira({cliente:'cnpj:12345678'},pool),{status:404});
  assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});

test('SQL real: limites das faixas, títulos antigos, baixa parcial e cadastros duplicados', {skip:process.env.TEST_CARTEIRA_SQL!=='1'}, async()=>{
  const {clientPool}=await import('../src/db/clientPool.js');
  const db=await clientPool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const records=`(SELECT 1 AS empresarec, 'A'::text AS serierec, n AS duplicatarec, 1 AS parcelarec,
      10 AS clienterec, DATE '2022-02-15' AS dataemissaorec, CURRENT_DATE - days AS datavencimentorec,
      100::numeric AS valorduplicatarec, 10.01::numeric AS valorabertorec, 1 AS statusrec
      FROM (VALUES (1,-1),(2,0),(3,1),(4,15),(5,16),(6,30),(7,31),(8,60),(9,61),(10,NULL::int)) v(n,days)
      UNION ALL SELECT 2,'B',11,1,20,DATE '2022-01-01',CURRENT_DATE-100,100,50,1
      UNION ALL SELECT 1,'A',12,1,10,CURRENT_DATE,CURRENT_DATE-5,100,0,1
      UNION ALL SELECT 1,'A',13,1,10,CURRENT_DATE,CURRENT_DATE-5,100,100,3)`;
    const customers=`(SELECT * FROM (VALUES (1,10,'Matriz','Matriz','12345678000101'),(1,10,'Matriz','Matriz','12345678000101'),(2,20,'Filial','Filial','12345678000202')) c(empresacli,codigocli,fantasiacli,nomecli,cnpjcpfcli))`;
    const fixture=sql=>sql.replaceAll('financeiro.receber rec',`${records} rec`).replaceAll('gerais.clientes c',`${customers} c`);
    const {rows:[row]}=await db.query(fixture(CARTEIRA_SUMMARY_SQL),[null]);
    assert.equal(row.titulos,11);assert.equal(Number(row.total),150.1);
    for(const key of ['aVencer','ate15','de16a30','de31a60'])assert.equal(Number(row[key]),20.02);
    assert.equal(Number(row.acima60),60.01);assert.equal(Number(row.semVencimento),10.01);
    const {rows:titles}=await db.query(fixture(CARTEIRA_TITLES_SQL),[1,'cnpj:12345678','ate15',0]);
    assert.equal(titles.length,2);assert.deepEqual(titles.map(t=>t.diasAtraso).sort((a,b)=>a-b),[1,15]);
    assert.ok(titles.every(t=>t.emissao==='2022-02-15'&&Number(t.saldo)===10.01));
    const {rows:company}=await db.query(fixture(CARTEIRA_SUMMARY_SQL),[2]);
    assert.equal(Number(company[0].total),50);
    const many=fixture(CARTEIRA_TITLES_SQL).replace(records,`(SELECT 1 AS empresarec,'A'::text AS serierec,n AS duplicatarec,1 AS parcelarec,10 AS clienterec,DATE '2022-01-01' AS dataemissaorec,CURRENT_DATE-1 AS datavencimentorec,100::numeric AS valorduplicatarec,10::numeric AS valorabertorec,1 AS statusrec FROM generate_series(1,65) n)`);
    const {rows:first}=await db.query(many,[1,'cnpj:12345678','todas',0]);
    const {rows:second}=await db.query(many,[1,'cnpj:12345678','todas',50]);
    assert.equal(first.length,50);assert.equal(second.length,15);
    assert.equal(new Set([...first,...second].map(row=>row.numero)).size,65);
  } finally {await db.query('ROLLBACK');db.release();await clientPool.end();}
});
