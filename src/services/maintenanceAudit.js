import { config, tableName } from '../config.js';

export async function setMaintenanceActor(client, user) {
  await client.query("SELECT set_config('app.actor_id', $1, true), set_config('app.actor_login', $2, true)",
    [String(user?.id || ''), String(user?.login || '')]);
}

export async function maintenanceMutation(pool, user, sql, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setMaintenanceActor(client, user);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// Never persist provider response bodies: they may contain credentials or session data.
export function maintenanceSendError(error) {
  if (Number.isInteger(error?.status)) return `Serviço de mensagens respondeu HTTP ${error.status}.`;
  if (/não configurada|nao configurada/i.test(error?.message || '')) return 'Serviço de WhatsApp não configurado.';
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'Tempo limite excedido; o envio pode ter sido aceito. Conferir no provedor antes de reenviar.';
  return 'Falha de comunicação ou processamento; resultado do envio não confirmado. Conferir no provedor.';
}

export async function maintenanceAttemptExists(pool, {origin, recordId, reference, type, number}) {
  const previous = await pool.query(`SELECT id FROM ${tableName('manutencao_auditoria')}
    WHERE evento='envio' AND origem=$1 AND registro_id=$2 AND referencia=$3 AND tipo_alerta=$4 AND numero=$5
      AND status IN ('iniciado','aceito','inconclusivo') LIMIT 1`,
  [origin, recordId, reference, type, number]);
  return previous.rowCount > 0;
}

export async function sendAuditedMaintenance({ pool, send, candidate, item, currentKm, component = false }) {
  const audit = tableName('manutencao_auditoria');
  const origin = component ? 'componente_posicao' : 'plano';
  const recordId = item.id;
  // A pending/ambiguous request must not be resent automatically after a restart.
  if (await maintenanceAttemptExists(pool, {origin, recordId, reference: candidate.referencia, type: candidate.tipo, number: candidate.numero})) return { skipped: true };
  const { rows } = await pool.query(`INSERT INTO ${audit}
    (evento,origem,registro_id,automacao_id,placa,titulo,numero,mensagem,referencia,tipo_alerta,status,dados_novos)
    VALUES ('envio',$1,$2,$3,$4,$5,$6,$7,$8,$9,'iniciado',$10) RETURNING id`,
  [origin, recordId, component ? null : item.id, candidate.placa, item.titulo || item.componente,
    candidate.numero, candidate.mensagem, candidate.referencia, candidate.tipo,
    { km_atual: currentKm, km_proximo_envio: item.km_proximo_envio ?? item.proximo_km, data_proximo_envio: item.data_proximo_envio ?? item.proxima_data }]);
  const attemptId = rows[0].id;
  let response;
  try {
    response = await send(candidate.numero, candidate.mensagem);
    if (response?.error || response?.success === false) throw Object.assign(new Error('Provider rejected request'), { status: 502 });
  } catch (error) {
    const definitive = (error?.status >= 400 && error?.status < 500) || /não configurada|nao configurada/i.test(error?.message || '');
    const status = definitive ? 'falha' : 'inconclusivo';
    await pool.query(`UPDATE ${audit} SET status=$2,erro=$3,concluido_em=clock_timestamp() WHERE id=$1`,
      [attemptId, status, maintenanceSendError(error)]);
    return { failed: true, status, attemptId };
  }
  // Both acknowledgement and deduplication marker commit together. If persistence
  // fails, the durable 'iniciado' record prevents a blind duplicate on the next run.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ${audit} SET status='aceito',provedor_id=$2,provedor_status=$3,concluido_em=clock_timestamp() WHERE id=$1`,
      [attemptId, String(response?.key?.id || response?.messageId || response?.id || '').slice(0, 200) || null,
        typeof response?.status === 'string' ? response.status.slice(0, 80) : null]);
    const target = tableName(component ? 'manutencao_componentes_alertas_enviados' : 'manutencao_alertas_enviados');
    await client.query(`INSERT INTO ${target} (${component ? 'registro_id' : 'automacao_id'},referencia,tipo_alerta,numero,mensagem,tentativa_id)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [recordId, candidate.referencia, candidate.tipo, candidate.numero, candidate.mensagem, attemptId]);
    await client.query('COMMIT');
    return { accepted: true, attemptId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getMaintenanceAudit(pool, filters = {}) {
  const values = [], where = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  if (filters.placa) add('placa ILIKE ?', `%${String(filters.placa).replace(/[^a-z0-9]/gi, '').slice(0, 12)}%`);
  if (filters.automacaoId) {
    if (!/^\d+$/.test(String(filters.automacaoId))) throw Object.assign(new Error('Plano inválido.'), { status: 400 });
    add('automacao_id = ?', filters.automacaoId);
  }
  if (filters.tipo === 'envios') where.push("evento='envio'");
  if (filters.tipo === 'alteracoes') where.push("evento <> 'envio'");
  for (const [key, comparison] of [['inicio', '>='], ['fim', '<']]) {
    if (!filters[key]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || Number.isNaN(Date.parse(filters[key]))) {
      throw Object.assign(new Error('Data inválida.'), { status: 400 });
    }
    add(`ocorrido_em ${comparison} ((?::date${key === 'fim' ? " + 1" : ''})::timestamp AT TIME ZONE 'America/Sao_Paulo')`, filters[key]);
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(filters.pagina, 10) || 1));
  const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [result, runs] = await Promise.all([
    pool.query(`SELECT * FROM ${tableName('manutencao_auditoria')} ${predicate}
      ORDER BY ocorrido_em DESC,id DESC LIMIT 51 OFFSET $${values.length + 1}`, [...values, (page - 1) * 50]),
    pool.query(`SELECT * FROM ${tableName('manutencao_alertas_execucoes')} ORDER BY iniciado_em DESC LIMIT 1`),
  ]);
  return { rows: result.rows.slice(0, 50), pagina: page, temMais: result.rows.length > 50,
    ultimaExecucao: runs.rows[0] || null,
    agendadorNestaApi: false,
    executorManutencao: "worker",
    agendamentoDiario: process.env.MAINTENANCE_DAILY_TIME === "08:00" ? "08:00 — Brasília" : null,
    whatsappConfigurado: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    somenteConsulta: config.readOnly };
}
