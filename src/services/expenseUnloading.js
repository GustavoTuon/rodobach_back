import {clientPool} from '../db/clientPool.js';

const tripColumns = `empresacvg::text AS company,codigocvg::text AS number,
  veiculocvg AS plate,datasaidacvg::text AS departure`;
const plateFilter = `regexp_replace(upper(veiculocvg), '[^A-Z0-9]', '', 'g')=$1`;

export async function unloadingTrips(plate, number = '') {
  const {rows} = await clientPool.query(`SELECT ${tripColumns} FROM logistica.controleviagens
    WHERE ${plateFilter} AND ($2::text='' OR codigocvg::text=$2)
    ORDER BY datasaidacvg DESC NULLS LAST,empresacvg,codigocvg DESC LIMIT 50`, [plate,number]);
  return rows;
}

export async function unloadingTrip(plate, company, number) {
  const {rows} = await clientPool.query(`SELECT ${tripColumns} FROM logistica.controleviagens
    WHERE ${plateFilter} AND empresacvg::text=$2 AND codigocvg::text=$3`, [plate,company,number]);
  if (!rows[0]) throw Object.assign(new Error('Viagem não encontrada para esta placa.'), {statusCode:400});
  return rows[0];
}

export async function unloadingCtes(company, number) {
  const {rows} = await clientPool.query(`SELECT c.empresacon::text AS company,c.seriecon AS series,
    c.codigocon::text AS code,c.numeroctecon::text AS number,c.clientecon::text AS "customerCode",
    COALESCE(NULLIF(TRIM(cli.nomecli),''), 'Cliente não identificado') AS "customerName"
    FROM logistica.conhecimentos c
    LEFT JOIN LATERAL (SELECT nomecli FROM gerais.clientes WHERE codigocli=c.clientecon
      ORDER BY (empresacli=c.empresacon) DESC,empresacli LIMIT 1) cli ON true
    WHERE c.statuscon=2 AND ((c.empresaviagemcon::text=$1 AND c.viagemcon::text=$2)
      OR EXISTS (SELECT 1 FROM logistica.controleviagensfretes f
        WHERE f.empresacvf::text=$1 AND f.codigocvf::text=$2
        AND f.empresaconhecimentocvf=c.empresacon AND f.serieconhecimentocvf=c.seriecon
        AND f.conhecimentocvf=c.codigocon))
    ORDER BY c.numeroctecon,c.empresacon,c.seriecon,c.codigocon`, [company,number]);
  return rows;
}

export async function resolveUnloading(plate, input) {
  if (!input) throw Object.assign(new Error('Informe a viagem, o CT-e e se haverá reembolso da descarga.'), {statusCode:400});
  const trip = await unloadingTrip(plate,input.trip.company,input.trip.number);
  const ctes = await unloadingCtes(trip.company,trip.number);
  const cte = ctes.find(row => row.company===input.cte.company && row.series===input.cte.series && row.code===input.cte.code);
  if (!cte) throw Object.assign(new Error('O CT-e selecionado não está autorizado e vinculado a esta viagem no ERP.'), {statusCode:400});
  return {trip,cte,reimbursement:input.reimbursement};
}
