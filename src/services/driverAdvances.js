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
    m.nomemot AS driver,m.codigomot::text AS "driverCode",p.veiculopag AS plate,
    p.dataemissaopag::date::text AS issued,p.datavencimentopag::date::text AS due,
    p.valorduplicatapag AS amount,p.valorabertopag AS open,p.observacaopag AS note,
    COALESCE(s.nomespg,p.seriepag) AS category,
    CASE WHEN s.nomespg ILIKE '%ADIANTAMENTO%' THEN 'advance' ELSE 'other' END AS type,
    (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
    FROM financeiro.pagar p
    JOIN LATERAL (SELECT nomemot,codigomot FROM frotas.motoristas
      WHERE fornecedormot=p.fornecedorpag
      ORDER BY (empresamot=p.empresapag) DESC,empresamot,codigomot LIMIT 1) m ON true
    LEFT JOIN financeiro.seriespagar s ON s.empresaspg=p.empresapag AND s.codigospg=p.seriepag
    WHERE p.statuspag IN (1,2)
      AND (p.valorabertopag>0 OR p.dataemissaopag >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '12 months')
    ORDER BY (p.valorabertopag>0) DESC,p.datavencimentopag ASC NULLS LAST,p.empresapag,p.seriepag,p.duplicatapag,p.parcelapag`);
  const today=rows[0]?.today || new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  return {today,updatedAt:new Date().toISOString(),records:rows.map(row=>({...row,amount:Number(row.amount)||0,open:Number(row.open)||0,status:payableStatus(row,today)}))};
}
