import {clientPool} from '../db/clientPool.js';

export async function reimbursementList(records, db=clientPool) {
  try {return {records:await reimbursementReceipts(records,db)};}
  catch {
    return {records,reimbursementWarning:'Não foi possível atualizar os reembolsos pelo ERP. As situações exibidas são as últimas registradas. Tente Atualizar lista novamente.'};
  }
}

// Live ERP projection: no writes to the ERP and no synthetic local payment events.
export async function reimbursementReceipts(records, db=clientPool) {
  const linked=records.filter(row=>row.reimbursement?.erpDocument);
  if(!linked.length) return records;
  const identities=linked.map(row=>({id:row.id,...row.reimbursement.erpDocument}));
  const {rows}=await db.query(`WITH docs AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS d(id text,company text,series text,code text)
  ), titles AS (
    SELECT DISTINCT d.id,r.empresarec,r.serierec,r.duplicatarec,r.parcelarec,
      r.valorabertorec,r.valorduplicatarec,r.statusrec
    FROM docs d
    JOIN logistica.conhecimentos c ON c.empresacon::text=d.company
      AND c.seriecon=d.series AND c.codigocon::text=d.code AND c.statuscon=2
    JOIN financeiro.receber r ON r.empresarec=c.empresacon AND (
      EXISTS (SELECT 1 FROM financeiro.receberconhecimentosvinculados v
        WHERE v.empresa=r.empresarec AND v.serie=r.serierec AND v.duplicata=r.duplicatarec
          AND v.serieconhecimento=c.seriecon AND v.codigoconhecimento=c.codigocon)
      OR EXISTS (SELECT 1 FROM financeiro.receberconhecimentos v
        WHERE v.empresarcc=r.empresarec AND v.seriercc=r.serierec AND v.duplicatarcc=r.duplicatarec
          AND v.parcelarcc=r.parcelarec AND v.conhecimentorcc=c.codigocon
          AND (SELECT count(*) FROM logistica.conhecimentos x
            WHERE x.empresacon=c.empresacon AND x.codigocon=c.codigocon)=1)
    )
  ), receipts AS (
    SELECT t.*,p.received_date FROM titles t
    LEFT JOIN LATERAL (SELECT MAX(p.datarecebimentorcb::date)::text AS received_date
      FROM financeiro.receberrecebimentos p WHERE p.empresarcb=t.empresarec
        AND p.seriercb=t.serierec AND p.duplicatarcb=t.duplicatarec AND p.parcelarcb=t.parcelarec
        AND p.valorrecebidorcb>0 AND p.datarecebimentorcb::date <= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
    ) p ON true
  ) SELECT id,BOOL_AND(COALESCE(statusrec IN (1,2) AND valorduplicatarec>0
      AND valorabertorec=0 AND received_date IS NOT NULL,false)) AS paid,
      MAX(received_date) AS date FROM receipts GROUP BY id`,[JSON.stringify(identities)]);
  const results=new Map(rows.map(row=>[row.id,row]));
  return records.map(row=>{
    if(!row.reimbursement?.erpDocument) return row;
    const result=results.get(row.id);
    return {...row,reimbursement:{...row.reimbursement,status:result?.paid===true?'recebido':'cobrado',
      receivedDate:result?.paid===true?result.date:null}};
  });
}
