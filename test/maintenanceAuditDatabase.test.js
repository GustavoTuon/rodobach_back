import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('PostgreSQL audit triggers preserve before/after, actor, legacy dates and deleted plans', {skip: process.env.MAINTENANCE_AUDIT_DB_TEST !== '1'}, async (t) => {
  const {pool} = await import('../src/db/pool.js');
  const {tableName, config} = await import('../src/config.js');
  const originalSchema = config.db.schema;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = `audit_test_${Date.now()}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    for (const name of ['automacao_mensagem_manutencao', 'historico_manutencao_veiculo', 'manutencao_componentes_posicao', 'manutencao_alertas_enviados', 'manutencao_componentes_alertas_enviados']) {
      await client.query(`CREATE TABLE ${schema}.${name} AS SELECT * FROM ${tableName(name)} WHERE FALSE`);
    }
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const sql = await fs.readFile(new URL('../sql/046_manutencao_auditoria.sql', import.meta.url), 'utf8');
    // Seed an old send before the migration to exercise the historical import.
    await client.query("INSERT INTO automacao_mensagem_manutencao (id,placa,titulo,km_atual,km_proximo_envio) VALUES (42,'TEST123','Revisão',260000,300000)");
    await client.query("INSERT INTO manutencao_alertas_enviados (id,automacao_id,referencia,tipo_alerta,numero,mensagem,enviado_em) VALUES (1,42,'300000','vencido','5500000000000','Simulação histórica','2026-08-24T13:31:43Z')");
    await client.query(sql);
    await client.query(sql); // additive migration is repeatable
    let rows = (await client.query('SELECT * FROM manutencao_auditoria')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'registro_legado');
    assert.equal(rows[0].ocorrido_em.toISOString(), '2026-08-24T13:31:43.000Z');
    await client.query("SELECT set_config('app.actor_id','9',true),set_config('app.actor_login','operador',true)");
    await client.query('UPDATE automacao_mensagem_manutencao SET km_atual=303292,km_proximo_envio=340000 WHERE id=42');
    rows = (await client.query("SELECT * FROM manutencao_auditoria WHERE evento='alteracao'")).rows;
    assert.equal(rows[0].dados_anteriores.km_atual, 260000);
    assert.equal(rows[0].dados_novos.km_atual, 303292);
    assert.equal(rows[0].dados_anteriores.km_proximo_envio, 300000);
    assert.equal(rows[0].dados_novos.km_proximo_envio, 340000);
    assert.equal(rows[0].usuario_login, 'operador');
    // Updates that only touch a timestamp are not operational changes.
    await client.query('UPDATE automacao_mensagem_manutencao SET atualizado_em=NOW() WHERE id=42');
    assert.equal((await client.query("SELECT * FROM manutencao_auditoria WHERE evento='alteracao'")).rowCount, 1);
    await client.query("INSERT INTO historico_manutencao_veiculo (id,automacao_id,placa,descricao,km_servico) VALUES (88,42,'TEST123','Troca',303292)");
    assert.equal((await client.query("SELECT * FROM manutencao_auditoria WHERE origem='historico_manutencao_veiculo'")).rowCount, 1);
    // A linked, audited send must not produce an extra legacy event.
    await client.query("INSERT INTO manutencao_alertas_enviados (id,automacao_id,referencia,tipo_alerta,numero,mensagem,tentativa_id) VALUES (2,42,'340000','vencido','5500000000000','Simulação',999)");
    assert.equal((await client.query("SELECT * FROM manutencao_auditoria WHERE evento='envio'")).rowCount, 1);
    // Exercise the real edit route against an isolated schema. Its transaction
    // wrapper is held inside this test's outer transaction, then rolled back.
    const {default: express} = await import('express');
    const {default: request} = await import('supertest');
    const {manutencaoRouter} = await import('../src/routes/manutencao.js');
    config.db.schema = schema;
    t.mock.method(pool, 'connect', async () => ({release() {}, query(sql, values) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return Promise.resolve({rows: []});
      return client.query(sql, values);
    }}));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {req.user = {id: 9, login: 'operador'}; next();});
    app.use('/api', manutencaoRouter);
    await client.query("UPDATE automacao_mensagem_manutencao SET intervalo_km=40000,km_proximo_envio=300000,tipo_controle='km' WHERE id=42");
    let response = await request(app).put('/api/manutencao/42').send({km_atual: 310000, intervalo_km: 40000, titulo: 'Revis?o editada'});
    assert.equal(response.status, 200);
    assert.equal(response.body.automacao.km_proximo_envio, 300000);
    response = await request(app).put('/api/manutencao/42').send({intervalo_km: 50000});
    assert.equal(response.status, 200);
    assert.equal(response.body.automacao.km_proximo_envio, 310000);
    assert.equal((await request(app).put('/api/manutencao/42').send({intervalo_km: -1})).status, 400);
    await client.query("UPDATE automacao_mensagem_manutencao SET tipo_controle='data',data_ultimo_servico='2026-09-01',intervalo_dias=10,data_proximo_envio='2026-09-11' WHERE id=42");
    response = await request(app).put('/api/manutencao/42').send({intervalo_dias: 20});
    assert.equal(response.status, 200);
    assert.match(response.body.automacao.data_proximo_envio, /^2026-09-21/);
    config.db.schema = originalSchema;
    await client.query('DELETE FROM automacao_mensagem_manutencao WHERE id=42');
    rows = (await client.query("SELECT * FROM manutencao_auditoria WHERE evento='exclusao'")).rows;
    assert.equal(rows[0].dados_anteriores.km_atual, 310000);
    assert.equal((await client.query("SELECT * FROM manutencao_auditoria WHERE evento='envio'")).rowCount, 1);
  } finally {
    config.db.schema = originalSchema;
    // All fixtures, schema, trigger definitions and changes are rolled back.
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
