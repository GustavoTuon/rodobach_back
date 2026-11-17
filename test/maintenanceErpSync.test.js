import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {config, quoteIdent} from '../src/config.js';
import {pool} from '../src/db/pool.js';
import {isEngineOilChange, oilPlans, syncMaintenanceErp} from '../src/services/maintenanceErpSync.js';

test('identifies explicit oil change without confusing products, filters or other fluids', () => {
  for (const name of ['Troca de óleo', '(S) - TROCAR ÓLEO', 'VW - Troca de oleo motor']) assert.ok(isEngineOilChange(name));
  for (const name of ['Óleo motor 15W40','Filtro de óleo','Troca de óleo câmbio','Troca óleo diferencial','Completar óleo','Troca de filtro intermediário']) assert.equal(isEngineOilChange(name), false);
  const plan = {id: 1, titulo:'Troca de óleo', placa:'ABC-1D23',ativo:true,tipo_controle:'km',intervalo_km:40000};
  assert.equal(oilPlans([plan], 'ABC1D23').length, 1);
  assert.equal(oilPlans([{...plan,ativo:false}], 'ABC1D23').length, 0);
  assert.equal(oilPlans([plan], 'XYZ1234').length, 0);
});

test('ERP import baselines, retries incomplete OS, deduplicates and updates deadlines atomically', async () => {
  const client = await pool.connect();
  const original = config.db.schema;
  const schema = `test_os_erp_${process.pid}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}`);
    config.db.schema = schema;
    await client.query(await fs.readFile(new URL('../sql/092_manutencao_os_erp.sql', import.meta.url),'utf8'));
    await client.query(`CREATE TABLE automacao_mensagem_manutencao (
      id int primary key, placa text, titulo text, ativo boolean, tipo_controle text,
      intervalo_km int, km_proximo_envio int, data_ultimo_servico date, data_proximo_envio date,
      intervalo_dias int, atualizado_em timestamptz);
      CREATE TABLE historico_manutencao_veiculo (id serial primary key, automacao_id int,
      placa text,tipo_movimento text,descricao text,data_servico date,km_servico int,
      fornecedor text,documento text,observacao text,criado_por int);
      INSERT INTO automacao_mensagem_manutencao(id,placa,titulo,ativo,tipo_controle,intervalo_km,km_proximo_envio)
      VALUES(1,'ABC1D23','Troca de óleo',true,'km',40000,140000),
      (2,'ABC1D23','Troca de filtro intermediário',true,'km',20000,120000);`);
    const db = {connect: async () => ({release(){}, query(sql, params) {
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return Promise.resolve({rows:[]});
      // This test owns an isolated schema, so it must not compete with a live sync.
      if (sql === 'SELECT pg_try_advisory_xact_lock(78482933) AS acquired') {
        return client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [schema]);
      }
      return client.query(sql,params);
    }})};
    const order = {chave:'old',numero:1,km:130000,data:'2026-01-02',servicos:[{descricao:'Troca de óleo',placa:'ABC-1D23'}]};
    let orders = [order];
    const run = () => syncMaintenanceErp({db,load:async()=>orders,readOnly:false});
    assert.equal((await run()).baseline,1);
    assert.equal((await run()).importados,0);
    orders.push({...order,chave:'new',km:0});
    assert.equal((await run()).pendentes,1);
    orders[1].km=130000;
    assert.equal((await run()).importados,1);
    assert.equal((await run()).importados,0);
    assert.deepEqual((await client.query('SELECT km_proximo_envio FROM automacao_mensagem_manutencao ORDER BY id')).rows.map(r=>r.km_proximo_envio),[170000,120000]);
    orders.push({...order,chave:'backdated',data:'2026-01-01',km:110000});
    await run();
    assert.equal((await client.query('SELECT km_proximo_envio FROM automacao_mensagem_manutencao WHERE id=1')).rows[0].km_proximo_envio,170000);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM historico_manutencao_veiculo')).rows[0].n,2);
    orders.push({...order,chave:'multi',servicos:[...order.servicos,{descricao:'Troca de óleo',placa:'XYZ1234'}]});
    assert.equal((await run()).pendentes,1);
    assert.deepEqual(await syncMaintenanceErp({readOnly:true}),{ignorado:true});
  } finally {
    config.db.schema=original;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
