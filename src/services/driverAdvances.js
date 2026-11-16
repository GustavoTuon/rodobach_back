import {clientPool} from '../db/clientPool.js';

export function payableStatus(row,today){
  if(Number(row.open)<=0)return 'settled';
  if(!row.due)return 'undated';
  return row.due<today?'overdue':row.due===today?'today':'future';
}
export async function driverAdvances(){
  const {rows}=await clientPool.query(`SELECT
    concat(p.empresapag,':',p.seriepag,':',p.duplicatapag,':',p.parcelapag,':',p.fornecedorpag) AS id,
    p.empresapag AS company,p.seriepag AS series,p.duplicatapag::text AS document,p.parcelapag AS installment,
    COALESCE(NULLIF(trim(m.nomemot),''),'Motorista não informado') AS driver,
    m.codigomot::text AS "driverCode",
    COALESCE(NULLIF(trim(p.veiculopag),''),cf.veiculocfr) AS plate,
    COALESCE(NULLIF(trim(f.nomefor),''),'Fornecedor não informado') AS supplier,
    p.dataemissaopag::date::text AS issued,p.datavencimentopag::date::text AS due,
    p.valorduplicatapag AS amount,p.valorabertopag AS open,p.observacaopag AS note,
    COALESCE(pay.paid,0) AS paid,pay.last_paid AS "lastPaid",
    COALESCE(s.nomespg,p.seriepag) AS category,
    'charter' AS type,
    (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
    FROM financeiro.pagar p
    LEFT JOIN logistica.cartasfretes cf ON cf.empresacfr=p.empresapag
      AND cf.seriecfr=p.seriepag AND cf.codigocfr=p.duplicatapag
      AND cf.proprietariocfr=p.fornecedorpag
    LEFT JOIN LATERAL (SELECT nomemot,codigomot FROM frotas.motoristas
      WHERE codigomot=cf.motoristacfr
      ORDER BY (empresamot=p.empresapag) DESC,empresamot,codigomot LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT nomefor FROM gerais.fornecedores WHERE codigofor=p.fornecedorpag
      ORDER BY (empresafor=p.empresapag) DESC,empresafor LIMIT 1) f ON true
    LEFT JOIN financeiro.seriespagar s ON s.empresaspg=p.empresapag AND s.codigospg=p.seriepag
    LEFT JOIN LATERAL (SELECT SUM(pp.valorpagoppg) AS paid,MAX(pp.datapagamentoppg)::date::text AS last_paid
      FROM financeiro.pagarpagamentos pp WHERE pp.empresappg=p.empresapag AND pp.serieppg=p.seriepag
        AND pp.duplicatappg=p.duplicatapag AND pp.parcelappg=p.parcelapag
        AND pp.fornecedorppg=p.fornecedorpag) pay ON true
    WHERE p.seriepag='C' AND p.statuspag IN (1,2)
      AND (p.valorabertopag>0 OR p.dataemissaopag >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '12 months')
    ORDER BY (p.valorabertopag>0) DESC,p.datavencimentopag ASC NULLS LAST,p.empresapag,p.seriepag,p.duplicatapag,p.parcelapag`);
  const today=rows[0]?.today || new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  return {today,updatedAt:new Date().toISOString(),records:rows.map(row=>({...row,amount:Number(row.amount)||0,paid:Number(row.paid)||0,open:Number(row.open)||0,status:payableStatus(row,today)}))};
}
