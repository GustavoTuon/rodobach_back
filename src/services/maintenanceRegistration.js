import {setMaintenanceActor} from './maintenanceAudit.js';
import {tableName} from '../config.js';

const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function includedFilterPlans(plans, service) {
  const source = plans.find(plan => Number(plan.id) === Number(service.automacao_id));
  const title = normalized(source?.titulo || service.descricao);
  const fullOil = service.tipo_movimento === 'troca_oleo_motor'
    && !/intermedi|cambio|diferencial|completar|reposicao|filtro de oleo/.test(title)
    && (!source || /oleo/.test(title));
  if (!fullOil) return [];
  return plans.filter(plan => Number(plan.id) !== Number(service.automacao_id) && plan.tipo_controle === 'km'
    && Number(plan.intervalo_km) > 0 && /filtro/.test(normalized(plan.titulo)) && /intermedi/.test(normalized(plan.titulo)));
}

export function canAdvanceMaintenance(previous, service) {
  if (!previous) return true;
  const previousDate = previous.data_servico instanceof Date ? previous.data_servico.toISOString().slice(0, 10) : String(previous.data_servico).slice(0, 10);
  return service.data_servico >= previousDate && Number(service.km_servico) >= Number(previous.km_servico);
}

// All records and deadlines commit together. No notifications are sent here.
export async function registerMaintenance(pool, service, userId, userLogin) {
  const client = await pool.connect();
  const history = tableName('historico_manutencao_veiculo'), plansTable = tableName('automacao_mensagem_manutencao');
  try {
    await client.query('BEGIN');
    await setMaintenanceActor(client, {id: userId, login: userLogin});
    const {rows: plans} = await client.query(`SELECT * FROM ${plansTable}
      WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = $1 ORDER BY id FOR UPDATE`, [service.placa]);
    const source = plans.find(plan => Number(plan.id) === Number(service.automacao_id));
    if (service.automacao_id && !source) throw Object.assign(new Error('Plano não encontrado para este veículo.'), {status: 400});
    const {rows: previous} = await client.query(`SELECT DISTINCT ON (automacao_id) automacao_id, data_servico, km_servico
      FROM ${history} WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = $1 AND automacao_id = ANY($2::int[])
      ORDER BY automacao_id, data_servico DESC, km_servico DESC, id DESC`, [service.placa, plans.map(plan => plan.id)]);
    const latest = new Map(previous.map(row => [Number(row.automacao_id), row]));
    const reference = plan => latest.get(Number(plan.id)) || (plan.tipo_controle === 'km' && Number(plan.km_proximo_envio) > 0
      ? {data_servico: '0000-01-01', km_servico: Number(plan.km_proximo_envio) - Number(plan.intervalo_km)} : null);
    async function insert(planId, type, description, observation) {
      const {rows} = await client.query(`INSERT INTO ${history}
        (automacao_id, placa, tipo_movimento, descricao, data_servico, km_servico, fornecedor, documento, observacao, criado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [planId, service.placa, type, description, service.data_servico, service.km_servico, service.fornecedor || null, service.documento || null, observation || null, userId || null]);
      return rows[0];
    }
    async function advance(plan) {
      await client.query(`UPDATE ${plansTable} SET
        km_proximo_envio = CASE WHEN tipo_controle = 'km' THEN $1 + intervalo_km ELSE km_proximo_envio END,
        data_ultimo_servico = CASE WHEN tipo_controle = 'data' THEN $2::date ELSE data_ultimo_servico END,
        data_proximo_envio = CASE WHEN tipo_controle = 'data' THEN $2::date + intervalo_dias ELSE data_proximo_envio END,
        atualizado_em = NOW() WHERE id = $3`, [service.km_servico, service.data_servico, plan.id]);
    }
    const record = await insert(source?.id || null, service.tipo_movimento, service.descricao, service.observacao);
    if (source && canAdvanceMaintenance(reference(source), service)) await advance(source);
    const updated = [];
    for (const plan of includedFilterPlans(plans, service)) {
      if (!canAdvanceMaintenance(reference(plan), service)) continue;
      await insert(plan.id, 'filtro_combustivel', `${plan.titulo} — incluído na troca de óleo completa`,
        `Filtros substituídos na troca completa. Registro de origem: ${record.id}. ${service.observacao || ''}`.trim());
      await advance(plan);
      updated.push({id: plan.id, titulo: plan.titulo, km_proximo_envio: Number(service.km_servico) + Number(plan.intervalo_km)});
    }
    await client.query('COMMIT');
    return {registro: record, planos_intermediarios_atualizados: updated};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {client.release();}
}
