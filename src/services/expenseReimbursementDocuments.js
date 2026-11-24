import {clientPool} from '../db/clientPool.js';

export async function reimbursementDocuments(plate, date, number='', identity=null, series='') {
  const {rows}=await clientPool.query(`SELECT c.empresacon::text AS company,c.seriecon AS series,
    c.codigocon::text AS code,COALESCE(c.numeroctecon,c.codigocon)::text AS number,
    c.dataemissaocon::date::text AS date,COALESCE(cli.nomecli,'') AS "customerName"
    FROM logistica.conhecimentos c
    LEFT JOIN LATERAL (SELECT nomecli FROM gerais.clientes WHERE codigocli=c.clientecon
      ORDER BY (empresacli=c.empresacon) DESC,empresacli LIMIT 1) cli ON true
    WHERE c.statuscon=2 AND c.tipoctecon=1
      AND UPPER(TRIM(c.seriecon)) NOT IN ('O','OC')
      AND NULLIF(TRIM(c.chaveorcamentocon),'') IS NULL
      AND regexp_replace(upper(c.veiculocon),'[^A-Z0-9]','','g')=$1
      AND c.dataemissaocon >= $2::date - INTERVAL '30 days'
      AND c.dataemissaocon < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + INTERVAL '1 day'
      AND ($3::text='' OR COALESCE(c.numeroctecon,c.codigocon)::text=ltrim($3,'0'))
      AND ($4::text IS NULL OR (c.empresacon::text=$4 AND c.seriecon=$5 AND c.codigocon::text=$6))
      AND ($7::text='' OR UPPER(TRIM(c.seriecon))=UPPER($7))
    ORDER BY c.dataemissaocon DESC,c.empresacon,c.seriecon,c.codigocon LIMIT 50`,
    [plate,date,number,identity?.company || null,identity?.series || null,identity?.code || null,series.trim()]);
  return rows;
}
