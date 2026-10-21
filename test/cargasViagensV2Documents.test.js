import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { clientPool } from "../src/db/clientPool.js";
import { cargasViagensV2Router, enrichCargasFinancial, syncDeliveredCargasV2 } from "../src/routes/cargasViagensV2.js";

test("financial lookup does not merge companies/series or fall back from a missing key", async t => {
  t.mock.method(clientPool, "query", async () => ({ rows: [
    {empresacon:"1",seriecon:"1",numero:"123",chave:"key",status_financeiro:"quitado",titulos:1,valor_total:100,valor_aberto:0},
    {empresacon:"1",seriecon:"C",numero:"123",chave:"",status_financeiro:"em_aberto",titulos:1,valor_total:200,valor_aberto:200},
  ] }));
  const loads = await enrichCargasFinancial([
    {documentos:[{tipo:"Orçamento",empresa:"1",serie:"C",numero:"123"}]},
    {documentos:[{tipo:"CT-e",numero:"123"}]},
    {documentos:[{tipo:"CT-e",numero:"123",chave:"missing"}]},
    {documentos:[{tipo:"CT-e",numero:"123",chave:"key"}]},
  ]);
  assert.deepEqual(loads.map(row => row.financeiro.status), ["em_aberto","revisar","revisar","quitado"]);
  assert.equal(loads[0].financeiro.valorTotal, 200);
});

test("save preserves series/company and legacy documents through the API", async t => {
  const inserted = [];
  const fake = {
    query: async (sql, params) => {
      if (sql.includes("SELECT id,status")) return {rowCount:1,rows:[{id:1,status:"em_transito"}]};
      if (sql.includes("INSERT INTO")) inserted.push(params);
      return {rows:[],rowCount:0};
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => fake);
  t.mock.method(pool, "query", async () => ({rows:[{id:1,documentos:inserted.map((p, index) => ({
    id:index+1,tipo_documento:p[1],numero_documento:p[2],chave_documento:p[3],
    empresa_documento:p[8],serie_documento:p[9],
  }))}]}));
  t.mock.method(clientPool, "query", async () => ({rows:[]}));
  const app = express();
  app.use(express.json());
  app.use(cargasViagensV2Router);
  const response = await request(app).put("/cargas-viagens-v2/cargas/1/documentos").send({documentos:[
    {tipo:"CT-e",numero:"123",empresa:"1",serie:"1",chave:"key"},
    {tipo:"Orçamento",numero:"123",empresa:"1",serie:"C"},
    {tipo:"NF-e",numero:"50"},
  ]});
  assert.equal(response.status, 200);
  assert.equal(response.body.documentos[1].tipo, "Orçamento");
  assert.deepEqual(response.body.documentos.map(d => [d.numero,d.empresa,d.serie]),
    [["123","1","1"],["123","1","C"],["50","",""]]);
});

test("delivery sync locks before reading links and completes only unambiguous fully delivered cargas", async t => {
  const calls = [];
  const cte = {empresa:"1",serie:"1",numero:"123",chave:"key",placa:"ABC1234",emissaoAt:"2026-01-01"};
  const budget = {...cte,serie:"C",chave:""};
  const fake = {
    query: async (sql, params) => {
      calls.push({sql,params});
      if (sql.includes("FOR UPDATE")) return {rows:[{id:1},{id:2},{id:3},{id:4},{id:5}]};
      if (sql.includes("AS carga_id")) return {rowCount:6,rows:[
        {...cte,carga_id:1},{...budget,carga_id:1},
        {...cte,carga_id:2},{numero:"123",placa:"ABC1234",carga_id:3},
        {...budget,numero:"456",carga_id:4},{...budget,numero:"789",carga_id:5},
      ]};
      return {rows:[]};
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => fake);
  t.mock.method(clientPool, "query", async sql => {
    if (sql.includes("WITH cte_documentos")) return {rows:[
      {empresacon:"1",seriecon:"C",numero:"456",status_financeiro:"quitado",titulos:1,valor_total:100,valor_aberto:0},
      {empresacon:"1",seriecon:"C",numero:"789",status_financeiro:"parcial",titulos:1,valor_total:100,valor_aberto:50},
    ]};
    if (sql.includes("WITH alvo")) return {rows:[{
      empresaCte:1,serieCte:"1",codigoCte:123,empresa:1,serie:"1",numero:10,
      placa:"ABC1234",statusCodigo:7,autorizadoEm:"2026-01-01",encerradoEm:"2026-01-02",
    },{
      empresaCte:1,serieCte:"C",codigoCte:123,empresa:1,serie:"1",numero:11,
      placa:"ABC1234",statusCodigo:5,autorizadoEm:"2026-01-01",encerradoEm:null,
    }]};
    // Neither forecast nor delivery dates from the CT-e may conclude a carga.
    assert.doesNotMatch(sql, /datahoraentregacon/);
    assert.doesNotMatch(sql, /dataentregacon/);
    return {rows:[cte,budget]};
  });
  assert.deepEqual(await syncDeliveredCargasV2(), {updated:2});
  const update = calls.find(call => call.sql.includes("SET status='entregue'"));
  assert.deepEqual(update.params, [[4,2]]);
  assert.ok(calls.findIndex(call => call.sql.includes("FOR UPDATE"))
    < calls.findIndex(call => call.sql.includes("AS carga_id")));
  assert.deepEqual(calls.find(call => call.sql.includes("AS carga_id")).params, [[1,2,3,4,5]]);
  assert.equal(calls.at(-1).sql, "COMMIT");
});
