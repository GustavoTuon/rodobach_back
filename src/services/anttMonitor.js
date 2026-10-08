import { pool } from "../db/pool.js";
import { config, tableName } from "../config.js";
import { logger } from "../logger.js";
import {
  ANTT_BASE,
  ANTT_INDEXES,
  fetchOfficial,
  discoverActs,
  parseAnttAct,
  validateChange,
} from "./anttSource.js";

const LOCK = 586722;
export async function syncAntt({
  force = false,
  db = pool,
  fetchPage = fetchOfficial,
} = {}) {
  if (config.readOnly) return { status: "disabled" };
  const client = await db.connect();
  let locked = false,
    runId,
    candidate;
  try {
    locked = (
      await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK])
    ).rows[0].locked;
    if (!locked) return { status: "busy" };
    const last = (
      await client.query(
        `SELECT *, now()-iniciado_em < CASE WHEN status IN ('error','review','running') THEN interval '1 hour' ELSE interval '24 hours' END AS recente FROM ${tableName("antt_monitor_execucoes")} ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0];
    if (!force && last?.recente) return { status: "not_due" };
    runId = (
      await client.query(
        `INSERT INTO ${tableName("antt_monitor_execucoes")}(status) VALUES ('running') RETURNING id`,
      )
    ).rows[0].id;
    const sources = [...ANTT_INDEXES, ANTT_BASE];
    const pages = await Promise.all(sources.map((url) => fetchPage(url)));
    const acts = pages.flatMap((html, i) =>
      discoverActs(html, sources[i], i === 2),
    );
    // Failure to discover must never be reported as confirmation that rates are current.
    if (!discoverActs(pages[0], sources[0]).length || !acts.length)
      throw new Error(
        "Índice oficial sem publicações reconhecidas. Revisão necessária.",
      );
    const latest = acts.sort((a, b) => b.date.localeCompare(a.date))[0];
    const html = await fetchPage(latest.url);
    candidate = parseAnttAct(html, latest.url);
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    if (candidate.published > today)
      throw new Error("Data de publicação futura. Revisão necessária.");
    await client.query("BEGIN");
    const current = (
      await client.query(
        `SELECT DISTINCT ON (eixos,tipo_carga) eixos,tipo_carga,km_valor,carga_descarga,data_vigencia::text FROM ${tableName("antt_tabela")} WHERE ativo=true AND operacao='geral' ORDER BY eixos,tipo_carga,data_vigencia DESC,atualizado_em DESC,id DESC`,
      )
    ).rows;
    validateChange(candidate, current);
    const different = candidate.rows.some((r) => {
      const old = current.find(
        (o) => Number(o.eixos) === r.eixos && o.tipo_carga === r.tipoCarga,
      );
      return (
        old.data_vigencia !== candidate.effective ||
        Number(old.km_valor) !== r.kmValor ||
        Number(old.carga_descarga) !== r.cargaDescarga
      );
    });
    await client.query(
      `INSERT INTO ${tableName("antt_publicacoes")}(hash,titulo,fonte,publicada_em,vigencia,html_hash,dados) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(hash) DO NOTHING`,
      [
        candidate.hash,
        candidate.title,
        candidate.source,
        candidate.published,
        candidate.effective,
        candidate.htmlHash,
        JSON.stringify(candidate.rows),
      ],
    );
    if (different) {
      const names = {
        3: "Truck",
        4: "Bitruck",
        5: "Carreta 5e",
        6: "Carreta 6e",
        7: "Carreta 7e",
      };
      for (const r of candidate.rows)
        await client.query(
          `INSERT INTO ${tableName("antt_tabela")}(tipo_veiculo,eixos,operacao,tipo_carga,km_valor,carga_descarga,data_vigencia,versao,fonte) VALUES ($1,$2,'geral',$3,$4,$5,$6,$7,$8)`,
          [
            names[r.eixos],
            r.eixos,
            r.tipoCarga,
            r.kmValor,
            r.cargaDescarga,
            candidate.effective,
            candidate.title,
            candidate.source,
          ],
        );
    }
    const status = different ? "updated" : "ok";
    const message = different
      ? `Nova tabela validada. Vigência: ${candidate.effective}.`
      : "Tabela conferida com a publicação oficial.";
    await client.query(
      `UPDATE ${tableName("antt_monitor_execucoes")} SET status=$2,mensagem=$3,fonte=$4,publicacao=$5,finalizado_em=now() WHERE id=$1`,
      [runId, status, message, candidate.source, JSON.stringify(candidate)],
    );
    await client.query("COMMIT");
    return { status, message, effective: candidate.effective };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (runId)
      await client.query(
        `UPDATE ${tableName("antt_monitor_execucoes")} SET status=$2,mensagem=$3,fonte=$4,publicacao=$5,finalizado_em=now() WHERE id=$1`,
        [
          runId,
          candidate ? "review" : "error",
          String(error.message).slice(0, 700),
          candidate?.source || null,
          candidate ? JSON.stringify(candidate) : null,
        ],
      );
    logger.warn(
      { message: error.message },
      "Verificação ANTT não concluída; tabela preservada",
    );
    return { status: candidate ? "review" : "error", message: error.message };
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock($1)", [LOCK])
        .catch(() => {});
    client.release();
  }
}

let timer;
export function startAnttMonitor() {
  if (timer || config.readOnly || process.env.ANTT_SYNC_ENABLED === "false")
    return;
  const tick = () =>
    syncAntt().catch((error) =>
      logger.error({ message: error.message }, "Falha no monitor ANTT"),
    );
  void tick();
  timer = setInterval(tick, 15 * 60 * 1000);
  timer.unref();
}

export async function getAnttStatus() {
  const { rows } = await pool.query(
    `SELECT id,iniciado_em,finalizado_em,status,mensagem,fonte FROM ${tableName("antt_monitor_execucoes")} ORDER BY id DESC LIMIT 1`,
  );
  const last = rows[0] || null;
  const success = (
    await pool.query(
      `SELECT finalizado_em FROM ${tableName("antt_monitor_execucoes")} WHERE status IN ('ok','updated') ORDER BY id DESC LIMIT 1`,
    )
  ).rows[0];
  const upcoming = (
    await pool.query(
      `SELECT DISTINCT data_vigencia::text,versao FROM ${tableName("antt_tabela")} WHERE ativo=true AND data_vigencia > (now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY data_vigencia LIMIT 1`,
    )
  ).rows[0];
  return {
    lastCheck: last,
    lastSuccess: success?.finalizado_em || null,
    stale:
      !success ||
      Date.now() - new Date(success.finalizado_em).getTime() > 26 * 3600000,
    upcoming: upcoming || null,
  };
}
