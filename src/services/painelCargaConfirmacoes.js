import {createHash} from 'node:crypto';
import {pool} from '../db/pool.js';
import {tableName} from '../config.js';

const table = () => tableName('painel_carga_confirmacoes');
const fail = message => Object.assign(new Error(message), {status: 400});
export function cargoContext(row, sm) {
  return createHash('sha256').update(JSON.stringify([
    row.placa, row.estado, row.statusFonte, row.chaveCte, row.codigoConhecimento, row.documento,
    row.viagem, row.carga, row.emissaoAt, row.saidaAt, row.entregaAt, row.eventoReferenciaAt,
    sm?.id, sm?.inicio, sm?.fim, sm?.operacao,
    row.operacaoCarga,
    row.macroCargaContexto,
  ])).digest('hex');
}
export function validateCargoConfirmation(body, now = new Date()) {
  const placa = String(body.placa || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const motivo = String(body.motivo || '').trim();
  const date = new Date(body.confirmadoEm);
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa) || !['carregado', 'vazio'].includes(body.situacao)) throw fail('Informe veículo e situação válidos.');
  if (motivo.length < 5 || motivo.length > 500) throw fail('Informe um motivo entre 5 e 500 caracteres.');
  if (typeof body.confirmadoEm !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(body.confirmadoEm) || !Number.isFinite(+date) || date > now || now - date > 180 * 86400000) throw fail('Informe data e hora com fuso, não futuras e dentro dos últimos 180 dias.');
  if (typeof body.contexto !== 'string' || !/^[a-f0-9]{64}$/.test(body.contexto)) throw fail('Atualize o painel antes de confirmar.');
  if (body.situacao === 'vazio') return {placa,motivo,situacao:'vazio',confirmadoEm:date.toISOString(),expiraEm:null,contexto:body.contexto};
  const expiry = body.expiraEm === undefined ? new Date(now.getTime() + 24 * 3600000) : new Date(body.expiraEm);
  if ((body.expiraEm !== undefined && (typeof body.expiraEm !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(body.expiraEm))) || !Number.isFinite(+expiry) || expiry <= now || expiry <= date) throw fail('Informe uma data e hora de validade futura, com fuso.');
  return {placa, motivo, situacao: body.situacao, confirmadoEm: date.toISOString(), expiraEm: expiry.toISOString(), contexto: body.contexto};
}
export function correctionState(record, item, now = new Date()) {
  if (record.cancelado_em) return 'Desfeita';
  if (Array.isArray(record.documentos_referencia)) {
    if (record.novo_documento_em || item?.documentosCarga?.some(id => !record.documentos_referencia.includes(id))) return 'Novo documento';
    return item ? 'Ativa' : 'Veículo indisponível';
  }
  if (new Date(record.expira_em) <= now) return 'Expirada';
  if (!item || record.contexto !== item.contextoCarga) return 'Operação alterada';
  return 'Ativa';
}
export function applyCargoConfirmation(item, record, now = new Date()) {
  if (!record || record.cancelado_em) return item;
  if (Array.isArray(record.documentos_referencia)) {
    if (correctionState(record,item,now) !== 'Ativa') return item;
  } else if (record.contexto !== item.contextoCarga) return item;
  if (correctionState(record, item, now) === 'Expirada') return {...item, cargaAutomatica: item.carga,
    carga: {codigo: record.situacao, label: record.situacao === 'vazio' ? 'Vazio' : 'Carregado',
      desde: record.confirmado_em, horasVazio: null, confirmacaoPendente: true,
      fonte: `Confirmação pendente · Última situação manual de ${record.usuario_nome}; confirmação expirada.`}};
  return {...item, cargaAutomatica: item.carga,
    confirmacaoManual: {id: record.id, usuario: record.usuario_nome, criadoEm: record.criado_em, expiraEm: record.expira_em, motivo: record.motivo},
    carga: {codigo: record.situacao, label: record.situacao === 'vazio' ? 'Vazio' : 'Carregado',
      desde: record.confirmado_em, horasVazio: record.situacao === 'vazio' ? Math.max(0, (now - new Date(record.confirmado_em)) / 3600000) : null,
      fonte: `Confirmação manual · ${record.usuario_nome}`},
    // A manual state does not establish a new destination.
    rota: record.situacao === 'vazio' && item.rota?.fonte !== 'SM ativa' ? {destino: null, previsaoFim: null, fonte: null} : item.rota};
}
export async function withCargoConfirmations(data) {
  let rows;
  try {
    ({rows} = await pool.query(`SELECT DISTINCT ON (placa) * FROM ${table()} ORDER BY placa, id DESC`));
  } catch (error) {
    if (error.code === '42P01') return {...data, confirmacoesDisponiveis: false};
    throw error;
  }
  const map = new Map(rows.map(row => [row.placa, row]));
  const ended=data.itens.map(item=>map.get(item.placa)).filter(record=>record&&!record.novo_documento_em&&correctionState(record,data.itens.find(i=>i.placa===record.placa))==='Novo documento');
  if(ended.length)await pool.query(`UPDATE ${table()} SET novo_documento_em=now() WHERE id=ANY($1::bigint[]) AND novo_documento_em IS NULL`,[ended.map(r=>r.id)]);
  return {...data, confirmacoesDisponiveis: true, itens: data.itens.map(item => applyCargoConfirmation(item, map.get(item.placa)))};
}
export async function saveCargoConfirmation(input, user, item) {
  if(input.situacao==='vazio'&&!Array.isArray(item?.documentosCarga))throw fail('Atualize o painel antes de confirmar vazio.');
  const {rows} = await pool.query(`INSERT INTO ${table()} (placa,situacao,confirmado_em,motivo,contexto,usuario_id,usuario_nome,expira_em,documentos_referencia)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [input.placa, input.situacao, input.confirmadoEm, input.motivo, input.contexto, user.id, user.login || String(user.id), input.expiraEm,input.situacao==='vazio'?JSON.stringify(item.documentosCarga):null]);
  return rows[0];
}
export async function cargoConfirmationHistory(placa) {
  if (!/^[A-Z0-9]{7}$/.test(placa)) throw fail('Placa inválida.');
  return (await pool.query(`SELECT * FROM ${table()} WHERE placa=$1 ORDER BY id DESC LIMIT 50`, [placa])).rows;
}
export async function cancelCargoConfirmation(id, user) {
  if (!/^[0-9]+$/.test(String(id))) throw fail('Confirmação inválida.');
  const {rowCount} = await pool.query(`UPDATE ${table()} SET cancelado_em=now(), cancelado_por=$2 WHERE id=$1 AND cancelado_em IS NULL`, [id, user.id]);
  if (!rowCount) throw Object.assign(new Error('Confirmação não encontrada ou já desfeita.'), {status: 404});
}
