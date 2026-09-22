import {clientPool} from '../db/clientPool.js';
import {createAsyncCache} from './asyncCache.js';
import {buildClienteMargem, resolveMargemPeriod} from './clienteMargemModel.js';

const cache = createAsyncCache({ttlMs: 30000, maxEntries: 6, maxPending: 3});
export const CLIENT_MARGIN_SQL = `
SELECT CONCAT(con.empresacon, ':', con.seriecon, ':', con.codigocon) AS id,
  con.empresacon AS empresa, con.seriecon AS serie, con.codigocon AS codigo, con.numeroctecon AS numero,
  con.dataemissaocon::date::text AS data, con.viagemcon AS viagem,
  COALESCE(con.empresaviagemcon, con.empresacon) AS empresa_viagem,
  UPPER(TRIM(con.veiculocon::text)) AS placa,
  tomador.codigo AS cliente_codigo, cli.nome AS cliente,
  NULLIF(CONCAT_WS('/', origem.nomecid, origem_uf.abreviaturaest), '') AS origem,
  NULLIF(CONCAT_WS('/', destino.nomecid, destino_uf.abreviaturaest), '') AS destino,
  COALESCE(NULLIF(con.totalcon, 0), con.valorfretecon) AS receita,
  COALESCE(NULLIF(cvf.custo, 0), NULLIF(con.viagemvalorfretemotoristacon, 0)) AS custo_motorista,
  COALESCE(cartas.items, '[]'::json) AS cartas
FROM logistica.conhecimentos con
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(NULLIF(f.valorfretemotoristacvf, 0), NULLIF(f.valorfretepesomotoristacvf, 0), NULLIF(f.valorcomissaocvf, 0))) AS custo
  FROM logistica.controleviagensfretes f
  WHERE f.empresaconhecimentocvf=con.empresacon AND f.serieconhecimentocvf=con.seriecon AND f.conhecimentocvf=con.codigocon
) cvf ON true
LEFT JOIN LATERAL (
  SELECT JSON_AGG(JSON_BUILD_OBJECT('id', CONCAT(c.empresacfr, ':', c.seriecfr, ':', c.codigocfr),
    'valor', c.valorfretecfr, 'documentos', (
      SELECT COUNT(DISTINCT (all_links.serieconhecimentocfc, all_links.conhecimentocfc))
      FROM logistica.cartasfretesconhecimentos all_links
      WHERE all_links.empresacfc=c.empresacfr AND all_links.seriecfc=c.seriecfr AND all_links.codigocfc=c.codigocfr
    ))) AS items
  FROM logistica.cartasfretes c
  WHERE COALESCE(c.statuscfr, 0) <> 3 AND NULLIF(TRIM(c.motivocancelamentocfr), '') IS NULL
    AND EXISTS (SELECT 1 FROM logistica.cartasfretesconhecimentos l
      WHERE l.empresacfc=c.empresacfr AND l.seriecfc=c.seriecfr AND l.codigocfc=c.codigocfr
        AND l.empresacfc=con.empresacon AND l.serieconhecimentocfc=con.seriecon AND l.conhecimentocfc=con.codigocon)
) cartas ON true
CROSS JOIN LATERAL (
  SELECT CASE con.tomadorservicoctecon
    WHEN 4 THEN COALESCE(con.tomadorservicooutroscon, con.clientecon)
    WHEN 3 THEN COALESCE(con.destinatariocon, con.clientecon)
    WHEN 2 THEN COALESCE(con.recebedorcon, con.clientecon)
    WHEN 1 THEN COALESCE(con.expedidorcon, con.clientecon)
    ELSE con.clientecon END AS codigo
) tomador
LEFT JOIN LATERAL (
  SELECT tomador.codigo, COALESCE(NULLIF(TRIM(c.fantasiacli), ''), c.nomecli) AS nome
  FROM gerais.clientes c WHERE c.codigocli=tomador.codigo
  ORDER BY (c.empresacli=con.empresacon) DESC, c.empresacli LIMIT 1
) cli ON true
LEFT JOIN localidades.cidades origem ON origem.codigocid=con.cidadecoletacon
LEFT JOIN localidades.estados origem_uf ON origem_uf.codigoest=origem.estadocid
LEFT JOIN localidades.cidades destino ON destino.codigocid=con.cidadeentregacon
LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest=destino.estadocid
WHERE con.statuscon=2 AND con.tipoctecon IN (0,3)
  AND NULLIF(TRIM(con.chavectecon), '') IS NOT NULL
  AND con.dataemissaocon::date BETWEEN $1::date AND $2::date
  AND NOT EXISTS (
    SELECT 1 FROM logistica.conhecimentos other
    WHERE other.statuscon=2 AND other.tipoctecon IN (0,3)
      AND TRIM(other.chavectecon)=TRIM(con.chavectecon)
      AND (other.empresacon, other.seriecon, other.codigocon) < (con.empresacon, con.seriecon, con.codigocon)
  )
ORDER BY con.dataemissaocon DESC, con.empresacon, con.seriecon, con.codigocon
LIMIT 10001`;

export async function getClienteMargem(filters = {}) {
  const periods = resolveMargemPeriod(filters);
  return cache.get(JSON.stringify(periods), async () => {
    const {rows} = await clientPool.query(CLIENT_MARGIN_SQL, [periods.previous.startDate, periods.current.endDate]);
    if (rows.length > 10000) throw Object.assign(new Error('Mais de 10 mil documentos no comparativo. Reduza o período para obter uma análise completa.'), {status: 422});
    return buildClienteMargem(rows, periods);
  });
}
