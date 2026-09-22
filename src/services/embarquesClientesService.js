import { conciliarEmbarques } from './conciliacaoEmbarques.js';

function monthValue(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}

export function resolveEmbarquesPeriodos(filters = {}) {
  const mes = monthValue(filters.mes || filters.mesAno);
  const startDate = filters.startDate || `${mes}-01`;
  const endDate = filters.endDate || new Date(Date.UTC(Number(mes.slice(0,4)), Number(mes.slice(5)), 0)).toISOString().slice(0,10);
  if (![startDate,endDate].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d) || startDate > endDate || startDate.slice(0,7) !== endDate.slice(0,7)) throw new Error('Selecione datas válidas dentro do mesmo mês.');
  const shift = (date, offset) => {
    const [y,m,d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y,m+offset,0)).getUTCDate();
    return new Date(Date.UTC(y,m-1+offset,Math.min(d,last))).toISOString().slice(0,10);
  };
  const lastDay = date => { const [year,month]=date.split('-').map(Number); return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10); };
  const mesInteiro = startDate.endsWith('-01') && endDate === lastDay(startDate);
  const periodos = [0,-1,-2].map(offset => {
    const inicio=shift(startDate,offset);
    return {startDate:inicio,endDate:mesInteiro ? lastDay(inicio) : shift(endDate,offset)};
  });
  return {startDate,periodos};
}

export async function getEmbarquesClientes(filters = {}) {
  const {startDate,periodos}=resolveEmbarquesPeriodos(filters);
  const regioes = String(filters.regioes || filters.regiao || '').split(',').map(s=>s.trim()).filter(Boolean);
  const vendedor = String(filters.vendedor || "").trim() || null;
  const result=await conciliarEmbarques(periodos,regioes,vendedor);
  return {...result,periodo:{mesAtual:startDate.slice(0,7),mesAnterior:periodos[1].startDate.slice(0,7),periodos},criterio:'Quantidade de documentos: CT-es autorizados e orçamentos ativos, pela própria data de emissão, mesmo sem viagem vinculada. Orçamento convertido em CT-e válido e cópias da mesma chave contam uma vez. Complementos, anulações e cancelados não aumentam a quantidade. Receita financeira pela emissão do título, incluindo complementos.'};
}
