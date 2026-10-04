import { clientPool } from '../db/clientPool.js';

export function classifyTripCtes(rows, trip) {
  const documentos = rows.map(row => {
    const links = row.vinculos || [];
    const current = links.some(v => Number(v.empresa) === Number(trip.empresa) && Number(v.numero) === Number(trip.numero));
    const others = links.filter(v => Number(v.empresa) !== Number(trip.empresa) || Number(v.numero) !== Number(trip.numero));
    const situacao = current && !row.noPeriodo ? 'fora_periodo'
      : others.length ? (current ? 'duplicado' : 'outra_viagem')
        : current ? 'vinculado' : 'sem_vinculo';
    return { ...row, situacao };
  });
  const priority = {sem_vinculo:0,outra_viagem:1,duplicado:2,fora_periodo:3,vinculado:4};
  documentos.sort((a,b)=>priority[a.situacao]-priority[b.situacao]);
  const count = predicate => documentos.filter(predicate).length;
  return { disponivel: true, inicio: trip.saida?.slice(0,10), fim: trip.chegada?.slice(0,10), documentos,
    emitidos: count(v => v.noPeriodo), vinculados: count(v => v.noPeriodo && v.situacao === 'vinculado'),
    semVinculo: count(v => v.situacao === 'sem_vinculo'),
    divergencias: count(v => !['vinculado','sem_vinculo'].includes(v.situacao)),
    pendencias: count(v => v.situacao !== 'vinculado') };
}

export async function auditTripCtes(trip) {
  const inicio = trip.saida?.slice(0,10), fim = trip.chegada?.slice(0,10);
  if (!inicio || !fim || fim < inicio || !trip.placa?.trim()) {
    return { disponivel: false, mensagem: 'Informe placa, saída e chegada válidas na viagem para conferir os CT-es.' };
  }
  const { rows } = await clientPool.query(`
    WITH links AS (
      SELECT DISTINCT empresaconhecimentocvf AS empresa, serieconhecimentocvf AS serie,
        conhecimentocvf AS codigo, empresacvf AS "empresaViagem", codigocvf AS viagem
      FROM logistica.controleviagensfretes WHERE conhecimentocvf > 0
      UNION
      SELECT empresacon, seriecon, codigocon, empresaviagemcon, viagemcon
      FROM logistica.conhecimentos WHERE viagemcon > 0 AND empresaviagemcon > 0
    )
    SELECT c.empresacon AS empresa, c.seriecon AS serie, c.codigocon AS codigo,
      c.numeroctecon AS numero, c.dataemissaocon::text AS emissao, c.veiculocon AS placa,
      (c.dataemissaocon BETWEEN $3::date AND $4::date
        AND regexp_replace(upper(c.veiculocon), '[^A-Z0-9]', '', 'g') = $5) AS "noPeriodo",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('empresa',l."empresaViagem",'numero',l.viagem))
        FROM links l WHERE l.empresa=c.empresacon AND l.serie=c.seriecon AND l.codigo=c.codigocon),'[]'::jsonb) AS vinculos
    FROM logistica.conhecimentos c
    WHERE c.statuscon=2 AND (
      EXISTS (
        SELECT 1 FROM financeiro.receberconhecimentosvinculados rv
        JOIN financeiro.receber r ON r.empresarec=rv.empresa AND r.serierec=rv.serie AND r.duplicatarec=rv.duplicata AND r.statusrec IN (1,2)
        WHERE rv.empresa=c.empresacon AND rv.serieconhecimento=c.seriecon AND rv.codigoconhecimento=c.codigocon
      ) OR EXISTS (
        SELECT 1 FROM financeiro.receberconhecimentos rc
        JOIN financeiro.receber r ON r.empresarec=rc.empresarcc AND r.serierec=rc.seriercc AND r.duplicatarec=rc.duplicatarcc AND r.parcelarec=rc.parcelarcc AND r.statusrec IN (1,2)
        WHERE rc.empresarcc=c.empresacon AND rc.conhecimentorcc=c.codigocon
          AND (SELECT count(*) FROM logistica.conhecimentos same_code WHERE same_code.empresacon=c.empresacon AND same_code.codigocon=c.codigocon)=1
      )
    ) AND (
      (c.dataemissaocon BETWEEN $3::date AND $4::date
        AND regexp_replace(upper(c.veiculocon), '[^A-Z0-9]', '', 'g') = $5)
      OR EXISTS (SELECT 1 FROM links l WHERE l.empresa=c.empresacon AND l.serie=c.seriecon
        AND l.codigo=c.codigocon AND l."empresaViagem"=$1 AND l.viagem=$2))
    ORDER BY c.dataemissaocon,c.empresacon,c.seriecon,c.codigocon`,
  [trip.empresa, trip.numero, inicio, fim, trip.placa.toUpperCase().replace(/[^A-Z0-9]/g,'')]);
  return classifyTripCtes(rows, trip);
}
