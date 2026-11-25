import {clientPool} from '../db/clientPool.js';

export async function reimbursementList(records, db=clientPool) {
  try {
    const updated=await reimbursementReceipts(records,db);
    return {records:updated,reimbursementCheckedAt:updated.find(row=>row.reimbursementSync?.checkedAt)?.reimbursementSync.checkedAt || null};
  }
  catch {
    return {records:records.map(row=>row.reimbursement?.erpDocument ? {...row,reimbursementSync:{status:'unavailable',checkedAt:null}} : row),reimbursementCheckedAt:null,reimbursementWarning:'Não foi possível atualizar os reembolsos pelo ERP. As situações exibidas são as últimas registradas. Tente Atualizar lista novamente.'};
  }
}

// Live ERP projection: no writes to the ERP and no synthetic local payment events.
export async function reimbursementReceipts(records, db=clientPool) {
  const linked=records.filter(row=>row.reimbursement?.erpDocument);
  if(!linked.length) return records;
  const identities=linked.map(row=>({id:row.id,...row.reimbursement.erpDocument}));
  // Resolve document links first; scanning every receivable with correlated OR/EXISTS
  // made seven linked CT-es take ~25 seconds. UNION also deduplicates both link sources.
  const {rows}=await db.query(`WITH docs AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS d(id text,company text,series text,code text)
  ), linked_ctes AS (
    SELECT d.id,c.empresacon,c.seriecon,c.codigocon
    FROM docs d
    JOIN logistica.conhecimentos c ON c.empresacon=d.company::bigint
      AND c.seriecon=d.series AND c.codigocon=d.code::bigint AND c.statuscon=2
  ), titles AS (
    SELECT d.id,r.empresarec,r.serierec,r.duplicatarec,r.parcelarec,
      r.valorabertorec,r.valorduplicatarec,r.statusrec
    FROM linked_ctes d
    JOIN financeiro.receberconhecimentosvinculados v ON v.empresa=d.empresacon
      AND v.serieconhecimento=d.seriecon AND v.codigoconhecimento=d.codigocon
    JOIN financeiro.receber r ON r.empresarec=v.empresa AND r.serierec=v.serie AND r.duplicatarec=v.duplicata
    UNION
    SELECT d.id,r.empresarec,r.serierec,r.duplicatarec,r.parcelarec,
      r.valorabertorec,r.valorduplicatarec,r.statusrec
    FROM linked_ctes d
    JOIN financeiro.receberconhecimentos v ON v.empresarcc=d.empresacon AND v.conhecimentorcc=d.codigocon
    JOIN financeiro.receber r ON r.empresarec=v.empresarcc AND r.serierec=v.seriercc
      AND r.duplicatarec=v.duplicatarcc AND r.parcelarec=v.parcelarcc
    WHERE (SELECT count(*) FROM logistica.conhecimentos x
      WHERE x.empresacon=d.empresacon AND x.codigocon=d.codigocon)=1
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
  const checkedAt=new Date().toISOString();
  return records.map(row=>{
    if(!row.reimbursement?.erpDocument) return row;
    const result=results.get(row.id);
    return {...row,reimbursementSync:{status:result?'verified':'needs_review',checkedAt},reimbursement:{...row.reimbursement,status:result?.paid===true?'recebido':'cobrado',
      receivedDate:result?.paid===true?result.date:null}};
  });
}
