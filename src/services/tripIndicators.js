import { clientPool } from '../db/clientPool.js';
import { getDreEmpresarial } from './dreEmpresarialService.js';

// Contas de custos fixos da frota no plano financeiro do cliente.
export const FIXED_ACCOUNTS = ['4.1.002','4.1.006','6.2.015','6.2.040','6.2.057','6.2.063','6.2.067','6.5.001'];
const numeric = value => Number(value || 0);
const money = value => Math.round((numeric(value)+Number.EPSILON)*100)/100;
export function monthShare(reference, start, end) {
  const month = reference.slice(0,7);
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth()+1,0));
  const from = Math.max(first.getTime(),Date.parse(`${start}T00:00:00Z`));
  const to = Math.min(last.getTime(),Date.parse(`${end}T00:00:00Z`));
  return {dias:Math.max(0,Math.round((to-from)/86400000)+1),diasMes:last.getUTCDate()};
}
function summary(rows) {
  const receita=money(rows.filter(r=>r.tipo==='Receita').reduce((s,r)=>s+r.valor,0));
  const custo=money(-rows.filter(r=>r.tipo!=='Receita').reduce((s,r)=>s+r.valor,0));
  const lucro=money(receita-custo);
  return {receita,custo,lucro,margem:receita>0?money(lucro/receita*100):null};
}
export function vehicleIndicators(financialRows, fixedRows, start, end) {
  const rows=financialRows.filter(r=>{
    const fixed=r.tipo!=='Receita' && FIXED_ACCOUNTS.includes(r.contaMascara);
    if(fixed && r.origem==='pagar')return false; // Substituído pelas parcelas por vencimento.
    return fixed || (r.data>=start && r.data<=end);
  }).map(r=>({...r,fixo:r.tipo!=='Receita'&&FIXED_ACCOUNTS.includes(r.contaMascara)}));
  rows.push(...fixedRows.map(r=>({...r,tipo:'Despesa',fixo:true,origem:'pagar',valor:-numeric(r.valor)})));
  const itens=rows.map(r=>{
    const share=r.fixo?monthShare(r.data,start,end):null;
    return {data:r.data,documento:r.documento,conta:r.contaFinanceira,contaMascara:r.contaMascara,
      descricao:r.historico || r.contaFinanceira,tipo:r.tipo,fixo:r.fixo,origem:r.origem,
      valorOriginal:money(r.valor),valor:money(numeric(r.valor)*(share?share.dias/share.diasMes:1)),...share};
  });
  return {...summary(itens),fixos:money(-itens.filter(r=>r.fixo).reduce((s,r)=>s+r.valor,0)),
    financiamentos:money(-itens.filter(r=>r.contaMascara==='6.5.001').reduce((s,r)=>s+r.valor,0)),itens};
}
export function tripIndicators(trip) {
  // O saldo do controle já contém os ajustes do acerto; não somar suas rubricas novamente.
  if(trip.fretes==null || trip.totalViagem==null)return {disponivel:false};
  const receita=money(trip.fretes), lucro=money(trip.totalViagem), custo=money(receita-lucro);
  const componentes=[['Despesas',trip.despesas],['Abastecimentos',trip.abastecimentos],['Comissão',trip.comissao]]
    .map(([conta,valor])=>({conta,valor:money(valor)}));
  componentes.push({conta:'Demais ajustes do acerto (líquidos)',valor:money(custo-componentes.reduce((s,r)=>s+r.valor,0))});
  return {disponivel:true,receita,custo,lucro,margem:receita>0?money(lucro/receita*100):null,componentes};
}
export async function getTripIndicators(trip) {
  const viagem=tripIndicators(trip),start=trip.saida?.slice(0,10),end=trip.chegada?.slice(0,10);
  if(!start||!end||end<start||!trip.placa?.trim())return {viagem,veiculo:{disponivel:false,mensagem:'Informe placa e período válidos para analisar o veículo.'}};
  const first=start.slice(0,7)+'-01';
  const endDate=new Date(`${end}T00:00:00Z`);
  const last=new Date(Date.UTC(endDate.getUTCFullYear(),endDate.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const placa=trip.placa.toUpperCase().replace(/[^A-Z0-9]/g,'');
  const [dre,fixed]=await Promise.all([
    getDreEmpresarial({startDate:first,endDate:last,placa}),
    clientPool.query(`SELECT p.datavencimentopag::text AS data,p.documentopag AS documento,
      p.observacaopag AS historico,c.nomecfi AS "contaFinanceira",c.mascaracfi AS "contaMascara",v.valorliquido AS valor
      FROM financeiro.pagar p
      JOIN financeiro.valorliquidorateiospagar v ON v.empresa=p.empresapag AND v.serie=p.seriepag
        AND v.duplicata=p.duplicatapag AND v.parcela=p.parcelapag AND v.fornecedor=p.fornecedorpag
      LEFT JOIN LATERAL (SELECT nomecfi,mascaracfi FROM financeiro.contasfinanceiras WHERE codigocfi=v.contafinanceira
        ORDER BY (empresacfi=p.empresapag) DESC,empresacfi LIMIT 1) c ON true
      LEFT JOIN LATERAL (SELECT min(regexp_replace(upper(placavei),'[^A-Z0-9]','','g')) AS placa FROM frotas.veiculos
        WHERE centrocustovei=v.centrocusto AND empresavei=p.empresapag
        HAVING count(DISTINCT regexp_replace(upper(placavei),'[^A-Z0-9]','','g'))=1) vehicle ON true
      WHERE p.statuspag IN (1,2) AND p.datavencimentopag BETWEEN $1::date AND $2::date
        AND c.mascaracfi=ANY($4::text[])
        AND COALESCE(NULLIF(regexp_replace(upper(p.veiculopag),'[^A-Z0-9]','','g'),''),vehicle.placa)=$3`,[first,last,placa,FIXED_ACCOUNTS]),
  ]);
  return {viagem,veiculo:{disponivel:true,inicio:start,fim:end,...vehicleIndicators(dre.rows,fixed.rows,start,end)}};
}
