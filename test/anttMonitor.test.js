import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseAnttAct,
  discoverActs,
  validateChange,
  officialUrl,
} from "../src/services/anttSource.js";
import { syncAntt } from "../src/services/anttMonitor.js";

const html = fs.readFileSync(
  new URL("./fixtures/antt-suroc-22-2026.html", import.meta.url),
  "utf8",
);
const source = officialUrl(
  "https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=POR&numeroAto=00000022&valorAno=2026",
);
const index = `<a href="${source}">PORTARIA SUROC Nº 22, DE 28 DE SETEMBRO DE 2026 Reajusta os coeficientes dos pisos mínimos previstos no Anexo II</a>`;
const candidate = parseAnttAct(html, source);
const current = candidate.rows.map((r) => ({
  eixos: r.eixos,
  tipo_carga: r.tipoCarga,
  km_valor: r.kmValor,
  carga_descarga: r.cargaDescarga,
  data_vigencia: candidate.effective,
}));

test("lê a publicação oficial, separa tabelas A/C e calcula a vigência pelo DOU", () => {
  assert.equal(candidate.effective, "2026-09-30");
  assert.equal(candidate.published, "2026-09-29");
  assert.equal(candidate.rows.length, 10);
  assert.deepEqual(
    candidate.rows.find((r) => r.eixos === 6 && r.tipoCarga === "normal"),
    { eixos: 6, tipoCarga: "normal", kmValor: 7.5347, cargaDescarga: 671.93 },
  );
  assert.equal(
    candidate.rows.find(
      (r) => r.eixos === 6 && r.tipoCarga === "alto_desempenho",
    ).kmValor,
    6.4924,
  );
  assert.equal(discoverActs(index, source)[0].date, "2026-09-28");
});
test("rejeita coeficiente incompleto, unidade alterada, eixo inesperado e vigência ambígua", () => {
  for (const damaged of [
    html.replace("7,5347", "—"),
    html.replaceAll("R$/km", "R$/ton"),
    html.replaceAll("dia seguinte ao de sua", "prazo regulamentar após sua"),
    html.replaceAll(">9<", ">8<"),
  ])
    assert.throws(() => parseAnttAct(damaged, source));
});
test("não aceita fonte externa, regressão, alteração na mesma vigência ou salto acima de 20%", () => {
  assert.throws(() => officialUrl("https://attacker.example/action/"));
  assert.throws(() =>
    officialUrl("https://anttlegis.antt.gov.br@127.0.0.1/action/"),
  );
  assert.doesNotThrow(() => validateChange(candidate, current));
  assert.throws(() =>
    validateChange({ ...candidate, effective: "2026-07-17" }, current),
  );
  const changed = structuredClone(candidate);
  changed.rows[0].kmValor *= 1.01;
  assert.throws(() => validateChange(changed, current));
  changed.effective = "2026-10-10";
  changed.rows[0].kmValor *= 2;
  assert.throws(() => validateChange(changed, current));
});

function fakeDb({ old = false, failInsert = false, locked = true } = {}) {
  const queries = [];
  const client = {
    release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked }] };
      if (sql.includes("AS recente")) return { rows: [] };
      if (sql.includes("RETURNING id")) return { rows: [{ id: 1 }] };
      if (sql.includes("SELECT DISTINCT ON"))
        return {
          rows: current.map((r) => ({
            ...r,
            data_vigencia: old ? "2026-07-17" : r.data_vigencia,
          })),
        };
      if (
        failInsert &&
        sql.includes("INSERT INTO") &&
        sql.includes("antt_tabela")
      )
        throw new Error("Falha de gravação");
      return { rows: [] };
    },
  };
  return { queries, connect: async () => client };
}
const fetchPage = async (url) => (url === source ? html : index);
test("repetição não duplica tarifas e concorrência não inicia segunda execução", async () => {
  const db = fakeDb();
  assert.equal((await syncAntt({ db, fetchPage, force: true })).status, "ok");
  assert.equal(
    db.queries.filter(
      (q) => q.sql.includes("INSERT INTO") && q.sql.includes("antt_tabela"),
    ).length,
    0,
  );
  assert.equal(
    (await syncAntt({ db: fakeDb({ locked: false }), fetchPage, force: true }))
      .status,
    "busy",
  );
});
test("nova publicação grava dez tarifas em uma transação; falha reverte tudo", async () => {
  const db = fakeDb({ old: true });
  assert.equal(
    (await syncAntt({ db, fetchPage, force: true })).status,
    "updated",
  );
  assert.equal(
    db.queries.filter(
      (q) => q.sql.includes("INSERT INTO") && q.sql.includes("antt_tabela"),
    ).length,
    10,
  );
  assert.ok(db.queries.some((q) => q.sql === "COMMIT"));
  const failed = fakeDb({ old: true, failInsert: true });
  assert.equal(
    (await syncAntt({ db: failed, fetchPage, force: true })).status,
    "review",
  );
  assert.ok(failed.queries.some((q) => q.sql === "ROLLBACK"));
  assert.ok(!failed.queries.some((q) => q.sql === "COMMIT"));
});
test("indisponibilidade da fonte registra erro sem alterar tarifas", async () => {
  const db = fakeDb();
  const result = await syncAntt({
    db,
    force: true,
    fetchPage: async () => {
      throw new Error("Timeout");
    },
  });
  assert.equal(result.status, "error");
  assert.ok(
    !db.queries.some(
      (q) => q.sql.includes("INSERT INTO") && q.sql.includes("antt_tabela"),
    ),
  );
});
