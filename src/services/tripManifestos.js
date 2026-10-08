import { clientPool } from '../db/clientPool.js';

export const cteIdentity = doc => `${doc.empresa}:${doc.serie}:${doc.codigo}`;
const fields = `m.empresamdf AS empresa, m.seriemdf AS serie, m.codigomdf AS numero,
  m.veiculomdf AS placa, m.statusmdf AS "statusCodigo", s.descricaosmd AS status,
  (m.datahoraautorizacaomdf AT TIME ZONE 'America/Sao_Paulo') AS "autorizadoEm",
  (m.datahoraencerramentomdf AT TIME ZONE 'America/Sao_Paulo') AS "encerradoEm"`;

export async function loadOpenManifestosByPlate(plates) {
  const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const list = [...new Set(plates.map(normalize).filter(Boolean))];
  if (!list.length) return new Map();
  // Authorized or issued in contingency, across every ERP company and date.
  // Drafts, cancellations and closures are not active manifests.
  const {rows} = await clientPool.query(`SELECT ${fields}
    FROM logistica.mdfe m LEFT JOIN logistica.statusmdfe s ON s.codigosmd=m.statusmdf
    WHERE regexp_replace(upper(m.veiculomdf), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND m.statusmdf IN (3,5)
      AND m.datahoraencerramentomdf IS NULL AND m.datahoracancelamentomdf IS NULL
    ORDER BY m.datahoraautorizacaomdf DESC NULLS LAST, m.empresamdf, m.seriemdf, m.codigomdf`, [list]);
  const result = new Map(list.map(p => [p, []]));
  for (const row of rows) result.get(normalize(row.placa))?.push(row);
  return result;
}

// Company, series and internal code together identify a CT-e in the ERP.
export async function loadCteManifestos(documents) {
  if (!documents.length) return new Map();
  const { rows } = await clientPool.query(`WITH alvo AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS a(empresa int, serie text, codigo int)
  ), links AS (
    SELECT a.*, d.empresamdc em, d.seriemdc se, d.codigomdc co FROM alvo a
    JOIN logistica.mdfeconhecimentos d ON d.empresaconhecimentomdc=a.empresa
      AND d.serieconhecimentomdc=a.serie AND d.codigoconhecimentomdc=a.codigo
    UNION
    SELECT a.*, f.empresamdfecvf, f.seriemdfecvf, f.mdfecvf FROM alvo a
    JOIN logistica.controleviagensfretes f ON f.empresaconhecimentocvf=a.empresa
      AND f.serieconhecimentocvf=a.serie AND f.conhecimentocvf=a.codigo
    WHERE f.mdfecvf > 0
  ) SELECT l.empresa AS "empresaCte", l.serie AS "serieCte", l.codigo AS "codigoCte", ${fields}
    FROM links l JOIN logistica.mdfe m ON m.empresamdf=l.em AND m.seriemdf=l.se AND m.codigomdf=l.co
    LEFT JOIN logistica.statusmdfe s ON s.codigosmd=m.statusmdf
    ORDER BY m.empresamdf,m.seriemdf,m.codigomdf`, [JSON.stringify(documents)]);
  const result = new Map();
  for (const { empresaCte, serieCte, codigoCte, ...manifesto } of rows) {
    const key = cteIdentity({empresa:empresaCte, serie:serieCte, codigo:codigoCte});
    result.set(key, [...(result.get(key) || []), manifesto]);
  }
  return result;
}

export async function getTripManifestos(trip) {
  const {rows} = await clientPool.query(`SELECT DISTINCT ${fields}
    FROM logistica.mdfe m LEFT JOIN logistica.statusmdfe s ON s.codigosmd=m.statusmdf
    WHERE (m.empresaviagemmdf=$1 AND m.viagemmdf=$2) OR EXISTS (
      SELECT 1 FROM logistica.controleviagensfretes f
      WHERE f.empresacvf=$1 AND f.codigocvf=$2 AND (
        (f.empresamdfecvf=m.empresamdf AND f.seriemdfecvf=m.seriemdf AND f.mdfecvf=m.codigomdf)
        OR EXISTS (SELECT 1 FROM logistica.mdfeconhecimentos d
          WHERE d.empresamdc=m.empresamdf AND d.seriemdc=m.seriemdf AND d.codigomdc=m.codigomdf
          AND d.empresaconhecimentomdc=f.empresaconhecimentocvf
          AND d.serieconhecimentomdc=f.serieconhecimentocvf AND d.codigoconhecimentomdc=f.conhecimentocvf)))
    ORDER BY numero`, [trip.empresa, trip.numero]);
  return rows;
}

// A cancelled MDF-e, a forecast or a partial closure cannot close the load.
export function manifestoCompletion(doc, now = new Date()) {
  const list = (doc.manifestos || []).filter(m => Number(m.statusCodigo) !== 6);
  if (!list.length) return null;
  const plate = v => String(v || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (!list.every(m => Number(m.statusCodigo) === 7 && m.encerradoEm
    && Number.isFinite(+new Date(m.encerradoEm)) && new Date(m.encerradoEm) <= now
    && new Date(m.encerradoEm) >= new Date(doc.emissaoAt)
    && (!m.autorizadoEm || new Date(m.encerradoEm) >= new Date(m.autorizadoEm))
    && plate(doc.placa) && plate(m.placa) === plate(doc.placa))) return null;
  return list.map(m => m.encerradoEm).sort((a,b) => new Date(b)-new Date(a))[0];
}
