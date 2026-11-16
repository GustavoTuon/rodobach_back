import {config, tableName} from '../config.js';
import {pool} from '../db/pool.js';
import {clientPool} from '../db/clientPool.js';
import {registerMaintenance} from './maintenanceRegistration.js';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plate = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function isEngineOilChange(description) {
  const text = normalize(description);
  return /troc\w*\s+(?:de\s+|do\s+|o\s+)?oleo/.test(text)
    && !/cambio|diferencial|direcao|hidraul|compressor|complet|reposi|filtro|intermedi/.test(text);
}
export function oilPlans(plans, vehicle) {
  return plans.filter(p => p.ativo && p.tipo_controle === 'km' && Number(p.intervalo_km) > 0
    && plate(p.placa) === plate(vehicle) && isEngineOilChange(p.titulo));
}

// Snapshot every OS, including ones without items: old OS must never become new
// just because a service is added later. ERP is queried read-only.
export async function loadExternalOrders(erp = clientPool) {
  const {rows} = await erp.query(`SELECT
    json_build_array(o.empresaose,o.serieose,o.codigoose,o.fornecedorose)::text AS chave,
    o.codigoose AS numero, o.kilometragematualveiculoose AS km,
    to_char(COALESCE(o.dataentradaose,o.dataemissaoose),'YYYY-MM-DD') AS data,
    COALESCE(json_agg(json_build_object('descricao',s.nomesrv,
      'placa',COALESCE(NULLIF(trim(i.veiculooes),''),o.veiculoose)))
      FILTER (WHERE i.servicooes IS NOT NULL AND i.quantidadeoes > 0),'[]') AS servicos
    FROM frotas.ordensservicosexterna o
    LEFT JOIN frotas.ordensservicosexternaservicos i ON
      (i.empresaoes,i.serieoes,i.codigooes,i.fornecedoroes) =
      (o.empresaose,o.serieose,o.codigoose,o.fornecedorose)
    LEFT JOIN estoque.servicos s ON s.empresasrv=i.empresaoes AND s.codigosrv=i.servicooes
    GROUP BY o.empresaose,o.serieose,o.codigoose,o.fornecedorose,
      o.kilometragematualveiculoose,o.dataentradaose,o.dataemissaoose
    ORDER BY COALESCE(o.dataentradaose,o.dataemissaoose),o.codigoose`);
  return rows;
}

export async function syncMaintenanceErp({db = pool, load = loadExternalOrders, readOnly = config.readOnly} = {}) {
  if (readOnly) return {ignorado: true};
  const client = await db.connect();
  const ledger = tableName('manutencao_os_erp'), state = tableName('manutencao_os_erp_estado');
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(78482933) AS acquired');
    if (!lock.rows[0].acquired) { await client.query('ROLLBACK'); return {ignorado: true}; }
    const orders = await load();
    const initialized = (await client.query(`SELECT id FROM ${state} WHERE id=1`)).rowCount > 0;
    if (!initialized) {
      await client.query(`INSERT INTO ${ledger}(chave,estado) SELECT unnest($1::text[]),'historico'`, [orders.map(o => o.chave)]);
      await client.query(`INSERT INTO ${state}(id,ultima_execucao) VALUES(1,now())`);
      await client.query('COMMIT');
      return {baseline: orders.length, importados: 0};
    }
    const known = new Map((await client.query(`SELECT chave,estado FROM ${ledger}`)).rows.map(r => [r.chave,r.estado]));
    const plans = (await client.query(`SELECT * FROM ${tableName('automacao_mensagem_manutencao')} ORDER BY id FOR UPDATE`)).rows;
    let imported = 0, pending = 0;
    for (const order of orders) {
      if (['historico','importado'].includes(known.get(order.chave))) continue;
      const services = order.servicos.filter(s => isEngineOilChange(s.descricao));
      const vehicles = [...new Set(services.map(s => plate(s.placa)).filter(Boolean))];
      let reason = !services.length ? 'Sem serviço explícito de troca de óleo do motor' : null;
      if (!vehicles.length) reason = 'Sem placa ou serviço de troca de óleo';
      // Header odometer cannot safely describe multiple vehicles.
      if (vehicles.length > 1) reason = 'OS com troca de óleo em mais de uma placa';
      if (!Number.isSafeInteger(Number(order.km)) || Number(order.km) <= 0 || !order.data
        || order.data > new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'})) reason = 'KM/data ausente ou inválido';
      const matches = vehicles.length === 1 ? oilPlans(plans, vehicles[0]) : [];
      if (!reason && !matches.length) reason = 'Sem plano ativo de troca de óleo para a placa';
      const records = [];
      if (!reason) {
        for (const plan of matches) {
          const result = await registerMaintenance(db, {
            automacao_id: plan.id, placa: vehicles[0], tipo_movimento: 'troca_oleo_motor',
            descricao: 'Troca de óleo do motor — OS externa ERP', data_servico: order.data,
            km_servico: Number(order.km), documento: `OS ${order.numero}`,
            observacao: `Importação automática ERP. Chave: ${order.chave}`,
          }, null, 'integracao-os-erp', {client, includeFilters: false});
          records.push(result.registro.id);
        }
        imported++;
      } else pending++;
      await client.query(`INSERT INTO ${ledger}(chave,estado,motivo,registros) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(chave) DO UPDATE SET estado=excluded.estado,motivo=excluded.motivo,
        registros=excluded.registros,atualizado_em=now()`,
      [order.chave, reason ? 'pendente' : 'importado', reason, JSON.stringify(records)]);
    }
    await client.query(`UPDATE ${state} SET ultima_execucao=now() WHERE id=1`);
    await client.query('COMMIT');
    return {importados: imported, pendentes: pending};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {client.release();}
}

let timer;
export function startMaintenanceErpSync() {
  if (timer || config.readOnly || process.env.MAINTENANCE_ERP_SYNC_ENABLED === 'false') return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { console.info('Sincronização OS ERP:', await syncMaintenanceErp()); }
    catch (error) { console.error('Falha na sincronização OS ERP:', error.message); }
    finally {running = false;}
  };
  void run();
  timer = setInterval(run, 5 * 60 * 1000);
  timer.unref();
}
