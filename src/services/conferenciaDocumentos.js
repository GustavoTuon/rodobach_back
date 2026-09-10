import { pool } from "../db/pool.js";
import { tableName, quoteIdent } from "../config.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

let ready;
async function ensure() {
  if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS ${tableName("ociosidade_confirmacoes")} (
    id bigserial PRIMARY KEY, placa text NOT NULL, documentos jsonb NOT NULL,
    inicio timestamptz NOT NULL, fim timestamptz NOT NULL, usuario text NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now(), CHECK(fim > inicio))`).catch((e) => { ready = null; throw e; });
  await ready;
}
export const documentKey = (d) => `${d.placa}|${d.empresa}|${d.serie}|${d.codigo}|${new Date(d.emissao_documento_at).toISOString()}`;
export function validateConfirmation(body) {
  const inicio = new Date(body.inicio), fim = new Date(body.fim);
  if (!/^[A-Z0-9]{7}$/.test(body.placa || "") || !Array.isArray(body.documentos) || !body.documentos.length || body.documentos.length > 100 || body.documentos.some((x) => typeof x !== "string" || !x.startsWith(`${body.placa}|`) || x.length > 200) || !Number.isFinite(+inicio) || !Number.isFinite(+fim) || fim <= inicio || fim - inicio > 120 * 86400000 || fim > new Date()) throw Object.assign(new Error("Informe documentos da mesma placa e horários válidos, com descarga após carregamento."), { status: 400 });
  return { placa: body.placa, documentos: [...new Set(body.documentos)], inicio: inicio.toISOString(), fim: fim.toISOString() };
}
export async function listConfirmations() {
  await ensure();
  return (await pool.query(`SELECT * FROM ${tableName("ociosidade_confirmacoes")} ORDER BY inicio`)).rows;
}
export async function saveConfirmation(body, user) {
  const data = validateConfirmation(body);
  await ensure();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${tableName("ociosidade_confirmacoes")} IN EXCLUSIVE MODE`);
    const existing = await client.query(`SELECT id FROM ${tableName("ociosidade_confirmacoes")} WHERE placa=$1 AND (documentos ?| $2::text[] OR (inicio < $4::timestamptz AND fim > $3::timestamptz))`, [data.placa, data.documentos, data.inicio, data.fim]);
    if (existing.rowCount) throw Object.assign(new Error("Há confirmação sobreposta ou documentos já vinculados. Desfaça a confirmação anterior para corrigir."), { status: 409 });
    const result = await client.query(`INSERT INTO ${tableName("ociosidade_confirmacoes")} (placa,documentos,inicio,fim,usuario) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [data.placa, JSON.stringify(data.documentos), data.inicio, data.fim, String(user)]);
    await client.query("COMMIT"); return result.rows[0];
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function removeConfirmation(id) {
  if (!/^\d+$/.test(String(id))) throw Object.assign(new Error("Confirmação inválida"), { status: 400 });
  await ensure(); await pool.query(`DELETE FROM ${tableName("ociosidade_confirmacoes")} WHERE id=$1`, [id]);
}
export function applyConfirmations(documents, confirmations) {
  return documents.map((doc) => {
    const key = documentKey(doc);
    const c = confirmations.find((item) => item.placa === doc.placa && item.documentos.includes(key));
    return { ...doc, documentKey: key, ...(c ? { confirmacaoId: c.id, emissaoOriginal: doc.emissao_documento_at, entregaOriginal: doc.entrega_at, emissao_documento_at: c.inicio, entrega_at: c.fim, entrega_precisa: true } : {}) };
  });
}
export async function suggestStops({ placa, inicio, fim }) {
  if (!/^[A-Z0-9]{7}$/.test(placa || "") || !Number.isFinite(+new Date(inicio)) || !Number.isFinite(+new Date(fim)) || new Date(fim) <= new Date(inicio) || new Date(fim)-new Date(inicio)>31*86400000) throw Object.assign(new Error("Selecione placa e período de até 31 dias."), { status: 400 });
  const s = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const { rows } = await getVeiculosPool().query(`WITH points AS (
    SELECT m.data_hora,m.velocidade,m.municipio,m.latitude,m.longitude,m.odometro,
      lag(m.data_hora) OVER w prev_at,lag(m.velocidade) OVER w prev_speed,
      lag(m.latitude) OVER w prev_lat,lag(m.longitude) OVER w prev_lon
    FROM ${s}.mensagens_cb m JOIN ${s}.veiculos v ON v.veiculo_id=m.veiculo_id
    WHERE v.placa=$1 AND m.data_hora BETWEEN $2::timestamptz AND $3::timestamptz
    WINDOW w AS (ORDER BY m.data_hora)
  ), grouped AS (SELECT *,sum(CASE WHEN prev_at IS NULL OR data_hora-prev_at>interval '10 minutes' OR velocidade>=5 OR prev_speed>=5 OR abs(latitude-prev_lat)>.002 OR abs(longitude-prev_lon)>.002 THEN 1 ELSE 0 END) OVER (ORDER BY data_hora) grp FROM points)
  SELECT min(data_hora) inicio,max(data_hora) fim,max(municipio) municipio,
    avg(latitude) latitude,avg(longitude) longitude,min(odometro) FILTER(WHERE odometro>0) odometro_minimo,max(odometro) FILTER(WHERE odometro>0) odometro_maximo
  FROM grouped WHERE velocidade<5 AND latitude IS NOT NULL AND longitude IS NOT NULL
  GROUP BY grp HAVING max(data_hora)-min(data_hora)>=interval '15 minutes' ORDER BY inicio LIMIT 300`, [placa, inicio, fim]);
  return rows;
}
