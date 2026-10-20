import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pool } from "../src/db/pool.js";

test("migration preserves legacy links and delivery SQL rejects forecasts/future dates", {
  skip: process.env.CARGAS_DOCUMENTS_DB_TEST !== "1",
}, async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All writes are restricted to session-local temporary tables.
    await client.query("SET LOCAL search_path TO pg_temp");
    await client.query("CREATE TEMP TABLE carga_documentos_v2 (id bigint, numero_documento text, chave_documento text) ON COMMIT DROP");
    await client.query("INSERT INTO carga_documentos_v2 VALUES (1,'123','legacy-key')");
    const migration = await fs.readFile(new URL("../sql/068_carga_documentos_identidade_erp.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration);
    const { rows } = await client.query("SELECT * FROM carga_documentos_v2");
    assert.deepEqual(rows, [{id:"1",numero_documento:"123",chave_documento:"legacy-key",empresa_documento:null,serie_documento:null}]);
    const source = await fs.readFile(new URL("../src/routes/cargasViagensV2.js", import.meta.url), "utf8");
    const expression = source.match(/\(con\.dataentregacon IS NOT NULL[\s\S]+?\) AS entregue/)[0];
    const dates = await client.query(`
      WITH clock AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AS today)
      SELECT con.id, ${expression}
      FROM clock CROSS JOIN LATERAL (VALUES
        (1, NULL::date, today - 1),
        (2, today + 1, NULL::date),
        (3, today - 1, NULL::date),
        (4, today, NULL::date)
      ) AS con(id,dataentregacon,datahoraentregacon)
      ORDER BY con.id
    `);
    assert.deepEqual(dates.rows.map(row => row.entregue), [false,false,true,true]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
