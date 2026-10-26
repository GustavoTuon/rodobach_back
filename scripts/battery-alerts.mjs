import {config, tableName} from '../src/config.js';
import {pool} from '../src/db/pool.js';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
import {sendWhatsappText} from '../src/routes/whatsapp.js';
import {evaluateBattery, batteryMessage} from '../src/services/batteryRules.js';

const mode = process.argv[2] || '--preview';
const plate = process.env.BATTERY_ALERT_PLATE || 'RAA8G58';
const number = process.env.BATTERY_ALERT_NUMBER || '5548999503759';
const table = tableName('bateria_alertas_envios');
let stopping = false;
let timer;
let running;

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
    id bigserial PRIMARY KEY, placa text NOT NULL, numero text NOT NULL,
    tipo text NOT NULL, mensagem text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'incerto', protocolo text
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bateria_alertas_destino_idx ON ${table} (placa,numero,criado_em DESC)`);
}

async function cycle() {
  const test = mode === '--test';
  let event;
  if (test) event = {voltage: 23, level: 'critico'};
  else {
    const {rows} = await getVeiculosPool().query(`SELECT m.data_hora,m.bateria_carreta,
      m.evt4_ignicao_acionada AS ignicao,m.rpm,m.velocidade
      FROM rodobach.veiculos v JOIN LATERAL (
        SELECT data_hora,bateria_carreta,evt4_ignicao_acionada,rpm,velocidade,id
        FROM rodobach.mensagens_cb WHERE veiculo_id=v.veiculo_id
        AND data_hora>now()-interval '30 minutes' ORDER BY data_hora DESC,id DESC LIMIT 1000
      ) m ON true WHERE v.placa=$1 ORDER BY m.data_hora DESC,m.id DESC`, [plate]);
    event = evaluateBattery(rows);
  }
  if (!event) { console.log(`${new Date().toISOString()} ${plate}: sem alerta elegível.`); return; }
  const message = batteryMessage(plate, event, test);
  if (mode === '--preview') { console.log(message); return; }
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(82424026) AS locked');
    locked = lock.rows[0].locked;
    if (!locked) return;
    // Persist intent before sending. Unknown outcomes are never retried automatically.
    const type = test ? 'teste' : event.level;
    const previous = await client.query(`SELECT id FROM ${table} WHERE placa=$1 AND numero=$2
      AND tipo=$3 AND criado_em>now()-interval '24 hours' LIMIT 1`, [plate, number, type]);
    if (previous.rowCount) { console.log('Envio já registrado nas últimas 24 horas.'); return; }
    const {rows} = await client.query(`INSERT INTO ${table} (placa,numero,tipo,mensagem)
      VALUES ($1,$2,$3,$4) RETURNING id`, [plate, number, type, message]);
    const result = await sendWhatsappText(number, message);
    await client.query(`UPDATE ${table} SET status='aceito',protocolo=$2 WHERE id=$1`,
      [rows[0].id, result?.key?.id || null]);
    console.log(JSON.stringify({status:'aceito', teste:test, placa:plate, protocolo:result?.key?.id || null}));
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(82424026)');
    client.release();
  }
}

async function close() {
  await pool.end();
  await getVeiculosPool().end();
}
async function tick() {
  try { await cycle(); } catch { console.error('Falha na consulta ou envio. Confira a auditoria; resultados incertos não são repetidos por 24 horas.'); }
  if (!stopping) timer = setTimeout(() => { running = tick(); }, 60_000);
}
try {
  if (!['--preview','--test','--worker','--init'].includes(mode)) throw Error('Modo inválido.');
  if (!/^[A-Z0-9]{7}$/.test(plate) || !/^55\d{10,11}$/.test(number)) throw Error('Placa ou destinatário inválido.');
  if (mode !== '--preview' && config.readOnly) throw Error('Modo somente consulta.');
  if (mode === '--init') { await init(); await close(); }
  else if (mode === '--worker') {
    await pool.query(`SELECT id FROM ${table} LIMIT 0`);
    console.log(`Monitor de bateria iniciado: ${plate}; consulta a cada minuto.`);
    const stop = async () => { stopping = true; clearTimeout(timer); await running; await close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    running = tick();
  } else { await cycle(); await close(); }
} catch {
  console.error('Não foi possível executar. Verifique modo, configuração, conexão e tabela de auditoria (--init).');
  await close(); process.exitCode = 1;
}
