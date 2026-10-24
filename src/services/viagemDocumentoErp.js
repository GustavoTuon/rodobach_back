import { clientPool } from '../db/clientPool.js';

export const normalizePlate = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function documentType(ownership) {
  const value = String(ownership || '').toUpperCase();
  if (value === 'FROTA') return 'viagem_frota';
  if (value === 'TERCEIRO') return 'carta_frete';
  throw Object.assign(new Error('Defina se o veículo é frota ou terceiro no cadastro da viagem.'), {status:400});
}

export async function searchTripDocuments(trip, filters = {}) {
  const tipo = documentType(trip.tipo_propriedade);
  const placa = normalizePlate(trip.placa_veiculo);
  if (!placa) throw Object.assign(new Error('Informe a placa no cadastro da viagem.'), {status:400});
  const numero = String(filters.numero || '').trim();
  const data = String(filters.data || '');
  const page = Number(filters.page || 1);
  if ((numero && !/^\d{1,20}$/.test(numero)) || !Number.isSafeInteger(page) || page < 1 || page > 10000
    || (data && (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(data)) || new Date(data).toISOString().slice(0,10) !== data))) {
    throw Object.assign(new Error('Confira o número e a data informados.'), {status:400});
  }
  const frota = tipo === 'viagem_frota';
  const suffix = frota ? 'cvg' : 'cfr';
  const dateColumn = frota ? 'datasaidacvg' : 'datacfr';
  const params = [placa];
  const where = [`REGEXP_REPLACE(UPPER(TRIM(d.veiculo${suffix})), '[^A-Z0-9]', '', 'g')=$1`];
  if (frota) where.push("COALESCE(s.nomescv,'') NOT ILIKE '%cancel%'");
  else where.push('COALESCE(d.statuscfr,0)<>3');
  if (numero) { params.push(numero.replace(/^0+(?=\d)/,'')); where.push(`d.codigo${suffix}::text=$${params.length}`); }
  if (data) { params.push(data); where.push(`d.${dateColumn}>=$${params.length}::date AND d.${dateColumn}<$${params.length}::date + INTERVAL '1 day'`); }
  if (filters.empresa !== undefined) { params.push(String(filters.empresa)); where.push(`d.empresa${suffix}::text=$${params.length}`); }
  if (!frota && filters.serie !== undefined) { params.push(String(filters.serie)); where.push(`TRIM(d.seriecfr)=$${params.length}`); }
  params.push((page-1)*50);
  const {rows} = await clientPool.query(`SELECT d.codigo${suffix}::text AS numero,
    d.empresa${suffix}::text AS empresa, ${frota ? "''::text" : 'TRIM(d.seriecfr)'} AS serie,
    TRIM(d.veiculo${suffix}) AS placa, d.${dateColumn}::date::text AS data,
    COALESCE(m.nomemot,'') AS motorista
    FROM logistica.${frota ? 'controleviagens' : 'cartasfretes'} d
    LEFT JOIN frotas.motoristas m ON m.codigomot=d.motorista${suffix} AND m.empresamot=d.empresa${suffix}
    ${frota ? 'LEFT JOIN logistica.statuscontroleviagens s ON s.codigoscv=d.statuscvg' : ''}
    WHERE ${where.join(' AND ')} ORDER BY d.${dateColumn} DESC NULLS LAST,d.codigo${suffix} DESC,d.empresa${suffix}${frota ? '' : ',d.seriecfr'}
    LIMIT 51 OFFSET $${params.length}`,params);
  return {items:rows.slice(0,50).map(row=>({...row,tipo})),page,hasMore:rows.length>50};
}
